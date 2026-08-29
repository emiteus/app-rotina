const express = require('express');
const { run, get, all } = require('../lib/db');
const { enviarPush, configurado, publicKey } = require('../lib/push');
const { requireUserId } = require('../lib/tenant');

const router = express.Router();

// GET /api/push/config — retorna a public key pro frontend
router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ativo: configurado, publicKey: publicKey || null });
});

// POST /api/push/subscribe — salva/atualiza subscription do browser
router.post('/subscribe', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ erro: 'subscription inválida' });
  }
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    await run(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         user_id = EXCLUDED.user_id`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth, ua, uid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/push/unsubscribe — remove subscription (usuário desabilitou)
router.post('/unsubscribe', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ erro: 'endpoint obrigatório' });
  try {
    await run(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [endpoint, uid]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/push/test — dispara uma notificação de teste
router.post('/test', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const subs = await all(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [uid]);
    if (!subs.length) return res.json({ enviadas: 0, falhas: 0, motivo: 'sem_subscriptions' });
    const r = await enviarPush('App Rotina', 'Notificação de teste — se você tá vendo isso, tá funcionando 🚀', '/');
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
