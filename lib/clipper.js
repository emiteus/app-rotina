/**
 * Cliente Clipper/Vortex (módulo Jarvis).
 * Localhost por padrão — no Railway só funciona se CLIPPER_API_URL for público/túnel.
 */
function baseUrl() {
  return String(process.env.CLIPPER_API_URL || '').replace(/\/+$/, '');
}

function clipperReady() {
  return !!baseUrl();
}

async function clipFetch(path, opts = {}) {
  if (!clipperReady()) throw new Error('Clipper não configurado (CLIPPER_API_URL)');
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  const key = String(process.env.CLIPPER_API_KEY || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs || 15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `Clipper HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getClipperSnapshot() {
  if (!clipperReady()) {
    return { conectado: false, motivo: 'CLIPPER_API_URL ausente (PC local / túnel)' };
  }
  try {
    const [health, status, streams, clips] = await Promise.all([
      clipFetch('/api/health', { timeoutMs: 5000 }).catch(() => null),
      clipFetch('/api/system/status', { timeoutMs: 8000 }).catch(() => null),
      clipFetch('/api/streams', { timeoutMs: 8000 }).catch(() => null),
      clipFetch('/api/clips?limit=5&offset=0', { timeoutMs: 8000 }).catch(() => null)
    ]);
    const streamList = streams?.streams || [];
    const live = streamList.filter((s) => s?.live || s?.status === 'live' || s?.isLive).length;
    return {
      conectado: !!(health && health.ok !== false),
      projeto: 'Clipper',
      health: health || null,
      sistema: status?.status || status || null,
      streams: {
        total: streamList.length,
        live,
        itens: streamList.slice(0, 8).map((s) => ({
          id: s.id,
          name: s.name || s.title || s.login,
          live: !!(s.live || s.isLive || s.status === 'live')
        }))
      },
      clips_recentes: (clips?.groups || []).slice(0, 5).map((g) => ({
        id: g.id,
        note: g.note,
        createdAt: g.createdAt,
        status: g.status,
        clips: Array.isArray(g.clips) ? g.clips.length : undefined
      }))
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function criarClip({ durationSeconds = 30, note, streamIds, clickTimestamp } = {}) {
  return clipFetch('/api/clips', {
    method: 'POST',
    body: JSON.stringify({
      durationSeconds: Number(durationSeconds) || 30,
      ...(note ? { note: String(note) } : {}),
      ...(Array.isArray(streamIds) ? { streamIds } : {}),
      ...(clickTimestamp != null ? { clickTimestamp: Number(clickTimestamp) } : {})
    }),
    timeoutMs: 30000
  });
}

async function retryClip(groupId) {
  return clipFetch(`/api/clips/${encodeURIComponent(groupId)}/retry`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 30000
  });
}

module.exports = {
  clipperReady,
  getClipperSnapshot,
  criarClip,
  retryClip
};
