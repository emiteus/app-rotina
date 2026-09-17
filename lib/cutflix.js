/**
 * Cutflix connector — health check da API (ops write ainda não no hub).
 * Env: CUTFLIX_API_URL (ex. https://api.cutflix… ou http://localhost:4000)
 */
function baseUrl() {
  return String(process.env.CUTFLIX_API_URL || '').replace(/\/+$/, '');
}

function cutflixReady() {
  return !!baseUrl();
}

async function cutflixFetch(path, opts = {}) {
  if (!cutflixReady()) throw new Error('Cutflix não configurado (CUTFLIX_API_URL)');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `Cutflix HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getCutflixSnapshot() {
  if (!cutflixReady()) {
    return { conectado: false, motivo: 'CUTFLIX_API_URL ausente' };
  }
  try {
    const health = await cutflixFetch('/api/v1/health', { timeoutMs: 8000 });
    const status =
      health?.data?.status ||
      health?.status ||
      (health?.success ? 'ok' : null);
    return {
      conectado: true,
      projeto: 'Cutflix',
      status: status || 'ok',
      health
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function cutflixStatus() {
  const snap = await getCutflixSnapshot();
  return snap;
}

module.exports = {
  cutflixReady,
  getCutflixSnapshot,
  cutflixStatus
};
