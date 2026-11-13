/* FitX Accounts — keyboard shortcuts (computer browser, installed web app, and the phone/tablet app with a keyboard).
   Ctrl on Windows/Android, Ctrl or ⌘ on Mac. Every shortcut also works with Alt, for the few keys a browser keeps for itself
   (Ctrl+N new window, Ctrl+T new tab). Ctrl+/ shows the list. */
(function () {
  'use strict';
  const closeAll = () => { while (typeof sheets !== 'undefined' && sheets.length) closeTopSheet(); };
  const go = (tab, pre) => () => { closeAll(); if (pre) pre(); goTab(tab); };
  function quit() {
    if (window.AndroidBridge && AndroidBridge.quitApp) { AndroidBridge.quitApp(); return; }
    try { window.close(); } catch (e) {}
    setTimeout(() => toast('Close this browser tab to quit (the browser does not let a page close itself)'), 200);
  }
  // Ctrl+N: create new – follows the screen you are on
  function createNew() {
    if (typeof sheets !== 'undefined' && sheets.length) closeAll();
    const t = state.tab;
    if (t === 'customers') return editCustomer();
    if (t === 'suppliers') return editSupplier();
    if (t === 'stock') return editItem();
    if (t === 'sales') return editDoc(state.salesType === 'QUO' ? 'QUO' : 'INV');
    if (t === 'expenses') return state.expTab === 'bills' ? editPurchase() : editExpense();
    if (t === 'porders' && window.FitxPO) return FitxPO.edit();
    newMenu(); // anywhere else: choose what to create (item, customer, supplier, invoice…)
  }
  const KEYS = {
    q: ['Quotations', go('sales', () => { state.salesType = 'QUO'; state.salesFilter = 'All'; })],
    i: ['Invoices', go('sales', () => { state.salesType = 'INV'; state.salesFilter = 'All'; })],
    e: ['Expenses', go('expenses', () => { state.expTab = 'exp'; })],
    s: ['Suppliers', go('suppliers')],
    d: ['Products & services', go('stock')],
    o: ['Customers', go('customers')],
    b: ['Bank', go('banking')],
    a: ['Accounting', go('ledger')],
    y: ['Payroll', go('payroll')],
    t: ['Qatar tax', go('tax')],
    m: ['Reminders', go('reminders')],
    r: ['Reports', go('reports')],
    k: ['Settings & backup', () => { closeAll(); goTab('more'); viewSettings(); }],
    n: ['Create new (item, customer, supplier…)', createNew]
  };
  const LIST = [['Ctrl + Q', 'q'], ['Ctrl + I', 'i'], ['Ctrl + E', 'e'], ['Ctrl + S', 's'], ['Ctrl + D', 'd'], ['Ctrl + O', 'o'], ['Ctrl + B', 'b'], ['Ctrl + A', 'a'], ['Ctrl + Y', 'y'], ['Ctrl + T', 't'], ['Ctrl + M', 'm'], ['Ctrl + R', 'r'], ['Ctrl + K', 'k'], ['Ctrl + N', 'n']];

  function help() {
    openSheet('Keyboard shortcuts', `<div class="list">${LIST.map(([k, c]) => `<div class="item"><div class="main"><div class="t">${KEYS[c][0]}</div></div><kbd class="kbd">${k}</kbd></div>`).join('')}
      <div class="item"><div class="main"><div class="t">Quit application</div></div><kbd class="kbd">Ctrl + Shift + Q</kbd></div>
      <div class="item"><div class="main"><div class="t">Next / previous section</div></div><kbd class="kbd">Tab · Shift + Tab</kbd></div>
      <div class="item"><div class="main"><div class="t">Close the open screen</div></div><kbd class="kbd">Esc</kbd></div>
      <div class="item"><div class="main"><div class="t">Show this list</div></div><kbd class="kbd">Ctrl + /</kbd></div></div>
      <p class="hint" style="margin:12px 4px">On a Mac use ⌘ instead of Ctrl. Ctrl+Q opens Quotations, so quitting is Ctrl+Shift+Q. If your browser takes a key for itself (Ctrl+N new window, Ctrl+T new tab), use <b>Alt</b> with the same letter, e.g. Alt+N. Ctrl+A still selects text while you are typing in a box.</p>`);
  }
  const css = document.createElement('style');
  css.textContent = `.kbd{font:700 12px/1 ui-monospace,Menlo,Consolas,monospace;background:var(--line);border:1px solid var(--line2);border-bottom-width:2px;border-radius:6px;padding:6px 8px;white-space:nowrap;color:var(--text)}`;
  document.head.appendChild(css);

  /* Tab / Shift+Tab: next / previous section (when no screen is open and you are not typing in a box) */
  const ORDER = ['home', 'sales', 'customers', 'stock', 'expenses', 'porders', 'suppliers', 'banking', 'ledger', 'payroll', 'tax', 'reminders', 'reports'];
  function stepTab(dir) {
    const V = window.FITX_VIEWS || {};
    const list = ORDER.filter(t => ['home', 'sales', 'customers', 'stock', 'expenses', 'suppliers', 'banking', 'ledger', 'reports'].includes(t) || V[t]);
    let i = list.indexOf(state.tab); if (i < 0) i = dir > 0 ? -1 : 0;
    goTab(list[(i + dir + list.length) % list.length]);
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (document.querySelector('.cl-wrap') || (typeof sheets !== 'undefined' && sheets.length)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    stepTab(e.shiftKey ? -1 : 1);
  });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    if (document.querySelector('.cl-wrap')) return; // sign-in screen
    const mod = e.ctrlKey || e.metaKey, alt = e.altKey && !e.ctrlKey && !e.metaKey;
    if (!mod && !alt) return;
    const k = (e.key || '').toLowerCase();
    const typing = e.target && (e.target.isContentEditable || /^(input|textarea|select)$/i.test(e.target.tagName));
    if (mod && e.shiftKey && k === 'q') { e.preventDefault(); quit(); return; }
    if (mod && (k === '/' || k === '?')) { e.preventDefault(); help(); return; }
    if (e.shiftKey) return;
    const act = KEYS[k]; if (!act) return;
    if (typing && mod && k === 'a') return; // keep select-all inside text boxes
    e.preventDefault();
    try { act[1](); } catch (err) { console.error(err); }
  });
  window.FitxKeys = {help};
})();
