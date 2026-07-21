const CACHE_NAME = 'hfc-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/adaptive.css',
  '/css/modes.css',
  '/js/app.js',
  '/js/engines/signal-detection.js',
  '/js/engines/intervention-router.js',
  '/js/engines/memory-recall.js'
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

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
