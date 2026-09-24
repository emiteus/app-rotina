/**
 * Avisos no celular (Fase 5.5 MCU): Web Push pra página do Jarvis instalada na tela inicial.
 * A inscrição vem do próprio celular pelo canal /jarvis-device; o servidor só manda pro serviço de
 * push oficial (Apple/Google/Mozilla/Microsoft) — endpoint de outro lugar é recusado (sem SSRF).
 */
const store = require('./store');

const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/
];

/** Confere e limpa a inscrição que o celular mandou. null = inválida. */
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  let url;
  try {
    url = new URL(String(sub.endpoint || ''));
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  if (url.href.length > 1000) return null;
  const keys = sub.keys || {};
  const b64u = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
  if (!b64u.test(String(keys.p256dh || '')) || !b64u.test(String(keys.auth || ''))) return null;
  return { endpoint: url.href, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) } };
}

function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let configured = null;
function webpush(deps) {
  if (deps && deps.webpush) return deps.webpush;
  const wp = require('web-push');
  if (configured === null) {
    configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (configured) {
      wp.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }
  }
  return configured ? wp : null;
}

/**
 * Manda o aviso pros celulares do usuário com aviso ligado.
 * @returns {Promise<{ sent: number, failed: number }>} sent > 0 → quem chamou pode pular o WhatsApp
 */
async function pushToPhones(userId, { title = 'Jarvis', body, tag = 'jarvis' } = {}, deps = {}) {
  if (!userId || !body || process.env.JARVIS_PHONE_PUSH === '0') return { sent: 0, failed: 0 };
  const targets = await (deps.targets || store.phonePushTargets)(userId).catch(() => []);
  if (!targets.length) return { sent: 0, failed: 0 };
  let wp;
  try {
    wp = webpush(deps);
  } catch (_) {
    wp = null;
  }
  if (!wp) return { sent: 0, failed: 0 };
  const payload = JSON.stringify({
    title: String(title).slice(0, 60),
    body: String(body).slice(0, 400),
    tag: String(tag).slice(0, 40),
    url: '/jarvis/'
  });
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    const sub = cleanSubscription(t.sub);
    if (!sub) continue;
    try {
      await wp.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' });
      sent += 1;
    } catch (e) {
      failed += 1;
      // Inscrição morta (app removido da tela inicial / permissão tirada) → apaga
      if (e.statusCode === 404 || e.statusCode === 410) {
        await (deps.setPush || store.setDevicePush)(t.deviceId, null).catch(() => {});
      }
      console.log(JSON.stringify({ tag: 'jarvis.push', event: 'fail', deviceId: t.deviceId, status: e.statusCode || null }));
    }
  }
  return { sent, failed };
}

module.exports = { cleanSubscription, pushToPhones, vapidPublicKey, PUSH_HOSTS };
