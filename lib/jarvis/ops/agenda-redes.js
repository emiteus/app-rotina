/**
 * Agendamento nas redes PELO SITE, no PC do Mateus (19/10/2026) — sem API.
 * Ele percebeu que post feito por API engaja menos; aqui o Jarvis faz o passo a passo de uma pessoa:
 * abre o TikTok Studio / Meta Business Suite no Navegador do Jarvis, sobe o vídeo, escreve a legenda
 * e marca o horário NO AGENDADOR DA PRÓPRIA REDE. Quem publica é a rede (o PC pode estar desligado na hora).
 *
 *  - "agenda os vídeos da pasta X no TikTok e no Instagram, 3 por dia, modelo filmes"
 *    → antes do SIM o servidor lê a pasta no PC e monta o PLANO (vídeo → rede → data/hora → legenda).
 *      A aprovação mostra o plano e a execução usa esse mesmo plano (nada muda depois do SIM).
 *  - Modelos de legenda por nicho/conta (jarvis_soc_modelos): {titulo} {parte} {hashtags} {arquivo}
 *  - Fila (jarvis_soc_agenda): a rede só aceita agendar alguns dias à frente (TikTok ~10, Business Suite ~29);
 *    o que passa disso espera e sobe sozinho quando entrar no prazo (relógio de 5 min + quando o PC conecta)
 *  - Uma subida por vez por rede, com pausa de gente entre uma e outra; a rede pediu verificação → para e avisa
 */
const crypto = require('crypto');
const { requireLib } = require('../host');
const { once } = require('../db-once');
const { nomeDaObra, parteDe, ordenarPartes } = require('./ney-filmes');

const TZ = 'America/Sao_Paulo';
/** prazo = quantos dias à frente a rede aceita agendar (com folga); antecedencia = mínimo antes do horário */
const REDES = {
  tiktok: { label: 'TikTok', prazoDias: 9, antecedenciaMin: 30 },
  instagram: { label: 'Instagram', prazoDias: 27, antecedenciaMin: 30 }
};
const MAX_LOTE = 60;
const MAX_POR_DIA = 12;
const JANELA = { ini: 9 * 60, fim: 23 * 60 }; // horários automáticos entre 09:00 e 23:00 (Brasília)
const LEGENDA_MAX = 2200; // limite do Instagram (o TikTok aceita mais)
const PAUSA = { min: 70000, max: 160000 }; // entre uma subida e outra na mesma rede
const SUBIDA_TIMEOUT_MS = 15 * 60 * 1000;

const db = () => requireLib('db');
const ensureTables = once(async () => {
  await db().run(`
    CREATE TABLE IF NOT EXISTS jarvis_soc_modelos (
      user_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      legenda TEXT NOT NULL,
      hashtags TEXT,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, nome)
    )
  `);
  await db().run(`
    CREATE TABLE IF NOT EXISTS jarvis_soc_agenda (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lote TEXT NOT NULL,
      rede TEXT NOT NULL,
      arquivo TEXT NOT NULL,
      nome TEXT NOT NULL,
      bytes BIGINT,
      legenda TEXT,
      quando TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'fila',
      erro TEXT,
      tentativas INT NOT NULL DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db().run(`ALTER TABLE jarvis_soc_agenda ADD COLUMN IF NOT EXISTS conta TEXT`);
  await db()
    .run(`CREATE INDEX IF NOT EXISTS idx_jarvis_soc_agenda_fila ON jarvis_soc_agenda (user_id, rede, status, quando)`)
    .catch(() => {});
});

// ---------- texto ----------

const normNome = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);

function normRedes(a) {
  const bruto = [].concat(a.redes || a.rede || []).flatMap((x) => String(x).split(/[,\s]+|\be\b/));
  const out = new Set();
  for (const r of bruto) {
    const t = r.trim().toLowerCase();
    if (/^(ambas|todas|as duas)$/.test(t)) Object.keys(REDES).forEach((k) => out.add(k));
    else if (/^(tiktok|tik tok|tt)$/.test(t)) out.add('tiktok');
    else if (/^(instagram|insta|ig|reels?)$/.test(t)) out.add('instagram');
  }
  return [...out];
}

function normHashtags(h) {
  const tags = String(h || '')
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#*/, ''))
    .filter((t) => /^[\p{L}\p{N}_]{1,60}$/u.test(t))
    .slice(0, 30);
  return tags.map((t) => `#${t}`).join(' ');
}

/** Legenda do vídeo a partir do modelo do nicho. Sem modelo: o nome do vídeo. */
function aplicarModelo(modelo, video) {
  const titulo = nomeDaObra(video.nome) || String(video.nome || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const n = parteDe(video.nome);
  if (!modelo) return titulo.slice(0, LEGENDA_MAX);
  const tags = normHashtags(modelo.hashtags);
  let txt = String(modelo.legenda || '')
    .replace(/\{titulo\}/gi, titulo)
    .replace(/\{parte\}/gi, n ? `Parte ${n}` : '')
    .replace(/\{arquivo\}/gi, String(video.nome || ''))
    .replace(/\{hashtags\}/gi, tags);
  if (tags && !/\{hashtags\}/i.test(modelo.legenda || '')) txt = `${txt}\n\n${tags}`;
  return txt
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, LEGENDA_MAX);
}

// ---------- horários ----------

function brt(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms))
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { dia: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/** Meia-noite (Brasília) do dia de `ms`, em ms. */
function inicioDoDia(ms) {
  return ms - brt(ms).min * 60000 - (new Date(ms).getUTCSeconds() * 1000 + new Date(ms).getUTCMilliseconds());
}

const arred5 = (min) => Math.round(min / 5) * 5;

/** "19h", "19:30", "7 da noite" → minutos do dia; inválido → null */
function lerHora(h) {
  const s = String(h || '').trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas?)?\s*(da manh[aã]|da tarde|da noite)?$/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2] || 0);
  if (m[3] && /tarde|noite/.test(m[3]) && hh < 12) hh += 12;
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** "amanhã", "hoje", "2026-10-25", "25/10" → ms do começo do dia; nada → null (= hoje) */
function lerInicio(v, agora) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === 'hoje' || s === 'agora') return null;
  if (s === 'amanhã' || s === 'amanha') return inicioDoDia(inicioDoDia(agora) + 26 * 3600000);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (d) m = [null, d[3] ? (d[3].length === 2 ? `20${d[3]}` : d[3]) : String(new Date(agora).getUTCFullYear()), d[2].padStart(2, '0'), d[1].padStart(2, '0')];
  }
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00-03:00`);
  return Number.isFinite(ms) ? inicioDoDia(ms) : null;
}

/**
 * Horários do lote: `porDia` por dia, a partir de `inicio`.
 * Com `horarios` fixos ("12:00", "19h") usa exatamente esses; sem eles espalha entre 09:00 e 23:00
 * com variação (gente não posta sempre no minuto cravado), sempre em múltiplos de 5 min.
 * `ocupados` = já agendados na mesma rede (não cola em cima: mínimo 30 min de distância).
 */
function planejarHorarios(n, { porDia = 3, horarios = [], inicio = null, agora = Date.now(), ocupados = [], rand = Math.random } = {}) {
  porDia = Math.max(1, Math.min(MAX_POR_DIA, Math.round(Number(porDia) || 3)));
  const fixos = [...new Set((horarios || []).map(lerHora).filter((x) => x != null))].sort((a, b) => a - b);
  const minimo = agora + 30 * 60000;
  const longe = (t) => ocupados.every((o) => Math.abs(o - t) >= 30 * 60000);
  const out = [];
  let dia = inicio != null ? inicio : inicioDoDia(agora);
  for (let guarda = 0; out.length < n && guarda < 400; guarda++) {
    let slots;
    if (fixos.length) slots = fixos;
    else {
      const gap = (JANELA.fim - JANELA.ini) / porDia;
      slots = Array.from({ length: porDia }, (_, k) => arred5(JANELA.ini + gap * (k + 0.5) + (rand() - 0.5) * gap * 0.5));
    }
    for (const min of slots) {
      if (out.length >= n) break;
      // dia + minutos (Brasília), corrigido pelo fuso do instante (sem depender do fuso do servidor)
      let t = dia + min * 60000;
      t += (min - brt(t).min) * 60000;
      if (t >= minimo && longe(t)) out.push(t);
    }
    dia = inicioDoDia(dia + 26 * 3600000);
  }
  return out;
}

const quandoTxt = (ms) =>
  new Date(ms).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- modelos de legenda ----------

async function salvarModelo(userId, { nome, legenda, hashtags }) {
  const n = normNome(nome);
  if (!n) throw new Error('falta o nome do modelo (ex.: "filmes")');
  const leg = String(legenda || '').trim().slice(0, LEGENDA_MAX);
  if (!leg) throw new Error('falta o texto do modelo (use {titulo} onde entra o nome do vídeo)');
  await ensureTables();
  await db().run(
    `INSERT INTO jarvis_soc_modelos (user_id, nome, legenda, hashtags) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, nome) DO UPDATE SET legenda = EXCLUDED.legenda, hashtags = EXCLUDED.hashtags, atualizado_em = CURRENT_TIMESTAMP`,
    [String(userId), n, leg, normHashtags(hashtags) || null]
  );
  return { nome: n, legenda: leg, hashtags: normHashtags(hashtags) };
}

async function listarModelos(userId) {
  await ensureTables();
  return db().all(`SELECT nome, legenda, hashtags FROM jarvis_soc_modelos WHERE user_id = $1 ORDER BY nome`, [String(userId)]);
}

async function acharModelo(userId, nome) {
  await ensureTables();
  return db().get(`SELECT nome, legenda, hashtags FROM jarvis_soc_modelos WHERE user_id = $1 AND nome = $2`, [String(userId), normNome(nome)]);
}

async function apagarModelo(userId, nome) {
  await ensureTables();
  const r = await db().all(`DELETE FROM jarvis_soc_modelos WHERE user_id = $1 AND nome = $2 RETURNING nome`, [String(userId), normNome(nome)]);
  return r.length > 0;
}

// ---------- plano (antes do SIM) ----------

const ATIVOS = ['fila', 'subindo', 'agendado'];

async function jaNaAgenda(userId, rede, videos) {
  if (!videos.length) return new Set();
  const rows = await db().all(
    `SELECT nome, bytes FROM jarvis_soc_agenda WHERE user_id = $1 AND rede = $2 AND status = ANY($3)`,
    [String(userId), rede, ATIVOS]
  );
  return new Set(rows.map((r) => `${String(r.nome).toLowerCase()}|${Number(r.bytes)}`));
}

async function ocupadosDe(userId, rede) {
  const rows = await db().all(
    `SELECT quando FROM jarvis_soc_agenda WHERE user_id = $1 AND rede = $2 AND status = ANY($3) AND quando > NOW()`,
    [String(userId), rede, ATIVOS]
  );
  return rows.map((r) => new Date(r.quando).getTime());
}

/**
 * Lê a pasta no PC e monta o plano. Vai dentro da ação (acao.plano) e é o que a aprovação mostra.
 * @returns {Promise<{ pasta, plano: Array, repetidos: number, modelo: string|null }>}
 */
async function montarPlano(userId, acao, deps = {}) {
  const redes = normRedes(acao);
  if (!redes.length) throw new Error('em qual rede? (TikTok, Instagram ou as duas)');
  const pasta = String(acao.pasta || acao.path || '').trim();
  if (!pasta) throw new Error('qual pasta? (ex.: "Vídeos/filmes")');
  // Business Suite tem várias contas/páginas e vem marcando grupos junto: a conta do Instagram é obrigatória
  const contaIg = String(acao.conta_instagram || acao.conta || '').replace(/^@/, '').trim();
  if (redes.includes('instagram') && !/^[\w.]{1,30}$/.test(contaIg)) throw new Error('em qual conta do Instagram? (ex.: @mrpoubel)');
  let modelo = null;
  if (acao.modelo) {
    modelo = await (deps.acharModelo || acharModelo)(userId, acao.modelo);
    if (!modelo) {
      const tem = (await (deps.listarModelos || listarModelos)(userId)).map((m) => m.nome);
      throw new Error(`não tenho o modelo de legenda "${acao.modelo}"${tem.length ? ` (tenho: ${tem.join(', ')})` : ' (nenhum modelo criado ainda)'}`);
    }
  }
  const requestTool = deps.requestTool || require('../devices/gateway').requestTool;
  const r = await requestTool(userId, 'pc_media_list', { pasta }, { timeoutMs: 20000 });
  if (!r.ok) throw new Error(r.erro || 'não consegui ler a pasta no PC');
  let videos = ordenarPartes((r.result && r.result.videos) || []);
  const max = Math.min(MAX_LOTE, Math.max(1, Number(acao.quantidade) || MAX_LOTE));
  const agora = deps.agora || Date.now();
  const plano = [];
  let repetidos = 0;
  const legendaFixa = acao.legenda ? String(acao.legenda).trim().slice(0, LEGENDA_MAX) : null;
  for (const rede of redes) {
    const ja = await (deps.jaNaAgenda || jaNaAgenda)(userId, rede, videos);
    const novos = videos.filter((v) => !ja.has(`${String(v.nome).toLowerCase()}|${Number(v.bytes)}`)).slice(0, max);
    repetidos += videos.length - novos.length;
    const quandos = planejarHorarios(novos.length, {
      porDia: acao.por_dia || acao.porDia,
      horarios: [].concat(acao.horarios || acao.horario || []),
      inicio: lerInicio(acao.inicio || acao.a_partir_de, agora),
      agora,
      ocupados: await (deps.ocupadosDe || ocupadosDe)(userId, rede),
      rand: deps.rand
    });
    novos.forEach((v, i) => {
      if (quandos[i] == null) return;
      plano.push({
        rede,
        conta: rede === 'instagram' ? contaIg : null,
        arquivo: v.arquivo,
        nome: v.nome,
        bytes: v.bytes,
        quando: new Date(quandos[i]).toISOString(),
        legenda: legendaFixa || aplicarModelo(modelo, v)
      });
    });
  }
  return { pasta: (r.result && r.result.pasta) || pasta, plano, repetidos, modelo: modelo ? modelo.nome : null };
}

/**
 * Antes do SIM (tools/index.js): soc_agendar ganha o plano dentro da ação.
 * @returns {Promise<{ prontas: Array, falhas: Array }>}
 */
async function prepararParaAprovacao(userId, acoes, deps = {}) {
  const prontas = [];
  const falhas = [];
  for (const a of acoes || []) {
    if (!a || a.tipo !== 'soc_agendar' || Array.isArray(a.plano)) {
      prontas.push(a);
      continue;
    }
    try {
      const p = await montarPlano(userId, a, deps);
      if (!p.plano.length) {
        falhas.push({
          tipo: a.tipo,
          ok: false,
          erro: p.repetidos ? `todos os vídeos da pasta ${p.pasta} já estão na agenda` : `não achei vídeo na pasta ${p.pasta}`
        });
        continue;
      }
      prontas.push({ ...a, pasta: p.pasta, modelo: p.modelo, plano: p.plano, repetidos: p.repetidos });
    } catch (e) {
      falhas.push({ tipo: a.tipo, ok: false, erro: String(e.message || e).slice(0, 220) });
    }
  }
  return { prontas, falhas };
}

/** Prévia da aprovação: o plano inteiro (até 15 linhas) + a 1ª legenda completa como exemplo. */
function previewAgenda(a) {
  const plano = Array.isArray(a.plano) ? a.plano : [];
  if (!plano.length) return `agendar os vídeos da pasta ${a.pasta || '?'} nas redes`;
  const redes = [...new Set(plano.map((p) => (REDES[p.rede] ? REDES[p.rede].label : p.rede) + (p.conta ? ` @${p.conta}` : '')))].join(' e ');
  const videos = new Set(plano.map((p) => `${p.nome}|${p.bytes}`)).size;
  const linhas = plano
    .slice()
    .sort((x, y) => Date.parse(x.quando) - Date.parse(y.quando))
    .slice(0, 15)
    .map((p) => `• ${quandoTxt(Date.parse(p.quando))} · ${REDES[p.rede] ? REDES[p.rede].label : p.rede} · ${p.nome}`);
  const resto = plano.length > 15 ? `\n…e mais ${plano.length - 15}` : '';
  return (
    `agendar ${videos} vídeo(s) da pasta ${a.pasta} no ${redes} (${plano.length} posts${a.modelo ? `, modelo "${a.modelo}"` : ''}):\n` +
    `${linhas.join('\n')}${resto}\n\nLegenda do 1º:\n${String(plano[0].legenda || '').slice(0, 600)}`
  );
}

// ---------- execução ----------

/** Depois do SIM: grava o plano aprovado na fila e começa a subir em segundo plano. */
async function agendarLote(userId, acao, deps = {}) {
  let plano = Array.isArray(acao.plano) ? acao.plano : null;
  let pasta = acao.pasta;
  if (!plano) {
    // Sem plano = não passou pela aprovação com prévia (ex.: HITL desligado): monta agora
    const p = await montarPlano(userId, acao, deps);
    plano = p.plano;
    pasta = p.pasta;
  }
  plano = plano
    .filter((p) => REDES[p.rede] && p.arquivo && Number.isFinite(Date.parse(p.quando)))
    .filter((p) => p.rede !== 'instagram' || /^[\w.]{1,30}$/.test(String(p.conta || '')))
    .slice(0, MAX_LOTE * 2);
  if (!plano.length) return { ok: false, erro: 'nada pra agendar' };
  await ensureTables();
  const lote = crypto.randomUUID().slice(0, 8);
  for (const p of plano) {
    await db().run(
      `INSERT INTO jarvis_soc_agenda (id, user_id, lote, rede, conta, arquivo, nome, bytes, legenda, quando) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [crypto.randomUUID(), String(userId), lote, p.rede, p.conta || null, String(p.arquivo).slice(0, 400), String(p.nome).slice(0, 200), Number(p.bytes) || null, String(p.legenda || '').slice(0, LEGENDA_MAX), p.quando]
    );
  }
  const ts = plano.map((p) => Date.parse(p.quando)).sort((a, b) => a - b);
  if (!deps.semProcessar) processar(userId, deps).catch((e) => console.error('[agenda-redes] processar:', e.message));
  const esperando = plano.filter((p) => Date.parse(p.quando) > Date.now() + REDES[p.rede].prazoDias * 864e5).length;
  return { ok: true, lote, pasta, posts: plano.length, primeiro: quandoTxt(ts[0]), ultimo: quandoTxt(ts[ts.length - 1]), esperando_prazo: esperando };
}

const rodando = new Set();
const ultimaSubida = new Map(); // `${userId}|${rede}` → ms

/** Erro da rede que não adianta repetir agora (login, verificação, tela mudou) → para essa rede e avisa */
const PARA_A_REDE = /not_logged|n[aã]o est[aá] logado|challenge|verifica[çc][aã]o|rate_limited|mais devagar|p[aá]gina mudou|compose_not_found|file_not_attached|schedule_not_found|falta mapear/i;
const PC_FORA = /nenhum PC|n[aã]o respondeu a tempo|offline/i;
/** Freio do PC (teto do dia, pausa que a rede pediu): não é falha do vídeo — volta pra fila e continua depois */
const ESPERAR = /limite de seguran[çc]a|volto depois de|amanh[ãa] volto/i;

/**
 * Sobe o que está na fila e já entrou no prazo da rede. Uma subida por vez por rede.
 * @returns {Promise<{ feitos: Array, falhas: Array, parou: string|null }>}
 */
async function processar(userId, deps = {}) {
  await ensureTables();
  const requestTool = deps.requestTool || require('../devices/gateway').requestTool;
  const dormir = deps.dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rand = deps.rand || Math.random;
  const feitos = [];
  const falhas = [];
  const esperas = [];
  let parou = null;
  for (const rede of Object.keys(REDES)) {
    const chave = `${userId}|${rede}`;
    if (rodando.has(chave)) continue;
    rodando.add(chave);
    try {
      const cfg = REDES[rede];
      // Horário que passou com o PC desligado: não dá mais pra agendar → falha com motivo
      const vencidos = await db().all(
        `UPDATE jarvis_soc_agenda SET status = 'falhou', erro = 'o horário passou antes de eu conseguir subir (PC desligado?)', atualizado_em = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND rede = $2 AND status = 'fila' AND quando < NOW() + ($3 || ' minutes')::interval RETURNING nome, quando, rede`,
        [String(userId), rede, String(cfg.antecedenciaMin)]
      );
      for (const v of vencidos) falhas.push({ rede, nome: v.nome, quando: quandoTxt(new Date(v.quando).getTime()), erro: 'o horário passou antes de subir' });
      for (let guarda = 0; guarda < MAX_LOTE; guarda++) {
        const item = await db().get(
          `SELECT * FROM jarvis_soc_agenda WHERE user_id = $1 AND rede = $2 AND status = 'fila'
             AND quando <= NOW() + ($3 || ' days')::interval ORDER BY quando LIMIT 1`,
          [String(userId), rede, String(cfg.prazoDias)]
        );
        if (!item) break;
        const espera = (ultimaSubida.get(chave) || 0) + PAUSA.min + rand() * (PAUSA.max - PAUSA.min) - Date.now();
        if (espera > 0) await dormir(espera);
        await db().run(`UPDATE jarvis_soc_agenda SET status = 'subindo', tentativas = tentativas + 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [item.id]);
        const r = await requestTool(
          userId,
          'soc_schedule_upload',
          { rede, conta: item.conta || undefined, arquivo: item.arquivo, legenda: item.legenda || '', quando: new Date(item.quando).toISOString() },
          { timeoutMs: SUBIDA_TIMEOUT_MS }
        );
        ultimaSubida.set(chave, Date.now());
        const quando = quandoTxt(new Date(item.quando).getTime());
        if (r.ok) {
          await db().run(`UPDATE jarvis_soc_agenda SET status = 'agendado', erro = NULL, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [item.id]);
          feitos.push({ rede, nome: item.nome, quando });
          continue;
        }
        const erro = String(r.erro || 'falhou sem motivo').slice(0, 220);
        if (PC_FORA.test(erro) && !r.uncertain) {
          // PC desligou no meio: volta pra fila, tenta quando ele conectar
          await db().run(`UPDATE jarvis_soc_agenda SET status = 'fila', tentativas = tentativas - 1 WHERE id = $1`, [item.id]);
          parou = 'pc';
          break;
        }
        if (ESPERAR.test(erro)) {
          await db().run(`UPDATE jarvis_soc_agenda SET status = 'fila', tentativas = tentativas - 1 WHERE id = $1`, [item.id]);
          esperas.push({ rede, erro });
          break;
        }
        // Não sabemos se subiu (demorou demais): não repete pra não duplicar o post — confere na rede
        const final = r.uncertain || item.tentativas + 1 >= 2 || PARA_A_REDE.test(erro) ? 'falhou' : 'fila';
        await db().run(`UPDATE jarvis_soc_agenda SET status = $2, erro = $3, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [item.id, final, r.uncertain ? `${erro} — confere no ${cfg.label} se subiu antes de mandar de novo` : erro]);
        if (final === 'falhou') falhas.push({ rede, nome: item.nome, quando, erro });
        if (PARA_A_REDE.test(erro)) {
          parou = rede;
          break;
        }
      }
    } finally {
      rodando.delete(chave);
    }
    if (parou === 'pc') break;
  }
  if ((feitos.length || falhas.length) && !deps.semAviso) {
    const { text, speech } = resumo({ feitos, falhas, parou, esperas });
    await require('../events/bus')
      .notifyWarnNotes([{ level: 'warn', type: 'agenda_redes', text, speech }], { source: 'agenda-redes', userId })
      .catch(() => {});
  }
  return { feitos, falhas, parou, esperas };
}

function resumo({ feitos, falhas, parou, esperas = [] }) {
  const porRede = (xs) => {
    const m = {};
    for (const x of xs) m[REDES[x.rede].label] = (m[REDES[x.rede].label] || 0) + 1;
    return Object.entries(m).map(([k, v]) => `${v} no ${k}`).join(' e ');
  };
  const plural = (n, um, varios) => (n === 1 ? um : varios);
  const partes = [];
  if (feitos.length) partes.push(`agendei ${porRede(feitos)}`);
  if (falhas.length) {
    partes.push(`${falhas.length} ${plural(falhas.length, 'falhou', 'falharam')}: ${falhas.slice(0, 6).map((f) => `${f.nome} (${f.erro})`).join('; ')}`);
  }
  if (parou && parou !== 'pc') partes.push(`parei o ${REDES[parou].label} até você ver isso`);
  for (const e of esperas) partes.push(`o resto do ${REDES[e.rede].label} fica na fila (${e.erro})`);
  const linhas = feitos.slice(0, 12).map((f) => `• ${f.quando} · ${REDES[f.rede].label} · ${f.nome}`);
  return {
    text: `Agenda das redes: ${partes.join('. ')}.${linhas.length ? `\n${linhas.join('\n')}` : ''}`,
    // Voz: quantos e, se for uma falha só, o motivo (sem ele o aviso falado não diz o que fazer)
    speech:
      `Senhor, ${feitos.length ? `agendei ${feitos.length} ${plural(feitos.length, 'vídeo', 'vídeos')} nas redes` : 'a agenda das redes teve problema'}` +
      (falhas.length === 1
        ? `${feitos.length ? ', e um falhou' : ''}: ${String(falhas[0].erro).replace(/\s*\[[^\]]*\]\s*$/, '').slice(0, 140)}.`
        : falhas.length
          ? `, e ${falhas.length} falharam. Os motivos estão na conversa.`
          : '.')
  };
}

/** Relógio (5 min) e PC conectando: sobe o que entrou no prazo. Nada na fila → nem toca no PC. */
async function tick(userId, deps = {}) {
  try {
    await ensureTables();
    const tem = await db().get(`SELECT 1 AS x FROM jarvis_soc_agenda WHERE user_id = $1 AND status = 'fila' LIMIT 1`, [String(userId)]);
    if (!tem) return { skipped: true };
    const gw = deps.gateway || require('../devices/gateway');
    if (gw.onlineDeviceIds && !gw.onlineDeviceIds(userId).length) return { skipped: true, reason: 'pc_offline' };
    return await processar(userId, deps);
  } catch (e) {
    console.error('[agenda-redes] tick:', e.message);
    return { skipped: true, reason: 'error' };
  }
}

/** "o que tá agendado nas redes" */
async function listar(userId, { status = null, limite = 20 } = {}) {
  await ensureTables();
  const filtro = status ? [].concat(status) : ['fila', 'subindo', 'agendado', 'falhou'];
  const rows = await db().all(
    `SELECT id, lote, rede, nome, quando, status, erro FROM jarvis_soc_agenda
      WHERE user_id = $1 AND status = ANY($2) AND (status <> 'agendado' OR quando > NOW() - INTERVAL '1 day')
      ORDER BY quando LIMIT $3`,
    [String(userId), filtro, Math.min(60, Number(limite) || 20)]
  );
  return rows.map((r) => ({ id: r.id.slice(0, 8), lote: r.lote, rede: REDES[r.rede] ? REDES[r.rede].label : r.rede, nome: r.nome, quando: quandoTxt(new Date(r.quando).getTime()), status: r.status, erro: r.erro || undefined }));
}

/** Cancela o que AINDA NÃO subiu. O que já está agendado na rede só sai pela própria rede. */
async function cancelar(userId, { lote = null, ids = [], tudo = false } = {}) {
  await ensureTables();
  const curtos = [].concat(ids || []).map((x) => String(x).slice(0, 8)).filter(Boolean);
  if (!lote && !curtos.length && !tudo) throw new Error('cancelar o quê? (um lote, itens ou "tudo")');
  const rows = await db().all(
    `UPDATE jarvis_soc_agenda SET status = 'cancelado', atualizado_em = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND status = 'fila' AND ($2::text IS NULL OR lote = $2) AND (cardinality($3::text[]) = 0 OR left(id, 8) = ANY($3))
      RETURNING nome`,
    [String(userId), lote, tudo ? [] : curtos]
  );
  const jaNaRede = await db().get(
    `SELECT count(*)::int AS n FROM jarvis_soc_agenda WHERE user_id = $1 AND status = 'agendado' AND quando > NOW() AND ($2::text IS NULL OR lote = $2)`,
    [String(userId), lote]
  );
  return { cancelados: rows.length, ja_na_rede: (jaNaRede && jaNaRede.n) || 0 };
}

module.exports = {
  REDES,
  MAX_LOTE,
  normRedes,
  normHashtags,
  aplicarModelo,
  lerHora,
  lerInicio,
  planejarHorarios,
  brt,
  salvarModelo,
  listarModelos,
  acharModelo,
  apagarModelo,
  montarPlano,
  prepararParaAprovacao,
  previewAgenda,
  agendarLote,
  processar,
  resumo,
  tick,
  listar,
  cancelar,
  _reset: () => {
    rodando.clear();
    ultimaSubida.clear();
  }
};
