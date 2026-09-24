/**
 * Cache curto de snapshots (Phase 2 + 4).
 * - projetos: HTTP externos (default 45s)
 * - assist: snapshot lite completo (default 20s)
 * - bypass: após coleta async, força refresh por N ms
 *
 * Velho-mas-útil (24/09/2026): montar o snapshot leva ~9 s e o TTL é 20 s, então quase toda fala
 * com o Jarvis esperava ele. Agora, passado o TTL e dentro de STALE_MS, devolve o que tem na hora e
 * atualiza em segundo plano. Mutação (tool) apaga o cache → a próxima resposta espera o dado novo.
 */
const PROJETOS_TTL_MS = Number(process.env.JARVIS_SNAPSHOT_CACHE_MS) || 45000;
const ASSIST_TTL_MS = Number(process.env.JARVIS_ASSIST_CACHE_MS) || 20000;
const STALE_MS = Number(process.env.JARVIS_SNAPSHOT_STALE_MS) || 10 * 60 * 1000;
const store = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise (um carregamento por vez)
const gen = new Map(); // key -> geração; invalidar sobe, e carga antiga não sobrescreve
const bypassUntil = new Map(); // userId -> timestamp
const refreshTimers = new Map(); // userId -> timeout[]

function keyProjetos(userId) {
  return `projetos:${userId || 'anon'}`;
}
function keyAssist(userId) {
  return `assist:${userId || 'anon'}`;
}

function load(key, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const g = gen.get(key) || 0;
  const startedAt = Date.now();
  const p = Promise.resolve()
    .then(loader)
    .then((value) => {
      // Invalidado no meio da carga (tool mexeu nos dados): não guarda o valor velho
      if ((gen.get(key) || 0) === g) store.set(key, { at: startedAt, value });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

async function getCached(key, ttlMs, loader, staleMs = STALE_MS) {
  const hit = store.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < ttlMs) return hit.value;
  if (hit && age < staleMs) {
    load(key, loader).catch((e) => console.error('[snapshot-cache] atualização em segundo plano:', e.message));
    return hit.value;
  }
  return load(key, loader);
}

function drop(key) {
  store.delete(key);
  gen.set(key, (gen.get(key) || 0) + 1);
  inflight.delete(key);
}

async function getCachedProjetos(userId, loader) {
  const uid = userId || 'anon';
  const until = bypassUntil.get(uid) || 0;
  if (Date.now() < until) {
    drop(keyProjetos(uid));
  }
  return getCached(keyProjetos(uid), PROJETOS_TTL_MS, loader);
}

async function getCachedAssistSnap(userId, loader) {
  return getCached(keyAssist(userId), ASSIST_TTL_MS, loader);
}

function invalidateProjetosCache(userId) {
  drop(keyProjetos(userId));
}

function invalidateAssistCache(userId) {
  drop(keyAssist(userId));
}

/** Após qualquer mutação de tool — limpa assist (+ projetos se flag). */
function invalidateUserCaches(userId, { projetos = false } = {}) {
  invalidateAssistCache(userId);
  if (projetos) invalidateProjetosCache(userId);
}

/**
 * Após coleta async: força miss de cache por `ms` e re-invalida em delays.
 * Evita ranking stale logo depois de attracione_coleta.
 */
function bypassProjetosCache(userId, ms = 120000) {
  const uid = userId || 'anon';
  const until = Date.now() + Math.max(5000, Number(ms) || 120000);
  bypassUntil.set(uid, until);
  invalidateProjetosCache(uid);
  invalidateAssistCache(uid);
}

function scheduleProjetosRefresh(userId, delaysMs = [60000, 120000]) {
  const uid = userId || 'anon';
  const prev = refreshTimers.get(uid) || [];
  for (const t of prev) clearTimeout(t);
  const timers = (delaysMs || []).map((d) =>
    setTimeout(() => {
      try {
        invalidateProjetosCache(uid);
        invalidateAssistCache(uid);
      } catch (_) { /* ignore */ }
    }, Math.max(1000, Number(d) || 0))
  );
  refreshTimers.set(uid, timers);
}

function clearAllSnapshotCache() {
  store.clear();
  inflight.clear();
  gen.clear();
  bypassUntil.clear();
  for (const timers of refreshTimers.values()) {
    for (const t of timers) clearTimeout(t);
  }
  refreshTimers.clear();
}

module.exports = {
  getCachedProjetos,
  getCachedAssistSnap,
  invalidateProjetosCache,
  invalidateAssistCache,
  invalidateUserCaches,
  bypassProjetosCache,
  scheduleProjetosRefresh,
  clearAllSnapshotCache,
  DEFAULT_TTL_MS: PROJETOS_TTL_MS,
  ASSIST_TTL_MS,
  STALE_MS
};
