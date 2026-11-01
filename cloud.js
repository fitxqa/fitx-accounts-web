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
      'auth/invalid-credential': 'Email or password is wrong.',
      'auth/invalid-login-credentials': 'Email or password is wrong.',
      'auth/email-already-in-use': 'An account with this email already exists. Tap “Sign in”.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/network-request-failed': 'No internet connection.',
      'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
      'auth/operation-not-allowed': 'Email sign-in is not turned on in Firebase (Authentication → Email/Password).'
    })[c] || (e && e.message) || 'Something went wrong.';
  }
  function loginScreen(mode) {
    mode = mode || 'in';
    showWrap(`
      <div class="cl-tabs" role="tablist"><button type="button" data-m="in" class="${mode === 'in' ? 'on' : ''}">Sign in</button><button type="button" data-m="up" class="${mode === 'up' ? 'on' : ''}">Create account</button></div>
      <form id="clForm" class="card" autocomplete="on">
        ${mode === 'up' ? '<label class="f"><span>Your name</span><input class="in" name="name" autocomplete="name" required></label>' : ''}
        <label class="f"><span>Email</span><input class="in" name="email" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="f"><span>Password</span><input class="in" name="pw" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="6" required></label>
        <div class="cl-err" id="clErr" role="alert"></div>
        <button class="btn pri full" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
        ${mode === 'in' ? '<button type="button" class="btn full" id="clForgot" style="margin-top:8px">Forgot password</button>' : ''}
      </form>
      <p class="hint" style="text-align:center;margin:18px 6px 8px">Sign in to share your accounts between phones, computers and staff.</p>
      <button type="button" class="btn full" id="clLocal">Use on this phone only (no cloud)</button>`, w => {
      w.querySelectorAll('[data-m]').forEach(b => b.onclick = () => loginScreen(b.dataset.m));
      w.querySelector('#clLocal').onclick = () => { lsSet(LS_OFFLINE, true); closeWrap(); toast('Working on this phone only. Turn on cloud in Menu → Cloud & team.'); };
      const fp = w.querySelector('#clForgot');
      if (fp) fp.onclick = async () => {
        const em = w.querySelector('[name=email]').value.trim();
        if (!em) { w.querySelector('#clErr').textContent = 'Type your email first.'; return; }
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
          } else await auth.signInWithEmailAndPassword(f.email.trim(), f.pw);
          lsSet(LS_OFFLINE, null);
        } catch (err) { er.textContent = authErr(err); btn.disabled = false; }
      };
    });
  }
  async function companyScreen() {
    const em = (C.user.email || '').toLowerCase();
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
        <div style="margin-top:10px" class="hint">Signed in as</div><div><b>${esc(C.user.email)}</b> <span class="cl-role">${esc((ROLES[C.role] || {}).label || C.role)}</span></div>
        <div style="margin-top:12px" id="clStat">${statusHTML()}</div>
        <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="clSyncNow">Sync now</button><button type="button" class="btn danger" id="clSignOut">Sign out</button></div>
      </div>
      ${can('team') ? `<div class="sec"><h2>Team</h2></div><div class="list" id="clMembers"><div class="empty">Loading…</div></div>
      <button type="button" class="btn pri full" id="clInvite" style="margin-top:10px">+ Invite staff</button>
      <p class="hint" style="margin-top:8px">${Object.entries(ROLES).map(([k, r]) => `<b>${r.label}:</b> ${r.desc}`).join('<br>')}</p>` : ''}
      <div class="sec"><h2>Web version</h2></div>
      <div class="card"><p class="hint" style="margin:0">Open the same accounts on a computer at your FitX website (e.g. <b>www.fitx.qa/accounts</b>) and sign in with the same email.</p></div>`;
  }
  async function loadMembers(el) {
    const box = el.querySelector('#clMembers'); if (!box) return;
    try {
      const base = fs.collection('companies').doc(C.cid);
      const [ms, inv] = await Promise.all([base.collection('members').get(), fs.collection('invites').where('cid', '==', C.cid).get()]);
      const rows = [];
      ms.forEach(d => { const m = d.data(); rows.push(`<div class="item"><div class="main"><div class="t">${esc(m.name || m.email)}</div><div class="s">${esc(m.email)}</div></div>${d.id === C.user.uid ? `<span class="cl-role">${ROLES[m.role].label} · you</span>` : `<select class="in" data-mem="${d.id}" aria-label="Role for ${esc(m.email)}" style="width:auto;min-height:40px">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${r.label}</option>`).join('')}<option value="__remove">Remove</option></select>`}</div>`); });
      inv.forEach(d => { const m = d.data(); rows.push(`<div class="item"><div class="main"><div class="t">${esc(d.id)}</div><div class="s">Invited · ${esc((ROLES[m.role] || {}).label || m.role)} · waiting to sign up</div></div><button type="button" class="btn danger" data-uninv="${esc(d.id)}">Cancel</button></div>`); });
      box.innerHTML = rows.join('') || '<div class="empty">No members.</div>';
      box.querySelectorAll('[data-mem]').forEach(s => s.onchange = async () => {
        const ref = base.collection('members').doc(s.dataset.mem);
        try {
          if (s.value === '__remove') { if (!confirm('Remove this person from the company?')) { loadMembers(el); return; } await ref.delete(); toast('Removed'); }
          else { await ref.update({role: s.value}); toast('Role updated'); }
        } catch (e) { toast(e.message); }
        loadMembers(el);
      });
      box.querySelectorAll('[data-uninv]').forEach(b => b.onclick = async () => { try { await fs.collection('invites').doc(b.dataset.uninv).delete(); } catch (e) { toast(e.message); } loadMembers(el); });
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function bindCloudBody(el) {
    const on = (id, fn) => { const b = el.querySelector('#' + id); if (b) b.onclick = fn; };
    on('clSignIn', () => { closeSheet(() => loginScreen('in')); });
    on('clSetup', () => { closeSheet(() => companyScreen()); });
    on('clSyncNow', async () => { await push(); toast(C.status === 'err' ? 'Sync problem: ' + C.error : 'Up to date'); refreshCloudSheet(); });
    on('clSignOut', () => {
      if (!confirm('Sign out? The data stays on this phone, but will not sync until you sign in again.')) return;
      lsSet(LS_LINK, null); detach(); auth.signOut(); closeSheet(render);
    });
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
    cloudSheet = openSheet('Cloud & team', `<div id="clBody">${cloudBody()}</div>`, el => bindCloudBody(el));
  };

  // Menu row
  const origMore = window.viewMore;
  window.viewMore = function () {
    origMore();
    const list = document.querySelector('#main .list');
    const s = document.querySelector('#main .sec');
    if (!s) return;
    const sub = !C.enabled ? 'Not set up' : !C.user ? 'Sign in to sync phones, computers and staff' : !C.cid ? 'Set up your company' : `${(ROLES[C.role] || {}).label} · ${C.status === 'ok' ? 'synced' : C.status === 'err' ? 'sync problem' : 'syncing'}`;
    s.insertAdjacentHTML('beforebegin', `<div class="list" style="margin-top:12px"><button type="button" class="item rcard" id="mCloud"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/></svg></span><div class="main"><div class="t">Cloud &amp; team</div><div class="s">${esc(sub)}</div></div></button></div>`);
    document.getElementById('mCloud').onclick = () => C.openCloud();
    if (C.role === 'technician') document.querySelectorAll('#main .sec').forEach(sec => {
      const l = sec.nextElementSibling;
      if (l && l.classList.contains('list') && !Array.from(l.children).some(x => getComputedStyle(x).display !== 'none')) { sec.classList.add('cl-hide-tech'); l.classList.add('cl-hide-tech'); }
    });
    const foot = Array.from(document.querySelectorAll('#main > p.hint')).pop();
    if (foot && C.cid) foot.textContent = 'Data is saved on this device and synced to the cloud.';
  };
  const origRender = window.render;
  window.render = function () { if (!can(state.tab)) state.tab = 'home'; origRender(); if (C.cid) setStatus(C.status); };

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
