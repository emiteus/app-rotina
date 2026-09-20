/**
 * Cache curto do último layout reproduce por user — follow-ups tipo "afasta os escudos".
 */
const store = new Map(); // userId -> { base64, mime, caption, at }
const TTL_MS = Number(process.env.JARVIS_LAYOUT_CACHE_TTL_MS) || 45 * 60 * 1000;
const MAX_B64 = 8 * 1024 * 1024; // ~6MB decoded

function rememberLayoutImage(userId, { base64, mime, caption } = {}) {
  const id = String(userId || '');
  const b64 = String(base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!id || !b64 || b64.length < 200 || b64.length > MAX_B64) return false;
  store.set(id, {
    base64: b64,
    mime: mime || 'image/png',
    caption: String(caption || '').slice(0, 200),
    at: Date.now()
  });
  return true;
}

function getLastLayoutImage(userId) {
  const id = String(userId || '');
  const row = store.get(id);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    store.delete(id);
    return null;
  }
  return row;
}

function clearLayoutImage(userId) {
  store.delete(String(userId || ''));
}

module.exports = {
  rememberLayoutImage,
  getLastLayoutImage,
  clearLayoutImage
};
