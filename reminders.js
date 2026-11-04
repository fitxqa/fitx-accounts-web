/* FitX Accounts — customer service reminders after an invoice (1, 2, 3, 6, 9, 12 months).
   Each invoice keeps d.remind = [months…] and d.remSent = {months: 'yyyy-mm-dd' | 'skip:yyyy-mm-dd'}.
   Due reminders show on the dashboard every day; the Android app also gets a daily 9 AM notification.
   Sending opens WhatsApp with the message written; one tap sends it. */
(function () {
  'use strict';
  const OPTS = [1, 2, 3, 6, 9, 12];
  const DEF_MSG = 'Dear {customer},\n\nGreetings from {company}. It has been {period} since we serviced your {equipment} (invoice {invoice} on {date}).\n\nRegular servicing keeps your equipment safe, smooth and avoids costly breakdowns. Shall we book your next service visit? Just reply to this message or call us on {phone}.\n\nThank you,\n{company}';
  const R = () => { const s = S(); s.remind = s.remind || {}; return s.remind; };
  const period = m => m === 12 ? '1 year' : m === 1 ? '1 month' : m + ' months';
  const label = m => m === 12 ? '12-month (yearly) service' : m + '-month service';
  const addMonths = (iso, m) => {
    const [y, mo, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, mo - 1 + m, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  };
  const baseDate = d => (d.wcr && d.wcr.on && d.wcr.date) || d.date;
  const equipOf = d => {
    const l = (d.lines || []).find(x => x.brand || x.model) || (d.lines || []).find(x => !x.sub) || {};
    const eq = [l.brand, l.model].filter(Boolean).join(' ');
    return eq || (d.subject ? d.subject.replace(/\s*[–-].*$/, '') : '') || 'gym equipment';
  };

  /* ---------- the list ---------- */
  function all() {
    const out = [];
    (db.docs || []).forEach(d => {
      if (d.type !== 'INV' || d.cancelled || !Array.isArray(d.remind) || !d.remind.length) return;
      const c = custById(d.customerId) || {};
      if (c.noRemind) return;
      d.remind.forEach(m => {
        const st = (d.remSent || {})[m] || '';
        out.push({d, m, c, due: addMonths(baseDate(d), m), sent: st && !st.startsWith('skip') ? st : '', skipped: st.startsWith('skip') ? st.slice(5) : ''});
      });
    });
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }
  const pending = () => all().filter(r => !r.sent && !r.skipped);
  const dueNow = () => pending().filter(r => r.due <= today());

  function message(r) {
    const s = S();
    return (R().msg || DEF_MSG)
      .replace(/\{customer\}/g, r.c.contact || r.c.name || 'Customer')
      .replace(/\{company\}/g, s.name || 'FitX')
      .replace(/\{period\}/g, period(r.m))
      .replace(/\{equipment\}/g, equipOf(r.d))
      .replace(/\{invoice\}/g, r.d.number || '')
      .replace(/\{date\}/g, dfmt(baseDate(r.d)))
      .replace(/\{phone\}/g, s.phone || '');
  }
  function send(r) {
    const n = waNumber(r.c.phone || '');
    if (!n) { toast('No mobile number for ' + (r.c.name || 'this customer') + ' – add it to the customer first'); return false; }
    openLink(`https://wa.me/${n}?text=${encodeURIComponent(message(r))}`);
    mark(r, today());
    return true;
  }
  function mark(r, val) {
    r.d.remSent = r.d.remSent || {};
    if (val === null) delete r.d.remSent[r.m]; else r.d.remSent[r.m] = val;
    r.d.updated = Date.now();
    save();
  }

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .rmchips{display:flex;flex-wrap:wrap;gap:8px}
    .rmchips button{border:1px solid var(--line2);background:var(--card);border-radius:999px;padding:8px 14px;font-weight:700;font-size:13px;min-height:40px;color:var(--text)}
    .rmchips button.on{background:var(--orange);border-color:var(--orange);color:#fff}
    .rmcard{background:#fff7f0;border:1px solid #ffd2b0;border-radius:var(--r);padding:14px;margin-bottom:14px;box-shadow:var(--sh)}
    .rmcard h3{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px}
    .rmcard .rmrow{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #ffe2cc}
    .rmcard .rmrow:first-of-type{border-top:0}
    .rmrow .main{flex:1;min-width:0}
    .rmrow .t{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .rmrow .s{font-size:12px;color:var(--muted)}
    .rmrow .btn{min-height:38px;padding:4px 12px;font-size:13px;white-space:nowrap}
    .btn.wa{background:#25d366;border-color:#25d366;color:#fff}
    .rmpanel{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-top:12px}
    .rmpanel .hint{margin:6px 0 0}`;
  document.head.appendChild(css);
  const icBell = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const icWa = (window.ICON && ICON.wa) || '';
  // drop-down list of common schedules, with "Custom…" for any mix of months
  const PRESETS = [['none', 'None – no reminder', []], ['1', 'After 1 month', [1]], ['2', 'After 2 months', [2]], ['3', 'After 3 months', [3]], ['6', 'After 6 months', [6]], ['9', 'After 9 months', [9]], ['12', 'After 12 months (yearly)', [12]],
    ['q', 'Every 3 months (3, 6, 9, 12)', [3, 6, 9, 12]], ['h', 'Every 6 months (6, 12)', [6, 12]], ['m', '1, 3, 6 & 12 months', [1, 3, 6, 12]], ['all', 'All (1, 2, 3, 6, 9, 12 months)', [1, 2, 3, 6, 9, 12]], ['c', 'Custom…', null]];
  const presetOf = sel => { const k = sel.slice().sort((a, b) => a - b).join(','); const p = PRESETS.find(x => x[2] && x[2].join(',') === k); return p ? p[0] : 'c'; };
  const chipsHTML = (sel) => { const cur = presetOf(sel);
    return `<select class="in rmsel" aria-label="Service reminder">${PRESETS.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="rmchips ${cur === 'c' ? '' : 'hidden'}" style="margin-top:8px">${OPTS.map(m => `<button type="button" data-rmm="${m}" class="${sel.includes(m) ? 'on' : ''}">${m === 12 ? '12 months' : m === 1 ? '1 month' : m + ' months'}</button>`).join('')}</div>`; };
  const bindChips = (el, arr, onChange) => {
    const selEl = el.querySelector('.rmsel'), chips = el.querySelector('.rmchips');
    const syncChips = () => chips.querySelectorAll('[data-rmm]').forEach(b => b.classList.toggle('on', arr.includes(+b.dataset.rmm)));
    if (selEl) selEl.onchange = () => {
      const p = PRESETS.find(x => x[0] === selEl.value);
      chips.classList.toggle('hidden', selEl.value !== 'c');
      if (p && p[2]) { arr.splice(0, arr.length, ...p[2]); syncChips(); }
      if (onChange) onChange();
    };
    chips.querySelectorAll('[data-rmm]').forEach(b => b.onclick = () => {
      const m = +b.dataset.rmm, i = arr.indexOf(m);
      if (i >= 0) arr.splice(i, 1); else arr.push(m);
      arr.sort((x, y) => x - y); syncChips(); if (onChange) onChange();
    });
  };

  /* ---------- invoice editor panel ---------- */
  window.remindPanel = function (draft, isNew) {
    const cu = custById(draft.customerId);
    if (!Array.isArray(draft.remind)) draft.remind = isNew && !(cu && cu.noRemind) ? (R().defaults || []).slice() : [];
    return `<div class="rmpanel" id="rmPanel"><div style="font-weight:800;display:flex;gap:8px;align-items:center;margin-bottom:8px">${icBell}Service reminders (WhatsApp)</div>
      ${chipsHTML(draft.remind)}<p class="hint" id="rmHint"></p></div>`;
  };
  window.bindRemind = function (el, draft) {
    const p = el.querySelector('#rmPanel'); if (!p) return;
    const hint = () => {
      const base = (el.querySelector('[name=rDate]') && el.querySelector('#rOn') && el.querySelector('#rOn').checked && el.querySelector('[name=rDate]').value) || el.querySelector('[name=date]').value || today();
      p.querySelector('#rmHint').textContent = draft.remind.length ? 'Remind the customer on: ' + draft.remind.map(m => dfmt(addMonths(base, m))).join(', ') : 'Choose when the customer should get a service reminder.';
    };
    bindChips(p, draft.remind, hint); hint();
    const dt = el.querySelector('[name=date]'); if (dt) dt.addEventListener('change', hint);
    // customer set to "No service reminders": switch to None when chosen; otherwise use the default for a new invoice
    const cs = el.querySelector('#dCust');
    const note = () => { const c = custById(cs.value); let n = p.querySelector('.rmno'); if (c && c.noRemind) { if (!n) p.insertAdjacentHTML('beforeend', '<p class="hint rmno" style="color:var(--orange-d)">This customer is set to “No service reminders”.</p>'); } else if (n) n.remove(); };
    if (cs) cs.addEventListener('change', () => {
      const c = custById(cs.value), sel = p.querySelector('.rmsel');
      if (c && c.noRemind) { draft.remind.splice(0); }
      else if (!draft.remind.length && !draft.id) draft.remind.splice(0, 0, ...(R().defaults || []));
      if (sel) { sel.value = presetOf(draft.remind); sel.dispatchEvent(new Event('change')); }
      note(); hint();
    });
    if (cs) note();
  };

  /* ---------- dashboard card (every day while something is due) ---------- */
  function rowHTML(r, i) {
    const late = r.due < today() ? Math.round((new Date(today()) - new Date(r.due)) / 864e5) : 0;
    return `<div class="rmrow"><div class="main"><div class="t">${esc(r.c.name || 'Customer')}</div><div class="s">${label(r.m)} · ${esc(r.d.number)} · ${late ? `<b style="color:var(--red)">${late} day${late > 1 ? 's' : ''} late</b>` : 'due today'}</div></div>
      <button type="button" class="btn wa" data-rmsend="${i}">${icWa}WhatsApp</button><button type="button" class="btn" data-rmskip="${i}" aria-label="Skip this reminder">Skip</button></div>`;
  }
  function dashCard() {
    const list = dueNow(); if (!list.length) return '';
    const show = list.slice(0, 5);
    return `<div class="rmcard" id="rmDash"><h3>${icBell}Service reminders due today (${list.length})</h3><div class="hint" style="margin-bottom:6px">Send each customer a WhatsApp reminder to book their service.</div>
      ${show.map(rowHTML).join('')}${list.length > show.length ? `<button type="button" class="btn full" id="rmAll" style="margin-top:8px">See all ${list.length} reminders</button>` : `<button type="button" class="lnk" id="rmAll" style="margin-top:6px">All reminders ›</button>`}</div>`;
  }
  function bindRows(root, list, redraw) {
    root.querySelectorAll('[data-rmsend]').forEach(b => b.onclick = () => { if (send(list[+b.dataset.rmsend])) { toast('Reminder opened in WhatsApp'); redraw(); } });
    root.querySelectorAll('[data-rmskip]').forEach(b => b.onclick = () => { mark(list[+b.dataset.rmskip], 'skip:' + today()); toast('Reminder skipped'); redraw(); });
  }
  const origHome = window.viewHome;
  if (origHome) window.viewHome = function () {
    origHome();
    const h = dashCard(); if (!h) return;
    const main = document.getElementById('main'); if (!main) return;
    main.insertAdjacentHTML('afterbegin', h);
    const card = document.getElementById('rmDash');
    bindRows(card, dueNow().slice(0, 5), () => render());
    card.querySelector('#rmAll').onclick = () => goTab('reminders');
  };

  /* ---------- reminders screen ---------- */
  function viewReminders() {
    const tab = state.rmTab || 'due';
    setTop('Service reminders', 'Settings', remindSettings);
    const A = all(), t = today();
    const lists = {due: A.filter(r => !r.sent && !r.skipped && r.due <= t), up: A.filter(r => !r.sent && !r.skipped && r.due > t), done: A.filter(r => r.sent || r.skipped).reverse()};
    const list = lists[tab];
    $('#main').innerHTML = `
      ${KP([['Due now', String(lists.due.length), lists.due.length ? 'var(--orange)' : '', true], ['Next 30 days', String(lists.up.filter(r => r.due <= addDays(t, 30)).length)], ['Sent', String(A.filter(r => r.sent).length), 'var(--green)'], ['Customers', String(new Set(A.map(r => r.d.customerId)).size)]])}
      <div class="chips" style="margin:12px 0">${[['due', 'Due now'], ['up', 'Upcoming'], ['done', 'Sent / skipped']].map(([k, l]) => `<button type="button" data-rt="${k}" class="${k === tab ? 'on' : ''}">${l} (${lists[k].length})</button>`).join('')}</div>
      ${list.length ? `<div class="list">${list.map((r, i) => `<div class="item"><div class="main" data-rmdoc="${r.d.id}" style="cursor:pointer"><div class="t">${esc(r.c.name || 'Customer')}</div><div class="s">${label(r.m)} · ${esc(r.d.number)} · ${esc(equipOf(r.d))}</div><div class="s">${r.sent ? 'Sent ' + dfmt(r.sent) : r.skipped ? 'Skipped ' + dfmt(r.skipped) : (r.due < t ? '<b style="color:var(--red)">Due ' + dfmt(r.due) + '</b>' : 'Due ' + dfmt(r.due))}</div></div>
        <div class="r" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${r.sent || r.skipped ? `<button type="button" class="btn" data-rmundo="${i}" style="min-height:36px;padding:4px 10px">Undo</button>` : `<button type="button" class="btn wa" data-rmsend="${i}" style="min-height:36px;padding:4px 10px">${icWa}${tab === 'up' ? 'Send early' : 'WhatsApp'}</button>${r.c.email && window.FitxMail ? `<button type="button" class="btn" data-rmmail="${i}" style="min-height:36px;padding:4px 10px" aria-label="Email reminder">${ICON.mail}</button>` : ''}${tab === 'due' ? `<button type="button" class="btn" data-rmskip="${i}" style="min-height:36px;padding:4px 10px">Skip</button>` : ''}`}</div></div>`).join('')}</div>`
        : `<div class="list"><div class="empty">${tab === 'due' ? 'No reminders due. 👍' : tab === 'up' ? 'No upcoming reminders. Tick the months on an invoice to plan them.' : 'Nothing sent yet.'}</div></div>`}
      <p class="hint" style="margin-top:14px">Set reminders on each invoice (Service reminders: 1, 2, 3, 6, 9, 12 months). Due reminders show on the dashboard every day${window.AndroidBridge ? ' and as a phone notification at 9 AM' : ''}.</p>`;
    $$('#main [data-rt]').forEach(b => b.onclick = () => { state.rmTab = b.dataset.rt; render(); });
    bindRows($('#main'), list, () => render());
    $$('#main [data-rmmail]').forEach(b => b.onclick = () => { const r = list[+b.dataset.rmmail]; const sp = FitxMail.specService(Object.assign({}, r, {equipment: equipOf(r.d), base: baseDate(r.d)})); const o = sp.onSent; sp.onSent = () => { o(); setTimeout(render, 300); }; FitxMail.compose(sp); });
    $$('#main [data-rmundo]').forEach(b => b.onclick = () => { mark(list[+b.dataset.rmundo], null); render(); });
    $$('#main [data-rmdoc]').forEach(b => b.onclick = () => viewDoc(b.dataset.rmdoc));
  }

  function remindSettings() {
    const r = R(); const defs = (r.defaults || []).slice();
    openSheet('Service reminder settings', `<form id="rmsForm">
      <div class="f"><span style="display:block;margin-bottom:8px">Default for every new invoice</span>${chipsHTML(defs)}</div>
      <label class="f" style="margin-top:12px"><span>WhatsApp message</span><textarea class="in" name="msg" rows="10">${esc(r.msg || DEF_MSG)}</textarea></label>
      <p class="hint" style="margin-top:-6px">Words in { } are filled in: {customer} {equipment} {period} {invoice} {date} {company} {phone}</p>
      <div class="btns"><button type="button" class="btn" id="rmsReset">Reset message</button><button type="submit" class="btn pri">Save</button></div></form>`, el => {
      bindChips(el, defs);
      el.querySelector('#rmsReset').onclick = () => { el.querySelector('[name=msg]').value = DEF_MSG; };
      el.querySelector('#rmsForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        r.defaults = defs; r.msg = v.msg.trim() === DEF_MSG.trim() ? '' : v.msg.trim();
        save(); closeSheet(() => { toast('Saved'); render(); });
      };
    });
  }

  /* ---------- on the invoice screen ---------- */
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id); if (!d || d.type !== 'INV' || d.cancelled) return;
    const top = typeof sheets !== 'undefined' && sheets[sheets.length - 1]; const sheet = top && top.querySelector('.sb > div'); if (!sheet) return;
    const rows = all().filter(r => r.d.id === id);
    const html = `<div class="rmpanel" id="rmView"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="display:flex;gap:8px;align-items:center">${icBell}Service reminders</b><button type="button" class="btn" id="rmEdit" style="min-height:34px;padding:4px 12px">${rows.length ? 'Change' : 'Set reminders'}</button></div>
      ${rows.length ? rows.map(r => `<div class="hint" style="margin-top:6px">${label(r.m)} · ${dfmt(r.due)} · ${r.sent ? '<span style="color:var(--green)">sent ' + dfmt(r.sent) + '</span>' : r.skipped ? 'skipped' : r.due <= today() ? '<b style="color:var(--orange)">due</b>' : 'planned'}</div>`).join('') : '<p class="hint">No reminders for this invoice.</p>'}</div>`;
    sheet.insertAdjacentHTML('beforeend', html);
    sheet.querySelector('#rmEdit').onclick = () => {
      const sel = (d.remind || []).slice();
      openSheet('Service reminders · ' + d.number, `${chipsHTML(sel)}<p class="hint">Counted from ${d.wcr && d.wcr.on && d.wcr.date ? 'the work completion date' : 'the invoice date'} (${dfmt(baseDate(d))}).</p><button type="button" class="btn pri full" id="rmSave" style="margin-top:12px">Save</button>`, el => {
        bindChips(el, sel);
        el.querySelector('#rmSave').onclick = () => { d.remind = sel; d.updated = Date.now(); save(); closeSheet(() => reopenWith(() => viewDoc(id))); toast('Reminders saved'); };
      });
    };
  };

  /* ---------- Android: daily notification list ---------- */
  let lastJson = null, tm = null;
  function pushNative() {
    const AB = window.AndroidBridge; if (!AB || !AB.setReminders) return;
    const list = pending().slice(0, 500).map(r => ({d: r.due, t: (r.c.name || 'Customer') + ' (' + period(r.m) + ')'}));
    const j = JSON.stringify(list);
    if (j === lastJson) return;
    lastJson = j;
    try { AB.setReminders(j); } catch (e) {}
  }
  const origSave = window.save;
  if (origSave) window.save = function () { const r = origSave.apply(this, arguments); clearTimeout(tm); tm = setTimeout(pushNative, 800); return r; };
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(() => setTimeout(pushNative, 500));
  setTimeout(pushNative, 1500);

  /* ---------- wiring ---------- */
  window.FITX_VIEWS = Object.assign(window.FITX_VIEWS || {}, {reminders: viewReminders});
  if (typeof NAV_GROUP !== 'undefined') NAV_GROUP.reminders = 'sales';
  window.fitxOpen = function (what) { if (what === 'reminders') { while (typeof sheets !== 'undefined' && sheets.length) closeTopSheet(); goTab('reminders'); } };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const sales = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /^sales$/i.test(h.textContent.trim()));
    const list = sales && sales.parentElement.nextElementSibling; if (!list) return;
    const n = dueNow().length;
    list.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mRemind"><span class="ic">${icBell}</span><div class="main"><div class="t">Service reminders${n ? ` <span class="badge b-orange">${n} due</span>` : ''}</div><div class="s">WhatsApp reminders after 1, 2, 3, 6, 9, 12 months</div></div></button>`);
    document.getElementById('mRemind').onclick = () => goTab('reminders');
  };
  const side = document.querySelector('#side .si[data-tab=reports]');
  if (side) side.insertAdjacentHTML('beforebegin', `<button type="button" class="si" data-tab="reminders">${icBell}Reminders</button>`);
  window.FitxReminders = {all, pending, dueNow, message, addMonths};
})();
