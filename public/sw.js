/**
 * public/sw.js
 * Service worker voor de statische onderdelen van de app (PWA).
 *
 * Belangrijk: /api-aanvragen worden NOOIT gecacht. Leads en analyses moeten
 * altijd vers van de server komen, anders zie je verouderde of verkeerde data.
 *
 * Strategie:
 *   - Navigatie (HTML): network-first, zodat je altijd de nieuwste versie krijgt.
 *   - Statische bestanden (css/js/png/svg/manifest): cache-first met update op
 *     de achtergrond.
 */
const VERSION = 'leadpilot-v1';
const STATIC_CACHE = `${VERSION}-static`;

const SHELL = ['/', '/index.html', '/css/styles.css', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticRequest(url) {
  return (
    url.origin === self.location.origin &&
    (/\.(css|js|mjs|png|jpg|jpeg|svg|webp|woff2?|json|webmanifest)$/i.test(url.pathname) ||
      url.pathname.startsWith('/icons/'))
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nooit de API cachen.
  if (url.pathname.startsWith('/api/')) return;

  // Alleen GET, en alleen ons eigen domein.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // HTML: altijd eerst netwerk.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (!isStaticRequest(url)) return;

  // Statische bestanden: uit cache, en op de achtergrond verversen.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })
  );
});
