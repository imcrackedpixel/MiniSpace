// StationEnhance.js - pictures on ships/ore rows and plain-language upgrade descriptions.
// Purely visual: it decorates rows after the game draws them and never changes game logic.
(function () {
  const SHIP_IMG = {
    'mining frigate': 'mining_frigate.png',
    'mining barge': 'mining_barge.png',
    'command ship': 'command_ship.png',
    'carrier': 'carrier.png',
    'mining capital': 'mining_capital.png',
    'combat frigate': 'combat_frigate.png',
    'exploration frigate': 'exploration_frigate.png',
    'improved explorer frigate': 'improved_explorer_frigate.png',
    'explorer cruiser': 'explorer_cruiser.png',
    'siege cruiser': 'siege_cruiser.png',
    'siege battleship': 'siege_battleship.png',
    'siege capital': 'siege_battleship.png'
  };
  const SHIP_KEYS = Object.keys(SHIP_IMG).sort((a, b) => b.length - a.length);
  // Pictures drawn sideways get turned so every ship points up. 90 = turn clockwise, -90 = counter-clockwise.
  // If a ship ends up pointing down, flip its number here (90 <-> -90, or use 180).
  const TURN = {
    'siege battleship': 90,
    'combat frigate': -90
  };
  const DEFAULT_TURN = 90;
  const low = (s) => (s || '').trim().toLowerCase();

  function shipFile(text) {
    const k = low(text);
    for (const n of SHIP_KEYS) if (k.includes(n)) return SHIP_IMG[n];
    return null;
  }

  // Individual inventory illustrations: ores look like mineral chunks and
  // recovered components look like the actual electronic parts.
  function itemIcon(text) {
    const name = low(text);
    const icons = {
      copper: '<path d="M8 29 14 12 27 7 40 17 37 34 22 42 10 38Z" fill="#b87333" stroke="#f0b878" stroke-width="2"/><path d="m14 12 13-5 2 15-19 7Z" fill="#e39a55"/><path d="m29 22 11-5-3 17-15 8Z" fill="#8d4d28"/>',
      steel: '<path d="m8 18 12-10 17 5 5 17-13 12-19-7Z" fill="#87949d" stroke="#d5dde2" stroke-width="2"/><path d="m8 18 12-10 4 18-14 9Z" fill="#c2cbd1"/><path d="m24 26 13-13 5 17-13 12Z" fill="#59656e"/>',
      titanium: '<path d="m7 27 9-17 18-2 9 15-8 17-19 1Z" fill="#7898a8" stroke="#c8e0ec" stroke-width="2"/><path d="m16 10 18-2-4 18-14 1Z" fill="#b3d0dc"/><path d="m30 27 13-4-8 17-19 1Z" fill="#486b7b"/>',
      gold: '<path d="m7 28 8-18 17-3 10 14-7 19-18 2Z" fill="#b88a24" stroke="#ffe08a" stroke-width="2"/><path d="m15 10 17-3-1 19-16 2Z" fill="#ffdf70"/><path d="m31 26 11-5-7 19-18 2Z" fill="#8c6519"/>',
      resistor: '<path d="M4 24h10m20 0h10" stroke="#cbd5dc" stroke-width="2.5" stroke-linecap="round"/><rect x="13" y="16" width="22" height="16" rx="7" fill="#d7b887" stroke="#f4e1bd" stroke-width="1.5"/><path d="M19 17v14m6-14v14m5-14v14" stroke="#8b4c2c" stroke-width="3"/>',
      capacitor: '<path d="M5 24h9m20 0h9" stroke="#cbd5dc" stroke-width="2.5" stroke-linecap="round"/><rect x="14" y="10" width="20" height="28" rx="4" fill="#397b70" stroke="#83d6c2" stroke-width="1.5"/><path d="M14 16h20" stroke="#b6e6d9" stroke-width="2"/><path d="M19 10v28" stroke="#24584f" stroke-width="1.5"/>',
      'circuit board': '<rect x="7" y="8" width="34" height="32" rx="3" fill="#176b4d" stroke="#72d6a4" stroke-width="2"/><path d="M12 14h8v8h9v-5h7M13 34h8v-6h8v7h7M23 14v5m-5 15v-5" fill="none" stroke="#b6df73" stroke-width="2"/><circle cx="12" cy="14" r="2" fill="#e7c76b"/><circle cx="36" cy="17" r="2" fill="#e7c76b"/><circle cx="36" cy="35" r="2" fill="#e7c76b"/>',
      microchip: '<rect x="13" y="13" width="22" height="22" rx="3" fill="#303c48" stroke="#a9bbc8" stroke-width="2"/><path d="M17 8v5m7-5v5m7-5v5M17 35v5m7-5v5m7-5v5M8 17h5m-5 7h5m-5 7h5m22-14h5m-5 7h5m-5 7h5" stroke="#d5b66a" stroke-width="2"/><rect x="19" y="19" width="10" height="10" fill="#6b8fa8"/>',
      processor: '<rect x="12" y="12" width="24" height="24" rx="2" fill="#b88c36" stroke="#ffe19a" stroke-width="2"/><rect x="18" y="18" width="12" height="12" fill="#283b4b" stroke="#d9bd76" stroke-width="1.5"/><path d="M16 6v6m8-6v6m8-6v6M16 36v6m8-6v6m8-6v6M6 16h6m-6 8h6m-6 8h6m24-16h6m-6 8h6m-6 8h6" stroke="#e5c46c" stroke-width="2"/>'
    };
    let key = null;
    if (name.includes('copper')) key = 'copper';
    else if (name.includes('steel')) key = 'steel';
    else if (name.includes('titanium')) key = 'titanium';
    else if (name.includes('gold')) key = 'gold';
    else if (name.includes('resistor')) key = 'resistor';
    else if (name.includes('capacitor')) key = 'capacitor';
    else if (name.includes('circuit board')) key = 'circuit board';
    else if (name.includes('microchip')) key = 'microchip';
    else if (name.includes('processor')) key = 'processor';

    const shape = key ? icons[key] :
      '<path d="m8 29 5-15 14-7 13 12-5 18-17 5Z" fill="#77838d" stroke="#c5d0d8" stroke-width="2"/><path d="m13 14 14-7 1 17-20 5Z" fill="#aebbc4"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' + shape + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // ---------- pictures ----------
  function decoratePics(tbody) {
    tbody.querySelectorAll('tr').forEach((tr) => {
      if (tr.dataset.enh) return;
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      if (tds.length !== 3 || tds.some((t) => t.hasAttribute('colspan'))) return;
      const [name, qty, act] = tds;
      const details = tr.closest('details');
      const group = details && details.querySelector('summary') ? low(details.querySelector('summary').textContent) : '';
      let src = shipFile(name.textContent);
      let ore = false;
      if (!src && (group.startsWith('ore') || group.startsWith('components') || /\/ea/.test(qty.textContent))) {
        src = itemIcon(name.textContent);
        ore = true;
      }
      tr.dataset.enh = '1';
      if (!src) return;
      name.classList.add('c-name'); qty.classList.add('c-qty'); act.classList.add('c-act');
      const pic = document.createElement('td');
      pic.className = 'pic-td';
      const img = document.createElement('img');
      img.className = 'ship-pic' + (ore ? ' ore-pic' : '');
      img.src = src;
      img.alt = '';
      if (!ore) {
        const turn = TURN[SHIP_KEYS.find((n) => src === SHIP_IMG[n])] ;
        const fix = () => {
          if (img.naturalWidth > img.naturalHeight * 1.15) {
            img.style.transform = 'rotate(' + (turn === undefined ? DEFAULT_TURN : turn) + 'deg)';
          }
        };
        if (img.complete && img.naturalWidth) fix(); else img.addEventListener('load', fix);
      }
      pic.appendChild(img);
      tr.insertBefore(pic, tr.firstChild);
      tr.classList.add('has-pic');
    });
  }

  // ---------- upgrade descriptions ----------
  const TITLES = {
    laser: 'Mining laser', dronestether: 'Mining drones', dronetether: 'Carrier drones', shield: 'Shield',
    shieldextender: 'Shield extender', shieldplating: 'Shield plating', cargo: 'Cargo hold', propulsion: 'Engines',
    resistance: 'Damage resistance', guns: 'Guns', missiles: 'Missiles', scrambler: 'Scrambler',
    cloaking: 'Cloak', hacking: 'Relic hacking'
  };
  const MINE = { // ore per second at level 1, and gained per level
    'Mining Frigate': [9, 3], 'Mining Barge': [33, 10.8], 'Mining Capital': [360, 90]
  };
  const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString();

  function describe(mod, cls, lvl, atMax) {
    const next = (f) => (atMax ? '' : ' → ' + f(lvl + 1));
    const now = (f) => f(lvl) + next(f);
    switch (mod) {
      case 'laser': {
        const m = MINE[cls];
        return m ? 'Mines ' + now((l) => fmt(m[0] + (l - 1) * m[1])) + ' ore per second.' : 'Mines more ore per second.';
      }
      case 'dronestether':
        return cls === 'Command Ship' ? 'Mining drones collect ' + now((l) => fmt(150 + (l - 1) * 48)) + ' ore per second.' : 'Drones mine more ore per second.';
      case 'dronetether':
        return 'Raises the missile damage of the drones your Carrier launches.';
      case 'missiles':
        return cls === 'Combat Frigate' ? 'Each missile hits for ' + now((l) => 15 + (l - 1) * 8) + ' damage.' : 'Missiles hit harder.';
      case 'propulsion': {
        let sp = Infinity;
        try { sp = window.speedAtLevel ? window.speedAtLevel(cls, lvl) : Infinity; } catch (e) {}
        if (isFinite(sp)) {
          return 'Top speed ' + now((l) => fmt(window.speedAtLevel(cls, l))) + '.';
        }
        return 'Raises top speed.';
      }
      case 'cargo':
        return 'Bigger cargo hold, so you can carry more ore per trip.';
      case 'shield': case 'shieldextender': case 'shieldplating': {
        let t = 'Shield recharges faster out of combat (+15% per level).';
        if (/siege/i.test(cls)) t += ' Also recharges during combat at ' + now((l) => (30 + 5 * (l - 1)) + '%') + ' of that rate.';
        return t;
      }
      case 'resistance':
        return cls === 'Carrier' ? 'Reduces damage taken by about 15% plus 2% per level (max 80%).' : 'Reduces damage taken.';
      case 'guns':
        return cls === 'Siege Capital' ? 'Gun damage +2.5% per level.' : 'Guns deal more damage.';
      case 'scrambler':
        return 'Makes your scrambler stronger against enemy ships.';
      case 'cloaking':
        return 'Improves your cloak.';
      case 'hacking':
        return 'Hacks relics faster.';
      default:
        return '';
    }
  }

  function decorateUpgrades(tbody) {
    const cls = (window.playerShip && window.playerShip.className) || '';
    tbody.querySelectorAll('tr').forEach((tr) => {
      if (tr.dataset.enh) return;
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      if (tds.length !== 3) return;
      const mod = low(tds[0].textContent);
      const m = /lv\.\s*(\d+)(?:\s*\/\s*(\d+))?/i.exec(tds[1].textContent);
      if (!m) return;
      const lvl = parseInt(m[1], 10);
      const cap = m[2] ? parseInt(m[2], 10) : 5;
      const text = describe(mod, cls, lvl, lvl >= cap);
      tr.dataset.enh = '1';
      tds[0].textContent = TITLES[mod] || tds[0].textContent;
      if (text) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = text;
        tds[0].appendChild(sub);
      }
    });
  }

  function watch(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    fn(el);
    new MutationObserver(() => fn(el)).observe(el, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    watch('items-hanger-list', decoratePics);
    watch('market-list', decoratePics);
    watch('upgrades-list', decorateUpgrades);
  });
})();
