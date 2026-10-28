/* ذِمّتي — Service Worker : يعمل بدون إنترنت */
const CACHE = 'dhimmati-v1';
const CORE = [
  './',
  './index.html',
  './jadwa.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // شبكة أولًا مع رجوع للكاش عند الانقطاع
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return r;
        })
        .catch(() =>
          caches.match(req).then((m) => m || caches.match('./index.html'))
        )
    );
  } else {
    // كاش أولًا ثم شبكة (تحديث بالخلفية)
    e.respondWith(
      caches.match(req).then(
        (m) =>
          m ||
          fetch(req)
            .then((r) => {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
              return r;
            })
            .catch(() => m || new Response('', { status: 504, statusText: 'offline' }))
      )
    );
  }
});
