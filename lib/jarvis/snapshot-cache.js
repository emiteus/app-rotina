/**
 * Cache curto de snapshots de projetos (Phase 2).
 * Evita re-bater CineRush/Attracione/SocialHub/Clipper a cada bolha do WhatsApp.
 */
const DEFAULT_TTL_MS = Number(process.env.JARVIS_SNAPSHOT_CACHE_MS) || 45000;
const store = new Map(); // key -> { at, value }

function cacheKey(userId) {
  return `projetos:${userId || 'anon'}`;
}

async function getCachedProjetos(userId, loader) {
  const key = cacheKey(userId);
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < DEFAULT_TTL_MS) {
    return hit.value;
  }
  const value = await loader();
  store.set(key, { at: now, value });
  return value;
}

function invalidateProjetosCache(userId) {
  store.delete(cacheKey(userId));
}

function clearAllSnapshotCache() {
  store.clear();
}

module.exports = {
  getCachedProjetos,
  invalidateProjetosCache,
  clearAllSnapshotCache,
  DEFAULT_TTL_MS
};
