/**
 * Cache curto de snapshots (Phase 2 + 4).
 * - projetos: HTTP externos (default 45s)
 * - assist: snapshot lite completo (default 20s)
 */
const PROJETOS_TTL_MS = Number(process.env.JARVIS_SNAPSHOT_CACHE_MS) || 45000;
const ASSIST_TTL_MS = Number(process.env.JARVIS_ASSIST_CACHE_MS) || 20000;
const store = new Map(); // key -> { at, value }

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
  return getCached(keyProjetos(userId), PROJETOS_TTL_MS, loader);
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

function clearAllSnapshotCache() {
  store.clear();
}

module.exports = {
  getCachedProjetos,
  getCachedAssistSnap,
  invalidateProjetosCache,
  invalidateAssistCache,
  invalidateUserCaches,
  clearAllSnapshotCache,
  DEFAULT_TTL_MS: PROJETOS_TTL_MS,
  ASSIST_TTL_MS
};
