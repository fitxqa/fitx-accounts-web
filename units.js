/* FitX Accounts — units of measure and room-size (area) calculator.
   • Unit list (pcs, m², m, roll, tile …) offered on every product.
   • Lines whose product is sold per m² get a "Room size" button: enter length × width per room (+ wastage %),
     the quantity becomes the total m² and the room sizes print under the line.
   Line fields: l.unit, l.dims = [{name, l, w}], l.waste (%) */
(function () {
  'use strict';
  const UNITS = [['pcs', 'Pieces'], ['m²', 'Square metre'], ['m', 'Running metre'], ['m³', 'Cubic metre'], ['roll', 'Roll'], ['tile', 'Tile'], ['box', 'Box'], ['set', 'Set'], ['pair', 'Pair'], ['pack', 'Pack'],
    ['kg', 'Kilogram'], ['litre', 'Litre'], ['sheet', 'Sheet'], ['job', 'Job'], ['hour', 'Hour'], ['day', 'Day'], ['visit', 'Visit'], ['month', 'Month'], ['year', 'Year'], ['lot', 'Lot']];
  const dl = document.createElement('datalist'); dl.id = 'unitList';
  dl.innerHTML = UNITS.map(([u, l]) => `<option value="${u}">${l}</option>`).join('');
  document.body.appendChild(dl);

  const isArea = u => /^(m²|m2|sqm|sq\.? ?m|square met(er|re)s?)$/i.test(String(u || '').trim());
  window.lineUnit = l => ((l.itemId && itemById(l.itemId)) || {}).unit || l.unit || '';
  const HIDE = /^(|pcs|pc|nos|no|job|ea|each)$/i;
  window.unitSfx = l => { const u = lineUnit(l); return HIDE.test(u) ? '' : ' ' + esc(isArea(u) ? 'm²' : u); };
  const area = d => num(d.l) * num(d.w);
  const total = l => { const a = (l.dims || []).reduce((s, d) => s + area(d), 0); return r2(a * (1 + num(l.waste) / 100)); };
  const f2 = n => (+num(n).toFixed(2)).toFixed(2);
  window.dimsHTML = l => !(l.dims || []).length ? '' : `<div class="lnote" style="color:#555">${l.dims.map(d => `${d.name ? esc(d.name) + ': ' : ''}${f2(d.l)} × ${f2(d.w)} m = ${f2(area(d))} m²`).join('<br>')}${l.waste ? `<br>+ ${num(l.waste)}% cutting allowance` : ''}${l.dims.length > 1 || l.waste ? `<br><b>Total ${f2(total(l))} m²</b>` : ''}</div>`;
  window.dimsText = l => !(l.dims || []).length ? '' : '\n   ' + l.dims.map(d => `${d.name ? d.name + ': ' : ''}${f2(d.l)} × ${f2(d.w)} m = ${f2(area(d))} m²`).join('\n   ') + (l.waste ? `\n   + ${num(l.waste)}% allowance` : '');
  window.roomBtn = l => isArea(lineUnit(l)) || (l.dims || []).length
    ? `<button type="button" class="btn full lroom" style="margin:2px 0 8px"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h4M9 3v4M3 15h3M15 3v3"/></svg>${(l.dims || []).length ? `Room size: ${l.dims.length} area${l.dims.length > 1 ? 's' : ''} = ${f2(total(l))} m² – edit` : 'Room size (length × width) → m²'}</button>` : '';

  window.roomSize = function (l, done) {
    const rows = (l.dims || []).length ? l.dims.map(d => Object.assign({}, d)) : [{name: '', l: '', w: ''}];
    let waste = l.waste || '';
    openSheet('Room size – square metres', `
      <p class="hint" style="margin-top:0">Measure each room or area in metres. The quantity becomes the total m².</p>
      <div id="rmRows"></div>
      <button type="button" class="btn full" id="rmAdd" style="margin-bottom:12px">+ Add room / area</button>
      <label class="f"><span>Cutting / wastage allowance</span><select class="in" id="rmWaste">${[0, 3, 5, 7, 10, 15].map(p => `<option value="${p}" ${num(waste) === p ? 'selected' : ''}>${p ? '+ ' + p + '%' : 'None'}</option>`).join('')}</select></label>
      <div class="tot" id="rmTot"></div>
      <button type="button" class="btn pri full" id="rmOk">Use this quantity</button>
      ${(l.dims || []).length ? '<button type="button" class="btn full" id="rmClr" style="margin-top:8px">Remove room sizes</button>' : ''}`, el => {
      const R = el.querySelector('#rmRows');
      const tot = () => {
        const a = rows.reduce((s, d) => s + area(d), 0), t = a * (1 + num(waste) / 100);
        el.querySelector('#rmTot').innerHTML = `<div><span>Measured area</span><span>${f2(a)} m²</span></div>${num(waste) ? `<div><span>+ ${num(waste)}% allowance</span><span>${f2(t - a)} m²</span></div>` : ''}<div class="g"><span>Quantity</span><span>${f2(t)} m²</span></div>${num(l.price) ? `<div><span>× ${fmt(num(l.price))}</span><span>${money(t * num(l.price))}</span></div>` : ''}`;
        R.querySelectorAll('[data-r]').forEach(row => { row.querySelector('.rma').textContent = f2(area(rows[+row.dataset.r])) + ' m²'; });
      };
      const draw = () => {
        R.innerHTML = rows.map((d, i) => `<div class="line" data-r="${i}" style="padding:10px 12px">
          <div class="lt"><input class="in rmn" value="${esc(d.name || '')}" placeholder="Room ${i + 1} (e.g. Gym floor, Free-weight area)" aria-label="Room name" style="flex:1">${rows.length > 1 ? '<button type="button" class="ldel rmdel">Remove</button>' : ''}</div>
          <div class="row3" style="margin-top:8px"><label><span class="hint">Length (m)</span><input class="in rml" type="number" step="0.01" min="0" inputmode="decimal" value="${d.l}" placeholder="0.00"></label>
            <label><span class="hint">Width (m)</span><input class="in rmw" type="number" step="0.01" min="0" inputmode="decimal" value="${d.w}" placeholder="0.00"></label>
            <div><span class="hint">Area</span><div class="amt rma"></div></div></div></div>`).join('');
        tot();
      };
      R.addEventListener('input', e => {
        const row = e.target.closest('[data-r]'); if (!row) return; const d = rows[+row.dataset.r];
        if (e.target.classList.contains('rmn')) d.name = e.target.value;
        if (e.target.classList.contains('rml')) d.l = e.target.value;
        if (e.target.classList.contains('rmw')) d.w = e.target.value;
        tot();
      });
      R.addEventListener('click', e => { const b = e.target.closest('.rmdel'); if (b) { rows.splice(+b.closest('[data-r]').dataset.r, 1); draw(); } });
      el.querySelector('#rmAdd').onclick = () => { rows.push({name: '', l: '', w: ''}); draw(); const ins = R.querySelectorAll('.rml'); ins[ins.length - 1].focus(); };
      el.querySelector('#rmWaste').onchange = e => { waste = e.target.value; tot(); };
      el.querySelector('#rmOk').onclick = () => {
        const ok = rows.filter(d => area(d) > 0).map(d => ({name: (d.name || '').trim(), l: num(d.l), w: num(d.w)}));
        if (!ok.length) { toast('Enter length and width'); return; }
        l.dims = ok; l.waste = num(waste); l.qty = total(l);
        if (!l.unit) l.unit = 'm²';
        closeSheet(done);
      };
      const clr = el.querySelector('#rmClr'); if (clr) clr.onclick = () => { delete l.dims; delete l.waste; closeSheet(done); };
      draw();
    });
  };
  window.FitxUnits = {UNITS, isArea};
})();
