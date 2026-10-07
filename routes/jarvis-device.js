/**
 * Pareamento do Jarvis Desktop (público: o PC ainda não tem sessão).
 * POST /api/jarvis-device/pair { code, name, kind? } → { deviceId, token } (kind 'phone' = página do celular)
 * POST /api/jarvis-device/blob — arquivo grande (base64) do PC; evita estourar o WebSocket
 * Código: 8 caracteres, uso único, 10 min. Limite de tentativas por IP contra chute.
 */
const express = require('express');
const { redeemPairCode, authenticateToken } = require('../lib/jarvis/devices/store');
const blobs = require('../lib/jarvis/devices/blobs');

const router = express.Router();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;
const tries = new Map(); // ip -> timestamps

function tooMany(ip) {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  tries.set(ip, list);
  if (tries.size > 5000) tries.delete(tries.keys().next().value);
  return list.length > MAX_TRIES;
}

function bearer(req) {
  const h = String(req.get('authorization') || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

router.post('/pair', express.json({ limit: '2kb' }), async (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || '?');
  if (tooMany(ip)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Espera alguns minutos.' });
  }
  const code = String(req.body?.code || '');
  const name = String(req.body?.name || 'PC');
  const kind = req.body?.kind === 'phone' ? 'phone' : 'pc';
  try {
    const out = await redeemPairCode(code, name, kind);
    if (!out) return res.status(401).json({ erro: 'Código inválido, expirado ou já usado.' });
    res.set('Cache-Control', 'no-store');
    res.json({ deviceId: out.deviceId, token: out.token, name: out.name, kind: out.kind });
  } catch (e) {
    console.error('[jarvis.device] pair:', e.message);
    res.status(500).json({ erro: 'Falha ao parear.' });
  }
});

/**
 * Arquivo grande do PC (WhatsApp etc.).
 * Body = bytes crus (application/octet-stream) — o express.json global (2mb) NÃO engole isso
 * (antes: JSON+base64 → 413 Payload Too Large).
 * Headers: Authorization, x-jarvis-mime, x-jarvis-filename (URI-encoded).
 */
router.post(
  '/blob',
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  async (req, res) => {
    try {
      const device = await authenticateToken(bearer(req));
      if (!device) return res.status(401).json({ erro: 'token inválido' });
      if (device.kind === 'phone') return res.status(403).json({ erro: 'só o PC sobe arquivo' });
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!buf.length) return res.status(400).json({ erro: 'arquivo vazio' });
      let fileName = 'arquivo';
      try {
        fileName = decodeURIComponent(String(req.get('x-jarvis-filename') || 'arquivo'));
      } catch (_) {
        fileName = String(req.get('x-jarvis-filename') || 'arquivo').slice(0, 180);
      }
      const out = blobs.put({
        deviceId: device.id,
        userId: device.userId,
        base64: buf.toString('base64'),
        mime: req.get('x-jarvis-mime') || 'application/octet-stream',
        fileName
      });
      if (out.erro) return res.status(400).json({ erro: out.erro });
      res.set('Cache-Control', 'no-store');
      res.json({ blobId: out.blobId });
    } catch (e) {
      console.error('[jarvis.device] blob:', e.message);
      res.status(500).json({ erro: 'falha ao guardar o arquivo' });
    }
  }
);

module.exports = router;
