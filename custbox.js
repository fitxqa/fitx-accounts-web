/* FitX Accounts — customer box with search, "+ Add new customer", and edit / delete beside each customer.
   Turns every customer drop-down into this box (invoice / quote, work order, AMC, Payment In, customer statement).
   The original <select> stays in the form (hidden) and is kept in step, so saving works exactly as before. */
(function () {
  'use strict';
  const SEL = 'select[name="customerId"], select#dCust, select#stC, select#apP';
  const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const BIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
  const css = document.createElement('style');
  css.textContent = `
  .cbx{position:relative;flex:1;min-width:0}
  .cbx-in{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;border:1px solid var(--line,#dcdfe5);border-radius:10px;padding:6px 12px;background:var(--card,#fff);color:var(--text,#111);font-family:inherit;font-weight:600;font-size:15px;text-align:left;cursor:pointer}
  .cbx-in .cbx-v{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cbx-in .cbx-v small{font-weight:500;color:var(--muted,#888)}
  .cbx-in .cbx-v.ph{color:var(--muted,#888);font-weight:500}
  .cbx-in .cbx-ch{color:#888;transition:transform .15s;flex-shrink:0}
  .cbx.open .cbx-in{border:2px solid var(--orange);padding:5px 11px}
  .cbx.open .cbx-in .cbx-ch{transform:rotate(180deg)}
  .cbx-dd{display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);background:var(--card,#fff);border:1px solid var(--line,#e3e5ea);border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.18);z-index:60;overflow:hidden}
  .cbx.open .cbx-dd{display:block}
  .cbx-s{display:block;width:calc(100% - 16px);margin:8px;border:1px solid var(--line,#e3e5ea);border-radius:9px;padding:9px 10px;font-family:inherit;font-weight:500;font-size:14px;outline-color:var(--orange);background:var(--bg,#fff);color:var(--text,#111)}
  .cbx-new{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;border-bottom:1px solid var(--line,#eee);padding:11px 14px;color:var(--orange);font-family:inherit;font-weight:700;font-size:14px;text-align:left;cursor:pointer}
  .cbx-new:hover{background:#fff5ee}
  .cbx-l{max-height:320px;overflow-y:auto}
  .cbx-r{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 14px;cursor:pointer}
  .cbx-r:hover,.cbx-r.kb{background:#fff5ee}
  .cbx-r .nm{flex:1;min-width:0}
  .cbx-r .nm b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cbx-r .nm small{display:block;color:var(--muted,#888);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cbx-r.sel .nm b{color:var(--orange)}
  .cbx-ic{flex:0 0 auto;width:34px;height:34px;border-radius:8px;border:0;background:none;display:grid;place-items:center;color:#666;cursor:pointer;padding:0}
  .cbx-ic svg{width:16px;height:16px}
  .cbx-ic:hover{background:#ffe9da;color:var(--orange)}
  .cbx-ic.d{color:#c0392b}.cbx-ic.d:hover{background:#fde8e6;color:#b3261e}
  .cbx-none{padding:14px;color:var(--muted,#888);font-size:13.5px}
  select.cbx-hid{display:none!important}
  .cbx-on #dNewCust{display:none!important}`;
  document.head.appendChild(css);

  const low = s => String(s || '').toLowerCase();
  const cust = id => (db.customers || []).find(c => c.id === id);
  const sub = c => [c.phone, [c.zone && 'Zone ' + c.zone, c.area].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const used = id => (db.docs || []).some(d => d.customerId === id) || (db.workorders || []).some(w => w.customerId === id) || (db.amcs || []).some(a => a.customerId === id);
  const fire = sel => { sel.dispatchEvent(new Event('input', {bubbles: true})); sel.dispatchEvent(new Event('change', {bubbles: true})); };
  let openBox = null;
  const closeOpen = () => { if (openBox) { openBox.classList.remove('open'); openBox = null; } };

  function enhance(sel) {
    if (sel.dataset.cbx) return;
    sel.dataset.cbx = '1';
    const ph = (sel.options[0] && sel.options[0].value === '' ? sel.options[0].textContent : 'Select customer').replace(/[—–-]\s*|\s*[—–-]$/g, '').trim() || 'Select customer';
    const box = document.createElement('div'); box.className = 'cbx';
    box.innerHTML = `<button type="button" class="cbx-in" aria-haspopup="listbox"><span class="cbx-v"></span><span class="cbx-ch">▾</span></button>
      <div class="cbx-dd" role="listbox"><input class="cbx-s" type="search" placeholder="Search name or phone…" autocomplete="off"><button type="button" class="cbx-new">＋ Add new customer</button><div class="cbx-l"></div></div>`;
    sel.insertAdjacentElement('afterend', box);
    if (sel.id === 'apP') box.querySelector('.cbx-new').remove();   // Payment In lists only customers who owe money
    sel.classList.add('cbx-hid');
    const row = sel.parentNode; if (row && row.querySelector('#dNewCust')) row.classList.add('cbx-on');
    const v = box.querySelector('.cbx-v'), s = box.querySelector('.cbx-s'), l = box.querySelector('.cbx-l');
    // options the screen offers (keeps its own filter, e.g. work orders hide the home-visit account)
    const offered = () => [...sel.options].filter(o => o.value);
    const showValue = () => {
      const o = sel.selectedOptions[0], c = o && o.value && cust(o.value);
      if (!o || !o.value) { v.className = 'cbx-v ph'; v.textContent = ph; return; }
      v.className = 'cbx-v'; v.innerHTML = `${esc(c ? c.name : o.textContent)}${c && c.phone ? ` <small>· ${esc(c.phone)}</small>` : ''}`;
    };
    const draw = () => {
      const q = low(s.value).trim(), qd = q.replace(/\D/g, '');
      const list = offered().filter(o => { const c = cust(o.value); const hay = low(o.textContent + ' ' + (c ? [c.name, c.contact, c.area, c.zone, c.email].join(' ') : '')); return !q || hay.includes(q) || (qd.length >= 3 && c && String(c.phone || '').replace(/\D/g, '').includes(qd)); });
      l.innerHTML = list.length ? list.map((o, i) => { const c = cust(o.value);
        return `<div class="cbx-r${o.value === sel.value ? ' sel' : ''}${i === 0 && q ? ' kb' : ''}" data-id="${esc(o.value)}" role="option"><div class="nm"><b>${esc(c ? c.name : o.textContent)}</b>${c && sub(c) ? `<small>${esc(sub(c))}</small>` : ''}${!c ? '' : (o.textContent.includes(' · ') ? `<small>${esc(o.textContent.split(' · ').slice(1).join(' · '))}</small>` : '')}</div>${c ? `<button type="button" class="cbx-ic e" data-ed="${esc(o.value)}" title="Edit customer" aria-label="Edit ${esc(c.name)}">${PEN}</button><button type="button" class="cbx-ic d" data-del="${esc(o.value)}" title="Delete customer" aria-label="Delete ${esc(c.name)}">${BIN}</button>` : ''}</div>`; }).join('')
        : `<div class="cbx-none">${q ? 'No customer found. Use “＋ Add new customer”.' : 'No customers yet.'}</div>`;
    };
    const pick = id => { sel.value = id; showValue(); closeOpen(); fire(sel); };
    const open = () => { closeOpen(); box.classList.add('open'); openBox = box; s.value = ''; draw(); setTimeout(() => { try { s.focus({preventScroll: true}); } catch (e) {} const r = l.querySelector('.sel'); if (r) r.scrollIntoView({block: 'nearest'}); }, 0); };
    const addOption = c => {
      let o = [...sel.options].find(x => x.value === c.id);
      if (!o) { o = document.createElement('option'); o.value = c.id; sel.appendChild(o); }
      o.textContent = c.name;
    };
    box.querySelector('.cbx-in').onclick = e => { e.preventDefault(); box.classList.contains('open') ? closeOpen() : open(); };
    s.oninput = draw;
    s.onkeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOpen(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const r = l.querySelector('.cbx-r.kb') || l.querySelector('.cbx-r'); if (r) pick(r.dataset.id); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const rows = [...l.querySelectorAll('.cbx-r')]; if (!rows.length) return;
        let i = rows.findIndex(r => r.classList.contains('kb')); rows.forEach(r => r.classList.remove('kb'));
        i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1); rows[i].classList.add('kb'); rows[i].scrollIntoView({block: 'nearest'});
      }
    };
    if (box.querySelector('.cbx-new')) box.querySelector('.cbx-new').onclick = () => {
      closeOpen();
      editCustomer(null, c => { if (!c) return; addOption(c); sel.value = c.id; showValue(); fire(sel); toast('Customer saved'); });
    };
    l.addEventListener('click', e => {
      const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]'), r = e.target.closest('.cbx-r');
      if (ed) { e.stopPropagation(); const id = ed.dataset.ed; closeOpen(); editCustomer(id, c => { if (c) { addOption(c); showValue(); if (sel.value === id) fire(sel); } toast('Customer saved'); }); return; }
      if (del) {
        e.stopPropagation(); const c = cust(del.dataset.del); if (!c) return;
        if (used(c.id)) { toast(c.name + ' has invoices, quotes or work orders – delete those first'); return; }
        if (!confirm('Delete ' + c.name + '?')) return;
        db.customers = db.customers.filter(x => x.id !== c.id); save();
        const o = [...sel.options].find(x => x.value === c.id); if (o) o.remove();
        if (sel.value === c.id || !sel.value) { sel.value = ''; fire(sel); }
        showValue(); draw(); toast('Customer deleted'); return;
      }
      if (r) pick(r.dataset.id);
    });
    // the screen may change the select itself (e.g. after its own + New): follow it
    sel.addEventListener('change', showValue);
    new MutationObserver(showValue).observe(sel, {childList: true});
    showValue();
  }

  document.addEventListener('click', e => { if (openBox && !openBox.contains(e.target)) closeOpen(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openBox) { e.stopPropagation(); closeOpen(); } }, true);
  const scan = root => { (root.querySelectorAll ? root.querySelectorAll(SEL) : []).forEach(sel => { if (sel.id === 'apP' && !/customer/i.test((sel.closest('label') || {}).textContent || '')) return; enhance(sel); }); };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches && n.matches(SEL)) scan(n.parentNode || n); else scan(n); } }))).observe(document.body, {childList: true, subtree: true});
  scan(document);
  window.FitxCustBox = {enhance};
})();
