/**
 * Cliente SocialHub (módulo Jarvis) — ops via Bearer OPS_API_KEY/CRON_SECRET.
 */
function baseUrl() {
  return String(process.env.SOCIALHUB_URL || 'https://teushub.online').replace(/\/+$/, '');
}

function opsKey() {
  return String(process.env.SOCIALHUB_OPS_KEY || '').trim();
}

function socialhubReady() {
  return !!(baseUrl() && opsKey().length >= 16);
}

async function shFetch(path, opts = {}) {
  if (!socialhubReady()) throw new Error('SocialHub não configurado (SOCIALHUB_URL/OPS_KEY)');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${opsKey()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 30000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `SocialHub HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getSocialhubSnapshot() {
  if (!socialhubReady()) return { conectado: false };
  try {
    const summary = await shFetch('/api/ops/summary', { timeoutMs: 15000 });
    return {
      conectado: true,
      projeto: 'SocialHub',
      contas: summary.contas || [],
      posts: summary.posts || null,
      metricas_7d: summary.metricas_7d || null
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function listarContas() {
  return shFetch('/api/ops/accounts');
}

async function listarPosts(status, limit = 10) {
  const q = new URLSearchParams();
  if (status) q.set('status', String(status));
  q.set('limit', String(limit));
  return shFetch(`/api/ops/posts?${q}`);
}

async function agendarPost({ caption, socialAccountIds, scheduledAt, mediaUrls, mediaType }) {
  return shFetch('/api/ops/posts', {
    method: 'POST',
    body: JSON.stringify({ caption, socialAccountIds, scheduledAt, mediaUrls, mediaType }),
    timeoutMs: 30000
  });
}

async function publicarAgendados() {
  return shFetch('/api/ops/cron/publish', {
    method: 'POST',
    body: '{}',
    timeoutMs: 90000
  });
}

module.exports = {
  socialhubReady,
  getSocialhubSnapshot,
  listarContas,
  listarPosts,
  agendarPost,
  publicarAgendados
};
