/* eslint-disable no-undef */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

// vite-plugin-pwa (injectManifest) bu satırı derleme sırasında gerçek dosya listesiyle değiştirir.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Sunucudan gelen push mesajını göster. Ana ekrandan/uygulama kapalıyken bile tetiklenir.
self.addEventListener('push', (event) => {
  let data = { title: 'İSG Takip', body: 'Yeni bir bildiriminiz var.', url: '/' };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: data.url || '/' },
    tag: data.url || 'isg-bildirim',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Bildirime tıklanınca uygulamayı ilgili sayfada açar; zaten açık bir sekme varsa oraya odaklanıp yönlendirir.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          if ('focus' in client) await client.focus();
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
