/* FitX Accounts — general ledger (double entry), chart of accounts, banking & reconciliation.
   Journal entries are built automatically from invoices, payments, expenses, bills, supplier payments
   and stock adjustments; manual journals, transfers and opening balances are stored in db.journals / accounts.
   Each posting: {key, date, acc, dr, cr, desc, ref, open: fn} — key is stable so bank reconciliation can tick it. */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['accounts', 'journals', 'recons']);

  const TYPES = [['asset', 'Assets', 'الأصول'], ['liability', 'Liabilities', 'الخصوم'], ['equity', 'Equity', 'حقوق الملكية'], ['income', 'Income', 'الإيرادات'], ['expense', 'Expenses', 'المصروفات']];
  const DEBIT_NATURE = t => t === 'asset' || t === 'expense';
  // default chart of accounts (fixed ids so every device creates the same ones)
  const DEFAULT_ACCOUNTS = [
    ['1000', 'Cash on hand', 'asset', 'cash'], ['1010', 'Petty cash', 'asset', 'cash'],
    ['1100', 'Bank – current account', 'asset', 'bank'],
    ['1200', 'Accounts receivable (customers)', 'asset', 'ar'], ['1300', 'Inventory – spare parts', 'asset', 'inv'],
    ['1400', 'Prepaid expenses & deposits', 'asset', ''], ['1500', 'Tools & equipment', 'asset', 'fixed'], ['1510', 'Vehicles', 'asset', 'fixed'],
    ['2000', 'Accounts payable (suppliers)', 'liability', 'ap'], ['2100', 'Accrued expenses', 'liability', ''],
    ['2200', 'Customer advances', 'liability', ''], ['2300', 'Loans', 'liability', ''], ['2400', 'End of service benefits payable', 'liability', ''],
    ['1410', 'Employee advances & loans', 'asset', ''], ['2410', 'Salaries payable', 'liability', ''], ['2420', 'Social insurance payable (GRSIA)', 'liability', ''],
    ['2500', 'Corporate income tax payable', 'liability', ''], ['2510', 'Withholding tax payable', 'liability', ''],
    ['6500', 'Salaries & wages', 'expense', 'pay'], ['6510', 'Employer social insurance', 'expense', 'pay'], ['6520', 'End of service gratuity', 'expense', 'pay'],
    ['6530', 'Overtime & bonuses', 'expense', 'pay'], ['8000', 'Corporate income tax', 'expense', 'tax'],
    ['3000', "Owner's capital", 'equity', 'capital'], ['3100', "Owner's drawings", 'equity', 'drawings'],
    ['3200', 'Retained earnings', 'equity', 're'], ['3900', 'Opening balance equity', 'equity', 'obe'],
    ['4000', 'Maintenance & repair income', 'income', 'svc'], ['4100', 'Spare parts sales', 'income', 'parts'],
    ['4200', 'AMC income', 'income', 'amc'], ['4900', 'Other income', 'income', 'other'], ['4950', 'Discounts given', 'income', 'disc'],
    ['5000', 'Cost of spare parts sold', 'expense', 'cogs'], ['5010', 'Direct job costs', 'expense', 'jobcost'],
    ['5030', 'Inventory adjustments', 'expense', 'invadj'], ['6900', 'Bank charges', 'expense', 'bankfee']
  ];
  const A = code => 'acc_' + code;
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'other';
  const METHODS = ['Cash', 'Fawran', 'Bank transfer', 'Card', 'Cheque'];

  /* ---------- accounts ---------- */
  function ensureAccounts() {
    if (!Array.isArray(db.accounts)) db.accounts = [];
    if (!Array.isArray(db.journals)) db.journals = [];
    if (!Array.isArray(db.recons)) db.recons = [];
    let changed = false;
    DEFAULT_ACCOUNTS.forEach(([code, name, type, sub]) => {
      if (!db.accounts.some(a => a.id === A(code))) { db.accounts.push({id: A(code), code, name, type, sub, system: true}); changed = true; }
    });
    // one expense account per expense category
    const cats = Array.from(new Set([...(S().expCats || []), ...db.expenses.map(x => x.category)].filter(Boolean)));
    const SEP = ' › ';
    const tops = Array.from(new Set(cats.map(c => String(c).split(SEP)[0])));
    const byCat = c => db.accounts.find(a => a.sub === 'cat' && a.cat === c);
    tops.forEach(c => {
      const id = 'acc_exp_' + slug(c);
      if (!byCat(c) && !db.accounts.some(a => a.id === id)) { db.accounts.push({id, code: nextCode('6'), name: c, type: 'expense', sub: 'cat', cat: c, system: true}); changed = true; }
    });
    cats.filter(c => String(c).includes(SEP)).forEach(c => {
      const pAcc = byCat(String(c).split(SEP)[0]);
      const id = 'acc_exp_' + slug(c), pid = pAcc ? pAcc.id : 'acc_exp_' + slug(String(c).split(SEP)[0]);
      const ex = byCat(c) || db.accounts.find(a => a.id === id);
      if (!ex) { db.accounts.push({id, code: childCode(pid), name: String(c).split(SEP).pop(), type: 'expense', sub: 'cat', cat: c, parent: pid, system: true}); changed = true; }
      else if (!ex.parent) { ex.parent = pid; changed = true; }
    });
    const st = S();
    if (!st.methodAcc) { st.methodAcc = {Cash: A(1000), Fawran: A(1100), 'Bank transfer': A(1100), Card: A(1100), Cheque: A(1100)}; changed = true; }
    return changed;
  }
  // first free code after the parent's code (6000 -> 6001, 6002 …)
  function childCode(pid) {
    const p = db.accounts.find(a => a.id === pid); if (!p) return nextCode('6');
    const used = new Set(db.accounts.map(a => String(a.code)));
    let n = Number(p.code) + 1; while (used.has(String(n)) && n % 10 !== 0) n++;
    return used.has(String(n)) ? nextCode(String(p.code)[0]) : String(n);
  }
  // accounts as a tree: each top-level account followed by its sub-accounts
  function accTree(list) {
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
    const ids = new Set(list.map(a => a.id));
    const tops = list.filter(a => !a.parent || !ids.has(a.parent)).sort(byCode);
    return tops.flatMap(t => [Object.assign({_lvl: 0}, t), ...list.filter(a => a.parent === t.id).sort(byCode).map(c => Object.assign({_lvl: 1}, c))]);
  }
  const kidsOf = id => db.accounts.filter(a => a.parent === id);
  function nextCode(prefix) {
    const used = db.accounts.map(a => String(a.code)).filter(c => c.startsWith(prefix)).map(Number).filter(n => !isNaN(n));
    let n = prefix === '6' ? 6000 : Number(prefix + '000');
    while (used.includes(n)) n += 10;
    return String(n);
  }
  const accById = id => db.accounts.find(a => a.id === id);
  const accName = id => { const a = accById(id); return a ? `${a.code} · ${a.name}` : '(deleted account)'; };
  const bankAccounts = () => db.accounts.filter(a => a.type === 'asset' && (a.sub === 'bank' || a.sub === 'cash') && !a.hidden).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const moneyAcc = (acc, method) => (acc && accById(acc)) ? acc : ((S().methodAcc || {})[method] || A(method === 'Cash' ? 1000 : 1100));
  const expAcc = cat => {
    const c = cat || 'Other';
    const hit = db.accounts.find(a => a.sub === 'cat' && a.cat === c); if (hit) return hit.id;
    const id = 'acc_exp_' + slug(c); return accById(id) ? id : (accById('acc_exp_other') ? 'acc_exp_other' : A(5010));
  };
  // renaming an expense category renames its account (history stays on the same account)
  window.onCatRename = function (key, swap) {
    if (key !== 'expCats') return;
    db.accounts.forEach(a => { if (a.sub === 'cat' && a.cat) { const n = swap(a.cat); if (n !== a.cat) { a.cat = n; a.name = n.split(' › ').pop(); } } });
  };
  window.FitxLedger = {accById, bankAccounts, moneyAcc};

  // options for "Deposit to / Paid from" selects in payment & expense forms
  window.bankAccOptions = function (sel) {
    ensureAccounts();
    return `<option value="">Automatic (by payment method)</option>` + bankAccounts().map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.bank ? ' – ' + esc(a.bank) : ''}</option>`).join('');
  };

  /* ---------- postings ---------- */
  function postings() {
    ensureAccounts();
    const P = [];
    const add = (key, date, acc, amt, desc, ref, open) => {
      amt = r2(amt); if (!amt) return;
      P.push({key, date, acc, dr: amt > 0 ? amt : 0, cr: amt < 0 ? -amt : 0, desc, ref, open});
    };
    const cn = id => (custById(id) || {}).name || '';
    const sn = id => (supById(id) || {}).name || '';
    // invoices
    db.docs.forEach(d => {
      if (d.type !== 'INV' || d.cancelled) return;
      const open = () => viewDoc(d.id);
      const who = cn(d.customerId);
      let svc = 0, parts = 0, cost = 0;
      (d.lines || []).forEach(l => { const amt = num(l.qty) * num(l.price); if (lineKind(l) === 'part') { parts += amt; cost += num(l.qty) * lineUnitCost(l); } else svc += amt; });
      const disc = r2(subTotal(d) - docTotal(d));
      const incAcc = /amc/i.test(d.jobType || '') ? A(4200) : A(4000);
      const k = 'inv:' + d.id + ':';
      add(k + 'ar', d.date, A(1200), docTotal(d), 'Invoice · ' + who, d.number, open);
      add(k + 'svc', d.date, incAcc, -svc, 'Invoice · ' + who, d.number, open);
      add(k + 'parts', d.date, A(4100), -parts, 'Invoice · ' + who, d.number, open);
      add(k + 'disc', d.date, A(4950), disc, 'Discount · ' + who, d.number, open);
      add(k + 'cogs', d.date, A(5000), cost, 'Cost of parts · ' + d.number, d.number, open);
      add(k + 'inv', d.date, A(1300), -cost, 'Parts out · ' + d.number, d.number, open);
      (d.payments || []).forEach((p, i) => {
        const acc = moneyAcc(p.acc, p.method);
        add('ip:' + d.id + ':' + i + ':b', p.date, acc, num(p.amount), `Payment · ${who} (${p.method || ''})`, d.number, open);
        add('ip:' + d.id + ':' + i + ':ar', p.date, A(1200), -num(p.amount), `Payment · ${who}`, d.number, open);
      });
    });
    // expenses
    db.expenses.forEach(x => {
      const open = () => editExpense(x.id, () => render());
      add('ex:' + x.id + ':e', x.date, expAcc(x.category), num(x.amount), x.desc || x.category, 'Expense', open);
      add('ex:' + x.id + ':b', x.date, moneyAcc(x.acc, x.method), -num(x.amount), (x.desc || x.category) + ` (${x.method || ''})`, 'Expense', open);
    });
    // bills / purchases
    (db.purchases || []).forEach(p => {
      if (p.void || p.cancelled) return;
      const open = () => viewPurchase(p.id);
      const who = sn(p.supplierId);
      let stock = 0, job = 0;
      (p.lines || []).forEach(l => { const amt = num(l.qty) * num(l.cost); const it = l.itemId && itemById(l.itemId); if (it && !it.service) stock += amt; else job += amt; });
      // supplier discount spread over stock and non-stock lines in proportion
      const g = stock + job, kf = g > 0 ? purTotal(p) / g : 0;
      const k = 'pu:' + p.id + ':';
      const stockNet = r2(stock * kf);
      add(k + 'inv', p.date, A(1300), stockNet, 'Bill · ' + who, p.number, open);
      add(k + 'job', p.date, A(5010), r2(purTotal(p) - stockNet), 'Bill · ' + who, p.number, open);
      add(k + 'ap', p.date, A(2000), -purTotal(p), 'Bill · ' + who, p.number, open);
      const wht = typeof purWht === 'function' ? purWht(p) : 0;
      if (wht) { add(k + 'whtap', p.date, A(2000), wht, `WHT ${p.whtRate}% · ` + who, p.number, open); add(k + 'wht', p.date, 'acc_2510', -wht, `WHT ${p.whtRate}% · ` + who, p.number, open); }
      (p.payments || []).forEach((x, i) => {
        add('pp:' + p.id + ':' + i + ':ap', x.date, A(2000), num(x.amount), `Paid · ${who}`, p.number, open);
        add('pp:' + p.id + ':' + i + ':b', x.date, moneyAcc(x.acc, x.method), -num(x.amount), `Paid · ${who} (${x.method || ''})`, p.number, open);
      });
    });
    // manual stock movements (opening stock, adjustments) at item cost
    db.moves.forEach(m => {
      const it = itemById(m.itemId); if (!it || it.service) return;
      const val = num(m.qty) * (m.cost !== undefined ? num(m.cost) : num(it.cost)); if (!val) return;
      const openStock = /opening/i.test(m.note || '');
      const open = () => viewItem(it.id);
      add('mv:' + m.id + ':i', m.date, A(1300), val, (m.note || 'Stock adjustment') + ' · ' + it.name, 'Stock', open);
      add('mv:' + m.id + ':o', m.date, openStock ? A(3900) : A(5030), -val, (m.note || 'Stock adjustment') + ' · ' + it.name, 'Stock', open);
    });
    // opening balances of accounts
    db.accounts.forEach(a => {
      const ob = num(a.opening); if (!ob || a.id === A(3900)) return;
      const signed = DEBIT_NATURE(a.type) ? ob : -ob;
      const date = a.openingDate || '2000-01-01';
      add('ob:' + a.id + ':a', date, a.id, signed, 'Opening balance', 'Opening', () => editAccount(a.id));
      add('ob:' + a.id + ':e', date, A(3900), -signed, 'Opening balance · ' + a.name, 'Opening', () => editAccount(a.id));
    });
    // manual journals, transfers, money in / out
    db.journals.forEach(j => {
      const open = () => editJournal(j.id);
      (j.lines || []).forEach((l, i) => add('jr:' + j.id + ':' + i, j.date, l.acc, num(l.dr) - num(l.cr), l.memo || j.memo || 'Journal', j.no || 'Journal', open));
    });
    (window.FITX_POSTERS || []).forEach(fn => { try { fn(add, A); } catch (e) { console.error(e); } });
    return P;
  }
  window.ledgerPostings = postings;

  const sumBy = (P, f) => { const m = {}; P.forEach(p => { if (f && !f(p)) return; const x = m[p.acc] || (m[p.acc] = {dr: 0, cr: 0}); x.dr += p.dr; x.cr += p.cr; }); return m; };
  // natural balance (positive = normal side) as of a date
  function balances(asOf, from) {
    const m = sumBy(postings(), p => p.date <= asOf && (!from || p.date >= from));
    const out = {};
    db.accounts.forEach(a => { const x = m[a.id] || {dr: 0, cr: 0}; out[a.id] = r2(DEBIT_NATURE(a.type) ? x.dr - x.cr : x.cr - x.dr); });
    return out;
  }
  window.ledgerBalances = balances;
  const clearedSet = () => new Set((db.recons || []).map(r => r.id));

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .bankgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-bottom:12px}
    .bankcard{background:var(--card,#fff);border:1px solid var(--line,#e5e7eb);border-radius:14px;padding:14px;text-align:left;min-height:112px;display:flex;flex-direction:column;gap:4px;box-shadow:var(--sh,none)}
    .bankcard .bt{font-weight:800;font-size:15px}.bankcard .bs{color:var(--muted,#6b7280);font-size:12px}
    .bankcard .bv{font-size:22px;font-weight:900;margin-top:auto}
    .bankcard.cash{border-top:4px solid #16a34a}.bankcard.bank{border-top:4px solid #ff6a00}
    .ltab{display:flex;gap:6px;overflow-x:auto;margin-bottom:12px}
    .ltab button{flex-shrink:0;border:1px solid var(--line,#e5e7eb);background:var(--card,#fff);border-radius:999px;padding:9px 14px;font-weight:700;color:var(--muted,#6b7280);min-height:40px}
    .ltab button.on{background:#111;color:#fff;border-color:#111}
    .acctype{margin:16px 2px 6px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#6b7280);display:flex;justify-content:space-between}
    .reg td,.reg th{font-size:13px}
    .regrow{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line,#e5e7eb);background:var(--card,#fff)}
    .regrow:last-child{border-bottom:0}
    .regrow .rd{font-size:12px;color:var(--muted,#6b7280)}
    .regrow .ra{text-align:right;font-weight:800;white-space:nowrap}
    .regrow .ra.in{color:#16a34a}.regrow .ra.out{color:#dc2626}
    .regrow .rb{font-size:11px;color:var(--muted,#6b7280);font-weight:600}
    .regrow input[type=checkbox]{width:22px;height:22px;accent-color:#16a34a}
    .jl{display:grid;grid-template-columns:1fr 92px 92px 36px;gap:6px;align-items:end;margin-bottom:8px}
    .jl .in{min-height:42px;padding:8px}
    .tbal{display:flex;justify-content:space-between;padding:10px 12px;border-radius:10px;font-weight:800;margin:8px 0}
    .tbal.ok{background:rgba(22,163,74,.1);color:#15803d}.tbal.bad{background:rgba(220,38,38,.1);color:#b91c1c}
    body.role-tech #side [data-tab=banking], body.role-tech #side [data-tab=ledger], body.role-tech #mBank, body.role-tech #mLedger{display:none!important}
    @media (max-width:560px){.jl{grid-template-columns:1fr 70px 70px 32px}}`;
  document.head.appendChild(css);

  const ic = {
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 8h6M8 12h6"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'
  };
  const sbtn = (id, icon, label, pri) => `<button type="button" class="btn${pri ? ' pri' : ''}" id="${id}">${icon}${label}</button>`;

  /* ---------- BANKING ---------- */
  window.viewBanking = function () {
    if (ensureAccounts()) save();
    setTop('Banking', '+ Account', () => editAccount(null, {type: 'asset', sub: 'bank'}));
    const bal = balances('9999-12-31');
    const cl = clearedSet(); const P = postings();
    const banks = bankAccounts();
    const total = banks.reduce((s, a) => s + bal[a.id], 0);
    $('#main').innerHTML = `
      ${KP([['Bank & cash total', fmt(total), '', true], ['Bank', fmt(banks.filter(a => a.sub === 'bank').reduce((s, a) => s + bal[a.id], 0))], ['Cash', fmt(banks.filter(a => a.sub === 'cash').reduce((s, a) => s + bal[a.id], 0))], ['Owed to you', fmt(bal[A(1200)] || 0), 'var(--yellow)']])}
      <div class="btns" style="margin:12px 0">${sbtn('bkXfer', ic.swap, 'Transfer')}${sbtn('bkIn', ic.plus, 'Money in')}${sbtn('bkOut', ic.minus, 'Money out')}${sbtn('bkMap', ic.book, 'Payment methods')}</div>
      <div class="bankgrid">${banks.map(a => {
        const unc = P.filter(p => p.acc === a.id && !cl.has(p.key)).length;
        return `<button type="button" class="bankcard ${a.sub}" data-acc="${a.id}"><div class="bt">${esc(a.name)}</div><div class="bs">${esc([a.bank, a.accNo && 'A/C ' + a.accNo].filter(Boolean).join(' · ') || (a.sub === 'cash' ? 'Cash account' : 'Bank account'))}</div><div class="bs">${unc ? unc + ' not reconciled' : 'All reconciled'}</div><div class="bv" style="color:${bal[a.id] < 0 ? 'var(--red)' : 'inherit'}">QAR ${fmt(bal[a.id])}</div></button>`;
      }).join('')}</div>
      <p class="hint">Payments you record go to the account chosen on the payment, or automatically by method (Payment methods button). Tap an account for its register and to reconcile with your bank statement.</p>`;
    $$('#main [data-acc]').forEach(b => b.onclick = () => viewRegister(b.dataset.acc));
    $('#bkXfer').onclick = () => quickMove('transfer');
    $('#bkIn').onclick = () => quickMove('in');
    $('#bkOut').onclick = () => quickMove('out');
    $('#bkMap').onclick = () => methodMap();
  };

  function viewRegister(accId, focusRecon) {
    const a = accById(accId); if (!a) return;
    const cl = clearedSet();
    const rows = postings().filter(p => p.acc === accId).sort((x, y) => (x.date + x.key).localeCompare(y.date + y.key));
    let run = 0; rows.forEach(r => { run = r2(run + (DEBIT_NATURE(a.type) ? r.dr - r.cr : r.cr - r.dr)); r.bal = run; });
    const clearedBal = r2(rows.filter(r => cl.has(r.key)).reduce((s, r) => s + (r.dr - r.cr), 0));
    const sheet = openSheet(a.name, `
      ${KP([['Balance', 'QAR ' + fmt(run), '', true], ['Reconciled balance', fmt(clearedBal)], ['Not reconciled', String(rows.filter(r => !cl.has(r.key)).length)]])}
      <div class="btns" style="margin:12px 0">${sbtn('rgRec', ic.check, 'Reconcile', true)}${sbtn('rgEdit', ICON.edit, 'Edit account')}${sbtn('rgPdf', ICON.share, 'Share PDF')}${sbtn('rgXfer', ic.swap, 'Transfer')}</div>
      <input class="search" id="rgQ" placeholder="Search register" aria-label="Search register">
      <p class="hint" style="margin:0 2px 8px">Tick ✓ = matches your bank statement.</p>
      <div class="list" id="rgList"></div>`, el => {
      const draw = () => {
        const q = (el.querySelector('#rgQ').value || '').toLowerCase();
        const list = rows.slice().reverse().filter(r => !q || (r.desc + ' ' + r.ref + ' ' + r.date).toLowerCase().includes(q));
        el.querySelector('#rgList').innerHTML = list.length ? list.slice(0, 400).map(r => `<div class="regrow"><input type="checkbox" data-k="${esc(r.key)}" ${cl.has(r.key) ? 'checked' : ''} aria-label="Reconciled"><button type="button" class="lnk" data-open="${esc(r.key)}" style="text-align:left;background:none;border:0;padding:0;color:inherit"><div style="font-weight:600">${esc(r.desc)}</div><div class="rd">${dfmt(r.date)} · ${esc(r.ref || '')}</div></button><div><div class="ra ${r.dr ? 'in' : 'out'}">${r.dr ? '+' + fmt(r.dr) : '−' + fmt(r.cr)}</div><div class="rb">${fmt(r.bal)}</div></div></div>`).join('') : '<div class="empty">No transactions yet.</div>';
        el.querySelectorAll('[data-k]').forEach(c => c.onchange = () => toggleCleared(c.dataset.k, accId, c.checked));
        el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const r = rows.find(x => x.key === b.dataset.open); if (r && r.open) r.open(); });
      };
      el.querySelector('#rgQ').oninput = draw;
      el.querySelector('#rgRec').onclick = () => reconcile(accId);
      el.querySelector('#rgEdit').onclick = () => editAccount(accId);
      el.querySelector('#rgXfer').onclick = () => quickMove('transfer', accId);
      el.querySelector('#rgPdf').onclick = () => sendPdf({html: reportPaper(a.name + ' register', '', 'All transactions to ' + dfmt(today()), registerTable(rows, true)), name: `FitX ${a.name} register ${today()}`, subject: a.name + ' register'}, 'share');
      el._refresh = () => reopenWith(() => viewRegister(accId));
      draw();
    });
    if (focusRecon) setTimeout(() => reconcile(accId), 50);
    return sheet;
  }
  function registerTable(rows, P) {
    return TB([['Date'], ['Description'], ['Ref'], ['In', 1], ['Out', 1], ['Balance', 1]], rows.map(r => [dfmt(r.date), esc(r.desc), esc(r.ref || ''), r.dr ? fmt(r.dr) : '', r.cr ? fmt(r.cr) : '', fmt(r.bal)]), null, P);
  }
  function toggleCleared(key, acc, on) {
    db.recons = (db.recons || []).filter(r => r.id !== key);
    if (on) db.recons.push({id: key, acc, at: today()});
    save();
  }
  function reconcile(accId) {
    const a = accById(accId);
    const st = (a.lastRecon || {});
    openSheet('Reconcile · ' + a.name, `
      <p class="hint">Enter the closing balance from your bank statement, then tick each item that appears on the statement. When the difference is 0.00 your books match the bank.</p>
      <div class="row">
        <label class="f"><span>Statement date</span><input class="in" type="date" id="rcDate" value="${esc(st.date || today())}"></label>
        <label class="f"><span>Statement closing balance</span><input class="in" type="number" step="0.01" inputmode="decimal" id="rcBal" value="${st.bal ?? ''}" placeholder="0.00"></label>
      </div>
      <div class="tbal" id="rcSum"></div>
      <div class="btns" style="margin-bottom:10px"><button type="button" class="btn" id="rcAll">Tick all to date</button><button type="button" class="btn pri" id="rcDone">Finish</button></div>
      <div class="list" id="rcList"></div>`, el => {
      const draw = () => {
        const dt = el.querySelector('#rcDate').value || today();
        const cl = clearedSet();
        const rows = postings().filter(p => p.acc === accId && p.date <= dt).sort((x, y) => (x.date + x.key).localeCompare(y.date + y.key));
        const clearedBal = r2(rows.filter(r => cl.has(r.key)).reduce((s, r) => s + (r.dr - r.cr), 0));
        const target = num(el.querySelector('#rcBal').value);
        const diff = r2(target - clearedBal);
        const sum = el.querySelector('#rcSum');
        sum.className = 'tbal ' + (el.querySelector('#rcBal').value !== '' && Math.abs(diff) < 0.005 ? 'ok' : 'bad');
        sum.innerHTML = `<span>Ticked balance ${fmt(clearedBal)}</span><span>Difference ${fmt(diff)}</span>`;
        const open = rows.filter(r => !cl.has(r.key));
        el.querySelector('#rcList').innerHTML = open.length ? open.reverse().map(r => `<div class="regrow"><input type="checkbox" data-k="${esc(r.key)}" aria-label="Matches statement"><div><div style="font-weight:600">${esc(r.desc)}</div><div class="rd">${dfmt(r.date)} · ${esc(r.ref || '')}</div></div><div class="ra ${r.dr ? 'in' : 'out'}">${r.dr ? '+' + fmt(r.dr) : '−' + fmt(r.cr)}</div></div>`).join('') : '<div class="empty">Everything up to this date is ticked.</div>';
        el.querySelectorAll('[data-k]').forEach(c => c.onchange = () => { toggleCleared(c.dataset.k, accId, c.checked); draw(); });
        el._rows = open;
      };
      el.querySelector('#rcDate').onchange = draw;
      el.querySelector('#rcBal').oninput = draw;
      el.querySelector('#rcAll').onclick = () => { (el._rows || []).forEach(r => db.recons.push({id: r.key, acc: accId, at: today()})); save(); draw(); };
      el.querySelector('#rcDone').onclick = () => {
        a.lastRecon = {date: el.querySelector('#rcDate').value, bal: num(el.querySelector('#rcBal').value)}; save();
        closeSheet(() => toast('Reconciliation saved'));
      };
      draw();
    });
  }

  /* transfers and quick money in/out are journals with two lines */
  function quickMove(kind, fromAcc) {
    ensureAccounts();
    const banks = bankAccounts();
    const opt = (list, sel) => list.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.code + ' · ' + a.name)}</option>`).join('');
    const others = db.accounts.filter(a => !(a.sub === 'bank' || a.sub === 'cash') && !['ar', 'ap', 'inv'].includes(a.sub)).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const title = {transfer: 'Transfer between accounts', in: 'Money in', out: 'Money out'}[kind];
    const defOther = kind === 'in' ? A(3000) : A(3100);
    openSheet(title, `
      <form id="qmForm">
        <div class="row">
          <label class="f"><span>Date</span><input class="in" type="date" name="date" value="${today()}" required></label>
          <label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" min="0.01" inputmode="decimal" name="amount" required></label>
        </div>
        ${kind === 'transfer' ? `
          <label class="f"><span>From</span><select class="in" name="from">${opt(banks, fromAcc || A(1100))}</select></label>
          <label class="f"><span>To</span><select class="in" name="to">${opt(banks, fromAcc === A(1000) ? A(1100) : A(1000))}</select></label>`
        : `
          <label class="f"><span>${kind === 'in' ? 'Into' : 'From'} account</span><select class="in" name="bank">${opt(banks, fromAcc || A(1100))}</select></label>
          <label class="f"><span>${kind === 'in' ? 'What is it?' : 'What for?'}</span><select class="in" name="other">${opt(others, defOther)}</select></label>
          <p class="hint" style="margin-top:-6px">${kind === 'in' ? "e.g. Owner's capital (you put money in), Loans, Other income." : "e.g. Owner's drawings (you took money), Bank charges, Loans repaid. For normal expenses use Expenses."}</p>`}
        <label class="f"><span>Description</span><input class="in" name="memo" placeholder="${kind === 'transfer' ? 'e.g. Cash deposited to QNB' : 'Optional'}"></label>
        <button class="btn pri full" type="submit">Save</button>
      </form>`, el => {
      el.querySelector('#qmForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target); const amt = r2(f.amount);
        let lines;
        if (kind === 'transfer') { if (f.from === f.to) { toast('Choose two different accounts'); return; } lines = [{acc: f.to, dr: amt, cr: 0}, {acc: f.from, dr: 0, cr: amt}]; }
        else if (kind === 'in') lines = [{acc: f.bank, dr: amt, cr: 0}, {acc: f.other, dr: 0, cr: amt}];
        else lines = [{acc: f.other, dr: amt, cr: 0}, {acc: f.bank, dr: 0, cr: amt}];
        const memo = f.memo.trim() || title + (kind === 'transfer' ? '' : ' · ' + (accById(f.other) || {}).name);
        db.journals.push({id: uid(), no: nextJournalNo(), date: f.date, memo, kind, lines: lines.map(l => Object.assign(l, {memo}))});
        save(); closeSheet(() => { render(); toast('Saved'); });
      };
    });
  }
  function nextJournalNo() { const s = S(); const n = s.nextJrn || 1; s.nextJrn = n + 1; return `JV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; }
  function methodMap() {
    ensureAccounts();
    const m = S().methodAcc;
    openSheet('Payment methods → accounts', `
      <p class="hint">When a payment or expense doesn't pick an account, it goes to the account set here for its method.</p>
      <form id="mmForm">${METHODS.map(x => `<label class="f"><span>${x}</span><select class="in" name="${esc(x)}">${bankAccounts().map(a => `<option value="${a.id}" ${m[x] === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`).join('')}
      <button class="btn pri full" type="submit">Save</button></form>`, el => {
      el.querySelector('#mmForm').onsubmit = e => { e.preventDefault(); S().methodAcc = Object.assign({}, m, formData(e.target)); save(); closeSheet(() => { render(); toast('Saved'); }); };
    });
  }

  /* ---------- ACCOUNTING: chart of accounts, journals, trial balance, balance sheet ---------- */
  window.viewLedger = function () {
    if (ensureAccounts()) save();
    const tab = state.ledTab || 'coa';
    setTop('Accounting', tab === 'jrn' ? '+ Journal' : '+ Account', () => tab === 'jrn' ? editJournal() : editAccount());
    const T = [['coa', 'Chart of accounts'], ['jrn', 'Journal entries'], ['tb', 'Trial balance'], ['bs', 'Balance sheet'], ['gl', 'General ledger']];
    $('#main').innerHTML = `<div class="ltab">${T.map(([k, l]) => `<button type="button" data-lt="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="ledBody"></div>`;
    $$('#main [data-lt]').forEach(b => b.onclick = () => { state.ledTab = b.dataset.lt; render(); });
    ({coa: drawCOA, jrn: drawJournals, tb: drawTB, bs: drawBS, gl: drawGL})[tab]($('#ledBody'));
  };
  function asOfPicker(id) { return `<label class="f" style="max-width:220px"><span>As of</span><input class="in" type="date" id="${id}" value="${esc(state.ledAsOf || today())}"></label>`; }
  function drawCOA(box) {
    const bal = balances('9999-12-31');
    const q = (state.coaQ || '').toLowerCase();
    box.innerHTML = `<input class="search" id="coaQ" placeholder="Search accounts" value="${esc(state.coaQ || '')}" aria-label="Search accounts">` + TYPES.map(([t, label]) => {
      const all = db.accounts.filter(a => a.type === t && !a.hidden);
      const match = a => !q || (a.code + ' ' + a.name).toLowerCase().includes(q);
      const list = accTree(all).filter(a => match(a) || kidsOf(a.id).some(match) || (a.parent && match(accById(a.parent) || {code: '', name: ''})));
      if (!list.length) return '';
      const tot = all.reduce((s, a) => s + bal[a.id], 0);
      const roll = a => r2(bal[a.id] + kidsOf(a.id).reduce((s, k) => s + bal[k.id], 0));
      return `<div class="acctype"><span>${label}</span><span>${fmt(tot)}</span></div><div class="list">${list.map(a => { const v = a._lvl ? bal[a.id] : roll(a); const hasKids = !a._lvl && kidsOf(a.id).length; return `<button type="button" class="item" data-acc="${a.id}"${a._lvl ? ' style="padding-left:30px"' : ''}><div class="main"><div class="t"${hasKids ? ' style="font-weight:800"' : ''}>${a._lvl ? '\u21b3 ' : ''}${esc(a.code)} · ${esc(a.name)}</div><div class="s">${esc(hasKids ? kidsOf(a.id).length + ' sub-accounts · total incl. sub-accounts' : subLabel(a))}</div></div><div class="r"><div class="amt" style="color:${v < 0 ? 'var(--red)' : 'inherit'}">${fmt(v)}</div></div></button>`; }).join('')}</div>`;
    }).join('');
    const qi = box.querySelector('#coaQ'); qi.oninput = () => { state.coaQ = qi.value; const pos = qi.selectionStart; drawCOA(box); const n = box.querySelector('#coaQ'); n.focus(); n.setSelectionRange(pos, pos); };
    box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => viewAccountLedger(b.dataset.acc));
  }
  const subLabel = a => ({cash: 'Cash account', bank: 'Bank account' + (a.bank ? ' · ' + a.bank : ''), ar: 'Customer balances (automatic)', ap: 'Supplier balances (automatic)', inv: 'Spare parts stock (automatic)', obe: 'Balancing account for opening balances', svc: 'From invoice service lines', parts: 'From invoice spare part lines', amc: 'Invoices with an AMC job type', disc: 'Invoice discounts', cogs: 'Cost of parts on invoices', jobcost: 'Bill lines not added to stock', invadj: 'Stock adjustments', cat: 'Expense category: ' + (a.cat || ''), capital: 'Money you put into the business', drawings: 'Money you took out', fixed: 'Long-term asset'})[a.sub] || ({asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense'})[a.type];
  function viewAccountLedger(accId) {
    const a = accById(accId);
    if (a.sub === 'bank' || a.sub === 'cash') { viewRegister(accId); return; }
    const rows = postings().filter(p => p.acc === accId).sort((x, y) => (x.date + x.key).localeCompare(y.date + y.key));
    let run = 0; rows.forEach(r => { run = r2(run + (DEBIT_NATURE(a.type) ? r.dr - r.cr : r.cr - r.dr)); r.bal = run; });
    openSheet(a.code + ' · ' + a.name, `
      ${KP([['Balance', 'QAR ' + fmt(run), '', true], ['Entries', String(rows.length)]])}
      <div class="btns" style="margin:12px 0">${sbtn('alEdit', ICON.edit, 'Edit account')}${sbtn('alPdf', ICON.share, 'Share PDF', true)}</div>
      <div class="list">${rows.length ? rows.slice().reverse().slice(0, 500).map((r, i) => `<button type="button" class="item" data-i="${rows.length - 1 - i}"><div class="main"><div class="t">${esc(r.desc)}</div><div class="s">${dfmt(r.date)} · ${esc(r.ref || '')}</div></div><div class="r"><div class="amt">${r.dr ? 'Dr ' + fmt(r.dr) : 'Cr ' + fmt(r.cr)}</div><div class="s">${fmt(r.bal)}</div></div></button>`).join('') : '<div class="empty">No entries yet.</div>'}</div>`, el => {
      el.querySelector('#alEdit').onclick = () => editAccount(accId);
      el.querySelector('#alPdf').onclick = () => sendPdf({html: reportPaper(a.code + ' ' + a.name, '', 'Account ledger to ' + dfmt(today()), TB([['Date'], ['Description'], ['Ref'], ['Debit', 1], ['Credit', 1], ['Balance', 1]], rows.map(r => [dfmt(r.date), esc(r.desc), esc(r.ref || ''), r.dr ? fmt(r.dr) : '', r.cr ? fmt(r.cr) : '', fmt(r.bal)]), null, true)), name: `FitX ledger ${a.code} ${a.name}`, subject: 'Account ledger ' + a.name}, 'share');
      el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const r = rows[+b.dataset.i]; if (r && r.open) r.open(); });
    });
  }
  function parentOpts(a) {
    const list = db.accounts.filter(x => x.type === (a.type || 'expense') && !x.parent && x.id !== a.id && !x.hidden).sort((x, y) => String(x.code).localeCompare(String(y.code)));
    return `<option value="">— None (main account) —</option>` + list.map(x => `<option value="${x.id}" ${x.id === a.parent ? 'selected' : ''}>${esc(x.code + ' · ' + x.name)}</option>`).join('');
  }
  function editAccount(id, preset) {
    ensureAccounts();
    const a = id ? accById(id) : Object.assign({type: 'expense'}, preset || {});
    const isBank = a.sub === 'bank' || a.sub === 'cash';
    openSheet(id ? 'Edit account' : 'New account', `
      <form id="acForm">
        <div class="row">
          <label class="f"><span>Code</span><input class="in" name="code" value="${esc(a.code || '')}" placeholder="auto" inputmode="numeric"></label>
          <label class="f"><span>Type</span><select class="in" name="type" ${a.system ? 'disabled' : ''}>${TYPES.map(([t, l]) => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${l.replace(/s$/, '').replace('Liabilitie', 'Liability').replace('Expense', 'Expense')}</option>`).join('')}</select></label>
        </div>
        <label class="f"><span>Name</span><input class="in" name="name" value="${esc(a.name || '')}" required placeholder="${isBank ? 'e.g. QNB current account' : 'e.g. Equipment rental income'}"></label>
        <label class="f"><span>Sub-account of</span><select class="in" name="parent" id="acPar">${parentOpts(a)}</select></label>
        ${!a.system || isBank ? `<label class="f"><span>Kind</span><select class="in" name="sub" ${a.system && !isBank ? 'disabled' : ''}><option value="">Normal</option><option value="bank" ${a.sub === 'bank' ? 'selected' : ''}>Bank account</option><option value="cash" ${a.sub === 'cash' ? 'selected' : ''}>Cash account</option><option value="fixed" ${a.sub === 'fixed' ? 'selected' : ''}>Fixed asset</option></select></label>` : ''}
        <div id="acBank" class="${isBank ? '' : 'hidden'}">
          <div class="row">
            <label class="f"><span>Bank name</span><input class="in" name="bank" value="${esc(a.bank || '')}" placeholder="e.g. QNB, CBQ, Dukhan"></label>
            <label class="f"><span>Account no.</span><input class="in" name="accNo" value="${esc(a.accNo || '')}"></label>
          </div>
          <label class="f"><span>IBAN</span><input class="in" name="iban" value="${esc(a.iban || '')}" placeholder="QA.."></label>
        </div>
        ${['ar', 'ap', 'inv', 'obe'].includes(a.sub) ? '<p class="hint">This balance is calculated from invoices, bills and stock automatically.</p>' : `
        <div class="sec"><h2>Opening balance</h2></div>
        <div class="row">
          <label class="f"><span>Amount (QAR)</span><input class="in" type="number" step="0.01" inputmode="decimal" name="opening" value="${a.opening ?? ''}" placeholder="0.00"></label>
          <label class="f"><span>As of date</span><input class="in" type="date" name="openingDate" value="${esc(a.openingDate || '')}"></label>
        </div>
        <p class="hint" style="margin-top:-6px">${isBank ? 'Your bank / cash balance on the day you started using this app.' : 'Balance on the day you started using this app (e.g. loan still owed, value of tools).'}</p>`}
        <button class="btn pri full" type="submit">Save account</button>
        ${id && !a.system ? `<button type="button" class="btn danger full" id="acDel" style="margin-top:8px">${ICON.trash}Delete account</button>` : ''}
      </form>`, el => {
      const sub = el.querySelector('[name=sub]');
      if (sub) sub.onchange = () => el.querySelector('#acBank').classList.toggle('hidden', !['bank', 'cash'].includes(sub.value));
      const ty = el.querySelector('[name=type]');
      if (ty && !a.system) ty.onchange = () => { el.querySelector('#acPar').innerHTML = parentOpts(Object.assign({}, a, {type: ty.value})); };
      el.querySelector('#acForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        const type = a.system ? a.type : (f.type || 'expense');
        const s2 = f.sub !== undefined ? f.sub : a.sub;
        if ((s2 === 'bank' || s2 === 'cash') && type !== 'asset') { toast('Bank and cash accounts must be Assets'); return; }
        const parent = f.parent || '';
        if (parent && (accById(parent) || {}).type !== type) { toast('A sub-account must be the same type as its main account'); return; }
        if (parent && id && kidsOf(id).length) { toast('This account has its own sub-accounts, so it can’t be a sub-account'); return; }
        const code = (f.code || '').trim() || (parent ? childCode(parent) : nextCode({asset: '1', liability: '2', equity: '3', income: '4', expense: '6'}[type]));
        if (db.accounts.some(x => x.code === code && x.id !== id)) { toast('Code ' + code + ' is already used'); return; }
        const data = {code, name: f.name.trim(), type, sub: s2 || '', parent, bank: (f.bank || '').trim(), accNo: (f.accNo || '').trim(), iban: (f.iban || '').trim()};
        if (!parent) delete data.parent;
        if (f.opening !== undefined) { data.opening = f.opening === '' ? 0 : r2(f.opening); data.openingDate = f.openingDate || ''; }
        if (id) Object.assign(a, data); else db.accounts.push(Object.assign({id: 'acc_' + uid()}, data));
        save(); closeSheet(() => { render(); toast('Account saved'); });
      };
      const del = el.querySelector('#acDel');
      if (del) del.onclick = () => {
        const used = postings().some(p => p.acc === id && !p.key.startsWith('ob:'));
        if (used) { toast('This account has entries — it can’t be deleted'); return; }
        if (kidsOf(id).length) { toast('Move or delete its sub-accounts first'); return; }
        if (!confirm('Delete ' + a.name + '?')) return;
        db.accounts = db.accounts.filter(x => x.id !== id); save(); closeSheet(() => closeSheet(render));
      };
    });
  }

  function drawJournals(box) {
    const list = db.journals.slice().sort((a, b) => (b.date + (b.no || '')).localeCompare(a.date + (a.no || '')));
    box.innerHTML = `<p class="hint" style="margin:0 2px 10px">Invoices, payments, expenses and bills post to the books automatically. Use journal entries for anything else — depreciation, accruals, loan interest, corrections.</p>
      <div class="list">${list.length ? list.map(j => { const t = (j.lines || []).reduce((s, l) => s + num(l.dr), 0); return `<button type="button" class="item" data-j="${j.id}"><div class="main"><div class="t">${esc(j.memo || 'Journal')}</div><div class="s">${esc(j.no || '')} · ${dfmt(j.date)} · ${(j.lines || []).map(l => esc((accById(l.acc) || {}).name || '?')).slice(0, 3).join(', ')}</div></div><div class="r"><div class="amt">${fmt(t)}</div>${j.kind ? `<span class="badge b-grey">${j.kind === 'transfer' ? 'Transfer' : j.kind === 'in' ? 'Money in' : 'Money out'}</span>` : ''}</div></button>`; }).join('') : '<div class="empty">No journal entries yet.</div>'}</div>`;
    box.querySelectorAll('[data-j]').forEach(b => b.onclick = () => editJournal(b.dataset.j));
  }
  function editJournal(id) {
    ensureAccounts();
    const j = id ? db.journals.find(x => x.id === id) : null;
    const draft = j ? JSON.parse(JSON.stringify(j)) : {date: today(), memo: '', lines: [{acc: '', dr: '', cr: ''}, {acc: '', dr: '', cr: ''}]};
    const accOpts = sel => '<option value="">— Account —</option>' + TYPES.map(([t, l]) => `<optgroup label="${l}">${accTree(db.accounts.filter(a => a.type === t && !a.hidden)).map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a._lvl ? '\u00a0\u00a0\u21b3 ' : ''}${esc(a.code + ' · ' + a.name)}</option>`).join('')}</optgroup>`).join('');
    openSheet(j ? 'Journal ' + (j.no || '') : 'New journal entry', `
      <form id="jrForm">
        <div class="row">
          <label class="f"><span>Date</span><input class="in" type="date" name="date" value="${esc(draft.date)}" required></label>
          <label class="f"><span>Number</span><input class="in" value="${esc(draft.no || 'automatic')}" disabled></label>
        </div>
        <label class="f"><span>Description</span><input class="in" name="memo" value="${esc(draft.memo || '')}" placeholder="e.g. Depreciation of tools – October" required></label>
        <div class="jl hint" style="margin-bottom:4px"><span>Account</span><span>Debit</span><span>Credit</span><span></span></div>
        <div id="jrLines"></div>
        <button type="button" class="btn full" id="jrAdd">+ Add line</button>
        <div class="tbal" id="jrBal"></div>
        <button class="btn pri full" type="submit">Save journal</button>
        ${j ? `<button type="button" class="btn danger full" id="jrDel" style="margin-top:8px">${ICON.trash}Delete</button>` : ''}
      </form>`, el => {
      const lines = el.querySelector('#jrLines');
      const bal = () => {
        const d = r2(draft.lines.reduce((s, l) => s + num(l.dr), 0)), c = r2(draft.lines.reduce((s, l) => s + num(l.cr), 0));
        const b = el.querySelector('#jrBal'); b.className = 'tbal ' + (d === c && d > 0 ? 'ok' : 'bad');
        b.innerHTML = `<span>Debits ${fmt(d)} · Credits ${fmt(c)}</span><span>${d === c && d > 0 ? 'Balanced' : 'Difference ' + fmt(d - c)}</span>`;
      };
      const draw = () => {
        lines.innerHTML = draft.lines.map((l, i) => `<div class="jl" data-i="${i}"><select class="in ja" aria-label="Account">${accOpts(l.acc)}</select><input class="in jd" type="number" step="0.01" min="0" inputmode="decimal" value="${l.dr || ''}" placeholder="0.00" aria-label="Debit"><input class="in jc" type="number" step="0.01" min="0" inputmode="decimal" value="${l.cr || ''}" placeholder="0.00" aria-label="Credit"><button type="button" class="btn danger jx" aria-label="Remove line" style="min-height:42px;padding:0">×</button></div>`).join('');
        bal();
      };
      lines.addEventListener('input', e => {
        const row = e.target.closest('[data-i]'); if (!row) return; const l = draft.lines[+row.dataset.i];
        if (e.target.classList.contains('jd')) { l.dr = e.target.value; if (num(l.dr)) { l.cr = ''; row.querySelector('.jc').value = ''; } }
        if (e.target.classList.contains('jc')) { l.cr = e.target.value; if (num(l.cr)) { l.dr = ''; row.querySelector('.jd').value = ''; } }
        bal();
      });
      lines.addEventListener('change', e => { if (e.target.classList.contains('ja')) draft.lines[+e.target.closest('[data-i]').dataset.i].acc = e.target.value; });
      lines.addEventListener('click', e => { if (!e.target.classList.contains('jx')) return; if (draft.lines.length <= 2) { toast('A journal needs at least two lines'); return; } draft.lines.splice(+e.target.closest('[data-i]').dataset.i, 1); draw(); });
      el.querySelector('#jrAdd').onclick = () => {
        // pre-fill the amount that balances the entry
        const d = draft.lines.reduce((s, l) => s + num(l.dr), 0), c = draft.lines.reduce((s, l) => s + num(l.cr), 0);
        draft.lines.push({acc: '', dr: c > d ? r2(c - d) : '', cr: d > c ? r2(d - c) : ''}); draw();
      };
      el.querySelector('#jrForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        const ls = draft.lines.filter(l => l.acc && (num(l.dr) || num(l.cr))).map(l => ({acc: l.acc, dr: r2(l.dr), cr: r2(l.cr)}));
        const d = r2(ls.reduce((s, l) => s + l.dr, 0)), c = r2(ls.reduce((s, l) => s + l.cr, 0));
        if (ls.length < 2) { toast('Add at least two lines with an account and amount'); return; }
        if (d !== c) { toast('Debits and credits must be equal'); return; }
        const data = {date: f.date, memo: f.memo.trim(), lines: ls};
        if (j) Object.assign(j, data); else db.journals.push(Object.assign({id: uid(), no: nextJournalNo()}, data));
        save(); closeSheet(() => { render(); toast('Journal saved'); });
      };
      const del = el.querySelector('#jrDel');
      if (del) del.onclick = () => { if (!confirm('Delete this journal entry?')) return; db.journals = db.journals.filter(x => x.id !== id); db.recons = db.recons.filter(r => !r.id.startsWith('jr:' + id + ':')); save(); closeSheet(render); };
      draw();
    });
  }

  function tbData(asOf) {
    const m = sumBy(postings(), p => p.date <= asOf);
    return db.accounts.slice().sort((a, b) => String(a.code).localeCompare(String(b.code))).map(a => {
      const x = m[a.id] || {dr: 0, cr: 0}; const net = r2(x.dr - x.cr);
      return {a, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0};
    }).filter(r => r.dr || r.cr);
  }
  function tbHTML(asOf, P) {
    const rows = tbData(asOf);
    const d = r2(rows.reduce((s, r) => s + r.dr, 0)), c = r2(rows.reduce((s, r) => s + r.cr, 0));
    return TB([['Code'], ['Account'], ['Type'], ['Debit', 1], ['Credit', 1]], rows.map(r => [esc(r.a.code), (r.a.parent ? '\u00a0\u00a0\u21b3 ' : '') + esc(r.a.name), esc(r.a.type), r.dr ? fmt(r.dr) : '', r.cr ? fmt(r.cr) : '']), ['', 'Total', '', fmt(d), fmt(c)], P, 'No entries yet.') +
      (P ? '' : `<div class="tbal ${d === c ? 'ok' : 'bad'}"><span>Debits ${fmt(d)} · Credits ${fmt(c)}</span><span>${d === c ? 'In balance' : 'Out by ' + fmt(d - c)}</span></div>`);
  }
  function drawTB(box) {
    const asOf = state.ledAsOf || today();
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">${asOfPicker('tbAsOf')}<button type="button" class="btn pri" id="tbPdf" style="margin-bottom:12px">${ICON.share}Share PDF</button></div>${tbHTML(asOf)}`;
    box.querySelector('#tbAsOf').onchange = e => { state.ledAsOf = e.target.value; drawTB(box); };
    box.querySelector('#tbPdf').onclick = () => sendPdf({html: reportPaper('Trial balance', 'ميزان المراجعة', 'As of ' + dfmt(asOf), tbHTML(asOf, true)), name: `FitX Trial balance ${asOf}`, subject: 'Trial balance as of ' + dfmt(asOf)}, 'share');
  }
  function bsHTML(asOf, P) {
    const bal = balances(asOf);
    const grp = t => db.accounts.filter(a => a.type === t && Math.abs(bal[a.id]) >= 0.005).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const sum = list => r2(list.reduce((s, a) => s + bal[a.id], 0));
    const inc = sum(db.accounts.filter(a => a.type === 'income')), exp = sum(db.accounts.filter(a => a.type === 'expense'));
    const profit = r2(inc - exp);
    const assets = grp('asset'), liab = grp('liability'), eq = grp('equity');
    const tA = sum(assets), tL = sum(liab), tE = r2(sum(eq) + profit);
    const sec = (title, list, extra, total) => {
      const ids = new Set(list.map(a => a.id));
      // include main accounts whose sub-accounts have balances
      list.forEach(a => { if (a.parent && !ids.has(a.parent) && accById(a.parent)) { ids.add(a.parent); list = list.concat([accById(a.parent)]); } });
      const rows = accTree(list).map(a => {
        const kids = a._lvl ? [] : list.filter(k => k.parent === a.id);
        if (a._lvl) return [`<span style="padding-left:16px;color:#555">\u21b3 ${esc(a.code + ' · ' + a.name)}</span>`, fmt(bal[a.id])];
        if (!kids.length) return [esc(a.code + ' · ' + a.name), fmt(bal[a.id])];
        const sub = r2(bal[a.id] + kids.reduce((s, k) => s + bal[k.id], 0));
        const head = [`<b>${esc(a.code + ' · ' + a.name)}</b>`, `<b>${fmt(sub)}</b>`];
        return Math.abs(bal[a.id]) >= 0.005 ? [head, [`<span style="padding-left:16px;color:#555">\u21b3 ${esc(a.code + ' · ' + a.name)} (main)</span>`, fmt(bal[a.id])]] : head;
      }).flatMap(r => Array.isArray(r[0]) ? r : [r]);
      return `<h3>${title}</h3>` + TB([['Account'], ['Amount', 1]], rows.concat(extra || []), ['Total ' + title.toLowerCase(), fmt(total)], P, 'None');
    };
    const ok = Math.abs(tA - tL - tE) < 0.01;
    return (P ? '' : KP([['Total assets', fmt(tA), '', true], ['Total liabilities', fmt(tL)], ['Equity', fmt(tE)], ['Profit to date', fmt(profit), profit >= 0 ? 'var(--green)' : 'var(--red)']])) +
      sec('Assets', assets, null, tA) + sec('Liabilities', liab, null, tL) + sec('Equity', eq, [['Profit / (loss) to date', fmt(profit)]], tE) +
      `<div class="tbal ${ok ? 'ok' : 'bad'}"><span>Assets ${fmt(tA)} = Liabilities + Equity ${fmt(r2(tL + tE))}</span><span>${ok ? 'Balanced' : 'Check entries'}</span></div>`;
  }
  function drawBS(box) {
    const asOf = state.ledAsOf || today();
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">${asOfPicker('bsAsOf')}<button type="button" class="btn pri" id="bsPdf" style="margin-bottom:12px">${ICON.share}Share PDF</button></div>${bsHTML(asOf)}`;
    box.querySelector('#bsAsOf').onchange = e => { state.ledAsOf = e.target.value; drawBS(box); };
    box.querySelector('#bsPdf').onclick = () => sendPdf({html: reportPaper('Balance sheet', 'الميزانية العمومية', 'As of ' + dfmt(asOf), bsHTML(asOf, true)), name: `FitX Balance sheet ${asOf}`, subject: 'Balance sheet as of ' + dfmt(asOf)}, 'share');
  }
  function glHTML(f, t, P) {
    const all = postings().filter(p => p.date >= f && p.date <= t);
    const by = {}; all.forEach(p => (by[p.acc] = by[p.acc] || []).push(p));
    const accs = db.accounts.filter(a => by[a.id]).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    if (!accs.length) return P ? '<p>No entries.</p>' : '<div class="list"><div class="empty">No entries in this period.</div></div>';
    return accs.map(a => {
      const rows = by[a.id].sort((x, y) => (x.date + x.key).localeCompare(y.date + y.key));
      const d = r2(rows.reduce((s, r) => s + r.dr, 0)), c = r2(rows.reduce((s, r) => s + r.cr, 0));
      return `<h3>${esc(a.code + ' · ' + a.name)}</h3>` + TB([['Date'], ['Description'], ['Ref'], ['Debit', 1], ['Credit', 1]], rows.map(r => [dfmt(r.date), esc(r.desc), esc(r.ref || ''), r.dr ? fmt(r.dr) : '', r.cr ? fmt(r.cr) : '']), ['', 'Total', '', fmt(d), fmt(c)], P);
    }).join('');
  }
  function drawGL(box) {
    const [f, t] = periodRange(state.rep);
    box.innerHTML = `${periodPicker()}<p class="hint" style="margin:-4px 2px 12px">${esc(periodLabel(f, t))}</p><button type="button" class="btn pri" id="glPdf" style="margin-bottom:12px">${ICON.share}Share PDF</button>${glHTML(f, t)}`;
    bindPeriod(box, () => drawGL(box));
    box.querySelector('#glPdf').onclick = () => sendPdf({html: reportPaper('General ledger', 'دفتر الأستاذ العام', periodLabel(f, t), glHTML(f, t, true)), name: `FitX General ledger ${f}_${t}`, subject: 'General ledger ' + periodLabel(f, t)}, 'share');
  }
  window.FitxLedger.trialBalanceHTML = tbHTML;
  window.FitxLedger.balanceSheetHTML = bsHTML;

  /* ---------- menu entries ---------- */
  const origMore = window.viewMore;
  window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling;
    if (!list) return;
    const bal = balances('9999-12-31');
    const cashTotal = bankAccounts().reduce((s, a) => s + bal[a.id], 0);
    list.insertAdjacentHTML('afterbegin', `
      <button type="button" class="item rcard" id="mBank"><span class="ic">${ic.bank}</span><div class="main"><div class="t">Banking</div><div class="s">Bank &amp; cash QAR ${fmt(cashTotal)} · transfers · reconcile</div></div></button>
      <button type="button" class="item rcard" id="mLedger"><span class="ic">${ic.book}</span><div class="main"><div class="t">Accounting</div><div class="s">Chart of accounts, journals, trial balance, balance sheet</div></div></button>`);
    document.getElementById('mBank').onclick = () => goTab('banking');
    document.getElementById('mLedger').onclick = () => goTab('ledger');
  };
  // sidebar (tablet / computer)
  const side = document.querySelector('#side .si[data-tab=reports]');
  if (side) side.insertAdjacentHTML('beforebegin', `<button type="button" class="si" data-tab="banking">${ic.bank}Banking</button><button type="button" class="si" data-tab="ledger">${ic.book}Accounting</button>`);
  if (typeof NAV_GROUP !== 'undefined') { NAV_GROUP.banking = 'more'; NAV_GROUP.ledger = 'more'; }

  // new reports in the Reports tab
  if (typeof REPORTS !== 'undefined') {
    REPORTS.tb = [ic.book, 'Trial balance', 'All accounts with debit and credit totals'];
    REPORTS.bs = [ic.book, 'Balance sheet', 'Assets, liabilities and equity'];
    REPORTS.gl = [ic.book, 'General ledger', 'Every entry by account'];
    REPORTS.bank = [ic.bank, 'Bank & cash registers', 'Balances, transactions, reconciliation'];
    if (typeof REPORT_GROUPS !== 'undefined') REPORT_GROUPS.push(['Accounting books', ['bs', 'tb', 'gl', 'bank']]);
  }
  window.ledgerReport = function (k) {
    if (k === 'bank') { goTab('banking'); return true; }
    if (['tb', 'bs', 'gl'].includes(k)) { state.ledTab = k; goTab('ledger'); return true; }
    return false;
  };

  if (ensureAccounts()) { try { rawSaveLedger(); } catch (e) {} }
  function rawSaveLedger() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
})();
