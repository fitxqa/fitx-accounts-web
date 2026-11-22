/* FitX Accounts — belt production (making treadmill running belts from conveyor belt rolls).
   Materials (belt rolls 1.6 / 1.8 / 2.0 / 2.2 mm, splice film, glue…) are normal stock items bought on bills.
   A recipe says what one belt of a size uses; a production run "makes N belts": materials leave stock and the
   finished belt item comes into stock at the real cost (materials at their stock cost + labour + machine per belt).
   Selling the belt on an invoice then uses that cost, so profit per belt is right.
   Books: materials → finished belt is stock to stock (no entry); labour + machine cost moved into stock:
          Dr Spare parts stock, Cr 5040 Production costs absorbed.
   Records: db.recipes = [{id, productId, L, W, thick, extraMm, measure:'m'|'m2', lines:[{itemId, qty}], labour, machine, created}]
            db.prods   = [{id, number, date, recipeId, productId, qty, lines:[{itemId, qty, cost}], labour, machine, unitCost, note, created}] */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['recipes', 'prods']);
  const ACC_ABS = 'acc_5040';
  const THICK = ['1.6', '1.8', '2.0', '2.2'];
  function ensure() {
    if (!Array.isArray(db.recipes)) db.recipes = [];
    if (!Array.isArray(db.prods)) db.prods = [];
    if (Array.isArray(db.accounts) && !db.accounts.some(a => a.id === ACC_ABS)) db.accounts.push({id: ACC_ABS, code: '5040', name: 'Production costs absorbed (belts)', type: 'expense', sub: 'prodabs', system: true});
  }
  ensure();
  { const st = document.createElement('style'); st.textContent = '@media (min-width:700px){.btns.prbtns{grid-template-columns:repeat(3,1fr)}}'; document.head.appendChild(st); }
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(ensure);

  const recById = id => db.recipes.find(r => r.id === id);
  const prodById = id => db.prods.find(p => p.id === id);
  const fq = q => String(+num(q).toFixed(3));
  const iname = id => (itemById(id) || {}).name || '(deleted item)';
  const iunit = id => (itemById(id) || {}).unit || '';
  const rollSku = t => 'BELT-ROLL-' + t;
  const rollOf = t => db.items.find(i => i.sku === rollSku(t));
  // the four conveyor belt rolls you buy, created the first time Production is opened
  function seedRolls() {
    let n = 0;
    THICK.forEach(t => { if (!rollOf(t)) { db.items.push({id: uid(), name: `Conveyor belt roll ${t} mm`, sku: rollSku(t), category: 'Belt making materials', cost: 0, price: 0, unit: 'm', minQty: 0, service: false}); n++; } });
    if (n) save();
  }
  const recCost = r => r2((r.lines || []).reduce((s, l) => s + num(l.qty) * num((itemById(l.itemId) || {}).cost), 0) + num(r.labour) + num(r.machine));
  const runUnit = p => r2(num(p.unitCost));
  const absorbed = p => r2(num(p.qty) * (num(p.labour) + num(p.machine)));
  const recName = r => iname(r.productId);
  const nextNo = () => { const s = S(); const n = s.nextPRD || 1; s.nextPRD = n + 1; return `${s.prdPrefix || 'PRD'}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; };

  /* ---------- stock + books ---------- */
  (window.FITX_STOCK_FLOWS = window.FITX_STOCK_FLOWS || []).push(itemId => {
    const out = [];
    db.prods.forEach(p => {
      if (p.productId === itemId) out.push({date: p.date, qty: num(p.qty), src: 'prod'});
      (p.lines || []).forEach(l => { if (l.itemId === itemId) out.push({date: p.date, qty: -num(l.qty), src: 'use'}); });
    });
    return out;
  });
  (window.FITX_POSTERS = window.FITX_POSTERS || []).push((add, A) => {
    db.prods.forEach(p => {
      const v = absorbed(p); if (v <= 0) return;
      const open = () => viewRun(p.id);
      add('prd:' + p.id + ':inv', p.date, A(1300), v, `Belts made · ${fq(p.qty)} × ${iname(p.productId)}`, p.number, open);
      add('prd:' + p.id + ':abs', p.date, ACC_ABS, -v, 'Labour & machine cost moved into belt stock', p.number, open);
    });
  });
  // P&L: labour / machine already paid as salaries or expenses is carried in the belt cost, so take it off once
  (window.FITX_ACCT_HOOKS = window.FITX_ACCT_HOOKS || []).push((a, f, t) => {
    db.prods.forEach(p => { if (p.date >= f && p.date <= t) a.stockAdj -= absorbed(p); });
  });

  /* ---------- home ---------- */
  function home() {
    seedRolls();
    const rolls = THICK.map(t => rollOf(t)).filter(Boolean);
    const runs = db.prods.slice().sort((a, b) => String(b.date + b.number).localeCompare(String(a.date + a.number)));
    openSheet('Belt production', `
      <div class="btns prbtns" style="margin-bottom:12px"><button type="button" class="btn pri" id="prMake">${ICON.wrench || ''}Make belts</button><button type="button" class="btn" id="prRec">+ New belt recipe</button><button type="button" class="btn" id="prBill">+ Buy materials (bill)</button></div>
      <div class="sec"><h2>Belt rolls in stock</h2><span class="hint">buy them on a bill</span></div>
      <div class="list">${rolls.map(i => `<button type="button" class="item" data-item="${i.id}"><div class="main"><div class="t">${esc(i.name)}</div><div class="s">${num(i.cost) ? 'Cost ' + fmt(i.cost) + ' per ' + esc(i.unit || 'm') : 'No cost yet – record the roll on a bill'}</div></div><div class="amt">${fq(stockQty(i.id))} ${esc(i.unit || 'm')}</div></button>`).join('')}</div>
      <div class="sec"><h2>Belt recipes</h2><span class="hint">what one belt uses</span></div>
      <div class="list">${db.recipes.length ? db.recipes.map(r => `<button type="button" class="item" data-rec="${r.id}"><div class="main"><div class="t">${esc(recName(r))}</div><div class="s">${(r.lines || []).map(l => fq(l.qty) + ' ' + esc(iunit(l.itemId)) + ' ' + esc(iname(l.itemId))).join(' · ')}</div></div><div class="amt">${fmt(recCost(r))}<div class="hint" style="font-weight:400">per belt</div></div></button>`).join('') : '<div class="empty">No recipes yet. Add one for each belt size you make (length × width × thickness).</div>'}</div>
      <div class="sec"><h2>Production runs</h2></div>
      <div class="list">${runs.length ? runs.slice(0, 60).map(p => `<button type="button" class="item" data-run="${p.id}"><div class="main"><div class="t">${esc(p.number)} · ${fq(p.qty)} × ${esc(iname(p.productId))}</div><div class="s">${dfmt(p.date)} · ${fmt(runUnit(p))} per belt</div></div><div class="amt">${fmt(r2(num(p.qty) * runUnit(p)))}</div></button>`).join('') : '<div class="empty">No belts made yet.</div>'}</div>`, el => {
      el.querySelector('#prMake').onclick = () => make();
      el.querySelector('#prRec').onclick = () => editRecipe();
      el.querySelector('#prBill').onclick = () => editPurchase(null, {lines: rolls.map(i => ({itemId: i.id, desc: i.name, qty: '', cost: i.cost || ''}))});
      el.querySelectorAll('[data-item]').forEach(b => b.onclick = () => window.viewItem ? viewItem(b.dataset.item) : editItem(b.dataset.item));
      el.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => editRecipe(b.dataset.rec));
      el.querySelectorAll('[data-run]').forEach(b => b.onclick = () => viewRun(b.dataset.run));
    });
  }
  const reHome = () => { while (sheets.length) closeTopSheet(); home(); render(); };

  /* ---------- recipe ---------- */
  function editRecipe(id) {
    seedRolls();
    const ex = id ? recById(id) : null;
    const r = ex ? JSON.parse(JSON.stringify(ex)) : {L: '', W: '', thick: '2.0', extraMm: 0, measure: 'm', lines: [], labour: '', machine: ''};
    const itemOpts = sel => '<option value="">Choose material…</option>' + db.items.filter(i => !i.service).sort((a, b) => (a.category === 'Belt making materials' ? 0 : 1) - (b.category === 'Belt making materials' ? 0 : 1) || a.name.localeCompare(b.name)).map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}${i.unit ? ' (' + esc(i.unit) + ')' : ''}</option>`).join('');
    // the roll line is calculated from the size; other lines are typed
    const extras = (r.lines || []).filter(l => !THICK.some(t => rollOf(t) && rollOf(t).id === l.itemId));
    openSheet(ex ? 'Edit belt recipe' : 'New belt recipe', `<form id="rcForm" autocomplete="off">
      <div class="sec" style="margin-top:0"><h2>Belt size</h2></div>
      <div class="row"><label class="f"><span>Length (mm)</span><input class="in" type="number" min="1" inputmode="numeric" name="L" id="rcL" value="${esc(r.L)}" placeholder="e.g. 3000" required></label>
      <label class="f"><span>Width (mm)</span><input class="in" type="number" min="1" inputmode="numeric" name="W" id="rcW" value="${esc(r.W)}" placeholder="e.g. 500" required></label></div>
      <div class="row"><label class="f"><span>Thickness</span><select class="in" name="thick" id="rcT">${THICK.map(t => `<option value="${t}" ${r.thick === t ? 'selected' : ''}>${t} mm</option>`).join('')}</select></label>
      <label class="f"><span>Extra length for joint (mm)</span><input class="in" type="number" min="0" inputmode="numeric" name="extraMm" id="rcX" value="${esc(r.extraMm || 0)}"></label></div>
      <label class="f"><span>Belt roll is bought by</span><select class="in" name="measure" id="rcM"><option value="m" ${r.measure !== 'm2' ? 'selected' : ''}>Running metre (roll already the belt width)</option><option value="m2" ${r.measure === 'm2' ? 'selected' : ''}>Square metre (m²) – cut to width</option></select></label>
      <div class="card" id="rcRoll" style="margin-bottom:12px"></div>
      <div class="sec"><h2>Other materials per belt</h2><span class="hint">splice film, glue…</span></div>
      <div id="rcLines"></div><button type="button" class="btn full" id="rcAdd">+ Add material</button>
      <div class="sec"><h2>Labour &amp; machine per belt</h2><span class="hint">optional</span></div>
      <div class="row"><label class="f"><span>Labour (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="labour" id="rcLab" value="${esc(r.labour)}" placeholder="0.00"></label>
      <label class="f"><span>Machine &amp; power (QAR)</span><input class="in" type="number" step="0.01" min="0" inputmode="decimal" name="machine" id="rcMac" value="${esc(r.machine)}" placeholder="0.00"></label></div>
      <p class="hint" style="margin-top:-4px">Only add labour if you want it inside the belt cost. It is taken off your P&amp;L once, so salaries are not counted twice.</p>
      <div class="tot" id="rcTot"></div>
      <button class="btn pri full" type="submit">Save recipe</button>
      ${ex ? '<button class="btn danger full" type="button" id="rcDel" style="margin-top:8px">Delete recipe</button>' : ''}</form>`, el => {
      const v = s => el.querySelector(s).value;
      const rollQty = () => { const L = num(v('#rcL')), W = num(v('#rcW')), x = num(v('#rcX')); const m = (L + x) / 1000; return r2(v('#rcM') === 'm2' ? m * W / 1000 : m) ; };
      const roll = () => rollOf(v('#rcT'));
      const drawLines = () => {
        el.querySelector('#rcLines').innerHTML = extras.map((l, i) => `<div class="row" style="align-items:end"><label class="f"><span>Material</span><select class="in eI" data-i="${i}">${itemOpts(l.itemId)}</select></label><label class="f" style="max-width:120px"><span>Qty / belt</span><input class="in eQ" data-i="${i}" type="number" step="any" min="0" inputmode="decimal" value="${esc(l.qty)}"></label><button type="button" class="btn eD" data-i="${i}" style="margin-bottom:12px;flex:0 0 auto" aria-label="Remove">✕</button></div>`).join('');
        el.querySelectorAll('.eI').forEach(e => e.onchange = () => { extras[+e.dataset.i].itemId = e.value; tot(); });
        el.querySelectorAll('.eQ').forEach(e => e.oninput = () => { extras[+e.dataset.i].qty = num(e.value); tot(); });
        el.querySelectorAll('.eD').forEach(e => e.onclick = () => { extras.splice(+e.dataset.i, 1); drawLines(); tot(); });
      };
      const tot = () => {
        const rl = roll(), q = rollQty(), c = rl ? num(rl.cost) : 0;
        const mat = q * c + extras.reduce((s, l) => s + num(l.qty) * num((itemById(l.itemId) || {}).cost), 0);
        el.querySelector('#rcRoll').innerHTML = rl ? `<b>${esc(rl.name)}</b><div class="hint">${fq(q)} ${v('#rcM') === 'm2' ? 'm²' : 'm'} per belt × ${num(c) ? fmt(c) : '<span style="color:var(--yellow)">no cost yet</span>'} = <b style="color:var(--text)">${fmt(q * c)}</b> · in stock ${fq(stockQty(rl.id))} ${esc(rl.unit || 'm')}</div>` : '';
        const unit = r2(mat + num(v('#rcLab')) + num(v('#rcMac')));
        el.querySelector('#rcTot').innerHTML = `<div class="g"><span>Cost per belt (today's prices)</span><span>${money(unit)}</span></div>`;
      };
      ['#rcL', '#rcW', '#rcX', '#rcLab', '#rcMac'].forEach(s => el.querySelector(s).oninput = tot);
      ['#rcT', '#rcM'].forEach(s => el.querySelector(s).onchange = tot);
      el.querySelector('#rcAdd').onclick = () => { extras.push({itemId: '', qty: 1}); drawLines(); };
      drawLines(); tot();
      const del = el.querySelector('#rcDel'); if (del) del.onclick = () => { if (!confirm('Delete this recipe? Belts already made are not changed.')) return; db.recipes = db.recipes.filter(x => x.id !== id); save(); reHome(); };
      el.querySelector('#rcForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target);
        const L = Math.round(num(f.L)), W = Math.round(num(f.W)), t = f.thick, rl = rollOf(t);
        if (!L || !W) { toast('Enter the belt length and width'); return; }
        // finished belt item – same name / code the treadmill part finder uses
        const sku = `RB-${L}x${W}-${t}`;
        let prod = db.items.find(i => i.sku === sku);
        if (!prod) { prod = {id: uid(), name: `Running belt ${L}×${W} mm (${t} mm)`, sku, category: 'Running belts', cost: 0, price: 0, unit: 'pcs', minQty: 0, service: false}; db.items.push(prod); }
        const lines = [{itemId: rl.id, qty: rollQty()}].concat(extras.filter(l => l.itemId && num(l.qty) > 0).map(l => ({itemId: l.itemId, qty: num(l.qty)})));
        const data = {productId: prod.id, L, W, thick: t, extraMm: num(f.extraMm), measure: f.measure, lines, labour: r2(num(f.labour)), machine: r2(num(f.machine))};
        if (ex) Object.assign(ex, data, {updated: Date.now()}); else db.recipes.push(Object.assign({id: uid(), created: String(Date.now())}, data));
        save(); toast('Recipe saved · ' + prod.name); reHome();
      };
    });
  }

  /* ---------- make belts ---------- */
  function make(recipeId) {
    seedRolls();
    if (!db.recipes.length) { toast('Add a belt recipe first'); editRecipe(); return; }
    let rid = recipeId || db.recipes[0].id;
    openSheet('Make belts', `<form id="mkForm" autocomplete="off">
      <label class="f"><span>Belt</span><select class="in" name="recipe" id="mkR">${db.recipes.map(r => `<option value="${r.id}" ${r.id === rid ? 'selected' : ''}>${esc(recName(r))}</option>`).join('')}</select></label>
      <div class="row"><label class="f"><span>Quantity made</span><input class="in" type="number" min="1" step="1" inputmode="numeric" name="qty" id="mkQ" value="1" required></label>
      <label class="f"><span>Date</span><input class="in" type="date" name="date" value="${today()}" required></label></div>
      <div class="sec"><h2>Materials used</h2></div><div class="card" id="mkMat" style="padding:6px 12px"></div>
      <div class="tot" id="mkTot"></div>
      <label class="f"><span>Note</span><input class="in" name="note" placeholder="Optional, e.g. order for Aspire Zone"></label>
      <button class="btn pri full" type="submit">Save production</button></form>`, el => {
      const draw = () => {
        rid = el.querySelector('#mkR').value; const r = recById(rid), q = Math.max(0, num(el.querySelector('#mkQ').value));
        if (!r) return;
        let mat = 0, short = [];
        el.querySelector('#mkMat').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">${(r.lines || []).map(l => {
          const it = itemById(l.itemId) || {}, need = num(l.qty) * q, have = stockQty(l.itemId), c = need * num(it.cost); mat += c;
          if (need > have + 0.0001) short.push(it.name);
          return `<tr style="border-bottom:1px solid var(--line)"><td style="padding:7px 0"><b>${esc(it.name || '?')}</b><div class="hint">${fq(need)} ${esc(it.unit || '')} · in stock ${fq(have)}${need > have + 0.0001 ? ' <b style="color:var(--red)">short</b>' : ''}</div></td><td style="text-align:right;white-space:nowrap">${fmt(c)}</td></tr>`;
        }).join('')}${num(r.labour) ? `<tr style="border-bottom:1px solid var(--line)"><td style="padding:7px 0">Labour<div class="hint">${fmt(r.labour)} × ${q}</div></td><td style="text-align:right">${fmt(num(r.labour) * q)}</td></tr>` : ''}${num(r.machine) ? `<tr><td style="padding:7px 0">Machine &amp; power<div class="hint">${fmt(r.machine)} × ${q}</div></td><td style="text-align:right">${fmt(num(r.machine) * q)}</td></tr>` : ''}</table>`;
        const total = mat + (num(r.labour) + num(r.machine)) * q;
        el.querySelector('#mkTot').innerHTML = `<div class="g"><span>Cost per belt</span><span>${money(q ? total / q : 0)}</span></div><div class="hint" style="text-align:right;margin-top:4px">Total ${money(total)}${short.length ? ` · <b style="color:var(--red)">not enough stock: ${esc(short.join(', '))}</b>` : ''}</div>`;
      };
      el.querySelector('#mkR').onchange = draw; el.querySelector('#mkQ').oninput = draw; draw();
      el.querySelector('#mkForm').onsubmit = e => {
        e.preventDefault(); const f = formData(e.target), r = recById(f.recipe), q = Math.round(num(f.qty));
        if (!r || q <= 0) { toast('Enter how many belts were made'); return; }
        const lines = (r.lines || []).map(l => ({itemId: l.itemId, qty: r2(num(l.qty) * q * 1000) / 1000, cost: num((itemById(l.itemId) || {}).cost)}));
        const short = lines.filter(l => l.qty > stockQty(l.itemId) + 0.0001);
        if (short.length && !confirm(`Not enough stock of ${short.map(l => iname(l.itemId)).join(', ')}. Save anyway? (stock will go below zero – record the bill for the roll)`)) return;
        const mat = lines.reduce((s, l) => s + l.qty * l.cost, 0);
        const unitCost = r2((mat + (num(r.labour) + num(r.machine)) * q) / q);
        // finished belt: weighted average cost with what is already in stock
        const prod = itemById(r.productId);
        if (prod) { const have = Math.max(0, stockQty(prod.id)); prod.cost = r2((have * num(prod.cost) + q * unitCost) / (have + q)); }
        const run = {id: uid(), number: nextNo(), date: f.date, recipeId: r.id, productId: r.productId, qty: q, lines, labour: num(r.labour), machine: num(r.machine), unitCost, note: (f.note || '').trim(), created: String(Date.now())};
        db.prods.push(run); save();
        closeSheet(() => { toast(`${q} belt${q === 1 ? '' : 's'} added to stock`); viewRun(run.id); render(); });
      };
    });
  }

  /* ---------- run view ---------- */
  function viewRun(id) {
    const p = prodById(id); if (!p) return;
    const mat = (p.lines || []).reduce((s, l) => s + num(l.qty) * num(l.cost), 0);
    const prod = itemById(p.productId) || {};
    openSheet(p.number, `
      <div class="card"><b>${fq(p.qty)} × ${esc(prod.name || '')}</b><div class="hint">${dfmt(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
      <div class="scroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>Used</th><th class="n">Qty</th><th class="n">Cost</th><th class="n">Amount</th></tr></thead><tbody>
        ${(p.lines || []).map(l => `<tr><td>${esc(iname(l.itemId))}</td><td class="n">${fq(l.qty)} ${esc(iunit(l.itemId))}</td><td class="n">${fmt(l.cost)}</td><td class="n">${fmt(num(l.qty) * num(l.cost))}</td></tr>`).join('')}
        ${num(p.labour) ? `<tr><td>Labour</td><td class="n">${fq(p.qty)}</td><td class="n">${fmt(p.labour)}</td><td class="n">${fmt(num(p.labour) * num(p.qty))}</td></tr>` : ''}
        ${num(p.machine) ? `<tr><td>Machine &amp; power</td><td class="n">${fq(p.qty)}</td><td class="n">${fmt(p.machine)}</td><td class="n">${fmt(num(p.machine) * num(p.qty))}</td></tr>` : ''}
      </tbody><tfoot><tr><td colspan="3">Total cost</td><td class="n">${fmt(r2(mat + absorbed(p)))}</td></tr><tr><td colspan="3"><b>Cost per belt</b></td><td class="n"><b>${fmt(p.unitCost)}</b></td></tr></tfoot></table></div>
      ${num(prod.price) ? `<div class="card" style="margin-top:12px">Selling price ${fmt(prod.price)} → profit per belt <b style="color:var(--green)">${fmt(r2(num(prod.price) - num(p.unitCost)))}</b></div>` : `<p class="hint" style="margin-top:12px">Set a selling price on the belt item to see the profit per belt.</p>`}
      <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="rvItem">${ICON.box || ''}Open belt item</button><button type="button" class="btn danger" id="rvDel">${ICON.trash}Delete run</button></div>`, el => {
      el.querySelector('#rvItem').onclick = () => window.viewItem ? viewItem(p.productId) : editItem(p.productId);
      el.querySelector('#rvDel').onclick = () => {
        if (!confirm(`Delete ${p.number}? The materials go back to stock and the ${fq(p.qty)} belts come out of stock.`)) return;
        db.prods = db.prods.filter(x => x.id !== id); save(); closeSheet(render); toast('Deleted');
      };
    });
  }

  /* ---------- More page row ---------- */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mStock');
    if (a && !document.getElementById('mPrd')) {
      a.insertAdjacentHTML('afterend', `<button type="button" class="item rcard" id="mPrd"><span class="ic">${ICON.wrench || ICON.box}</span><div class="main"><div class="t">Belt production</div><div class="s">Belt rolls, recipes and belts made · cost per belt</div></div></button>`);
      document.getElementById('mPrd').onclick = home;
    }
  };

  window.FitxProd = {home, make, editRecipe, viewRun, seedRolls};
})();
