/* FitX Accounts — service worker for the installed web app.
   Same-site files: network first (so updates arrive at once), cached copy when offline.
   Firebase / Google requests are not touched. */
const CACHE = 'fitx-accounts-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './firebase-config.js', './treadmill-data.js', './catalog.js', './ledger.js', './payroll.js', './install.js', './cloud.js',
  './vendor/firebase-app-compat.js', './vendor/firebase-auth-compat.js', './vendor/firebase-firestore-compat.js', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || /\.apk$/i.test(u.pathname)) return;
  e.respondWith(fetch(r).then(res => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, {ignoreSearch: true}).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
