/* FitX Accounts — send invoices & quotations by email directly from the app through Outlook (Microsoft 365),
   as a professional HTML email with the company signature and logo, PDF attached. Also: PDF preview.
   Sending uses Microsoft Graph (/me/sendMail) after the user signs in with the company mailbox (e.g. sales@fitx.qa).
   One-time setup: an app registration in Microsoft Entra (client ID + tenant ID, permission Mail.Send). */
(function () {
  'use strict';
  const inApk = !!window.AndroidBridge || /androidplatform\.net$/.test(location.hostname);
  const REDIRECT = inApk ? 'https://appassets.androidplatform.net/assets/www/index.html' : location.origin + location.pathname.replace(/index\.html$/, '');
  const M = () => { const s = S(); s.mail = s.mail || {}; return s.mail; };
  const configured = () => !!(M().clientId && M().tenantId);
  const RESUME = 'fitx_mail_resume';
  const provider = () => M().provider || 'cpanel';
  const cpReady = () => !!(M().cpUrl && M().cpKey);
  const ready = () => provider() === 'cpanel' ? cpReady() : configured();

  /* ---------- Microsoft sign-in (MSAL) ---------- */
  let pca = null, loading = null;
  function loadMsal() {
    if (window.msal) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'vendor/msal-browser.min.js'; sc.onload = ok; sc.onerror = () => bad(new Error('Could not load Microsoft sign-in')); document.head.appendChild(sc); });
    return loading;
  }
  async function client() {
    if (!configured()) throw new Error('Set up Outlook first (Menu → Email & signature)');
    await loadMsal();
    const key = M().clientId + '|' + M().tenantId;
    if (pca && pca._fitxKey === key) return pca;
    pca = new msal.PublicClientApplication({
      auth: {clientId: M().clientId.trim(), authority: 'https://login.microsoftonline.com/' + M().tenantId.trim(), redirectUri: REDIRECT, navigateToLoginRequestUrl: false},
      cache: {cacheLocation: 'localStorage'}
    });
    pca._fitxKey = key;
    await pca.initialize();
    return pca;
  }
  const fromAddr = () => (M().from || '').trim().toLowerCase();
  const account = p => { const all = p.getAllAccounts(); return all.find(a => (a.username || '').toLowerCase() === fromAddr()) || all[0] || null; };
  const scopesFor = acc => (acc && fromAddr() && (acc.username || '').toLowerCase() !== fromAddr()) ? ['Mail.Send', 'Mail.Send.Shared', 'User.Read'] : ['Mail.Send', 'User.Read'];
  async function signIn(resumeDocId) {
    const p = await client();
    try { if (resumeDocId) sessionStorage.setItem(RESUME, resumeDocId); else sessionStorage.removeItem(RESUME); } catch (e) {}
    await p.loginRedirect({scopes: ['Mail.Send', 'User.Read'], loginHint: M().from || undefined, prompt: 'select_account'});
  }
  async function token() {
    const p = await client(); const acc = account(p);
    if (!acc) return null;
    try { return {token: (await p.acquireTokenSilent({scopes: scopesFor(acc), account: acc})).accessToken, acc}; }
    catch (e) { return null; }
  }
  async function signOut() {
    const p = await client(); const acc = account(p);
    if (acc) await p.clearCache({account: acc});
    toast('Outlook disconnected');
  }
  // coming back from the Microsoft sign-in page
  (async function () {
    if (!/[#&?](code|error)=/.test(location.hash + location.search) || !configured()) return;
    try {
      const p = await client(); const r = await p.handleRedirectPromise();
      if (r && r.account) {
        toast('Outlook connected: ' + r.account.username);
        let id = ''; try { id = sessionStorage.getItem(RESUME) || ''; sessionStorage.removeItem(RESUME); } catch (e) {}
        if (id && docById(id)) setTimeout(() => { viewDoc(id); compose(id); }, 600);
      }
    } catch (e) { toast('Outlook sign-in failed: ' + (e.errorMessage || e.message || e)); }
    try { history.replaceState(history.state, '', location.pathname); } catch (e) {}
  })();

  /* ---------- logo as PNG (inline image in the email) ---------- */
  async function logoPng() {
    const s = S(); const H = 120;
    const cv = document.createElement('canvas'); const g = cv.getContext('2d');
    if (s.logo) {
      const im = new Image(); im.src = s.logo;
      await new Promise(r => { im.onload = im.onerror = r; });
      if (im.naturalWidth) { const w = Math.round(im.naturalWidth * H / im.naturalHeight); cv.width = Math.min(w, 480); cv.height = H; g.drawImage(im, 0, 0, cv.width, H); return cv.toDataURL('image/png').split(',')[1]; }
    }
    g.font = '700 15px Arial, sans-serif'; const tw = g.measureText('SPORTS EQUIPMENT SERVICES').width;
    cv.width = Math.ceil(tw + 16); cv.height = H; g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, H);
    g.font = '900 70px Arial Black, Arial, sans-serif'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#0d0d0d'; g.fillText('Fit', 6, 74); const w = g.measureText('Fit').width;
    g.fillStyle = '#ff6a00'; g.fillText('X', 6 + w, 74);
    g.font = '700 15px Arial, sans-serif'; g.fillStyle = '#333'; g.fillText('SPORTS EQUIPMENT SERVICES', 8, 104);
    return cv.toDataURL('image/png').split(',')[1];
  }

  /* ---------- email content ---------- */
  const esc2 = t => esc(t).replace(/\n/g, '<br>');
  function defaults(d) {
    const s = S(), c = custById(d.customerId) || {}, isInv = d.type === 'INV';
    const name = c.contact || c.name || 'Customer';
    const subject = `${isInv ? 'Invoice' : 'Quotation'} ${d.number}${d.subject ? ' – ' + d.subject : ''} | ${s.name}`;
    const msg = isInv
      ? `Dear ${name},\n\nThank you for choosing ${s.name}. Please find attached invoice ${d.number} for the work completed${d.subject ? ' (' + d.subject + ')' : ''}.\n\nWe would appreciate payment by the due date shown below. Please let us know if you have any questions.`
      : `Dear ${name},\n\nThank you for your enquiry. Please find attached our quotation ${d.number}${d.subject ? ' for ' + d.subject : ''}.\n\nTo go ahead, simply reply to this email or call us, and we will schedule the work at your convenience.`;
    return {to: c.email || '', cc: M().cc || '', subject, msg};
  }
  function signatureHTML(logoSrc) {
    const s = S(), m = M();
    const line = (t, href) => t ? `<div style="margin:2px 0">${href ? `<a href="${href}" style="color:#333333;text-decoration:none">${esc(t)}</a>` : esc(t)}</div>` : '';
    const web = s.web ? (/^https?:/i.test(s.web) ? s.web : 'https://' + s.web) : '';
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.45">
      <tr><td style="padding:0 16px 0 0;vertical-align:middle;border-right:3px solid #ff6a00"><img src="${logoSrc}" alt="${esc(s.name)}" height="60" style="display:block;height:60px;width:auto;border:0"></td>
      <td style="padding:0 0 0 16px;vertical-align:middle">
        <div style="font-size:15px;font-weight:bold;color:#0d0d0d">${esc(m.name || s.name)}</div>
        ${m.title ? `<div style="color:#ff6a00;font-weight:bold;margin-bottom:4px">${esc(m.title)}</div>` : ''}
        ${m.name ? `<div style="font-weight:bold;margin-bottom:2px">${esc(s.name)}</div>` : ''}
        ${line([s.phone && 'Tel: ' + s.phone, m.mobile && 'Mobile: ' + m.mobile].filter(Boolean).join('  |  '))}
        ${line(m.from || s.email, 'mailto:' + (m.from || s.email))}
        ${line(s.web, web)}
        ${line([s.address, s.cr && 'CR No. ' + s.cr].filter(Boolean).join('  ·  '))}
      </td></tr></table>`;
  }
  function emailHTML(d, msg, logoSrc, attNames) {
    const s = S(), isInv = d.type === 'INV';
    const bal = isInv ? docBal(d) : docTotal(d);
    const row = (k, v, strong) => `<tr><td style="padding:8px 14px;color:#666666;font-size:13px;border-bottom:1px solid #eeeeee">${k}</td><td style="padding:8px 14px;text-align:right;font-size:13px;border-bottom:1px solid #eeeeee;${strong ? 'font-weight:bold;color:#ff6a00;font-size:15px' : 'color:#0d0d0d'}">${v}</td></tr>`;
    const box = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e5e5;border-radius:6px;margin:18px 0">
      <tr><td colspan="2" style="background:#0d0d0d;color:#ffffff;padding:10px 14px;font-weight:bold;font-size:13px;letter-spacing:.5px">${isInv ? 'INVOICE SUMMARY' : 'QUOTATION SUMMARY'}</td></tr>
      ${row(isInv ? 'Invoice no.' : 'Quotation no.', esc(d.number))}
      ${row('Date', dfmt(d.date))}
      ${row(isInv ? 'Due date' : 'Valid until', dfmt(d.due))}
      ${isInv && docPaid(d) ? row('Total', money(docTotal(d))) + row('Paid', money(docPaid(d))) : ''}
      ${row(isInv ? (docPaid(d) ? 'Balance due' : 'Amount due') : 'Total amount', money(bal), true)}
    </table>`;
    const pay = isInv && s.payNote && bal > 0.004 ? `<p style="margin:0 0 14px;padding:10px 14px;background:#fff4ec;border-left:3px solid #ff6a00;font-size:13px">${esc2(s.payNote)}</p>` : '';
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4"><tr><td align="center" style="padding:20px 10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border-top:4px solid #ff6a00">
      <tr><td style="padding:26px 28px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.6">
        ${esc2(msg)}
        ${box}${pay}
        <p style="margin:0 0 4px;font-size:13px;color:#555555">Attached: ${attNames.map(esc).join(', ')}</p>
        <p style="margin:22px 0 14px">${esc(M().signoff || 'Best regards,')}</p>
        ${signatureHTML(logoSrc)}
      </td></tr>
      <tr><td style="padding:14px 28px 22px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999999;line-height:1.5;border-top:1px solid #eeeeee">${esc(M().disclaimer || 'This email and any attachments are confidential and intended only for the addressee. If you received it by mistake, please let us know and delete it.')}</td></tr>
      </table></td></tr></table></body></html>`;
  }
  const splitAddr = t => String(t || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);
  const okAddr = a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);

  /* ---------- PDF preview ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .pvw{display:grid;gap:14px;justify-items:center}
    .pvw .pg{width:100%;max-width:640px;aspect-ratio:1/1.4142;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18);position:relative;overflow:hidden}
    .pvw .pg img{position:absolute;left:0;width:100%}
    .pvw .pn{font-size:12px;color:var(--muted)}
    .mailatt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);margin-bottom:8px}
    .mailatt .nm{flex:1;min-width:0;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mailfrom{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:12px;background:var(--orange-l,#fff1e7);margin-bottom:12px;font-size:14px}
    body.role-tech #mMail{display:none!important}
    .mailprev{width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#f4f4f4}`;
  document.head.appendChild(css);
  async function pdfPreview(html, name, after) {
    toast('Preparing preview…');
    let r; try { r = await htmlToPdf(html, {pages: true}); } catch (e) { toast('Could not make the PDF: ' + e.message); return; }
    const kb = Math.round(r.b64.length * 3 / 4 / 1024);
    openSheet('PDF preview', `<div class="btns" style="margin-bottom:12px"><button type="button" class="btn pri" id="pvShare">${ICON.share}Share PDF</button><button type="button" class="btn" id="pvSave">${ICON.dl}Save PDF</button></div>
      <p class="hint" style="margin-top:-4px">${esc(name)}.pdf · ${r.pages.length} page${r.pages.length > 1 ? 's' : ''} · ${kb} KB — exactly as the customer receives it.</p>
      <div class="pvw">${r.pages.map((p, i) => `<div class="pg"><img src="${p.src}" alt="Page ${i + 1}" style="top:${(p.top * 100).toFixed(3)}%;height:${(p.h * 100).toFixed(3)}%"></div><div class="pn">Page ${i + 1} of ${r.pages.length}</div>`).join('')}</div>`, el => {
      const out = how => { const AB = window.AndroidBridge, fn = fileSafe(name) + '.pdf'; if (AB && AB.shareFile) { how === 'save' ? AB.saveFile(r.b64, 'application/pdf', fn) : AB.shareFile(r.b64, 'application/pdf', fn, ''); } else if (how === 'share' && navigator.canShare) { const f = new File([b64ToBlob(r.b64, 'application/pdf')], fn, {type: 'application/pdf'}); if (navigator.canShare({files: [f]})) navigator.share({files: [f], title: name}).catch(() => {}); else downloadBlob(b64ToBlob(r.b64, 'application/pdf'), fn); } else downloadBlob(b64ToBlob(r.b64, 'application/pdf'), fn); };
      el.querySelector('#pvShare').onclick = () => out('share');
      el.querySelector('#pvSave').onclick = () => out('save');
      if (after) after(el);
    });
  }

  function plainText(d, msg) {
    const s = S(), m = M(), isInv = d.type === 'INV';
    const amt = isInv ? docBal(d) : docTotal(d);
    return `${msg}\n\n${isInv ? 'Invoice' : 'Quotation'} no.: ${d.number}\nDate: ${dfmt(d.date)}\n${isInv ? 'Due date' : 'Valid until'}: ${dfmt(d.due)}\n${isInv ? 'Amount due' : 'Total amount'}: ${money(amt)}\n${isInv && s.payNote ? '\n' + s.payNote + '\n' : ''}\n${m.signoff || 'Best regards,'}\n${m.name || s.name}${m.title ? '\n' + m.title : ''}${m.name ? '\n' + s.name : ''}\nTel: ${s.phone}${m.mobile ? ' | Mobile: ' + m.mobile : ''}\n${m.from || s.email}\n${s.web}`;
  }
  const phpStr = v => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  function phpScript(key, from, name, pass) {
    return `<?php
/* FitX Accounts – email sender for Bluehost / cPanel hosting.
   Upload this file to public_html with cPanel File Manager. Created ${today()}.
   Keep it private: the key below lets the FitX app send email from ${from}. */
$KEY       = '${phpStr(key)}';
$FROM      = '${phpStr(from)}';
$FROM_NAME = '${phpStr(name)}';
$IMAP_PASS = '${phpStr(pass)}';   // optional mailbox password: keeps a copy of each email in "Sent"
$ALLOWED_ORIGINS = array('https://fitxqa.github.io', 'https://appassets.androidplatform.net');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
function reply($code, $data) { http_response_code($code); echo json_encode($data); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(200, array('ok' => true, 'msg' => 'FitX mail script is installed. Send email from the FitX Accounts app.'));

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in) || !isset($in['key']) || !hash_equals($KEY, (string)$in['key'])) reply(403, array('ok' => false, 'error' => 'Wrong key. In the app, create the mail script again and upload the new file.'));
if (isset($in['action']) && $in['action'] === 'ping') reply(200, array('ok' => true, 'php' => PHP_VERSION, 'from' => $FROM, 'sent_copy' => ($IMAP_PASS !== '' && function_exists('imap_open'))));

function clean_list($v) { $out = array(); foreach ((array)$v as $a) { $a = trim(str_replace(array("\\r", "\\n"), '', (string)$a)); if (filter_var($a, FILTER_VALIDATE_EMAIL)) $out[] = $a; } return $out; }
function hdr($s) { return '=?UTF-8?B?' . base64_encode(str_replace(array("\\r", "\\n"), ' ', (string)$s)) . '?='; }
function b64($s) { $s = preg_replace('/[^A-Za-z0-9+\\/=]/', '', (string)$s); return base64_decode($s, true) === false ? '' : $s; }
function fname($s) { $s = preg_replace('/[^A-Za-z0-9 ._()\\-]/', '_', (string)$s); return $s === '' ? 'file' : $s; }
function ctype($s) { return preg_match('#^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$#', (string)$s) ? $s : 'application/octet-stream'; }

$to = clean_list(isset($in['to']) ? $in['to'] : array());
$cc = clean_list(isset($in['cc']) ? $in['cc'] : array());
if (!$to) reply(400, array('ok' => false, 'error' => 'No valid email address to send to.'));
if (count($to) + count($cc) > 10) reply(400, array('ok' => false, 'error' => 'Too many recipients.'));
$subject = hdr(isset($in['subject']) ? $in['subject'] : '');
$html = isset($in['html']) ? (string)$in['html'] : '';
$text = isset($in['text']) ? (string)$in['text'] : strip_tags($html);
$fromName = (isset($in['fromName']) && $in['fromName'] !== '') ? $in['fromName'] : $FROM_NAME;
$atts = (isset($in['attachments']) && is_array($in['attachments'])) ? $in['attachments'] : array();

$e = "\\r\\n";
$b1 = 'fx1_' . bin2hex(random_bytes(8)); $b2 = 'fx2_' . bin2hex(random_bytes(8)); $b3 = 'fx3_' . bin2hex(random_bytes(8));
$body  = "--$b1{$e}Content-Type: multipart/related; boundary=\\"$b2\\"{$e}{$e}";
$body .= "--$b2{$e}Content-Type: multipart/alternative; boundary=\\"$b3\\"{$e}{$e}";
$body .= "--$b3{$e}Content-Type: text/plain; charset=UTF-8{$e}Content-Transfer-Encoding: base64{$e}{$e}" . chunk_split(base64_encode($text));
$body .= "--$b3{$e}Content-Type: text/html; charset=UTF-8{$e}Content-Transfer-Encoding: base64{$e}{$e}" . chunk_split(base64_encode($html));
$body .= "--$b3--{$e}";
foreach ($atts as $a) { if (empty($a['cid'])) continue; $d = b64(isset($a['data']) ? $a['data'] : ''); if ($d === '') continue; $n = fname($a['name']);
  $body .= "--$b2{$e}Content-Type: " . ctype($a['type']) . "; name=\\"$n\\"{$e}Content-Transfer-Encoding: base64{$e}Content-ID: <" . fname($a['cid']) . ">{$e}Content-Disposition: inline; filename=\\"$n\\"{$e}{$e}" . chunk_split($d); }
$body .= "--$b2--{$e}";
foreach ($atts as $a) { if (!empty($a['cid'])) continue; $d = b64(isset($a['data']) ? $a['data'] : ''); if ($d === '') continue; $n = fname($a['name']);
  $body .= "--$b1{$e}Content-Type: " . ctype($a['type']) . "; name=\\"$n\\"{$e}Content-Transfer-Encoding: base64{$e}Content-Disposition: attachment; filename=\\"$n\\"{$e}{$e}" . chunk_split($d); }
$body .= "--$b1--";

$headers = array('From: ' . hdr($fromName) . " <$FROM>", "Reply-To: $FROM", 'MIME-Version: 1.0', "Content-Type: multipart/mixed; boundary=\\"$b1\\"", 'X-Mailer: FitX Accounts');
if ($cc) $headers[] = 'Cc: ' . implode(', ', $cc);
$copy = !empty($in['copy']);
$imapOk = ($IMAP_PASS !== '' && function_exists('imap_open'));
$send = $headers; if ($copy && !$imapOk) $send[] = "Bcc: $FROM";
if (!mail(implode(', ', $to), $subject, $body, implode("\\r\\n", $send), '-f' . $FROM)) reply(500, array('ok' => false, 'error' => 'The mail server did not accept the email. Check that ' . $FROM . ' exists in cPanel → Email Accounts.'));

$saved = false;
if ($copy && $imapOk) {
  $msg = 'Date: ' . date('r') . $e . 'To: ' . implode(', ', $to) . $e . ($cc ? 'Cc: ' . implode(', ', $cc) . $e : '') . "Subject: $subject" . $e . implode($e, $headers) . $e . $e . $body;
  foreach (array('INBOX.Sent', 'Sent', 'INBOX.Sent Items') as $box) {
    $mb = '{localhost:993/imap/ssl/novalidate-cert}' . $box;
    $im = @imap_open($mb, $FROM, $IMAP_PASS, 0, 1);
    if ($im) { $saved = @imap_append($im, $mb, $msg, '\\\\Seen'); @imap_close($im); if ($saved) break; }
  }
  @imap_errors(); @imap_alerts();
}
reply(200, array('ok' => true, 'to' => $to, 'saved_to_sent' => $saved));
`;
  }

  /* ---------- compose & send ---------- */
  async function compose(id) {
    const d = docById(id); if (!d) return;
    const isInv = d.type === 'INV', c = custById(d.customerId) || {};
    const dft = defaults(d);
    const R = isInv ? d.wcr : d.insp, repKind = isInv ? 'wcr' : 'insp';
    const hasRep = !!(R && R.on);
    let tk = null;
    if (provider() === 'outlook' && configured()) { try { tk = await token(); } catch (e) { tk = null; } }
    const fromHtml = provider() === 'cpanel'
      ? (cpReady() ? `<div class="mailfrom"><span>From: <b>${esc(M().from || 'sales@fitx.qa')}</b></span><span class="badge b-green">Bluehost</span></div>`
        : `<div class="mailfrom"><span>Email sending is not set up yet.</span><button type="button" class="btn pri" id="mlSetup" style="min-height:36px;padding:4px 12px">Set up</button></div>`)
      : !configured()
      ? `<div class="mailfrom"><span>Outlook is not set up yet.</span><button type="button" class="btn" id="mlSetup" style="min-height:36px;padding:4px 12px">Set up</button></div>`
      : tk ? `<div class="mailfrom"><span>From: <b>${esc(tk.acc.username)}</b>${fromAddr() && fromAddr() !== tk.acc.username.toLowerCase() ? ' as <b>' + esc(M().from) + '</b>' : ''}</span><span class="badge b-green">Outlook</span></div>`
        : `<div class="mailfrom"><span>Sign in to Outlook${M().from ? ' (' + esc(M().from) + ')' : ''} to send.</span><button type="button" class="btn pri" id="mlSign" style="min-height:36px;padding:4px 12px">Sign in</button></div>`;
    openSheet('Email ' + (isInv ? 'invoice' : 'quotation') + ' ' + d.number, `
      ${fromHtml}
      <form id="mlForm" autocomplete="off">
        <label class="f"><span>To</span><input class="in" name="to" type="email" multiple inputmode="email" value="${esc(dft.to)}" placeholder="customer@email.com" required></label>
        <label class="f"><span>Cc (optional)</span><input class="in" name="cc" inputmode="email" value="${esc(dft.cc)}" placeholder="separate with commas"></label>
        <label class="f"><span>Subject</span><input class="in" name="subject" value="${esc(dft.subject)}" required></label>
        <label class="f"><span>Message</span><textarea class="in" name="msg" rows="8">${esc(dft.msg)}</textarea></label>
        <p class="hint" style="margin-top:-6px">The ${isInv ? 'invoice' : 'quotation'} summary${isInv ? ', payment details' : ''} and your signature with logo are added automatically.</p>
        <div class="sec"><h2>Attachments</h2></div>
        <div class="mailatt">${ICON.inv}<span class="nm">${esc(d.number)}.pdf</span><button type="button" class="btn" id="mlPv" style="min-height:34px;padding:4px 10px">Preview</button></div>
        ${hasRep ? `<label class="mailatt" style="cursor:pointer"><input type="checkbox" name="rep" ${M().attachRep !== false ? 'checked' : ''} style="width:20px;height:20px">${ICON.wrench}<span class="nm">${esc(repNo(d, repKind))}.pdf · ${isInv ? 'Work completion report' : 'Inspection report'}</span><button type="button" class="btn" id="mlPvR" style="min-height:34px;padding:4px 10px">Preview</button></label>` : ''}
        ${!c.email ? `<label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="saveMail" checked style="width:20px;height:20px"><span style="margin:0;color:var(--text)">Save this email address to ${esc(c.name || 'the customer')}</span></label>` : ''}
        <div class="btns" style="margin-top:6px"><button type="button" class="btn" id="mlLook">Preview email</button><button type="submit" class="btn pri" id="mlSend">${ICON.mail}Send email</button></div>
      </form>`, el => {
      const st = el.querySelector('#mlSetup'); if (st) st.onclick = () => settings(() => closeSheet(() => compose(id)));
      const sg = el.querySelector('#mlSign'); if (sg) sg.onclick = () => signIn(id).catch(e => toast(e.message || String(e)));
      el.querySelector('#mlPv').onclick = () => pdfPreview(docHTML(d), d.number + ' - ' + (c.name || ''));
      const pr = el.querySelector('#mlPvR'); if (pr) pr.onclick = ev => { ev.preventDefault(); pdfPreview(reportHTML(d, repKind), repNo(d, repKind) + ' - ' + (c.name || '')); };
      el.querySelector('#mlLook').onclick = async () => {
        const v = formData(el.querySelector('#mlForm'));
        const logo = 'data:image/png;base64,' + await logoPng();
        const names = [d.number + '.pdf'].concat(hasRep && v.rep ? [repNo(d, repKind) + '.pdf'] : []);
        openSheet('Email preview', `<p class="hint" style="margin-top:0"><b>To:</b> ${esc(v.to)}${v.cc ? ' · <b>Cc:</b> ' + esc(v.cc) : ''}<br><b>Subject:</b> ${esc(v.subject)}</p><iframe class="mailprev" title="Email preview" sandbox="allow-same-origin"></iframe>`, e2 => { const fr = e2.querySelector('iframe'); fr.onload = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (e) {} }; fr.srcdoc = emailHTML(d, v.msg, logo, names); });
      };
      el.querySelector('#mlForm').onsubmit = async ev => {
        ev.preventDefault();
        const v = formData(ev.target);
        const to = splitAddr(v.to), cc = splitAddr(v.cc);
        const bad = to.concat(cc).find(a => !okAddr(a)); if (bad) { toast('Check the email address: ' + bad); return; }
        if (!to.length) { toast('Enter the customer email'); return; }
        if (!ready()) { toast('Set up email sending first'); settings(() => closeSheet(() => compose(id))); return; }
        let t = null;
        if (provider() === 'outlook') { t = await token().catch(() => null); if (!t) { toast('Sign in to Outlook first'); signIn(id).catch(e => toast(e.message || String(e))); return; } }
        const btn = el.querySelector('#mlSend'); btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const files = [];
          files.push({name: fileSafe(d.number + ' - ' + (c.name || '')) + '.pdf', type: 'application/pdf', data: await htmlToPdf(docHTML(d))});
          if (hasRep && v.rep) files.push({name: fileSafe(repNo(d, repKind) + ' - ' + (c.name || '')) + '.pdf', type: 'application/pdf', data: await htmlToPdf(reportHTML(d, repKind))});
          const logo = {name: 'logo.png', type: 'image/png', data: await logoPng(), cid: 'fitxlogo'};
          const size = files.concat([logo]).reduce((s2, a) => s2 + a.data.length, 0);
          const html = emailHTML(d, v.msg, 'cid:fitxlogo', files.map(a => a.name));
          let by;
          if (provider() === 'cpanel') {
            if (size > 14e6) throw new Error('The attachments are too large to send. Try without the report.');
            const res = await fetch(M().cpUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify({key: M().cpKey, to, cc, subject: v.subject, html, text: plainText(d, v.msg), fromName: S().name, copy: M().copySelf !== false, attachments: files.concat([logo])})}).catch(() => { throw new Error('Could not reach ' + M().cpUrl + '. Check the internet and that fitx-mail.php is uploaded.'); });
            let j = null; try { j = await res.json(); } catch (e) {}
            if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('Mail server error ' + res.status));
            by = M().from || 'Bluehost';
          } else {
            if (size > 3.6e6) throw new Error('The attachments are too large to send (over 3 MB). Try without the report.');
            const atts = files.map(a => ({'@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.type, contentBytes: a.data}));
            atts.push({'@odata.type': '#microsoft.graph.fileAttachment', name: logo.name, contentType: logo.type, contentBytes: logo.data, isInline: true, contentId: 'fitxlogo'});
            const message = {subject: v.subject, body: {contentType: 'HTML', content: html}, toRecipients: to.map(a => ({emailAddress: {address: a}})), ccRecipients: cc.map(a => ({emailAddress: {address: a}})), attachments: atts};
            const me = (t.acc.username || '').toLowerCase();
            const url = fromAddr() && fromAddr() !== me ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromAddr())}/sendMail` : 'https://graph.microsoft.com/v1.0/me/sendMail';
            if (fromAddr() && fromAddr() !== me) message.from = {emailAddress: {address: fromAddr()}};
            const res = await fetch(url, {method: 'POST', headers: {Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json'}, body: JSON.stringify({message, saveToSentItems: true})});
            if (!res.ok) { let m = ''; try { m = (await res.json()).error.message; } catch (e) {} throw new Error(res.status === 403 ? 'Outlook refused: this account may not send as ' + (M().from || 'that mailbox') + '. ' + m : (m || 'Outlook error ' + res.status)); }
            by = t.acc.username;
          }
          d.mails = d.mails || []; d.mails.push({date: today(), at: Date.now(), to: to.join(', '), by});
          if (v.saveMail && !c.email && c.id) c.email = to[0];
          save();
          closeSheet(() => { toast('Email sent to ' + to.join(', ')); reopenWith(() => viewDoc(id)); });
        } catch (e) {
          toast(e.message || String(e)); btn.disabled = false; btn.innerHTML = ICON.mail + 'Send email';
        }
      };
    });
  }

  /* ---------- settings: Outlook connection + signature ---------- */
  function settings(after) {
    const m = M(), s = S();
    const signed = async el => { try { const t = configured() ? await token() : null; el.querySelector('#msStat').innerHTML = !configured() ? 'Not set up' : t ? `Connected: <b>${esc(t.acc.username)}</b>` : 'Not signed in'; el.querySelector('#msOut').classList.toggle('hidden', !t); } catch (e) { el.querySelector('#msStat').textContent = e.message; } };
    openSheet('Email & signature', `<form id="msForm" autocomplete="off">
      <label class="f"><span>Send from (your email address)</span><input class="in" name="from" type="email" value="${esc(m.from || 'sales@fitx.qa')}"></label>
      <div class="chips" style="margin-bottom:12px" id="msProv"><button type="button" data-prov="cpanel" class="${provider() === 'cpanel' ? 'on' : ''}">Bluehost / cPanel email</button><button type="button" data-prov="outlook" class="${provider() === 'outlook' ? 'on' : ''}">Outlook (Microsoft 365)</button></div>
      <div id="msCp" class="${provider() === 'cpanel' ? '' : 'hidden'}">
        <div class="mailfrom"><span id="cpStat">${cpReady() ? 'Ready – script created' : 'Not set up'}</span><button type="button" class="btn" id="cpTest" style="min-height:36px;padding:4px 12px">Test</button></div>
        <label class="f"><span>Mail script address</span><input class="in" name="cpUrl" type="url" value="${esc(m.cpUrl || 'https://fitx.qa/fitx-mail.php')}"></label>
        <label class="f"><span>Email password (optional – only to keep a copy in your Sent folder)</span><input class="in" name="cpPass" type="password" autocomplete="new-password" placeholder="Not stored in the app"></label>
        <label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="copySelf" ${m.copySelf !== false ? 'checked' : ''} style="width:20px;height:20px"><span style="margin:0;color:var(--text)">Keep a copy of every email (in Sent, or in your inbox if no password)</span></label>
        <button type="button" class="btn pri full" id="cpMake">${ICON.dl}Create mail script (fitx-mail.php)</button>
        <details class="card" style="margin:12px 0" ${cpReady() ? '' : 'open'}><summary style="font-weight:700;cursor:pointer">How to set it up (one time, 3 minutes)</summary>
          <ol style="padding-left:20px;line-height:1.7;margin:10px 0 0">
            <li>Check the email address above (e.g. <b>sales@fitx.qa</b> – it must exist in cPanel → Email Accounts).</li>
            <li>Tap <b>Create mail script</b>. The file <b>fitx-mail.php</b> is saved to your downloads.</li>
            <li>Log in to <b>Bluehost → cPanel → File Manager</b>, open <b>public_html</b>, tap <b>Upload</b> and choose fitx-mail.php.</li>
            <li>Tap <b>Save</b> here, then <b>Test</b>. You will get a test email.</li>
          </ol>
          <p class="hint">If your website is not hosted on Bluehost, upload the file to any folder of your Bluehost hosting and put its web address above.</p></details>
      </div>
      <div id="msOl" class="${provider() === 'outlook' ? '' : 'hidden'}">
      <div class="mailfrom"><span id="msStat">Checking…</span><span><button type="button" class="btn" id="msIn" style="min-height:36px;padding:4px 12px">Sign in</button> <button type="button" class="btn hidden" id="msOut" style="min-height:36px;padding:4px 12px">Sign out</button></span></div>
      <label class="f"><span>Application (client) ID</span><input class="in" name="clientId" value="${esc(m.clientId || '')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <label class="f"><span>Directory (tenant) ID</span><input class="in" name="tenantId" value="${esc(m.tenantId || '')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <details class="card" style="margin-bottom:12px"><summary style="font-weight:700;cursor:pointer">How to get these IDs (one time, 5 minutes)</summary>
        <ol style="padding-left:20px;line-height:1.7;margin:10px 0 0">
          <li>Go to <b>entra.microsoft.com</b> and sign in as your Microsoft 365 admin.</li>
          <li><b>Applications → App registrations → New registration</b>. Name: <i>FitX Accounts</i>. Who can use: <i>this organizational directory only</i>.</li>
          <li>Redirect URI: choose <b>Single-page application (SPA)</b> and enter<br><code style="word-break:break-all">https://fitxqa.github.io/fitx-accounts-web/</code> → <b>Register</b>.</li>
          <li>Open <b>Authentication → Add URI</b> and also add<br><code style="word-break:break-all">https://appassets.androidplatform.net/assets/www/index.html</code> (for the phone app) → <b>Save</b>.</li>
          <li><b>API permissions → Add → Microsoft Graph → Delegated → Mail.Send</b> (and <b>Mail.Send.Shared</b> if you sign in as a different user than sales@). Then <b>Grant admin consent</b>.</li>
          <li>On <b>Overview</b>, copy the <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> into the boxes above.</li>
        </ol></details>
      </div>
      <div class="sec"><h2>Sending options</h2></div>
      <label class="f"><span>Always Cc (optional)</span><input class="in" name="cc" value="${esc(m.cc || '')}" placeholder="e.g. accounts@fitx.qa"></label>
      <label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="attachRep" ${m.attachRep !== false ? 'checked' : ''} style="width:20px;height:20px"><span style="margin:0;color:var(--text)">Attach the inspection / work completion report when there is one</span></label>
      <div class="sec"><h2>Signature</h2></div>
      <div class="row"><label class="f"><span>Your name</span><input class="in" name="name" value="${esc(m.name || '')}" placeholder="e.g. Muhsin"></label><label class="f"><span>Job title</span><input class="in" name="title" value="${esc(m.title || 'Sales Department')}"></label></div>
      <div class="row"><label class="f"><span>Mobile</span><input class="in" name="mobile" type="tel" value="${esc(m.mobile || '')}"></label><label class="f"><span>Sign-off</span><input class="in" name="signoff" value="${esc(m.signoff || 'Best regards,')}"></label></div>
      <label class="f"><span>Footer note</span><textarea class="in" name="disclaimer" rows="2" placeholder="Confidentiality note (optional)">${esc(m.disclaimer || '')}</textarea></label>
      <p class="hint" style="margin-top:-4px">Logo, company name, phone, website, address and CR come from Company settings${s.logo ? '' : ' (add your logo there to use it instead of the FitX text logo)'}.</p>
      <div class="card" style="padding:14px" id="msSig">…</div>
      <button class="btn pri full" type="submit" style="margin-top:12px">Save</button></form>`, async el => {
      const f = el.querySelector('#msForm');
      let prov = provider();
      el.querySelectorAll('[data-prov]').forEach(b => b.onclick = () => { prov = b.dataset.prov; el.querySelectorAll('[data-prov]').forEach(x => x.classList.toggle('on', x === b)); el.querySelector('#msCp').classList.toggle('hidden', prov !== 'cpanel'); el.querySelector('#msOl').classList.toggle('hidden', prov !== 'outlook'); if (prov === 'outlook') signed(el); });
      const keep = () => { const v = formData(f); Object.assign(m, {provider: prov, cpUrl: v.cpUrl.trim(), copySelf: !!v.copySelf, from: v.from.trim(), clientId: v.clientId.trim(), tenantId: v.tenantId.trim(), cc: v.cc.trim(), attachRep: !!v.attachRep, name: v.name.trim(), title: v.title.trim(), mobile: v.mobile.trim(), signoff: v.signoff.trim(), disclaimer: v.disclaimer.trim()}); };
      const drawSig = async () => { keep(); el.querySelector('#msSig').innerHTML = signatureHTML('data:image/png;base64,' + await logoPng()); };
      f.addEventListener('input', () => { clearTimeout(f._t); f._t = setTimeout(drawSig, 300); });
      drawSig(); if (prov === 'outlook') signed(el);
      el.querySelector('#cpMake').onclick = () => {
        keep();
        if (!okAddr(m.from || '')) { toast('Enter the email address to send from'); return; }
        if (!m.cpKey) { const a = new Uint8Array(24); crypto.getRandomValues(a); m.cpKey = Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
        const php = phpScript(m.cpKey, m.from, S().name, formData(f).cpPass || '');
        save();
        const AB = window.AndroidBridge;
        if (AB && AB.saveFile) AB.saveFile(btoa(unescape(encodeURIComponent(php))), 'application/octet-stream', 'fitx-mail.php');
        else downloadBlob(new Blob([php], {type: 'application/octet-stream'}), 'fitx-mail.php');
        el.querySelector('#cpStat').textContent = 'Script created – upload it to public_html, then Test';
        toast('fitx-mail.php saved – upload it in cPanel File Manager');
      };
      el.querySelector('#cpTest').onclick = async () => {
        keep(); save();
        if (!cpReady()) { toast('Create the mail script first'); return; }
        const st = el.querySelector('#cpStat'); st.textContent = 'Testing…';
        try {
          const r = await fetch(m.cpUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify({key: m.cpKey, action: 'ping'})});
          const j = await r.json().catch(() => null);
          if (!j || !j.ok) throw new Error((j && j.error) || 'No answer from ' + m.cpUrl + ' (' + r.status + ') – is fitx-mail.php uploaded there?');
          const logo = await logoPng();
          const r2 = await fetch(m.cpUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify({key: m.cpKey, to: [m.from], subject: 'FitX Accounts – test email', fromName: S().name, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333"><p>This is a test email from FitX Accounts. Your email sending works.</p><p>${esc(m.signoff || 'Best regards,')}</p>${signatureHTML('cid:fitxlogo')}</div>`, text: 'This is a test email from FitX Accounts. Your email sending works.', attachments: [{name: 'logo.png', type: 'image/png', data: logo, cid: 'fitxlogo'}]})});
          const j2 = await r2.json().catch(() => null);
          if (!j2 || !j2.ok) throw new Error((j2 && j2.error) || 'Sending failed (' + r2.status + ')');
          st.innerHTML = `<b style="color:var(--green)">Working</b> – test email sent to ${esc(m.from)}${j.sent_copy ? ' · copies saved in Sent' : ''}`;
        } catch (e) { st.textContent = e.message === 'Failed to fetch' ? 'Could not reach ' + m.cpUrl + ' – check the address and that the file is uploaded' : e.message; }
      };
      el.querySelector('#msIn').onclick = () => { keep(); save(); signIn().catch(e => toast(e.message || String(e))); };
      el.querySelector('#msOut').onclick = async () => { await signOut(); signed(el); };
      f.onsubmit = ev => { ev.preventDefault(); keep(); save(); closeSheet(() => { toast('Email settings saved'); if (after) after(); }); };
    });
  }

  /* ---------- wiring into the invoice / quote screen ---------- */
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id); if (!d) return;
    const top = typeof sheets !== 'undefined' && sheets[sheets.length - 1]; if (!top) return;
    const mail = top.querySelector('#aMail');
    if (mail) { mail.onclick = () => compose(id); mail.innerHTML = ICON.mail + 'Email'; }
    const bar = top.querySelector('.sharebar');
    if (bar && !bar.querySelector('#aPdfPv')) {
      bar.insertAdjacentHTML('beforeend', `<button type="button" class="btn" id="aPdfPv">${ICON.search || ''}PDF preview</button>`);
      bar.querySelector('#aPdfPv').onclick = () => pdfPreview(docHTML(d), d.number + ' - ' + ((custById(d.customerId) || {}).name || ''));
    }
    if ((d.mails || []).length) {
      const last = d.mails[d.mails.length - 1];
      bar && bar.insertAdjacentHTML('afterend', `<p class="hint" style="margin:-6px 2px 12px">${ICON.mail.replace('<svg ', '<svg width="13" height="13" style="vertical-align:-2px" ')} Emailed to ${esc(last.to)} on ${dfmt(last.date)}${d.mails.length > 1 ? ` (${d.mails.length} times)` : ''}</p>`);
    }
  };
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore();
    const bus = Array.from(document.querySelectorAll('#main .sec h2')).find(h => /business/i.test(h.textContent));
    const list = bus && bus.parentElement.nextElementSibling; if (!list) return;
    list.insertAdjacentHTML('beforeend', `<button type="button" class="item rcard" id="mMail"><span class="ic">${ICON.mail}</span><div class="main"><div class="t">Email &amp; signature</div><div class="s">${ready() ? (provider() === 'cpanel' ? 'Bluehost' : 'Outlook') + ' · ' + esc(M().from || '') : 'Send invoices by email with your logo signature'}</div></div></button>`);
    document.getElementById('mMail').onclick = () => settings();
  };
  window.FitxMail = {compose, settings, pdfPreview, emailHTML, signatureHTML, logoPng, defaults};
})();
