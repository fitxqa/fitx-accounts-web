/* FitX Accounts — Work orders and AMC (annual maintenance contracts).
   Work order: one job for a customer — technician (from Payroll employees), equipment & problem, work done,
     parts used from stock, photos, customer signature. Status: open → assigned → in progress → completed (→ invoiced).
     "Make invoice" opens a new invoice filled from the job (linked by doc.woId). A completed job that is not invoiced
     (e.g. parts free under an AMC) still takes its parts out of stock: Dr Cost of parts sold, Cr Spare parts stock.
   AMC: contract per customer — period, covered equipment, number of service visits (each visit becomes a work order),
     contract value, billing yearly once / monthly / quarterly / per visit (invoices linked by doc.amcId + doc.amcKey).
   Records: db.workorders = [{id, number, date, time, customerId, jobType, priority, techId, status, equipment:[{desc, brand, model, sn, problem}],
              work, labour, parts:[{itemId, desc, qty, price}], photos:[jpeg data URL], sign, signName, amcId, visitNo, doneDate, notes, created}]
            db.amcs = [{id, number, customerId, start, end, visits, billing:'once'|'monthly'|'quarterly'|'visit', value, perVisit,
              equipment:[{desc, brand, model, qty}], covers, notes, cancelled, renewedFrom, created}] */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['workorders', 'amcs', 'homeclients']);
  const ensure = () => { if (!Array.isArray(db.workorders)) db.workorders = []; if (!Array.isArray(db.amcs)) db.amcs = []; if (!Array.isArray(db.homeclients)) db.homeclients = []; };
  ensure();
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const woById = id => db.workorders.find(w => w.id === id);
  const amcById = id => db.amcs.find(a => a.id === id);
  const emps = () => (db.employees || []).filter(e => !e.left || e.left >= today()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const empName = id => ((db.employees || []).find(e => e.id === id) || {}).name || '';
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
  const cname = id => (custById(id) || {}).name || 'No customer';
  /* home visits: private people identified by mobile, kept in db.homeclients – never mixed into Customers */
  const digits = v => String(v || '').replace(/\D/g, '').replace(/^00974|^974/, '');
  const homeByPhone = ph => { const d = digits(ph); return d ? db.homeclients.find(h => digits(h.phone) === d) : null; };
  const blueBoard = h => [h.building && 'Building ' + h.building, h.street && 'Street ' + h.street, h.zone && 'Zone ' + h.zone, h.area].filter(Boolean).join(', ');
  // the person / company a job is for, in the shape of a customer record
  const party = w => w.kind === 'home' ? Object.assign({}, w.home || {}, {name: (w.home || {}).name || (w.home || {}).phone || 'Home visit', homeVisit: true}) : (custById(w.customerId) || {});
  const pname = w => w.kind === 'home' ? ((w.home || {}).name || (w.home || {}).phone || 'Home visit') : cname(w.customerId);
  const pAddr = c => c.homeVisit ? blueBoard(c) : addrText(c);
  const pMap = c => c.maps || (pAddr(c) ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(pAddr(c) + ', Qatar') : '');
  // the single customers-list account home-visit invoices are booked to (the person's details stay on the invoice)
  function homeAccount() {
    let c = db.customers.find(x => x.homeVisits);
    if (!c) { c = {id: uid(), name: 'Home visit customers', homeVisits: true, phone: '', email: '', notes: 'Invoices for home-visit jobs. Each invoice shows the client\'s own name, mobile and address.'}; db.customers.push(c); }
    return c;
  }
  const fq = q => String(+num(q).toFixed(3));
  const nextNo = (key, pre) => { const s = S(); const n = s[key] || 1; s[key] = n + 1; return `${pre}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; };
  const top = () => { const a = document.querySelectorAll('.sheet'); return a[a.length - 1]; };
  const addMonths = (d, m) => { const x = new Date(d + 'T00:00:00'); const day = x.getDate(); x.setMonth(x.getMonth() + m); if (x.getDate() < day) x.setDate(0); return isoOf(x); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
  const ST = {open: ['Open', 'b-grey'], assigned: ['Assigned', 'b-blue'], progress: ['In progress', 'b-yellow'], done: ['Completed', 'b-green'], cancelled: ['Cancelled', 'b-red']};
  const woInvoice = w => db.docs.find(d => d.woId === w.id && d.type === 'INV' && !d.cancelled);
  const woStatus = w => w.status === 'done' && woInvoice(w) ? ['Invoiced', 'b-green'] : (ST[w.status] || ST.open);
  const woDone = w => w.status === 'done';
  const partCost = l => num(l.qty) * num((itemById(l.itemId) || {}).cost);
  const isStock = id => { const it = id && itemById(id); return !!(it && !it.service); };

  /* ---------- stock + books for completed jobs that are not invoiced ---------- */
  (window.FITX_STOCK_FLOWS = window.FITX_STOCK_FLOWS || []).push(itemId => {
    const out = [];
    db.workorders.forEach(w => { if (woDone(w) && !woInvoice(w)) (w.parts || []).forEach(l => { if (l.itemId === itemId && isStock(itemId)) out.push({date: w.doneDate || w.date, qty: -num(l.qty), src: 'wo'}); }); });
    return out;
  });
  (window.FITX_POSTERS = window.FITX_POSTERS || []).push((add, A) => {
    db.workorders.forEach(w => {
      if (!woDone(w) || woInvoice(w)) return;
      const c = r2((w.parts || []).reduce((s, l) => s + (isStock(l.itemId) ? partCost(l) : 0), 0)); if (c <= 0) return;
      const open = () => viewWO(w.id), d = w.doneDate || w.date;
      add('wo:' + w.id + ':cogs', d, A(5000), c, 'Parts used · ' + w.number + ' · ' + pname(w), w.number, open);
      add('wo:' + w.id + ':inv', d, A(1300), -c, 'Parts used · ' + w.number, w.number, open);
    });
  });
  (window.FITX_ACCT_HOOKS = window.FITX_ACCT_HOOKS || []).push((a, f, t) => {
    db.workorders.forEach(w => { const d = w.doneDate || w.date; if (woDone(w) && !woInvoice(w) && d >= f && d <= t) a.cogsStock += (w.parts || []).reduce((s, l) => s + (isStock(l.itemId) ? partCost(l) : 0), 0); });
  });

  /* ---------- shared bits ---------- */
  const brandHead = (title, ar, no, box) => {
    const s = S();
    const brand = `<div class="pbrand">${s.logo ? `<img class="logoimg" src="${s.logo}" alt="${esc(s.name)}">` : plogoHTML()}<div class="pname">${esc(s.name)}</div></div>`;
    return `<div class="xband"></div><div class="xh"><div>${brand}<div class="xco">${esc(s.address)}<br>Tel: ${esc(s.phone)} · ${esc(s.email)}<br>${esc(s.web)}${s.cr ? '<br>CR No. ' + esc(s.cr) : ''}</div></div>
      <div class="xtt"><h2>${title}</h2><div class="ar" dir="rtl" lang="ar">${ar}</div><div class="xnum">${esc(no)}</div>${box || ''}<div></div></div></div>`;
  };
  const stampHTML = () => { const s = S(); return s.stampOn === false ? '' : `<div class="pstamp"><div class="pstin"><img src="${s.stampImg || window.FITX_STAMP_DATA || 'icons/stamp.png'}" alt="Company stamp"><div class="pstl">For ${esc(s.name)}<br><span>Authorised signature &amp; stamp</span></div></div></div>`; };
  const custBlock = c => `<b>${esc(c.name || '')}</b>${c.contact ? '<br>Attn: ' + esc(c.contact) : ''}${pAddr(c) ? '<br>' + esc(pAddr(c)) : ''}${c.phone ? '<br>Tel: ' + esc(c.phone) : ''}${c.email ? '<br>' + esc(c.email) : ''}`;
  const shareRow = p => `<div class="btns sharebar" style="margin-bottom:12px"><button type="button" class="btn pri" id="${p}Share">${ICON.share}Share PDF</button><button type="button" class="btn" id="${p}Wa">${ICON.wa}WhatsApp</button><button type="button" class="btn" id="${p}Mail">${ICON.mail}Email</button><button type="button" class="btn" id="${p}Print">${ICON.print}Print</button><button type="button" class="btn" id="${p}Pv">PDF preview</button></div>`;
  const bindDocShare = (el, p, html, name, c, subject, wa) => {
    bindShare(el, p, () => ({html: html(), name, phone: c.phone, email: c.email, subject, body: '', wa}), () => printHTML(html(), name));
    el.querySelector('#' + p + 'Pv').onclick = () => FitxMail.pdfPreview(html(), name);
  };
  const css = document.createElement('style');
  css.textContent = `.wo-ph{display:flex;gap:8px;flex-wrap:wrap}.wo-ph .ph{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;background:var(--line)}
    .wo-ph .ph img{width:100%;height:100%;object-fit:cover}.wo-ph .ph button{position:absolute;top:2px;right:2px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:12px;cursor:pointer}
    .wo-ph label.add{width:76px;height:76px;border-radius:10px;border:2px dashed var(--line2);display:grid;place-items:center;color:var(--muted);font-size:26px;cursor:pointer}
    .wo-sig{width:100%;height:150px;border:1px solid var(--line2);border-radius:10px;background:#fff;touch-action:none;display:block}
    .wo-av{width:36px;height:36px;border-radius:50%;background:var(--orange);color:#fff;display:grid;place-items:center;font-weight:700;flex:0 0 auto}
    .wo-eq{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:var(--card,#fff)}
    .paper .wo-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px}.paper .wo-photos img{width:100%;height:150px;object-fit:cover;border-radius:6px;border:1px solid #ebebef}
    .paper .wo-sigimg{height:70px;display:block}.paper .wo-box{border:1px solid #ebebef;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:11.5px;white-space:pre-wrap}`;
  document.head.appendChild(css);
  const shrink = file => new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const m = 1000, k = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.7)); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Not an image')); };
    img.src = url;
  });

  /* =================== WORK ORDERS =================== */
  let woTab = 'active';
  function listWO() {
    openSheet('Work orders', `
      <button type="button" class="btn pri full" id="woNew" style="margin-bottom:12px">+ New work order</button>
      <div class="chips" id="woTabs" style="margin-bottom:10px">${[['active', 'Open & in progress'], ['home', 'Home visits'], ['done', 'Completed'], ['all', 'All']].map(([k, l]) => `<button type="button" class="chip ${woTab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <input class="search" id="woQ" placeholder="Search customer, mobile, number, technician or machine" aria-label="Search">
      <div class="list" id="woList"></div>`, el => {
      const draw = () => {
        const q = el.querySelector('#woQ').value.trim().toLowerCase();
        let l = db.workorders.slice().sort((a, b) => String(b.date + b.number).localeCompare(String(a.date + a.number)));
        if (woTab === 'active') l = l.filter(w => !['done', 'cancelled'].includes(w.status)); else if (woTab === 'done') l = l.filter(w => w.status === 'done'); else if (woTab === 'home') l = l.filter(w => w.kind === 'home');
        if (q) l = l.filter(w => (w.number + ' ' + pname(w) + ' ' + ((w.home || {}).phone || '') + ' ' + empName(w.techId) + ' ' + (w.equipment || []).map(e => [e.desc, e.brand, e.model].join(' ')).join(' ')).toLowerCase().includes(q));
        el.querySelector('#woList').innerHTML = l.length ? l.map(w => { const [s, c] = woStatus(w); return `<button type="button" class="item r2" data-id="${w.id}"><div class="main"><div class="t">${w.kind === 'home' ? '<span title="Home visit">🏠 </span>' : ''}${esc(pname(w))}${w.priority === 'Urgent' ? ' <span style="color:var(--red)">●</span>' : ''}</div><div class="s">${esc(w.number)} · ${dfmt(w.date)}${w.time ? ' ' + esc(w.time) : ''}${empName(w.techId) ? ' · ' + esc(empName(w.techId)) : ''}</div></div><div class="r"><span class="badge ${c}">${s}</span></div></button>`; }).join('')
          : `<div class="empty">${db.workorders.length ? 'Nothing here.' : 'No work orders yet. Tap “+ New work order” for each job you send a technician to.'}</div>`;
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => viewWO(b.dataset.id));
      };
      el.querySelectorAll('#woTabs [data-t]').forEach(b => b.onclick = () => { woTab = b.dataset.t; el.querySelectorAll('#woTabs [data-t]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
      el.querySelector('#woQ').oninput = draw; draw();
      el.querySelector('#woNew').onclick = () => editWO();
    });
  }

  function editWO(id, preset) {
    const ex = id ? woById(id) : null;
    const w = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({kind: 'customer', home: {}, date: today(), time: '', customerId: '', jobType: 'Repair / breakdown', priority: 'Normal', techId: '', status: 'open', equipment: [{desc: '', brand: '', model: '', sn: '', problem: ''}], work: '', labour: '', parts: [], notes: ''}, preset || {});
    const custOpts = '<option value="">Choose customer…</option>' + db.customers.filter(c => !c.homeVisits).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}" ${c.id === w.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const techOpts = '<option value="">Not assigned yet</option>' + emps().map(e => `<option value="${e.id}" ${e.id === w.techId ? 'selected' : ''}>${esc(e.name)}${e.job ? ' · ' + esc(e.job) : ''}</option>`).join('');
    const partOpts = sel => '<option value="">Choose part…</option>' + db.items.filter(i => !i.service).sort((a, b) => a.name.localeCompare(b.name)).map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} · stock ${fq(stockQty(i.id))}</option>`).join('');
    const jobs = (S().jobTypes || []);
    openSheet(ex ? 'Edit ' + ex.number : 'New work order', `<form id="woForm" autocomplete="off">
      <div class="chips" id="woKind" style="margin-bottom:10px"><button type="button" data-k="customer" class="${w.kind !== 'home' ? 'on' : ''}">Customer (gym, hotel, company)</button><button type="button" data-k="home" class="${w.kind === 'home' ? 'on' : ''}">🏠 Home visit</button></div>
      <div id="woCust" style="${w.kind === 'home' ? 'display:none' : ''}"><label class="f"><span>Customer</span><select class="in" name="customerId">${custOpts}</select></label>
      ${db.customers.length ? '' : '<p class="hint">Add the customer first in Customers.</p>'}</div>
      <div id="woHome" style="${w.kind === 'home' ? '' : 'display:none'}">
        <div class="row"><label class="f"><span>Mobile *</span><input class="in" type="tel" inputmode="tel" name="hPhone" id="woHP" value="${esc((w.home || {}).phone || '')}" placeholder="e.g. 5555 1234"></label>
        <label class="f"><span>Name (optional)</span><input class="in" name="hName" id="woHN" value="${esc((w.home || {}).name || '')}" placeholder="Client name"></label></div>
        <div class="hint" id="woHFound" style="margin:-4px 2px 8px"></div>
        <div class="sec" style="margin-top:2px"><h2>Address · blue plate</h2></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"><label class="f"><span>Building no.</span><input class="in" inputmode="numeric" name="hBuilding" id="woHB" value="${esc((w.home || {}).building || '')}"></label>
        <label class="f"><span>Street no.</span><input class="in" inputmode="numeric" name="hStreet" id="woHS" value="${esc((w.home || {}).street || '')}"></label>
        <label class="f"><span>Zone no.</span><input class="in" inputmode="numeric" name="hZone" id="woHZ" value="${esc((w.home || {}).zone || '')}"></label></div>
        <label class="f"><span>Area (optional)</span><input class="in" name="hArea" id="woHA" value="${esc((w.home || {}).area || '')}" placeholder="e.g. Al Wakrah, Villa 12"></label>
        <label class="f"><span>Location (Google Maps link)</span><input class="in" name="hMaps" id="woHM" value="${esc((w.home || {}).maps || '')}" placeholder="Paste a shared location link"></label>
        <button type="button" class="btn full" id="woHGps" style="margin:-4px 0 12px">📍 Use my current location</button>
      </div>
      <div class="row"><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${esc(w.date)}" required></label><label class="f"><span>Time</span><input class="in" type="time" name="time" value="${esc(w.time || '')}"></label></div>
      <div class="row"><label class="f"><span>Job type</span><select class="in" name="jobType">${jobs.map(j => `<option ${j === w.jobType ? 'selected' : ''}>${esc(j)}</option>`).join('')}</select></label>
      <label class="f"><span>Priority</span><select class="in" name="priority">${['Normal', 'Urgent', 'Low'].map(p => `<option ${p === w.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
      <label class="f"><span>Technician (from Payroll)</span><select class="in" name="techId">${techOpts}</select></label>
      ${emps().length ? '' : '<p class="hint" style="margin-top:-6px">No employees yet – add your technicians in Payroll → Employees.</p>'}
      <div class="sec"><h2>Equipment &amp; problem</h2></div><div id="woEq"></div><button type="button" class="btn full" id="woEqAdd">+ Add machine</button>
      <div class="sec"><h2>Work done</h2></div>
      <label class="f"><span>What was done</span><textarea class="in" name="work" rows="3" placeholder="e.g. Belt aligned & tensioned, drive belt replaced, tested OK">${esc(w.work || '')}</textarea></label>
      <label class="f"><span>Labour / service charge (QAR, for the invoice)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="labour" value="${esc(w.labour)}" placeholder="0.00"></label>
      <div class="sec"><h2>Parts used (from stock)</h2></div><div id="woParts"></div><button type="button" class="btn full" id="woPAdd">+ Add part</button>
      <label class="f" style="margin-top:12px"><span>Internal note</span><input class="in" name="notes" value="${esc(w.notes || '')}" placeholder="Optional"></label>
      <button class="btn pri full" type="submit">Save work order</button>
      ${ex ? '<button type="button" class="btn danger full" id="woDel" style="margin-top:8px">Delete work order</button>' : ''}</form>`, el => {
      const eqBox = el.querySelector('#woEq'), pBox = el.querySelector('#woParts');
      const drawEq = () => {
        eqBox.innerHTML = w.equipment.map((e, i) => `<div class="wo-eq"><div class="row"><label class="f"><span>Machine</span><input class="in" data-e="${i}" data-k="desc" value="${esc(e.desc)}" placeholder="e.g. Treadmill"></label><label class="f"><span>Brand</span><input class="in" data-e="${i}" data-k="brand" value="${esc(e.brand)}" placeholder="e.g. Life Fitness"></label></div>
          <div class="row"><label class="f"><span>Model</span><input class="in" data-e="${i}" data-k="model" value="${esc(e.model)}"></label><label class="f"><span>Serial no.</span><input class="in" data-e="${i}" data-k="sn" value="${esc(e.sn)}"></label></div>
          <label class="f" style="margin-bottom:4px"><span>Problem reported</span><input class="in" data-e="${i}" data-k="problem" value="${esc(e.problem)}" placeholder="e.g. Belt slipping, error E5"></label>
          ${w.equipment.length > 1 ? `<button type="button" class="btn danger" data-ed="${i}" style="margin-top:6px">Remove machine</button>` : ''}</div>`).join('');
        eqBox.querySelectorAll('[data-e]').forEach(x => x.oninput = () => { w.equipment[+x.dataset.e][x.dataset.k] = x.value; });
        eqBox.querySelectorAll('[data-ed]').forEach(x => x.onclick = () => { w.equipment.splice(+x.dataset.ed, 1); drawEq(); });
      };
      const drawP = () => {
        pBox.innerHTML = w.parts.map((p, i) => `<div class="row" style="align-items:end"><label class="f"><span>Part</span><select class="in" data-p="${i}">${partOpts(p.itemId)}</select></label><label class="f" style="max-width:90px"><span>Qty</span><input class="in" type="number" step="any" min="0" inputmode="decimal" data-q="${i}" value="${esc(p.qty)}"></label><label class="f" style="max-width:110px"><span>Price</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" data-r="${i}" value="${esc(p.price)}"></label><button type="button" class="btn" data-pd="${i}" style="margin-bottom:12px;flex:0 0 auto" aria-label="Remove part">✕</button></div>`).join('');
        pBox.querySelectorAll('[data-p]').forEach(x => x.onchange = () => { const it = itemById(x.value) || {}; const p = w.parts[+x.dataset.p]; p.itemId = x.value; p.desc = it.name || ''; if (!num(p.price)) p.price = num(it.price); drawP(); });
        pBox.querySelectorAll('[data-q]').forEach(x => x.oninput = () => { w.parts[+x.dataset.q].qty = num(x.value); });
        pBox.querySelectorAll('[data-r]').forEach(x => x.oninput = () => { w.parts[+x.dataset.r].price = num(x.value); });
        pBox.querySelectorAll('[data-pd]').forEach(x => x.onclick = () => { w.parts.splice(+x.dataset.pd, 1); drawP(); });
      };
      el.querySelector('#woEqAdd').onclick = () => { w.equipment.push({desc: '', brand: '', model: '', sn: '', problem: ''}); drawEq(); };
      el.querySelector('#woPAdd').onclick = () => { w.parts.push({itemId: '', desc: '', qty: 1, price: 0}); drawP(); };
      drawEq(); drawP();
      let kind = w.kind === 'home' ? 'home' : 'customer';
      el.querySelectorAll('#woKind [data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; el.querySelectorAll('#woKind [data-k]').forEach(x => x.classList.toggle('on', x === b)); el.querySelector('#woCust').style.display = kind === 'home' ? 'none' : ''; el.querySelector('#woHome').style.display = kind === 'home' ? '' : 'none'; });
      // a known mobile fills in the saved name and address
      el.querySelector('#woHP').oninput = () => {
        const h = homeByPhone(el.querySelector('#woHP').value), info = el.querySelector('#woHFound');
        if (!h) { info.textContent = ''; return; }
        const n = db.workorders.filter(x => x.kind === 'home' && digits((x.home || {}).phone) === digits(h.phone)).length;
        info.textContent = `Known client${n ? ' · ' + n + ' earlier visit' + (n > 1 ? 's' : '') : ''} – details filled in.`;
        [['#woHN', 'name'], ['#woHB', 'building'], ['#woHS', 'street'], ['#woHZ', 'zone'], ['#woHA', 'area'], ['#woHM', 'maps']].forEach(([sel, k]) => { const i = el.querySelector(sel); if (!i.value && h[k]) i.value = h[k]; });
      };
      el.querySelector('#woHGps').onclick = () => {
        if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
        const b = el.querySelector('#woHGps'); b.disabled = true; b.textContent = 'Finding location…';
        navigator.geolocation.getCurrentPosition(pos => { el.querySelector('#woHM').value = `https://www.google.com/maps?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`; b.disabled = false; b.textContent = '📍 Location saved – tap again to update'; },
          () => { b.disabled = false; b.textContent = '📍 Use my current location'; toast('Could not get the location – allow location for the app, or paste a link'); }, {enableHighAccuracy: true, timeout: 15000});
      };
      const del = el.querySelector('#woDel'); if (del) del.onclick = () => { if (!confirm(`Delete ${ex.number}?`)) return; db.workorders = db.workorders.filter(x => x.id !== id); save(); while (sheets.length) closeTopSheet(); render(); toast('Deleted'); };
      el.querySelector('#woForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        let home = null;
        if (kind === 'home') {
          if (digits(f.hPhone).length < 7) { toast('Enter the client\'s mobile number'); return; }
          home = {phone: f.hPhone.trim(), name: (f.hName || '').trim(), building: (f.hBuilding || '').trim(), street: (f.hStreet || '').trim(), zone: (f.hZone || '').trim(), area: (f.hArea || '').trim(), maps: (f.hMaps || '').trim()};
          const hc = homeByPhone(home.phone);
          if (hc) Object.assign(hc, Object.fromEntries(Object.entries(home).filter(([, v]) => v)), {updated: Date.now()}); else db.homeclients.push(Object.assign({id: uid(), created: String(Date.now())}, home));
        } else if (!f.customerId) { toast('Choose the customer'); return; }
        const data = {kind, home: home || {}, date: f.date, time: f.time, customerId: kind === 'home' ? '' : f.customerId, jobType: f.jobType, priority: f.priority, techId: f.techId, work: (f.work || '').trim(), labour: num(f.labour) || '', notes: (f.notes || '').trim(),
          equipment: w.equipment.filter(x => x.desc || x.brand || x.model || x.problem), parts: w.parts.filter(p => p.itemId && num(p.qty) > 0)};
        let rec;
        if (ex) { Object.assign(ex, data, {updated: Date.now()}); if (ex.status === 'open' && ex.techId) ex.status = 'assigned'; if (ex.status === 'assigned' && !ex.techId) ex.status = 'open'; rec = ex; }
        else { rec = Object.assign({id: uid(), number: nextNo('nextWO', S().woPrefix || 'WO'), status: data.techId ? 'assigned' : 'open', photos: [], created: String(Date.now()), amcId: w.amcId || '', visitNo: w.visitNo || ''}, data); db.workorders.push(rec); }
        save(); closeSheet(() => { toast(rec.number + ' saved'); viewWO(rec.id); render(); });
      };
    });
  }

  function woHTML(w) {
    const c = party(w), inv = woInvoice(w), amc = w.amcId ? amcById(w.amcId) : null;
    const eqRows = (w.equipment || []).map((e, i) => `<tr><td>${i + 1}</td><td><b>${esc(e.desc || '')}</b>${[e.brand, e.model].filter(Boolean).length ? '<div class="xd">' + esc([e.brand, e.model].filter(Boolean).join(' · ')) + '</div>' : ''}</td><td>${esc(e.sn || '')}</td><td>${esc(e.problem || '')}</td></tr>`).join('');
    const pRows = (w.parts || []).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.desc || (itemById(p.itemId) || {}).name || '')}</td><td class="n">${fq(p.qty)}</td></tr>`).join('');
    return `<div class="paper lay-pro stmt">${brandHead('WORK REPORT', 'تقرير إنجاز العمل', w.number, `<div class="xdue"><small>STATUS</small><b>${esc(woStatus(w)[0].toUpperCase())}</b></div>`)}
      <div class="xmeta two"><div><span class="xl">${c.homeVisit ? 'Home visit' : 'Customer'} <span dir="rtl" lang="ar">· العميل</span></span>${custBlock(c)}${c.homeVisit && c.maps ? '<br>Location: ' + esc(c.maps) : ''}</div>
        <div class="xdg"><span>Date</span><span>${dfmt(w.date)}${w.time ? ' · ' + esc(w.time) : ''}</span><span>Job type</span><span>${esc(w.jobType || '')}</span><span>Technician</span><span>${esc(empName(w.techId) || '—')}</span>${w.doneDate ? `<span>Completed</span><span>${dfmt(w.doneDate)}</span>` : ''}${amc ? `<span>Contract</span><span>${esc(amc.number)}${w.visitNo ? ' · visit ' + w.visitNo : ''}</span>` : ''}${inv ? `<span>Invoice</span><span>${esc(inv.number)}</span>` : ''}</div></div>
      ${eqRows ? `<table class="xitems"><thead><tr><th style="width:28px">#</th><th>Equipment</th><th style="width:110px">Serial no.</th><th>Problem reported</th></tr></thead><tbody>${eqRows}</tbody></table>` : ''}
      ${w.work ? `<h4>Work done</h4><div class="wo-box">${esc(w.work)}</div>` : ''}
      ${pRows ? `<h4>Parts used</h4><table class="xitems"><thead><tr><th style="width:28px">#</th><th>Part</th><th class="n" style="width:70px">Qty</th></tr></thead><tbody>${pRows}</tbody></table>` : ''}
      ${(w.photos || []).length ? `<h4>Photos</h4><div class="wo-photos">${w.photos.map(p => `<img src="${p}" alt="Job photo">`).join('')}</div>` : ''}
      <div class="xsig"><div class="xterms"><b>Customer confirmation</b>${w.sign ? `<img class="wo-sigimg" src="${w.sign}" alt="Customer signature">` : '<div style="height:60px;border-bottom:1px solid #ccc;margin:10px 0"></div>'}<div>${esc(w.signName || '')}${w.sign ? '' : 'Name &amp; signature'}</div><div style="margin-top:4px">Work completed to my satisfaction.</div></div>${stampHTML()}</div>
      <div class="xfoot"><span>${esc(S().name)} · ${esc(S().phone)} · ${esc(S().web)}</span><span>Work order ${esc(w.number)}</span></div></div>`;
  }

  function viewWO(id) {
    const w = woById(id); if (!w) return;
    const c = party(w), inv = woInvoice(w), [st, cls] = woStatus(w), map = pMap(c);
    const next = {open: null, assigned: ['progress', 'Start job'], progress: ['done', 'Mark completed']}[w.status];
    openSheet(w.number, `${shareRow('wo')}
      <div class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${c.homeVisit ? '🏠 ' : ''}${esc(c.name || 'No customer')}</b><span class="badge ${cls}">${st}</span></div>
        <div class="hint">${c.homeVisit ? 'Home visit · ' : ''}${esc(pAddr(c) || 'No address')}</div>
        ${map || c.phone ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px">${map ? `<a class="btn" href="${map}" target="_blank" rel="noopener" style="min-height:36px;padding:6px 14px;flex:0 0 auto">📍 Open in Maps</a>` : ''}${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}" style="min-height:36px;padding:6px 14px;flex:0 0 auto">📞 ${esc(c.phone)}</a>` : ''}${c.phone ? `<a class="btn" href="https://wa.me/${waNumber(c.phone)}" target="_blank" rel="noopener" style="min-height:36px;padding:6px 14px;flex:0 0 auto">${ICON.wa}WhatsApp</a>` : ''}</div>` : ''}
        <div class="hint">${esc(w.jobType || '')} · Priority: ${w.priority === 'Urgent' ? '<b style="color:var(--red)">Urgent</b>' : esc(w.priority || 'Normal')} · ${dfmt(w.date)}${w.time ? ' ' + esc(w.time) : ''}</div></div>
      <div class="sec"><h2>Assigned to</h2></div>
      <div class="card" style="display:flex;gap:10px;align-items:center">${w.techId ? `<div class="wo-av">${esc(initials(empName(w.techId)))}</div><div><b>${esc(empName(w.techId))}</b><div class="hint">Technician</div></div>` : '<div class="hint">Not assigned yet – tap Edit to choose a technician.</div>'}</div>
      <div class="btns" style="margin:12px 0">
        ${w.status === 'open' && !w.techId ? '' : ''}
        ${next ? `<button type="button" class="btn pri" id="woNext">${next[1]}</button>` : ''}
        ${w.status === 'done' && !inv ? `<button type="button" class="btn pri" id="woInv">${ICON.inv}Make invoice</button>` : ''}
        ${inv ? `<button type="button" class="btn" id="woOpenInv">${ICON.inv}Open ${esc(inv.number)}</button>` : ''}
        <button type="button" class="btn" id="woEdit">${ICON.edit}Edit</button>
        ${w.status === 'done' ? '<button type="button" class="btn" id="woReopen">Reopen</button>' : (w.status !== 'cancelled' ? '<button type="button" class="btn danger" id="woCancel">Cancel job</button>' : '<button type="button" class="btn" id="woReopen">Reopen</button>')}</div>
      <div class="sec"><h2>Equipment &amp; work</h2></div>
      ${(w.equipment || []).map((e, i) => `<div class="wo-eq"><b>${i + 1}. ${esc([e.desc, e.brand, e.model].filter(Boolean).join(' · ') || 'Machine')}</b><div class="hint">${esc([e.sn && 'SN ' + e.sn, e.problem].filter(Boolean).join(' · '))}</div></div>`).join('') || '<p class="hint">No machines added.</p>'}
      ${w.work ? `<div class="card" style="white-space:pre-wrap">${esc(w.work)}</div>` : ''}
      ${(w.parts || []).length ? `<div class="sec"><h2>Parts used</h2><span class="hint">${inv ? 'on the invoice' : w.status === 'done' ? 'taken from stock' : 'taken from stock when completed'}</span></div><div class="list">${w.parts.map(p => `<div class="item"><div class="main"><div class="t">${esc(p.desc || (itemById(p.itemId) || {}).name || '')}</div><div class="s">${fq(p.qty)} × ${fmt(p.price)}</div></div><div class="amt">${fmt(num(p.qty) * num(p.price))}</div></div>`).join('')}</div>` : ''}
      <div class="sec"><h2>Photos</h2><span class="hint">up to 6</span></div>
      <div class="wo-ph" id="woPh">${(w.photos || []).map((p, i) => `<div class="ph"><img src="${p}" alt="Job photo ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove photo">✕</button></div>`).join('')}${(w.photos || []).length < 6 ? '<label class="add" aria-label="Add photo">+<input type="file" accept="image/*" multiple id="woPhIn" hidden></label>' : ''}</div>
      <div class="sec"><h2>Customer signature</h2></div>
      ${w.sign ? `<div class="card"><img src="${w.sign}" alt="Signature" style="max-height:110px;display:block"><div class="hint">${esc(w.signName || '')}</div><button type="button" class="btn" id="woSigClr" style="margin-top:8px">Sign again</button></div>`
        : `<canvas class="wo-sig" id="woSig" aria-label="Customer signs here"></canvas><div class="row" style="margin-top:8px;align-items:end"><label class="f"><span>Customer name</span><input class="in" id="woSigN" placeholder="Name of the person signing"></label><button type="button" class="btn" id="woSigX" style="margin-bottom:12px;flex:0 0 auto">Clear</button><button type="button" class="btn pri" id="woSigOk" style="margin-bottom:12px;flex:0 0 auto">Save signature</button></div>`}
      <div class="sec"><h2>Work report preview</h2></div><div id="woPrev">${woHTML(w)}</div>`, el => {
      const reopen = () => reopenWith(() => viewWO(id));
      bindDocShare(el, 'wo', () => woHTML(w), w.number + ' - ' + (c.name || ''), c, 'Work report ' + w.number, `Dear ${c.contact || c.name || ''},\n\nPlease find the work report *${w.number}* for the ${w.jobType || 'service'} on ${dfmt(w.date)}.\n\nThank you,\n${S().name}`);
      const b = s => el.querySelector(s);
      if (b('#woNext')) b('#woNext').onclick = () => { w.status = next[0]; if (w.status === 'done') w.doneDate = today(); save(); reopen(); toast(next[1] === 'Start job' ? 'Job started' : 'Job completed'); render(); };
      if (b('#woInv')) b('#woInv').onclick = () => closeSheet(() => makeInvoice(w));
      if (b('#woOpenInv')) b('#woOpenInv').onclick = () => closeSheet(() => viewDoc(inv.id));
      b('#woEdit').onclick = () => closeSheet(() => editWO(id));
      if (b('#woReopen')) b('#woReopen').onclick = () => { w.status = w.techId ? 'progress' : 'open'; delete w.doneDate; save(); reopen(); };
      if (b('#woCancel')) b('#woCancel').onclick = () => { if (!confirm('Cancel this job?')) return; w.status = 'cancelled'; save(); reopen(); render(); };
      el.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { w.photos.splice(+x.dataset.rm, 1); save(); reopen(); });
      const pin = b('#woPhIn'); if (pin) pin.onchange = async () => {
        const files = [...pin.files].slice(0, 6 - (w.photos || []).length);
        try { for (const f of files) { w.photos = w.photos || []; w.photos.push(await shrink(f)); } save(); reopen(); } catch (e) { toast('Could not read that photo'); }
      };
      if (b('#woSigClr')) b('#woSigClr').onclick = () => { delete w.sign; delete w.signName; save(); reopen(); };
      const cv = b('#woSig');
      if (cv) {
        const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr;
        const g = cv.getContext('2d'); g.scale(dpr, dpr); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
        let down = false, drawn = false; const pt = ev => { const q = cv.getBoundingClientRect(); return [ev.clientX - q.left, ev.clientY - q.top]; };
        cv.onpointerdown = ev => { down = true; cv.setPointerCapture(ev.pointerId); const [x, y] = pt(ev); g.beginPath(); g.moveTo(x, y); };
        cv.onpointermove = ev => { if (!down) return; const [x, y] = pt(ev); g.lineTo(x, y); g.stroke(); drawn = true; };
        cv.onpointerup = cv.onpointercancel = () => { down = false; };
        b('#woSigX').onclick = () => { g.clearRect(0, 0, cv.width, cv.height); drawn = false; };
        b('#woSigOk').onclick = () => {
          if (!drawn) { toast('Ask the customer to sign in the box'); return; }
          // trim to a small PNG
          const out = document.createElement('canvas'); out.width = 500; out.height = Math.round(500 * cv.height / cv.width);
          out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height);
          w.sign = out.toDataURL('image/png'); w.signName = b('#woSigN').value.trim(); save(); reopen(); toast('Signature saved');
        };
      }
    });
  }

  function makeInvoice(w) {
    const amc = w.amcId ? amcById(w.amcId) : null;
    const lines = [];
    const eqs = (w.equipment || []).filter(e => e.desc);
    eqs.forEach(e => lines.push({kind: 'equip', desc: e.desc, brand: e.brand || '', model: e.model || '', sn: e.sn || '', qty: 1, price: 0}));
    if (num(w.labour) || !(w.parts || []).length) lines.push({kind: 'service', itemId: '', desc: (w.jobType || 'Service') + (w.work ? ' – ' + w.work.split('\n')[0].slice(0, 80) : ''), qty: 1, price: num(w.labour)});
    (w.parts || []).forEach(p => { const it = itemById(p.itemId) || {}; lines.push({kind: 'part', itemId: p.itemId, desc: p.desc || it.name || '', qty: num(p.qty), price: num(p.price), cost: num(it.cost)}); });
    if (amc && amc.billing === 'visit' && num(amc.perVisit)) lines.unshift({kind: 'service', desc: `AMC ${amc.number} – service visit ${w.visitNo || ''}`.trim(), qty: 1, price: num(amc.perVisit)});
    const hc = w.kind === 'home' ? homeAccount() : null;
    const draft = {type: 'INV', customerId: hc ? hc.id : w.customerId, date: today(), lines, discount: 0, notes: '', subject: (w.jobType || 'Service') + ' · ' + w.number, jobType: w.jobType, svc: eqs.length > 0, woId: w.id};
    if (hc) { const h = w.home || {}; draft.walkin = {name: h.name || '', phone: h.phone || '', building: h.building || '', street: h.street || '', zone: h.zone || '', area: h.area || '', maps: h.maps || ''}; draft.payType = 'cash'; }
    if (amc && amc.billing === 'visit') { draft.amcId = amc.id; draft.amcKey = 'V' + (w.visitNo || w.id); }
    editDoc('INV', null, draft);
  }

  /* =================== AMC =================== */
  const BILL = {once: 'Full amount once (yearly)', monthly: 'Monthly invoices', quarterly: 'Quarterly invoices', visit: 'Per service visit'};
  const amcStatus = a => { const t = today(); if (a.cancelled) return ['Cancelled', 'b-red']; if (a.start > t) return ['Upcoming', 'b-blue']; if (a.end < t) return ['Expired', 'b-red']; if (daysBetween(t, a.end) <= 30) return ['Renew soon', 'b-yellow']; return ['Active', 'b-green']; };
  const visitPlan = a => { const n = Math.max(1, Math.round(num(a.visits) || 1)), span = Math.max(1, daysBetween(a.start, a.end) + 1); return Array.from({length: n}, (_, i) => { const d = new Date(a.start + 'T00:00:00'); d.setDate(d.getDate() + Math.floor(i * span / n)); return {no: i + 1, date: isoOf(d)}; }); };
  const visitWO = (a, no) => db.workorders.find(w => w.amcId === a.id && String(w.visitNo) === String(no) && w.status !== 'cancelled');
  const months = a => Math.max(1, Math.round(daysBetween(a.start, a.end) / 30.44));
  function installments(a) {
    const v = num(a.value);
    if (a.billing === 'visit') return db.workorders.filter(w => w.amcId === a.id && w.status === 'done').map(w => ({key: 'V' + (w.visitNo || w.id), label: `Visit ${w.visitNo || ''} · ${w.number}`, due: w.doneDate || w.date, amount: num(a.perVisit), wo: w}));
    if (a.billing === 'once') return [{key: 'Y', label: 'Full contract ' + dfmt(a.start) + ' – ' + dfmt(a.end), due: a.start, amount: v}];
    const step = a.billing === 'monthly' ? 1 : 3, n = Math.max(1, Math.ceil(months(a) / step)), each = r2(v / n);
    return Array.from({length: n}, (_, i) => { const from = addMonths(a.start, i * step), to = i === n - 1 ? a.end : addMonths(addMonths(a.start, (i + 1) * step), 0); const end = i === n - 1 ? a.end : addDays(to, -1);
      return {key: (step === 1 ? 'M' : 'Q') + (i + 1), label: `${step === 1 ? 'Month' : 'Quarter'} ${i + 1} · ${dfmt(from)} – ${dfmt(end)}`, due: from, amount: i === n - 1 ? r2(v - each * (n - 1)) : each}; });
  }
  const instInv = (a, k) => db.docs.find(d => d.amcId === a.id && d.amcKey === k && d.type === 'INV' && !d.cancelled);
  const amcDue = a => a.cancelled ? [] : installments(a).filter(x => !instInv(a, x.key) && x.due <= addDays(today(), 7));
  const visitsDue = a => a.cancelled ? [] : visitPlan(a).filter(v => !visitWO(a, v.no) && v.date <= addDays(today(), 7));

  function listAMC() {
    openSheet('AMC contracts', `
      <button type="button" class="btn pri full" id="amNew" style="margin-bottom:12px">+ New AMC contract</button>
      <input class="search" id="amQ" placeholder="Search customer or contract number" aria-label="Search">
      <div class="list" id="amList"></div>`, el => {
      const draw = () => {
        const q = el.querySelector('#amQ').value.trim().toLowerCase();
        const l = db.amcs.filter(a => !q || (a.number + ' ' + cname(a.customerId)).toLowerCase().includes(q)).sort((a, b) => (a.cancelled - b.cancelled) || String(a.end).localeCompare(String(b.end)));
        el.querySelector('#amList').innerHTML = l.length ? l.map(a => { const [s, c] = amcStatus(a), due = amcDue(a).length, vd = visitsDue(a).length;
          return `<button type="button" class="item r2" data-id="${a.id}"><div class="main"><div class="t">${esc(cname(a.customerId))}</div><div class="s">${esc(a.number)} · ${dfmt(a.start)} – ${dfmt(a.end)}${due ? ` · <b class="bal">${due} invoice${due > 1 ? 's' : ''} due</b>` : ''}${vd ? ` · <b class="bal">${vd} visit${vd > 1 ? 's' : ''} due</b>` : ''}</div></div><div class="r"><div class="amt">${fmt(a.value)}</div><span class="badge ${c}">${s}</span></div></button>`; }).join('')
          : `<div class="empty">${db.amcs.length ? 'Nothing matches.' : 'No AMC contracts yet. Add one for each customer with a yearly maintenance contract.'}</div>`;
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => viewAMC(b.dataset.id));
      };
      el.querySelector('#amQ').oninput = draw; draw();
      el.querySelector('#amNew').onclick = () => editAMC();
    });
  }

  function editAMC(id, preset) {
    const ex = id ? amcById(id) : null;
    const a = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({customerId: '', start: today(), end: addDays(addMonths(today(), 12), -1), visits: 4, billing: 'quarterly', value: '', perVisit: '', equipment: [{desc: '', brand: '', model: '', qty: 1}], covers: 'Preventive maintenance visits, inspection, cleaning, lubrication, adjustment and safety check of all listed equipment.\nLabour for breakdown repairs included.\nSpare parts are charged separately after approval.', notes: ''}, preset || {});
    const custOpts = '<option value="">Choose customer…</option>' + db.customers.slice().sort((x, y) => x.name.localeCompare(y.name)).map(c => `<option value="${c.id}" ${c.id === a.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    openSheet(ex ? 'Edit ' + ex.number : 'New AMC contract', `<form id="amForm" autocomplete="off">
      <label class="f"><span>Customer</span><select class="in" name="customerId" required>${custOpts}</select></label>
      <div class="row"><label class="f"><span>Start date</span><input class="in" type="date" name="start" id="amS" value="${esc(a.start)}" required></label><label class="f"><span>End date</span><input class="in" type="date" name="end" id="amE" value="${esc(a.end)}" required></label></div>
      <div class="row"><label class="f"><span>Service visits in the period</span><select class="in" name="visits">${[[12, 'Monthly (12)'], [6, 'Every 2 months (6)'], [4, 'Quarterly (4)'], [3, 'Every 4 months (3)'], [2, 'Every 6 months (2)'], [1, 'Once a year (1)']].map(([v, l]) => `<option value="${v}" ${num(a.visits) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>Contract value (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="value" value="${esc(a.value)}" placeholder="Total for the period"></label></div>
      <label class="f"><span>Billing</span><select class="in" name="billing" id="amB">${Object.entries(BILL).map(([k, l]) => `<option value="${k}" ${a.billing === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" id="amPV" style="${a.billing === 'visit' ? '' : 'display:none'}"><span>Charge per visit (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="perVisit" value="${esc(a.perVisit)}"></label>
      <p class="hint" id="amBH"></p>
      <div class="sec"><h2>Covered equipment</h2></div><div id="amEq"></div><button type="button" class="btn full" id="amEqAdd">+ Add equipment</button>
      <label class="f" style="margin-top:12px"><span>What the contract covers (printed)</span><textarea class="in" name="covers" rows="4">${esc(a.covers || '')}</textarea></label>
      <label class="f"><span>Internal note</span><input class="in" name="notes" value="${esc(a.notes || '')}" placeholder="Optional"></label>
      <button class="btn pri full" type="submit">Save contract</button>
      ${ex ? '<button type="button" class="btn danger full" id="amDel" style="margin-top:8px">Delete contract</button>' : ''}</form>`, el => {
      const eqBox = el.querySelector('#amEq');
      const drawEq = () => {
        eqBox.innerHTML = a.equipment.map((e, i) => `<div class="wo-eq"><div class="row"><label class="f"><span>Equipment</span><input class="in" data-e="${i}" data-k="desc" value="${esc(e.desc)}" placeholder="e.g. Treadmill"></label><label class="f" style="max-width:80px"><span>Qty</span><input class="in" type="number" min="1" inputmode="numeric" data-e="${i}" data-k="qty" value="${esc(e.qty || 1)}"></label></div>
          <div class="row"><label class="f"><span>Brand</span><input class="in" data-e="${i}" data-k="brand" value="${esc(e.brand)}"></label><label class="f"><span>Model</span><input class="in" data-e="${i}" data-k="model" value="${esc(e.model)}"></label></div>
          ${a.equipment.length > 1 ? `<button type="button" class="btn danger" data-ed="${i}">Remove</button>` : ''}</div>`).join('');
        eqBox.querySelectorAll('[data-e]').forEach(x => x.oninput = () => { a.equipment[+x.dataset.e][x.dataset.k] = x.value; });
        eqBox.querySelectorAll('[data-ed]').forEach(x => x.onclick = () => { a.equipment.splice(+x.dataset.ed, 1); drawEq(); });
      };
      el.querySelector('#amEqAdd').onclick = () => { a.equipment.push({desc: '', brand: '', model: '', qty: 1}); drawEq(); };
      drawEq();
      const hint = () => { const f = formData(el.querySelector('#amForm')); const t = {start: f.start, end: f.end, billing: f.billing, value: f.value, visits: f.visits}; el.querySelector('#amPV').style.display = f.billing === 'visit' ? '' : 'none';
        if (f.billing === 'visit') { el.querySelector('#amBH').textContent = 'An invoice is made after each completed service visit.'; return; }
        if (!f.start || !f.end || f.end < f.start) { el.querySelector('#amBH').textContent = ''; return; }
        const ins = installments(t); el.querySelector('#amBH').textContent = ins.length === 1 ? `One invoice of ${money(ins[0].amount)} on ${dfmt(ins[0].due)}.` : `${ins.length} invoices of about ${money(ins[0].amount)} each.`; };
      el.querySelectorAll('#amForm input, #amForm select').forEach(x => x.addEventListener('input', hint)); el.querySelector('#amB').onchange = hint; hint();
      const del = el.querySelector('#amDel'); if (del) del.onclick = () => { if (!confirm(`Delete ${ex.number}? Work orders and invoices already made stay.`)) return; db.amcs = db.amcs.filter(x => x.id !== id); save(); while (sheets.length) closeTopSheet(); render(); toast('Deleted'); };
      el.querySelector('#amForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        if (!f.customerId) { toast('Choose the customer'); return; }
        if (f.end < f.start) { toast('End date is before the start date'); return; }
        const data = {customerId: f.customerId, start: f.start, end: f.end, visits: parseInt(f.visits) || 1, billing: f.billing, value: r2(num(f.value)), perVisit: r2(num(f.perVisit)), covers: f.covers || '', notes: (f.notes || '').trim(), equipment: a.equipment.filter(x => x.desc)};
        let rec;
        if (ex) { Object.assign(ex, data, {updated: Date.now()}); rec = ex; }
        else { rec = Object.assign({id: uid(), number: nextNo('nextAMC', S().amcPrefix || 'AMC'), created: String(Date.now()), renewedFrom: a.renewedFrom || ''}, data); db.amcs.push(rec); }
        save(); closeSheet(() => { toast(rec.number + ' saved'); viewAMC(rec.id); render(); });
      };
    });
  }

  function amcHTML(a) {
    const c = custById(a.customerId) || {}, ins = installments(a), vp = visitPlan(a);
    return `<div class="paper lay-pro stmt">${brandHead('MAINTENANCE CONTRACT', 'عقد صيانة سنوي', a.number, `<div class="xdue"><small>CONTRACT VALUE</small><b>QAR ${fmt(a.value)}</b></div>`)}
      <div class="xmeta two"><div><span class="xl">Customer <span dir="rtl" lang="ar">· العميل</span></span>${custBlock(c)}</div>
        <div class="xdg"><span>Period</span><span>${dfmt(a.start)} – ${dfmt(a.end)}</span><span>Service visits</span><span>${vp.length}</span><span>Billing</span><span>${esc(BILL[a.billing])}${a.billing === 'visit' ? ' · QAR ' + fmt(a.perVisit) : ''}</span></div></div>
      <h4>Covered equipment</h4><table class="xitems"><thead><tr><th style="width:28px">#</th><th>Equipment</th><th>Brand / model</th><th class="n" style="width:60px">Qty</th></tr></thead><tbody>${(a.equipment || []).map((e, i) => `<tr><td>${i + 1}</td><td><b>${esc(e.desc)}</b></td><td>${esc([e.brand, e.model].filter(Boolean).join(' · '))}</td><td class="n">${fq(e.qty || 1)}</td></tr>`).join('')}</tbody></table>
      <h4>Scope of work</h4><div class="wo-box">${esc(a.covers || '')}</div>
      <h4>Visit schedule</h4><table class="xitems"><thead><tr><th style="width:60px">Visit</th><th>Planned date</th></tr></thead><tbody>${vp.map(v => `<tr><td>${v.no}</td><td>${dfmt(v.date)}</td></tr>`).join('')}</tbody></table>
      ${a.billing !== 'visit' ? `<h4>Payment schedule</h4><table class="xitems"><thead><tr><th>Instalment</th><th>Invoice date</th><th class="n">Amount</th></tr></thead><tbody>${ins.map(x => `<tr><td>${esc(x.label.split(' · ')[0])}</td><td>${dfmt(x.due)}</td><td class="n">${fmt(x.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="xsig" style="grid-template-columns:1fr 1fr"><div class="xterms"><b>For the customer</b><div style="height:60px;border-bottom:1px solid #ccc;margin:10px 0"></div><div>Name, signature &amp; stamp</div></div>${stampHTML()}</div>
      <div class="xfoot"><span>${esc(S().name)} · ${esc(S().phone)} · ${esc(S().web)}</span><span>Contract ${esc(a.number)}</span></div></div>`;
  }

  function viewAMC(id) {
    const a = amcById(id); if (!a) return;
    const c = custById(a.customerId) || {}, [st, cls] = amcStatus(a), ins = installments(a), vp = visitPlan(a);
    const invoiced = r2(ins.reduce((s, x) => s + (instInv(a, x.key) ? docTotal(instInv(a, x.key)) : 0), 0));
    const left = daysBetween(today(), a.end);
    const nextVisit = vp.find(v => !visitWO(a, v.no));
    openSheet(a.number, `${shareRow('am')}
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>${esc(c.name || '')}</b><span class="badge ${cls}">${st}</span></div>
        <div class="hint">${dfmt(a.start)} – ${dfmt(a.end)} · ${vp.length} visit${vp.length > 1 ? 's' : ''} · ${(a.equipment || []).reduce((s, e) => s + num(e.qty || 1), 0)} machines · ${esc(BILL[a.billing])}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;text-align:center">
          <div class="card" style="padding:8px"><div class="hint">Contract</div><b>${fmt(a.value)}</b></div><div class="card" style="padding:8px"><div class="hint">Invoiced</div><b>${fmt(invoiced)}</b></div>
          <div class="card" style="padding:8px"><div class="hint">${left >= 0 ? 'Ends in' : 'Ended'}</div><b style="color:${left <= 30 ? 'var(--orange)' : 'inherit'}">${Math.abs(left)} days</b></div></div></div>
      <div class="btns" style="margin:12px 0"><button type="button" class="btn" id="amWa">${ICON.wa}WhatsApp reminder</button><button type="button" class="btn" id="amRenew">Renew</button><button type="button" class="btn" id="amEdit">${ICON.edit}Edit</button>
        <button type="button" class="btn ${a.cancelled ? '' : 'danger'}" id="amCan">${a.cancelled ? 'Reactivate' : 'Cancel contract'}</button></div>
      <div class="sec"><h2>Billing</h2><span class="hint">${esc(BILL[a.billing])}</span></div>
      <div class="list">${ins.length ? ins.map(x => { const d = instInv(a, x.key), [t1, t2] = x.label.split(' · '); return `<div class="item"><div class="main"><div class="t">${esc(t1)} · ${fmt(x.amount)}</div><div class="s">${esc(t2 || '')}${d ? ' · ' + esc(d.number) + ' · ' + status(d)[0] : ''}</div></div>${d ? `<button type="button" class="btn" style="flex:0 0 auto;min-height:38px;padding:6px 14px" data-od="${d.id}">Open</button>` : `<button type="button" class="btn ${x.due <= today() ? 'pri' : ''}" style="flex:0 0 auto;min-height:38px;padding:6px 14px" data-mi="${x.key}">Invoice</button>`}</div>`; }).join('') : `<div class="empty">${a.billing === 'visit' ? 'An invoice line appears here after each completed visit.' : 'No billing.'}</div>`}</div>
      <div class="sec"><h2>Service visits</h2><span class="hint">each visit is a work order</span></div>
      <div class="list">${vp.map(v => { const w = visitWO(a, v.no); return `<div class="item"><div class="main"><div class="t">Visit ${v.no} · ${dfmt(v.date)}</div><div class="s">${w ? esc(w.number) + ' · ' + woStatus(w)[0] + (w.techId ? ' · ' + esc(empName(w.techId)) : '') : (v.date < today() ? '<b style="color:var(--red)">Not done yet</b>' : 'Planned')}</div></div>${w ? `<button type="button" class="btn" style="flex:0 0 auto;min-height:38px;padding:6px 14px" data-ow="${w.id}">Open</button>` : `<button type="button" class="btn ${v.date <= addDays(today(), 7) ? 'pri' : ''}" style="flex:0 0 auto;min-height:38px;padding:6px 14px" data-sv="${v.no}">Schedule</button>`}</div>`; }).join('')}</div>
      <div class="sec"><h2>Contract preview</h2></div><div id="amPrev">${amcHTML(a)}</div>`, el => {
      const reopen = () => reopenWith(() => viewAMC(id));
      bindDocShare(el, 'am', () => amcHTML(a), a.number + ' - ' + (c.name || ''), c, 'Maintenance contract ' + a.number, `Dear ${c.contact || c.name || ''},\n\nPlease find our maintenance contract *${a.number}* (${dfmt(a.start)} – ${dfmt(a.end)}).\n\nThank you,\n${S().name}`);
      el.querySelectorAll('[data-od]').forEach(b => b.onclick = () => viewDoc(b.dataset.od));
      el.querySelectorAll('[data-ow]').forEach(b => b.onclick = () => viewWO(b.dataset.ow));
      el.querySelectorAll('[data-mi]').forEach(b => b.onclick = () => {
        const x = ins.find(i => i.key === b.dataset.mi); if (!x) return;
        const amcItem = db.items.find(i => /annual maintenance contract/i.test(i.name || ''));
        closeSheet(() => editDoc('INV', null, {type: 'INV', customerId: a.customerId, date: today(), discount: 0, notes: '', jobType: 'AMC contract', subject: `Maintenance contract ${a.number}`, amcId: a.id, amcKey: x.key,
          lines: [{kind: 'service', itemId: amcItem ? amcItem.id : '', desc: `Annual maintenance contract ${a.number} – ${x.label}`, qty: 1, price: x.amount}]}));
      });
      el.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => {
        const v = vp.find(x => String(x.no) === b.dataset.sv);
        closeSheet(() => editWO(null, {customerId: a.customerId, date: v.date < today() ? today() : v.date, jobType: (S().jobTypes || []).find(j => /preventive/i.test(j)) || 'Preventive maintenance', amcId: a.id, visitNo: v.no,
          equipment: (a.equipment || []).map(e => ({desc: e.desc + (num(e.qty) > 1 ? ' × ' + fq(e.qty) : ''), brand: e.brand || '', model: e.model || '', sn: '', problem: `AMC ${a.number} – visit ${v.no}`}))}));
      });
      el.querySelector('#amEdit').onclick = () => closeSheet(() => editAMC(id));
      el.querySelector('#amCan').onclick = () => { if (!a.cancelled && !confirm('Cancel this contract? Planned visits and invoices stop.')) return; a.cancelled = !a.cancelled; save(); reopen(); render(); };
      el.querySelector('#amRenew').onclick = () => {
        const ns = addDays(a.end, 1), len = daysBetween(a.start, a.end);
        closeSheet(() => editAMC(null, {customerId: a.customerId, start: ns, end: addDays(ns, len), visits: a.visits, billing: a.billing, value: a.value, perVisit: a.perVisit, equipment: JSON.parse(JSON.stringify(a.equipment || [])), covers: a.covers, renewedFrom: a.id}));
      };
      el.querySelector('#amWa').onclick = () => {
        const msg = left <= 30 && left >= -60
          ? `Dear ${c.contact || c.name || ''},\n\nYour maintenance contract *${a.number}* with ${S().name} ${left >= 0 ? 'ends on ' + dfmt(a.end) : 'ended on ' + dfmt(a.end)}. Shall we renew it for the next year?\n\nThank you,\n${S().name}\n${S().phone}`
          : `Dear ${c.contact || c.name || ''},\n\nReminder: your next maintenance visit (${a.number}) is planned on *${nextVisit ? dfmt(nextVisit.date) : '—'}*. Please confirm a suitable time.\n\nThank you,\n${S().name}\n${S().phone}`;
        openLink(`https://wa.me/${waNumber(c.phone || '')}?text=` + encodeURIComponent(msg));
      };
    });
  }

  /* ---------- dashboard alert + menus ---------- */
  const origHome = window.viewHome;
  if (origHome) window.viewHome = function () {
    const r = origHome.apply(this, arguments);
    try {
      const main = document.getElementById('main'); if (!main || main.querySelector('#woHomeCard')) return r;
      const act = db.workorders.filter(w => ['open', 'assigned', 'progress'].includes(w.status)).length;
      const vd = db.amcs.reduce((s, a) => s + visitsDue(a).length, 0), idue = db.amcs.reduce((s, a) => s + amcDue(a).length, 0);
      const ren = db.amcs.filter(a => !a.cancelled && a.end >= today() && daysBetween(today(), a.end) <= 30).length;
      if (!act && !vd && !idue && !ren) return r;
      const parts = [act && `<b>${act}</b> open work order${act > 1 ? 's' : ''}`, vd && `<b>${vd}</b> AMC visit${vd > 1 ? 's' : ''} to schedule`, idue && `<b>${idue}</b> AMC invoice${idue > 1 ? 's' : ''} due`, ren && `<b>${ren}</b> contract${ren > 1 ? 's' : ''} to renew`].filter(Boolean);
      const card = document.createElement('div'); card.id = 'woHomeCard'; card.className = 'card'; card.style.cssText = 'margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      card.innerHTML = `<div style="flex:1;min-width:200px">${ICON.wrench || ''} ${parts.join(' · ')}</div><button type="button" class="btn" id="woHomeW">Work orders</button>${db.amcs.length ? '<button type="button" class="btn" id="woHomeA">AMC</button>' : ''}`;
      main.insertBefore(card, main.firstElementChild ? main.firstElementChild.nextSibling : null);
      card.querySelector('#woHomeW').onclick = listWO; const ha = card.querySelector('#woHomeA'); if (ha) ha.onclick = listAMC;
    } catch (e) {}
    return r;
  };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mRcv') || document.querySelector('#main .item.rcard');
    if (!a || document.getElementById('mWO')) return;
    const row = (id, t, s) => `<button type="button" class="item rcard" id="${id}"><span class="ic">${ICON.wrench || ICON.box}</span><div class="main"><div class="t">${t}</div><div class="s">${s}</div></div></button>`;
    a.insertAdjacentHTML('beforebegin', row('mWO', 'Work orders', 'Jobs, technicians, photos, signature & work report') + row('mAMC', 'AMC contracts', 'Maintenance contracts, visits, billing & renewals'));
    document.getElementById('mWO').onclick = listWO; document.getElementById('mAMC').onclick = listAMC;
  };

  window.FitxWO = {list: listWO, edit: editWO, view: viewWO, html: woHTML, makeInvoice};
  window.FitxAMC = {list: listAMC, edit: editAMC, view: viewAMC, html: amcHTML, installments, visitPlan};
})();
