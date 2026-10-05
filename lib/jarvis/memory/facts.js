/**
 * Memória automática de fatos (ideia do OpenJarvis/Stanford, 05/10/2026).
 * Depois de cada conversa, um modelo rápido separa o que vale lembrar sobre o usuário (preferências,
 * rotina, pessoas, projetos, decisões) e guarda em jarvis_facts. Os fatos entram no prompt das próximas
 * conversas. Complementa o "lembra que X" (prefs.extras.notas), que continua igual.
 *
 * Regras de segurança:
 *  - roda DEPOIS da resposta, em segundo plano: nunca atrasa nem derruba o turno
 *  - só aprende com as palavras do PRÓPRIO usuário; resultado de tool, arquivo, comentário e DM
 *    (CONTEÚDO EXTERNO) é cortado antes — texto de terceiro não vira "fato" (envenenamento de memória)
 *  - mensagem com cara de manipulação ("ignore as instruções…") não é aprendida
 *  - o usuário vê e apaga tudo ("o que você sabe de mim?", "esquece que X")
 */
const crypto = require('crypto');
const { get, run, all } = require('../host').requireLib('db');

const MAX_FATO = 200;
const MAX_NOVOS_POR_TURNO = 5;
const MAX_ATIVOS = 200;
const NO_PROMPT = 30;
const INTERVALO_MIN_MS = 15 * 1000; // por usuário: rajada de mensagens não vira rajada de chamadas
const MIN_CHARS = 15;

const EXTERNO = /\[CONTEÚDO EXTERNO[^\]]*\][\s\S]*?\[\/CONTEÚDO EXTERNO\]/gi;
// Manipulação clássica (versão em português + inglês do injection scanner do OpenJarvis)
const MANIPULACAO = [
  /ignor[ea]\w*\s+(?:todas?\s+)?(?:as\s+)?(?:instru[cç][oõ]es|regras|ordens)\s+(?:anteriores|acima|de\s+antes)/i,
  /esque[cç]a\s+(?:todas?\s+)?(?:as\s+)?(?:suas\s+)?(?:instru[cç][oõ]es|regras)/i,
  /(?:a\s+partir\s+de\s+agora|agora)\s+voc[eê]\s+(?:[eé]|ser[aá])\s+(?:outro|outra|um\s+novo|uma\s+nova)/i,
  /finja\s+que\s+(?:n[aã]o\s+tem|est[aá]\s+sem)\s+(?:regras|restri[cç][oõ]es|limites|filtros)/i,
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|your)\s+(?:instructions?|programming|rules?)/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new|my)/i,
  /<\|(?:im_start|im_end|system|assistant)\|>/i,
  /```(?:system|assistant)\b/i
];

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function pareceManipulacao(texto) {
  return MANIPULACAO.some((re) => re.test(String(texto || '')));
}

/** Tira blocos de conteúdo externo e o "[Áudio transcrito]:" da voz. */
function soDoUsuario(texto) {
  return String(texto || '')
    .replace(EXTERNO, ' ')
    .replace(/^\s*\[[ÁA]udio transcrito\]\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Vale gastar uma chamada? Cumprimento, mensagem curta e pedido curto que COMEÇA com verbo de ação
 * ("abre o YouTube", "toca rock") não ensinam nada durável. Verbo no meio da frase não conta
 * ("treino às 6h, então não marca nada cedo" tem fato).
 */
function valeAprender(userText) {
  const t = soDoUsuario(userText);
  if (t.length < MIN_CHARS) return false;
  if (pareceManipulacao(t)) return false;
  const { looksLikeGreeting, looksLikeCommand } = require('../context/intent');
  if (looksLikeGreeting(userText)) return false;
  const semVocativo = t.replace(/^(?:(?:ei|oi|fala|e a[ií])\s+)?jarvis\s*[,!:.-]?\s*/i, '');
  const primeira = semVocativo.split(/\s+/)[0] || '';
  if (semVocativo.length < 50 && looksLikeCommand(primeira)) return false;
  return true;
}

const SYSTEM = [
  'Você extrai FATOS DURÁVEIS sobre o usuário de UMA troca de mensagens com o assistente dele (Jarvis).',
  'Bom fato: continua verdadeiro por semanas e ajuda em conversas futuras — preferências, rotina, horários,',
  'pessoas e quem são, projetos e decisões, metas, restrições, jeito de trabalhar.',
  'NÃO é fato: pedido pontual ("toca tal música"), conversa fiada, o que o assistente disse sobre si,',
  'números do dia (saldo, views de hoje), e qualquer coisa que o usuário não disse ou não confirmou.',
  'Só use o que o USUÁRIO afirmou. A resposta do assistente é só contexto.',
  'Você recebe os fatos que já sabemos, numerados. Não repita nenhum. Se o usuário corrigiu ou mudou algo',
  'que já sabemos, devolva o fato novo e o número do antigo em "obsoletos".',
  'Escreva cada fato em português, terceira pessoa, curto (até 200 caracteres), ex.: "Prefere postar às 22h".',
  'Responda SÓ com JSON: {"novos": ["..."], "obsoletos": [3]}. Nada a aprender: {"novos": [], "obsoletos": []}.'
].join(' ');

/** Saída do modelo → { novos, obsoletos }. Tolerante a cerca de código e texto em volta. */
function interpretar(texto, totalConhecidos = 0) {
  const vazio = { novos: [], obsoletos: [] };
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  if (!m) return vazio;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return vazio;
  }
  const vistos = new Set();
  const novos = [];
  for (const f of Array.isArray(j.novos) ? j.novos : []) {
    const fato = String(f || '').replace(/\s+/g, ' ').trim().slice(0, MAX_FATO);
    const chave = fold(fato);
    if (fato.length < 6 || vistos.has(chave) || pareceManipulacao(fato)) continue;
    vistos.add(chave);
    novos.push(fato);
    if (novos.length >= MAX_NOVOS_POR_TURNO) break;
  }
  const obsoletos = [...new Set((Array.isArray(j.obsoletos) ? j.obsoletos : []).map(Number))].filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= totalConhecidos
  );
  return { novos, obsoletos };
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS jarvis_facts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          fato TEXT NOT NULL,
          chave TEXT NOT NULL,
          origem TEXT NOT NULL DEFAULT 'conversa',
          canal TEXT,
          vezes INT NOT NULL DEFAULT 1,
          ativo BOOLEAN NOT NULL DEFAULT true,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, chave)
        )
      `);
      await run(`CREATE INDEX IF NOT EXISTS idx_jarvis_facts_user ON jarvis_facts (user_id, ativo, atualizado_em DESC)`).catch(() => {});
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

/** Fatos ativos, mais recentes primeiro. */
async function listarFatos(userId, { limite = NO_PROMPT } = {}) {
  if (!userId) return [];
  await ensureTable();
  return all(
    `SELECT id, fato, origem, vezes, criado_em, atualizado_em FROM jarvis_facts
      WHERE user_id = $1 AND ativo = true ORDER BY atualizado_em DESC LIMIT $2`,
    [userId, limite]
  );
}

/** Bloco pro system prompt (vazio se não tiver nada). */
function blocoParaPrompt(fatos) {
  if (!fatos || !fatos.length) return '';
  return (
    '\nO que você já sabe do usuário (aprendido nas conversas; use quando ajudar, sem recitar a lista; ' +
    'se ele disser que algo mudou, vale o que ele disser agora):\n' +
    fatos.map((f) => `- ${f.fato}`).join('\n')
  );
}

async function guardarFato(userId, fato, { origem = 'conversa', canal = null } = {}) {
  await ensureTable();
  const texto = String(fato || '').replace(/\s+/g, ' ').trim().slice(0, MAX_FATO);
  const chave = fold(texto);
  if (!chave) return null;
  // Mesmo fato de novo: reativa e conta mais uma confirmação (não duplica)
  return get(
    `INSERT INTO jarvis_facts (id, user_id, fato, chave, origem, canal)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, chave) DO UPDATE
       SET vezes = jarvis_facts.vezes + 1, ativo = true, atualizado_em = CURRENT_TIMESTAMP
     RETURNING id, fato, vezes`,
    [crypto.randomUUID(), userId, texto, chave, origem, canal]
  );
}

/** "esquece que eu moro em X" → desativa os fatos que batem com o trecho. Devolve o que esqueceu. */
async function esquecerFatos(userId, trecho) {
  await ensureTable();
  const termos = fold(trecho).split(' ').filter((t) => t.length > 2);
  if (!termos.length) return [];
  const ativos = await all(`SELECT id, fato, chave FROM jarvis_facts WHERE user_id = $1 AND ativo = true`, [userId]);
  const alvo = ativos.filter((f) => termos.every((t) => f.chave.includes(t)));
  for (const f of alvo) await run(`UPDATE jarvis_facts SET ativo = false, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`, [f.id, userId]);
  return alvo.map((f) => f.fato);
}

/** Mantém no máximo MAX_ATIVOS: desativa os menos confirmados e mais velhos. */
async function podar(userId) {
  await run(
    `UPDATE jarvis_facts SET ativo = false
      WHERE user_id = $1 AND ativo = true AND id NOT IN (
        SELECT id FROM jarvis_facts WHERE user_id = $1 AND ativo = true
        ORDER BY vezes DESC, atualizado_em DESC LIMIT $2)`,
    [userId, MAX_ATIVOS]
  );
}

const ultimaVez = new Map(); // userId -> ms
const fila = new Map(); // userId -> Promise (um por vez por usuário: sem corrida entre turnos)

/**
 * Aprende com um turno. Chamado depois da resposta; NUNCA lança.
 * @returns {Promise<{ novos: string[], esquecidos: string[] } | null>} null = não tentou
 */
function aprenderDoTurno({ userId, userText, assistantText = '', canal = null, chamarIA, agora = Date.now() }) {
  if (!userId || !valeAprender(userText)) return Promise.resolve(null);
  if (agora - (ultimaVez.get(userId) || 0) < INTERVALO_MIN_MS) return Promise.resolve(null);
  ultimaVez.set(userId, agora);

  const anterior = fila.get(userId) || Promise.resolve();
  const job = anterior
    .then(async () => {
      const conhecidos = await listarFatos(userId, { limite: 60 });
      const ia = chamarIA || require('../ai-gateway').chamarIA;
      const lista = conhecidos.map((f, i) => `${i + 1}. ${f.fato}`).join('\n') || '(nenhum ainda)';
      const { texto } = await ia({
        system: SYSTEM,
        user:
          `Fatos que já sabemos:\n${lista}\n\n` +
          `Usuário: ${soDoUsuario(userText).slice(0, 2000)}\n` +
          `Assistente: ${soDoUsuario(assistantText).slice(0, 600)}`,
        maxTokens: 400,
        jsonMode: true,
        timeout: 20000,
        fast: true
      });
      const { novos, obsoletos } = interpretar(texto, conhecidos.length);
      const esquecidos = [];
      for (const n of obsoletos) {
        const f = conhecidos[n - 1];
        await run(`UPDATE jarvis_facts SET ativo = false, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`, [f.id, userId]);
        esquecidos.push(f.fato);
      }
      for (const fato of novos) await guardarFato(userId, fato, { origem: 'conversa', canal });
      if (novos.length) await podar(userId);
      if (novos.length || esquecidos.length) {
        console.log(JSON.stringify({ tag: 'jarvis.facts', userId, novos: novos.length, esquecidos: esquecidos.length, canal }));
      }
      return { novos, esquecidos };
    })
    .catch((e) => {
      console.log(JSON.stringify({ tag: 'jarvis.facts', userId, erro: String(e && e.message).slice(0, 120) }));
      return null;
    });
  fila.set(userId, job);
  job.finally(() => {
    if (fila.get(userId) === job) fila.delete(userId);
  });
  return job;
}

module.exports = {
  aprenderDoTurno,
  listarFatos,
  blocoParaPrompt,
  guardarFato,
  esquecerFatos,
  interpretar,
  valeAprender,
  pareceManipulacao,
  soDoUsuario,
  ensureTable,
  _reset: () => {
    ultimaVez.clear();
    fila.clear();
    tableReady = null;
  }
};
