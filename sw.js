// Service worker FOOT LETTERS : démarrage rapide et jeu disponible même avec une connexion faible.
const CACHE = 'footletter-v1015';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/version.json' || url.pathname === '/diag') return;
  // Page : réseau d'abord (toujours la dernière version), copie locale si hors ligne
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    const home = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(home ? '/index.html' : req, c)); return r; })
      .catch(() => caches.match(home ? '/index.html' : req).then((m) => m || caches.match('/index.html'))));
    return;
  }
  // Icônes et fichiers fixes : copie locale d'abord
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })));
});
