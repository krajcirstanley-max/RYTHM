// RYTHM Service Worker
const CACHE_NAME = 'rythm-v8';
const PRECACHE = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});

// Push notification handler
self.addEventListener('push', e => {
  let data = { title: 'RYTHM', body: 'Check your energy', tag: 'rythm-push' };
  if (e.data) {
    try { data = e.data.json(); } catch (_) {
      data.body = e.data.text();
    }
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'RYTHM', {
      body: data.body,
      tag: data.tag || 'rythm-push',
      icon: data.icon || undefined,
      badge: data.badge || undefined,
      data: data.data || {},
      silent: false
    })
  );
});

// Click handler — focus or open app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('rythm') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./rythm.html');
    })
  );
});
