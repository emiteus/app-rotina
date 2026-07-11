// App Rotina — Service Worker (Web Push + PWA offline básico)
const CACHE = 'app-rotina-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Push recebido do servidor
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'App Rotina', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'App Rotina';
  const options = {
    body: data.body || '',
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: { url: data.url || '/' },
    tag: data.tag || 'app-rotina',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação — abre/foca a janela do app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
