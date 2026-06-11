// RYTHM Service Worker
const CACHE_NAME = 'rythm-v172';
const PRECACHE = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon.svg'];

self.addEventListener('install', e => {
  // Always activate immediately — don't wait for old tabs to close
  self.skipWaiting();
  // Precache the BARE urls (no ?v= suffix). The browser requests "index.html"
  // without a query, so storing "index.html?v=..." made every offline cache.match
  // miss. Bare keys mean the precache is actually usable offline.
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
    // NOTE: we deliberately do NOT navigate/reload tabs here. The page listens for
    // 'controllerchange' and reloads itself exactly once. Reloading from the SW too
    // caused 2-3 stacked reloads per update that interrupted the user mid-interaction.
  );
});

// Allow the page to fast-track a waiting SW.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
      // Offline — try cache, then fall back to the cached app shell for navigations
      return caches.match(e.request).then(r =>
        r || caches.match('index.html') || new Response('Offline', { status: 503 })
      );
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

// Click handler — focus or open app. Match by origin (not a "rythm" substring,
// which fails on custom domains / random Netlify subdomains).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});
