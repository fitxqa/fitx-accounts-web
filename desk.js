/* FitX Accounts — full-screen layout on computers.
   On wide screens (1200 px and up) the quotation / invoice form and the document view use the whole width:
   one column that fills the window (no split).
   Phones and tablets are unchanged. */
(function () {
  'use strict';
  const WIDE = '(min-width:1100px)';
  const css = document.createElement('style');
  css.textContent = `
    @media ${WIDE}{
      .sheet.dwide .sb>div{max-width:none;margin:0}
      .sheet.dwide .sb{padding-left:28px;padding-right:28px}
      .sheet.dwide #docForm .in:not(textarea){min-height:40px;height:40px;padding-top:6px;padding-bottom:6px}
      .sheet.dwide #docForm textarea.in{min-height:60px}
      .sheet.dwide #docForm .f,.sheet.dwide #docForm label.f{margin-bottom:8px}
      .dgrid{display:grid;gap:28px;align-items:start}
      .dgrid.dform{grid-template-columns:minmax(380px,1fr) minmax(0,1.85fr)}
      .dgrid.dview{grid-template-columns:minmax(0,1.6fr) minmax(400px,1fr)}
      .dgrid>.dcol{min-width:0}
      .dgrid.dview>.dR{position:sticky;top:0}
      .dgrid .dcard{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;padding:16px 16px 6px;margin-bottom:16px}
      .dgrid .dcard>.sec:first-child{margin-top:0}
      .sheet.dwide #docPrev{max-width:1100px;margin:0 auto}
    }`;
  document.head.appendChild(css);

  const wide = () => window.matchMedia && matchMedia(WIDE).matches;
  const isSec = (n, re) => n.classList && n.classList.contains('sec') && re.test(n.textContent || '');

  function layoutForm(el) {
    const form = el.querySelector('#docForm');
    if (!form || form.dataset.dsplit) return;
    const kids = Array.from(form.children);
    const iItems = kids.findIndex(n => isSec(n, /^\s*Items/i));
    if (iItems < 0) return;
    const grid = document.createElement('div'); grid.className = 'dgrid dform';
    const L = document.createElement('div'), R = document.createElement('div');
    L.className = 'dcol dL'; R.className = 'dcol dR';
    const lTop = document.createElement('div'), lBot = document.createElement('div'), rCard = document.createElement('div');
    lTop.className = 'dcard'; lBot.className = 'dcard'; rCard.className = 'dcard';
    lTop.innerHTML = '<div class="sec"><h2>Details</h2></div>';
    kids.forEach((n, i) => {
      if (i < iItems) { lTop.appendChild(n); return; }
      const toRight = n.tagName === 'BUTTON' || n.classList.contains('tot') || isSec(n, /^\s*Totals/i) || !!n.querySelector('#dDisc') || i < kids.findIndex(k => isSec(k, /^\s*Totals/i));
      (toRight ? rCard : lBot).appendChild(n);
    });
    L.appendChild(lTop); if (lBot.children.length) L.appendChild(lBot);
    R.appendChild(rCard);
    grid.append(L, R); form.appendChild(grid); form.dataset.dsplit = '1';
    el.classList.add('dwide');
  }

  function layoutView(el) {
    const prev = el.querySelector('#docPrev');
    if (!prev) return;
    const box = prev.parentElement;
    if (!box || box.dataset.dsplit) return;
    const kids = Array.from(box.children);
    const iPrev = kids.findIndex(n => isSec(n, /^\s*Preview/i));
    const grid = document.createElement('div'); grid.className = 'dgrid dview';
    const L = document.createElement('div'), R = document.createElement('div');
    L.className = 'dcol dL'; R.className = 'dcol dR';
    const card = document.createElement('div'); card.className = 'dcard';
    kids.forEach((n, i) => { if (n === prev || (iPrev >= 0 && i >= iPrev)) L.appendChild(n); else card.appendChild(n); });
    R.appendChild(card);
    grid.append(L, R); box.appendChild(grid); box.dataset.dsplit = '1';
    el.classList.add('dwide');
  }

  const orig = window.openSheet;
  if (typeof orig !== 'function') return;
  window.openSheet = function (title, html, mount) {
    const el = orig.call(this, title, html, mount);
    try { if (el && wide() && (el.querySelector('#docForm') || el.querySelector('#docPrev'))) el.classList.add('dwide'); } catch (e) {} // single column, full window width
    return el;
  };
})();
