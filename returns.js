/* FitX Accounts — Sales return / Credit note and Purchase return / Debit note.
   Credit note (CN): against one invoice. Lowers the invoice balance; returned parts can go back to stock;
     money paid back to the customer is recorded as a refund. Ledger: Dr Sales returns, Cr Receivables;
     restocked parts Dr Inventory, Cr Cost of parts sold; refund Dr Receivables, Cr bank/cash.
   Debit note (DN): against one bill. Lowers what you owe the supplier; returned stock leaves stock at the bill cost;
     money the supplier pays back is a refund. Ledger: Dr Payables, Cr Inventory (stock) / Direct job costs (other);
     refund Dr bank/cash, Cr Payables.
   Records: db.cnotes = [{id, number, date, customerId, invoiceId, reason, note, lines:[{li, itemId, desc, qty, price, restock}], refunds:[{amount, date, method, acc, note}], created}]
            db.dnotes = [{id, number, date, supplierId, purchaseId, reason, note, lines:[{li, itemId, desc, qty, cost}], refunds:[…], created}] */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['cnotes', 'dnotes']);
  const ACC_RET = 'acc_4960';
  function ensure() {
    if (!Array.isArray(db.cnotes)) db.cnotes = [];
    if (!Array.isArray(db.dnotes)) db.dnotes = [];
    if (Array.isArray(db.accounts) && !db.accounts.some(a => a.id === ACC_RET)) db.accounts.push({id: ACC_RET, code: '4960', name: 'Sales returns (credit notes)', type: 'income', sub: 'returns', system: true});
  }
  ensure();
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const cnById = id => db.cnotes.find(n => n.id === id);
  const dnById = id => db.dnotes.find(n => n.id === id);
  const lineSum = (n, f) => r2((n.lines || []).reduce((s, l) => s + num(l.qty) * num(l[f]), 0));
  const cnTotal = n => lineSum(n, 'price');
  const dnTotal = n => lineSum(n, 'cost');
  const refunded = n => r2((n.refunds || []).reduce((s, x) => s + num(x.amount), 0));
  const invOk = n => { const d = docById(n.invoiceId); return d && !d.cancelled; };
  const cnsOf = invId => db.cnotes.filter(n => n.invoiceId === invId && invOk(n));
  const dnsOf = purId => db.dnotes.filter(n => n.purchaseId === purId && purById(n.purchaseId));
  const moneyAcc = (acc, method) => (acc && (db.accounts || []).some(a => a.id === acc)) ? acc : ((S().methodAcc || {})[method] || 'acc_' + (method === 'Cash' ? 1000 : 1100));
  const isStock = id => { const it = id && itemById(id); return !!(it && !it.service); };
  const fq = q => String(+num(q).toFixed(3));
  const METHODS = ['Cash', 'Fawran', 'Bank transfer', 'Card', 'Cheque'];
  const accOpts = () => window.bankAccOptions ? bankAccOptions('') : '<option value="">Automatic</option>';
  const nextNo = (key, pre) => { const s = S(); const n = s[key] || 1; s[key] = n + 1; return `${pre}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; };

  /* ---------- totals used by the core (balances, status) ---------- */
  const invCredit = id => r2(cnsOf(id).reduce((s, n) => s + cnTotal(n), 0));
  const invRefund = id => r2(cnsOf(id).reduce((s, n) => s + refunded(n), 0));
  const billDebit = id => r2(dnsOf(id).reduce((s, n) => s + dnTotal(n), 0));
  const billRefund = id => r2(dnsOf(id).reduce((s, n) => s + refunded(n), 0));
  // cost of a returned invoice line = the cost saved on that invoice line
  const cnLineCost = (n, l) => { const d = docById(n.invoiceId); const il = d && l.li !== undefined && l.li !== '' ? (d.lines || [])[l.li] : null; return il ? lineUnitCost(il) : num((itemById(l.itemId) || {}).cost); };
  const restockCost = n => r2((n.lines || []).reduce((s, l) => s + (l.restock && isStock(l.itemId) ? num(l.qty) * cnLineCost(n, l) : 0), 0));
  const dnStockVal = n => r2((n.lines || []).reduce((s, l) => s + (isStock(l.itemId) ? num(l.qty) * num(l.cost) : 0), 0));
  const returnedQty = (list, key, parentId, li, exceptId) => list.filter(n => n[key] === parentId && n.id !== exceptId).reduce((s, n) => s + (n.lines || []).reduce((a, l) => a + (String(l.li) === String(li) ? num(l.qty) : 0), 0), 0);

  /* ---------- stock movements ---------- */
  (window.FITX_STOCK_FLOWS = window.FITX_STOCK_FLOWS || []).push(itemId => {
    const out = [];
    db.cnotes.forEach(n => { if (invOk(n)) (n.lines || []).forEach(l => { if (l.restock && l.itemId === itemId && isStock(itemId)) out.push({date: n.date, qty: num(l.qty), src: 'ret'}); }); });
    db.dnotes.forEach(n => { if (purById(n.purchaseId)) (n.lines || []).forEach(l => { if (l.itemId === itemId && isStock(itemId)) out.push({date: n.date, qty: -num(l.qty), src: 'pret'}); }); });
    return out;
  });

  /* ---------- books ---------- */
  (window.FITX_POSTERS = window.FITX_POSTERS || []).push((add, A) => {
    db.cnotes.forEach(n => {
      if (!invOk(n)) return;
      const who = (custById(n.customerId) || {}).name || '', open = () => viewCN(n.id), T = cnTotal(n), C = restockCost(n), k = 'cn:' + n.id + ':';
      add(k + 'ret', n.date, ACC_RET, T, 'Credit note · ' + who, n.number, open);
      add(k + 'ar', n.date, A(1200), -T, 'Credit note · ' + who, n.number, open);
      add(k + 'inv', n.date, A(1300), C, 'Returned to stock · ' + n.number, n.number, open);
      add(k + 'cogs', n.date, A(5000), -C, 'Returned to stock · ' + n.number, n.number, open);
      (n.refunds || []).forEach((x, i) => {
        add(k + 'r' + i + ':ar', x.date, A(1200), num(x.amount), 'Refund to ' + who, n.number, open);
        add(k + 'r' + i + ':b', x.date, moneyAcc(x.acc, x.method), -num(x.amount), `Refund to ${who} (${x.method || ''})`, n.number, open);
      });
    });
    db.dnotes.forEach(n => {
      if (!purById(n.purchaseId)) return;
      const who = (supById(n.supplierId) || {}).name || '', open = () => viewDN(n.id), T = dnTotal(n), V = dnStockVal(n), k = 'dn:' + n.id + ':';
      add(k + 'ap', n.date, A(2000), T, 'Debit note · ' + who, n.number, open);
      add(k + 'inv', n.date, A(1300), -V, 'Returned to supplier · ' + n.number, n.number, open);
      const pp = purById(n.purchaseId) || {};
      add(k + 'job', n.date, (pp.assetAcc && (db.accounts || []).some(a => a.id === pp.assetAcc)) ? pp.assetAcc : A(5010), -r2(T - V), 'Debit note · ' + who, n.number, open);
      (n.refunds || []).forEach((x, i) => {
        add(k + 'r' + i + ':b', x.date, moneyAcc(x.acc, x.method), num(x.amount), `Refund from ${who} (${x.method || ''})`, n.number, open);
        add(k + 'r' + i + ':ap', x.date, A(2000), -num(x.amount), 'Refund from ' + who, n.number, open);
      });
    });
  });

  /* ---------- reports (P&L, cash) ---------- */
  (window.FITX_ACCT_HOOKS = window.FITX_ACCT_HOOKS || []).push((a, f, t) => {
    const inR = d => d >= f && d <= t;
    a.returns = a.returns || 0; a.purReturns = a.purReturns || 0;
    db.cnotes.forEach(n => {
      if (!invOk(n)) return;
      if (inR(n.date)) {
        const d = docById(n.invoiceId);
        let svc = 0, parts = 0;
        (n.lines || []).forEach(l => { const il = d && l.li !== undefined && l.li !== '' ? (d.lines || [])[l.li] : null; const v = num(l.qty) * num(l.price); if ((il && lineKind(il) === 'part') || (!il && isStock(l.itemId))) parts += v; else svc += v; });
        a.servRev -= svc; a.partsRev -= parts; a.revenue -= svc + parts; a.returns += svc + parts;
        a.cogsStock -= restockCost(n);
      }
      (n.refunds || []).forEach(x => { if (inR(x.date)) { a.collected -= num(x.amount); a.inByMethod[x.method || 'Other'] = (a.inByMethod[x.method || 'Other'] || 0) - num(x.amount); } });
    });
    db.dnotes.forEach(n => {
      if (!purById(n.purchaseId)) return;
      if (inR(n.date)) { const T = dnTotal(n), V = dnStockVal(n); a.purTot -= T; a.purStock -= V; if ((purById(n.purchaseId) || {}).assetAcc) a.capex = (a.capex || 0) - (T - V); else a.directCost -= (T - V); a.purReturns += T; }
      (n.refunds || []).forEach(x => { if (inR(x.date)) { a.supPaid -= num(x.amount); a.outByMethod[x.method || 'Other'] = (a.outByMethod[x.method || 'Other'] || 0) - num(x.amount); } });
    });
  });

  /* ---------- customer / supplier statements ---------- */
  (window.FITX_LEDGER_EV = window.FITX_LEDGER_EV || []).push((kind, id, ev) => {
    if (kind === 'cust') db.cnotes.filter(n => n.customerId === id && invOk(n)).forEach(n => {
      const d = docById(n.invoiceId) || {};
      ev.push({date: n.date, sort: n.date + '2' + n.created, ref: n.number, desc: 'Credit note · against ' + (d.number || '') + (n.reason ? ' · ' + n.reason : ''), dr: 0, cr: cnTotal(n)});
      (n.refunds || []).forEach((x, i) => ev.push({date: x.date, sort: x.date + '3' + n.created + i, ref: n.number, desc: 'Refund paid · ' + (x.method || ''), dr: num(x.amount), cr: 0}));
    });
    if (kind === 'sup') db.dnotes.filter(n => n.supplierId === id && purById(n.purchaseId)).forEach(n => {
      const p = purById(n.purchaseId) || {};
      ev.push({date: n.date, sort: n.date + '2' + n.created, ref: n.number, desc: 'Debit note · against ' + (p.number || '') + (n.reason ? ' · ' + n.reason : ''), dr: 0, cr: dnTotal(n)});
      (n.refunds || []).forEach((x, i) => ev.push({date: x.date, sort: x.date + '3' + n.created + i, ref: n.number, desc: 'Refund received · ' + (x.method || ''), dr: num(x.amount), cr: 0}));
    });
  });

  /* ---------- printed note (FitX Pro style) ---------- */
  function noteHTML(kind, n) {
    const s = S(), cn = kind === 'cn';
    const party = cn ? (custById(n.customerId) || {}) : (supById(n.supplierId) || {});
    const par = cn ? docById(n.invoiceId) : purById(n.purchaseId);
    const T = cn ? cnTotal(n) : dnTotal(n), R = refunded(n);
    const brand = `<div class="pbrand">${s.logo ? `<img class="logoimg" src="${s.logo}" alt="${esc(s.name)}">` : '<div class="plogo">Fit<span>X</span></div>'}<div class="pname">${esc(s.name)}</div></div>`;
    const coLines = `${esc(s.address)}<br>Tel: ${esc(s.phone)} · ${esc(s.email)}<br>${esc(s.web)}${s.cr ? '<br>CR No. ' + esc(s.cr) : ''}`;
    const who = `<b>${esc(party.name || '')}</b>${party.contact ? '<br>Attn: ' + esc(party.contact) : ''}${party.phone ? '<br>Tel: ' + esc(party.phone) : ''}${party.email ? '<br>' + esc(party.email) : ''}`;
    const rows = (n.lines || []).map((l, i) => {
      const sub = cn ? (l.restock && isStock(l.itemId) ? 'Back to stock' : (l.li === '' || l.li === undefined ? 'Credit / adjustment' : '')) : (isStock(l.itemId) ? 'Returned to supplier' : (l.li === '' || l.li === undefined ? 'Price correction / adjustment' : ''));
      const rate = cn ? l.price : l.cost;
      return `<tr><td>${i + 1}</td><td><b>${esc(l.desc)}</b>${sub ? `<div class="xd">${sub}</div>` : ''}</td><td class="n">${fq(l.qty)}</td><td class="n">${fmt(rate)}</td><td class="n">${fmt(num(l.qty) * num(rate))}</td></tr>`;
    }).join('');
    const parBal = par ? (cn ? docBal(par) : purBal(par)) : 0;
    const stamp = s.stampOn === false ? '' : `<div class="pstamp"><div class="pstin"><img src="${s.stampImg || window.FITX_STAMP_DATA || 'icons/stamp.png'}" alt="Company stamp"><div class="pstl">For ${esc(s.name)}<br><span>Authorised signature &amp; stamp</span></div></div></div>`;
    const tr = (k, v, b) => `<tr><td style="padding:5px 0;border-bottom:1px solid #ebebef">${b ? '<b>' + k + '</b>' : k}</td><td style="padding:5px 0;border-bottom:1px solid #ebebef;text-align:right">${b ? '<b>' + v + '</b>' : v}</td></tr>`;
    return `<div class="paper lay-pro stmt"><div class="xband"></div>
    <div class="xh"><div>${brand}<div class="xco">${coLines}</div></div>
      <div class="xtt"><h2>${cn ? 'CREDIT NOTE' : 'DEBIT NOTE'}</h2><div class="ar" dir="rtl" lang="ar">${cn ? 'إشعار دائن · مرتجع مبيعات' : 'إشعار مدين · مرتجع مشتريات'}</div><div class="xnum">${esc(n.number)}</div><div class="xdue"><small>${cn ? 'CREDIT AMOUNT' : 'DEBIT AMOUNT'}</small><b>QAR ${fmt(T)}</b></div><div></div></div></div>
    <div class="xmeta two"><div><span class="xl">${cn ? 'Customer <span dir="rtl" lang="ar">· العميل</span>' : 'Supplier <span dir="rtl" lang="ar">· المورد</span>'}</span>${who}</div>
      <div class="xdg"><span>Date</span><span>${dfmt(n.date)}</span><span>${cn ? 'Against invoice' : 'Against bill'}</span><span><b>${esc(par ? par.number : '—')}</b>${par ? ' · ' + dfmt(par.date) : ''}${!cn && par && par.ref ? '<br>Supplier ref ' + esc(par.ref) : ''}</span>${n.reason ? `<span>Reason</span><span>${esc(n.reason)}</span>` : ''}</div></div>
    <table class="xitems"><thead><tr><th style="width:30px">#</th><th>${cn ? 'Returned item / credit' : 'Returned item / debit'}</th><th class="n" style="width:56px">Qty</th><th class="n" style="width:84px">Rate</th><th class="n" style="width:92px">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:18px;margin-top:14px;font-size:11.5px">
      <div class="xterms">${n.note ? `<b>Note</b><div style="white-space:pre-wrap">${esc(n.note)}</div>` : ''}<div style="margin-top:6px">${cn ? `This credit is deducted from invoice ${esc(par ? par.number : '')}.` : `This amount is deducted from bill ${esc(par ? par.number : '')}.`}</div></div>
      <table style="width:100%;border-collapse:collapse">${tr(cn ? 'Credit total' : 'Debit total', fmt(T))}${tr(cn ? 'Refunded to customer' : 'Refund received', fmt(R))}${par ? tr((cn ? 'Invoice ' : 'Bill ') + esc(par.number) + ' balance now', fmt(parBal), true) : ''}</table></div>
    <div class="xsig"><div class="xterms"></div>${stamp}</div>
    <div class="xfoot"><span>${esc(s.name)} · ${esc(s.phone)} · ${esc(s.web)}</span><span>${cn ? 'Credit note' : 'Debit note'} ${esc(n.number)}</span></div></div>`;
  }
  const fname = (kind, n) => n.number + ' - ' + ((kind === 'cn' ? custById(n.customerId) : supById(n.supplierId)) || {}).name;
  const shareRow = p => `<div class="btns sharebar" style="margin-bottom:12px">
    <button type="button" class="btn pri" id="${p}Share">${ICON.share}Share PDF</button><button type="button" class="btn" id="${p}Wa">${ICON.wa}WhatsApp</button>
    <button type="button" class="btn" id="${p}Mail">${ICON.mail}Email</button><button type="button" class="btn" id="${p}Print">${ICON.print}Print</button>
    <button type="button" class="btn" id="${p}Pv">${ICON.search || ''}PDF preview</button></div>`;

  /* ---------- pick the invoice / bill ---------- */
  function picker(kind) {
    const cn = kind === 'cn';
    const all = cn ? activeInvoices().slice() : db.purchases.slice();
    all.sort((a, b) => String(b.date + b.number).localeCompare(String(a.date + a.number)));
    openSheet(cn ? 'Sales return · choose invoice' : 'Purchase return · choose bill', `
      <p class="hint" style="margin-top:0">${cn ? 'A credit note is made against one invoice. Pick the invoice the customer is returning items from (or getting money back on).' : 'A debit note is made against one bill. Pick the bill you are returning parts from (or getting a price correction on).'}</p>
      <input class="search" id="rpq" placeholder="Search number or ${cn ? 'customer' : 'supplier'}" aria-label="Search">
      <div class="list" id="rpList"></div>`, el => {
      const draw = () => {
        const q = el.querySelector('#rpq').value.trim().toLowerCase();
        const nm = d => ((cn ? custById(d.customerId) : supById(d.supplierId)) || {}).name || '';
        const list = all.filter(d => !q || (d.number + ' ' + nm(d) + ' ' + (d.ref || '')).toLowerCase().includes(q)).slice(0, 80);
        el.querySelector('#rpList').innerHTML = list.length ? list.map(d => `<button type="button" class="item" data-id="${d.id}"><div class="main"><div class="t">${esc(d.number)} · ${esc(nm(d))}</div><div class="s">${dfmt(d.date)} · total ${fmt(cn ? docTotal(d) : purNet(d))} · balance ${fmt(cn ? docBal(d) : purBal(d))}</div></div></button>`).join('') : `<div class="empty">${cn ? 'No invoices found.' : 'No bills found.'}</div>`;
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => closeSheet(() => cn ? editCN(null, b.dataset.id) : editDN(null, b.dataset.id)));
      };
      el.querySelector('#rpq').oninput = draw; draw();
    });
  }

  /* ---------- editor (shared by CN and DN) ---------- */
  const REASONS_CN = ['Goods returned', 'Wrong part supplied', 'Damaged / faulty part', 'Service not done / cancelled', 'Price correction / overcharge', 'Discount given after invoice', 'Other'];
  const REASONS_DN = ['Parts returned to supplier', 'Wrong part received', 'Damaged / faulty part', 'Price correction / overcharged', 'Short supply', 'Other'];
  function editNote(kind, id, parentId) {
    const cn = kind === 'cn';
    const ex = id ? (cn ? cnById(id) : dnById(id)) : null;
    const par = cn ? docById(ex ? ex.invoiceId : parentId) : purById(ex ? ex.purchaseId : parentId);
    if (!par) { toast(cn ? 'Invoice not found' : 'Bill not found'); return; }
    if (cn && par.cancelled) { toast('This invoice is cancelled'); return; }
    const rateKey = cn ? 'price' : 'cost';
    const k = cn ? discFactor(par) : (purTotal(par) && (par.lines || []).reduce((s, l) => s + num(l.qty) * num(l.cost), 0) > 0 ? purTotal(par) / (par.lines || []).reduce((s, l) => s + num(l.qty) * num(l.cost), 0) : 1);
    const list = cn ? db.cnotes : db.dnotes, key = cn ? 'invoiceId' : 'purchaseId';
    // one row per original line (machines excluded) + any extra lines
    const rows = (par.lines || []).map((l, li) => ({l, li})).filter(x => x.l.kind !== 'equip' && num(x.l.qty) > 0).map(({l, li}) => {
      const old = ex ? (ex.lines || []).find(x => String(x.li) === String(li)) : null;
      const max = r2(num(l.qty) - returnedQty(list, key, par.id, li, ex && ex.id));
      const stock = isStock(l.itemId) && (!cn || lineKind(l) === 'part');
      return {li, itemId: l.itemId || '', desc: l.desc || (itemById(l.itemId) || {}).name || '', max, on: !!old, qty: old ? num(old.qty) : max, rate: old ? num(old[rateKey]) : r2(num(cn ? l.price : l.cost) * k), stock, restock: old ? !!old.restock : stock};
    });
    const extra = ex ? (ex.lines || []).filter(x => x.li === '' || x.li === undefined).map(x => ({desc: x.desc, amt: r2(num(x.qty) * num(x[rateKey]))})) : [];
    const R = cn ? REASONS_CN : REASONS_DN;
    const parTot = cn ? docTotal(par) : purNet(par);
    const others = r2((cn ? cnsOf(par.id) : dnsOf(par.id)).filter(n => !ex || n.id !== ex.id).reduce((s, n) => s + (cn ? cnTotal(n) : dnTotal(n)), 0));
    const balExcl = r2((cn ? docBal(par) : purBal(par)) + (ex ? (cn ? cnTotal(ex) : dnTotal(ex)) - refunded(ex) : 0));
    const who = ((cn ? custById(par.customerId) : supById(par.supplierId)) || {}).name || '';
    openSheet(ex ? 'Edit ' + ex.number : (cn ? 'Sales return / Credit note' : 'Purchase return / Debit note'), `<form id="rnForm" autocomplete="off">
      <div class="card" style="margin-bottom:12px"><b>${esc(par.number)}</b> · ${esc(who)}<div class="hint">${dfmt(par.date)} · total ${money(parTot)} · balance ${money(balExcl)}${others ? ` · earlier ${cn ? 'credit' : 'debit'} notes ${money(others)}` : ''}</div></div>
      <div class="row"><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${esc(ex ? ex.date : today())}" required></label>
      <label class="f"><span>Reason</span><select class="in" name="reason">${R.map(r => `<option ${ex && ex.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div>
      <div class="sec"><h2>${cn ? 'Items returned / credited' : 'Items returned to supplier'}</h2><span class="hint">tick the lines</span></div>
      <div class="list" id="rnRows">${rows.map((r, i) => `<div class="item" style="display:block;padding:10px 12px">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="rOn" data-i="${i}" ${r.on ? 'checked' : ''} ${r.max <= 0 && !r.on ? 'disabled' : ''} style="width:20px;height:20px;margin-top:2px;accent-color:var(--orange)">
          <span style="flex:1;min-width:0"><b>${esc(r.desc)}</b><span class="hint" style="display:block">${r.max <= 0 && !r.on ? 'Already fully returned' : 'Up to ' + fq(r.max) + (cn ? ' · sold at ' : ' · bought at ') + fmt(r.rate)}</span></span></label>
        <div class="row rDet" data-i="${i}" style="margin:8px 0 0 30px;${r.on ? '' : 'display:none'}">
          <label class="f" style="margin:0"><span>Qty</span><input class="in rQty" data-i="${i}" type="number" step="any" min="0" max="${r.max}" inputmode="decimal" value="${fq(r.qty)}"></label>
          <label class="f" style="margin:0"><span>Rate (QAR)</span><input class="in rRate" data-i="${i}" type="number" step="0.01" min="0" inputmode="decimal" value="${r.rate}"></label></div>
        ${cn && r.stock ? `<label class="rDet hint" data-i="${i}" style="display:${r.on ? 'flex' : 'none'};gap:8px;align-items:center;margin:8px 0 0 30px"><input type="checkbox" class="rStk" data-i="${i}" ${r.restock ? 'checked' : ''} style="accent-color:var(--orange)"> Put back into stock</label>` : ''}
        ${!cn && r.stock ? `<div class="rDet hint" data-i="${i}" style="display:${r.on ? 'block' : 'none'};margin:6px 0 0 30px">Leaves your stock</div>` : ''}
      </div>`).join('') || '<div class="empty">No lines on this ' + (cn ? 'invoice' : 'bill') + '.</div>'}</div>
      <div class="sec"><h2>Other ${cn ? 'credit' : 'debit'}</h2><span class="hint">e.g. ${cn ? 'labour reversed, goodwill discount' : 'price correction'}</span></div>
      <div id="rnExtra"></div><button type="button" class="btn full" id="rnAddX">+ Add amount</button>
      <label class="f" style="margin-top:12px"><span>Note (printed)</span><textarea class="in" name="note" placeholder="Optional">${esc(ex ? ex.note || '' : '')}</textarea></label>
      <div class="tot" id="rnTot"></div>
      <div id="rnRefBox"></div>
      <button class="btn pri full" type="submit">Save ${cn ? 'credit note' : 'debit note'}</button></form>`, el => {
      const xBox = el.querySelector('#rnExtra');
      const drawX = () => {
        xBox.innerHTML = extra.map((x, i) => `<div class="row" style="align-items:end"><label class="f"><span>Description</span><input class="in xD" data-i="${i}" value="${esc(x.desc)}" placeholder="${cn ? 'e.g. Labour charge reversed' : 'e.g. Overcharged on invoice'}"></label><label class="f" style="max-width:150px"><span>Amount</span><input class="in xA" data-i="${i}" type="number" step="0.01" min="0" inputmode="decimal" value="${x.amt || ''}"></label><button type="button" class="btn xDel" data-i="${i}" style="margin-bottom:12px;flex:0 0 auto" aria-label="Remove">✕</button></div>`).join('');
        xBox.querySelectorAll('.xD').forEach(e => e.oninput = () => { extra[+e.dataset.i].desc = e.value; });
        xBox.querySelectorAll('.xA').forEach(e => e.oninput = () => { extra[+e.dataset.i].amt = num(e.value); tot(); });
        xBox.querySelectorAll('.xDel').forEach(e => e.onclick = () => { extra.splice(+e.dataset.i, 1); drawX(); tot(); });
      };
      const total = () => r2(rows.reduce((s, r) => s + (r.on ? num(r.qty) * num(r.rate) : 0), 0) + extra.reduce((s, x) => s + num(x.amt), 0));
      const refBox = el.querySelector('#rnRefBox');
      let refundState = {on: false, amount: ''};
      const tot = () => {
        const T = total(), after = r2(balExcl - T);
        el.querySelector('#rnTot').innerHTML = `<div class="g"><span>${cn ? 'Credit note total' : 'Debit note total'}</span><span>${money(T)}</span></div><div class="hint" style="text-align:right;margin-top:4px">${esc(par.number)} balance ${money(balExcl)} → <b style="color:var(--text)">${money(after)}</b></div>`;
        const need = r2(-after);
        if (!ex && need > 0.004) {
          if (!refBox.dataset.drawn) {
            refBox.dataset.drawn = '1';
            refBox.innerHTML = `<div class="card" style="margin:10px 0"><b>${cn ? 'Customer has already paid' : 'You have already paid this bill'}</b><div class="hint" id="rnNeed"></div>
              <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="rnRefOn" style="width:20px;height:20px;accent-color:var(--orange)"> ${cn ? 'Refund the money now' : 'Supplier refunded the money now'}</label>
              <div id="rnRefF" style="display:none"><div class="row"><label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" id="rnRefAmt"></label><label class="f"><span>Method</span><select class="in" id="rnRefM">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label></div>
              <label class="f"><span>${cn ? 'Paid from' : 'Received into'}</span><select class="in" id="rnRefAcc">${accOpts()}</select></label></div>
              <p class="hint" style="margin:6px 0 0">If you don't refund now, the ${cn ? 'customer keeps a credit' : 'supplier owes you'} – you can record the refund later from the ${cn ? 'credit' : 'debit'} note.</p></div>`;
            refBox.querySelector('#rnRefOn').onchange = e => { refundState.on = e.target.checked; refBox.querySelector('#rnRefF').style.display = e.target.checked ? '' : 'none'; };
            refBox.querySelector('#rnRefAmt').oninput = e => { refundState.amount = e.target.value; refundState.touched = true; };
          }
          refBox.querySelector('#rnNeed').textContent = `${cn ? 'Refund due to customer' : 'Supplier owes you'}: ${money(need)}`;
          if (!refundState.touched) refBox.querySelector('#rnRefAmt').value = need;
        } else { refBox.innerHTML = ''; delete refBox.dataset.drawn; refundState = {on: false, amount: ''}; }
      };
      el.querySelectorAll('.rOn').forEach(c => c.onchange = () => { const i = +c.dataset.i; rows[i].on = c.checked; el.querySelectorAll(`.rDet[data-i="${i}"]`).forEach(d => { d.style.display = c.checked ? (d.classList.contains('row') ? '' : d.tagName === 'LABEL' ? 'flex' : 'block') : 'none'; }); tot(); });
      el.querySelectorAll('.rQty').forEach(c => c.oninput = () => { rows[+c.dataset.i].qty = num(c.value); tot(); });
      el.querySelectorAll('.rRate').forEach(c => c.oninput = () => { rows[+c.dataset.i].rate = num(c.value); tot(); });
      el.querySelectorAll('.rStk').forEach(c => c.onchange = () => { rows[+c.dataset.i].restock = c.checked; });
      el.querySelector('#rnAddX').onclick = () => { extra.push({desc: '', amt: 0}); drawX(); const all = xBox.querySelectorAll('.xD'); if (all.length) all[all.length - 1].focus(); };
      drawX(); tot();
      el.querySelector('#rnForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        for (const r of rows) if (r.on && (num(r.qty) <= 0 || num(r.qty) > r.max + 0.0001)) { toast(`Qty for “${r.desc}” must be between 0 and ${fq(r.max)}`); return; }
        const lines = rows.filter(r => r.on && num(r.qty) > 0).map(r => cn ? {li: r.li, itemId: r.itemId, desc: r.desc, qty: num(r.qty), price: r2(r.rate), restock: !!(r.stock && r.restock)} : {li: r.li, itemId: r.itemId, desc: r.desc, qty: num(r.qty), cost: r2(r.rate)})
          .concat(extra.filter(x => num(x.amt) > 0).map(x => cn ? {li: '', itemId: '', desc: x.desc.trim() || 'Credit', qty: 1, price: r2(x.amt), restock: false} : {li: '', itemId: '', desc: x.desc.trim() || 'Adjustment', qty: 1, cost: r2(x.amt)}));
        const T = r2(lines.reduce((s, l) => s + num(l.qty) * num(l[rateKey]), 0));
        if (T <= 0) { toast('Tick at least one line or add an amount'); return; }
        if (T > r2(parTot - others) + 0.004) { toast(`Total can't be more than ${money(r2(parTot - others))} (what is left on ${par.number})`); return; }
        const base = {date: f.date, reason: f.reason, note: (f.note || '').trim(), lines};
        let rec;
        if (ex) { Object.assign(ex, base, {updated: Date.now()}); rec = ex; }
        else {
          rec = Object.assign({id: uid(), number: cn ? nextNo('nextCN', S().cnPrefix || 'CN') : nextNo('nextDN', S().dnPrefix || 'DN'), created: String(Date.now()), refunds: []}, base,
            cn ? {customerId: par.customerId, invoiceId: par.id} : {supplierId: par.supplierId, purchaseId: par.id});
          list.push(rec);
          if (refundState.on) { const ai = el.querySelector('#rnRefAmt'); const amt = r2(num(ai ? ai.value : refundState.amount)); const sel = el.querySelector('#rnRefM'); if (amt > 0) rec.refunds.push({amount: amt, date: f.date, method: sel ? sel.value : 'Cash', acc: (el.querySelector('#rnRefAcc') || {}).value || '', note: ''}); }
        }
        save(); closeSheet(() => { toast(`${rec.number} saved`); cn ? viewCN(rec.id) : viewDN(rec.id); });
      };
    });
  }
  const editCN = (id, invId) => editNote('cn', id, invId);
  const editDN = (id, purId) => editNote('dn', id, purId);

  /* ---------- view ---------- */
  function viewNote(kind, id) {
    const cn = kind === 'cn', n = cn ? cnById(id) : dnById(id); if (!n) return;
    const par = cn ? docById(n.invoiceId) : purById(n.purchaseId);
    const party = (cn ? custById(n.customerId) : supById(n.supplierId)) || {};
    const parBal = par ? (cn ? docBal(par) : purBal(par)) : 0;
    const due = r2(-parBal);
    const refunds = (n.refunds || []).length ? `<div class="sec"><h2>${cn ? 'Refunds paid' : 'Refunds received'}</h2></div><div class="list">${n.refunds.map((x, i) => `<div class="item"><div class="main"><div class="t">${money(x.amount)}</div><div class="s">${dfmt(x.date)} · ${esc(x.method || '')}</div></div><button type="button" class="btn danger" data-delr="${i}" aria-label="Delete refund">${ICON.trash}</button></div>`).join('')}</div>` : '';
    openSheet(n.number, `${shareRow('rn')}
      <div class="btns" style="margin-bottom:12px">
        ${due > 0.004 ? `<button type="button" class="btn pri" id="rnRef">${ICON.pay}${cn ? 'Refund customer' : 'Record supplier refund'} (${fmt(due)})</button>` : ''}
        ${par ? `<button type="button" class="btn" id="rnPar">${ICON.inv}Open ${esc(par.number)}</button>` : ''}
        <button type="button" class="btn" id="rnEdit">${ICON.edit}Edit</button>
        <button type="button" class="btn danger" id="rnDel">${ICON.trash}Delete</button></div>
      ${refunds}
      <div class="sec"><h2>Preview</h2></div><div id="rnPrev">${noteHTML(kind, n)}</div>`, el => {
      const reopen = () => reopenWith(() => viewNote(kind, id));
      const opts = () => ({html: noteHTML(kind, n), name: fname(kind, n), phone: party.phone, email: party.email, subject: (cn ? 'Credit note ' : 'Debit note ') + n.number, body: '', wa: `Dear ${party.contact || party.name || ''},\n\n${cn ? 'Credit note' : 'Debit note'} *${n.number}* for ${money(cn ? cnTotal(n) : dnTotal(n))}${par ? ' against ' + par.number : ''}.\n\nThank you,\n${S().name}`});
      bindShare(el, 'rn', opts, () => printHTML(noteHTML(kind, n), fname(kind, n)));
      el.querySelector('#rnPv').onclick = () => FitxMail.pdfPreview(noteHTML(kind, n), fname(kind, n));
      const pb = el.querySelector('#rnPar'); if (pb) pb.onclick = () => closeSheet(() => cn ? viewDoc(par.id) : viewPurchase(par.id));
      el.querySelector('#rnEdit').onclick = () => closeSheet(() => editNote(kind, id));
      el.querySelector('#rnDel').onclick = () => {
        if (!confirm(`Delete ${n.number}? The ${cn ? 'invoice' : 'bill'} balance and stock go back to how they were.`)) return;
        if (cn) db.cnotes = db.cnotes.filter(x => x.id !== id); else db.dnotes = db.dnotes.filter(x => x.id !== id);
        save(); closeSheet(render); toast('Deleted');
      };
      el.querySelectorAll('[data-delr]').forEach(b => b.onclick = () => { if (!confirm('Delete this refund?')) return; n.refunds.splice(+b.dataset.delr, 1); save(); reopen(); });
      const rf = el.querySelector('#rnRef'); if (rf) rf.onclick = () => openSheet(cn ? 'Refund customer · ' + n.number : 'Supplier refund · ' + n.number, `<form id="rfForm">
        <p class="hint">${cn ? 'Money paid back to' : 'Money received back from'} <b style="color:var(--text)">${esc(party.name || '')}</b>.</p>
        <div class="row"><label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0.01" inputmode="decimal" name="amount" value="${due}" required></label><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${today()}" required></label></div>
        <div class="row"><label class="f"><span>Method</span><select class="in" name="method">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label><label class="f"><span>${cn ? 'Paid from' : 'Received into'}</span><select class="in" name="acc">${accOpts()}</select></label></div>
        <label class="f"><span>Reference / note</span><input class="in" name="note" placeholder="Optional"></label>
        <button class="btn pri full" type="submit">Save refund</button></form>`, e2 => {
        e2.querySelector('#rfForm').onsubmit = ev => {
          ev.preventDefault(); const f = formData(ev.target); const amt = r2(f.amount);
          if (amt > due + 0.004) { toast('More than the refund due (' + money(due) + ')'); return; }
          n.refunds = n.refunds || []; n.refunds.push({amount: amt, date: f.date, method: f.method, acc: f.acc || '', note: (f.note || '').trim()});
          save(); closeSheet(() => { reopen(); toast('Refund saved'); });
        };
      });
    });
  }
  const viewCN = id => viewNote('cn', id);
  const viewDN = id => viewNote('dn', id);

  /* ---------- lists ---------- */
  function listNotes(kind) {
    const cn = kind === 'cn';
    openSheet(cn ? 'Credit notes · sales returns' : 'Debit notes · purchase returns', `
      <button type="button" class="btn pri full" id="rlNew" style="margin-bottom:12px">+ New ${cn ? 'sales return / credit note' : 'purchase return / debit note'}</button>
      <input class="search" id="rlq" placeholder="Search number, ${cn ? 'customer' : 'supplier'} or ${cn ? 'invoice' : 'bill'}" aria-label="Search">
      <div class="list" id="rlList"></div><p class="hint" id="rlSum" style="margin:10px 4px"></p>`, el => {
      const draw = () => {
        const q = el.querySelector('#rlq').value.trim().toLowerCase();
        const all = (cn ? db.cnotes : db.dnotes).slice().sort((a, b) => String(b.date + b.number).localeCompare(String(a.date + a.number)));
        const nm = n => ((cn ? custById(n.customerId) : supById(n.supplierId)) || {}).name || '';
        const pn = n => ((cn ? docById(n.invoiceId) : purById(n.purchaseId)) || {}).number || '';
        const list = all.filter(n => !q || (n.number + ' ' + nm(n) + ' ' + pn(n) + ' ' + (n.reason || '')).toLowerCase().includes(q));
        el.querySelector('#rlList').innerHTML = list.length ? list.map(n => `<button type="button" class="item" data-id="${n.id}"><div class="main"><div class="t">${esc(n.number)} · ${esc(nm(n))}</div><div class="s">${dfmt(n.date)} · against ${esc(pn(n))}${n.reason ? ' · ' + esc(n.reason) : ''}</div></div><div class="amt">${fmt(cn ? cnTotal(n) : dnTotal(n))}</div></button>`).join('')
          : `<div class="empty">${all.length ? 'Nothing matches.' : (cn ? 'No credit notes yet. When a customer returns parts or you reduce an invoice, make a credit note.' : 'No debit notes yet. When you return parts to a supplier or get a price correction, make a debit note.')}</div>`;
        el.querySelector('#rlSum').textContent = list.length ? `${list.length} note${list.length === 1 ? '' : 's'} · total ${money(list.reduce((s, n) => s + (cn ? cnTotal(n) : dnTotal(n)), 0))}` : '';
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => cn ? viewCN(b.dataset.id) : viewDN(b.dataset.id));
      };
      el.querySelector('#rlq').oninput = draw; draw();
      el.querySelector('#rlNew').onclick = () => picker(kind);
    });
  }

  /* ---------- buttons on the invoice and bill screens ---------- */
  const noteList = (kind, notes) => notes.length ? `<div class="sec"><h2>${kind === 'cn' ? 'Credit notes · returns' : 'Debit notes · returns'}</h2></div><div class="list" style="margin-bottom:12px">${notes.map(n => `<button type="button" class="item" data-rn="${n.id}"><div class="main"><div class="t">${esc(n.number)}</div><div class="s">${dfmt(n.date)}${n.reason ? ' · ' + esc(n.reason) : ''}${refunded(n) ? ' · refunded ' + fmt(refunded(n)) : ''}</div></div><div class="amt">− ${fmt(kind === 'cn' ? cnTotal(n) : dnTotal(n))}</div></button>`).join('')}</div>` : '';
  const top = () => { const all = document.querySelectorAll('.sheet'); return all[all.length - 1]; };
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView.apply(this, arguments);
    const d = docById(id), el = top();
    if (!d || d.type !== 'INV' || !el) return;
    const btns = el.querySelector('.sb .btns:not(.sharebar)');
    if (btns && !d.cancelled && !el.querySelector('#aCN')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'aCN'; b.innerHTML = `${ICON.conv || ''}Sales return / Credit note`;
      const ref = btns.querySelector('#aEdit'); btns.insertBefore(b, ref || null);
      b.onclick = () => closeSheet(() => editCN(null, d.id));
    }
    const ns = cnsOf(d.id);
    if (ns.length && btns) { btns.insertAdjacentHTML('afterend', noteList('cn', ns)); el.querySelectorAll('[data-rn]').forEach(x => x.onclick = () => viewCN(x.dataset.rn)); }
  };
  const origPur = window.viewPurchase;
  if (origPur) window.viewPurchase = function (id) {
    origPur.apply(this, arguments);
    const p = purById(id), el = top();
    if (!p || !el) return;
    const btns = el.querySelector('.sb .btns');
    if (btns && !el.querySelector('#ppDN')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'ppDN'; b.innerHTML = `${ICON.conv || ''}Purchase return / Debit note`;
      btns.insertBefore(b, btns.querySelector('#ppEdit') || null);
      b.onclick = () => closeSheet(() => editDN(null, p.id));
    }
    const ns = dnsOf(p.id);
    if (ns.length && btns) { btns.insertAdjacentHTML('afterend', noteList('dn', ns)); el.querySelectorAll('[data-rn]').forEach(x => x.onclick = () => viewDN(x.dataset.rn)); }
  };

  /* ---------- More page rows ---------- */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const row = (id, ic, t, s) => `<button type="button" class="item rcard" id="${id}"><span class="ic">${ic}</span><div class="main"><div class="t">${t}</div><div class="s">${s}</div></div></button>`;
    const a = document.getElementById('mRcv'), b = document.getElementById('mPayOut');
    if (a && !document.getElementById('mCN')) { a.insertAdjacentHTML('afterend', row('mCN', ICON.inv, 'Credit notes · sales returns', 'Customer returns, refunds and invoice reductions')); document.getElementById('mCN').onclick = () => listNotes('cn'); }
    if (b && !document.getElementById('mDN')) { b.insertAdjacentHTML('afterend', row('mDN', ICON.box, 'Debit notes · purchase returns', 'Parts returned to suppliers, price corrections')); document.getElementById('mDN').onclick = () => listNotes('dn'); }
  };

  window.FitxRet = {invCredit, invRefund, billDebit, billRefund, editCN, editDN, viewCN, viewDN, listCN: () => listNotes('cn'), listDN: () => listNotes('dn'), pickInvoice: () => picker('cn'), pickBill: () => picker('dn'), noteHTML, cnTotal, dnTotal};
})();
