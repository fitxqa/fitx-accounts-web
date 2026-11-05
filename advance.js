/* FitX Accounts — sales orders, proforma invoices and customer advances (all built on the quotation).
   Flow: Quotation → Proforma (request e.g. 50% advance) → advance received
         → Invoice (advance deducted automatically).
   Accounting: advance received  Dr Bank/Cash, Cr 2200 Customer advances (liability, not income)
               on the invoice      Dr 2200 Customer advances, Cr 1200 Receivables  (payment method "Advance")
   Records: quote.so = {no, date, custRef, delivery}; quote.advPct; quote.advances = [{id, amount, date, method, acc, note}] */
(function () {
  'use strict';
  const ADV = 'acc_2200';
  const proNo = q => String(q.number || '').replace(/^[A-Za-z]+/, 'PRO');
  const advPct = q => q.advPct !== undefined && q.advPct !== '' ? num(q.advPct) : (S().advPct !== undefined ? num(S().advPct) : 50);
  const advPaid = q => r2((q.advances || []).reduce((s, x) => s + num(x.amount), 0));
  const advReq = q => r2(docTotal(q) * advPct(q) / 100);
  const applied = q => r2(db.docs.filter(d => d.type === 'INV' && !d.cancelled).reduce((s, d) => s + (d.payments || []).filter(p => p.adv && p.advQuote === q.id).reduce((a, p) => a + num(p.amount), 0), 0));
  const available = q => r2(advPaid(q) - applied(q));
  const proDoc = q => Object.assign({}, q, {number: proNo(q), _pro: true, _advPct: advPct(q), _advReq: advReq(q), _advPaid: advPaid(q)});
  const soDoc = q => Object.assign({}, q, {number: q.so.no, date: q.so.date || q.date, due: q.so.delivery || '', _so: true, _custRef: q.so.custRef || ''});
  const top = () => typeof sheets !== 'undefined' && sheets[sheets.length - 1];
  const methods = sel => ['Cash', 'Fawran', 'Bank transfer', 'Card', 'Cheque'].map(m => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('');

  /* ---------- invoice from the quotation: deduct the advance ---------- */
  function apply(inv, quoteId) {
    const q = docById(quoteId); if (!q || !(q.advances || []).length) return;
    const avail = available(q); if (avail <= 0.004) return;
    const other = (inv.payments || []).filter(p => !p.auto).reduce((s, p) => s + num(p.amount), 0);
    const amt = r2(Math.min(avail, docTotal(inv) - other)); if (amt <= 0.004) return;
    inv.payments = inv.payments || [];
    inv.payments.push({amount: amt, date: inv.date, method: 'Advance', acc: ADV, note: 'Advance ' + proNo(q), adv: true, advQuote: q.id});
  }

  /* ---------- accounting ---------- */
  (window.FITX_POSTERS = window.FITX_POSTERS || []).push(add => {
    db.docs.forEach(q => {
      if (q.type !== 'QUO') return;
      const who = (custById(q.customerId) || {}).name || '';
      (q.advances || []).forEach((x, i) => {
        const open = () => proforma(q.id);
        add('adv:' + q.id + ':' + i + ':b', x.date, FitxLedger.moneyAcc(x.acc, x.method), num(x.amount), `Advance received · ${who} (${x.method || ''})`, proNo(q), open);
        add('adv:' + q.id + ':' + i + ':l', x.date, ADV, -num(x.amount), `Advance received · ${who}`, proNo(q), open);
      });
    });
  });
  (window.FITX_ACCT_HOOKS = window.FITX_ACCT_HOOKS || []).push((a, f, t) => {
    db.docs.forEach(q => { if (q.type === 'QUO') (q.advances || []).forEach(x => { if (x.date >= f && x.date <= t) { a.collected += num(x.amount); a.inByMethod[x.method || 'Other'] = (a.inByMethod[x.method || 'Other'] || 0) + num(x.amount); } }); });
  });

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .advbar{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:6px 0 2px}
    .advbar i{display:block;height:100%;background:var(--green)}
    .flowrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin:0 0 12px;color:var(--muted)}
    .flowrow span{padding:3px 9px;border-radius:99px;background:var(--line);font-weight:700}
    .flowrow span.done{background:#e3f6ec;color:#1a7f45}
    .flowrow span.now{background:var(--orange-l);color:var(--orange-d)}
    .pctrow{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}
    .pctrow button{border:1.5px solid var(--line2);background:var(--card);border-radius:99px;padding:6px 12px;font-weight:700;color:var(--text);min-height:38px}
    .pctrow button.on{border-color:var(--orange);background:var(--orange-l);color:var(--orange-d)}`;
  document.head.appendChild(css);

  /* ---------- share bar for SO / proforma PDFs ---------- */
  function shareBar(el, prefix, getDoc, kind) {
    const q = () => getDoc(), c = () => custById(q().customerId) || {};
    const name = () => q().number + ' - ' + (c().name || '');
    const opts = () => ({html: docHTML(q()), name: name(), phone: c().phone, email: c().email, subject: name(), body: '', wa: waText(q(), kind)});
    bindShare(el, prefix, opts, () => printHTML(docHTML(q()), name()));
    el.querySelector('#' + prefix + 'Mail').onclick = () => FitxMail.compose(mailSpec(q(), kind));
    const pv = el.querySelector('#' + prefix + 'Pv'); if (pv) pv.onclick = () => FitxMail.pdfPreview(docHTML(q()), name());
  }
  function waText(d, kind) {
    const c = custById(d.customerId) || {}, s = S();
    if (kind === 'pro') return `Dear ${c.contact || c.name || 'Customer'},\n\nProforma invoice *${d.number}* – total ${money(docTotal(d))}.\nTo confirm the order please pay the ${d._advPct}% advance: *${money(Math.max(0, d._advReq - d._advPaid))}*.\n\n${s.payNote || ''}\n\nThank you,\n${s.name}`;
    return `Dear ${c.contact || c.name || 'Customer'},\n\nThank you for your order. Sales order *${d.number}* – total ${money(docTotal(d))}${d.due ? '\nPlanned delivery: ' + dfmt(d.due) : ''}${d._custRef ? '\nYour ref: ' + d._custRef : ''}.\n\nThank you,\n${s.name}`;
  }
  function mailSpec(d, kind) {
    const c = custById(d.customerId) || {};
    const base = Object.assign(FitxMail.custVars(c), {number: d.number, date: dfmt(d.date), due: d.due ? dfmt(d.due) : 'to be agreed', total: money(docTotal(d)), for: d.subject ? ' for ' + d.subject : '', re: d.subject ? ' – ' + d.subject : ''});
    if (kind === 'pro') return {kind: 'proforma', to: c.email, cust: c, rec: docById(d.id), phone: c.phone, vars: FitxMail.baseVars(Object.assign(base, {pct: d._advPct, advance: money(Math.max(0, d._advReq - d._advPaid))})),
      title: 'Proforma invoice', rows: [['Proforma no.', d.number], ['Total', money(docTotal(d))], [`Advance (${d._advPct}%)`, money(d._advReq)], ...(d._advPaid ? [['Received', money(d._advPaid)]] : []), ['Advance due now', money(Math.max(0, d._advReq - d._advPaid)), true]],
      extra: S().payNote, atts: [{name: d.number + ' - ' + (c.name || ''), html: () => docHTML(d)}]};
    return {kind: 'so', to: c.email, cust: c, rec: docById(d.id), phone: c.phone, vars: FitxMail.baseVars(base),
      title: 'Sales order', rows: [['Order no.', d.number], ['Order date', dfmt(d.date)], ['Delivery', d.due ? dfmt(d.due) : 'To be agreed'], ...(d._custRef ? [['Your ref', d._custRef]] : []), ['Order total', money(docTotal(d)), true]],
      atts: [{name: d.number + ' - ' + (c.name || ''), html: () => docHTML(d)}]};
  }
  const shareRow = p => `<div class="btns sharebar" style="margin-bottom:12px">
    <button type="button" class="btn pri" id="${p}Share">${ICON.share}Share PDF</button><button type="button" class="btn" id="${p}Wa">${ICON.wa}WhatsApp</button>
    <button type="button" class="btn" id="${p}Mail">${ICON.mail}Email</button><button type="button" class="btn" id="${p}Print">${ICON.print}Print</button>
    <button type="button" class="btn" id="${p}Pv">${ICON.search || ''}PDF preview</button></div>`;

  /* ---------- sales order ---------- */
  function editSO(id, after) {
    const q = docById(id); if (!q) return;
    const so = q.so || {};
    openSheet(so.no ? 'Edit sales order ' + so.no : 'Confirm sales order', `<form id="soForm">
      <p class="hint" style="margin-top:0">${so.no ? '' : 'Turns quotation ' + esc(q.number) + ' into a confirmed sales order with its own number. Prices and lines come from the quotation.'}</p>
      <div class="row"><label class="f"><span>Order date</span><input class="in" type="date" name="date" value="${esc(so.date || today())}" required></label><label class="f"><span>Delivery / completion date</span><input class="in" type="date" name="delivery" value="${esc(so.delivery || '')}"></label></div>
      <label class="f"><span>Customer's PO / reference</span><input class="in" name="custRef" value="${esc(so.custRef || '')}" placeholder="e.g. PO-4471 or LPO number"></label>
      <button class="btn pri full" type="submit">${so.no ? 'Save' : 'Confirm sales order'}</button></form>`, el => {
      el.querySelector('#soForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target), s = S();
        if (!q.so) { q.so = {no: `${s.soPrefix || 'SO'}-${new Date().getFullYear()}-${String(s.nextSO || 1).padStart(4, '0')}`}; s.nextSO = (s.nextSO || 1) + 1; }
        Object.assign(q.so, {date: v.date, delivery: v.delivery, custRef: v.custRef.trim()});
        if (!q.status || q.status === 'Open') q.status = 'Accepted';
        q.updated = Date.now(); save();
        closeSheet(() => { toast('Sales order ' + q.so.no + ' saved'); (after || salesOrder)(q.id); });
      };
    });
  }
  function salesOrder(id) {
    const q = docById(id); if (!q || !q.so) return;
    const d = soDoc(q);
    openSheet('Sales order ' + q.so.no, `${flow(q, 'so')}${shareRow('so')}
      <div class="btns" style="margin-bottom:12px"><button type="button" class="btn" id="soEdit">${ICON.edit}Edit order details</button><button type="button" class="btn" id="soPro">Proforma &amp; advance</button>${q.status !== 'Converted' ? `<button type="button" class="btn pri" id="soInv">${ICON.conv}Create invoice</button>` : ''}</div>
      <div class="sec"><h2>Preview</h2></div><div>${docHTML(d)}</div>`, el => {
      shareBar(el, 'so', () => soDoc(docById(id)), 'so');
      el.querySelector('#soEdit').onclick = () => editSO(id, x => reopenWith(() => salesOrder(x)));
      el.querySelector('#soPro').onclick = () => closeSheet(() => proforma(id));
      const iv = el.querySelector('#soInv'); if (iv) iv.onclick = () => { while (sheets.length) closeTopSheet(); editDoc('INV', null, docById(id)); };
    });
  }
  const flow = (q, now) => {
    const inv = q.status === 'Converted';
    const st = [['quo', 'Quotation', true], ['pro', 'Advance', advPaid(q) > 0], ['inv', 'Invoice', inv]];
    return `<div class="flowrow">${st.map(([k, l, done], i) => `${i ? '›' : ''}<span class="${k === now ? 'now' : done ? 'done' : ''}">${done && k !== now ? '✓ ' : ''}${l}</span>`).join(' ')}</div>`;
  };

  /* ---------- proforma & advance ---------- */
  function proforma(id) {
    const q = docById(id); if (!q) return;
    const req = advReq(q), paid = advPaid(q), due = Math.max(0, r2(req - paid)), pct = advPct(q);
    const PCTS = [25, 30, 40, 50, 60, 70, 100];
    openSheet('Proforma ' + proNo(q), `${flow(q, 'pro')}
      ${KP([['Order total', fmt(docTotal(q))], [`Advance (${pct}%)`, fmt(req), '', true], ['Received', fmt(paid), paid ? 'var(--green)' : ''], ['Due now', fmt(due), due > 0.004 ? 'var(--orange)' : 'var(--green)']])}
      <div class="advbar"><i style="width:${req ? Math.min(100, paid / req * 100) : 0}%"></i></div>
      <div class="sec"><h2>Advance required</h2></div>
      <div class="pctrow">${PCTS.map(p => `<button type="button" data-pct="${p}" class="${p === pct ? 'on' : ''}">${p}%</button>`).join('')}<input class="in" id="pcCustom" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="Other %" style="width:110px;min-height:38px" value="${PCTS.includes(pct) ? '' : pct}"></div>
      ${shareRow('pf')}
      <div class="sec"><h2>Record advance received</h2></div>
      <form id="advForm"><div class="row"><label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0.01" inputmode="decimal" name="amount" value="${due > 0.004 ? due : ''}" required></label><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${today()}" required></label></div>
        <div class="row"><label class="f"><span>Method</span><select class="in" name="method">${methods('Bank transfer')}</select></label><label class="f"><span>Received into</span><select class="in" name="acc">${window.bankAccOptions ? bankAccOptions('') : '<option value="">Automatic</option>'}</select></label></div>
        <label class="f"><span>Reference / note</span><input class="in" name="note" placeholder="Optional, e.g. cheque no."></label>
        <button class="btn pri full" type="submit">${ICON.pay}Save advance</button></form>
      ${(q.advances || []).length ? `<div class="sec"><h2>Advances received</h2></div><div class="list">${q.advances.map((x, i) => `<div class="item"><div class="main"><div class="t">${money(x.amount)}</div><div class="s">${dfmt(x.date)} · ${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''}</div></div><button type="button" class="btn mailbtn" data-arc="${i}" aria-label="Advance receipt">${ICON.print}</button><button type="button" class="btn mailbtn" data-amail="${i}" aria-label="Email receipt">${ICON.mail}</button><button type="button" class="btn danger" data-adel="${i}" aria-label="Delete advance">${ICON.trash}</button></div>`).join('')}</div>
        <p class="hint">${applied(q) > 0.004 ? `${money(applied(q))} already deducted on invoice ${esc(q.convertedTo || '')}. ` : ''}${available(q) > 0.004 ? `${money(available(q))} will be deducted automatically when you create the invoice from this quotation.` : ''}</p>` : ''}
      ${q.status !== 'Converted' ? `<button type="button" class="btn full" id="pfInv" style="margin-top:12px">${ICON.conv}Create final invoice</button>` : ''}`, el => {
      const reopen = () => reopenWith(() => proforma(id));
      const setPct = v => { v = Math.max(1, Math.min(100, num(v))); if (!v) return; q.advPct = v; q.updated = Date.now(); save(); reopen(); };
      el.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => setPct(b.dataset.pct));
      el.querySelector('#pcCustom').onchange = e => setPct(e.target.value);
      shareBar(el, 'pf', () => proDoc(docById(id)), 'pro');
      el.querySelector('#advForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        q.advances = q.advances || [];
        q.advances.push({id: uid(), amount: r2(v.amount), date: v.date, method: v.method, acc: v.acc || '', note: v.note.trim()});
        if (!q.status || q.status === 'Open') q.status = 'Accepted';
        q.updated = Date.now(); save(); reopen(); toast('Advance saved – booked to Customer advances');
      };
      el.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => {
        const i = +b.dataset.adel;
        if (applied(q) > 0.004 && available(q) - num(q.advances[i].amount) < -0.004) { toast('This advance is already deducted on an invoice – remove it from the invoice first'); return; }
        if (!confirm('Delete this advance?')) return;
        q.advances.splice(i, 1); save(); reopen();
      });
      el.querySelectorAll('[data-arc]').forEach(b => b.onclick = () => FitxMail.pdfPreview(receiptHTML(q, +b.dataset.arc), rcNo(q, +b.dataset.arc) + ' - ' + ((custById(q.customerId) || {}).name || '')));
      el.querySelectorAll('[data-amail]').forEach(b => b.onclick = () => FitxMail.compose(rcSpec(q, +b.dataset.amail)));
      const iv = el.querySelector('#pfInv'); if (iv) iv.onclick = () => { while (sheets.length) closeTopSheet(); editDoc('INV', null, docById(id)); };
    });
  }
  const rcNo = (q, i) => 'ADV-' + String(q.number || '').replace(/^[A-Za-z]+-?/, '') + '-' + (i + 1);
  function receiptHTML(q, i) {
    const x = q.advances[i], c = custById(q.customerId) || {};
    return reportPaper('Advance receipt', 'إيصال دفعة مقدمة', rcNo(q, i) + ' · ' + dfmt(x.date), `
      <table class="eqt"><tbody>
        <tr><td><b>Received from</b></td><td>${esc(c.name || '')}${c.contact ? '<br>Attn: ' + esc(c.contact) : ''}</td></tr>
        <tr><td><b>Amount received</b></td><td style="font-size:18px;font-weight:800;color:#ff6a00">${money(x.amount)}</td></tr>
        <tr><td><b>Payment method</b></td><td>${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''}</td></tr>
        <tr><td><b>Date</b></td><td>${dfmt(x.date)}</td></tr>
        <tr><td><b>Against</b></td><td>Proforma ${esc(proNo(q))} · order total ${money(docTotal(q))}</td></tr>
        <tr><td><b>Total advance received</b></td><td>${money(advPaid(q))} of ${money(advReq(q))} requested (${advPct(q)}%)</td></tr>
      </tbody></table>
      <p style="margin-top:22px;font-size:12px">This advance will be deducted from the final invoice.</p>`);
  }
  function rcSpec(q, i) {
    const x = q.advances[i], c = custById(q.customerId) || {};
    return {kind: 'advrcpt', to: c.email, cust: c, rec: q, phone: c.phone,
      vars: FitxMail.baseVars(Object.assign(FitxMail.custVars(c), {number: proNo(q), amount: money(x.amount), date: dfmt(x.date), method: x.method || 'payment'})),
      title: 'Advance receipt', rows: [['Receipt no.', rcNo(q, i)], ['Proforma', proNo(q)], ['Date', dfmt(x.date)], ['Method', x.method || ''], ['Amount received', money(x.amount), true]],
      atts: [{name: rcNo(q, i) + ' - ' + (c.name || ''), html: () => receiptHTML(q, i)}]};
  }

  /* ---------- buttons on the quotation screen ---------- */
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const q = docById(id), el = top(); if (!q || !el) return;
    if (q.type === 'INV') return;
    const anchor = el.querySelector('#aEdit'); if (!anchor) return;
    const box = anchor.parentElement;
    box.insertAdjacentHTML('afterbegin', `<button type="button" class="btn" id="aPro">Proforma &amp; advance${advPaid(q) ? ' ✓' : ''}</button>`);
    el.querySelector('#aPro').onclick = () => closeSheet(() => proforma(id));
    if (advPaid(q)) box.insertAdjacentHTML('afterend', `<p class="hint" style="margin:-6px 2px 12px">Advance received ${money(advPaid(q))} of ${money(advReq(q))} (${advPct(q)}%)${available(q) > 0.004 ? ' – deducted automatically on the invoice' : ''}.</p>`);
    const del = el.querySelector('#aDel');
    if (del && (q.advances || []).length) del.onclick = () => toast('This quotation has advance payments. Delete the advances first (Proforma & advance).');
  };

  /* ---------- Sales orders list ---------- */
  function viewSalesOrders() {
    setTop('Sales', '+ Quotation', () => editDoc('QUO'));
    const list = db.docs.filter(d => d.type === 'QUO' && d.so).sort((a, b) => String(b.so.date || '').localeCompare(String(a.so.date || '')));
    const F = state.soFilter || 'Open';
    const shown = list.filter(q => F === 'All' ? true : F === 'Open' ? q.status !== 'Converted' : q.status === 'Converted');
    $('#main').innerHTML = subnav('sales') + `
      <div class="chips">${['Open', 'Invoiced', 'All'].map(f => `<button type="button" data-sf="${f}" class="${F === f ? 'on' : ''}">${f}</button>`).join('')}</div>
      ${shown.length ? `<div class="list">${shown.map(q => { const c = custById(q.customerId) || {}, req = advReq(q), paid = advPaid(q);
        return `<button type="button" class="item" data-so="${q.id}"><div class="main"><div class="t">${esc(c.name || 'No customer')}</div><div class="s">${esc(q.so.no)} · ${dfmt(q.so.date)}${q.so.delivery ? ' · delivery ' + dfmt(q.so.delivery) : ''}${q.so.custRef ? ' · ref ' + esc(q.so.custRef) : ''}</div><div class="s">${paid ? `Advance ${money(paid)} of ${money(req)}` : 'No advance yet'}${q.status === 'Converted' ? ' · invoiced ' + esc(q.convertedTo || '') : ''}</div></div><div class="r"><div class="amt">${fmt(docTotal(q))}</div><span class="badge ${q.status === 'Converted' ? 'b-green' : paid >= req - 0.004 && paid ? 'b-green' : 'b-orange'}">${q.status === 'Converted' ? 'Invoiced' : paid >= req - 0.004 && paid ? 'Advance paid' : paid ? 'Part advance' : 'Open'}</span></div></button>`; }).join('')}</div>`
        : `<div class="list"><div class="empty">No sales orders yet. Open an accepted quotation and tap <b>Confirm sales order</b>.</div></div>`}
      <p class="hint" style="margin:10px 4px">${shown.length} order${shown.length === 1 ? '' : 's'} · Total ${money(shown.reduce((s, q) => s + docTotal(q), 0))} · Advances held ${money(shown.reduce((s, q) => s + available(q), 0))}</p>`;
    $$('#main [data-sf]').forEach(b => b.onclick = () => { state.soFilter = b.dataset.sf; render(); });
    $$('#main [data-so]').forEach(b => b.onclick = () => salesOrder(b.dataset.so));
  }

  window.FitxAdv = {apply, proforma, salesOrder, editSO, proNo, advPaid, advReq, available, proDoc, soDoc};
})();
