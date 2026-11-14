/* FitX Accounts — cloud (Firebase) sign-in, company, staff roles and live sync.
   The app keeps its data in `db` and calls save() after every change. This file:
   - signs the user in (email + password) and links them to a company,
   - mirrors each record of db to Firestore: companies/{cid}/{collection}/{recordId} = {j: JSON, t, by},
   - listens for changes from other phones/computers and merges them into db,
   - hides screens a staff member's role is not allowed to use.
   Without window.FITX_FIREBASE the app runs on this phone only, exactly as before. */
(function () {
  'use strict';
  const CFG = window.FITX_FIREBASE;
  const LS_LINK = KEY + '_cloud';          // {cid, uid, email} of the company this device is linked to
  const LS_OFFLINE = KEY + '_offlineOnly'; // user chose "this phone only"
  const ROLES = {
    owner: {label: 'Owner', desc: 'Everything, including team and settings'},
    accountant: {label: 'Accountant', desc: 'All accounts, reports and settings — no team management'},
    technician: {label: 'Technician', desc: 'Customers, quotes, invoices, payments and products only'}
  };
  // collections synced record-by-record (any other array in db is synced too)
  const BASE_COLS = ['customers', 'items', 'moves', 'docs', 'expenses', 'suppliers', 'purchases', 'treadmills'];
  const TECH_READ = ['customers', 'items', 'docs', 'moves', 'treadmills'];
  const TECH_WRITE = ['customers', 'docs', 'moves', 'items'];
  // settings are compared with sorted keys so two devices never ping-pong the same values
  const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
  const stable = v => JSON.stringify(sortKeys(v));
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const C = window.FitxCloud = {
    enabled: !!(CFG && CFG.apiKey && window.firebase), user: null, cid: null, role: null, company: null,
    ready: false, status: 'off', pending: 0, lastSync: 0, error: ''
  };
  const rawSave = window.save; // writes db to this phone
  let fs, auth, shadow = new Map(), unsubs = [], pushTimer = null, renderTimer = null, firstSnaps = 0, cols = [];

  /* ---------- role gating ---------- */
  const can = what => {
    const r = C.role;
    if (!C.cid || !r) return true; // phone-only mode: everything
    if (what === 'team') return r === 'owner';
    if (r === 'technician') return ['sales', 'customers', 'stock', 'home', 'more'].includes(what);
    return true;
  };
  C.can = can;
  function applyRole() {
    document.body.classList.toggle('role-tech', C.role === 'technician');
    if (!can(state.tab)) state.tab = 'home';
  }
  const css = document.createElement('style');
  css.textContent = `
    body.role-tech #side [data-tab=expenses], body.role-tech #side [data-tab=suppliers], body.role-tech #side [data-tab=reports],
    body.role-tech #tabs [data-tab=expenses], body.role-tech #topSet,
    body.role-tech #mBills, body.role-tech #mSup, body.role-tech #mRep, body.role-tech #mSet, body.role-tech #mBak,
    body.role-tech .subnav [data-sn^=expenses], body.role-tech .subnav [data-sn=suppliers],
    body.role-tech [data-nk=exp], body.role-tech [data-nk=bill], body.role-tech [data-nk=paybill], body.role-tech [data-nk=sup],
    body.role-tech [data-nk=rep], body.role-tech [data-nk=bak], body.role-tech .cl-hide-tech,
    body.role-tech .newgrid > div:has([data-nk=exp]) {display:none!important}
    .cl-wrap{position:fixed;inset:0;z-index:200;background:var(--bg,#f3f4f6);overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px}
    .cl-box{width:100%;max-width:420px;margin-top:4vh}
    .cl-logo{font-weight:900;font-size:40px;letter-spacing:-1px;text-align:center}.cl-logo span{color:#ff6a00}
    .cl-sub{text-align:center;color:var(--muted,#6b7280);margin:4px 0 22px;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
    .cl-tabs{display:flex;background:var(--card,#fff);border:1px solid var(--line,#e5e7eb);border-radius:999px;padding:4px;margin-bottom:14px}
    .cl-tabs button{flex:1;border:0;background:none;border-radius:999px;padding:10px;font-weight:700;color:var(--muted,#6b7280);min-height:44px}
    .cl-tabs button.on{background:#ff6a00;color:#fff}
    .cl-err{color:#c62828;font-size:13px;margin:6px 2px 10px;min-height:1em}
    .cl-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px;background:#9ca3af}
    .cl-dot.ok{background:#16a34a}.cl-dot.busy{background:#f59e0b}.cl-dot.err{background:#dc2626}
    .cl-role{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#fff1e6;color:#c2410c}`;
  document.head.appendChild(css);

  /* ---------- save hook: write to phone, then queue a cloud push ---------- */
  window.save = function () {
    rawSave();
    if (C.cid && C.ready) schedulePush();
  };
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 350); }

  const colsInDb = () => Array.from(new Set([...BASE_COLS, ...Object.keys(db).filter(k => Array.isArray(db[k]))]));
  const readable = c => C.role !== 'technician' || TECH_READ.includes(c);
  const writable = c => C.role !== 'technician' || TECH_WRITE.includes(c);
  const isCounter = k => /^next[A-Z]/.test(k);
  function splitSettings() {
    const st = {}, ct = {};
    Object.keys(db.settings || {}).forEach(k => (isCounter(k) ? ct : st)[k] = db.settings[k]);
    return {st, ct};
  }
  const pack = v => ({j: JSON.stringify(v), t: firebase.firestore.FieldValue.serverTimestamp(), by: C.user ? C.user.uid : ''});

  async function push() {
    if (!C.cid || !C.ready) return;
    const ops = [];
    const base = fs.collection('companies').doc(C.cid);
    const seen = new Set();
    colsInDb().forEach(col => {
      if (!writable(col)) return;
      (db[col] || []).forEach(rec => {
        if (!rec || typeof rec !== 'object') return;
        if (!rec.id) rec.id = uid();
        const k = col + '/' + rec.id; seen.add(k);
        const j = JSON.stringify(rec);
        if (shadow.get(k) !== j) { ops.push(['set', base.collection(col).doc(String(rec.id)), j]); shadow.set(k, j); }
      });
    });
    // records removed on this device
    Array.from(shadow.keys()).forEach(k => {
      if (k.startsWith('meta/')) return;
      const col = k.split('/')[0];
      if (!seen.has(k) && writable(col)) { ops.push(['del', base.collection(col).doc(k.slice(col.length + 1))]); shadow.delete(k); }
    });
    const {st, ct} = splitSettings();
    const sj = stable(st), cj = stable(ct);
    if (C.role !== 'technician' && shadow.get('meta/settings') !== sj) { ops.push(['set', base.collection('meta').doc('settings'), sj]); shadow.set('meta/settings', sj); }
    if (shadow.get('meta/counters') !== cj) { ops.push(['set', base.collection('meta').doc('counters'), cj]); shadow.set('meta/counters', cj); }
    if (!ops.length) return;
    setStatus('busy');
    C.pending += ops.length;
    try {
      for (let i = 0; i < ops.length; i += 450) {
        const b = fs.batch();
        ops.slice(i, i + 450).forEach(([t, ref, j]) => t === 'del' ? b.delete(ref) : b.set(ref, {j, t: firebase.firestore.FieldValue.serverTimestamp(), by: C.user.uid}));
        await b.commit();
      }
      C.lastSync = Date.now(); C.error = ''; setStatus('ok');
    } catch (e) {
      C.error = fbErr(e); setStatus('err');
      // forget what failed so it is retried on the next save
      ops.forEach(([t, ref]) => shadow.delete(ref.parent.id + '/' + ref.id));
      if (/permission/i.test(C.error)) toast('Cloud: you do not have permission for that change');
    } finally { C.pending = Math.max(0, C.pending - ops.length); }
  }

  /* ---------- live listeners ---------- */
  function stopListeners() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; }
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { try { rawSave(); render(); refreshCloudSheet(); } catch (e) {} }, 250);
  }
  function upsert(col, rec) {
    if (!Array.isArray(db[col])) db[col] = [];
    const i = db[col].findIndex(r => r && String(r.id) === String(rec.id));
    if (i >= 0) db[col][i] = rec; else db[col].push(rec);
  }
  function startListeners(onAllFirst) {
    stopListeners();
    const base = fs.collection('companies').doc(C.cid);
    cols = Array.from(new Set([...BASE_COLS, ...(window.FITX_EXTRA_COLS || [])])).filter(readable);
    const total = cols.length + 1;
    firstSnaps = 0;
    const firstDone = () => { if (++firstSnaps === total && onAllFirst) onAllFirst(); };
    cols.forEach(col => {
      let first = true;
      unsubs.push(base.collection(col).onSnapshot({includeMetadataChanges: false}, snap => {
        snap.docChanges().forEach(ch => {
          const k = col + '/' + ch.doc.id;
          if (ch.type === 'removed') {
            if (C.ready && shadow.has(k)) { shadow.delete(k); db[col] = (db[col] || []).filter(r => String(r.id) !== ch.doc.id); }
            return;
          }
          if (ch.doc.metadata.hasPendingWrites && !first) return; // our own write echoing back
          const j = ch.doc.data().j; if (!j) return;
          if (shadow.get(k) === j) return;
          try { const rec = JSON.parse(j); shadow.set(k, j); if (C.ready || !first) upsert(col, rec); else (C._initial[col] = C._initial[col] || []).push(rec); } catch (e) {}
        });
        if (first) { first = false; firstDone(); } else scheduleRender();
      }, err => { C.error = fbErr(err); setStatus('err'); if (first) { first = false; firstDone(); } }));
    });
    let metaFirst = true;
    unsubs.push(base.collection('meta').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') return;
        if (ch.doc.metadata.hasPendingWrites && !metaFirst) return;
        const j = ch.doc.data().j; const k = 'meta/' + ch.doc.id;
        if (!j) return;
        let v; try { v = JSON.parse(j); } catch (e) { return; }
        const sj = stable(v);
        if (shadow.get(k) === sj) return;
        shadow.set(k, sj);
        if (ch.doc.id === 'counters') {
          C._initialCounters = v;
          if (!metaFirst || C.ready) Object.keys(v).forEach(n => { db.settings[n] = Math.max(num(db.settings[n]) || 1, num(v[n]) || 1); });
        } else if (ch.doc.id === 'settings') {
          C._initialSettings = v;
          if (!metaFirst || C.ready) Object.assign(db.settings, v);
        }
      });
      if (metaFirst) { metaFirst = false; firstDone(); } else scheduleRender();
    }, err => { C.error = fbErr(err); setStatus('err'); if (metaFirst) { metaFirst = false; firstDone(); } }));
  }

  /* adopt the cloud copy as this device's data */
  function adoptInitial() {
    const fresh = DEFAULT();
    const merged = Object.assign(fresh, {settings: Object.assign(fresh.settings, C._initialSettings || {}, C._initialCounters || {})});
    cols.forEach(col => { merged[col] = (C._initial[col] || []).sort((a, b) => String(a.id).localeCompare(String(b.id))); });
    // a technician cannot read every collection: keep their local copy of the rest empty
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch (e) {}
    load();
  }
  const hasLocalData = () => ['customers', 'docs', 'expenses', 'suppliers', 'purchases'].some(k => (db[k] || []).length);
  const cloudHasData = () => Object.keys(C._initial || {}).some(k => k !== 'treadmills' && k !== 'items' && (C._initial[k] || []).length) || !!C._initialSettings;

  async function attach(cid, role, mode) {
    C.cid = cid; C.role = role; C.ready = false; C._initial = {}; C._initialSettings = null; C._initialCounters = null;
    shadow = new Map();
    setStatus('busy');
    applyRole();
    try { const cs = await fs.collection('companies').doc(cid).get(); C.company = cs.exists ? cs.data() : null; } catch (e) {}
    startListeners(async () => {
      if (mode === 'auto' && role !== 'owner') mode = 'download';
      if (mode === 'upload' || (mode === 'auto' && !cloudHasData())) {
        // first device of a new company: this phone's data becomes the company's data
        shadow = new Map();
        C.ready = true; await push();
        toast('Your data is now in the cloud');
      } else {
        const linked = lsGet(LS_LINK);
        if (hasLocalData() && !(linked && linked.cid === cid)) {
          try { localStorage.setItem(KEY + '_beforeCloud', JSON.stringify(db)); } catch (e) {}
          setTimeout(() => toast('Phone data saved as a backup; showing company data from the cloud'), 600);
        }
        adoptInitial();
        C.ready = true;
        await push(); // anything changed offline that the cloud does not have yet
      }
      lsSet(LS_LINK, {cid, uid: C.user.uid, email: C.user.email, role});
      setStatus('ok'); C.lastSync = Date.now();
      applyRole(); render(); refreshCloudSheet();
      // one-time data set-ups (e.g. the FitX catalog) run on the cloud copy so they are saved for every device
      (window.FITX_AFTER_SYNC || []).forEach(fn => { try { fn(); } catch (e) {} });
    });
  }
  function detach() {
    stopListeners(); clearTimeout(pushTimer);
    C.cid = null; C.role = null; C.ready = false; C.company = null; shadow = new Map();
    document.body.classList.remove('role-tech');
    setStatus('off');
  }

  /* ---------- status ---------- */
  function setStatus(s) {
    C.status = s;
    const el = document.getElementById('clStat');
    if (el) el.innerHTML = statusHTML();
    const sf = document.getElementById('sideFoot');
    if (sf && C.cid) {
      if (!sf.querySelector('.cl-line')) sf.insertAdjacentHTML('beforeend', '<div class="cl-line" style="margin-top:6px"></div>');
      sf.querySelector('.cl-line').innerHTML = statusHTML(true);
    }
  }
  function statusHTML(short) {
    const m = {off: ['', 'Not connected'], busy: ['busy', 'Syncing…'], ok: ['ok', 'Synced' + (C.lastSync ? ' ' + new Date(C.lastSync).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '')], err: ['err', 'Sync problem']}[C.status] || ['', ''];
    if (!navigator.onLine && C.cid) m[0] = 'busy', m[1] = 'Offline — changes will sync later';
    return `<span class="cl-dot ${m[0]}"></span>${esc(m[1])}${!short && C.error && C.status === 'err' ? `<div class="hint" style="margin-top:4px">${esc(C.error)}</div>` : ''}`;
  }
  window.addEventListener('online', () => { setStatus(C.status); if (C.cid) schedulePush(); });
  window.addEventListener('offline', () => setStatus(C.status));

  /* ---------- screens ---------- */
  let wrap = null;
  function closeWrap() { if (wrap) { wrap.remove(); wrap = null; } }
  function showWrap(html, mount) {
    closeWrap();
    wrap = document.createElement('div'); wrap.className = 'cl-wrap';
    wrap.innerHTML = `<div class="cl-box"><div class="cl-logo">Fit<span>X</span></div><div class="cl-sub">Accounts · Cloud</div>${html}</div>`;
    document.body.appendChild(wrap);
    if (mount) mount(wrap);
  }
  // explain Firebase setup problems in plain words
  function fbErr(e) {
    const m = (e && (e.message || e.code)) || String(e);
    if (/permission|insufficient/i.test(m)) return 'Firebase blocked this. Publish the FitX security rules: Firebase → Firestore Database → Rules → paste the rules → Publish.';
    if (/does not exist|not-found|NOT_FOUND/i.test(m)) return 'The Firestore database is not created yet: Firebase → Build → Firestore Database → Create database.';
    if (/offline|network|unavailable/i.test(m)) return 'No connection to the cloud. Check the internet and try again.';
    return m;
  }
  function authErr(e) {
    const c = (e && e.code) || '';
    return ({
      'auth/invalid-email': 'That email address is not valid.',
      'auth/user-not-found': 'No account with that email. Tap “Create account”.',
      'auth/wrong-password': 'Wrong password.',
      'auth/invalid-credential': 'Username / email or password is wrong.',
      'fitx/disabled': 'This user is disabled. Ask the owner.',
      'auth/requires-recent-login': 'Please sign out and sign in again, then change the password.',
      'auth/invalid-login-credentials': 'Username / email or password is wrong.',
      'auth/email-already-in-use': 'An account with this email already exists. Tap “Sign in”.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/network-request-failed': 'No internet connection.',
      'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
      'auth/operation-not-allowed': 'Email sign-in is not turned on in Firebase (Authentication → Email/Password).'
    })[c] || (e && e.message) || 'Something went wrong.';
  }
  /* ---------- staff usernames ----------
     A username is a login made by the owner (no email needed). It signs in with a private alias e-mail
     <username>@users.fitx.qa (or <username>.r2@… after a password reset). logins/<username> = {email, uid, cid, role, name, disabled}. */
  const ALIAS = 'users.fitx.qa';
  const OWNER_EMAILS = ['fitxqa@gmail.com'];
  const cleanUser = u => String(u || '').trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
  async function loginEmail(v) {
    v = String(v || '').trim();
    if (v.includes('@')) return v;
    const u = cleanUser(v);
    try {
      const d = await fs.collection('logins').doc(u).get();
      if (d.exists) { if (d.data().disabled) { const e = new Error('This user is disabled. Ask the owner.'); e.code = 'fitx/disabled'; throw e; } return d.data().email; }
    } catch (e) { if (e.code === 'fitx/disabled') throw e; }
    return u + '@' + ALIAS;
  }
  const shownLogin = em => { const m = String(em || '').match(new RegExp('^([^@]+?)(?:\\.r\\d+)?@' + ALIAS.replace(/\./g, '\\.') + '$')); return m ? m[1] : em; };
  C.shownLogin = shownLogin;
  // a second Firebase app signs up new logins without signing the owner out
  async function secondary() {
    const app = firebase.apps.find(a => a.name === 'fitx-admin') || firebase.initializeApp(CFG, 'fitx-admin');
    try { await app.auth().setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) {}
    return app;
  }
  async function makeLogin(username, password, name) {
    const app = await secondary(); let cred = null, email = '';
    for (let n = 1; n <= 30 && !cred; n++) {
      email = username + (n === 1 ? '' : '.r' + n) + '@' + ALIAS;
      try { cred = await app.auth().createUserWithEmailAndPassword(email, password); }
      catch (e) { if (e.code !== 'auth/email-already-in-use') throw e; }
    }
    if (!cred) throw new Error('Could not create this login – try another username.');
    try { if (name) await cred.user.updateProfile({displayName: name}); } catch (e) {}
    await app.firestore().collection('users').doc(cred.user.uid).set({cid: C.cid, email, username});
    await app.auth().signOut();
    return {uid: cred.user.uid, email};
  }
  const genPw = () => { const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; s = s[0].toUpperCase() + s.slice(1); for (let i = 0; i < 4; i++) s += d[Math.floor(Math.random() * d.length)]; return s; };
  function rulesHelp(e) {
    if (!/permission|insufficient/i.test((e && (e.message || e.code)) || '')) return false;
    openSheet('One-time setup needed', `<p>To use usernames, Firebase needs the updated FitX security rules (one time only):</p>
      <ol class="hint" style="padding-left:18px;line-height:1.6"><li>Open <b>console.firebase.google.com</b> → project <b>fitx-accounts</b></li><li><b>Firestore Database → Rules</b></li><li>Delete everything, paste the new rules, tap <b>Publish</b></li></ol>
      <button type="button" class="btn pri full" id="ruCopy">Copy the new rules</button>`, el => {
      el.querySelector('#ruCopy').onclick = async () => { try { const t = await (await fetch('firestore.rules.txt', {cache: 'no-store'})).text(); await navigator.clipboard.writeText(t); toast('Rules copied – paste them in Firebase'); } catch (er) { toast('Copy failed: ' + er.message); } };
    });
    return true;
  }
  function shareLogin(name, username, pw, title) {
    const msg = `${title || 'Your FitX Accounts login'} (${S().name})\n\nUsername: ${username}\nPassword: ${pw}\n\nApp: https://fitxqa.github.io/fitx-accounts-web/download/FitX-Accounts.apk\nWeb: https://fitxqa.github.io/fitx-accounts-web/\n\nChange your password after signing in: Menu → Cloud & team → Change my password.`;
    openSheet('Login details', `<div class="card" style="font-size:15px;line-height:1.8">${name ? `<b>${esc(name)}</b><br>` : ''}Username: <b>${esc(username)}</b><br>Password: <b style="font-family:ui-monospace,monospace;font-size:17px">${esc(pw)}</b></div>
      <p class="hint">Give these to ${esc(name || 'the employee')}. The password is not shown again.</p>
      <div class="btns"><button type="button" class="btn pri" id="lgWa">${ICON.wa || ''}Send by WhatsApp</button><button type="button" class="btn" id="lgCopy">Copy</button></div>`, el => {
      el.querySelector('#lgWa').onclick = () => openLink('https://wa.me/?text=' + encodeURIComponent(msg));
      el.querySelector('#lgCopy').onclick = async () => { try { await navigator.clipboard.writeText(msg); toast('Copied'); } catch (e) { toast('Copy failed'); } };
    });
  }
  function addUser(after) {
    const pw0 = genPw();
    openSheet('Add user', `<form id="auForm" autocomplete="off">
      <label class="f"><span>Full name</span><input class="in" name="name" required placeholder="e.g. Ravi Kumar"></label>
      <label class="f"><span>Username (to sign in)</span><input class="in" name="username" required autocapitalize="none" spellcheck="false" placeholder="e.g. ravi"></label>
      <label class="f"><span>Password</span><div style="display:flex;gap:8px"><input class="in" name="pw" required minlength="6" value="${pw0}" style="font-family:ui-monospace,monospace"><button type="button" class="btn" id="auGen">New</button></div></label>
      <label class="f"><span>Role</span><select class="in" name="role">${Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, r]) => `<option value="${k}">${r.label} — ${r.desc}</option>`).join('')}<option value="owner">Owner — ${ROLES.owner.desc}</option></select></label>
      <div class="cl-err" id="auErr" role="alert"></div>
      <button class="btn pri full" type="submit">Create user</button></form>`, el => {
      const un = el.querySelector('[name=username]');
      el.querySelector('[name=name]').addEventListener('input', e => { if (!un.dataset.touched) un.value = cleanUser(e.target.value.split(' ')[0]); });
      un.addEventListener('input', () => { un.dataset.touched = 1; });
      el.querySelector('#auGen').onclick = () => { el.querySelector('[name=pw]').value = genPw(); };
      el.querySelector('#auForm').onsubmit = async ev => {
        ev.preventDefault(); const f = formData(ev.target), er = el.querySelector('#auErr'), btn = ev.target.querySelector('[type=submit]');
        const u = cleanUser(f.username); er.textContent = '';
        if (u.length < 3) { er.textContent = 'Username: at least 3 letters or numbers.'; return; }
        if (f.pw.length < 6) { er.textContent = 'Password: at least 6 characters.'; return; }
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
          const ex = await fs.collection('logins').doc(u).get();
          if (ex.exists) { er.textContent = 'This username is taken – choose another.'; btn.disabled = false; btn.textContent = 'Create user'; return; }
          const lg = await makeLogin(u, f.pw, f.name.trim());
          await fs.collection('companies').doc(C.cid).collection('members').doc(lg.uid).set({role: f.role, email: lg.email, username: u, name: f.name.trim(), joined: firebase.firestore.FieldValue.serverTimestamp()});
          await fs.collection('logins').doc(u).set({email: lg.email, uid: lg.uid, cid: C.cid, role: f.role, name: f.name.trim(), disabled: false});
          closeSheet(() => { if (after) after(); shareLogin(f.name.trim(), u, f.pw, 'Your FitX Accounts login'); });
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Create user';
          if (!rulesHelp(e)) er.textContent = e.code ? authErr(e) : fbErr(e);
        }
      };
    });
  }
  async function resetUser(m, after) {
    const pw0 = genPw();
    openSheet('Reset password – ' + (m.name || m.username), `<form id="rpForm">
      <p class="hint" style="margin-top:0">Sets a new password for <b>${esc(m.username)}</b>. Their phone is signed out and they sign in again with the new password.</p>
      <label class="f"><span>New password</span><div style="display:flex;gap:8px"><input class="in" name="pw" required minlength="6" value="${pw0}" style="font-family:ui-monospace,monospace"><button type="button" class="btn" id="rpGen">New</button></div></label>
      <div class="cl-err" id="rpErr" role="alert"></div>
      <button class="btn pri full" type="submit">Reset password</button></form>`, el => {
      el.querySelector('#rpGen').onclick = () => { el.querySelector('[name=pw]').value = genPw(); };
      el.querySelector('#rpForm').onsubmit = async ev => {
        ev.preventDefault(); const pw = formData(ev.target).pw, er = el.querySelector('#rpErr'), btn = ev.target.querySelector('[type=submit]');
        if (pw.length < 6) { er.textContent = 'Password: at least 6 characters.'; return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const lg = await makeLogin(m.username, pw, m.name);
          const base = fs.collection('companies').doc(C.cid).collection('members');
          await base.doc(lg.uid).set({role: m.role, email: lg.email, username: m.username, name: m.name || '', joined: firebase.firestore.FieldValue.serverTimestamp()});
          if (m.uid && m.uid !== lg.uid) { try { await base.doc(m.uid).delete(); } catch (e) {} }
          await fs.collection('logins').doc(m.username).set({email: lg.email, uid: lg.uid, cid: C.cid, role: m.role, name: m.name || '', disabled: false});
          closeSheet(() => { if (after) after(); shareLogin(m.name, m.username, pw, 'Your new FitX Accounts password'); });
        } catch (e) { btn.disabled = false; btn.textContent = 'Reset password'; if (!rulesHelp(e)) er.textContent = e.code ? authErr(e) : fbErr(e); }
      };
    });
  }
  function changeMyPassword() {
    openSheet('Change my password', `<form id="cpForm" autocomplete="on">
      <input type="text" name="u" autocomplete="username" value="${esc(C.user ? C.user.email : '')}" hidden>
      <label class="f"><span>Current password</span><input class="in" type="password" name="cur" autocomplete="current-password" required></label>
      <label class="f"><span>New password</span><input class="in" type="password" name="pw" autocomplete="new-password" minlength="6" required></label>
      <label class="f"><span>New password again</span><input class="in" type="password" name="pw2" autocomplete="new-password" minlength="6" required></label>
      <div class="cl-err" id="cpErr" role="alert"></div>
      <button class="btn pri full" type="submit">Change password</button></form>`, el => {
      el.querySelector('#cpForm').onsubmit = async ev => {
        ev.preventDefault(); const f = formData(ev.target), er = el.querySelector('#cpErr'), btn = ev.target.querySelector('[type=submit]');
        er.textContent = '';
        if (f.pw.length < 6) { er.textContent = 'At least 6 characters.'; return; }
        if (f.pw !== f.pw2) { er.textContent = 'The two new passwords are different.'; return; }
        btn.disabled = true;
        try {
          await C.user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(C.user.email, f.cur));
          await C.user.updatePassword(f.pw);
          closeSheet(() => toast('Password changed'));
        } catch (e) { btn.disabled = false; er.textContent = authErr(e); }
      };
    });
  }
  C.changeMyPassword = changeMyPassword;

  function loginScreen(mode) {
    mode = mode || 'in';
    showWrap(`
      ${mode === 'up' ? '<div class="cl-tabs" role="tablist"><button type="button" data-m="in">Sign in</button><button type="button" data-m="up" class="on">Create account</button></div>' : '<h2 style="text-align:center;margin:4px 0 14px">Sign in</h2>'}
      <form id="clForm" class="card" autocomplete="on">
        ${mode === 'up' ? '<label class="f"><span>Your name</span><input class="in" name="name" autocomplete="name" required></label>' : ''}
        <label class="f"><span>${mode === 'up' ? 'Email' : 'Username or email'}</span><input class="in" name="email" ${mode === 'up' ? 'type="email" inputmode="email"' : 'type="text" autocapitalize="none" spellcheck="false"'} autocomplete="username" required></label>
        <label class="f"><span>Password</span><input class="in" name="pw" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="6" required></label>
        <div class="cl-err" id="clErr" role="alert"></div>
        <button class="btn pri full" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
        ${mode === 'in' ? '<button type="button" class="btn full" id="clForgot" style="margin-top:8px">Forgot password</button>' : ''}
      </form>
      <p class="hint" style="text-align:center;margin:18px 6px 8px">Use the username and password from your company owner.</p>
      <button type="button" class="btn full" id="clLocal">Use on this phone only (no cloud)</button>`, w => {
      w.querySelectorAll('[data-m]').forEach(b => b.onclick = () => loginScreen(b.dataset.m));
      w.querySelector('#clLocal').onclick = () => { lsSet(LS_OFFLINE, true); closeWrap(); toast('Working on this phone only. Turn on cloud in Menu → Cloud & team.'); };
      const fp = w.querySelector('#clForgot');
      if (fp) fp.onclick = async () => {
        const em = w.querySelector('[name=email]').value.trim();
        if (!em) { w.querySelector('#clErr').textContent = 'Type your email first.'; return; }
        if (!em.includes('@')) { w.querySelector('#clErr').textContent = 'Staff usernames: ask the owner to reset your password in Menu → Users & passwords.'; return; }
        try { await auth.sendPasswordResetEmail(em); w.querySelector('#clErr').textContent = 'Password reset email sent to ' + em; }
        catch (e) { w.querySelector('#clErr').textContent = authErr(e); }
      };
      w.querySelector('#clForm').onsubmit = async e => {
        e.preventDefault();
        const f = formData(e.target); const btn = e.target.querySelector('[type=submit]'); const er = w.querySelector('#clErr');
        btn.disabled = true; er.textContent = '';
        try {
          if (mode === 'up') {
            const cred = await auth.createUserWithEmailAndPassword(f.email.trim(), f.pw);
            if (f.name) await cred.user.updateProfile({displayName: f.name.trim()});
          } else await auth.signInWithEmailAndPassword(await loginEmail(f.email), f.pw);
          lsSet(LS_OFFLINE, null);
        } catch (err) {
          er.textContent = authErr(err); btn.disabled = false;
          // the owner's very first sign-in on the cloud: offer to set up the owner account (only for the owner email)
          if (mode !== 'up' && OWNER_EMAILS.includes(String(f.email).trim().toLowerCase()) && /invalid|not-found|wrong/.test(err.code || '') && !w.querySelector('#clOwnerUp')) {
            er.insertAdjacentHTML('afterend', `<div id="clOwnerUp" class="card" style="margin-top:10px;border:1.5px solid #ff6a00"><b>First time on the cloud?</b><p class="hint" style="margin:4px 0 10px">If you have never signed in with ${esc(f.email.trim())} before, set it up now with the password you typed. If you have, tap <b>Forgot password</b> instead.</p><button type="button" class="btn pri full" id="clOwnerGo">Set up owner account</button></div>`);
            w.querySelector('#clOwnerGo').onclick = async () => {
              const pw = w.querySelector('[name=pw]').value;
              if (pw.length < 6) { er.textContent = 'Password must be at least 6 characters.'; return; }
              try { await auth.createUserWithEmailAndPassword(f.email.trim(), pw); lsSet(LS_OFFLINE, null); }
              catch (e2) { er.textContent = e2.code === 'auth/email-already-in-use' ? 'This email is already set up – the password is wrong. Tap “Forgot password” to get a reset link by email.' : authErr(e2); }
            };
          }
        }
      };
    });
  }
  async function companyScreen() {
    const em = (C.user.email || '').toLowerCase();
    if (em.endsWith('@' + ALIAS)) {   // staff username without an active membership (disabled / password was reset)
      showWrap(`<div class="card"><b>This login is not active</b><p class="hint">Username <b>${esc(shownLogin(em))}</b> has no access right now. If the owner reset your password, sign in with the new password. Otherwise ask the owner to enable you.</p></div>
        <button type="button" class="btn pri full" id="clOut" style="margin-top:10px">Sign in again</button>`, w => { w.querySelector('#clOut').onclick = () => auth.signOut(); });
      return;
    }
    let inv = null;
    try { const s = await fs.collection('invites').doc(em).get(); if (s.exists) inv = s.data(); } catch (e) {}
    showWrap(`
      <div class="card">
        <div class="hint">Signed in as</div><div style="font-weight:700;margin-bottom:10px">${esc(C.user.email)}</div>
        ${inv ? `<div style="padding:12px;border:1.5px solid #ff6a00;border-radius:12px;margin-bottom:12px"><b>You're invited</b><div class="hint" style="margin:4px 0 10px">Join <b>${esc(inv.companyName || 'the company')}</b> as <b>${esc((ROLES[inv.role] || {}).label || inv.role)}</b>.</div><button type="button" class="btn pri full" id="clJoin">Join company</button></div>` : ''}
        <b>Start your company in the cloud</b>
        <p class="hint">Creates <b>${esc(S().name)}</b> online and uploads the accounts on this phone (${db.customers.length} customers, ${db.docs.length} invoices/quotes, ${db.items.length} products). You become the owner and can invite staff.</p>
        <button type="button" class="btn ${inv ? '' : 'pri'} full" id="clCreate">Create company &amp; upload my data</button>
        <div class="cl-err" id="clErr" role="alert"></div>
        ${inv ? '' : '<p class="hint">Joining someone else\'s company? Ask the owner to invite <b>' + esc(C.user.email) + '</b> in Menu → Cloud &amp; team, then tap “Check again”.</p><button type="button" class="btn full" id="clAgain">Check again</button>'}
      </div>
      <button type="button" class="btn full" id="clOut" style="margin-top:10px">Sign out</button>`, w => {
      const er = w.querySelector('#clErr');
      w.querySelector('#clOut').onclick = () => auth.signOut();
      const again = w.querySelector('#clAgain'); if (again) again.onclick = () => companyScreen();
      const join = w.querySelector('#clJoin');
      if (join) join.onclick = async () => {
        join.disabled = true;
        try {
          await fs.collection('companies').doc(inv.cid).collection('members').doc(C.user.uid).set({role: inv.role, email: em, name: C.user.displayName || '', joined: firebase.firestore.FieldValue.serverTimestamp()});
          await fs.collection('users').doc(C.user.uid).set({cid: inv.cid, email: em}, {merge: true});
          try { await fs.collection('invites').doc(em).delete(); } catch (e) {}
          closeWrap(); attach(inv.cid, inv.role, 'download');
        } catch (e) { er.textContent = fbErr(e); join.disabled = false; }
      };
      w.querySelector('#clCreate').onclick = async ev => {
        ev.target.disabled = true; er.textContent = '';
        try {
          const ref = fs.collection('companies').doc();
          await ref.set({name: S().name, owner: C.user.uid, created: firebase.firestore.FieldValue.serverTimestamp()});
          await ref.collection('members').doc(C.user.uid).set({role: 'owner', email: em, name: C.user.displayName || '', joined: firebase.firestore.FieldValue.serverTimestamp()});
          await fs.collection('users').doc(C.user.uid).set({cid: ref.id, email: em}, {merge: true});
          closeWrap(); attach(ref.id, 'owner', 'upload');
        } catch (e) { er.textContent = fbErr(e); ev.target.disabled = false; }
      };
    });
  }

  /* ---------- Menu → Cloud & team ---------- */
  let cloudSheet = null;
  function refreshCloudSheet() { if (cloudSheet && document.body.contains(cloudSheet)) { const b = cloudSheet.querySelector('#clBody'); if (b) b.innerHTML = cloudBody(); bindCloudBody(cloudSheet); } }
  function cloudBody() {
    if (!C.enabled) return `<div class="card"><b>Cloud is not set up yet</b><p class="hint">This version of the app has no Firebase project connected. Your data is stored on this phone only.</p></div>`;
    if (!C.user) return `<div class="card"><b>Not signed in</b><p class="hint">Your data is stored on this phone only. Sign in to share it with your other devices and staff.</p><button type="button" class="btn pri full" id="clSignIn">Sign in / create account</button></div>`;
    if (!C.cid) return `<div class="card"><b>${esc(C.user.email)}</b><p class="hint">Signed in, but not linked to a company yet.</p><button type="button" class="btn pri full" id="clSetup">Set up company</button></div>`;
    return `
      <div class="card">
        <div class="hint">Company</div><div style="font-weight:800;font-size:16px">${esc((C.company && C.company.name) || S().name)}</div>
        <div style="margin-top:10px" class="hint">Signed in as</div><div><b>${esc(shownLogin(C.user.email))}</b> <span class="cl-role">${esc((ROLES[C.role] || {}).label || C.role)}</span></div>
        <div style="margin-top:12px" id="clStat">${statusHTML()}</div>
        <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="clSyncNow">Sync now</button><button type="button" class="btn" id="clMyPw">Change my password</button><button type="button" class="btn danger" id="clSignOut">Sign out</button></div>
      </div>
      ${can('team') ? `<div class="sec"><h2>Users &amp; passwords</h2></div><div class="list" id="clMembers"><div class="empty">Loading…</div></div>
      <button type="button" class="btn pri full" id="clAddUser" style="margin-top:10px">+ Add user (username &amp; password)</button>
      <p class="hint" style="margin-top:8px">${Object.entries(ROLES).map(([k, r]) => `<b>${r.label}:</b> ${r.desc}`).join('<br>')}</p>` : ''}
      <div class="sec"><h2>Web version</h2></div>
      <div class="card"><p class="hint" style="margin:0">Open the same accounts on a computer at <b>fitxqa.github.io/fitx-accounts-web</b> and sign in with the same username or email.</p></div>`;
  }
  async function loadMembers(el) {
    const box = el.querySelector('#clMembers'); if (!box) return;
    try {
      const base = fs.collection('companies').doc(C.cid);
      const [ms, inv, off] = await Promise.all([base.collection('members').get(), fs.collection('invites').where('cid', '==', C.cid).get(),
        fs.collection('logins').where('cid', '==', C.cid).where('disabled', '==', true).get().catch(() => ({forEach() {}}))]);
      const rows = [], mem = {};
      ms.forEach(d => {
        const m = Object.assign({uid: d.id}, d.data()); mem[d.id] = m;
        const me = d.id === C.user.uid;
        rows.push(`<div class="item" style="flex-wrap:wrap;gap:8px"><div class="main" style="min-width:150px"><div class="t">${esc(m.name || m.username || m.email)}${me ? ' <span class="cl-role">you</span>' : ''}</div><div class="s">${m.username ? 'Username: <b>' + esc(m.username) + '</b>' : esc(m.email)}</div></div>
          ${me ? `<span class="cl-role">${(ROLES[m.role] || {}).label || m.role}</span>` : `<select class="in" data-mem="${d.id}" aria-label="Role for ${esc(m.name || m.email)}" style="width:auto;min-height:40px">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
          ${m.username ? `<button type="button" class="btn" data-reset="${d.id}">Reset password</button><button type="button" class="btn" data-off="${d.id}">Disable</button>` : ''}<button type="button" class="btn danger" data-rm="${d.id}" aria-label="Remove ${esc(m.name || m.email)}">${ICON.trash}</button>`}</div>`);
      });
      off.forEach(d => { const m = d.data(); rows.push(`<div class="item" style="opacity:.7"><div class="main"><div class="t">${esc(m.name || d.id)}</div><div class="s">Username: <b>${esc(d.id)}</b> · <span style="color:var(--red)">disabled</span></div></div><button type="button" class="btn" data-on="${esc(d.id)}">Enable</button></div>`); });
      inv.forEach(d => { const m = d.data(); rows.push(`<div class="item"><div class="main"><div class="t">${esc(d.id)}</div><div class="s">Invited · ${esc((ROLES[m.role] || {}).label || m.role)} · waiting to sign up</div></div><button type="button" class="btn danger" data-uninv="${esc(d.id)}">Cancel</button></div>`); });
      box.innerHTML = rows.join('') || '<div class="empty">No users.</div>';
      const again = () => loadMembers(el);
      box.querySelectorAll('[data-mem]').forEach(s => s.onchange = async () => {
        const m = mem[s.dataset.mem];
        try { await base.collection('members').doc(m.uid).update({role: s.value}); if (m.username) await fs.collection('logins').doc(m.username).set({role: s.value}, {merge: true}).catch(() => {}); toast('Role updated'); } catch (e) { toast(fbErr(e)); }
        again();
      });
      box.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetUser(mem[b.dataset.reset], again));
      box.querySelectorAll('[data-off]').forEach(b => b.onclick = async () => {
        const m = mem[b.dataset.off]; if (!confirm(`Disable ${m.name || m.username}? They are signed out and cannot sign in until you enable them again.`)) return;
        try { await fs.collection('logins').doc(m.username).set({disabled: true, uid: m.uid, role: m.role, name: m.name || '', cid: C.cid, email: m.email}, {merge: true}); await base.collection('members').doc(m.uid).delete(); toast('Disabled'); } catch (e) { if (!rulesHelp(e)) toast(fbErr(e)); }
        again();
      });
      box.querySelectorAll('[data-on]').forEach(b => b.onclick = async () => {
        try {
          const d = await fs.collection('logins').doc(b.dataset.on).get(); const m = d.data();
          await base.collection('members').doc(m.uid).set({role: m.role || 'technician', email: m.email, username: b.dataset.on, name: m.name || '', joined: firebase.firestore.FieldValue.serverTimestamp()});
          await fs.collection('logins').doc(b.dataset.on).set({disabled: false}, {merge: true}); toast('Enabled');
        } catch (e) { if (!rulesHelp(e)) toast(fbErr(e)); }
        again();
      });
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
        const m = mem[b.dataset.rm]; if (!confirm(`Remove ${m.name || m.username || m.email} completely?${m.username ? ' The username can be used again later.' : ''}`)) return;
        try { await base.collection('members').doc(m.uid).delete(); if (m.username) await fs.collection('logins').doc(m.username).delete().catch(() => {}); toast('Removed'); } catch (e) { toast(fbErr(e)); }
        again();
      });
      box.querySelectorAll('[data-uninv]').forEach(b => b.onclick = async () => { try { await fs.collection('invites').doc(b.dataset.uninv).delete(); } catch (e) { toast(e.message); } again(); });
    } catch (e) { box.innerHTML = `<div class="empty">${esc(fbErr(e))}</div>`; }
  }
  function bindCloudBody(el) {
    const on = (id, fn) => { const b = el.querySelector('#' + id); if (b) b.onclick = fn; };
    on('clSignIn', () => { closeSheet(() => loginScreen('in')); });
    on('clSetup', () => { closeSheet(() => companyScreen()); });
    on('clSyncNow', async () => { await push(); toast(C.status === 'err' ? 'Sync problem: ' + C.error : 'Up to date'); refreshCloudSheet(); });
    on('clSignOut', () => C.signOut());
    on('clMyPw', () => changeMyPassword());
    on('clAddUser', () => addUser(() => loadMembers(cloudSheet)));
    on('clInvite', () => {
      openSheet('Invite staff', `
        <form id="clInvForm">
          <label class="f"><span>Their email</span><input class="in" name="email" type="email" inputmode="email" required></label>
          <label class="f"><span>Role</span><select class="in" name="role">${Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, r]) => `<option value="${k}">${r.label} — ${r.desc}</option>`).join('')}<option value="owner">Owner — ${ROLES.owner.desc}</option></select></label>
          <button class="btn pri full" type="submit">Send invite</button>
          <p class="hint">They install the app (or open the web version), tap <b>Create account</b> with this email, then tap <b>Join company</b>.</p>
        </form>`, s2 => {
        s2.querySelector('#clInvForm').onsubmit = async e => {
          e.preventDefault(); const f = formData(e.target); const em = f.email.trim().toLowerCase();
          try {
            await fs.collection('invites').doc(em).set({cid: C.cid, role: f.role, companyName: (C.company && C.company.name) || S().name, by: C.user.email, at: firebase.firestore.FieldValue.serverTimestamp()});
            const msg = `You're invited to FitX Accounts (${S().name}) as ${ROLES[f.role].label}.\n\n1. Install the FitX Accounts app or open the web version\n2. Tap "Create account" with this email: ${em}\n3. Tap "Join company"`;
            closeSheet(() => { loadMembers(cloudSheet); toast('Invite saved'); if (confirm('Send the invite instructions by WhatsApp?')) openLink('https://wa.me/?text=' + encodeURIComponent(msg)); });
          } catch (err) { toast(err.message); }
        };
      });
    });
    loadMembers(el);
  }
  C.openCloud = function () {
    cloudSheet = openSheet(C.role === 'owner' ? 'Cloud, users & passwords' : 'Cloud & team', `<div id="clBody">${cloudBody()}</div>`, el => bindCloudBody(el));
  };

  // Menu row
  /* sign out: upload anything pending, then remove this device's copy (data stays in the cloud) */
  C.signOut = async function () {
    if (!auth || !C.user) return;
    if (!confirm('Sign out of ' + C.user.email + '?\n\nYour accounts stay safe in the cloud. This device\'s copy is removed — sign in again to see it.')) return;
    toast('Signing out…');
    try { if (C.cid && C.ready) { clearTimeout(pushTimer); await push(); } } catch (e) {}
    if (C.status === 'err' && !confirm('Some changes could not be uploaded (' + (C.error || 'no connection') + ').\nSign out anyway and lose them?')) return;
    try { stopListeners(); } catch (e) {}
    try { await auth.signOut(); } catch (e) {}
    try { await fs.terminate(); await fs.clearPersistence(); } catch (e) {}
    try { [KEY, LS_LINK, KEY + '_beforeCloud', KEY + '_lastBackup'].forEach(k => localStorage.removeItem(k)); localStorage.removeItem(LS_OFFLINE); } catch (e) {}
    location.reload();
  };
  // side bar (computer / tablet): who is signed in + sign out
  function sideAccount() {
    const sf = document.getElementById('sideFoot'); if (!sf) return;
    let box = sf.querySelector('.cl-acct');
    if (!C.enabled) { if (box) box.remove(); return; }
    if (!box) { sf.insertAdjacentHTML('beforeend', '<div class="cl-acct" style="margin-top:10px"></div>'); box = sf.querySelector('.cl-acct'); }
    box.innerHTML = C.user
      ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(C.user.email)}">${esc(C.user.email)}</div><button type="button" class="btn" id="sideOut" style="margin-top:6px;min-height:36px;width:100%;font-size:13px">Sign out</button>`
      : `<button type="button" class="btn pri" id="sideIn" style="margin-top:6px;min-height:36px;width:100%;font-size:13px">Sign in</button>`;
    const o = box.querySelector('#sideOut'); if (o) o.onclick = () => C.signOut();
    const i = box.querySelector('#sideIn'); if (i) i.onclick = () => loginScreen('in');
  }
  const origMore = window.viewMore;
  window.viewMore = function () {
    origMore();
    const list = document.querySelector('#main .list');
    const s = document.querySelector('#main .sec');
    if (!s) return;
    const sub = !C.enabled ? 'Not set up' : !C.user ? 'Sign in to sync phones, computers and staff' : !C.cid ? 'Set up your company' : `${(ROLES[C.role] || {}).label} · ${C.status === 'ok' ? 'synced' : C.status === 'err' ? 'sync problem' : 'syncing'}`;
    s.insertAdjacentHTML('beforebegin', `<div class="list" style="margin-top:12px"><button type="button" class="item rcard" id="mCloud"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/></svg></span><div class="main"><div class="t">${C.role === 'owner' ? 'Cloud, users &amp; passwords' : 'Cloud &amp; my password'}</div><div class="s">${esc(sub)}</div></div></button></div>`);
    document.getElementById('mCloud').onclick = () => C.openCloud();
    if (C.role === 'technician') document.querySelectorAll('#main .sec').forEach(sec => {
      const l = sec.nextElementSibling;
      if (l && l.classList.contains('list') && !Array.from(l.children).some(x => getComputedStyle(x).display !== 'none')) { sec.classList.add('cl-hide-tech'); l.classList.add('cl-hide-tech'); }
    });
    const foot = Array.from(document.querySelectorAll('#main > p.hint')).pop();
    if (foot && C.cid) foot.textContent = 'Data is saved on this device and synced to the cloud.';
    if (C.enabled) {
      const where = foot || document.querySelector('#main').lastElementChild;
      where.insertAdjacentHTML('beforebegin', C.user
        ? `<div class="list" style="margin-top:16px"><button type="button" class="item rcard" id="mSignOut"><span class="ic" style="color:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/></svg></span><div class="main"><div class="t" style="color:var(--red)">Sign out</div><div class="s">${esc(C.user.email)}</div></div></button></div>`
        : `<div class="list" style="margin-top:16px"><button type="button" class="item rcard" id="mSignIn"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M14 17l5-5-5-5M19 12H8"/></svg></span><div class="main"><div class="t">Sign in</div><div class="s">Use the cloud: phones, computer and staff</div></div></button></div>`);
      const so = document.getElementById('mSignOut'); if (so) so.onclick = () => C.signOut();
      const si = document.getElementById('mSignIn'); if (si) si.onclick = () => loginScreen('in');
    }
  };
  const origRender = window.render;
  window.render = function () { if (!can(state.tab)) state.tab = 'home'; origRender(); if (C.cid) setStatus(C.status); sideAccount(); };

  /* ---------- start ---------- */
  if (!C.enabled) return;
  try {
    firebase.initializeApp(CFG);
    auth = firebase.auth(); fs = firebase.firestore();
    fs.enablePersistence({synchronizeTabs: true}).catch(() => {});
  } catch (e) { C.enabled = false; C.error = e.message; return; }
  C._fs = fs; C._auth = auth; C._push = push; C._shadow = () => shadow;

  auth.onAuthStateChanged(async user => {
    C.user = user;
    if (!user) {
      detach();
      if (!lsGet(LS_OFFLINE)) loginScreen('in');
      render();
      return;
    }
    closeWrap();
    let cid = null, role = null;
    try {
      const u = await fs.collection('users').doc(user.uid).get();
      cid = u.exists ? u.data().cid : null;
      if (cid) {
        const m = await fs.collection('companies').doc(cid).collection('members').doc(user.uid).get();
        role = m.exists ? m.data().role : null;
        if (!role) cid = null;
      }
    } catch (e) {
      // offline at start: use the last company this device was linked to
      const l = lsGet(LS_LINK);
      if (l && l.uid === user.uid) { cid = l.cid; role = l.role || null; }
    }
    if (!cid) { companyScreen(); return; }
    attach(cid, role, 'auto'); // remembers the link once the data is in place
  });
})();
