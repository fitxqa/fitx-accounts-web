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
    .sigbox{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
    .sghelp{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:12px 0;background:var(--card)}
    .sghelp summary{font-weight:700;cursor:pointer}
    .sghelp ul{padding-left:18px;line-height:1.6;margin:8px 0 0}
    label.ck{display:flex;gap:10px;align-items:flex-start;margin:8px 0}
    label.ck input{width:20px;height:20px;flex-shrink:0;margin-top:2px}
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

  /* ---------- signature with logo (white / orange) ---------- */
  const LOGO_URL = 'https://fitxqa.github.io/fitx-accounts-web/icons/email-logo-dark.png';
  const OR = '#ff6a00';
  function sigHTML(logoSrc) {
    const s = S(), m = M();
    const web = s.web ? (/^https?:/i.test(s.web) ? s.web : 'https://' + s.web) : '';
    const mail = m.from || s.email;
    const lab = t => `<span style="color:${OR};font-weight:bold">${t}</span>&nbsp;`;
    const tel = [s.phone && lab('T') + esc(s.phone), m.mobile && lab('M') + esc(m.mobile)].filter(Boolean).map(x => `<div style="white-space:nowrap">${x}</div>`).join('');
    const net = [mail && lab('E') + `<a href="mailto:${esc(mail)}" style="color:#333333;text-decoration:none">${esc(mail)}</a>`, s.web && lab('W') + `<a href="${esc(web)}" style="color:#333333;text-decoration:none">${esc(s.web)}</a>`].filter(Boolean).map(x => `<div>${x}</div>`).join('');
    return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#333333;background:#ffffff;border:1px solid #e6e6e6">
<tr><td width="128" style="width:128px;background:#0d0d0d;padding:14px 12px;vertical-align:middle;border-right:4px solid ${OR}"><img src="${logoSrc || LOGO_URL}" width="128" alt="FitX Sports Equipment Services" style="display:block;width:128px;height:auto;border:0"></td>
<td style="padding:12px 16px;vertical-align:middle;background:#ffffff">
${m.name ? `<div style="font-size:16px;font-weight:bold;color:#0d0d0d">${esc(m.name)}</div>` : ''}
${m.title ? `<div style="font-size:11px;font-weight:bold;color:${OR};text-transform:uppercase;letter-spacing:1px">${esc(m.title)}</div>` : ''}
<div style="font-weight:bold;color:#0d0d0d;margin-top:4px">${esc(s.name)}</div>
${tel}${net}
${s.address || s.cr ? `<div style="color:#777777;font-size:12px">${esc([s.address, s.cr && 'CR No. ' + s.cr].filter(Boolean).join(' · '))}</div>` : ''}
</td></tr>
<tr><td colspan="2" style="background:#0d0d0d;padding:7px 18px;font-size:11px;color:#ffffff;letter-spacing:.3px">Gym equipment repair <span style="color:${OR}">&#9679;</span> Maintenance <span style="color:${OR}">&#9679;</span> Spare parts <span style="color:${OR}">&#9679;</span> Refurbishing</td></tr>
</table>`;
  }
  // formatted email for mail apps that accept HTML: message + logo signature
  function htmlBody(main) {
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#333333">${esc(main).replace(/\n/g, '<br>')}<br><br>${sigHTML()}</div>`;
  }
  async function copyRich(el, html) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}), 'text/plain': new Blob([el.innerText], {type: 'text/plain'})})]);
        return true;
      }
    } catch (e) {}
    try {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const ok = document.execCommand('copy'); sel.removeAllRanges(); return ok;
    } catch (e) { return false; }
  }
  function settings() {
    const m = M();
    openSheet('Email signature', `<form id="sgForm" autocomplete="off">
      <div class="row"><label class="f"><span>Your name</span><input class="in" name="name" value="${esc(m.name || '')}" placeholder="e.g. Muhsin"></label><label class="f"><span>Job title</span><input class="in" name="title" value="${esc(m.title || '')}" placeholder="e.g. Sales Department"></label></div>
      <div class="row"><label class="f"><span>Mobile</span><input class="in" name="mobile" type="tel" value="${esc(m.mobile || '')}"></label><label class="f"><span>Email shown</span><input class="in" name="from" type="email" value="${esc(m.from || S().email || '')}"></label></div>
      <label class="f"><span>Sign-off</span><input class="in" name="signoff" value="${esc(m.signoff || 'Best regards,')}"></label>
      <div class="sec"><h2>Your signature with logo</h2></div>
      <div class="sigbox" id="sgPv"></div>
      <div class="btns" style="margin-top:10px"><button type="button" class="btn pri" id="sgCopy">${ICON.copy || ''}Copy signature</button><button type="button" class="btn" id="sgDl">${ICON.dl}Download (.html)</button></div>
      <details class="sghelp"><summary>Where to paste it (one time)</summary><ul>
        <li><b>Gmail on a computer:</b> ⚙ → See all settings → General → Signature → Create new → paste → choose it for new emails and replies → Save changes.</li>
        <li><b>Outlook:</b> Settings → Mail → Compose and reply (or Signatures) → New signature → paste → Save.</li>
        <li><b>Phone mail apps:</b> the Gmail phone app only allows a text signature. Leave its "Mobile signature" empty, so the text signature from FitX is used.</li>
      </ul><p class="hint">The logo is loaded from your FitX web address, so it shows for your customers.</p></details>
      <label class="ck"><input type="checkbox" name="textSig" ${m.textSig !== false ? 'checked' : ''}><span>Add my text signature to emails opened from FitX<br><small style="color:var(--muted)">Turn off if your mail app already adds the logo signature</small></span></label>
      <button class="btn pri full" type="submit" style="margin-top:12px">Save</button></form>`, el => {
      const f = el.querySelector('#sgForm');
      const keep = () => { const v = formData(f); Object.assign(m, {name: v.name.trim(), title: v.title.trim(), mobile: v.mobile.trim(), from: v.from.trim(), signoff: v.signoff.trim(), textSig: !!v.textSig}); };
      const draw = () => { keep(); el.querySelector('#sgPv').innerHTML = sigHTML('icons/email-logo-dark.png'); };
      f.addEventListener('input', draw); draw();
      el.querySelector('#sgCopy').onclick = async () => { keep(); const pv = el.querySelector('#sgPv'); pv.innerHTML = sigHTML(); const ok = await copyRich(pv, sigHTML()); toast(ok ? 'Signature copied – paste it into your mail signature settings' : 'Could not copy – use Download instead'); };
      el.querySelector('#sgDl').onclick = () => {
        keep();
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>FitX email signature</title></head><body style="margin:24px;background:#ffffff">${sigHTML()}</body></html>`;
        const AB = window.AndroidBridge;
        if (AB && AB.saveFile) AB.saveFile(btoa(unescape(encodeURIComponent(html))), 'text/html', 'FitX-email-signature.html');
        else downloadBlob(new Blob([html], {type: 'text/html'}), 'FitX-email-signature.html');
      };
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
    list.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mMail"><span class="ic">${ICON.mail}</span><div class="main"><div class="t">Email signature</div><div class="s">Black, orange &amp; white FitX logo signature – copy to your mail app</div></div></button>`);
    document.getElementById('mMail').onclick = settings;
  };
  window.FitxMail = {pdfPreview, settings, sigHTML, htmlBody};
})();
