/* FitX Accounts — "Import entries": daily data entry prepared outside the app (e.g. by Claude) as a JSON batch.
   Menu → Import entries: open the .json file or paste the text → review list (untick anything) → Post.
   Every record created is tagged imp:<batchId> so the whole batch can be undone.
   Menu → "Data for Claude" shares a small summary (customers, open invoices, suppliers, products, accounts) for matching.

   Batch format (all sections optional):
   {"fitx":"import","v":1,"batch":"2026-11-14 daily","note":"…",
    "customers":[{"name","phone","email","contact","address","invType":"cash|credit","creditDays"}],
    "suppliers":[{"name","phone","email","contact","wht"}],
    "items":[{"name","sku","category","unit","price","cost","service":true|false,"descr"}],
    "expenses":[{"date","amount","category","desc","method","account"}],
    "bills":[{"supplier","date","due","ref","lines":[{"item","desc","qty","cost"}],"discount","whtRate","notes","paid":{"amount","date","method","account","note"}}],
    "billPayments":[{"bill":"PUR-…"|"ref":"supplier invoice no","supplier","amount","date","method","account","note"}],
    "invoices":[{"type":"INV|QUO","customer","date","due","payType":"cash|credit","subject","lines":[{"item","desc","qty","price","kind":"service|part"}],"discount","notes","paid":{…}}],
    "payments":[{"invoice":"INV-…","customer","amount","date","method","account","note"}],   // no invoice → oldest open invoices of that customer
    "transfers":[{"date","amount","from","to","memo"}],
    "moneyIn":[{"date","amount","account","other","memo"}], "moneyOut":[…]}
   account = code ("1100"), id or name ("Cash", "QNB current"). */
(function () {
  'use strict';
  const low = t => String(t || '').trim().toLowerCase();
  const findCust = n => n && (db.customers.find(c => low(c.name) === low(n)) || db.customers.find(c => c.phone && String(c.phone).replace(/\D/g, '') === String(n).replace(/\D/g, '')));
  const findSup = n => n && (db.suppliers.find(s => low(s.name) === low(n)) || db.suppliers.find(s => s.phone && String(s.phone).replace(/\D/g, '') === String(n).replace(/\D/g, '')));
  const findItem = n => n && db.items.find(i => low(i.name) === low(n) || (i.sku && low(i.sku) === low(n)) || i.id === n);
  function findAcc(a) {
    if (!a) return '';
    const L = db.accounts || [];
    const x = L.find(c => c.id === a || String(c.code) === String(a)) || L.find(c => low(c.name) === low(a)) || L.find(c => low(c.name).includes(low(a)));
    return x ? x.id : '';
  }
  const accName = id => { const a = window.FitxLedger && FitxLedger.accById(id); return a ? a.code + ' ' + a.name : ''; };
  const D = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : today();

  /* ---------- build the review list ---------- */
  function plan(b) {
    const rows = [], newC = {}, newS = {}, newI = {};
    const add = (sec, label, sub, amt, warn, dup, apply) => rows.push({sec, label, sub, amt, warn: warn || '', on: !dup && !/not found/i.test(warn || ''), dup: !!dup, apply});
    const custRef = n => findCust(n) || newC[low(n)];
    const supRef = n => findSup(n) || newS[low(n)];
    (b.customers || []).forEach(c => {
      if (!c.name) return; const ex = findCust(c.name) || findCust(c.phone);
      if (ex) { add('Customers', c.name, 'already exists – skipped', null, '', true, () => 0); return; }
      newC[low(c.name)] = {pending: true, name: c.name};
      add('Customers', c.name, [c.phone, c.email].filter(Boolean).join(' · ') || 'new customer', null, '', false, ctx => {
        const rec = {id: uid(), name: c.name.trim(), phone: c.phone || '', email: c.email || '', contact: c.contact || '', address: c.address || '', invType: c.invType || '', creditDays: c.creditDays || '', imp: ctx.id};
        db.customers.push(rec); newC[low(c.name)] = rec;
      });
    });
    (b.suppliers || []).forEach(s => {
      if (!s.name) return; const ex = findSup(s.name);
      if (ex) { add('Suppliers', s.name, 'already exists – skipped', null, '', true, () => 0); return; }
      newS[low(s.name)] = {pending: true, name: s.name};
      add('Suppliers', s.name, [s.phone, s.email].filter(Boolean).join(' · ') || 'new supplier', null, '', false, ctx => {
        const rec = {id: uid(), name: s.name.trim(), phone: s.phone || '', email: s.email || '', contact: s.contact || '', wht: s.wht || '', imp: ctx.id};
        db.suppliers.push(rec); newS[low(s.name)] = rec;
      });
    });
    (b.items || []).forEach(i => {
      if (!i.name) return; const ex = findItem(i.name) || (i.sku && findItem(i.sku));
      if (ex) { add('Products & services', i.name, 'already exists – skipped', null, '', true, () => 0); return; }
      add('Products & services', i.name, [i.service ? 'Service' : 'Part', i.unit, i.category].filter(Boolean).join(' · '), num(i.price) || null, '', false, ctx => {
        const cat = i.category || (i.service ? 'Services' : 'Parts');
        const st = S(); if (!st.stockCats.includes(cat)) st.stockCats.push(cat);
        const rec = {id: uid(), name: i.name.trim(), sku: i.sku || '', category: cat, cost: r2(i.cost), price: r2(i.price), unit: i.unit || (i.service ? 'job' : 'pcs'), minQty: 0, service: !!i.service, descr: i.descr || '', imp: ctx.id};
        db.items.push(rec); newI[low(i.name)] = rec;
      });
    });
    const itemRef = n => findItem(n) || newI[low(n)];
    // item that exists now, or is created earlier in this same batch
    const itemSpec = n => itemRef(n) || (b.items || []).find(i => low(i.name) === low(n) || (i.sku && low(i.sku) === low(n)));
    (b.expenses || []).forEach(x => {
      const amt = r2(x.amount), date = D(x.date);
      const dup = db.expenses.some(e => e.date === date && Math.abs(num(e.amount) - amt) < 0.005 && low(e.desc) === low(x.desc));
      add('Expenses', x.desc || x.category || 'Expense', `${dfmt(date)} · ${x.category || 'Other'} · ${x.method || 'Cash'}`, amt, dup ? 'Same expense already in the app' : '', dup, ctx => {
        const st = S(); const cat = x.category || 'Other'; if (!st.expCats.includes(cat)) st.expCats.push(cat);
        db.expenses.push({id: uid(), date, amount: amt, category: cat, desc: (x.desc || '').trim(), method: x.method || 'Cash', acc: findAcc(x.account), imp: ctx.id});
      });
    });
    (b.bills || []).forEach(p => {
      const sp = supRef(p.supplier), date = D(p.date);
      const lines = (p.lines || []).map(l => { const it = itemRef(l.item || l.desc); return {it, desc: l.desc || (it && it.name) || l.item || '', qty: num(l.qty || 1), cost: r2(l.cost)}; });
      const tot = r2(lines.reduce((s, l) => s + l.qty * l.cost, 0) - num(p.discount));
      const dup = sp && !sp.pending && p.ref && db.purchases.some(x => x.supplierId === sp.id && low(x.ref) === low(p.ref));
      add('Supplier bills', `${p.supplier || '?'}${p.ref ? ' · ' + p.ref : ''}`, `${dfmt(date)} · ${lines.length} line${lines.length === 1 ? '' : 's'}${p.paid ? ' · paid ' + (p.paid.method || '') : ' · unpaid'}`, tot,
        !p.supplier ? 'Supplier missing' : dup ? 'Bill with this ref already exists' : !sp ? 'New supplier – add it in this batch or it will be created' : '', dup, ctx => {
          let s2 = supRef(p.supplier);
          if (!s2 || s2.pending) { s2 = {id: uid(), name: String(p.supplier).trim(), imp: ctx.id}; db.suppliers.push(s2); newS[low(p.supplier)] = s2; }
          const st = S();
          const rec = {id: uid(), number: `${st.purPrefix || 'PUR'}-${new Date().getFullYear()}-${String(st.nextPur || 1).padStart(4, '0')}`, supplierId: s2.id, date, due: p.due || addDays(date, 30), ref: p.ref || '',
            lines: lines.map(l => ({itemId: (itemRef(l.desc) || l.it || {}).id || '', desc: l.desc, qty: l.qty, cost: l.cost})), discount: num(p.discount), whtRate: p.whtRate || s2.wht || '', notes: p.notes || '', updateCost: true, created: String(Date.now()), payments: [], imp: ctx.id};
          st.nextPur = (st.nextPur || 1) + 1;
          rec.lines.forEach(l => { if (!l.itemId) { const it = itemRef(l.desc); if (it) l.itemId = it.id; } });
          if (typeof applyAvgCost === 'function') try { applyAvgCost(rec, null); } catch (e) {}
          if (p.paid && num(p.paid.amount)) rec.payments.push({amount: r2(p.paid.amount), date: D(p.paid.date || date), method: p.paid.method || 'Cash', acc: findAcc(p.paid.account), note: p.paid.note || '', imp: ctx.id});
          db.purchases.push(rec);
        });
    });
    (b.billPayments || []).forEach(x => {
      const sp = supRef(x.supplier);
      let bill = x.bill && db.purchases.find(p => low(p.number) === low(x.bill));
      if (!bill && x.ref) bill = db.purchases.find(p => low(p.ref) === low(x.ref) && (!sp || p.supplierId === sp.id));
      if (!bill && sp && !sp.pending) bill = db.purchases.filter(p => p.supplierId === sp.id && purBal(p) > 0.004).sort((a, c) => String(a.date).localeCompare(String(c.date)))[0];
      const amt = r2(x.amount), date = D(x.date);
      const dup = bill && (bill.payments || []).some(q => q.date === date && Math.abs(num(q.amount) - amt) < 0.005);
      add('Supplier payments', `${x.supplier || (bill && (supById(bill.supplierId) || {}).name) || '?'}${bill ? ' → ' + bill.number : ''}`, `${dfmt(date)} · ${x.method || 'Cash'}`, amt,
        !bill ? 'Bill not found – not posted' : dup ? 'Same payment already recorded' : amt - purBal(bill) > 0.004 ? `More than the bill balance (${fmt(purBal(bill))})` : '', dup, ctx => {
          if (!bill) return; bill.payments = bill.payments || [];
          bill.payments.push({amount: amt, date, method: x.method || 'Cash', acc: findAcc(x.account), note: x.note || '', imp: ctx.id});
        });
    });
    (b.invoices || []).forEach(v => {
      const type = v.type === 'QUO' ? 'QUO' : 'INV', date = D(v.date);
      const mk = () => (v.lines || []).map(l => { const it = itemSpec(l.item || l.desc); return {itemId: it && it.id ? it.id : '', desc: l.desc || (it && it.name) || l.item || '', qty: num(l.qty || 1), price: r2(l.price !== undefined ? l.price : it ? it.price : 0), kind: l.kind || (it && it.service ? 'service' : it ? 'part' : 'service'), cost: it && !it.service ? r2(it.cost) : 0}; });
      const lines = mk();
      const tot = r2(lines.reduce((s, l) => s + l.qty * l.price, 0) - num(v.discount));
      const ec = findCust(v.customer);
      const dupI = ec && db.docs.some(d => d.type === type && d.customerId === ec.id && d.date === date && Math.abs(docTotal(d) - tot) < 0.005);
      add(type === 'QUO' ? 'Quotations' : 'Invoices', `${v.customer || '?'}${v.subject ? ' · ' + v.subject : ''}`, `${dfmt(date)} · ${lines.length} line${lines.length === 1 ? '' : 's'}${type === 'INV' ? ' · ' + (v.payType || 'credit') : ''}`, tot,
        !v.customer ? 'Customer missing' : dupI ? 'Same ' + (type === 'QUO' ? 'quotation' : 'invoice') + ' already in the app' : !custRef(v.customer) ? 'New customer will be created' : '', dupI, ctx => {
          let c = custRef(v.customer);
          if (!c || c.pending) { c = {id: uid(), name: String(v.customer).trim(), imp: ctx.id}; db.customers.push(c); newC[low(v.customer)] = c; }
          const s = S(), d = {id: uid(), type, number: nextNumber(type), customerId: c.id, date, due: v.due || addDays(date, type === 'INV' ? (num(v.creditDays || c.creditDays) || s.dueDays || 15) : (s.quoValid || 30)),
            subject: v.subject || '', lines: mk(), discount: num(v.discount), notes: v.notes || '', payments: [], status: 'Open', created: String(Date.now()), imp: ctx.id};
          if (type === 'INV') { d.payType = v.payType === 'cash' ? 'cash' : 'credit'; if (d.payType === 'credit') d.creditDays = v.creditDays || c.creditDays || ''; }
          bumpNumber(type);
          if (v.paid && num(v.paid.amount)) d.payments.push({amount: r2(v.paid.amount), date: D(v.paid.date || date), method: v.paid.method || 'Cash', acc: findAcc(v.paid.account), note: v.paid.note || '', imp: ctx.id});
          if (type === 'INV' && d.payType === 'cash') { if (v.paid) d.cashMethod = v.paid.method; else if (typeof applyPayType === 'function') applyPayType(d); }
          db.docs.push(d);
        });
    });
    (b.payments || []).forEach(x => {
      const amt = r2(x.amount), date = D(x.date);
      let inv = x.invoice && db.docs.find(d => d.type === 'INV' && low(d.number) === low(x.invoice));
      const c = custRef(x.customer) || (inv && custById(inv.customerId));
      let targets = [];
      if (inv) targets = [[inv, amt]];
      else if (c && !c.pending) {
        let left = amt;
        db.docs.filter(d => d.type === 'INV' && !d.cancelled && d.customerId === c.id && docBal(d) > 0.004).sort((a, b2) => String(a.date).localeCompare(String(b2.date))).forEach(d => { if (left <= 0.004) return; const t = Math.min(left, docBal(d)); targets.push([d, r2(t)]); left = r2(left - t); });
        if (left > 0.004) targets.left = left;
      }
      const dup = targets.some(([d, a]) => (d.payments || []).some(p => p.date === date && Math.abs(num(p.amount) - a) < 0.005));
      const warn = !targets.length ? (x.invoice ? `Invoice ${x.invoice} not found – not posted` : 'No open invoice found – not posted') : dup ? 'Same payment already recorded' : targets.left ? `${fmt(targets.left)} more than the open invoices – not posted` : inv && amt - docBal(inv) > 0.004 ? `More than the invoice balance (${fmt(docBal(inv))})` : '';
      add('Customer payments', `${(c && c.name) || x.customer || '?'} → ${targets.map(([d]) => d.number).join(', ') || '?'}`, `${dfmt(date)} · ${x.method || 'Cash'}${x.note ? ' · ' + x.note : ''}`, amt, warn, dup || !!targets.left, ctx => {
        targets.forEach(([d, a]) => { d.payments = d.payments || []; d.payments.push({amount: a, date, method: x.method || 'Cash', acc: findAcc(x.account), note: x.note || '', imp: ctx.id}); });
      });
    });
    const jr = (sec, list, mk) => (list || []).forEach(j => {
      const amt = r2(j.amount), date = D(j.date), L = mk(j);
      const miss = L.lines.some(l => !l.acc);
      const dupJ = (db.journals || []).some(x => x.date === date && x.kind === L.kind && low(x.memo) === low(j.memo || L.memo) && (x.lines || []).some(l => Math.abs(num(l.dr) - amt) < 0.005));
      add(sec, j.memo || L.memo, `${dfmt(date)} · ${L.lines.slice().reverse().map(l => accName(l.acc) || '?').join(' → ')}`, amt, miss ? 'Account not found – not posted' : dupJ ? 'Same entry already in the app' : '', dupJ, ctx => {
        if (miss) return;
        db.journals = db.journals || [];
        db.journals.push({id: uid(), no: FitxLedger.nextJournalNo(), date, memo: j.memo || L.memo, kind: L.kind, lines: L.lines.map(l => Object.assign(l, {memo: j.memo || L.memo})), imp: ctx.id});
      });
    });
    jr('Bank transfers', b.transfers, j => ({kind: 'transfer', memo: 'Transfer', lines: [{acc: findAcc(j.to), dr: r2(j.amount), cr: 0}, {acc: findAcc(j.from), dr: 0, cr: r2(j.amount)}]}));
    jr('Money in', b.moneyIn, j => ({kind: 'in', memo: 'Money in', lines: [{acc: findAcc(j.account || '1100'), dr: r2(j.amount), cr: 0}, {acc: findAcc(j.other || '3000'), dr: 0, cr: r2(j.amount)}]}));
    jr('Money out', b.moneyOut, j => ({kind: 'out', memo: 'Money out', lines: [{acc: findAcc(j.other || '3100'), dr: r2(j.amount), cr: 0}, {acc: findAcc(j.account || '1100'), dr: 0, cr: r2(j.amount)}]}));
    return rows;
  }

  /* ---------- screens ---------- */
  function parse(text) {
    let t = String(text || '').trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) t = m[1].trim();   // pasted from a chat message
    const i = t.indexOf('{'), j = t.lastIndexOf('}'); if (i > 0 || j < t.length - 1) t = t.slice(i, j + 1);
    const b = JSON.parse(t);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Not an import batch');
    return b;
  }
  function start() {
    if (window.FitxLedger && FitxLedger.ensureAccounts) FitxLedger.ensureAccounts();
    const hist = (S().imports || []).slice(-5).reverse();
    openSheet('Import entries', `
      <p class="hint" style="margin-top:0">Open the daily entry file (.json) or paste the text you received. You check everything before it is posted.</p>
      <button type="button" class="btn pri full" id="imFile" style="margin-bottom:10px">${ICON.box}Open import file</button>
      <label class="f"><span>…or paste here</span><textarea class="in" id="imText" rows="6" placeholder='{"fitx":"import", …}' style="font-family:ui-monospace,Menlo,monospace;font-size:12px"></textarea></label>
      <button type="button" class="btn full" id="imGo">Review pasted entries</button>
      <div class="sec"><h2>Help Claude match your data</h2></div>
      <p class="hint">Share this small file now and then (customers, open invoices & bills, suppliers, products, accounts) so payments are matched to the right invoices.</p>
      <button type="button" class="btn full" id="imCtx">${ICON.share}Share “Data for Claude”</button>
      ${hist.length ? `<div class="sec"><h2>Recent imports</h2></div><div class="list">${hist.map(h => `<div class="item"><div class="main"><div class="t">${esc(h.batch)}</div><div class="s">${new Date(h.at).toLocaleString()} · ${h.n} entr${h.n === 1 ? 'y' : 'ies'}${h.undone ? ' · undone' : ''}</div></div>${h.undone ? '' : `<button type="button" class="btn danger" data-undo="${h.id}">Undo</button>`}</div>`).join('')}</div>` : ''}`, el => {
      const inp = $('#importFile');
      el.querySelector('#imFile').onclick = () => {
        inp.value = '';
        inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { inp.onchange = null; tryReview(r.result); }; r.readAsText(f); };
        inp.click();
      };
      el.querySelector('#imGo').onclick = () => tryReview(el.querySelector('#imText').value);
      el.querySelector('#imCtx').onclick = shareContext;
      el.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => undo(b.dataset.undo));
    });
  }
  function tryReview(text) {
    let b; try { b = parse(text); } catch (e) { toast('This is not a valid import file'); return; }
    if (b.app === 'fitx-accounts' && b.docs) { toast('This is a full backup – use Backup & restore instead'); return; }
    review(b);
  }
  function review(b) {
    const rows = plan(b);
    if (!rows.length) { toast('Nothing to import in this file'); return; }
    const secs = [...new Set(rows.map(r => r.sec))];
    openSheet('Review: ' + (b.batch || 'import'), `
      ${b.note ? `<div class="card" style="margin-bottom:12px;white-space:pre-wrap">${esc(b.note)}</div>` : ''}
      <p class="hint" style="margin-top:0">Untick anything you don't want. Grey = already in the app (duplicates are unticked).</p>
      ${secs.map(s => `<div class="sec"><h2>${esc(s)} (${rows.filter(r => r.sec === s).length})</h2></div><div class="list">${rows.map((r, i) => r.sec !== s ? '' : `
        <label class="item" style="cursor:pointer;${r.dup ? 'opacity:.55' : ''}"><input type="checkbox" data-r="${i}" ${r.on ? 'checked' : ''} style="width:22px;height:22px;flex:0 0 22px;accent-color:var(--orange)">
          <div class="main"><div class="t">${esc(r.label)}</div><div class="s">${esc(r.sub)}</div>${r.warn ? `<div class="s" style="color:${/not posted|missing/i.test(r.warn) ? 'var(--red)' : 'var(--orange-d)'};font-weight:600">⚠ ${esc(r.warn)}</div>` : ''}</div>
          ${r.amt !== null && r.amt !== undefined ? `<div class="r"><div class="amt">${fmt(r.amt)}</div></div>` : ''}</label>`).join('')}</div>`).join('')}
      <div class="tot" id="imTot" style="margin-top:12px"></div>
      <button type="button" class="btn pri full" id="imPost">Post selected entries</button>`, el => {
      const tot = () => { const sel = rows.filter(r => r.on); el.querySelector('#imTot').innerHTML = `<div class="g"><span>${sel.length} of ${rows.length} selected</span><span>${money(sel.reduce((s, r) => s + (num(r.amt) || 0), 0))}</span></div>`; };
      el.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { rows[+c.dataset.r].on = c.checked; tot(); });
      tot();
      el.querySelector('#imPost').onclick = () => {
        const sel = rows.filter(r => r.on); if (!sel.length) { toast('Nothing selected'); return; }
        const ctx = {id: 'imp_' + uid()};
        let n = 0; const fails = [];
        sel.forEach(r => { try { r.apply(ctx); n++; } catch (e) { console.error(e); fails.push(r.label); } });
        const st = S(); st.imports = (st.imports || []).concat([{id: ctx.id, batch: b.batch || today() + ' import', at: Date.now(), n}]).slice(-30);
        save();
        while (sheets.length) closeTopSheet(); render();
        toast(`${n} entr${n === 1 ? 'y' : 'ies'} posted${fails.length ? ' · ' + fails.length + ' failed' : ''}`);
      };
    });
  }
  function undo(id) {
    const h = (S().imports || []).find(x => x.id === id); if (!h) return;
    if (!confirm(`Undo the import "${h.batch}"?\n\nEverything it created (expenses, bills, invoices, payments, transfers) is removed.`)) return;
    const tag = x => x && x.imp === id;
    db.expenses = db.expenses.filter(x => !tag(x));
    db.purchases = db.purchases.filter(x => !tag(x)); db.purchases.forEach(p => { if (p.payments) p.payments = p.payments.filter(x => !tag(x)); });
    db.docs = db.docs.filter(x => !tag(x)); db.docs.forEach(d => { if (d.payments) d.payments = d.payments.filter(x => !tag(x)); });
    if (db.journals) db.journals = db.journals.filter(x => !tag(x));
    const used = id2 => db.docs.some(d => d.customerId === id2) || db.purchases.some(p => p.supplierId === id2);
    db.customers = db.customers.filter(c => !tag(c) || used(c.id));
    db.suppliers = db.suppliers.filter(s => !tag(s) || used(s.id));
    db.items = db.items.filter(i => !tag(i) || db.docs.some(d => (d.lines || []).some(l => l.itemId === i.id)) || db.purchases.some(p => (p.lines || []).some(l => l.itemId === i.id)));
    h.undone = true; save();
    while (sheets.length) closeTopSheet(); render(); toast('Import undone');
  }

  /* compact data for matching (no amounts beyond what is needed) */
  function shareContext() {
    const ctx = {fitx: 'context', v: 1, exported: new Date().toISOString(), company: S().name,
      customers: db.customers.map(c => ({name: c.name, phone: c.phone || undefined, invType: c.invType || undefined})),
      openInvoices: db.docs.filter(d => d.type === 'INV' && !d.cancelled && docBal(d) > 0.004).map(d => ({number: d.number, customer: (custById(d.customerId) || {}).name, date: d.date, total: docTotal(d), balance: docBal(d)})),
      suppliers: db.suppliers.map(s => ({name: s.name, phone: s.phone || undefined})),
      openBills: db.purchases.filter(p => purBal(p) > 0.004).map(p => ({number: p.number, supplier: (supById(p.supplierId) || {}).name, ref: p.ref || undefined, date: p.date, balance: purBal(p)})),
      items: db.items.map(i => ({name: i.name, sku: i.sku || undefined, unit: i.unit, price: num(i.price) || undefined, service: i.service || undefined, category: i.category})),
      expenseCategories: S().expCats,
      accounts: (db.accounts || []).filter(a => !a.hidden).map(a => ({code: a.code, name: a.name, type: a.type, sub: a.sub || undefined})),
      lastNumbers: {invoice: S().nextInv - 1, quotation: S().nextQuo - 1, bill: (S().nextPur || 1) - 1}};
    const json = JSON.stringify(ctx);
    const name = 'FitX-data-for-Claude-' + today() + '.json';
    if (window.AndroidBridge && AndroidBridge.shareFile) { try { AndroidBridge.shareFile(btoa(unescape(encodeURIComponent(json))), 'application/json', name, 'FitX data for Claude'); return; } catch (e) {} }
    if (navigator.share && navigator.canShare) {
      try { const f = new File([json], name, {type: 'application/json'}); if (navigator.canShare({files: [f]})) { navigator.share({files: [f], title: name}).catch(() => {}); return; } } catch (e) {}
    }
    if (window.AndroidBridge && AndroidBridge.shareFile) { try { AndroidBridge.shareFile(btoa(unescape(encodeURIComponent(json))), 'application/json', name, 'FitX data for Claude'); return; } catch (e) {} }
    download(name, json, 'application/json'); toast('Saved ' + name);
  }

  /* Menu entry */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const k = document.getElementById('mBak'); if (!k || document.getElementById('mImp')) return;
    k.insertAdjacentHTML('afterend', `<button type="button" class="item rcard" id="mImp"><span class="ic">${ICON.box}</span><div class="main"><div class="t">Import entries</div><div class="s">Daily data entry file (from Claude) · review · post · undo</div></div></button>`);
    document.getElementById('mImp').onclick = start;
  };
  window.FitxImport = {start, review, plan, parse, shareContext};
})();
