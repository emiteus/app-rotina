/* Jarvis no celular: service worker só pros avisos (sem cache: a página sempre vem nova). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Jarvis').slice(0, 60), {
      body: String(data.body || '').slice(0, 400),
      tag: String(data.tag || 'jarvis').slice(0, 40),
      icon: '/jarvis/icon-192.png',
      badge: '/jarvis/icon-192.png',
      data: { url: '/jarvis/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const aberto = list.find((c) => new URL(c.url).pathname.startsWith('/jarvis/'));
      if (aberto) return aberto.focus();
      return self.clients.openWindow('/jarvis/');
    })
  );
});
