/**
 * Cache curto de snapshots (Phase 2 + 4).
 * - projetos: HTTP externos (default 45s)
 * - assist: snapshot lite completo (default 20s)
 * - bypass: após coleta async, força refresh por N ms
 */
const PROJETOS_TTL_MS = Number(process.env.JARVIS_SNAPSHOT_CACHE_MS) || 45000;
const ASSIST_TTL_MS = Number(process.env.JARVIS_ASSIST_CACHE_MS) || 20000;
const store = new Map(); // key -> { at, value }
const bypassUntil = new Map(); // userId -> timestamp
const refreshTimers = new Map(); // userId -> timeout[]

function keyProjetos(userId) {
  return `projetos:${userId || 'anon'}`;
}
function keyAssist(userId) {
  return `assist:${userId || 'anon'}`;
}

async function getCached(key, ttlMs, loader) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await loader();
  store.set(key, { at: now, value });
  return value;
}

async function getCachedProjetos(userId, loader) {
  const uid = userId || 'anon';
  const until = bypassUntil.get(uid) || 0;
  if (Date.now() < until) {
    store.delete(keyProjetos(uid));
  }
  return getCached(keyProjetos(uid), PROJETOS_TTL_MS, loader);
}

async function getCachedAssistSnap(userId, loader) {
  return getCached(keyAssist(userId), ASSIST_TTL_MS, loader);
}

function invalidateProjetosCache(userId) {
  store.delete(keyProjetos(userId));
}

function invalidateAssistCache(userId) {
  store.delete(keyAssist(userId));
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
  ASSIST_TTL_MS
};
