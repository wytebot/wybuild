/* WyBuild service worker.
 * Goals: installable app, offline shell, and NEVER a stale deploy.
 *  - pages (navigations): network first, cached copy only when offline
 *  - /assets/* (Vite content-hashed files): cache first, they never change under the same name
 *  - icons / manifest: stale-while-revalidate
 *  - /api/* and anything cross-origin: not touched at all (sign-in redirects, builds and billing must hit the network)
 * Bump VERSION to drop every cache on the next visit. */
const VERSION = 'wybuild-pwa-v1';
const SHELL = VERSION + '-shell';
const ASSETS = VERSION + '-assets';
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function pageRequest(request) {
  try {
    const response = await Promise.race([fetch(request), timeout(8000)]);
    // a redirected response cannot be replayed for a navigation, so it is never stored
    if (response && response.ok && !response.redirected) {
      const copy = response.clone();
      caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (e) {
    return (await caches.match(request)) || (await caches.match('/')) || (await caches.match('/offline.html')) || Response.error();
  }
}

async function assetRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;
  if (request.mode === 'navigate') return void event.respondWith(pageRequest(request));
  if (url.pathname.startsWith('/assets/')) return void event.respondWith(assetRequest(request));
  if (/\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) return void event.respondWith(staleWhileRevalidate(request));
});
