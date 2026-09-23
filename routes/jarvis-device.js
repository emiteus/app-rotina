/**
 * Pareamento do Jarvis Desktop (público: o PC ainda não tem sessão).
 * POST /api/jarvis-device/pair { code, name } → { deviceId, token }
 * Código: 8 caracteres, uso único, 10 min. Limite de tentativas por IP contra chute.
 */
const express = require('express');
const { redeemPairCode } = require('../lib/jarvis/devices/store');

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

router.post('/pair', express.json({ limit: '2kb' }), async (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || '?');
  if (tooMany(ip)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Espera alguns minutos.' });
  }
  const code = String(req.body?.code || '');
  const name = String(req.body?.name || 'PC');
  try {
    const out = await redeemPairCode(code, name);
    if (!out) return res.status(401).json({ erro: 'Código inválido, expirado ou já usado.' });
    res.json({ deviceId: out.deviceId, token: out.token, name: out.name });
  } catch (e) {
    console.error('[jarvis.device] pair:', e.message);
    res.status(500).json({ erro: 'Falha ao parear.' });
  }
});

module.exports = router;
