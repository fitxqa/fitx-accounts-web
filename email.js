/* FitX Accounts — email through the phone / computer mail app, and PDF preview.
   Email opens the mail app (Gmail, Outlook…) with the PDF attached, the customer's address, subject
   and a professional message with your signature; you tap Send there. Signature: Menu → Email signature. */
(function () {
  'use strict';
  const M = () => { const s = S(); s.mail = s.mail || {}; return s.mail; };

  /* ---------- PDF preview ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .pvw{display:grid;gap:14px;justify-items:center}
    .pvw .pg{width:100%;max-width:640px;aspect-ratio:1/1.4142;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18);position:relative;overflow:hidden}
    .pvw .pg img{position:absolute;left:0;width:100%}
    .pvw .pn{font-size:12px;color:var(--muted)}
    .sigpv{white-space:pre-wrap;font-size:13px;line-height:1.5;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
    body.role-tech #mMail{display:none!important}`;
  document.head.appendChild(css);
  async function pdfPreview(html, name) {
    toast('Preparing preview…');
    let r; try { r = await htmlToPdf(html, {pages: true}); } catch (e) { toast('Could not make the PDF: ' + e.message); return; }
    const kb = Math.round(r.b64.length * 3 / 4 / 1024);
    openSheet('PDF preview', `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn pri" id="pvShare">${ICON.share}Share PDF</button><button type="button" class="btn" id="pvSave">${ICON.dl}Save PDF</button></div>
      <p class="hint" style="margin-top:-4px">${esc(name)}.pdf · ${r.pages.length} page${r.pages.length > 1 ? 's' : ''} · ${kb} KB — exactly as the customer receives it.</p>
      <div class="pvw">${r.pages.map((p, i) => `<div class="pg"><img src="${p.src}" alt="Page ${i + 1}" style="top:${(p.top * 100).toFixed(3)}%;height:${(p.h * 100).toFixed(3)}%"></div><div class="pn">Page ${i + 1} of ${r.pages.length}</div>`).join('')}</div>`, el => {
      const fn = fileSafe(name) + '.pdf', AB = window.AndroidBridge;
      const out = how => {
        if (AB && AB.shareFile) { if (how === 'save') AB.saveFile(r.b64, 'application/pdf', fn); else AB.shareFile(r.b64, 'application/pdf', fn, ''); return; }
        const blob = b64ToBlob(r.b64, 'application/pdf');
        if (how === 'share' && navigator.canShare) { const f = new File([blob], fn, {type: 'application/pdf'}); if (navigator.canShare({files: [f]})) { navigator.share({files: [f], title: name}).catch(() => {}); return; } }
        downloadBlob(blob, fn);
      };
      el.querySelector('#pvShare').onclick = () => out('share');
      el.querySelector('#pvSave').onclick = () => out('save');
    });
  }

  /* ---------- signature (used in the email text) ---------- */
  function settings() {
    const m = M();
    const sample = () => docMailBody({type: 'INV', number: 'INV-0001', date: today(), due: today(), lines: [], payments: [], discount: 0, customerId: ''}).body.split('\n').slice(-7).join('\n');
    openSheet('Email signature', `<form id="sgForm" autocomplete="off">
      <p class="hint" style="margin-top:0">Email opens your mail app (Gmail, Outlook…) with the PDF attached and the message written. This signature is added at the end.</p>
      <div class="row"><label class="f"><span>Your name</span><input class="in" name="name" value="${esc(m.name || '')}" placeholder="e.g. Muhsin"></label><label class="f"><span>Job title</span><input class="in" name="title" value="${esc(m.title || '')}" placeholder="e.g. Sales Department"></label></div>
      <div class="row"><label class="f"><span>Mobile</span><input class="in" name="mobile" type="tel" value="${esc(m.mobile || '')}"></label><label class="f"><span>Email shown</span><input class="in" name="from" type="email" value="${esc(m.from || S().email || '')}"></label></div>
      <label class="f"><span>Sign-off</span><input class="in" name="signoff" value="${esc(m.signoff || 'Best regards,')}"></label>
      <div class="sec"><h2>Preview</h2></div><div class="sigpv" id="sgPv"></div>
      <button class="btn pri full" type="submit" style="margin-top:12px">Save</button></form>`, el => {
      const f = el.querySelector('#sgForm');
      const keep = () => { const v = formData(f); Object.assign(m, {name: v.name.trim(), title: v.title.trim(), mobile: v.mobile.trim(), from: v.from.trim(), signoff: v.signoff.trim()}); };
      const draw = () => { keep(); el.querySelector('#sgPv').textContent = sample(); };
      f.addEventListener('input', draw); draw();
      f.onsubmit = ev => { ev.preventDefault(); keep(); save(); closeSheet(() => toast('Signature saved')); };
    });
  }

  /* ---------- invoice / quote screen ---------- */
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id); if (!d) return;
    const top = typeof sheets !== 'undefined' && sheets[sheets.length - 1]; if (!top) return;
    const bar = top.querySelector('.sharebar');
    if (bar && !bar.querySelector('#aPdfPv')) {
      bar.insertAdjacentHTML('beforeend', `<button type="button" class="btn" id="aPdfPv">${ICON.search || ''}PDF preview</button>`);
      bar.querySelector('#aPdfPv').onclick = () => pdfPreview(docHTML(d), d.number + ' - ' + ((custById(d.customerId) || {}).name || ''));
    }
  };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling; if (!list) return;
    list.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mMail"><span class="ic">${ICON.mail}</span><div class="main"><div class="t">Email signature</div><div class="s">Name, title and mobile at the end of your emails</div></div></button>`);
    document.getElementById('mMail').onclick = settings;
  };
  window.FitxMail = {pdfPreview, settings};
})();
