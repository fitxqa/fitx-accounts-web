/* FitX Accounts — purchase orders to suppliers.
   A PO is a commitment only: no ledger posting and no stock movement. When the goods arrive,
   "Convert to bill" opens a new purchase (bill) pre-filled from the PO; the bill does the accounting and stock.
   Records: db.porders = [{id, number, supplierId, date, delivery, ref, lines:[{itemId, desc, qty, cost}], notes, terms, status, billId, created, updated}] */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['porders']);
  const ensure = () => { if (!Array.isArray(db.porders)) db.porders = []; };
  ensure();
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const poById = id => db.porders.find(p => p.id === id);
  const poTotal = p => r2((p.lines || []).reduce((s, l) => s + num(l.qty) * num(l.cost), 0) - num(p.discount));
  const STAT = {Draft: 'b-grey', Sent: 'b-orange', 'Part received': 'b-orange', Received: 'b-green', Cancelled: 'b-red'};
  const top = () => sheets[sheets.length - 1];

  function poHTML(p) {
    const s = S(), sp = supById(p.supplierId) || {};
    const rows = (p.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.desc || (itemById(l.itemId) || {}).name || '')}${l.itemId && (itemById(l.itemId) || {}).sku ? `<br><small style="color:#777">${esc(itemById(l.itemId).sku)}</small>` : ''}</td><td style="text-align:right">${fmtQ(l.qty)}</td><td style="text-align:right">${fmt(num(l.cost))}</td><td style="text-align:right"><b>${fmt(num(l.qty) * num(l.cost))}</b></td></tr>`).join('');
    const gross = (p.lines || []).reduce((a, l) => a + num(l.qty) * num(l.cost), 0);
    return reportPaper('Purchase order', 'أمر شراء', p.number + ' · ' + dfmt(p.date), `
      <table style="width:100%;margin:0 0 12px;font-size:12px"><tr>
        <td style="vertical-align:top;width:55%"><div style="color:#777;font-size:10px;font-weight:700;letter-spacing:.06em">SUPPLIER</div><b style="font-size:14px">${esc(sp.name || '')}</b>${sp.contact ? '<br>Attn: ' + esc(sp.contact) : ''}${sp.phone ? '<br>' + esc(sp.phone) : ''}${sp.email ? '<br>' + esc(sp.email) : ''}${sp.address ? '<br>' + esc(sp.address) : ''}</td>
        <td style="vertical-align:top;text-align:right">PO No: <b>${esc(p.number)}</b><br>Date: ${dfmt(p.date)}<br>Delivery by: <b>${p.delivery ? dfmt(p.delivery) : 'ASAP'}</b>${p.ref ? '<br>Your quote ref: ' + esc(p.ref) : ''}<br>Deliver to: ${esc(p.deliverTo || s.address || '')}</td></tr></table>
      <table class="eqt"><thead><tr><th>#</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <table style="margin:10px 0 0 auto;font-size:13px;min-width:240px">
        ${num(p.discount) ? `<tr><td>Subtotal</td><td style="text-align:right">${fmt(gross)}</td></tr><tr><td>Discount</td><td style="text-align:right">− ${fmt(num(p.discount))}</td></tr>` : ''}
        <tr><td style="padding-top:6px"><b>TOTAL (QAR)</b></td><td style="text-align:right;padding-top:6px;font-size:16px;font-weight:800;color:#ff6a00">${money(poTotal(p))}</td></tr></table>
      ${p.terms ? `<div style="margin-top:16px;font-size:11.5px"><b>Terms</b><div style="white-space:pre-wrap">${esc(p.terms)}</div></div>` : ''}
      ${p.notes ? `<div style="margin-top:10px;font-size:11.5px"><b>Notes</b><div style="white-space:pre-wrap">${esc(p.notes)}</div></div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-top:36px;font-size:11.5px"><div>Authorised by: ____________________</div><div>Supplier acceptance: ____________________</div></div>`);
  }
  const fmtQ = q => String(+num(q).toFixed(3));
  const fname = p => p.number + ' - ' + ((supById(p.supplierId) || {}).name || '');

  /* ---------- editor ---------- */
  function editPO(id, prefill) {
    const ex = id ? poById(id) : null, s = S();
    const d = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({supplierId: '', date: today(), delivery: '', ref: '', lines: [{itemId: '', desc: '', qty: 1, cost: ''}], discount: 0, notes: '', terms: s.poTerms || 'Please confirm the order and delivery date.\nPrices in QAR. Invoice must quote this PO number.', status: 'Draft'}, prefill || {});
    if (!d.lines.length) d.lines.push({itemId: '', desc: '', qty: 1, cost: ''});
    openSheet(ex ? 'Edit ' + ex.number : 'New purchase order', `<form id="poForm" autocomplete="off">
      <label class="f"><span>Supplier</span><select class="in" name="supplierId" required>${supplierOptions(d.supplierId)}</select></label>
      <div class="row"><label class="f"><span>PO date</span><input class="in" type="date" name="date" value="${esc(d.date)}" required></label><label class="f"><span>Delivery by</span><input class="in" type="date" name="delivery" value="${esc(d.delivery || '')}"></label></div>
      <label class="f"><span>Supplier quote / ref</span><input class="in" name="ref" value="${esc(d.ref || '')}" placeholder="Optional"></label>
      <div class="sec"><h2>Items to order</h2></div>
      <div id="polines"></div>
      <button type="button" class="btn full" id="poAdd">+ Add line</button>
      <label class="f" style="margin-top:12px"><span>Discount (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="discount" id="poDisc" value="${d.discount || ''}" placeholder="0.00"></label>
      <div class="tot" id="poTot"></div>
      <label class="f"><span>Terms</span><textarea class="in" name="terms">${esc(d.terms || '')}</textarea></label>
      <label class="f"><span>Notes</span><textarea class="in" name="notes" placeholder="Optional">${esc(d.notes || '')}</textarea></label>
      <button type="submit" class="btn pri full">Save purchase order</button></form>`, el => {
      const L = el.querySelector('#polines');
      const tot = () => { d.discount = num(el.querySelector('#poDisc').value); el.querySelector('#poTot').innerHTML = `<div class="g"><span>Total</span><span>${money(poTotal(d))}</span></div>`; };
      const draw = () => {
        L.innerHTML = d.lines.map((l, i) => `<div class="line" data-i="${i}">
          <div class="lt"><span>Line ${i + 1}</span>${d.lines.length > 1 ? '<button type="button" class="ldel">Remove</button>' : ''}</div>
          <div style="display:flex;gap:8px;margin-bottom:8px"><select class="in litem" aria-label="Item">${partOptions(l.itemId).replace('No stock item (direct job cost)', 'Type your own (no item)')}</select><button type="button" class="btn lpick" aria-label="Search parts">${ICON.search}</button></div>
          <input class="in ldesc" aria-label="Description" placeholder="Description" value="${esc(l.desc)}" style="margin-bottom:8px">
          <div class="row3"><label><span class="hint">Qty</span><input class="in lqty" type="number" step="any" min="0" inputmode="decimal" value="${l.qty}"></label>
            <label><span class="hint">Unit price</span><input class="in lcost" type="number" step="0.01" min="0" inputmode="decimal" value="${l.cost}" placeholder="0.00"></label>
            <div><span class="hint">Amount</span><div class="amt lamt">${fmt(num(l.qty) * num(l.cost))}</div></div></div></div>`).join('');
        tot();
      };
      L.addEventListener('input', e => {
        const row = e.target.closest('.line'); if (!row) return; const l = d.lines[+row.dataset.i];
        if (e.target.classList.contains('ldesc')) l.desc = e.target.value;
        if (e.target.classList.contains('lqty')) l.qty = e.target.value;
        if (e.target.classList.contains('lcost')) l.cost = e.target.value;
        row.querySelector('.lamt').textContent = fmt(num(l.qty) * num(l.cost)); tot();
      });
      L.addEventListener('change', e => {
        if (!e.target.classList.contains('litem')) return;
        const l = d.lines[+e.target.closest('.line').dataset.i];
        if (e.target.value === NEWITEM) { e.target.value = l.itemId || ''; return; }
        const it = itemById(e.target.value); l.itemId = e.target.value;
        if (it) { l.desc = it.name; if (!num(l.cost)) l.cost = it.cost || ''; }
        draw();
      });
      L.addEventListener('click', e => {
        const row = e.target.closest('.line'); if (!row) return; const i = +row.dataset.i;
        if (e.target.closest('.ldel')) { d.lines.splice(i, 1); draw(); }
        if (e.target.closest('.lpick')) pickItem({partsOnly: true}, it => { const sel = row.querySelector('.litem'); sel.value = it.id; sel.dispatchEvent(new Event('change', {bubbles: true})); });
      });
      el.querySelector('#poAdd').onclick = () => { d.lines.push({itemId: '', desc: '', qty: 1, cost: ''}); draw(); };
      el.querySelector('#poDisc').oninput = tot;
      el.querySelector('#poForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        const lines = d.lines.filter(l => (l.desc || '').trim() || l.itemId).map(l => ({itemId: l.itemId || '', desc: (l.desc || '').trim(), qty: num(l.qty), cost: num(l.cost)}));
        if (!v.supplierId) { toast('Choose a supplier'); return; }
        if (!lines.length) { toast('Add at least one line'); return; }
        const rec = ex || {id: uid(), created: Date.now(), status: 'Draft'};
        if (!ex) { rec.number = `${s.poPrefix || 'PO'}-${new Date().getFullYear()}-${String(s.nextPO || 1).padStart(4, '0')}`; s.nextPO = (s.nextPO || 1) + 1; db.porders.push(rec); }
        Object.assign(rec, {supplierId: v.supplierId, date: v.date, delivery: v.delivery, ref: v.ref.trim(), lines, discount: num(v.discount), terms: v.terms, notes: v.notes, updated: Date.now()});
        save();
        closeSheet(() => { toast(rec.number + ' saved'); if (state.tab === 'porders') render(); viewPO(rec.id); });
      };
      draw();
    });
  }

  /* ---------- view ---------- */
  function viewPO(id) {
    const p = poById(id); if (!p) return;
    const sp = supById(p.supplierId) || {};
    const bill = p.billId && purById(p.billId);
    openSheet(p.number, `
      <div style="margin:0 2px 12px;font-size:15px"><b>${esc(sp.name || '')}</b> · ${money(poTotal(p))} <span class="badge ${STAT[p.status] || 'b-grey'}">${esc(p.status || 'Draft')}</span>${bill ? `<br><span class="hint">Billed as ${esc(bill.number)}</span>` : ''}</div>
      <div class="btns sharebar" style="margin-bottom:12px">
        <button type="button" class="btn pri" id="poShare">${ICON.share}Share PDF</button><button type="button" class="btn" id="poWa">${ICON.wa}WhatsApp</button>
        <button type="button" class="btn" id="poMail">${ICON.mail}Email</button><button type="button" class="btn" id="poPrint">${ICON.print}Print</button><button type="button" class="btn" id="poPv">${ICON.search}PDF preview</button></div>
      <div class="btns" style="margin-bottom:12px">
        ${!bill && p.status !== 'Cancelled' ? `<button type="button" class="btn pri" id="poBill">${ICON.conv}Goods received – create bill</button>` : bill ? `<button type="button" class="btn" id="poOpenBill">Open bill ${esc(bill.number)}</button>` : ''}
        ${!bill ? `<button type="button" class="btn" id="poEdit">${ICON.edit}Edit</button>` : ''}
        <select class="in" id="poSt" style="width:auto;min-height:44px" aria-label="Status">${['Draft', 'Sent', 'Part received', 'Received', 'Cancelled'].map(x => `<option ${x === (p.status || 'Draft') ? 'selected' : ''}>${x}</option>`).join('')}</select>
        ${!bill ? `<button type="button" class="btn danger" id="poDel">${ICON.trash}Delete</button>` : ''}</div>
      <div class="sec"><h2>Preview</h2></div><div>${poHTML(p)}</div>`, el => {
      const mark = () => { if (p.status === 'Draft') { p.status = 'Sent'; p.updated = Date.now(); save(); } };
      const opts = () => ({html: poHTML(p), name: fname(p), phone: sp.phone, email: sp.email, subject: 'Purchase order ' + p.number, body: '',
        wa: `Dear ${sp.contact || sp.name || 'Sir/Madam'},\n\nPlease find our purchase order *${p.number}* – total ${money(poTotal(p))}${p.delivery ? ', delivery by ' + dfmt(p.delivery) : ''}.\nKindly confirm.\n\nThank you,\n${S().name}`});
      bindShare(el, 'po', () => { mark(); return opts(); }, () => printHTML(poHTML(p), fname(p)));
      el.querySelector('#poMail').onclick = () => FitxMail.compose({kind: 'po', to: sp.email, cust: {name: sp.name, contact: sp.contact, email: sp.email, phone: sp.phone}, rec: p, phone: sp.phone,
        vars: FitxMail.baseVars({name: sp.contact || sp.name || 'Sir/Madam', customer: sp.name || '', supplier: sp.name || '', number: p.number, date: dfmt(p.date), due: p.delivery ? dfmt(p.delivery) : 'as soon as possible', total: money(poTotal(p))}),
        title: 'Purchase order', rows: [['PO no.', p.number], ['Date', dfmt(p.date)], ['Delivery by', p.delivery ? dfmt(p.delivery) : 'ASAP'], ['Order total', money(poTotal(p)), true]],
        atts: [{name: fname(p), html: () => poHTML(p)}], onSent: mark});
      el.querySelector('#poPv').onclick = () => FitxMail.pdfPreview(poHTML(p), fname(p));
      el.querySelector('#poSt').onchange = e => { p.status = e.target.value; p.updated = Date.now(); save(); reopenWith(() => viewPO(id)); if (state.tab === 'porders') render(); };
      const ed = el.querySelector('#poEdit'); if (ed) ed.onclick = () => closeSheet(() => editPO(id));
      const dl = el.querySelector('#poDel'); if (dl) dl.onclick = () => { if (!confirm('Delete ' + p.number + '?')) return; db.porders.splice(db.porders.indexOf(p), 1); save(); closeSheet(() => { if (state.tab === 'porders') render(); }); };
      const ob = el.querySelector('#poOpenBill'); if (ob) ob.onclick = () => viewPurchase(p.billId);
      const bb = el.querySelector('#poBill'); if (bb) bb.onclick = () => toBill(p);
    });
  }

  /* goods received → bill: open the purchase form pre-filled; link it back once saved */
  function toBill(p) {
    const before = new Set(db.purchases.map(x => x.id));
    const sp = supById(p.supplierId) || {};
    while (sheets.length) closeTopSheet();
    editPurchase(null, {supplierId: p.supplierId, ref: p.ref || '', discount: num(p.discount), notes: 'PO ' + p.number, whtRate: sp.wht || '',
      lines: (p.lines || []).map(l => ({itemId: l.itemId || '', desc: l.desc, qty: l.qty, cost: l.cost}))});
    pending = {po: p.id, before};
  }
  let pending = null;
  const origSave = window.save;
  window.save = function () {
    if (pending) {
      const nw = db.purchases.find(x => !pending.before.has(x.id));
      if (nw) { const p = poById(pending.po); if (p) { p.billId = nw.id; p.status = 'Received'; p.updated = Date.now(); } pending = null; }
    }
    return origSave.apply(this, arguments);
  };
  // drop the pending link if the purchase form is closed without saving
  setInterval(() => { if (pending && !sheets.length) pending = null; }, 3000);

  /* ---------- list (Expenses → Purchase orders) ---------- */
  function viewPOs() {
    setTop('Expenses', '+ PO', () => editPO());
    ensure();
    const F = state.poFilter || 'Open', q = (state.poQ || '').toLowerCase();
    let list = db.porders.filter(p => !q || [p.number, p.ref, (supById(p.supplierId) || {}).name].join(' ').toLowerCase().includes(q));
    if (F === 'Open') list = list.filter(p => !['Received', 'Cancelled'].includes(p.status));
    if (F === 'Received') list = list.filter(p => p.status === 'Received');
    list.sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
    $('#main').innerHTML = subnav('expenses') + `
      <button type="button" class="btn pri full" id="poNew" style="margin-bottom:12px">+ New purchase order</button>
      <input class="search" id="poQ" placeholder="Search PO number, supplier or ref" aria-label="Search purchase orders" value="${esc(state.poQ || '')}">
      <div class="chips">${['Open', 'Received', 'All'].map(f => `<button type="button" data-pf="${f}" class="${F === f ? 'on' : ''}">${f}</button>`).join('')}</div>
      <div class="list">${list.length ? list.map(p => `<button type="button" class="item" data-po="${p.id}"><div class="main"><div class="t">${esc((supById(p.supplierId) || {}).name || 'No supplier')}</div><div class="s">${esc(p.number)} · ${dfmt(p.date)}${p.delivery ? ' · delivery ' + dfmt(p.delivery) : ''}${p.billId && purById(p.billId) ? ' · bill ' + esc(purById(p.billId).number) : ''}</div></div><div class="r"><div class="amt">${fmt(poTotal(p))}</div><span class="badge ${STAT[p.status] || 'b-grey'}">${esc(p.status || 'Draft')}</span></div></button>`).join('')
        : `<div class="empty">${db.porders.length ? 'Nothing here.' : 'No purchase orders yet. Send a PO to your supplier, then turn it into a bill when the parts arrive.'}</div>`}</div>
      <p class="hint" style="margin:10px 4px">${list.length} PO${list.length === 1 ? '' : 's'} · Total ${money(list.reduce((s, p) => s + poTotal(p), 0))}</p>`;
    $('#poNew').onclick = () => editPO();
    $('#poQ').oninput = e => { state.poQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#poQ'); i.focus(); i.setSelectionRange(pos, pos); };
    $$('#main [data-pf]').forEach(b => b.onclick = () => { state.poFilter = b.dataset.pf; render(); });
    $$('#main [data-po]').forEach(b => b.onclick = () => viewPO(b.dataset.po));
  }
  window.FITX_VIEWS = Object.assign(window.FITX_VIEWS || {}, {porders: viewPOs});
  if (typeof NAV_GROUP !== 'undefined') NAV_GROUP.porders = 'expenses';
  if (typeof SUBNAV !== 'undefined' && !SUBNAV.expenses.some(x => x[0] === 'porders')) SUBNAV.expenses.splice(2, 0, ['porders', 'Purchase orders']);

  // PO button on the supplier screen
  window.FitxPO = {edit: editPO, view: viewPO, html: poHTML, total: poTotal};
})();
