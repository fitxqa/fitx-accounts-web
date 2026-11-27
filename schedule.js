/* FitX Accounts — Appointment schedule.
   • Schedule page: visits of a day grouped by area (work orders with a date + AMC visits that fall due), route per area.
   • Area picker with all areas of Qatar (work order home visits and the customer form).
   • Time slots in the work order form: slots already booked (same day, same technician) show as occupied. */
(function () {
  'use strict';
  if (!window.FitxWO) return;
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['appointments']);
  const AREAS = {
    'Doha': ['Abu Hamour', 'Ain Khaled', 'Al Asiri', 'Al Bidda', 'Al Dafna', 'Al Doha Al Jadeeda', 'Al Egla', 'Al Ghanim', 'Al Hilal', 'Al Hitmi', 'Al Jasra', 'Al Khulaifat', 'Al Maamoura', 'Al Mansoura', 'Al Markhiya', 'Al Mirqab', 'Al Messila', 'Al Muntazah', 'Al Najada', 'Al Nasr', 'Al Rumailah', 'Al Sadd', 'Al Souq', 'Al Tarfa', 'Al Thumama', 'Al Waab', 'Barwa Commercial Avenue', 'Corniche', 'Doha Port', 'Duhail', 'Fereej Abdel Aziz', 'Fereej Bin Durham', 'Fereej Bin Mahmoud', 'Fereej Bin Omran', 'Fereej Kulaib', 'Gewan Island', 'Hazm Al Markhiya', 'Industrial Area', 'Jelaiah', 'Jeryan Nejaima', 'Katara', 'Leqtaifiya', 'Madinat Khalifa North', 'Madinat Khalifa South', 'Msheireb', 'Mushayrib', 'Najma', 'Nuaija', 'Old Airport', 'Onaiza', 'Qetaifan Island', 'Ras Abu Aboud', 'Rawdat Al Khail', 'The Pearl', 'Umm Ghuwailina', 'Umm Lekhba', 'Wadi Al Sail', 'West Bay', 'West Bay Lagoon'],
    'Al Rayyan': ['Abu Nakhla', 'Al Aziziya', 'Al Gharrafa', 'Al Luqta', 'Al Rayyan Al Jadeed', 'Al Rayyan Al Qadeem', 'Al Sailiya', 'Al Shagub', 'Al Soudan', 'Al Wajba', 'Aspire Zone', 'Baaya', 'Bani Hajer', 'Education City', 'Fereej Al Murra', 'Gharrafat Al Rayyan', 'Izghawa', 'Mebaireek', 'Mehairja', 'Muaither', 'Murraikh', 'New Al Rayyan', 'Old Al Rayyan', 'Umm Al Seneem', 'Wadi Al Banat'],
    'Al Daayen': ['Al Kharaitiyat', 'Jeryan Jenaihat', 'Leabaib', 'Lusail', 'Rawdat Al Hamama', 'Simaisma', 'Umm Qarn', 'Wadi Lusail'],
    'Umm Salal': ['Al Kheesa', 'Al Ebb', 'Bu Fasseela', 'Umm Salal Ali', 'Umm Salal Mohammed', 'Umm Al Amad'],
    'Al Wakrah': ['Al Wakrah', 'Al Wukair', 'Al Mashaf', 'Barwa City', 'Barwa Village', 'Birkat Al Awamer', 'Ezdan Village', 'Mesaieed', 'Sealine', 'Umm Besher'],
    'Al Khor & Al Thakhira': ['Al Khor', 'Al Thakhira', 'Ras Laffan', 'Simsima', 'Al Ghuwariyah', 'Umm Birka'],
    'Al Shamal': ['Madinat Al Shamal', 'Al Ruwais', 'Abu Dhalouf', 'Fuwairit', 'Al Zubarah'],
    'Al Shahaniya': ['Al Shahaniya', 'Dukhan', 'Al Kharsaah', 'Umm Bab', 'Zekreet', 'Al Karaana', 'Al Utouriya', 'Abu Samra']
  };
  const ALL = Object.values(AREAS).flat();
  const OTHER = '__other';
  const ST = {open: ['Open', ''], assigned: ['Assigned', 'b-blue'], progress: ['In progress', 'b-yellow'], parts: ['Waiting parts', 'b-yellow'], approval: ['Waiting approval', 'b-blue'], hold: ['On hold', ''], done: ['Completed', 'b-green'], cancelled: ['Cancelled', 'b-red']};
  const ACTIVE = ['open', 'assigned', 'progress', 'parts', 'approval', 'hold'];
  const SLOT_FROM = 9, SLOT_TO = 22, STEP = 30, LEN = 60;   // 9:00 – 22:00, every 30 min, a visit takes about 1 hour
  const emp = id => ((db.employees || []).find(e => e.id === id) || {}).name || '';
  const cust = id => (db.customers || []).find(c => c.id === id) || {};
  const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const t12 = t => { const m = mins(t); if (m == null) return ['—', '']; let h = Math.floor(m / 60); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return [h + ':' + String(m % 60).padStart(2, '0'), ap]; };
  const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addD = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };

  /* ---------- area picker ---------- */
  function areaSelect(input) {
    if (input.dataset.qa) return; input.dataset.qa = '1';
    const cur = String(input.value || '').trim();
    const sel = document.createElement('select'); sel.className = input.className;
    sel.innerHTML = '<option value="">Choose area…</option>' + (cur && !ALL.includes(cur) ? `<option selected>${esc(cur)}</option>` : '') +
      Object.entries(AREAS).map(([g, l]) => `<optgroup label="${esc(g)}">${l.slice().sort().map(a => `<option ${a === cur ? 'selected' : ''}>${esc(a)}</option>`).join('')}</optgroup>`).join('') +
      `<option value="${OTHER}">✎ Other – type it</option>`;
    input.type = 'hidden'; input.insertAdjacentElement('afterend', sel);
    sel.onchange = () => {
      if (sel.value === OTHER) { const v = prompt('Area name'); if (v && v.trim()) { const o = document.createElement('option'); o.textContent = v.trim(); sel.insertBefore(o, sel.options[1]); sel.value = v.trim(); } else sel.value = input.value || ''; }
      input.value = sel.value === OTHER ? '' : sel.value;
      input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));
    };
  }

  /* ---------- time slots ---------- */
  let pendingAppt = '';   // appointment being turned into a work order: its own slot is not "booked" for that form
  const apptWO = a => (db.workorders || []).find(w => w.apptId === a.id && w.status !== 'cancelled');
  const pName = x => (x.kind === 'home' ? ((x.home || {}).name || (x.home || {}).phone) : cust(x.customerId).name) || x.number || '';
  function busyOn(day, tid, exWO, exAppt) {
    const l = [];
    (db.workorders || []).forEach(w => { if (w.date === day && w.id !== exWO && !['cancelled', 'done'].includes(w.status) && mins(w.time) != null && (!tid || !w.techId || w.techId === tid)) l.push({m: mins(w.time), who: pName(w)}); });
    (db.appointments || []).forEach(a => { if (a.date === day && a.id !== exAppt && a.id !== pendingAppt && a.status !== 'cancelled' && !apptWO(a) && mins(a.time) != null && (!tid || !a.techId || a.techId === tid)) l.push({m: mins(a.time), who: pName(a)}); });
    return l;
  }
  function slotGrid(form, ex) {
    if (form.dataset.slots) return; form.dataset.slots = '1';
    const tIn = form.querySelector('input[name="time"]'), dIn = form.querySelector('input[name="date"]'), tech = form.querySelector('select[name="techId"]');
    if (!tIn || !dIn) return;
    const box = document.createElement('div'); box.className = 'qslot';
    (tIn.closest('.row') || tIn.closest('label')).insertAdjacentElement('afterend', box);
    const draw = () => {
      const day = dIn.value, tid = tech ? tech.value : '', e = ex();
      const busy = busyOn(day, tid, e.wo, e.appt), cur = mins(tIn.value);
      let html = '';
      // one-hour slots, same as the customer booking page (9–10 am … 9–10 pm)
      const h12 = h => h % 12 || 12;
      for (let hr = SLOT_FROM; hr < SLOT_TO; hr++) {
        const m = hr * 60, hit = busy.find(b => Math.abs(b.m - m) < LEN), lab = `${h12(hr)}–${h12(hr + 1)}<span>${hr + 1 < 12 ? 'am' : 'pm'}</span>`;
        html += hit ? `<button type="button" class="qs busy" disabled title="Booked – ${esc(hit.who)}">${lab}</button>`
          : `<button type="button" class="qs${cur != null && cur >= m && cur < m + 60 ? ' on' : ''}" data-t="${hhmm(m)}">${lab}</button>`;
      }
      box.innerHTML = `<div class="qsh"><span>Time slot</span><small>${busy.length ? busy.length + ' booked' + (tid ? ' for ' + esc(emp(tid).split(' ')[0]) : '') : 'all free'} · ${esc(dfmt(day))}</small></div><div class="qsg">${html}</div>`;
      box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tIn.value = b.dataset.t; tIn.dispatchEvent(new Event('input', {bubbles: true})); draw(); });
    };
    [dIn, tIn, tech].forEach(x => x && x.addEventListener('change', draw));
    tIn.addEventListener('input', () => setTimeout(draw, 0));
    draw();
  }
  function slots(form) {   // work order form
    const title = ((form.closest('.sheet') || document).querySelector('h1,h2,.st,.title') || {}).textContent || '';
    const self = (db.workorders || []).find(w => w.number && title.includes(w.number));
    slotGrid(form, () => ({wo: self && self.id}));
  }

  /* ---------- appointments ---------- */
  const apById = id => (db.appointments || []).find(a => a.id === id);
  const nextAp = () => { const st = S(); const n = st.nextAPT || 1; st.nextAPT = n + 1; return `APT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; };
  function editAppt(id, preset) {
    db.appointments = db.appointments || [];
    const ex = id ? apById(id) : null;
    const a = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({kind: 'home', customerId: '', home: {}, date: today(), time: '', techId: '', machine: '', problem: '', notes: ''}, preset || {});
    const h = a.home || {};
    const custOpts = '<option value="">Choose customer…</option>' + db.customers.filter(c => !c.homeVisits).sort((x, y) => x.name.localeCompare(y.name)).map(c => `<option value="${c.id}" ${c.id === a.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const techOpts = '<option value="">Not assigned yet</option>' + (db.employees || []).filter(e => !e.left || e.left >= today()).map(e => `<option value="${e.id}" ${e.id === a.techId ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    openSheet(ex ? 'Edit ' + ex.number : 'New appointment', `<form id="apForm2" autocomplete="off">
      <div class="chips" id="apK" style="display:grid;grid-template-columns:1fr 1fr;overflow:visible;margin-bottom:12px"><button type="button" data-k="customer" class="${a.kind !== 'home' ? 'on' : ''}" style="justify-content:center">🏢 Customer</button><button type="button" data-k="home" class="${a.kind === 'home' ? 'on' : ''}" style="justify-content:center">🏠 Home visit</button></div>
      <div id="apC" style="${a.kind === 'home' ? 'display:none' : ''}"><label class="f"><span>Customer</span><select class="in" name="customerId">${custOpts}</select></label></div>
      <div id="apH" style="${a.kind === 'home' ? '' : 'display:none'}">
        <div class="row"><label class="f"><span>Mobile *</span><input class="in" type="tel" inputmode="tel" name="hPhone" value="${esc(h.phone || '')}" placeholder="e.g. 5555 1234"></label><label class="f"><span>Name</span><input class="in" name="hName" value="${esc(h.name || '')}" placeholder="Client name"></label></div>
        <label class="f"><span>Area</span><input class="in" name="hArea" value="${esc(h.area || '')}"></label>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"><label class="f"><span>Building no.</span><input class="in" inputmode="numeric" name="hBuilding" value="${esc(h.building || '')}"></label><label class="f"><span>Street no.</span><input class="in" inputmode="numeric" name="hStreet" value="${esc(h.street || '')}"></label><label class="f"><span>Zone no.</span><input class="in" inputmode="numeric" name="hZone" value="${esc(h.zone || '')}"></label></div>
        <label class="f"><span>Location (Google Maps link)</span><input class="in" name="hMaps" value="${esc(h.maps || '')}" placeholder="Paste a shared location link"></label>
      </div>
      <div class="row"><label class="f"><span>Machine</span><input class="in" name="machine" value="${esc(a.machine || '')}" placeholder="e.g. Treadmill"></label><label class="f"><span>Problem reported</span><input class="in" name="problem" value="${esc(a.problem || '')}" placeholder="e.g. Belt slipping"></label></div>
      <div class="row"><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${esc(a.date)}" required></label><label class="f"><span>Technician</span><select class="in" name="techId">${techOpts}</select></label></div>
      <label class="f"><span>Time</span><input class="in" type="time" name="time" value="${esc(a.time || '')}"></label>
      <label class="f"><span>Notes</span><textarea class="in" name="notes" rows="2" placeholder="Gate code, parking, call before…">${esc(a.notes || '')}</textarea></label>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn pri">${ex ? 'Save' : 'Book appointment'}</button></div></form>`, el => {
      const f = el.querySelector('#apForm2');
      let kind = a.kind;
      el.querySelectorAll('#apK [data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; el.querySelectorAll('#apK [data-k]').forEach(x => x.classList.toggle('on', x === b)); el.querySelector('#apC').style.display = kind === 'home' ? 'none' : ''; el.querySelector('#apH').style.display = kind === 'home' ? '' : 'none'; });
      areaSelect(f.hArea);
      // a known home client: fill the address from the last visit
      f.hPhone.addEventListener('change', () => { const d = String(f.hPhone.value).replace(/\D/g, '').slice(-8); const o = d.length >= 7 && (db.homeclients || []).find(x => String(x.phone || '').replace(/\D/g, '').slice(-8) === d); if (!o) return;
        ['Name', 'Building', 'Street', 'Zone', 'Maps'].forEach(k => { const inp = f['h' + k]; if (inp && !inp.value) inp.value = o[k.toLowerCase()] || ''; }); if (!f.hArea.value && o.area) { f.hArea.value = o.area; const sel = f.hArea.nextElementSibling; if (sel && sel.tagName === 'SELECT') { if (![...sel.options].some(x => x.value === o.area)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(o.area)}</option>`); sel.value = o.area; } } toast('Known client – address filled'); });
      slotGrid(f, () => ({appt: ex && ex.id}));
      f.onsubmit = e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        if (kind === 'home' && !String(v.hPhone || '').trim()) { toast('Mobile number is needed for a home visit'); return; }
        if (kind !== 'home' && !v.customerId) { toast('Choose the customer'); return; }
        if (v.time && busyOn(v.date, v.techId, null, ex && ex.id).some(b => Math.abs(b.m - mins(v.time)) < LEN) && !confirm('That time is already booked' + (v.techId ? ' for ' + emp(v.techId) : '') + '. Book anyway?')) return;
        const data = {kind, customerId: kind === 'home' ? '' : v.customerId, home: kind === 'home' ? {phone: v.hPhone.trim(), name: (v.hName || '').trim(), area: (v.hArea || '').trim(), building: (v.hBuilding || '').trim(), street: (v.hStreet || '').trim(), zone: (v.hZone || '').trim(), maps: (v.hMaps || '').trim()} : {},
          date: v.date, time: v.time || '', techId: v.techId || '', machine: (v.machine || '').trim(), problem: (v.problem || '').trim(), notes: (v.notes || '').trim()};
        let rec;
        if (ex) { Object.assign(ex, data, {updated: Date.now()}); rec = ex; }
        else { rec = Object.assign({id: uid(), number: nextAp(), status: 'booked', created: String(Date.now())}, data); db.appointments.push(rec); }
        save(); closeSheet(() => { toast(rec.number + ' booked'); viewAppt(rec.id); });
      };
    });
  }
  function toWO(a) {
    pendingAppt = a.id;
    FitxWO.edit(null, {kind: a.kind === 'home' ? 'home' : 'customer', customerId: a.customerId || '', home: Object.assign({}, a.home || {}), date: a.date, time: a.time || '', techId: a.techId || '', notes: a.notes || '', apptId: a.id,
      equipment: [{desc: a.machine || '', brand: '', model: '', sn: '', problem: a.problem || ''}]});
    const depth = sheets.length;
    const iv = setInterval(() => { if (sheets.length < depth || !sheets.length) { clearInterval(iv); pendingAppt = ''; } }, 600);
  }
  function viewAppt(id) {
    const a = apById(id); if (!a) return;
    const w = apptWO(a), c = a.kind === 'home' ? (a.home || {}) : cust(a.customerId), phone = c.phone || '';
    const [h, ap] = t12(a.time), wa = String(phone).replace(/\D/g, '');
    const addr = [c.building && 'Building ' + c.building, c.street && 'Street ' + c.street, c.zone && 'Zone ' + c.zone, c.area].filter(Boolean).join(', ');
    openSheet(a.number, `
      <div class="card" style="margin-top:0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><div class="hint" style="margin:0">${a.kind === 'home' ? '🏠 Home visit' : '🏢 Customer'}</div><div style="font-size:19px;font-weight:800">${esc(pName(a))}</div></div>
        <span class="badge ${a.status === 'cancelled' ? 'b-red' : w ? (ST[w.status] || ST.open)[1] : a.status === 'requested' ? 'b-orange' : 'b-blue'}">${a.status === 'cancelled' ? 'Cancelled' : w ? 'Work order ' + esc(w.number) : a.status === 'requested' ? 'Requested online' : 'Booked'}</span></div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:10px">
          <span class="hint" style="margin:0">When</span><b>${esc(dfmt(a.date))}${a.time ? ' · ' + h + ' ' + ap : ''}</b>
          ${a.machine || a.problem ? `<span class="hint" style="margin:0">Job</span><b>${esc([a.machine, a.problem].filter(Boolean).join(' – '))}</b>` : ''}
          ${addr ? `<span class="hint" style="margin:0">Address</span><b>${esc(addr)}</b>` : ''}
          ${phone ? `<span class="hint" style="margin:0">Mobile</span><b>${esc(phone)}</b>` : ''}
          <span class="hint" style="margin:0">Technician</span><b>${esc(emp(a.techId) || 'Not assigned')}</b>
          ${a.notes ? `<span class="hint" style="margin:0">Notes</span><span>${esc(a.notes)}</span>` : ''}</div></div>
      ${a.photo ? `<img src="${esc(a.photo)}" alt="Photo from the customer" style="width:100%;max-height:260px;object-fit:contain;border-radius:12px;background:#000;margin-bottom:10px">` : ''}
      ${a.status === 'requested' ? `<div class="btns" style="margin-bottom:10px"><button type="button" class="btn pri" id="avOk" style="flex:2">✅ Confirm & WhatsApp</button><button type="button" class="btn" id="avNo" style="color:var(--red)">Decline</button></div><p class="hint" style="margin:-4px 2px 10px">To change the time: tap Edit, choose a new slot, then Confirm.</p>` : ''}
      ${a.status !== 'cancelled' && a.status !== 'requested' ? (w ? `<button type="button" class="btn pri" id="avWO" style="width:100%">🔧 Open work order ${esc(w.number)}</button>` : `<button type="button" class="btn pri" id="avMake" style="width:100%">🔧 Create work order</button>`) : ''}
      <div class="btns" style="margin-top:10px;flex-wrap:wrap">
        ${phone ? `<a class="btn" href="tel:${esc(phone)}">📞 Call</a><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${wa.length === 8 ? '974' + wa : wa}?text=${encodeURIComponent('Hello' + (c.name ? ' ' + c.name : '') + ', this is ' + (S().company && S().company.name || 'FitX') + '. Your appointment is on ' + dfmt(a.date) + (a.time ? ' at ' + h + ' ' + ap : '') + '.')}">💬 WhatsApp</a>` : ''}
        ${c.maps ? `<a class="btn" target="_blank" rel="noopener" href="${esc(c.maps)}">📍 Map</a>` : ''}
        ${!w && a.status !== 'cancelled' ? '<button type="button" class="btn" id="avEd">Edit</button>' + (a.status === 'requested' ? '' : '<button type="button" class="btn" id="avCx">Cancel appointment</button>') : ''}
        ${!w ? '<button type="button" class="btn" id="avDel" style="color:var(--red)">Delete</button>' : ''}</div>`, el => {
      const b = s2 => el.querySelector(s2);
      const waTo = txt => { const n = String(phone).replace(/\D/g, ''); window.open('https://wa.me/' + (n.length === 8 ? '974' + n : n) + '?text=' + encodeURIComponent(txt), '_blank'); };
      const coName = (S().name || (S().company && S().company.name) || 'FitX');
      if (b('#avOk')) b('#avOk').onclick = () => { a.status = 'booked'; a.updated = Date.now(); save(); waTo(`Hello${c.name ? ' ' + c.name : ''}, this is ${coName}. Your service visit is confirmed for ${dfmt(a.date)}${a.time ? ' at ' + h + ' ' + ap : ''}${a.machine ? ' (' + a.machine + ')' : ''}. Our technician will call before arriving. Thank you!`); closeSheet(() => { toast('Appointment confirmed'); viewAppt(a.id); }); };
      if (b('#avNo')) b('#avNo').onclick = () => { if (!confirm('Decline this booking? The time becomes free again.')) return; a.status = 'cancelled'; a.updated = Date.now(); save(); waTo(`Hello${c.name ? ' ' + c.name : ''}, this is ${coName}. Sorry, we can't come on ${dfmt(a.date)}${a.time ? ' at ' + h + ' ' + ap : ''}. Please choose another time or reply here and we'll find a slot for you.`); closeSheet(() => toast('Booking declined')); };
      if (b('#avMake')) b('#avMake').onclick = () => { closeSheet(() => toWO(a)); };
      if (b('#avWO')) b('#avWO').onclick = () => FitxWO.view(w.id);
      if (b('#avEd')) b('#avEd').onclick = () => closeSheet(() => editAppt(a.id));
      if (b('#avCx')) b('#avCx').onclick = () => { if (!confirm('Cancel ' + a.number + '? The time slot becomes free.')) return; a.status = 'cancelled'; a.updated = Date.now(); save(); closeSheet(() => { toast('Appointment cancelled'); viewAppt(a.id); }); };
      if (b('#avDel')) b('#avDel').onclick = () => { if (!confirm('Delete ' + a.number + '?')) return; db.appointments = db.appointments.filter(x => x.id !== a.id); save(); closeSheet(() => toast('Deleted')); };
    });
  }

  /* ---------- online booking (book.html) ---------- */
  const BOOK = {from: 9, to: 22, closed: [5]};   // 9 AM – 10 PM, Friday closed, one team
  const cloudOn = () => !!(window.FitxCloud && FitxCloud._fs && FitxCloud.cid && FitxCloud.user && FitxCloud.role !== 'technician');
  // FitX's own page on fitx.qa; other companies use the direct link
  const bookUrl = () => { const c = window.FitxCloud && FitxCloud.cid || ''; return c === '8EZ2NIK0OLqPiMvZft6R' ? 'https://www.fitx.qa/appointment' : 'https://fitxqa.github.io/fitx-accounts-web/book.html#' + c; };
  let lastAreas = {};
  function busyMap() {
    const out = {}, start = today(), end = addD(start, 45);
    const jobs = [];
    const areaOf = x => String(((x.kind === 'home' ? x.home : cust(x.customerId)) || {}).area || '').trim();
    (db.workorders || []).forEach(w => { if (w.date >= start && w.date <= end && !['cancelled', 'done'].includes(w.status) && mins(w.time) != null) jobs.push([w.date, mins(w.time), areaOf(w)]); });
    (db.appointments || []).forEach(a => { if (a.date >= start && a.date <= end && a.status !== 'cancelled' && !apptWO(a) && mins(a.time) != null) jobs.push([a.date, mins(a.time), areaOf(a)]); });
    // where the team will be (area name only, no names) – the booking page suggests the slot next to a visit in the same area
    lastAreas = {};
    jobs.forEach(([d, m, ar]) => { if (!ar) return; const t = String(Math.floor(m / 60)).padStart(2, '0') + ':00'; (lastAreas[d] = lastAreas[d] || {})[t] = ar; });
    jobs.forEach(([d, m]) => { for (let h = BOOK.from; h < BOOK.to; h++) if (Math.abs(h * 60 - m) < LEN) { (out[d] = out[d] || []); const t = String(h).padStart(2, '0') + ':00'; if (!out[d].includes(t)) out[d].push(t); } });
    return out;
  }
  let pubTimer = null, lastPub = '';
  function publishSlots() {
    if (!cloudOn()) return;
    clearTimeout(pubTimer);
    pubTimer = setTimeout(() => {
      const st = S(), rec = {cid: FitxCloud.cid, co: {name: st.name || '', phone: st.phone || ''}, from: BOOK.from, to: BOOK.to, closed: BOOK.closed, busy: busyMap(), areas: lastAreas};
      const key = JSON.stringify(rec); if (key === lastPub) return; lastPub = key;
      try { FitxCloud._fs.collection('slots').doc(FitxCloud.cid).set(Object.assign(rec, {updated: Date.now()})).catch(e => { lastPub = ''; console.warn('slots', e && e.message); }); } catch (e) {}
    }, 2500);
  }
  let importing = false;
  function importBookings() {
    if (!cloudOn() || importing) return;
    importing = true;
    FitxCloud._fs.collection('bookings').where('cid', '==', FitxCloud.cid).get().then(q => {
      let n = 0;
      db.appointments = db.appointments || [];
      q.forEach(doc => {
        const b = doc.data();
        if (!db.appointments.some(a => a.bookingId === doc.id)) {
          db.appointments.push({id: uid(), number: nextAp(), status: 'requested', source: 'online', src: ((String(b.maps || '').match(/^src=([a-z0-9]+)/i) || [])[1] || ''), bookingId: doc.id, created: String(b.created || Date.now()), kind: 'home', customerId: '',
            home: {phone: String(b.phone || '').slice(0, 20), name: String(b.name || '').slice(0, 60), area: String(b.area || '').slice(0, 40), building: String(b.building || '').slice(0, 10), street: String(b.street || '').slice(0, 10), zone: String(b.zone || '').slice(0, 10), maps: String(b.maps || '').replace(/^src=\S+\s*/, '').slice(0, 200)},
            date: String(b.date || today()), time: /^\d\d:\d\d$/.test(String(b.time || '')) ? b.time : '', techId: '', machine: [b.machine, b.brand].filter(Boolean).join(' · ').slice(0, 80), problem: String(b.problem || '').slice(0, 300), notes: 'Booked online' + (/^\d\d:\d\d$/.test(String(b.time || '')) ? '' : ' · Customer wants another time: ' + String(b.time || '').replace(/^Other:\s*/, '').slice(0, 80)), wantsOther: !/^\d\d:\d\d$/.test(String(b.time || '')), photo: typeof b.photo === 'string' && b.photo.startsWith('data:image/') ? b.photo : ''});
          n++;
        }
        doc.ref.delete().catch(() => {});
      });
      if (n) { save(); toast(`🛎️ ${n} new online booking${n > 1 ? 's' : ''} – open Schedule to confirm`); if (typeof state !== 'undefined' && state.tab === 'home' && !(typeof sheets !== 'undefined' && sheets.length)) render(); }
    }).catch(e => console.warn('bookings', e && e.message)).finally(() => { importing = false; });
  }
  function shareLink() {
    if (!cloudOn()) { toast('Sign in to the cloud first (Menu → Users & passwords) – the booking page needs it'); return; }
    publishSlots();
    const url = bookUrl(), msg = `Welcome to ${S().name || 'FitX'} 👋\nGym equipment repair, maintenance, installation, dismantling, assembly, relocation, spare parts & AMC.\n📅 Book a visit: ${url}\n\nأهلاً بكم 👋 صيانة وإصلاح وتركيب وفك ونقل الأجهزة الرياضية، توريد قطع الغيار وعقود الصيانة.\n📅 احجز موعدك: ${url}`;
    openSheet('Booking link', `<p class="hint" style="margin-top:0">Customers open this link, choose a free time (9 AM – 10 PM, Friday closed) and send the request. It arrives here as <b>Requested</b> for you to confirm.</p>
      <div class="card" style="word-break:break-all;font-weight:600">${esc(url)}</div>
      <div class="btns"><a class="btn pri" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">💬 Send on WhatsApp</a><button type="button" class="btn" id="blCopy">Copy link</button><a class="btn" target="_blank" rel="noopener" href="${esc(url)}">Open page</a></div>`, el => {
      el.querySelector('#blCopy').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => { prompt('Copy this link', url); }); };
    });
  }
  const origSave2 = window.save;
  if (origSave2) window.save = function () { const r = origSave2.apply(this, arguments); publishSlots(); return r; };
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(() => { publishSlots(); importBookings(); });
  setInterval(importBookings, 120000);
  setTimeout(() => { publishSlots(); importBookings(); }, 4000);

  /* ---------- schedule page ---------- */
  const latlng = url => { const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url || '') || /[?&](?:q|ll|query|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url || ''); return m ? m[1] + ',' + m[2] : ''; };
  function visitsOn(day) {
    const out = [];
    (db.appointments || []).filter(a => a.date === day && a.status !== 'cancelled' && !apptWO(a)).forEach(a => {
      const c = a.kind === 'home' ? (a.home || {}) : cust(a.customerId);
      out.push({kind: 'apt', id: a.id, time: a.time || '', home: a.kind === 'home', name: pName(a) || 'Appointment', area: String(c.area || '').trim() || 'No area',
        what: [a.machine, a.problem].filter(Boolean).join(' – '), where: [c.zone && 'Zone ' + c.zone, c.street && 'St ' + c.street, c.building && 'Bldg ' + c.building].filter(Boolean).join(' · '),
        tech: emp(a.techId), st: a.status === 'requested' ? ['Requested · online', 'b-orange'] : ['Appointment', 'b-purple'], loc: latlng(c.maps || ''), number: a.number});
    });
    (db.workorders || []).filter(w => w.date === day && w.status !== 'cancelled').forEach(w => {
      const home = w.kind === 'home', c = home ? (w.home || {}) : cust(w.customerId);
      const e = (w.equipment || []).find(x => String(x.problem || '').trim()) || (w.equipment || [])[0] || {};
      out.push({kind: 'wo', id: w.id, time: w.time || '', home, name: home ? (c.name || c.phone || 'Home visit') : (c.name || 'Customer'), area: String(c.area || '').trim() || 'No area',
        what: [e.desc, e.problem].map(x => String(x || '').trim()).filter(Boolean).join(' – ') || w.jobType || '',
        where: [c.zone && 'Zone ' + c.zone, c.street && 'St ' + c.street, c.building && 'Bldg ' + c.building].filter(Boolean).join(' · '),
        tech: emp(w.techId), st: ST[w.status] || ST.open, done: w.status === 'done', loc: latlng(c.maps || c.location || ''), number: w.number});
    });
    if (window.FitxAMC && FitxAMC.visitPlan) (db.amcs || []).filter(a => !a.cancelled).forEach(a => {
      FitxAMC.visitPlan(a).filter(v => v.date === day).forEach(v => {
        if ((db.workorders || []).some(w => w.amcId === a.id && String(w.visitNo) === String(v.no) && w.status !== 'cancelled')) return;   // already a work order
        const c = cust(a.customerId);
        out.push({kind: 'amc', id: a.id, time: '', home: false, name: c.name || 'Customer', area: String(c.area || '').trim() || 'No area', what: `AMC visit ${v.no} of ${FitxAMC.visitPlan(a).length} – preventive service`,
          where: a.number, tech: '', st: ['AMC visit', 'b-blue'], loc: latlng(c.maps || ''), number: a.number});
      });
    });
    return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }
  // every appointment, by tab, newest first for past ones
  function listAppts(tab) {
    tab = tab || ((db.appointments || []).some(a => a.status === 'requested') ? 'req' : 'up');
    openSheet('All appointments', '<div id="laB"></div>', el => {
      let q = '';
      const draw = () => {
        const all = db.appointments || [], t = today();
        const st = a => { const w = apptWO(a); return a.status === 'cancelled' ? 'cx' : a.status === 'requested' ? 'req' : w ? 'wo' : a.date < t ? 'past' : 'up'; };
        const TABS = [['up', 'Upcoming'], ['req', 'Requested'], ['past', 'Past'], ['wo', 'Work order made'], ['cx', 'Cancelled']];
        const cnt = k => all.filter(a => st(a) === k).length;
        let l = all.filter(a => st(a) === tab);
        if (q) { const k = q.toLowerCase(), d = q.replace(/\D/g, ''); l = l.filter(a => [a.number, pName(a), (a.home || {}).area, cust(a.customerId).area, a.machine, a.problem].join(' ').toLowerCase().includes(k) || (d.length >= 3 && String((a.home || {}).phone || cust(a.customerId).phone || '').replace(/\D/g, '').includes(d))); }
        l.sort((x, y) => { const c = (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')); return tab === 'up' || tab === 'req' ? c : -c; });
        el.querySelector('#laB').innerHTML = `
          <div class="chips" style="margin-bottom:10px">${TABS.map(([k, n]) => `<button type="button" data-t="${k}" class="${tab === k ? 'on' : ''}">${n} · ${cnt(k)}</button>`).join('')}</div>
          <input class="in" id="laQ" type="search" placeholder="Search name, mobile, area, APT no." value="${esc(q)}" style="margin-bottom:10px">
          ${l.length ? `<div class="list">${l.map(a => { const [h, ap] = t12(a.time), w = apptWO(a), c = a.kind === 'home' ? (a.home || {}) : cust(a.customerId);
            return `<button type="button" class="item" data-id="${a.id}" style="gap:10px"><div style="flex:0 0 54px;text-align:center"><div style="font-weight:800;font-size:15px">${new Date(a.date + 'T00:00:00').getDate()}</div><div style="font-size:11px;color:var(--muted);font-weight:600">${new Date(a.date + 'T00:00:00').toLocaleDateString('en-GB', {month: 'short'})} · ${a.time ? h + ' ' + ap : '—'}</div></div>
              <div class="main"><div class="t">${a.kind === 'home' ? '🏠 ' : ''}${esc(pName(a))}</div><div class="s">${esc([a.number, c.area, [a.machine, a.problem].filter(Boolean).join(' – ')].filter(Boolean).join(' · '))}</div></div>
              <span class="badge ${a.status === 'cancelled' ? 'b-red' : a.status === 'requested' ? 'b-orange' : w ? 'b-green' : 'b-purple'}">${a.status === 'cancelled' ? 'Cancelled' : a.status === 'requested' ? 'Requested' : w ? esc(w.number) : 'Booked'}</span></button>`; }).join('')}</div>`
            : `<div class="empty">${q ? 'Nothing found.' : 'No appointments here.'}</div>`}`;
        el.querySelectorAll('.chips [data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
        const qi = el.querySelector('#laQ'); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = el.querySelector('#laQ'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
        el.querySelectorAll('.list [data-id]').forEach(b => b.onclick = () => viewAppt(b.dataset.id));
      };
      draw();
      const depth = sheets.length;
      const iv = setInterval(() => { if (!document.body.contains(el)) { clearInterval(iv); return; } if (sheets.length === depth && el.dataset.stale) { delete el.dataset.stale; draw(); } if (sheets.length > depth) el.dataset.stale = '1'; }, 500);
    });
  }
  let day = null, areaF = '';
  function open(d) {
    day = d || day || today(); areaF = '';
    openSheet('Schedule', '<div id="scB"></div>', el => {
      const draw = () => {
        const vs = visitsOn(day), areas = [...new Set(vs.map(v => v.area))].sort((a, b) => a === 'No area' ? 1 : b === 'No area' ? -1 : a.localeCompare(b));
        if (areaF && !areas.includes(areaF)) areaF = '';
        const shown = vs.filter(v => !areaF || v.area === areaF);
        const strip = Array.from({length: 14}, (_, i) => addD(day, i - 3)).map(d => { const n = visitsOn(d).length, dt = new Date(d + 'T00:00:00');
          return `<button type="button" data-d="${d}" class="${d === day ? 'on' : ''}${d === today() ? ' td' : ''}">${dt.toLocaleDateString('en-GB', {weekday: 'short'})}<b>${dt.getDate()}</b><i>${n}</i></button>`; }).join('');
        const techs = new Set(vs.map(v => v.tech).filter(Boolean)).size;
        const grp = a => { const l = shown.filter(v => v.area === a); if (!l.length) return '';
          const stops = l.map(v => v.loc || (v.area !== 'No area' ? v.area + ', Qatar' : '')).filter(Boolean);
          const route = stops.length ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(stops[stops.length - 1]) + (stops.length > 1 ? '&waypoints=' + encodeURIComponent(stops.slice(0, -1).join('|')) : '') : '';
          return `<div class="sgrp"><div class="sgh">📍<b>${esc(a)}</b><small>${l.length} visit${l.length > 1 ? 's' : ''}</small>${route ? `<a href="${route}" target="_blank" rel="noopener">Route ›</a>` : ''}</div>
            ${l.map(v => { const [h, ap] = t12(v.time); return `<button type="button" class="sv${v.done ? ' dn' : ''}" data-k="${v.kind}" data-id="${v.id}"><div class="tm">${h}<small>${ap}</small></div><div class="bd"><b>${v.home ? '🏠 ' : ''}${esc(v.name)}</b>${v.what ? `<div class="m">${esc(v.what)}</div>` : ''}<div class="x">${esc([v.where, v.tech || (v.kind === 'wo' ? 'Not assigned' : '')].filter(Boolean).join(' · '))}</div></div><span class="badge ${v.st[1]}">${esc(v.st[0])}</span></button>`; }).join('')}</div>`; };
        el.querySelector('#scB').innerHTML = `
          <div class="btns" style="margin:0 0 12px"><button type="button" class="btn pri" id="scNew" style="flex:2">+ New appointment</button><button type="button" class="btn" id="scLink">🔗 Booking link</button></div>
          <button type="button" class="item" id="scAll" style="width:100%;margin:0 0 12px;border:1px solid var(--line);border-radius:12px;gap:10px"><span style="font-size:20px">📋</span><div class="main"><div class="t">All appointments</div><div class="s">${(db.appointments || []).length} in total · upcoming, past, cancelled</div></div><span style="color:var(--muted)">›</span></button>
          ${(db.appointments || []).some(x => x.status === 'requested') ? `<button type="button" class="item" id="scReq" style="width:100%;margin:0 0 12px;border:1px solid #ffc89e;background:#fff4ea;border-radius:12px;gap:10px"><span style="font-size:20px">🛎️</span><div class="main"><div class="t">${(db.appointments || []).filter(x => x.status === 'requested').length} online booking request(s)</div><div class="s">Tap to confirm or decline</div></div></button>` : ''}
          <div class="sday">${strip}</div>
          <div class="row" style="gap:8px;margin:0 0 10px"><input class="in" type="date" id="scD" value="${day}" style="flex:1"><button type="button" class="btn${day === today() ? ' pri' : ''}" id="scT" style="flex:0 0 auto">Today</button></div>
          <div class="ssum"><div><b>${vs.length}</b>visit${vs.length === 1 ? '' : 's'} · ${esc(dfmt(day))}</div><div><b>${areas.length}</b>area${areas.length === 1 ? '' : 's'}</div><div><b>${techs}</b>technician${techs === 1 ? '' : 's'}</div></div>
          ${areas.length > 1 ? `<div class="sarea"><button type="button" data-a="" class="${areaF ? '' : 'on'}">All areas · ${vs.length}</button>${areas.map(a => `<button type="button" data-a="${esc(a)}" class="${areaF === a ? 'on' : ''}">${esc(a)} · ${vs.filter(v => v.area === a).length}</button>`).join('')}</div>` : ''}
          ${vs.length ? areas.map(grp).join('') : `<div class="empty">No visits on ${esc(dfmt(day))}.<br>Tap <b>+ New appointment</b> to book one.</div>`}`;
        el.querySelectorAll('.sday [data-d]').forEach(b => b.onclick = () => { day = b.dataset.d; draw(); });
        const on = el.querySelector('.sday .on'); if (on) on.scrollIntoView({inline: 'center', block: 'nearest'});
        el.querySelector('#scD').onchange = e => { if (e.target.value) { day = e.target.value; draw(); } };
        el.querySelector('#scT').onclick = () => { day = today(); draw(); };
        el.querySelectorAll('.sarea [data-a]').forEach(b => b.onclick = () => { areaF = b.dataset.a; draw(); });
        el.querySelectorAll('.sv').forEach(b => b.onclick = () => b.dataset.k === 'amc' ? FitxAMC.view(b.dataset.id) : b.dataset.k === 'apt' ? viewAppt(b.dataset.id) : FitxWO.view(b.dataset.id));
        el.querySelector('#scNew').onclick = () => editAppt(null, {date: day});
        el.querySelector('#scLink').onclick = shareLink;
        el.querySelector('#scAll').onclick = () => listAppts();
        const rq = el.querySelector('#scReq'); if (rq) rq.onclick = () => { const r = (db.appointments || []).filter(x => x.status === 'requested').sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))[0]; if (r) viewAppt(r.id); };
      };
      draw();
      // come back to an up-to-date list after a job is saved / closed
      const depth = sheets.length;
      const iv = setInterval(() => { if (!document.body.contains(el)) { clearInterval(iv); return; } if (sheets.length === depth && el.dataset.stale) { delete el.dataset.stale; draw(); } if (sheets.length > depth) el.dataset.stale = '1'; }, 500);
    });
  }

  const css = document.createElement('style');
  css.textContent = `
  .sday{display:flex;gap:6px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}.sday::-webkit-scrollbar{display:none}
  .sday button{flex:0 0 auto;width:52px;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:6px 0;display:flex;flex-direction:column;align-items:center;font-size:11px;color:var(--muted);font-weight:600}
  .sday button b{font-size:18px;color:var(--text);line-height:1.2}.sday button i{font-style:normal;font-size:10.5px;margin-top:2px;background:#eef0f3;border-radius:999px;padding:0 7px;color:#555}
  .sday button.td{border-color:var(--orange)}
  .sday button.on{background:var(--orange);border-color:var(--orange);color:#fff}.sday button.on b{color:#fff}.sday button.on i{background:#fff;color:var(--orange)}
  .ssum{display:flex;gap:8px;margin-bottom:10px}.ssum div{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-size:11.5px;color:var(--muted);font-weight:600}.ssum b{display:block;font-size:18px;color:var(--text)}
  .sarea{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}.sarea::-webkit-scrollbar{display:none}
  .sarea button{flex:0 0 auto;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:600;color:var(--text)}.sarea button.on{background:var(--orange-l);border-color:var(--orange);color:var(--orange-d)}
  .sgrp{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden;box-shadow:var(--sh)}
  .sgh{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--orange-l);border-bottom:1px solid var(--line)}.sgh b{font-size:15px}.sgh small{color:var(--muted);font-weight:600}.sgh a{margin-left:auto;color:var(--orange-d);font-weight:700;font-size:13px;text-decoration:none}
  .sv{display:flex;gap:12px;width:100%;padding:10px 14px;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;color:var(--text);cursor:pointer}.sv:last-child{border-bottom:0}.sv:hover{background:rgba(255,106,0,.05)}
  .sv.dn{opacity:.55}
  .sv .tm{flex:0 0 50px;font-weight:800;font-size:14px;color:var(--orange-d)}.sv .tm small{display:block;font-weight:600;font-size:11px;color:var(--muted)}
  .sv .bd{flex:1;min-width:0}.sv .bd b{font-size:14.5px}.sv .bd .m{font-size:13px;margin-top:1px}.sv .bd .x{font-size:12px;color:var(--muted);margin-top:2px}
  .sv .badge{align-self:flex-start;white-space:nowrap}
  .badge.b-purple{background:#efe7fb;color:#6b3fb5}.badge.b-orange{background:#ffe9d6;color:#b04a00}
  .qslot{margin:-2px 0 12px}.qsh{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 6px;font-size:13px;font-weight:700;color:var(--muted)}.qsh small{font-weight:600}
  .qsg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:2px}
  .qs{height:44px;border:1px solid var(--line);background:var(--card);border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;color:var(--text);cursor:pointer;padding:0}
  .qs span{font-size:11px;font-weight:600;opacity:.75;margin-left:2px}
  .qs.on{background:var(--orange);border-color:var(--orange);color:#fff}
  .qs.busy{background:transparent;color:#c3c5ca;border-style:dashed;text-decoration:line-through;cursor:not-allowed}`;
  document.head.appendChild(css);

  // enhance forms as they open
  const scan = () => {
    document.querySelectorAll('#woForm input[name="hArea"]').forEach(areaSelect);
    document.querySelectorAll('form input[name="area"][placeholder*="Pearl"]').forEach(areaSelect);   // customer form
    document.querySelectorAll('#woForm').forEach(slots);
  };
  new MutationObserver(() => scan()).observe(document.body, {childList: true, subtree: true});

  // More menu row (old style menu)
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mWO');
    if (!a || document.getElementById('mSch')) return;
    a.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mSch"><span class="ic">📅</span><div class="main"><div class="t">Schedule</div><div class="s">Appointments by day and area, time slots, routes</div></div></button>`);
    document.getElementById('mSch').onclick = () => open();
  };
  window.FitxSchedule = {open, listAppts, areas: AREAS, visitsOn, editAppt, viewAppt, newAppt: () => editAppt(), shareLink, importBookings, publishSlots, busyMap};
})();
