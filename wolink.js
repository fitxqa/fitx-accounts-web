/* FitX Accounts — work orders from a link.
   A link like  https://fitxqa.github.io/fitx-accounts-web/#wo=<data>  opens FitX with the work order(s) already filled in;
   the user checks each one and taps Save. <data> is base64url JSON: {"jobs":[{...}]} with, per job:
     kind "home"|"customer", name, phone, area, building, street, zone, maps, customer (name, for customer jobs),
     machine, brand, model, sn, problem, machines [{machine,brand,model,sn,problem}], date YYYY-MM-DD, time HH:MM,
     jobType, priority, tech (employee name), notes */
(function () {
  'use strict';
  const low = s => String(s || '').trim().toLowerCase();
  const digits = s => String(s || '').replace(/\D/g, '').slice(-8);
  function decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = atob(s), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function findCustomer(j) {
    const n = low(j.customer || j.name), d = digits(j.phone);
    const cs = (db.customers || []).filter(c => !c.homeVisits);
    return cs.find(c => low(c.name) === n) || (d.length >= 7 && cs.find(c => String(c.phone || '').split(/[\/,;]| or /).some(p => digits(p) === d)))
      || (n.length >= 3 && cs.find(c => low(c.name).includes(n) || n.includes(low(c.name))));
  }
  function preset(j) {
    const kind = low(j.kind) === 'customer' || j.customer ? 'customer' : 'home';
    const eq = (Array.isArray(j.machines) && j.machines.length ? j.machines : [j]).map(m => ({desc: m.machine || m.desc || '', brand: m.brand || '', model: m.model || '', sn: m.sn || '', problem: m.problem || ''}));
    const tech = j.tech ? (db.employees || []).find(e => low(e.name) === low(j.tech) || low(e.name).split(' ')[0] === low(j.tech).split(' ')[0]) : null;
    const p = {kind, equipment: eq, date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : today(), time: j.time || '', notes: j.notes || ''};
    if (j.jobType) p.jobType = j.jobType;
    if (j.priority) p.priority = /urgent/i.test(j.priority) ? 'Urgent' : j.priority;
    if (tech) p.techId = tech.id;
    let miss = '';
    if (kind === 'home') {
      const old = (db.homeclients || []).find(h => digits(h.phone) === digits(j.phone)) || {};
      p.home = {phone: j.phone || old.phone || '', name: j.name || old.name || '', building: j.building || old.building || '', street: j.street || old.street || '', zone: j.zone || old.zone || '', area: j.area || old.area || '', maps: j.maps || old.maps || ''};
    } else {
      const c = findCustomer(j);
      if (c) p.customerId = c.id; else miss = j.customer || j.name || '';
      p.home = {};
    }
    return {p, miss};
  }
  const label = j => (j.name || j.customer || j.phone || 'Job') + (j.area ? ' · ' + j.area : '') + (j.machine || j.problem ? ' · ' + [j.machine, j.problem].filter(Boolean).join(' – ') : '');

  function openOne(j, after) {
    const {p, miss} = preset(j);
    const before = (db.workorders || []).length, depth = sheets.length;
    FitxWO.edit(null, p);
    if (miss) setTimeout(() => toast('“' + miss + '” is not in your customers – pick it or tap ＋ Add new customer'), 600);
    // when the form closes, tell the list whether it was saved
    const iv = setInterval(() => { if (sheets.length <= depth) { clearInterval(iv); if (after) after((db.workorders || []).length > before); } }, 400);
  }
  function run(data) {
    const jobs = (data && (data.jobs || (Array.isArray(data) ? data : [data]))) || [];
    if (!jobs.length) { toast('This link has no work order'); return; }
    if (!window.FitxWO) { toast('Work orders are not available in this version'); return; }
    if (jobs.length === 1) { openOne(jobs[0], ok => { if (ok) toast('Work order saved'); }); return; }
    const done = jobs.map(() => false);
    openSheet(jobs.length + ' work orders from link', '<p class="hint" style="margin-top:0">Tap each job, check the details and tap Save.</p><div class="list" id="wlL"></div>', el => {
      const draw = () => {
        el.querySelector('#wlL').innerHTML = jobs.map((j, i) => `<button type="button" class="item" data-i="${i}" style="gap:10px"><span style="font-size:20px">${done[i] ? '✅' : '📝'}</span><div class="main"><div class="t">${esc(j.name || j.customer || j.phone || 'Job ' + (i + 1))}</div><div class="s">${esc(label(j).split(' · ').slice(1).join(' · '))}${j.date ? ' · ' + esc(dfmt(j.date)) : ''}${j.time ? ' ' + esc(j.time) : ''}</div></div><span class="badge ${done[i] ? 'green' : ''}">${done[i] ? 'Saved' : 'Fill in'}</span></button>`).join('');
        el.querySelectorAll('#wlL [data-i]').forEach(b => b.onclick = () => { const i = +b.dataset.i; if (done[i]) return; openOne(jobs[i], ok => { if (ok) { done[i] = true; draw(); if (done.every(Boolean)) toast('All ' + jobs.length + ' work orders saved'); } }); });
      };
      draw();
    });
  }
  function check() {
    const m = (location.hash || '').match(/^#wo=([A-Za-z0-9_\-+/=]+)/);
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    let data; try { data = decode(m[1]); } catch (e) { toast('This work order link is damaged – ask for it again'); return; }
    // give the app (and the cloud) a moment to load the customers first
    let tries = 0;
    const go = () => { if ((typeof db === 'undefined' || !window.FitxWO || !document.getElementById('main')) && tries++ < 30) { setTimeout(go, 300); return; } setTimeout(() => run(data), 1200); };
    go();
  }
  window.addEventListener('hashchange', check);
  if (document.readyState === 'complete') check(); else window.addEventListener('load', check);
  window.FitxWOLink = {run, decode};
})();
