/* FitX Accounts — product & service symbols.
   Every item gets a line-drawn symbol picked automatically from its name / category (treadmill, bike, belt, bearing, board…).
   Any item can be given a different symbol by hand (item.icon) from Edit item → Symbol. */
(function () {
  'use strict';
  const I = {
    treadmill: ['Treadmill', '<path d="M2 18h15l2.6-12"/><path d="M16.4 6h5"/><path d="M18.7 10.5H13"/><path d="M3 21h14"/><circle cx="3.5" cy="18" r=".6"/>'],
    bike: ['Bike', '<path d="M3 21h16"/><path d="M9 21l1.6-12"/><path d="M8 9h4.5"/><path d="M10.2 13.5h5.3"/><path d="M15.5 13.5L17 6h3.5"/><circle cx="15.5" cy="16.5" r="3"/>'],
    elliptical: ['Elliptical', '<path d="M3 21h16"/><ellipse cx="10" cy="15.5" rx="6" ry="2.8"/><path d="M17.5 21L15.5 4"/><path d="M13.5 4h4.5"/><path d="M5.5 13.5h3M12 17.5h3"/>'],
    rower: ['Rower', '<path d="M2 18h20"/><rect x="5" y="15" width="5" height="3" rx="1"/><circle cx="18.5" cy="13" r="3"/><path d="M15.6 12.3L12 11"/><path d="M12 9.5v3"/><path d="M14 18l1.5-2.5"/>'],
    stairs: ['Stair climber', '<path d="M3 20h5v-4h4v-4h4V8h5"/><path d="M19 8V3"/><path d="M16 3h5"/>'],
    cable: ['Cable / functional trainer', '<path d="M3 21h18"/><path d="M5 21V3h14v18"/><circle cx="8.5" cy="6" r="1.5"/><circle cx="15.5" cy="6" r="1.5"/><path d="M8.5 7.5v9M15.5 7.5v9M7 16.5h3M14 16.5h3"/>'],
    stack: ['Weight-stack machine', '<path d="M4 3h16M6 3v18M18 3v18M4 21h16"/><rect x="8.5" y="12" width="7" height="7" rx=".5"/><path d="M8.5 14.3h7M8.5 16.6h7M10.5 3v9M13.5 3v9"/>'],
    plate: ['Weight plate / plate-loaded', '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M2 12h3M19 12h3"/><path d="M12 7.5v.01"/>'],
    bench: ['Bench', '<rect x="3" y="10" width="18" height="3" rx="1.5"/><path d="M6 13v7M18 13v7M4 20h4M16 20h4"/>'],
    rack: ['Rack / Smith machine', '<path d="M5 3v18M19 3v18M3 21h4M17 21h4M2 9h20"/><path d="M3 7v4M21 7v4"/>'],
    dumbbell: ['Free weights', '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>'],
    wrench: ['Service / repair', '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'],
    clock: ['Labour hour', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    van: ['Visit / transport', '<path d="M2 6h11v10H2zM13 9.5h4l3.5 3.5v3H13"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>'],
    diag: ['Diagnosis / inspection', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L21 21"/><path d="M6.5 10.5h1.8l1-2 1.6 4 1-2h1.6"/>'],
    box: ['Installation / assembly', '<path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10"/>'],
    calendar: ['Maintenance contract', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8.5 15l2 2 4-4"/>'],
    board: ['Circuit board', '<rect x="3" y="5" width="18" height="14" rx="1.5"/><rect x="7.5" y="9" width="5" height="5"/><path d="M12.5 11.5H17V8.5M6 9v6M14.5 16H18"/><circle cx="17" cy="8" r=".6"/>'],
    chip: ['Chip / semiconductor', '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>'],
    capacitor: ['Capacitor', '<path d="M2 12h8M14 12h8M10 6v12M14 6v12"/>'],
    resistor: ['Resistor / passive', '<path d="M2 12h4l1.5-3 3 6 3-6 3 6 1.5-3h4"/>'],
    fuse: ['Fuse / breaker', '<rect x="5" y="8" width="14" height="8" rx="2"/><path d="M2 12h3M19 12h3M8 12c2-3 6 3 8 0"/>'],
    coil: ['Relay / transformer / choke', '<path d="M5 4v16M19 4v16M11 4v16M13 4v16"/><path d="M5 6.5c2.5 0 2.5 3 0 3 2.5 0 2.5 3 0 3 2.5 0 2.5 3 0 3M19 6.5c-2.5 0-2.5 3 0 3-2.5 0-2.5 3 0 3-2.5 0-2.5 3 0 3"/>'],
    magnet: ['Sensor / magnet', '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 7.5h4M14 7.5h4"/>'],
    keypad: ['Switch / keypad', '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 10h5M13 14h5"/>'],
    estop: ['Safety / emergency stop', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2"/>'],
    heart: ['Heart rate', '<path d="M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2c0 5.4 8.8 11 8.8 11s8.8-5.6 8.8-11z"/><path d="M6 11h3l1.5-2.5 2 5 1.5-2.5h4"/>'],
    plug: ['Power / cord', '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>'],
    wire: ['Wiring / connector', '<path d="M2 12h7M15 12h7"/><rect x="9" y="8" width="6" height="8" rx="1"/><path d="M11 10.5v3M13 10.5v3"/>'],
    fan: ['Cooling fan', '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C11 7 12 5 14.5 5.5c1 2.5-.8 4.5-2.5 5M13.4 12.6c3.4 1 4.6 2.9 3.2 4.9-2.6-.1-3.8-2.7-3.2-4.9M10.6 12.8c-2.5 2.5-4.7 2.6-5.6.4 1.6-2 4.4-1.6 5.6-.4"/>'],
    motor: ['Motor / generator', '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10h2.5v4H16M18.5 12H22M7 7v10M10.5 7v10M5 17v2h9v-2"/>'],
    brush: ['Motor brushes', '<rect x="8" y="12" width="8" height="9" rx="1"/><path d="M12 12V9.5l-2.5-1 5-1.5-5-1.5 2.5-1V2"/>'],
    flywheel: ['Flywheel / brake', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>'],
    belt: ['Belt', '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M6 8h12M6 16h12"/><path d="M6 8a4 4 0 0 0 0 8M18 8a4 4 0 0 1 0 8"/>'],
    bearing: ['Bearing', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="5.5" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/><circle cx="5.5" cy="12" r="1.3"/>'],
    bush: ['Bushing / linear bearing', '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M12 1v22M7 8h10M7 16h10"/>'],
    roller: ['Roller', '<path d="M6 8h12M6 16h12"/><ellipse cx="6" cy="12" rx="2" ry="4"/><ellipse cx="18" cy="12" rx="2" ry="4"/><path d="M1.5 12H4M20 12h2.5"/>'],
    deck: ['Deck / sheet', '<path d="M2 15l6-6h14l-6 6z"/><path d="M2 15v2h14l6-6V9M16 15v2"/>'],
    hood: ['Cover / hood / rail', '<path d="M3 17c0-6 4-10 9-10s9 4 9 10z"/><path d="M2 17h20"/>'],
    oil: ['Lubricant', '<path d="M9 3h6v3l2 2v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8l2-2z"/><path d="M12 11c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z"/>'],
    pedal: ['Pedal / crank', '<rect x="10" y="12" width="11" height="5" rx="1.5"/><path d="M4 5l7.5 8.5"/><circle cx="4" cy="5" r="1.8"/>'],
    saddle: ['Seat / saddle', '<path d="M3 9c3-2 8-2 11 0h5a2 2 0 0 1 0 4h-6c-4 0-7 0-10-2z"/><path d="M12 13v8M9 21h6"/>'],
    grip: ['Grip / handle', '<rect x="3" y="9" width="11" height="6" rx="3"/><path d="M14 12h7M7 9v6M10 9v6"/>'],
    knob: ['Knob / potentiometer', '<circle cx="12" cy="13" r="7"/><path d="M12 6v5"/><path d="M12 2v1M4.2 5.2l.8.8M19.8 5.2l-.8.8"/>'],
    sticker: ['Sticker / overlay', '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>'],
    steelcable: ['Steel cable', '<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="5"/><circle cx="11" cy="12" r="2"/><path d="M19 12h3"/>'],
    pulley: ['Pulley', '<circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="1.5"/><path d="M12 1.5V3M6 9v12M18 9v12"/>'],
    hook: ['Snap hook / cable end', '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M6 10l5 4"/>'],
    pin: ['Pin / rod', '<circle cx="6" cy="6" r="3"/><path d="M8.2 8.2L21 21"/>'],
    pad: ['Pad / upholstery', '<rect x="3" y="8" width="18" height="8" rx="3"/><path d="M8 8v8M16 8v8" stroke-dasharray="1.5 2"/>'],
    roll: ['Vinyl / fabric roll', '<circle cx="6" cy="8" r="3"/><path d="M6 5h14v14H6M3 8v8a3 3 0 0 0 3 3"/>'],
    tube: ['Steel tube / profile', '<path d="M3 9l3-3h15l-3 3zM3 9v9h15V9M18 18l3-3V6"/>'],
    nut: ['Bolts / nuts / fixings', '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>'],
    weld: ['Welding', '<path d="M3 21l7-7"/><path d="M10 14l3-3 3 3-3 3z"/><path d="M17 3v3M21 7h-3M19.8 4.2l-2 2M14.5 5.5l1 1"/>'],
    disc: ['Grinding / cutting disc', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M18.4 5.6l-2.1 2.1"/>'],
    bracket: ['Fabrication / bracket', '<path d="M4 4v16h16"/><path d="M4 14h6v6"/><circle cx="7" cy="8" r="1"/><circle cx="16" cy="17" r="1"/>'],
    gear: ['Lathe / machining', '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'],
    spray: ['Spray / paint can', '<rect x="7" y="8" width="9" height="13" rx="1.5"/><path d="M9 8V5h5v3M11 3h2"/><path d="M19 4h.01M21 6.5h.01M19 8h.01"/>'],
    paint: ['Painting / coating', '<rect x="4" y="3" width="14" height="5" rx="1"/><path d="M18 5.5h2v5h-8v3"/><rect x="11" y="13.5" width="2" height="7.5" rx=".5"/>'],
    sparkle: ['Refurbish / clean / polish', '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'],
    code: ['Software / firmware', '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9.5 8.5l-2 2 2 2M14.5 8.5l2 2-2 2M8 21h8M12 17v4"/>'],
    console: ['Console / display', '<rect x="3" y="5" width="18" height="11" rx="2"/><rect x="6" y="8" width="7" height="4" rx=".5"/><path d="M16 8.5h2M16 11.5h2M9 20h6M12 16v4"/>'],
    tiles: ['Rubber flooring / interlocking tiles', '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v3.5a1.5 1.5 0 0 1 0 3V14.5a1.5 1.5 0 0 0 0 3V21M3 12h3.5a1.5 1.5 0 0 1 3 0h5a1.5 1.5 0 0 0 3 0H21"/>'],
    floorroll: ['Rubber roll flooring', '<circle cx="6.5" cy="9" r="3.5"/><circle cx="6.5" cy="9" r="1"/><path d="M6.5 12.5H21v5H6.5a4 4 0 0 1-4-4V9"/>'],
    ramp: ['Edge ramp / trim', '<path d="M2 18h20l-7-7H2z"/><path d="M2 14h16"/>'],
    turf: ['Turf / sled track', '<path d="M2 20h20M5 20c0-4 .8-7 2-9M9 20c0-5-1-8-3-11M12 20c0-5 1-9 3.5-12M16 20c0-4-1-6.5-2.5-8M19.5 20c0-3 .2-5.5 1.5-7.5"/>'],
    part: ['Spare part', '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><path d="M12 22V12M20.7 7L12 12 3.3 7"/>']
  };
  /* ordered rules: first match on the item name wins, then on its category */
  const RULES = [
    [/air bike|fan bike|assault bike/, 'bike'],
    [/edge ramp|\bramp\b|bevel|threshold|transition strip|skirting|wall trim/, 'ramp'],
    [/flooring roll|rubber roll|roll flooring|underlay/, 'floorroll'],
    [/turf|sled track/, 'turf'],
    [/interlock|rubber tile|gym tile|epdm|eva foam mat|flooring|\bfloor\b|deadlift platform|lifting platform/, 'tiles'],
    [/software|firmware|calibration|program/, 'code'],
    [/heart rate|pulse|hr grip|chest strap/, 'heart'],
    [/emergency|safety key|e-stop|estop/, 'estop'],
    [/overlay|sticker|decal|label/, 'sticker'],
    [/console|display|screen|lcd/, 'console'],
    [/lubric|silicone|grease|\boil\b|wax/, 'oil'],
    [/weld/, 'weld'],
    [/lathe|machining|thread/, 'gear'],
    [/linear bearing|bushing|bush\b|spacer|sleeve/, 'bush'],
    [/bearing/, 'bearing'],
    [/belt/, 'belt'],
    [/mcb|motor control board/, 'board'],
    [/capacitor/, 'capacitor'],
    [/brush/, 'brush'],
    [/eddy|resistance magnet|flywheel|brake/, 'flywheel'],
    [/vinyl|leather|fabric/, 'roll'],
    [/grip|handle|handlebar/, 'grip'],
    [/seat pad|back pad|upholster|foam/, 'pad'],
    [/hood|cover|shroud|side rail/, 'hood'],
    [/motor|generator|alternator|actuator/, 'motor'],
    [/board|pcb|inverter|controller|receiver/, 'board'],
    [/igbt|mosfet|transistor|diode|rectifier|\bic\b|regulator|optocoupler|microcontroller|chip|semiconductor/, 'chip'],
    [/resistor|thermistor|varistor|passive/, 'resistor'],
    [/fuse|breaker/, 'fuse'],
    [/relay|inductor|choke|transformer|coil/, 'coil'],
    [/potentiometer|knob/, 'knob'],
    [/sensor|reed|hall|magnet|encoder/, 'magnet'],
    [/keypad|membrane|switch|button/, 'keypad'],
    [/power cord|cord|plug|inlet|socket|power supply/, 'plug'],
    [/harness|wiring|wire|data cable|connector|terminal/, 'wire'],
    [/fan\b/, 'fan'],
    [/functional trainer|crossover|cable column|single cable|lat pull|pulldown/, 'cable'],
    [/steel cable|wire rope|cable \(per|cable replacement/, 'steelcable'],
    [/snap hook|carabiner|cable end|ball stop/, 'hook'],
    [/pulley/, 'pulley'],
    [/stack pin|weight pin|\bpin\b|selector rod|guide rod/, 'pin'],
    [/elastomer|cushion|isolator|roller pad/, 'pad'],
    [/roller|shaft|axle/, 'roller'],
    [/pec deck/, 'stack'],
    [/deck|steel plate|sheet/, 'deck'],
    [/pedal|crank/, 'pedal'],
    [/\bseat\b|saddle/, 'saddle'],
    [/\bpad\b/, 'pad'],
    [/tube|profile/, 'tube'],
    [/bolt|nut\b|nuts|washer|screw|fixing|fastener/, 'nut'],
    [/disc|grinding|cutting/, 'disc'],
    [/bracket|fabricat/, 'bracket'],
    [/spray|primer|rust converter|\(can\)/, 'spray'],
    [/powder|paint|coat/, 'paint'],
    [/polish|clean|sanitis|refurb|rust/, 'sparkle'],
    [/stair|stepper|climber|stepmill/, 'stairs'],
    [/rower|rowing|ski erg|skierg/, 'rower'],
    [/elliptical|cross trainer|\bamt\b|adaptive motion|arc trainer/, 'elliptical'],
    [/treadmill|walking|running/, 'treadmill'],
    [/bike|cycle|spin|recumbent/, 'bike'],
    [/smith|\brack\b|cage|\brig\b|squat/, 'rack'],
    [/bench/, 'bench'],
    [/dumbbell|kettlebell|barbell|free weight/, 'dumbbell'],
    [/plate/, 'plate'],
    [/cable/, 'cable'],
    [/selectori|machine|press|curl|extension|\bfly\b|abductor|adductor|leg|chest|shoulder|strength/, 'stack'],
    [/per hour|hourly|\bhour/, 'clock'],
    [/visit|call-out|callout|transport|relocat|delivery/, 'van'],
    [/diagnos|inspect|fault finding/, 'diag'],
    [/install|assembl|dismantl/, 'box'],
    [/amc|contract|preventive/, 'calendar'],
    [/electronic/, 'board'],
    [/cardio/, 'treadmill']
  ];
  function iconKey(i) {
    if (!i) return 'part';
    if (i.icon && I[i.icon]) return i.icon;
    const name = String(i.name || '').toLowerCase(), cat = String(i.category || '').toLowerCase();
    // services: the machine in the name is the best symbol ("Chest press machine – service & repair")
    for (const [re, k] of RULES) if (re.test(name)) return k;
    for (const [re, k] of RULES) if (re.test(cat)) return k;
    return i.service ? 'wrench' : 'part';
  }
  const svg = (k, size) => `<svg viewBox="0 0 24 24" width="${size || 22}" height="${size || 22}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k][1]}</svg>`;
  window.prodIco = (i, cls) => { const k = iconKey(i); return `<span class="pico${i && i.service ? ' svc' : ''}${cls ? ' ' + cls : ''}" title="${I[k][0]}">${svg(k)}</span>`; };

  const css = document.createElement('style');
  css.textContent = `
    .pico{flex:0 0 40px;width:40px;height:40px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;background:var(--orange-l);color:var(--orange-d);margin-right:2px}
    .pico.svc{background:#e8f0fb;color:#2f6db5}
    .pico.big{flex-basis:56px;width:56px;height:56px;border-radius:15px}
    .pico.big svg{width:32px;height:32px}
    @media (prefers-color-scheme:dark){:root:not([data-theme=light]) .pico.svc{background:#1d2b3d;color:#8ab8ef}}
    :root[data-theme=dark] .pico.svc{background:#1d2b3d;color:#8ab8ef}
    .icogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;margin:4px 0 14px}
    .icogrid button{border:1.5px solid var(--line2);background:var(--card);border-radius:12px;padding:8px 2px 6px;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--text);font-size:9.5px;line-height:1.15;min-height:64px}
    .icogrid button svg{color:var(--orange-d)}
    .icogrid button.on{border-color:var(--orange);background:var(--orange-l)}
    .icogrid button span{max-width:100%;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-align:center}
    .icocur{display:flex;align-items:center;gap:10px;margin:2px 0 8px}`;
  document.head.appendChild(css);

  /* Symbol picker inside Edit item */
  function picker(el, item) {
    const box = el.querySelector('#iIco'); if (!box) return;
    const inp = el.querySelector('[name=icon]');
    const nameIn = el.querySelector('[name=name]'), catIn = el.querySelector('[name=category]');
    let open = false;
    const draw = () => {
      const probe = {name: nameIn.value, category: catIn.value, service: el.querySelector('.seg [data-k=service]').classList.contains('on'), icon: inp.value};
      const auto = iconKey(Object.assign({}, probe, {icon: ''}));
      const cur = iconKey(probe);
      box.innerHTML = `<div class="icocur">${prodIco(probe, 'big')}<div style="flex:1"><b>${I[cur][0]}</b><div class="hint">${inp.value ? 'Chosen by hand' : 'Automatic from name & category'}</div></div><button type="button" class="btn" id="icoTog">${open ? 'Close' : 'Change'}</button></div>
        ${open ? `<div class="icogrid"><button type="button" data-ico="" class="${inp.value ? '' : 'on'}">${svg(auto, 24)}<span>Automatic</span></button>${Object.keys(I).map(k => `<button type="button" data-ico="${k}" class="${inp.value === k ? 'on' : ''}" aria-label="${I[k][0]}">${svg(k, 24)}<span>${I[k][0]}</span></button>`).join('')}</div>` : ''}`;
      box.querySelector('#icoTog').onclick = () => { open = !open; draw(); };
      box.querySelectorAll('[data-ico]').forEach(b => b.onclick = () => { inp.value = b.dataset.ico; open = false; draw(); });
    };
    nameIn.addEventListener('input', () => { if (!inp.value) draw(); });
    catIn.addEventListener('change', draw);
    el.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setTimeout(draw)));
    draw();
  }
  window.FitxIco = {key: iconKey, svg, picker, ICONS: I};
})();
