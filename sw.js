/* Hostel Manager - offline cache */
const CACHE = 'hostel-manager-v7';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './vendor/supabase.js',
  './icon-192.png',
  './icon-512.png'
];

/* The cloud API must never be cached: those responses are private data and a
   stale row would be shown as if it were the cloud copy. */
function isCloudRequest(url) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)supabase\.(co|in)$/i.test(host);
  } catch (e) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  // Do not take over mid-session; the page asks for SKIP_WAITING when it is safe.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Auth, REST and storage calls go straight to the network, untouched by us.
  if (isCloudRequest(req.url)) return;

  // Pages: try the network so updates arrive, fall back to the cached app.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // Everything else: cache first, then network.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        try {
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
        } catch (e) { /* ignore */ }
        return res;
      }).catch(() => hit);
    })
  );
});
