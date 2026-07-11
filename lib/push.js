const webpush = require('web-push');
const { all, run } = require('./db');

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';

const configurado = !!(PUBLIC && PRIVATE);
if (configurado) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
} else {
  console.warn('[Push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes — push desativado');
}

// Envia notificação pra todas subscriptions do BD.
// Se o browser respondeu 410 Gone ou 404, apaga a subscription expirada.
async function enviarPush(titulo, mensagem, url) {
  if (!configurado) return { enviadas: 0, falhas: 0, motivo: 'vapid_ausente' };

  const subs = await all(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`);
  if (!subs.length) return { enviadas: 0, falhas: 0, motivo: 'sem_subscriptions' };

  const payload = JSON.stringify({
    title: String(titulo || 'App Rotina'),
    body: String(mensagem || ''),
    url: url || '/',
    ts: Date.now()
  });

  let enviadas = 0, falhas = 0, expiradas = 0;
  await Promise.all(subs.map(async (s) => {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 });
      enviadas++;
      run(`UPDATE push_subscriptions SET ultimo_uso = CURRENT_TIMESTAMP WHERE id = $1`, [s.id]).catch(() => {});
    } catch (err) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        run(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]).catch(() => {});
        expiradas++;
      } else {
        console.error('[Push] Falha ao enviar:', err && err.statusCode, err && err.body);
        falhas++;
      }
    }
  }));

  return { enviadas, falhas, expiradas };
}

module.exports = { enviarPush, configurado, publicKey: PUBLIC };
