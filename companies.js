/* FitX Accounts — several companies on one device.
   Each company has its own customers, invoices, stock, accounts, settings (name, logo, stamp, terms) and cloud link.
   Switching saves the current company and reloads the app with the other company's data. */
(function () {
  'use strict';
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  const keyOf = id => id === 'main' ? 'fitx_accounts_v1' : 'fitx_accounts_v1__' + id;
  const write = l => LS(CO_LIST_KEY, JSON.stringify(l));
  const nameIn = id => { try { const d = JSON.parse(LS(keyOf(id)) || 'null'); return d && d.settings && d.settings.name; } catch (e) { return ''; } };
  function list() {
    const l = coList();
    l.forEach(c => { if (c.id === ACTIVE_CO) c.name = S().name || c.name; else if (!c.name) c.name = nameIn(c.id) || (c.id === 'main' ? 'FitX Sports Equipment Services' : 'Company'); });
    return l;
  }
  // keep the list name in step with Settings → company name
  const sync = () => { const l = coList(), c = l.find(x => x.id === ACTIVE_CO); if (c && S().name && c.name !== S().name) { c.name = S().name; write(l); } };
  const origSave = window.save;
  if (origSave) window.save = function () { const r = origSave.apply(this, arguments); try { sync(); } catch (e) {} return r; };

  function switchTo(id) {
    if (id === ACTIVE_CO) return;
    try { save(); } catch (e) {}
    write(list()); LS(CO_ACTIVE_KEY, id);
    location.reload();
  }
  function add(name) {
    const l = list(), id = 'c' + Date.now().toString(36);
    l.push({id, name: name.trim()}); write(l);
    // same "this phone only" choice as the main company, so a new company doesn't ask to sign in
    if (LS('fitx_accounts_v1_offlineOnly') === 'true') LS(keyOf(id) + '_offlineOnly', 'true');
    switchTo(id);
  }
  function remove(id) {
    if (id === 'main' || id === ACTIVE_CO) return;
    write(list().filter(c => c.id !== id));
    ['', '_cloud', '_offlineOnly', '_lastBackup'].forEach(s => LS(keyOf(id) + s, null));
  }

  function open() {
    const l = list();
    const count = id => { try { const d = id === ACTIVE_CO ? db : JSON.parse(LS(keyOf(id)) || 'null'); return d ? `${(d.customers || []).length} customers · ${(d.docs || []).length} invoices & quotes` : 'No data yet'; } catch (e) { return ''; } };
    openSheet('Companies', `
      <p class="hint" style="margin-top:0">Each company has its own customers, invoices, stock, accounts, logo, stamp and settings. Tap a company to switch to it.</p>
      <div class="list">${l.map(c => `<div class="item" style="gap:8px">
        <button type="button" class="main" data-sw="${c.id}" style="text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit;min-width:0">
          <div class="t">${esc(c.name)}${c.id === ACTIVE_CO ? ' <span class="badge b-green">Open now</span>' : ''}</div><div class="s">${esc(count(c.id))}</div></button>
        ${c.id !== 'main' && c.id !== ACTIVE_CO ? `<button type="button" class="btn danger" data-del="${c.id}" aria-label="Delete ${esc(c.name)}" style="flex:0 0 auto">${ICON.trash}</button>` : ''}
      </div>`).join('')}</div>
      <form id="coAdd" autocomplete="off" style="margin-top:14px">
        <div class="sec"><h2>Add a company</h2></div>
        <label class="f"><span>Company name</span><input class="in" name="name" placeholder="e.g. Expert Solutions" required maxlength="80"></label>
        <button class="btn pri full" type="submit">+ Create company &amp; open it</button>
        <p class="hint">The new company starts empty, with its own invoice numbers. Add its logo, stamp, phone and terms in Settings after it opens.</p>
      </form>`, el => {
      el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { if (b.dataset.sw !== ACTIVE_CO) switchTo(b.dataset.sw); else closeSheet(); });
      el.querySelector('#coAdd').onsubmit = e => {
        e.preventDefault(); const nm = (formData(e.target).name || '').trim();
        if (!nm) return;
        if (l.some(c => c.name.toLowerCase() === nm.toLowerCase())) { toast('A company with this name already exists'); return; }
        add(nm);
      };
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        const c = l.find(x => x.id === b.dataset.del); if (!c) return;
        openSheet('Delete ' + c.name, `<form id="coDel"><p>This deletes <b>${esc(c.name)}</b> and all its data on this device: ${esc(count(c.id))}. It can't be undone. Data already in the cloud stays there.</p>
          <label class="f"><span>Type the company name to confirm</span><input class="in" name="n" required autocomplete="off"></label>
          <button class="btn danger full" type="submit">Delete company</button></form>`, e2 => {
          e2.querySelector('#coDel').onsubmit = ev => {
            ev.preventDefault();
            if ((formData(ev.target).n || '').trim().toLowerCase() !== c.name.toLowerCase()) { toast('Name does not match'); return; }
            remove(c.id); closeSheet(() => { closeSheet(() => open()); toast('Company deleted'); });
          };
        });
      });
    });
  }

  /* entry points: More page (top), Settings */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    if (document.getElementById('mCo')) return;
    const first = document.querySelector('#main .item.rcard, #main .item');
    if (!first) return;
    const n = list().length;
    first.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mCo"><span class="ic">${ICON.user}</span><div class="main"><div class="t">Companies</div><div class="s">${esc(S().name)}${n > 1 ? ` · ${n} companies` : ' · add another company'}</div></div></button>`);
    document.getElementById('mCo').onclick = open;
  };
  const origSet = window.viewSettings;
  if (origSet) window.viewSettings = function () {
    const r = origSet.apply(this, arguments);
    setTimeout(() => {
      const all = document.querySelectorAll('.sheet'), el = all[all.length - 1];
      if (!el || el.querySelector('#setCo')) return;
      const body = el.querySelector('.sb>div') || el.querySelector('.sb');
      if (!body) return;
      body.insertAdjacentHTML('afterbegin', `<button type="button" class="btn full" id="setCo" style="margin-bottom:12px">${ICON.user}Companies · switch or add (${list().length})</button>`);
      el.querySelector('#setCo').onclick = open;
    }, 0);
    return r;
  };

  window.FitxCo = {list, open, switchTo, add, active: () => ACTIVE_CO};
})();
