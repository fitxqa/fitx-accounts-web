/* FitX Accounts — SkipCash online card payments (Qatar).
   The SkipCash secret keys live only in a small PHP file on the company's own hosting (Bluehost: fitx-pay.php).
   App → fitx-pay.php : create a payment link for an invoice / proforma advance, list payment statuses.
   SkipCash → fitx-pay.php : webhook + customer return page (signature checked, status re-read from SkipCash).
   Paid links are recorded automatically: invoice payment (or proforma advance), method "SkipCash",
   money in account 1150 SkipCash (clearing). When SkipCash pays out, record a transfer 1150 → bank (fees as expense).
   Records: doc.skip = [{id, url, amount, kind:'inv'|'adv', at, st}], settings S().skipcash = {url, key, mode, on} */
(function () {
  'use strict';
  const ACC = 'acc_1150';
  const SC = () => { const s = S(); if (!s.skipcash) s.skipcash = {}; return s.skipcash; };
  const ready = () => !!(SC().url && SC().key);
  const STATUS = {0: 'New', 1: 'Pending', 2: 'Paid', 3: 'Cancelled', 4: 'Failed', 5: 'Rejected', 6: 'Refunded', 7: 'Refund pending', 8: 'Refund failed'};
  const OPEN = st => st === undefined || st === 0 || st === 1;
  const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  const phpStr = v => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  /* ---------- the PHP file for Bluehost ---------- */
  function php(o) {
    return String.raw`<?php
/* FitX Accounts – SkipCash online payments. Created ${today()}.
   Upload to public_html (same place as fitx-mail.php) as fitx-pay.php.
   KEEP THIS FILE PRIVATE – it contains your SkipCash secret keys. */
$APP_KEY     = '${phpStr(o.appKey)}';      // the FitX app uses this key
$SC_URL      = '${o.mode === 'live' ? 'https://api.skipcash.app' : 'https://skipcashtest.azurewebsites.net'}';   // ${o.mode === 'live' ? 'LIVE' : 'TEST / sandbox'}
$CLIENT_ID   = '${phpStr(o.clientId)}';
$KEY_ID      = '${phpStr(o.keyId)}';
$KEY_SECRET  = '${phpStr(o.keySecret)}';
$WEBHOOK_KEY = '${phpStr(o.webhookKey)}';
$COMPANY     = '${phpStr(S().name)}';
$DATA        = __DIR__ . '/fitx-pay-data.php';   // payment log (not readable from the web)
$ALLOWED_ORIGINS = array('https://fitxqa.github.io', 'https://appassets.androidplatform.net', 'https://www.fitx.qa', 'https://fitx.qa');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function reply($code, $data) { http_response_code($code); header('Content-Type: application/json; charset=utf-8'); echo json_encode($data); exit; }
function self_url() { $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https'); return ($https ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . strtok($_SERVER['REQUEST_URI'], '?'); }
function load_db() { global $DATA; if (!file_exists($DATA)) return array(); $t = file_get_contents($DATA); $t = preg_replace('/^<\?php exit; \?>\n/', '', $t); $j = json_decode($t, true); return is_array($j) ? $j : array(); }
function save_db($db) { global $DATA; file_put_contents($DATA, "<?php exit; ?>\n" . json_encode($db), LOCK_EX); }
function sign_fields($fields, $data, $secret) {
  $p = array();
  foreach ($fields as $f) { if (!isset($data[$f]) || $data[$f] === '' || $data[$f] === null) continue; $v = $data[$f]; if (is_bool($v)) $v = $v ? 'true' : 'false'; $p[] = $f . '=' . $v; }
  return base64_encode(hash_hmac('sha256', implode(',', $p), $secret, true));
}
function uuid4() { $d = random_bytes(16); $d[6] = chr((ord($d[6]) & 0x0f) | 0x40); $d[8] = chr((ord($d[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4)); }
function http_json($method, $url, $auth, $body = null) {
  $ch = curl_init($url);
  $h = array('Accept: application/json', 'Authorization: ' . $auth);
  if ($body !== null) { $h[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body)); }
  curl_setopt_array($ch, array(CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $h));
  $res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  if ($res === false) return array('_error' => 'Cannot reach SkipCash: ' . $err);
  $j = json_decode($res, true);
  if (!is_array($j)) return array('_error' => 'SkipCash answered HTTP ' . $code . ': ' . substr(strip_tags($res), 0, 200));
  if ($code >= 400 || (isset($j['returnCode']) && (int)$j['returnCode'] >= 400)) return array('_error' => isset($j['errorMessage']) && $j['errorMessage'] ? $j['errorMessage'] : ('SkipCash error ' . $code), '_raw' => $j);
  return isset($j['resultObj']) && is_array($j['resultObj']) ? $j['resultObj'] : $j;
}
function refresh(&$db, $id) {
  global $SC_URL, $CLIENT_ID;
  $r = http_json('GET', $SC_URL . '/api/v1/payments/' . rawurlencode($id), $CLIENT_ID);
  if (isset($r['_error']) || !isset($r['statusId'])) return false;
  if (!isset($db[$id])) $db[$id] = array('id' => $id, 'created' => gmdate('c'));
  $p = $db[$id];
  $p['statusId'] = (int)$r['statusId'];
  if (isset($r['amount'])) $p['amount'] = (string)$r['amount'];
  if (isset($r['transactionId'])) $p['transactionId'] = (string)$r['transactionId'];
  if (isset($r['visaId'])) $p['visaId'] = (string)$r['visaId'];
  if (isset($r['custom1']) && empty($p['docId'])) $p['docId'] = (string)$r['custom1'];
  if ($p['statusId'] === 2 && empty($p['paidAt'])) $p['paidAt'] = gmdate('c');
  $p['checked'] = gmdate('c');
  $db[$id] = $p;
  return true;
}

/* ---------- customer comes back from the SkipCash page ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['return'])) {
  $id = isset($_GET['id']) ? preg_replace('/[^A-Za-z0-9\-]/', '', $_GET['id']) : '';
  $db = load_db(); if ($id) { refresh($db, $id); save_db($db); }
  $paid = $id && isset($db[$id]) && $db[$id]['statusId'] === 2;
  header('Content-Type: text/html; charset=utf-8');
  echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($COMPANY) . '</title><body style="font-family:system-ui,sans-serif;background:#f4f5f7;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="background:#fff;border-radius:16px;padding:32px 26px;max-width:380px;margin:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)"><div style="font:900 34px Arial;letter-spacing:-1px">Fit<span style="color:#ff6a00">X</span></div>'
    . ($paid ? '<h2 style="color:#1a7f45">Payment received ✓</h2><p>Thank you. Your payment of <b>QAR ' . htmlspecialchars($db[$id]['amount']) . '</b> was successful.</p>' : '<h2>Payment not completed</h2><p>The payment was not completed. Please try again or contact us.</p>')
    . '<p style="color:#888;font-size:13px">' . htmlspecialchars($COMPANY) . '</p></div></body>';
  exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(200, array('ok' => true, 'msg' => 'FitX SkipCash script is installed.'));

$raw = file_get_contents('php://input');
$in = json_decode($raw, true);
if (!is_array($in)) reply(400, array('ok' => false, 'error' => 'Bad request'));

/* ---------- webhook from SkipCash ---------- */
if (isset($in['PaymentId']) && !isset($in['key'])) {
  $auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : (function_exists('getallheaders') && isset(getallheaders()['Authorization']) ? getallheaders()['Authorization'] : '');
  $expected = sign_fields(array('PaymentId', 'Amount', 'StatusId', 'TransactionId', 'Custom1', 'VisaId'), $in, $WEBHOOK_KEY);
  if (!$auth || !hash_equals($expected, trim($auth))) reply(401, array('ok' => false, 'error' => 'Bad signature'));
  $db = load_db();
  // never trust the webhook alone: read the real status from SkipCash
  if (!refresh($db, (string)$in['PaymentId'])) reply(500, array('ok' => false, 'error' => 'Could not confirm with SkipCash'));
  save_db($db);
  reply(200, array('ok' => true));
}

/* ---------- requests from the FitX app ---------- */
if (!isset($in['key']) || !hash_equals($APP_KEY, (string)$in['key'])) reply(403, array('ok' => false, 'error' => 'WRONGKEY'));
$action = isset($in['action']) ? $in['action'] : '';

if ($action === 'ping') reply(200, array('ok' => true, 'php' => PHP_VERSION, 'curl' => function_exists('curl_init'), 'mode' => (strpos($SC_URL, 'test') !== false ? 'test' : 'live'), 'webhook' => self_url() . '?webhook=1', 'keys' => ($CLIENT_ID !== '' && $KEY_ID !== '' && $KEY_SECRET !== '')));

if ($action === 'create') {
  $amount = round((float)$in['amount'], 2);
  if ($amount <= 0) reply(400, array('ok' => false, 'error' => 'Amount must be more than 0'));
  $phone = preg_replace('/[^0-9+]/', '', (string)$in['phone']);
  if (strlen($phone) === 8) $phone = '+974' . $phone;
  if ($phone === '') $phone = '+97400000000';
  $ref = preg_replace('/[^A-Za-z0-9\-]/', '', (string)$in['ref']);
  $body = array(
    'Uid' => uuid4(), 'KeyId' => $KEY_ID, 'Amount' => number_format($amount, 2, '.', ''),
    'FirstName' => mb_substr(trim((string)$in['firstName']) ?: 'Customer', 0, 60), 'LastName' => mb_substr(trim((string)$in['lastName']) ?: '-', 0, 60),
    'Phone' => $phone, 'Email' => filter_var($in['email'], FILTER_VALIDATE_EMAIL) ? $in['email'] : 'payments@' . preg_replace('/^www\./', '', $_SERVER['HTTP_HOST']),
    'TransactionId' => $ref . '-' . time(), 'Custom1' => (string)$in['docId'],
  );
  $sig = sign_fields(array('Uid', 'KeyId', 'Amount', 'FirstName', 'LastName', 'Phone', 'Email', 'Street', 'City', 'State', 'Country', 'PostalCode', 'TransactionId', 'Custom1'), $body, $KEY_SECRET);
  $body['Subject'] = mb_substr((string)$in['subject'], 0, 100);
  $body['Description'] = mb_substr((string)$in['description'], 0, 200);
  $body['ReturnUrl'] = self_url() . '?return=1';
  $body['WebhookUrl'] = self_url() . '?webhook=1';
  $r = http_json('POST', $SC_URL . '/api/v1/payments', $sig, $body);
  if (isset($r['_error'])) reply(502, array('ok' => false, 'error' => $r['_error']));
  if (empty($r['payUrl']) || empty($r['id'])) reply(502, array('ok' => false, 'error' => 'SkipCash did not return a payment link'));
  $db = load_db();
  $db[$r['id']] = array('id' => $r['id'], 'payUrl' => $r['payUrl'], 'docId' => (string)$in['docId'], 'ref' => $ref, 'kind' => (string)$in['kind'], 'amount' => number_format($amount, 2, '.', ''), 'statusId' => 0, 'transactionId' => $body['TransactionId'], 'created' => gmdate('c'));
  save_db($db);
  reply(200, array('ok' => true, 'id' => $r['id'], 'payUrl' => $r['payUrl']));
}

if ($action === 'list') {
  $db = load_db(); $n = 0;
  foreach ($db as $id => $p) {   // re-check open links (max 15 per call, last 45 days)
    if ($n >= 15) break;
    if (in_array((int)$p['statusId'], array(0, 1), true) && strtotime($p['created']) > time() - 45 * 86400 && (empty($p['checked']) || strtotime($p['checked']) < time() - 60)) { refresh($db, $id); $n++; }
  }
  if ($n) save_db($db);
  $out = array(); foreach ($db as $p) if (strtotime($p['created']) > time() - 120 * 86400) $out[] = $p;
  reply(200, array('ok' => true, 'payments' => array_values($out)));
}
reply(400, array('ok' => false, 'error' => 'Unknown action'));
`;
  }

  async function call(body, url) {
    const r = await fetch(url || SC().url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({key: SC().key}, body))});
    let j; const t = await r.text();
    try { j = JSON.parse(t); } catch (e) { throw new Error(/<\?php/.test(t) ? 'PHP is not running this file – check the file name ends with .php' : 'Unexpected answer from your website (HTTP ' + r.status + ')'); }
    if (!j.ok) throw new Error(j.error === 'WRONGKEY' ? 'The key in the app does not match fitx-pay.php – copy the script again and upload it.' : (j.error || 'Error'));
    return j;
  }

  /* ---------- settings ---------- */
  function setup() {
    const c = SC(); if (!c.key) { c.key = newKey(); save(); }
    openSheet('SkipCash online payments', `
      <p class="hint" style="margin-top:0">Customers pay invoices and advances by card / Apple Pay through a SkipCash link or QR code. Paid links are recorded automatically.</p>
      <div class="seg" id="scMode" style="margin-bottom:12px"><button type="button" data-m="test" class="${c.mode !== 'live' ? 'on' : ''}">Test (sandbox)</button><button type="button" data-m="live" class="${c.mode === 'live' ? 'on' : ''}">Live</button></div>
      <div class="card" style="font-size:13.5px;line-height:1.55"><b>1.</b> From the SkipCash Merchant Portal → <b>Online Payments</b>, copy your keys here (they go only into the PHP file, not into the app):</div>
      <label class="f"><span>Client ID</span><input class="in" id="scCid" autocapitalize="none" spellcheck="false"></label>
      <label class="f"><span>Key ID</span><input class="in" id="scKid" autocapitalize="none" spellcheck="false"></label>
      <label class="f"><span>Key Secret</span><input class="in" id="scSec" type="password" autocapitalize="none" spellcheck="false"></label>
      <label class="f"><span>Webhook Key</span><input class="in" id="scWh" type="password" autocapitalize="none" spellcheck="false"></label>
      <div class="card" style="font-size:13.5px;line-height:1.55"><b>2.</b> <button type="button" class="btn pri" id="scCopy" style="min-height:38px;margin:4px 0">Copy PHP file</button><br>
        <b>3.</b> Bluehost cPanel → <b>File Manager</b> → <b>public_html</b> → <b>+ File</b> named <code>fitx-pay.php</code> → Edit → paste → <b>Save</b>.<br>
        <b>4.</b> Paste its address below (e.g. <code>https://fitx.qa/fitx-pay.php</code>) and tap <b>Test</b>.<br>
        <b>5.</b> In the SkipCash portal set the <b>Webhook URL</b> to the address shown after the test.</div>
      <label class="f"><span>Script address</span><input class="in" id="scUrl" value="${esc(c.url || '')}" placeholder="https://fitx.qa/fitx-pay.php" autocapitalize="none" spellcheck="false"></label>
      <div id="scRes" class="hint" style="font-weight:600"></div>
      <button type="button" class="btn pri full" id="scTest">Test &amp; save</button>
      ${ready() ? '<button type="button" class="btn full" id="scList" style="margin-top:8px">SkipCash payments</button>' : ''}
      <p class="hint" style="margin-top:10px">Money from SkipCash is booked to <b>1150 SkipCash (clearing)</b>. When SkipCash pays out to your bank, record <b>Banking → Transfer</b> from SkipCash to your bank, and the fee as an expense (Bank charges).</p>`, el => {
      let mode = c.mode === 'live' ? 'live' : 'test';
      el.querySelectorAll('#scMode button').forEach(b => b.onclick = () => { mode = b.dataset.m; el.querySelectorAll('#scMode button').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelector('#scCopy').onclick = async () => {
        const o = {appKey: c.key, mode, clientId: el.querySelector('#scCid').value.trim(), keyId: el.querySelector('#scKid').value.trim(), keySecret: el.querySelector('#scSec').value.trim(), webhookKey: el.querySelector('#scWh').value.trim()};
        if (!o.clientId || !o.keyId || !o.keySecret) { toast('Fill in Client ID, Key ID and Key Secret first'); return; }
        const txt = php(o);
        try { await navigator.clipboard.writeText(txt); toast('PHP file copied – paste it in cPanel File Manager'); }
        catch (e) { openSheet('fitx-pay.php', `<textarea class="in" rows="18" readonly style="font-family:ui-monospace,monospace;font-size:11px">${esc(txt)}</textarea>`); }
        c.mode = mode; save();
      };
      el.querySelector('#scTest').onclick = async ev => {
        const url = el.querySelector('#scUrl').value.trim(), res = el.querySelector('#scRes');
        if (!/^https:\/\//.test(url)) { res.style.color = 'var(--red)'; res.textContent = 'Enter the https:// address of fitx-pay.php'; return; }
        ev.target.disabled = true; res.style.color = ''; res.textContent = 'Testing…';
        try {
          const j = await call({action: 'ping'}, url);
          if (!j.curl) throw new Error('PHP cURL is not enabled on the hosting.');
          if (!j.keys) throw new Error('The PHP file has no SkipCash keys – fill them in, copy again and re-upload.');
          Object.assign(c, {url, mode: j.mode, on: true}); save();
          if (window.FitxLedger) FitxLedger.ensureAccounts();
          res.style.color = 'var(--green)';
          res.innerHTML = `Connected ✓ (${j.mode === 'live' ? 'LIVE' : 'TEST'} mode, PHP ${esc(j.php)}).<br>Webhook URL for the SkipCash portal:<br><code style="user-select:all">${esc(j.webhook)}</code>`;
        } catch (e) { res.style.color = 'var(--red)'; res.textContent = e.message === 'Failed to fetch' ? 'Could not reach the script – check the address (and that it is https).' : e.message; }
        ev.target.disabled = false;
      };
      const ls = el.querySelector('#scList'); if (ls) ls.onclick = paymentsList;
    });
  }

  /* ---------- create a link ---------- */
  function linkSheet(doc, kind) {
    if (!ready()) { setup(); return; }
    const c = custById(doc.customerId) || {};
    const A = window.FitxAdv;
    const due = kind === 'adv' ? Math.max(0, r2(A.advReq(doc) - A.advPaid(doc))) : docBal(doc);
    const ref = kind === 'adv' ? A.proNo(doc) : doc.number;
    const links = (doc.skip || []).filter(x => x.kind === kind);
    openSheet('SkipCash payment link', `
      <p class="hint" style="margin-top:0">${esc(c.name || '')} · ${esc(ref)}${kind === 'adv' ? ' (advance)' : ''}</p>
      <label class="f"><span>Amount to collect (QAR)</span><input class="in" type="number" step="0.01" min="1" inputmode="decimal" id="slAmt" value="${due > 0 ? due.toFixed(2) : ''}"></label>
      <button type="button" class="btn pri full" id="slMake">Create payment link</button>
      <div id="slOut"></div>
      ${links.length ? `<div class="sec"><h2>Links for this ${kind === 'adv' ? 'proforma' : 'invoice'}</h2></div><div class="list">${links.slice().reverse().map(x => `<div class="item"><div class="main"><div class="t">${money(x.amount)}</div><div class="s">${new Date(x.at).toLocaleString()} · <b style="color:${x.st === 2 ? 'var(--green)' : OPEN(x.st) ? 'var(--orange-d)' : 'var(--red)'}">${STATUS[x.st || 0]}</b></div></div>${OPEN(x.st) ? `<button type="button" class="btn" data-sh="${esc(x.id)}">Share</button>` : ''}</div>`).join('')}</div>
        <button type="button" class="btn full" id="slSync" style="margin-top:8px">Check payment status now</button>` : ''}`, el => {
      const show = x => {
        const qr = qrData(x.url);
        el.querySelector('#slOut').innerHTML = `<div class="card" style="text-align:center;margin-top:12px">${qr ? `<img src="${qr}" alt="QR code for the payment link" style="width:180px;height:180px">` : ''}
          <div style="font-weight:700;margin:6px 0">${money(x.amount)}</div><div class="hint" style="word-break:break-all">${esc(x.url)}</div>
          <div class="btns" style="margin-top:10px"><button type="button" class="btn pri" id="slWa">${ICON.wa || ''}WhatsApp</button><button type="button" class="btn" id="slCopy">Copy link</button><button type="button" class="btn" id="slOpen">Open</button></div></div>`;
        const msg = `Dear ${c.contact || c.name || 'Customer'},\n\nYou can pay ${kind === 'adv' ? 'the advance for ' : ''}${ref} (${money(x.amount)}) securely by card or Apple Pay here:\n${x.url}\n\nThank you,\n${S().name}`;
        el.querySelector('#slWa').onclick = () => openLink(waLink(c.phone, msg));
        el.querySelector('#slCopy').onclick = async () => { try { await navigator.clipboard.writeText(x.url); toast('Link copied'); } catch (e) { toast('Copy failed'); } };
        el.querySelector('#slOpen').onclick = () => openLink(x.url);
      };
      el.querySelector('#slMake').onclick = async ev => {
        const amt = r2(el.querySelector('#slAmt').value);
        if (!(amt > 0)) { toast('Enter the amount'); return; }
        ev.target.disabled = true; ev.target.textContent = 'Creating…';
        const nm = String(c.contact || c.name || 'Customer').trim().split(/\s+/);
        try {
          const j = await call({action: 'create', amount: amt, docId: doc.id, kind, ref, firstName: nm[0], lastName: nm.slice(1).join(' ') || (c.name && c.contact ? c.name : '-'), phone: c.phone || '', email: c.email || '',
            subject: `${kind === 'adv' ? 'Advance – ' : ''}${ref} – ${S().name}`.slice(0, 100), description: (doc.subject || '').slice(0, 200)});
          const x = {id: j.id, url: j.payUrl, amount: amt, kind, at: Date.now(), st: 0};
          doc.skip = (doc.skip || []).concat([x]); doc.updated = Date.now(); save();
          show(x); armPoll();
        } catch (e) { alert('SkipCash: ' + e.message); }
        ev.target.disabled = false; ev.target.textContent = 'Create payment link';
      };
      el.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => show(links.find(x => x.id === b.dataset.sh)));
      const sy = el.querySelector('#slSync'); if (sy) sy.onclick = async () => { await sync(true); closeSheet(() => linkSheet(docById(doc.id), kind)); };
    });
  }
  function waLink(phone, text) {
    let p = String(phone || '').replace(/\D/g, ''); if (p.length === 8) p = '974' + p;
    return 'https://wa.me/' + (p || '') + '?text=' + encodeURIComponent(text);
  }
  function qrData(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(5, 2); } catch (e) { return ''; }
  }

  /* ---------- QR / link on the invoice & proforma PDF ---------- */
  function payBlock(d) {
    if (!d || !d.skip || !d.skip.length) return '';
    const kind = d._pro ? 'adv' : d.type === 'INV' ? 'inv' : null; if (!kind) return '';
    const due = d._pro ? d._advReq - d._advPaid : docBal(d); if (due <= 0.004 || d.cancelled) return '';
    const x = d.skip.filter(l => l.kind === kind && OPEN(l.st)).slice(-1)[0]; if (!x) return '';
    const qr = qrData(x.url);
    return `<div class="pay" style="display:flex;gap:12px;align-items:center;margin-top:8px">${qr ? `<img src="${qr}" alt="" style="width:92px;height:92px;flex:0 0 92px">` : ''}<div><b>Pay online – card / Apple Pay</b><br>Scan the code or open:<br><span style="font-size:10.5px;word-break:break-all">${esc(x.url)}</span><br><span style="font-size:10.5px;color:#777">Secure payment by SkipCash · ${money(x.amount)}</span></div></div>`;
  }

  /* ---------- status sync & automatic recording ---------- */
  let syncing = false;
  async function sync(loud) {
    if (!ready() || syncing) return 0;
    const open = []; db.docs.forEach(d => (d.skip || []).forEach(x => { if (OPEN(x.st)) open.push([d, x]); }));
    if (!open.length && !loud) return 0;
    syncing = true; let n = 0;
    try {
      const j = await call({action: 'list'});
      const byId = {}; (j.payments || []).forEach(p => { byId[p.id] = p; });
      db.docs.forEach(d => (d.skip || []).forEach(x => {
        const p = byId[x.id]; if (!p) return;
        const st = +p.statusId;
        if (st !== x.st) { x.st = st; d.updated = Date.now(); }
        if (st !== 2) return;
        const amt = r2(p.amount || x.amount), date = (p.paidAt || new Date().toISOString()).slice(0, 10);
        const note = 'SkipCash ' + (p.transactionId || x.id);
        if (x.kind === 'adv') {
          d.advances = d.advances || [];
          if (d.advances.some(a => a.skip === x.id)) return;
          d.advances.push({id: uid(), amount: amt, date, method: 'SkipCash', acc: ACC, note, skip: x.id});
        } else {
          d.payments = d.payments || [];
          if (d.payments.some(a => a.skip === x.id)) return;
          d.payments.push({amount: amt, date, method: 'SkipCash', acc: ACC, note, skip: x.id});
        }
        n++; toast(`SkipCash payment received: ${d.number} · ${money(amt)}`);
      }));
      if (n || open.length) { save(); if (n) render(); }
      if (loud && !n) toast('No new SkipCash payments');
    } catch (e) { if (loud) alert('SkipCash: ' + e.message); else console.warn('skipcash sync', e); }
    syncing = false; return n;
  }
  let poll = 0;
  function armPoll() { clearInterval(poll); poll = setInterval(() => { if (!document.hidden) sync(false); }, 120000); }
  setTimeout(() => { if (ready()) { sync(false); armPoll(); } }, 9000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ready()) sync(false); });

  async function paymentsList() {
    const sh = openSheet('SkipCash payments', `<div id="spBody"><div class="list"><div class="empty">Loading…</div></div></div>`);
    try {
      const j = await call({action: 'list'});
      const L = (j.payments || []).sort((a, b) => String(b.created).localeCompare(String(a.created)));
      const box = document.querySelector('#spBody'); if (!box) return;
      const tot = L.filter(p => +p.statusId === 2).reduce((s, p) => s + num(p.amount), 0);
      box.innerHTML = `<p class="hint" style="margin-top:0">Paid in the last 120 days: <b>${money(tot)}</b></p>` + (L.length ? `<div class="list">${L.map(p => { const d = docById(p.docId); return `<div class="item"><div class="main"><div class="t">${esc(p.ref || '')} · ${money(p.amount)}</div><div class="s">${new Date(p.created).toLocaleString()} · ${esc(d ? ((custById(d.customerId) || {}).name || '') : '')}</div></div><span class="badge ${+p.statusId === 2 ? 'b-green' : OPEN(+p.statusId) ? 'b-orange' : 'b-red'}">${STATUS[+p.statusId] || p.statusId}</span></div>`; }).join('')}</div>` : '<div class="list"><div class="empty">No SkipCash links yet.</div></div>');
      sync(false);
    } catch (e) { const box = document.querySelector('#spBody'); if (box) box.innerHTML = `<div class="list"><div class="empty">${esc(e.message)}</div></div>`; }
  }

  /* ---------- buttons on invoices & quotations ---------- */
  const card = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>';
  const origView = window.viewDoc;
  if (origView) window.viewDoc = function (id) {
    origView(id);
    const d = docById(id), el = sheets[sheets.length - 1]; if (!d || !el || d.cancelled) return;
    const anchor = el.querySelector('#aEdit'); if (!anchor) return;
    const box = anchor.parentElement;
    if (d.type === 'INV' && docBal(d) > 0.004) {
      box.insertAdjacentHTML('afterbegin', `<button type="button" class="btn" id="aSkip">${card}SkipCash payment link</button>`);
      el.querySelector('#aSkip').onclick = () => linkSheet(d, 'inv');
    } else if (d.type === 'QUO' && window.FitxAdv && d.status !== 'Converted') {
      box.insertAdjacentHTML('afterbegin', `<button type="button" class="btn" id="aSkip">${card}SkipCash link (advance)</button>`);
      el.querySelector('#aSkip').onclick = () => linkSheet(d, 'adv');
    }
    if ((d.skip || []).some(x => OPEN(x.st))) sync(false);
  };

  /* Menu row */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const k = document.getElementById('mBak'); if (!k || document.getElementById('mSkip')) return;
    if (window.FitxCloud && FitxCloud.cid && FitxCloud.role === 'technician') return;
    k.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mSkip"><span class="ic">${card}</span><div class="main"><div class="t">SkipCash online payments</div><div class="s">${ready() ? 'Connected · ' + (SC().mode === 'live' ? 'live' : 'test') + ' mode' : 'Card / Apple Pay links & QR on invoices'}</div></div></button>`);
    document.getElementById('mSkip').onclick = setup;
  };
  window.FitxSkip = {setup, linkSheet, payBlock, sync, php, paymentsList};
})();
