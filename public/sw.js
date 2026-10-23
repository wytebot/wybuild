/* WyBuild offline-first application shell. Network-only actions (auth, billing, builds, APIs) remain network-only. */
const VERSION = 'wybuild-pwa-v3';
const SHELL = VERSION + '-shell';
const ASSETS = VERSION + '-assets';
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(SHELL);
  await Promise.all(PRECACHE.map(async path => { try { const r = await fetch(new Request(path, {cache:'reload'})); if (r.ok && !r.redirected) await cache.put(path, r); } catch (_) {} }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys(); await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))); await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
const timeout = ms => new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), ms));
async function navigation(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([fetch(request), timeout(3500)]);
    if (response && response.ok && !response.redirected) { cache.put(request, response.clone()).catch(() => {}); }
    if (response && response.ok) return response;
    return (await cache.match(request)) || (await cache.match('/')) || response;
  } catch (_) {
    // Use the cached app shell for deep links too, so the app UI stays open offline.
    return (await cache.match(request)) || (await cache.match('/')) || new Response('WyBuild is starting offline. Reopen the app after it has loaded once online.', {status: 503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
async function staticAsset(request) {
  const cached = await caches.match(request); if (cached) return cached;
  try { const response = await fetch(request); if (response && response.ok) (await caches.open(ASSETS)).put(request, response.clone()).catch(() => {}); return response && response.ok ? response : (cached || response || Response.error()); }
  catch (e) { return cached || Response.error(); }
}
async function revalidate(request) {
  const cache = await caches.open(SHELL), cached = await cache.match(request);
  const fresh = fetch(request).then(r => { if (r && r.ok) cache.put(request, r.clone()).catch(() => {}); return r; }).catch(() => cached);
  return cached || fresh;
}
self.addEventListener('fetch', event => {
  const req = event.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;
  if (req.mode === 'navigate') { event.respondWith(navigation(req)); return; }
  // Cache Vite bundles and same-origin app scripts/styles/fonts so the UI can boot offline.
  if (/\.(?:js|mjs|css|html|json|png|jpe?g|svg|ico|webmanifest|woff2?|ttf|wasm)$/.test(url.pathname)) { event.respondWith(staticAsset(req)); return; }
});
