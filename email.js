/* FitX Accounts — email system.
   Sends straight from your Bluehost / cPanel mailbox (through a small mail script uploaded once to your hosting),
   or, when that is not set up, opens the phone / computer mail app with the PDF attached.
   Every email starts from an editable draft: quotation, invoice, payment receipt, payment reminder, statement,
   inspection report, work completion report, service reminder, supplier payment advice, payslip.
   HTML email: your message, a summary box, black/orange/white logo signature, PDFs attached. */
(function () {
  'use strict';
  const M = () => { const s = S(); s.mail = s.mail || {}; return s.mail; };
  const OR = '#ff6a00';
  const direct = () => (M().provider || (M().cpKey ? 'cpanel' : 'mailapp')) === 'cpanel' && !!(M().cpUrl && M().cpKey);
  const fromAddr = () => M().from || S().email || '';
  const okAddr = a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);
  const splitAddr = t => String(t || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);
  const esc2 = t => esc(t).replace(/\n/g, '<br>');

  /* ---------- drafts ---------- */
  const TPL = {
    quote: ['Quotation', 'Quotation {number}{re} | {company}', 'Dear {contact},\n\nThank you for your enquiry. Please find attached our quotation {number}{for}, valid until {due}.\n\nTo go ahead, simply reply to this email and we will schedule the work at your convenience.'],
    invoice: ['Invoice', 'Invoice {number}{re} | {company}', 'Dear {contact},\n\nThank you for choosing {company}. Please find attached invoice {number}{for}.\n\nWe would appreciate payment by {due}. Please let us know if you have any questions.'],
    receipt: ['Payment receipt', 'Payment received – {number} | {company}', 'Dear {contact},\n\nThank you for your payment of {amount} received on {date} by {method} against invoice {number}.\n\n{balance_line}\n\nWe appreciate your business.'],
    reminder: ['Payment reminder', 'Payment reminder – Invoice {number} | {company}', 'Dear {contact},\n\nThis is a friendly reminder that invoice {number} dated {date} for {total} {due_text}. The outstanding balance is {balance}.\n\nIf you have already paid, please ignore this message and accept our thanks. Otherwise we would be grateful if you could arrange payment at your earliest convenience.'],
    statement: ['Statement of account', 'Statement of account – {customer} | {company}', 'Dear {contact},\n\nPlease find attached your statement of account as of {today}.\n\nOutstanding balance: {balance}\n\n{open_list}\n\nPlease let us know if anything does not match your records.'],
    insp: ['Inspection report', 'Inspection report {number}{re} | {company}', 'Dear {contact},\n\nPlease find attached our inspection report {number}{for}, together with our findings and recommendations.\n\nPlease let us know if you would like us to proceed with the recommended work.'],
    wcr: ['Work completion report', 'Work completion report {number}{re} | {company}', 'Dear {contact},\n\nWe are pleased to confirm that the work{for} has been completed. Please find attached work completion report {number}.\n\nThank you for your business. Please let us know if you need anything else.'],
    service: ['Service reminder', 'Service reminder – {equipment} | {company}', 'Dear {contact},\n\nIt has been {period} since we serviced your {equipment} (invoice {number} on {date}).\n\nRegular servicing keeps your equipment safe and smooth and avoids costly breakdowns. Shall we book your next service visit? Simply reply to this email or call us on {phone}.'],
    advice: ['Supplier payment advice', 'Payment advice – {ref} | {company}', 'Dear {supplier},\n\nWe have paid {amount} on {date} by {method} against your invoice {ref} (our reference {number}).\n\n{balance_line}\n\nKindly confirm receipt.'],
    payslip: ['Payslip', 'Payslip {month} | {company}', 'Dear {employee},\n\nPlease find attached your payslip for {month}. Net pay: {net}.\n\nPlease let us know if you have any questions.'],
    so: ['Sales order', 'Sales order {number}{re} | {company}', 'Dear {contact},\n\nThank you for your order. Please find attached our sales order {number} confirming the work and prices{for}.\n\nPlanned delivery: {due}. Please check the details and let us know if anything needs to change.'],
    proforma: ['Proforma invoice', 'Proforma invoice {number} – {pct}% advance | {company}', 'Dear {contact},\n\nPlease find attached proforma invoice {number}{for}. To confirm the order and schedule the work, we kindly request an advance payment of {pct}%: {advance}.\n\nThe balance will be invoiced when the work is completed.'],
    advrcpt: ['Advance receipt', 'Advance received – {number} | {company}', 'Dear {contact},\n\nThank you. We have received your advance payment of {amount} on {date} by {method} against {number}.\n\nThis advance will be deducted from the final invoice when the work is completed.'],
    po: ['Purchase order', 'Purchase order {number} | {company}', 'Dear {supplier},\n\nPlease find attached our purchase order {number}. Kindly confirm the order, prices and delivery date ({due}).\n\nPlease quote our order number on your invoice and delivery note.']
  };
  const tpl = k => { const t = (M().tpl || {})[k] || {}; return {subject: t.subject || TPL[k][1], body: t.body || TPL[k][2]}; };
  function fill(text, v) { return String(text).replace(/\{(\w+)\}/g, (m0, k) => v[k] !== undefined && v[k] !== null ? String(v[k]) : m0).replace(/\n{3,}/g, '\n\n').trim(); }
  function baseVars(extra) {
    const s = S();
    return Object.assign({company: s.name, phone: s.phone, email: fromAddr(), web: s.web, pay_note: s.payNote || '', today: dfmt(today())}, extra);
  }
  const custVars = c => ({customer: c.name || 'Customer', contact: c.contact || c.name || 'Customer'});

  /* ---------- logo & signature ---------- */
  const LOGO_URL = 'https://fitxqa.github.io/fitx-accounts-web/icons/email-logo-badge2.png';
  let logoB64 = null;
  async function logoData() {
    if (logoB64) return logoB64;
    try { const r = await fetch('icons/email-logo-badge2.png'); const b = await r.blob(); logoB64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); }
    catch (e) { logoB64 = ''; }
    return logoB64;
  }
  function sigHTML(logoSrc) {
    const s = S(), m = M();
    const web = s.web ? (/^https?:/i.test(s.web) ? s.web : 'https://' + s.web) : '';
    const mail = m.from || s.email;
    const lab = t => `<span style="color:${OR};font-weight:bold;font-size:11px">${t}</span>&nbsp;`;
    const dot = '<span style="color:#cccccc">&nbsp;&nbsp;|&nbsp;&nbsp;</span>';
    const a = (href, t) => `<a href="${esc(href)}" style="color:#333333;text-decoration:none">${esc(t)}</a>`;
    const tel = [s.phone && lab('T') + a('tel:' + s.phone.replace(/\s+/g, ''), s.phone), m.mobile && lab('M') + a('tel:' + m.mobile.replace(/\s+/g, ''), m.mobile)].filter(Boolean).join(dot);
    const net = [mail && lab('E') + a('mailto:' + mail, mail), s.web && lab('W') + a(web, s.web.replace(/^https?:\/\//, ''))].filter(Boolean).join(dot);
    const foot = [s.address, s.cr && 'CR ' + s.cr].filter(Boolean).join(' · ');
    // fluid layout: logo and details side by side on wide screens, details drop under the logo on narrow phones
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#333333">
<div style="display:inline-block;vertical-align:middle;width:150px;min-width:150px;margin:0 18px 10px 0"><img src="${logoSrc || LOGO_URL}" width="150" height="68" alt="FitX Sports Equipment Services" style="display:block;width:150px;min-width:150px;max-width:150px;height:68px;border:0;outline:none"></div><div style="display:inline-block;vertical-align:middle;border-left:3px solid ${OR};padding:2px 0 2px 14px;margin:0 0 10px 0">
<div style="font-size:16px;line-height:1.25;font-weight:bold;color:#0d0d0d">${esc(m.name || s.name)}</div>
${m.title ? `<div style="font-size:11.5px;line-height:1.4;font-weight:bold;color:${OR};letter-spacing:.6px;text-transform:uppercase">${esc(m.title)}</div>` : ''}
${tel ? `<div style="margin-top:4px">${tel}</div>` : ''}${net ? `<div>${net}</div>` : ''}
${foot ? `<div style="font-size:11.5px;color:#999999">${esc(foot)}</div>` : ''}
</div></td></tr></table>`;
  }
  function textSig() {
    const s = S(), m = M(), L = [];
    if (m.name) L.push(m.name); if (m.title) L.push(m.title); L.push(s.name);
    L.push([s.phone && 'Tel: ' + s.phone, m.mobile && 'Mobile: ' + m.mobile].filter(Boolean).join(' | '));
    L.push([fromAddr(), s.web].filter(Boolean).join(' | '));
    if (s.address || s.cr) L.push([s.address, s.cr && 'CR No. ' + s.cr].filter(Boolean).join(' · '));
    return L.join('\n');
  }
  // used by the mail-app hand-off on Android (formatted version for apps that show HTML)
  function htmlBody(main) { return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#333333">${esc2(main)}<br><br>${sigHTML()}</div>`; }
  function emailHTML(msg, title, rows, attNames, logoSrc) {
    const row = r => `<tr><td style="padding:8px 14px;color:#666666;font-size:13px;border-bottom:1px solid #eeeeee">${esc(r[0])}</td><td style="padding:8px 14px;text-align:right;font-size:13px;border-bottom:1px solid #eeeeee;${r[2] ? 'font-weight:bold;color:' + OR + ';font-size:15px' : 'color:#0d0d0d'}">${esc(r[1])}</td></tr>`;
    const box = rows && rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e5e5;margin:18px 0"><tr><td colspan="2" style="background:#0d0d0d;color:#ffffff;padding:10px 14px;font-weight:bold;font-size:13px;letter-spacing:.5px;border-bottom:3px solid ${OR}">${esc(title.toUpperCase())}</td></tr>${rows.map(row).join('')}</table>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head><body style="margin:0;padding:0;background:#f4f4f4;-webkit-text-size-adjust:100%">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;width:100%;background:#ffffff;border-top:4px solid ${OR}">
<tr><td style="padding:22px 20px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.6">
${esc2(msg)}${box}
${attNames && attNames.length ? `<p style="margin:0 0 4px;font-size:13px;color:#555555">Attached: ${attNames.map(esc).join(', ')}</p>` : ''}
<p style="margin:22px 0 14px">${esc(M().signoff || 'Best regards,')}</p>
${sigHTML(logoSrc)}
</td></tr>
<tr><td style="padding:12px 28px 20px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999999;line-height:1.5;border-top:1px solid #eeeeee">This email and any attachments are confidential and intended only for the addressee.</td></tr>
</table></td></tr></table></body></html>`;
  }

  /* ---------- PDFs that are not invoices ---------- */
  function receiptHTML(d, i) {
    if (window.FitxVoucher && FitxVoucher.on()) return FitxVoucher.forInvoice(d, i);
    const p = d.payments[i], c = custById(d.customerId) || {}, bal = docBal(d);
    return reportPaper('Payment receipt', 'إيصال استلام', receiptNo(d, i) + ' · ' + dfmt(p.date), `
      <table class="eqt"><tbody>
        <tr><td><b>Received from</b></td><td>${esc(c.name || '')}${c.contact ? '<br>Attn: ' + esc(c.contact) : ''}</td></tr>
        <tr><td><b>Amount received</b></td><td style="font-size:18px;font-weight:800;color:${OR}">${money(p.amount)}</td></tr>
        <tr><td><b>Payment method</b></td><td>${esc(p.method || '')}${p.note ? ' · ' + esc(p.note) : ''}</td></tr>
        <tr><td><b>Date</b></td><td>${dfmt(p.date)}</td></tr>
        <tr><td><b>Against invoice</b></td><td>${esc(d.number)} dated ${dfmt(d.date)} – total ${money(docTotal(d))}</td></tr>
        <tr><td><b>Balance remaining</b></td><td>${bal > 0.004 ? money(bal) : 'Nil – invoice fully paid'}</td></tr>
      </tbody></table>
      <p style="margin-top:28px;font-size:12px">Thank you for your payment.</p>
      <div style="display:flex;justify-content:space-between;margin-top:46px;font-size:11px"><div>Received by ____________</div><div>${esc(S().name)}</div></div>`);
  }
  const receiptNo = (d, i) => 'RCT-' + String(d.number || '').replace(/^[A-Za-z]+-?/, '') + '-' + (i + 1);
  function adviceHTML(p, i) {
    const x = p.payments[i], sp = supById(p.supplierId) || {};
    return reportPaper('Payment advice', 'إشعار دفع', dfmt(x.date), `
      <table class="eqt"><tbody>
        <tr><td><b>Paid to</b></td><td>${esc(sp.name || '')}</td></tr>
        <tr><td><b>Amount paid</b></td><td style="font-size:18px;font-weight:800;color:${OR}">${money(x.amount)}</td></tr>
        <tr><td><b>Method</b></td><td>${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''}</td></tr>
        <tr><td><b>Date</b></td><td>${dfmt(x.date)}</td></tr>
        <tr><td><b>Your invoice</b></td><td>${esc(p.ref || '—')} · our ref ${esc(p.number)}</td></tr>
        <tr><td><b>Bill total</b></td><td>${money(purTotal(p))}${purWht(p) ? ` (withholding tax ${p.whtRate}%: ${money(purWht(p))})` : ''}</td></tr>
        <tr><td><b>Balance after this payment</b></td><td>${purBal(p) > 0.004 ? money(purBal(p)) : 'Nil – fully paid'}</td></tr>
      </tbody></table>`);
  }

  /* ---------- what each email contains ---------- */
  const forSubj = d => d.subject ? ' for ' + d.subject : '';
  const reSubj = d => d.subject ? ' – ' + d.subject : '';
  function specDoc(d) {
    const c = custById(d.customerId) || {}, isInv = d.type === 'INV';
    const R = isInv ? d.wcr : d.insp, rk = isInv ? 'wcr' : 'insp';
    const atts = [{name: d.number + ' - ' + (c.name || ''), html: () => docHTML(d)}];
    if (R && R.on) atts.push({name: repNo(d, rk) + ' - ' + (c.name || ''), html: () => reportHTML(d, rk), optional: true, label: isInv ? 'Work completion report' : 'Inspection report'});
    return {kind: isInv ? 'invoice' : 'quote', to: c.email, cust: c, rec: d, phone: c.phone,
      vars: baseVars(Object.assign(custVars(c), {number: d.number, date: dfmt(d.date), due: dfmt(d.due), total: money(docTotal(d)), balance: money(docBal(d)), re: reSubj(d), for: forSubj(d), subject: d.subject || ''})),
      title: isInv ? 'Invoice summary' : 'Quotation summary',
      rows: isInv ? [['Invoice no.', d.number], ['Date', dfmt(d.date)], ['Due date', dfmt(d.due)], ...(docPaid(d) ? [['Total', money(docTotal(d))], ['Paid', money(docPaid(d))]] : []), [docPaid(d) ? 'Balance due' : 'Amount due', money(docBal(d)), true]]
        : [['Quotation no.', d.number], ['Date', dfmt(d.date)], ['Valid until', dfmt(d.due)], ['Total amount', money(docTotal(d)), true]],
      extra: isInv && docBal(d) > 0.004 ? S().payNote : '', atts};
  }
  function specReport(d, kind) {
    const c = custById(d.customerId) || {}, R = (kind === 'insp' ? d.insp : d.wcr) || {};
    return {kind, to: c.email, cust: c, rec: d, phone: c.phone,
      vars: baseVars(Object.assign(custVars(c), {number: repNo(d, kind), date: dfmt(R.date || d.date), re: reSubj(d), for: forSubj(d)})),
      title: kind === 'insp' ? 'Inspection report' : 'Work completion', rows: [['Report no.', repNo(d, kind)], ['Date', dfmt(R.date || d.date)], ...(R.by ? [[kind === 'insp' ? 'Inspected by' : 'Technician', R.by]] : []), ['Ref', d.number]],
      atts: [{name: repNo(d, kind) + ' - ' + (c.name || ''), html: () => reportHTML(d, kind)}]};
  }
  function specReceipt(d, i) {
    const c = custById(d.customerId) || {}, p = d.payments[i], bal = docBal(d);
    return {kind: 'receipt', to: c.email, cust: c, rec: d, phone: c.phone,
      vars: baseVars(Object.assign(custVars(c), {number: d.number, amount: money(p.amount), date: dfmt(p.date), method: p.method || 'payment', balance: money(bal), balance_line: bal > 0.004 ? `The remaining balance on this invoice is ${money(bal)}.` : 'This invoice is now fully paid. Thank you!'})),
      title: 'Payment receipt', rows: [['Receipt no.', receiptNo(d, i)], ['Invoice', d.number], ['Date', dfmt(p.date)], ['Method', p.method || ''], ['Amount received', money(p.amount), true], ['Balance remaining', bal > 0.004 ? money(bal) : 'Nil']],
      atts: [{name: receiptNo(d, i) + ' - ' + (c.name || ''), html: () => receiptHTML(d, i)}, {name: d.number + ' - ' + (c.name || ''), html: () => docHTML(d), optional: true, off: true, label: 'Invoice'}]};
  }
  function specReminder(d) {
    const c = custById(d.customerId) || {}, late = d.due && d.due < today() ? daysBetween(d.due, today()) : 0;
    return {kind: 'reminder', to: c.email, cust: c, rec: d, phone: c.phone,
      vars: baseVars(Object.assign(custVars(c), {number: d.number, date: dfmt(d.date), due: dfmt(d.due), total: money(docTotal(d)), balance: money(docBal(d)), days: late, due_text: late ? `was due on ${dfmt(d.due)} (${late} day${late > 1 ? 's' : ''} ago)` : `is due on ${dfmt(d.due)}`})),
      title: 'Payment reminder', rows: [['Invoice no.', d.number], ['Invoice date', dfmt(d.date)], ['Due date', dfmt(d.due)], ...(late ? [['Days overdue', String(late)]] : []), ['Balance due', money(docBal(d)), true]],
      extra: S().payNote, atts: [{name: d.number + ' - ' + (c.name || ''), html: () => docHTML(d)}]};
  }
  function specStatement(cid) {
    const c = custById(cid) || {}, f = '2000-01-01', t = today();
    const L = custLedger(cid, f, t);
    const open = activeInvoices().filter(d => d.customerId === cid && docBal(d) > 0.004).sort((a, b) => a.date.localeCompare(b.date));
    const overdue = open.filter(d => d.due && d.due < today()).reduce((s, d) => s + docBal(d), 0);
    return {kind: 'statement', to: c.email, cust: c, rec: c, phone: c.phone,
      vars: baseVars(Object.assign(custVars(c), {balance: money(L.close), open_list: open.length ? 'Open invoices:\n' + open.map(d => `• ${d.number} dated ${dfmt(d.date)} – ${money(docBal(d))}${d.due && d.due < today() ? ' (overdue)' : ''}`).join('\n') : ''})),
      title: 'Account summary', rows: [['Statement date', dfmt(t)], ['Open invoices', String(open.length)], ...(overdue > 0.004 ? [['Overdue', money(overdue)]] : []), ['Balance due', money(L.close), true]],
      extra: L.close > 0.004 ? S().payNote : '', atts: [{name: 'Statement - ' + (c.name || ''), html: () => stmtPaper('cust', cid, f, t)}]};
  }
  function specAdvice(p, i) {
    const sp = supById(p.supplierId) || {}, x = p.payments[i];
    return {kind: 'advice', to: sp.email, cust: sp, rec: p, phone: sp.phone,
      vars: baseVars({supplier: sp.contact || sp.name || 'Sir / Madam', customer: sp.name, contact: sp.contact || sp.name, number: p.number, ref: p.ref || p.number, amount: money(x.amount), date: dfmt(x.date), method: x.method || 'bank transfer', balance_line: purBal(p) > 0.004 ? `The remaining balance is ${money(purBal(p))}.` : 'This settles the invoice in full.'}),
      title: 'Payment advice', rows: [['Your invoice', p.ref || '—'], ['Our reference', p.number], ['Date paid', dfmt(x.date)], ['Method', x.method || ''], ['Amount paid', money(x.amount), true]],
      atts: [{name: 'Payment advice ' + p.number, html: () => adviceHTML(p, i)}]};
  }
  function specService(r) {
    return {kind: 'service', to: r.c.email, cust: r.c, rec: r.d, phone: r.c.phone, onSent: () => { r.d.remSent = r.d.remSent || {}; r.d.remSent[r.m] = today(); },
      vars: baseVars(Object.assign(custVars(r.c), {period: r.m === 12 ? '1 year' : r.m === 1 ? '1 month' : r.m + ' months', equipment: r.equipment || 'gym equipment', number: r.d.number, date: dfmt(r.base || r.d.date)})),
      title: 'Service reminder', rows: [['Equipment', r.equipment || 'Gym equipment'], ['Last service', dfmt(r.base || r.d.date)], ['Service due', dfmt(r.due), true]], atts: []};
  }
  function specPayslip(run, l, e, html) {
    return {kind: 'payslip', to: e.email, cust: e, rec: run, phone: e.phone,
      vars: baseVars({employee: l.name, customer: l.name, contact: l.name, month: (window.FitxPayroll && FitxPayroll.monthLabel) ? FitxPayroll.monthLabel(run.month) : run.month, net: 'QAR ' + fmt(l.net)}),
      title: 'Payslip', rows: [['Employee', l.name], ['Pay period', run.month], ['Net pay', 'QAR ' + fmt(l.net), true]],
      atts: [{name: 'Payslip ' + l.name + ' ' + run.month, html}]};
  }

  /* ---------- send ---------- */
  async function sendDirect(sp, to, cc, subject, msg, atts) {
    const files = [];
    for (const a of atts) files.push({name: fileSafe(a.name) + '.pdf', type: 'application/pdf', data: await htmlToPdf(a.html())});
    const logo = await logoData();
    const html = emailHTML(msg + (sp.extra ? '\n\n' + sp.extra : ''), sp.title, sp.rows, files.map(f => f.name), logo ? 'cid:fitxlogo' : '');
    const text = msg + (sp.extra ? '\n\n' + sp.extra : '') + '\n\n' + (M().signoff || 'Best regards,') + '\n' + textSig();
    const body = {key: M().cpKey, to, cc, subject, html, text, fromName: S().name, copy: M().copySelf !== false, attachments: files.concat(logo ? [{name: 'logo.png', type: 'image/png', data: logo, cid: 'fitxlogo'}] : [])};
    let res;
    try { res = await fetch(M().cpUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(body)}); }
    catch (e) { throw new Error('Could not reach your mail script (' + M().cpUrl + '). Check the internet connection.'); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Mail server error ' + res.status);
    if (j.note) setTimeout(() => toast(j.note), 1500);
  }
  function logSent(sp, to) {
    const r = sp.rec; if (r) { r.mails = r.mails || []; r.mails.push({date: today(), at: Date.now(), to: to.join(', '), kind: sp.kind}); if (r.mails.length > 30) r.mails.splice(0, r.mails.length - 30); }
    if (sp.onSent) sp.onSent();
    save();
  }
  async function viaMailApp(sp, to, subject, msg, atts) {
    const a = atts[0];
    const main = msg + (sp.extra ? '\n\n' + sp.extra : '') + '\n\n' + (M().signoff || 'Best regards,');
    const body = M().textSig === false ? main : main + '\n' + textSig();
    if (!a) { openLink(`mailto:${encodeURIComponent(to.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`); return; }
    await sendPdf({html: a.html(), name: a.name, email: to.join(','), subject, body, main}, 'email');
  }

  /* ---------- compose screen ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .pvz{position:relative;overflow:auto;height:calc(100vh - 215px);min-height:320px;background:#e9eaed;border-radius:12px;padding:12px;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    .pvbar{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}
    .sheet.pvfull .sb{padding:8px 8px 0}
    .sheet.pvfull .pvz{height:calc(100vh - 128px);border-radius:10px}
    .pvbar .btn{min-height:38px;min-width:44px;padding:0 12px;justify-content:center}
    .pvbar .zl{min-width:58px;text-align:center;font-weight:800;font-size:14px}
    .pvw{display:grid;gap:14px;justify-items:center;margin:0 auto}
    .pvw .pg{width:100%;aspect-ratio:1/1.4142;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18);position:relative;overflow:hidden}
    .pvw .pg img{position:absolute;left:0;width:100%}
    .pvw .pn{font-size:12px;color:var(--muted)}
    .mailfrom{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:12px;background:var(--orange-l,#fff1e7);margin-bottom:12px;font-size:14px}
    .mailatt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);margin-bottom:8px}
    .mailatt .nm{flex:1;min-width:0;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mailatt input{width:20px;height:20px;flex-shrink:0}
    .mailatt svg{width:22px;height:22px;flex-shrink:0;color:var(--orange)}
    .mailbtn svg{width:18px;height:18px}
    .mailprev{width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#f4f4f4}
    .sigbox{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;overflow-x:auto}
    .mshelp{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0;background:var(--card)}
    .mshelp summary{font-weight:700;cursor:pointer}
    .mshelp ol,.mshelp ul{padding-left:20px;line-height:1.65;margin:8px 0 0}
    label.ck{display:flex;gap:10px;align-items:flex-start;margin:8px 0}
    label.ck input{width:20px;height:20px;flex-shrink:0;margin-top:2px}
    .tplph{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 10px}
    .tplph button{border:1px solid var(--line2);background:var(--card);border-radius:999px;padding:3px 9px;font-size:12px;color:var(--text)}
    .mailbtn{min-width:40px;padding:0 10px}
    body.role-tech #mMail,body.role-tech #mPayRem{display:none!important}`;
  document.head.appendChild(css);

  function compose(sp) {
    const t = tpl(sp.kind), d0 = direct();
    const subject0 = fill(t.subject, sp.vars), msg0 = fill(t.body, sp.vars);
    const name = TPL[sp.kind][0];
    openSheet('Email · ' + name, `
      <div class="mailfrom"><span>${d0 ? `From: <b>${esc(fromAddr())}</b>` : 'Opens your mail app with the PDF attached'}</span><span class="badge ${d0 ? 'b-green' : 'b-grey'}">${d0 ? 'Bluehost' : 'Mail app'}</span></div>
      <form id="mlForm" autocomplete="off">
        <label class="f"><span>To</span><input class="in" name="to" inputmode="email" value="${esc(sp.to || '')}" placeholder="name@company.com" required></label>
        ${d0 ? `<label class="f"><span>Cc (optional)</span><input class="in" name="cc" inputmode="email" value="${esc(M().cc || '')}" placeholder="separate with commas"></label>` : ''}
        <label class="f"><span>Subject</span><input class="in" name="subject" value="${esc(subject0)}" required></label>
        <label class="f"><span>Message</span><textarea class="in" name="msg" rows="9">${esc(msg0)}</textarea></label>
        ${sp.atts.length ? `<div class="sec"><h2>Attachments</h2></div>${sp.atts.map((a, i) => `<label class="mailatt">${a.optional && d0 ? `<input type="checkbox" data-att="${i}" ${a.off ? '' : 'checked'}>` : ICON.inv}<span class="nm">${esc(a.name)}.pdf${a.label ? ' · ' + esc(a.label) : ''}</span><button type="button" class="btn" data-pv="${i}" style="min-height:34px;padding:4px 10px">Preview</button></label>`).join('')}${!d0 && sp.atts.length > 1 ? '<p class="hint">The mail app attaches the first file only.</p>' : ''}` : ''}
        ${sp.cust && !sp.cust.email && sp.cust.id ? `<label class="ck"><input type="checkbox" name="saveMail" checked><span>Save this email address to ${esc(sp.cust.name || 'the contact')}</span></label>` : ''}
        <div class="btns" style="margin-top:8px">${d0 ? `<button type="button" class="btn" id="mlLook">Preview email</button>` : `<button type="button" class="btn" id="mlSetup">Set up direct sending</button>`}<button type="submit" class="btn pri" id="mlSend">${ICON.mail}${d0 ? 'Send email' : 'Open mail app'}</button></div>
        <p class="hint" style="margin-top:8px">Change the standard wording in Menu → Email settings → Email drafts.</p>
      </form>`, el => {
      const pick = () => sp.atts.filter((a, i) => { const cb = el.querySelector(`[data-att="${i}"]`); return cb ? cb.checked : !(a.optional && a.off && d0); });
      el.querySelectorAll('[data-pv]').forEach(b => b.onclick = ev => { ev.preventDefault(); const a = sp.atts[+b.dataset.pv]; pdfPreview(a.html(), a.name); });
      const su = el.querySelector('#mlSetup'); if (su) su.onclick = () => settings();
      const lk = el.querySelector('#mlLook'); if (lk) lk.onclick = async () => {
        const v = formData(el.querySelector('#mlForm'));
        const html = emailHTML(v.msg + (sp.extra ? '\n\n' + sp.extra : ''), sp.title, sp.rows, pick().map(a => fileSafe(a.name) + '.pdf'), 'icons/email-logo-badge2.png');
        openSheet('Email preview', `<p class="hint" style="margin-top:0"><b>To:</b> ${esc(v.to)}${v.cc ? ' · <b>Cc:</b> ' + esc(v.cc) : ''}<br><b>Subject:</b> ${esc(v.subject)}</p><iframe class="mailprev" title="Email preview" sandbox="allow-same-origin"></iframe>`, e2 => { const fr = e2.querySelector('iframe'); fr.onload = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (e) {} }; fr.srcdoc = html; });
      };
      el.querySelector('#mlForm').onsubmit = async ev => {
        ev.preventDefault();
        const v = formData(ev.target);
        const to = splitAddr(v.to), cc = splitAddr(v.cc);
        const bad = to.concat(cc).find(a => !okAddr(a)); if (bad) { toast('Check the email address: ' + bad); return; }
        if (!to.length) { toast('Enter the email address'); return; }
        if (v.saveMail && sp.cust && !sp.cust.email) { sp.cust.email = to[0]; save(); }
        const btn = el.querySelector('#mlSend'); btn.disabled = true;
        try {
          if (d0) {
            btn.textContent = 'Sending…';
            await sendDirect(sp, to, cc, v.subject, v.msg, pick());
            logSent(sp, to);
            closeSheet(() => toast('Email sent to ' + to.join(', ')));
          } else {
            await viaMailApp(sp, to, v.subject, v.msg, pick());
            logSent(sp, to);
            closeSheet();
          }
        } catch (e) { toast(e.message || String(e)); btn.disabled = false; btn.innerHTML = ICON.mail + (d0 ? 'Send email' : 'Open mail app'); }
      };
    });
  }

  /* ---------- PDF preview ---------- */
  // zoom for the PDF preview: pinch, double-tap, buttons, Ctrl + wheel
  function bindZoom(box, pages, lvl, bIn, bOut, bFit) {
    let scale = 1;
    const baseW = () => Math.min(box.clientWidth - 24, 680);
    const apply = (ns, cx, cy) => {
      ns = Math.max(1, Math.min(5, ns));
      if (cx === undefined) { cx = box.clientWidth / 2; cy = box.clientHeight / 2; }
      const px = (box.scrollLeft + cx) / scale, py = (box.scrollTop + cy) / scale;
      scale = ns;
      pages.style.width = Math.round(baseW() * scale) + 'px';
      box.scrollLeft = px * scale - cx; box.scrollTop = py * scale - cy;
      lvl.textContent = Math.round(scale * 100) + '%';
    };
    apply(1);
    window.addEventListener('resize', () => apply(scale));
    bIn.onclick = () => apply(scale * 1.25);
    bOut.onclick = () => apply(scale / 1.25);
    bFit.onclick = () => { apply(1); box.scrollTop = 0; box.scrollLeft = 0; };
    const pt = (t, r) => ({x: t.clientX - r.left, y: t.clientY - r.top});
    let pinch = null, lastTap = 0;
    box.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const r = box.getBoundingClientRect(), a = pt(e.touches[0], r), b = pt(e.touches[1], r);
        pinch = {d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: scale};
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) { const r = box.getBoundingClientRect(), p = pt(e.touches[0], r); apply(scale > 1.2 ? 1 : 2.5, p.x, p.y); e.preventDefault(); lastTap = 0; }
        else lastTap = now;
      }
    }, {passive: false});
    box.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const r = box.getBoundingClientRect(), a = pt(e.touches[0], r), b = pt(e.touches[1], r);
      apply(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }, {passive: false});
    box.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
    box.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = box.getBoundingClientRect(); apply(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); }, {passive: false});
    box.addEventListener('dblclick', e => { const r = box.getBoundingClientRect(); apply(scale > 1.2 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top); });
  }
  const pagesHTML = r => r.pages.map((p, i) => `<div class="pg"><img src="${p.src}" alt="Page ${i + 1}" style="top:${(p.top * 100).toFixed(3)}%;height:${(p.h * 100).toFixed(3)}%"></div><div class="pn">Page ${i + 1} of ${r.pages.length}</div>`).join('');
  const zoomBar = full => `<div class="pvbar"><button type="button" class="btn" data-z="out" aria-label="Zoom out">−</button><span class="zl">100%</span><button type="button" class="btn" data-z="in" aria-label="Zoom in">+</button><button type="button" class="btn" data-z="fit">Fit</button>
    <span style="margin-left:auto">${full ? `<button type="button" class="btn" data-z="print">${ICON.print}Print</button>` : `<button type="button" class="btn" data-z="full" aria-label="Full screen">⛶ Full</button>`}</span></div>`;
  async function pdfPreview(html, name) {
    toast('Preparing preview…');
    let r; try { r = await htmlToPdf(html, {pages: true}); } catch (e) { toast('Could not make the PDF: ' + e.message); return; }
    const kb = Math.round(r.b64.length * 3 / 4 / 1024);
    const fn = fileSafe(name) + '.pdf', AB = window.AndroidBridge;
    const out = how => {
      if (AB && AB.shareFile) { if (how === 'save') AB.saveFile(r.b64, 'application/pdf', fn); else AB.shareFile(r.b64, 'application/pdf', fn, ''); return; }
      const blob = b64ToBlob(r.b64, 'application/pdf');
      if (how === 'share' && navigator.canShare) { const f = new File([blob], fn, {type: 'application/pdf'}); if (navigator.canShare({files: [f]})) { navigator.share({files: [f], title: name}).catch(() => {}); return; } }
      downloadBlob(blob, fn);
    };
    const print = () => printHTML(html, name);
    const wire = (el, full) => {
      const q = k => el.querySelector(`[data-z="${k}"]`);
      bindZoom(el.querySelector('.pvz'), el.querySelector('.pvw'), el.querySelector('.zl'), q('in'), q('out'), q('fit'));
      (q('print') || el.querySelector('#pvPrint')).onclick = print;
      if (q('full')) q('full').onclick = openFull;
    };
    function openFull() {
      openSheet(name, `${zoomBar(true)}<div class="pvz"><div class="pvw">${pagesHTML(r)}</div></div>`, el => { el.classList.add('pvfull'); wire(el, true); });
    }
    openSheet('PDF preview', `<div class="btns" style="margin-bottom:10px;grid-template-columns:repeat(3,minmax(0,1fr))"><button type="button" class="btn pri" id="pvShare">${ICON.share}Share</button><button type="button" class="btn" id="pvSave">${ICON.dl}Save</button><button type="button" class="btn" id="pvPrint">${ICON.print}Print</button></div>
      <p class="hint" style="margin:-4px 2px 8px">${esc(name)}.pdf · ${r.pages.length} page${r.pages.length > 1 ? 's' : ''} · ${kb} KB · pinch or double-tap to zoom</p>
      ${zoomBar(false)}<div class="pvz"><div class="pvw">${pagesHTML(r)}</div></div>`, el => {
      wire(el, false);
      el.querySelector('#pvShare').onclick = () => out('share');
      el.querySelector('#pvSave').onclick = () => out('save');
    });
  }

  /* ---------- payment reminders for all overdue customers ---------- */
  function overdueCustomers() {
    const m = {};
    activeInvoices().forEach(d => { if (docBal(d) > 0.004 && d.due && d.due < today()) { const o = m[d.customerId] = m[d.customerId] || {c: custById(d.customerId) || {id: d.customerId, name: '—'}, amt: 0, n: 0, oldest: d.due}; o.amt += docBal(d); o.n++; if (d.due < o.oldest) o.oldest = d.due; } });
    return Object.values(m).sort((a, b) => b.amt - a.amt);
  }
  function viewPaymentReminders() {
    const list = overdueCustomers(), d0 = direct();
    openSheet('Payment reminders', `
      ${KP([['Customers overdue', String(list.length), list.length ? 'var(--red)' : '', true], ['Overdue amount', fmt(list.reduce((s, o) => s + o.amt, 0)), 'var(--red)']])}
      <p class="hint">Each customer gets their statement of account with all open invoices${d0 ? ', sent from ' + esc(fromAddr()) : ''}.</p>
      ${list.length ? `<div class="list">${list.map((o, i) => `<div class="item"><label style="display:flex;gap:10px;align-items:center;flex:1;min-width:0">${d0 ? `<input type="checkbox" data-pr="${i}" ${o.c.email ? 'checked' : 'disabled'} style="width:20px;height:20px">` : ''}<div class="main"><div class="t">${esc(o.c.name)}</div><div class="s">${o.n} invoice${o.n > 1 ? 's' : ''} · oldest due ${dfmt(o.oldest)} (${daysBetween(o.oldest, today())} days)${o.c.email ? ' · ' + esc(o.c.email) : ' · <b style="color:var(--red)">no email</b>'}${o.c.lastReminder ? ' · last reminder ' + dfmt(o.c.lastReminder) : ''}</div></div></label><div class="r" style="display:flex;gap:6px;align-items:center"><div class="amt">${fmt(o.amt)}</div><button type="button" class="btn mailbtn" data-one="${i}" aria-label="Email ${esc(o.c.name)}">${ICON.mail}</button></div></div>`).join('')}</div>` : '<div class="list"><div class="empty">No overdue invoices. 👍</div></div>'}
      ${list.length && d0 ? `<button type="button" class="btn pri full" id="prAll" style="margin-top:12px">${ICON.mail}Send reminders to selected</button>` : ''}
      ${!d0 && list.length ? `<p class="hint" style="margin-top:12px">Tip: set up direct sending (Menu → Email settings) to send all reminders with one tap.</p>` : ''}`, el => {
      el.querySelectorAll('[data-one]').forEach(b => b.onclick = () => { const o = list[+b.dataset.one]; const sp = specStatement(o.c.id); sp.kind = 'statement'; sp.onSent = () => { o.c.lastReminder = today(); }; compose(sp); });
      const all = el.querySelector('#prAll'); if (all) all.onclick = async () => {
        const pick = list.filter((o, i) => { const cb = el.querySelector(`[data-pr="${i}"]`); return cb && cb.checked; });
        if (!pick.length) { toast('Select customers with an email address'); return; }
        if (!confirm(`Send statement reminders to ${pick.length} customer(s)?`)) return;
        all.disabled = true; let ok = 0, fail = [];
        for (const o of pick) {
          all.textContent = `Sending ${ok + fail.length + 1} of ${pick.length}…`;
          const sp = specStatement(o.c.id), t = tpl('statement');
          try { await sendDirect(sp, [o.c.email], splitAddr(M().cc), fill(t.subject, sp.vars), fill(t.body, sp.vars), sp.atts); o.c.lastReminder = today(); logSent(sp, [o.c.email]); ok++; }
          catch (e) { fail.push(o.c.name + ': ' + e.message); }
        }
        save();
        closeSheet(() => { toast(`${ok} reminder${ok === 1 ? '' : 's'} sent` + (fail.length ? ` · ${fail.length} failed` : '')); if (fail.length) setTimeout(() => alert('Not sent:\n' + fail.join('\n')), 300); });
      };
    });
  }

  /* ---------- settings: sending, signature, drafts ---------- */
  const phpStr = v => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  // o: {key, from, name, mode: 'local'|'smtp', imapPass, smtpHost, smtpPort, smtpUser, smtpPass}
  function phpScript(o) {
    return String.raw`<?php
/* FitX Accounts – email sender. Upload to public_html with cPanel File Manager. Created ${today()}.
   Mode: ${o.mode === 'smtp' ? 'SMTP (' + o.smtpHost + ')' : 'Bluehost / cPanel mail'}.
   Keep this file private: the key below lets the FitX app send email from ${o.from}. */
$KEY       = '${phpStr(o.key)}';
$FROM      = '${phpStr(o.from)}';
$FROM_NAME = '${phpStr(o.name)}';
$MODE      = '${o.mode === 'smtp' ? 'smtp' : 'local'}';
$SMTP_HOST = '${phpStr(o.smtpHost)}';
$SMTP_PORT = ${Number(o.smtpPort) || 465};
$SMTP_USER = '${phpStr(o.smtpUser)}';
$SMTP_PASS = '${phpStr(o.smtpPass)}';
$IMAP_PASS = '${phpStr(o.imapPass)}';   // optional (cPanel mode): keeps a copy of each email in "Sent"
$ALLOWED_ORIGINS = array('https://fitxqa.github.io', 'https://appassets.androidplatform.net');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
function reply($code, $data) { http_response_code($code); echo json_encode($data); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(200, array('ok' => true, 'msg' => 'FitX mail script is installed. Send email from the FitX Accounts app.'));

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in) || !isset($in['key']) || !hash_equals($KEY, (string)$in['key'])) reply(403, array('ok' => false, 'error' => 'Wrong key. In the app, create the mail script again and upload the new file.'));
if (isset($in['action']) && $in['action'] === 'ping') reply(200, array('ok' => true, 'php' => PHP_VERSION, 'from' => $FROM, 'mode' => $MODE, 'sent_copy' => ($MODE === 'smtp' || ($IMAP_PASS !== '' && function_exists('imap_open') && !file_exists(__DIR__ . '/.fitx-mail-sent-off'))), 'sent_copy_off' => file_exists(__DIR__ . '/.fitx-mail-sent-off')));

function clean_list($v) { $out = array(); foreach ((array)$v as $a) { $a = trim(str_replace(array("\r", "\n"), '', (string)$a)); if (filter_var($a, FILTER_VALIDATE_EMAIL)) $out[] = $a; } return $out; }
function hdr($s) { return '=?UTF-8?B?' . base64_encode(str_replace(array("\r", "\n"), ' ', (string)$s)) . '?='; }
function b64($s) { $s = preg_replace('/[^A-Za-z0-9+\/=]/', '', (string)$s); return base64_decode($s, true) === false ? '' : $s; }
function fname($s) { $s = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string)$s); return $s === '' ? 'file' : $s; }
function ctype($s) { return preg_match('#^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$#', (string)$s) ? $s : 'application/octet-stream'; }

function smtp_send($host, $port, $user, $pass, $from, $rcpts, $data, &$err) {
  $ctx = stream_context_create(array('ssl' => array('verify_peer' => true, 'verify_peer_name' => true)));
  $fp = @stream_socket_client(($port == 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port, $en, $es, 20, STREAM_CLIENT_CONNECT, $ctx);
  if (!$fp) { $err = "Cannot connect to $host:$port ($es). Your hosting may block outgoing mail connections."; return false; }
  stream_set_timeout($fp, 30);
  $read = function () use ($fp) { $r = ''; while (($l = fgets($fp, 515)) !== false) { $r .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $r; };
  $cmd = function ($c, $ok) use ($fp, $read, &$err) { if ($c !== null) fwrite($fp, $c . "\r\n"); $r = $read(); if (!in_array((int)substr($r, 0, 3), (array)$ok, true)) { $err = trim($r) ?: 'No reply from mail server'; return false; } return true; };
  $me = 'fitx-accounts.local';
  if (!$cmd(null, 220) || !$cmd("EHLO $me", 250)) { fclose($fp); return false; }
  if ($port != 465) {
    if (!$cmd('STARTTLS', 220) || !stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) || !$cmd("EHLO $me", 250)) { $err = 'Secure connection failed: ' . $err; fclose($fp); return false; }
  }
  if (!$cmd('AUTH LOGIN', 334) || !$cmd(base64_encode($user), 334) || !$cmd(base64_encode($pass), 235)) { $err = 'Login refused – check the email and app password. ' . $err; fclose($fp); return false; }
  if (!$cmd("MAIL FROM:<$from>", 250)) { fclose($fp); return false; }
  foreach ($rcpts as $r) { if (!$cmd("RCPT TO:<$r>", array(250, 251))) { fclose($fp); return false; } }
  if (!$cmd('DATA', 354)) { fclose($fp); return false; }
  fwrite($fp, preg_replace('/^\./m', '..', $data) . "\r\n.\r\n");
  if (!$cmd(null, 250)) { fclose($fp); return false; }
  $cmd('QUIT', 221); fclose($fp); return true;
}

$to = clean_list(isset($in['to']) ? $in['to'] : array());
$cc = clean_list(isset($in['cc']) ? $in['cc'] : array());
if (!$to) reply(400, array('ok' => false, 'error' => 'No valid email address to send to.'));
if (count($to) + count($cc) > 10) reply(400, array('ok' => false, 'error' => 'Too many recipients.'));
$subject = hdr(isset($in['subject']) ? $in['subject'] : '');
$html = isset($in['html']) ? (string)$in['html'] : '';
$text = isset($in['text']) ? (string)$in['text'] : strip_tags($html);
$fromName = (isset($in['fromName']) && $in['fromName'] !== '') ? $in['fromName'] : $FROM_NAME;
$atts = (isset($in['attachments']) && is_array($in['attachments'])) ? $in['attachments'] : array();
$copy = !empty($in['copy']);

$e = "\r\n";
$b1 = 'fx1_' . bin2hex(random_bytes(8)); $b2 = 'fx2_' . bin2hex(random_bytes(8)); $b3 = 'fx3_' . bin2hex(random_bytes(8));
$body  = "--$b1{$e}Content-Type: multipart/related; boundary=\"$b2\"{$e}{$e}";
$body .= "--$b2{$e}Content-Type: multipart/alternative; boundary=\"$b3\"{$e}{$e}";
$body .= "--$b3{$e}Content-Type: text/plain; charset=UTF-8{$e}Content-Transfer-Encoding: base64{$e}{$e}" . chunk_split(base64_encode($text));
$body .= "--$b3{$e}Content-Type: text/html; charset=UTF-8{$e}Content-Transfer-Encoding: base64{$e}{$e}" . chunk_split(base64_encode($html));
$body .= "--$b3--{$e}";
foreach ($atts as $a) { if (empty($a['cid'])) continue; $d = b64(isset($a['data']) ? $a['data'] : ''); if ($d === '') continue; $n = fname($a['name']);
  $body .= "--$b2{$e}Content-Type: " . ctype($a['type']) . "; name=\"$n\"{$e}Content-Transfer-Encoding: base64{$e}Content-ID: <" . fname($a['cid']) . ">{$e}Content-Disposition: inline; filename=\"$n\"{$e}{$e}" . chunk_split($d); }
$body .= "--$b2--{$e}";
foreach ($atts as $a) { if (!empty($a['cid'])) continue; $d = b64(isset($a['data']) ? $a['data'] : ''); if ($d === '') continue; $n = fname($a['name']);
  $body .= "--$b1{$e}Content-Type: " . ctype($a['type']) . "; name=\"$n\"{$e}Content-Transfer-Encoding: base64{$e}Content-Disposition: attachment; filename=\"$n\"{$e}{$e}" . chunk_split($d); }
$body .= "--$b1--";

$headers = array('From: ' . hdr($fromName) . " <$FROM>", "Reply-To: $FROM", 'MIME-Version: 1.0', "Content-Type: multipart/mixed; boundary=\"$b1\"", 'X-Mailer: FitX Accounts');
if ($cc) $headers[] = 'Cc: ' . implode(', ', $cc);

if ($MODE === 'smtp') {
  $domain = substr(strrchr($FROM, '@'), 1);
  $msg = 'Date: ' . date('r') . $e . 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>' . $e . 'To: ' . implode(', ', $to) . $e . "Subject: $subject" . $e . implode($e, $headers) . $e . $e . $body;
  $err = '';
  if (!smtp_send($SMTP_HOST, $SMTP_PORT, $SMTP_USER, $SMTP_PASS, $FROM, array_merge($to, $cc), $msg, $err)) reply(502, array('ok' => false, 'error' => $err));
  reply(200, array('ok' => true, 'to' => $to, 'saved_to_sent' => true));
}

// copy to "Sent" logs in ONCE per email; after a failed login it stops trying for good (no lock-outs)
$LOCK = __DIR__ . '/.fitx-mail-sent-off';
$imapOk = ($IMAP_PASS !== '' && function_exists('imap_open') && !file_exists($LOCK));
$send = $headers; if ($copy && !$imapOk) $send[] = "Bcc: $FROM";
if (!mail(implode(', ', $to), $subject, $body, implode("\r\n", $send), '-f' . $FROM)) reply(500, array('ok' => false, 'error' => 'The mail server did not accept the email. Check that ' . $FROM . ' exists in cPanel → Email Accounts.'));
$saved = false; $note = '';
if ($copy && $imapOk) {
  $msg = 'Date: ' . date('r') . $e . 'To: ' . implode(', ', $to) . $e . "Subject: $subject" . $e . implode($e, $headers) . $e . $e . $body;
  $srv = '{localhost:993/imap/ssl/novalidate-cert}';
  $im = @imap_open($srv, $FROM, $IMAP_PASS, OP_HALFOPEN, 0);
  if (!$im) {
    @file_put_contents($LOCK, date('c') . ' login failed – copies to Sent switched off');
    $note = 'Email sent, but the password in the mail script is wrong, so no copy was saved in Sent. Copies to Sent are now switched off – create the script again with the right password (or no password).';
  } else {
    foreach (array('INBOX.Sent', 'Sent', 'INBOX.Sent Items') as $box) { if (@imap_append($im, $srv . $box, $msg, '\\Seen')) { $saved = true; break; } }
    @imap_close($im);
  }
  @imap_errors(); @imap_alerts();
}
reply(200, array('ok' => true, 'to' => $to, 'saved_to_sent' => $saved, 'note' => $note));
`;
  }

  const PH = {
    quote: ['customer', 'contact', 'number', 'date', 'due', 'total', 'subject', 'for', 're'],
    invoice: ['customer', 'contact', 'number', 'date', 'due', 'total', 'balance', 'subject', 'for', 're'],
    receipt: ['customer', 'contact', 'number', 'amount', 'date', 'method', 'balance', 'balance_line'],
    reminder: ['customer', 'contact', 'number', 'date', 'due', 'days', 'total', 'balance', 'due_text'],
    statement: ['customer', 'contact', 'balance', 'open_list', 'today'],
    insp: ['customer', 'contact', 'number', 'date', 'for', 're'],
    wcr: ['customer', 'contact', 'number', 'date', 'for', 're'],
    service: ['customer', 'contact', 'equipment', 'period', 'number', 'date'],
    advice: ['supplier', 'number', 'ref', 'amount', 'date', 'method', 'balance_line'],
    payslip: ['employee', 'month', 'net'],
    so: ['customer', 'contact', 'number', 'date', 'due', 'total', 'for', 're'],
    proforma: ['customer', 'contact', 'number', 'pct', 'advance', 'total', 'for'],
    advrcpt: ['customer', 'contact', 'number', 'amount', 'date', 'method'],
    po: ['supplier', 'number', 'date', 'due', 'total']
  };
  function editTpl(k) {
    const t = tpl(k);
    openSheet('Draft · ' + TPL[k][0], `<form id="tpForm">
      <label class="f"><span>Subject</span><input class="in" name="subject" value="${esc(t.subject)}"></label>
      <label class="f"><span>Message</span><textarea class="in" name="body" rows="11">${esc(t.body)}</textarea></label>
      <div class="hint" style="margin:-4px 0 6px">Tap to insert:</div>
      <div class="tplph">${PH[k].concat(['company', 'phone', 'email', 'web', 'pay_note']).map(p => `<button type="button" data-ph="${p}">{${p}}</button>`).join('')}</div>
      <p class="hint">The summary box, attachments, sign-off and logo signature are added automatically.</p>
      <div class="btns"><button type="button" class="btn" id="tpReset">Reset to standard</button><button type="submit" class="btn pri">Save draft</button></div></form>`, el => {
      const body = el.querySelector('[name=body]'); let last = body;
      el.querySelectorAll('input,textarea').forEach(x => x.addEventListener('focus', () => { last = x; }));
      el.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { const s0 = last.selectionStart || last.value.length; last.value = last.value.slice(0, s0) + '{' + b.dataset.ph + '}' + last.value.slice(last.selectionEnd || s0); last.focus(); });
      el.querySelector('#tpReset').onclick = () => { el.querySelector('[name=subject]').value = TPL[k][1]; body.value = TPL[k][2]; };
      el.querySelector('#tpForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target); const m = M(); m.tpl = m.tpl || {};
        if (v.subject.trim() === TPL[k][1] && v.body.trim() === TPL[k][2]) delete m.tpl[k]; else m.tpl[k] = {subject: v.subject.trim(), body: v.body.trim()};
        save(); closeSheet(() => { toast('Draft saved'); const l = document.querySelector(`[data-tpk="${k}"] .s`); if (l) l.textContent = fill(tpl(k).subject, {}); });
      };
    });
  }
  function settings() {
    const m = M();
    let prov = m.provider || (m.cpKey ? 'cpanel' : 'mailapp');
    openSheet('Email settings', `<form id="msForm" autocomplete="off">
      <div class="chips" style="margin-bottom:10px" id="msProv"><button type="button" data-prov="cpanel">Send from Bluehost (cPanel)</button><button type="button" data-prov="mailapp">Phone mail app</button></div>
      <div class="mailfrom"><span id="msStat">…</span><button type="button" class="btn" id="msTest" style="min-height:36px;padding:4px 12px">Test</button></div>
      <label class="f"><span>Your email address</span><input class="in" name="from" type="email" value="${esc(m.from || 'sales@fitx.qa')}"></label>
      <div data-for="cpanel">
        <label class="f"><span>Mail script address</span><input class="in" name="cpUrl" type="url" value="${esc(m.cpUrl || 'https://fitx.qa/fitx-mail.php')}"></label>
        <label class="f"><span>Email password <small style="color:var(--muted)">(optional – keeps a copy in Sent; goes into the script only)</small></span><input class="in" name="cpPass" type="password" autocomplete="new-password"></label>
        <button type="button" class="btn pri full" id="cpMake">${ICON.dl}Create mail script (fitx-mail.php)</button>
        <details class="mshelp" ${m.cpKey ? '' : 'open'}><summary>How to set up (one time, 3 minutes)</summary><ol>
          <li>Check that the address above exists in <b>cPanel → Email Accounts</b>.</li>
          <li>Tap <b>Create mail script</b> – fitx-mail.php is saved to your downloads.</li>
          <li><b>Bluehost → cPanel → File Manager → public_html → Upload</b> the file.</li>
          <li>Tap <b>Save</b>, then <b>Test</b> – a test email arrives in your inbox.</li>
        </ol><p class="hint">The script on your hosting sends the emails, from the phone app and the web version. Your password never stays in the app.</p></details>
        <label class="f"><span>Always Cc (optional)</span><input class="in" name="cc" value="${esc(m.cc || '')}" placeholder="e.g. accounts@fitx.qa"></label>
        <label class="ck"><input type="checkbox" name="copySelf" ${m.copySelf !== false ? 'checked' : ''}><span>Keep a copy of every email (in Sent, or in your inbox)</span></label>
      </div>
      <div data-for="mailapp"><p class="hint" style="margin:0 0 10px">Emails open in your mail app (Gmail, Outlook…) with the PDF attached; you tap Send there.</p>
        <label class="ck"><input type="checkbox" name="textSig" ${m.textSig !== false ? 'checked' : ''}><span>Add my text signature (turn off if the mail app adds its own)</span></label></div>

      <details class="mshelp"><summary>Email drafts</summary>
        <p class="hint" style="margin:6px 0">Standard wording for each email. Tap one to edit.</p>
        <div class="list">${Object.keys(TPL).map(k => `<button type="button" class="item" data-tpk="${k}"><div class="main"><div class="t">${TPL[k][0]}${(m.tpl || {})[k] ? ' <span class="badge b-orange">edited</span>' : ''}</div><div class="s">${esc(tpl(k).subject)}</div></div><span class="hint">›</span></button>`).join('')}</div>
      </details>
      <details class="mshelp"><summary>Signature with logo</summary>
        <div class="row" style="margin-top:10px"><label class="f"><span>Your name</span><input class="in" name="name" value="${esc(m.name || '')}" placeholder="e.g. Muhsin"></label><label class="f"><span>Job title</span><input class="in" name="title" value="${esc(m.title || '')}" placeholder="e.g. Sales Department"></label></div>
        <div class="row"><label class="f"><span>Mobile</span><input class="in" name="mobile" type="tel" value="${esc(m.mobile || '')}"></label><label class="f"><span>Sign-off</span><input class="in" name="signoff" value="${esc(m.signoff || 'Best regards,')}"></label></div>
        <div class="sigbox" id="msSig"></div>
        <div class="btns" style="margin-top:8px"><button type="button" class="btn" id="sgCopy">${ICON.copy || ''}Copy signature</button><button type="button" class="btn" id="sgDl">${ICON.dl}Download (.html)</button></div>
        <p class="hint">Emails sent from the app already include this signature. Copy it if you also want it in Gmail / Outlook.</p>
      </details>
      <button class="btn pri full" type="submit" style="margin-top:12px">Save</button></form>`, el => {
      const f = el.querySelector('#msForm');
      const keep = () => { const v = formData(f); Object.assign(m, {provider: prov, from: v.from.trim(), cpUrl: v.cpUrl.trim(), cc: v.cc.trim(), copySelf: !!v.copySelf, textSig: !!v.textSig, name: v.name.trim(), title: v.title.trim(), mobile: v.mobile.trim(), signoff: v.signoff.trim()}); };
      const status = () => {
        const st = el.querySelector('#msStat'); el.querySelector('#msTest').classList.toggle('hidden', prov !== 'cpanel');
        if (prov === 'mailapp') { st.innerHTML = '<b style="color:var(--green)">Ready</b> – no setup needed'; return; }
        st.innerHTML = m.lastTestOk && m.cpKey ? `<b style="color:var(--green)">Working</b> – sending from ${esc(m.from)}` : m.cpKey ? 'Script created – upload it, then Test' : 'Not set up – create the mail script';
      };
      const show = () => { el.querySelectorAll('[data-prov]').forEach(x => x.classList.toggle('on', x.dataset.prov === prov)); el.querySelectorAll('[data-for]').forEach(x => x.classList.toggle('hidden', x.dataset.for !== prov)); status(); };
      el.querySelectorAll('[data-prov]').forEach(b => b.onclick = () => { prov = b.dataset.prov; show(); });
      const drawSig = () => { keep(); el.querySelector('#msSig').innerHTML = sigHTML('icons/email-logo-badge2.png'); };
      f.addEventListener('input', () => { clearTimeout(f._t); f._t = setTimeout(drawSig, 250); });
      show(); drawSig();
      el.querySelectorAll('[data-tpk]').forEach(b => b.onclick = () => editTpl(b.dataset.tpk));
      el.querySelector('#cpMake').onclick = () => {
        keep(); const v = formData(f);
        if (!okAddr(m.from || '')) { toast('Enter your email address first'); return; }
        if (!m.cpKey) { const a = new Uint8Array(24); crypto.getRandomValues(a); m.cpKey = Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
        const php = phpScript({key: m.cpKey, from: m.from, name: S().name, mode: 'local', imapPass: v.cpPass || ''});
        m.scriptMode = 'cpanel'; m.lastTestOk = false; save();
        const AB = window.AndroidBridge;
        if (AB && AB.saveFile) AB.saveFile(btoa(unescape(encodeURIComponent(php))), 'application/octet-stream', 'fitx-mail.php');
        else downloadBlob(new Blob([php], {type: 'application/octet-stream'}), 'fitx-mail.php');
        status(); toast('fitx-mail.php saved – upload it in cPanel File Manager');
      };
      el.querySelector('#msTest').onclick = async () => {
        keep(); save();
        const st = el.querySelector('#msStat');
        if (!m.cpKey || !m.cpUrl) { toast('Create the mail script first'); return; }
        st.textContent = 'Testing…';
        try {
          const post = b => fetch(m.cpUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(Object.assign({key: m.cpKey}, b))});
          const r = await post({action: 'ping'}); const j = await r.json().catch(() => null);
          if (!j || !j.ok) throw new Error((j && j.error) || 'No answer from ' + m.cpUrl + ' (' + r.status + ') – is fitx-mail.php uploaded there?');
          const logo = await logoData();
          const html = emailHTML('This is a test email from FitX Accounts.\n\nYour email sending works. Invoices, quotations, receipts, reminders and statements will now be sent from ' + m.from + '.', 'Test', [['Sent from', m.from], ['Date', dfmt(today())]], [], logo ? 'cid:fitxlogo' : '');
          const r2 = await post({to: [m.from], subject: 'FitX Accounts – test email', fromName: S().name, html, text: 'This is a test email from FitX Accounts. Your email sending works.', attachments: logo ? [{name: 'logo.png', type: 'image/png', data: logo, cid: 'fitxlogo'}] : []});
          const j2 = await r2.json().catch(() => null);
          if (!j2 || !j2.ok) throw new Error((j2 && j2.error) || 'Sending failed (' + r2.status + ')');
          m.lastTestOk = true; save();
          st.innerHTML = `<b style="color:var(--green)">Working</b> – test email sent to ${esc(m.from)}`;
        } catch (e) { m.lastTestOk = false; st.textContent = e.message === 'Failed to fetch' ? 'Could not reach ' + m.cpUrl + ' – check the address and that the file is uploaded' : e.message; }
      };
      el.querySelector('#sgCopy').onclick = async () => {
        keep(); const box = el.querySelector('#msSig'); box.innerHTML = sigHTML(); let ok = false;
        try { if (navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([sigHTML()], {type: 'text/html'}), 'text/plain': new Blob([box.innerText], {type: 'text/plain'})})]); ok = true; } } catch (e) {}
        if (!ok) { try { const rg = document.createRange(); rg.selectNodeContents(box); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); ok = document.execCommand('copy'); sel.removeAllRanges(); } catch (e) {} }
        toast(ok ? 'Signature copied – paste it into your mail signature settings' : 'Could not copy – use Download');
      };
      el.querySelector('#sgDl').onclick = () => {
        keep(); const html = `<!doctype html><html><head><meta charset="utf-8"><title>FitX email signature</title></head><body style="margin:24px;background:#ffffff">${sigHTML()}</body></html>`;
        const AB = window.AndroidBridge;
        if (AB && AB.saveFile) AB.saveFile(btoa(unescape(encodeURIComponent(html))), 'text/html', 'FitX-email-signature.html'); else downloadBlob(new Blob([html], {type: 'text/html'}), 'FitX-email-signature.html');
      };
      f.onsubmit = ev => { ev.preventDefault(); keep(); save(); closeSheet(() => toast('Email settings saved')); };
    });
  }
  /* ---------- buttons across the app ---------- */
  const lastMail = r => (r && r.mails && r.mails.length) ? r.mails[r.mails.length - 1] : null;
  const mailNote = r => { const l = lastMail(r); return l ? `<p class="hint" style="margin:-6px 2px 12px">✉ Emailed ${esc(TPL[l.kind] ? TPL[l.kind][0].toLowerCase() : '')} to ${esc(l.to)} on ${dfmt(l.date)}</p>` : ''; };
  const top = () => typeof sheets !== 'undefined' && sheets[sheets.length - 1];
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id), el = top(); if (!d || !el) return;
    const bar = el.querySelector('.sharebar');
    const mail = el.querySelector('#aMail'); if (mail) mail.onclick = () => compose(specDoc(d));
    if (bar && !bar.querySelector('#aPdfPv')) {
      bar.insertAdjacentHTML('beforeend', `<button type="button" class="btn" id="aPdfPv">${ICON.search || ''}PDF preview</button>` + (d.type === 'INV' && !d.cancelled && docBal(d) > 0.004 ? `<button type="button" class="btn" id="aRemind">${ICON.clock || ICON.mail}Payment reminder</button>` : ''));
      bar.querySelector('#aPdfPv').onclick = () => pdfPreview(docHTML(d), d.number + ' - ' + ((custById(d.customerId) || {}).name || ''));
      const rm = bar.querySelector('#aRemind'); if (rm) rm.onclick = () => compose(specReminder(d));
      bar.insertAdjacentHTML('afterend', mailNote(d));
    }
    el.querySelectorAll('[data-delpay]').forEach(b => {
      const i = +b.dataset.delpay;
      b.insertAdjacentHTML('beforebegin', `<button type="button" class="btn mailbtn" data-rcpt="${i}" aria-label="Email receipt">${ICON.mail}</button>`);
      b.parentElement.querySelector(`[data-rcpt="${i}"]`).onclick = () => compose(specReceipt(d, i));
    });
  };
  const origRep = window.viewReport;
  if (origRep) window.viewReport = function (d, kind) {
    origRep(d, kind);
    const el = top(); const mail = el && el.querySelector('#rMail'); if (mail) mail.onclick = () => compose(specReport(d, kind));
  };
  const origPur = window.viewPurchase;
  if (origPur) window.viewPurchase = function (id) {
    origPur(id);
    const p = purById(id), el = top(); if (!p || !el) return;
    el.querySelectorAll('[data-delpay]').forEach(b => {
      const i = +b.dataset.delpay;
      b.insertAdjacentHTML('beforebegin', `<button type="button" class="btn mailbtn" data-adv="${i}" aria-label="Email payment advice">${ICON.mail}</button>`);
      b.parentElement.querySelector(`[data-adv="${i}"]`).onclick = () => compose(specAdvice(p, i));
    });
  };
  const origCust = window.viewCustomer;
  if (origCust) window.viewCustomer = function (id) {
    origCust(id);
    const c = custById(id), el = top(); if (!c || !el) return;
    const card = el.querySelector('.card'); if (!card) return;
    card.insertAdjacentHTML('afterend', `<div class="btns" style="margin:0 0 12px"><button type="button" class="btn" id="cStmtMail">${ICON.mail}Email statement</button></div>${mailNote(c)}`);
    el.querySelector('#cStmtMail').onclick = () => compose(specStatement(id));
  };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const sec = h => { const x = Array.from(document.querySelectorAll('#main .sec h2')).find(e => h.test(e.textContent.trim())); return x && x.parentElement.nextElementSibling; };
    const bus = sec(/business/i), sales = sec(/^sales$/i);
    const n = overdueCustomers().length;
    if (sales) { sales.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mPayRem"><span class="ic">${ICON.clock || ICON.mail}</span><div class="main"><div class="t">Payment reminders${n ? ` <span class="badge b-red">${n} overdue</span>` : ''}</div><div class="s">Email statements to customers with overdue invoices</div></div></button>`); document.getElementById('mPayRem').onclick = viewPaymentReminders; }
    if (bus) { bus.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mMail"><span class="ic">${ICON.mail}</span><div class="main"><div class="t">Email settings</div><div class="s">${direct() ? 'Sending from ' + esc(fromAddr()) + ' (Bluehost)' : 'Bluehost sending, email drafts, logo signature'}</div></div></button>`); document.getElementById('mMail').onclick = () => settings(); }
  };
  window.FitxMail = {baseVars, custVars, compose, settings, pdfPreview, sigHTML, htmlBody, specDoc, specReminder, specReceipt, specStatement, specAdvice, specService, specPayslip, specReport, viewPaymentReminders, emailHTML, receiptHTML, direct, TPL};
})();
