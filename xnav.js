/* FitX Accounts — "X-Style" side menu (computers & tablets), modelled on Vyapar:
   grouped menu that opens one group at a time, "+" beside a page to create a new one straight away,
   "Open anything" search at the top (Ctrl+F), and + Add invoice / + Add bill / + buttons in the top bar.
   Settings → Menu style switches between X-Style and Classic (remembered on this device).
   The FitX name in the top-left corner and the ☰ (icons only) button are unchanged. */
(function () {
  'use strict';
  const KEY = 'fitx_nav_style';
  const getStyle = () => { try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'x'; } catch (e) { return 'x'; } };
  const setStyle = v => { try { localStorage.setItem(KEY, v); } catch (e) {} apply(); };
  const closeAll = () => { while (typeof sheets !== 'undefined' && sheets.length) closeTopSheet(); };
  const tab = (t, pre) => () => { closeAll(); if (pre) pre(); goTab(t); };
  const sales = t => tab('sales', () => { state.salesType = t; state.salesFilter = 'All'; });
  const exp = t => tab('expenses', () => { state.expTab = t; state.billFilter = 'All'; });
  const viaMenu = id => () => { closeAll(); goTab('more'); setTimeout(() => { const b = document.getElementById(id); if (b) b.click(); else toast('Not available here'); }, 30); };
  const call = (fn) => () => { closeAll(); fn(); };

  const P = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    party: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-4-5.5"/>',
    items: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    sale: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
    buy: '<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.6"/><circle cx="18" cy="19" r="1.6"/>',
    bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    pay: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 12.5h.01M18 12.5h.01"/>',
    acc: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    rep: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4M6 22v-4h4"/>',
    tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'
  };
  const svg = (k, s) => `<svg viewBox="0 0 24 24" width="${s || 19}" height="${s || 19}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

  /* menu: [icon, label, {key, open, add} | [sub items]] — sub item: [label, key, open, add?] */
  const MENU = () => [
    ['home', 'Dashboard', {key: 'home', open: tab('home')}],
    ['party', 'Parties', [
      ['Customers', 'customers', tab('customers'), () => editCustomer()],
      ['Suppliers', 'suppliers', tab('suppliers'), () => editSupplier()],
      ['Employees', 'payroll', tab('payroll'), window.FitxPayroll && FitxPayroll.editEmployee ? () => FitxPayroll.editEmployee() : null]]],
    ['items', 'Products & services', {key: 'stock', open: tab('stock'), add: () => editItem()}],
    ['sale', 'Sale', [
      ['Invoices', 'sales:INV', sales('INV'), () => editDoc('INV')],
      ['Quotations', 'sales:QUO', sales('QUO'), () => editDoc('QUO')],
      ['Receive payment', '', call(() => receivePayment())],
      ['Service reminders', 'reminders', tab('reminders')],
      ['Payment reminders', '', viaMenu('mPayRem')],
      ['SkipCash card payments', '', viaMenu('mSkip')]]],
    ['buy', 'Purchase & Expense', [
      ['Bills (parts purchases)', 'expenses:bills', exp('bills'), () => editPurchase()],
      ['Expenses', 'expenses:exp', exp('exp'), () => editExpense()],
      ['Purchase orders', 'porders', tab('porders'), window.FitxPO ? () => FitxPO.edit() : null]]],
    ['bank', 'Cash & Bank', {key: 'banking', open: tab('banking')}],
    ['pay', 'Payroll', [
      ['Payroll', 'payroll', tab('payroll')],
      ['Payroll & WPS settings', '', viaMenu('mPaySet')]]],
    ['acc', 'Accounting', [
      ['Journal & accounts', 'ledger', tab('ledger')],
      ['Qatar tax', 'tax', tab('tax')]]],
    ['rep', 'Reports', {key: 'reports', open: tab('reports')}],
    ['sync', 'Backup & Data', [
      ['Backup & restore', '', call(() => viewBackup())],
      ['Import entries', '', call(() => window.FitxImport && FitxImport.start())],
      ...(window.FitxReceipts ? [['Receipt photos', '', call(() => FitxReceipts.view())]] : [])]],
    ['tools', 'Utilities', [
      ['Users & passwords', '', viaMenu('mCloud')],
      ['Security & app lock', '', viaMenu('mSec')],
      ['Password vault', '', viaMenu('mVault')],
      ['Email settings', '', viaMenu('mMail')],
      ['Company stamp', '', viaMenu('mStamp')],
      ['Keyboard shortcuts', '', call(() => window.FitxKeys && FitxKeys.help())]]],
    ['set', 'Settings', {key: '', open: call(() => viewSettings())}]
  ];

  const css = document.createElement('style');
  css.textContent = `
  .xnav,.xtop{display:none}
  @media (min-width:768px){
    body.xstyle aside.side>.snew,body.xstyle aside.side>button.si,body.xstyle aside.side>.sg{display:none!important}
    body.xstyle .xnav{display:flex;flex-direction:column;gap:1px;margin:0 -10px}
    .xsearch{margin:2px 14px 10px;background:#232330;color:#b9b9c7;border:0;border-radius:20px;padding:9px 12px;font:500 13px inherit;display:flex;gap:8px;align-items:center;text-align:left;cursor:pointer}
    .xsearch:hover{background:#2b2b3a;color:#fff}
    .xsearch kbd{margin-left:auto;font:600 10px inherit;background:#33334a;border-radius:5px;padding:2px 6px;color:#ccc}
    .xi{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;border-left:3px solid transparent;color:#d6d6de;font:600 14px inherit;padding:10px 14px 10px 17px;text-align:left;cursor:pointer}
    .xi:hover{background:#1d1d26;color:#fff}
    .xi>span.xl{flex:1;min-width:0}
    .xi svg{flex-shrink:0;opacity:.9}
    .xi .xc{color:#8a8a99;transition:transform .15s;display:flex}
    .xg.open>.xi{background:#1f1f2a;color:#fff}
    .xg.open>.xi .xc{transform:rotate(180deg)}
    .xi.on{border-left-color:var(--orange);color:#fff;background:#232330}
    .xi.on svg{color:var(--orange)}
    .xg.has-on>.xi svg{color:var(--orange)}
    .xadd{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:#9a9aab;font-size:19px;line-height:1;font-weight:400;flex-shrink:0}
    .xadd:hover{background:#33334a;color:#fff}
    .xsub{display:none;background:#17171f;padding:3px 0}
    .xg.open>.xsub{display:block}
    .xs{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;border-left:3px solid transparent;color:#c3c3d0;font:500 13.2px inherit;padding:8px 14px 8px 48px;text-align:left;cursor:pointer}
    .xs>span.xl{flex:1}
    .xs:hover{background:#1f1f2a;color:#fff}
    .xs.on{background:#262634;color:#fff;border-left-color:var(--orange);font-weight:700}
    body.xstyle aside.side .sfoot{margin-top:auto}
    body.xstyle.side-mini .xsearch{width:44px;height:40px;margin:0 auto 10px;padding:0;justify-content:center;font-size:0}
    body.xstyle.side-mini .xsearch kbd{display:none}
    body.xstyle.side-mini .xi{padding:11px 0;justify-content:center;font-size:0;gap:0;border-left-width:0}
    body.xstyle.side-mini .xi.on,body.xstyle.side-mini .xg.has-on>.xi{box-shadow:inset 3px 0 0 var(--orange)}
    body.xstyle.side-mini .xi .xc,body.xstyle.side-mini .xi .xadd,body.xstyle.side-mini .xsub{display:none!important}
    body.xstyle.side-mini .xnav{margin:0 -8px}
    body.xstyle.side-mini .xi>span.xl{display:none}
    body.xstyle:not(.side-mini){--side:256px}
    body.xstyle .xi>span.xl,body.xstyle .xs>span.xl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    body.xstyle .xsearch{white-space:nowrap}
    body.xstyle .xtop{display:flex;gap:8px;align-items:center;margin-left:auto}
    .xtop button{border:0;border-radius:999px;padding:8px 14px;font:700 13px inherit;color:#fff;display:inline-flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap}
    .xtop .xa{background:var(--orange)}.xtop .xb{background:#1a73c8}
    .xtop .xm{background:#eef2fd;color:#1a73c8;width:36px;height:36px;padding:0;justify-content:center;font-size:21px;font-weight:500}
    body.xstyle header.top #topAct{margin-left:8px}
    .xpages .item{padding:9px 14px}
  }
  @media (min-width:768px) and (max-width:1023px){ .xtop .xa span,.xtop .xb span{display:none} }`;
  document.head.appendChild(css);

  let openGroup = null;
  function curKey() {
    const t = state.tab;
    if (t === 'sales') return 'sales:' + (state.salesType || 'INV');
    if (t === 'expenses') return 'expenses:' + (state.expTab || 'exp');
    return t;
  }
  function build() {
    const side = document.getElementById('side'); if (!side) return;
    let nav = side.querySelector('.xnav');
    if (!nav) { nav = document.createElement('div'); nav.className = 'xnav'; const logo = side.querySelector('.slogo'); logo.insertAdjacentElement('afterend', nav); }
    const k = curKey(), M = MENU();
    if (openGroup === null) { const g = M.find(m => Array.isArray(m[2]) && m[2].some(s => s[1] && s[1] === k)); openGroup = g ? g[1] : ''; }
    nav.innerHTML = `<button type="button" class="xsearch" data-xs="1" title="Open anything (Ctrl+F)">${svg('search', 15)}Open anything<kbd>Ctrl+F</kbd></button>` + M.map(([ic, label, x], gi) => {
      if (!Array.isArray(x)) return `<div class="xg"><button type="button" class="xi${x.key && x.key === k ? ' on' : ''}" data-g="${gi}" title="${esc(label)}">${svg(ic)}<span class="xl">${esc(label)}</span>${x.add ? `<span class="xadd" data-ga="${gi}" title="New">+</span>` : ''}</button></div>`;
      const hasOn = x.some(s => s[1] && s[1] === k), open = openGroup === label;
      return `<div class="xg${open ? ' open' : ''}${hasOn ? ' has-on' : ''}"><button type="button" class="xi" data-g="${gi}" title="${esc(label)}" aria-expanded="${open}">${svg(ic)}<span class="xl">${esc(label)}</span><span class="xc"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg></span></button>
        <div class="xsub">${x.map((s, si) => `<button type="button" class="xs${s[1] && s[1] === k ? ' on' : ''}" data-g="${gi}" data-s="${si}"><span class="xl">${esc(s[0])}</span>${s[3] ? `<span class="xadd" data-g="${gi}" data-sa="${si}" title="New ${esc(s[0])}">+</span>` : ''}</button>`).join('')}</div></div>`;
    }).join('');
  }
  function onClick(e) {
    const nav = e.target.closest('.xnav'); if (!nav) return;
    e.stopPropagation();
    if (e.target.closest('[data-xs]')) { openAnything(); return; }
    const M = MENU();
    const a = e.target.closest('[data-sa]'), ga = e.target.closest('[data-ga]');
    if (a) { closeAll(); M[a.dataset.g][2][a.dataset.sa][3](); return; }
    if (ga) { closeAll(); M[ga.dataset.ga][2].add(); return; }
    const s = e.target.closest('[data-s]');
    if (s) { M[s.dataset.g][2][s.dataset.s][2](); return; }
    const g = e.target.closest('[data-g]'); if (!g) return;
    const item = M[g.dataset.g];
    if (!Array.isArray(item[2])) { openGroup = ''; item[2].open(); return; }
    if (document.body.classList.contains('side-mini')) { const t = document.getElementById('sideTog'); if (t) t.click(); openGroup = item[1]; build(); return; }
    openGroup = openGroup === item[1] ? '' : item[1]; build();
  }

  /* Open anything: pages + the normal search (customers, invoices, parts, suppliers) */
  function openAnything() {
    const pages = [];
    MENU().forEach(([ic, label, x]) => { if (Array.isArray(x)) x.forEach(s => pages.push([s[0], label, s[2]])); else pages.push([label, '', x.open]); });
    globalSearch();
    const top = (typeof sheets !== 'undefined' && sheets.length) ? sheets[sheets.length - 1] : null;
    const el = top && (top.el || top); const box = el && el.querySelector ? el : document;
    const inp = box.querySelector('#gq'), gr = box.querySelector('#gr'); if (!inp || !gr) return;
    inp.placeholder = 'Open anything – pages, customers, invoices, parts…';
    const pv = document.createElement('div'); pv.className = 'xpages'; gr.parentNode.insertBefore(pv, gr);
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      const list = (q ? pages.filter(p => (p[0] + ' ' + p[1]).toLowerCase().includes(q)) : pages.slice(0, 8)).slice(0, 8);
      pv.innerHTML = list.length ? `<div class="sec"><h2>${q ? 'Pages' : 'Go to'}</h2></div><div class="list">${list.map((p, i) => `<button type="button" class="item" data-pg="${i}"><div class="main"><div class="t">${esc(p[0])}</div>${p[1] ? `<div class="s">${esc(p[1])}</div>` : ''}</div><span class="hint">↵</span></button>`).join('')}</div>` : '';
      pv.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => list[b.dataset.pg][2]());
      pv._first = list[0];
    };
    inp.addEventListener('input', draw);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && pv._first && !gr.querySelector('.item')) { e.preventDefault(); pv._first[2](); } });
    draw();
  }

  function topButtons() {
    const head = document.querySelector('header.top'); if (!head || head.querySelector('.xtop')) return;
    const t = document.createElement('div'); t.className = 'xtop';
    t.innerHTML = '<button type="button" class="xa" title="New invoice">+<span> Add invoice</span></button><button type="button" class="xb" title="New bill (parts purchase)">+<span> Add bill</span></button><button type="button" class="xm" title="Create new (Ctrl+N)" aria-label="Create new">+</button>';
    head.insertBefore(t, document.getElementById('topSearch'));
    t.querySelector('.xa').onclick = () => { closeAll(); editDoc('INV'); };
    t.querySelector('.xb').onclick = () => { closeAll(); editPurchase(); };
    t.querySelector('.xm').onclick = () => { closeAll(); newMenu(); };
  }

  function apply() {
    const x = getStyle() === 'x';
    document.body.classList.toggle('xstyle', x);
    if (x) { build(); topButtons(); }
  }

  const side = document.getElementById('side');
  if (side) side.addEventListener('click', onClick, true);
  document.addEventListener('keydown', e => {
    if (getStyle() !== 'x') return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      if (document.querySelector('.lockscreen, #lockScreen')) return;
      e.preventDefault(); e.stopPropagation(); closeAll(); openAnything();
    }
  }, true);

  /* keep the highlighted page in step with the screen */
  const origRender = window.render;
  if (typeof origRender === 'function') window.render = function () { const r = origRender.apply(this, arguments); try { if (getStyle() === 'x') { openGroup = null; build(); } } catch (e) {} return r; };

  /* Settings → Menu style */
  const origSet = window.viewSettings;
  if (typeof origSet === 'function') window.viewSettings = function () {
    const r = origSet.apply(this, arguments);
    setTimeout(() => {
      const sh = document.querySelectorAll('.sheet'); const el = sh[sh.length - 1]; if (!el || el.querySelector('#xStyleSeg')) return;
      const body = el.querySelector('.sb>div') || el.querySelector('.sb'); if (!body) return;
      const st = getStyle();
      body.insertAdjacentHTML('afterbegin', `<div class="card" id="xStyleCard" style="margin-bottom:14px"><div style="font-weight:800;margin-bottom:2px">Menu style</div><div class="hint" style="margin-bottom:10px">Side menu on computers and tablets</div>
        <div class="seg" id="xStyleSeg" role="radiogroup" style="display:flex;gap:8px"><button type="button" class="btn${st === 'x' ? ' pri' : ''}" data-st="x" style="flex:1">X-Style</button><button type="button" class="btn${st === 'classic' ? ' pri' : ''}" data-st="classic" style="flex:1">Classic</button></div></div>`);
      body.querySelectorAll('#xStyleSeg [data-st]').forEach(b => b.onclick = () => {
        setStyle(b.dataset.st);
        body.querySelectorAll('#xStyleSeg [data-st]').forEach(x => x.classList.toggle('pri', x === b));
        toast(b.dataset.st === 'x' ? 'X-Style menu on' : 'Classic menu on');
      });
    }, 0);
    return r;
  };

  window.FitxNav = {apply, getStyle, setStyle, openAnything};
  apply();
})();
