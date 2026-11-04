/* FitX Accounts — company stamp on invoices & quotations.
   Each document can be "With stamp" or "Without stamp" (Design section of the invoice / quote screen).
   Default and stamp image: Menu → Company stamp (rebuilt FitX stamp, or upload your own scan). */
(function () {
  'use strict';
  const css = document.createElement('style');
  css.textContent = `
    .stseg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 4px}
    .stseg button{border:1.5px solid var(--line2);background:var(--card);border-radius:12px;padding:10px;font-weight:700;color:var(--text);display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px}
    .stseg button.on{border-color:var(--orange);background:var(--orange-l,#fff1e7);color:var(--orange-d,#e05d00)}
    .stseg img{width:28px;height:28px}
    .stprev{display:flex;justify-content:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}
    .stprev img{width:180px;height:180px}
    body.role-tech #mStamp{display:none!important}`;
  document.head.appendChild(css);
  const src = () => S().stampImg || window.FITX_STAMP_DATA || 'icons/stamp.png';
  // keep the built-in stamp as data so PDFs can always draw it
  fetch('icons/stamp.png').then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).then(u => { window.FITX_STAMP_DATA = u; }).catch(() => {});
  const isOn = d => d.stamp !== undefined ? !!d.stamp : S().stampOn !== false;

  // invoice / quote screen: With stamp | Without stamp
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id), el = typeof sheets !== 'undefined' && sheets[sheets.length - 1]; if (!d || !el) return;
    const lay = el.querySelector('#laySeg'); if (!lay || el.querySelector('#stSeg')) return;
    lay.insertAdjacentHTML('afterend', `<div class="stseg" id="stSeg" role="radiogroup" aria-label="Company stamp"><button type="button" data-st="1" class="${isOn(d) ? 'on' : ''}"><img src="${src()}" alt="">With stamp</button><button type="button" data-st="0" class="${isOn(d) ? '' : 'on'}">Without stamp</button></div>`);
    el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      d.stamp = b.dataset.st === '1'; d.updated = Date.now(); save();
      el.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b));
      const pv = el.querySelector('#docPrev'); if (pv) pv.innerHTML = docHTML(d);
      toast(d.stamp ? 'Stamp added' : 'Stamp removed');
    });
  };

  // settings: default + own stamp image
  function settings() {
    const s = S();
    openSheet('Company stamp', `
      <div class="stprev"><img id="stImg" src="${src()}" alt="Company stamp"></div>
      <div class="stseg"><button type="button" data-def="1" class="${s.stampOn !== false ? 'on' : ''}">Stamp on new documents</button><button type="button" data-def="0" class="${s.stampOn !== false ? '' : 'on'}">No stamp by default</button></div>
      <p class="hint">You can still switch each invoice or quote between “With stamp” and “Without stamp” on its screen (under Design).</p>
      <div class="btns" style="margin-top:8px"><label class="btn" style="cursor:pointer">${ICON.dl}Upload my own stamp<input type="file" accept="image/*" id="stUp" hidden></label><button type="button" class="btn" id="stReset">Use FitX stamp</button></div>
      <p class="hint">Best: a clear photo or scan of the stamp on white paper. The paper background is removed and the stamp is cropped automatically.</p>`, el => {
      el.querySelectorAll('[data-def]').forEach(b => b.onclick = () => { s.stampOn = b.dataset.def === '1'; save(); el.querySelectorAll('[data-def]').forEach(x => x.classList.toggle('on', x === b)); toast('Saved'); });
      el.querySelector('#stReset').onclick = () => { delete s.stampImg; save(); el.querySelector('#stImg').src = src(); toast('FitX stamp restored'); };
      el.querySelector('#stUp').onchange = ev => {
        const f = ev.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          const im = new Image();
          im.onload = () => {
            // 1) work copy (max 1000 px), 2) paper colour from the border, 3) ink = pixels far from the paper colour,
            // 4) crop square around the ink, 5) paper → transparent, max 400 px
            const k = Math.min(1, 1000 / Math.max(im.naturalWidth, im.naturalHeight));
            const W = Math.round(im.naturalWidth * k), H = Math.round(im.naturalHeight * k);
            const c1 = document.createElement('canvas'); c1.width = W; c1.height = H; const g1 = c1.getContext('2d'); g1.drawImage(im, 0, 0, W, H);
            const d1 = g1.getImageData(0, 0, W, H).data;
            let br = 0, bg = 0, bb = 0, bn = 0;
            const edge = Math.max(4, Math.round(Math.min(W, H) * 0.04));
            for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { if (x > edge && x < W - edge && y > edge && y < H - edge) continue; const i = (y * W + x) * 4; br += d1[i]; bg += d1[i + 1]; bb += d1[i + 2]; bn++; }
            br /= bn; bg /= bn; bb /= bn;
            const inkA = i => { const dr = d1[i] - br, dg = d1[i + 1] - bg, db = d1[i + 2] - bb; const dist = Math.sqrt(dr * dr + dg * dg + db * db); return Math.max(0, Math.min(1, (dist - 38) / 55)); };
            let x0 = W, y0 = H, x1 = 0, y1 = 0;
            for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (inkA((y * W + x) * 4) > 0.6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
            const side = Math.max(x1 - x0, y1 - y0) * 1.06, cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
            const size = Math.min(400, Math.round(side));
            const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d');
            const out = g.createImageData(size, size), o = out.data, sc = side / size;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
              const sx = Math.round(cxm - side / 2 + x * sc), sy = Math.round(cym - side / 2 + y * sc);
              if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
              const i = (sy * W + sx) * 4, j = (y * size + x) * 4, a = inkA(i);
              o[j] = d1[i]; o[j + 1] = d1[i + 1]; o[j + 2] = d1[i + 2]; o[j + 3] = Math.round(255 * a);
            }
            g.putImageData(out, 0, 0);
            s.stampImg = cv.toDataURL('image/png'); save();
            el.querySelector('#stImg').src = s.stampImg; toast('Your stamp is saved');
          };
          im.src = rd.result;
        };
        rd.readAsDataURL(f);
      };
    });
  }
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling; if (!list) return;
    list.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mStamp"><span class="ic"><img src="${src()}" alt="" style="width:24px;height:24px"></span><div class="main"><div class="t">Company stamp</div><div class="s">${S().stampOn !== false ? 'On invoices & quotes by default' : 'Off by default'} · change or upload</div></div></button>`);
    document.getElementById('mStamp').onclick = settings;
  };
  window.FitxStamp = {settings};
})();
