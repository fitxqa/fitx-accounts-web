/* FitX Accounts — Receipt photos (phone app only).
   Take photos of receipts / bills / bank slips with the camera or pick from the gallery, keep them in a small inbox on
   this phone, then "Send to Claude" shares them in one go (Android share menu → Claude app) for the daily data entry.
   Photos stay only on this phone (IndexedDB), compressed to ~1600 px JPEG; nothing goes to the cloud. */
(function () {
  'use strict';
  if (!window.AndroidBridge) return; // mobile app only

  /* ---------- tiny IndexedDB store ---------- */
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open('fitx_receipts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', {keyPath: 'id'});
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const tx = async (mode, fn) => { const d = await idb(); return new Promise((ok, no) => { const t = d.transaction('photos', mode); const st = t.objectStore('photos'); const res = fn(st); t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res); t.onerror = () => no(t.error); }); };
  const all = () => tx('readonly', st => st.getAll()).then(l => (l || []).sort((a, b) => b.at - a.at));
  const put = p => tx('readwrite', st => st.put(p));
  const del = id => tx('readwrite', st => st.delete(id));

  /* compress a picked/taken image to JPEG ≤ 1600 px */
  function compress(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.72));
      };
      im.onerror = () => { URL.revokeObjectURL(url); no(new Error('not an image')); };
      im.src = url;
    });
  }

  const CAM = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
  const css = document.createElement('style');
  css.textContent = `
    .rcgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin:6px 0 12px}
    .rcph{position:relative;border-radius:12px;overflow:hidden;background:var(--line);aspect-ratio:3/4;border:2px solid transparent}
    .rcph img{width:100%;height:100%;object-fit:cover;display:block}
    .rcph.sent{opacity:.55}
    .rcph b{position:absolute;left:6px;top:6px;font-size:10px;background:rgba(0,0,0,.65);color:#fff;border-radius:6px;padding:2px 6px}
    .rcph button{position:absolute;right:4px;top:4px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:16px;line-height:30px;padding:0}
    .rcph i{position:absolute;left:0;right:0;bottom:0;font-style:normal;font-size:10.5px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.75));padding:14px 6px 5px}`;
  document.head.appendChild(css);

  function pick(capture) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (capture) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = async () => {
      const files = Array.from(inp.files || []); inp.remove();
      if (!files.length) return;
      let n = 0;
      for (const f of files) { try { await put({id: uid(), at: Date.now(), img: await compress(f), note: '', status: 'new'}); n++; } catch (e) {} }
      toast(n + ' photo' + (n === 1 ? '' : 's') + ' added');
      refresh();
      if (capture) setTimeout(() => { if (confirm('Photo saved. Take another one?')) pick(true); }, 350);
    };
    inp.click();
  }

  let refresh = () => {};
  async function view() {
    const list = await all();
    const fresh = list.filter(p => p.status === 'new');
    openSheet('Receipt photos', `
      <p class="hint" style="margin-top:0">Photograph today's receipts, supplier bills, bank slips or voucher pages, then send them to Claude for data entry. Photos are kept only on this phone.</p>
      <div class="row" style="margin-bottom:10px"><button type="button" class="btn pri" id="rcCam">${CAM} Take photo</button><button type="button" class="btn" id="rcGal">${ICON.box} From gallery</button></div>
      <div id="rcBody"></div>`, el => {
      const body = el.querySelector('#rcBody');
      el.querySelector('#rcCam').onclick = () => pick(true);
      el.querySelector('#rcGal').onclick = () => pick(false);
      refresh = async () => {
        if (!document.body.contains(body)) return;
        const L = await all(), N = L.filter(p => p.status === 'new'), Sx = L.filter(p => p.status !== 'new');
        body.innerHTML = `
          ${N.length ? `<div class="sec"><h2>Not sent yet (${N.length})</h2></div>
            <div class="rcgrid">${N.map(p => `<div class="rcph" data-ph="${p.id}"><img src="${p.img}" alt="Receipt photo"><button type="button" data-del="${p.id}" aria-label="Delete photo">×</button>${p.note ? `<i>${esc(p.note)}</i>` : ''}</div>`).join('')}</div>
            <label class="f"><span>Message for Claude (optional)</span><input class="in" id="rcMsg" placeholder="e.g. Belts bill paid cash · Aspire paid by Fawran"></label>
            <button type="button" class="btn pri full" id="rcSend">${ICON.share}Send ${N.length} photo${N.length === 1 ? '' : 's'} to Claude</button>
            <p class="hint" style="margin:8px 2px 0">Choose the <b>Claude</b> app in the share menu, then send the message. You get back the entries to paste in Menu → Import entries.</p>`
          : `<div class="list"><div class="empty">No new photos. Tap <b>Take photo</b> to add today's receipts.</div></div>`}
          ${Sx.length ? `<div class="sec" style="margin-top:14px"><h2>Already sent (${Sx.length})</h2></div>
            <div class="rcgrid">${Sx.slice(0, 30).map(p => `<div class="rcph sent" data-ph="${p.id}"><img src="${p.img}" alt="Sent receipt photo"><b>Sent ${new Date(p.sentAt || p.at).toLocaleDateString()}</b><button type="button" data-del="${p.id}" aria-label="Delete photo">×</button></div>`).join('')}</div>
            <button type="button" class="btn full" id="rcClr">Delete all sent photos</button>` : ''}`;
        body.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => { e.stopPropagation(); if (!confirm('Delete this photo?')) return; await del(b.dataset.del); refresh(); });
        body.querySelectorAll('[data-ph]').forEach(d => d.onclick = () => photo(L.find(p => p.id === d.dataset.ph)));
        const sd = body.querySelector('#rcSend'); if (sd) sd.onclick = () => send(N, (body.querySelector('#rcMsg') || {}).value || '');
        const cl = body.querySelector('#rcClr'); if (cl) cl.onclick = async () => { if (!confirm('Delete all photos already sent?')) return; for (const p of Sx) await del(p.id); refresh(); };
      };
      refresh();
    });
  }

  function photo(p) {
    if (!p) return;
    openSheet('Receipt photo', `<img src="${p.img}" alt="Receipt photo" style="width:100%;border-radius:12px;margin-bottom:12px">
      <label class="f"><span>Note (sent with the photo)</span><input class="in" id="phNote" value="${esc(p.note || '')}" placeholder="e.g. paid cash · for Al Sadd job"></label>
      <button type="button" class="btn pri full" id="phSave">Save note</button>
      ${p.status !== 'new' ? '<button type="button" class="btn full" id="phAgain" style="margin-top:8px">Mark as not sent</button>' : ''}`, el => {
      el.querySelector('#phSave').onclick = async () => { p.note = el.querySelector('#phNote').value.trim(); await put(p); closeSheet(() => refresh()); };
      const ag = el.querySelector('#phAgain'); if (ag) ag.onclick = async () => { p.status = 'new'; await put(p); closeSheet(() => refresh()); };
    });
  }

  async function send(list, msg) {
    if (!list.length) return;
    const d = today();
    const notes = list.map((p, i) => p.note ? `Photo ${i + 1}: ${p.note}` : '').filter(Boolean);
    const text = `FitX data entry – ${dfmt(d)}: ${list.length} receipt photo${list.length === 1 ? '' : 's'}. Please prepare the import entries.${msg ? '\n' + msg : ''}${notes.length ? '\n' + notes.join('\n') : ''}`;
    const files = list.map((p, i) => ({b64: p.img.split(',')[1], name: `FitX-receipt-${d}-${i + 1}.jpg`, mime: 'image/jpeg'}));
    try {
      if (AndroidBridge.shareFiles) AndroidBridge.shareFiles(JSON.stringify(files), text);
      else if (files.length === 1) AndroidBridge.shareFile(files[0].b64, 'image/jpeg', files[0].name, text);
      else { toast('Please update the app to send several photos at once'); return; }
    } catch (e) { toast('Could not share the photos'); return; }
    for (const p of list) { p.status = 'sent'; p.sentAt = Date.now(); await put(p); }
    setTimeout(refresh, 600);
  }

  /* Menu row + button on the Import entries screen */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const k = document.getElementById('mImp') || document.getElementById('mBak'); if (!k || document.getElementById('mRcp')) return;
    k.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mRcp"><span class="ic">${CAM}</span><div class="main"><div class="t">Receipt photos</div><div class="s">Take photos of receipts & bills · send to Claude for data entry</div></div></button>`);
    document.getElementById('mRcp').onclick = view;
  };
  window.FitxReceipts = {view, pick};
})();
