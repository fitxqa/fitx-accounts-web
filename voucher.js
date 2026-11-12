/* FitX Accounts — "Receipt Voucher" design (same layout as the printed FitX receipt book).
   Optional: Settings value S().rcptStyle = 'voucher' | 'standard' (default standard). Chosen from the receipt screen.
   Used for invoice payment receipts and advance receipts (screen, PDF, print, email attachment). */
(function () {
  'use strict';
  const OR = '#ff6a00';
  const on = () => S().rcptStyle === 'voucher';
  let HEAD = 'icons/voucher-head.png';
  fetch(HEAD).then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).then(u => { HEAD = u; }).catch(() => {});
  const stamp = () => S().stampImg || window.FITX_STAMP_DATA || 'icons/stamp.png';

  /* ---------- amount in words (Qatari Riyals & Dirhams) ---------- */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function w999(n) {
    let s = '';
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' and '; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += '-' + ONES[n % 10]; }
    else if (n) s += ONES[n];
    return s;
  }
  function words(n) {
    n = Math.floor(n); if (!n) return 'Zero';
    const parts = [];
    for (const [v, l] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) if (n >= v) { parts.push(w999(Math.floor(n / v)) + ' ' + l); n %= v; }
    if (n) parts.push((parts.length && n < 100 ? 'and ' : '') + w999(n));
    return parts.join(' ');
  }
  function amountWords(a) {
    a = Math.round(num(a) * 100) / 100;
    const r = Math.floor(a), d = Math.round((a - r) * 100);
    return `Qatari Riyals ${words(r)}${d ? ' and Dirhams ' + words(d) : ''} Only`;
  }

  /* ---------- the voucher page ---------- */
  const fl = (v, extra) => `<span class="vv"${extra ? ` style="${extra}"` : ''}>${v || '&nbsp;'}</span>`;
  const box = (label, ticked) => `<span class="vck"><b>${label}</b><i>${ticked ? '✓' : ''}</i></span>`;
  function phoneFmt(p) { const d = String(p || '').replace(/\D/g, ''); return d.length === 8 ? `+974 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6)}` : (p || ''); }
  function html(o) {
    const s = S(), m = String(o.method || '').toLowerCase();
    const isChq = /cheque|check|pdc/.test(m), isCash = !isChq && /cash/.test(m), isOther = !isChq && !isCash;
    const rows = (o.lines || []).slice(0, 8);
    while (rows.length < 3) rows.push(null);
    const wa = '<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:-2px" fill="none" stroke="#fff" stroke-width="2"><path d="M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1-.4-2.5-1.9-2.9-2.9l.9-1-1-2z" fill="#fff" stroke="none"/></svg>';
    return `<div class="paper vpaper"><style>
      .vpaper{padding:0!important;font-family:'Open Sans','Segoe UI',Arial,sans-serif;color:#111;overflow:visible}
      .vpaper .vb{border:1.6px solid #000}
      .vpaper .vh{background:#000;display:flex;align-items:center;gap:12px;padding:10px 16px 10px 14px}
      .vpaper .vh img{height:58px;width:auto;max-width:68%;display:block}
      .vpaper .vtag{margin-left:auto;text-align:center}
      .vpaper .vtag b{display:block;background:${OR};color:#fff;font-size:15px;font-weight:700;padding:4px 12px;white-space:nowrap}
      .vpaper .vtag small{display:block;color:#fff;font-size:12px;margin-top:3px;font-family:'Noto Naskh Arabic','Segoe UI',Tahoma,sans-serif}
      .vpaper .vbody{padding:14px 22px 14px;font-size:12px}
      .vpaper .vr{display:flex;align-items:flex-end;gap:8px;margin-bottom:11px}
      .vpaper .vr>b,.vpaper .vl{font-weight:600;white-space:nowrap}
      .vpaper .vv{flex:1;border-bottom:1px solid #000;min-height:17px;padding:0 4px 1px;font-weight:700;font-size:12.5px;color:#0d1b3d}
      .vpaper .vck{display:inline-flex;align-items:center;gap:6px;margin-right:16px}
      .vpaper .vck i{display:inline-flex;width:17px;height:17px;border:1.3px solid #000;align-items:center;justify-content:center;font-style:normal;font-weight:800;color:${OR};font-size:14px;line-height:1}
      .vpaper table.vt{width:100%;border-collapse:collapse;margin:4px 0 12px}
      .vpaper table.vt th{font-weight:600;text-align:left;border:1px solid #000;padding:5px 8px;font-size:12px;background:#fff!important;color:#111!important;text-transform:none;letter-spacing:0}
      .vpaper table.vt td{border:1px solid #000;padding:5px 8px;height:16px;font-size:11.5px;font-weight:600;color:#0d1b3d;vertical-align:top}
      .vpaper table.vt .n{text-align:right;white-space:nowrap}
      .vpaper table.vt th.n{text-align:center}
      .vpaper .vbot{display:flex;gap:26px;align-items:stretch;margin-top:4px}
      .vpaper table.vs{border-collapse:collapse;width:48%}
      .vpaper table.vs td{border:1px solid #000;padding:6px 8px;font-size:12px}
      .vpaper table.vs td:first-child{font-weight:600;white-space:nowrap;width:40%}
      .vpaper table.vs td:last-child{font-weight:800;color:#0d1b3d;text-align:right}
      .vpaper .vsig{flex:1;display:flex;flex-direction:column;justify-content:space-between;position:relative}
      .vpaper .vsig .vr{margin-bottom:6px}
      .vpaper .vstamp{position:absolute;right:6px;bottom:-6px;width:88px;opacity:.92;pointer-events:none}
      .vpaper .vf{background:#000;color:#fff;text-align:center;font-weight:600;font-size:11.5px;padding:9px 10px;letter-spacing:.1px}
      .vpaper .vf span{opacity:.6;margin:0 5px}
    </style><div class="vb">
      <div class="vh"><img src="${HEAD}" alt="FitX Sports Equipment Services"><div class="vtag"><b>Receipt Voucher</b><small dir="rtl" lang="ar">سند قبض</small></div></div>
      <div class="vbody">
        <div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:6px">
          <div style="flex:1;display:flex;align-items:flex-end;flex-wrap:wrap;gap:4px 0;padding-top:4px">${box('Cheque', isChq)}${box('Cash', isCash)}${box('Other', isOther)}<span style="flex:1;display:flex;align-items:flex-end;gap:6px;min-width:160px">${fl(isOther ? esc(o.method || '') : '')}<span style="font-size:11px;white-space:nowrap">(Please specify)</span></span></div>
          <div style="width:32%"><div class="vr"><b>No :</b>${fl(`<span style="color:${OR}">${esc(o.no)}</span>`)}</div><div class="vr" style="margin-bottom:0"><b>Date</b>${fl(esc(dfmt(o.date)))}</div></div>
        </div>
        <div class="vr"><b>Received from</b>${fl(esc(o.from || ''))}</div>
        <div class="vr"><b>The sum of</b>${fl(esc(amountWords(o.received)) + ` <span style="font-weight:600;color:#555">(QAR ${fmt(num(o.received))})</span>`)}</div>
        <div class="vl" style="margin:4px 0 2px">On settlement of</div>
        <table class="vt"><thead><tr><th>Description</th><th class="n" style="width:15%">Rate</th><th class="n" style="width:8%">Qty</th><th class="n" style="width:16%">Total</th></tr></thead>
          <tbody>${rows.map(l => l ? `<tr><td>${esc(l.desc)}</td><td class="n">${l.rate === '' || l.rate === undefined ? '' : fmt(num(l.rate))}</td><td class="n">${l.qty === '' || l.qty === undefined ? '' : String(+num(l.qty).toFixed(3))}</td><td class="n">${fmt(num(l.total))}</td></tr>` : '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}
          ${(o.lines || []).length > 8 ? `<tr><td colspan="4" style="color:#555">+ ${(o.lines.length - 8)} more item(s) – see invoice ${esc(o.ref || '')}</td></tr>` : ''}</tbody></table>
        <div class="vr"><b>Customer Number .:</b>${fl(esc(o.custNo || ''), 'flex:0 0 34%')}${o.ref ? `<span style="margin-left:auto;font-weight:600;white-space:nowrap">Ref :</span>${fl(esc(o.ref), 'flex:0 0 30%')}` : ''}</div>
        <div class="vr"><b>Cheque No .:</b>${fl(esc(o.chqNo || ''), 'flex:0 0 22%')}<b>Bank :</b>${fl(esc(o.bank || ''))}<b>Dated :</b>${fl(o.chqDate ? esc(dfmt(o.chqDate)) : '', 'flex:0 0 18%')}</div>
        <div class="vbot">
          <table class="vs"><tbody>
            <tr><td>Total amount due :</td><td>${fmt(num(o.due))}</td></tr>
            <tr><td>Amount received :</td><td style="color:${OR}">${fmt(num(o.received))}</td></tr>
            <tr><td>Balance due :</td><td>${num(o.balance) > 0.004 ? fmt(num(o.balance)) : 'NIL'}</td></tr>
          </tbody></table>
          <div class="vsig">
            <div class="vr"><b>Paid by :</b>${fl(esc(o.paidBy || ''))}</div>
            <div class="vr"><b>Received by :</b>${fl(esc(o.receivedBy || ''))}</div>
            <div class="vr"><b>Receiver’s Signature :</b>${fl('')}</div>
            ${o.stamp ? `<img class="vstamp" src="${stamp()}" alt="">` : ''}
          </div>
        </div>
      </div>
      <div class="vf">Mobile &amp; ${wa} : ${esc(phoneFmt(s.phone))}<span>|</span>Email: ${esc(s.email || '')}<span>|</span>${esc(s.web || '')}${s.cr ? `<span>|</span>CR No.${esc(s.cr)}` : ''}<span>|</span>Doha- Qatar</div>
    </div></div>`;
  }

  const receivedBy = () => { const u = window.FitxCloud && FitxCloud.user; return (u && u.displayName) || S().lastTech || (S().mail && S().mail.name) || ''; };
  const custNo = c => c.code || c.custNo || c.accNo || c.phone || '';
  const chq = p => /cheque|check|pdc/i.test(p.method || '') ? {chqNo: p.chequeNo || p.ref || p.note || '', bank: p.bank || '', chqDate: p.chequeDate || p.date} : {};
  const rcNo = (d, i) => 'RCT-' + String(d.number || '').replace(/^[A-Za-z]+-?/, '') + '-' + (i + 1);

  /* payment i on invoice d */
  function forInvoice(d, i) {
    const p = d.payments[i], c = custById(d.customerId) || {};
    const before = (d.payments || []).slice(0, i).reduce((s, x) => s + num(x.amount), 0);
    const due = r2(docTotal(d) - before), bal = r2(due - num(p.amount));
    const mains = (d.lines || []).filter(l => !l.sub && ((l.desc || '').trim() || num(l.price)));
    const lines = mains.length ? mains.map(l => ({desc: l.desc, rate: num(l.price), qty: num(l.qty), total: num(l.qty) * num(l.price)})) : [{desc: 'Invoice ' + d.number, rate: '', qty: '', total: docTotal(d)}];
    if (num(d.discount)) lines.push({desc: 'Less: discount', rate: '', qty: '', total: -num(d.discount)});
    return html(Object.assign({no: rcNo(d, i), date: p.date, method: p.method, from: c.name || '', received: p.amount, due, balance: bal,
      lines, custNo: custNo(c), ref: d.number + ' · ' + dfmt(d.date), paidBy: p.paidBy || c.contact || c.name || '', receivedBy: receivedBy(), stamp: d.stamp !== undefined ? !!d.stamp : S().stampOn !== false}, chq(p)));
  }
  /* advance i on quotation q (proforma) */
  function forAdvance(q, i) {
    const x = q.advances[i], c = custById(q.customerId) || {}, A = window.FitxAdv;
    const before = q.advances.slice(0, i).reduce((s, a) => s + num(a.amount), 0);
    const req = A ? A.advReq(q) : docTotal(q), due = r2(Math.max(0, req - before));
    return html(Object.assign({no: 'ADV-' + String(q.number || '').replace(/^[A-Za-z]+-?/, '') + '-' + (i + 1), date: x.date, method: x.method, from: c.name || '', received: x.amount, due, balance: r2(due - num(x.amount)),
      lines: [{desc: `Advance payment against proforma ${A ? A.proNo(q) : q.number}${q.subject ? ' – ' + q.subject : ''} (order total QAR ${fmt(docTotal(q))})`, rate: '', qty: '', total: num(x.amount)}],
      custNo: custNo(c), ref: A ? A.proNo(q) : q.number, paidBy: c.contact || c.name || '', receivedBy: receivedBy(), stamp: S().stampOn !== false}, chq(x)));
  }

  /* ---------- receipt screen (from a payment on the invoice) ---------- */
  function receiptSheet(id, i) {
    const d = docById(id); if (!d || !d.payments[i]) return;
    const c = custById(d.customerId) || {}, p = d.payments[i];
    const name = () => rcNo(d, i) + ' - ' + (c.name || '');
    const H = () => FitxMail.receiptHTML(d, i);
    openSheet('Receipt ' + rcNo(d, i), `
      <div class="seg" id="rvSeg" role="radiogroup" aria-label="Receipt design" style="margin-bottom:12px"><button type="button" data-rv="standard" class="${on() ? '' : 'on'}">Standard receipt</button><button type="button" data-rv="voucher" class="${on() ? 'on' : ''}">Receipt voucher</button></div>
      <div class="btns sharebar" style="margin-bottom:12px">
        <button type="button" class="btn pri" id="rvShare">${ICON.share}Share PDF</button><button type="button" class="btn" id="rvWa">${ICON.wa}WhatsApp</button>
        <button type="button" class="btn" id="rvMail">${ICON.mail}Email</button><button type="button" class="btn" id="rvPrint">${ICON.print}Print</button><button type="button" class="btn" id="rvPv">${ICON.search || ''}PDF preview</button></div>
      <div id="rvPrev"></div>`, el => {
      const prev = () => { const box = el.querySelector('#rvPrev'); box.innerHTML = H(); const v = box.querySelector('.vpaper'); if (v) { v.style.width = '760px'; v.style.zoom = Math.min(1, (box.clientWidth || 340) / 760); } };
      prev();
      const bal = () => docBal(d);
      bindShare(el, 'rv', () => ({html: H(), name: name(), phone: c.phone, email: c.email, subject: 'Payment receipt ' + rcNo(d, i), body: '',
        wa: `Dear ${c.contact || c.name || 'Customer'},\n\nThank you. We have received *${money(p.amount)}* on ${dfmt(p.date)} by ${p.method || 'payment'} against invoice ${d.number}.\n${bal() > 0.004 ? 'Balance remaining: ' + money(bal()) : 'This invoice is now fully paid.'}\n\nReceipt no. ${rcNo(d, i)}\n\n${S().name}`}), () => printHTML(H(), name()));
      el.querySelector('#rvMail').onclick = () => FitxMail.compose(FitxMail.specReceipt(d, i));
      el.querySelector('#rvPv').onclick = () => FitxMail.pdfPreview(H(), name());
      el.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => {
        S().rcptStyle = b.dataset.rv; save();
        el.querySelectorAll('[data-rv]').forEach(x => x.classList.toggle('on', x === b));
        prev();
        toast(on() ? 'Receipt voucher design – used for all receipts' : 'Standard receipt design');
      });
    });
  }
  const top = () => sheets[sheets.length - 1];
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id), el = top(); if (!d || !el || d.type !== 'INV') return;
    el.querySelectorAll('[data-delpay]').forEach(b => {
      const i = +b.dataset.delpay;
      const mailB = b.parentElement.querySelector('[data-rcpt]') || b;
      mailB.insertAdjacentHTML('beforebegin', `<button type="button" class="btn mailbtn" data-rview="${i}" aria-label="Receipt">${ICON.print}</button>`);
      b.parentElement.querySelector(`[data-rview="${i}"]`).onclick = () => receiptSheet(id, i);
    });
  };

  window.FitxVoucher = {on, html, forInvoice, forAdvance, amountWords, receiptSheet};
})();
