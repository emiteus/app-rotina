/**
 * Aprovação permanente — "sempre sim" / "sempre não" (ideia do OpenJarvis/Stanford, 06/10/2026).
 * Na hora do "Posso X?", o usuário pode responder "sempre sim" (faz agora e não pergunta mais
 * pra MESMA ação com o MESMO alvo) ou "sempre não" (não faz e não pergunta mais).
 *
 * Segurança:
 *  - "sempre sim" é por LISTA DE LIBERAÇÃO: só tools com `standing: true` em TOOL_DEFS. Tool nova nasce
 *    perguntando. Critical nunca entra (dinheiro, apagar, publicar, deploy) — mesmo marcada.
 *  - teste logo depois de patch local (patch-marks) continua pedindo SIM sempre.
 *  - "sempre não" vale pra qualquer ação (bloquear é sempre seguro).
 *  - a regra casa ação + alvo exatos ("fechar o Discord" ≠ "fechar o Chrome"), em qualquer canal.
 *  - o usuário lista e desfaz ("o que você aprova sozinho?", "volta a me perguntar sobre X").
 */
const crypto = require('crypto');
const { get, run, all } = require('../host').requireLib('db');
const { once } = require('../db-once');

const SEMPRE_SIM = 'sempre_sim';
const SEMPRE_NAO = 'sempre_nao';
// Texto livre que não muda o que a ação faz (pergunta pro modelo, justificativa)
const VOLATEIS = new Set(['tipo', 'pergunta', 'question', 'motivo', 'reason', 'explicacao', 'porque']);

const fold = (s) =>
  String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Chave da ação: tipo + argumentos que importam, em ordem fixa, sem acento/maiúscula. */
function chaveDaAcao(a) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort()
        .reduce((o, k) => ((o[k] = norm(v[k])), o), {});
    }
    return typeof v === 'string' ? fold(v) : v;
  };
  const args = {};
  for (const [k, v] of Object.entries(a || {})) {
    if (!VOLATEIS.has(k) && v !== undefined && v !== null && v !== '') args[k] = v;
  }
  return `${String((a && a.tipo) || '')}|${JSON.stringify(norm(args))}`;
}

/** Regra "qualquer" desse tipo (ex.: sempre sim pra qualquer pc_open_app). */
function chaveTipo(tipo) {
  return `${String(tipo || '')}|*`;
}

/** Pode virar "sempre sim"? */
function podeSempreSim(a) {
  const { TOOL_DEFS } = require('../tools/definitions');
  const def = a && TOOL_DEFS[a.tipo];
  if (!def || def.risk === 'critical' || def.standing !== true) return false;
  const { runTestsNeedsApproval } = require('./patch-marks');
  return !runTestsNeedsApproval(a);
}

const ensureTable = once(async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_approval_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chave TEXT NOT NULL,
      tipo TEXT NOT NULL,
      decisao TEXT NOT NULL,
      resumo TEXT,
      usos INT NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, chave)
    )
  `);
});

function resumoDe(a) {
  const { summarizeAcoes } = require('./approvals');
  return summarizeAcoes([a]);
}

/**
 * Grava a decisão permanente pras ações. "sempre sim" só grava as liberadas.
 * @returns {{ gravadas: string[], recusadas: string[] }} resumos
 */
async function lembrarDecisao(userId, acoes, decisao, { porTipo = false } = {}) {
  await ensureTable();
  const gravadas = [];
  const recusadas = [];
  const { label } = require('../nl/humanize');
  for (const a of acoes || []) {
    const resumo = porTipo ? `${label(a.tipo)} (qualquer)` : resumoDe(a);
    if (decisao === SEMPRE_SIM && !podeSempreSim(a)) {
      recusadas.push(resumo);
      continue;
    }
    const chave = porTipo ? chaveTipo(a.tipo) : chaveDaAcao(a);
    // Decisão nova substitui a anterior da mesma ação (sempre sim → sempre não e vice-versa)
    await run(
      `INSERT INTO jarvis_approval_rules (id, user_id, chave, tipo, decisao, resumo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, chave) DO UPDATE
         SET decisao = EXCLUDED.decisao, resumo = EXCLUDED.resumo, ativo = true, atualizado_em = CURRENT_TIMESTAMP`,
      [crypto.randomUUID(), userId, chave, a.tipo, decisao, resumo]
    );
    gravadas.push(resumo);
  }
  return { gravadas, recusadas };
}

/**
 * Aplica as regras nas ações que iam pedir SIM.
 * @returns {{ liberadas: object[], bloqueadas: object[], restantes: object[] }}
 *  liberadas = "sempre sim" (rodam sem perguntar); bloqueadas = resultados ok:false prontos; restantes = perguntar
 */
async function aplicarRegras(userId, gated) {
  const vazio = { liberadas: [], bloqueadas: [], restantes: gated || [] };
  if (!userId || !gated || !gated.length) return vazio;
  await ensureTable();
  const chavesExatas = gated.map(chaveDaAcao);
  const chavesTipo = gated.map((a) => chaveTipo(a.tipo));
  const chaves = [...new Set([...chavesExatas, ...chavesTipo])];
  const regras = await all(
    `SELECT id, chave, decisao, resumo FROM jarvis_approval_rules
      WHERE user_id = $1 AND ativo = true AND chave = ANY($2::text[])`,
    [userId, chaves]
  );
  if (!regras.length) return vazio;
  const porChave = new Map(regras.map((r) => [r.chave, r]));
  const out = { liberadas: [], bloqueadas: [], restantes: [] };
  for (let i = 0; i < gated.length; i += 1) {
    const a = gated[i];
    // Exata ganha da "qualquer desse tipo"
    const r = porChave.get(chavesExatas[i]) || porChave.get(chavesTipo[i]);
    if (r && r.decisao === SEMPRE_NAO) {
      out.bloqueadas.push({
        tipo: a.tipo,
        ok: false,
        blocked_by_rule: true,
        erro: `você me pediu pra nunca fazer isso. Pra liberar, diz "volta a me perguntar sobre ${r.resumo}"`
      });
      await run(`UPDATE jarvis_approval_rules SET usos = usos + 1 WHERE id = $1`, [r.id]);
    } else if (r && r.decisao === SEMPRE_SIM && podeSempreSim(a)) {
      // Confere de novo a liberação: tool que deixou de ser "standing" volta a perguntar
      out.liberadas.push(a);
      await run(`UPDATE jarvis_approval_rules SET usos = usos + 1 WHERE id = $1`, [r.id]);
    } else {
      out.restantes.push(a);
    }
  }
  if (out.liberadas.length || out.bloqueadas.length) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.approval',
        event: 'standing_rule',
        userId,
        liberadas: out.liberadas.map((a) => a.tipo),
        bloqueadas: out.bloqueadas.map((a) => a.tipo)
      })
    );
  }
  return out;
}

async function listarRegras(userId) {
  await ensureTable();
  return all(
    `SELECT id, decisao, resumo, usos, atualizado_em FROM jarvis_approval_rules
      WHERE user_id = $1 AND ativo = true ORDER BY decisao, atualizado_em DESC`,
    [userId]
  );
}

/** "volta a me perguntar sobre fechar o Discord" → desativa as regras que batem. */
async function esquecerRegras(userId, trecho) {
  await ensureTable();
  const termos = fold(trecho)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 2 && !['sobre', 'que', 'pra', 'para', 'voce', 'perguntar', 'volta', 'sempre'].includes(t));
  const ativas = await listarRegras(userId);
  if (!termos.length) return [];
  const alvo = ativas.filter((r) => termos.every((t) => fold(r.resumo).includes(t)));
  for (const r of alvo) {
    await run(`UPDATE jarvis_approval_rules SET ativo = false, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`, [r.id, userId]);
  }
  return alvo.map((r) => ({ decisao: r.decisao, resumo: r.resumo }));
}

function textoDasRegras(regras) {
  if (!regras.length) return 'Nenhuma regra: eu pergunto antes de tudo que é arriscado.';
  const sim = regras.filter((r) => r.decisao === SEMPRE_SIM);
  const nao = regras.filter((r) => r.decisao === SEMPRE_NAO);
  const partes = [];
  if (sim.length) partes.push(`Faço sem perguntar:\n${sim.map((r) => `• ${r.resumo}`).join('\n')}`);
  if (nao.length) partes.push(`Nunca faço:\n${nao.map((r) => `• ${r.resumo}`).join('\n')}`);
  partes.push('Pra desfazer: "volta a me perguntar sobre …".');
  return partes.join('\n\n');
}

module.exports = {
  SEMPRE_SIM,
  SEMPRE_NAO,
  chaveDaAcao,
  chaveTipo,
  podeSempreSim,
  lembrarDecisao,
  aplicarRegras,
  listarRegras,
  esquecerRegras,
  textoDasRegras,
  ensureTable
};
