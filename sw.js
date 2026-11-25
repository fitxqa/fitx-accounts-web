/* FitX Accounts — service worker for the installed web app.
   Same-site files: network first (so updates arrive at once), saved copy when offline or when the network is slow (3 s).
   Firebase / Google requests are not touched. */
const CACHE = 'fitx-accounts-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './firebase-config.js', './treadmill-data.js', './catalog.js', './ledger.js', './payroll.js', './install.js', './cloud.js',
  './vendor/firebase-app-compat.js', './vendor/firebase-auth-compat.js', './vendor/firebase-firestore-compat.js', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first with a time limit: if the network has not answered within 3 s (slow / patchy signal) the saved copy is
// used at once, and the fresh copy still finishes downloading in the background for the next open.
const TIMEOUT = 3000;
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || /\.apk$/i.test(u.pathname)) return;
  const net = fetch(r, {cache: 'no-cache'}).then(res => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  });
  const saved = () => caches.match(r, {ignoreSearch: true}).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined));
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = res => { if (!done && res) { done = true; resolve(res); } };
    const t = setTimeout(() => saved().then(m => { if (m) finish(m); }), TIMEOUT);
    net.then(res => { clearTimeout(t); finish(res); })
      .catch(() => { clearTimeout(t); saved().then(m => { if (m) finish(m); else if (!done) { done = true; resolve(Response.error()); } }); });
  }));
});
