// HudValues.js - Numerical HUD values, Siege Cruiser in the hangar and Market, and HP / mining rate / DPS next to hangar ship names.
// Load in Index.html AFTER MainGameController.js (the line <script src="HudValues.js"></script> just before </body>).

// ===== HUD numbers: shield / armor / structure values on the bars =====
(function () {
  const ROWS = [
    { fill: 'shield-fill', key: 'shield', max: 'maxShield', label: 'hud-shield-val' },
    { fill: 'armor-fill', key: 'armor', max: 'maxArmor', label: 'hud-armor-val' },
    { fill: 'structure-fill', key: 'structure', max: 'maxStructure', label: 'hud-structure-val' }
  ];

  // Creates one value label per bar, placed at the end of its row (once)
  function ensureLabels() {
    for (const r of ROWS) {
      if (document.getElementById(r.label)) continue;
      const fill = document.getElementById(r.fill);
      if (!fill) continue;
      const row = fill.parentElement && fill.parentElement.parentElement;
      if (!row) continue;
      const span = document.createElement('span');
      span.id = r.label;
      span.style.cssText = 'font-size: 8px; color: #c9d1d9; white-space: nowrap; margin-left: 4px; min-width: 88px; text-align: right;';
      row.appendChild(span);
    }
  }

  function tick() {
    const s = window.playerShip;
    if (!s) return;
    ensureLabels();
    for (const r of ROWS) {
      const el = document.getElementById(r.label);
      if (!el) continue;
      const v = Math.max(0, Math.floor(s[r.key] || 0));
      const m = Math.floor(s[r.max] || 0);
      el.textContent = v.toLocaleString() + ' / ' + m.toLocaleString();
    }
  }

  setInterval(tick, 200);
  tick();
})();

// ===== Siege Cruiser: hangar Combat Ships group (the Market lists it from MainGameController.js) =====
(function () {
  const SHIP = 'Siege Cruiser';
  const CARGO = 400;
  const SPEED = 2.6;

  function isOwned() {
    const unlocked = typeof playerData !== 'undefined' && playerData && playerData.unlockedShips && playerData.unlockedShips.siegeCruiser;
    const flying = window.playerShip && window.playerShip.className === SHIP;
    return !!(unlocked || flying);
  }

  // Adds the Siege Cruiser row to the Combat Ships group in the hangar, once the player owns it
  function addHangarRow() {
    if (!isOwned()) return;
    const list = document.getElementById('items-hanger-list');
    if (!list || list.querySelector('[data-siege-row]')) return;

    let table = null;
    list.querySelectorAll('summary').forEach(function (s) {
      if (s.textContent.indexOf('COMBAT SHIPS') === 0) table = s.parentElement.querySelector('table');
    });
    if (!table) return;

    const body = table.tBodies[0] || table;
    // Remove the "None" placeholder row if the group was empty
    body.querySelectorAll('td[colspan]').forEach(function (td) {
      if (td.textContent.trim() === 'None') td.parentElement.remove();
    });

    const aboard = window.playerShip && window.playerShip.className === SHIP;
    const action = aboard
      ? '<span style="color:#8b949e;">Aboard</span>'
      : '<button onclick="window.boardShip(\'' + SHIP + '\', ' + CARGO + ', ' + SPEED + ')">Board</button>';
    const tr = document.createElement('tr');
    tr.setAttribute('data-siege-row', '1');
    tr.innerHTML = '<td>SIEGE CRUISER</td><td>1</td><td>' + action + '</td>';
    body.appendChild(tr);

    // Bump the group's count in its heading
    const summary = table.parentElement.querySelector('summary');
    if (summary) {
      summary.textContent = summary.textContent.replace(/\((\d+)\)/, function (m, n) {
        return '(' + (parseInt(n, 10) + 1) + ')';
      });
    }
  }

  // Runs `after` each time the original function `name` runs
  function wrap(name, after, flag) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig[flag]) return false;
    const f = function () {
      const r = orig.apply(this, arguments);
      try { after(); } catch (e) { console.error('HUD extras:', e); }
      return r;
    };
    f[flag] = true;
    window[name] = f;
    return true;
  }

  wrap('updateStationUI', addHangarRow, '_siegeWrapped');
})();

// ===== HP, mining rate and DPS next to ship names in the hangar =====
(function () {
  // Saved module level for a ship (1 if none)
  function level(cls, key) {
    const saved = (typeof playerData !== 'undefined' && playerData && playerData.upgrades && playerData.upgrades[cls]) || null;
    return Math.max(1, Number(saved && saved[key]) || 1);
  }

  function fmt(n) { return Math.round(n).toLocaleString(); }

  // ---- Mining rate, ore per second (per-frame values from the ship code x 60) ----
  function mineRate(cls) {
    if (cls === 'Mining Frigate') return (0.15 + (level(cls, 'laser') - 1) * 0.05) * 60;
    if (cls === 'Mining Barge') return (0.55 + (level(cls, 'laser') - 1) * 0.18) * 60;
    if (cls === 'Command Ship') return (2.5 + (level(cls, 'dronesTether') - 1) * 0.8) * 60;
    if (cls === 'Mining Capital') return (6 + (level(cls, 'laser') - 1) * 1.5) * 60;
    return null;
  }

  // ---- DPS (averages, assuming every shot lands, as in the Siege Capital notes) ----
  // Carrier drones (6 Combat Frigates) fire missiles; the tether level sets the missile level
  function carrierDps(tether) {
    const missileLevel = Math.min(4, tether * 1.5);
    return 6 * 0.13 * 60 * (15 + (missileLevel - 1) * 8);
  }

  // Siege Cruiser: 6 guns, each 30 damage x 80% hit chance, one shot per second
  function siegeCruiserDps() {
    const S = window.SiegeCruiser;
    if (!S || !S.CFG || !S.UPGRADE) return null;
    const dmg = S.CFG.damage * (1 + S.UPGRADE.guns * (level('Siege Cruiser', 'guns') - 1));
    return dmg * S.CFG.hitChance * 60 / S.CFG.cooldown * 6;
  }

  // Explorer beam: 58.5 DPS per beam, the Explorer Cruiser has two. Only fires while the ship is being shot.
  const BEAM_DPS = 0.5 * 0.13 * 60 * 15;

  function rateText(cls) {
    const m = mineRate(cls);
    if (m !== null) return 'MINE ' + fmt(m) + '/s' + (cls === 'Mining Capital' ? ' (anchored)' : '');

    if (cls === 'Combat Frigate') {
      const missileDmg = 15 + (level(cls, 'missiles') - 1) * 8;
      return 'DPS ' + fmt(0.13 * 60 * missileDmg);
    }
    if (cls === 'Carrier') return 'DPS ' + fmt(carrierDps(level(cls, 'droneTether')));
    if (cls === 'Siege Capital') {
      const C = window.SiegeCapital && window.SiegeCapital.CFG;
      const gunBonus = 1 + 0.025 * (level(cls, 'guns') - 1);
      const base = carrierDps(level('Carrier', 'droneTether')) * gunBonus;
      const capMult = C ? C.capitalMultiplier : 1;
      const otherMult = C ? C.otherMultiplier : 0.5;
      return 'DPS ' + fmt(base * capMult) + ' cap / ' + fmt(base * otherMult) + ' other';
    }
    if (cls === 'Siege Cruiser') {
      const d = siegeCruiserDps();
      return d === null ? 'DPS ?' : 'DPS ' + fmt(d);
    }
    if (cls === 'Explorer Cruiser') return 'DPS ' + fmt(BEAM_DPS * 2) + ' when shot';
    if (cls === 'Improved Explorer Frigate') return 'DPS ' + fmt(BEAM_DPS) + ' when shot';
    return null; // Exploration Frigate has no mining or weapon
  }

  // ---- HP: base shield + armor + structure, read from a throwaway instance of each hull ----
  let hpCache = null;
  function hullHp() {
    if (hpCache) return hpCache;
    const makers = {
      'Mining Frigate': typeof MiningFrigate !== 'undefined' ? function () { return new MiningFrigate(0, 0); } : null,
      'Mining Barge': typeof MiningBarge !== 'undefined' ? function () { return new MiningBarge(0, 0); } : null,
      'Command Ship': typeof CommandShip !== 'undefined' ? function () { return new CommandShip(0, 0); } : null,
      'Mining Capital': typeof CapitalShip !== 'undefined' ? function () { return new CapitalShip(0, 0); } : null,
      'Carrier': typeof Carrier !== 'undefined' ? function () { return new Carrier(0, 0); } : null,
      'Combat Frigate': typeof CombatFrigate !== 'undefined' ? function () { return new CombatFrigate(0, 0); } : null,
      'Exploration Frigate': typeof ExplorationFrigate !== 'undefined' ? function () { return new ExplorationFrigate(0, 0); } : null,
      'Improved Explorer Frigate': typeof ExplorationFrigate !== 'undefined' ? function () { return new ExplorationFrigate(0, 0, true); } : null,
      'Explorer Cruiser': typeof ExplorerCruiser !== 'undefined' ? function () { return new ExplorerCruiser(0, 0); } : null,
      'Siege Cruiser': window.SiegeCruiserShip ? function () { return new window.SiegeCruiserShip(0, 0); } : null,
      'Siege Capital': window.SiegeCapitalShip ? function () { return new window.SiegeCapitalShip(0, 0); } : null
    };
    const out = {};
    for (const name in makers) {
      if (!makers[name]) continue;
      try {
        const s = makers[name]();
        out[name] = (s.maxShield || 0) + (s.maxArmor || 0) + (s.maxStructure || 0);
      } catch (e) {
        console.error('HP probe failed for ' + name, e);
      }
    }
    hpCache = out;
    return out;
  }

  // Adds "HP x | MINE / DPS" after each hull name in the hangar
  function annotateHangar() {
    const list = document.getElementById('items-hanger-list');
    if (!list) return;
    const hp = hullHp();

    // Upper-case hangar label -> class name
    const byLabel = {};
    for (const name in hp) byLabel[name.toUpperCase()] = name;

    list.querySelectorAll('tr').forEach(function (tr) {
      const td = tr.querySelector('td');
      if (!td || td.hasAttribute('data-hpdps') || td.getAttribute('colspan')) return;

      const label = td.textContent.replace(/\s*\(HULL\)\s*$/, '').trim();
      const cls = byLabel[label];
      if (!cls) return;

      const parts = ['HP ' + fmt(hp[cls])];
      const rate = rateText(cls);
      if (rate) parts.push(rate);

      const tag = document.createElement('div');
      tag.style.cssText = 'color: #8b949e; font-size: 8px; margin-top: 2px; white-space: normal; line-height: 1.3;';
      tag.textContent = parts.join(' | ');
      td.appendChild(tag);
      td.setAttribute('data-hpdps', '1');
    });
  }

  function wrap(name, after, flag) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig[flag]) return false;
    const f = function () {
      const r = orig.apply(this, arguments);
      try { after(); } catch (e) { console.error('HP/DPS labels:', e); }
      return r;
    };
    f[flag] = true;
    window[name] = f;
    return true;
  }

  // Runs after the Siege Cruiser wrapper, so the new row gets its labels too
  wrap('updateStationUI', annotateHangar, '_hpWrapped');
  if (typeof window.updateStationUI === 'function') window.updateStationUI();
})();
