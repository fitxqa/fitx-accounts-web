/* FitX Accounts — direct Google Drive backup.
   A tiny Google Apps Script (deployed once from the owner's Google account, e.g. fitxqa@gmail.com) receives the backup
   and saves it straight into a Drive folder (default "FitX Backups"). No Drive app, no share menu.
   The app can also back up automatically once a day, list the backups and restore one.
   Settings: S().gdrive = {url, key, folder, auto, keep, last} */
(function () {
  'use strict';
  const G = () => { const s = S(); if (!s.gdrive) s.gdrive = {}; return s.gdrive; };
  const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  const cloudBlocked = () => window.FitxCloud && FitxCloud.cid && FitxCloud.role === 'technician';

  function script(key, folder, keep) {
    return `/* FitX Accounts – Google Drive backup (paste into script.google.com, then Deploy → Web app) */
const KEY = '${key}';          // must match the app – keep it secret
const FOLDER = '${String(folder || 'FitX Backups').replace(/'/g, '')}'; // Drive folder path, e.g. 'FitX/Backups'
const KEEP = ${Math.max(5, +keep || 90)};              // keep the newest backups, delete older ones

function folder_() {
  let f = DriveApp.getRootFolder();
  FOLDER.split('/').map(s => s.trim()).filter(String).forEach(name => {
    const it = f.getFoldersByName(name);
    f = it.hasNext() ? it.next() : f.createFolder(name);
  });
  return f;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function files_(f) {
  const list = [], it = f.getFiles();
  while (it.hasNext()) { const x = it.next(); if (/\\.json$/i.test(x.getName())) list.push(x); }
  return list.sort((a, b) => b.getDateCreated() - a.getDateCreated());
}
function doGet() { return out_({ok: true, app: 'FitX backup', folder: FOLDER}); }
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.key !== KEY) return out_({ok: false, error: 'Wrong key – copy the script again from the app'});
    const f = folder_();
    if (b.action === 'test') return out_({ok: true, folder: f.getName(), url: f.getUrl(), email: Session.getEffectiveUser().getEmail()});
    if (b.action === 'list') return out_({ok: true, url: f.getUrl(), files: files_(f).slice(0, 60).map(x => ({id: x.getId(), name: x.getName(), date: x.getDateCreated().toISOString(), size: x.getSize()}))});
    if (b.action === 'get') {
      const x = DriveApp.getFileById(b.id);
      const p = x.getParents(); let ok = false; while (p.hasNext()) if (p.next().getId() === f.getId()) ok = true;
      if (!ok) return out_({ok: false, error: 'Not a FitX backup'});
      return out_({ok: true, name: x.getName(), data: x.getBlob().getDataAsString()});
    }
    const file = f.createFile(String(b.name || 'FitX-backup.json').replace(/[\\\\/]/g, '-'), b.data, 'application/json');
    files_(f).slice(KEEP).forEach(x => x.setTrashed(true));
    return out_({ok: true, id: file.getId(), url: file.getUrl(), folder: f.getUrl(), size: file.getSize()});
  } catch (err) { return out_({ok: false, error: String(err)}); }
}
`;
  }

  async function call(body, url) {
    const g = G();
    const r = await fetch(url || g.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({key: g.key}, body)), redirect: 'follow'});
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch (e) { throw new Error(/<html/i.test(t) ? 'Google returned a web page – check the Web app is deployed with access “Anyone”' : 'Unexpected answer from Google'); }
    if (!j.ok) throw new Error(j.error || 'Google Drive error');
    return j;
  }
  const fname = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `FitX-Accounts-backup-${today()}_${p(d.getHours())}${p(d.getMinutes())}.json`; };

  async function backupNow(silent) {
    const g = G();
    if (!g.url || !g.key) { setup(); return false; }
    if (!silent) toast('Uploading backup to Google Drive…');
    try {
      const r = await call({action: 'save', name: fname(), data: backupJSON()});
      g.last = new Date().toISOString(); g.lastUrl = r.folder || g.lastUrl; save();
      try { localStorage.setItem(KEY + '_lastBackup', today()); } catch (e) {}
      toast(silent ? 'Daily backup saved to Google Drive' : 'Backup saved to Google Drive ✓');
      return true;
    } catch (e) { if (!silent) alert('Google Drive backup failed:\n' + e.message); else console.warn('auto backup', e); return false; }
  }

  function setup() {
    const g = G(); if (!g.key) { g.key = newKey(); save(); }
    openSheet('Google Drive – direct backup', `
      <p class="hint" style="margin-top:0">One-time setup (5 minutes) on a computer, signed in to Google as <b>fitxqa@gmail.com</b>. After that every backup goes straight into your Drive folder.</p>
      <label class="f"><span>Drive folder</span><input class="in" id="gdFolder" value="${esc(g.folder || 'FitX Backups')}" placeholder="FitX Backups or FitX/Backups"></label>
      <div class="card" style="font-size:13.5px;line-height:1.55">
        <b>1.</b> Open <b>script.google.com</b> → <b>New project</b>.<br>
        <b>2.</b> Delete the sample code and paste the FitX script: <button type="button" class="btn" id="gdCopy" style="min-height:36px;margin:4px 0">Copy script</button><br>
        <b>3.</b> Tap <b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Tap <b>Deploy</b>.<br>
        <b>4.</b> Allow access to your Drive (if Google says “not verified”, tap <b>Advanced → Go to project</b>).<br>
        <b>5.</b> Copy the <b>Web app URL</b> and paste it below.
      </div>
      <label class="f"><span>Web app URL</span><input class="in" id="gdUrl" value="${esc(g.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="none" spellcheck="false"></label>
      <label style="display:flex;gap:10px;align-items:center;margin:4px 2px 12px"><input type="checkbox" id="gdAuto" ${g.auto !== false ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--orange)"><span>Back up automatically once a day</span></label>
      <div class="cl-err" id="gdErr" role="alert" style="color:var(--red);font-weight:600"></div>
      <button type="button" class="btn pri full" id="gdTest">Test &amp; save</button>
      <p class="hint" style="margin-top:10px">Changing the folder? Copy the script again, paste it over the old code and choose <b>Deploy → Manage deployments → Edit → New version</b>.</p>`, el => {
      el.querySelector('#gdCopy').onclick = async () => {
        const txt = script(g.key, el.querySelector('#gdFolder').value.trim(), g.keep);
        try { await navigator.clipboard.writeText(txt); toast('Script copied – paste it in script.google.com'); }
        catch (e) { openSheet('FitX script', `<textarea class="in" rows="16" readonly style="font-family:ui-monospace,monospace;font-size:11px">${esc(txt)}</textarea><p class="hint">Select all and copy.</p>`); }
      };
      el.querySelector('#gdTest').onclick = async ev => {
        const url = el.querySelector('#gdUrl').value.trim(), er = el.querySelector('#gdErr');
        er.textContent = '';
        if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { er.textContent = 'Paste the Web app URL that starts with https://script.google.com/'; return; }
        ev.target.disabled = true; ev.target.textContent = 'Testing…';
        try {
          const r = await call({action: 'test'}, url);
          Object.assign(g, {url, folder: el.querySelector('#gdFolder').value.trim() || 'FitX Backups', auto: el.querySelector('#gdAuto').checked, lastUrl: r.url}); save();
          closeSheet(() => { toast('Connected to Google Drive' + (r.email ? ' (' + r.email + ')' : '') + ' · folder ' + r.folder); if (confirm('Connected! Make the first backup now?')) backupNow(); });
        } catch (e) { er.textContent = e.message === 'Failed to fetch' ? 'Could not reach Google – check the URL and that access is “Anyone”.' : e.message; ev.target.disabled = false; ev.target.textContent = 'Test & save'; }
      };
    });
  }

  async function restoreList() {
    const g = G(); if (!g.url) { setup(); return; }
    const sh = openSheet('Restore from Google Drive', `<div id="gdList"><div class="list"><div class="empty">Loading backups…</div></div></div>`);
    try {
      const r = await call({action: 'list'});
      const box = (sh || document).querySelector('#gdList'); if (!box) return;
      box.innerHTML = r.files.length ? `<p class="hint" style="margin-top:0">Newest first. Restoring replaces all data${window.FitxCloud && FitxCloud.cid ? ' – also in the cloud for everyone' : ' on this device'}.</p><div class="list">${r.files.map(f => `<button type="button" class="item" data-gf="${esc(f.id)}"><div class="main"><div class="t">${esc(f.name)}</div><div class="s">${new Date(f.date).toLocaleString()} · ${Math.round(f.size / 1024)} KB</div></div><span class="hint">Restore ›</span></button>`).join('')}</div>` : '<div class="list"><div class="empty">No backups in the folder yet.</div></div>';
      box.querySelectorAll('[data-gf]').forEach(b => b.onclick = async () => {
        try {
          toast('Downloading…');
          const x = await call({action: 'get', id: b.dataset.gf});
          const d = JSON.parse(x.data);
          if (!d || !Array.isArray(d.docs) || !Array.isArray(d.customers)) throw new Error('Not a FitX Accounts backup');
          if (!confirm(`Restore “${x.name}”?\n${d.customers.length} customers · ${d.docs.length} invoices/quotes.\n\nCurrent data will be replaced.`)) return;
          if (prompt('Type RESTORE to confirm') !== 'RESTORE') return;
          delete d.app; delete d.version; delete d.exported;
          localStorage.setItem(KEY, JSON.stringify(d)); load(); save();
          while (sheets.length) closeTopSheet(); render(); toast('Backup restored');
        } catch (e) { alert('Could not restore: ' + e.message); }
      });
    } catch (e) { const box = document.querySelector('#gdList'); if (box) box.innerHTML = `<div class="list"><div class="empty">${esc(e.message)}</div></div>`; }
  }

  /* add to Menu → Backup & restore */
  const origBackup = window.viewBackup;
  window.viewBackup = function () {
    origBackup.apply(this, arguments);
    const el = sheets[sheets.length - 1]; if (!el) return;
    const g = G(), btn = el.querySelector('#bDrive'); if (!btn) return;
    const card = btn.closest('.card');
    const on = !!(g.url && g.key);
    card.querySelector('.hint').innerHTML = on
      ? `Saves everything straight into your Google Drive folder <b>${esc(g.folder || 'FitX Backups')}</b>${g.auto !== false ? ' – and automatically once a day' : ''}.`
      : 'Set up once and every backup goes straight into a Google Drive folder (e.g. “FitX Backups” in fitxqa@gmail.com) – no Drive app or share menu. Until then the Drive app opens.';
    const last = g.last ? new Date(g.last).toLocaleString() : '';
    btn.insertAdjacentHTML('beforebegin', on && last ? `<p class="hint">Last Google Drive backup: <b style="color:var(--text)">${esc(last)}</b>${g.lastUrl ? ` · <a href="${esc(g.lastUrl)}" target="_blank" rel="noopener">open folder</a>` : ''}</p>` : '');
    btn.onclick = () => on ? backupNow() : backupToDrive();
    btn.insertAdjacentHTML('afterend', `<div class="btns" style="margin-top:8px"><button type="button" class="btn" id="gdSet">${on ? 'Google Drive settings' : '⚡ Set up direct Google Drive backup'}</button>${on ? '<button type="button" class="btn" id="gdRes">Restore from Google Drive</button>' : ''}</div>`);
    el.querySelector('#gdSet').onclick = setup;
    const rs = el.querySelector('#gdRes'); if (rs) rs.onclick = restoreList;
  };

  /* automatic daily backup (one device per day is enough – the date is shared through the cloud settings) */
  function auto() {
    const g = G();
    if (!g.url || !g.key || g.auto === false || cloudBlocked()) return;
    if (g.last && g.last.slice(0, 10) === new Date().toISOString().slice(0, 10)) return;
    if (!db.docs.length && !db.customers.length) return;
    backupNow(true);
  }
  setTimeout(auto, 20000);
  setInterval(auto, 60 * 60 * 1000);
  window.FitxDrive = {setup, backupNow, restoreList, script};
})();
