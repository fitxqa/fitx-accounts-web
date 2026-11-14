/* FitX Accounts — security:
   1. Admin check: erase all data / restore a backup need the owner's password (cloud) or the admin PIN (this device).
   2. App lock: PIN or password (+ fingerprint / face on the phone app) to open the app; locks again after a chosen time.
   3. Password vault: bank logins, email, Bluehost, Firebase, WiFi… encrypted with a master password (AES-256-GCM, PBKDF2).
      Only the encrypted blob is stored (S().vault) – it syncs to the cloud but nobody can read it without the master password. */
(function () {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  async function pbkdf2(pw, salt, iter, usage) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
    if (usage === 'bits') return b64(await crypto.subtle.deriveBits({name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256'}, base, 256));
    return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }
  const hashPw = async (pw, saltB64) => pbkdf2(pw, unb64(saltB64), 150000, 'bits');
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const LOCK = 'fitx_lock_v1';
  const L = () => lsGet(LOCK, {});
  const cloudOn = () => window.FitxCloud && FitxCloud.cid && FitxCloud.user;
  const bioOk = () => { try { return !!(window.AndroidBridge && AndroidBridge.biometricAvailable && AndroidBridge.biometricAvailable()); } catch (e) { return false; } };

  const css = document.createElement('style');
  css.textContent = `
    #lockScreen{position:fixed;inset:0;z-index:100000;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:24px}
    #lockScreen .lk{width:100%;max-width:340px;text-align:center}
    #lockScreen .lk-logo{font:900 34px/1 Montserrat,system-ui,sans-serif;letter-spacing:-1px;margin-bottom:6px}
    #lockScreen .lk-logo b{color:var(--orange)}
    #lockScreen input{text-align:center;font-size:22px;letter-spacing:6px;margin:18px 0 10px}
    #lockScreen .err{color:var(--red);font-weight:600;min-height:20px;font-size:13px}
    .vrow{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
    .vrow:last-child{border-bottom:0}
    .vrow .k{flex:0 0 86px;color:var(--muted);font-size:12.5px}
    .vrow .v{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}
    .vrow .v.pw{font-family:ui-monospace,Menlo,monospace;letter-spacing:1px}
    .vstr{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin:-4px 0 12px}
    .vstr i{display:block;height:100%}`;
  document.head.appendChild(css);

  /* ---------- password sheet helper ---------- */
  function askSecret(title, text, opts) {
    opts = opts || {};
    return new Promise(res => {
      let done = false;
      const fin = v => { if (done) return; done = true; res(v); };
      openSheet(title, `<form id="asForm" autocomplete="off"><p class="hint" style="margin-top:0">${text}</p>
        <input type="text" name="u" autocomplete="username" value="${esc(opts.user || '')}" hidden>
        <label class="f"><span>${esc(opts.label || 'Password')}</span><input class="in" type="password" name="pw" autocomplete="current-password" ${opts.numeric ? 'inputmode="numeric"' : ''} required autofocus></label>
        <div class="cl-err" id="asErr" role="alert" style="color:var(--red);font-weight:600"></div>
        <button class="btn pri full" type="submit">${esc(opts.ok || 'Confirm')}</button></form>`, el => {
        const f = el.querySelector('#asForm'), er = el.querySelector('#asErr');
        setTimeout(() => { try { f.pw.focus(); } catch (e) {} }, 150);
        f.onsubmit = async ev => {
          ev.preventDefault(); const btn = f.querySelector('[type=submit]'); btn.disabled = true; er.textContent = '';
          try { const r = await opts.check(f.pw.value); if (r === true) { closeSheet(() => fin(true)); return; } er.textContent = r || 'Wrong password.'; }
          catch (e) { er.textContent = e.message || 'Wrong password.'; }
          btn.disabled = false; f.pw.select();
        };
        // closing the sheet = cancel
        const mo = new MutationObserver(() => { if (!document.body.contains(el)) { mo.disconnect(); fin(false); } });
        mo.observe(document.body, {childList: true, subtree: true});
      });
    });
  }

  /* ---------- 1. admin check ---------- */
  async function requireAdmin(what) {
    if (cloudOn()) {
      if (FitxCloud.role !== 'owner') { alert('Only the owner can ' + what.toLowerCase() + '.'); return false; }
      const u = FitxCloud.user;
      return askSecret('Owner password', `To <b>${esc(what.toLowerCase())}</b>, type the owner password for <b>${esc(u.email)}</b>.`, {user: u.email, ok: 'Continue', check: async pw => {
        try { await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, pw)); return true; }
        catch (e) { return /too-many/.test(e.code || '') ? 'Too many tries – wait a few minutes.' : /network/.test(e.code || '') ? 'No internet – try again.' : 'Wrong password.'; }
      }});
    }
    const l = L();
    if (!l.hash) {
      alert('For safety, set an admin PIN first (Menu → Security & app lock). It is then needed to ' + what.toLowerCase() + '.');
      lockSettings(); return false;
    }
    return askSecret('Admin ' + (l.kind === 'pin' ? 'PIN' : 'password'), `To <b>${esc(what.toLowerCase())}</b>, enter the admin ${l.kind === 'pin' ? 'PIN' : 'password'} of this device.`, {numeric: l.kind === 'pin', label: l.kind === 'pin' ? 'PIN' : 'Password', ok: 'Continue', check: async pw => (await hashPw(pw, l.salt)) === l.hash || 'Wrong ' + (l.kind === 'pin' ? 'PIN' : 'password') + '.'});
  }

  // guard Erase / Restore on the Backup screen (and Restore from Google Drive)
  const origBackup = window.viewBackup;
  window.viewBackup = function () {
    origBackup.apply(this, arguments);
    const el = sheets[sheets.length - 1]; if (!el) return;
    [['#bReset', 'Erase all data'], ['#bImp', 'Restore a backup'], ['#gdRes', 'Restore a backup']].forEach(([sel, what]) => {
      const b = el.querySelector(sel); if (!b || !b.onclick) return;
      const orig = b.onclick;
      b.onclick = async ev => { if (await requireAdmin(what)) orig.call(b, ev); };
    });
  };

  /* ---------- 2. app lock ---------- */
  let locked = false, hiddenAt = 0, fails = 0, waitUntil = 0;
  function showLock() {
    const l = L(); if (!l.on || !l.hash || locked) return;
    locked = true;
    const d = document.createElement('div'); d.id = 'lockScreen'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'App locked');
    const pin = l.kind === 'pin', bio = l.bio && bioOk();
    d.innerHTML = `<div class="lk"><div class="lk-logo">Fit<b>X</b></div><div class="hint">FitX Accounts is locked</div>
      <form id="lkForm" autocomplete="off"><input class="in" type="password" id="lkIn" ${pin ? 'inputmode="numeric" maxlength="8"' : ''} placeholder="${pin ? 'PIN' : 'Password'}" aria-label="${pin ? 'PIN' : 'Password'}" autocomplete="current-password">
      <div class="err" id="lkErr" role="alert"></div>
      <button class="btn pri full" type="submit">Unlock</button></form>
      ${bio ? '<button type="button" class="btn full" id="lkBio" style="margin-top:10px">Use fingerprint / face</button>' : ''}
      <button type="button" class="btn full" id="lkForgot" style="margin-top:10px;border:0;background:none;color:var(--muted)">Forgot ${pin ? 'PIN' : 'password'}?</button></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector('#lkIn'), er = d.querySelector('#lkErr');
    const open = () => { locked = false; fails = 0; d.remove(); };
    d.querySelector('#lkForm').onsubmit = async ev => {
      ev.preventDefault();
      if (Date.now() < waitUntil) { er.textContent = `Too many tries – wait ${Math.ceil((waitUntil - Date.now()) / 1000)} s`; return; }
      if ((await hashPw(inp.value, l.salt)) === l.hash) return open();
      fails++; inp.value = '';
      if (fails >= 5) { waitUntil = Date.now() + 30000 * Math.pow(2, Math.min(4, fails - 5)); er.textContent = 'Too many wrong tries – wait 30 seconds.'; }
      else er.textContent = 'Wrong ' + (pin ? 'PIN' : 'password');
    };
    if (pin) inp.addEventListener('input', async () => { if (inp.value.length >= (l.len || 4) && (await hashPw(inp.value, l.salt)) === l.hash) open(); });
    const runBio = () => { window.__fitxBio = ok => { if (ok) open(); }; try { AndroidBridge.biometric('Unlock FitX Accounts'); } catch (e) {} };
    if (bio) { d.querySelector('#lkBio').onclick = runBio; setTimeout(runBio, 300); } else setTimeout(() => inp.focus(), 200);
    d.querySelector('#lkForgot').onclick = async () => {
      const r = prompt('Type your recovery code (shown when the lock was set up)' + (cloudOn() ? ', or leave empty to use your sign-in password instead' : '') + ':');
      if (r === null) return;
      if (r.trim() && l.rec && (await hashPw(r.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), l.salt)) === l.rec) { lsSet(LOCK, null); open(); toast('App lock removed – set a new one in Menu → Security'); return; }
      if (!r.trim() && cloudOn()) {
        const pw = prompt('Sign-in password for ' + FitxCloud.user.email + ':'); if (!pw) return;
        try { await FitxCloud.user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(FitxCloud.user.email, pw)); lsSet(LOCK, null); open(); toast('App lock removed – set a new one in Menu → Security'); }
        catch (e) { er.textContent = 'Wrong password'; }
        return;
      }
      er.textContent = 'Recovery code not correct';
    };
  }
  // block everything (keyboard shortcuts too) while locked
  window.addEventListener('keydown', e => { if (!locked) return; const inLock = e.target && e.target.closest && e.target.closest('#lockScreen'); if (!inLock || e.ctrlKey || e.metaKey || e.altKey) { e.stopImmediatePropagation(); if (!inLock || e.key !== 'Enter') e.preventDefault(); } }, true);
  document.addEventListener('visibilitychange', () => {
    const l = L(); if (!l.on) return;
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= (num(l.after) || 0) * 60000) showLock();
  });
  setTimeout(showLock, 0);

  function lockSettings() {
    const l = L(), bio = bioOk();
    openSheet('Security & app lock', `
      <div class="card"><b>App lock</b><p class="hint">Ask for a PIN or password every time FitX Accounts is opened on <b>this device</b>. The same PIN is the admin PIN for erasing or restoring data${cloudOn() ? ' when not signed in' : ''}.</p>
        ${l.hash ? `<label style="display:flex;gap:10px;align-items:center;margin:8px 0"><input type="checkbox" id="lkOn" ${l.on ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--orange)"><span>Lock the app (${l.kind === 'pin' ? 'PIN' : 'password'} set)</span></label>
          ${bio ? `<label style="display:flex;gap:10px;align-items:center;margin:8px 0"><input type="checkbox" id="lkBioOn" ${l.bio ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--orange)"><span>Unlock with fingerprint / face</span></label>` : ''}
          <label class="f"><span>Lock again after the app was in the background for</span><select class="in" id="lkAfter">${[[0, 'Immediately'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour']].map(([v, t]) => `<option value="${v}" ${num(l.after) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <div class="btns"><button type="button" class="btn" id="lkChange">Change ${l.kind === 'pin' ? 'PIN' : 'password'}</button><button type="button" class="btn" id="lkNow">Lock now</button><button type="button" class="btn danger" id="lkOff">Remove lock</button></div>`
        : `<button type="button" class="btn pri full" id="lkSet">Set up PIN / password</button>`}
      </div>
      <div class="card"><b>Admin protection</b><p class="hint" style="margin:4px 0 0">${cloudOn() ? `<b>Erase all data</b> and <b>restore backup</b> need the owner's sign-in password (${esc(FitxCloud.user.email)}).` : '<b>Erase all data</b> and <b>restore backup</b> need the admin PIN above.'}</p></div>
      <div class="card"><b>Password vault</b><p class="hint" style="margin:4px 0 8px">Keep bank, email, Bluehost, Firebase and other passwords encrypted with a master password.</p><button type="button" class="btn full" id="lkVault">Open password vault</button></div>`, el => {
      const q = s => el.querySelector(s), upd = p => { lsSet(LOCK, Object.assign(L(), p)); };
      if (q('#lkSet')) q('#lkSet').onclick = () => closeSheet(() => setupLock());
      if (q('#lkOn')) q('#lkOn').onchange = e => { upd({on: e.target.checked}); toast(e.target.checked ? 'App lock on' : 'App lock off'); };
      if (q('#lkBioOn')) q('#lkBioOn').onchange = e => upd({bio: e.target.checked});
      if (q('#lkAfter')) q('#lkAfter').onchange = e => upd({after: num(e.target.value)});
      if (q('#lkNow')) q('#lkNow').onclick = () => { while (sheets.length) closeTopSheet(); upd({on: true}); showLock(); };
      if (q('#lkChange')) q('#lkChange').onclick = async () => { if (await askSecret('Current ' + (l.kind === 'pin' ? 'PIN' : 'password'), 'Enter the current one first.', {numeric: l.kind === 'pin', check: async pw => (await hashPw(pw, l.salt)) === l.hash || 'Wrong.'})) { closeTopSheet(); setupLock(); } };
      if (q('#lkOff')) q('#lkOff').onclick = async () => { if (await askSecret('Remove app lock', 'Enter the current ' + (l.kind === 'pin' ? 'PIN' : 'password') + '.', {numeric: l.kind === 'pin', check: async pw => (await hashPw(pw, l.salt)) === l.hash || 'Wrong.'})) { lsSet(LOCK, null); closeTopSheet(); toast('App lock removed'); } };
      q('#lkVault').onclick = () => vault();
    });
  }
  function setupLock() {
    openSheet('Set up app lock', `<form id="slForm" autocomplete="off">
      <div class="seg" id="slKind" style="margin-bottom:12px"><button type="button" data-k="pin" class="on">PIN (numbers)</button><button type="button" data-k="pw">Password</button></div>
      <label class="f"><span id="slLbl">New PIN (4–8 digits)</span><input class="in" type="password" name="a" inputmode="numeric" autocomplete="new-password" required></label>
      <label class="f"><span>Repeat</span><input class="in" type="password" name="b" inputmode="numeric" autocomplete="new-password" required></label>
      ${bioOk() ? '<label style="display:flex;gap:10px;align-items:center;margin:4px 0 12px"><input type="checkbox" name="bio" checked style="width:22px;height:22px;accent-color:var(--orange)"><span>Also unlock with fingerprint / face</span></label>' : ''}
      <div class="cl-err" id="slErr" role="alert" style="color:var(--red);font-weight:600"></div>
      <button class="btn pri full" type="submit">Save &amp; turn on lock</button></form>`, el => {
      let kind = 'pin'; const f = el.querySelector('#slForm');
      el.querySelectorAll('#slKind button').forEach(b => b.onclick = () => {
        kind = b.dataset.k; el.querySelectorAll('#slKind button').forEach(x => x.classList.toggle('on', x === b));
        el.querySelector('#slLbl').textContent = kind === 'pin' ? 'New PIN (4–8 digits)' : 'New password (at least 6 characters)';
        [f.a, f.b].forEach(i => kind === 'pin' ? i.setAttribute('inputmode', 'numeric') : i.removeAttribute('inputmode'));
      });
      f.onsubmit = async ev => {
        ev.preventDefault(); const er = el.querySelector('#slErr');
        const a = f.a.value, bb = f.b.value;
        if (kind === 'pin' && !/^\d{4,8}$/.test(a)) { er.textContent = 'PIN: 4 to 8 digits.'; return; }
        if (kind === 'pw' && a.length < 6) { er.textContent = 'Password: at least 6 characters.'; return; }
        if (a !== bb) { er.textContent = 'The two entries are different.'; return; }
        const salt = b64(rnd(16));
        const code = Array.from(rnd(8), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
        lsSet(LOCK, {on: true, kind, len: a.length, salt, hash: await hashPw(a, salt), rec: await hashPw(code, salt), bio: !!(f.bio && f.bio.checked), after: num(L().after) || 0});
        closeSheet(() => openSheet('Write down your recovery code', `<p>If you forget the ${kind === 'pin' ? 'PIN' : 'password'}, this code unlocks the app:</p>
          <div class="card" style="text-align:center;font:800 26px ui-monospace,monospace;letter-spacing:3px">${code.slice(0, 4)}-${code.slice(4)}</div>
          <p class="hint">Keep it somewhere safe (not on this phone). It is shown only now.</p><button type="button" class="btn pri full" id="rcOk">I wrote it down</button>`, e2 => { e2.querySelector('#rcOk').onclick = () => closeSheet(() => toast('App lock is on')); }));
      };
    });
  }

  /* ---------- 3. password vault ---------- */
  const VCATS = ['Bank', 'Email', 'Website / portal', 'Government', 'Supplier portal', 'WiFi', 'Device / alarm', 'Other'];
  let V = null, vKey = null, vTimer = 0;   // unlocked entries + key (memory only)
  const vLockSoon = () => { clearTimeout(vTimer); vTimer = setTimeout(vLock, 3 * 60000); };
  const vLock = () => { V = null; vKey = null; clearTimeout(vTimer); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) vLock(); });
  async function vEncrypt(list) {
    const st = S().vault; const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, vKey, enc.encode(JSON.stringify(list)));
    S().vault = {v: 1, salt: st.salt, iv: b64(iv), ct: b64(ct), n: list.length, at: new Date().toISOString()}; save();
  }
  async function vOpen(pw) {
    const st = S().vault; const key = await pbkdf2(pw, unb64(st.salt), 250000);
    const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(st.iv)}, key, unb64(st.ct));   // throws on wrong password
    vKey = key; V = JSON.parse(dec.decode(pt)); vLockSoon();
  }
  function vAllowed() {
    if (cloudOn() && FitxCloud.role !== 'owner') { alert('The password vault is for the owner only.'); return false; }
    return true;
  }
  async function vault() {
    if (!vAllowed()) return;
    if (!crypto || !crypto.subtle) { alert('This browser cannot encrypt – open the vault in the phone app.'); return; }
    if (V) return vList();
    if (!S().vault || !S().vault.ct) return vCreate();
    const ok = await askSecret('Password vault', `Enter your <b>master password</b>. ${S().vault.n || 0} saved entr${S().vault.n === 1 ? 'y' : 'ies'}.`, {label: 'Master password', ok: 'Unlock', check: async pw => { try { await vOpen(pw); return true; } catch (e) { return 'Wrong master password.'; } }});
    if (ok) vList();
  }
  function vCreate() {
    openSheet('Create password vault', `<form id="vcForm" autocomplete="off">
      <p class="hint" style="margin-top:0">Choose a <b>master password</b>. Every entry is encrypted with it on this device before it is saved or synced. <b style="color:var(--red)">Nobody can recover it if you forget it</b> – not even FitX or Claude.</p>
      <label class="f"><span>Master password (at least 8 characters)</span><input class="in" type="password" name="a" autocomplete="new-password" required></label>
      <div class="vstr"><i id="vcStr"></i></div>
      <label class="f"><span>Repeat</span><input class="in" type="password" name="b" autocomplete="new-password" required></label>
      <div class="cl-err" id="vcErr" role="alert" style="color:var(--red);font-weight:600"></div>
      <button class="btn pri full" type="submit">Create vault</button></form>`, el => {
      const f = el.querySelector('#vcForm');
      f.a.oninput = () => strength(f.a.value, el.querySelector('#vcStr'));
      f.onsubmit = async ev => {
        ev.preventDefault(); const er = el.querySelector('#vcErr');
        if (f.a.value.length < 8) { er.textContent = 'At least 8 characters.'; return; }
        if (f.a.value !== f.b.value) { er.textContent = 'The two entries are different.'; return; }
        S().vault = {v: 1, salt: b64(rnd(16))};
        vKey = await pbkdf2(f.a.value, unb64(S().vault.salt), 250000); V = [];
        await vEncrypt(V); vLockSoon();
        closeSheet(() => { toast('Vault created'); vList(); });
      };
    });
  }
  function strength(p, bar) {
    let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
    bar.style.width = (s / 5 * 100) + '%'; bar.style.background = s <= 2 ? 'var(--red)' : s === 3 ? 'var(--orange)' : 'var(--green)';
  }
  const genPass = () => { const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?']; let p = sets.map(s => s[rnd(1)[0] % s.length]).join(''); const all = sets.join(''); while (p.length < 16) p += all[rnd(1)[0] % all.length]; return p.split('').sort(() => rnd(1)[0] - 128).join(''); };
  async function copy(t, what) {
    try { await navigator.clipboard.writeText(t); toast((what || 'Copied') + ' – cleared in 30 s'); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000); }
    catch (e) { toast('Copy failed'); }
  }
  function vList() {
    vLockSoon();
    let q = '';
    openSheet('Password vault', `<div class="btns" style="margin-bottom:10px"><button type="button" class="btn pri" id="vAdd">+ Add password</button><button type="button" class="btn" id="vLockB">Lock vault</button><button type="button" class="btn" id="vMaster">Change master password</button></div>
      <input class="search" id="vQ" placeholder="Search" aria-label="Search vault"><div id="vBody"></div>
      <p class="hint" style="margin:10px 4px">Encrypted with AES-256. The vault locks after 3 minutes or when the app goes to the background.</p>`, el => {
      const draw = () => {
        const L2 = V.filter(x => !q || [x.title, x.user, x.cat, x.url, x.notes].join(' ').toLowerCase().includes(q)).sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || a.title.localeCompare(b.title));
        el.querySelector('#vBody').innerHTML = L2.length ? `<div class="list">${L2.map(x => `<button type="button" class="item" data-v="${x.id}"><div class="main"><div class="t">${esc(x.title)}</div><div class="s">${esc([x.cat, x.user].filter(Boolean).join(' · '))}</div></div><span class="hint">›</span></button>`).join('')}</div>`
          : `<div class="list"><div class="empty">${V.length ? 'Nothing matches.' : 'No passwords yet. Tap <b>+ Add password</b>.'}</div></div>`;
        el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => vView(b.dataset.v, draw));
      };
      el.querySelector('#vQ').oninput = e => { q = e.target.value.toLowerCase(); draw(); vLockSoon(); };
      el.querySelector('#vAdd').onclick = () => vEdit(null, draw);
      el.querySelector('#vLockB').onclick = () => { vLock(); closeSheet(() => toast('Vault locked')); };
      el.querySelector('#vMaster').onclick = () => vChangeMaster();
      draw();
    });
  }
  function vView(id, redraw) {
    if (!V) return vault();
    vLockSoon();
    const x = V.find(e => e.id === id); if (!x) return;
    let shown = false;
    openSheet(x.title, `<div class="card" style="padding:4px 14px">
      ${x.user ? `<div class="vrow"><div class="k">Username</div><div class="v">${esc(x.user)}</div><button type="button" class="btn" data-c="user">Copy</button></div>` : ''}
      <div class="vrow"><div class="k">Password</div><div class="v pw" id="vpw">••••••••••</div><button type="button" class="btn" id="vShow">Show</button><button type="button" class="btn" data-c="pass">Copy</button></div>
      ${x.url ? `<div class="vrow"><div class="k">Website</div><div class="v">${esc(x.url)}</div><button type="button" class="btn" id="vGo">Open</button></div>` : ''}
      ${x.cat ? `<div class="vrow"><div class="k">Category</div><div class="v">${esc(x.cat)}</div></div>` : ''}
      ${x.notes ? `<div class="vrow"><div class="k">Notes</div><div class="v" style="white-space:pre-wrap;font-weight:400">${esc(x.notes)}</div></div>` : ''}
      </div><p class="hint">Changed ${x.at ? new Date(x.at).toLocaleDateString() : ''}</p>
      <div class="btns"><button type="button" class="btn" id="vEd">${ICON.edit}Edit</button><button type="button" class="btn danger" id="vDel">${ICON.trash}Delete</button></div>`, el => {
      el.querySelector('#vShow').onclick = e => { shown = !shown; el.querySelector('#vpw').textContent = shown ? x.pass : '••••••••••'; e.target.textContent = shown ? 'Hide' : 'Show'; vLockSoon(); };
      el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => copy(x[b.dataset.c], b.dataset.c === 'pass' ? 'Password copied' : 'Username copied'));
      const go = el.querySelector('#vGo'); if (go) go.onclick = () => openLink(/^https?:/.test(x.url) ? x.url : 'https://' + x.url);
      el.querySelector('#vEd').onclick = () => closeSheet(() => vEdit(id, redraw));
      el.querySelector('#vDel').onclick = async () => { if (!confirm('Delete "' + x.title + '"?')) return; V = V.filter(e => e.id !== id); await vEncrypt(V); closeSheet(() => { redraw(); toast('Deleted'); }); };
    });
  }
  function vEdit(id, redraw) {
    if (!V) return vault();
    vLockSoon();
    const x = id ? V.find(e => e.id === id) : {title: '', cat: 'Bank', user: '', pass: '', url: '', notes: ''};
    openSheet(id ? 'Edit ' + x.title : 'Add password', `<form id="veForm" autocomplete="off">
      <label class="f"><span>Name</span><input class="in" name="title" required value="${esc(x.title)}" placeholder="e.g. QNB online banking"></label>
      <label class="f"><span>Category</span><select class="in" name="cat">${VCATS.map(c => `<option ${c === x.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="f"><span>Username / email / account no.</span><input class="in" name="user" value="${esc(x.user)}" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
      <label class="f"><span>Password</span><div style="display:flex;gap:8px"><input class="in" name="pass" value="${esc(x.pass)}" autocomplete="off" spellcheck="false" style="font-family:ui-monospace,monospace"><button type="button" class="btn" id="veGen">Generate</button></div></label>
      <div class="vstr"><i id="veStr"></i></div>
      <label class="f"><span>Website (optional)</span><input class="in" name="url" value="${esc(x.url)}" autocapitalize="none" placeholder="e.g. qnb.com"></label>
      <label class="f"><span>Notes (optional)</span><textarea class="in" name="notes" rows="3" placeholder="PIN hints, security questions, customer ID…">${esc(x.notes)}</textarea></label>
      <button class="btn pri full" type="submit">Save</button></form>`, el => {
      const f = el.querySelector('#veForm'), bar = el.querySelector('#veStr');
      f.pass.oninput = () => { strength(f.pass.value, bar); vLockSoon(); }; strength(f.pass.value, bar);
      el.querySelector('#veGen').onclick = () => { f.pass.value = genPass(); strength(f.pass.value, bar); };
      f.onsubmit = async ev => {
        ev.preventDefault(); if (!V) { toast('Vault locked – open it again'); return; }
        const v = formData(f), rec = {id: id || uid(), title: v.title.trim(), cat: v.cat, user: v.user.trim(), pass: v.pass, url: v.url.trim(), notes: v.notes.trim(), at: new Date().toISOString()};
        V = id ? V.map(e => e.id === id ? rec : e) : V.concat([rec]);
        await vEncrypt(V);
        closeSheet(() => { redraw(); toast('Saved in vault'); });
      };
    });
  }
  function vChangeMaster() {
    if (!V) return vault();
    openSheet('Change master password', `<form id="vmForm" autocomplete="off">
      <label class="f"><span>New master password (at least 8)</span><input class="in" type="password" name="a" autocomplete="new-password" required></label>
      <label class="f"><span>Repeat</span><input class="in" type="password" name="b" autocomplete="new-password" required></label>
      <div class="cl-err" id="vmErr" role="alert" style="color:var(--red);font-weight:600"></div>
      <button class="btn pri full" type="submit">Change</button></form>`, el => {
      const f = el.querySelector('#vmForm');
      f.onsubmit = async ev => {
        ev.preventDefault(); const er = el.querySelector('#vmErr');
        if (f.a.value.length < 8) { er.textContent = 'At least 8 characters.'; return; }
        if (f.a.value !== f.b.value) { er.textContent = 'The two entries are different.'; return; }
        S().vault.salt = b64(rnd(16));
        vKey = await pbkdf2(f.a.value, unb64(S().vault.salt), 250000);
        await vEncrypt(V);
        closeSheet(() => toast('Master password changed'));
      };
    });
  }

  /* Menu rows */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const k = document.getElementById('mBak'); if (!k || document.getElementById('mSec')) return;
    const shield = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/></svg>';
    const key = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>';
    const showVault = !cloudOn() || FitxCloud.role === 'owner';
    k.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mSec"><span class="ic">${shield}</span><div class="main"><div class="t">Security &amp; app lock</div><div class="s">PIN / fingerprint to open the app · admin protection</div></div></button>
      ${showVault ? `<button type="button" class="item rcard" id="mVault"><span class="ic">${key}</span><div class="main"><div class="t">Password vault</div><div class="s">Bank, email & website passwords – encrypted</div></div></button>` : ''}`);
    document.getElementById('mSec').onclick = lockSettings;
    const mv = document.getElementById('mVault'); if (mv) mv.onclick = vault;
  };
  window.FitxSec = {requireAdmin, lockSettings, showLock, vault, vLock};
})();
