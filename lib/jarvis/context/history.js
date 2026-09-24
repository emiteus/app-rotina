/**
 * Higiene do histórico antes da decisão do LLM.
 * Evita sticky intent / dumps de tool / blobs externos contaminarem o turno atual.
 */
const { detectIntent } = require('./intent');

const NARROW = new Set(['finance', 'tasks', 'habits', 'projects', 'greeting']);
const KEEP_DEFAULT = 10;
const KEEP_SWITCH = 4;
const KEEP_GREETING = 2;
const MAX_MSG = 1500;

const EXTERNAL_BLOCK =
  /\[CONTEÚDO EXTERNO[^\]]*\][\s\S]*?\[\/CONTEÚDO EXTERNO\]/gi;
const DUMPISH =
  /research_|browser_|propose_patch|dev_railway|RESUMO:|ACHADOS:|"acoes"\s*:|CONTEÚDO EXTERNO/i;

/**
 * Colapsa blobs externos e truncates dumps longos.
 */
function scrubContent(content) {
  let s = String(content || '');
  s = s.replace(EXTERNAL_BLOCK, (m) => `[conteúdo externo omitido ~${m.length}c]`);
  if (s.length > MAX_MSG) {
    if (DUMPISH.test(s) || s.length > 3000) {
      s = `${s.slice(0, 600)}\n…[histórico truncado]`;
    } else {
      s = `${s.slice(0, MAX_MSG)}…`;
    }
  }
  return s.trim();
}

/**
 * Intent dominante das msgs de user anteriores (ignora general/mixed).
 */
function dominantPriorIntent(historico) {
  if (!Array.isArray(historico)) return null;
  for (let i = historico.length - 1; i >= 0; i--) {
    const m = historico[i];
    if (!m || m.role !== 'user') continue;
    const kind = detectIntent(String(m.content || '')).kind;
    if (kind && kind !== 'general' && kind !== 'mixed') return kind;
  }
  return null;
}

/**
 * @param {Array<{role:string,content:string}>} historico
 * @param {{ intent?: { kind?: string }, mensagem?: string }} [opts]
 * @returns {Array<{role:string,content:string}>}
 */
function sanitizeHistoricoForDecision(historico, opts = {}) {
  const arr = Array.isArray(historico) ? historico : [];
  const kind =
    (opts.intent && opts.intent.kind) || detectIntent(opts.mensagem || '').kind;
  const prior = dominantPriorIntent(arr);

  let keep = KEEP_DEFAULT;
  if (kind === 'greeting') {
    keep = KEEP_GREETING;
  } else if (NARROW.has(kind) && prior && prior !== kind && NARROW.has(prior)) {
    keep = KEEP_SWITCH;
  } else if (NARROW.has(kind) && prior && prior !== kind) {
    keep = 6;
  }

  return arr
    .slice(-keep)
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      let content = scrubContent(m.content);
      // Falha antiga no histórico vira "resposta pronta": o modelo leve repetia
      // "Não consegui pc_spotify_play: …" em vez de tentar de novo (23/09/2026)
      if (role === 'assistant') {
        content = content.replace(FAILURE_LINE, '').trim();
        // Resposta antiga com nome de comando ensina o modelo a repetir: histórico sai em português
        content = require('../nl/humanize').humanizeReply(content);
      }
      return { role, content };
    })
    .filter((m) => m.content);
}

const FAILURE_LINE = /^\s*(?:[❌⚠️]\s*)?(?:N[aã]o consegui\b|No PC: .*n[aã]o rodou).*$/gim;

module.exports = {
  sanitizeHistoricoForDecision,
  scrubContent,
  dominantPriorIntent,
  KEEP_DEFAULT,
  KEEP_SWITCH,
  KEEP_GREETING,
  MAX_MSG
};
