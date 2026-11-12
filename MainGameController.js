// MainGameController.js - Unified Game Loop & State Manager (complete)
var playerShip = null;
var mainStation = null;
var asteroidBelt = null;
var debrisField = null;
var botManager = null;
var stationMarket = null;
var autoplayManager = null;
var backgroundDecor = null;

var publicNpcManager = new PublicNpcManager();
var mapManager = new MapManager();
var sessionManager = new SessionManager();
var missionManager = new MissionManager();

var WORLD_SIZE = 5000;
var PUBLIC_SIZE = 9000;
const itemPrices = ITEM_PRICES;

// Names shown to the player. The internal ids (veldspar, debris_t3...) stay the same so saves and other scripts keep working.
const GAME_ITEM_LABELS = {
  veldspar: 'Copper', scordite: 'Steel', pyroxeres: 'Titanium', omber: 'Gold',
  debris_t1: 'Resistor', debris_t2: 'Capacitor', debris_t3: 'Circuit Board', debris_t4: 'Microchip', debris_t5: 'Processor'
};
function itemLabel(key) { return GAME_ITEM_LABELS[key] || String(key).toUpperCase().replace(/_/g, ' '); }

// Cargo is tracked per actual in-game item. `cargo` remains the total for capacity/UI compatibility.
function ensureOreCargo(ship) {
  if (!ship) return {};
  if (!ship.cargoByOre || typeof ship.cargoByOre !== 'object') {
    ship.cargoByOre = {};
    const legacyAmount = Math.max(0, Number(ship.cargo) || 0);
    if (legacyAmount > 0) {
      const legacyKey = ship.oreType && Object.prototype.hasOwnProperty.call(GAME_ITEM_LABELS, ship.oreType)
        ? ship.oreType : (isExplorerClass(ship.className) ? 'debris_t1' : 'veldspar');
      ship.cargoByOre[legacyKey] = legacyAmount;
    }
  }
  return ship.cargoByOre;
}
function addOreToCargo(ship, key, amount) {
  if (!ship || !(amount > 0)) return 0;
  key = Object.prototype.hasOwnProperty.call(GAME_ITEM_LABELS, key) ? key : 'veldspar';
  const cargoMap = ensureOreCargo(ship);
  const room = Math.max(0, (Number(ship.maxCargo) || Infinity) - (Number(ship.cargo) || 0));
  const added = Math.min(Number(amount) || 0, room);
  if (added > 0) {
    cargoMap[key] = (Number(cargoMap[key]) || 0) + added;
    ship.cargo = (Number(ship.cargo) || 0) + added;
    ship.oreType = key;
  }
  return added;
}
function removeOreFromCargo(ship, key, amount) {
  if (!ship || !(amount > 0)) return 0;
  const cargoMap = ensureOreCargo(ship);
  const available = Math.max(0, Number(cargoMap[key]) || 0);
  const removed = Math.min(available, Number(amount) || 0);
  if (removed > 0) {
    cargoMap[key] = available - removed;
    if (cargoMap[key] <= 0) delete cargoMap[key];
    ship.cargo = Math.max(0, (Number(ship.cargo) || 0) - removed);
  }
  return removed;
}
window.ensureOreCargo = ensureOreCargo;
window.addOreToCargo = addOreToCargo;
window.removeOreFromCargo = removeOreFromCargo;

// Short Scrap Metals format: 1.5m, 2.25b, 3t. Amounts under a million show in full.
function fmtISK(n) {
  n = Math.floor(Number(n) || 0);
  const units = [[1e12, 't'], [1e9, 'b'], [1e6, 'm']];
  for (const [v, suffix] of units) {
    if (Math.abs(n) >= v) {
      let x = (n / v).toFixed(2);
      if (x.indexOf('.') >= 0) x = x.replace(/\.?0+$/, '');
      return x + suffix;
    }
  }
  return n.toLocaleString();
}

// ===== TUNING =====
const EXTRACTION_SECONDS = 10;
const LOOT = {
  debrisIsk: 1000000,   // worth of T3-T5 debris added to hangar per station kill
  explorerChance: 0.05, // Improved Explorer Frigate Design blueprint chance
  chipChance: 0.05      // Item Level Chip chance (5%)
};
const CHIP_CAP_BONUS = 1; // each item level chip raises one random module's max level by this
window.STAT_CAPS = {
  combatFrigateSpeed: 10.0,  // Combat Frigate max speed (base 5.2)
  explorerSpeed: 9.0,        // Exploration and Improved Explorer max speed (base 6.0)
  carrierSpeed: 3.0,         // Carrier max speed (base 1.65)
  commandSpeed: 6.0,         // Command Ship max speed (base 3.0)
  carrierResistance: 0.8     // Carrier damage reduction, as a fraction (80%)
};

function isExplorerClass(cls) { return cls === 'Exploration Frigate' || cls === 'Improved Explorer Frigate' || cls === 'Explorer Cruiser'; }

const DESIGNS = {
  explorer: {
    label: 'Improved Explorer Frigate Design', hull: 'Improved Explorer Frigate', cargo: 150, speed: 6.0,
    cost: { isk: 5000000, items: 5000000 },   // Scrap Metals plus ore/debris worth (sell price)
    bonus: {}, hangar: true   // built hulls stay in the hangar until destroyed
  },
  cruiser: {
    label: 'Explorer Cruiser Design', hull: 'Explorer Cruiser', cargo: 600, speed: 4.5,
    cost: { isk: 10000000, items: 10000000 },   // double the Improved Explorer's build cost
    bonus: {}, hangar: true   // built hulls stay in the hangar until destroyed
  }
};

let playerData = {
  pilotName: '',
  isk: 0,
  stationOre: { veldspar: 0, scordite: 0, pyroxeres: 0, omber: 0, debris_t1: 0, debris_t2: 0, debris_t3: 0, debris_t4: 0, debris_t5: 0 },
  upgrades: {},
  shipsOwned: ['Mining Frigate'],
  unlockedShips: { barge: false, command: false, capital: false, carrier: false, combatFrigate: false, explorationFrigate: false },
  corpMembersPurchased: 0,
  explorationCorpPurchased: 0,
  transportManagerPurchased: 0,
  designs: { explorer: 0 },   // blueprints in hangar
  hullDesigns: {},                      // hull className -> design key built on it
  builtHulls: {},                       // hull className -> true once a blueprint built it (stays in hangar)
  chips: 0,                             // item level chips in hangar
  moduleBonusCap: {},                    // className -> module -> extra max levels
  progression: { xp: 0, level: 1, skillPoints: 0, spent: { combat: {}, mining: {} } }
};

mainStation = new SpaceStation(WORLD_SIZE / 2, 700, 'Private High-Sec 1.0'); // top middle of the High-Sec map
asteroidBelt = new AsteroidBelt(2500, 3800, 150, WORLD_SIZE);
asteroidBelt.generate(150, ['veldspar', 'scordite']);
debrisField = new DebrisField(2500, 3800, 3, WORLD_SIZE);
botManager = new BotManager(playerData, mainStation, asteroidBelt, debrisField);
stationMarket = new StationMarket(playerData, 'Private Station Market');
backgroundDecor = new BackgroundDecor(2400, 1600);

playerShip = new MiningFrigate(mainStation.x + 250, mainStation.y + 250);
playerShip.docked = false;
playerShip.className = 'Mining Frigate';

autoplayManager = new AutoplayManager(playerData, mainStation, asteroidBelt, debrisField);

window.showCorpNotification = function(msg) {
  // Filter out repetitive explorer scan messages to stop notification spam
  if (msg && (msg.includes('Relic scanned') || msg.includes('Relic scan failed'))) {
    return;
  }

  let note = document.getElementById('corp-notification');
  if (note) {
    note.innerText = msg;
    note.style.display = 'block';
    clearTimeout(window._noteTimer);
    window._noteTimer = setTimeout(function() { note.style.display = 'none'; }, 4000);
  }
};

function inPublicSpace() { return mapManager && mapManager.currentMapId === 'public_space'; }
function inMissionSpace() { return !!(mapManager && String(mapManager.currentMapId).indexOf('mission_') === 0); }
function autoplayIsOn() { return !!(autoplayManager && autoplayManager.isAutoplay); }
function balancedShips() {
  const list = [playerShip];
  if (botManager && botManager.bots) botManager.bots.forEach(b => list.push(b.ship));
  if (publicNpcManager && publicNpcManager.publicNpcMiners) publicNpcManager.publicNpcMiners.forEach(n => list.push(n.ship));
  return list.filter(Boolean);
}
function currentWorldSize() { return inPublicSpace() ? PUBLIC_SIZE : (inMissionSpace() ? 7000 : WORLD_SIZE); }

const MODULE_KEYS = {
  'Mining Frigate':      ['laser', 'shield', 'cargo', 'propulsion'],
  'Mining Barge':        ['laser', 'shield', 'cargo', 'propulsion'],
  'Command Ship':        ['dronesTether', 'shield', 'cargo', 'propulsion'],
  'Mining Capital':      ['laser', 'shield', 'cargo', 'propulsion'],
  'Siege Capital':       ['guns', 'shieldPlating', 'propulsion', 'resistance'],
  'Siege Cruiser':       ['guns', 'shield', 'resistance', 'shieldRecharge'],
  'Siege Battleship':    ['missiles', 'shield', 'propulsion'],
  'Carrier':             ['droneTether', 'shieldExtender', 'resistance', 'propulsion'],
  'Combat Frigate':      ['missiles', 'shield', 'scrambler', 'propulsion'],
  'Exploration Frigate': ['cloaking', 'hacking', 'propulsion', 'cargo'],
  'Improved Explorer Frigate': ['cloaking', 'hacking', 'propulsion', 'cargo'],
  'Explorer Cruiser':    ['cloaking', 'hacking', 'propulsion', 'cargo']
};

function getBonusCap(cls, mod) {
  const m = playerData.moduleBonusCap && playerData.moduleBonusCap[cls];
  return (m && m[mod]) || 0;
}
const MAX_MODULE_LEVEL = 20;
function getCap(mod, cls) {
  const c = cls || (playerShip && playerShip.className) || '';
  return Math.min(MAX_MODULE_LEVEL, 5 + getBonusCap(c, mod));
}

function cleanModules(ship) {
  if (!ship || !ship.moduleLevels) return;
  const keys = MODULE_KEYS[ship.className];
  if (!keys) return;
  for (const k of Object.keys(ship.moduleLevels)) {
    if (!keys.includes(k)) delete ship.moduleLevels[k];
  }
  for (const k of keys) {
    const v = Number(ship.moduleLevels[k]);
    const cap = getCap(k, ship.className);
    ship.moduleLevels[k] = (v >= 1 && v <= cap) ? v : 1;
  }
}

function applyDesign(ship) {
  if (!ship) return;
  if (window.Races) window.Races.tag(ship);
  if (typeof ship.applyStats === 'function') ship.applyStats();
  const key = playerData.hullDesigns ? playerData.hullDesigns[ship.className] : null;
  const d = key ? DESIGNS[key] : null;
  if (!d || ship.className !== d.hull) return;
  if (d.bonus.cargo) ship.maxCargo = (ship.maxCargo || 0) * d.bonus.cargo;
  if (d.bonus.speed) ship.maxSpeed = (ship.maxSpeed || 0) * d.bonus.speed;
  if (d.bonus.shield) {
    ship.maxShield = (ship.maxShield || 0) * d.bonus.shield;
    ship.shield = ship.maxShield;
  }
}

function normalizeWrecks() {
  if (!debrisField || !debrisField.entities) return;
  const colors = ['#8b949e', '#58a6ff', '#3fb950', '#d29922', '#f85149'];
  for (const e of debrisField.entities) {
    if (e.vertices) continue;
    const r = e.radius || 40;
    const pts = 7;
    e.vertices = [];
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const vr = r * (0.6 + Math.random() * 0.8);
      e.vertices.push({ x: Math.cos(a) * vr, y: Math.sin(a) * vr });
    }
    const tier = parseInt(String(e.oreType || '').replace('debris_t', ''), 10) || 1;
    e.tier = e.tier || tier;
    e.color = e.color || colors[Math.min(4, Math.max(0, e.tier - 1))];
    e.name = e.name || (itemLabel('debris_t' + e.tier) + ' Scrap');
    e.rotation = Math.random() * Math.PI * 2;
    e.rotSpeed = (Math.random() - 0.5) * 0.002;
    e.maxYield = e.maxYield || e.oreYield;
  }
}

function isNearGate(e) {
  if (!e) return false;
  if (!inPublicSpace()) {
    const g = mapManager ? mapManager.publicGate : null;
    if (!g) return false;
    return Math.hypot(e.x - g.x, e.y - g.y) < g.radius + 220 + (e.radius || 0);
  } else {
    if (!mapManager || !mapManager.playerGates) return false;
    for (let gate of mapManager.playerGates) {
      if (gate && Math.hypot(e.x - gate.x, e.y - gate.y) < gate.radius + 220 + (e.radius || 0)) return true;
    }
    return false;
  }
}

function nearestIn(list, x, y, maxD) {
  if (!list) return null;
  let best = null, bd = maxD;
  for (const e of list) {
    if (!e || !(e.oreYield > 0) || isNearGate(e)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function snapshotCorp() {
  if (botManager && botManager.bots) {
    playerData.corpBots = botManager.bots.map(function(b) {
      return {
        className: b.className, hauls: b.hauls || 0,
        haulProgress: b.haulProgress || 0,
        wallet: b.wallet || 0, stock: b.stock || {},
        cargoContrib: Object.values((b.ship && b.ship.cargoContrib) || {}).map(function(c) {
          return { sourceIndex: c.bot ? botManager.bots.indexOf(c.bot) : -1, ore: Object.assign({}, c.ore || {}), haulSize: c.haulSize || 0 };
        }),
        hasCruiserBlueprint: !!b.hasCruiserBlueprint, cruiserBuilt: !!b.cruiserBuilt
      };
    });
  }
}

function saveGameSession() {
  snapshotCorp();
  if (missionManager) playerData.activeMission = missionManager.activeMission ? Object.assign({}, missionManager.activeMission, { fleet: [] }) : null;
  if (playerShip && playerShip.moduleLevels) {
    cleanModules(playerShip);
    if (!playerData.progression) playerData.progression = { xp: 0, level: 1, skillPoints: 0, spent: { combat: {}, mining: {} } };
  if (!playerData.progression.spent) playerData.progression.spent = { combat: {}, mining: {} };
  if (!playerData.progression.spent.combat) playerData.progression.spent.combat = {};
  if (!playerData.progression.spent.mining) playerData.progression.spent.mining = {};
  if (!playerData.upgrades) playerData.upgrades = {};
    playerData.upgrades[playerShip.className] = Object.assign({}, playerShip.moduleLevels);
  }
  sessionManager.save(playerData, playerShip);
}

function loadGameSession() {
  playerShip = sessionManager.load(playerData, botManager, playerShip);
  if (!playerData.upgrades) playerData.upgrades = {};
  if (!playerData.designs) playerData.designs = {};
  if (typeof playerData.designs.explorer !== 'number') playerData.designs.explorer = 0;
  if (typeof playerData.designs.cruiser !== 'number') playerData.designs.cruiser = 0;
  // Siege Capital was removed; discard any obsolete blueprint count from older saves.
  delete playerData.designs.siege;
  if (typeof playerData.chips !== 'number') playerData.chips = 0;
  if (playerData.activeMission && !missionManager.activeMission) {
    missionManager.activeMission = Object.assign({}, playerData.activeMission, { spawnedFleet: false, fleet: [] });
  }
  if (missionManager.activeMission && mapManager && mapManager.missionEntryGate) {
    mapManager.missionEntryGate.destinationName = missionManager.activeMission.systemName || '';
  }
  if (!playerData.hullDesigns) playerData.hullDesigns = {};
  if (!playerData.builtHulls) playerData.builtHulls = {};
  if (!playerData.moduleBonusCap) playerData.moduleBonusCap = {};
  if (typeof playerData.transportManagerPurchased !== 'number') playerData.transportManagerPurchased = 0;
  if (botManager && Array.isArray(playerData.corpBots) && playerData.corpBots.length === botManager.bots.length) {
    botManager.bots.forEach(function(b, i) {
      const saved = playerData.corpBots[i];
      if (saved && saved.className && saved.className !== b.className) {
        b.ship = botManager.createShip(saved.className, b.ship.x, b.ship.y);
        b.className = saved.className;
      }
      if (b.ship) b.ship.corpBot = b;
      b.hauls = saved ? saved.hauls || 0 : 0;
      b.haulProgress = saved ? Math.max(0, Number(saved.haulProgress) || 0) : 0;
      if (saved) {
        b.wallet = saved.wallet || 0;
        b.stock = saved.stock || {};
        b.hasCruiserBlueprint = !!saved.hasCruiserBlueprint;
        b.cruiserBuilt = !!saved.cruiserBuilt;
      }
    });
  }
  if (playerShip) {
    if (playerShip.className === 'Combat Frigate') playerShip.noOrbitWhileFiring = true;
    const saved = playerData.upgrades[playerShip.className];
    if (saved && playerShip.moduleLevels) {
      Object.assign(playerShip.moduleLevels, saved);
    }
    cleanModules(playerShip);
    applyDesign(playerShip);
    applyPilotTalents();
    playerShip.docked = false;
  }
}

window.addEventListener('beforeunload', function() {
  saveGameSession();
});

function speedAtLevel(cls, lvl) {
  const caps = window.STAT_CAPS;
  if (cls === 'Combat Frigate') return Math.min(caps.combatFrigateSpeed, 5.2 + (lvl - 1) * 0.6);
  if (cls === 'Explorer Cruiser') return Math.min(caps.explorerSpeed, 4.5 * (1 + (lvl - 1) * 0.025));
  if (cls === 'Carrier') return Math.min(caps.carrierSpeed, 1.65 + (lvl - 1) * 0.15);
  if (cls === 'Command Ship') return Math.min(caps.commandSpeed, 3.0 + (lvl - 1) * 0.3);
  if (isExplorerClass(cls)) {
    const s = 6.0 * (1 + (lvl - 1) * 0.025) * (cls === 'Improved Explorer Frigate' ? 1.1 : 1);
    return Math.min(caps.explorerSpeed, s);
  }
  return Infinity;
}

function chipUseful(cls, mod) {
  const cap = getCap(mod, cls);
  if (cap >= MAX_MODULE_LEVEL) return false;
  if (cls === 'Carrier' && mod === 'resistance') {
    const tetherCap = getCap('droneTether', cls);
    const res = 0.15 + (cap - 1) * 0.02 + 0.05 * Math.max(0, tetherCap - 3);
    return res < window.STAT_CAPS.carrierResistance;
  }
  if (mod === 'propulsion') {
    const s = speedAtLevel(cls, cap);
    if (!isFinite(s)) return true;
    return s < speedAtLevel(cls, 1e6);
  }
  return true;
}

function autoUseChip() {
  const options = [];
  for (const c of Object.keys(MODULE_KEYS)) {
    for (const m of MODULE_KEYS[c]) if (chipUseful(c, m)) options.push({ cls: c, mod: m });
  }
  if (options.length === 0) return null;
  const pick = options[Math.floor(Math.random() * options.length)];
  const cls = pick.cls;
  const mod = pick.mod;
  if (!playerData.moduleBonusCap) playerData.moduleBonusCap = {};
  if (!playerData.moduleBonusCap[cls]) playerData.moduleBonusCap[cls] = {};
  playerData.moduleBonusCap[cls][mod] = getBonusCap(cls, mod) + CHIP_CAP_BONUS;
  return { cls: cls, mod: mod, cap: getCap(mod, cls) };
}

function rewardBossKill() {
  const tiers = ['debris_t3', 'debris_t4', 'debris_t5'];
  let remaining = LOOT.debrisIsk;
  let itemsGained = [];

  while (remaining > 0) {
    const key = tiers[Math.floor(Math.random() * tiers.length)];
    const price = itemPrices[key];
    const chunk = Math.min(remaining, 60000 + Math.random() * 90000);
    const qty = Math.max(1, Math.ceil(chunk / price));
    const value = Math.min(remaining, qty * price);
    playerData.stationOre[key] = (playerData.stationOre[key] || 0) + qty;
    remaining -= value;
    itemsGained.push({ label: itemLabel(key), qty: qty });
  }

  const aggregated = {};
  itemsGained.forEach(item => {
    aggregated[item.label] = (aggregated[item.label] || 0) + item.qty;
  });

  const lootSummary = [];
  for (const label in aggregated) {
    lootSummary.push(aggregated[label].toLocaleString() + 'x ' + label);
  }

  const result = {
    textParts: lootSummary,
    blueprints: [],
    chips: []
  };

  if (Math.random() < LOOT.explorerChance) {
    playerData.designs.explorer = (playerData.designs.explorer || 0) + 1;
    result.blueprints.push('IMPROVED EXPLORER DESIGN');
  }
  if (Math.random() < LOOT.chipChance) {
    const used = autoUseChip();
    if (used) {
      result.chips.push('ITEM LEVEL CHIP (' + used.mod.toUpperCase() + ' max Lv. ' + used.cap + ' on ' + used.cls + ')');
    } else {
      result.chips.push('ITEM LEVEL CHIP (no module can be improved further)');
    }
  }

  return result;
}

function showExtractionLootModal(lootData) {
  let existing = document.getElementById('extraction-loot-modal');
  if (existing) existing.remove();

  let modal = document.createElement('div');
  modal.id = 'extraction-loot-modal';
  modal.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:7000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Courier New", monospace;';

  let blueprintsHtml = lootData.blueprints.length > 0 ? '<div style="margin-top:10px;color:#facc15;font-weight:bold;">Blueprints Discovered:<br>' + lootData.blueprints.join('<br>') + '</div>' : '';
  let chipsHtml = lootData.chips.length > 0 ? '<div style="margin-top:10px;color:#38bdf8;font-weight:bold;">Upgrades Unlocked:<br>' + lootData.chips.join('<br>') + '</div>' : '';

  modal.innerHTML = '<div style="background:#12161b;border:1px solid #3a525c;border-radius:6px;padding:24px;max-width:420px;width:100%;color:#d3dade;box-shadow:0 8px 24px rgba(0,0,0,0.5);text-align:center;">' +
    '<div style="font-size:18px;font-weight:bold;color:#3fb950;margin-bottom:12px;">⚡ STATION BOSS DEFEATED ⚡</div>' +
    '<div style="font-size:13px;color:#8b949e;margin-bottom:16px;">Extraction sequence initiated. Salvaged components secured to hangar:</div>' +
    '<div style="background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:12px;text-align:left;font-size:13px;margin-bottom:16px;max-height:160px;overflow-y:auto;">' +
    lootData.textParts.map(p => '• ' + p).join('<br>') +
    blueprintsHtml + chipsHtml +
    '</div>' +
    '<button onclick="document.getElementById(\'extraction-loot-modal\').remove()" style="background:#1f6feb;color:#fff;border:none;border-radius:4px;padding:10px 20px;font-weight:bold;cursor:pointer;width:100%;">CONTINUE EXTRACTION</button>' +
    '</div>';

  document.body.appendChild(modal);
}

window.resetGameSave = function() {
  try { localStorage.removeItem('minispace_save'); } catch (e) {}
  location.reload();
};

window.jumpToPublicSpace = function(slot = 0) {
  let res = mapManager.jumpToPublicSpace(playerShip, mainStation, publicNpcManager, slot);
  asteroidBelt = res.asteroidBelt;
  debrisField = res.debrisField;
  targetMovePos = null;
  isDockingRequested = false;
  gateCooldown = 180;
  lockedTarget = null;
};

window.jumpToMissionSystem = function() {
  if (!missionManager || !missionManager.activeMission || missionManager.activeMission.returned) return;
  if (playerShip && playerShip.docked) return;
  const mission = missionManager.activeMission;
  const res = mapManager.jumpToMissionSystem(playerShip, mission);
  asteroidBelt = res.asteroidBelt;
  debrisField = res.debrisField;
  if (!mission.completed) missionManager.spawnMissionFleet(asteroidBelt, playerShip);
  else {
    mission.spawnedFleet = true;
    mission.fleet = [];
  }
  targetMovePos = null;
  lockedTarget = null;
  isDockingRequested = false;
  gateCooldown = 180;
  window.showCorpNotification('Arrived in ' + mission.systemName + '. Destroy ' +
    missionManager.getLivingEnemies().length + ' pirate raiders, then return through the green tear.');
  updateMissionsUI();
  saveGameSession();
};

window.jumpToPrivateSec = function() {
  let res = mapManager.jumpToPrivateSec(playerShip, mainStation);
  asteroidBelt = res.asteroidBelt;
  debrisField = res.debrisField;
  targetMovePos = null;
  isDockingRequested = false;
  gateCooldown = 180;
  lockedTarget = null;
};

function emptyCargoIntoStation() {
  if (!playerShip) return;
  const cargoMap = ensureOreCargo(playerShip);
  for (const key of Object.keys(cargoMap)) {
    const amount = Math.floor(Number(cargoMap[key]) || 0);
    if (amount > 0 && Object.prototype.hasOwnProperty.call(playerData.stationOre, key)) {
      playerData.stationOre[key] = (playerData.stationOre[key] || 0) + amount;
    }
  }
  playerShip.cargoByOre = {};
  playerShip.cargo = 0;
}

var autoUndockTimer = 0;
function performDock(silent) {
  if (!playerShip) return;
  playerShip.docked = true;
  playerShip.vx = 0;
  playerShip.vy = 0;
  targetMovePos = null;
  isDockingRequested = false;
  lockedTarget = null;
  emptyCargoIntoStation();
  let stationUi = document.getElementById('station-ui');
  if (silent === true && autoplayManager && autoplayManager.isAutoplay) {
    autoUndockTimer = 90;
    window.showCorpNotification('Autoplay: cargo stored in hangar, heading back out.');
  } else if (autoplayManager && autoplayManager.isAutoplay && autoplayManager.combatMode) {
    if (stationUi) stationUi.style.display = 'flex';
    // Keep combat autoplay active through every docking cycle.
    autoplayManager.onCombatDocked();
  } else {
    if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
    if (stationUi) stationUi.style.display = 'flex';
  }
  updateStationUI();
  updateCorpUI();
  if (typeof syncAutoplayButton === 'function') syncAutoplayButton();
  saveGameSession();
}

function undockShip() {
  if (!playerShip || !mainStation) return;
  playerShip.docked = false;
  playerShip.x = mainStation.x + 250;
  playerShip.y = mainStation.y + 250;
  playerShip.vx = 0;
  playerShip.vy = 0;
  let stationUi = document.getElementById('station-ui');
  if (stationUi) stationUi.style.display = 'none';
}

window.toggleDock = function() {
  if (!playerShip) return;
  if (playerShip.docked) { undockShip(); } else { performDock(); }
};

window.requestDock = function() {
  if (!playerShip || playerShip.docked) return;
  if (inPublicSpace()) { window.showCorpNotification('No station in Public Space - use your sector gate to return.'); return; }
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  isDockingRequested = true;
};

// Autoplay can be started from the station or in flight. The rules for which hulls
// and which zones are allowed live in AutoplayManager.toggle().
window.toggleAutoplay = function() {
  if (!autoplayManager) return;
  autoplayManager.toggle();
  syncAutoplayButton();
};


// ===== PILOT LEVELS & TALENT TREE =====
const TALENT_DEFS = {
 combat: [
  {id:'dps',name:'Weapon Systems',desc:'+3% damage per rank',max:10},
  {id:'tank',name:'Reinforced Hull',desc:'+4% shield and armour per rank',max:10},
  {id:'speed',name:'Afterburner Control',desc:'+2% combat ship speed per rank',max:10},
  {id:'reward',name:'Contract Negotiator',desc:'+3% mission rewards per rank',max:10}
 ],
 mining: [
  {id:'cargo',name:'Expanded Holds',desc:'+5% mining cargo per rank',max:10},
  {id:'speed',name:'Industrial Thrusters',desc:'+2% mining ship speed per rank',max:10},
  {id:'costs',name:'Efficient Manufacturing',desc:'-2% ship build costs per rank',max:10}
 ]
};
function progressionData(){
 if(!playerData.progression)playerData.progression={xp:0,level:1,skillPoints:0,spent:{combat:{},mining:{}}};
 const p=playerData.progression;if(!p.spent)p.spent={combat:{},mining:{}};if(!p.spent.combat)p.spent.combat={};if(!p.spent.mining)p.spent.mining={};return p;
}
function xpForNextLevel(level){return Math.floor(900*Math.pow(Math.max(1,level),1.55));}
function awardPlayerXP(path,amount,reason){
 const p=progressionData();amount=Math.max(0,Number(amount)||0);if(!amount)return;
 p.xp=(p.xp||0)+amount;let gained=0;
 while(p.xp >= xpForNextLevel(p.level||1)){p.xp-=xpForNextLevel(p.level||1);p.level=(p.level||1)+1;p.skillPoints=(p.skillPoints||0)+1;gained++;}
 if(gained){window.showCorpNotification('PILOT LEVEL UP! Level '+p.level+' — '+gained+' talent point'+(gained===1?'':'s')+' earned.');updatePilotPanel();saveGameSession();}
}
window.awardPlayerXP=awardPlayerXP;
function talentRank(path,id){const p=progressionData();return Math.max(0,Number(p.spent[path]&&p.spent[path][id])||0);}
function spendTalent(path,id){const def=(TALENT_DEFS[path]||[]).find(x=>x.id===id);const p=progressionData();if(!def||p.skillPoints<=0||talentRank(path,id)>=def.max)return; p.spent[path][id]=talentRank(path,id)+1;p.skillPoints--;applyPilotTalents();updatePilotPanel();renderSkillsUI();saveGameSession();}
window.spendTalent=spendTalent;
function applyPilotTalents(){
 const s=playerShip;if(!s)return;const combat=['Combat Frigate','Carrier','Siege Cruiser','Siege Battleship','Siege Capital'].includes(s.className);const mining=['Mining Frigate','Mining Barge','Command Ship','Mining Capital'].includes(s.className);const path=combat?'combat':(mining?'mining':null);if(!path)return;
 const ranks=progressionData().spent[path]||{};const mult=(id,per)=>1+(Number(ranks[id])||0)*per;
 const prev=(s._pilotTalentPath===path&&s._pilotTalentMult)?s._pilotTalentMult:{speed:1,cargo:1,tank:1,dps:1};
 if(s.maxSpeed)s.maxSpeed=s.maxSpeed/prev.speed*mult('speed',0.02);
 if(s.maxCargo)s.maxCargo=s.maxCargo/prev.cargo*mult('cargo',0.05);
 if(s.maxShield)s.maxShield=s.maxShield/prev.tank*mult('tank',0.04);
 if(s.maxArmor)s.maxArmor=s.maxArmor/prev.tank*mult('tank',0.04);
 if(s.missileDamage)s.missileDamage=s.missileDamage/prev.dps*mult('dps',0.03);
 if(Array.isArray(s.drones))s.drones.forEach(entry=>{const drone=entry&&(entry.ship||entry);if(drone&&drone.missileDamage){const old=drone._carrierTalentDps||1;drone.missileDamage=drone.missileDamage/old*mult('dps',0.03);drone._carrierTalentDps=mult('dps',0.03);}});
 s._pilotTalentPath=path;s._pilotTalentMult={speed:mult('speed',0.02),cargo:mult('cargo',0.05),tank:mult('tank',0.04),dps:mult('dps',0.03)};
}
window.getMissionRewardTalentMultiplier=function(){return 1+talentRank('combat','reward')*0.03;};
window.getBuildCostTalentMultiplier=function(){return Math.max(0.8,1-talentRank('mining','costs')*0.02);};
function updatePilotPanel(){const p=progressionData();const el=document.getElementById('pilot-level-text');if(el)el.innerText='LEVEL '+p.level+' · '+p.skillPoints+' TALENT POINTS';}
function openSkillsUI(){let modal=document.getElementById('skills-modal');if(!modal){modal=document.createElement('div');modal.id='skills-modal';modal.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.86);display:none;align-items:center;justify-content:center;padding:12px;';modal.innerHTML='<div style="width:min(760px,100%);max-height:92vh;overflow:auto;background:#101820;border:1px solid #4b6c78;border-radius:8px;padding:16px;color:#dce7eb;font-family:system-ui"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;color:#8fd4c2">PILOT TALENTS</h2><button onclick="window.closeSkillsUI()">CLOSE</button></div><div id="skills-content"></div></div>';document.body.appendChild(modal);}modal.style.display='flex';renderSkillsUI();}
function renderSkillsUI(){const host=document.getElementById('skills-content');if(!host)return;const p=progressionData(),next=xpForNextLevel(p.level);let html='<p>LEVEL '+p.level+' · '+Math.floor(p.xp)+' / '+next+' XP · '+p.skillPoints+' unspent talent points</p><div style="height:8px;background:#26323a;border-radius:8px;overflow:hidden"><div style="height:100%;width:'+Math.min(100,p.xp/next*100)+'%;background:#36b99a"></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:16px">';
 for(const path of ['combat','mining']){html+='<section style="border:1px solid #334650;padding:10px;border-radius:6px"><h3 style="color:'+(path==='combat'?'#f08b72':'#8fd4c2')+'">'+path.toUpperCase()+' TALENTS</h3>';for(const t of TALENT_DEFS[path]){const rank=talentRank(path,t.id);html+='<div style="padding:9px;margin:7px 0;background:#18232b;border-radius:5px"><strong>'+t.name+'</strong><div style="font-size:12px;color:#9eafb6">'+t.desc+'</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px"><span>RANK '+rank+'/'+t.max+'</span><button onclick="window.spendTalent(\''+path+'\',\''+t.id+'\')" '+(p.skillPoints<=0||rank>=t.max?'disabled':'')+'>UPGRADE</button></div></div>'; }html+='</section>';}
 host.innerHTML=html+'</div><p style="font-size:12px;color:#91a1a9">Mining XP comes from ore actually collected. Combat XP comes from pirates destroyed. Every level grants one talent point.</p>';}
window.openSkillsUI=openSkillsUI;window.closeSkillsUI=function(){const m=document.getElementById('skills-modal');if(m)m.style.display='none';};

window.switchTab = function(tabName, btnElement) {
  let parentContainer = btnElement.closest('.station-tabs');
  if (parentContainer) {
    parentContainer.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  }
  btnElement.classList.add('active');
  ['hangar', 'upgrades', 'corp', 'market', 'missions'].forEach(function(s) {
    let secEl = document.getElementById('tab-' + s);
    if (secEl) secEl.style.display = (s === tabName) ? 'block' : 'none';
  });
  if (tabName === 'corp') updateCorpUI();
  if (tabName === 'missions') updateMissionsUI();
  if (tabName === 'upgrades' || tabName === 'hangar') updateStationUI();
};

function updateMissionsUI() {
  const host = document.getElementById('missions-list');
  if (!host || !missionManager) return;
  const active = missionManager.activeMission;
  if (active) {
    let status = active.returned ? ((playerShip && playerShip.docked) ? 'Docked - reward ready to claim' : 'Returned to High-Sec - fly to station and dock') :
      (active.completed ? 'All targets destroyed - return through the green tear' :
      (inMissionSpace() ? 'In mission system - destroy the pirate raiders' : 'Accepted - undock and fly to the marked mission tear'));
    let action = active.completed && active.returned
      ? (playerShip && playerShip.docked ? '<button onclick="window.claimMissionReward()">CLAIM ' + fmtISK(active.rewardIsk) + ' REWARD</button>' : '<button disabled>FLY TO STATION AND DOCK TO CLAIM</button>')
      : (active.returned ? '' : (inMissionSpace()
        ? '<button disabled>MISSION ACTIVE — ' + missionManager.getLivingEnemies().length + ' PIRATES REMAIN</button>'
        : '<button disabled>UNLOCKED: FLY TO THE GREEN MISSION TEAR</button>'));
    host.innerHTML = '<div class="mission-card ' + active.id + '"><h3>' + active.difficulty.toUpperCase() + ' — ' + active.title + '</h3><p>' + active.description + '</p><div class="mission-meta"><span>Destination: ' + active.systemName + '</span><span>Targets: ' + (active.completed ? '0' : (active.spawnedFleet ? missionManager.getLivingEnemies().length : active.targetCount)) + '</span><span>Reward: ' + fmtISK(active.rewardIsk) + '</span></div><p>Status: ' + status + '</p>' + action + '</div>';
    return;
  }
  const combatReady = playerShip && (playerShip.className === 'Combat Frigate' || playerShip.className === 'Carrier' || playerShip.className === 'Siege Cruiser' || playerShip.className === 'Siege Battleship' || playerShip.className === 'Siege Capital' || playerShip.className === 'Explorer Cruiser');
  let warning = combatReady ? '' : '<div class="mission-warning">A stock Combat Frigate is recommended. Mining ships cannot damage pirate ships. No upgrades are required for the Easy contract.</div>';
  host.innerHTML = warning + missionManager.availableMissions.map(m => '<div class="mission-card ' + m.id + '"><h3>' + m.difficulty.toUpperCase() + ' — ' + m.title + '</h3><p>' + m.description + '</p><div class="mission-meta"><span>Destination: ' + m.systemName + '</span><span>Pirates: ' + m.targetCount + '</span><span>Reward: ' + fmtISK(m.rewardIsk) + '</span></div><button onclick="window.acceptStationMission(\'' + m.id + '\')" ' + (!combatReady ? 'disabled' : '') + '>ACCEPT MISSION</button></div>').join('');
}
window.acceptStationMission = function(id) {
  if (!playerShip || !playerShip.docked) { window.showCorpNotification('Dock at the station to accept a mission.'); return; }
  const combatReady = ['Combat Frigate','Carrier','Siege Cruiser','Siege Battleship','Siege Capital','Explorer Cruiser'].includes(playerShip.className);
  if (!combatReady) { window.showCorpNotification('Board a Combat Frigate or another combat-capable ship first.'); return; }
  if (!missionManager.acceptMission(id, playerShip)) return;
  mapManager.missionEntryGate.destinationName = missionManager.activeMission.systemName;
  saveGameSession();
  updateMissionsUI();
  window.showCorpNotification('Mission accepted: ' + missionManager.activeMission.systemName +
    '. Undock and fly to the green mission tear marked on your map.');
};
window.resumeMission = function() {
  if (!missionManager.activeMission) return;
  if (inMissionSpace()) {
    window.showCorpNotification('You are already in the mission system.');
  } else {
    window.showCorpNotification('Undock and fly to the green mission tear marked on your map. Missions do not teleport you.');
  }
};
window.claimMissionReward = function() {
  if (!playerShip || !playerShip.docked || !missionManager.activeMission || !missionManager.activeMission.returned) {
    window.showCorpNotification('Return through the green tear, fly back to the station and dock to claim your reward.');
    return;
  }
  const result = missionManager.claimReward(playerData);
  if (!result) return;
  playerData.activeMission = null;
  updateStationUI(); updateMissionsUI(); saveGameSession();
  window.showCorpNotification('Mission reward received: ' + fmtISK(result.reward) + ' Scrap Metals.' + (result.chip ? ' Rare drop: 1 Item Level Chip!' : ''));
};
window.updateMissionsUI = updateMissionsUI;

window.sellStationItem = function(key, price) {
  let qty = playerData.stationOre[key] || 0;
  if (qty <= 0) return;
  playerData.isk += qty * (price || itemPrices[key] || 10);
  playerData.stationOre[key] = 0;
  updateStationUI();
  saveGameSession();
};

window.buyStationItem = function(key, qty) {
  const price = itemPrices[key];
  if (price === undefined) return;
  let n = qty > 0 ? qty : Math.floor((playerData.isk || 0) / price);
  n = Math.min(n, Math.floor((playerData.isk || 0) / price));
  if (n <= 0) { window.showCorpNotification('Not enough Scrap Metals'); return; }
  playerData.isk -= n * price;
  playerData.stationOre[key] = (playerData.stationOre[key] || 0) + n;
  window.showCorpNotification('Bought ' + n.toLocaleString() + ' ' + itemLabel(key) + ' for ' + fmtISK(n * price) + ' Scrap Metals');
  updateStationUI();
  updateMarketUI();
  saveGameSession();
};

window.openBuyOre = function() {
  const btn = Array.from(document.querySelectorAll('.station-tabs .tab-btn')).find(function(b) { return /'market'/.test(b.getAttribute('onclick') || ''); });
  if (btn) window.switchTab('market', btn);
  marketActiveTab = 'ore';
  updateMarketUI();
};

window.quickSellAllVault = function() {
  let total = 0;
  for (let key in playerData.stationOre) {
    let qty = playerData.stationOre[key] || 0;
    total += qty * (itemPrices[key] || 10);
    playerData.stationOre[key] = 0;
  }
  playerData.isk += total;
  if (total > 0) window.showCorpNotification('Sold vault for ' + fmtISK(total) + ' Scrap Metals');
  updateStationUI();
  saveGameSession();
};

window.upgradeFrigateModule = function(mod) {
  if (!playerShip || !playerShip.moduleLevels) return;
  let lvl = playerShip.moduleLevels[mod] || 1;
  if (lvl >= getCap(mod)) return;
  let cost = upgradeCostAt(lvl);
  if (playerData.isk < cost) { window.showCorpNotification('Not enough Scrap Metals (' + fmtISK(cost) + ' needed)'); return; }
  playerData.isk -= cost;
  playerShip.moduleLevels[mod] = lvl + 1;
  applyDesign(playerShip);
  playerShip._pilotTalentMult = null;
  applyPilotTalents();
  updateStationUI();
  saveGameSession();
};

window.boardShip = function(className, cargo, speed) {
  if (!playerShip) return;
  if (missionManager && missionManager.activeMission) { window.showCorpNotification('Finish and claim your active mission before changing ships. Mission difficulty is locked to the ship you accepted it in.'); return; }
  if (!playerShip.docked) { window.showCorpNotification('Dock at the station to change ships.'); return; }
  if (playerShip.className === className) return;
  if (!playerData.upgrades) playerData.upgrades = {};
  cleanModules(playerShip);
  playerData.upgrades[playerShip.className] = Object.assign({}, playerShip.moduleLevels);
  playerShip.moduleLevels = {};
  let s = sessionManager.setShipClass(playerShip, className, cargo, speed);
  let saved = playerData.upgrades[className];
  if (saved && s.moduleLevels) Object.assign(s.moduleLevels, saved);
  cleanModules(s);
  s.cargo = 0;
  s.docked = true;
  applyDesign(s);
  if (s.className === 'Combat Frigate') s.noOrbitWhileFiring = true;
  playerShip = s;
  applyPilotTalents();
  window.showCorpNotification('Boarded ' + className);
  updateStationUI();
  saveGameSession();
};

function hangarItemValue() {
  let total = 0;
  for (const k in playerData.stationOre) total += (playerData.stationOre[k] || 0) * (itemPrices[k] || 10);
  return total;
}

function payDesignCost(cost) {
  if (!cost) return true;
  const buildMult = typeof window.getBuildCostTalentMultiplier === 'function' ? window.getBuildCostTalentMultiplier() : 1;
  cost = { isk: Math.ceil(cost.isk * buildMult), items: Math.ceil(cost.items * buildMult) };
  if (playerData.isk < cost.isk) {
    window.showCorpNotification('Need ' + fmtISK(cost.isk) + ' Scrap Metals to build this.');
    return false;
  }
  const have = hangarItemValue();
  if (have < cost.items) {
    window.showCorpNotification('Need ' + fmtISK(cost.items) + ' worth of ore and components (hangar has ' + fmtISK(have) + ').');
    return false;
  }
  playerData.isk -= cost.isk;
  let remaining = cost.items;
  const keys = Object.keys(playerData.stationOre).filter(function (k) { return (playerData.stationOre[k] || 0) > 0; });
  keys.sort(function () { return Math.random() - 0.5; });
  for (const k of keys) {
    if (remaining <= 0) break;
    const price = itemPrices[k] || 10;
    const qty = playerData.stationOre[k];
    const take = Math.min(qty, Math.ceil(remaining / price));
    playerData.stationOre[k] = qty - take;
    remaining -= take * price;
  }
  return true;
}

function showMissingOrePrompt(key) {
  const d = DESIGNS[key];
  const missing = Math.ceil(d.cost.items - hangarItemValue());
  const unit = itemPrices.omber || 10;
  const units = Math.ceil(missing / unit);
  const price = units * unit;
  let ov = document.getElementById('missing-ore-prompt');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'missing-ore-prompt';
  ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:6000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = '<div style="background:#12161b;border:1px solid #3a525c;border-radius:3px;padding:16px;max-width:360px;width:100%;color:#d3dade;font-size:14px;">' +
    '<div style="font-weight:bold;margin-bottom:8px;">Missing materials</div>' +
    '<div style="margin-bottom:12px;line-height:1.4;">' + d.label + ' needs ' + fmtISK(d.cost.items) + ' worth of ore and components. You are short ' + fmtISK(missing) + '.<br>Would you like to buy the missing materials (' + units.toLocaleString() + ' ' + itemLabel('omber') + ') for ' + fmtISK(price) + ' Scrap Metals?</div>' +
    '<div id="missing-ore-msg" style="color:#b5605a;margin-bottom:10px;min-height:0;"></div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button id="missing-ore-yes" style="flex:1;min-height:40px;">Yes</button>' +
    '<button id="missing-ore-no" style="flex:1;min-height:40px;">No</button></div></div>';
  document.body.appendChild(ov);
  document.getElementById('missing-ore-no').onclick = function () { ov.remove(); };
  document.getElementById('missing-ore-yes').onclick = function () {
    const needed = price + d.cost.isk;
    if (playerData.isk < needed) {
      document.getElementById('missing-ore-msg').innerText = 'Not enough Scrap Metals: you need ' + fmtISK(needed) + ' (' + fmtISK(price) + ' for materials + ' + fmtISK(d.cost.isk) + ' for the build) and have ' + fmtISK(playerData.isk) + '.';
      return;
    }
    ov.remove();
    playerData.isk -= price;
    playerData.stationOre.omber = (playerData.stationOre.omber || 0) + units;
    window.showCorpNotification('Bought ' + units.toLocaleString() + ' ' + itemLabel('omber') + ' for ' + fmtISK(price) + ' Scrap Metals');
    updateStationUI();
    window.buildDesign(key);
  };
}

window.buildDesign = function(key) {
  const d = DESIGNS[key];
  if (!d || !playerShip) return;
  if (!playerShip.docked) { window.showCorpNotification('Dock at the station to build.'); return; }
  if (!(playerData.designs[key] > 0)) return;
  if (d.cost && hangarItemValue() < d.cost.items) {
    showMissingOrePrompt(key);
    return;
  }
  if (!payDesignCost(d.cost)) return;

  playerData.designs[key]--;
  if (d.hangar) {
    if (!playerData.builtHulls) playerData.builtHulls = {};
    playerData.builtHulls[d.hull] = true;
    window.showCorpNotification(d.label + ' built. Board it from the hangar.');
  } else {
    if (playerShip.className !== d.hull) window.boardShip(d.hull, d.cargo, d.speed);
    playerData.hullDesigns[d.hull] = key;
    applyDesign(playerShip);
    window.showCorpNotification(d.label + ' built on ' + d.hull + '.');
  }
  updateStationUI();
  saveGameSession();
};

// ===== SHIPYARD =====
// Ships are built from specific ore and components (recipes live in Market.js).
// Nothing here costs Scrap Metals unless the player chooses to buy missing materials.
function recipeFor(key) {
  return SHIP_RECIPES[String(key).toLowerCase()] || null;
}

// Returns a list of {item, need, have} for every material the hangar is short on.
function recipeShortfall(recipe) {
  const short = [];
  for (const entry of recipe) {
    const have = Math.floor((playerData.stationOre && playerData.stationOre[entry[0]]) || 0);
    if (have < entry[1]) short.push({ item: entry[0], need: entry[1], have: have });
  }
  return short;
}

// Takes the materials out of the hangar. Call only when recipeShortfall() is empty.
function consumeRecipe(recipe) {
  for (const entry of recipe) {
    playerData.stationOre[entry[0]] = (playerData.stationOre[entry[0]] || 0) - entry[1];
  }
}

function missingMaterialsMessage(short) {
  return 'Missing: ' + short.map(function (s) {
    return (s.need - s.have).toLocaleString() + ' ' + itemLabel(s.item);
  }).join(', ');
}

// Total market price of everything in the shortfall list.
function missingMaterialsCost(short) {
  let total = 0;
  for (const s of short) total += (s.need - s.have) * (itemPrices[s.item] || 10);
  return total;
}

// Shows what is missing and offers to buy it with Scrap Metals, then retries the build.
function showBuyMissingPrompt(title, short, retryBuild) {
  const cost = missingMaterialsCost(short);
  let ov = document.getElementById('missing-ore-prompt');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'missing-ore-prompt';
  ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:6000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;';
  const lines = short.map(function (s) {
    return (s.need - s.have).toLocaleString() + ' ' + itemLabel(s.item) +
      ' <span style="color:#8b949e;">(' + fmtISK((s.need - s.have) * (itemPrices[s.item] || 10)) + ')</span>';
  }).join('<br>');
  ov.innerHTML = '<div style="background:#12161b;border:1px solid #3a525c;border-radius:3px;padding:16px;max-width:360px;width:100%;color:#d3dade;font-size:14px;">' +
    '<div style="font-weight:bold;margin-bottom:8px;">Missing materials for ' + title + '</div>' +
    '<div style="margin-bottom:12px;line-height:1.4;">' + lines + '</div>' +
    '<div style="margin-bottom:12px;">Buy all missing materials for <b>' + fmtISK(cost) + '</b> Scrap Metals and build?</div>' +
    '<div id="missing-ore-msg" style="color:#b5605a;margin-bottom:10px;"></div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button id="missing-ore-yes" style="flex:1;min-height:40px;">Buy Missing</button>' +
    '<button id="missing-ore-no" style="flex:1;min-height:40px;">Cancel</button></div></div>';
  document.body.appendChild(ov);
  document.getElementById('missing-ore-no').onclick = function () { ov.remove(); };
  document.getElementById('missing-ore-yes').onclick = function () {
    if (playerData.isk < cost) {
      document.getElementById('missing-ore-msg').innerText =
        'Not enough Scrap Metals: need ' + fmtISK(cost) + ', have ' + fmtISK(playerData.isk) + '.';
      return;
    }
    ov.remove();
    playerData.isk -= cost;
    for (const s of short) {
      playerData.stationOre[s.item] = (playerData.stationOre[s.item] || 0) + (s.need - s.have);
    }
    window.showCorpNotification('Bought missing materials for ' + fmtISK(cost) + ' Scrap Metals');
    retryBuild();
  };
}

window.buildShip = function(unlockKey, className) {
  if (!playerShip || !playerShip.docked) { window.showCorpNotification('Dock at the station to build ships.'); return; }
  if (!playerData.unlockedShips) playerData.unlockedShips = {};
  if (playerData.unlockedShips[unlockKey]) return;
  const recipe = recipeFor(unlockKey);
  if (!recipe) { window.showCorpNotification('No recipe for ' + className); return; }
  const short = recipeShortfall(recipe);
  if (short.length > 0) {
    showBuyMissingPrompt(className, short, function () { window.buildShip(unlockKey, className); });
    return;
  }
  consumeRecipe(recipe);
  playerData.unlockedShips[unlockKey] = true;
  if (playerData.shipsOwned.indexOf(className) === -1) playerData.shipsOwned.push(className);
  window.showCorpNotification(className + ' built. Board it from the Shipyard or Hangar.');
  updateStationUI();
  saveGameSession();
};

// TEST CHEAT: run minispaceTestShips() in the browser console to unlock every standard hull.
// This is local testing only; it does not grant ships on a future server-backed multiplayer account.
window.minispaceTestShips = function() {
  const testShips = {
    frigate: 'Mining Frigate',
    combatFrigate: 'Combat Frigate',
    barge: 'Mining Barge',
    command: 'Command Ship',
    carrier: 'Carrier',
    capital: 'Mining Capital',
    explorationFrigate: 'Exploration Frigate',
    siegeCruiser: 'Siege Cruiser',
    siegeBattleship: 'Siege Battleship'
  };
  if (!playerData.unlockedShips) playerData.unlockedShips = {};
  if (!Array.isArray(playerData.shipsOwned)) playerData.shipsOwned = [];
  Object.keys(testShips).forEach(function(key) {
    playerData.unlockedShips[key] = true;
    if (!playerData.shipsOwned.includes(testShips[key])) playerData.shipsOwned.push(testShips[key]);
  });
  playerData.transportManagerPurchased = Math.max(1, playerData.transportManagerPurchased || 0);
  updateStationUI();
  updateCorpUI();
  saveGameSession();
  window.showCorpNotification('TEST MODE: all standard ships and Transport Manager unlocked in your hangar.');
  return 'Unlocked: ' + Object.values(testShips).join(', ');
};

window.buildTransportManager = function() {
  if ((playerData.transportManagerPurchased || 0) > 0) return;
  const recipe = recipeFor('transportcapital');
  if (!recipe) {
    window.showCorpNotification('No recipe found for Transport Manager.');
    return;
  }
  const short = recipeShortfall(recipe);
  if (short.length > 0) {
    showBuyMissingPrompt('Transport Manager', short, function () { window.buildTransportManager(); });
    return;
  }
  consumeRecipe(recipe);
  playerData.transportManagerPurchased = 1;
  window.showCorpNotification('Transport Manager built. Logistics online.');
  saveGameSession();
  updateStationUI();
  updateCorpUI();
};

window.donateCruiserIsk = function(amount) {
  if (!botManager) return;
  if (playerData.isk < amount) { window.showCorpNotification('Not enough Scrap Metals to donate ' + fmtISK(amount)); return; }
  if (!botManager.donateIsk(amount)) { window.showCorpNotification('No corp explorer to donate to yet.'); return; }
  playerData.isk -= amount;
  window.showCorpNotification('Donated ' + fmtISK(amount) + ' Scrap Metals to the corp explorer.');
  updateStationUI(); updateCorpUI(); saveGameSession();
};

window.donateCruiserItems = function() {
  if (!botManager) return;
  const movedVal = botManager.donateItems(playerData.stationOre || {});
  if (movedVal <= 0) {
    window.showCorpNotification('Explorer already has enough ore/components or hangar is empty.');
    return;
  }
  window.showCorpNotification('Donated required ore & components worth ' + fmtISK(movedVal) + ' to the corp explorer.');
  updateStationUI(); updateCorpUI(); saveGameSession();
};

window.buyCorpMember = function() {
  let n = playerData.corpMembersPurchased || 0;
  if (n >= 5) return;
  let cost = 50000 * (n + 1);
  if (playerData.isk < cost) { window.showCorpNotification('Need ' + fmtISK(cost) + ' Scrap Metals'); return; }
  playerData.isk -= cost;
  playerData.corpMembersPurchased = n + 1;
  botManager.addBot('Mining Frigate');
  updateStationUI(); updateCorpUI(); saveGameSession();
};

window.buyExplorationCorp = function() {
  if (playerData.explorationCorpPurchased > 0) return;
  let cost = 200000;
  if (playerData.isk < cost) { window.showCorpNotification('Need ' + fmtISK(cost) + ' Scrap Metals'); return; }
  playerData.isk -= cost;
  playerData.explorationCorpPurchased = 1;
  botManager.addExplorationBot();
  updateStationUI(); updateCorpUI(); saveGameSession();
};

window.toggleCapitalAnchor = function() {
  if (playerShip && typeof playerShip.toggleIndustrialCore === 'function') {
    if (playerShip.cooldownTimer > 0) { window.showCorpNotification('Industrial core cooling down...'); return; }
    playerShip.toggleIndustrialCore();
  }
};

window.toggleExplorationCloak = function() {
  if (playerShip && typeof playerShip.toggleCloak === 'function') {
    playerShip.toggleCloak();
    let btn = document.getElementById('cloak-btn');
    if (btn) {
      btn.style.background = playerShip.isCloaked ? '#1f6feb' : '#21262d';
      btn.innerText = playerShip.isCloaked ? 'CLOAK: ON' : 'CLOAK: OFF';
    }
  }
};

window.toggleExplorationPanicButton = function() {
  if (playerShip && typeof playerShip.togglePanicButton === 'function') {
    playerShip.togglePanicButton();
    let btn = document.getElementById('PanicButton-btn');
    if (btn) {
      btn.style.background = playerShip.isPanicButtonActive ? '#f85149' : '#21262d';
      btn.innerText = playerShip.isPanicButtonActive ? 'PanicButton: ACTIVE' : 'PanicButton: OFF';
    }
  }
};

window.jumpToPanicButton = function(targetX, targetY) {
  if (playerShip && playerShip.className === 'Carrier') {
    playerShip.x = targetX + (Math.random() - 0.5) * 50;
    playerShip.y = targetY + (Math.random() - 0.5) * 50;
    playerShip.vx = 0;
    playerShip.vy = 0;
    window.showCorpNotification('Jump Drive Engaged! Teleported to PanicButton Beacon.');
  }
};

window.handlePlayerDeath = function() {
  let destroyed = playerShip ? playerShip.className : 'Ship';
  window.showCorpNotification(destroyed + ' and its upgrades destroyed! Returning to base.');
  if (playerData.upgrades) delete playerData.upgrades[destroyed];
  if (playerData.hullDesigns) delete playerData.hullDesigns[destroyed];
  if (playerData.builtHulls) delete playerData.builtHulls[destroyed];
  if (playerShip) playerShip.moduleLevels = {};
  playerShip = sessionManager.setShipClass(playerShip, 'Mining Frigate', 200, 3.4);
  applyDesign(playerShip);
  playerShip.cargo = 0;
  playerShip.structure = playerShip.maxStructure;
  playerShip.docked = false;
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  window.jumpToPrivateSec();
  performDock();
};

window.initializeNewGameSession = function() {
  let nameInput = document.getElementById('pilot-name-input');
  let name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    let err = document.getElementById('setup-error');
    if (err) err.innerText = 'Enter a pilot name to continue.';
    if (nameInput) nameInput.focus();
    return;
  }
  playerData.pilotName = name;

  if (!playerData.race) {
    let raceInput = document.getElementById('pilot-race-input');
    let pickedRace = raceInput ? raceInput.value : 'miner';
    playerData.race = window.Races ? window.Races.normalize(pickedRace) : (pickedRace === 'standard' ? 'miner' : pickedRace);
    if (playerData.race === 'siege') {
      if (!playerData.unlockedShips) playerData.unlockedShips = {};
      playerData.unlockedShips.combatFrigate = true;
      if (playerData.shipsOwned.indexOf('Combat Frigate') === -1) playerData.shipsOwned.push('Combat Frigate');
      playerShip = sessionManager.setShipClass(playerShip, 'Combat Frigate', 800, 5.0);
      cleanModules(playerShip);
    }
  }
  applyDesign(playerShip);
  if (playerShip.className === 'Combat Frigate') playerShip.noOrbitWhileFiring = true;
  applyPilotTalents();

  let modalEl = document.getElementById('setup-modal');
  if (modalEl) modalEl.style.display = 'none';

  let stationUi = document.getElementById('station-ui');
  if (stationUi) stationUi.style.display = 'none';

  if (playerShip && mainStation) {
    playerShip.docked = false;
    playerShip.x = mainStation.x + 250;
    playerShip.y = mainStation.y + 250;
    playerShip.vx = 0;
    playerShip.vy = 0;
  }
  saveGameSession();
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
if (minimapCanvas) { minimapCanvas.width = 120; minimapCanvas.height = 120; }

var cameraZoom = 0.35;
window.adjustZoom = function(amount) {
  cameraZoom = Math.min(1.2, Math.max(0.15, cameraZoom + amount));
};

var targetMovePos = null;
var isDockingRequested = false;
var gateCooldown = 0;
var lockedTarget = null;
var fullWarned = false;

function resize() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

function handleCanvasTouch(clientX, clientY) {
  if (!playerShip || playerShip.docked) return;
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();

  const rect = canvas.getBoundingClientRect();
  const xCoord = clientX - rect.left;
  const yCoord = clientY - rect.top;
  const dpr = window.devicePixelRatio || 1;

  targetMovePos = {
    x: playerShip.x + (xCoord - canvas.width / (2 * dpr)) / cameraZoom,
    y: playerShip.y + (yCoord - canvas.height / (2 * dpr)) / cameraZoom
  };
  isDockingRequested = !inPublicSpace() && mainStation &&
    Math.hypot(targetMovePos.x - mainStation.x, targetMovePos.y - mainStation.y) < 450;
  if (isDockingRequested) { lockedTarget = null; return; }

  const cls = playerShip.className;
  if (cls !== 'Combat Frigate' && cls !== 'Carrier' && cls !== 'Siege Capital' && cls !== 'Siege Battleship' && cls !== 'Siege Cruiser') {
    const pool = isExplorerClass(cls) ? (debrisField ? debrisField.getEntities() : []) : (asteroidBelt ? asteroidBelt.getEntities() : []);
    const tapR = 48 / cameraZoom;
    let hit = null, best = Infinity;
    for (const r of pool) {
      if (!r) continue;
      const d = Math.hypot(r.x - targetMovePos.x, r.y - targetMovePos.y) - (r.radius || 0);
      if (d < tapR && d < best) { best = d; hit = r; }
    }
    if (hit) {
      lockedTarget = hit;
      targetMovePos = null;
      return;
    }
  }
  lockedTarget = null;
}

function isUiTarget(e) {
  return e.target && e.target.closest &&
    (e.target.closest('#ui-layer') || e.target.closest('#station-ui') ||
     e.target.closest('#setup-modal') || e.target.closest('#autoplay-btn'));
}

window.addEventListener('pointerdown', function(e) {
  if (isUiTarget(e)) return;
  handleCanvasTouch(e.clientX, e.clientY);
});

const keys = {};
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

function isTypingTarget(target) {
  return !!(
    target &&
    (
      target.isContentEditable ||
      (target.closest && target.closest('input, textarea, select, [contenteditable="true"]'))
    )
  );
}

window.addEventListener('keydown', function(e) {
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.includes(k) && autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  keys[k] = true;
  keys[e.code] = true;
  targetMovePos = null;
  isDockingRequested = false;
});
window.addEventListener('keyup', function(e) {
  keys[e.key.toLowerCase()] = false;
  keys[e.code] = false;
});
function getShipTierMultiplier() {
  let name = (playerShip && playerShip.className || '').toLowerCase();
  if (name.includes('capital') || name.includes('carrier')) return 8;
  if (name.includes('command')) return 4;
  if (name.includes('barge')) return 2;
  return 1;
}

const baseUpgradeCosts = [3000, 6000, 9000, 12000, 18000];
const UPGRADE_STEP = 6000;
function upgradeCostAt(lvl) {
  const last = baseUpgradeCosts.length - 1;
  const base = lvl <= last ? baseUpgradeCosts[lvl] : baseUpgradeCosts[last] + UPGRADE_STEP * (lvl - last - 1);
  return base * getShipTierMultiplier();
}

function corpOwnedRow(name, sub) {
  return '<tr><td>' + name + '</td><td>' + sub + '</td><td style="color:#8b949e;">Corp</td></tr>';
}

// Every hull the hangar can show. unlock = key in playerData.unlockedShips (null = always owned)
const SHIP_CATALOG = {
  'Mining Frigate':      { cargo: 200,    speed: 3.4,  unlock: null },
  'Mining Barge':        { cargo: 1200,   speed: 4.2,  unlock: 'barge' },
  'Command Ship':        { cargo: 2500,   speed: 3.5,  unlock: 'command' },
  'Mining Capital':      { cargo: 100000, speed: 1.6,  unlock: 'capital' },
  'Carrier':             { cargo: 40000,  speed: 1.65, unlock: 'carrier' },
  'Combat Frigate':      { cargo: 800,    speed: 5.0,  unlock: 'combatFrigate' },
  'Siege Cruiser':       { cargo: 400,    speed: 2.6,  unlock: 'siegeCruiser' },
  'Siege Battleship':    { cargo: 2000,   speed: 3.2,  unlock: 'siegeBattleship' },
  'Exploration Frigate': { cargo: 150,    speed: 6.0,  unlock: 'explorationFrigate' }
};

function updateStationUI() {
  updateMarketUI();
  let iskDisplay = document.getElementById('station-isk-display');
  if (iskDisplay) iskDisplay.innerText = fmtISK(playerData.isk || 0) + ' Scrap Metals';

  const HANGAR_GROUP_TITLES = { ore: 'ORE', debris: 'COMPONENTS', explorer: 'EXPLORER SHIPS', mining: 'MINING SHIPS', combat: 'COMBAT SHIPS', capital: 'CAPITALS' };
  const HANGAR_SHIP_GROUP = {
    'Exploration Frigate': 'explorer', 'Improved Explorer Frigate': 'explorer', 'Explorer Cruiser': 'explorer',
    'Mining Frigate': 'mining', 'Mining Barge': 'mining', 'Command Ship': 'mining',
    'Combat Frigate': 'combat', 'Siege Cruiser': 'combat', 'Siege Battleship': 'combat',
    'Mining Capital': 'capital', 'Siege Capital': 'capital', 'Carrier': 'capital'
  };
  const groupRows = { ore: '', debris: '', explorer: '', mining: '', combat: '', capital: '' };
  const groupCount = { ore: 0, debris: 0, explorer: 0, mining: 0, combat: 0, capital: 0 };

  if (!playerData.stationOre) playerData.stationOre = {};
  for (let itemKey in playerData.stationOre) {
    let qty = playerData.stationOre[itemKey] || 0;
    let sellPrice = itemPrices[itemKey] || 10;
    let displayName = itemLabel(itemKey).toUpperCase();
    const g = itemKey.indexOf('debris_') === 0 ? 'debris' : 'ore';
    groupRows[g] += '<tr><td>' + displayName + '</td><td>' + qty.toLocaleString() + '</td><td><button onclick="window.sellStationItem(\'' + itemKey + '\', ' + sellPrice + ')" ' + (qty <= 0 ? 'disabled' : '') + '>Sell All (' + sellPrice + ' Scrap Metals/ea)</button></td></tr>';
    groupCount[g]++;
  }

  for (const key of Object.keys(DESIGNS)) {
    const n = (playerData.designs && playerData.designs[key]) || 0;
    if (n > 0) {
      const d = DESIGNS[key];
      const g = HANGAR_SHIP_GROUP[d.hull] || 'capital';
      const costTxt = d.cost ? ' (' + fmtISK(d.cost.isk) + ' Scrap Metals + ' + fmtISK(d.cost.items) + ' ore/components)' : '';
      groupRows[g] += '<tr><td>' + d.label.toUpperCase() + ' (BLUEPRINT)</td><td>' + n + '</td><td><button onclick="window.buildDesign(\'' + key + '\')">Build on ' + d.hull + costTxt + '</button></td></tr>';
      groupCount[g]++;
    }
  }
  for (const hull of Object.keys(playerData.builtHulls || {})) {
    if (!playerData.builtHulls[hull]) continue;
    const dk = Object.keys(DESIGNS).find(function (k) { return DESIGNS[k].hull === hull; });
    if (!dk) continue;
    const d = DESIGNS[dk];
    const g = HANGAR_SHIP_GROUP[hull] || 'capital';
    const aboard = playerShip && playerShip.className === hull;
    const action = aboard
      ? '<span style="color:#8b949e;">Aboard</span>'
      : '<button onclick="window.boardShip(\'' + hull + '\', ' + d.cargo + ', ' + d.speed + ')">Board</button>';
    groupRows[g] += '<tr><td>' + hull.toUpperCase() + ' (HULL)</td><td>1</td><td>' + action + '</td></tr>';
    groupCount[g]++;
  }

  const ownedHulls = new Set(['Mining Frigate']);
  (playerData.shipsOwned || []).forEach(function (n) { ownedHulls.add(n); });
  for (const name in SHIP_CATALOG) {
    const unlock = SHIP_CATALOG[name].unlock;
    if (unlock && playerData.unlockedShips && playerData.unlockedShips[unlock]) ownedHulls.add(name);
  }
  if (playerShip) ownedHulls.add(playerShip.className);
  for (const hull of ownedHulls) {
    const info = SHIP_CATALOG[hull];
    if (!info) continue;
    if (playerData.builtHulls && playerData.builtHulls[hull]) continue;
    const g = HANGAR_SHIP_GROUP[hull] || 'capital';
    const aboard = playerShip && playerShip.className === hull;
    const action = aboard
      ? '<span style="color:#8b949e;">Aboard</span>'
      : '<button onclick="window.boardShip(\'' + hull + '\', ' + info.cargo + ', ' + info.speed + ')">Board</button>';
    groupRows[g] += '<tr><td>' + hull.toUpperCase() + '</td><td>1</td><td>' + action + '</td></tr>';
    groupCount[g]++;
  }

  if ((playerData.transportManagerPurchased || 0) > 0) {
    groupRows.mining += corpOwnedRow('TRANSPORT MANAGER', 'Active (Logistics Online)');
    groupCount.mining++;
  }

  let hangarHtml = '';
  for (const g of ['ore', 'debris', 'explorer', 'mining', 'combat', 'capital']) {
    const body = groupRows[g] || '<tr><td colspan="3" style="text-align: center; color: #8b949e;">None</td></tr>';
    hangarHtml += '<tr><td colspan="3" style="padding: 0;"><details><summary style="cursor: pointer; font-weight: bold; color: #58a6ff; padding: 4px 2px;">' + HANGAR_GROUP_TITLES[g] + ' (' + groupCount[g] + ')</summary><table class="station-table">' + body + '</table></details></td></tr>';
  }
  if (playerData.chips > 0) {
    hangarHtml += '<tr><td>ITEM LEVEL CHIP</td><td>' + playerData.chips + '</td><td style="color:#8b949e;">Applied on drop</td></tr>';
  }

  let hangarEl = document.getElementById('items-hanger-list');
  if (hangarEl) hangarEl.innerHTML = hangarHtml;

  let hangarValue = 0;
  for (let itemKey in playerData.stationOre) {
    hangarValue += (playerData.stationOre[itemKey] || 0) * (itemPrices[itemKey] || 10);
  }
  let hangarValueEl = document.getElementById('hangar-value');
  if (hangarValueEl) hangarValueEl.innerText = 'HANGAR: ' + fmtISK(hangarValue) + ' Scrap Metals';

  let upgradesHtml = '';
  if (playerShip && playerShip.moduleLevels) {
    for (let mod in playerShip.moduleLevels) {
      let lvl = playerShip.moduleLevels[mod] || 1;
      let cap = getCap(mod);
      let atMax = lvl >= cap;
      let nextCost = atMax ? null : upgradeCostAt(lvl);
      let costText = nextCost ? fmtISK(nextCost) + ' Scrap Metals' : 'MAX';
      let levelText = 'Lv. ' + lvl + (cap > 5 ? ' / ' + cap : '');
      let chipBtn = '';
      upgradesHtml += '<tr><td>' + mod.toUpperCase() + '</td><td>' + levelText + '</td><td><button onclick="window.upgradeFrigateModule(\'' + mod + '\')" ' + (!nextCost ? 'disabled' : '') + '>Upgrade (' + costText + ')</button>' + chipBtn + '</td></tr>';
    }
  }
  let upgradesEl = document.getElementById('upgrades-list');
  if (upgradesEl) upgradesEl.innerHTML = upgradesHtml;
  if (typeof syncAutoplayButton === 'function') syncAutoplayButton();
}

var marketActiveTab = 'mining';
window.setMarketTab = function(tab) { marketActiveTab = tab; updateMarketUI(); };

function recipeHtml(recipe) {
  return recipe.map(function (entry) {
    const have = Math.floor((playerData.stationOre && playerData.stationOre[entry[0]]) || 0);
    const ok = have >= entry[1];
    return '<span style="color:' + (ok ? '#3fb950' : '#f85149') + ';">' +
      entry[1].toLocaleString() + ' ' + itemLabel(entry[0]) +
      ' <span style="color:#8b949e;">(have ' + have.toLocaleString() + ')</span></span>';
  }).join('<br>');
}

function marketShipRows(group) {
  const cur = playerShip ? playerShip.className : '';
  const unlocked = playerData.unlockedShips || {};
  const ships = [
    ['frigate', 'Mining Frigate', 200, 3.4, 'mining'],
    ['barge', 'Mining Barge', 1200, 4.2, 'mining'],
    ['command', 'Command Ship', 2500, 3.5, 'mining'],
    ['capital', 'Mining Capital', 100000, 1.6, 'mining'],
    ['combatFrigate', 'Combat Frigate', 800, 5.0, 'combat'],
    ['carrier', 'Carrier', 40000, 1.65, 'combat'],
    ['siegeCruiser', 'Siege Cruiser', 400, 2.6, 'combat'],
    ['siegeBattleship', 'Siege Battleship', 2000, 3.2, 'combat'],
    ['explorationFrigate', 'Exploration Frigate', 150, 6.0, 'explorer']
  ].filter(function (sh) {
    return sh[4] === group;
  }).map(function (sh) {
    return { key: sh[0], name: sh[1], cargo: sh[2], speed: sh[3], price: SHIP_PRICES[sh[0].toLowerCase()] || 0 };
  }).sort(function (a, b) { return a.price - b.price; });

  let h = '';
  for (const sh of ships) {
    const isCur = sh.name === cur;
    const owned = sh.price === 0 || !!unlocked[sh.key];
    const recipe = recipeFor(sh.key);
    let info, btn;
    if (owned) info = 'Built';
    else if (recipe) info = recipeHtml(recipe);
    else info = 'No recipe';
    if (isCur) {
      btn = '<button disabled>Active</button>';
    } else if (owned) {
      btn = '<button onclick="window.boardShip(\'' + sh.name + '\', ' + sh.cargo + ', ' + sh.speed + ')">Board</button>';
    } else {
      const canBuild = recipe && recipeShortfall(recipe).length === 0;
      btn = '<button onclick="window.buildShip(\'' + sh.key + '\', \'' + sh.name + '\')" ' + (canBuild ? '' : 'style="opacity:0.6;"') + '>Build</button>';
    }
    h += '<tr><td>' + sh.name + (isCur ? ' (current)' : '') + '</td><td style="font-size:12px;">' + info + '</td><td>' + btn + '</td></tr>';
  }

  if (group === 'mining') {
    const owned = (playerData.transportManagerPurchased || 0) > 0;
    h += '<tr><td>Transport Manager (corp)</td><td style="font-size:12px;">' +
      (owned ? 'Built' : recipeHtml(recipeFor('transportcapital'))) + '</td><td>' +
      (owned ? '<button disabled>Built</button>' : '<button onclick="window.buildTransportManager()">Build</button>') +
      '</td></tr>';
  }
  return h;
}

function marketItemRows(debris) {
  const stock = playerData.stationOre || {};
  const keys = Object.keys(itemPrices).filter(function (k) { return (k.indexOf('debris_') === 0) === debris; });
  keys.sort(function (a, b) { return itemPrices[a] - itemPrices[b]; });
  let h = '';
  for (const k of keys) {
    const price = itemPrices[k];
    const qty = Math.floor(stock[k] || 0);
    h += '<tr><td>' + itemLabel(k) + '</td><td>' + price + ' Scrap Metals/ea<br>Have ' + qty.toLocaleString() + '</td>' +
      '<td><button onclick="window.buyStationItem(\'' + k + '\', 100)" ' + (playerData.isk < price ? 'disabled' : '') + '>Buy 100</button>' +
      '<button onclick="window.buyStationItem(\'' + k + '\', 0)" ' + (playerData.isk < price ? 'disabled' : '') + '>Buy Max</button>' +
      '<button onclick="window.sellStationItem(\'' + k + '\', ' + price + ')" ' + (qty <= 0 ? 'disabled' : '') + '>Sell All</button></td></tr>';
  }
  return h || '<tr><td colspan="3" style="text-align:center;color:#8b949e;">None</td></tr>';
}

function updateMarketUI() {
  let el = document.getElementById('market-list');
  if (!el) return;
  const tabs = [['mining', 'MINING YARD'], ['combat', 'COMBAT YARD'], ['explorer', 'EXPLORER YARD'], ['ore', 'ORE'], ['debris', 'COMPONENTS']];
  let h = '<tr><td colspan="3" style="padding: 2px 0;">';
  for (const t of tabs) {
    const on = t[0] === marketActiveTab;
    h += '<button onclick="window.setMarketTab(\'' + t[0] + '\')" style="margin-right:4px;' + (on ? 'background:#1f6feb;color:#ffffff;' : '') + '">' + t[1] + '</button>';
  }
  h += '</td></tr>';
  h += (marketActiveTab === 'ore' || marketActiveTab === 'debris') ? marketItemRows(marketActiveTab === 'debris') : marketShipRows(marketActiveTab);
  el.innerHTML = h;
  if (typeof syncAutoplayButton === 'function') syncAutoplayButton();
}

function updateCorpUI() {
  let el = document.getElementById('corp-list');
  if (!el) return;
  let n = playerData.corpMembersPurchased || 0;
  let mineCost = 50000 * (n + 1);
  let hasExp = (playerData.explorationCorpPurchased || 0) > 0;
  let hasTransport = (playerData.transportManagerPurchased || 0) > 0;
  let explorerRows = '';
  const eb = botManager && botManager.bots ? botManager.bots.find(isExplorerBot) : null;
  if (eb) {
    if (eb.cruiserBuilt) {
      explorerRows = '<tr><td>Explorer Cruiser (corp)</td><td>Built and flying</td><td>-</td></tr>';
    } else if (!eb.hasCruiserBlueprint) {
      explorerRows = '<tr><td>Explorer Cruiser (corp)</td><td>Corp explorer hunting the blueprint (0.5% per relic)</td><td>-</td></tr>';
    } else {
      const haveIsk = eb.wallet || 0;
      const haveItems = botManager.stockValue(eb);
      explorerRows =
        '<tr><td>Explorer Cruiser (corp)</td><td>Blueprint held. Scrap Metals ' + fmtISK(haveIsk) + ' / ' + fmtISK(10000000) + ', ore &amp; components ' + fmtISK(haveItems) + ' / ' + fmtISK(10000000) + '</td>' +
        '<td><button onclick="window.donateCruiserIsk(1000000)">Donate 1m Scrap Metals</button> <button onclick="window.donateCruiserItems()">Donate all ore &amp; components</button></td></tr>';
    }
  }
  el.innerHTML =
    '<tr><td>Enthusiastic Rock Gobbler (1 ship)</td><td>' + (n * 1) + ' active</td><td><button onclick="window.buyCorpMember()" ' + (n >= 5 ? 'disabled' : '') + '>' + (n >= 5 ? 'MAX' : 'Hire (' + fmtISK(mineCost) + ' Scrap Metals)') + '</button></td></tr>' +
    '<tr><td>Exploration Frigate</td><td>' + (hasExp ? 'Active' : 'Not hired') + '</td><td><button onclick="window.buyExplorationCorp()" ' + (hasExp ? 'disabled' : '') + '>' + (hasExp ? 'Hired' : 'Hire (200,000 Scrap Metals)') + '</button></td></tr>' +
    '<tr><td>Transport Manager</td><td>' + (hasTransport ? 'Active (Logistics Online)' : 'Build it in the Shipyard') + '</td><td>-</td></tr>' +
    explorerRows +
    '<tr><td colspan="3" style="color:#8b949e;">Active members mine for you and pay random Scrap Metals dividends.</td></tr>';
}

function setText(id, text) { let el = document.getElementById(id); if (el) el.innerText = text; }
function setBar(id, v, max) {
  let el = document.getElementById(id);
  if (el) el.style.width = (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0) + '%';
}

function syncAutoplayButton() {
  const on = !!(autoplayManager && autoplayManager.isAutoplay);
  ['autoplay-btn', 'station-autoplay-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.background = on ? '#1f6feb' : '#21262d';
    btn.innerText = on ? 'AUTOPLAY: ON' : 'AUTOPLAY: OFF';
  });
}

function ensureAutoplayButton() {
  if (document.getElementById('autoplay-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'autoplay-btn';
  btn.innerText = 'AUTO: OFF';
  btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:5000;display:none;' +
    'background:#21262d;color:#d3dade;border:1px solid #3a525c;border-radius:4px;' +
    'padding:10px 14px;font-family:"Courier New", monospace;font-weight:bold;cursor:pointer;';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    window.toggleAutoplay();
  });
  document.body.appendChild(btn);
}

function updateHUD() {
  const s = playerShip;
  if (!s) return;
  setText('ui-pilot-name', playerData.pilotName);
  updatePilotPanel();
  // Keep the pilot profile compact: show total cargo only, not the ore breakdown.
  ensureOreCargo(s);
  setText('cargo-text', 'CARGO: ' + Math.floor(s.cargo || 0).toLocaleString() + ' / ' + Math.floor(s.maxCargo || 0).toLocaleString());
  setText('isk-text', 'Scrap Metals: ' + fmtISK(playerData.isk || 0));
  let sys = document.getElementById('system-text');
  if (sys) {
    sys.innerText = inPublicSpace() ? 'SYSTEM: PUBLIC PVP SPACE' : (inMissionSpace() && missionManager.activeMission ? 'SYSTEM: ' + missionManager.activeMission.systemName.toUpperCase() : 'SYSTEM: High-Sec 1.0');
    sys.style.color = inPublicSpace() ? '#f85149' : '#3fb950';
  }
  setBar('shield-fill', s.shield, s.maxShield);
  setBar('armor-fill', s.armor, s.maxArmor);
  setBar('structure-fill', s.structure, s.maxStructure);

  const isExp = isExplorerClass(s.className);
  const isCap = s.className === 'Mining Capital';

  let b;
  if ((b = document.getElementById('cloak-btn'))) b.style.display = isExp ? 'block' : 'none';
  if ((b = document.getElementById('PanicButton-btn'))) b.style.display = isExp ? 'block' : 'none';
  if ((b = document.getElementById('autoplay-btn'))) {
    b.style.display = canAutoplay(s.className) ? 'block' : 'none';
    syncAutoplayButton();
  }
  if ((b = document.getElementById('anchor-btn'))) {
    b.style.display = isCap ? 'block' : 'none';
    if (isCap) {
      b.innerText = s.cooldownTimer > 0 ? 'CORE: COOLDOWN' : (s.isAnchored ? 'CORE: ANCHORED' : 'CORE: UNANCHORED');
      b.style.background = s.isAnchored ? '#1f6feb' : '#21262d';
    }
  }
  if ((b = document.getElementById('dock-btn'))) b.style.display = (s.docked || inPublicSpace()) ? 'none' : 'block';
}

function drawMinimap() {
  if (!minimapCtx || !playerShip) return;
  const m = minimapCtx, size = 120, sc = size / currentWorldSize();
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.fillStyle = '#0d1117';
  m.fillRect(0, 0, size, size);
  m.fillStyle = '#6b7280';
  if (asteroidBelt && asteroidBelt.entities) {
    for (const r of asteroidBelt.entities) {
      if (r && r.oreYield > 0) m.fillRect(r.x * sc, r.y * sc, 1.5, 1.5);
    }
  }
  m.fillStyle = '#d29922';
  if (debrisField && debrisField.getEntities()) {
    for (const d of debrisField.getEntities()) {
      if (d) m.fillRect(d.x * sc - 1, d.y * sc - 1, 3, 3);
    }
  }
  if (inPublicSpace()) {
    if (mapManager && mapManager.playerGates) {
            for (const gate of mapManager.playerGates) {
        if (gate) {
          m.fillStyle = '#3fb950';
          m.fillRect(gate.x * sc - 2, gate.y * sc - 2, 4, 4);
        }
      }
    }
    m.fillStyle = '#f85149';
    if (publicNpcManager && publicNpcManager.publicNpcMiners) {
      for (const n of publicNpcManager.publicNpcMiners) {
        if (n && n.isAlive && n.ship) m.fillRect(n.ship.x * sc - 2, n.ship.y * sc - 2, 4, 4);
      }
    }
  } else if (inMissionSpace()) {
    if (mapManager && mapManager.missionReturnGate) {
      m.fillStyle = '#3fb950';
      m.beginPath();
      m.arc(mapManager.missionReturnGate.x * sc, mapManager.missionReturnGate.y * sc, 4, 0, Math.PI * 2);
      m.fill();
    }
    if (missionManager && missionManager.activeMission) {
      m.fillStyle = '#f85149';
      missionManager.getLivingEnemies().forEach(function(enemy) {
        m.fillRect(enemy.x * sc - 2, enemy.y * sc - 2, 4, 4);
      });
    }
  } else {
    if (mainStation) {
      m.fillStyle = '#58a6ff';
      m.fillRect(mainStation.x * sc - 3, mainStation.y * sc - 3, 6, 6);
    }
    if (mapManager && mapManager.publicGate) {
      m.fillStyle = '#f85149';
      m.fillRect(mapManager.publicGate.x * sc - 2, mapManager.publicGate.y * sc - 2, 4, 4);
    }
    if (missionManager && missionManager.activeMission && !missionManager.activeMission.returned &&
        mapManager && mapManager.missionEntryGate) {
      const gx = mapManager.missionEntryGate.x * sc;
      const gy = mapManager.missionEntryGate.y * sc;
      m.save();
      m.setLineDash([3, 2]);
      m.strokeStyle = 'rgba(52,211,153,0.75)';
      m.lineWidth = 1;
      m.beginPath();
      m.moveTo(playerShip.x * sc, playerShip.y * sc);
      m.lineTo(gx, gy);
      m.stroke();
      m.restore();
      m.fillStyle = '#34d399';
      m.beginPath();
      m.arc(gx, gy, 4, 0, Math.PI * 2);
      m.fill();
    }
  }
  m.fillStyle = '#ffffff';
  m.fillRect(playerShip.x * sc - 2, playerShip.y * sc - 2, 4, 4);
}

function manualControl() {
  const ship = playerShip;
  const pub = inPublicSpace();

  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  const usingKeys = dx !== 0 || dy !== 0;
  if (usingKeys) {
    const m = Math.hypot(dx, dy);
    targetMovePos = { x: ship.x + (dx / m) * 400, y: ship.y + (dy / m) * 400 };
    isDockingRequested = false;
    manualControl._wasKeys = true;
  } else if (manualControl._wasKeys) {
    manualControl._wasKeys = false;
    targetMovePos = null;
  }

  if (isDockingRequested && !pub && mainStation) {
    targetMovePos = { x: mainStation.x, y: mainStation.y };
    if (Math.hypot(ship.x - mainStation.x, ship.y - mainStation.y) < 150) {
      performDock();
      return;
    }
  } else if (targetMovePos && !usingKeys && Math.hypot(targetMovePos.x - ship.x, targetMovePos.y - ship.y) < 25) {
    targetMovePos = null;
  }

  if (targetMovePos && ship.isAnchored && ship.cooldownTimer <= 0 && typeof ship.toggleIndustrialCore === 'function') {
    ship.toggleIndustrialCore();
  }

  const cls = ship.className;
  const mines = cls !== 'Combat Frigate' && cls !== 'Carrier' && cls !== 'Siege Capital' && cls !== 'Siege Battleship' && cls !== 'Siege Cruiser';
  const full = (ship.cargo || 0) >= (ship.maxCargo || Infinity) - 0.5;
  if (usingKeys) lockedTarget = null;
  if (lockedTarget && !(lockedTarget.oreYield > 0)) lockedTarget = null;
  if (full && !fullWarned) { fullWarned = true; window.showCorpNotification('Cargo full - tap DOCK AT STATION to unload.'); }
  if (!full) fullWarned = false;

  let tgt = null;
  if (mines && !full && !targetMovePos) {
    const list = isExplorerClass(cls) ? (debrisField ? debrisField.getEntities() : []) : (asteroidBelt ? asteroidBelt.entities : []);
    tgt = isExplorerClass(cls) ? lockedTarget : (lockedTarget || nearestIn(list, ship.x, ship.y, 3000));
  }
  const enemies = pub && publicNpcManager && publicNpcManager.publicNpcMiners ? publicNpcManager.publicNpcMiners.filter(function(n) { return n && n.isAlive && n.ship; }).map(function(n) { return n.ship; }) : [];
  if (inMissionSpace() && missionManager) enemies.push.apply(enemies, missionManager.getLivingEnemies());
  const name = ship.className;

  if (name === 'Mining Capital' || name === 'Command Ship') {
    ship.update(targetMovePos, tgt, false, false, asteroidBelt);
  } else if (name === 'Carrier') {
    ship.update(targetMovePos, null, false, false, enemies);
  } else if (name === 'Combat Frigate' || name === 'Siege Capital' || name === 'Siege Battleship' || name === 'Siege Cruiser') {
    ship.update(targetMovePos, null, false, enemies, true);
  } else if (name === 'Improved Explorer Frigate' || name === 'Explorer Cruiser') {
    ship.update(targetMovePos, tgt, false);
    ship.updateGun(enemies);
  } else if (name === 'Exploration Frigate') {
    ship.update(targetMovePos, tgt, false);
  } else {
    ship.update(targetMovePos, tgt, false);
  }
}

function updateGame() {
  normalizeWrecks();
  const pub = inPublicSpace();
  if (window.Balance) window.Balance.applyAll(balancedShips());
  if (!pub && !inMissionSpace() && botManager) botManager.update(playerShip, asteroidBelt, debrisField);
  if (asteroidBelt) asteroidBelt.update();
  if (debrisField) debrisField.update();
  if (!inMissionSpace() && publicNpcManager) publicNpcManager.update(mapManager.currentMapId, playerShip, asteroidBelt, playerData, updateStationUI, saveGameSession);
  if (inMissionSpace() && missionManager) missionManager.updateMissionFleet(playerShip);
  if (!inMissionSpace() && window.SiegeCapital) window.SiegeCapital.update();

  if (pub) {
    if (window.centralStationBoss && window.centralStationBoss.structure <= 0 && !window.extractionCountdownActive) {
      window.extractionCountdownActive = true;
      window.extractionDeadline = Date.now() + EXTRACTION_SECONDS * 1000;
      window.extractionLastShown = EXTRACTION_SECONDS;
      const lootData = rewardBossKill();
      updateStationUI();
      saveGameSession();
      showExtractionLootModal(lootData);
      window.showCorpNotification('⚡ Station boss destroyed! Extracting in ' + EXTRACTION_SECONDS + ' seconds...');
    }

    if (window.extractionCountdownActive) {
      const remainingMs = window.extractionDeadline - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

      if (remainingSeconds <= 0) {
        window.extractionCountdownActive = false;
        window.extractionDeadline = null;
        window.extractionLastShown = null;
        window.showCorpNotification('Extraction complete! Teleporting back to High-Sec 1.0.');
        window.jumpToPrivateSec();
      } else if (remainingSeconds < window.extractionLastShown) {
        window.extractionLastShown = remainingSeconds;
        window.showCorpNotification('Extraction in: ' + remainingSeconds + 's');
      }
    }
  }

  if (playerShip && playerShip.docked && autoplayManager && autoplayManager.isAutoplay && autoUndockTimer > 0) {
    autoUndockTimer--;
    if (autoUndockTimer === 0) undockShip();
  }
  if (!playerShip || playerShip.docked) return;

  applyPilotTalents();
  if (typeof ShieldRegen !== 'undefined' && typeof ShieldRegen.update === 'function') {
    ShieldRegen.update(playerShip);
  }

  const cargoBeforePilotUpdate = Number(playerShip.cargo) || 0;
  if (!autoplayIsOn()) {
    const isCombat = ['Combat Frigate', 'Carrier', 'Siege Capital', 'Siege Battleship', 'Siege Cruiser'].includes(playerShip.className);
    if (targetMovePos || lockedTarget || isDockingRequested || manualControl._wasKeys || isCombat) {
      manualControl();
    } else {
      playerShip.vx = 0;
      playerShip.vy = 0;
    }
  } else {
    autoplayManager.belt = asteroidBelt;
    autoplayManager.debrisField = debrisField;
    autoplayManager.update(playerShip, asteroidBelt);
  }
  const minedByPlayer = Math.max(0, (Number(playerShip.cargo) || 0) - cargoBeforePilotUpdate);
  if (minedByPlayer > 0 && ['Mining Frigate','Mining Barge','Command Ship','Mining Capital'].includes(playerShip.className)) awardPlayerXP('mining', minedByPlayer / 100, 'Ore collected');
  if (playerShip.docked) return;

  const worldSize = currentWorldSize();
  playerShip.x = Math.max(50, Math.min(worldSize - 50, playerShip.x));
  playerShip.y = Math.max(50, Math.min(worldSize - 50, playerShip.y));

  if (gateCooldown > 0) gateCooldown--;
  else if (inMissionSpace()) {
    const g = mapManager && mapManager.missionReturnGate;
    if (g && Math.hypot(playerShip.x - g.x, playerShip.y - g.y) < g.radius) {
      if (missionManager.activeMission && !missionManager.activeMission.completed) {
        window.showCorpNotification('Mission incomplete. Destroy all pirate ships before using the return tear.');
        gateCooldown = 90;
      } else {
        if (missionManager.activeMission) missionManager.activeMission.returned = true;
        window.jumpToPrivateSec();
        // The return tear only brings the ship back into High-Sec. The pilot
        // must still fly to the station and dock before the reward is paid.
        playerShip.vx = 0; playerShip.vy = 0;
        const combatLoop = autoplayManager && autoplayManager.isAutoplay && autoplayManager.combatMode;
        if (combatLoop) {
          autoplayManager.combatPhase = 'docking';
          targetMovePos = { x: mainStation.x, y: mainStation.y };
          window.showCorpNotification('Mission complete. Autopilot is flying back to the station to dock and collect your reward.');
        } else {
          targetMovePos = null;
          window.showCorpNotification('Returned to High-Sec. Fly back to the station and dock to claim your mission reward.');
        }
        updateMissionsUI();
        saveGameSession();
      }
    }
  } else if (!pub) {
    const mg = mapManager && mapManager.missionEntryGate;
    if (missionManager.activeMission && mg && Math.hypot(playerShip.x - mg.x, playerShip.y - mg.y) < mg.radius) window.jumpToMissionSystem();
    else {
      const g = mapManager ? mapManager.publicGate : null;
      if (g && Math.hypot(playerShip.x - g.x, playerShip.y - g.y) < g.radius) window.jumpToPublicSpace(0);
    }
  } else {
    if (mapManager && mapManager.playerGates) {
      for (let gate of mapManager.playerGates) {
        if (gate && Math.hypot(playerShip.x - gate.x, playerShip.y - gate.y) < gate.radius) { window.jumpToPrivateSec(); break; }
      }
    }
  }

  if (playerShip.structure <= 0) window.handlePlayerDeath();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  const ship = playerShip;
  if (!ship) return;
  const camX = ship.x, camY = ship.y;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (backgroundDecor && typeof backgroundDecor.draw === 'function') {
    backgroundDecor.draw(ctx, -camX, -camY, W / dpr, H / dpr);
  }

  const z = cameraZoom * dpr;
  ctx.setTransform(z, 0, 0, z, W / 2 - camX * z, H / 2 - camY * z);
  const hw = W / 2 / z, hh = H / 2 / z;
  const view = { x1: camX - hw - 200, x2: camX + hw + 200, y1: camY - hh - 200, y2: camY + hh + 200 };
  const pub = inPublicSpace();

  if (inMissionSpace()) {
    if (mapManager && mapManager.missionReturnGate) mapManager.missionReturnGate.draw(ctx);
  } else if (!pub) {
    if (mainStation && typeof mainStation.draw === 'function') mainStation.draw(ctx);
    if (mapManager && mapManager.publicGate && typeof mapManager.publicGate.draw === 'function') mapManager.publicGate.draw(ctx);
    if (missionManager && missionManager.activeMission && !missionManager.activeMission.returned && mapManager.missionEntryGate) mapManager.missionEntryGate.draw(ctx);
  } else {
    if (mapManager && mapManager.playerGates) {
      for (let gate of mapManager.playerGates) {
        if (gate && typeof gate.draw === 'function') gate.draw(ctx);
      }
    }
  }
  if (asteroidBelt && typeof asteroidBelt.draw === 'function') asteroidBelt.draw(ctx, view);
  if (debrisField && typeof debrisField.draw === 'function') debrisField.draw(ctx);

  if (!pub && !inMissionSpace() && botManager && typeof botManager.draw === 'function') botManager.draw(ctx, asteroidBelt, debrisField);
  if (!inMissionSpace() && publicNpcManager && typeof publicNpcManager.draw === 'function') publicNpcManager.draw(ctx, mapManager.currentMapId, asteroidBelt);
  if (inMissionSpace() && missionManager) missionManager.drawMissionFleet(ctx);

  if (!ship.docked && typeof ship.draw === 'function') {
    const cargoBeforeDraw = Number(ship.cargo) || 0;
    ship.draw(ctx, asteroidBelt);
    const minedDuringDraw = Math.max(0, (Number(ship.cargo) || 0) - cargoBeforeDraw);
    if (minedDuringDraw > 0 && ['Mining Frigate','Mining Barge'].includes(ship.className)) awardPlayerXP('mining', minedDuringDraw / 100, 'Ore mined');
  }
  if (!inMissionSpace() && window.SiegeCapital) window.SiegeCapital.draw(ctx);

  const rt = !ship.docked && ship.currentTarget;
  if (rt && rt.oreYield > 0) {
    const locked = rt === lockedTarget;
    const pulse = 1 + Math.sin(frameCount * 0.15) * 0.06;
    ctx.save();
    ctx.strokeStyle = locked ? '#facc15' : '#58a6ff';
    ctx.lineWidth = 3 / cameraZoom;
    ctx.setLineDash([10 / cameraZoom, 8 / cameraZoom]);
    ctx.beginPath();
    ctx.arc(rt.x, rt.y, ((rt.radius || 40) + 14) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (targetMovePos && !ship.docked) {
    ctx.save();
    ctx.strokeStyle = 'rgba(88,166,255,0.7)';
    ctx.lineWidth = 3 / cameraZoom;
    ctx.beginPath();
    ctx.arc(targetMovePos.x, targetMovePos.y, 18 / cameraZoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

let frameCount = 0;
function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!ctx || !playerShip) return;
  try {
    updateGame();
    render();
    frameCount++;
    if (frameCount % 5 === 0) { updateHUD(); drawMinimap(); }
    if (frameCount % 900 === 0) saveGameSession();
  } catch (err) {
    if (!gameLoop._warned || frameCount % 300 === 0) { console.error('Game loop error:', err && err.stack ? err.stack : err); gameLoop._warned = true; }
  }
}

loadGameSession();

const _setupModal = document.getElementById('setup-modal');
if (_setupModal && playerData.pilotName && playerData.race) _setupModal.style.display = 'none';

let _stationUi = document.getElementById('station-ui');
if (_stationUi) _stationUi.style.display = 'none';
if (playerShip) {
  playerShip.x = mainStation.x + 250;
  playerShip.y = mainStation.y + 250;
}
updateStationUI();
updateCorpUI();
updateMissionsUI();
ensureAutoplayButton();
gameLoop();
// ONLINE MULTIPLAYER: expose the current map
window.getMiniSpaceMapId = function() {
  return mapManager?.currentMapId || 'private_highsec';
};

// MISSION DEATH FIX
// Failing a mission on death clears the ship-change lock.
window.handlePlayerDeath = function() {
  let destroyed = playerShip ? playerShip.className : 'Ship';

  if (missionManager && missionManager.activeMission) {
    window.showCorpNotification('Ship destroyed! Mission failed. You can choose another ship and try again.');
    missionManager.activeMission = null;
    missionManager.generateMissions();
  } else {
    window.showCorpNotification(destroyed + ' and its upgrades destroyed! Returning to base.');
  }

  playerData.activeMission = null;

  if (playerData.upgrades) delete playerData.upgrades[destroyed];
  if (playerData.hullDesigns) delete playerData.hullDesigns[destroyed];
  if (playerData.builtHulls) delete playerData.builtHulls[destroyed];

  if (playerShip) playerShip.moduleLevels = {};

  playerShip = sessionManager.setShipClass(playerShip, 'Mining Frigate', 200, 3.4);
  applyDesign(playerShip);
  playerShip.cargo = 0;
  playerShip.structure = playerShip.maxStructure;
  playerShip.docked = false;

  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();

  window.jumpToPrivateSec();
  performDock();

  updateMissionsUI();
  saveGameSession();
};

// RESTORE SAVED SHIP POSITION AFTER STARTUP
if (window.MINISPACE_SAVED_POSITION && playerShip) {
  const saved = window.MINISPACE_SAVED_POSITION;

  playerShip.x = saved.x;
  playerShip.y = saved.y;
  playerShip.vx = saved.vx;
  playerShip.vy = saved.vy;
  playerShip.angle = saved.angle;
  playerShip.docked = saved.docked;
}
