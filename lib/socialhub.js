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

/** Testes trocam o fetch (sem rede). */
let fetchImpl = (...args) => fetch(...args);
function _setFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

async function shFetchOnce(path, opts) {
  const res = await fetchImpl(`${baseUrl()}${path}`, {
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

/**
 * Leitura (GET) tenta 2x: o TeusHub no Railway às vezes solta 502/timeout no deploy ou no
 * cold start. Escrita nunca repete sozinha (agendar 2x = post duplicado).
 */
async function shFetch(path, opts = {}) {
  if (!socialhubReady()) throw new Error('SocialHub não configurado (SOCIALHUB_URL/OPS_KEY)');
  const isRead = !opts.method || opts.method === 'GET';
  try {
    return await shFetchOnce(path, opts);
  } catch (e) {
    const transient = !e.status || e.status === 502 || e.status === 503 || e.status === 504;
    if (!isRead || !transient) throw e;
    await new Promise((r) => setTimeout(r, opts.retryDelayMs != null ? opts.retryDelayMs : 1500));
    return shFetchOnce(path, opts);
  }
}

/** O TeusHub só aceita o enum (SCHEDULED…); o modelo manda "agendados", "failed"… */
const STATUS_ALIASES = {
  draft: 'DRAFT', rascunho: 'DRAFT', rascunhos: 'DRAFT',
  pending: 'PENDING', pendente: 'PENDING', pendentes: 'PENDING',
  scheduled: 'SCHEDULED', agendado: 'SCHEDULED', agendados: 'SCHEDULED', programado: 'SCHEDULED', programados: 'SCHEDULED',
  publishing: 'PUBLISHING', publicando: 'PUBLISHING',
  published: 'PUBLISHED', publicado: 'PUBLISHED', publicados: 'PUBLISHED', postado: 'PUBLISHED', postados: 'PUBLISHED',
  failed: 'FAILED', falha: 'FAILED', falhas: 'FAILED', falhou: 'FAILED', falho: 'FAILED', falhos: 'FAILED', erro: 'FAILED', erros: 'FAILED'
};

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'todos' || s === 'all') return null;
  return STATUS_ALIASES[s] || null;
}

const PLATFORM_ALIASES = {
  instagram: 'INSTAGRAM', insta: 'INSTAGRAM', ig: 'INSTAGRAM', reels: 'INSTAGRAM',
  tiktok: 'TIKTOK', tik: 'TIKTOK', tt: 'TIKTOK',
  facebook: 'FACEBOOK', face: 'FACEBOOK', fb: 'FACEBOOK',
  youtube: 'YOUTUBE', yt: 'YOUTUBE', shorts: 'YOUTUBE'
};

/**
 * "instagram", "@misterressence", "tiktok do mister", id… → ids das contas conectadas.
 * @returns {{ ids: string[], naoAchei: string[] }}
 */
function resolverContas(refs, contas) {
  const list = Array.isArray(refs) ? refs : String(refs || '').split(/[,;]| e /);
  const ids = [];
  const naoAchei = [];
  for (const raw of list) {
    const ref = String(raw || '').trim();
    if (!ref) continue;
    const low = ref.toLowerCase().replace(/^@/, '');
    let hit = contas.filter((c) => c.id === ref);
    if (!hit.length) {
      if (low === 'todas' || low === 'todos' || low === 'tudo') hit = contas.filter((c) => c.platform !== 'YOUTUBE');
    }
    if (!hit.length) {
      const plat = Object.entries(PLATFORM_ALIASES).find(([k]) => new RegExp(`\\b${k}\\b`).test(low));
      const user = contas.filter((c) => low.includes(String(c.username || '').toLowerCase()));
      if (plat) hit = contas.filter((c) => c.platform === plat[1]);
      if (hit.length > 1 && user.length) hit = hit.filter((c) => user.includes(c));
      if (!hit.length) hit = user;
    }
    if (!hit.length) naoAchei.push(ref);
    for (const c of hit) if (!ids.includes(c.id)) ids.push(c.id);
  }
  return { ids, naoAchei };
}

/**
 * Horários espalhados: 1º em `inicio`, os próximos a cada `intervaloMin` (+ até `variacaoMin`
 * aleatório, pra não postar no minuto redondo feito robô).
 */
function espalharHorarios(n, { inicio = Date.now(), intervaloMin = 15, variacaoMin = 0, rand = Math.random } = {}) {
  const out = [];
  let t = new Date(inicio).getTime();
  for (let i = 0; i < n; i++) {
    if (i > 0) t += (intervaloMin + Math.round(rand() * Math.max(0, variacaoMin))) * 60000;
    out.push(new Date(t).toISOString());
  }
  return out;
}

async function getSocialhubSnapshot() {
  if (!socialhubReady()) {
    return { conectado: false, motivo: 'SOCIALHUB_URL/OPS_KEY ausentes' };
  }
  try {
    const [summary, published] = await Promise.all([
      shFetch('/api/ops/summary', { timeoutMs: 15000 }),
      listarPosts('PUBLISHED', 25).catch(() => ({ posts: [], erro: 'listarPosts falhou' }))
    ]);

    const hojeYmd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    const postsList = published.posts || [];
    const postsHoje = postsList.filter((p) => {
      if (!p.publishedAt) return false;
      try {
        return (
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(p.publishedAt)) === hojeYmd
        );
      } catch {
        return String(p.publishedAt).slice(0, 10) === hojeYmd;
      }
    });

    const porConta = {};
    for (const p of postsHoje) {
      for (const pl of p.platforms || []) {
        const key = `${pl.platform || '?'}:${pl.account || '?'}`;
        if (!porConta[key]) {
          porConta[key] = {
            platform: pl.platform,
            account: pl.account,
            posts: 0
          };
        }
        porConta[key].posts += 1;
      }
    }

    const contas = summary.contas || [];
    return {
      conectado: true,
      projeto: 'SocialHub',
      contas,
      // Login da rede vencido/vencendo = o próximo post dela falha → avisar antes
      contas_com_problema: contas
        .filter((c) => c.tokenStatus && c.tokenStatus !== 'ok')
        .map((c) => ({ platform: c.platform, username: c.username, tokenStatus: c.tokenStatus })),
      posts: summary.posts || null,
      metricas_7d: summary.metricas_7d || null,
      ops_flags: summary.ops_flags || null,
      hoje: {
        data: hojeYmd,
        total: postsHoje.length,
        por_conta: Object.values(porConta),
        itens: postsHoje.slice(0, 8).map((p) => ({
          id: p.id,
          caption: p.caption,
          publishedAt: p.publishedAt,
          platforms: (p.platforms || []).map((x) => x.platform)
        })),
        motivo: published.erro || null
      },
      nota:
        'Posts do dia no TeuHub → hoje.total (NÃO Attracione / NÃO CineRush Editor). ' +
        'posts.proximos = fila; posts.falhas_recentes traz o motivo de cada falha. ' +
        'Cancelar/reagendar/tentar de novo → socialhub_post_acao.'
    };
  } catch (e) {
    return { conectado: false, motivo: e.message, erro: e.message };
  }
}

async function listarContas() {
  return shFetch('/api/ops/accounts');
}

async function listarPosts(status, limit = 10, { id } = {}) {
  const q = new URLSearchParams();
  const st = normalizeStatus(status);
  if (st) q.set('status', st);
  if (id) q.set('id', String(id));
  q.set('limit', String(Math.min(30, Math.max(1, Number(limit) || 10))));
  return shFetch(`/api/ops/posts?${q}`);
}

/** action: cancel | reschedule | retry (TeusHub /api/ops/posts/:id) */
async function postAcao(id, action, scheduledAt) {
  return shFetch(`/api/ops/posts/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, ...(scheduledAt ? { scheduledAt } : {}) }),
    timeoutMs: 20000
  });
}

/** Renova os logins das redes que vencem logo (o Railway não roda o cron diário do vercel.json). */
async function renovarTokens() {
  return shFetch('/api/ops/cron/publish?job=refresh-tokens', {
    method: 'POST',
    body: '{}',
    timeoutMs: 90000
  });
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

/** Runtime ops flags — pause crons without redeploy. */
async function listOpsFlags() {
  return shFetch('/api/ops/flags', { timeoutMs: 10000 });
}

async function setOpsFlag(key, enabled, note) {
  return shFetch('/api/ops/flags', {
    method: 'PATCH',
    body: JSON.stringify({
      key: String(key || '').trim(),
      enabled: enabled !== false,
      note: note != null ? String(note).slice(0, 500) : undefined
    }),
    timeoutMs: 10000
  });
}

module.exports = {
  socialhubReady,
  getSocialhubSnapshot,
  listarContas,
  listarPosts,
  postAcao,
  renovarTokens,
  normalizeStatus,
  resolverContas,
  espalharHorarios,
  _setFetch,
  agendarPost,
  publicarAgendados,
  listOpsFlags,
  setOpsFlag
};
