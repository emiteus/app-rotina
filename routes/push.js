const express = require('express');
const { run, get } = require('../lib/db');
const { enviarPush, configurado, publicKey } = require('../lib/push');

const router = express.Router();

// GET /api/push/config — retorna a public key pro frontend
router.get('/config', (req, res) => {
  res.json({ ativo: configurado, publicKey: publicKey || null });
});

// POST /api/push/subscribe — salva/atualiza subscription do browser
router.post('/subscribe', async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ erro: 'subscription inválida' });
  }
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    await run(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth, ua]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/push/unsubscribe — remove subscription (usuário desabilitou)
router.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ erro: 'endpoint obrigatório' });
  try {
    await run(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/push/test — dispara uma notificação de teste
router.post('/test', async (req, res) => {
  try {
    const r = await enviarPush('App Rotina', 'Notificação de teste — se você tá vendo isso, tá funcionando 🚀', '/');
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
