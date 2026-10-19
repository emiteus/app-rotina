/**
 * Blobs grandes do PC (ex. arquivo pro WhatsApp) — sobem por HTTP, não pelo WebSocket.
 * Memória com TTL curto; take() consome (1 uso).
 */
const crypto = require('crypto');

const TTL_MS = 3 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024; // alinhado ao pc_files_fetch
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 8;

/** @type {Map<string, { deviceId: string, userId: string, base64: string, mime: string, fileName: string, exp: number }>} */
const store = new Map();

function bytesOf(b64) {
  return Math.floor((String(b64).length * 3) / 4);
}

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

function totalBytes() {
  let n = 0;
  for (const b of store.values()) n += bytesOf(b.base64);
  return n;
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
  const bytes = bytesOf(b64);
  if (bytes <= 0 || bytes > MAX_BYTES) {
    return { erro: `arquivo grande demais (máx ${Math.round(MAX_BYTES / (1024 * 1024))} MB)` };
  }
  if (totalBytes() + bytes > MAX_TOTAL_BYTES) {
    return { erro: 'servidor ocupado com outros arquivos, tenta de novo em instantes' };
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

module.exports = { put, take, MAX_BYTES, MAX_TOTAL_BYTES, TTL_MS };
