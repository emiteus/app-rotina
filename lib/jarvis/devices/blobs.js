/**
 * Blobs grandes do PC (ex. arquivo pro WhatsApp) — sobem por HTTP, não pelo WebSocket.
 * Memória com TTL curto; take() consome (1 uso).
 */
const crypto = require('crypto');

const TTL_MS = 3 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024; // alinhado ao pc_files_fetch
const MAX_ENTRIES = 40;

/** @type {Map<string, { deviceId: string, userId: string, base64: string, mime: string, fileName: string, exp: number }>} */
const store = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, b] of store) {
    if (b.exp <= now) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (!oldest) break;
    store.delete(oldest);
  }
}

/**
 * @returns {{ blobId: string } | { erro: string }}
 */
function put({ deviceId, userId, base64, mime = 'application/octet-stream', fileName = 'arquivo' }) {
  sweep();
  const b64 = String(base64 || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 8) {
    return { erro: 'blob inválido' };
  }
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes <= 0 || bytes > MAX_BYTES) {
    return { erro: `arquivo grande demais (máx ${Math.round(MAX_BYTES / (1024 * 1024))} MB)` };
  }
  const blobId = `b${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
  store.set(blobId, {
    deviceId: String(deviceId),
    userId: String(userId),
    base64: b64,
    mime: String(mime || 'application/octet-stream').slice(0, 120),
    fileName: String(fileName || 'arquivo').slice(0, 180),
    exp: Date.now() + TTL_MS
  });
  return { blobId };
}

/** Consome o blob se for do mesmo aparelho. */
function take(blobId, { deviceId } = {}) {
  sweep();
  const id = String(blobId || '');
  const b = store.get(id);
  if (!b) return null;
  if (deviceId && b.deviceId !== String(deviceId)) return null;
  store.delete(id);
  return b;
}

module.exports = { put, take, MAX_BYTES, TTL_MS };
