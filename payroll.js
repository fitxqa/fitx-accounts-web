/* FitX Accounts — Payroll (Qatar) and Qatar tax.
   Payroll follows Qatar Labour Law No. 14 of 2004 and Social Insurance Law No. 1 of 2022:
   - no personal income tax on salaries
   - overtime: at least 125% of the basic hourly wage; 150% for night (9pm–6am), Friday rest day and public holidays
   - hourly wage = basic ÷ 30 ÷ 8
   - end of service gratuity: at least 3 weeks (21 days) of the final basic wage per year, after 1 year of service, pro rata
   - social insurance (GRSIA) for Qatari staff: employee 7%, employer 14% of the contribution salary (max QAR 100,000), due by the 5th
   - wages through WPS by the 7th of the following month
   Tax: withholding tax 5% / 7% on payments to non-resident suppliers (due by the 16th of the next month),
   corporate income tax 10% on the profit share of non-Qatari / non-GCC owners. VAT is not in force in Qatar.
   Records: db.employees, db.payruns, db.paytx (advances, final settlements, gratuity top-ups, tax payments & provisions). */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['employees', 'payruns', 'paytx']);
  const COLS = ['employees', 'payruns', 'paytx'];
  const ensure = () => COLS.forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
  ensure();
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const A = c => 'acc_' + c;
  const NAT = ['Expatriate', 'Qatari', 'GCC national'];
  const SI_DEF = {Qatari: [7, 14], 'GCC national': [0, 0], Expatriate: [0, 0]};
  const SI_CAP = 100000;
  const OT1 = 1.25, OT2 = 1.5;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const P = () => { const s = S(); s.payroll = s.payroll || {}; return s.payroll; };
  const gratDays = () => num(P().gratDays) || 21;
  const empById = id => db.employees.find(e => e.id === id);
  const monthLabel = ym => { const [y, m] = String(ym).split('-'); return (MONTHS[+m - 1] || '') + ' ' + y; };
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m, 0)); return d.toISOString().slice(0, 10); };
  const nextMonthDay = (ym, day) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m, day)); return d.toISOString().slice(0, 10); };
  const thisMonth = () => today().slice(0, 7);
  const daysDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const fixedPay = e => r2(num(e.basic) + num(e.housing) + num(e.transport) + num(e.food) + num(e.other));
  const siRates = e => (e.siEmp !== undefined && e.siEmp !== '') ? [num(e.siEmp), num(e.siEr)] : (SI_DEF[e.nat] || [0, 0]);
  const siBase = e => Math.min(SI_CAP, num(e.siBase) || (num(e.basic) + num(e.housing)));
  const gratOn = e => e.grat !== undefined ? !!e.grat : e.nat !== 'Qatari';
  const runTot = (r, k) => r2((r.lines || []).reduce((s, l) => s + num(l[k]), 0));
  const posted = r => r.status === 'Approved' || r.status === 'Paid';
  const txOf = kind => db.paytx.filter(x => x.kind === kind);

  /* ---------- calculations ---------- */
  function calcLine(l) {
    const fixed = r2(num(l.basic) + num(l.housing) + num(l.transport) + num(l.food) + num(l.other));
    l.fixed = fixed;
    l.unpaidDed = r2(fixed / 30 * num(l.unpaid));
    const hr = num(l.basic) / 30 / 8;
    l.ot = r2(hr * OT1 * num(l.otN) + hr * OT2 * num(l.otH));
    l.gross = r2(fixed - l.unpaidDed + l.ot + num(l.bonus));
    // contributions on the contribution salary, pro rata for days not employed / unpaid in the month
    const dayF = Math.max(0, 30 - num(l.unpaid)) / 30;
    l.siEmpAmt = r2(num(l.siBase) * dayF * num(l.siEmp) / 100);
    l.siErAmt = r2(num(l.siBase) * dayF * num(l.siEr) / 100);
    l.gratAmt = l.gratOn ? r2(num(l.basic) * gratDays() / 30 / 12) : 0;
    l.net = r2(l.gross - l.siEmpAmt - num(l.adv) - num(l.ded));
    return l;
  }
  function lineFor(e, ym) {
    const s = ym + '-01', end = monthEnd(ym);
    let unpaid = 0;
    if (e.join && e.join > s && e.join <= end) unpaid += Math.min(30, +e.join.slice(8) - 1);
    if (e.left && e.left >= s && e.left < end) unpaid += Math.max(0, 30 - +e.left.slice(8));
    const [se, sr] = siRates(e);
    return calcLine({empId: e.id, name: e.name, basic: num(e.basic), housing: num(e.housing), transport: num(e.transport), food: num(e.food), other: num(e.other),
      unpaid: Math.min(30, unpaid), otN: 0, otH: 0, bonus: 0, adv: 0, ded: 0, dedNote: '', siBase: se || sr ? siBase(e) : 0, siEmp: se, siEr: sr, gratOn: gratOn(e)});
  }
  const activeIn = ym => db.employees.filter(e => (!e.join || e.join <= monthEnd(ym)) && (!e.left || e.left >= ym + '-01')).sort((a, b) => String(a.no || a.name).localeCompare(String(b.no || b.name)));
  function advBal(empId, exceptRun) {
    const given = txOf('adv').filter(x => x.empId === empId).reduce((s, x) => s + num(x.amount), 0);
    const ded = db.payruns.filter(r => posted(r) && r.id !== exceptRun).reduce((s, r) => s + (r.lines || []).filter(l => l.empId === empId).reduce((a, l) => a + num(l.adv), 0), 0);
    const settled = txOf('settle').filter(x => x.empId === empId).reduce((s, x) => s + num(x.advRec), 0);
    return r2(given - ded - settled);
  }
  function gratProv(empId, exceptTx) {
    const acc = db.payruns.filter(posted).reduce((s, r) => s + (r.lines || []).filter(l => l.empId === empId).reduce((a, l) => a + num(l.gratAmt), 0), 0);
    const top = txOf('gtop').filter(x => x.empId === empId && x.id !== exceptTx).reduce((s, x) => s + num(x.amount), 0);
    const used = txOf('settle').filter(x => x.empId === empId && x.id !== exceptTx).reduce((s, x) => s + num(x.fromProv), 0);
    return r2(acc + top - used);
  }
  // legal gratuity on a date: 21 days' basic per year after one full year, pro rata
  function gratuity(e, asOf, accrued) {
    if (!e.join) return {days: 0, years: 0, amount: 0, eligible: false};
    const end = asOf || e.left || today();
    const days = Math.max(0, daysDiff(e.join, end) + 1), years = days / 365;
    const eligible = days >= 365;
    const amount = (eligible || accrued) && gratOn(e) ? r2(num(e.basic) / 30 * gratDays() * years) : 0;
    return {days, years, amount, eligible};
  }
  const leaveDays = e => { const g = gratuity(e, today(), true); return g.years >= 5 ? 28 : 21; };

  /* ---------- ledger postings ---------- */
  (window.FITX_POSTERS = window.FITX_POSTERS || []).push(add => {
    ensure();
    db.payruns.forEach(r => {
      if (!posted(r)) return;
      const open = () => viewRun(r.id), ref = r.number, k = 'pr:' + r.id + ':';
      const L = r.lines || [], sum = f => r2(L.reduce((s, l) => s + f(l), 0));
      const sal = sum(l => num(l.fixed) - num(l.unpaidDed) - num(l.ded)), otb = sum(l => num(l.ot) + num(l.bonus));
      const siE = sum(l => num(l.siEmpAmt)), siR = sum(l => num(l.siErAmt)), gr = sum(l => num(l.gratAmt)), adv = sum(l => num(l.adv)), net = sum(l => num(l.net));
      const d = 'Payroll ' + monthLabel(r.month);
      add(k + 'sal', r.date, A(6500), sal, d, ref, open);
      add(k + 'otb', r.date, A(6530), otb, d + ' · overtime & bonus', ref, open);
      add(k + 'sier', r.date, A(6510), siR, d + ' · employer social insurance', ref, open);
      add(k + 'gr', r.date, A(6520), gr, d + ' · gratuity provision', ref, open);
      add(k + 'net', r.date, A(2410), -net, d + ' · net salaries', ref, open);
      add(k + 'si', r.date, A(2420), -(siE + siR), d + ' · social insurance', ref, open);
      add(k + 'adv', r.date, A(1410), -adv, d + ' · advances recovered', ref, open);
      add(k + 'grp', r.date, A(2400), -gr, d + ' · gratuity provision', ref, open);
      if (r.paid) {
        const acc = FitxLedger.moneyAcc(r.paid.acc, r.paid.method || 'Bank transfer');
        add(k + 'pay:l', r.paid.date, A(2410), net, d + ' · salaries paid', ref, open);
        add(k + 'pay:b', r.paid.date, acc, -net, d + ' · salaries paid (' + (r.paid.method || 'WPS') + ')', ref, open);
      }
      if (r.siPaid) {
        const acc = FitxLedger.moneyAcc(r.siPaid.acc, r.siPaid.method || 'Bank transfer');
        add(k + 'sip:l', r.siPaid.date, A(2420), siE + siR, d + ' · social insurance paid', ref, open);
        add(k + 'sip:b', r.siPaid.date, acc, -(siE + siR), d + ' · social insurance paid to GRSIA', ref, open);
      }
    });
    db.paytx.forEach(x => {
      const e = empById(x.empId) || {}, k = 'ptx:' + x.id + ':', open = () => openTx(x);
      const bank = () => FitxLedger.moneyAcc(x.acc, x.method || 'Bank transfer');
      if (x.kind === 'adv') { add(k + 'a', x.date, A(1410), num(x.amount), 'Advance · ' + (e.name || ''), 'Advance', open); add(k + 'b', x.date, bank(), -num(x.amount), 'Advance · ' + (e.name || ''), 'Advance', open); }
      if (x.kind === 'gtop') { add(k + 'e', x.date, A(6520), num(x.amount), 'Gratuity provision top-up · ' + (e.name || ''), 'Gratuity', open); add(k + 'p', x.date, A(2400), -num(x.amount), 'Gratuity provision top-up · ' + (e.name || ''), 'Gratuity', open); }
      if (x.kind === 'settle') {
        const who = 'Final settlement · ' + (e.name || '');
        add(k + 'gp', x.date, A(2400), num(x.fromProv), who, 'Settlement', open);
        add(k + 'ge', x.date, A(6520), r2(num(x.gratuity) - num(x.fromProv)), who + ' · gratuity', 'Settlement', open);
        add(k + 'w', x.date, A(6500), r2(num(x.leavePay) + num(x.otherPay) - num(x.otherDed)), who + ' · leave pay & dues', 'Settlement', open);
        add(k + 'adv', x.date, A(1410), -num(x.advRec), who + ' · advance recovered', 'Settlement', open);
        add(k + 'b', x.date, bank(), -num(x.net), who, 'Settlement', open);
      }
      if (x.kind === 'wht') { add(k + 'l', x.date, A(2510), num(x.amount), 'Withholding tax paid · ' + monthLabel(x.period), 'WHT', open); add(k + 'b', x.date, bank(), -num(x.amount), 'Withholding tax paid to GTA', 'WHT', open); }
      if (x.kind === 'citprov') { add(k + 'e', x.date, A(8000), num(x.amount), 'Corporate income tax ' + x.period, 'CIT', open); add(k + 'l', x.date, A(2500), -num(x.amount), 'Corporate income tax ' + x.period, 'CIT', open); }
      if (x.kind === 'cit') { add(k + 'l', x.date, A(2500), num(x.amount), 'Corporate income tax paid ' + x.period, 'CIT', open); add(k + 'b', x.date, bank(), -num(x.amount), 'Corporate income tax paid to GTA', 'CIT', open); }
    });
  });

  /* ---------- P&L / cash book ---------- */
  const SC = 'Staff costs › ';
  (window.FITX_ACCT_HOOKS = window.FITX_ACCT_HOOKS || []).push((a, f, t) => {
    ensure();
    const inR = d => d && d >= f && d <= t;
    const cost = (cat, v) => { v = r2(v); if (!v) return; a.byCat[cat] = (a.byCat[cat] || 0) + v; a.expTot += v; a.accruedExp += v; };
    const out = (m, v) => { v = r2(v); if (!v) return; a.extraOut += v; a.outByMethod[m] = (a.outByMethod[m] || 0) + v; };
    db.payruns.forEach(r => {
      if (!posted(r)) return;
      const L = r.lines || [], sum = fn => L.reduce((s, l) => s + fn(l), 0);
      if (inR(r.date)) {
        cost(SC + 'Salaries & wages', sum(l => num(l.fixed) - num(l.unpaidDed) - num(l.ded)));
        cost(SC + 'Overtime & bonuses', sum(l => num(l.ot) + num(l.bonus)));
        cost(SC + 'Employer social insurance', sum(l => num(l.siErAmt)));
        cost(SC + 'End of service gratuity', sum(l => num(l.gratAmt)));
      }
      if (r.paid && inR(r.paid.date)) out(r.paid.method || 'Bank transfer', sum(l => num(l.net)));
      if (r.siPaid && inR(r.siPaid.date)) out(r.siPaid.method || 'Bank transfer', sum(l => num(l.siEmpAmt) + num(l.siErAmt)));
    });
    db.paytx.forEach(x => {
      if (!inR(x.date)) return;
      if (x.kind === 'adv') out(x.method || 'Cash', x.amount);
      if (x.kind === 'gtop') cost(SC + 'End of service gratuity', x.amount);
      if (x.kind === 'settle') { cost(SC + 'End of service gratuity', num(x.gratuity) - num(x.fromProv)); cost(SC + 'Salaries & wages', num(x.leavePay) + num(x.otherPay) - num(x.otherDed)); out(x.method || 'Bank transfer', x.net); }
      if (x.kind === 'citprov') cost('Corporate income tax', x.amount);
      if (x.kind === 'wht' || x.kind === 'cit') out(x.method || 'Bank transfer', x.amount);
    });
  });

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .prl{background:var(--card,#fff);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px;box-shadow:var(--sh)}
    .prl .ph{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:8px}
    .prl .ph b{font-size:15px}
    .prl .g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .prl .g4 .in{min-height:40px;padding:6px 8px}
    .prl .sum{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin-top:8px}
    .prl .sum b{color:var(--text)}
    .prl .net{font-weight:800;font-size:15px}
    @media(max-width:520px){.prl .g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .slip{font-size:12px}
    .slip .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .slip td.n{text-align:right}
    .slip .eqt td{word-break:break-word}
    .slip .netbox{margin-top:12px;background:#ff6a00;color:#fff;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;font-weight:800;font-size:15px}
    body.role-tech #side [data-tab=payroll], body.role-tech #side [data-tab=tax], body.role-tech #mPayroll, body.role-tech #mTax{display:none!important}`;
  document.head.appendChild(css);

  const btn = (id, label, cls) => `<button type="button" class="btn ${cls || ''}" id="${id}">${label}</button>`;
  const chips = (cur, list, attr) => `<div class="chips" style="margin-bottom:12px">${list.map(([k, l]) => `<button type="button" data-${attr}="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const methodOpts = sel => ['Bank transfer', 'Cash', 'Fawran', 'Cheque', 'Card'].map(m => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('');
  const accOpts = sel => window.bankAccOptions ? bankAccOptions(sel || '') : '<option value="">Automatic</option>';
  const statusBadge = r => r.status === 'Paid' ? '<span class="badge b-green">Paid</span>' : r.status === 'Approved' ? '<span class="badge b-orange">Approved · not paid</span>' : '<span class="badge b-grey">Draft</span>';

  /* ---------- Payroll tab ---------- */
  function viewPayroll() {
    ensure();
    const tab = state.payTab || 'runs';
    setTop('Payroll', tab === 'emps' ? '+ Employee' : tab === 'adv' ? '+ Advance' : '+ Run payroll', () => tab === 'emps' ? editEmployee() : tab === 'adv' ? editAdvance() : newRun());
    const act = db.employees.filter(e => !e.left || e.left >= today());
    const monthly = act.reduce((s, e) => s + fixedPay(e), 0);
    const bal = window.ledgerBalances ? ledgerBalances('9999-12-31') : {};
    let body = '';
    if (tab === 'runs') {
      const runs = db.payruns.slice().sort((a, b) => b.month.localeCompare(a.month));
      body = runs.length ? `<div class="list">${runs.map(r => `<button type="button" class="item" data-run="${r.id}"><div class="main"><div class="t">${monthLabel(r.month)}</div><div class="s">${esc(r.number)} · ${(r.lines || []).length} employees${r.paid ? ' · paid ' + dfmt(r.paid.date) : ''}</div></div><div class="r"><div class="amt">${fmt(runTot(r, 'net'))}</div>${statusBadge(r)}</div></button>`).join('')}</div>`
        : `<div class="list"><div class="empty">No payroll yet. Add your employees, then tap “+ Run payroll”.</div></div>`;
    } else if (tab === 'emps') {
      const list = db.employees.slice().sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0) || String(a.no || a.name).localeCompare(String(b.no || b.name)));
      body = list.length ? `<div class="list">${list.map(e => `<button type="button" class="item" data-emp="${e.id}"><div class="main"><div class="t">${esc(e.name)}${e.left && e.left < today() ? ' <span class="badge b-grey">Left</span>' : ''}</div><div class="s">${esc([e.no, e.job, e.nat].filter(Boolean).join(' · '))}</div></div><div class="r"><div class="amt">${fmt(fixedPay(e))}</div><div class="hint">per month</div></div></button>`).join('')}</div>`
        : `<div class="list"><div class="empty">No employees yet.</div></div>`;
    } else if (tab === 'adv') {
      const list = txOf('adv').sort((a, b) => b.date.localeCompare(a.date));
      body = `<p class="hint">Salary advances and loans to staff. Recover them through the monthly payroll (Advance deduction).</p>` + (list.length ? `<div class="list">${list.map(x => `<button type="button" class="item" data-tx="${x.id}"><div class="main"><div class="t">${esc((empById(x.empId) || {}).name || '—')}</div><div class="s">${dfmt(x.date)} · ${esc(x.method || '')}${x.note ? ' · ' + esc(x.note) : ''} · balance ${fmt(advBal(x.empId))}</div></div><div class="r"><div class="amt">${fmt(x.amount)}</div></div></button>`).join('')}</div>` : `<div class="list"><div class="empty">No advances.</div></div>`);
    } else {
      const list = db.employees.filter(e => gratOn(e));
      const rows = list.map(e => { const g = gratuity(e, e.left || today(), true), pv = gratProv(e.id); return [esc(e.name) + (e.left ? ' <span class="hint">(left)</span>' : ''), e.join ? dfmt(e.join) : '—', g.years.toFixed(2), fmt(g.amount), fmt(pv), fmt(g.amount - pv)]; });
      body = `<p class="hint">End of service gratuity: ${gratDays()} days of final basic salary for each year of service, payable after one full year. “Accrued” is the amount earned so far, used for the provision in your books.</p>
        ${TB([['Employee'], ['Joined'], ['Years', 1], ['Accrued', 1], ['Provision', 1], ['Shortfall', 1]], rows, list.length ? ['Total', '', '', fmt(list.reduce((s, e) => s + gratuity(e, e.left || today(), true).amount, 0)), fmt(list.reduce((s, e) => s + gratProv(e.id), 0)), ''] : null, false, 'No employees with gratuity.')}
        <div class="btns" style="margin-top:12px">${btn('gTop', 'Top up provision to accrued')}${btn('gSettle', 'Final settlement (leaving employee)')}</div>`;
    }
    $('#main').innerHTML = `
      ${KP([['Active employees', String(act.length), '', true], ['Monthly salaries', fmt(monthly)], ['Social insurance due', fmt(bal[A(2420)] || 0), 'var(--yellow)'], ['Gratuity provision', fmt(bal[A(2400)] || 0)]])}
      <div style="margin-top:12px">${chips(tab, [['runs', 'Payroll runs'], ['emps', 'Employees'], ['adv', 'Advances'], ['grat', 'Gratuity']], 'pt')}</div>
      ${body}
      <p class="hint" style="margin-top:16px">Qatar: no income tax on salaries. Social insurance applies to Qatari staff (7% employee + 14% employer, pay GRSIA by the 5th). Pay wages through WPS by the 7th of the next month.</p>`;
    $$('#main [data-pt]').forEach(b => b.onclick = () => { state.payTab = b.dataset.pt; render(); });
    $$('#main [data-run]').forEach(b => b.onclick = () => viewRun(b.dataset.run));
    $$('#main [data-emp]').forEach(b => b.onclick = () => viewEmployee(b.dataset.emp));
    $$('#main [data-tx]').forEach(b => b.onclick = () => openTx(db.paytx.find(x => x.id === b.dataset.tx)));
    const gt = $('#gTop'); if (gt) gt.onclick = topUpGratuity;
    const gs = $('#gSettle'); if (gs) gs.onclick = () => pickEmp('Final settlement – choose employee', db.employees.filter(e => !txOf('settle').some(x => x.empId === e.id)), e => settlement(e.id));
  }

  function pickEmp(title, list, cb) {
    if (!list.length) { toast('No employees'); return; }
    openSheet(title, `<div class="list">${list.map(e => `<button type="button" class="item" data-pe="${e.id}"><div class="main"><div class="t">${esc(e.name)}</div><div class="s">${esc([e.no, e.job].filter(Boolean).join(' · '))}</div></div></button>`).join('')}</div>`, el => {
      el.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => closeSheet(() => cb(empById(b.dataset.pe))));
    });
  }

  /* ---------- employees ---------- */
  function editEmployee(id, after) {
    const e = id ? empById(id) : {nat: 'Expatriate', join: today(), pay: 'WPS'};
    const nextNo = 'E' + String(db.employees.length + 1).padStart(3, '0');
    const f = (n, l, v, t, ph, x) => `<label class="f"><span>${l}</span><input class="in" name="${n}" ${t ? `type="${t}"` : ''} ${t === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''} value="${esc(v === undefined || v === null ? '' : v)}" placeholder="${esc(ph || '')}" ${x || ''}></label>`;
    const [se, sr] = siRates(e);
    openSheet(id ? 'Edit employee' : 'New employee', `
      <form id="empForm" autocomplete="off">
        ${f('name', 'Full name *', e.name, '', 'As on QID', 'required')}
        <div class="row">${f('no', 'Employee no.', e.no || (id ? '' : nextNo))}${f('job', 'Designation', e.job, '', 'e.g. Technician')}</div>
        <div class="row"><label class="f"><span>Nationality type</span><select class="in" name="nat" id="eNat">${NAT.map(n => `<option ${e.nat === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${f('country', 'Nationality', e.country, '', 'e.g. India')}</div>
        <div class="row">${f('qid', 'QID number', e.qid, '', '11 digits')}${f('visa', 'Visa / passport no.', e.visa)}</div>
        <div class="row">${f('join', 'Joining date', e.join, 'date')}${f('left', 'Last working day (if left)', e.left, 'date')}</div>
        ${f('phone', 'Mobile', e.phone, 'tel', '5xxxxxxx')}
        <div class="sec"><h2>Monthly salary (QAR)</h2></div>
        <div class="row">${f('basic', 'Basic salary *', e.basic, 'number', '', 'required')}${f('housing', 'Housing allowance', e.housing, 'number')}</div>
        <div class="row">${f('transport', 'Transport allowance', e.transport, 'number')}${f('food', 'Food allowance', e.food, 'number')}</div>
        ${f('other', 'Other fixed allowance', e.other, 'number')}
        <p class="hint" style="margin-top:-4px">Qatar minimum wage: QAR 1,000 basic, plus QAR 300 food and QAR 500 housing when the employer does not provide them.</p>
        <div class="sec"><h2>Payment (WPS)</h2></div>
        <div class="row"><label class="f"><span>Paid by</span><select class="in" name="pay">${['WPS', 'Cash'].map(m => `<option ${e.pay === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>${f('bank', 'Bank short name', e.bank, '', 'e.g. QNB, CBQ, DUKHAN')}</div>
        ${f('iban', 'IBAN / account no.', e.iban, '', 'QA…')}
        <div class="sec"><h2>Social insurance & gratuity</h2></div>
        <div class="row">${f('siEmp', 'SI employee %', se, 'number')}${f('siEr', 'SI employer %', sr, 'number')}</div>
        ${f('siBase', 'SI contribution salary (blank = basic + housing)', e.siBase, 'number', 'max 100,000')}
        <p class="hint" style="margin-top:-4px" id="eSiHint"></p>
        <label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="grat" id="eGrat" ${gratOn(e) ? 'checked' : ''} style="width:20px;height:20px"><span style="margin:0;color:var(--text)">End of service gratuity (${gratDays()} days basic per year)</span></label>
        <label class="f"><span>Notes</span><textarea class="in" name="notes">${esc(e.notes || '')}</textarea></label>
        <button class="btn pri full" type="submit">Save employee</button>
      </form>`, el => {
      const nat = el.querySelector('#eNat');
      const hint = () => { el.querySelector('#eSiHint').textContent = nat.value === 'Qatari' ? 'Qatari: 7% employee + 14% employer to GRSIA. No gratuity under the Labour Law (covered by pension).' : nat.value === 'GCC national' ? 'GCC national: enter the rates of the home country scheme (paid through GRSIA).' : 'Expatriate: no social insurance. Gratuity applies.'; };
      nat.onchange = () => { const [a, b] = SI_DEF[nat.value]; el.querySelector('[name=siEmp]').value = a; el.querySelector('[name=siEr]').value = b; el.querySelector('#eGrat').checked = nat.value !== 'Qatari'; hint(); };
      hint();
      el.querySelector('#empForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        const rec = {name: v.name.trim(), no: v.no.trim(), job: v.job.trim(), nat: v.nat, country: v.country.trim(), qid: v.qid.trim(), visa: v.visa.trim(), join: v.join, left: v.left || '', phone: v.phone.trim(),
          basic: r2(v.basic), housing: r2(v.housing), transport: r2(v.transport), food: r2(v.food), other: r2(v.other), pay: v.pay, bank: v.bank.trim().toUpperCase(), iban: v.iban.replace(/\s+/g, '').toUpperCase(),
          siEmp: num(v.siEmp), siEr: num(v.siEr), siBase: v.siBase ? r2(v.siBase) : '', grat: !!v.grat, notes: v.notes};
        let saved;
        if (id) { Object.assign(e, rec, {updated: Date.now()}); saved = e; } else { saved = Object.assign({id: uid(), created: String(Date.now())}, rec); db.employees.push(saved); }
        save(); closeSheet(() => { if (after) after(saved); else if (state.tab === 'payroll') render(); toast('Employee saved'); });
      };
    });
  }

  function viewEmployee(id) {
    const e = empById(id); if (!e) return;
    const g = gratuity(e, e.left || today()), ga = gratuity(e, e.left || today(), true);
    const slips = db.payruns.filter(r => (r.lines || []).some(l => l.empId === id)).sort((a, b) => b.month.localeCompare(a.month));
    const [se, sr] = siRates(e);
    openSheet(e.name, `
      <div class="card"><b>${esc(e.name)}</b><div class="hint">${esc([e.no, e.job, e.country || e.nat].filter(Boolean).join(' · '))}</div>
        <div class="hint">${e.qid ? 'QID ' + esc(e.qid) + ' · ' : ''}Joined ${e.join ? dfmt(e.join) : '—'}${e.left ? ' · Left ' + dfmt(e.left) : ''}</div></div>
      <div class="btns" style="margin-bottom:12px">${btn('eEdit', ICON.edit + 'Edit')}${btn('eAdv', 'Give advance')}${btn('eSet', 'Final settlement')}</div>
      ${TB([['Monthly pay'], ['QAR', 1]], [['Basic salary', fmt(e.basic)], ['Housing', fmt(e.housing)], ['Transport', fmt(e.transport)], ['Food', fmt(e.food)], ['Other', fmt(e.other)]], ['Total', fmt(fixedPay(e))], false)}
      ${KP([['Gratuity (legal, today)', fmt(g.amount)], ['Accrued gratuity', fmt(ga.amount)], ['Service', ga.years.toFixed(2) + ' yrs'], ['Annual leave', leaveDays(e) + ' days / yr'], ['Advance balance', fmt(advBal(id)), 'var(--yellow)'], ['Social insurance', se || sr ? `${se}% + ${sr}%` : 'Not covered']])}
      <div class="sec"><h2>Payslips</h2></div>
      ${slips.length ? `<div class="list">${slips.map(r => { const l = r.lines.find(x => x.empId === id); return `<button type="button" class="item" data-slip="${r.id}"><div class="main"><div class="t">${monthLabel(r.month)}</div><div class="s">${esc(r.number)}</div></div><div class="r"><div class="amt">${fmt(l.net)}</div>${statusBadge(r)}</div></button>`; }).join('')}</div>` : '<div class="list"><div class="empty">No payslips yet.</div></div>'}
      <div class="btns" style="margin-top:14px">${btn('eDel', ICON.trash + 'Delete employee', 'danger')}</div>`, el => {
      el.querySelector('#eEdit').onclick = () => closeSheet(() => editEmployee(id, () => viewEmployee(id)));
      el.querySelector('#eAdv').onclick = () => closeSheet(() => editAdvance(null, id));
      el.querySelector('#eSet').onclick = () => closeSheet(() => settlement(id));
      el.querySelectorAll('[data-slip]').forEach(b => b.onclick = () => payslip(b.dataset.slip, id));
      el.querySelector('#eDel').onclick = () => {
        if (db.payruns.some(r => (r.lines || []).some(l => l.empId === id)) || db.paytx.some(x => x.empId === id)) { toast('This employee has payroll history. Set a last working day instead.'); return; }
        if (!confirm('Delete ' + e.name + '?')) return;
        db.employees = db.employees.filter(x => x.id !== id); save(); closeSheet(() => render());
      };
    });
  }

  /* ---------- payroll run ---------- */
  function newRun() {
    ensure();
    if (!db.employees.length) { toast('Add your employees first'); state.payTab = 'emps'; render(); editEmployee(); return; }
    const done = new Set(db.payruns.map(r => r.month));
    let ym = thisMonth(); if (done.has(ym)) { const [y, m] = ym.split('-').map(Number); ym = m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); }
    openSheet('Run payroll', `
      <form id="nrForm"><label class="f"><span>Salary month</span><input class="in" type="month" name="month" value="${ym}" required></label>
      <p class="hint">All employees working in that month are added with their fixed salary. Part months (joined or left) are set as unpaid days. You can then enter overtime, bonuses, leave and deductions.</p>
      <button class="btn pri full" type="submit">Continue</button></form>`, el => {
      el.querySelector('#nrForm').onsubmit = ev => {
        ev.preventDefault(); const m = formData(ev.target).month;
        if (db.payruns.some(r => r.month === m)) { toast('Payroll for ' + monthLabel(m) + ' already exists'); return; }
        const list = activeIn(m); if (!list.length) { toast('No employees working in ' + monthLabel(m)); return; }
        const r = {month: m, date: monthEnd(m), lines: list.map(e => lineFor(e, m)), status: 'Draft'};
        closeSheet(() => editRun(null, r));
      };
    });
  }

  function editRun(id, fresh) {
    const ex = id ? db.payruns.find(r => r.id === id) : null;
    const draft = JSON.parse(JSON.stringify(ex || fresh));
    const num0 = v => v === 0 || v === '0' ? '' : v;
    openSheet((ex ? 'Edit ' : 'Payroll · ') + monthLabel(draft.month), `
      <form id="runForm" autocomplete="off">
        <div class="row"><label class="f"><span>Posting date</span><input class="in" type="date" name="date" value="${esc(draft.date)}"></label><label class="f"><span>Add employee</span><select class="in" id="rAdd"><option value="">—</option>${db.employees.filter(e => !draft.lines.some(l => l.empId === e.id)).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label></div>
        <p class="hint">Overtime: 125% of basic hourly rate (basic ÷ 30 ÷ 8) for normal days, 150% for nights (9pm–6am), Fridays and public holidays.</p>
        <div id="rLines"></div>
        <div class="tot" id="rTot"></div>
        <label class="f" style="margin-top:12px"><span>Notes</span><textarea class="in" name="notes">${esc(draft.notes || '')}</textarea></label>
        <div class="btns">${btn('rDraft', 'Save draft')}<button class="btn pri" type="submit">Approve &amp; post</button></div>
      </form>`, el => {
      const box = el.querySelector('#rLines');
      const fld = (k, l, v, i) => `<label><span class="hint">${l}</span><input class="in" data-k="${k}" type="number" step="any" min="0" inputmode="decimal" value="${num0(v)}" placeholder="0"></label>`;
      const sumHTML = l => `<div class="sum"><span>Fixed <b>${fmt(l.fixed)}</b></span>${l.unpaidDed ? `<span>Unpaid leave <b>−${fmt(l.unpaidDed)}</b></span>` : ''}${l.ot ? `<span>Overtime <b>${fmt(l.ot)}</b></span>` : ''}<span>Gross <b>${fmt(l.gross)}</b></span>${l.siEmpAmt ? `<span>SI 7% <b>−${fmt(l.siEmpAmt)}</b></span>` : ''}${num(l.adv) ? `<span>Advance <b>−${fmt(l.adv)}</b></span>` : ''}${num(l.ded) ? `<span>Deduction <b>−${fmt(l.ded)}</b></span>` : ''}<span class="net" style="margin-left:auto">Net ${fmt(l.net)}</span></div>`;
      const draw = () => {
        box.innerHTML = draft.lines.map((l, i) => { const ab = advBal(l.empId, ex && ex.id); return `<div class="prl" data-i="${i}">
          <div class="ph"><b>${esc(l.name)}</b><button type="button" class="lnk" data-rm="${i}" style="color:var(--red)">Remove</button></div>
          <div class="g4">${fld('unpaid', 'Unpaid leave days', l.unpaid)}${fld('otN', 'OT hrs 125%', l.otN)}${fld('otH', 'OT hrs 150%', l.otH)}${fld('bonus', 'Bonus / extra', l.bonus)}
          ${fld('adv', 'Advance deduction' + (ab > 0 ? ` (bal ${fmt(ab)})` : ''), l.adv)}${fld('ded', 'Other deduction', l.ded)}<label style="grid-column:span 2"><span class="hint">Deduction reason</span><input class="in" data-k="dedNote" value="${esc(l.dedNote || '')}" placeholder="e.g. absence, damage"></label></div>
          <div class="lsum">${sumHTML(l)}</div></div>`; }).join('') || '<div class="list"><div class="empty">No employees in this run.</div></div>';
        tot();
      };
      const tot = () => {
        const s = k => runTot(draft, k);
        el.querySelector('#rTot').innerHTML = `<div><span>Gross salaries</span><span>${fmt(s('gross'))}</span></div>${s('siEmpAmt') + s('siErAmt') ? `<div><span>Social insurance (employee ${fmt(s('siEmpAmt'))} + employer ${fmt(s('siErAmt'))})</span><span>${fmt(s('siEmpAmt') + s('siErAmt'))}</span></div>` : ''}${s('gratAmt') ? `<div><span>Gratuity provision this month</span><span>${fmt(s('gratAmt'))}</span></div>` : ''}<div class="g"><span>Net pay (WPS)</span><span>${money(s('net'))}</span></div>`;
      };
      box.addEventListener('input', ev => {
        const card = ev.target.closest('[data-i]'); const k = ev.target.dataset.k; if (!card || !k) return;
        const l = draft.lines[+card.dataset.i];
        l[k] = k === 'dedNote' ? ev.target.value : ev.target.value;
        if (k === 'unpaid' && num(l.unpaid) > 30) l.unpaid = 30;
        calcLine(l); card.querySelector('.lsum').innerHTML = sumHTML(l); tot();
      });
      box.addEventListener('click', ev => { const b = ev.target.closest('[data-rm]'); if (!b) return; draft.lines.splice(+b.dataset.rm, 1); draw(); });
      el.querySelector('#rAdd').onchange = ev => { const e = empById(ev.target.value); if (!e) return; draft.lines.push(lineFor(e, draft.month)); ev.target.querySelector(`option[value="${e.id}"]`).remove(); ev.target.value = ''; draw(); };
      const store = status => {
        const v = formData(el.querySelector('#runForm'));
        draft.date = v.date || monthEnd(draft.month); draft.notes = v.notes;
        draft.lines.forEach(l => { ['unpaid', 'otN', 'otH', 'bonus', 'adv', 'ded'].forEach(k => l[k] = num(l[k])); calcLine(l); });
        if (!draft.lines.length) { toast('Add at least one employee'); return; }
        const bad = draft.lines.find(l => l.net < 0); if (bad) { toast(bad.name + ': deductions are more than the salary'); return; }
        if (status !== 'Draft') { const over = draft.lines.find(l => num(l.adv) > advBal(l.empId, ex && ex.id) + 0.004); if (over) { toast(over.name + ': advance deduction is more than the advance balance'); return; } }
        let saved;
        if (ex) { Object.assign(ex, draft, {status: ex.paid ? 'Paid' : status, updated: Date.now()}); saved = ex; }
        else { saved = Object.assign(draft, {id: uid(), number: 'PAY-' + draft.month, created: String(Date.now()), status}); db.payruns.push(saved); }
        save(); closeSheet(() => { viewRun(saved.id); toast(status === 'Draft' ? 'Draft saved' : 'Payroll approved and posted'); if (state.tab === 'payroll') render(); });
      };
      el.querySelector('#rDraft').onclick = () => store('Draft');
      el.querySelector('#runForm').onsubmit = ev => { ev.preventDefault(); store('Approved'); };
      draw();
    });
  }

  function viewRun(id) {
    const r = db.payruns.find(x => x.id === id); if (!r) return;
    const s = k => runTot(r, k), si = s('siEmpAmt') + s('siErAmt');
    const rows = r.lines.map(l => [`<button type="button" class="lnk" data-slip="${l.empId}">${esc(l.name)}</button>`, fmt(l.fixed), fmt(num(l.ot) + num(l.bonus)), fmt(num(l.unpaidDed)), fmt(num(l.siEmpAmt) + num(l.adv) + num(l.ded)), `<b>${fmt(l.net)}</b>`]);
    openSheet(r.number + ' · ' + monthLabel(r.month), `
      <div class="card" style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${monthLabel(r.month)}</b><div class="hint">${r.lines.length} employees · posted ${dfmt(r.date)}${r.paid ? ' · salaries paid ' + dfmt(r.paid.date) : ''}${r.siPaid ? ' · SI paid ' + dfmt(r.siPaid.date) : ''}</div></div>${statusBadge(r)}</div>
      <div class="btns" style="margin-bottom:12px">
        ${r.status === 'Draft' ? btn('rvApprove', 'Approve & post', 'pri') : ''}
        ${r.status === 'Approved' ? btn('rvPay', ICON.pay + 'Pay salaries', 'pri') : ''}
        ${posted(r) && si > 0 && !r.siPaid ? btn('rvSi', 'Pay social insurance') : ''}
        ${btn('rvSif', ICON.dl + 'WPS SIF file')}
        ${btn('rvReg', ICON.print + 'Payroll register')}
        ${!r.paid ? btn('rvEdit', ICON.edit + 'Edit') : ''}
        ${r.paid ? btn('rvUnpay', 'Undo payment') : ''}
        ${btn('rvDel', ICON.trash + 'Delete', 'danger')}
      </div>
      ${TB([['Employee'], ['Fixed', 1], ['OT & bonus', 1], ['Unpaid', 1], ['Deductions', 1], ['Net', 1]], rows, ['Total', fmt(s('fixed')), fmt(s('ot') + s('bonus')), fmt(s('unpaidDed')), fmt(s('siEmpAmt') + s('adv') + s('ded')), `<b>${fmt(s('net'))}</b>`], false)}
      ${KP([['Gross pay', fmt(s('gross'))], ['Net pay (WPS)', fmt(s('net')), '', true], ['Social insurance', fmt(si)], ['Gratuity provision', fmt(s('gratAmt'))]])}
      <p class="hint">Tap a name for the payslip. WPS: pay by ${dfmt(nextMonthDay(r.month, 7))}.${si ? ' Social insurance: pay GRSIA by ' + dfmt(nextMonthDay(r.month, 5)) + '.' : ''}</p>`, el => {
      const reopen = () => reopenWith(() => viewRun(id));
      el.querySelectorAll('[data-slip]').forEach(b => b.onclick = () => payslip(id, b.dataset.slip));
      const on = (q, fn) => { const b = el.querySelector(q); if (b) b.onclick = fn; };
      on('#rvApprove', () => { const over = r.lines.find(l => num(l.adv) > advBal(l.empId, r.id) + 0.004); if (over) { toast(over.name + ': advance deduction is more than the advance balance'); return; } r.status = 'Approved'; save(); reopen(); toast('Payroll posted'); });
      on('#rvEdit', () => closeSheet(() => editRun(id)));
      on('#rvPay', () => payForm('Pay salaries · ' + monthLabel(r.month), s('net'), r.month + '-28' > today() ? today() : nextMonthDay(r.month, 1), (date, method, acc) => { r.paid = {date, method, acc}; r.status = 'Paid'; save(); closeSheet(() => { reopen(); toast('Salaries marked paid'); }); }));
      on('#rvSi', () => payForm('Pay social insurance (GRSIA) · ' + monthLabel(r.month), si, today(), (date, method, acc) => { r.siPaid = {date, method, acc}; save(); closeSheet(() => { reopen(); toast('Social insurance payment saved'); }); }));
      on('#rvUnpay', () => { if (!confirm('Undo the salary payment?')) return; delete r.paid; r.status = 'Approved'; save(); reopen(); });
      on('#rvSif', () => sifExport(r));
      on('#rvReg', () => printHTML(paper('Payroll register', 'كشف الرواتب', monthLabel(r.month), registerBody(r)), 'FitX Payroll ' + r.month));
      on('#rvDel', () => { if (!confirm('Delete payroll ' + monthLabel(r.month) + '? Its accounting entries will be removed.')) return; db.payruns = db.payruns.filter(x => x.id !== id); save(); closeSheet(() => render()); toast('Deleted'); });
    });
  }

  function payForm(title, amount, date, cb) {
    openSheet(title, `<form id="pfForm">
      <p class="hint">Amount: <b style="color:var(--text)">${money(amount)}</b></p>
      <label class="f"><span>Date paid</span><input class="in" type="date" name="date" value="${date}" required></label>
      <label class="f"><span>Method</span><select class="in" name="method">${methodOpts('Bank transfer')}</select></label>
      <label class="f"><span>Paid from</span><select class="in" name="acc">${accOpts('')}</select></label>
      <button class="btn pri full" type="submit">Save payment</button></form>`, el => {
      el.querySelector('#pfForm').onsubmit = ev => { ev.preventDefault(); const v = formData(ev.target); cb(v.date, v.method, v.acc || ''); };
    });
  }

  /* ---------- payslip / register (PDF) ---------- */
  const paper = (title, ar, sub, body) => reportPaper(title, ar, sub, `<div class="slip">${body}</div>`);
  function slipBody(r, l, e) {
    const er = [['Basic salary', l.basic], ['Housing allowance', l.housing], ['Transport allowance', l.transport], ['Food allowance', l.food], ['Other allowance', l.other], ['Overtime (' + [num(l.otN) && num(l.otN) + ' h @125%', num(l.otH) && num(l.otH) + ' h @150%'].filter(Boolean).join(', ') + ')', l.ot], ['Bonus / extra', l.bonus]].filter(x => num(x[1]));
    const dd = [['Unpaid leave (' + num(l.unpaid) + ' days)', l.unpaidDed], ['Social insurance (GRSIA ' + num(l.siEmp) + '%)', l.siEmpAmt], ['Advance recovery', l.adv], ['Other deduction' + (l.dedNote ? ' – ' + l.dedNote : ''), l.ded]].filter(x => num(x[1]));
    const t = (h, rows, tl, tv) => `<table><thead><tr><th>${h}</th><th class="n">QAR</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x[0])}</td><td class="n">${fmt(x[1])}</td></tr>`).join('') || '<tr><td colspan="2" style="color:#888">None</td></tr>'}</tbody><tfoot><tr><td><b>${tl}</b></td><td class="n"><b>${fmt(tv)}</b></td></tr></tfoot></table>`;
    return `<table class="eqt"><tbody>
        <tr><td><b>Employee</b></td><td>${esc(e.name || l.name)}</td><td><b>Employee no.</b></td><td>${esc(e.no || '')}</td></tr>
        <tr><td><b>Designation</b></td><td>${esc(e.job || '')}</td><td><b>QID</b></td><td>${esc(e.qid || '')}</td></tr>
        <tr><td><b>Pay period</b></td><td>${monthLabel(r.month)}</td><td><b>Payment</b></td><td>${esc(e.pay === 'Cash' ? 'Cash' : [e.bank, e.iban].filter(Boolean).join(' · ') || 'WPS')}</td></tr>
      </tbody></table>
      <div class="two">${t('Earnings', er, 'Total earnings', num(l.fixed) + num(l.ot) + num(l.bonus))}${t('Deductions', dd, 'Total deductions', num(l.unpaidDed) + num(l.siEmpAmt) + num(l.adv) + num(l.ded))}</div>
      <div class="netbox"><span>Net pay</span><span>QAR ${fmt(l.net)}</span></div>
      <p style="color:#666;font-size:10.5px;margin-top:10px">Qatar has no income tax on salaries.${num(l.siErAmt) ? ' Employer social insurance contribution this month: QAR ' + fmt(l.siErAmt) + '.' : ''} Working days basis: 30 days per month.</p>
      <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:11px"><div>Employer signature ____________</div><div>Employee signature ____________</div></div>`;
  }
  function payslip(runId, empId) {
    const r = db.payruns.find(x => x.id === runId); const l = r && r.lines.find(x => x.empId === empId); if (!l) return;
    const e = empById(empId) || {};
    const html = () => paper('Payslip', 'قسيمة الراتب', monthLabel(r.month), slipBody(r, l, e));
    const opts = () => ({html: html(), name: `Payslip ${l.name} ${r.month}`, phone: e.phone, subject: `Payslip ${monthLabel(r.month)}`, body: `Dear ${l.name},\n\nPlease find attached your payslip for ${monthLabel(r.month)}.\nNet pay: QAR ${fmt(l.net)}\n\n${S().name}`, wa: `Dear ${l.name}, your payslip for ${monthLabel(r.month)} is attached. Net pay: QAR ${fmt(l.net)}.`});
    openSheet('Payslip · ' + l.name, `<div class="btns" style="margin-bottom:12px">${btn('psShare', ICON.share + 'Share PDF', 'pri')}${btn('psWa', ICON.wa + 'WhatsApp')}${btn('psMail', ICON.mail + 'Email')}${btn('psPrint', ICON.print + 'Print')}</div><div style="overflow:auto">${html()}</div>`, el => {
      bindShare(el, 'ps', opts, () => printHTML(html(), `Payslip ${l.name} ${r.month}`));
    });
  }
  function registerBody(r) {
    const s = k => runTot(r, k);
    return `<table><thead><tr><th>#</th><th>Employee</th><th class="n">Basic</th><th class="n">Allowances</th><th class="n">OT &amp; bonus</th><th class="n">Unpaid</th><th class="n">SI</th><th class="n">Adv/Ded</th><th class="n">Net</th></tr></thead><tbody>
      ${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="n">${fmt(l.basic)}</td><td class="n">${fmt(num(l.fixed) - num(l.basic))}</td><td class="n">${fmt(num(l.ot) + num(l.bonus))}</td><td class="n">${fmt(l.unpaidDed)}</td><td class="n">${fmt(l.siEmpAmt)}</td><td class="n">${fmt(num(l.adv) + num(l.ded))}</td><td class="n"><b>${fmt(l.net)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td><b>Total</b></td><td class="n">${fmt(s('basic'))}</td><td class="n">${fmt(s('fixed') - s('basic'))}</td><td class="n">${fmt(s('ot') + s('bonus'))}</td><td class="n">${fmt(s('unpaidDed'))}</td><td class="n">${fmt(s('siEmpAmt'))}</td><td class="n">${fmt(s('adv') + s('ded'))}</td><td class="n"><b>${fmt(s('net'))}</b></td></tr></tfoot></table>
      <p style="font-size:11px;color:#555">Employer social insurance: QAR ${fmt(s('siErAmt'))} · Gratuity provision: QAR ${fmt(s('gratAmt'))} · Status: ${esc(r.status)}${r.paid ? ' on ' + dfmt(r.paid.date) : ''}</p>`;
  }

  /* ---------- WPS salary information file (SIF) ---------- */
  function sifExport(r) {
    const p = P(), s = S();
    if (!p.eid || !p.bank || !p.iban) { toast('Enter your WPS employer details first'); payrollSettings(() => sifExport(r)); return; }
    const wps = r.lines.filter(l => (empById(l.empId) || {}).pay !== 'Cash');
    const miss = wps.find(l => { const e = empById(l.empId) || {}; return !e.qid || !e.iban || !e.bank; });
    if (miss) { toast(miss.name + ': QID, bank and IBAN are needed for WPS'); return; }
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const d8 = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`, t4 = pad(now.getHours()) + pad(now.getMinutes());
    const q = v => { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const n2 = v => r2(v).toFixed(2);
    const total = wps.reduce((a, l) => a + num(l.net), 0);
    const rows = [
      ['Employer EID', 'File Creation Date', 'File Creation Time', 'Payer EID', 'Payer QID', 'Payer Bank Short Name', 'Payer IBAN', 'Salary Year and Month', 'Total Salaries', 'Total records', 'SIF Version'],
      [p.eid, d8, t4, p.payerEid || p.eid, p.payerQid || '', p.bank, p.iban, r.month.replace('-', ''), n2(total), wps.length, p.sifVer || '1'],
      ['Record Sequence', 'Employee QID', 'Employee Visa ID', 'Employee Name', 'Employee Bank Short Name', 'Employee Account', 'Salary Frequency', 'Number of Working days', 'Net Salary', 'Basic Salary', 'Extra hours', 'Extra income', 'Deductions', 'Payment Type', 'Notes / Comments'],
      ...wps.map((l, i) => { const e = empById(l.empId) || {}; return [i + 1, e.qid, e.visa || '', e.name || l.name, e.bank, e.iban, 'M', 30 - num(l.unpaid), n2(l.net), n2(l.basic), r2(num(l.otN) + num(l.otH)), n2(num(l.fixed) - num(l.basic) + num(l.ot) + num(l.bonus)), n2(num(l.unpaidDed) + num(l.siEmpAmt) + num(l.adv) + num(l.ded)), 'Normal Payment', l.dedNote || '']; })
    ];
    const csv = rows.map(x => x.map(q).join(',')).join('\r\n');
    const name = `SIF_${p.eid}_${p.bank}_${d8}_${t4}.csv`;
    const AB = window.AndroidBridge;
    if (AB && AB.saveFile) AB.saveFile(btoa(unescape(encodeURIComponent(csv))), 'text/csv', name);
    else downloadBlob(new Blob([csv], {type: 'text/csv'}), name);
    toast('WPS file saved: ' + name + (wps.length < r.lines.length ? ` (${r.lines.length - wps.length} cash-paid left out)` : ''));
  }

  function payrollSettings(after) {
    const p = P();
    openSheet('Payroll & WPS settings', `<form id="psForm" autocomplete="off">
      <label class="f"><span>Employer establishment ID (EID, from MoL)</span><input class="in" name="eid" value="${esc(p.eid || '')}"></label>
      <div class="row"><label class="f"><span>Your bank short name</span><input class="in" name="bank" value="${esc(p.bank || '')}" placeholder="e.g. QNB"></label><label class="f"><span>SIF version</span><input class="in" name="sifVer" value="${esc(p.sifVer || '1')}"></label></div>
      <label class="f"><span>Company IBAN (salaries paid from)</span><input class="in" name="iban" value="${esc(p.iban || '')}" placeholder="QA…"></label>
      <label class="f"><span>Payer QID (optional)</span><input class="in" name="payerQid" value="${esc(p.payerQid || '')}"></label>
      <label class="f"><span>Gratuity days per year of service</span><input class="in" type="number" min="21" step="1" name="gratDays" value="${esc(p.gratDays || 21)}"></label>
      <p class="hint">The law sets at least 21 days (3 weeks) of basic salary per year; use more if your contracts give more. Check the WPS file layout with your bank before the first upload.</p>
      <button class="btn pri full" type="submit">Save</button></form>`, el => {
      el.querySelector('#psForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        Object.assign(p, {eid: v.eid.trim(), bank: v.bank.trim().toUpperCase(), sifVer: v.sifVer.trim() || '1', iban: v.iban.replace(/\s+/g, '').toUpperCase(), payerQid: v.payerQid.trim(), gratDays: Math.max(21, num(v.gratDays) || 21)});
        save(); closeSheet(() => { toast('Saved'); if (after) after(); });
      };
    });
  }

  /* ---------- advances, gratuity top-up, final settlement ---------- */
  function editAdvance(x, empId) {
    const ex = x || null, v0 = ex || {empId: empId || '', date: today(), method: 'Cash', amount: ''};
    const emps = db.employees.filter(e => !e.left || e.left >= today() || e.id === v0.empId);
    if (!emps.length) { toast('Add an employee first'); return; }
    openSheet(ex ? 'Edit advance' : 'Salary advance / loan', `<form id="avForm">
      <label class="f"><span>Employee</span><select class="in" name="empId" required><option value="">Choose…</option>${emps.map(e => `<option value="${e.id}" ${e.id === v0.empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
      <div class="row"><label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0.01" inputmode="decimal" name="amount" value="${v0.amount}" required></label><label class="f"><span>Date</span><input class="in" type="date" name="date" value="${v0.date}" required></label></div>
      <div class="row"><label class="f"><span>Method</span><select class="in" name="method">${methodOpts(v0.method)}</select></label><label class="f"><span>Paid from</span><select class="in" name="acc">${accOpts(v0.acc)}</select></label></div>
      <label class="f"><span>Note</span><input class="in" name="note" value="${esc(v0.note || '')}" placeholder="e.g. Recover QAR 500 a month"></label>
      <button class="btn pri full" type="submit">Save advance</button>
      ${ex ? `<button type="button" class="btn danger full" id="avDel" style="margin-top:8px">Delete</button>` : ''}</form>`, el => {
      el.querySelector('#avForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target);
        const rec = {kind: 'adv', empId: v.empId, amount: r2(v.amount), date: v.date, method: v.method, acc: v.acc || '', note: v.note.trim()};
        if (ex) Object.assign(ex, rec, {updated: Date.now()}); else db.paytx.push(Object.assign({id: uid(), created: String(Date.now())}, rec));
        save(); closeSheet(() => { render(); toast('Advance saved'); });
      };
      const d = el.querySelector('#avDel'); if (d) d.onclick = () => { if (!confirm('Delete this advance?')) return; db.paytx = db.paytx.filter(y => y.id !== ex.id); save(); closeSheet(() => render()); };
    });
  }
  function openTx(x) {
    if (!x) return;
    if (x.kind === 'adv') return editAdvance(x);
    const e = empById(x.empId) || {};
    const label = {gtop: 'Gratuity provision top-up', settle: 'Final settlement', wht: 'Withholding tax payment', citprov: 'Corporate income tax provision', cit: 'Corporate income tax payment'}[x.kind] || 'Entry';
    openSheet(label, `<div class="card"><b>${esc(label)}</b><div class="hint">${dfmt(x.date)}${e.name ? ' · ' + esc(e.name) : ''}${x.period ? ' · ' + esc(x.kind === 'wht' ? monthLabel(x.period) : x.period) : ''}</div><div style="font-size:20px;font-weight:800;margin-top:6px">${money(x.kind === 'settle' ? x.net : x.amount)}</div></div>
      ${x.kind === 'settle' ? TB([['Item'], ['QAR', 1]], [['Gratuity', fmt(x.gratuity)], ['Leave salary', fmt(x.leavePay)], ['Other dues', fmt(x.otherPay)], ['Less advance balance', '−' + fmt(x.advRec)], ['Less other deductions', '−' + fmt(x.otherDed)]], ['Net paid', fmt(x.net)], false) : ''}
      <div class="btns" style="margin-top:12px">${x.kind === 'settle' ? btn('txPrint', ICON.print + 'Print settlement') : ''}${btn('txDel', ICON.trash + 'Delete', 'danger')}</div>`, el => {
      const pr = el.querySelector('#txPrint'); if (pr) pr.onclick = () => printHTML(paper('Final settlement', 'المخالصة النهائية', dfmt(x.date), settleBody(x, e)), 'Final settlement ' + (e.name || ''));
      el.querySelector('#txDel').onclick = () => { if (!confirm('Delete this entry?')) return; db.paytx = db.paytx.filter(y => y.id !== x.id); save(); closeSheet(() => render()); toast('Deleted'); };
    });
  }
  function topUpGratuity() {
    const date = today();
    const adds = db.employees.filter(e => gratOn(e) && !txOf('settle').some(x => x.empId === e.id)).map(e => ({e, amt: r2(gratuity(e, e.left || date, true).amount - gratProv(e.id))})).filter(x => x.amt > 0.5);
    if (!adds.length) { toast('Gratuity provision is up to date'); return; }
    if (!confirm(`Add QAR ${fmt(adds.reduce((s, x) => s + x.amt, 0))} to the gratuity provision for ${adds.length} employee(s), dated ${dfmt(date)}?`)) return;
    adds.forEach(x => db.paytx.push({id: uid(), created: String(Date.now()), kind: 'gtop', empId: x.e.id, date, amount: x.amt}));
    save(); render(); toast('Gratuity provision updated');
  }
  function settleBody(x, e) {
    return `<table class="eqt"><tbody><tr><td><b>Employee</b></td><td>${esc(e.name || '')}</td><td><b>QID</b></td><td>${esc(e.qid || '')}</td></tr>
      <tr><td><b>Joined</b></td><td>${e.join ? dfmt(e.join) : ''}</td><td><b>Last working day</b></td><td>${x.lastDay ? dfmt(x.lastDay) : ''}</td></tr>
      <tr><td><b>Service</b></td><td>${num(x.years).toFixed(2)} years</td><td><b>Final basic salary</b></td><td>QAR ${fmt(x.basic)}</td></tr></tbody></table>
      <table><thead><tr><th>Item</th><th class="n">QAR</th></tr></thead><tbody>
      <tr><td>End of service gratuity (${x.gDays} days × ${num(x.years).toFixed(2)} years × basic ÷ 30)</td><td class="n">${fmt(x.gratuity)}</td></tr>
      <tr><td>Leave salary (${num(x.leaveDaysDue)} days)</td><td class="n">${fmt(x.leavePay)}</td></tr>
      <tr><td>Other dues${x.otherNote ? ' – ' + esc(x.otherNote) : ''}</td><td class="n">${fmt(x.otherPay)}</td></tr>
      <tr><td>Less: advance balance</td><td class="n">−${fmt(x.advRec)}</td></tr>
      <tr><td>Less: other deductions</td><td class="n">−${fmt(x.otherDed)}</td></tr></tbody>
      <tfoot><tr><td><b>Net amount paid</b></td><td class="n"><b>${fmt(x.net)}</b></td></tr></tfoot></table>
      <p style="font-size:11px;margin-top:16px">I confirm I have received the above amount in full and final settlement of all my dues.</p>
      <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:11px"><div>Employer signature ____________</div><div>Employee signature ____________</div></div>`;
  }
  function settlement(empId) {
    const e = empById(empId); if (!e) return;
    if (txOf('settle').some(x => x.empId === empId)) { toast('A final settlement already exists for ' + e.name); return; }
    const last = e.left || today();
    openSheet('Final settlement · ' + e.name, `<form id="stForm">
      <label class="f"><span>Last working day</span><input class="in" type="date" name="lastDay" id="stLast" value="${last}" required></label>
      <div class="row"><label class="f"><span>Final basic salary</span><input class="in" type="number" step="0.01" name="basic" id="stBasic" value="${num(e.basic)}"></label><label class="f"><span>Unused leave days</span><input class="in" type="number" step="any" min="0" name="leave" id="stLeave" value="0"></label></div>
      <div class="row"><label class="f"><span>Other dues (QAR)</span><input class="in" type="number" step="0.01" min="0" name="otherPay" id="stOther" placeholder="0.00"></label><label class="f"><span>Other deductions (QAR)</span><input class="in" type="number" step="0.01" min="0" name="otherDed" id="stDed" placeholder="0.00"></label></div>
      <label class="f"><span>Other dues note</span><input class="in" name="otherNote" placeholder="e.g. air ticket, unpaid salary days"></label>
      <div class="tot" id="stTot"></div>
      <div class="row" style="margin-top:12px"><label class="f"><span>Payment date</span><input class="in" type="date" name="date" value="${today()}" required></label><label class="f"><span>Method</span><select class="in" name="method">${methodOpts('Bank transfer')}</select></label></div>
      <label class="f"><span>Paid from</span><select class="in" name="acc">${accOpts('')}</select></label>
      <button class="btn pri full" type="submit">Save settlement</button></form>`, el => {
      const calc = () => {
        const lastDay = el.querySelector('#stLast').value || today(), basic = num(el.querySelector('#stBasic').value);
        const g = gratuity(Object.assign({}, e, {basic}), lastDay);
        const leavePay = r2(basic / 30 * num(el.querySelector('#stLeave').value));
        const adv = Math.max(0, advBal(empId)), prov = Math.max(0, gratProv(empId));
        const otherPay = r2(el.querySelector('#stOther').value), otherDed = r2(el.querySelector('#stDed').value);
        const net = r2(g.amount + leavePay + otherPay - adv - otherDed);
        return {lastDay, basic, years: r2(g.years), gDays: gratDays(), gratuity: g.amount, eligible: g.eligible, leaveDaysDue: num(el.querySelector('#stLeave').value), leavePay, otherPay, otherDed, advRec: r2(Math.min(adv, g.amount + leavePay + otherPay)), fromProv: r2(Math.min(prov, g.amount)), net};
      };
      const draw = () => { const c = calc(); el.querySelector('#stTot').innerHTML = `<div><span>Service</span><span>${c.years.toFixed(2)} years</span></div><div><span>Gratuity${c.eligible ? '' : ' (less than 1 year – none due)'}</span><span>${fmt(c.gratuity)}</span></div><div><span>Leave salary</span><span>${fmt(c.leavePay)}</span></div>${c.otherPay ? `<div><span>Other dues</span><span>${fmt(c.otherPay)}</span></div>` : ''}${c.advRec ? `<div><span>Less advance balance</span><span>−${fmt(c.advRec)}</span></div>` : ''}${c.otherDed ? `<div><span>Less deductions</span><span>−${fmt(c.otherDed)}</span></div>` : ''}<div class="g"><span>Net to pay</span><span>${money(c.net)}</span></div>`; };
      el.querySelectorAll('input').forEach(i => i.addEventListener('input', draw)); draw();
      el.querySelector('#stForm').onsubmit = ev => {
        ev.preventDefault(); const v = formData(ev.target); const c = calc();
        c.net = r2(c.gratuity + c.leavePay + c.otherPay - c.advRec - c.otherDed);
        if (c.net < 0) { toast('Deductions are more than the dues'); return; }
        const x = Object.assign({id: uid(), created: String(Date.now()), kind: 'settle', empId, date: v.date, method: v.method, acc: v.acc || '', otherNote: v.otherNote.trim()}, c);
        db.paytx.push(x);
        e.left = c.lastDay; save();
        closeSheet(() => { render(); openTx(x); toast('Final settlement saved'); });
      };
    });
  }

  /* ---------- Qatar tax tab ---------- */
  function whtByMonth() {
    const m = {};
    db.purchases.forEach(p => { const w = purWht(p); if (!w || p.void || p.cancelled) return; const k = p.date.slice(0, 7); const o = m[k] = m[k] || {month: k, bills: [], wht: 0, paid: 0}; o.bills.push(p); o.wht += w; });
    txOf('wht').forEach(x => { const o = m[x.period] = m[x.period] || {month: x.period, bills: [], wht: 0, paid: 0}; o.paid += num(x.amount); });
    return Object.values(m).sort((a, b) => b.month.localeCompare(a.month));
  }
  function citEstimate(year) {
    const a = acct(year + '-01-01', year + '-12-31');
    const profitBefore = r2(a.net + (a.byCat['Corporate income tax'] || 0));
    const share = num(S().foreignShare);
    const taxable = Math.max(0, r2(profitBefore * share / 100));
    return {a, profitBefore, share, taxable, tax: r2(taxable * 0.10)};
  }
  function viewTax() {
    ensure();
    setTop('Qatar tax');
    const W = whtByMonth(), bal = window.ledgerBalances ? ledgerBalances('9999-12-31') : {};
    const year = state.taxYear || String(new Date().getFullYear());
    const c = citEstimate(year);
    const prov = txOf('citprov').find(x => x.period === year);
    $('#main').innerHTML = `
      ${KP([['Withholding tax owed', fmt(bal[A(2510)] || 0), 'var(--yellow)', true], ['Income tax payable', fmt(bal[A(2500)] || 0), 'var(--yellow)'], ['VAT', 'Not in force'], ['Tax on salaries', 'None']])}
      <div class="sec"><h2>Withholding tax (non-resident suppliers)</h2></div>
      <p class="hint">Deduct 5% (royalties, technical fees) or 7% (other services, commissions, interest) from payments to foreign suppliers without an office in Qatar. Set it on the supplier or on the bill. Pay it to the General Tax Authority (Dhareeba) by the 16th of the next month.</p>
      ${W.length ? `<div class="list">${W.map(o => { const due = nextMonthDay(o.month, 16), left = r2(o.wht - o.paid); return `<div class="item"><div class="main"><div class="t">${monthLabel(o.month)} · ${o.bills.length} bill${o.bills.length > 1 ? 's' : ''}</div><div class="s">Due ${dfmt(due)}${o.paid ? ' · paid ' + fmt(o.paid) : ''}${left > 0.004 && due < today() ? ' · <b style="color:var(--red)">overdue</b>' : ''}</div></div><div class="r"><div class="amt">${fmt(o.wht)}</div>${left > 0.004 ? `<button type="button" class="btn" data-whtpay="${o.month}" style="min-height:34px;padding:4px 10px">Pay ${fmt(left)}</button>` : '<span class="badge b-green">Paid</span>'}</div></div>`; }).join('')}</div>` : '<div class="list"><div class="empty">No bills with withholding tax.</div></div>'}
      <div class="sec"><h2>Corporate income tax</h2></div>
      <p class="hint">10% of taxable profit, on the share owned by non-Qatari / non-GCC partners. Qatari and GCC owned shares are exempt. File the return on Dhareeba within 4 months of the year end (30 April for a calendar year).</p>
      <div class="row"><label class="f"><span>Tax year</span><select class="in" id="tYear">${[0, 1, 2, 3].map(i => String(new Date().getFullYear() - i)).map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="f"><span>Non-Qatari / non-GCC ownership %</span><input class="in" type="number" min="0" max="100" step="0.01" id="tShare" value="${esc(S().foreignShare || 0)}"></label></div>
      ${TB([['Estimate for ' + year], ['QAR', 1]], [['Net profit before income tax (from your books)', fmt(c.profitBefore)], [`Taxable share (${c.share}%)`, fmt(c.taxable)], ['Income tax at 10%', `<b>${fmt(c.tax)}</b>`], ['Provision recorded', prov ? fmt(prov.amount) : '—']], null, false)}
      <div class="btns" style="margin-top:10px">${btn('tProv', prov ? 'Update tax provision' : 'Record tax provision')}${btn('tPay', 'Pay income tax')}</div>
      <p class="hint" style="margin-top:12px">This is an estimate from your accounting profit. Taxable profit can differ (non-deductible costs, depreciation rules, losses carried forward). Check the return with your tax advisor. VAT has not been introduced in Qatar yet, so invoices carry no VAT.</p>`;
    $$('#main [data-whtpay]').forEach(b => b.onclick = () => { const o = W.find(x => x.month === b.dataset.whtpay); payForm('Pay withholding tax · ' + monthLabel(o.month), r2(o.wht - o.paid), today(), (date, method, acc) => { db.paytx.push({id: uid(), created: String(Date.now()), kind: 'wht', period: o.month, date, method, acc, amount: r2(o.wht - o.paid)}); save(); closeSheet(() => render()); toast('Withholding tax payment saved'); }); });
    $('#tYear').onchange = ev => { state.taxYear = ev.target.value; render(); };
    $('#tShare').onchange = ev => { S().foreignShare = Math.min(100, Math.max(0, num(ev.target.value))); save(); render(); };
    $('#tProv').onclick = () => {
      if (!c.tax && !prov) { toast('No tax to record for ' + year); return; }
      if (!confirm(`Record income tax of QAR ${fmt(c.tax)} for ${year}, dated 31 Dec ${year}?`)) return;
      if (prov) Object.assign(prov, {amount: c.tax, updated: Date.now()}); else db.paytx.push({id: uid(), created: String(Date.now()), kind: 'citprov', period: year, date: year + '-12-31', amount: c.tax});
      save(); render(); toast('Tax provision recorded');
    };
    $('#tPay').onclick = () => { const owed = bal[A(2500)] || 0; if (owed <= 0.004) { toast('Record the tax provision first'); return; } payForm('Pay corporate income tax ' + year, owed, today(), (date, method, acc) => { db.paytx.push({id: uid(), created: String(Date.now()), kind: 'cit', period: year, date, method, acc, amount: owed}); save(); closeSheet(() => render()); toast('Tax payment saved'); }); };
  }

  /* ---------- reports ---------- */
  function reportPayroll() {
    openReport({title: 'Payroll summary', ar: 'ملخص الرواتب', body: (ctx, Pp) => {
      const runs = db.payruns.filter(r => posted(r) && r.date >= ctx.f && r.date <= ctx.t).sort((a, b) => a.month.localeCompare(b.month));
      const s = (r, k) => runTot(r, k);
      return TB([['Month'], ['Staff', 1], ['Gross', 1], ['SI employee', 1], ['SI employer', 1], ['Gratuity', 1], ['Net pay', 1], ['Paid', 0]],
        runs.map(r => [monthLabel(r.month), r.lines.length, fmt(s(r, 'gross')), fmt(s(r, 'siEmpAmt')), fmt(s(r, 'siErAmt')), fmt(s(r, 'gratAmt')), fmt(s(r, 'net')), r.paid ? dfmt(r.paid.date) : 'Not paid']),
        runs.length ? ['Total', '', fmt(runs.reduce((a, r) => a + s(r, 'gross'), 0)), fmt(runs.reduce((a, r) => a + s(r, 'siEmpAmt'), 0)), fmt(runs.reduce((a, r) => a + s(r, 'siErAmt'), 0)), fmt(runs.reduce((a, r) => a + s(r, 'gratAmt'), 0)), fmt(runs.reduce((a, r) => a + s(r, 'net'), 0)), ''] : null, Pp, 'No approved payroll in this period.');
    }});
  }
  function reportSI() {
    openReport({title: 'Social insurance (GRSIA)', ar: 'التأمينات الاجتماعية', body: (ctx, Pp) => {
      const rows = [];
      db.payruns.filter(r => posted(r) && r.date >= ctx.f && r.date <= ctx.t).sort((a, b) => a.month.localeCompare(b.month)).forEach(r => r.lines.filter(l => num(l.siEmpAmt) || num(l.siErAmt)).forEach(l => rows.push([monthLabel(r.month), esc(l.name), esc((empById(l.empId) || {}).qid || ''), fmt(l.siBase), fmt(l.siEmpAmt), fmt(l.siErAmt), fmt(num(l.siEmpAmt) + num(l.siErAmt)), r.siPaid ? dfmt(r.siPaid.date) : 'Due ' + dfmt(nextMonthDay(r.month, 5))])));
      return TB([['Month'], ['Employee'], ['QID'], ['Contribution salary', 1], ['Employee', 1], ['Employer', 1], ['Total', 1], ['Paid']], rows, null, Pp, 'No social insurance in this period.');
    }});
  }
  function reportGratuity() {
    openReport({title: 'End of service gratuity', ar: 'مكافأة نهاية الخدمة', period: false, body: (ctx, Pp) => {
      const list = db.employees.filter(e => gratOn(e) && !txOf('settle').some(x => x.empId === e.id));
      return TB([['Employee'], ['Joined'], ['Basic', 1], ['Years', 1], ['Legal today', 1], ['Accrued', 1], ['Provision', 1]],
        list.map(e => { const g = gratuity(e, e.left || today()), a = gratuity(e, e.left || today(), true); return [esc(e.name), e.join ? dfmt(e.join) : '', fmt(e.basic), a.years.toFixed(2), fmt(g.amount), fmt(a.amount), fmt(gratProv(e.id))]; }),
        list.length ? ['Total', '', '', '', fmt(list.reduce((s, e) => s + gratuity(e, e.left || today()).amount, 0)), fmt(list.reduce((s, e) => s + gratuity(e, e.left || today(), true).amount, 0)), fmt(list.reduce((s, e) => s + gratProv(e.id), 0))] : null, Pp, 'No employees with gratuity.');
    }});
  }
  function reportWHT() {
    openReport({title: 'Withholding tax', ar: 'ضريبة الاستقطاع', body: (ctx, Pp) => {
      const bills = db.purchases.filter(p => purWht(p) && p.date >= ctx.f && p.date <= ctx.t).sort((a, b) => a.date.localeCompare(b.date));
      return TB([['Date'], ['Bill'], ['Supplier'], ['Bill amount', 1], ['Rate', 1], ['WHT', 1], ['Due to GTA']], bills.map(p => [dfmt(p.date), esc(p.number), esc((supById(p.supplierId) || {}).name || ''), fmt(purTotal(p)), p.whtRate + '%', fmt(purWht(p)), dfmt(nextMonthDay(p.date.slice(0, 7), 16))]),
        bills.length ? ['Total', '', '', fmt(bills.reduce((s, p) => s + purTotal(p), 0)), '', fmt(bills.reduce((s, p) => s + purWht(p), 0)), ''] : null, Pp, 'No withholding tax in this period.');
    }});
  }

  /* ---------- wiring ---------- */
  window.FITX_VIEWS = Object.assign(window.FITX_VIEWS || {}, {payroll: viewPayroll, tax: viewTax});
  window.FitxPayroll = {calcLine, gratuity, advBal, gratProv, viewRun, editEmployee, payslip, sifExport, citEstimate, settlement, editRun, newRun, payrollSettings};
  if (typeof NAV_GROUP !== 'undefined') { NAV_GROUP.payroll = 'more'; NAV_GROUP.tax = 'more'; }
  const icPay = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 11h6M19 8v6"/></svg>';
  const icTax = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>';
  const side = document.querySelector('#side .si[data-tab=reports]');
  if (side) side.insertAdjacentHTML('beforebegin', `<button type="button" class="si" data-tab="payroll">${icPay}Payroll</button><button type="button" class="si" data-tab="tax">${icTax}Qatar tax</button>`);
  const origMore = window.viewMore;
  window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling; if (!list) return;
    const act = (db.employees || []).filter(e => !e.left || e.left >= today()).length;
    list.insertAdjacentHTML('beforeend', `
      <button type="button" class="item rcard" id="mPayroll"><span class="ic">${icPay}</span><div class="main"><div class="t">Payroll</div><div class="s">${act} employees · payslips, WPS, gratuity, social insurance</div></div></button>
      <button type="button" class="item rcard" id="mTax"><span class="ic">${icTax}</span><div class="main"><div class="t">Qatar tax</div><div class="s">Withholding tax, corporate income tax</div></div></button>
      <button type="button" class="item rcard" id="mPaySet"><span class="ic">${icPay}</span><div class="main"><div class="t">Payroll &amp; WPS settings</div><div class="s">Employer EID, bank, IBAN, gratuity days</div></div></button>`);
    document.getElementById('mPayroll').onclick = () => goTab('payroll');
    document.getElementById('mTax').onclick = () => goTab('tax');
    document.getElementById('mPaySet').onclick = () => payrollSettings();
  };
  if (typeof REPORTS !== 'undefined') {
    REPORTS.payroll = [icPay, 'Payroll summary', 'Gross, social insurance, gratuity and net pay by month'];
    REPORTS.si = [icPay, 'Social insurance (GRSIA)', 'Employee and employer contributions per month'];
    REPORTS.grat = [icPay, 'End of service gratuity', 'Gratuity owed and provision per employee'];
    REPORTS.wht = [icTax, 'Withholding tax', 'Tax deducted from non-resident suppliers'];
    if (typeof REPORT_GROUPS !== 'undefined') REPORT_GROUPS.push(['Payroll and tax', ['payroll', 'si', 'grat', 'wht']]);
  }
  const origLR = window.ledgerReport;
  window.ledgerReport = function (k) {
    const R = {payroll: reportPayroll, si: reportSI, grat: reportGratuity, wht: reportWHT}[k];
    if (R) { R(); return true; }
    return origLR ? origLR(k) : false;
  };
  // the cloud module hides these for technicians; also keep payroll off their screens
  const css2 = document.createElement('style');
  css2.textContent = 'body.role-tech #mPaySet{display:none!important}';
  document.head.appendChild(css2);
})();
