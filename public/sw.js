// Bump CACHE_NAME whenever ASSETS changes — activate() purges old caches.
const CACHE_NAME = 'hfc-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/adaptive.css',
  '/css/modes.css',
  '/js/app.js',
  '/js/engines/signal-detection.js',
  '/js/engines/intervention-router.js',
  '/js/engines/memory-recall.js',
  '/js/engines/task-list.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate: serve cache instantly (the app must appear NOW),
// but always refetch in the background so the next load gets the latest code.
// Cache-first with a static cache name would freeze users on their first-ever
// version forever — fatal for an app that ships improvements.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request)
          .then(res => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
