/* FitX standard catalog: services and spare parts with categories › sub-categories.
   Added once automatically (settings.catalogV1); Products → "FitX catalog" adds anything missing again.
   Fixed ids (cat_…) so every phone / computer creates the same items and cloud sync never duplicates them.
   Prices start at 0 — set your own rates. */
(function () {
  'use strict';
  const S_ = ' › ';
  // [main category, sub-category, unit, [names…]]
  const SERVICES = [
    ['Gym Equipment Service', 'Treadmill', 'job', ['Treadmill preventive maintenance', 'Treadmill repair – diagnosis & fault finding', 'Running belt replacement (labour)', 'Running belt alignment & tensioning', 'Deck lubrication', 'Drive belt replacement (labour)', 'Motor brush replacement (labour)', 'Roller replacement (labour)', 'Incline motor repair', 'Speed & incline calibration']],
    ['Gym Equipment Service', 'Elliptical & cross trainer', 'job', ['Elliptical service', 'Elliptical bearing replacement (labour)', 'Pedal arm / crank repair', 'Resistance system repair']],
    ['Gym Equipment Service', 'Bikes', 'job', ['Upright / recumbent bike service', 'Spin bike service', 'Spin bike brake pad replacement (labour)', 'Pedal & crank replacement (labour)']],
    ['Gym Equipment Service', 'Rower & ski', 'job', ['Rower service', 'Rower chain / strap replacement (labour)']],
    ['Gym Equipment Service', 'Stair climber', 'job', ['Stair climber service', 'Stair climber step chain repair']],
    ['Gym Equipment Service', 'Strength equipment', 'job', ['Selectorized machine service', 'Cable replacement (labour)', 'Pulley replacement (labour)', 'Weight stack & guide rod lubrication', 'Plate-loaded machine service', 'Smith machine service', 'Bench & rack inspection / tightening']],
    ['Gym Equipment Service', 'General', 'job', ['Service visit / call-out charge', 'Diagnosis / inspection fee', 'Preventive maintenance visit (per gym)', 'Equipment installation & assembly', 'Equipment dismantling & relocation', 'Annual Maintenance Contract (AMC)', 'Emergency call-out (after hours)']],
    ['Gym Equipment Service', 'General', 'hour', ['Technician labour (per hour)']],
    ['Electronic Repair', 'Boards', 'job', ['MCB (motor control board) repair', 'MCB replacement & set-up (labour)', 'Console / display board repair', 'Lower board / inverter repair', 'Power supply board repair', 'Heart rate board repair']],
    ['Electronic Repair', 'Components & wiring', 'job', ['Board-level component replacement (labour)', 'Wiring harness repair', 'Safety key / emergency stop repair', 'Speed sensor replacement (labour)', 'Software / firmware update & reset']],
    ['Lathe Work', 'Machining', 'job', ['Shaft / axle machining', 'Roller shaft repair', 'Bushing / spacer fabrication', 'Bearing housing machining', 'Thread repair / re-threading']],
    ['Welding & Fabrication', 'Welding', 'job', ['Frame welding repair', 'Aluminium / stainless steel welding', 'Crack repair & reinforcement']],
    ['Welding & Fabrication', 'Fabrication', 'job', ['Bracket fabrication', 'Custom part fabrication', 'Frame modification']],
    ['Upholstery', 'Pads & seats', 'job', ['Seat pad re-upholstery', 'Back pad re-upholstery', 'Bench re-upholstery', 'Foam replacement', 'Vinyl / leather cover replacement', 'Grip / handle cover replacement']],
    ['Refurbishing & Painting', 'Refurbishing', 'job', ['Full equipment refurbishment', 'Rust removal & treatment', 'Chrome / metal polishing', 'Decal & label replacement', 'Deep cleaning & sanitising']],
    ['Refurbishing & Painting', 'Painting', 'job', ['Frame powder coating', 'Frame spray painting', 'Touch-up painting']]
  ];
  const PARTS = [
    ['Electronic Components', 'Boards', 'pcs', ['Motor control board (MCB)', 'Lower control board', 'Console / display board', 'Power supply board', 'Inverter board', 'Heart rate receiver board']],
    ['Electronic Components', 'Semiconductors', 'pcs', ['IGBT module', 'MOSFET', 'Bridge rectifier', 'Diode', 'Voltage regulator IC', 'Optocoupler', 'Microcontroller IC', 'Transistor']],
    ['Electronic Components', 'Passive components', 'pcs', ['Electrolytic capacitor', 'Film capacitor', 'Resistor', 'Fuse', 'Thermistor (NTC)', 'Varistor (MOV)', 'Relay', 'Inductor / choke']],
    ['Electronic Components', 'Sensors & switches', 'pcs', ['Speed sensor (reed / hall)', 'Incline sensor / potentiometer', 'Safety key magnet', 'Emergency stop switch', 'Heart rate grip sensor', 'Keypad / membrane switch']],
    ['Electronic Components', 'Power & wiring', 'pcs', ['Power cord', 'Power inlet socket (IEC)', 'On/off rocker switch', 'Circuit breaker', 'Wiring harness / data cable', 'Connectors & terminals', 'Cooling fan', 'Transformer']],
    ['Motors & Drive', 'Motors', 'pcs', ['Drive motor (DC)', 'Incline / lift motor', 'Generator / alternator (bike & elliptical)']],
    ['Motors & Drive', 'Motor parts', 'pcs', ['Motor brush set', 'Motor capacitor', 'Eddy current brake / resistance magnet', 'Motor flywheel / pulley']],
    ['Belts & Bearings', 'Bike & elliptical belts', 'pcs', ['Spin bike drive belt', 'Elliptical / bike poly-V belt']],
    ['Treadmill Parts', 'Deck & rollers', 'pcs', ['Running deck', 'Front roller', 'Rear roller', 'Deck cushion / elastomer', 'Side rail']],
    ['Treadmill Parts', 'Covers & consumables', 'pcs', ['Treadmill silicone lubricant', 'Motor hood cover']],
    ['Cardio Parts', 'Bike & elliptical', 'pcs', ['Pedal set', 'Pedal strap', 'Crank arm', 'Spin bike brake pad', 'Resistance knob', 'Seat / saddle', 'Handlebar grips', 'Console overlay / keypad sticker']],
    ['Strength Parts', 'Cables & pulleys', 'pcs', ['Cable end / ball stop', 'Pulley', 'Snap hook / carabiner']],
    ['Strength Parts', 'Cables & pulleys', 'm', ['Steel cable (per metre)']],
    ['Strength Parts', 'Weight stack & guides', 'pcs', ['Weight stack pin', 'Selector rod', 'Guide rod', 'Linear bearing / bushing', 'Weight plate']],
    ['Strength Parts', 'Handles & grips', 'pcs', ['Grip handle', 'Foam roller pad']],
    ['Upholstery Materials', 'Covers & foam', 'm', ['Vinyl / PU leather (per metre)']],
    ['Upholstery Materials', 'Covers & foam', 'pcs', ['Foam sheet', 'Ready-made seat pad', 'Ready-made back pad', 'Staples & upholstery adhesive']],
    ['Fabrication Materials', 'Steel & fixings', 'm', ['Steel tube / profile (per metre)']],
    ['Fabrication Materials', 'Steel & fixings', 'pcs', ['Steel plate', 'Bolts, nuts & washers set', 'Bushing stock (nylon / brass)']],
    ['Fabrication Materials', 'Welding consumables', 'pcs', ['Welding rods / wire', 'Grinding & cutting discs']],
    ['Paint & Finishing', 'Coatings', 'kg', ['Powder coat']],
    ['Paint & Finishing', 'Coatings', 'pcs', ['Spray paint (can)', 'Primer', 'Rust converter']],
    ['Paint & Finishing', 'Finishing', 'pcs', ['Decal / sticker set', 'Polish & cleaning chemicals']]
  ];
  // treadmill-database categories move under one main category
  const TM_MOVE = {'Running belts': 'Belts & Bearings › Running belts', 'Drive belts': 'Belts & Bearings › Drive belts', 'Bearings': 'Belts & Bearings › Bearings'};
  const JOBS = ['Electronic / board repair', 'Lathe & machining', 'Welding & fabrication', 'Upholstery', 'Refurbishing & painting'];
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

  function importCatalog() {
    const st = S(); let added = 0;
    const addCat = c => { const main = c.split(S_)[0]; if (!st.stockCats.includes(main)) st.stockCats.push(main); if (!st.stockCats.includes(c)) st.stockCats.push(c); };
    const addItem = (main, sub, unit, name, service) => {
      const cat = main + S_ + sub; addCat(cat);
      const id = 'cat_' + slug(name);
      if (db.items.some(i => i.id === id || (i.name || '').toLowerCase() === name.toLowerCase())) return;
      db.items.push({id, name, sku: '', category: cat, cost: 0, price: 0, unit, minQty: service ? 0 : 1, service: !!service, descr: ''});
      added++;
    };
    SERVICES.forEach(([m, sub, unit, names]) => names.forEach(n => addItem(m, sub, unit, n, true)));
    PARTS.forEach(([m, sub, unit, names]) => names.forEach(n => addItem(m, sub, unit, n, false)));
    // group the treadmill-database categories
    Object.entries(TM_MOVE).forEach(([from, to]) => {
      let used = false;
      db.items.forEach(i => { if (i.category === from) { i.category = to; used = true; } });
      if (used || st.stockCats.includes(from)) { st.stockCats = st.stockCats.filter(c => c !== from); addCat(to); }
    });
    if (typeof TM_CATS !== 'undefined') Object.keys(TM_CATS).forEach(k => { if (TM_MOVE[TM_CATS[k]]) TM_CATS[k] = TM_MOVE[TM_CATS[k]]; });
    // old starter categories that no product uses are replaced by the catalog's categories
    const OLD = ['Belts', 'Motors', 'Electronics / Boards', 'Cables', 'Rollers', 'Decks', 'Consoles', 'Lubricant', 'Accessories'];
    st.stockCats = st.stockCats.filter(c => !OLD.includes(c) || db.items.some(i => i.category === c || String(i.category || '').startsWith(c + S_)));
    JOBS.forEach(j => { if (!st.jobTypes.includes(j)) st.jobTypes.push(j); });
    st.catalogV1 = true;
    save();
    return added;
  }
  window.importFitxCatalog = importCatalog;
  // keep future treadmill imports in the grouped categories
  if (typeof TM_CATS !== 'undefined') Object.keys(TM_CATS).forEach(k => { if (TM_MOVE[TM_CATS[k]]) TM_CATS[k] = TM_MOVE[TM_CATS[k]]; });

  // Products screen: button to add the catalog again (adds only what is missing)
  const origStock = window.viewStock;
  window.viewStock = function () {
    origStock();
    const bar = document.getElementById('tmImp');
    if (bar && !document.getElementById('catImp')) {
      bar.insertAdjacentHTML('afterend', `<button type="button" class="btn" id="catImp">${ICON.box}FitX catalog</button>`);
      document.getElementById('catImp').onclick = () => {
        if (!confirm('Add the FitX services & parts catalog?\n\nOnly items that are missing are added. Your prices and existing items are kept.')) return;
        const n = importCatalog(); render(); toast(n ? n + ' items added' : 'Catalog already complete');
      };
    }
  };

  // signed in to the cloud: add the catalog to the company data once it has loaded
  (window.FITX_AFTER_SYNC = window.FITX_AFTER_SYNC || []).push(() => {
    const missing = SERVICES.concat(PARTS).some(([m, sub, u, names]) => names.some(n => !db.items.some(i => i.id === 'cat_' + slug(n) || (i.name || '').toLowerCase() === n.toLowerCase())));
    if (!S().catalogV1 || missing) { const n = importCatalog(); if (n) { render(); toast(`FitX catalog added: ${n} services & parts`); } }
  });
  // first start after this update
  if (!S().catalogV1) {
    const n = importCatalog();
    if (n) setTimeout(() => toast(`FitX catalog added: ${n} services & parts`), 1200);
  }
})();
