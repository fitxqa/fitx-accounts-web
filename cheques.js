/* FitX Accounts — cheque printing for Qatar banks.
   Prints only the text (date, payee, amount in words, amount in figures, A/C Payee crossing) onto the bank's printed cheque.
   Layouts are in millimetres from the top-left corner of the cheque. "New" = the current uniform QCB cheque, "Old" = earlier
   cheque books. Every bank keeps its own nudges (whole cheque + each field), set once with a test print, saved in settings.
   Paper: cheque fed alone (page = cheque size), or cheque placed on A4 at an offset (for printers that need A4).
   Records: db.cheques = [{id, no, bank, layout, date, payee, amount, acPayee, lang, memo, src:{t,id}, status, created}]
   Settings: S().chq = {bank, paper, a4x, a4y, banks:{[bank]:{layout, next, dx, dy, f:{date:[dx,dy], payee:[…], words:[…], amount:[…], cross:[…]}}}} */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['cheques']);
  const ensure = () => { if (!Array.isArray(db.cheques)) db.cheques = []; };
  ensure();
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const BANKS = [['qnb', 'QNB – Qatar National Bank'], ['cbq', 'Commercial Bank (CBQ)'], ['doha', 'Doha Bank'], ['qib', 'Qatar Islamic Bank (QIB)'], ['rayan', 'Masraf Al Rayan'], ['dukhan', 'Dukhan Bank'],
    ['ahli', 'Ahli Bank'], ['qiib', 'QIIB – Qatar International Islamic Bank'], ['lesha', 'Lesha Bank'], ['hsbc', 'HSBC Qatar'], ['scb', 'Standard Chartered Qatar'], ['arab', 'Arab Bank'], ['other', 'Other bank']];
  const bankName = k => (BANKS.find(b => b[0] === k) || [k, k])[1];
  // base layouts (mm). date: boxes = 8 digit boxes DDMMYYYY starting at x with pitch, or text.
  const LAYOUTS = {
    new: {name: 'New QCB cheque', w: 176, h: 80, date: {x: 128, y: 9.5, boxes: true, pitch: 5.3}, payee: {x: 24, y: 25, w: 125}, words: {x: 24, y: 33.5, w: 104, line2x: 10, lh: 6.8}, amount: {x: 140, y: 33}, cross: {x: 6, y: 6}},
    old: {name: 'Old cheque', w: 180, h: 82, date: {x: 136, y: 11, boxes: false}, payee: {x: 22, y: 27, w: 130}, words: {x: 26, y: 36, w: 110, line2x: 10, lh: 7}, amount: {x: 146, y: 36.5}, cross: {x: 6, y: 6}}
  };
  const cfg = () => { const s = S(); s.chq = s.chq || {bank: 'qnb', paper: 'cheque', a4x: 17, a4y: 10, banks: {}}; s.chq.banks = s.chq.banks || {}; return s.chq; };
  const bcfg = k => { const c = cfg(); c.banks[k] = c.banks[k] || {layout: 'new', next: '', dx: 0, dy: 0, f: {}}; c.banks[k].f = c.banks[k].f || {}; return c.banks[k]; };
  const off = (b, f) => { const o = b.f[f] || [0, 0]; return [num(b.dx) + num(o[0]), num(b.dy) + num(o[1])]; };

  /* ---------- amount in words ---------- */
  function enAmount(v) {
    const x = Math.round(Math.abs(num(v)) * 100), r = Math.floor(x / 100), d = x % 100;
    const w = qarWords(r).replace(/^Qatari Riyals /, '').replace(/ Only$/, '');
    return w + ' Qatari Riyals' + (d ? ' and ' + qarWords(d).replace(/^Qatari Riyals /, '').replace(/ Only$/, '') + ' Dirhams' : '') + ' Only';
  }
  const AR1 = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const AR10 = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const AR100 = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  const ar3 = n => { const h = Math.floor(n / 100), r = n % 100, out = []; if (h) out.push(AR100[h]); if (r) out.push(r < 20 ? AR1[r] : (r % 10 ? AR1[r % 10] + ' و' + AR10[Math.floor(r / 10)] : AR10[Math.floor(r / 10)])); return out.join(' و'); };
  const arGroup = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : (n >= 3 && n <= 10) ? ar3(n) + ' ' + few : ar3(n) + ' ' + many;
  function arWords(n) {
    if (!n) return 'صفر';
    const out = [], m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000;
    if (m) out.push(arGroup(m, 'مليون', 'مليونان', 'ملايين', 'مليون'));
    if (t) out.push(arGroup(t, 'ألف', 'ألفان', 'آلاف', 'ألف'));
    if (r) out.push(ar3(r));
    return out.join(' و');
  }
  function arAmount(v) { const x = Math.round(Math.abs(num(v)) * 100), r = Math.floor(x / 100), d = x % 100; return 'فقط ' + arWords(r) + ' ريال قطري' + (d ? ' و' + arWords(d) + ' درهم' : '') + ' لا غير'; }
  const words = (v, lang) => lang === 'ar' ? arAmount(v) : lang === 'both' ? enAmount(v) + ' / ' + arAmount(v) : enAmount(v);

  /* ---------- the printed text (absolute mm positions) ---------- */
  function chequeInner(c, opt) {
    const b = bcfg(c.bank), L = LAYOUTS[c.layout] || LAYOUTS[b.layout] || LAYOUTS.new;
    const P = (f, x, y) => { const [ox, oy] = off(b, f); return `left:${(x + ox).toFixed(1)}mm;top:${(y + oy).toFixed(1)}mm`; };
    const [yy, mm, dd] = String(c.date || today()).split('-');
    const dateHTML = L.date.boxes ? (dd + mm + yy).split('').map((ch, i) => `<span class="cq-t" style="${P('date', L.date.x + i * L.date.pitch, L.date.y)};width:${L.date.pitch}mm;text-align:center;font-weight:700;font-size:12pt">${ch}</span>`).join('')
      : `<span class="cq-t" style="${P('date', L.date.x, L.date.y)};font-weight:700;font-size:12pt;letter-spacing:.5mm">${dd}/${mm}/${yy}</span>`;
    const w = words(c.amount, c.lang);
    // split the words over two lines at about the line width
    const max = Math.round(L.words.w / (c.lang === 'ar' ? 1.9 : 2.05));
    let l1 = '**' + w, l2 = '';
    if (l1.length > max) { const cut = l1.lastIndexOf(' ', max); l2 = l1.slice(cut + 1); l1 = l1.slice(0, cut); }
    l2 = l2 ? l2 + '**' : ''; if (!l2) l1 += '**';
    const rtl = c.lang === 'ar' ? 'direction:rtl;' : '';
    return `${opt && opt.outline ? `<div style="position:absolute;inset:0;border:0.3mm dashed #999;border-radius:2mm"></div><div class="cq-t" style="left:3mm;bottom:3mm;top:auto;font-size:7pt;color:#999">${esc(bankName(c.bank))} · ${esc(L.name)} · test print – lay over a real cheque to check</div>` : ''}
      ${c.acPayee ? `<div class="cq-t" style="${P('cross', L.cross.x, L.cross.y)};transform:rotate(-14deg);transform-origin:left top;border-top:0.35mm solid #000;border-bottom:0.35mm solid #000;padding:0.6mm 2mm;font-size:8pt;font-weight:700;letter-spacing:.3mm">A/C PAYEE ONLY</div>` : ''}
      ${dateHTML}
      <span class="cq-t" style="${P('payee', L.payee.x, L.payee.y)};width:${L.payee.w}mm;font-size:11.5pt;font-weight:700;white-space:nowrap;overflow:hidden">**${esc(c.payee)}**</span>
      <span class="cq-t" style="${P('words', L.words.x, L.words.y)};width:${L.words.w}mm;font-size:10pt;font-weight:600;white-space:nowrap;${rtl}">${esc(l1)}</span>
      ${l2 ? `<span class="cq-t" style="${P('words', L.words.line2x, L.words.y + L.words.lh)};width:${L.words.w + L.words.x - L.words.line2x}mm;font-size:10pt;font-weight:600;white-space:nowrap;${rtl}">${esc(l2)}</span>` : ''}
      <span class="cq-t" style="${P('amount', L.amount.x, L.amount.y)};font-size:13pt;font-weight:800">**${fmt(c.amount)}**</span>`;
  }
  const chequeBox = (c, opt) => { const L = LAYOUTS[c.layout] || LAYOUTS.new; return `<div class="cq" style="position:relative;width:${L.w}mm;height:${L.h}mm;font-family:Arial,Helvetica,sans-serif;color:#000">${chequeInner(c, opt)}</div>`; };
  const style = document.createElement('style');
  style.textContent = `.cq .cq-t{position:absolute;line-height:1.1}
    .cq-prev{width:100%;overflow:hidden;border-radius:8px;border:1px solid #b9c6d4;background:linear-gradient(135deg,#eef3f8,#dfe8f1);position:relative}
    .cq-prev .cq{transform-origin:top left}`;
  document.head.appendChild(style);

  function printCheque(c, outline) {
    const C = cfg(), L = LAYOUTS[c.layout] || LAYOUTS.new;
    const page = C.paper === 'a4' ? `@page{size:A4;margin:0}` : `@page{size:${L.w}mm ${L.h}mm;margin:0}`;
    const st = document.createElement('style'); st.id = 'cqPrintCss';
    st.textContent = `@media print{${page} #printArea{padding:0!important;margin:0!important} #printArea .cq{${C.paper === 'a4' ? `margin:${num(C.a4y)}mm 0 0 ${num(C.a4x)}mm;` : ''}page-break-after:avoid}}`;
    document.getElementById('cqPrintCss') && document.getElementById('cqPrintCss').remove();
    document.head.appendChild(st);
    printHTML(chequeBox(c, {outline}), 'Cheque ' + (c.no || ''));
    setTimeout(() => { const x = document.getElementById('cqPrintCss'); if (x) x.remove(); }, 15000);
  }

  /* ---------- fill from bills / expenses / salaries ---------- */
  function sources() {
    const out = [];
    db.purchases.filter(p => purBal(p) > 0.004).forEach(p => out.push({k: 'bill:' + p.id, g: 'Unpaid bills', label: `${(supById(p.supplierId) || {}).name || ''} · ${p.number}`, payee: (supById(p.supplierId) || {}).name || '', amount: purBal(p), memo: p.number + (p.ref ? ' / ' + p.ref : '')}));
    db.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 25).forEach(x => out.push({k: 'exp:' + x.id, g: 'Recent expenses', label: `${x.category} · ${dfmt(x.date)} · ${fmt(x.amount)}`, payee: x.desc || x.category, amount: num(x.amount), memo: x.category}));
    const runs = (db.payruns || []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month)));
    (db.employees || []).filter(e => !e.left || e.left >= today()).forEach(e => { const r = runs.find(x => (x.lines || []).some(l => l.empId === e.id)); const l = r && r.lines.find(q => q.empId === e.id);
      out.push({k: 'emp:' + e.id, g: 'Salaries', label: `${e.name}${l ? ' · ' + r.month + ' net ' + fmt(l.net) : ''}`, payee: e.name, amount: l ? num(l.net) : '', memo: l ? 'Salary ' + r.month : 'Salary'}); });
    return out;
  }

  /* ---------- write a cheque ---------- */
  function editCheque(id, preset) {
    const ex = id ? db.cheques.find(c => c.id === id) : null, C = cfg();
    const c = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({bank: C.bank || 'qnb', layout: bcfg(C.bank || 'qnb').layout || 'new', date: today(), payee: '', amount: '', acPayee: true, lang: 'en', memo: '', src: null, no: bcfg(C.bank || 'qnb').next || ''}, preset || {});
    const src = sources(), groups = [...new Set(src.map(s => s.g))];
    openSheet(ex ? 'Cheque ' + (ex.no || '') : 'Print cheque', `<form id="cqForm" autocomplete="off">
      ${!ex && src.length ? `<label class="f"><span>Fill from (optional)</span><select class="in" id="cqSrc"><option value="">— type it yourself —</option>${groups.map(g => `<optgroup label="${esc(g)}">${src.filter(s => s.g === g).map(s => `<option value="${esc(s.k)}">${esc(s.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
      <div class="row"><label class="f"><span>Bank</span><select class="in" name="bank" id="cqBank">${BANKS.map(([k, n]) => `<option value="${k}" ${k === c.bank ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="f"><span>Cheque book</span><select class="in" name="layout" id="cqLay">${Object.entries(LAYOUTS).map(([k, l]) => `<option value="${k}" ${k === c.layout ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label></div>
      <label class="f"><span>Pay to</span><input class="in" name="payee" id="cqPayee" value="${esc(c.payee)}" required placeholder="Name exactly as on the account"></label>
      <div class="row"><label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0.01" inputmode="decimal" name="amount" id="cqAmt" value="${esc(c.amount)}" required></label>
      <label class="f"><span>Cheque date</span><input class="in" type="date" name="date" id="cqDate" value="${esc(c.date)}" required></label></div>
      <div class="row"><label class="f"><span>Cheque no.</span><input class="in" name="no" id="cqNo" value="${esc(c.no || '')}" inputmode="numeric" placeholder="e.g. 000123"></label>
      <label class="f"><span>Amount words</span><select class="in" name="lang" id="cqLang">${[['en', 'English'], ['ar', 'Arabic'], ['both', 'English + Arabic']].map(([k, l]) => `<option value="${k}" ${k === c.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label style="display:flex;gap:8px;align-items:center;margin:0 0 10px"><input type="checkbox" name="acPayee" id="cqAc" ${c.acPayee ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--orange)"> Print “A/C Payee only” crossing</label>
      <label class="f"><span>Memo (for your register, not printed)</span><input class="in" name="memo" id="cqMemo" value="${esc(c.memo || '')}" placeholder="e.g. PUR-2026-0004 / rent November"></label>
      <div class="hint" id="cqWords" style="margin:-4px 2px 10px"></div>
      <div class="sec"><h2>Preview</h2><span class="hint">only the black text prints</span></div>
      <div class="cq-prev" id="cqPrev"></div>
      <div class="btns" style="margin-top:12px"><button class="btn pri" type="submit">${ICON.print}Print cheque</button><button type="button" class="btn" id="cqTest">Test print (with outline)</button><button type="button" class="btn" id="cqCal">Adjust position</button></div>
      <p class="hint">Saved to the cheque register when you print. Recording the payment itself (e.g. paying the bill) is done as usual in Payment Out.</p></form>`, el => {
      const form = el.querySelector('#cqForm');
      const cur = () => { const f = formData(form); return {bank: f.bank, layout: f.layout, payee: f.payee.trim(), amount: num(f.amount), date: f.date, no: (f.no || '').trim(), lang: f.lang, acPayee: !!f.acPayee, memo: (f.memo || '').trim(), src: c.src}; };
      const draw = () => {
        const x = cur(), L = LAYOUTS[x.layout] || LAYOUTS.new, box = el.querySelector('#cqPrev');
        const k = box.clientWidth / (L.w * 96 / 25.4);
        box.style.height = (L.h * 96 / 25.4 * k) + 'px';
        box.innerHTML = chequeBox(x); const q = box.querySelector('.cq'); q.style.transform = `scale(${k})`;
        el.querySelector('#cqWords').textContent = x.amount ? words(x.amount, x.lang) : '';
      };
      el.querySelector('#cqBank').onchange = () => { const b = bcfg(el.querySelector('#cqBank').value); el.querySelector('#cqLay').value = b.layout || 'new'; if (!ex && b.next) el.querySelector('#cqNo').value = b.next; draw(); };
      form.addEventListener('input', draw); form.addEventListener('change', draw);
      const s = el.querySelector('#cqSrc'); if (s) s.onchange = () => { const x = src.find(q => q.k === s.value); if (!x) { c.src = null; return; } el.querySelector('#cqPayee').value = x.payee; if (x.amount !== '') el.querySelector('#cqAmt').value = r2(x.amount); el.querySelector('#cqMemo').value = x.memo; const [t, i] = x.k.split(':'); c.src = {t, id: i}; draw(); };
      setTimeout(draw, 30); window.addEventListener('resize', draw, {once: true});
      el.querySelector('#cqTest').onclick = () => { const x = cur(); if (!x.payee) x.payee = 'Test Payee Name Trading WLL'; if (!x.amount) x.amount = 12345.5; printCheque(x, true); };
      el.querySelector('#cqCal').onclick = () => calibrate(cur().bank, cur().layout, draw);
      form.onsubmit = e => {
        e.preventDefault(); const x = cur();
        if (!x.payee || !(x.amount > 0)) { toast('Enter the payee and amount'); return; }
        const C2 = cfg(); C2.bank = x.bank; const b = bcfg(x.bank); b.layout = x.layout;
        let rec;
        if (ex) { Object.assign(ex, x, {updated: Date.now()}); rec = ex; }
        else {
          rec = Object.assign({id: uid(), status: 'issued', created: String(Date.now())}, x); db.cheques.push(rec);
          if (/^\d+$/.test(x.no)) b.next = String(parseInt(x.no, 10) + 1).padStart(x.no.length, '0');
        }
        save(); printCheque(rec, false);
        closeSheet(() => { toast('Cheque sent to the printer'); render(); });
      };
    });
  }

  /* ---------- position adjustment (once per bank) ---------- */
  function calibrate(bank, layout, after) {
    const b = bcfg(bank), C = cfg();
    const F = [['all', 'Whole cheque'], ['date', 'Date'], ['payee', 'Pay to'], ['words', 'Amount in words'], ['amount', 'Amount in figures'], ['cross', 'A/C Payee crossing']];
    const val = f => f === 'all' ? [num(b.dx), num(b.dy)] : (b.f[f] || [0, 0]);
    openSheet('Adjust position · ' + bankName(bank), `
      <p class="hint" style="margin-top:0">Do a <b>test print</b> on plain paper, hold it over a real ${esc(bankName(bank))} cheque against the light, then move fields here. Right / down are +. Saved for this bank.</p>
      <label class="f"><span>Cheque book</span><select class="in" id="caLay">${Object.entries(LAYOUTS).map(([k, l]) => `<option value="${k}" ${k === (layout || b.layout) ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>
      <div class="list" id="caList"></div>
      <div class="sec"><h2>Paper</h2></div>
      <label class="f"><span>How the cheque goes into the printer</span><select class="in" id="caPaper"><option value="cheque" ${C.paper !== 'a4' ? 'selected' : ''}>Cheque alone (page = cheque size)</option><option value="a4" ${C.paper === 'a4' ? 'selected' : ''}>On A4 (cheque at the position below)</option></select></label>
      <div class="row" id="caA4" style="${C.paper === 'a4' ? '' : 'display:none'}"><label class="f"><span>From left (mm)</span><input class="in" type="number" step="0.5" id="caX" value="${num(C.a4x)}"></label><label class="f"><span>From top (mm)</span><input class="in" type="number" step="0.5" id="caY" value="${num(C.a4y)}"></label></div>
      <div class="btns"><button type="button" class="btn pri" id="caTest">${ICON.print}Test print</button><button type="button" class="btn" id="caReset">Reset this bank</button></div>`, el => {
      const draw = () => {
        el.querySelector('#caList').innerHTML = F.map(([f, l]) => { const [x, y] = val(f); return `<div class="item" style="flex-wrap:wrap;gap:6px"><div class="main" style="min-width:140px"><div class="t">${l}</div><div class="s">${x >= 0 ? '+' : ''}${x.toFixed(1)} mm right · ${y >= 0 ? '+' : ''}${y.toFixed(1)} mm down</div></div>
          <div style="display:flex;gap:4px">${[['←', -0.5, 0], ['→', 0.5, 0], ['↑', 0, -0.5], ['↓', 0, 0.5]].map(([s, dx, dy]) => `<button type="button" class="btn" data-f="${f}" data-dx="${dx}" data-dy="${dy}" style="min-width:42px;padding:6px" aria-label="${l} ${s}">${s}</button>`).join('')}</div></div>`; }).join('');
        el.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { const f = x.dataset.f, dx = +x.dataset.dx, dy = +x.dataset.dy;
          if (f === 'all') { b.dx = r2(num(b.dx) + dx); b.dy = r2(num(b.dy) + dy); } else { const o = b.f[f] || [0, 0]; b.f[f] = [r2(num(o[0]) + dx), r2(num(o[1]) + dy)]; }
          save(); draw(); after && after(); });
      };
      draw();
      el.querySelector('#caLay').onchange = e => { b.layout = e.target.value; save(); after && after(); };
      el.querySelector('#caPaper').onchange = e => { C.paper = e.target.value; el.querySelector('#caA4').style.display = C.paper === 'a4' ? '' : 'none'; save(); };
      el.querySelector('#caX').oninput = e => { C.a4x = num(e.target.value); save(); };
      el.querySelector('#caY').oninput = e => { C.a4y = num(e.target.value); save(); };
      el.querySelector('#caReset').onclick = () => { if (!confirm('Reset all position changes for ' + bankName(bank) + '?')) return; b.dx = 0; b.dy = 0; b.f = {}; save(); draw(); after && after(); };
      el.querySelector('#caTest').onclick = () => printCheque({bank, layout: el.querySelector('#caLay').value, date: today(), payee: 'Test Payee Name Trading WLL', amount: 12345.5, acPayee: true, lang: 'en', no: 'TEST'}, true);
    });
  }

  /* ---------- register ---------- */
  const CST = {issued: ['Issued', 'b-blue'], cleared: ['Cleared', 'b-green'], bounced: ['Bounced', 'b-red'], cancelled: ['Cancelled', 'b-grey']};
  function register() {
    openSheet('Cheques', `
      <div class="btns" style="margin-bottom:12px"><button type="button" class="btn pri" id="cqNew">${ICON.print}Print a cheque</button><button type="button" class="btn" id="cqAdj">Adjust position</button></div>
      <input class="search" id="cqQ" placeholder="Search payee, number or bank" aria-label="Search">
      <div class="list" id="cqList"></div><p class="hint" id="cqSum" style="margin:10px 4px"></p>`, el => {
      const draw = () => {
        const q = el.querySelector('#cqQ').value.trim().toLowerCase();
        const l = db.cheques.filter(c => !q || (c.payee + ' ' + c.no + ' ' + bankName(c.bank) + ' ' + (c.memo || '')).toLowerCase().includes(q)).sort((a, b) => String(b.date + b.created).localeCompare(String(a.date + a.created)));
        el.querySelector('#cqList').innerHTML = l.length ? l.map(c => { const [s, k] = CST[c.status] || CST.issued; return `<button type="button" class="item r2" data-id="${c.id}"><div class="main"><div class="t">${esc(c.payee)}</div><div class="s">${c.no ? 'No. ' + esc(c.no) + ' · ' : ''}${dfmt(c.date)} · ${esc(bankName(c.bank).split(' – ')[0])}${c.memo ? ' · ' + esc(c.memo) : ''}</div></div><div class="r"><div class="amt">${fmt(c.amount)}</div><span class="badge ${k}">${s}</span></div></button>`; }).join('')
          : `<div class="empty">${db.cheques.length ? 'Nothing matches.' : 'No cheques printed yet.'}</div>`;
        const open = l.filter(c => c.status === 'issued');
        el.querySelector('#cqSum').textContent = open.length ? `${open.length} cheque${open.length > 1 ? 's' : ''} not cleared yet · ${money(open.reduce((s, c) => s + num(c.amount), 0))}` : '';
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => viewCheque(b.dataset.id));
      };
      el.querySelector('#cqQ').oninput = draw; draw();
      el.querySelector('#cqNew').onclick = () => editCheque();
      el.querySelector('#cqAdj').onclick = () => calibrate(cfg().bank || 'qnb');
    });
  }
  function viewCheque(id) {
    const c = db.cheques.find(x => x.id === id); if (!c) return;
    openSheet('Cheque ' + (c.no || ''), `
      <div class="card"><b>${esc(c.payee)}</b><div class="hint">${money(c.amount)} · ${dfmt(c.date)} · ${esc(bankName(c.bank))}${c.memo ? ' · ' + esc(c.memo) : ''}</div><div class="hint">${esc(words(c.amount, c.lang))}</div></div>
      <div class="sec"><h2>Status</h2></div>
      <div class="chips" id="cvSt">${Object.entries(CST).map(([k, [l]]) => `<button type="button" class="${c.status === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="cq-prev" id="cvPrev"></div>
      <div class="btns" style="margin-top:12px"><button type="button" class="btn pri" id="cvPrint">${ICON.print}Print again</button><button type="button" class="btn" id="cvEdit">${ICON.edit}Edit</button><button type="button" class="btn danger" id="cvDel">${ICON.trash}Delete</button></div>`, el => {
      const box = el.querySelector('#cvPrev'), L = LAYOUTS[c.layout] || LAYOUTS.new;
      setTimeout(() => { const k = box.clientWidth / (L.w * 96 / 25.4); box.style.height = (L.h * 96 / 25.4 * k) + 'px'; box.innerHTML = chequeBox(c); box.querySelector('.cq').style.transform = `scale(${k})`; }, 30);
      el.querySelectorAll('#cvSt [data-s]').forEach(b => b.onclick = () => { c.status = b.dataset.s; save(); el.querySelectorAll('#cvSt [data-s]').forEach(x => x.classList.toggle('on', x === b)); toast('Marked ' + CST[c.status][0].toLowerCase()); });
      el.querySelector('#cvPrint').onclick = () => printCheque(c, false);
      el.querySelector('#cvEdit').onclick = () => closeSheet(() => editCheque(id));
      el.querySelector('#cvDel').onclick = () => { if (!confirm('Delete this cheque from the register?')) return; db.cheques = db.cheques.filter(x => x.id !== id); save(); closeSheet(() => { render(); }); toast('Deleted'); };
    });
  }

  /* ---------- entry points ---------- */
  const origPur = window.viewPurchase;
  if (origPur) window.viewPurchase = function (pid) {
    origPur.apply(this, arguments);
    const p = purById(pid), all = document.querySelectorAll('.sheet'), el = all[all.length - 1];
    if (!p || !el || el.querySelector('#ppChq')) return;
    const btns = el.querySelector('.sb .btns'); if (!btns) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'ppChq'; b.innerHTML = `${ICON.print}Print cheque`;
    btns.appendChild(b);
    const sup = supById(p.supplierId) || {};
    b.onclick = () => editCheque(null, {payee: sup.name || '', amount: purBal(p) > 0.004 ? purBal(p) : '', memo: p.number + (p.ref ? ' / ' + p.ref : ''), src: {t: 'bill', id: p.id}});
  };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mPayOut') || document.getElementById('mDN');
    if (!a || document.getElementById('mChq')) return;
    a.insertAdjacentHTML('afterend', `<button type="button" class="item rcard" id="mChq"><span class="ic">${ICON.print}</span><div class="main"><div class="t">Cheques</div><div class="s">Print cheques for all Qatar banks · cheque register</div></div></button>`);
    document.getElementById('mChq').onclick = register;
  };

  window.FitxChq = {print: editCheque, register, calibrate, arAmount, enAmount, chequeBox, BANKS, LAYOUTS};
})();
