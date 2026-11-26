/* FitX Accounts — caller ID (Android app only).
   Keeps a small list on the phone: mobile number → name + open work orders / balance / AMC, so that when a customer
   calls, the Android side (CallReceiver) can show a card over the ringing screen before you answer.
   The list is rebuilt a moment after every save. Settings: More → Caller ID. */
(function () {
  'use strict';
  const AB = window.AndroidBridge;
  if (!AB || typeof AB.setCallers !== 'function') return;   // web version / older app: nothing to do
  const key = n => { const d = String(n || '').replace(/\D/g, ''); return d.length > 8 ? d.slice(-8) : d; };
  const daysAgo = d => { const n = Math.round((new Date(today() + 'T00:00:00') - new Date(String(d) + 'T00:00:00')) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'since yesterday' : `since ${n} days`; };
  const ST = {open: 'Open', assigned: 'Assigned', progress: 'In progress', parts: 'Waiting for parts', approval: 'Waiting for approval', hold: 'On hold', done: 'Completed', cancelled: 'Cancelled'};
  const ACTIVE = ['open', 'assigned', 'progress', 'parts', 'approval', 'hold'];
  const emp = id => ((db.employees || []).find(e => e.id === id) || {}).name || '';

  function woLines(list) {
    const act = list.filter(w => ACTIVE.includes(w.status)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const out = [];
    act.slice(0, 3).forEach(w => {
      out.push(`🔧 ${w.number} · ${ST[w.status] || w.status}${emp(w.techId) ? ' · ' + emp(w.techId).split(' ')[0] : ''} · ${daysAgo(w.date)}`);
      // machine and the problem the customer reported
      (w.equipment || []).filter(e => e.desc || e.problem).slice(0, act.length > 1 ? 1 : 2).forEach(e => {
        const m = [e.desc, e.brand, e.model].map(x => String(x || '').trim()).filter(Boolean).join(' ');
        out.push('   ' + (m || 'Machine') + (String(e.problem || '').trim() ? ' – ' + String(e.problem).trim() : ''));
      });
      // what the technician has done so far
      const done = String(w.work || '').trim().split('\n')[0];
      if (done) out.push('   ✔ ' + (done.length > 90 ? done.slice(0, 88) + '…' : done));
    });
    if (!act.length) { const last = list.filter(w => w.status === 'done').sort((a, b) => String(b.doneDate || b.date).localeCompare(String(a.doneDate || a.date)))[0]; if (last) out.push(`Last job ${last.number} · completed ${dfmt(last.doneDate || last.date)}`); }
    return {lines: out, open: act[0]};
  }
  // upcoming appointments (booked, no work order yet)
  const t12 = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return ' ' + h + ':' + m[2] + ' ' + ap; };
  const apFirst = match => { const l = (db.appointments || []).filter(a => a.status !== 'cancelled' && a.date >= today() && !(db.workorders || []).some(w => w.apptId === a.id && w.status !== 'cancelled') && match(a)).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))); return l[0]; };
  function apLines(match) {
    const wos = db.workorders || [];
    return (db.appointments || []).filter(a => a.status !== 'cancelled' && a.date >= today() && !wos.some(w => w.apptId === a.id && w.status !== 'cancelled') && match(a))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 2)
      .reduce((out, a) => { out.push(`📅 ${a.number} · ${a.date === today() ? 'today' : dfmt(a.date)}${t12(a.time)}${emp(a.techId) ? ' · ' + emp(a.techId).split(' ')[0] : ''}`);
        const j = [a.machine, a.problem].map(x => String(x || '').trim()).filter(Boolean).join(' – '); if (j) out.push('   ' + j); return out; }, []);
  }
  function build() {
    const idx = {}, wos = db.workorders || [];
    const put = (phone, rec) => { const k = key(phone); if (k.length >= 7 && !idx[k]) idx[k] = rec; };
    db.customers.forEach(c => {
      if (c.homeVisits || !c.phone) return;
      const w = woLines(wos.filter(x => x.kind !== 'home' && x.customerId === c.id));
      const lines = w.lines.concat(apLines(a => a.kind !== 'home' && a.customerId === c.id));
      const bal = custBalance(c.id); if (bal > 0.004) lines.push(`Balance due QAR ${fmt(bal)}`);
      const amc = (db.amcs || []).find(a => a.customerId === c.id && !a.cancelled && a.end >= today()); if (amc) lines.push(`AMC ${amc.number} until ${dfmt(amc.end)}`);
      if (!lines.length) lines.push('No open work orders');
      const rec = {n: c.name, k: 'Customer', l: lines, o: w.open ? 'wo:' + w.open.id : (apFirst(a => a.kind !== 'home' && a.customerId === c.id) ? 'apt:' + apFirst(a => a.kind !== 'home' && a.customerId === c.id).id : 'cust:' + c.id)};
      String(c.phone).split(/[\/,;]| or /).forEach(ph => put(ph, rec));
    });
    (db.homeclients || []).forEach(h => {
      const w = woLines(wos.filter(x => x.kind === 'home' && key((x.home || {}).phone) === key(h.phone)));
      const lines = w.lines.concat(apLines(a => a.kind === 'home' && key((a.home || {}).phone) === key(h.phone)));
      if (String(h.area || '').trim()) lines.push('📍 ' + String(h.area).trim());   // area only – the full address is on the work order
      if (!lines.length) lines.push('Home visit client');
      put(h.phone, {n: h.name || h.phone, k: 'Home visit client', l: lines, o: w.open ? 'wo:' + w.open.id : (apFirst(a => a.kind === 'home' && key((a.home || {}).phone) === key(h.phone)) ? 'apt:' + apFirst(a => a.kind === 'home' && key((a.home || {}).phone) === key(h.phone)).id : 'newwo:' + h.phone)});
    });
    (db.appointments || []).filter(a => a.kind === 'home' && a.status !== 'cancelled' && (a.home || {}).phone).forEach(a => {
      const h = a.home, lines = apLines(x => x.kind === 'home' && key((x.home || {}).phone) === key(h.phone));
      if (!lines.length) return;
      if (String(h.area || '').trim()) lines.push('📍 ' + String(h.area).trim());
      put(h.phone, {n: h.name || h.phone, k: 'Home visit client', l: lines, o: 'apt:' + a.id});
    });
    db.suppliers.forEach(s => { if (s.phone) put(s.phone, {n: s.name, k: 'Supplier', l: [supBalance(s.id) > 0.004 ? `You owe QAR ${fmt(supBalance(s.id))}` : 'Supplier'], o: 'sup:' + s.id}); });
    (db.employees || []).forEach(e => { if (e.phone && (!e.left || e.left >= today())) put(e.phone, {n: e.name, k: 'Staff', l: [e.job || 'Employee'].concat(wos.filter(w => w.techId === e.id && ACTIVE.includes(w.status)).length ? [`${wos.filter(w => w.techId === e.id && ACTIVE.includes(w.status)).length} open work orders`] : []), o: ''}); });
    return idx;
  }
  let timer = null;
  const sync = () => { clearTimeout(timer); timer = setTimeout(() => { try { AB.setCallers(JSON.stringify(build())); } catch (e) { console.warn('caller id', e); } }, 1500); };
  const origSave = window.save;
  if (origSave) window.save = function () { const r = origSave.apply(this, arguments); sync(); return r; };
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(sync);
  setTimeout(sync, 2500);

  // a tap on the card opens the job / customer
  const origOpen = window.fitxOpen;
  window.fitxOpen = function (what) {
    const [t, id] = String(what || '').split(/:(.*)/);
    const clear = () => { while (typeof sheets !== 'undefined' && sheets.length) closeTopSheet(); };
    if (t === 'wo' && window.FitxWO) { clear(); FitxWO.view(id); return; }
    if (t === 'cust' && window.viewCustomer) { clear(); viewCustomer(id); return; }
    if (t === 'sup' && window.viewSupplier) { clear(); viewSupplier(id); return; }
    if (t === 'apt' && window.FitxSchedule) { clear(); FitxSchedule.viewAppt(id); return; }
    if (t === 'newwo' && window.FitxWO) { clear(); const h = (db.homeclients || []).find(x => key(x.phone) === key(id)) || {phone: id}; FitxWO.edit(null, {kind: 'home', home: Object.assign({}, h)}); return; }
    if (origOpen) origOpen(what);
  };

  function status() { try { return JSON.parse(AB.callerStatus()); } catch (e) { return {}; } }
  function settings() {
    const draw = el => {
      const s = status(), n = Object.keys(build()).length;
      const row = (ok, t, d, btn, id) => `<div class="item" style="gap:10px"><span style="font-size:20px">${ok ? '✅' : '⚠️'}</span><div class="main"><div class="t">${t}</div><div class="s">${d}</div></div>${ok ? '' : `<button type="button" class="btn pri" id="${id}" style="flex:0 0 auto;min-height:38px;padding:6px 14px">${btn}</button>`}</div>`;
      el.querySelector('#ciBody').innerHTML = `
        <p class="hint" style="margin-top:0">When someone calls this phone, FitX shows who it is and their open work orders, balance and AMC – before you answer. ${n} phone numbers are known (customers, home-visit clients, suppliers, staff).</p>
        <label class="item" style="gap:10px;cursor:pointer"><input type="checkbox" id="ciOn" ${s.on ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--orange)"><div class="main"><div class="t">Show caller card</div><div class="s">Turn off any time</div></div></label>
        <div class="sec"><h2>Allow once</h2></div>
        <div class="list">${row(s.phone, 'Phone &amp; call log', 'So the app can see the number that is calling', 'Allow', 'ciPhone')}
          ${row(s.overlay, 'Display over other apps', 'So the card shows on the ringing screen (otherwise a notification is shown)', 'Open settings', 'ciOv')}
          ${row(s.notif, 'Notifications', 'Used when the card cannot be shown', 'Allow', 'ciNt')}</div>
        <div class="sec"><h2>Try it</h2></div>
        <div class="row" style="align-items:end"><label class="f"><span>Customer mobile</span><input class="in" id="ciNum" inputmode="tel" placeholder="e.g. 5555 1234"></label><button type="button" class="btn" id="ciTest" style="margin-bottom:12px;flex:0 0 auto">Show card</button></div>
        <div class="hint" id="ciRes" style="margin:-4px 2px 10px;color:var(--text)"></div>
        <p class="hint">Works for calls to this phone's SIM numbers. Calls that come in through the Linkus (Yeastar) app are internet calls and can't be read by other apps.</p>`;
      el.querySelector('#ciOn').onchange = e => { AB.callerEnable(e.target.checked); toast(e.target.checked ? 'Caller card on' : 'Caller card off'); };
      const ph = el.querySelector('#ciPhone'); if (ph) ph.onclick = () => AB.callerAskPhone();
      const nt = el.querySelector('#ciNt'); if (nt) nt.onclick = () => AB.callerAskPhone();
      const ov = el.querySelector('#ciOv'); if (ov) ov.onclick = () => AB.callerAskOverlay();
      el.querySelector('#ciTest').onclick = () => {
        try { AB.setCallers(JSON.stringify(build())); } catch (e) {}
        const v = el.querySelector('#ciNum').value.trim(); if (!v) { toast('Type a customer mobile number first'); return; }
        const r = String(AB.callerTest(v));
        const msg = r === 'nomatch' || r === 'false' ? 'That number is not saved on any customer, home client, supplier or employee in FitX.'
          : r === 'notification' ? 'Shown as a notification – switch on “Display over other apps” to get the card on the call screen.'
          : r.startsWith('error') ? 'Android blocked the card (' + r.slice(6).trim() + '). A notification was shown instead.'
          : 'Card shown at the top of the screen.';
        el.querySelector('#ciRes').textContent = msg;
      };
    };
    openSheet('Caller ID', '<div id="ciBody"></div>', el => {
      draw(el);
      // permissions are granted in Android screens; refresh when the user comes back
      const re = () => { if (document.visibilityState === 'visible' && document.body.contains(el)) draw(el); };
      document.addEventListener('visibilitychange', re);
      const iv = setInterval(() => { if (!document.body.contains(el)) { clearInterval(iv); document.removeEventListener('visibilitychange', re); } }, 2000);
    });
  }

  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mWO') || document.querySelector('#main .item.rcard');
    if (!a || document.getElementById('mCid')) return;
    const s = status(), ready = s.on && s.phone;
    a.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mCid"><span class="ic">📞</span><div class="main"><div class="t">Caller ID</div><div class="s">${ready ? 'On · shows the customer & work order status when they call' : 'Show the customer & work order status when they call'}</div></div></button>`);
    document.getElementById('mCid').onclick = settings;
  };
  window.FitxCaller = {settings, build, sync};
})();
