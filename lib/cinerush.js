/**
 * Cliente CineRush (módulo Jarvis) — ops via ADMIN_OPS_KEY.
 */
function baseUrl() {
  return String(process.env.CINERUSH_BACKEND_URL || '').replace(/\/+$/, '');
}

function opsKey() {
  return String(process.env.CINERUSH_OPS_KEY || '').trim();
}

function cinerushReady() {
  return !!(baseUrl() && opsKey().length >= 16);
}

async function cinerushFetch(path, opts = {}) {
  if (!cinerushReady()) throw new Error('CineRush não configurado (CINERUSH_BACKEND_URL/OPS_KEY)');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${opsKey()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `CineRush HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Snapshot leve pro contexto do Jarvis (só owner). */
async function getCinerushSnapshot() {
  if (!cinerushReady()) return { conectado: false };
  try {
    const summary = await cinerushFetch('/api/admin/ops/summary', { timeoutMs: 15000 });
    return {
      conectado: true,
      projeto: 'CineRush TV',
      periodo: summary.periodo,
      assinantes: summary.assinantes,
      receita_mes: summary.receita_mes,
      vendas_ontem: summary.vendas_ontem || null,
      chart_7d: summary.chart_7d || null,
      havok: summary.havok?.credits != null
        ? { credits: summary.havok.credits, cached: !!summary.havok.cached }
        : summary.havok,
      fila: summary.fila,
      suporte: summary.chatwoot || null
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function buscarAssinantes(search, status) {
  const q = new URLSearchParams();
  if (search) q.set('search', String(search));
  if (status) q.set('status', String(status));
  q.set('page', '1');
  q.set('pageSize', '10');
  return cinerushFetch(`/api/admin/subscribers?${q}`);
}

async function provisionarAssinante(id) {
  return cinerushFetch(`/api/admin/subscribers/${encodeURIComponent(id)}/provision`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 90000
  });
}

async function reenviarEmailAssinante(id, force = true) {
  const qs = force ? '?force=true' : '';
  return cinerushFetch(`/api/admin/subscribers/${encodeURIComponent(id)}/send-email${qs}`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 45000
  });
}

async function listarChatwoot(status = 'open', limit = 15) {
  const q = new URLSearchParams({ status: String(status || 'open'), limit: String(limit) });
  return cinerushFetch(`/api/admin/ops/chatwoot/conversations?${q}`);
}

async function resolverChatwoot(id) {
  return cinerushFetch(
    `/api/admin/ops/chatwoot/conversations/${encodeURIComponent(id)}/resolve`,
    { method: 'POST', body: '{}', timeoutMs: 20000 }
  );
}

async function atribuirChatwoot(id, teamId) {
  return cinerushFetch(
    `/api/admin/ops/chatwoot/conversations/${encodeURIComponent(id)}/assign`,
    {
      method: 'POST',
      body: JSON.stringify(teamId != null ? { team_id: teamId } : {}),
      timeoutMs: 20000
    }
  );
}

module.exports = {
  cinerushReady,
  getCinerushSnapshot,
  buscarAssinantes,
  provisionarAssinante,
  reenviarEmailAssinante,
  listarChatwoot,
  resolverChatwoot,
  atribuirChatwoot
};
