/**
 * Relógio do TeusHub (25/09/2026). O TeusHub roda no Railway, que não lê o vercel.json: os crons
 * de publicar agendados (1 min) e renovar logins das redes (diário) nunca rodaram lá — post
 * agendado ficava parado pra sempre. Quem bate o relógio agora é o Jarvis:
 *  - publishTick (cron 1 min): dispara a publicação e avisa o que saiu / o que falhou e por quê
 *  - dailyTokens (cron 8h): renova os logins e avisa conta com login vencido (o próximo post dela falharia)
 * Pausar as automações do TeusHub (flag "crons") continua valendo: o TeusHub responde "skipped".
 */
const { requireConnector } = require('../host');

const REDE = { INSTAGRAM: 'Instagram', TIKTOK: 'TikTok', FACEBOOK: 'Facebook', YOUTUBE: 'YouTube' };
const rede = (p) => REDE[p] || String(p || 'rede').toLowerCase();

let inflight = false;
let lastErrorLog = 0;

function connector(sh) {
  return sh || requireConnector('socialhub');
}

/** Resultado do cron → avisos: 1 por post (junta as redes). */
function publishNotes(results) {
  const byPost = new Map();
  for (const r of results || []) {
    if (!byPost.has(r.postId)) byPost.set(r.postId, []);
    byPost.get(r.postId).push(r);
  }
  const notes = [];
  for (const [postId, rs] of byPost) {
    const ok = rs.filter((r) => r.ok);
    const bad = rs.filter((r) => !r.ok);
    const parts = [];
    if (ok.length) parts.push(`Post do TeusHub publicado no ${ok.map((r) => rede(r.platform)).join(' e ')}.`);
    for (const r of bad) {
      parts.push(`Falhou no ${rede(r.platform)} (@${r.account}): ${String(r.error || 'sem detalhe').slice(0, 160)}.`);
    }
    notes.push({
      level: 'warn',
      type: bad.length ? 'socialhub_publish_failed' : 'socialhub_published',
      postId,
      text: parts.join(' ') + (bad.length ? ' — manda "tenta de novo o post do TeusHub" que eu repito.' : ''),
      speech: bad.length
        ? `Senhor, o post do TeusHub falhou no ${bad.map((r) => rede(r.platform)).join(' e ')}.` +
          (ok.length ? ` Saiu no ${ok.map((r) => rede(r.platform)).join(' e ')}.` : '')
        : `Senhor, o post do TeusHub foi publicado no ${ok.map((r) => rede(r.platform)).join(' e ')}.`
    });
  }
  return notes;
}

async function publishTick({ sh } = {}) {
  if (process.env.JARVIS_SOCIALHUB_CLOCK === '0') return { skipped: true, reason: 'disabled', notes: [] };
  const c = connector(sh);
  if (!c.socialhubReady()) return { skipped: true, reason: 'not_configured', notes: [] };
  // TikTok espera a publicação terminar (pode passar de 1 min): não empilha rodadas
  if (inflight) return { skipped: true, reason: 'inflight', notes: [] };
  inflight = true;
  try {
    const out = await c.publicarAgendados();
    const cron = out.cron || out;
    if (out.skipped || cron.skipped) return { skipped: true, reason: 'paused', notes: [] };
    return { processed: cron.processed || 0, notes: publishNotes(cron.results) };
  } catch (e) {
    // Fora do ar quem avisa é o uptime; aqui só loga (no máximo 1x a cada 10 min)
    if (Date.now() - lastErrorLog > 10 * 60 * 1000) {
      lastErrorLog = Date.now();
      console.error('[socialhub-clock] publicar:', e.message);
    }
    return { skipped: true, reason: 'error', error: e.message, notes: [] };
  } finally {
    inflight = false;
  }
}

async function dailyTokens({ sh } = {}) {
  if (process.env.JARVIS_SOCIALHUB_CLOCK === '0') return { skipped: true, reason: 'disabled', notes: [] };
  const c = connector(sh);
  if (!c.socialhubReady()) return { skipped: true, reason: 'not_configured', notes: [] };
  const notes = [];
  let renewed = 0;
  try {
    const out = await c.renovarTokens();
    const cron = out.cron || {};
    if (!out.skipped && !cron.skipped) renewed = cron.renewed || 0;
  } catch (e) {
    console.error('[socialhub-clock] renovar logins:', e.message);
  }
  try {
    const { accounts = [] } = await c.listarContas();
    const vencidas = accounts.filter((a) => a.tokenStatus === 'vencido');
    const logo = accounts.filter((a) => a.tokenStatus === 'vence_logo');
    if (vencidas.length) {
      const quem = vencidas.map((a) => `${rede(a.platform)} @${a.username}`).join(', ');
      notes.push({
        level: 'warn',
        type: 'socialhub_token_expired',
        text: `Login vencido no TeusHub: ${quem}. Os posts dessa conta vão falhar até reconectar em teushub.online/settings.`,
        speech: `Senhor, o login do ${vencidas.map((a) => rede(a.platform)).join(' e ')} no TeusHub venceu. Precisa reconectar.`
      });
    }
    if (logo.length) {
      const quem = logo.map((a) => `${rede(a.platform)} @${a.username}`).join(', ');
      notes.push({
        level: 'warn',
        type: 'socialhub_token_expiring',
        text: `Login quase vencendo no TeusHub e não renovou sozinho: ${quem}. Reconecta em teushub.online/settings.`,
        speech: `Senhor, o login do ${logo.map((a) => rede(a.platform)).join(' e ')} no TeusHub está pra vencer.`
      });
    }
  } catch (e) {
    console.error('[socialhub-clock] contas:', e.message);
  }
  return { renewed, notes };
}

function _reset() {
  inflight = false;
  lastErrorLog = 0;
}

module.exports = { publishTick, dailyTokens, publishNotes, _reset };
