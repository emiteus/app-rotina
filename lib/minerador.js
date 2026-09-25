/**
 * Cliente do Minerador (R:\Projetos\Minerador) — cortes de filme em alta no Kwai.
 * Ops via Bearer MINERADOR_OPS_KEY. Sem MINERADOR_URL o braço fica desligado.
 */
function baseUrl() {
  return String(process.env.MINERADOR_URL || '').trim().replace(/\/+$/, '');
}

function opsKey() {
  return String(process.env.MINERADOR_OPS_KEY || '').trim();
}

function mineradorReady() {
  return !!(baseUrl() && opsKey().length >= 32);
}

let fetchImpl = (...a) => fetch(...a);
function _setFetch(fn) {
  fetchImpl = fn || ((...a) => fetch(...a));
}

async function mFetch(path, opts = {}) {
  if (!mineradorReady()) throw new Error('Minerador não configurado (MINERADOR_URL/OPS_KEY)');
  const res = await fetchImpl(`${baseUrl()}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${opsKey()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Minerador HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const feed = ({ janela = 6, limite = 10, pagina, minViews, ordem, dias } = {}) => {
  const q = new URLSearchParams({ janela: String(janela), limite: String(limite) });
  if (pagina) q.set('pagina', String(pagina));
  if (minViews) q.set('min_views', String(Math.round(minViews)));
  if (ordem === 'views') q.set('ordem', 'views');
  if (dias) q.set('dias', String(dias));
  return mFetch(`/api/ops/feed?${q}`);
};
const sources = () => mFetch('/api/ops/sources');
const addSource = (ref) =>
  mFetch('/api/ops/sources', {
    method: 'POST',
    body: JSON.stringify(/^https?:/i.test(String(ref)) ? { link: ref } : { handle: String(ref).replace(/^@/, '') }),
    timeoutMs: 60000
  });
/** Vários @/links de uma vez (link curto do app vale). Lento de propósito: ~1,5 s por página. */
const addSources = (refs) =>
  mFetch('/api/ops/sources/lote', { method: 'POST', body: JSON.stringify({ refs }), timeoutMs: 180000 });
const removeSource = (handle) => mFetch(`/api/ops/sources/${encodeURIComponent(String(handle).replace(/^@/, ''))}`, { method: 'DELETE' });
const setStatus = (videoId, status) =>
  mFetch(`/api/ops/videos/${encodeURIComponent(String(videoId))}/status`, { method: 'POST', body: JSON.stringify({ status }) });
const status = () => mFetch('/api/ops/status');
/** Varre a página INTEIRA no Minerador (segundo plano; página grande leva minutos). Devolve {id, handle}. */
const varrer = (ref, { dias } = {}) =>
  mFetch('/api/ops/varredura', { method: 'POST', body: JSON.stringify({ pagina: String(ref), ...(dias ? { dias } : {}) }), timeoutMs: 90000 });
const varredura = (id, { minViews, limite, dias } = {}) => {
  const q = new URLSearchParams();
  if (minViews) q.set('min_views', String(Math.round(minViews)));
  if (limite) q.set('limite', String(limite));
  if (dias) q.set('dias', String(dias));
  return mFetch(`/api/ops/varredura/${encodeURIComponent(String(id))}?${q}`);
};

/** Pro snapshot do Jarvis: top 5 + saúde. Nunca lança. */
async function getMineradorSnapshot() {
  if (!mineradorReady()) return { conectado: false, motivo: 'MINERADOR_URL/OPS_KEY ausentes' };
  try {
    const [f, s] = await Promise.all([feed({ janela: 6, limite: 5 }), status()]);
    return {
      conectado: true,
      projeto: 'Minerador',
      paginas: s.ativas,
      ultima_rodada: s.ultimaRodada ? { em: s.ultimaRodada.inicio, videos: s.ultimaRodada.videos, alerta: s.ultimaRodada.alerta } : null,
      em_alta: (f.videos || []).map((v) => ({ videoId: v.videoId, pagina: v.handle, views: v.views, porHora: v.porHora, idadeH: v.idadeH, url: v.url })),
      nota: 'Cortes em alta no Kwai (Minerador). Cortar → cinerush_editor_process com a url + minerador_video status cortado.'
    };
  } catch (e) {
    return { conectado: false, motivo: e.message };
  }
}

module.exports = { mineradorReady, feed, sources, addSource, addSources, removeSource, setStatus, status, varrer, varredura, getMineradorSnapshot, _setFetch };
