// MainGameController.js - Unified Game Loop & State Manager (complete)
var playerShip = null;
var mainStation = null;
var asteroidBelt = null;
var debrisField = null;
var botManager = null;
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
    if (ship === playerShip) refreshCargoCounter(true);
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
    if (ship === playerShip) refreshCargoCounter(true);
  }
  return removed;
}
window.ensureOreCargo = ensureOreCargo;
window.addOreToCargo = addOreToCargo;
window.removeOreFromCargo = removeOreFromCargo;

window.addEventListener('minispace-gm-teleport',function(event){
  const data=event.detail||{};
  if(!playerShip||!mapManager||data.mapId!==mapManager.currentMapId)return;
  playerShip.x=Number(data.x)||0;
  playerShip.y=Number(data.y)||0;
  playerShip.vx=0;playerShip.vy=0;
  playerShip.docked=false;
  targetMovePos=null;lockedTarget=null;isDockingRequested=false;
  if(typeof saveGameSession==='function')saveGameSession();
  if(window.showCorpNotification)window.showCorpNotification('GM teleport: arrived near '+String(data.name||'target pilot')+'.');
});
window.addEventListener('minispace-gm-unstick',function(event){
  if(!playerShip||!mainStation||typeof window.jumpToPrivateSec!=='function')return;
  window.jumpToPrivateSec();
  playerShip.docked=false;
  playerShip.x=mainStation.x+250;
  playerShip.y=mainStation.y+250;
  playerShip.vx=0;playerShip.vy=0;
  targetMovePos=null;lockedTarget=null;isDockingRequested=false;
  const stationUi=document.getElementById('station-ui');
  if(stationUi)stationUi.style.display='none';
  if(typeof saveGameSession==='function')saveGameSession();
  if(window.showCorpNotification)window.showCorpNotification(event.detail?.message||'A Game Master returned your ship to Private High-Sec.');
});

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
  progression: { xp: 0, level: 1, skillPoints: 0, spent: { combat: {}, mining: {} } },
  offensiveMode: false
};

mainStation = new SpaceStation(WORLD_SIZE / 2, 700, 'Private High-Sec 1.0'); // top middle of the High-Sec map
var homeStation = mainStation;
window.MINISPACE_FRONTIER_STATION = null;
asteroidBelt = new AsteroidBelt(2500, 3800, 150, WORLD_SIZE);
asteroidBelt.generate(150, ['veldspar', 'scordite']);
debrisField = new DebrisField(2500, 3800, 3, WORLD_SIZE);
botManager = new BotManager(playerData, mainStation, asteroidBelt, debrisField);
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

function isFrontierSpace() { return !!(mapManager && String(mapManager.currentMapId).indexOf('frontier_') === 0); }
function inPublicSpace() { return !!(mapManager && (mapManager.currentMapId === 'public_space' || isFrontierSpace())); }
function inMissionSpace() { return !!(mapManager && String(mapManager.currentMapId).indexOf('mission_') === 0); }
function autoplayIsOn() { return !!(autoplayManager && autoplayManager.isAutoplay); }

window.addEventListener('minispace-pvp-hit', function(event) {
  const hit = event && event.detail;
  if (!hit || !playerShip || !mapManager || hit.mapId !== mapManager.currentMapId || playerShip.docked) return;
  playerShip.shield = Math.max(0, Number(hit.shield) || 0);
  playerShip.armor = Math.max(0, Number(hit.armor) || 0);
  playerShip.structure = Math.max(0, Number(hit.structure) || 0);
  if (playerShip.structure <= 0) window.showCorpNotification('Your ship was destroyed by another pilot.');
});

function getRemotePvpTargets() {
  const online = window.MinispaceOnline && window.MinispaceOnline.state;
  const remote = online && online.remotePlayers;
  if (!remote || !mapManager) return [];
  const cache = window._miniSpacePvpTargets || (window._miniSpacePvpTargets = Object.create(null));
  const active = new Set(), targets = [];
  Object.values(remote).forEach(p => {
    if (!p || !p.id || p.id === online.id || p.mapId !== mapManager.currentMapId || p.pvp === false || p.docked) return;
    const rawStructure = Number(p.structure);
    const structure = Number.isFinite(rawStructure) ? Math.max(0, rawStructure) : Math.max(1, Number(p.maxStructure) || 1000);
    if (structure <= 0) return;
    active.add(p.id);
    let proxy = cache[p.id];
    if (!proxy) {
      proxy = {
        takeDamage: function(amount) {
          const damage = Math.max(0, Math.min(500, Number(amount) || 0));
          const now = Date.now();
          if (!damage || now - (this._lastPvpSend || 0) < 120) return;
          this._lastPvpSend = now;
          if (window.MinispaceOnline && typeof window.MinispaceOnline.send === 'function') {
            window.MinispaceOnline.send({ type: 'pvp-damage', targetId: this._targetId, mapId: this._mapId, damage: damage });
          }
        }
      };
      cache[p.id] = proxy;
    }
    Object.assign(proxy, {
      _targetId: p.id, _mapId: p.mapId,
      x: Number(p.x) || 0, y: Number(p.y) || 0,
      angle: Number(p.angle) || 0,
      shield: Math.max(0, Number(p.shield) || 0),
      armor: Math.max(0, Number(p.armor) || 0),
      structure: structure,
      maxShield: Number(p.maxShield) || 0,
      maxArmor: Number(p.maxArmor) || 0,
      maxStructure: Number(p.maxStructure) || structure,
      className: p.ship || 'Pilot Ship',
      pilotName: p.name || 'Pilot',
      isPlayerPilot: true,
      isPirate: false,
      docked: !!p.docked
    });
    targets.push(proxy);
  });
  Object.keys(cache).forEach(id => {
    if (!active.has(id)) { cache[id].structure = 0; delete cache[id]; }
  });
  return targets;
}
function balancedShips() {
  const list = [playerShip];
  if (botManager && botManager.bots) botManager.bots.forEach(b => list.push(b.ship));
  if (publicNpcManager && publicNpcManager.publicNpcMiners) publicNpcManager.publicNpcMiners.forEach(n => {
    if (n && n.ship && (n.mapId ? n.mapId === mapManager.currentMapId : mapManager.currentMapId === 'public_space')) list.push(n.ship);
  });
  return list.filter(Boolean);
}
function currentWorldSize() { return mapManager && String(mapManager.currentMapId).indexOf('frontier_') === 0 ? 9000 : (inPublicSpace() ? PUBLIC_SIZE : (inMissionSpace() ? 7000 : WORLD_SIZE)); }

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

function fittedModuleBonusPercent(slot, rank, rarity) {
  const scale = ({white:1,green:1.1,blue:1.2,purple:1.3})[String(rarity||'white').toLowerCase()] || 1;
  const perRank = slot === 'shieldRecharge' ? 1 : 1.5;
  return Math.max(0, Number(rank)||1) * perRank * scale;
}
function fittedModuleBonusLabel(slot, rank, rarity) {
  const pct = fittedModuleBonusPercent(slot, rank, rarity), half = pct * 0.5;
  const one = n => '+' + n.toFixed(1) + '%';
  if (['laser','guns','missiles'].includes(slot)) return 'Damage ' + one(pct) + ' · Range ' + one(half);
  if (['shield','shieldPlating','shieldExtender'].includes(slot)) return 'Shield / armour ' + one(pct);
  if (slot === 'shieldRecharge') return 'Shield recharge ' + one(pct);
  if (slot === 'resistance') return 'Damage resistance ' + one(pct);
  if (slot === 'cargo') return 'Cargo capacity ' + one(pct);
  if (slot === 'propulsion') return 'Top speed ' + one(pct * 0.65);
  if (['droneTether','dronesTether'].includes(slot)) return 'Drone range ' + one(pct);
  if (slot === 'scrambler') return 'Scrambler range ' + one(pct) + ' · Slow strength +' + one(pct * 0.1);
  if (slot === 'hacking') return 'Hacking / scan power ' + one(pct);
  if (slot === 'cloaking') return 'Cloak duration ' + one(pct);
  return 'Module bonus ' + one(pct);
}
function shipFittingHp(ship) {
  if (!ship) return 0;
  return Math.round(['maxShield','maxArmor','maxStructure'].reduce((sum,key)=>sum+Math.max(0,Number(ship[key])||0),0) || Number(ship.maxHp)||Number(ship.maxHealth)||0);
}
function shipFittingDps(ship) {
  if (!ship) return 0;
  if (ship.className === 'Siege Battleship') return Math.round(800 * (Number(ship._fittedDamageMultiplier)||1));
  if (ship.className === 'Siege Cruiser' && typeof ship.gunDamage === 'function') {
    const mounts = Array.isArray(ship.guns) ? ship.guns.length : 1;
    return Math.round(ship.gunDamage() * mounts * 0.8);
  }
  if (Number.isFinite(Number(ship.weaponDps || ship.dps || ship.damagePerSecond))) return Math.round(Number(ship.weaponDps || ship.dps || ship.damagePerSecond));
  if (Number.isFinite(Number(ship.missileDamage))) return Math.round(Number(ship.missileDamage) * 0.13 * 60);
  if (Number.isFinite(Number(ship.weaponDamage))) return Math.round(Number(ship.weaponDamage));
  if (Array.isArray(ship.drones)) return Math.round(ship.drones.reduce((sum,entry)=>{const d=entry&&(entry.ship||entry);return sum+(d&&Number(d.missileDamage)||0)*0.13*60;},0));
  return 0;
}
function applyFittedModuleBonuses(ship) {
  const fitted = ship && ship.fittedModules || {};
  let fittedDamageMultiplier = 1;
  ship._fittedResistanceMultiplier = 1;
  ship._fittedShieldRechargeMultiplier = 1;
  Object.keys(fitted).forEach(function(slot) {
    const mod = fitted[slot]; if (!mod) return;
    const rank = Math.max(1, Math.min(10, Number(mod.rank) || 1));
    const rarity = String(mod.rarity || 'white').toLowerCase();
    const scale = ({white:1,green:1.1,blue:1.2,purple:1.3})[rarity] || 1;
    const bonus = 1 + rank * 0.015 * scale;
    if (slot === 'resistance') {
      ship._fittedResistanceMultiplier = bonus;
      if (Number.isFinite(Number(ship.damageResistance))) ship.damageResistance = Math.min(0.75, ship.damageResistance * bonus);
    }
    if (slot === 'shieldRecharge') {
      const rechargeBonus = 1 + rank * 0.01 * scale;
      ship._fittedShieldRechargeMultiplier = Math.min(1.15, rechargeBonus);
      if (Number.isFinite(Number(ship.shieldRechargeRate))) ship.shieldRechargeRate *= Math.min(1.15, rechargeBonus);
    }
    if (['laser','guns','missiles'].includes(slot)) {
      fittedDamageMultiplier *= bonus;
      ['miningPower','missileDamage','weaponDamage','gunDamage'].forEach(k=>{if(Number.isFinite(Number(ship[k])))ship[k]*=bonus;});
      ['laserRange','weaponRange','scramblerRange'].forEach(k=>{if(Number.isFinite(Number(ship[k])))ship[k]*=1+(bonus-1)*0.5;});
    } else if (['shield','shieldPlating','shieldExtender'].includes(slot)) {
      ['maxShield','maxArmor'].forEach(k=>{if(Number.isFinite(Number(ship[k])))ship[k]*=bonus;});
      if (Number.isFinite(Number(ship.shield))) ship.shield=Math.min(ship.maxShield||ship.shield,ship.shield*bonus);
    } else if (slot==='cargo') {
      if(Number.isFinite(Number(ship.maxCargo)))ship.maxCargo*=bonus;
    } else if (slot==='propulsion') {
      if(Number.isFinite(Number(ship.maxSpeed)))ship.maxSpeed*=1+(bonus-1)*0.65;
    } else if (['droneTether','dronesTether'].includes(slot)) {
      ['droneRange','droneTetherRange','tetherRange'].forEach(k=>{if(Number.isFinite(Number(ship[k])))ship[k]*=bonus;});
    } else if (slot==='scrambler') {
      if(Number.isFinite(Number(ship.scramblerRange)))ship.scramblerRange*=bonus;
      if(Number.isFinite(Number(ship.slowFactor)))ship.slowFactor=Math.min(0.98,ship.slowFactor+(bonus-1)*0.1);
    } else if (slot==='hacking') {
      if(Number.isFinite(Number(ship.hackSpeed)))ship.hackSpeed*=bonus;
      if(Number.isFinite(Number(ship.scanPower)))ship.scanPower*=bonus;
    } else if (slot==='cloaking') {
      if(Number.isFinite(Number(ship.cloakDuration)))ship.cloakDuration*=bonus;
    }
  });
  ship._fittedDamageMultiplier = fittedDamageMultiplier;
}
function applyDesign(ship) {
  if (!ship) return;
  if (window.Races) window.Races.tag(ship);
  if (typeof ship.applyStats === 'function') ship.applyStats();
  const key = playerData.hullDesigns ? playerData.hullDesigns[ship.className] : null;
  const d = key ? DESIGNS[key] : null;
  if (d && ship.className === d.hull) {
    if (d.bonus.cargo) ship.maxCargo = (ship.maxCargo || 0) * d.bonus.cargo;
    if (d.bonus.speed) ship.maxSpeed = (ship.maxSpeed || 0) * d.bonus.speed;
    if (d.bonus.shield) {
      ship.maxShield = (ship.maxShield || 0) * d.bonus.shield;
      ship.shield = ship.maxShield;
    }
  }
  applyFittedModuleBonuses(ship);
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
  playerData.lastKnownLocation = {
    mapId: mapManager && mapManager.currentMapId || 'private_highsec',
    x: playerShip ? Number(playerShip.x) || 0 : 0,
    y: playerShip ? Number(playerShip.y) || 0 : 0,
    angle: playerShip ? Number(playerShip.angle) || 0 : 0,
    docked: playerShip ? !!playerShip.docked : false,
    savedAt: Date.now()
  };
  sessionManager.save(playerData, playerShip);
  if (typeof window.MINISPACE_SAVE_CLOUD === 'function') {
    window.MINISPACE_SAVE_CLOUD();
  }
}

function loadGameSession() {
  playerShip = sessionManager.load(playerData, botManager, playerShip);
  if (!playerData.upgrades) playerData.upgrades = {};
  if (!Array.isArray(playerData.moduleDrops)) playerData.moduleDrops = [];
  if (typeof playerData.offensiveMode !== 'boolean') playerData.offensiveMode = false;
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
  if (!playerData.fittedModules || typeof playerData.fittedModules !== 'object') playerData.fittedModules = {};
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
    playerShip.fittedModules = Object.assign({}, playerData.fittedModules[playerShip.className] || playerShip.fittedModules || {});
    applyDesign(playerShip);
    cleanModules(playerShip);
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


// Screen-space jump animation: a teal/blue tunnel, expanding rings and a short arrival flash.
window.startMiniSpaceJumpEffect = function() {
  window.MINISPACE_JUMP_EFFECT = { startedAt: Date.now(), duration: 1050 };
};
function drawMiniSpaceJumpEffect(context, width, height) {
  const effect = window.MINISPACE_JUMP_EFFECT;
  if (!effect) return;
  const elapsed = Date.now() - effect.startedAt;
  const progress = Math.max(0, Math.min(1, elapsed / effect.duration));
  if (progress >= 1) { window.MINISPACE_JUMP_EFFECT = null; return; }
  const cx = width / 2, cy = height / 2;
  const tunnel = Math.sin(progress * Math.PI);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.globalAlpha = Math.min(0.82, tunnel * 0.9 + (progress < 0.16 ? 0.2 : 0));
  const wash = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.72);
  wash.addColorStop(0, 'rgba(90,220,255,0.03)');
  wash.addColorStop(0.55, 'rgba(20,145,205,' + (0.10 * tunnel) + ')');
  wash.addColorStop(1, 'rgba(4,18,45,' + (0.32 * tunnel) + ')');
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
  const maxRadius = Math.hypot(width, height) * 0.72;
  for (let i = 0; i < 7; i++) {
    const phase = (progress * 1.45 + i / 7) % 1;
    const radius = 18 + phase * maxRadius;
    context.globalAlpha = (1 - phase) * tunnel * 0.8;
    context.strokeStyle = i % 2 ? '#39d9ff' : '#b5f7ff';
    context.lineWidth = 1.5 + (1 - phase) * 3;
    context.beginPath();
    context.ellipse(cx, cy, radius, radius * 0.58, 0, 0, Math.PI * 2);
    context.stroke();
  }
  // Radial streaks rush away from the centre, creating a jump-tunnel sensation.
  context.globalAlpha = tunnel * 0.52;
  context.lineWidth = 1.4;
  for (let i = 0; i < 44; i++) {
    const angle = i * Math.PI * 2 / 44;
    const inner = 24 + ((i * 37) % 95);
    const outer = Math.min(maxRadius, inner + 45 + tunnel * 190);
    context.strokeStyle = i % 3 ? 'rgba(72,205,255,0.8)' : 'rgba(220,250,255,0.95)';
    context.beginPath();
    context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    context.stroke();
  }
  // Brief white-blue arrival flash.
  if (progress > 0.78) {
    context.globalAlpha = Math.pow((progress - 0.78) / 0.22, 2) * 0.42;
    context.fillStyle = '#c9f7ff';
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}

window.jumpToFrontierSystem = function(id) {
  if (!playerShip || (missionManager && missionManager.activeMission)) { window.showCorpNotification('Finish your active mission before entering the frontier.'); return; }
  const current = mapManager.currentMapId;
  const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === id);
  const allowed = current === 'private_highsec' ? !!(system && system.ring === 1) :
    (isFrontierSpace() && (window.MINISPACE_UNIVERSE_SYSTEMS || []).some(s => s.id === current && s.links.includes(id)));
  if (!allowed) { window.showCorpNotification('Fly through a connected space gate to reach that system.'); return; }
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  window.startMiniSpaceJumpEffect();
  const r = mapManager.jumpToFrontierSystem(playerShip, id); if (!r) { window.MINISPACE_JUMP_EFFECT = null; return; }
  asteroidBelt = r.asteroidBelt; debrisField = r.debrisField;
  mainStation = r.station || mapManager.frontierStation || homeStation;
  window.MINISPACE_FRONTIER_STATION = mainStation;
  targetMovePos = null; lockedTarget = null; isDockingRequested = false; gateCooldown = 180;
  if (publicNpcManager) publicNpcManager.initFrontierSystem(r.system, mainStation);
  const destination = window._universeRouteDestination;
  if (destination) {
    if (destination === id) { window._universeRouteDestination = null; window._universeTargetNextHop = null; window.showCorpNotification('Arrived at destination: ' + r.system.name + '.'); }
    else {
      const path = window.findFrontierRoute(id, destination), next = path && path[1];
      window._universeTargetNextHop = next || null;
      // Keep the plotted destination as navigation guidance only. The pilot
      // must fly to each highlighted tear and choose when to jump.
      if (!next) window._universeRouteDestination = null;
    }
  }
  window.showCorpNotification('Warp complete: ' + r.system.name + ' · ' +
    (r.system.lossMode === 'no-loss' ? 'PROTECTED PvP · NO SHIP LOSS' : 'FULL-LOOT PvP') +
    ' · clear station guards to dock.');
  if (typeof saveGameSession === 'function') saveGameSession();
  window.closeUniverse();
};
window.findFrontierRoute = function(from, to) {
  const systems = window.MINISPACE_UNIVERSE_SYSTEMS || [];
  const homeGateSystemId = mapManager && mapManager.frontierHomeGateSystemId;
  const linksFor = id => id === 'private_highsec' ? (homeGateSystemId ? [homeGateSystemId] : []) :
    (((systems.find(s => s.id === id) || {}).links || []).filter(next => next !== 'private_highsec' || id === homeGateSystemId));
  const queue = [[from]], seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift(), last = path[path.length - 1];
    if (last === to) return path;
    linksFor(last).forEach(next => { if (!seen.has(next)) { seen.add(next); queue.push(path.concat(next)); } });
  }
  return null;
};
try {
  window._universeTargetSystemId = window._universeTargetSystemId || localStorage.getItem('minispace_universe_target') || window._universeRouteDestination || null;
} catch (_) {}
window.refreshUniverseTargetRoute = function() {
  const target = window._universeTargetSystemId;
  if (!target || !mapManager) {
    window._universeTargetNextHop = null;
    return null;
  }
  const current = mapManager.currentMapId === 'private_highsec' ? 'private_highsec' : mapManager.currentMapId;
  const path = window.findFrontierRoute(current, target);
  window._universeTargetNextHop = path && path.length > 1 ? path[1] : null;
  return path;
};
window.setUniverseTargetSystem = function(destinationId) {
  const valid = destinationId === 'private_highsec' || (window.MINISPACE_UNIVERSE_SYSTEMS || []).some(s => s.id === destinationId);
  if (!valid) return;
  if (window._universeTargetSystemId === destinationId) {
    window._universeTargetSystemId = null;
    window._universeRouteDestination = null;
    window._universeTargetNextHop = null;
    try { localStorage.removeItem('minispace_universe_target'); } catch (_) {}
    if (typeof window.showCorpNotification === 'function') window.showCorpNotification('SYSTEM TARGET CLEARED');
  } else {
    window._universeTargetSystemId = destinationId;
    window._universeRouteDestination = destinationId;
    try { localStorage.setItem('minispace_universe_target', destinationId); } catch (_) {}
    const path = window.refreshUniverseTargetRoute();
    const target = destinationId === 'private_highsec' ? null : (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === destinationId);
    if (typeof window.showCorpNotification === 'function') {
      window.showCorpNotification('SYSTEM TARGET SET · ' + (target ? target.name : 'HIGH-SEC 1.0') +
        (path && path.length > 1 ? ' · next tear highlighted' : ' · you are there'));
    }
  }
  if (typeof window.openUniverse === 'function') window.openUniverse();
  if (typeof updateNearbySpacePanel === 'function') updateNearbySpacePanel();
};
window.flyToFrontierGate = function(destinationId) {
  if (!playerShip || !mapManager) return;
  const current = mapManager.currentMapId, systems = window.MINISPACE_UNIVERSE_SYSTEMS || [];
  if (destinationId !== 'private_highsec' && !systems.some(s => s.id === destinationId)) { window.showCorpNotification('Unknown system destination.'); return; }
  if (current === destinationId) { window.closeUniverse(); return; }
  const path = window.findFrontierRoute(current === 'private_highsec' ? 'private_highsec' : current, destinationId);
  if (!path || path.length < 2) { window.showCorpNotification('No gate route to that system.'); return; }
  const nextHop = path[1];
  const gate = current === 'private_highsec' ?
    (mapManager.frontierEntryGates || []).find(g => g.destinationId === nextHop) :
    (nextHop === 'private_highsec' ? mapManager.frontierReturnGate : (mapManager.frontierGates || []).find(g => g.destinationId === nextHop));
  if (!gate) { window.showCorpNotification('The next physical gate is unavailable.'); return; }
  window._universeRouteDestination = destinationId;
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  lockedTarget = null; targetMovePos = { x: gate.x, y: gate.y }; isDockingRequested = false;
  window.closeUniverse();
  window.showCorpNotification('ROUTE SET · ' + (destinationId === 'private_highsec' ? 'HIGH-SEC' : destinationId.replace('frontier_','').toUpperCase()) +
    ' · flying to ' + (nextHop === 'private_highsec' ? 'HIGH-SEC' : nextHop.replace('frontier_','').toUpperCase()) + ' gate.');
};
window.hotDropMiningFleet = function(sightingId) {
  if (!playerShip || !mapManager || !publicNpcManager || !botManager) return;
  if (!(Number(playerData.explorationCorpPurchased) > 0)) {
    window.showCorpNotification('A Corp Explorer is required to locate mining fleets.');
    return;
  }
  const sightings = publicNpcManager.getExplorerFleetSightings(true);
  const sighting = sightings.find(s => s.id === sightingId);
  if (!sighting || sighting.expiresAt <= Date.now() || sighting.dispatched || sighting.spawned) {
    window.showCorpNotification('Explorer ping expired · waiting for a fresh scan.');
    window.openUniverse();
    return;
  }
  const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === sighting.systemId);
  if (!system) return;
  const dispatch = botManager.dispatchExplorerToFleet(sighting, system);
  if (!dispatch || !dispatch.success) {
    window.showCorpNotification(dispatch && dispatch.message ? dispatch.message : 'Corp Explorer could not accept the dispatch.');
    return;
  }
  publicNpcManager.spawnExplorerMiningFleet(system, sighting);
  sighting.dispatched = true;
  window.closeUniverse();
  window.showCorpNotification('CORP EXPLORER DISPATCHED · ' + system.name + ' · cloaked transit. You will be reinforced when Panic Button activates.');
  saveGameSession();
};

window.onCorpExplorerPanicHotDrop = function(bot) {
  if (!bot || !bot.ship || !bot.explorerMission || !playerShip || !mapManager) return;
  const mission = bot.explorerMission;
  const destinationId = mission.targetSystemId;
  if (!destinationId || mission.playerReinforced) return;
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  const arrival = mapManager.jumpToFrontierSystem(playerShip, destinationId);
  if (!arrival) {
    window.showCorpNotification('TACTICAL REINFORCEMENT delayed · unable to open the Explorer system.');
    return;
  }
  asteroidBelt = arrival.asteroidBelt;
  debrisField = arrival.debrisField;
  mainStation = arrival.station || mapManager.frontierStation || homeStation;
  window.MINISPACE_FRONTIER_STATION = mainStation;
  if (publicNpcManager) publicNpcManager.initFrontierSystem(arrival.system, mainStation);
  playerShip.x = bot.ship.x + 190;
  playerShip.y = bot.ship.y + 120;
  playerShip.vx = 0; playerShip.vy = 0;
  playerShip.angle = Math.atan2(bot.ship.y - playerShip.y, bot.ship.x - playerShip.x);
  playerShip.docked = false;
  // Brief arrival shield prevents instant spawn-kills, including hostile player fire.
  playerShip._miniTacticalShieldUntil = Date.now() + 4000;
  if (typeof playerShip.takeDamage === 'function' && !playerShip._miniTacticalShieldWrapped) {
    const originalTakeDamage = playerShip.takeDamage.bind(playerShip);
    playerShip.takeDamage = function() {
      if (Date.now() < (this._miniTacticalShieldUntil || 0)) return;
      return originalTakeDamage.apply(null, arguments);
    };
    playerShip._miniTacticalShieldWrapped = true;
  }
  targetMovePos = null; lockedTarget = null; isDockingRequested = false; gateCooldown = 180;
  const remotePilots = window.MinispaceOnline && window.MinispaceOnline.state && window.MinispaceOnline.state.remotePlayers;
  const pilotsInSystem = remotePilots ? Object.values(remotePilots).filter(p => p && p.mapId === destinationId).length : 0;
  mission.playerReinforced = true;
  if (mission.counterDropRisk && !mission.counterDropSpawned && publicNpcManager &&
      typeof publicNpcManager.spawnTacticalCounterDrop === 'function') {
    mission.counterDropSpawned = publicNpcManager.spawnTacticalCounterDrop(arrival.system, mission.sightingId, playerShip.x, playerShip.y);
  }
  window.startMiniSpaceJumpEffect();
  if (publicNpcManager && typeof publicNpcManager.addCapitalDropEffect === 'function') {
    publicNpcManager.addCapitalDropEffect(destinationId, playerShip.x, playerShip.y);
  }
  if (typeof saveGameSession === 'function') saveGameSession();
  window.showCorpNotification('TACTICAL REINFORCEMENT · pulled into ' + ((arrival.system && arrival.system.name) || 'the fleet system') +
    (pilotsInSystem ? ' · ' + pilotsInSystem + ' other pilot(s) detected' : '') + ' · 4-second arrival shield.');
};

window.openUniverse = function() {
  const modal = document.getElementById('universe-modal'), host = document.getElementById('universe-systems');
  if (!modal || !host) return;
  const systems = window.MINISPACE_UNIVERSE_SYSTEMS || [], current = mapManager.currentMapId;
  try { if (!window._universeTargetSystemId) window._universeTargetSystemId = localStorage.getItem('minispace_universe_target') || null; } catch (_) {}
  if (window._universeTargetSystemId) window.refreshUniverseTargetRoute();
  else window._universeTargetNextHop = null;
  const fleetSightings = publicNpcManager && typeof publicNpcManager.getExplorerFleetSightings === 'function'
    ? publicNpcManager.getExplorerFleetSightings((Number(playerData.explorationCorpPurchased) || 0) > 0) : [];
  // Four readable map regions. System placement is stable and independent of
  // render order, while the gates still connect the exact same system IDs.
  const regionMembers = [[], [], [], []];
  systems.forEach(system => {
    let hash = 2166136261;
    for (const ch of String(system.id)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    regionMembers[hash % 4].push(system);
  });
  const systemPositions = new Map();
  regionMembers.forEach((members, region) => members.forEach((system, index) => {
    let x, y;
    if (region === 0 || region === 2) {
      const col = index % 4, row = Math.floor(index / 4);
      x = 95 + col * 190 + ((index * 13) % 17 - 8);
      y = (region === 0 ? 55 : 326) + row * 36 + ((index * 7) % 9 - 4);
    } else {
      const col = index % 2, row = Math.floor(index / 2);
      x = (region === 3 ? 78 : 582) + col * 112 + ((index * 11) % 13 - 6);
      y = 178 + row * 39 + ((index * 5) % 9 - 4);
    }
    systemPositions.set(system.id, [x, y]);
  }));
  const xy = id => id === 'private_highsec' ? [380, 240] : (systemPositions.get(id) || [380, 240]);
  const regionPanels = [
    '<div class="universe-region universe-region-top">TOP REGION</div>',
    '<div class="universe-region universe-region-right">RIGHT REGION</div>',
    '<div class="universe-region universe-region-bottom">BOTTOM REGION</div>',
    '<div class="universe-region universe-region-left">LEFT REGION</div>'
  ].join('');
  const edges = new Set(), routes = [];
  const plottedPath = window._universeTargetSystemId
    ? window.findFrontierRoute(current === 'private_highsec' ? 'private_highsec' : current, window._universeTargetSystemId)
    : null;
  const plottedEdges = new Set();
  if (plottedPath) for (let i = 1; i < plottedPath.length; i++) plottedEdges.add([plottedPath[i - 1], plottedPath[i]].sort().join('|'));
  systems.forEach(s => s.links.forEach(id => {
    if (id === 'private_highsec' && s.id !== (mapManager && mapManager.frontierHomeGateSystemId)) return;
    const key = [s.id,id].sort().join('|'); if (edges.has(key)) return; edges.add(key);
    const a = xy(s.id), b = xy(id), active = plottedEdges.has(key);
    routes.push('<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="' + (active ? 'universe-route-line universe-route-active' : 'universe-route-line') + '"/>');
  }));
  const fleetMarkers = fleetSightings.map(sighting => {
    const p = xy(sighting.systemId);
    return '<button type="button" data-fleet-system="' + sighting.systemId + '" data-sighting-id="' + sighting.id +
      '" title="Explorer ping · ' + sighting.ships + ' mining ships · intel confidence ' + (sighting.intelConfidence || 0) + '% · dispatch Corp Explorer" style="position:absolute;left:' + (p[0] / 7.6) +
      '%;top:' + (p[1] / 4.8) + '%;transform:translate(15px,-22px);z-index:7;padding:3px 6px;border-radius:12px;border:1px solid #fbbf24;background:#422006;color:#fde68a;font-size:11px;font-weight:900;box-shadow:0 0 12px rgba(251,191,36,.55)">' + (Number(sighting.intelConfidence) < 82 ? '⚠ ' : '⛏ ') + sighting.ships + '</button>';
  }).join('');
  const corpExplorer = botManager && botManager.bots
    ? botManager.bots.find(entry => entry && entry.ship && ['Exploration Frigate','Improved Explorer Frigate','Explorer Cruiser'].includes(entry.className))
    : null;
  const explorerSystemId = corpExplorer ? (corpExplorer.explorerMapId || 'private_highsec') : null;
  const explorerPhase = corpExplorer && corpExplorer.explorerMission ? corpExplorer.explorerMission.phase : 'standby';
  const explorerLabel = explorerPhase === 'panic' ? 'TACTICAL REINFORCEMENT'
    : explorerPhase === 'return' ? 'RETURNING'
    : explorerPhase === 'outbound' ? 'EN ROUTE'
    : 'CORP EXPLORER';
  const explorerPoint = explorerSystemId ? xy(explorerSystemId) : null;
  const explorerMarker = explorerPoint ? '<div title="Corp Explorer · ' + explorerLabel + '" aria-label="Corp Explorer ' + explorerLabel +
    '" style="pointer-events:none;position:absolute;left:' + (explorerPoint[0] / 7.6) + '%;top:' + (explorerPoint[1] / 4.8) +
    '%;transform:translate(-50%,-155%);z-index:9;white-space:nowrap;padding:4px 7px;border-radius:10px;border:1px solid #5eead4;background:rgba(4,55,58,.96);color:#ccfbf1;font-size:10px;font-weight:900;box-shadow:0 0 14px rgba(45,212,191,.7)">🚀 ' + explorerLabel + '</div>' : '';
  const homeHere = current === 'private_highsec', homeTargeted = window._universeTargetSystemId === 'private_highsec';
  const home = '<button type="button" class="universe-node ' + (homeHere ? 'current' : '') + '" data-system-id="private_highsec" title="' + (homeHere ? 'YOU ARE HERE · ' : '') + 'Private High-Sec 1.0" aria-label="' + (homeHere ? 'Your current system: ' : 'Fly back to ') + 'Private High-Sec" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:' + (homeHere ? '42px' : '34px') + ';height:' + (homeHere ? '42px' : '34px') + ';padding:0;border-radius:50%;z-index:4;border:3px solid ' + (homeHere ? '#facc15' : (homeTargeted ? '#fbbf24' : '#38bdf8')) + ';background:' + (homeHere ? '#854d0e' : (homeTargeted ? '#713f12' : '#12354a')) + ';color:#fff;box-shadow:' + (homeHere ? '0 0 0 5px rgba(250,204,21,.22),0 0 24px #facc15' : (homeTargeted ? '0 0 0 5px rgba(251,191,36,.24),0 0 22px #fbbf24' : '0 0 12px #38bdf8')) + '">' + (homeHere ? '★' : '⌂') + (homeHere ? '<span style="position:absolute;left:50%;top:43px;transform:translateX(-50%);white-space:nowrap;color:#facc15;font-size:11px;font-weight:900;text-shadow:0 1px 4px #000">YOU ARE HERE</span>' : '') + '</button>';
  const nodes = systems.map(s => {
    const p = xy(s.id), safe = s.lossMode === 'no-loss', color = safe ? '#38bdf8' : '#f87171';
    const here = current === s.id, targeted = window._universeTargetSystemId === s.id;
    return '<button type="button" class="universe-node ' + (here ? 'current ' : '') + (targeted ? 'targeted ' : '') + (here ? '' : 'reachable') +
      '" data-system-id="' + s.id + '" title="' + (here ? 'YOU ARE HERE · ' : '') + s.name + ' · RING ' + s.ring + ' · ' + (safe ? 'NO-LOSS PvP' : 'FULL-LOOT PvP') +
      '" aria-label="' + (here ? 'Your current system: ' : 'Fly to ') + s.name + ', ring ' + s.ring + ', ' + (safe ? 'no ship loss' : 'full loot') +
      '" style="position:absolute;left:' + (p[0] / 7.6) + '%;top:' + (p[1] / 4.8) + '%;transform:translate(-50%,-50%);width:' + (here ? '27px' : '18px') + ';height:' + (here ? '27px' : '18px') + ';min-width:' + (here ? '27px' : '18px') + ';padding:0;border-radius:50%;border:' + (here ? '3px solid #facc15' : (targeted ? '3px solid #fbbf24' : '2px solid ' + color)) + ';background:' + (here ? '#854d0e' : (targeted ? '#713f12' : color)) + ';color:#fff;font-size:' + (here ? '15px' : '10px') + ';font-weight:900;box-shadow:' + (here ? '0 0 0 5px rgba(250,204,21,.22),0 0 24px #facc15' : (targeted ? '0 0 0 5px rgba(251,191,36,.2),0 0 20px #fbbf24' : '0 0 9px ' + color)) + ';z-index:' + (here ? '5' : '2') + '">' + (here ? '★' : s.ring) + '<span style="position:absolute;left:50%;top:calc(100% + 5px);transform:translateX(-50%);white-space:nowrap;padding:3px 6px;border-radius:5px;background:rgba(2,8,16,.96);border:1px solid ' + (targeted ? '#fbbf24' : 'rgba(120,150,165,.45)') + ';color:' + (targeted ? '#fde68a' : '#d5e2e8') + ';font-size:9px;font-weight:' + (targeted ? '900' : '700') + ';text-shadow:0 1px 4px #000;pointer-events:none">' + s.name + '</span>' + (here ? '<span style="position:absolute;left:50%;top:28px;transform:translateX(-50%);white-space:nowrap;color:#facc15;font-size:11px;font-weight:900;text-shadow:0 1px 4px #000">YOU ARE HERE</span>' : '') + '</button>';
  }).join('');
  const list = systems.map(s => {
    const targeted = window._universeTargetSystemId === s.id;
    return '<button type="button" data-system-id="' + s.id + '" style="display:inline-block;margin:3px;padding:5px 7px;background:' +
      (targeted ? '#713f12' : (s.lossMode === 'no-loss' ? '#12354a' : '#4a2025')) + ';color:' + (targeted ? '#fde68a' : '#e6edf3') + ';border:1px solid ' +
      (targeted ? '#fbbf24' : (s.lossMode === 'no-loss' ? '#38bdf8' : '#f87171')) + ';border-radius:5px;font-size:11px;font-weight:' + (targeted ? '900' : '600') + '">' +
      (targeted ? '★ ' : '') + s.name + ' · ' + s.ring + '</button>';
  }).join('');
  host.innerHTML = '<div class="universe-chart-scroll"><div class="universe-starchart" style="position:relative;min-height:480px;overflow:hidden"><svg viewBox="0 0 760 480" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">' +
    routes.join('') + '</svg>' + regionPanels + home + nodes + fleetMarkers + explorerMarker + '<div class="universe-chart-title">MINISPACE UNIVERSE · 50 SYSTEMS</div>' +
    '<div class="universe-chart-key">★ YOUR LOCATION · 🚀 CORP EXPLORER · BLUE NO-LOSS · RED FULL-LOOT</div></div></div>' +
    '<details style="margin-top:10px"><summary style="cursor:pointer;color:#9fb6c4">ALL 49 FRONTIER SYSTEMS</summary><div style="max-height:180px;overflow:auto;margin-top:8px">' + list + '</div></details>' +
    '<p class="universe-map-note">Tap a system to set or clear your saved destination. The amber route and highlighted tear show your next gate; fly there to continue. Gold ⛏ markers are mining fleet pings. The teal 🚀 marker shows the Corp Explorer live system and mission status.</p>';
  if (!host.dataset.navigationBound) {
    host.addEventListener('click', function(event) {
      const fleet = event.target.closest('button[data-fleet-system]');
      if (fleet) { window.hotDropMiningFleet(fleet.getAttribute('data-sighting-id')); return; }
      const node = event.target.closest('button[data-system-id]');
      if (node) window.setUniverseTargetSystem(node.getAttribute('data-system-id'));
    });
    host.dataset.navigationBound = '1';
  }
  modal.style.display = 'flex';
};
window.closeUniverse = function(){const m=document.getElementById('universe-modal');if(m)m.style.display='none';};

window.jumpToPublicSpace = function(slot = 0) {
  window.startMiniSpaceJumpEffect();
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
  window.startMiniSpaceJumpEffect();
  mainStation = homeStation || mainStation;
  window.MINISPACE_FRONTIER_STATION = null;
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
  if (isFrontierSpace()) { isDockingRequested = false; targetMovePos = null; window.showCorpNotification(window.MINISPACE_FRONTIER_STATION && window.MINISPACE_FRONTIER_STATION.structure <= 0 ? 'Station destroyed · docking unavailable. Use a Universe Tear to leave.' : 'Hostile stronghold · destroy the station before leaving it behind.'); return; }
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
  if (inPublicSpace() && !isFrontierSpace()) { window.showCorpNotification('No station in Public Space - use your sector gate to return.'); return; }
  if (isFrontierSpace()) { window.showCorpNotification(window.MINISPACE_FRONTIER_STATION && window.MINISPACE_FRONTIER_STATION.structure <= 0 ? 'Station destroyed · docking unavailable. Use a Universe Tear to leave.' : 'Hostile stronghold · destroy the station before leaving it behind.'); return; }
  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
  isDockingRequested = true;
};

// Autoplay can be started from the station or in flight. The rules for which hulls
// and which zones are allowed live in AutoplayManager.toggle().
window.toggleOffensiveMode = function() {
  playerData.offensiveMode = !playerData.offensiveMode;
  if (playerShip) {
    playerShip.ignoreStationBoss = !playerData.offensiveMode;
    playerShip.weaponsEnabled = !!playerData.offensiveMode;
    if (!playerData.offensiveMode) {
      playerShip.currentTarget = null;
      if (typeof playerShip.releaseScrambler === 'function') playerShip.releaseScrambler();
    }
    (playerShip.drones || []).forEach(entry => {
      if (!entry) return;
      entry.targetEnemy = null;
      const drone = entry.ship || entry;
      if (drone) { drone.weaponsEnabled = !!playerData.offensiveMode; if (!playerData.offensiveMode) drone.currentTarget = null; }
    });
  }
  const button = document.getElementById('offensive-btn');
  if (button) {
    button.textContent = 'COMBAT: ' + (playerData.offensiveMode ? 'ON' : 'OFF');
    button.style.color = playerData.offensiveMode ? '#ff8b82' : '#9aa7b0';
    button.style.borderColor = playerData.offensiveMode ? '#b94a48' : '#39434b';
  }
  saveGameSession();
  window.showCorpNotification(playerData.offensiveMode
    ? 'Offensive systems armed. Your ship will engage pirates and hostile pilots in PvP space.'
    : 'Weapons safety ON. Your ship will not fire.');
};
window.toggleAutoplay = function() {
  if (!autoplayManager) return;
  if(mapManager&&String(mapManager.currentMapId).indexOf('frontier_')===0&&!autoplayManager.isAutoplay){window.showCorpNotification('Autoplay is disabled in frontier systems. Manual flight only.');return;}
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
 updatePilotPanel();
 if(gained){window.showCorpNotification('PILOT LEVEL UP! Level '+p.level+' — '+gained+' talent point'+(gained===1?'':'s')+' earned.');saveGameSession();}
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
  ['hangar', 'upgrades', 'corp', 'market', 'missions', 'trade-market', 'trade-hangar'].forEach(function(s) {
    let secEl = document.getElementById('tab-' + s);
    if (secEl) secEl.style.display = (s === tabName) ? 'block' : 'none';
  });
  if (tabName === 'corp') updateCorpUI();
  if (tabName === 'missions') updateMissionsUI();
  if (tabName === 'upgrades' || tabName === 'hangar') updateStationUI();
  if (tabName === 'trade-market') window.refreshTradeMarket();
  if (tabName === 'trade-hangar') window.refreshTradeHangars();
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

// Legacy component trading is deliberately disabled. Ore and components now
// move through the Trade Hub hangars and are bought/sold only on its shared market.
window.sellStationItem = function() {
  window.showCorpNotification('Components can only be sold through the Trade Hub Market.');
};
window.buyStationItem = function() {
  window.showCorpNotification('Components can only be bought through the Trade Hub Market.');
};
window.openBuyOre = function() {
  window.showCorpNotification('Travel to the Trade Hub to buy or sell ore and components.');
};
window.quickSellAllVault = function() {
  window.showCorpNotification('Use Trade Hangar to move materials, then sell them on the Trade Hub Market.');
};

window.applySkillChip=function(id){
  if(!playerShip||!playerShip.docked){window.showCorpNotification('Dock at your Private High-Sec station to fit a skill chip.');return;}
  const chips=Array.isArray(playerData.skillChips)?playerData.skillChips:[];
  const index=chips.findIndex(c=>c&&c.id===id),chip=chips[index];
  if(!chip)return;
  if(playerShip.className!==chip.hull){window.showCorpNotification('This chip is designed for '+chip.hull+'. Board that ship first.');return;}
  if(!MODULE_KEYS[chip.hull]||!MODULE_KEYS[chip.hull].includes(chip.module)){window.showCorpNotification('This chip does not match a valid module slot.');return;}
  if(getCap(chip.module,chip.hull)>=MAX_MODULE_LEVEL){window.showCorpNotification('That module has reached the absolute level cap.');return;}
  if(!playerData.moduleBonusCap)playerData.moduleBonusCap={};
  if(!playerData.moduleBonusCap[chip.hull])playerData.moduleBonusCap[chip.hull]={};
  playerData.moduleBonusCap[chip.hull][chip.module]=Math.min(15,(Number(playerData.moduleBonusCap[chip.hull][chip.module])||0)+1);
  chips.splice(index,1);playerData.skillChips=chips;
  cleanModules(playerShip);applyDesign(playerShip);saveGameSession();updateStationUI();
  window.showCorpNotification('Purple chip fitted: '+chip.module+' maximum level increased to '+getCap(chip.module,chip.hull)+'.');
};

function moduleDropSaleValue(drop) {
  const values = { white: 250000, green: 600000, blue: 1500000, purple: 4000000 };
  return values[String(drop && drop.rarity || 'white').toLowerCase()] || values.white;
}
function ensureFittedModules(ship) {
  if (!ship) return {};
  if (!ship.fittedModules || typeof ship.fittedModules !== 'object') ship.fittedModules = {};
  if (!playerData.fittedModules) playerData.fittedModules = {};
  const saved = playerData.fittedModules[ship.className];
  if (saved && typeof saved === 'object') ship.fittedModules = Object.assign({}, saved, ship.fittedModules);
  return ship.fittedModules;
}
window.fitFrontierModuleDrop = function(id) {
  if (!playerShip || !playerShip.docked) { window.showCorpNotification('Dock at a station to fit a module drop.'); return; }
  const drops = Array.isArray(playerData.moduleDrops) ? playerData.moduleDrops : [];
  const index = drops.findIndex(d => d && d.id === id), drop = drops[index];
  if (!drop) return;
  if (playerShip.className !== drop.hull) { window.showCorpNotification('This module is designed for ' + drop.hull + '. Board that ship first.'); return; }
  if (!MODULE_KEYS[drop.hull] || !MODULE_KEYS[drop.hull].includes(drop.module)) { window.showCorpNotification('This module does not fit this ship.'); return; }
  const slots = ensureFittedModules(playerShip);
  if (slots[drop.module]) { window.showCorpNotification('That slot is occupied. Remove its module first.'); return; }
  slots[drop.module] = { id:drop.id, name:drop.name, module:drop.module, hull:drop.hull, rarity:drop.rarity||'white', rank:1 };
  drops.splice(index,1); playerData.moduleDrops=drops;
  if(!playerData.fittedModules)playerData.fittedModules={};
  playerData.fittedModules[playerShip.className]=Object.assign({},slots);
  applyDesign(playerShip); applyPilotTalents(); saveGameSession(); updateStationUI();
  window.showCorpNotification(drop.name+' installed in '+drop.module+' slot · Rank 1. Use + to improve it.');
};
window.removeFittedModule = function(slot) {
  if(!playerShip||!playerShip.docked)return;
  const slots=ensureFittedModules(playerShip),mod=slots[slot];if(!mod)return;
  if(!Array.isArray(playerData.moduleDrops))playerData.moduleDrops=[];
  playerData.moduleDrops.push({id:mod.id||('returned_'+Date.now()),name:mod.name||slot,hull:playerShip.className,module:slot,rarity:mod.rarity||'white',level:1});
  delete slots[slot];playerData.fittedModules[playerShip.className]=Object.assign({},slots);
  applyDesign(playerShip);saveGameSession();updateStationUI();
};
function fittedModuleUpgradeRequirements(slot, rank) {
  const tierMult = getShipTierMultiplier();
  const req = { scrap: upgradeCostAt(rank), ore: null, component: null };
  // Ranks 1-5 use Scrap Metals only. Rank 6 onward adds scaling ore and components.
  if (rank >= 5) {
    const oreBase = upgradeOreRequirement(slot, rank);
    req.ore = { key: oreBase.key, qty: Math.ceil(oreBase.qty * (1 + (rank - 5) * 0.5)) };
    const componentTier = rank <= 6 ? 1 : rank <= 8 ? 2 : 3;
    req.component = { key: 'debris_t' + componentTier, qty: Math.ceil((10 + (rank - 5) * 10) * tierMult) };
  }
  return req;
}
window.upgradeFittedModule = function(slot) {
  if(!playerShip||!playerShip.docked)return;
  const slots=ensureFittedModules(playerShip),mod=slots[slot];if(!mod)return;
  const rank=Math.max(1,Number(mod.rank)||1),rankCap=getCap(slot,playerShip.className);
  if(rank>=10){window.showCorpNotification('This module is already Rank 10.');return;}
  if(rank>=rankCap){window.showCorpNotification('This module is locked at Rank '+rank+'. Defeat elite pirates to earn an Item Level Chip and unlock the next rank.');return;}
  const req=fittedModuleUpgradeRequirements(slot,rank);
  const scrap=Math.max(0,Number(playerData.isk)||0);
  if(scrap<req.scrap){window.showCorpNotification('Need '+fmtISK(req.scrap)+' Scrap Metals to upgrade.');return;}
  const oreHave=req.ore?Math.max(0,Math.floor(Number(playerData.stationOre&&playerData.stationOre[req.ore.key])||0)):0;
  if(req.ore&&oreHave<req.ore.qty){window.showCorpNotification('Need '+req.ore.qty.toLocaleString()+' '+itemLabel(req.ore.key)+' in your hangar.');return;}
  const componentHave=req.component?Math.max(0,Math.floor(Number(playerData.stationOre&&playerData.stationOre[req.component.key])||0)):0;
  if(req.component&&componentHave<req.component.qty){window.showCorpNotification('Need '+req.component.qty.toLocaleString()+' '+itemLabel(req.component.key)+' components in your hangar.');return;}
  playerData.isk-=req.scrap;
  if(req.ore)playerData.stationOre[req.ore.key]=oreHave-req.ore.qty;
  if(req.component)playerData.stationOre[req.component.key]=componentHave-req.component.qty;
  mod.rank=rank+1;
  playerData.fittedModules[playerShip.className]=Object.assign({},slots);
  applyDesign(playerShip);saveGameSession();updateStationUI();
  window.showCorpNotification(mod.name+' upgraded to Rank '+mod.rank+'.');
};
window.sellFrontierModuleDrop = function(id) {
  if (!playerShip || !playerShip.docked || mapManager.currentMapId !== 'public_trade_hub') {
    window.showCorpNotification('Dock at the Trade Store to sell frontier module drops.'); return;
  }
  const drops = Array.isArray(playerData.moduleDrops) ? playerData.moduleDrops : [];
  const index = drops.findIndex(d => d && d.id === id), drop = drops[index];
  if (!drop) return;
  const value = moduleDropSaleValue(drop);
  drops.splice(index, 1);
  playerData.moduleDrops = drops;
  playerData.isk = Math.max(0, Number(playerData.isk) || 0) + value;
  updateStationUI(); saveGameSession();
  window.showCorpNotification('NPC Trade Store bought ' + drop.name + ' for ' + fmtISK(value) + ' Scrap Metals.');
};
window.setHangarView=function(view){
  const valid=['items','ships','fitting'];if(!valid.includes(view))view='items';
  window._miniHangarView=view;
  const table=document.getElementById('hangar-items-table'),fit=document.getElementById('hangar-fitting-panel');
  if(table)table.style.display=view==='fitting'?'none':'';
  if(fit)fit.style.display=view==='fitting'?'block':'none';
  document.querySelectorAll('[data-hangar-view]').forEach(b=>b.classList.toggle('active',b.getAttribute('data-hangar-view')===view));
  document.querySelectorAll('#items-hanger-list > tr[data-hangar-group]').forEach(row=>{
    const group=row.getAttribute('data-hangar-group'),isItem=group==='ore'||group==='debris';
    row.style.display=view==='items'?(isItem?'':'none'):(view==='ships'?(isItem?'none':''):'none');
  });
};
const MODULE_UPGRADE_ORE = {
  laser:'pyroxeres', guns:'pyroxeres', missiles:'pyroxeres',
  shield:'scordite', shieldPlating:'scordite', shieldExtender:'scordite',
  shieldRecharge:'scordite', resistance:'scordite',
  cargo:'veldspar', propulsion:'veldspar',
  dronesTether:'omber', droneTether:'omber',
  cloaking:'debris_t1', hacking:'debris_t1', scrambler:'debris_t2'
};
function upgradeOreRequirement(mod, level) {
  const key = MODULE_UPGRADE_ORE[mod] || 'scordite';
  return { key: key, qty: Math.ceil((250 + Math.max(1, Number(level) || 1) * 150) * getShipTierMultiplier()) };
}
window.upgradeFrigateModule = function(mod) {
  if (!playerShip || !playerShip.moduleLevels) return;
  let lvl = playerShip.moduleLevels[mod] || 1;
  if (lvl >= getCap(mod)) return;
  let cost = upgradeCostAt(lvl);
  const ore = upgradeOreRequirement(mod, lvl);
  const availableOre = Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[ore.key]) || 0));
  if (availableOre < ore.qty) {
    window.showCorpNotification('Upgrade needs ' + ore.qty.toLocaleString() + ' ' + itemLabel(ore.key) + ' (' + availableOre.toLocaleString() + ' in your Private hangar). Buy it at Trade Hub or mine it.');
    return;
  }
  if (playerData.isk < cost) { window.showCorpNotification('Not enough Scrap Metals (' + fmtISK(cost) + ' needed)'); return; }
  playerData.isk -= cost;
  playerData.stationOre[ore.key] = availableOre - ore.qty;
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
  if (!playerData.fittedModules) playerData.fittedModules = {};
  if (playerShip.fittedModules) playerData.fittedModules[playerShip.className] = Object.assign({}, playerShip.fittedModules);
  cleanModules(playerShip);
  playerData.upgrades[playerShip.className] = Object.assign({}, playerShip.moduleLevels);
  playerShip.moduleLevels = {};
  let s = sessionManager.setShipClass(playerShip, className, cargo, speed);
  let saved = playerData.upgrades[className];
  if (saved && s.moduleLevels) Object.assign(s.moduleLevels, saved);
  s.fittedModules = Object.assign({}, playerData.fittedModules[className] || {});
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


window.buildDesign = function(key) {
  const d = DESIGNS[key];
  if (!d || !playerShip) return;
  if (!playerShip.docked) { window.showCorpNotification('Dock at the station to build.'); return; }
  if (!(playerData.designs[key] > 0)) return;
  if (d.cost && hangarItemValue() < d.cost.items) {
    window.showCorpNotification('Not enough materials in your Private High-Sec hangar. Supply them through the Trade Hub market, then transfer them into your private hangar before building.');
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
// Ship recipes require real materials already present in the Private High-Sec hangar.
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


window.buildShip = function(unlockKey, className) {
  if (!playerShip || !playerShip.docked) { window.showCorpNotification('Dock at the station to build ships.'); return; }
  if (!playerData.unlockedShips) playerData.unlockedShips = {};
  if (playerData.unlockedShips[unlockKey]) return;
  const recipe = recipeFor(unlockKey);
  if (!recipe) { window.showCorpNotification('No recipe for ' + className); return; }
  const short = recipeShortfall(recipe);
  if (short.length > 0) {
    window.requestTransportShipBuild(unlockKey, className, recipe, short);
    return;
  }
  consumeRecipe(recipe);
  playerData.unlockedShips[unlockKey] = true;
  if (playerData.shipsOwned.indexOf(className) === -1) playerData.shipsOwned.push(className);
  window.showCorpNotification(className + ' built. Board it from the Shipyard or Hangar.');
  updateStationUI();
  saveGameSession();
};

// Dispatch the free Transport Manager to collect missing ship materials.
window.requestTransportShipBuild = async function(unlockKey, className, recipe, short, fromQueue) {
  if (window._transportShipBuildRequestPending) return;
  window._transportShipBuildRequestPending = true;
  try {
    if (!window.MINISPACE_MARKET || !botManager) throw new Error('Market or corporation logistics are not ready.');
    await window.MINISPACE_MARKET.ready();
    await window.MINISPACE_MARKET.refresh();
    window.MINISPACE_MARKET.applyToGame(playerData);
    short = recipeShortfall(recipe);
    if (!short.length) {
      window.buildShip(unlockKey, className);
      return;
    }
    const findManager = function() {
      return botManager.bots.find(function(bot) {
        const name = bot && bot.ship && bot.ship.className;
        return name === 'Transport Capital' || name === 'Industrial Hauler' || name === 'Freighter';
      });
    };
    if (!findManager()) window.buildTransportManager();
    const transport = findManager();
    if (!transport || !transport.ship) throw new Error('The free Transport Manager could not be deployed.');
    if (transport.transportTask || !['loading', null].includes(transport.transportState)) {
      if (fromQueue) return;
      if (!Array.isArray(transport.transportBuildQueue)) transport.transportBuildQueue = [];
      const duplicate = transport.transportBuildQueue.some(function(order) { return order && order.unlockKey === unlockKey; });
      if (!duplicate) transport.transportBuildQueue.push({ unlockKey: unlockKey, className: className });
      if (typeof window.saveGameSession === 'function') window.saveGameSession();
      if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
      if (typeof updateStationUI === 'function') updateStationUI();
      window.showCorpNotification(className + ' fetch & build order queued. The Transport Manager will collect the materials after his current trip.');
      return;
    }
    // Return any partial corporation load to its hangar before taking a personal order.
    if ((transport.ship.cargo || 0) > 0) {
      const corpInventory = playerData.corpStationOre || (playerData.corpStationOre = {});
      const carried = transport.ship.cargoByOre || {};
      Object.keys(carried).forEach(function(key) {
        corpInventory[key] = (Number(corpInventory[key]) || 0) + Math.max(0, Math.floor(Number(carried[key]) || 0));
      });
      transport.ship.cargo = 0;
      transport.ship.cargoByOre = {};
    }

    const state = window.MINISPACE_MARKET.state();
    const items = short.map(function(entry) {
      const tradeRow = (state.hangars || []).find(function(row) {
        return row.station_id === 'trade_hub' && row.item_key === entry.item;
      });
      const tradeQty = Math.max(0, Number(tradeRow && tradeRow.quantity) || 0);
      const toBuy = Math.max(0, entry.need - entry.have - tradeQty);
      const marketRow = (state.items || []).find(function(row) { return row.item_key === entry.item; });
      const stock = marketRow ? Math.max(0, Number(marketRow.stock) ||
        (Number(marketRow.player_stock || 0) + Number(marketRow.npc_stock || 0))) : 0;
      if (stock < toBuy) throw new Error('Trade Hub is short of ' + itemLabel(entry.item) +
        ' (needs ' + toBuy.toLocaleString() + ', market has ' + stock.toLocaleString() + ').');
      return { key: entry.item, quantity: entry.need - entry.have, target: entry.need };
    });
    const cost = items.reduce(function(total, item) {
      const row = (state.items || []).find(function(candidate) { return candidate.item_key === item.key; });
      const tradeRow = (state.hangars || []).find(function(candidate) {
        return candidate.station_id === 'trade_hub' && candidate.item_key === item.key;
      });
      const alreadyThere = Math.max(0, Number(tradeRow && tradeRow.quantity) || 0);
      return total + Math.max(0, item.quantity - alreadyThere) * Math.max(0, Number(row && row.unit_price) || 0);
    }, 0);
    const wallet = state.wallet ? Math.max(0, Number(state.wallet.isk) || 0) : 0;
    if (wallet < cost) throw new Error('Not enough Scrap Metals. The required market purchases cost ' + cost.toLocaleString() + '.');

    if (fromQueue && Array.isArray(transport.transportBuildQueue)) {
      const queuedIndex = transport.transportBuildQueue.findIndex(function(order) { return order && order.unlockKey === unlockKey; });
      if (queuedIndex >= 0) transport.transportBuildQueue.splice(queuedIndex, 1);
    }
    transport.transportTask = { type: 'ship_build', unlockKey: unlockKey, className: className,
      items: items, status: 'outbound' };
    transport.transportState = 'buy_to_trade_gate';
    transport.transportMapId = 'private_highsec';
    transport.ship.docked = false;
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
    if (typeof updateStationUI === 'function') updateStationUI();
    window.showCorpNotification('Transport Manager dispatched to collect materials for ' + className +
      '. It will fly to the Trade Hub and return to finish the build.');
  } catch (error) {
    window.showCorpNotification('Could not dispatch materials: ' + (error.message || error));
  } finally {
    window._transportShipBuildRequestPending = false;
  }
};

window.startNextTransportShipBuild = function(transport) {
  if (!transport || transport.transportTask || !Array.isArray(transport.transportBuildQueue) || !transport.transportBuildQueue.length) return false;
  if (!['loading', null].includes(transport.transportState)) return false;
  const order = transport.transportBuildQueue[0];
  if (!order || !order.unlockKey || !order.className) {
    transport.transportBuildQueue.shift();
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    return false;
  }
  const recipe = recipeFor(order.unlockKey);
  if (!recipe) {
    window.showCorpNotification('Queued build order could not find a recipe for ' + order.className + '.');
    transport.transportBuildQueue.shift();
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    return false;
  }
  window.requestTransportShipBuild(order.unlockKey, order.className, recipe, recipeShortfall(recipe), true);
  return true;
};

// Called when the Transport Manager reaches the Trade Hub market.
window.completeTransportMaterialPickup = async function(transport) {
  const task = transport && transport.transportTask;
  if (!task || task.type !== 'ship_build') return { success: false, message: 'No ship build request is queued.' };
  try {
    await window.MINISPACE_MARKET.ready();
    for (const item of task.items || []) {
      await window.MINISPACE_MARKET.refresh();
      const state = window.MINISPACE_MARKET.state();
      const privateRow = (state.hangars || []).find(function(row) {
        return row.station_id === 'private_highsec' && row.item_key === item.key;
      });
      const privateQty = Math.max(0, Number(privateRow && privateRow.quantity) || 0);
      const required = Math.max(0, (Number(item.target) || Number(item.quantity) || 0) - privateQty);
      if (!required) continue;
      const tradeRow = (state.hangars || []).find(function(row) {
        return row.station_id === 'trade_hub' && row.item_key === item.key;
      });
      const tradeQty = Math.max(0, Number(tradeRow && tradeRow.quantity) || 0);
      if (tradeQty < required) await window.MINISPACE_MARKET.buy(item.key, required - tradeQty);
      await window.MINISPACE_MARKET.transferToPrivate(item.key, required);
    }
    await window.MINISPACE_MARKET.refresh();
    window.MINISPACE_MARKET.applyToGame(playerData);
    updateStationUI();
    saveGameSession();
    return { success: true, message: 'All required materials collected and delivered.' };
  } catch (error) {
    await window.MINISPACE_MARKET.refresh().catch(function() {});
    window.MINISPACE_MARKET.applyToGame(playerData);
    updateStationUI();
    saveGameSession();
    return { success: false, message: error.message || String(error) };
  }
};

window.finishTransportShipBuild = function(task, result) {
  if (!task) return;
  if (result && result.success && playerShip && playerShip.docked &&
      !playerData.unlockedShips[task.unlockKey]) {
    const remaining = recipeShortfall(recipeFor(task.unlockKey) || []);
    if (!remaining.length) {
      window.buildShip(task.unlockKey, task.className);
      return;
    }
  }
  if (result && result.success) {
    window.showCorpNotification(task.className + ' materials delivered to Private High-Sec. Dock and press Build to finish.');
  } else {
    window.showCorpNotification('Transport Manager pickup incomplete: ' +
      ((result && result.message) || 'Unknown market error') + '. Any purchased materials are safe in your hangar.');
  }
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
  if (!playerShip || !playerShip.docked) {
    window.showCorpNotification('Dock at your Private High-Sec station to build the Transport Manager.');
    return false;
  }
  if ((playerData.transportManagerPurchased || 0) > 0) return false;
  // Limited-time starter offer: the first Transport Manager is free.
  playerData.transportManagerPurchased = 1;
  window.showCorpNotification('Free Transport Manager hired. Logistics online.');
  saveGameSession();
  updateStationUI();
  updateCorpUI();
  return true;
};

window.upgradeTransportManager = function() {
  if (!botManager || typeof botManager.upgradeTransportManager !== 'function') return false;
  const result = botManager.upgradeTransportManager();
  if (!result.success) {
    window.showCorpNotification(result.message || 'Transport Manager upgrade unavailable.');
    return false;
  }
  window.showCorpNotification(
    'Transport Manager reached Level ' + result.level + '! Cargo capacity increased to ' +
    result.capacity.toLocaleString() + '. Next upgrade cost will increase.'
  );
  return true;
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
      playerShip = sessionManager.setShipClass(playerShip, 'Combat Frigate', 200, 5.0);
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
// The old canvas minimap has been replaced by the live Nearby in Space list.

// Start at the old maximum zoom-out level, so the phone view is the new normal.
// Pinch and wheel gestures can zoom further out without needing on-screen buttons.
var cameraZoom = 0.15;
const MIN_CAMERA_ZOOM = 0.05;
const MAX_CAMERA_ZOOM = 1.2;
// Camera can be dragged away from the pilot to inspect nearby space.
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let cameraMapId = null;
function setCameraZoom(value) {
  cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, Number(value) || MIN_CAMERA_ZOOM));
}
window.adjustZoom = function(amount) {
  setCameraZoom(cameraZoom + Number(amount || 0));
};

const activeZoomPointers = new Map();
let pinchDistance = 0;
let pinchGestureActive = false;
let pinchGestureFinished = false;
function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
window.addEventListener('pointerdown', function(e) {
  if (!canvas || e.target !== canvas) return;
  activeZoomPointers.set(e.pointerId, {
    x:e.clientX, y:e.clientY, startX:e.clientX, startY:e.clientY,
    lastX:e.clientX, lastY:e.clientY, dragged:false
  });
  if (activeZoomPointers.size >= 2) {
    pinchGestureActive = true;
    pinchGestureFinished = true;
    const pts = Array.from(activeZoomPointers.values());
    pinchDistance = pointerDistance(pts[0], pts[1]) || 1;
  }
}, { passive: true });

window.addEventListener('pointermove', function(e) {
  const point = activeZoomPointers.get(e.pointerId);
  if (!point) return;
  point.x = e.clientX;
  point.y = e.clientY;
  if (activeZoomPointers.size >= 2) {
    const pts = Array.from(activeZoomPointers.values());
    const nextDistance = pointerDistance(pts[0], pts[1]);
    if (pinchDistance > 0 && nextDistance > 0) setCameraZoom(cameraZoom * (nextDistance / pinchDistance));
    pinchDistance = nextDistance || pinchDistance;
    return;
  }
  const moved = Math.hypot(e.clientX - point.startX, e.clientY - point.startY);
  if (moved > 9) point.dragged = true;
  // A single held pointer pans the camera. It never moves the ship.
  if (point.dragged) {
    cameraOffsetX -= (e.clientX - point.lastX) / cameraZoom;
    cameraOffsetY -= (e.clientY - point.lastY) / cameraZoom;
  }
  point.lastX = e.clientX;
  point.lastY = e.clientY;
}, { passive: true });

function finishZoomPointer(e) {
  const point = activeZoomPointers.get(e.pointerId);
  if (!point) return;
  activeZoomPointers.delete(e.pointerId);
  if (activeZoomPointers.size === 0) {
    if (e.type === 'pointerup' && !point.dragged && !pinchGestureFinished && !pinchGestureActive) {
      handleCanvasTouch(e.clientX, e.clientY);
    }
    pinchGestureActive = false;
    pinchGestureFinished = false;
    pinchDistance = 0;
  } else if (activeZoomPointers.size < 2) {
    pinchGestureActive = false;
    pinchDistance = 0;
  }
}
window.addEventListener('pointerup', finishZoomPointer, { passive: true });
window.addEventListener('pointercancel', finishZoomPointer, { passive: true });

if (canvas) {
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    setCameraZoom(cameraZoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}

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
    x: playerShip.x + cameraOffsetX + (xCoord - canvas.width / (2 * dpr)) / cameraZoom,
    y: playerShip.y + cameraOffsetY + (yCoord - canvas.height / (2 * dpr)) / cameraZoom
  };
  isDockingRequested = (!inPublicSpace() || isFrontierSpace()) && mainStation &&
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
  'Carrier':             { cargo: 5000,   speed: 1.65, unlock: 'carrier' },
  'Combat Frigate':      { cargo: 200,    speed: 5.0,  unlock: 'combatFrigate' },
  'Siege Cruiser':       { cargo: 500,    speed: 2.6,  unlock: 'siegeCruiser' },
  'Siege Battleship':    { cargo: 1000,   speed: 3.2,  unlock: 'siegeBattleship' },
  'Exploration Frigate': { cargo: 150,    speed: 6.0,  unlock: 'explorationFrigate' }
};

// CLOUD PLAYER MARKET: only visible while docked in the public Trade Hub.
const TRADE_ITEM_LABELS = {
  veldspar:'Copper', scordite:'Steel', pyroxeres:'Titanium', omber:'Gold',
  debris_t1:'Resistor', debris_t2:'Capacitor', debris_t3:'Circuit Board',
  debris_t4:'Microchip', debris_t5:'Processor'
};
function tradeMarketState() {
  return window.MINISPACE_MARKET && window.MINISPACE_MARKET.state
    ? window.MINISPACE_MARKET.state() : {wallet:null,hangars:[],items:[]};
}
function tradeQuantity(station, key, state) {
  const row = (state.hangars || []).find(x => x.station_id === station && x.item_key === key);
  return row ? Number(row.quantity) || 0 : 0;
}
function tradeEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);
  });
}
function renderTradeMarket() {
  const state = tradeMarketState();
  const wallet = document.getElementById('trade-market-wallet');
  if (wallet) wallet.textContent = (state.gameStateSynced ? 'Scrap Metals wallet: ' : 'Scrap Metals wallet sync required: ') + fmtISK(Number(state.wallet && state.wallet.isk) || 0) + ' Scrap Metals';
  const body = document.getElementById('trade-market-list');
  if (!body) return;
  if (!state.gameStateSynced) {
    body.innerHTML = '<tr><td colspan="4">Install supabase/market_game_sync.sql in Supabase to connect the game wallet and hangar before trading.</td></tr>';
    return;
  }
  const rows = (state.items || []).map(function(item) {
    const key = item.item_key;
    const label = TRADE_ITEM_LABELS[key] || key;
    const qty = tradeQuantity('trade_hub', key, state);
    const price = Number(item.unit_price) || 0;
    const stock = Number(item.stock) || 0;
    return '<tr><td>' + tradeEsc(label) + '<br><small>Trade Hub hangar: ' + qty.toLocaleString() + '</small></td>' +
      '<td>' + fmtISK(price) + ' Scrap Metals</td><td>' + stock.toLocaleString() + '</td>' +
      '<td><button onclick="window.tradeMarketBuy(\'' + tradeEsc(key) + '\',1)" ' + (stock < 1 ? 'disabled' : '') + '>Buy 1</button> ' +
      '<button onclick="window.tradeMarketBuy(\'' + tradeEsc(key) + '\',100)" ' + (stock < 100 ? 'disabled' : '') + '>Buy 100</button> ' +
      '<button onclick="window.tradeMarketBuy(\'' + tradeEsc(key) + '\',1000)" ' + (stock < 1000 ? 'disabled' : '') + '>Buy 1k</button> ' +
      '<button onclick="window.tradeMarketSellAll(\'' + tradeEsc(key) + '\')" ' + (qty < 1 ? 'disabled' : '') + '>Sell all</button></td></tr>';
  });
  body.innerHTML = rows.join('') || '<tr><td colspan="4">No market items available.</td></tr>';
}
function renderTradeHangars() {
  const state = tradeMarketState();
  const wallet = document.getElementById('trade-hangar-wallet');
  if (wallet) wallet.textContent = (state.gameStateSynced ? 'Scrap Metals wallet: ' : 'Scrap Metals wallet sync required: ') + fmtISK(Number(state.wallet && state.wallet.isk) || 0) + ' Scrap Metals';
  ['private_highsec','trade_hub'].forEach(function(station) {
    const id = station === 'private_highsec' ? 'private-hangar-list' : 'trade-hangar-list';
    const body = document.getElementById(id);
    if (!body) return;
    const items = Object.keys(TRADE_ITEM_LABELS);
    body.innerHTML = items.map(function(key) {
      const qty = tradeQuantity(station,key,state);
      const action = station === 'private_highsec'
        ? '<button onclick="window.transferTradeGoods(\'' + key + '\',' + qty + ')" ' + (!state.gameStateSynced || qty < 1 ? 'disabled' : '') + '>Move all to Trade Hub</button>'
        : '<button onclick="window.transferTradeGoodsToPrivate(\'' + key + '\',' + qty + ')" ' + (!state.gameStateSynced || qty < 1 ? 'disabled' : '') + '>Move all to Private High-Sec</button> ' +
          '<button onclick="window.tradeMarketSellAll(\'' + key + '\')" ' + (!state.gameStateSynced || qty < 1 ? 'disabled' : '') + '>Sell all</button>';
      return '<tr><td>' + TRADE_ITEM_LABELS[key] + '</td><td>' + qty.toLocaleString() + '</td><td>' + action + '</td></tr>';
    }).join('');
  });
}
window.refreshTradeMarket = async function() {
  const body = document.getElementById('trade-market-list');
  if (body) body.innerHTML = '<tr><td colspan="4">Refreshing shared market…</td></tr>';
  try {
    await window.MINISPACE_MARKET.ready();
    await window.MINISPACE_MARKET.refresh();
    renderTradeMarket();
  } catch (error) {
    if (body) body.innerHTML = '<tr><td colspan="4">Market unavailable: ' + tradeEsc(error.message || error) + '</td></tr>';
  }
};
window.refreshTradeHangars = async function() {
  try {
    await window.MINISPACE_MARKET.ready();
    await window.MINISPACE_MARKET.refresh();
    renderTradeHangars();
  } catch (error) {
    const body = document.getElementById('private-hangar-list');
    if (body) body.innerHTML = '<tr><td colspan="3">Hangars unavailable: ' + tradeEsc(error.message || error) + '</td></tr>';
  }
};
window.tradeMarketBuy = async function(key, qty) {
  try {
    await window.MINISPACE_MARKET.buy(key,qty);
    if (window.MINISPACE_MARKET.applyToGame(playerData)) {
      updateStationUI();
      saveGameSession();
    }
    renderTradeMarket(); renderTradeHangars();
    window.showCorpNotification('Purchased ' + qty + ' ' + (TRADE_ITEM_LABELS[key] || key) + ' into your Trade Hub hangar.');
  } catch(error) { window.showCorpNotification('Market buy failed: ' + (error.message || error)); }
};
window.tradeMarketSellAll = async function(key) {
  const qty = tradeQuantity('trade_hub',key,tradeMarketState());
  if (qty < 1) return;
  try {
    await window.MINISPACE_MARKET.sell(key,qty);
    if (window.MINISPACE_MARKET.applyToGame(playerData)) {
      updateStationUI();
      saveGameSession();
    }
    renderTradeMarket(); renderTradeHangars();
    window.showCorpNotification('Sold ' + qty + ' ' + (TRADE_ITEM_LABELS[key] || key) + ' from your Trade Hub hangar.');
  } catch(error) { window.showCorpNotification('Market sale failed: ' + (error.message || error)); }
};
window.transferTradeGoods = async function(key,qty) {
  if (qty < 1) return;
  try {
    await window.MINISPACE_MARKET.transfer(key,qty);
    if (window.MINISPACE_MARKET.applyToGame(playerData)) {
      updateStationUI();
      saveGameSession();
    }
    renderTradeHangars();
    window.showCorpNotification('Transferred ' + qty + ' ' + (TRADE_ITEM_LABELS[key] || key) + ' to the Trade Hub hangar.');
  } catch(error) { window.showCorpNotification('Transfer failed: ' + (error.message || error)); }
};

window.transferTradeGoodsToPrivate = async function(key,qty) {
  if (qty < 1) return;
  try {
    await window.MINISPACE_MARKET.transferToPrivate(key,qty);
    if (window.MINISPACE_MARKET.applyToGame(playerData)) {
      updateStationUI();
      saveGameSession();
    }
    renderTradeHangars();
    window.showCorpNotification('Transferred ' + qty + ' ' + (TRADE_ITEM_LABELS[key] || key) + ' into your Private High-Sec hangar. They can now be used for ship builds.');
  } catch(error) { window.showCorpNotification('Transfer failed: ' + (error.message || error)); }
};

window.openHangarItem=function(itemKey){
 const panel=document.getElementById('hangar-item-details');if(!panel)return;
 if(!Object.prototype.hasOwnProperty.call(GAME_ITEM_LABELS,itemKey))return;
 const available=Math.max(0,Math.floor(Number(playerData.stationOre&&playerData.stationOre[itemKey])||0));
 const room=playerShip?Math.max(0,Math.floor((Number(playerShip.maxCargo)||0)-(Number(playerShip.cargo)||0))):0;
 const max=Math.min(available,room);
 panel.innerHTML='<div class="hangar-item-detail-head">'+hangarItemPicture(itemKey)+'<strong>'+itemLabel(itemKey).toUpperCase()+'</strong><button onclick="window.closeHangarItem()" aria-label="Close">✕</button></div><p>Station storage: '+available.toLocaleString()+'</p><p>Available cargo space: '+room.toLocaleString()+'</p><label>Quantity to move <input id="hangar-detail-qty" type="number" min="1" max="'+max+'" value="'+max+'" inputmode="numeric"></label><button onclick="window.moveHangarItemToCargo(\''+itemKey+'\')" '+(!playerShip||!playerShip.docked||max<1?'disabled':'')+'>MOVE TO CARGO</button>';
 panel.style.display='block';panel.scrollIntoView({behavior:'smooth',block:'nearest'});
};
window.closeHangarItem=function(){const p=document.getElementById('hangar-item-details');if(p){p.style.display='none';p.innerHTML='';}};
window.moveHangarItemToCargo=function(itemKey){const input=document.getElementById('hangar-detail-qty');const qty=Math.floor(Number(input&&input.value)||0);window.loadHangarItemToShip(itemKey,qty);window.closeHangarItem();};
window.loadHangarItemToShip = function(itemKey, requestedQty) {
  const input = document.getElementById('hangar-qty-' + itemKey);
  const qty = requestedQty===undefined?Math.floor(Number(input && input.value) || 0):Math.floor(Number(requestedQty)||0);
  if (!playerShip || !playerShip.docked) {
    window.showCorpNotification('Dock your active ship before loading its cargo.');
    return;
  }
  const available = Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[itemKey]) || 0));
  const room = Math.max(0, Math.floor((Number(playerShip.maxCargo) || 0) - (Number(playerShip.cargo) || 0)));
  if (!Object.prototype.hasOwnProperty.call(GAME_ITEM_LABELS, itemKey) || qty < 1 || qty > available) {
    window.showCorpNotification('Choose a valid quantity from your hangar.');
    return;
  }
  if (room < 1) {
    window.showCorpNotification('Your active ship cargo hold is full.');
    return;
  }
  const moved = addOreToCargo(playerShip, itemKey, Math.min(qty, room));
  if (moved < 1) {
    window.showCorpNotification('No cargo space available.');
    return;
  }
  playerData.stationOre[itemKey] = Math.max(0, available - moved);
  updateStationUI();
  updateHUD();
  saveGameSession();
  window.showCorpNotification('Loaded ' + moved.toLocaleString() + ' ' + itemLabel(itemKey) + ' into your active ' + playerShip.className + '.');
};

window.sellHangarItemViaTransport = async function(itemKey, requestedQty) {
  const input = document.getElementById('hangar-qty-' + itemKey);
  const qty = requestedQty === undefined
    ? Math.floor(Number(input && input.value) || 0)
    : Math.floor(Number(requestedQty) || 0);
  const available = Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[itemKey]) || 0));
  const manager = botManager && botManager.bots ? botManager.bots.find(function (b) { return b && b.ship && ['Transport Capital', 'Industrial Hauler', 'Freighter'].includes(b.ship.className); }) : null;
  const saleStates = ['sell_to_trade_gate', 'sell_to_market', 'sell_to_return_gate', 'sell_returning', 'to_trade_gate', 'to_market', 'to_return_gate', 'returning'];
  const canReceiveWhileTravelling = !!(manager && saleStates.includes(manager.transportState));
  const canReceiveAtStation = !!(manager && manager.transportState === 'loading' && !manager.transportTask);
  if (!playerShip || !playerShip.docked || (typeof window.getMiniSpaceMapId === 'function' && window.getMiniSpaceMapId() !== 'private_highsec')) {
    window.showCorpNotification('Dock at your Private High-Sec station to deposit goods with the Transport Manager.');
    return;
  }
  if (!manager || manager.transportTask || (!canReceiveAtStation && !canReceiveWhileTravelling)) {
    window.showCorpNotification('Your Transport Manager is busy with a different job and cannot accept goods right now.');
    return;
  }
  const capacity = Math.min(1000000, Math.max(1, Math.floor(Number(manager.ship.maxCargo) || 5000)));
  if (!Object.prototype.hasOwnProperty.call(GAME_ITEM_LABELS, itemKey) || qty < 1 || qty > available) {
    window.showCorpNotification('Choose a quantity up to the amount in your Private High-Sec hangar.');
    return;
  }
  let deposited = 0;
  try {
    // A large hangar deposit is divided into cargo-sized shipment records.
    // This lets one selection exceed the manager's hold while every trip stays within capacity.
    if (!Array.isArray(manager.playerSaleQueue)) manager.playerSaleQueue = [];
    if (canReceiveAtStation && !manager.playerSaleTask && manager.transportState === 'loading') {
      // Put any partially loaded corporation cargo safely back before starting player sales.
      const corpHangar = playerData.corpStationOre || (playerData.corpStationOre = {});
      const oldCargo = manager.ship.cargoByOre || {};
      Object.keys(oldCargo).forEach(function (key) {
        const amount = Math.max(0, Math.floor(Number(oldCargo[key]) || 0));
        if (amount > 0) corpHangar[key] = (Number(corpHangar[key]) || 0) + amount;
      });
      manager.ship.cargo = 0;
      manager.ship.cargoByOre = {};
    }
    while (deposited < qty) {
      const chunk = Math.min(capacity, qty - deposited);
      const shipmentId = 'pilot-sale-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
      const items = {};
      items[itemKey] = chunk;
      const raw = await window.MINISPACE_MARKET.reserveTransportSale(shipmentId, items);
      const receipt = Array.isArray(raw) ? raw[0] : raw;
      if (!receipt || receipt.success === false) throw new Error('The market could not reserve the next cargo batch.');
      manager.playerSaleQueue.push({ shipmentId: shipmentId, items: items, status: 'deposited', owner: 'current_pilot' });
      deposited += chunk;
    }
    if (!window.MINISPACE_MARKET.applyToGame(playerData)) {
      throw new Error('The goods were reserved, but the local hangar could not refresh. Reopen the game before depositing more.');
    }
    if (canReceiveAtStation && !manager.playerSaleTask && !manager.playerSaleIdleSince) {
      manager.playerSaleIdleSince = Date.now();
    }
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    updateStationUI();
    updateCorpUI();
    const waiting = manager.playerSaleQueue.reduce(function (sum, order) {
      return sum + Object.keys(order.items || {}).reduce(function (n, key) { return n + Math.max(0, Math.floor(Number(order.items[key]) || 0)); }, 0);
    }, 0);
    window.showCorpNotification('Deposited ' + deposited.toLocaleString() + ' ' + itemLabel(itemKey) + ' in ' + Math.ceil(deposited / capacity) + ' cargo batch(es). ' + waiting.toLocaleString() + ' goods are waiting for delivery.');
    return { success: true, deposited: deposited };
  } catch (error) {
    if (deposited > 0 && window.MINISPACE_MARKET && typeof window.MINISPACE_MARKET.applyToGame === 'function') window.MINISPACE_MARKET.applyToGame(playerData);
    if (manager.playerSaleQueue.length && typeof window.saveGameSession === 'function') window.saveGameSession();
    updateStationUI();
    updateCorpUI();
    window.showCorpNotification('Transport deposit stopped after ' + (typeof deposited === 'number' ? deposited.toLocaleString() : '0') + ' items: ' + (error.message || error) + '. Any batches already accepted remain queued.');
    return { success: false, deposited: deposited, error: error.message || String(error) };
  }
};

window.sellAllHangarViaTransport = async function() {
  if (window._miniSpaceSellAllRunning) return;
  window._miniSpaceSellAllRunning = true;
  try {
    if (!playerShip || !playerShip.docked ||
        (typeof window.getMiniSpaceMapId === 'function' && window.getMiniSpaceMapId() !== 'private_highsec')) {
      window.showCorpNotification('Dock at your Private High-Sec station to sell your hangar through the Transport Manager.');
      return;
    }
    const manager = botManager && botManager.bots ? botManager.bots.find(function (b) {
      return b && b.ship && ['Transport Capital', 'Industrial Hauler', 'Freighter'].includes(b.ship.className);
    }) : null;
    if (!manager || manager.transportTask ||
        !(['loading','sell_to_trade_gate','sell_to_market','sell_to_return_gate','sell_returning','to_trade_gate','to_market','to_return_gate','returning'].includes(manager.transportState))) {
      window.showCorpNotification('Your Transport Manager cannot accept a Sell All order right now.');
      return;
    }
    if (!window.MINISPACE_MARKET || typeof window.MINISPACE_MARKET.ready !== 'function') {
      throw new Error('The shared hangar system is not ready.');
    }

    // Always take the Sell All snapshot from the authoritative cloud hangar,
    // not a possibly stale local save or an old station panel.
    await window.MINISPACE_MARKET.ready();
    await window.MINISPACE_MARKET.refresh();
    if (!window.MINISPACE_MARKET.applyToGame(playerData)) {
      throw new Error('The cloud hangar has not finished syncing. Please try again.');
    }
    const keys = Object.keys(GAME_ITEM_LABELS);
    const stock = keys.map(function(key) {
      return { key: key, qty: Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[key]) || 0)) };
    }).filter(function(entry) { return entry.qty > 0; });
    if (!stock.length) {
      updateStationUI();
      window.showCorpNotification('Your Private High-Sec hangar is already empty.');
      return;
    }

    let total = 0;
    for (const entry of stock) {
      const result = await window.sellHangarItemViaTransport(entry.key, entry.qty);
      if (result && result.deposited) total += result.deposited;
      if (!result || !result.success || result.deposited !== entry.qty) {
        await window.MINISPACE_MARKET.refresh().catch(function() {});
        window.MINISPACE_MARKET.applyToGame(playerData);
        if (typeof window.saveGameSession === 'function') window.saveGameSession();
        updateStationUI();
        updateCorpUI();
        window.showCorpNotification('Sell All transferred ' + total.toLocaleString() +
          ' goods so far. ' + itemLabel(entry.key) + ' was only partly accepted. Any accepted batches remain safely queued; try Sell All again for the remainder.');
        return;
      }
    }

    // Re-read the cloud after the final reservation and verify every station item is zero.
    await window.MINISPACE_MARKET.refresh();
    if (!window.MINISPACE_MARKET.applyToGame(playerData)) {
      throw new Error('Goods were queued, but the final cloud-hangar check could not complete. Reopen the station to verify.');
    }
    const leftovers = keys.reduce(function(sum, key) {
      return sum + Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[key]) || 0));
    }, 0);
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    updateStationUI();
    updateCorpUI();
    if (leftovers > 0) {
      window.showCorpNotification('Transport accepted ' + total.toLocaleString() + ' goods. ' +
        leftovers.toLocaleString() + ' remain in your station hangar; press Sell All again to send the remainder.');
      return;
    }
    window.showCorpNotification('Hangar emptied: all ' + total.toLocaleString() +
      ' ore and components are now in the Transport Manager sale queue. He will deliver them in cargo-sized trips.');
  } catch (error) {
    window.showCorpNotification('Sell All could not finish: ' + (error.message || error));
  } finally {
    window._miniSpaceSellAllRunning = false;
  }
};

function updateStationUI() {
  updateMarketUI();
  const inTradeHub = typeof window.getMiniSpaceMapId === 'function' &&
    window.getMiniSpaceMapId() === 'public_trade_hub';
  ['trade-market-tab-btn','trade-hangar-tab-btn'].forEach(function(id) {
    const button = document.getElementById(id);
    if (button) button.style.display = inTradeHub ? '' : 'none';
  });
  if (!inTradeHub) {
    ['trade-market','trade-hangar'].forEach(function(tab) {
      const pane = document.getElementById('tab-' + tab);
      if (pane) pane.style.display = 'none';
    });
  }
  const walletText = fmtISK(playerData.isk || 0) + ' Scrap Metals';
  let iskDisplay = document.getElementById('station-isk-display');
  if (iskDisplay) iskDisplay.innerText = walletText;
  const flightWalletDisplay = document.getElementById('isk-text');
  if (flightWalletDisplay) flightWalletDisplay.innerText = 'Scrap Metals: ' + fmtISK(playerData.isk || 0);

  const HANGAR_GROUP_TITLES = { ore: 'ORE', debris: 'COMPONENTS', explorer: 'EXPLORER SHIPS', mining: 'MINING SHIPS', combat: 'COMBAT SHIPS', capital: 'CAPITALS' };
  const HANGAR_SHIP_ART = {
    'Mining Frigate':'mining_frigate.png','Mining Barge':'mining_barge.png',
    'Command Ship':'command_ship.png','Mining Capital':'mining_capital.png',
    'Carrier':'carrier.png','Combat Frigate':'combat_frigate.png',
    'Siege Cruiser':'siege_cruiser.png','Siege Battleship':'siege_battleship.png',
    'Siege Capital':'siege_battleship.png','Exploration Frigate':'exploration_frigate.png',
    'Improved Explorer Frigate':'improved_explorer_frigate.png',
    'Transport Capital':'Transport_Capital.png','Industrial Hauler':'mining_capital.png','Freighter':'mining_capital.png'
  };
  function hangarShipPicture(name) {
    const file = HANGAR_SHIP_ART[name] || 'mining_frigate.png';
    const safeName = String(name).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    return '<div class="hangar-art-frame"><img src="'+file+'" alt="'+safeName+'" loading="lazy" onerror="this.style.display=\'none\'"></div>';
  }
  function hangarItemPicture(key) {
    const colors = {veldspar:'#c99b59',scordite:'#b9c0c8',pyroxeres:'#54b8c8',omber:'#e7bd45',debris_t1:'#a4b3bf',debris_t2:'#58c7d7',debris_t3:'#6c9df2',debris_t4:'#b58be8',debris_t5:'#e5a4ef'};
    const color = colors[key] || '#8bc9d9';
    const isOre = String(key).indexOf('debris_') !== 0;
    const art = isOre
      ? '<path d="M32 5 51 22 45 49 30 59 12 43 14 18Z" fill="'+color+'" stroke="#e8f7ff" stroke-opacity=".8" stroke-width="2"/><path d="m32 5-2 54M14 18l16 12 21-8M12 43l18-13 15 19" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>'
      : '<rect x="13" y="13" width="38" height="38" rx="5" fill="'+color+'" fill-opacity=".25" stroke="'+color+'" stroke-width="3"/><path d="M20 22h24v20H20zM25 18v-5m12 5v-5m-12 38v-5m12 5v-5M8 26h5m38 0h5M8 39h5m38 0h5" fill="none" stroke="'+color+'" stroke-width="3"/><path d="m25 32 6 5 9-11" fill="none" stroke="#eafaff" stroke-width="3"/>';
    return '<div class="hangar-art-frame item-art"><svg viewBox="0 0 64 64" role="img" aria-label="'+itemLabel(key)+'"><circle cx="32" cy="32" r="30" fill="'+color+'" fill-opacity=".12"/>'+art+'</svg></div>';
  }
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
    const manager = botManager && botManager.bots ? botManager.bots.find(function (b) { return b && b.ship && ['Transport Capital', 'Industrial Hauler', 'Freighter'].includes(b.ship.className); }) : null;
    const managerReady = !!(manager && !manager.transportTask && (manager.transportState === 'loading' || ['sell_to_trade_gate','sell_to_market','sell_to_return_gate','sell_returning'].includes(manager.transportState)));
    const inTradeHubNow = typeof window.getMiniSpaceMapId === 'function' && window.getMiniSpaceMapId() === 'public_trade_hub';
    const loadRoom = playerShip ? Math.max(0, (Number(playerShip.maxCargo) || 0) - (Number(playerShip.cargo) || 0)) : 0;
    const rowDefault = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), 5000);
    const rowInput = '<input id="hangar-qty-' + itemKey + '" type="number" min="1" max="' + Math.max(0, Math.floor(Number(qty) || 0)) + '" value="' + rowDefault + '" inputmode="numeric" style="width:72px;max-width:22%;background:#080d12;color:#fff;border:1px solid #40535c;padding:4px;">';
    const loadButton = '<button onclick="window.loadHangarItemToShip(\'' + itemKey + '\')" ' + (!playerShip || !playerShip.docked || inTradeHubNow || qty < 1 || loadRoom < 1 ? 'disabled' : '') + '>Load ship</button>';
    const sellButton = '<button onclick="window.sellHangarItemViaTransport(\'' + itemKey + '\')" ' + (!managerReady || inTradeHubNow || qty < 1 ? 'disabled' : '') + '>Sell via Transport</button>';
    groupRows[g] += '<div class="inventory-slot" role="button" tabindex="0" onclick="window.openHangarItem(\''+itemKey+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();window.openHangarItem(\''+itemKey+'\')}">'+hangarItemPicture(itemKey)+'<strong>'+displayName+'</strong><span class="slot-qty">'+qty.toLocaleString()+'</span><small>Tap for item actions</small><div class="slot-actions" onclick="event.stopPropagation()">'+rowInput+sellButton+'</div></div>';
    groupCount[g]++;
  }

  for (const key of Object.keys(DESIGNS)) {
    const n = (playerData.designs && playerData.designs[key]) || 0;
    if (n > 0) {
      const d = DESIGNS[key];
      const g = HANGAR_SHIP_GROUP[d.hull] || 'capital';
      const costTxt = d.cost ? ' (' + fmtISK(d.cost.isk) + ' Scrap Metals + ' + fmtISK(d.cost.items) + ' ore/components)' : '';
      groupRows[g] += '<div class="inventory-slot"><div class="hangar-art-frame blueprint-art"><span>▤</span></div><strong>' + d.label.toUpperCase() + ' (BLUEPRINT)</strong><span class="slot-qty">' + n + ' stored</span><div class="slot-actions"><button onclick="window.buildDesign(\'' + key + '\')">Build on ' + d.hull + costTxt + '</button></div></div>';
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
    groupRows[g] += '<div class="inventory-slot">'+hangarShipPicture(hull)+'<strong>' + hull.toUpperCase() + ' (HULL)</strong><span class="slot-qty">1 stored</span><div class="slot-actions">' + action + '</div></div>';
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
    groupRows[g] += '<div class="inventory-slot">'+hangarShipPicture(hull)+'<strong>' + hull.toUpperCase() + '</strong><span class="slot-qty">1 owned</span><div class="slot-actions">' + action + '</div></div>';
    groupCount[g]++;
  }

  if ((playerData.transportManagerPurchased || 0) > 0) {
    groupRows.mining += '<div class="inventory-slot">'+hangarShipPicture('Transport Capital')+'<strong>TRANSPORT MANAGER</strong><span class="slot-qty">Active</span><small>Logistics Online</small></div>';
    groupCount.mining++;
  }

  let hangarHtml = '';
  for (const g of ['ore', 'debris', 'explorer', 'mining', 'combat', 'capital']) {
    const body = groupRows[g] || '<div class="fitting-empty">None stored</div>';
    hangarHtml += '<tr data-hangar-group="' + g + '"><td colspan="3" style="padding:0;"><details data-hangar-group="' + g + '" '+(g==='ore'||g==='debris'?'open':'')+'><summary>' + HANGAR_GROUP_TITLES[g] + ' (' + groupCount[g] + ')</summary><div class="inventory-slot-grid">' + body + '</div></details></td></tr>';
  }
  if (playerData.chips > 0) {
    hangarHtml += '<tr data-hangar-group="debris"><td>ITEM LEVEL CHIP</td><td>' + playerData.chips + '</td><td style="color:#8b949e;">Applied on drop</td></tr>';
  }

  const transportManagerForHangar = botManager && botManager.bots ? botManager.bots.find(function (b) {
    return b && b.ship && ['Transport Capital', 'Industrial Hauler', 'Freighter'].includes(b.ship.className);
  }) : null;
  const canSellAllHangar = !!(transportManagerForHangar &&
    !transportManagerForHangar.transportTask &&
    (['loading','sell_to_trade_gate','sell_to_market','sell_to_return_gate','sell_returning','to_trade_gate','to_market','to_return_gate','returning'].includes(transportManagerForHangar.transportState)));
  const hasHangarGoods = Object.keys(GAME_ITEM_LABELS).some(function(key) {
    return Math.max(0, Math.floor(Number(playerData.stationOre && playerData.stationOre[key]) || 0)) > 0;
  });
  hangarHtml = '<tr data-hangar-group="ore"><td colspan="3" style="padding:6px 2px;"><button onclick="window.sellAllHangarViaTransport()" ' +
    (!canSellAllHangar || !hasHangarGoods || !playerShip || !playerShip.docked || inTradeHub ? 'disabled' : '') +
    ' style="width:100%;font-weight:bold;">SELL ALL TO TRANSPORT</button></td></tr>' + hangarHtml;
  let hangarEl = document.getElementById('items-hanger-list');
  if (hangarEl) { hangarEl.innerHTML = hangarHtml; window.setHangarView(window._miniHangarView || 'items'); }
  const fittingEl=document.getElementById('hangar-fitting-panel');
  if(fittingEl){
    let fit='<div class="fitting-heading"><strong>SHIP FITTING</strong><span>'+(playerShip?playerShip.className:'No ship boarded')+'</span></div>';
    if(playerShip){
      const slots=ensureFittedModules(playerShip);
      fit+='<div class="fitting-module-grid">';
      for(const mod of (MODULE_KEYS[playerShip.className]||[])){
        const installed=slots[mod];
        if(installed){
          const rank=Math.max(1,Number(installed.rank)||1),rankCap=getCap(mod,playerShip.className),next=rank<10&&rank<rankCap,req=next?fittedModuleUpgradeRequirements(mod,rank):null;
          const costLabel=next?fmtISK(req.scrap)+' Scrap Metals'+(req.ore?' + '+req.ore.qty.toLocaleString()+' '+itemLabel(req.ore.key)+' + '+req.component.qty.toLocaleString()+' '+itemLabel(req.component.key):''):'';
          const rankStatus=rank>=10?'MAX RANK':rank>=rankCap?'LOCKED · ITEM LEVEL CHIP REQUIRED':'';
          fit+='<div class="fitting-module"><span>'+mod.replace(/([A-Z])/g,' $1').toUpperCase()+' SLOT</span><strong>'+installed.name+' · RANK '+rank+'/'+rankCap+'</strong><small>'+String(installed.rarity||'white').toUpperCase()+' MODULE</small><small class="fitting-bonus">'+fittedModuleBonusLabel(mod,rank,installed.rarity)+'</small><button onclick="window.upgradeFittedModule(\''+mod+'\')" '+(!next||!playerShip.docked?'disabled':'')+'>'+(next?'+ UPGRADE · '+costLabel:rankStatus)+'</button><button onclick="window.removeFittedModule(\''+mod+'\')" '+(!playerShip.docked?'disabled':'')+'>REMOVE</button></div>';
        } else {
          fit+='<div class="fitting-module"><span>'+mod.replace(/([A-Z])/g,' $1').toUpperCase()+' SLOT</span><strong>EMPTY</strong><small>Find a compatible frontier drop</small></div>';
        }
      }
      fit+='</div>';
      fit+='<div class="fitting-heading"><strong>SHIP PERFORMANCE</strong><span>LIVE FITTED STATS</span></div><div class="fitting-performance"><strong>HP '+shipFittingHp(playerShip).toLocaleString()+'</strong><strong>DPS '+shipFittingDps(playerShip).toLocaleString()+'</strong></div>';
    }else fit+='<p>Board a ship to view its module slots.</p>';
    const chips=Array.isArray(playerData.skillChips)?playerData.skillChips:[];
    const drops=Array.isArray(playerData.moduleDrops)?playerData.moduleDrops:[];
    fit+='<div class="fitting-heading"><strong>FRONTIER MODULE DROPS</strong><span>'+drops.length+' stored</span></div>';
    if(drops.length)fit+='<div class="fitting-chip-list">'+drops.map(d=>{
      const compatible=!!(playerShip&&playerShip.docked&&playerShip.className===d.hull&&MODULE_KEYS[d.hull]&&MODULE_KEYS[d.hull].includes(d.module)&&!ensureFittedModules(playerShip)[d.module]);
      const sale=moduleDropSaleValue(d);
      return '<div class="fitting-chip rarity-'+d.rarity+'"><span class="chip-glyph">⬡</span><div><strong>'+d.name+'</strong><small>'+d.hull+' · '+d.module+' · '+d.rarity.toUpperCase()+'</small><small class="fitting-bonus">'+fittedModuleBonusLabel(d.module,1,d.rarity)+'</small></div><button onclick="window.fitFrontierModuleDrop(\''+d.id+'\')" '+(!compatible?'disabled':'')+'>FIT</button><button onclick="window.sellFrontierModuleDrop(\''+d.id+'\')" '+(!inTradeHub||!playerShip||!playerShip.docked?'disabled':'')+'>SELL '+fmtISK(sale)+'</button></div>';
    }).join('')+'</div>';
    fit+='<div class="fitting-heading"><strong>PURPLE SKILL CHIPS</strong><span>'+chips.length+' stored</span></div>';
    if(!chips.length)fit+='<p class="fitting-empty">No purple chips yet. Hunt elite pirates in Level 4–5 frontier systems.</p>';
    else fit+='<div class="fitting-chip-list">'+chips.map(ch=>{
      const compatible=!!(playerShip&&playerShip.docked&&playerShip.className===ch.hull&&MODULE_KEYS[ch.hull]&&MODULE_KEYS[ch.hull].includes(ch.module));
      const full=(Number(getBonusCap(ch.hull,ch.module))||0)>=15;
      return '<div class="fitting-chip"><span class="chip-glyph">✦</span><div><strong>'+ch.name+'</strong><small>'+ch.hull+' · '+ch.module+' · Maximum level +1</small></div><button onclick="window.applySkillChip(\''+ch.id+'\')" '+(!compatible||full?'disabled':'')+'>'+(full?'CAP REACHED':compatible?'FIT CHIP':'BOARD '+ch.hull.toUpperCase())+'</button></div>';
    }).join('')+'</div>';
    fittingEl.innerHTML=fit;
  }
  let hangarValue = 0;
  for (let itemKey in playerData.stationOre) {
    hangarValue += (playerData.stationOre[itemKey] || 0) * (itemPrices[itemKey] || 10);
  }
  let hangarValueEl = document.getElementById('hangar-value');
  if (hangarValueEl) hangarValueEl.innerText = 'HANGAR: ' + fmtISK(hangarValue) + ' Scrap Metals';

  window.setHangarView(window._miniHangarView||'items');
  if (typeof syncAutoplayButton === 'function') syncAutoplayButton();
}

var marketActiveTab = 'mining';
window.setMarketTab = function(tab) {
  if (!['mining','combat','explorer'].includes(tab)) return;
  marketActiveTab = tab;
  updateMarketUI();
};

function recipeHtml(recipe) {
  return recipe.map(function (entry) {
    const have = Math.floor((playerData.stationOre && playerData.stationOre[entry[0]]) || 0);
    const ok = have >= entry[1];
    return '<span style="color:' + (ok ? '#3fb950' : '#f85149') + ';">' +
      entry[1].toLocaleString() + ' ' + itemLabel(entry[0]) +
      ' <span style="color:#8b949e;">(have ' + have.toLocaleString() + ')</span></span>';
  }).join('<br>');
}

function transportBuildOrderStatus(unlockKey) {
  const manager = botManager && botManager.bots
    ? botManager.bots.find(function(bot) {
        const name = bot && bot.ship && bot.ship.className;
        return name === 'Transport Capital' || name === 'Industrial Hauler' || name === 'Freighter';
      })
    : null;
  if (!manager) return null;
  const task = manager.transportTask;
  if (task && task.type === 'ship_build' && task.unlockKey === unlockKey) {
    return { label: '⌛ IN TRANSIT', state: 'transit' };
  }
  if (Array.isArray(manager.transportBuildQueue) &&
      manager.transportBuildQueue.some(function(order) { return order && order.unlockKey === unlockKey; })) {
    return { label: '◷ QUEUED', state: 'queued' };
  }
  return null;
}

function marketShipRows(group) {
  const cur = playerShip ? playerShip.className : '';
  const unlocked = playerData.unlockedShips || {};
  const ships = [
    ['frigate', 'Mining Frigate', 200, 3.4, 'mining'],
    ['barge', 'Mining Barge', 1200, 4.2, 'mining'],
    ['command', 'Command Ship', 2500, 3.5, 'mining'],
    ['capital', 'Mining Capital', 100000, 1.6, 'mining'],
    ['combatFrigate', 'Combat Frigate', 200, 5.0, 'combat'],
    ['carrier', 'Carrier', 5000, 1.65, 'combat'],
    ['siegeCruiser', 'Siege Cruiser', 500, 2.6, 'combat'],
    ['siegeBattleship', 'Siege Battleship', 1000, 3.2, 'combat'],
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
      const orderStatus = !canBuild ? transportBuildOrderStatus(sh.key) : null;
      if (orderStatus) {
        btn = '<button disabled style="opacity:0.42;background:#171b20!important;color:#7b858d!important;border-color:#303840!important;">Fetch & Build</button>' +
          '<span style="display:inline-block;margin-left:6px;padding:4px 6px;border:1px solid #45535c;border-radius:4px;color:#aab6bd;font-size:10px;white-space:nowrap;">' + orderStatus.label + '</span>';
      } else {
        btn = '<button onclick="window.buildShip(\'' + sh.key + '\', \'' + sh.name + '\')" ' + (canBuild ? '' : 'style="opacity:0.9;"') + '>' + (canBuild ? 'Build' : 'Fetch & Build') + '</button>';
      }
    }
    h += '<tr><td>' + sh.name + (isCur ? ' (current)' : '') + '</td><td style="font-size:12px;">' + info + '</td><td>' + btn + '</td></tr>';
  }

  if (group === 'mining') {
    const owned = (playerData.transportManagerPurchased || 0) > 0;
    h += '<tr><td>Transport Manager (corp)</td><td style="font-size:12px;">' +
      (owned ? 'Free logistics active' : 'FREE — limited-time starter offer') + '</td><td>' +
      (owned ? '<button disabled>Active</button>' : '<button onclick="window.buildTransportManager()">Hire Free</button>') +
      '</td></tr>';
  }
  return h;
}

function marketItemRows() {
  return '<tr><td colspan="3" style="text-align:center;color:#8b949e;">Ore and components are traded exclusively through the Trade Hub Market.</td></tr>';
}

function updateMarketUI() {
  let el = document.getElementById('market-list');
  if (!el) return;
  const tabs = [['mining', 'MINING YARD'], ['combat', 'COMBAT YARD'], ['explorer', 'EXPLORER YARD']];
  let h = '<tr><td colspan="3" style="padding: 2px 0;">';
  for (const t of tabs) {
    const on = t[0] === marketActiveTab;
    h += '<button onclick="window.setMarketTab(\'' + t[0] + '\')" style="margin-right:4px;' + (on ? 'background:#1f6feb;color:#ffffff;' : '') + '">' + t[1] + '</button>';
  }
  h += '</td></tr>';
  h += marketShipRows(marketActiveTab);
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
function setBar(id, v, max, valueId) {
  const current = Number(v) || 0;
  const maximum = Math.max(0, Number(max) || 0);
  const percent = maximum > 0 ? Math.max(0, Math.min(100, (current / maximum) * 100)) : 0;
  const el = document.getElementById(id);
  if (el) {
    el.style.width = percent + '%';
    el.setAttribute('aria-valuenow', String(Math.round(current)));
    el.setAttribute('aria-valuemax', String(Math.round(maximum)));
  }
  const value = valueId && document.getElementById(valueId);
  if (value) value.textContent = Math.ceil(current).toLocaleString() + ' / ' + Math.ceil(maximum).toLocaleString();
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
  refreshCargoCounter(false);
  const walletText = fmtISK(playerData.isk || 0) + ' Scrap Metals';
  setText('isk-text', 'Scrap Metals: ' + fmtISK(playerData.isk || 0));
  // Keep the docked header and flight HUD tied to the same live wallet value.
  const dockedWalletDisplay = document.getElementById('station-isk-display');
  if (dockedWalletDisplay) dockedWalletDisplay.textContent = walletText;
  let sys = document.getElementById('system-text');
  if (sys) {
    const frontierSystem = isFrontierSpace()
      ? (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(system => system.id === mapManager.currentMapId)
      : null;
    if (frontierSystem) {
      const protectedZone = frontierSystem.lossMode === 'no-loss';
      sys.innerText = 'SYSTEM: ' + frontierSystem.name.toUpperCase() + ' · RING ' + frontierSystem.ring +
        (protectedZone ? ' · NO-LOSS PvP' : ' · FULL-LOOT PvP');
      sys.style.color = protectedZone ? '#38bdf8' : '#f85149';
    } else {
      sys.innerText = inPublicSpace() ? 'SYSTEM: PUBLIC PVP SPACE' :
        (inMissionSpace() && missionManager.activeMission ? 'SYSTEM: ' + missionManager.activeMission.systemName.toUpperCase() : 'SYSTEM: High-Sec 1.0');
      sys.style.color = inPublicSpace() ? '#f85149' : '#3fb950';
    }
  }
  setBar('shield-fill', s.shield, s.maxShield, 'shield-value');
  setBar('armor-fill', s.armor, s.maxArmor, 'armor-value');
  setBar('structure-fill', s.structure, s.maxStructure, 'structure-value');

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
  if ((b = document.getElementById('offensive-btn'))) {
    b.style.display = ['Combat Frigate','Carrier','Siege Cruiser','Siege Battleship','Siege Capital','Explorer Cruiser'].includes(s.className) ? 'block' : 'none';
    b.textContent = 'COMBAT: ' + (playerData.offensiveMode ? 'ON' : 'OFF');
    b.style.color = playerData.offensiveMode ? '#ff8b82' : '#9aa7b0';
    b.style.borderColor = playerData.offensiveMode ? '#b94a48' : '#39434b';
    s.ignoreStationBoss = !playerData.offensiveMode;
  }
}

function refreshCargoCounter(changed){
 const s=playerShip,el=document.getElementById('cargo-text');if(!s)return;
 const cargo=ensureOreCargo(s);
 const amount=Object.keys(cargo).reduce((sum,key)=>sum+Math.max(0,Number(cargo[key])||0),0);
 // Keep the headline total derived from the item-by-item cargo manifest.
 s.cargo=Math.floor(amount);
 if(!el)return;
 const capacity=Math.floor(Number(s.maxCargo)||0);
 el.textContent='CARGO: '+s.cargo.toLocaleString()+' / '+capacity.toLocaleString();
 if(changed){el.classList.remove('cargo-changed');void el.offsetWidth;el.classList.add('cargo-changed');}
}
function cargoIconMarkup(key){
 const symbols={veldspar:'◆',scordite:'▰',pyroxeres:'⬟',omber:'✦',debris_t1:'⌁',debris_t2:'Ⅱ',debris_t3:'▦',debris_t4:'▣',debris_t5:'◈'};
 const cls='cargo-icon-'+String(key).replace(/[^a-z0-9_-]/gi,'');
 return '<span class="cargo-item-icon '+cls+'" aria-hidden="true">'+(symbols[key]||'◆')+'</span>';
}
function updateCargoReadout(){
 const panel=document.getElementById('space-cargo-readout'),list=document.getElementById('space-cargo-items');
 if(!panel||!list||!playerShip)return;
 const cargo=ensureOreCargo(playerShip),keys=Object.keys(cargo).filter(k=>Number(cargo[k])>0);
 panel.style.display=keys.length&&!window._miniSpaceHudCollapsed?'block':'none';
 list.innerHTML=keys.map(k=>'<div class="cargo-item-row"><span>'+cargoIconMarkup(k)+itemLabel(k)+'</span><b>'+Math.floor(cargo[k]).toLocaleString()+'</b></div>').join('');
}
window.setNearbySpaceTab=function(tab){if(!['tears','pirates','ore','players'].includes(tab))return;window._miniSpaceNearbyTab=tab;document.querySelectorAll('#nearby-space-tabs .nearby-tab').forEach(function(btn){btn.classList.toggle('active',btn.dataset.nearbyTab===tab);});updateNearbySpacePanel();};
function updateNearbySpacePanel(){
 const list=document.getElementById('nearby-space-list');if(!list)return;
 if(!playerShip||!mapManager){list.innerHTML='<div class="nearby-empty">Waiting for your ship…</div>';return;}
 const px=Number(playerShip.x)||0,py=Number(playerShip.y)||0,dist=o=>Math.hypot((Number(o&&o.x)||0)-px,(Number(o&&o.y)||0)-py);
 const g={tears:[],pirates:[],ore:[],players:[]},add=(k,n,o,t,x)=>{if(o&&Number.isFinite(Number(o.x))&&Number.isFinite(Number(o.y)))g[k].push({name:String(n||t),x:Number(o.x),y:Number(o.y),distance:dist(o),kind:t,ref:o,extra:x||null});};
 const id=String(mapManager.currentMapId||'');
 if(id==='public_trade_hub'&&window.MINISPACE_TRADE_HUB&&window.MINISPACE_TRADE_HUB.station)add('tears','Trade Hub Station',window.MINISPACE_TRADE_HUB.station,'station','trade');
 else if(id.indexOf('frontier_')===0){if(mainStation)add('tears',(window.MINISPACE_UNIVERSE_SYSTEMS||[]).find(s=>s.id===id)?.name+' Station',mainStation,'station','local');if(mapManager.frontierReturnGate)add('tears','High-Sec Station · return tear',mapManager.frontierReturnGate,'station','return');}
 else if(id.indexOf('mission_')===0&&mapManager.missionReturnGate)add('tears','High-Sec Station · return tear',mapManager.missionReturnGate,'station','return');
 /* 3v3 High-Sec exit gates are hidden from Nearby. */
 else if(mainStation)add('tears','High-Sec Station',mainStation,'station','home');
 const gate=(o,n,x)=>add('tears',n,o,'gate',x);
 if(id.indexOf('frontier_')===0){gate(mapManager.frontierReturnGate,'Universe Return Tear',{return:true});(Array.isArray(mapManager.frontierGates)?mapManager.frontierGates:[]).forEach(o=>{const d=(window.MINISPACE_UNIVERSE_SYSTEMS||[]).find(v=>v.id===o.destinationId);gate(o,(d?d.name:'Frontier')+' Tear',{destinationId:o.destinationId});});}
 else if(id.indexOf('mission_')===0)gate(mapManager.missionReturnGate,'Mission Return Tear',{return:true});
 else{(mapManager.frontierEntryGates||[mapManager.frontierEntryGate]).forEach(o=>{if(!o)return;const d=(window.MINISPACE_UNIVERSE_SYSTEMS||[]).find(v=>v.id===o.destinationId);gate(o,(d?d.name:'Frontier')+' Tear',{destinationId:o.destinationId||'frontier_ashen'});});if(id!=='public_trade_hub')gate(mapManager.publicGate,'Arena Tear',{});if(mapManager.missionEntryGate&&missionManager&&missionManager.activeMission&&!missionManager.activeMission.returned)gate(mapManager.missionEntryGate,'Mission Tear',{mission:true});}
 if((id==='public_space'||id.indexOf('frontier_')===0)&&window.MinispaceOnline&&window.MinispaceOnline.state&&window.MinispaceOnline.state.remotePlayers){Object.values(window.MinispaceOnline.state.remotePlayers).forEach(p=>{if(!p||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y)))return;const pname=String(p.name||p.pilotName||'Pilot').slice(0,16);add('players',pname,p,'player');});}
 if((id==='public_space'||id.indexOf('frontier_')===0)&&publicNpcManager&&Array.isArray(publicNpcManager.publicNpcMiners))publicNpcManager.publicNpcMiners.forEach(n=>{if(n&&n.isAlive&&n.ship&&(n.mapId?n.mapId===id:id==='public_space'))add('pirates',(n.stationGuard?'Station Guard · ':'')+(n.ship.pilotName||n.ship.name||n.className||'Pirate'),n.ship,'pirate');});
 if(Array.isArray(asteroidBelt&&asteroidBelt.entities))asteroidBelt.entities.forEach((o,i)=>{if(o&&Number(o.oreYield)>0)add('ore',itemLabel(o.oreType||'veldspar'),o,'rock');});
 if(debrisField&&typeof debrisField.getEntities==='function')(debrisField.getEntities()||[]).forEach((o)=>{if(o&&Number(o.oreYield)>0)add('ore',itemLabel('debris_t'+(Number(o.tier)||1)),o,'salvage');});
 Object.keys(g).forEach(k=>g[k].sort((a,b)=>a.distance-b.distance));
 const tab=window._miniSpaceNearbyTab||'tears',rows=g[tab]||[],targets=[],esc=v=>String(v).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
 rows.slice(0,20).forEach(o=>{const i=targets.push(o)-1;list.insertAdjacentHTML('beforeend','');});
 window._miniSpaceNearbyTargets=targets;
 list.innerHTML=rows.length?rows.slice(0,20).map(o=>{const i=targets.indexOf(o);const targetGate=o.kind==='gate'&&((o.extra&&o.extra.destinationId&&o.extra.destinationId===window._universeTargetNextHop)||(o.extra&&o.extra.return&&window._universeTargetNextHop==='private_highsec'));return '<button type="button" class="nearby-entry'+(targetGate?' nearby-target-gate':'')+'" data-nearby-index="'+i+'"><span class="nearby-entry-name">'+(targetGate?'★ TARGET · ':'')+esc(o.name)+'</span><span class="nearby-entry-distance">'+Math.round(o.distance).toLocaleString()+' m</span></button>';}).join(''):'<div class="nearby-empty">Nothing detected</div>';
 document.querySelectorAll('#nearby-space-tabs .nearby-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.nearbyTab===tab));
 try{updateCargoReadout();}catch(_){}
}
(function bindNearbySpaceClicks(){
  const list=document.getElementById('nearby-space-list');
  if(!list||list.dataset.bound)return;
  list.dataset.bound='1';
  list.addEventListener('click',function(event){
    const button=event.target.closest('button[data-nearby-index]');
    if(!button||!playerShip)return;
    const item=(window._miniSpaceNearbyTargets||[])[Number(button.dataset.nearbyIndex)];
    if(!item)return;
    if(autoplayManager&&autoplayManager.isAutoplay)window.toggleAutoplay();
    lockedTarget=null;isDockingRequested=false;
    if(item.kind==='station'){
      if(item.extra==='return'){
        targetMovePos={x:item.x,y:item.y};
        window.showCorpNotification('Auto-flight engaged: '+item.name);
      } else {
        window.requestDock();
      }
      return;
    }
    if(item.kind==='rock'||item.kind==='salvage'){
      lockedTarget=item.kind==='rock'?item.ref:null;
      targetMovePos={x:item.x,y:item.y};
      window.showCorpNotification('Auto-flight engaged: '+item.name);
      return;
    }
    if(item.kind==='gate'&&item.extra&&item.extra.destinationId&&typeof window.flyToFrontierGate==='function'){
      window.flyToFrontierGate(item.extra.destinationId);
      return;
    }
    if(item.kind==='gate'&&item.extra&&item.extra.return){
      targetMovePos={x:item.x,y:item.y};
      window.showCorpNotification('Auto-flight engaged: '+item.name);
      return;
    }
    targetMovePos={x:item.x,y:item.y};
    window.showCorpNotification('Auto-flight engaged: '+item.name);
  });
})();

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

  if (isDockingRequested && (!pub || isFrontierSpace()) && mainStation) {
    if (isFrontierSpace()) { isDockingRequested = false; targetMovePos = null; window.showCorpNotification(window.MINISPACE_FRONTIER_STATION && window.MINISPACE_FRONTIER_STATION.structure <= 0 ? 'Station destroyed · docking unavailable. Use a Universe Tear to leave.' : 'Hostile stronghold · destroy the station before leaving it behind.'); return; }
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
  const enemies = playerData.offensiveMode && (pub || isFrontierSpace())
    ? (publicNpcManager && publicNpcManager.publicNpcMiners
      ? publicNpcManager.publicNpcMiners.filter(function(n) {
          return n && n.isAlive && n.ship && (n.mapId ? n.mapId === mapManager.currentMapId : mapManager.currentMapId === 'public_space');
        }).map(function(n) { return n.ship; })
      : []).concat(getRemotePvpTargets(),
        isFrontierSpace() && window.MINISPACE_FRONTIER_STATION && window.MINISPACE_FRONTIER_STATION.structure > 0
          ? [window.MINISPACE_FRONTIER_STATION] : [])
    : [];
  if (playerData.offensiveMode && inMissionSpace() && missionManager) enemies.push.apply(enemies, missionManager.getLivingEnemies());
  ship.ignoreStationBoss = !playerData.offensiveMode;
  ship.weaponsEnabled = !!playerData.offensiveMode;
  (ship.drones || []).forEach(entry => { const drone = entry && (entry.ship || entry); if (drone) drone.weaponsEnabled = !!playerData.offensiveMode; });
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

function getPlayerSalvageCollectionRange() {
  if (!playerShip) return 105;
  const ranges = [
    Number(playerShip.weaponRange) || 0,
    Number(playerShip.laserRange) || 0,
    Number(playerShip.scramblerRange) || 0
  ];
  // Carrier and other drone ships can collect from the effective reach of their deployed drones.
  const drones = Array.isArray(playerShip.drones) ? playerShip.drones : [];
  drones.forEach(entry => {
    const drone = entry && (entry.ship || entry);
    if (!drone) return;
    ranges.push(Number(drone.weaponRange) || 0, Number(drone.scramblerRange) || 0, Number(drone.laserRange) || 0);
  });
  // Keep the old pickup radius as a minimum for mining/exploration hulls without a combat range.
  return Math.max(105, ...ranges.filter(n => Number.isFinite(n) && n > 0));
}
function autoLootNearbyWrecks() {
  if (!playerShip || playerShip.docked || !debrisField ||
      typeof debrisField.getEntities !== 'function' ||
      typeof addOreToCargo !== 'function') return 0;
  let collected = 0;
  const pickupRange = getPlayerSalvageCollectionRange();
  for (const crate of debrisField.getEntities()) {
    if (!crate || crate.isLootCrate === false || !(Number(crate.oreYield) > 0)) continue;
    if (Math.hypot(playerShip.x - crate.x, playerShip.y - crate.y) > pickupRange) continue;
    const tier = Math.max(1, Math.min(5, Math.floor(Number(crate.tier) || 1)));
    const key = 'debris_t' + tier;
    const room = Math.max(0, Math.floor((Number(playerShip.maxCargo) || 0) - (Number(playerShip.cargo) || 0)));
    if (room < 1) break;
    const amount = Math.min(room, Math.floor(Number(crate.oreYield) || 0));
    if (amount <= 0) continue;
    const added = addOreToCargo(playerShip, key, amount);
    if (added > 0) {
      crate.oreYield = Math.max(0, Number(crate.oreYield) - added);
      collected += added;
    }
  }
  if (collected > 0) {
    refreshCargoCounter(true);
    updateCargoReadout();
    if (typeof saveGameSession === 'function') saveGameSession();
  }
  return collected;
}

function updateGame() {
  normalizeWrecks();
  if (botManager && typeof botManager.updateExplorerDispatches === 'function') botManager.updateExplorerDispatches();
  const pub = inPublicSpace();
  if (window.Balance) window.Balance.applyAll(balancedShips());
  if (!inMissionSpace() && botManager) {
    if (!pub) {
      botManager.update(playerShip, asteroidBelt, debrisField, mapManager.currentMapId);
    } else if (
      mapManager.currentMapId === 'public_trade_hub' &&
      typeof botManager.updateTransportOnly === 'function'
    ) {
      botManager.updateTransportOnly(playerShip, asteroidBelt, debrisField, mapManager.currentMapId);
    }
  }
  if (asteroidBelt) asteroidBelt.update();
  if (debrisField) debrisField.update();
  if (!inMissionSpace() && publicNpcManager) publicNpcManager.update(mapManager.currentMapId, playerShip, asteroidBelt, playerData, updateStationUI, saveGameSession, debrisField);
  if (inMissionSpace() && missionManager) missionManager.updateMissionFleet(playerShip);
  if (!inMissionSpace() && window.SiegeCapital) window.SiegeCapital.update();

  if (pub && mapManager.currentMapId === 'public_space') {
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
  autoLootNearbyWrecks();
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
      const frontierGates = mapManager ? (mapManager.frontierEntryGates || [mapManager.frontierEntryGate]) : [];
      const frontierEntry = frontierGates.find(g => g && Math.hypot(playerShip.x - g.x, playerShip.y - g.y) < g.radius);
      if (frontierEntry) {
        window.jumpToFrontierSystem(frontierEntry.destinationId || 'frontier_ashen');
      } else {
        const g = mapManager ? mapManager.publicGate : null;
        if (g && Math.hypot(playerShip.x - g.x, playerShip.y - g.y) < g.radius) window.jumpToPublicSpace(0);
      }
    }
  } else if (mapManager && String(mapManager.currentMapId).indexOf('frontier_') === 0) {
    const back=mapManager.frontierReturnGate;
    if(back&&Math.hypot(playerShip.x-back.x,playerShip.y-back.y)<back.radius) {
      const destination=window._universeRouteDestination;
      window._universeRouteDestination=null;
      window.jumpToPrivateSec();
      if(destination==='private_highsec')window.showCorpNotification('Arrived home in Private High-Sec.');
    } else for(const gate of (mapManager.frontierGates||[])) {
      if(Math.hypot(playerShip.x-gate.x,playerShip.y-gate.y)<gate.radius){window.jumpToFrontierSystem(gate.destinationId);break;}
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

function drawSpaceDepthBackground(context, camX, camY, width, height, ship) {
  const t=Date.now()*0.001,vx=Number(ship&&ship.vx)||0,vy=Number(ship&&ship.vy)||0,speed=Math.hypot(vx,vy);
  const layers=[{count:75,depth:.12,size:.7,alpha:.35},{count:58,depth:.28,size:1.05,alpha:.55},{count:34,depth:.52,size:1.5,alpha:.78}];
  context.save();
  const glow=context.createRadialGradient(width*.52,height*.48,0,width*.52,height*.48,Math.max(width,height)*.72);glow.addColorStop(0,'rgba(20,48,68,.22)');glow.addColorStop(1,'rgba(2,6,13,0)');context.fillStyle=glow;context.fillRect(0,0,width,height);
  layers.forEach((layer,li)=>{for(let i=0;i<layer.count;i++){const seed=(i*92821+li*12731+17)>>>0,rx=((seed*16807)%2147483647)/2147483647,ry=((seed*48271+97)%2147483647)/2147483647,x=((rx*width-camX*layer.depth*.035)%width+width)%width,y=((ry*height-camY*layer.depth*.035)%height+height)%height,tw=.72+.28*Math.sin(t*(1+li*.35)+i);context.globalAlpha=layer.alpha*tw;context.fillStyle=li===2?'#d9f5ff':'#a8c8dc';context.beginPath();context.arc(x,y,layer.size,0,Math.PI*2);context.fill();}});
  if(speed>.65){const len=Math.min(42,speed*2.8);context.globalAlpha=Math.min(.42,speed*.035);context.strokeStyle='#9bd9f5';context.lineWidth=1;for(let i=0;i<18;i++){const x=((i*73+t*vx*1.4)%width+width)%width,y=((i*131+t*vy*1.4)%height+height)%height;context.beginPath();context.moveTo(x,y);context.lineTo(x-vx/Math.max(1,speed)*len,y-vy/Math.max(1,speed)*len);context.stroke();}}
  context.restore();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  const ship = playerShip;
  if (!ship) return;
  const currentCameraMapId = String(mapManager && mapManager.currentMapId || '');
  if (cameraMapId !== currentCameraMapId) {
    cameraMapId = currentCameraMapId;
    cameraOffsetX = 0;
    cameraOffsetY = 0;
  }
  const camX = ship.x + cameraOffsetX, camY = ship.y + cameraOffsetY;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (backgroundDecor && typeof backgroundDecor.draw === 'function') {
    backgroundDecor.draw(ctx, -camX, -camY, W / dpr, H / dpr);
  }
  drawSpaceDepthBackground(ctx,camX,camY,W/dpr,H/dpr,ship);

  const z = cameraZoom * dpr;
  ctx.setTransform(z, 0, 0, z, W / 2 - camX * z, H / 2 - camY * z);
  const hw = W / 2 / z, hh = H / 2 / z;
  const view = { x1: camX - hw - 200, x2: camX + hw + 200, y1: camY - hh - 200, y2: camY + hh + 200 };
  const pub = inPublicSpace();

  const worldTransform = [z, 0, 0, z, W / 2 - camX * z, H / 2 - camY * z];
  const safeWorldDraw = (name, drawFn) => {
    ctx.save();
    try { drawFn(); }
    catch (drawError) {
      if (!safeWorldDraw.warned) safeWorldDraw.warned = new Set();
      if (!safeWorldDraw.warned.has(name)) {
        safeWorldDraw.warned.add(name);
        console.error('[MiniSpace render] ' + name + ' failed:', drawError && drawError.stack ? drawError.stack : drawError);
      }
    } finally {
      try { ctx.restore(); } catch (_) {}
      ctx.setTransform(...worldTransform);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
    }
  };

  safeWorldDraw('map gates/station', () => {
    if (inMissionSpace()) {
      if (mapManager && mapManager.missionReturnGate) mapManager.missionReturnGate.draw(ctx);
    } else if (mapManager && String(mapManager.currentMapId).indexOf('frontier_') === 0) {
      if (mainStation && typeof mainStation.draw === 'function') mainStation.draw(ctx);
      if(mapManager.frontierReturnGate)mapManager.frontierReturnGate.draw(ctx);
      (mapManager.frontierGates||[]).forEach(g=>g.draw(ctx));
    } else if (!pub) {
      if (mainStation && typeof mainStation.draw === 'function') mainStation.draw(ctx);
      (mapManager.frontierEntryGates || [mapManager.frontierEntryGate]).forEach(g => { if (g && typeof g.draw === 'function') g.draw(ctx); });
      if (mapManager && mapManager.publicGate && typeof mapManager.publicGate.draw === 'function') mapManager.publicGate.draw(ctx);
      if (missionManager && missionManager.activeMission && !missionManager.activeMission.returned && mapManager.missionEntryGate) mapManager.missionEntryGate.draw(ctx);
    } else if (mapManager && mapManager.playerGates) {
      for (let gate of mapManager.playerGates) if (gate && typeof gate.draw === 'function') gate.draw(ctx);
    }
  });
  if (asteroidBelt && typeof asteroidBelt.draw === 'function') safeWorldDraw('asteroid belt', () => asteroidBelt.draw(ctx, view));
  if (debrisField && typeof debrisField.draw === 'function') safeWorldDraw('debris field', () => debrisField.draw(ctx));

  if (!pub && !inMissionSpace() && botManager && typeof botManager.draw === 'function') safeWorldDraw('corp ships', () => botManager.draw(ctx, asteroidBelt, debrisField, mapManager.currentMapId));
  if (!inMissionSpace() && publicNpcManager && typeof publicNpcManager.draw === 'function') safeWorldDraw('public pirates', () => publicNpcManager.draw(ctx, mapManager.currentMapId, asteroidBelt));
  if (inMissionSpace() && missionManager) safeWorldDraw('mission fleet', () => missionManager.drawMissionFleet(ctx));

  if (!ship.docked && typeof ship.draw === 'function') safeWorldDraw('player ship', () => {
    const cargoBeforeDraw = Number(ship.cargo) || 0;
    ship.draw(ctx, asteroidBelt);
    const minedDuringDraw = Math.max(0, (Number(ship.cargo) || 0) - cargoBeforeDraw);
    if (minedDuringDraw > 0 && ['Mining Frigate','Mining Barge'].includes(ship.className)) awardPlayerXP('mining', minedDuringDraw / 100, 'Ore mined');
  });
  if (!inMissionSpace() && window.SiegeCapital) safeWorldDraw('siege capital', () => window.SiegeCapital.draw(ctx));
  const remote=window.MinispaceOnline&&window.MinispaceOnline.state&&window.MinispaceOnline.state.remotePlayers;
  if(remote)Object.values(remote).forEach(p=>{
    if(!p||p.mapId!==mapManager.currentMapId||!isFinite(Number(p.x))||!isFinite(Number(p.y)))return;
    const z=Math.max(.45,Number(window.cameraZoom)||1),name=String(p.name||'PILOT').slice(0,16);
    ctx.save();ctx.translate(Number(p.x),Number(p.y));
    ctx.font='bold '+11/z+'px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    const labelW=Math.max(82,ctx.measureText(name).width+24/z),labelH=27/z,labelY=-((Number(p.radius)||22)+25)/z;
    ctx.fillStyle='rgba(3,15,22,.94)';ctx.strokeStyle='#36b99a';ctx.lineWidth=1.5/z;
    ctx.beginPath();ctx.roundRect(-labelW/2,labelY-labelH/2,labelW,labelH,7/z);ctx.fill();ctx.stroke();
    ctx.shadowColor='#36b99a';ctx.shadowBlur=6/z;ctx.fillStyle='#b7f5e4';ctx.fillText(name,0,labelY-2/z);
    ctx.shadowBlur=0;ctx.fillStyle='#7fa8b8';ctx.font='7px system-ui,sans-serif';ctx.fillText('PILOT',0,labelY+8/z);
    ctx.rotate(Number(p.angle)||0);ctx.fillStyle='#36b99a';ctx.beginPath();ctx.moveTo(0,-13/z);ctx.lineTo(8/z,9/z);ctx.lineTo(0,5/z);ctx.lineTo(-8/z,9/z);ctx.closePath();ctx.fill();ctx.restore();
  });

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
  drawMiniSpaceJumpEffect(ctx, W, H);
  const otherPilots=window.MinispaceOnline&&window.MinispaceOnline.state&&window.MinispaceOnline.state.remotePlayers;if(otherPilots){m.fillStyle='#36b99a';Object.values(otherPilots).forEach(p=>{if(p&&p.mapId===mapManager.currentMapId&&isFinite(Number(p.x))&&isFinite(Number(p.y))){m.beginPath();m.arc(Number(p.x)*sc,Number(p.y)*sc,2.4,0,Math.PI*2);m.fill();}});}m.save();m.translate(playerShip.x*sc,playerShip.y*sc);m.rotate(Number(playerShip.angle)||0);m.fillStyle='#e8fbff';m.strokeStyle='#36b99a';m.lineWidth=1.2;m.beginPath();m.moveTo(0,-5);m.lineTo(3.7,4);m.lineTo(0,2);m.lineTo(-3.7,4);m.closePath();m.fill();m.stroke();m.restore();m.strokeStyle='rgba(112,166,190,.55)';m.lineWidth=1;m.strokeRect(.5,.5,size-1,size-1);
}

let frameCount = 0;
// Fixed-step simulation: camera zoom changes only rendering, never the rate at which the world advances.
const SIMULATION_STEP_MS = 1000 / 60;
let lastSimulationFrame = null;
let simulationAccumulator = 0;
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);
  try { updateNearbySpacePanel(); } catch (nearbyError) { if (!updateNearbySpacePanel._warned) { console.error('Nearby space list error:', nearbyError && nearbyError.stack ? nearbyError.stack : nearbyError); updateNearbySpacePanel._warned = true; } }
  if (!ctx || !playerShip) return;
  try {
    const now = Number(timestamp) || (lastSimulationFrame === null ? 0 : lastSimulationFrame + SIMULATION_STEP_MS);
    const elapsed = lastSimulationFrame === null ? SIMULATION_STEP_MS : Math.min(250, Math.max(0, now - lastSimulationFrame));
    lastSimulationFrame = now;
    simulationAccumulator += elapsed;
    let steps = 0;
    while (simulationAccumulator >= SIMULATION_STEP_MS && steps < 15) {
      try { updateGame(); }
      catch (updateError) {
        if (!gameLoop._updateWarned) {
          console.error('[MiniSpace update] Simulation step failed; rendering will continue:', updateError && updateError.stack ? updateError.stack : updateError);
          gameLoop._updateWarned = true;
        }
      }
      simulationAccumulator -= SIMULATION_STEP_MS;
      steps++;
    }
    render();
    frameCount++;
    if (frameCount % 5 === 0) updateHUD();
    if (frameCount % 900 === 0) saveGameSession();
  } catch (err) {
    if (!gameLoop._warned || frameCount % 300 === 0) { console.error('Game loop error:', err && err.stack ? err.stack : err); gameLoop._warned = true; }
  }
}

// Do not load or start a pilot until the email/password account has been verified.
function restoreSavedFrontierLocation() {
  const saved = window.MINISPACE_SAVED_POSITION || playerData.lastKnownLocation;
  if (!saved || !String(saved.mapId || '').startsWith('frontier_')) return false;
  const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === saved.mapId);
  if (!system || !playerShip || !mapManager) return false;
  const result = mapManager.jumpToFrontierSystem(playerShip, system.id);
  if (!result) return false;
  asteroidBelt = result.asteroidBelt;
  debrisField = result.debrisField;
  mainStation = result.station || mapManager.frontierStation || homeStation;
  window.MINISPACE_FRONTIER_STATION = mainStation;
  if (publicNpcManager) publicNpcManager.initFrontierSystem(system, mainStation);
  playerShip.x = Number.isFinite(Number(saved.x)) ? Number(saved.x) : playerShip.x;
  playerShip.y = Number.isFinite(Number(saved.y)) ? Number(saved.y) : playerShip.y;
  playerShip.vx = 0;
  playerShip.vy = 0;
  playerShip.angle = Number(saved.angle) || playerShip.angle || 0;
  playerShip.docked = false;
  targetMovePos = null;
  lockedTarget = null;
  isDockingRequested = false;
  gateCooldown = 180;
  window.showCorpNotification('LOCATION RESTORED · ' + system.name + ' · your last frontier position.');
  return true;
}

Promise.resolve(window.MINISPACE_AUTH_READY).then(async function () {
  loadGameSession();

  // Once the latest cloud save is loaded, hydrate the game wallet and private
  // hangar from the shared economy (only after its one-time bootstrap succeeds).
  try {
    if (window.MINISPACE_MARKET) {
      await window.MINISPACE_MARKET.ready();
      if (window.MINISPACE_MARKET.applyToGame(playerData)) {
        saveGameSession();
      }
    }
  } catch (marketError) {
    console.warn('Shared economy is not ready yet; keeping the local pilot save:', marketError.message || marketError);
  }

  const restoredFrontierLocation = restoreSavedFrontierLocation();
  if (restoredFrontierLocation) saveGameSession();
  const _setupModal = document.getElementById('setup-modal');
  if (_setupModal && playerData.pilotName && playerData.race) _setupModal.style.display = 'none';

  let _stationUi = document.getElementById('station-ui');
  if (_stationUi) _stationUi.style.display = 'none';
  if (playerShip && !restoredFrontierLocation) {
    playerShip.x = mainStation.x + 250;
    playerShip.y = mainStation.y + 250;
  }
  updateStationUI();
  updateCorpUI();
  updateMissionsUI();
  ensureAutoplayButton();
  gameLoop();
}).catch(function (error) {
  console.error('MiniSpace account startup failed:', error);
});
// ONLINE MULTIPLAYER: expose the current map
window.getMiniSpaceMapId = function() {
  return mapManager?.currentMapId || 'private_highsec';
};

// MISSION DEATH FIX
// Failing a mission on death clears the ship-change lock.
window.handlePlayerDeath = function() {
  let destroyed = playerShip ? playerShip.className : 'Ship';
  const currentSystem = isFrontierSpace()
    ? (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === mapManager.currentMapId)
    : null;

  // Protected frontier rings are PvP combat zones, but destruction never removes
  // the pilot's hull, fittings, blueprints, cargo or wallet.
  if (currentSystem && currentSystem.lossMode === 'no-loss') {
    if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();
    if (playerShip) {
      playerShip.structure = Number(playerShip.maxStructure) || 1;
      playerShip.shield = Number(playerShip.maxShield) || 0;
      playerShip.armor = Number(playerShip.maxArmor) || 0;
      playerShip.vx = 0; playerShip.vy = 0;
      playerShip.docked = false;
    }
    window.showCorpNotification('Ship disabled in protected PvP · no ship, module or cargo loss. Returning to High-Sec.');
    window.jumpToPrivateSec();
    if (playerShip && homeStation) {
      playerShip.x = homeStation.x + 250;
      playerShip.y = homeStation.y + 250;
    }
    performDock();
    updateMissionsUI();
    saveGameSession();
    return;
  }

  if (missionManager && missionManager.activeMission) {
    window.showCorpNotification('Ship destroyed! Mission failed. You can choose another ship and try again.');
    missionManager.activeMission = null;
    missionManager.generateMissions();
  } else {
    window.showCorpNotification(destroyed + ' and its fittings destroyed! The hull is lost and must be rebuilt from its Shipyard recipe. Returning to base.');
  }

  playerData.activeMission = null;

  if (playerData.upgrades) delete playerData.upgrades[destroyed];
  if (playerData.hullDesigns) delete playerData.hullDesigns[destroyed];
  if (playerData.builtHulls) delete playerData.builtHulls[destroyed];
  if (playerData.fittedModules) delete playerData.fittedModules[destroyed];

  const destroyedUnlockKey = ({
    'Combat Frigate': 'combatFrigate',
    'Mining Barge': 'barge',
    'Command Ship': 'command',
    'Carrier': 'carrier',
    'Mining Capital': 'capital',
    'Exploration Frigate': 'explorationFrigate',
    'Improved Explorer Frigate': 'explorationFrigate',
    'Siege Cruiser': 'siegeCruiser',
    'Siege Battleship': 'siegeBattleship'
  })[destroyed];
  if (destroyedUnlockKey && playerData.unlockedShips) {
    delete playerData.unlockedShips[destroyedUnlockKey];
    playerData.shipsOwned = (playerData.shipsOwned || []).filter(name => name !== destroyed);
  }

  if (playerShip) playerShip.moduleLevels = {};

  playerShip = sessionManager.setShipClass(playerShip, 'Mining Frigate', 200, 3.4);
  applyDesign(playerShip);
  playerShip.cargo = 0;
  playerShip.cargoByOre = {};
  playerShip.structure = playerShip.maxStructure;
  playerShip.docked = false;

  if (autoplayManager && autoplayManager.isAutoplay) window.toggleAutoplay();

  window.jumpToPrivateSec();
  performDock();

  updateMissionsUI();
  saveGameSession();
};


// RESTORE SAVED POSITION IN PRIVATE HIGH-SEC ONLY
const savedPosition = window.MINISPACE_SAVED_POSITION;

if (
  savedPosition &&
  savedPosition.mapId === 'private_highsec' &&
  playerShip
) {
  playerShip.x = savedPosition.x;
  playerShip.y = savedPosition.y;
  playerShip.vx = savedPosition.vx;
  playerShip.vy = savedPosition.vy;
  playerShip.angle = savedPosition.angle;
  playerShip.docked = savedPosition.docked;
}
// RESTORE ACTIVE MISSION AREA AFTER RELOAD
const savedMissionPosition = window.MINISPACE_SAVED_POSITION;

if (
  savedMissionPosition &&
  typeof savedMissionPosition.mapId === 'string' &&
  savedMissionPosition.mapId.indexOf('mission_') === 0 &&
  missionManager &&
  missionManager.activeMission &&
  !missionManager.activeMission.returned
) {
  const mission = missionManager.activeMission;

  // Rebuild the mission area.
  const missionWorld = mapManager.jumpToMissionSystem(playerShip, mission);
  asteroidBelt = missionWorld.asteroidBelt;
  debrisField = missionWorld.debrisField;

  // Restore the saved ship position.
  playerShip.x = savedMissionPosition.x;
  playerShip.y = savedMissionPosition.y;
  playerShip.vx = savedMissionPosition.vx;
  playerShip.vy = savedMissionPosition.vy;
  playerShip.angle = savedMissionPosition.angle;
  playerShip.docked = false;

  // Restart the encounter without changing its mission or reward.
  if (!mission.completed) {
    mission.kills = 0;
    mission.fleet = [];
    mission.spawnedFleet = false;
    missionManager.spawnMissionFleet(asteroidBelt, playerShip);
  } else {
    mission.fleet = [];
    mission.spawnedFleet = true;
  }

  targetMovePos = null;
  lockedTarget = null;
  isDockingRequested = false;

  updateMissionsUI();
  saveGameSession();
}

/* TRADE HUB CONNECTION - separate from Station Loot */
(function () {
  if (!window.MINISPACE_TRADE_HUB) return;

  const tradeGate = {
    x: 4200,
    y: 2500,
    radius: 100,
    draw(ctx) {
      // Reuse the animated emerald space-tear effect used by mission gates.
      drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.ret, 24);

      // Keep the destination label legible at phone and desktop zoom levels.
      const zoom = Math.max(0.45, Number(cameraZoom) || 1);
      const fontSize = 18 / zoom;
      const labelY = this.y - this.radius - (34 / zoom);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
      const label = 'MARKET SYSTEM';
      const width = ctx.measureText(label).width + (24 / zoom);
      const height = 30 / zoom;
      ctx.fillStyle = 'rgba(3, 15, 22, 0.88)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.roundRect(this.x - width / 2, labelY - height / 2, width, height, 7 / zoom);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ecfdf5';
      ctx.shadowColor = '#34d399';
      ctx.shadowBlur = 9 / zoom;
      ctx.fillText(label, this.x, labelY);
      ctx.restore();
    }
  };

  const hubReturnGate = {
    x: 700,
    y: 3500,
    radius: 100,
    draw(ctx) {
      // Matching return tear, so the route is visually consistent in both systems.
      drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.ret, 25);

      const zoom = Math.max(0.45, Number(cameraZoom) || 1);
      const fontSize = 18 / zoom;
      const labelY = this.y - this.radius - (34 / zoom);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
      const label = 'MARKET SYSTEM';
      const width = ctx.measureText(label).width + (24 / zoom);
      const height = 30 / zoom;
      ctx.fillStyle = 'rgba(3, 15, 22, 0.88)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.roundRect(this.x - width / 2, labelY - height / 2, width, height, 7 / zoom);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ecfdf5';
      ctx.shadowColor = '#34d399';
      ctx.shadowBlur = 9 / zoom;
      ctx.fillText(label, this.x, labelY);
      ctx.restore();
    }
  };

  window.jumpToTradeHub = function () {
    const hub = window.MINISPACE_TRADE_HUB;
    mapManager.currentMapId = hub.id;

    const world = hub.createWorld();
    asteroidBelt = world.asteroidBelt;
    debrisField = world.debrisField;

    playerShip.x = hubReturnGate.x + 180;
    playerShip.y = hubReturnGate.y;
    playerShip.vx = 0;
    playerShip.vy = 0;
    playerShip.docked = false;

    targetMovePos = null;
    lockedTarget = null;
    isDockingRequested = false;
    gateCooldown = 180;

    window.showCorpNotification('Welcome to the Trade & Social Hub. PvP is disabled here.');
  };

  const originalWorldSize = currentWorldSize;
  currentWorldSize = function () {
    return mapManager.currentMapId === 'public_trade_hub'
      ? 7000
      : originalWorldSize();
  };

  const originalUpdateGame = updateGame;
  updateGame = function () {
    originalUpdateGame();

    if (!playerShip || gateCooldown > 0) return;

    if (mapManager.currentMapId === 'public_trade_hub') {
      if (Math.hypot(
        playerShip.x - hubReturnGate.x,
        playerShip.y - hubReturnGate.y
      ) < hubReturnGate.radius) {
        window.jumpToPrivateSec();
        window.showCorpNotification('Returned to High-Sec.');
      }
      return;
    }

    if (
      mapManager.currentMapId === 'private_highsec' &&
      Math.hypot(
        playerShip.x - tradeGate.x,
        playerShip.y - tradeGate.y
      ) < tradeGate.radius
    ) {
      window.jumpToTradeHub();
    }
  };

  const originalRender = render;
  render = function () {
    originalRender();

    if (!playerShip || !ctx) return;

    const mapId = mapManager.currentMapId;
    if (
      mapId !== 'private_highsec' &&
      mapId !== 'public_trade_hub'
    ) return;

    const dpr = window.devicePixelRatio || 1;
    const z = cameraZoom * dpr;

    ctx.setTransform(
      z, 0, 0, z,
      canvas.width / 2 - playerShip.x * z,
      canvas.height / 2 - playerShip.y * z
    );

    if (mapId === 'private_highsec') {
      tradeGate.draw(ctx);
    } else {
      hubReturnGate.draw(ctx);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
})();
/* TRADE HUB: HIDE CORP MINERS AND SHOW HUB GATES ON MINIMAP */
(function () {
  if (!botManager) return;

  const oldBotDraw = botManager.draw;
  botManager.draw = function () {
    const originalBots = this.bots;
    const currentMap = mapManager.currentMapId;
    this.bots = originalBots.filter(function (bot) {
      const ship = bot && bot.ship;
      const isTransport =
        ship && (
          ship.className === 'Transport Capital' ||
          ship.className === 'Industrial Hauler' ||
          ship.className === 'Freighter'
        );

      if (isTransport) {
        return (bot.transportMapId || 'private_highsec') === currentMap;
      }

      return currentMap !== 'public_trade_hub';
    });

    try {
      return oldBotDraw.apply(this, arguments);
    } finally {
      this.bots = originalBots;
    }
  };


})();

/* HIDE AND DISABLE 3V3 ENTRANCE INSIDE TRADE HUB ONLY */
(function () {
  const previousUpdate = updateGame;

  updateGame = function () {
    const gate = mapManager && mapManager.publicGate;

    if (mapManager.currentMapId === 'public_trade_hub' && gate) {
      const oldRadius = gate.radius;
      gate.radius = 0;

      try {
        previousUpdate();
      } finally {
        gate.radius = oldRadius;
      }
      return;
    }

    previousUpdate();
  };

  const previousRender = render;

  render = function () {
    const gate = mapManager && mapManager.publicGate;

    if (mapManager.currentMapId === 'public_trade_hub' && gate) {
      const oldDraw = gate.draw;
      gate.draw = function () {};

      try {
        previousRender();
      } finally {
        gate.draw = oldDraw;
      }
      return;
    }

    previousRender();
  };
})();

/* TRADE HUB - SHOW THE UNIQUE TRADE STATION */
(function () {
  const previousRender = render;

  render = function () {
    const inHub =
      mapManager &&
      mapManager.currentMapId === 'public_trade_hub';

    const oldDraw = mainStation && mainStation.draw;

    // Hide the normal High-Sec station in the Trade Hub
    if (inHub && mainStation) {
      mainStation.draw = function () {};
    }

    try {
      previousRender();
    } finally {
      if (inHub && mainStation) {
        mainStation.draw = oldDraw;
      }
    }

    if (!inHub || !playerShip || !ctx || !canvas) return;

    const station =
      window.MINISPACE_TRADE_HUB &&
      window.MINISPACE_TRADE_HUB.station;

    if (!station || typeof station.draw !== 'function') return;

    const dpr = window.devicePixelRatio || 1;
    const z = cameraZoom * dpr;

    ctx.setTransform(
      z, 0, 0, z,
      canvas.width / 2 - playerShip.x * z,
      canvas.height / 2 - playerShip.y * z
    );

    station.draw(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
})();

/* TRADE HUB - CONNECT DOCKING TO ITS OWN STATION */
(function () {
  const oldRequestDock = window.requestDock;

  window.requestDock = function () {
    if (mapManager.currentMapId !== 'public_trade_hub') {
      return oldRequestDock();
    }

    if (!playerShip || playerShip.docked) return;

    if (autoplayManager && autoplayManager.isAutoplay) {
      window.toggleAutoplay();
    }

    isDockingRequested = true;
    targetMovePos = null;
    lockedTarget = null;
  };

  const oldManualControl = manualControl;

  manualControl = function () {
    if (mapManager.currentMapId !== 'public_trade_hub') {
      return oldManualControl.apply(this, arguments);
    }

    const station = window.MINISPACE_TRADE_HUB.station;
    const oldX = mainStation.x;
    const oldY = mainStation.y;

    mainStation.x = station.x;
    mainStation.y = station.y;

    try {
      return oldManualControl.apply(this, arguments);
    } finally {
      mainStation.x = oldX;
      mainStation.y = oldY;
    }
  };

  const oldUndockShip = undockShip;

  undockShip = function () {
    if (mapManager.currentMapId !== 'public_trade_hub') {
      return oldUndockShip();
    }

    const station = window.MINISPACE_TRADE_HUB.station;
    const oldX = mainStation.x;
    const oldY = mainStation.y;

    mainStation.x = station.x;
    mainStation.y = station.y;

    try {
      return oldUndockShip();
    } finally {
      mainStation.x = oldX;
      mainStation.y = oldY;
    }
  };
})();

/* TRADE HUB - DRAW STATION BEHIND SHIPS */
(function () {
  const previousRender = render;

  render = function () {
    const inHub =
      mapManager &&
      mapManager.currentMapId === 'public_trade_hub';

    const station =
      window.MINISPACE_TRADE_HUB &&
      window.MINISPACE_TRADE_HUB.station;

    if (!inHub || !station || !playerShip) {
      return previousRender();
    }

    const oldDraw = station.draw;

    const dpr = window.devicePixelRatio || 1;
    const z = cameraZoom * dpr;

    ctx.setTransform(
      z, 0, 0, z,
      canvas.width / 2 - playerShip.x * z,
      canvas.height / 2 - playerShip.y * z
    );

    station.draw(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    station.draw = function () {};

    try {
      previousRender();
    } finally {
      station.draw = oldDraw;
    }
  };
})();

/* TRADE HUB - RESTORE STATION AND KEEP PLAYER SHIP IN FRONT */
(function () {
  const previousRender = render;

  render = function () {
    previousRender();

    if (
      !mapManager ||
      mapManager.currentMapId !== 'public_trade_hub' ||
      !playerShip ||
      !ctx ||
      !canvas
    ) return;

    const dpr = window.devicePixelRatio || 1;
    const z = cameraZoom * dpr;

    ctx.setTransform(
      z, 0, 0, z,
      canvas.width / 2 - playerShip.x * z,
      canvas.height / 2 - playerShip.y * z
    );

    // The station was already drawn behind ships by the preceding render wrapper.
    // Redraw only the player's ship above it, avoiding a second station paint.
    // Redraw the player's ship above the station image.
    if (!playerShip.docked && typeof playerShip.draw === 'function') {
      playerShip.draw(ctx, null);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
})();



/* RESTORE STATION UI FOR DOCKED SAVES */
(function () {
  // Restore the station interface when loading a docked save.
  if (playerShip && playerShip.docked) {
    const stationUi = document.getElementById('station-ui');

    if (stationUi) {
      stationUi.style.display = 'flex';
    }

    updateStationUI();
    updateCorpUI();
  }
})();

/* RECOVER SAVED PILOTS FROM AN INVALID MISSION INSTANCE */
(function () {
  // Escape a saved mission map without resetting the rest of the save.
  if (
    mapManager &&
    String(mapManager.currentMapId).indexOf('mission_') === 0 &&
    playerShip
  ) {
    if (missionManager) {
      missionManager.activeMission = null;
      missionManager.generateMissions();
    }

    playerData.activeMission = null;

    const world = mapManager.jumpToPrivateSec(playerShip, mainStation);
    asteroidBelt = world.asteroidBelt;
    debrisField = world.debrisField;

    playerShip.x = mainStation.x + 250;
    playerShip.y = mainStation.y + 250;
    playerShip.vx = 0;
    playerShip.vy = 0;
    playerShip.docked = false;

    playerShip.currentTarget = null;
    targetMovePos = null;
    lockedTarget = null;
    isDockingRequested = false;

    mapManager.missionReturnGate = null;
    gateCooldown = 180;

    const stationUi = document.getElementById('station-ui');
    if (stationUi) stationUi.style.display = 'none';

    updateMissionsUI();
    saveGameSession();
  }
})();

/* CORPORATION HANGAR + EXPLORER 50/25/25 + TRANSPORT MANAGER */
(function () {
  if (!botManager) return;

  playerData.corpStationOre = playerData.corpStationOre || {};

  function isTransportManager(bot) {
    const name = bot && bot.ship && bot.ship.className;
    return name === 'Transport Capital' ||
      name === 'Industrial Hauler' ||
      name === 'Freighter';
  }

  function isExplorer(bot) {
    const name = bot && bot.ship && bot.ship.className;
    return name === 'Exploration Frigate' ||
      name === 'Explorer Cruiser';
  }

  // Fully upgraded corporation miners deposit into the corp hangar.
  const oldCreditMinerShare =
    BotManager.prototype.creditMinerShare;

  BotManager.prototype.creditMinerShare = function (bot, key, amount) {
    if (!this.nextMinerUpgrade(bot)) {
      const inventory = this.playerData.corpStationOre ||
        (this.playerData.corpStationOre = {});

      inventory[key] = (inventory[key] || 0) + amount;
      return;
    }

    return oldCreditMinerShare.call(this, bot, key, amount);
  };

  // Explorer delivery split:
  // 50% player, 12.5% Explorer materials,
  // 12.5% Explorer wallet, 25% corporation market stock.
  BotManager.prototype.processCorpExplorerDocking = function (bot) {
    if (!bot) return;

    const inventory = this.playerData.stationOre ||
      (this.playerData.stationOre = {});
    const corpInventory = this.playerData.corpStationOre ||
      (this.playerData.corpStationOre = {});

    bot.stock = bot.stock || {};
    bot.wallet = Number(bot.wallet) || 0;

    for (const key of Object.keys(bot.tempStock || {})) {
      const amount = Math.max(
        0,
        Math.floor(Number(bot.tempStock[key]) || 0)
      );

      if (amount <= 0) continue;

      const playerShare = Math.floor(amount * 0.50);
      const explorerShare = Math.floor(amount * 0.25);
      const corpShare = amount - playerShare - explorerShare;

      // Player receives 50%.
      inventory[key] = (inventory[key] || 0) + playerShare;

      // Explorer uses 25% for his own progression.
      // Half becomes Cruiser materials; half funds his wallet.
      const explorerMaterials = Math.floor(explorerShare * 0.5);
      const explorerWalletGoods = explorerShare - explorerMaterials;

      bot.stock[key] =
        (bot.stock[key] || 0) + explorerMaterials;

      const itemPrice =
        (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[key]) ||
        10;

      bot.wallet += explorerWalletGoods * itemPrice;

      // Corporation receives 25% for the Transport Manager.
      corpInventory[key] =
        (corpInventory[key] || 0) + corpShare;
    }

    bot.tempStock = {};

    if (typeof this.tryBuildCruiser === 'function') {
      this.tryBuildCruiser(bot);
    }

    if (bot.ship) {
      bot.ship.cargo = 0;
      bot.ship.cargoByOre = {};
    }

    if (typeof window.saveGameSession === 'function') {
      window.saveGameSession();
    }

    if (typeof window.updateStationUI === 'function') {
      window.updateStationUI();
    }
  };

  // Protect Explorer progression stock and wallet from surplus payouts.
  const oldPaySurplus = BotManager.prototype.paySurplus;

  BotManager.prototype.paySurplus = function (bot) {
    if (isExplorer(bot)) return null;
    return oldPaySurplus.call(this, bot);
  };

  // Preserve cargo and Explorer progression in corporation saves.
  const oldSnapshotCorp = snapshotCorp;

  snapshotCorp = function () {
    oldSnapshotCorp();

    if (!botManager || !playerData.corpBots) return;

    botManager.bots.forEach(function (bot, index) {
      const saved = playerData.corpBots[index];
      const ship = bot && bot.ship;

      if (!saved || !ship) return;

      saved.stock = Object.assign({}, bot.stock || {});
      saved.tempStock = Object.assign({}, bot.tempStock || {});
      saved.wallet = bot.wallet || 0;
      saved.cargo = ship.cargo || 0;
      saved.oreType = ship.oreType || null;
      saved.cargoByOre = Object.assign(
        {},
        window.ensureOreCargo
          ? window.ensureOreCargo(ship)
          : ship.cargoByOre || {}
      );
      saved.transportState = bot.transportState || null;
      saved.transportMapId = bot.transportMapId || null;
      saved.transportShipmentId = bot.transportShipmentId || null;
      saved.transportTask = bot.transportTask ? JSON.parse(JSON.stringify(bot.transportTask)) : null;
      saved.playerSaleTask = bot.playerSaleTask ? JSON.parse(JSON.stringify(bot.playerSaleTask)) : null;
      saved.playerSaleQueue = Array.isArray(bot.playerSaleQueue) ? JSON.parse(JSON.stringify(bot.playerSaleQueue)) : [];
      saved.playerSaleIdleSince = Number(bot.playerSaleIdleSince) || 0;
      saved.transportLevel = bot.transportLevel || null;
    });
  };

  // Display Transport Manager loading progress in Corporation tab.
  const oldUpdateCorpUI = updateCorpUI;

  updateCorpUI = function () {
    oldUpdateCorpUI();

    const table = document.getElementById('corp-list');
    if (table) {
      const row = Array.from(table.rows).find(function (r) {
        return r.cells[0] &&
          r.cells[0].innerText.includes('Transport Manager');
      });

      const manager = botManager.bots.find(isTransportManager);

      if (row && row.cells[1]) {
        if (!manager || !manager.ship) {
          row.cells[1].innerText =
            playerData.transportManagerPurchased > 0
              ? 'Transport ship preparing'
              : 'Build it in the Shipyard';
        } else {
          const ship = manager.ship;
          const maxCargo = Math.max(1, ship.maxCargo || 50000);
          const percent = Math.min(
            100,
            Math.floor(((ship.cargo || 0) / maxCargo) * 100)
          );

          const stateLabels = {
            loading: 'Loading corporation goods',
            sell_to_trade_gate: 'Your sale — outbound to Trade Hub',
            sell_to_market: 'Trade Hub — selling your goods',
            sell_to_return_gate: 'Sale complete — returning to gate',
            sell_returning: 'Returning with your sale proceeds',

            to_trade_gate: 'FULL — Departing High-Sec',
            to_market: 'Trade Hub — Delivering shipment',
            to_return_gate: 'Trade Hub — Returning to gate',
            returning: 'Returning to High-Sec',
            buy_to_trade_gate: 'Shipyard order — outbound',
            buy_to_market: 'Trade Hub — collecting ship materials',
            buy_to_return_gate: 'Ship materials secured — returning',
            buy_returning: 'Delivering materials to High-Sec'
          };
          const stateLabel =
            stateLabels[manager.transportState] || 'Transport Manager ready';
          const level = Math.max(1, Math.floor(Number(manager.transportLevel) || 1));
          const queuedOrders = Array.isArray(manager.playerSaleQueue) ? manager.playerSaleQueue : [];
          const queuedGoods = queuedOrders.reduce(function (sum, order) {
            return sum + Object.keys(order.items || {}).reduce(function (n, key) {
              return n + Math.max(0, Math.floor(Number(order.items[key]) || 0));
            }, 0);
          }, 0);
          const idleLeft = manager.playerSaleIdleSince
            ? Math.max(0, 30 - Math.floor((Date.now() - manager.playerSaleIdleSince) / 1000))
            : 30;
          const queueLabel = queuedGoods > 0
            ? ' · Hangar ' + queuedGoods.toLocaleString() + ' waiting' +
              (manager.transportState === 'loading' ? ' · Depart in ' + idleLeft + 's or when full' : '')
            : '';
          row.cells[1].innerText =
            'LV ' + level + ' · ' + stateLabel + ' · ' +
            Math.floor(ship.cargo || 0).toLocaleString() + ' / ' +
            maxCargo.toLocaleString() + ' (' + percent + '%)' + queueLabel;
          if (row.cells[2]) {
            const upgradeCost = 25000 * level;
            const cannotAfford = (Number(playerData.isk) || 0) < upgradeCost;
            row.cells[2].innerHTML = '<button onclick="window.upgradeTransportManager()" ' +
              (cannotAfford ? 'disabled title="Not enough Scrap Metals"' : '') +
              '>UPGRADE CARGO · ' + fmtISK(upgradeCost) + ' Scrap Metals</button>';
          }
        }
      }
    }

    // Render corporation inventory separately from the pilot's personal hangar.
    const hangarTable = document.getElementById('corp-hangar-list');
    const totalLabel = document.getElementById('corp-hangar-total');

    if (hangarTable) {
      while (hangarTable.firstChild) {
        hangarTable.removeChild(hangarTable.firstChild);
      }

      const inventory = playerData.corpStationOre || {};
      const items = Object.keys(inventory).filter(function (key) {
        return Number(inventory[key]) > 0;
      }).sort();

      let totalValue = 0;

      items.forEach(function (key) {
        const quantity = Math.floor(Number(inventory[key]) || 0);
        const unitPrice =
          (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[key]) || 0;
        totalValue += quantity * unitPrice;

        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        const quantityCell = document.createElement('td');
        const priceCell = document.createElement('td');

        nameCell.textContent = key.replace(/_/g, ' ').toUpperCase();
        quantityCell.textContent = quantity.toLocaleString();
        priceCell.textContent = unitPrice.toLocaleString() + ' Scrap Metals';

        row.appendChild(nameCell);
        row.appendChild(quantityCell);
        row.appendChild(priceCell);
        hangarTable.appendChild(row);
      });

      if (!items.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.textContent = 'No corporation goods stored';
        row.appendChild(cell);
        hangarTable.appendChild(row);
      }

      if (totalLabel) {
        totalLabel.textContent =
          'CORP HANGAR VALUE: ' + totalValue.toLocaleString() +
          ' Scrap Metals  |  CORP WALLET: ' +
          (Number(playerData.corpIsk) || 0).toLocaleString() + ' Scrap Metals';
      }
    }
  };

  // Create the Transport Manager ship after purchase.
  const oldBuildTransportManager = window.buildTransportManager;

  window.buildTransportManager = function () {
    oldBuildTransportManager();

    if (
      playerData.transportManagerPurchased > 0 &&
      !botManager.bots.some(isTransportManager)
    ) {
      botManager.addTransportBot();
      saveGameSession();
      updateCorpUI();
    }
  };
})();


/* SINGLE MINIMAP RENDERER: player-centred, isolated from HUD update failures. */
(function () {
  drawMinimap = function () {
    if (!minimapCanvas || !minimapCtx) return;
    const m = minimapCtx, size = 148, cx = size / 2, cy = size / 2, ship = playerShip;
    const world = Math.max(1000, Number(currentWorldSize()) || 5000);
    const range = Math.max(900, Math.min(2600, world * 0.28));
    const scale = (size * 0.44) / range;
    const px = ship && Number.isFinite(Number(ship.x)) ? Number(ship.x) : world / 2;
    const py = ship && Number.isFinite(Number(ship.y)) ? Number(ship.y) : world / 2;
    if (minimapCanvas.width !== size || minimapCanvas.height !== size) { minimapCanvas.width = size; minimapCanvas.height = size; }
    m.setTransform(1,0,0,1,0,0); m.clearRect(0,0,size,size); m.fillStyle='#07111b'; m.fillRect(0,0,size,size);
    m.save(); m.strokeStyle='rgba(112,166,190,.25)'; m.lineWidth=1;
    for(let i=1;i<=3;i++){m.beginPath();m.arc(cx,cy,i*19,0,Math.PI*2);m.stroke();}
    m.beginPath();m.moveTo(cx,3);m.lineTo(cx,size-3);m.moveTo(3,cy);m.lineTo(size-3,cy);m.stroke();
    m.beginPath();m.rect(1,1,size-2,size-2);m.clip();
    const plot=function(x,y,color,radius){x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y))return;const sx=cx+(x-px)*scale,sy=cy+(y-py)*scale;if(sx<2||sy<2||sx>size-2||sy>size-2)return;m.fillStyle=color;m.beginPath();m.arc(sx,sy,radius||2,0,Math.PI*2);m.fill();};
    try{if(asteroidBelt&&Array.isArray(asteroidBelt.entities))asteroidBelt.entities.forEach(r=>{if(r&&Number(r.oreYield)>0)plot(r.x,r.y,'#788895',1.2);});}catch(_){}
    try{const ds=debrisField&&typeof debrisField.getEntities==='function'?debrisField.getEntities():[];if(Array.isArray(ds))ds.forEach(d=>{if(d)plot(d.x,d.y,'#d29922',2);});}catch(_){}
    try{
      const id=mapManager&&mapManager.currentMapId;
      if(id==='private_highsec')plot(4200,2500,'#36b99a',4);
      if(id==='public_trade_hub'){const h=window.MINISPACE_TRADE_HUB&&window.MINISPACE_TRADE_HUB.station;if(h)plot(h.x,h.y,'#58a6ff',4);plot(700,3500,'#36b99a',4);}
      else{if(mainStation)plot(mainStation.x,mainStation.y,'#58a6ff',4);if(mapManager){['publicGate','frontierEntryGate','frontierReturnGate','missionEntryGate','missionReturnGate'].forEach(k=>{const g=mapManager[k];if(g)plot(g.x,g.y,k==='frontierEntryGate'?'#fb923c':'#36b99a',3);});(mapManager.playerGates||[]).forEach(g=>{if(g)plot(g.x,g.y,'#3fb950',3);});(mapManager.frontierGates||[]).forEach(g=>{if(g)plot(g.x,g.y,'#fb923c',3);});}}
    }catch(_){}
    try{
      if(publicNpcManager&&Array.isArray(publicNpcManager.publicNpcMiners))publicNpcManager.publicNpcMiners.forEach(n=>{if(n&&n.isAlive&&n.ship)plot(n.ship.x,n.ship.y,n.faction==='miners'?'#e3b341':'#f85149',3);});
      if(missionManager&&typeof missionManager.getLivingEnemies==='function')missionManager.getLivingEnemies().forEach(e=>{if(e)plot(e.x,e.y,'#f85149',3);});
      const remote=window.MinispaceOnline&&window.MinispaceOnline.state&&window.MinispaceOnline.state.remotePlayers;if(remote)Object.values(remote).forEach(p=>{if(p&&p.mapId===(mapManager&&mapManager.currentMapId))plot(p.x,p.y,'#36b99a',2.5);});
    }catch(_){}
    if(targetMovePos){plot(targetMovePos.x,targetMovePos.y,'#4dd0e1',3);m.save();m.strokeStyle='rgba(77,208,225,.85)';m.setLineDash([3,3]);m.beginPath();m.moveTo(cx,cy);m.lineTo(cx+(targetMovePos.x-px)*scale,cy+(targetMovePos.y-py)*scale);m.stroke();m.restore();}
    m.restore();m.save();m.translate(cx,cy);m.rotate(Number(ship&&ship.angle)||0);m.fillStyle='#fff';m.strokeStyle='#36b99a';m.lineWidth=1.5;m.beginPath();m.moveTo(0,-8);m.lineTo(6,6);m.lineTo(0,3);m.lineTo(-6,6);m.closePath();m.fill();m.stroke();m.restore();
    try{if(typeof updateCargoReadout==='function')updateCargoReadout();}catch(_){}
  };
})();
