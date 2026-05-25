// RYTHM Service Worker
const CACHE_NAME = 'rythm-v81';
const PRECACHE = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon.svg'];

self.addEventListener('install', e => {
  // Always activate immediately — don't wait for old tabs to close
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE.map(u => u + '?v=' + CACHE_NAME)))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => clients.claim())
    // Force all open tabs to reload with new version
    .then(() => clients.matchAll({ type: 'window' }))
    .then(tabs => tabs.forEach(tab => tab.navigate(tab.url)))
  );
});

// Network-first: always try fresh, cache as fallback for offline only
self.addEventListener('fetch', e => {
  // Skip non-GET and cross-origin
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request).then(resp => {
      // Cache a fresh copy for offline use
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => {
      // Offline — try cache
      return caches.match(e.request).then(r => r || new Response('Offline', { status: 503 }));
    })
  );
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
      return clients.openWindow('./index.html');
    })
  );
});
