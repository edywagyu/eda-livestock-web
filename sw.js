/* ============================================================
   EDA-LIVESTOCK Service Worker
   - Strategy: stale-while-revalidate for HTML, cache-first for assets
   - Version bump invalidates old cache
   ============================================================ */
const CACHE_VERSION = 'eda-v2026-05-15-002-numeric';
const CORE_ASSETS = [
  './',
  'index.html',
  'shop.html',
  'subscription.html',
  'product.html',
  'public/data/products-master.js',
  'public/js/eda-bundle.js',
  'public/css/a11y.css',
  'public/css/jp-typography.css',
  'public/css/mobile-modern.css',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* 外部リクエスト (Stripe / Google Fonts) は pass-through */
  if (url.origin !== location.origin) {
    /* Google Fonts は cache-first */
    if (url.host.includes('fonts.gstatic.com') || url.host.includes('fonts.googleapis.com')) {
      event.respondWith(
        caches.match(req).then((cached) =>
          cached || fetch(req).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
            return res;
          }).catch(() => cached)
        )
      );
    }
    return;
  }

  /* HTML: stale-while-revalidate */
  if (req.destination === 'document' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* 画像・CSS・JS: cache-first */
  event.respondWith(
    caches.match(req).then((cached) => {
      return cached || fetch(req).then((res) => {
        if (res.ok && (req.destination === 'image' || req.destination === 'style' || req.destination === 'script' || req.destination === 'font')) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return res;
      });
    })
  );
});
