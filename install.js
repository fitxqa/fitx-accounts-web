/* FitX Accounts — install from the browser.
   On the web version: makes the app installable (home screen / desktop app), works offline,
   and offers the Android APK download. Does nothing inside the Android app itself. */
(function () {
  'use strict';
  const inApk = !!window.AndroidBridge || /androidplatform\.net$/.test(location.hostname);
  if (inApk || !/^https?:$/.test(location.protocol)) return;

  const APK = 'download/FitX-Accounts.apk';
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let deferred = null;

  if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); if (window.toast) toast('FitX Accounts installed'); });

  const css = document.createElement('style');
  css.textContent = `
    .fx-inst{margin-top:16px;display:grid;gap:8px}
    .fx-inst .btn{width:100%;justify-content:center;text-decoration:none;color:var(--text,#2b2c30)}
    .fx-inst small{display:block;text-align:center;color:var(--muted,#6b6e76);font-size:12px}
    .fx-steps{margin:0;padding-left:20px;line-height:1.7}
    .fx-steps b{color:var(--text,#2b2c30)}`;
  document.head.appendChild(css);

  const icDl = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  const icApp = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>';

  function installApp() {
    if (deferred) {
      const d = deferred; deferred = null;
      d.prompt();
      (d.userChoice || Promise.resolve({})).then(c => { if (c && c.outcome === 'accepted' && window.toast) toast('Installing FitX Accounts…'); refresh(); });
      return;
    }
    const steps = isIOS
      ? `<ol class="fx-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
      : isAndroid
        ? `<ol class="fx-steps"><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="hint" style="margin-top:12px">Or download the full Android app (APK) below.</p>`
        : `<ol class="fx-steps"><li>Use <b>Chrome</b> or <b>Edge</b>.</li><li>Click the <b>install icon</b> at the right end of the address bar, or open the <b>⋮</b> menu → <b>Cast, save and share</b> → <b>Install page as app</b>.</li></ol>`;
    const html = `${steps}${isIOS ? '' : `<a class="btn full" href="${APK}" download style="margin-top:14px">${icDl}Download Android app (APK)</a>`}<p class="hint" style="margin-top:12px">The installed app opens in its own window with the FitX icon, and syncs with your phone and computer.</p>`;
    if (window.openSheet && !document.querySelector('.cl-wrap')) openSheet('Install FitX Accounts', html);
    else alertBox(html);
  }
  // simple overlay for the sign-in screen (the normal sheets sit under it)
  function alertBox(html) {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px';
    o.innerHTML = `<div class="card" style="max-width:440px;width:100%;margin:0;padding:18px"><h3 style="margin:0 0 10px">Install FitX Accounts</h3>${html}<button type="button" class="btn full" style="margin-top:10px">Close</button></div>`;
    o.onclick = e => { if (e.target === o || e.target.matches('button:last-child')) o.remove(); };
    document.body.appendChild(o);
  }

  function boxHTML() {
    const parts = [];
    if (!standalone()) parts.push(`<button type="button" class="btn fx-app">${icApp}Install app on this device</button>`);
    if (!isIOS) parts.push(`<a class="btn fx-apk" href="${APK}" download>${icDl}Download Android app (APK)</a>`);
    if (!parts.length) return '';
    return parts.join('') + `<small>${isIOS ? 'Adds FitX to your home screen' : 'Install from the browser, or get the Android app'}</small>`;
  }
  function bindBox(el) { const b = el.querySelector('.fx-app'); if (b) b.onclick = installApp; }

  // sign-in screen
  function addToLogin() {
    const box = document.querySelector('.cl-wrap .cl-box');
    if (!box || box.querySelector('.fx-inst')) return;
    const h = boxHTML(); if (!h) return;
    const d = document.createElement('div'); d.className = 'fx-inst'; d.innerHTML = h; box.appendChild(d); bindBox(d);
  }
  new MutationObserver(addToLogin).observe(document.body, {childList: true, subtree: true});
  addToLogin();

  // menu rows
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling; if (!list) return;
    let rows = '';
    if (!standalone()) rows += `<button type="button" class="item rcard" id="mInstall"><span class="ic">${icApp}</span><div class="main"><div class="t">Install app</div><div class="s">${isIOS ? 'Add FitX Accounts to your home screen' : 'Install on this phone or computer – opens like an app'}</div></div></button>`;
    if (!isIOS) rows += `<a class="item rcard" id="mApk" href="${APK}" download style="text-decoration:none;color:inherit"><span class="ic">${icDl}</span><div class="main"><div class="t">Download Android app</div><div class="s">FitX Accounts APK for Android phones</div></div></a>`;
    list.insertAdjacentHTML('beforeend', rows);
    const b = document.getElementById('mInstall'); if (b) b.onclick = installApp;
  };
  function refresh() {
    document.querySelectorAll('.fx-inst').forEach(x => x.remove()); addToLogin();
    if (typeof state !== 'undefined' && state.tab === 'more' && typeof render === 'function' && !document.querySelector('.cl-wrap')) render();
  }
  window.FitxInstall = {installApp, standalone};
})();
