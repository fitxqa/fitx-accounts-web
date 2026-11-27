/* FitX Accounts — Business & Marketing.
   Leads pipeline, today's follow-ups (leads, open quotes, AMC renewals, service due), ad campaigns with tracking links
   (Google, Instagram, Meta, TikTok), WhatsApp campaigns, business reports, AI ad writer (Claude) and Google review requests.
   Data: db.leads, db.adcamps, db.campaigns, settings S().mkt = {reviewUrl, done:{key: date}}. Menu → Marketing. */
(function () {
  'use strict';
  window.FITX_EXTRA_COLS = (window.FITX_EXTRA_COLS || []).concat(['leads', 'adcamps', 'campaigns']);
  const SOURCES = ['WhatsApp', 'Phone call', 'Booking page', 'Google', 'Instagram', 'Meta / Facebook', 'TikTok', 'Website', 'Referral', 'Walk-in', 'Other'];
  const STAGES = [['new', 'New', 'mk-n'], ['quoted', 'Quoted', 'mk-q'], ['won', 'Won', 'mk-w'], ['lost', 'Lost', 'mk-l']];
  const PLAT = {google: ['Google Ads', '#4285F4', 'G', 'Google'], instagram: ['Instagram', 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)', '◎', 'Instagram'],
    meta: ['Meta / Facebook', '#1877F2', 'f', 'Meta / Facebook'], tiktok: ['TikTok', '#111', '♪', 'TikTok']};
  const BOOK_BASE = 'https://fitxqa.github.io/fitx-accounts-web/book.html';
  const M = () => { const s = S(); s.mkt = s.mkt || {}; s.mkt.done = s.mkt.done || {}; return s.mkt; };
  const L = () => (db.leads = db.leads || []);
  const cust = id => (db.customers || []).find(c => c.id === id) || {};
  const digits = s => String(s || '').replace(/\D/g, '');
  const waNum = p => { const d = digits(p); return d.length === 8 ? '974' + d : d; };
  const waLink = (p, txt) => 'https://wa.me/' + waNum(p) + (txt ? '?text=' + encodeURIComponent(txt) : '');
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addD = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
  const coName = () => S().name || (S().company && S().company.name) || 'FitX';
  const nextNo = () => { const s = S(); const n = s.nextLead || 1; s.nextLead = n + 1; return `LD-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; };
  const monthStart = () => today().slice(0, 8) + '01';
  const cid = () => (window.FitxCloud && FitxCloud.cid) || '';
  const trackUrl = code => BOOK_BASE + '?src=' + encodeURIComponent(code) + '#' + cid();

  /* ---------- online bookings count as leads too ---------- */
  function onlineLeads() {
    return (db.appointments || []).filter(a => a.source === 'online').map(a => {
      const w = (db.workorders || []).find(x => x.apptId === a.id && x.status !== 'cancelled');
      return {virtual: true, id: a.id, date: String(a.created && +a.created ? iso(new Date(+a.created)) : a.date), name: (a.home || {}).name || (a.home || {}).phone, phone: (a.home || {}).phone,
        area: (a.home || {}).area, source: srcLabel(a.src) || 'Booking page', src: a.src || '', need: [a.machine, a.problem].filter(Boolean).join(' – '),
        stage: a.status === 'cancelled' ? 'lost' : w ? 'won' : 'new'};
    });
  }
  const srcLabel = code => { if (!code) return ''; const c = (db.adcamps || []).find(x => x.code === code); return c ? PLAT[c.platform][3] : ''; };
  const allLeads = () => L().concat(onlineLeads());
  function stats(from) {
    const l = allLeads().filter(x => !from || x.date >= from);
    const won = l.filter(x => x.stage === 'won').length, closed = l.filter(x => x.stage === 'won' || x.stage === 'lost').length;
    const spend = (db.adcamps || []).reduce((s, c) => s + (+c.spend || 0), 0);
    const paid = l.filter(x => ['Google', 'Instagram', 'Meta / Facebook', 'TikTok'].includes(x.source)).length;
    return {leads: l.length, won, rate: closed ? Math.round(won / closed * 100) : 0, cpl: paid ? spend / paid : 0, list: l};
  }

  /* ---------- follow-ups ---------- */
  function followUps() {
    const t = today(), done = M().done, out = [];
    const skip = k => done[k] && done[k] > t;
    L().forEach(l => { if ((l.stage === 'new' || l.stage === 'quoted') && (!l.followUp || l.followUp <= t) && !skip('ld:' + l.id))
      out.push({k: 'ld:' + l.id, ic: '💬', bg: '#e3f4ea', name: l.name || l.phone, sub: `${l.source || 'Lead'}${l.need ? ' · ' + l.need : ''}${l.followUp && l.followUp < t ? ' · due ' + dfmt(l.followUp) : ''}`, phone: l.phone, wa: `Hello${l.name ? ' ' + l.name : ''}, this is ${coName()}. Following up on your enquiry${l.need ? ' about ' + l.need : ''} – how can we help?`, lead: l.id}); });
    db.docs.filter(d => d.type === 'QUO' && quoStatus(d)[0] === 'Open' && d.date <= addD(t, -3)).forEach(d => {
      const c = (typeof docParty === 'function' ? docParty(d) : cust(d.customerId)) || {}; if (skip('qu:' + d.id)) return;
      out.push({k: 'qu:' + d.id, ic: '📞', bg: '#fff4ec', name: c.name || 'Customer', sub: `Quote ${d.number} · QAR ${fmt(docTotal(d))} · sent ${daysBetween(d.date, t)} days ago`, phone: c.phone, wa: `Hello${c.name ? ' ' + c.name : ''}, this is ${coName()}. Just checking on our quotation ${d.number}. Shall we go ahead? Happy to answer any questions.`, doc: d.id});
    });
    (db.amcs || []).filter(a => !a.cancelled && a.end && a.end >= t && a.end <= addD(t, 30)).forEach(a => {
      if ((db.amcs || []).some(x => x !== a && !x.cancelled && x.customerId === a.customerId && x.start > a.start)) return;
      const c = cust(a.customerId); if (skip('amc:' + a.id)) return;
      out.push({k: 'amc:' + a.id, ic: '📋', bg: '#e5f0fb', name: c.name || 'Customer', sub: `AMC ${a.number} ends in ${daysBetween(t, a.end)} days · renewal`, phone: c.phone, wa: `Hello${c.name ? ' ' + c.name : ''}, this is ${coName()}. Your maintenance contract ${a.number} ends on ${dfmt(a.end)}. Shall we renew it for next year?`, amc: a.id, btn: 'Renew'});
    });
    // last service 6+ months ago
    const last = {};
    (db.workorders || []).filter(w => w.status === 'done').forEach(w => {
      const key = w.kind === 'home' ? 'h:' + digits((w.home || {}).phone).slice(-8) : 'c:' + w.customerId, d = w.doneDate || w.date;
      if (!last[key] || last[key].d < d) last[key] = {d, name: w.kind === 'home' ? (w.home || {}).name || (w.home || {}).phone : cust(w.customerId).name, phone: w.kind === 'home' ? (w.home || {}).phone : cust(w.customerId).phone, area: w.kind === 'home' ? (w.home || {}).area : cust(w.customerId).area};
    });
    Object.entries(last).filter(([k, v]) => v.d <= addD(t, -180) && v.d >= addD(t, -420) && !skip('sv:' + k) && !(db.workorders || []).some(w => w.status !== 'done' && w.status !== 'cancelled' && ((w.kind === 'home' ? 'h:' + digits((w.home || {}).phone).slice(-8) : 'c:' + w.customerId) === k)))
      .slice(0, 15).forEach(([k, v]) => out.push({k: 'sv:' + k, ic: '🔧', bg: '#efe7fb', name: (v.name || 'Customer') + (v.area ? ' · ' + v.area : ''), sub: `Last service ${dfmt(v.d)} · offer a check-up`, phone: v.phone, wa: `Hello${v.name ? ' ' + v.name : ''}, this is ${coName()}. It's been about 6 months since your last service – would you like a check-up to keep your equipment running smoothly? Book here: ${bookLink()}`}));
    return out;
  }
  const bookLink = () => cid() === '8EZ2NIK0OLqPiMvZft6R' ? 'www.fitx.qa/appointment' : BOOK_BASE + '#' + cid();

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .mk h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 2px 8px;display:flex;justify-content:space-between;align-items:center}
  .mk h2 button{background:none;border:0;color:var(--orange-d);font:inherit;font-size:13px;font-weight:700;letter-spacing:0;text-transform:none;cursor:pointer;padding:0}
  .mk-kp{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.mk-kp div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 4px;text-align:center}
  .mk-kp b{display:block;font-size:19px}.mk-kp small{font-size:10.5px;color:var(--muted);font-weight:600;line-height:1.2;display:block}
  .mk-pipe{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.mk-pipe button{border:0;border-radius:12px;padding:8px 4px;text-align:center;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}
  .mk-pipe b{display:block;font-size:19px;color:var(--text)}
  .mk-n{background:#fff4ec;color:#b04a00}.mk-q{background:#e5f0fb;color:#145ea8}.mk-w{background:#e3f4ea;color:#1e8e4e}.mk-l{background:#fde8e6;color:#b3261e}
  .mk-cd{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .mk-r{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left;font:inherit;color:var(--text)}
  .mk-r:last-child{border-bottom:0}button.mk-r{cursor:pointer}
  .mk-r .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:17px;flex-shrink:0}
  .mk-r .mn{flex:1;min-width:0}.mk-r .mn b{font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mk-r .mn small{color:var(--muted);font-size:12px;display:block}
  .mk-bt{font-size:12px;font-weight:700;border-radius:999px;padding:6px 11px;background:var(--orange);color:#fff;white-space:nowrap;border:0;cursor:pointer;text-decoration:none;font-family:inherit}
  .mk-bt.k{background:#111}.mk-bt.g{background:#eef0f3;color:#555}
  .mk-tg{font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;background:#eef0f3;color:#555;white-space:nowrap}
  .mk-ads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mk-ad{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;text-align:left;font:inherit;color:var(--text);cursor:pointer}
  .mk-ad .h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}.mk-ad .h i{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:#fff;font-style:normal;font-size:12px;font-weight:800;flex-shrink:0}
  .mk-ad .v{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:6px}.mk-ad .v b{color:var(--text)}
  .mk-bar{height:8px;border-radius:99px;background:#eef0f3;overflow:hidden}.mk-bar i{display:block;height:100%;background:var(--orange);border-radius:99px}
  .mk-src{display:grid;grid-template-columns:96px 1fr 34px;gap:8px;align-items:center;font-size:12.5px;padding:5px 12px}.mk-src b{text-align:right}
  .mk-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mk-tools button{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;font-weight:700;font-size:13.5px;color:var(--text);cursor:pointer;text-align:left}
  .mk-tools button span{font-size:20px}.mk-tools button small{display:block;font-weight:500;color:var(--muted);font-size:11.5px}
  .mk-tools .ai{background:linear-gradient(135deg,#111,#2a2a2a);color:#fff;border-color:#111}.mk-tools .ai small{color:#bbb}
  .mk-empty{padding:16px;text-align:center;color:var(--muted);font-size:13px}
  .mk-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.mk-chips button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;color:var(--text);cursor:pointer}
  .mk-chips button.on{background:var(--orange);border-color:var(--orange);color:#fff}
  .mk-out{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:14px;line-height:1.5}
  .mk-mbar{display:flex;align-items:flex-end;gap:6px;height:120px;padding:8px 12px 0}.mk-mbar div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:10.5px;color:var(--muted)}
  .mk-mbar i{display:block;width:100%;background:var(--orange);border-radius:6px 6px 0 0;min-height:2px}.mk-mbar b{font-size:10px;color:var(--text)}`;
  document.head.appendChild(css);

  /* ---------- main page ---------- */
  function open() {
    openSheet('Business & Marketing', '<div class="mk" id="mkB"></div>', el => {
      const draw = () => {
        const st = stats(monthStart()), all = allLeads(), fu = followUps();
        const byStage = k => all.filter(x => x.stage === k).length;
        const ads = Object.keys(PLAT).map(p => { const cs = (db.adcamps || []).filter(c => c.platform === p), spend = cs.reduce((s, c) => s + (+c.spend || 0), 0);
          const ld = all.filter(x => x.source === PLAT[p][3] || cs.some(c => c.code && x.src === c.code)); const jobs = ld.filter(x => x.stage === 'won').length;
          return {p, spend, leads: ld.length, jobs, n: cs.length}; });
        const srcs = SOURCES.map(s => [s, st.list.filter(x => x.source === s).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
        const mx = Math.max(1, ...srcs.map(x => x[1]));
        const camps = (db.campaigns || []).slice().sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 3);
        el.querySelector('#mkB').innerHTML = `
          <div class="mk-kp"><div><b>${st.leads}</b><small>Leads<br>this month</small></div><div><b>${st.won}</b><small>Won</small></div><div><b>${st.rate}%</b><small>Win rate</small></div><div><b>${st.cpl ? Math.round(st.cpl) : '–'}</b><small>Cost / lead<br>QAR</small></div></div>
          <h2>Leads pipeline <button type="button" id="mkNew">+ New lead</button></h2>
          <div class="mk-pipe">${STAGES.map(([k, n, c]) => `<button type="button" class="${c}" data-st="${k}"><b>${byStage(k)}</b>${n}</button>`).join('')}</div>
          <h2>Today's follow-ups ${fu.length > 5 ? `<button type="button" id="mkFuAll">See all ${fu.length} ›</button>` : ''}</h2>
          <div class="mk-cd">${fu.length ? fu.slice(0, 5).map(fuRow).join('') : '<div class="mk-empty">🎉 Nothing to follow up today.</div>'}</div>
          <h2>Tools</h2>
          <div class="mk-tools">
            <button type="button" class="ai" id="mkAI"><span>✨</span><div>Write ad with AI<small>Claude writes EN + AR</small></div></button>
            <button type="button" id="mkCamp"><span>📣</span><div>WhatsApp campaign<small>Send an offer to a group</small></div></button>
            <button type="button" id="mkRev"><span>⭐</span><div>Google reviews<small>${M().reviewUrl ? 'Review link set' : 'Set your review link'}</small></div></button>
            <button type="button" id="mkRep"><span>📈</span><div>Reports<small>Sales, areas, win rate</small></div></button></div>
          <h2>Ads <button type="button" id="mkAdNew">+ Campaign</button></h2>
          <div class="mk-ads">${ads.map(a => `<button type="button" class="mk-ad" data-plat="${a.p}"><div class="h"><i style="background:${PLAT[a.p][1]}">${PLAT[a.p][2]}</i>${PLAT[a.p][0]}</div>
            <div class="v"><span>Spent</span><b>QAR ${fmt(a.spend).replace('.00', '')}</b></div><div class="v"><span>Leads · Jobs</span><b>${a.leads} · ${a.jobs}</b></div><div class="v"><span>Cost / job</span><b>${a.jobs ? 'QAR ' + Math.round(a.spend / a.jobs) : '–'}</b></div></button>`).join('')}</div>
          <h2>WhatsApp campaigns <button type="button" id="mkCamp2">+ New</button></h2>
          <div class="mk-cd">${camps.length ? camps.map(c => { const r = c.recipients || [], sent = r.filter(x => x.sent).length, rep = r.filter(x => x.replied).length;
            return `<button type="button" class="mk-r" data-camp="${c.id}"><span class="ic" style="background:#e3f4ea">📣</span><div class="mn"><b>${esc(c.name)}</b><small>${r.length} people · ${sent} sent · ${rep} replied</small></div><span class="mk-tg">${sent >= r.length && r.length ? 'Done' : sent ? 'Sending' : 'Draft'}</span></button>`; }).join('') : '<div class="mk-empty">No campaigns yet.</div>'}</div>
          <h2>Where customers come from <span style="text-transform:none;letter-spacing:0;font-weight:600">this month</span></h2>
          <div class="mk-cd" style="padding:6px 0">${srcs.length ? srcs.map(([n, v]) => `<div class="mk-src"><span>${esc(n)}</span><div class="mk-bar"><i style="width:${v / mx * 100}%"></i></div><b>${v}</b></div>`).join('') : '<div class="mk-empty">Add leads with their source to see this.</div>'}</div>`;
        const q = s => el.querySelector(s);
        q('#mkNew').onclick = () => editLead();
        el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => listLeads(b.dataset.st));
        if (q('#mkFuAll')) q('#mkFuAll').onclick = () => listFollowUps();
        bindFu(el, draw);
        q('#mkAI').onclick = () => aiWriter();
        q('#mkCamp').onclick = q('#mkCamp2').onclick = () => editCampaign();
        q('#mkRev').onclick = () => reviews();
        q('#mkRep').onclick = () => reports();
        q('#mkAdNew').onclick = () => editAd();
        el.querySelectorAll('[data-plat]').forEach(b => b.onclick = () => listAds(b.dataset.plat));
        el.querySelectorAll('[data-camp]').forEach(b => b.onclick = () => runCampaign(b.dataset.camp));
      };
      draw();
      keepFresh(el, draw);
    });
  }
  const keepFresh = (el, draw) => { const depth = sheets.length; const iv = setInterval(() => { if (!document.body.contains(el)) { clearInterval(iv); return; } if (sheets.length === depth && el.dataset.stale) { delete el.dataset.stale; draw(); } if (sheets.length > depth) el.dataset.stale = '1'; }, 500); };
  const fuRow = f => `<div class="mk-r"><span class="ic" style="background:${f.bg}">${f.ic}</span><div class="mn"><b>${esc(f.name)}</b><small>${esc(f.sub)}</small></div>
    ${f.phone ? `<a class="mk-bt${f.btn ? ' k' : ''}" target="_blank" rel="noopener" href="${esc(waLink(f.phone, f.wa))}" data-fu="${esc(f.k)}">${f.btn || 'WhatsApp'}</a><a class="mk-bt g" href="tel:${esc(f.phone)}" aria-label="Call">📞</a>` : `<span class="mk-tg">no phone</span>`}
    <button type="button" class="mk-bt g" data-fudone="${esc(f.k)}" title="Done – hide for a week" aria-label="Done">✓</button></div>`;
  function bindFu(el, draw) {
    el.querySelectorAll('[data-fudone]').forEach(b => b.onclick = () => { M().done[b.dataset.fudone] = addD(today(), 7); save(); toast('Done – hidden for a week'); draw(); });
    el.querySelectorAll('a[data-fu]').forEach(a => a.addEventListener('click', () => { const k = a.dataset.fu; if (k.startsWith('ld:')) { const l = L().find(x => x.id === k.slice(3)); if (l) { l.lastContact = today(); l.followUp = addD(today(), 3); save(); } } }));
  }
  function listFollowUps() {
    openSheet("Today's follow-ups", '<div class="mk" id="fuB"></div>', el => { const draw = () => { const fu = followUps(); el.querySelector('#fuB').innerHTML = `<div class="mk-cd">${fu.length ? fu.map(fuRow).join('') : '<div class="mk-empty">🎉 All done.</div>'}</div>`; bindFu(el, draw); }; draw(); });
  }

  /* ---------- leads ---------- */
  function editLead(id, preset) {
    const ex = id ? L().find(l => l.id === id) : null;
    const l = ex ? Object.assign({}, ex) : Object.assign({date: today(), stage: 'new', source: 'WhatsApp', followUp: addD(today(), 1)}, preset || {});
    const areas = window.FitxSchedule && FitxSchedule.areas ? [].concat(...Object.values(FitxSchedule.areas)).sort() : [];
    openSheet(ex ? 'Edit ' + ex.number : 'New lead', `<form id="ldF" autocomplete="off">
      <div class="row"><label class="f"><span>Name</span><input class="in" name="name" value="${esc(l.name || '')}" placeholder="Customer or company"></label><label class="f"><span>Mobile</span><input class="in" name="phone" type="tel" inputmode="tel" value="${esc(l.phone || '')}" placeholder="5555 1234"></label></div>
      <div class="row"><label class="f"><span>Source</span><select class="in" name="source">${SOURCES.map(s => `<option ${s === l.source ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="f"><span>Area</span><select class="in" name="area"><option value="">—</option>${areas.map(a => `<option ${a === l.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}${l.area && !areas.includes(l.area) ? `<option selected>${esc(l.area)}</option>` : ''}</select></label></div>
      <label class="f"><span>What do they need?</span><input class="in" name="need" value="${esc(l.need || '')}" placeholder="e.g. Treadmill service, AMC for hotel gym"></label>
      <div class="row"><label class="f"><span>Expected value (QAR)</span><input class="in" name="value" inputmode="decimal" value="${esc(l.value || '')}"></label><label class="f"><span>Follow up on</span><input class="in" type="date" name="followUp" value="${esc(l.followUp || '')}"></label></div>
      <label class="f"><span>Stage</span><div class="mk-chips" id="ldSt">${STAGES.map(([k, n]) => `<button type="button" data-k="${k}" class="${l.stage === k ? 'on' : ''}">${n}</button>`).join('')}</div></label>
      <label class="f"><span>Notes</span><textarea class="in" name="notes" rows="2">${esc(l.notes || '')}</textarea></label>
      <div class="btns">${ex ? '<button type="button" class="btn danger" id="ldDel">Delete</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn pri">Save lead</button></div></form>`, el => {
      const f = el.querySelector('#ldF'); let stage = l.stage;
      el.querySelectorAll('#ldSt [data-k]').forEach(b => b.onclick = () => { stage = b.dataset.k; el.querySelectorAll('#ldSt [data-k]').forEach(x => x.classList.toggle('on', x === b)); });
      if (el.querySelector('#ldDel')) el.querySelector('#ldDel').onclick = () => { if (!confirm('Delete ' + ex.number + '?')) return; db.leads = L().filter(x => x.id !== ex.id); save(); closeSheet(() => toast('Lead deleted')); };
      f.onsubmit = e => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(f));
        if (!v.name.trim() && !v.phone.trim()) { toast('Enter a name or mobile'); return; }
        const data = {name: v.name.trim(), phone: v.phone.trim(), source: v.source, area: v.area, need: v.need.trim(), value: v.value.trim(), followUp: v.followUp, notes: v.notes.trim(), stage, updated: Date.now()};
        if (ex) Object.assign(ex, data); else L().push(Object.assign({id: uid(), number: nextNo(), date: today(), created: String(Date.now())}, data));
        save(); closeSheet(() => toast('Lead saved'));
      };
    });
  }
  function listLeads(stage) {
    openSheet('Leads', '<div class="mk" id="llB"></div>', el => {
      let q = '';
      const draw = () => {
        let l = allLeads().filter(x => x.stage === stage);
        if (q) { const k = q.toLowerCase(); l = l.filter(x => [x.name, x.phone, x.area, x.need, x.source, x.number].join(' ').toLowerCase().includes(k)); }
        l.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        el.querySelector('#llB').innerHTML = `<div class="mk-chips">${STAGES.map(([k, n]) => `<button type="button" data-k="${k}" class="${stage === k ? 'on' : ''}">${n} · ${allLeads().filter(x => x.stage === k).length}</button>`).join('')}</div>
          <input class="in" id="llQ" type="search" placeholder="Search name, mobile, area" value="${esc(q)}" style="margin-bottom:10px">
          <div class="mk-cd">${l.length ? l.map(x => `<button type="button" class="mk-r" data-id="${x.id}" data-v="${x.virtual ? 1 : ''}"><span class="ic" style="background:#fff4ec">${x.virtual ? '🌐' : '👤'}</span><div class="mn"><b>${esc(x.name || x.phone || 'Lead')}</b><small>${esc([x.source, x.area, x.need].filter(Boolean).join(' · '))}</small></div><span class="mk-tg">${esc(dfmt(x.date))}</span></button>`).join('') : '<div class="mk-empty">No leads here.</div>'}</div>
          <button type="button" class="btn pri" id="llNew" style="width:100%;margin-top:12px">+ New lead</button>`;
        el.querySelectorAll('.mk-chips [data-k]').forEach(b => b.onclick = () => { stage = b.dataset.k; draw(); });
        const qi = el.querySelector('#llQ'); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; draw(); const n = el.querySelector('#llQ'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} };
        el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => b.dataset.v ? (window.FitxSchedule && FitxSchedule.viewAppt(b.dataset.id)) : editLead(b.dataset.id));
        el.querySelector('#llNew').onclick = () => editLead(null, {stage});
      };
      draw(); keepFresh(el, draw);
    });
  }

  /* ---------- ads ---------- */
  function editAd(id, plat) {
    const ex = id ? (db.adcamps || []).find(c => c.id === id) : null;
    const c = ex ? Object.assign({}, ex) : {platform: plat || 'instagram', start: today(), end: addD(today(), 7), budget: '', spend: ''};
    openSheet(ex ? 'Edit campaign' : 'New ad campaign', `<form id="adF">
      <label class="f"><span>Platform</span><div class="mk-chips" id="adP">${Object.entries(PLAT).map(([k, v]) => `<button type="button" data-k="${k}" class="${c.platform === k ? 'on' : ''}">${v[0]}</button>`).join('')}</div></label>
      <label class="f"><span>Campaign name</span><input class="in" name="name" value="${esc(c.name || '')}" placeholder="e.g. Treadmill service – Doha – Dec" required></label>
      <div class="row"><label class="f"><span>Start</span><input class="in" type="date" name="start" value="${esc(c.start || '')}"></label><label class="f"><span>End</span><input class="in" type="date" name="end" value="${esc(c.end || '')}"></label></div>
      <div class="row"><label class="f"><span>Budget (QAR)</span><input class="in" name="budget" inputmode="decimal" value="${esc(c.budget || '')}"></label><label class="f"><span>Spent so far (QAR)</span><input class="in" name="spend" inputmode="decimal" value="${esc(c.spend || '')}"></label></div>
      <label class="f"><span>Notes</span><textarea class="in" name="notes" rows="2" placeholder="Audience, ad text…">${esc(c.notes || '')}</textarea></label>
      <div class="btns">${ex ? '<button type="button" class="btn danger" id="adDel">Delete</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn pri">Save</button></div></form>`, el => {
      const f = el.querySelector('#adF'); let plat2 = c.platform;
      el.querySelectorAll('#adP [data-k]').forEach(b => b.onclick = () => { plat2 = b.dataset.k; el.querySelectorAll('#adP [data-k]').forEach(x => x.classList.toggle('on', x === b)); });
      if (el.querySelector('#adDel')) el.querySelector('#adDel').onclick = () => { if (!confirm('Delete this campaign?')) return; db.adcamps = db.adcamps.filter(x => x.id !== ex.id); save(); closeSheet(() => toast('Deleted')); };
      f.onsubmit = e => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(f));
        const data = {platform: plat2, name: v.name.trim(), start: v.start, end: v.end, budget: v.budget.trim(), spend: v.spend.trim(), notes: v.notes.trim()};
        db.adcamps = db.adcamps || [];
        let rec = ex; if (ex) Object.assign(ex, data); else { rec = Object.assign({id: uid(), code: plat2.slice(0, 2) + Math.random().toString(36).slice(2, 6), created: String(Date.now())}, data); db.adcamps.push(rec); }
        save(); closeSheet(() => { toast('Campaign saved'); viewAd(rec.id); });
      };
    });
  }
  function viewAd(id) {
    const c = (db.adcamps || []).find(x => x.id === id); if (!c) return;
    const url = trackUrl(c.code), ld = allLeads().filter(x => x.src === c.code), jobs = ld.filter(x => x.stage === 'won').length;
    openSheet(c.name, `<div class="mk">
      <div class="mk-kp"><div><b>${fmt(c.spend || 0).replace('.00', '')}</b><small>Spent QAR</small></div><div><b>${ld.length}</b><small>Leads</small></div><div><b>${jobs}</b><small>Jobs</small></div><div><b>${jobs ? Math.round((+c.spend || 0) / jobs) : '–'}</b><small>QAR / job</small></div></div>
      <h2>Tracking link for this ad</h2>
      <div class="mk-out" style="word-break:break-all;font-size:13px">${esc(url)}</div>
      <p class="hint">Use this as the ad's website / booking link. Bookings made through it are counted for this campaign.</p>
      <div class="btns"><button type="button" class="btn pri" id="avCopy">Copy link</button><button type="button" class="btn" id="avEd">Edit · update spend</button></div>
      <p class="hint">${esc(PLAT[c.platform][0])} · ${esc(dfmt(c.start))} – ${esc(dfmt(c.end))}${c.budget ? ' · budget QAR ' + esc(c.budget) : ''}</p></div>`, el => {
      el.querySelector('#avCopy').onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => prompt('Copy this link', url));
      el.querySelector('#avEd').onclick = () => closeSheet(() => editAd(c.id));
    });
  }
  function listAds(plat) {
    const cs = (db.adcamps || []).filter(c => c.platform === plat);
    openSheet(PLAT[plat][0], `<div class="mk"><div class="mk-cd">${cs.length ? cs.map(c => `<button type="button" class="mk-r" data-id="${c.id}"><span class="ic" style="background:#fff4ec">📢</span><div class="mn"><b>${esc(c.name)}</b><small>${esc(dfmt(c.start))} – ${esc(dfmt(c.end))} · spent QAR ${esc(c.spend || 0)}</small></div><span style="color:var(--muted)">›</span></button>`).join('') : '<div class="mk-empty">No campaigns on this platform yet.</div>'}</div>
      <button type="button" class="btn pri" id="laNew" style="width:100%;margin-top:12px">+ New ${esc(PLAT[plat][0])} campaign</button>
      <button type="button" class="btn" id="laAI" style="width:100%;margin-top:8px">✨ Write the ad with AI</button></div>`, el => {
      el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => viewAd(b.dataset.id));
      el.querySelector('#laNew').onclick = () => editAd(null, plat);
      el.querySelector('#laAI').onclick = () => aiWriter(plat);
    });
  }

  /* ---------- AI ad writer (Claude) ---------- */
  function aiWriter(plat) {
    const P2 = {instagram: 'Instagram post', meta: 'Facebook ad', google: 'Google search ad', tiktok: 'TikTok video script', whatsapp: 'WhatsApp offer message'};
    openSheet('✨ Write ad with AI', `<div class="mk"><form id="aiF">
      <label class="f"><span>For</span><div class="mk-chips" id="aiP">${Object.entries(P2).map(([k, v]) => `<button type="button" data-k="${k}" class="${(plat || 'instagram') === k ? 'on' : ''}">${v}</button>`).join('')}</div></label>
      <label class="f"><span>What are you offering?</span><input class="in" name="offer" placeholder="e.g. Treadmill service at home, QAR 250, this week only" required></label>
      <div class="row"><label class="f"><span>Area / audience</span><input class="in" name="aud" placeholder="e.g. Doha home gyms, hotel gyms"></label><label class="f"><span>Language</span><select class="in" name="lang"><option>English + Arabic</option><option>English</option><option>Arabic</option></select></label></div>
      <label class="f"><span>Tone</span><div class="mk-chips" id="aiT">${['Professional', 'Friendly', 'Urgent offer', 'Premium'].map((t, i) => `<button type="button" data-k="${t}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></label>
      <button type="submit" class="btn pri" style="width:100%">✨ Write with Claude</button>
      <p class="hint">Opens Claude with everything filled in – it writes the headline, text, hashtags and call to action. Copy the result into your ad.</p></form></div>`, el => {
      let p = plat || 'instagram', tone = 'Professional';
      el.querySelectorAll('#aiP [data-k]').forEach(b => b.onclick = () => { p = b.dataset.k; el.querySelectorAll('#aiP [data-k]').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('#aiT [data-k]').forEach(b => b.onclick = () => { tone = b.dataset.k; el.querySelectorAll('#aiT [data-k]').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelector('#aiF').onsubmit = e => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
        const prompt = `Write a ${P2[p]} for ${coName()}, a gym equipment service company in Qatar (repair, maintenance, installation, dismantling & relocation, spare parts, AMC for gyms, hotels and home gyms).
Offer: ${v.offer}
Audience: ${v.aud || 'gym owners and home gym users in Qatar'}
Tone: ${tone}
Language: ${v.lang}
Booking link: ${bookLink()}  ·  Phone/WhatsApp: ${S().phone || ''}
Give: a short headline, the main text${p === 'google' ? ' (3 headlines up to 30 characters and 2 descriptions up to 90 characters)' : ''}${p === 'tiktok' ? ' as a 15–30 second video script with scenes' : ''}, a call to action${p === 'instagram' || p === 'tiktok' ? ' and 8–12 hashtags for Qatar' : ''}. Keep it honest – no prices or claims I did not give.`;
        window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank');
        try { navigator.clipboard && navigator.clipboard.writeText(prompt); } catch (er) {}
        toast('Opening Claude – the request is also copied');
      };
    });
  }

  /* ---------- WhatsApp campaigns ---------- */
  function audienceList(type, area) {
    const out = [], seen = new Set();
    const add = (name, phone, a) => { const k = digits(phone).slice(-8); if (k.length < 8 || seen.has(k)) return; seen.add(k); out.push({name: name || '', phone, area: a || '', sent: false, replied: false}); };
    if (type === 'gyms' || type === 'all') (db.customers || []).filter(c => !c.homeVisits && c.phone).forEach(c => String(c.phone).split(/[\/,;]| or /).slice(0, 1).forEach(p => add(c.name, p, c.area)));
    if (type === 'home' || type === 'all') { (db.homeclients || []).forEach(h => add(h.name, h.phone, h.area)); (db.appointments || []).filter(a => a.kind === 'home').forEach(a => add((a.home || {}).name, (a.home || {}).phone, (a.home || {}).area)); }
    if (type === 'amc') (db.amcs || []).filter(a => !a.cancelled && a.end >= today() && a.end <= addD(today(), 60)).forEach(a => { const c = cust(a.customerId); add(c.name, c.phone, c.area); });
    if (type === 'leads') L().filter(l => l.stage !== 'won').forEach(l => add(l.name, l.phone, l.area));
    return out.filter(r => !area || r.area === area);
  }
  function editCampaign() {
    const T = [['home', 'Home clients'], ['gyms', 'Gyms, hotels & companies'], ['all', 'Everyone'], ['amc', 'AMC ending in 60 days'], ['leads', 'Open leads']];
    openSheet('New WhatsApp campaign', `<div class="mk"><form id="cpF">
      <label class="f"><span>Campaign name</span><input class="in" name="name" placeholder="e.g. Ramadan service offer" required></label>
      <label class="f"><span>Send to</span><div class="mk-chips" id="cpT">${T.map(([k, n], i) => `<button type="button" data-k="${k}" class="${i === 0 ? 'on' : ''}">${n}</button>`).join('')}</div></label>
      <label class="f"><span>Only this area (optional)</span><select class="in" name="area" id="cpA"><option value="">All areas</option></select></label>
      <p class="hint" id="cpN" style="margin-top:-4px"></p>
      <label class="f"><span>Message – {name} becomes each customer's name</span><textarea class="in" name="msg" rows="6" required>Hello {name} 👋
${coName()} offer: full gym equipment service at a special price this month.
📅 Book here: ${bookLink()}
Reply to this message for details.</textarea></label>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn pri">Create & start sending</button></div></form></div>`, el => {
      let type = 'home';
      const areaSel = el.querySelector('#cpA');
      const refresh = () => { const l = audienceList(type, ''); const areas = [...new Set(l.map(r => r.area).filter(Boolean))].sort(); const cur = areaSel.value;
        areaSel.innerHTML = '<option value="">All areas</option>' + areas.map(a => `<option ${a === cur ? 'selected' : ''}>${esc(a)}</option>`).join('');
        el.querySelector('#cpN').textContent = audienceList(type, areaSel.value).length + ' people with a mobile number'; };
      el.querySelectorAll('#cpT [data-k]').forEach(b => b.onclick = () => { type = b.dataset.k; el.querySelectorAll('#cpT [data-k]').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
      areaSel.onchange = refresh; refresh();
      el.querySelector('#cpF').onsubmit = e => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), rec = audienceList(type, v.area);
        if (!rec.length) { toast('Nobody in this group has a mobile number'); return; }
        db.campaigns = db.campaigns || [];
        const c = {id: uid(), name: v.name.trim(), type, area: v.area, message: v.msg, recipients: rec, created: String(Date.now())};
        db.campaigns.push(c); save(); closeSheet(() => runCampaign(c.id));
      };
    });
  }
  function runCampaign(id) {
    const c = (db.campaigns || []).find(x => x.id === id); if (!c) return;
    openSheet(c.name, '<div class="mk" id="rcB"></div>', el => {
      const draw = () => {
        const r = c.recipients || [], sent = r.filter(x => x.sent).length, next = r.findIndex(x => !x.sent);
        el.querySelector('#rcB').innerHTML = `
          <div class="mk-kp" style="grid-template-columns:repeat(3,1fr)"><div><b>${r.length}</b><small>People</small></div><div><b>${sent}</b><small>Sent</small></div><div><b>${r.filter(x => x.replied).length}</b><small>Replied</small></div></div>
          <div class="mk-bar" style="margin:10px 0"><i style="width:${r.length ? sent / r.length * 100 : 0}%"></i></div>
          ${next >= 0 ? `<a class="btn pri" id="rcNext" target="_blank" rel="noopener" href="${esc(waLink(r[next].phone, c.message.replace(/\{name\}/g, r[next].name || '').replace(/Hello\s+👋/, 'Hello 👋')))}" style="width:100%;display:flex;justify-content:center;text-decoration:none">💬 Send to next: ${esc(r[next].name || r[next].phone)}</a>
            <p class="hint">WhatsApp opens with the message ready – tap Send there, then come back for the next one.</p>` : '<div class="mk-empty">✅ Sent to everyone.</div>'}
          <h2>People</h2>
          <div class="mk-cd">${r.map((x, i) => `<div class="mk-r"><span class="ic" style="background:${x.sent ? '#e3f4ea' : '#eef0f3'}">${x.sent ? '✓' : i + 1}</span><div class="mn"><b>${esc(x.name || x.phone)}</b><small>${esc([x.phone, x.area].filter(Boolean).join(' · '))}</small></div>
            <button type="button" class="mk-bt ${x.replied ? '' : 'g'}" data-rep="${i}">${x.replied ? 'Replied' : 'Replied?'}</button>
            <a class="mk-bt g" target="_blank" rel="noopener" data-send="${i}" href="${esc(waLink(x.phone, c.message.replace(/\{name\}/g, x.name || '')))}">💬</a></div>`).join('')}</div>
          <button type="button" class="btn danger" id="rcDel" style="width:100%;margin-top:14px">Delete campaign</button>`;
        const mark = i => { c.recipients[i].sent = true; c.recipients[i].at = Date.now(); save(); setTimeout(draw, 300); };
        const nx = el.querySelector('#rcNext'); if (nx) nx.addEventListener('click', () => mark(next));
        el.querySelectorAll('[data-send]').forEach(a => a.addEventListener('click', () => mark(+a.dataset.send)));
        el.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { const x = c.recipients[+b.dataset.rep]; x.replied = !x.replied; save(); draw(); });
        el.querySelector('#rcDel').onclick = () => { if (!confirm('Delete this campaign?')) return; db.campaigns = db.campaigns.filter(x => x.id !== c.id); save(); closeSheet(() => toast('Deleted')); };
      };
      draw();
    });
  }

  /* ---------- Google reviews ---------- */
  function reviewMsg(name) {
    return `Hello${name ? ' ' + name : ''}, thank you for choosing ${coName()} 🙏\nIf you're happy with our service, a quick Google review would really help us:\n⭐ ${M().reviewUrl}\nشكراً لاختياركم ${coName()}، يسعدنا تقييمكم على جوجل 🌟`;
  }
  function askReview(name, phone) {
    if (!M().reviewUrl) { toast('Set your Google review link first (Marketing → Google reviews)'); reviews(); return; }
    if (!phone) { toast('No mobile number for this customer'); return; }
    window.open(waLink(phone, reviewMsg(name)), '_blank');
  }
  function reviews() {
    const done = (db.workorders || []).filter(w => w.status === 'done' && (w.doneDate || w.date) >= addD(today(), -30)).sort((a, b) => String(b.doneDate || b.date).localeCompare(String(a.doneDate || a.date)));
    const who = w => w.kind === 'home' ? (w.home || {}) : cust(w.customerId);
    openSheet('⭐ Google reviews', `<div class="mk">
      <label class="f"><span>Your Google review link</span><input class="in" id="rvU" value="${esc(M().reviewUrl || '')}" placeholder="https://g.page/r/…/review"></label>
      <p class="hint" style="margin-top:-4px">Find it in Google Business Profile → <b>Ask for reviews</b> → copy the link.</p>
      <button type="button" class="btn pri" id="rvSave" style="width:100%">Save link</button>
      ${M().reviewUrl ? `<a class="btn" target="_blank" rel="noopener" href="${esc(M().reviewUrl)}" style="width:100%;margin-top:8px;display:block;text-align:center;text-decoration:none">Open review page</a>` : ''}
      <h2>Ask recent customers</h2>
      <div class="mk-cd">${done.length ? done.map(w => { const c = who(w); return `<div class="mk-r"><span class="ic" style="background:#fff4ec">⭐</span><div class="mn"><b>${esc(c.name || c.phone || 'Customer')}</b><small>${esc(w.number)} · completed ${esc(dfmt(w.doneDate || w.date))}${w.reviewAsked ? ' · asked ✓' : ''}</small></div>
        <button type="button" class="mk-bt${w.reviewAsked ? ' g' : ''}" data-w="${w.id}">${w.reviewAsked ? 'Ask again' : 'Ask'}</button></div>`; }).join('') : '<div class="mk-empty">No jobs completed in the last 30 days.</div>'}</div>
      <p class="hint">Tip: ask the same day the job is done – that's when customers are happiest to leave a review. The button is also on every completed work order.</p></div>`, el => {
      el.querySelector('#rvSave').onclick = () => { const v = el.querySelector('#rvU').value.trim(); if (v && !/^https?:\/\//.test(v)) { toast('Paste the full link starting with https://'); return; } M().reviewUrl = v; save(); closeSheet(() => { toast('Review link saved'); reviews(); }); };
      el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { const w = db.workorders.find(x => x.id === b.dataset.w), c = who(w); if (!M().reviewUrl) { toast('Save your review link first'); return; } askReview(c.name, c.phone); w.reviewAsked = today(); save(); b.textContent = 'Ask again'; b.classList.add('g'); });
    });
  }

  /* ---------- reports ---------- */
  function reports() {
    openSheet('📈 Reports', '<div class="mk" id="rpB"></div>', el => {
      let per = 'year';
      const draw = () => {
        const t = today(), from = per === 'month' ? monthStart() : per === '3m' ? addD(t, -90) : t.slice(0, 4) + '-01-01';
        const inv = db.docs.filter(d => d.type === 'INV' && !d.void && d.date >= from), quo = db.docs.filter(d => d.type === 'QUO' && d.date >= from);
        const party = d => (typeof docParty === 'function' ? docParty(d) : cust(d.customerId)) || {};
        const total = inv.reduce((s, d) => s + docTotal(d), 0);
        const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(iso(d).slice(0, 7)); }
        const mv = months.map(m => db.docs.filter(d => d.type === 'INV' && !d.void && d.date.startsWith(m)).reduce((s, d) => s + docTotal(d), 0)), mmax = Math.max(1, ...mv);
        const by = (fn) => { const o = {}; inv.forEach(d => { const k = fn(d) || '—'; o[k] = (o[k] || 0) + docTotal(d); }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
        const areas = by(d => party(d).area), custs = by(d => party(d).name).slice(0, 8);
        const conv = quo.filter(q => q.status === 'Converted' || q.status === 'Accepted' || db.docs.some(d => d.type === 'INV' && d.fromQuote === q.number)).length;
        const repeat = (() => { const n = {}; db.docs.filter(d => d.type === 'INV' && !d.void).forEach(d => { const k = party(d).name; if (k) n[k] = (n[k] || 0) + 1; }); const v = Object.values(n); return [v.filter(x => x > 1).length, v.length]; })();
        const bars = (rows, mx) => rows.length ? rows.map(([n, v]) => `<div class="mk-src" style="grid-template-columns:110px 1fr 70px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n)}</span><div class="mk-bar"><i style="width:${v / mx * 100}%"></i></div><b>${fmt(v).replace('.00', '')}</b></div>`).join('') : '<div class="mk-empty">No sales in this period.</div>';
        el.querySelector('#rpB').innerHTML = `
          <div class="mk-chips">${[['month', 'This month'], ['3m', 'Last 3 months'], ['year', 'This year']].map(([k, n]) => `<button type="button" data-k="${k}" class="${per === k ? 'on' : ''}">${n}</button>`).join('')}</div>
          <div class="mk-kp"><div><b>${fmt(total).replace('.00', '')}</b><small>Sales QAR</small></div><div><b>${inv.length}</b><small>Invoices</small></div><div><b>${quo.length ? Math.round(conv / quo.length * 100) : 0}%</b><small>Quotes won</small></div><div><b>${repeat[1] ? Math.round(repeat[0] / repeat[1] * 100) : 0}%</b><small>Repeat customers</small></div></div>
          <h2>Sales – last 6 months</h2>
          <div class="mk-cd"><div class="mk-mbar">${months.map((m, i) => `<div><b>${mv[i] ? (mv[i] >= 1000 ? (mv[i] / 1000).toFixed(1) + 'k' : Math.round(mv[i])) : ''}</b><i style="height:${mv[i] / mmax * 90}%"></i>${new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', {month: 'short'})}</div>`).join('')}</div><div style="height:8px"></div></div>
          <h2>Sales by area</h2><div class="mk-cd" style="padding:6px 0">${bars(areas.slice(0, 8), areas.length ? areas[0][1] : 1)}</div>
          <h2>Top customers</h2><div class="mk-cd" style="padding:6px 0">${bars(custs, custs.length ? custs[0][1] : 1)}</div>
          <h2>Leads by source</h2><div class="mk-cd" style="padding:6px 0">${(() => { const l = allLeads().filter(x => x.date >= from), s = SOURCES.map(n => [n, l.filter(x => x.source === n).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]); const mx = s.length ? s[0][1] : 1;
            return s.length ? s.map(([n, v]) => `<div class="mk-src"><span>${esc(n)}</span><div class="mk-bar"><i style="width:${v / mx * 100}%"></i></div><b>${v}</b></div>`).join('') : '<div class="mk-empty">No leads in this period.</div>'; })()}</div>`;
        el.querySelectorAll('.mk-chips [data-k]').forEach(b => b.onclick = () => { per = b.dataset.k; draw(); });
      };
      draw();
    });
  }

  /* ---------- menus ---------- */
  const origMore = window.viewMore;
  if (origMore) window.viewMore = function () {
    origMore.apply(this, arguments);
    const a = document.getElementById('mWO') || document.querySelector('#main .item.rcard');
    if (!a || document.getElementById('mMkt')) return;
    a.insertAdjacentHTML('beforebegin', `<button type="button" class="item rcard" id="mMkt"><span class="ic">📣</span><div class="main"><div class="t">Business &amp; Marketing</div><div class="s">Leads, follow-ups, ads, WhatsApp campaigns, reviews, reports</div></div></button>`);
    document.getElementById('mMkt').onclick = () => open();
  };
  window.FitxMkt = {open, editLead, listLeads, followUps, askReview, reviews, reports, aiWriter, editCampaign, editAd};
})();
