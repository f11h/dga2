const CACHE = 'bitte-aergern-controller-v1';
const SHELL = ['./', './index.html', './controller.css', './controller.js', './manifest.webmanifest', './icon.svg', '../network.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bitte-aergern-controller-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const known = SHELL.map(path => new URL(path, self.location.href).pathname);
  if (!known.includes(url.pathname)) return;
  // Only the static controller shell is cached: never rooms, tokens, websocket traffic or game state.
  const key = new Request(url.origin + url.pathname);
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy))); }
    return response;
  }).catch(() => caches.match(key).then(cached => cached || Response.error())));
});
