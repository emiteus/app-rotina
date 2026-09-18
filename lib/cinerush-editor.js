/**
 * Cliente CineRush Editor (ops M2M) — process / batch / poll.
 * Env: CINERUSH_EDITOR_URL + CINERUSH_EDITOR_OPS_KEY (≥16).
 */
function baseUrl() {
  return String(process.env.CINERUSH_EDITOR_URL || '').replace(/\/+$/, '');
}

function opsKey() {
  return String(process.env.CINERUSH_EDITOR_OPS_KEY || '').trim();
}

function cinerushEditorReady() {
  return !!(baseUrl() && opsKey().length >= 16);
}

async function editorFetch(path, opts = {}) {
  if (!cinerushEditorReady()) {
    throw new Error('CineRush Editor não configurado (CINERUSH_EDITOR_URL/OPS_KEY)');
  }
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
    const msg = data?.error || data?.message || `CineRush Editor HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getCinerushEditorSnapshot() {
  if (!cinerushEditorReady()) {
    return { conectado: false, motivo: 'CINERUSH_EDITOR_URL/OPS_KEY ausentes' };
  }
  try {
    const [health, stats] = await Promise.all([
      editorFetch('/api/ops/health', { timeoutMs: 10000 }),
      editorFetch('/api/ops/stats', { timeoutMs: 12000 }).catch((e) => ({
        erro: e.message
      }))
    ]);
    const hoje = stats?.hoje
      ? {
          data: stats.hoje.data,
          total: stats.hoje.total,
          por_pessoa: (stats.hoje.por_pessoa || []).map((p) => ({
            nome: p.nome || p.email,
            email: p.email,
            videos: p.videos || 0
          })),
          erro: stats.hoje.erro || null
        }
      : null;
    return {
      conectado: !!health.ok,
      projeto: 'CineRush Editor',
      version: health.version || null,
      queue: health.queue || stats?.queue || null,
      hoje,
      nota:
        '"quantos vídeos postei no CineRush hj" → hoje.por_pessoa (IG via editor). NÃO confundir com Attracione (competiçao).',
      notes: health.notes || null
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

function normalizeProcessBody(acao = {}) {
  return {
    url: String(acao.url || '').trim(),
    output_name: acao.output_name || acao.outputName || 'ops_clip',
    movie_name: acao.movie_name || acao.movieName || '',
    manual_headline: acao.manual_headline || acao.headline || acao.titulo || '',
    use_ai: acao.use_ai !== false && acao.useAi !== false,
    use_emojis: acao.use_emojis !== false && acao.useEmojis !== false,
    clip_duration: Number(acao.clip_duration || acao.clipDuration || acao.duracao || 60) || 60,
    template_id: acao.template_id || acao.templateId || '',
    font_id: acao.font_id || acao.fontId || '',
    headline_size: acao.headline_size || acao.headlineSize || '',
    single_cut: acao.single_cut !== false && acao.singleCut !== false,
    upload_ref: acao.upload_ref || acao.uploadRef || '',
    lang: acao.lang || '',
    category_account_id: acao.category_account_id || acao.categoryAccountId || '',
    owner_user_id: acao.owner_user_id || acao.ownerUserId || '',
    owner_email: acao.owner_email || acao.ownerEmail || '',
    client_id: acao.client_id || acao.clientId || ''
  };
}

async function processClip(acao) {
  const body = normalizeProcessBody(acao);
  if (!body.url && !body.upload_ref) {
    throw new Error('url (ou upload_ref) obrigatório');
  }
  return editorFetch('/api/ops/process', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 45000
  });
}

async function processBatch(acao) {
  const raw = acao.items || acao.videos || acao.urls || [];
  const items = (Array.isArray(raw) ? raw : []).map((it) => {
    if (typeof it === 'string') return normalizeProcessBody({ url: it });
    return normalizeProcessBody(it);
  });
  if (!items.length) throw new Error('items[] obrigatório');
  const body = { items };
  if (acao.max != null) body.max = Number(acao.max);
  return editorFetch('/api/ops/process-batch', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 60000
  });
}

async function getJobStatus(jobId) {
  if (!jobId) throw new Error('job_id obrigatório');
  return editorFetch(`/api/ops/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 15000 });
}

async function getBatchStatus(batchId) {
  if (!batchId) throw new Error('batch_id obrigatório');
  return editorFetch(`/api/ops/batches/${encodeURIComponent(batchId)}`, {
    timeoutMs: 15000
  });
}

module.exports = {
  cinerushEditorReady,
  getCinerushEditorSnapshot,
  processClip,
  processBatch,
  getJobStatus,
  getBatchStatus
};
