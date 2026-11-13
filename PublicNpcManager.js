// PublicNpcManager.js - Manages Public Space NPCs, Central Station Boss, combat AI, and death/despawn handling
// Pirate types. What spawns is decided by the hull the player entered with (ENTRY_SPAWNS below).
const PIRATE_TYPES = {
  frigate: { makeShip: function (x, y) { return new MiningFrigate(x, y); }, name: 'Mining Frigate', marketVal: 150000, hp: 800 },
  barge: { makeShip: function (x, y) { return new MiningBarge(x, y); }, name: 'Mining Barge', marketVal: 1200000, hp: 5200 },
  command: { makeShip: function (x, y) { return new CommandShip(x, y); }, name: 'Command Ship', marketVal: 2500000, hp: 6000 },
  carrier: { makeShip: function (x, y) { return new NpcCarrier(x, y); }, name: 'Carrier', marketVal: 20000000, hp: 25000 },
  capital: { makeShip: function (x, y) { return new CapitalShip(x, y); }, name: 'Capital', marketVal: 12000000, hp: 35000 },
  combatFrigate: { makeShip: function (x, y) { return new CombatFrigate(x, y); }, name: 'Combat Frigate', marketVal: 400000, hp: 1500 },
  explorationFrigate: { makeShip: function (x, y) { return new ExplorationFrigate(x, y); }, name: 'Exploration Frigate', marketVal: 100000, hp: 600 },
  siegeCruiser: { makeShip: function (x, y) { return new SiegeCruiserShip(x, y); }, name: 'Siege Cruiser', marketVal: 1500000, hp: 0 }, // hp 0 = use the player's hull HP
  siegeBattleship: { makeShip: function (x, y) { return new SiegeBattleshipShip(x, y); }, name: 'Siege Battleship', marketVal: 3000000, hp: 0 }
};
// Combat hulls that take the player's full base HP and deal reduced damage (1 = normal)
const MATCH_PLAYER_HP = { 'Combat Frigate': true, 'Siege Cruiser': true, 'Siege Battleship': true };
// Default damage scale per hull. A spawn entry's own `dmg` overrides this.
const DPS_DAMPEN = { 'Combat Frigate': 0.5, 'Siege Cruiser': 0.5, 'Siege Battleship': 0.75 };

// ---- What spawns, by the hull the player enters with ----
// Which group each player hull falls into. Anything not listed counts as a frigate.
const PLAYER_HULL_GROUP = {
  'Mining Frigate': 'frigate', 'Combat Frigate': 'frigate', 'Exploration Frigate': 'frigate', 'Improved Explorer Frigate': 'frigate',
  'Explorer Cruiser': 'cruiser', 'Siege Cruiser': 'cruiser', 'Mining Barge': 'cruiser', 'Command Ship': 'cruiser',
  'Siege Battleship': 'battleship',
  'Carrier': 'capital', 'Capital': 'capital', 'Mining Capital': 'capital'
};
// Hulls that can fight. Any of these spawned in the player's own belt is aggro the moment they enter:
// it spawns close enough to attack straight away and keeps hunting the player. Everything else mines
// rocks until the player comes within PEACE_RANGE.
const COMBAT_HULLS = { 'Combat Frigate': true, 'Siege Cruiser': true, 'Siege Battleship': true, 'Carrier': true, 'Capital': true };
const COMBAT_SPAWN_MIN = 500;  // combat hulls spawn this far from the gate...
const NPC_HP_SCALE = 0.6;       // every pirate spawns with this fraction of its shield / armor / structure
const COMBAT_DPS_SCALE = 0.2;   // every combat ship deals this fraction of its full damage
const COMBAT_SPAWN_VAR = 300;  // ...plus up to this much more, so they are inside PEACE_RANGE on entry
// Each entry: t = pirate type ('miners' = random pick from MINER_POOL), n = how many,
// Damage for combat ships is set by COMBAT_DPS_SCALE; an entry can still carry its own `dmg` for non-combat hulls.
const ENTRY_SPAWNS = {
  frigate: [
    { t: 'combatFrigate', n: 2 },
    { t: 'frigate', n: 3 }
  ],
  cruiser: [
    { t: 'combatFrigate', n: 3 },
    { t: 'siegeCruiser', n: 1 }
  ],
  battleship: [
    { t: 'siegeBattleship', n: 1 },
    { t: 'siegeCruiser', n: 2 },
    { t: 'combatFrigate', n: 3 },
    { t: 'miners', n: 2 }
  ],
  capital: [
    { t: 'carrier', n: 1 },
    { t: 'siegeBattleship', n: 1 },
    { t: 'siegeCruiser', n: 3 },
    { t: 'miners', n: 4 }
  ]
};
const MINER_POOL = [{ t: 'frigate', w: 3 }, { t: 'barge', w: 2 }, { t: 'command', w: 1 }];

function playerHullGroup(ship) { return (ship && PLAYER_HULL_GROUP[ship.className]) || 'frigate'; }

// Legacy tier tables, no longer used to decide spawns (kept in case other files reference them)
const PIRATE_POOLS = {
  1: [{ t: 'frigate', w: 1 }, { t: 'combatFrigate', w: 1 }, { t: 'explorationFrigate', w: 1 }],
  2: [{ t: 'frigate', w: 2 }, { t: 'barge', w: 2 }, { t: 'command', w: 1 }, { t: 'combatFrigate', w: 2 }, { t: 'siegeCruiser', w: 1 }, { t: 'siegeBattleship', w: 1 }],
  3: [{ t: 'command', w: 2 }, { t: 'carrier', w: 2 }, { t: 'capital', w: 1 }, { t: 'combatFrigate', w: 1 }, { t: 'siegeCruiser', w: 2 }, { t: 'siegeBattleship', w: 2 }]
};
const PIRATE_COUNTS = { 1: 4, 2: 5, 3: 6 };
const PIRATE_TIER_OF = {
  'Mining Frigate': 1, 'Combat Frigate': 1, 'Exploration Frigate': 1,
  'Mining Barge': 2, 'Command Ship': 2,
  'Mining Capital': 3, 'Carrier': 3, 'Siege Cruiser': 3, 'Siege Battleship': 3
};

// ================= MOVEMENT SETTINGS =================
// All speeds come from Balance.js (maxSpeed per hull). Nothing here is a hardcoded hull speed.
const PEACE_RANGE = 1000;          // pirates attack the player inside this distance, otherwise they carry on their job
const MATCH_PLAYER_SPEED = false;  // true = every NPC uses the player's maxSpeed instead of its own row
const NPC_SPEED_FALLBACK = 2.5;    // used if a hull has no maxSpeed anywhere
const PATROL_SPEED_FRAC = 0.85;     // patrol cruising speed as a fraction of maxSpeed
const MINE_SPEED_FRAC = 0.75;       // speed flying in to a rock, as a fraction of maxSpeed

// Hulls that patrol their belt. Every other pirate hull mines rocks when the player is away.
const PATROL_NAMES = { 'Mining Frigate': true, 'Mining Barge': true, 'Command Ship': true, 'Carrier': true, 'Capital': true, 'Combat Frigate': true, 'Exploration Frigate': true, 'Siege Cruiser': true, 'Siege Battleship': true };

// Ring the attackers hold around the player, as a fraction of their weapon range
const ORBIT_RANGE_FRAC = 0.9;
const SIEGE_HULLS = { 'Siege Cruiser': true, 'Siege Battleship': true };
const SIEGE_RANGE_FRAC = 0.7;      // siege hulls hold 70% of their weapon range
// The ring is never smaller than this, whatever weaponRange says. These hulls are several hundred units long,
// so a small ring puts them on top of the player.
const SIEGE_MIN_RING = { 'Siege Cruiser': 400, 'Siege Battleship': 500 };
// Real reach of the main weapon when weaponRange is missing or smaller (Battleship missiles reach 800)
const SIEGE_WEAPON_RANGE = { 'Siege Battleship': 800 };
// Used when a ship has no usable weaponRange
const RING_FALLBACK_RANGE = { 'Siege Cruiser': 650, 'Siege Battleship': 800, 'Carrier': 500, 'Capital': 500 };
const RING_DEFAULT_RANGE = 550;
// Smallest ring for each hull, whatever its weaponRange says. Short-range hulls (mining lasers, small guns) would
// otherwise get a tiny ring and fly into the player. Sized to clear each hull's length.
const RING_MIN_DEFAULT = 350;
const ORBIT_MIN_RANGE_BY_HULL = {
  'Combat Frigate': 350, 'Exploration Frigate': 350, 'Mining Frigate': 400,
  'Mining Barge': 450, 'Command Ship': 500, 'Carrier': 500, 'Capital': 500
};

const HUNT_CATCHUP = 1.2;          // while chasing or orbiting they move at least this multiple of the player's own speed
const RING_CORRECTION_GAIN = 0.06; // inward / outward speed per unit of distance from the ring
const LEAD_FRAMES = 10;            // (legacy, no longer used by the steering)
const ORBIT_START_FRAC = 1.5;      // start curving into orbit once within this multiple of the ring radius, come straight in before that
const NPC_ACCEL_FRAC = 0.04;       // most velocity change per frame, as a fraction of maxSpeed (lower = heavier ship)
const NPC_TURN_RATE = 0.06;        // most heading change per frame, in radians
const DEBUG_NPC = true;            // logs siege ship state to the console about every 2 seconds

function pirateTier(ship) { return (ship && PIRATE_TIER_OF[ship.className]) || 1; }
function pickPirate(pool) {
  const total = pool.reduce(function (sum, p) { return sum + p.w; }, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return PIRATE_TYPES[p.t];
  }
  return PIRATE_TYPES[pool[pool.length - 1].t];
}

// Per-pirate rarity: common is the norm; blue is uncommon and purple is very rare.
const PIRATE_RARITY_ROLLS = [
  { rarity: 'common', weight: 58 },
  { rarity: 'uncommon', weight: 25 },
  { rarity: 'rare', weight: 14 },
  { rarity: 'epic', weight: 3 }
];
const PIRATE_RARITY_POWER = {
  common: { hp: 1, damage: 1, loot: 0, rank: 0, label: 'COMMON' },
  uncommon: { hp: 1.25, damage: 1.15, loot: 0.08, rank: 1, label: 'GREEN' },
  rare: { hp: 1.65, damage: 1.35, loot: 0.20, rank: 2, label: 'BLUE' },
  epic: { hp: 2.2, damage: 1.65, loot: 0.35, rank: 3, label: 'PURPLE' }
};
function rollPirateRarity(randomValue) {
  let roll = (randomValue === undefined ? Math.random() : randomValue) * 100;
  for (const entry of PIRATE_RARITY_ROLLS) {
    roll -= entry.weight;
    if (roll < 0) return entry.rarity;
  }
  return 'common';
}

class PublicNpcManager {
  constructor() {
    this.publicNpcMiners = [];
    this.CARRIER_PROXIMITY_AGGRO = 1000;
    this.CARRIER_AGGRO_MEMORY = 1800;
    this.CARRIER_HUNT_RANGE = 1200;
    this.CARRIER_HUNT_SPEED = 2.2;
    this.CARRIER_IDEAL_DIST = 320;
    this._dbgFrame = 0;
    this._frontierStates = Object.create(null);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('minispace-frontier-npc-state', e => this.applyFrontierNpcState(e && e.detail));
      window.addEventListener('minispace-frontier-npc-killed', e => this.applyFrontierNpcKilled(e && e.detail));
      window.addEventListener('minispace-frontier-npc-respawn', e => this.applyFrontierNpcRespawn(e && e.detail));
      window.addEventListener('minispace-frontier-station-state', e => this.applyFrontierStationState(e && e.detail));
    }
  }

  // playerSlot is the belt the player spawned in (0-2). Every pirate spawns in that belt only.
  init(playerShip, playerSlot = 0) {
    // Keep the shared arena population when another pilot enters. Rebuilding this
    // array here used to erase every existing pirate ship on each gate entry.
    if (!Array.isArray(this.publicNpcMiners)) this.publicNpcMiners = [];
    const M = PUBLIC_MAP;

    // Keep the current station boss for pilots already fighting in this arena.
    if (!window.centralStationBoss || Number(window.centralStationBoss.structure) <= 0) {
      const centralStation = new SpaceStation(M.cx, M.cy, 'Rogue NPC Station');
      centralStation.structure = 20000;
      centralStation.maxStructure = 20000;
      window.centralStationBoss = centralStation;
    }

    const slot = Math.max(0, Math.min(M.spawns.length - 1, playerSlot | 0));
    // Only seed a belt when it has no living pirates. Existing ships in every
    // other belt remain untouched when a new player arrives.
    if (this.publicNpcMiners.some(n => n && n.isAlive && n.beltSlot === slot)) return;
    this.playerSlot = slot;
    const sp = M.spawns[slot];
    const plan = ENTRY_SPAWNS[playerHullGroup(playerShip)];

    // Flatten the plan into one list and shuffle it, so hunters and miners are mixed around the belt
    const list = [];
    for (const e of plan) {
      for (let k = 0; k < e.n; k++) {
        const cfg = e.t === 'miners' ? pickPirate(MINER_POOL) : PIRATE_TYPES[e.t];
        list.push({ cfg: cfg, dmg: e.dmg, rarity: rollPirateRarity() });
      }
    }
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }

    list.forEach((item, i) => {
      const a = (i / list.length) * Math.PI * 2 + Math.random() * 0.6;
      const combat = !!COMBAT_HULLS[item.cfg.name];
      // Combat hulls spawn close to the player so they engage at once; miners sit out on the rock ring
      const r = combat
        ? COMBAT_SPAWN_MIN + Math.random() * COMBAT_SPAWN_VAR
        : M.beltRadius + (Math.random() - 0.5) * 200;
      this.addPirate(item.cfg, sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r, 'belt' + slot + '_' + i,
        { dmg: combat ? COMBAT_DPS_SCALE : item.dmg, aggro: combat, slot: slot, rarity: item.rarity });
    });
  }

  frontierState(systemId) {
    return this._frontierStates[systemId] || (this._frontierStates[systemId] = {
      spawned: false, guardDefs: [], guardRespawns: Object.create(null),
      stationHp: null, stationMaxHp: 0, wavesSpawned: [], wavesMaterialized: [], stationDestroyed: false, destroyNotified: false
    });
  }

  applyFrontierStationState(message) {
    if (!message || !String(message.mapId || '').startsWith('frontier_')) return;
    const state = this.frontierState(message.mapId);
    const maxHp = Math.max(1, Number(message.maxHp) || state.stationMaxHp || 1);
    const hp = Number(message.hp);
    if (!Number.isFinite(hp)) return;
    state.stationMaxHp = maxHp;
    state.stationHp = state.stationHp == null ? Math.max(0, Math.min(maxHp, hp)) : Math.min(state.stationHp, Math.max(0, Math.min(maxHp, hp)));
    state.stationDestroyed = state.stationHp <= 0;
    if (Array.isArray(message.wavesSpawned)) message.wavesSpawned.forEach(w => {
      const n = Number(w);
      if (Number.isInteger(n) && n >= 0 && n < 3 && !state.wavesSpawned.includes(n)) state.wavesSpawned.push(n);
    });
    const station = window.MINISPACE_FRONTIER_STATION;
    if (station && mapManager && mapManager.currentMapId === message.mapId) {
      station.maxStructure = state.stationMaxHp;
      station.structure = state.stationHp;
      this.checkFrontierStationWaves(message.mapId, station);
    }
    if (state.stationDestroyed && !state.destroyNotified) {
      state.destroyNotified = true;
      if (typeof window.showCorpNotification === 'function') window.showCorpNotification('FRONTIER STATION DESTROYED · SYSTEM STRONGHOLD ELIMINATED');
    }
  }

  onFrontierStationDamaged(systemId, station) {
    const state = this.frontierState(systemId);
    state.stationMaxHp = Math.max(1, Number(station.maxStructure) || state.stationMaxHp || 1);
    state.stationHp = Math.max(0, Math.min(state.stationMaxHp, Number(station.structure) || 0));
    state.stationDestroyed = state.stationHp <= 0;
    this.checkFrontierStationWaves(systemId, station);
    if (window.MinispaceOnline && typeof window.MinispaceOnline.send === 'function') {
      window.MinispaceOnline.send({type:'frontier-station-state',mapId:systemId,hp:state.stationHp,maxHp:state.stationMaxHp,wavesSpawned:state.wavesSpawned.slice()});
    }
    if (state.stationDestroyed && !state.destroyNotified) {
      state.destroyNotified = true;
      if (typeof window.showCorpNotification === 'function') window.showCorpNotification('FRONTIER STATION DESTROYED · SYSTEM STRONGHOLD ELIMINATED');
    }
  }

  checkFrontierStationWaves(systemId, station) {
    if (!station || !(station.maxStructure > 0)) return;
    const state = this.frontierState(systemId);
    const fraction = Math.max(0, Number(station.structure) || 0) / station.maxStructure;
    [0.75, 0.50, 0.25].forEach((threshold, waveIndex) => {
      const alreadyRecorded = state.wavesSpawned.includes(waveIndex);
      if (fraction <= threshold || alreadyRecorded) {
        if (!alreadyRecorded) state.wavesSpawned.push(waveIndex);
        if (!state.wavesMaterialized.includes(waveIndex)) {
          state.wavesMaterialized.push(waveIndex);
          const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === systemId);
          if (system) this.spawnFrontierStationWave(system, station, waveIndex);
        }
      }
    });
  }

  spawnFrontierStationWave(system, station, waveIndex) {
    const id = system.id;
    const base = system.ring <= 2 ? ['combatFrigate','frigate','frigate'] :
      (system.ring <= 6 ? ['siegeCruiser','combatFrigate','combatFrigate','frigate'] :
      ['siegeBattleship','siegeCruiser','combatFrigate','carrier']);
    const plan = base.concat(waveIndex >= 1 ? ['combatFrigate'] : [], waveIndex >= 2 ? ['siegeCruiser'] : []);
    let seed = 0;
    const seedText = id + '_siege_' + waveIndex;
    for (let k = 0; k < seedText.length; k++) seed = (seed * 33 + seedText.charCodeAt(k)) >>> 0;
    const seeded = index => { let value = (seed + (index + 1) * 1013904223) >>> 0; value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
    plan.forEach((type, i) => {
      const angle = (i / plan.length) * Math.PI * 2 + seeded(i * 3) * 0.35;
      const radius = 1050 + seeded(i * 3 + 1) * 500;
      const cfg = PIRATE_TYPES[type];
      if (!cfg) return;
      this.addPirate(cfg, station.x + Math.cos(angle) * radius, station.y + Math.sin(angle) * radius,
        'station_wave_' + id + '_' + waveIndex + '_' + i,
        {mapId:id,stationWave:true,role:'patrol',hpScale:system.ring>=7?0.72:0.62,dmg:system.ring>=7?0.28:0.18,rarity:rollPirateRarity(seeded(i*7+3))});
    });
    if (typeof window.showCorpNotification === 'function') window.showCorpNotification('STATION DEFENCE WAVE ' + (waveIndex + 1) + ' · ' + plan.length + ' ships undocked');
  }

  applyFrontierNpcState(message) {
    if (!message || !String(message.mapId || '').startsWith('frontier_')) return;
    const state = this.frontierState(message.mapId);
    (Array.isArray(message.deadNpcs) ? message.deadNpcs : []).forEach(dead => {
      if (!dead || !dead.npcId) return;
      const at = Number(dead.respawnAt) || 0;
      if (at > Date.now()) {
        state.guardRespawns[dead.npcId] = at;
        const npc = this.publicNpcMiners.find(n => n && n.id === dead.npcId && n.mapId === message.mapId);
        if (npc) npc.isAlive = false;
      }
    });
    this.publicNpcMiners = this.publicNpcMiners.filter(n => n && n.isAlive);
  }

  applyFrontierNpcKilled(message) {
    if (!message || !String(message.mapId || '').startsWith('frontier_') || !message.npcId) return;
    const state = this.frontierState(message.mapId);
    const at = Number(message.respawnAt) || Date.now() + 240000;
    state.guardRespawns[message.npcId] = at;
    const npc = this.publicNpcMiners.find(n => n && n.id === message.npcId && n.mapId === message.mapId);
    if (npc) npc.isAlive = false;
    this.publicNpcMiners = this.publicNpcMiners.filter(n => n && n.isAlive);
  }

  applyFrontierNpcRespawn(message) {
    if (!message || !String(message.mapId || '').startsWith('frontier_') || !message.npcId) return;
    const state = this.frontierState(message.mapId);
    delete state.guardRespawns[message.npcId];
    const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === message.mapId);
    const def = (state.guardDefs || []).find(d => d.id === message.npcId);
    if (system && def && this.spawnFrontierGuard(system, def, window.MINISPACE_FRONTIER_STATION) &&
        typeof window.showCorpNotification === 'function') {
      window.showCorpNotification('A station guard patrol has respawned · docking locked again.');
    }
  }

  spawnFrontierGuard(system, def, station) {
    if (!system || !def || this.publicNpcMiners.some(n => n && n.isAlive && n.id === def.id && n.mapId === system.id)) return false;
    const cfg = PIRATE_TYPES[def.type];
    if (!cfg) return false;
    this.addPirate(cfg, def.x, def.y, def.id, {
      mapId: system.id, stationGuard: true, role: 'patrol',
      hpScale: def.hpScale, dmg: def.dmg, elite: def.elite, rarity: def.rarity
    });
    return true;
  }

  initFrontierSystem(system, station) {
    if (!system || !system.id || !station) return;
    const id = system.id, state = this.frontierState(id);
    const maxHp = 45000 + Math.max(1, Number(system.ring) || 1) * 12000;
    if (!(state.stationMaxHp > 0)) state.stationMaxHp = maxHp;
    if (state.stationHp == null) state.stationHp = state.stationMaxHp;
    state.stationHp = Math.max(0, Math.min(state.stationMaxHp, Number(state.stationHp)));
    state.stationDestroyed = state.stationHp <= 0;
    station.isFrontierStation = true;
    station.maxStructure = state.stationMaxHp;
    station.structure = state.stationHp;
    station.takeDamage = rawDamage => {
      const damage = Math.max(0, Number(rawDamage) || 0);
      if (!damage || station.structure <= 0) return;
      station.structure = Math.max(0, station.structure - damage);
      this.onFrontierStationDamaged(id, station);
    };
    state.spawned = true;
    this.checkFrontierStationWaves(id, station);
  }

  scheduleFrontierGuardRespawn(npc) {
    if (!npc || !npc.stationGuard || !npc.mapId) return;
    const state = this.frontierState(npc.mapId);
    const respawnAt = Date.now() + 180000 + Math.floor(Math.random() * 120001);
    state.guardRespawns[npc.id] = respawnAt;
    if (window.MinispaceOnline && typeof window.MinispaceOnline.send === 'function') {
      window.MinispaceOnline.send({
        type: 'frontier-npc-killed', mapId: npc.mapId,
        npcId: npc.id, respawnAt: respawnAt
      });
    }
  }

  hasLivingStationGuards(systemId) {
    return this.publicNpcMiners.some(n => n && n.isAlive && n.stationGuard && n.mapId === systemId);
  }

  updateFrontierRespawn(systemId) {
    const station = window.MINISPACE_FRONTIER_STATION;
    if (station && mapManager && mapManager.currentMapId === systemId) this.checkFrontierStationWaves(systemId, station);
  }

  addPirate(cfg, x, y, id, opts) {
    opts = opts || {};
    const rarity = PIRATE_RARITY_POWER[opts.rarity] ? opts.rarity : 'common';
    const rarityPower = PIRATE_RARITY_POWER[rarity];
    const scale = (opts.dmg !== undefined ? opts.dmg : (DPS_DAMPEN[cfg.name] || 1)) * (opts.elite ? 1.5 : 1) * rarityPower.damage;
    // Instant aggro only for combat-capable hulls that belong to the player's own belt
    const autoAggro = !!opts.aggro && opts.slot === this.playerSlot;
    const shipObj = cfg.makeShip(x, y);
    shipObj.npcDamageScale = scale;
    shipObj.isPirate = true;   // NPC-owned
    // Track who actually damaged this NPC. NPC damage must not erase player reward eligibility.
    const originalTakeDamage = shipObj.takeDamage;
    if (typeof originalTakeDamage === 'function' && !shipObj._minispaceDamageTracked) {
      shipObj.takeDamage = function () {
        if (window.__MINISPACE_NPC_ATTACK_SOURCE) this._minispaceNpcDamageAt = Date.now();
        else this._minispacePlayerTagged = true;
        return originalTakeDamage.apply(this, arguments);
      };
      shipObj._minispaceDamageTracked = true;
    }
    if (DEBUG_NPC && (SIEGE_HULLS[cfg.name] || cfg.name === 'Carrier')) this.describeShip(cfg.name, shipObj);
    // Combat hulls get the same base HP as the player's ship of that class; others use their listed HP
    let hp = MATCH_PLAYER_HP[cfg.name]
      ? ((shipObj.maxShield || 0) + (shipObj.maxArmor || 0) + (shipObj.maxStructure || 0)) || cfg.hp
      : cfg.hp;
    // Combat hulls keep their own shield / armor / structure values so the bars show the true numbers
    if (!MATCH_PLAYER_HP[cfg.name]) {
      shipObj.structure = hp;
      shipObj.maxStructure = hp;
    }
    // Scale every layer (max and current) down to NPC_HP_SCALE
    const npcHpScale=Number(opts.hpScale)||NPC_HP_SCALE;
    for (const layer of ['shield', 'armor', 'structure']) {
      const maxKey = 'max' + layer.charAt(0).toUpperCase() + layer.slice(1);
      if (shipObj[maxKey] > 0) {
        shipObj[maxKey] *= npcHpScale;
        shipObj[layer] = (shipObj[layer] || 0) * npcHpScale;
      }
    }
    hp *= npcHpScale;
    if(opts.elite){for(const layer of ['shield','armor','structure']){const key='max'+layer.charAt(0).toUpperCase()+layer.slice(1);if(shipObj[key]>0){shipObj[key]*=2.4;shipObj[layer]*=2.4;}}hp*=2.4;}
    if(rarityPower.hp>1){for(const layer of ['shield','armor','structure']){const key='max'+layer.charAt(0).toUpperCase()+layer.slice(1);if(shipObj[key]>0){shipObj[key]*=rarityPower.hp;shipObj[layer]*=rarityPower.hp;}}hp*=rarityPower.hp;}
    this.publicNpcMiners.push({
      id: id,
      mapId: opts.mapId || null,
      stationGuard: !!opts.stationGuard,
      stationWave: !!opts.stationWave,
      role: opts.role || null,
      cfg: cfg,
      elite: !!opts.elite,
      rarity: rarity,
      rarityPower: rarityPower,
      rewarded: false,
      ship: shipObj,
      className: cfg.name,
      combat: !!COMBAT_HULLS[cfg.name],
      bounty: cfg.marketVal * 0.1,
      maxHp: hp,
      dpsScale: scale,                       // multiplies the damage this pirate deals
      autoAggro: autoAggro,                  // hunts the player from the moment they enter
      beltSlot: opts.slot,                   // which belt it spawned in
      orbitDir: Math.random() < 0.5 ? 1 : -1, // which way it circles the player
      orbitJitter: (Math.random() - 0.5) * 0.06, // small spread so several ships do not share one ring
      isAgro: autoAggro,
      isAlive: true,
      respawnTimer: 0,
      fleeTimer: 0,
      isAggro: false,
      aggroTimer: 0,
      lastHp: hp,
      home: { x: x, y: y },                               // centre of its patrol area
      pos: { x: x, y: y },                                // authoritative position, owned by this manager
      patrolPt: null,
      rock: null
    });
  }

  totalHp(ship) {
    return (ship.shield || 0) + (ship.armor || 0) + (ship.structure || 0);
  }

  // ================= MOVEMENT (rebuilt) =================
  // The manager is the only thing that decides where a pirate goes. Each frame it:
  //   1. remembers the ship's position,
  //   2. lets the ship's own update() run (weapons, missiles, drones, animation),
  //   3. puts the ship back where it was (undoing whatever movement update() did),
  //   4. moves it with the code below.

  // Current speed of the player's ship (0 if it has no velocity fields)
  playerSpeed(player) {
    const s = Math.hypot((player && player.vx) || 0, (player && player.vy) || 0);
    return isFinite(s) ? s : 0;
  }

  // Top speed for a pirate, read from Balance.js. With MATCH_PLAYER_SPEED on, the player's maxSpeed is used instead.
  npcSpeed(npc, player) {
    let s;
    if (MATCH_PLAYER_SPEED && player && player.maxSpeed > 0) {
      s = player.maxSpeed;
    } else {
      const row = window.Balance && window.Balance.TABLE && window.Balance.TABLE[npc.className];
      s = (row && row.maxSpeed) || (npc.ship && npc.ship.maxSpeed);
    }
    return isFinite(s) && s > 0 ? s : NPC_SPEED_FALLBACK;
  }

  // Radius of the ring this pirate holds around the player. weaponRange is read with Number() and must be
  // above 0, so a missing or non-numeric value falls back to a default instead of producing NaN.
  ringRadius(npc) {
    const jitter = 1 + (npc.orbitJitter || 0);
    const wr = Number(npc.ship.weaponRange);
    if (SIEGE_HULLS[npc.className]) {
      const range = Math.max(wr > 0 ? wr : 0, SIEGE_WEAPON_RANGE[npc.className] || 0) || RING_FALLBACK_RANGE[npc.className] || RING_DEFAULT_RANGE;
      return Math.max(range * SIEGE_RANGE_FRAC, SIEGE_MIN_RING[npc.className] || 0) * jitter;
    }
    const range = wr > 0 ? wr : (RING_FALLBACK_RANGE[npc.className] || RING_DEFAULT_RANGE);
    return Math.max(range * ORBIT_RANGE_FRAC, ORBIT_MIN_RANGE_BY_HULL[npc.className] || RING_MIN_DEFAULT) * jitter;
  }

  // Debug: what kind of property is ship.x, and what the ship reports for range and speed
  describeShip(name, ship) {
    const kind = function (obj) {
      let o = obj, depth = 0;
      while (o && depth < 6) {
        const d = Object.getOwnPropertyDescriptor(o, 'x');
        if (d) return (depth === 0 ? 'own ' : 'inherited ') + (d.get || d.set ? 'accessor' + (d.set ? '' : ' (NO SETTER)') : (d.writable ? 'data' : 'data (READ-ONLY)'));
        o = Object.getPrototypeOf(o); depth++;
      }
      return 'missing';
    };
    console.log('[NPC] spawned', name, '| x is', kind(ship), '| weaponRange', ship.weaponRange,
      '| maxSpeed', ship.maxSpeed, '| has update()', typeof ship.update === 'function',
      '| class', ship.constructor && ship.constructor.name,
      '| orientation fields', Object.keys(ship).filter(function (k) { return /angle|heading|rot|facing|dir/i.test(k); }));
  }

  // Writes a pirate's position. Refuses NaN / Infinity, which would lose the ship for good.
  setPos(ship, x, y) {
    if (!isFinite(x) || !isFinite(y)) return;
    ship.x = x;
    ship.y = y;
    // If the write did not stick, the ship's x / y are not plain properties. Say so once.
    if (DEBUG_NPC && !ship._warnedWrite && (ship.x !== x || ship.y !== y)) {
      ship._warnedWrite = true;
      console.warn('[NPC] position write ignored for ' + ship.className + ': wanted', x, y, 'got', ship.x, ship.y);
    }
  }

  // Moves a ship up to `speed` units straight toward a point, and faces the way it is going.
  flyTo(ship, pt, speed) {
    const dx = pt.x - ship.x, dy = pt.y - ship.y, d = Math.hypot(dx, dy);
    if (!isFinite(d) || d < 0.5) { ship.vx = 0; ship.vy = 0; ship._vel = { x: 0, y: 0 }; return; }
    const step = Math.min(speed, d);
    // Accelerate toward the wanted velocity instead of jumping to it (no sudden speed or direction changes)
    const vel = ship._vel || (ship._vel = { x: ship.vx || 0, y: ship.vy || 0 });   // the manager's own copy, so ship.update() cannot overwrite it
    const accel = Math.max(speed * 0.15, 0.03);
    let sx = (dx / d) * step - vel.x, sy = (dy / d) * step - vel.y;
    const sm = Math.hypot(sx, sy);
    if (sm > accel) { sx = sx / sm * accel; sy = sy / sm * accel; }
    vel.x += sx; vel.y += sy;
    if (!isFinite(vel.x) || !isFinite(vel.y)) { vel.x = 0; vel.y = 0; }
    ship.vx = vel.x; ship.vy = vel.y;
    this.setPos(ship, ship.x + vel.x, ship.y + vel.y);
    // Face the direction of travel, turning gradually
    if (Math.hypot(vel.x, vel.y) > 0.05) this.turnToward(ship, Math.atan2(vel.y, vel.x));
  }

  // Turns a ship's heading toward `want` by at most NPC_TURN_RATE per frame (no instant snapping).
  turnToward(ship, want) {
    let diff = want - (ship.angle || 0);
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ship.angle = (ship.angle || 0) + Math.max(-NPC_TURN_RATE, Math.min(NPC_TURN_RATE, diff));
  }

  // Attack movement, steered like a player: fly in toward the ring, then circle it.
  // No teleporting: speed and heading both change gradually, and the ship faces its direction of travel.
  engagePlayer(npc, player) {
    const ship = npc.ship;
    const ring = this.ringRadius(npc);
    const base = this.npcSpeed(npc, player);
    // While the player is moving, keep pace with them instead of falling behind
    const maxSpd = Math.max(base, this.playerSpeed(player) * HUNT_CATCHUP);
    const accel = base * NPC_ACCEL_FRAC;

    const vel = ship._vel || (ship._vel = { x: ship.vx || 0, y: ship.vy || 0 });

    let dx = ship.x - player.x, dy = ship.y - player.y, d = Math.hypot(dx, dy);
    if (!isFinite(d) || d < 1) { dx = 1; dy = 0; d = 1; }   // exactly on top of the player: pick a direction
    const rx = dx / d, ry = dy / d;                         // outward from the player
    const dir = npc.orbitDir || 1;
    const tx = -ry * dir, ty = rx * dir;                    // sideways, the way it circles

    // Inward / outward speed grows with distance from the ring (negative = toward the player)
    const err = d - ring;
    const vr = Math.max(-maxSpd, Math.min(maxSpd, -err * RING_CORRECTION_GAIN));
    // Sideways speed fades in as it nears the ring, so it comes straight in then curves into orbit
    const near = Math.max(0, Math.min(1, (ring * ORBIT_START_FRAC - d) / (ring * (ORBIT_START_FRAC - 1))));
    const vt = base * near;

    // Desired velocity, plus the player's own velocity so the ring follows them
    let wx = rx * vr + tx * vt + (player.vx || 0) * near;
    let wy = ry * vr + ty * vt + (player.vy || 0) * near;
    const wm = Math.hypot(wx, wy);
    if (wm > maxSpd) { wx = wx / wm * maxSpd; wy = wy / wm * maxSpd; }

    // Accelerate toward it, limited per frame
    let sx = wx - vel.x, sy = wy - vel.y;
    const sm = Math.hypot(sx, sy);
    if (sm > accel) { sx = sx / sm * accel; sy = sy / sm * accel; }
    vel.x += sx; vel.y += sy;
    if (!isFinite(vel.x) || !isFinite(vel.y)) { vel.x = 0; vel.y = 0; }

    this.setPos(ship, ship.x + vel.x, ship.y + vel.y);
    ship.vx = vel.x; ship.vy = vel.y;

    // Face the direction of travel, turning gradually
    if (Math.hypot(vel.x, vel.y) > 0.05) {
      const want = Math.atan2(vel.y, vel.x);
      let diff = want - (ship.angle || 0);
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ship.angle = (ship.angle || 0) + Math.max(-NPC_TURN_RATE, Math.min(NPC_TURN_RATE, diff));
    }
  }

  // Peaceful movement while the player is away: patrol the area, or mine the nearest rock with the laser showing.
  peacefulBehaviour(npc, belt) {
    const ship = npc.ship;
    const speed = this.npcSpeed(npc);

    if (npc.role === 'patrol') {
      if (!npc.patrolPt || Math.hypot(npc.patrolPt.x - ship.x, npc.patrolPt.y - ship.y) < 80) {
        const a = Math.random() * Math.PI * 2;
        const r = 900 + Math.random() * 900;
        npc.patrolPt = { x: npc.home.x + Math.cos(a) * r, y: npc.home.y + Math.sin(a) * r };
      }
      this.flyTo(ship, npc.patrolPt, speed * PATROL_SPEED_FRAC);
      ship.currentTarget = null;
      return;
    }

    // Mining: AsteroidBelt stores rocks in .entities (getEntities is optional on older builds).
    // Keep the current rock until it is exhausted, otherwise select the nearest available rock.
    const rocks = belt
      ? (typeof belt.getEntities === 'function' ? belt.getEntities() : (Array.isArray(belt.entities) ? belt.entities : []))
      : [];
    if (!npc.rock || !(npc.rock.oreYield > 0)) {
      npc.rock = null;
      npc.miningProgress = 0;
      let best = null, bd = Infinity;
      for (const r of rocks) {
        if (!r || !(Number(r.oreYield) > 0)) continue;
        const d = Math.hypot(r.x - ship.x, r.y - ship.y);
        if (d < bd) { bd = d; best = r; }
      }
      npc.rock = best;
    }

    if (!npc.rock) {
      // No rocks remain: make a visible patrol circuit instead of freezing at the home point.
      if (!npc.patrolPt || Math.hypot(npc.patrolPt.x - ship.x, npc.patrolPt.y - ship.y) < 100) {
        const a = Math.random() * Math.PI * 2;
        const radius = 900 + Math.random() * 900;
        npc.patrolPt = { x: npc.home.x + Math.cos(a) * radius, y: npc.home.y + Math.sin(a) * radius };
      }
      this.flyTo(ship, npc.patrolPt, speed * PATROL_SPEED_FRAC);
      ship.currentTarget = null;
      return;
    }

    const rock = npc.rock;
    const parkDist = 220;
    const dx = rock.x - ship.x, dy = rock.y - ship.y, d = Math.hypot(dx, dy);
    if (d > parkDist + 20) {
      const a = Math.atan2(ship.y - rock.y, ship.x - rock.x);
      this.flyTo(ship, { x: rock.x + Math.cos(a) * parkDist, y: rock.y + Math.sin(a) * parkDist }, speed * MINE_SPEED_FRAC);
      ship.currentTarget = null;
    } else {
      // Mine while holding position. Ore is depleted gradually so the NPC visibly works the belt.
      ship.vx = 0;
      ship.vy = 0;
      ship._vel = { x: 0, y: 0 };
      ship.angle = Math.atan2(dy, dx);
      ship.currentTarget = rock;
      npc.miningProgress = (npc.miningProgress || 0) + 2.5;
      rock.oreYield = Math.max(0, Number(rock.oreYield) - 2.5);
      npc.minedCargo = (npc.minedCargo || 0) + 2.5;
      if (rock.oreYield <= 0) {
        npc.rock = null;
        npc.patrolPt = null;
        ship.currentTarget = null;
      }
    }
  }

  // Runs the ship's own update() for weapons, missiles, drones and animation. It is called every frame for combat
  // hulls, even when the player is out of range, so their missiles keep flying instead of freezing in space.
  // `enemies` is empty unless the ship is engaged, so it only fires when it should.
  runShipUpdate(npc, player, playerPresent, engaged) {
    const ship = npc.ship;
    if (typeof ship.update !== 'function') return;
    // Only hand the ship the player as a target while it is actually fighting. Passing it when the player is away
    // leaves a Carrier's drones locked onto a target that is out of reach, parked at the end of their tether.
    const target = playerPresent && engaged ? player : null;
    const enemies = engaged && playerPresent ? [player] : [];
    // The ship's own update() may turn the hull toward its target. The manager decides heading
    // (direction of travel), so remember it and put it back afterwards, or the two fight each frame.
    const keepAngle = ship.angle;
    const previousDamageSource = window.__MINISPACE_NPC_ATTACK_SOURCE;
    window.__MINISPACE_NPC_ATTACK_SOURCE = npc.id;
    try {
      if (npc.className === 'Carrier') {
        ship.update(null, target, null, false, enemies, true);
      } else if (npc.className === 'Siege Battleship' || npc.className === 'Siege Cruiser' || npc.className === 'Combat Frigate') {
        // Give combat hulls an explicit targetEnemy; the manager remains responsible for movement.
        ship.update(null, target, false, enemies, true);
      } else {
        ship.update(null, target, false, enemies);
      }
    } catch (err) {
      if (!npc._warnedUpdate) {
        npc._warnedUpdate = true;
        console.warn('[NPC] ' + npc.className + ' update() threw:', err);
      }
    }
    window.__MINISPACE_NPC_ATTACK_SOURCE = previousDamageSource;
    if (typeof keepAngle === 'number' && isFinite(keepAngle)) ship.angle = keepAngle;
  }

  // One readable line per problem (message + stack), once per ship, so a single failing ship can never stop
  // the game loop and the cause is visible even in a small mobile console.
  reportError(npc, where, err) {
    const key = '_err_' + where;
    if (npc[key]) return;
    npc[key] = true;
    console.error('[NPC] ' + npc.className + ' ' + where + ' error: ' + (err && err.message) + '\n' + (err && err.stack));
  }

  update(currentMapId, playerShip, asteroidBelt, playerData, updateStationUI, saveGameSession, debrisField) {
    const isFrontier = String(currentMapId || '').indexOf('frontier_') === 0;
    if (currentMapId !== 'public_space' && !isFrontier) return;
    if (isFrontier) {
      const system = (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === currentMapId);
      this.initFrontierSystem(system, window.MINISPACE_FRONTIER_STATION);
    }

    // Check if player is shooting the station boss
    if (currentMapId === 'public_space' && window.centralStationBoss && window.centralStationBoss.structure > 0 && playerShip && !playerShip.docked) {
      let dist = Math.hypot(playerShip.x - window.centralStationBoss.x, playerShip.y - window.centralStationBoss.y);
      if (dist < 500) {
        let dmg = playerShip.className === 'Combat Frigate' ? 3.0 : 1.2;
        window.centralStationBoss.structure -= dmg;
      }
    }

    this._dbgFrame++;

    // Update all active NPC pirate ships
    this.publicNpcMiners.forEach(npc => {
      try {
      if (npc.mapId ? npc.mapId !== currentMapId : currentMapId !== 'public_space') return;
      if (!npc.isAlive) return;
      if (!npc.ship) return;
      const ship = npc.ship;

      // Check if NPC was killed
      if (this.totalHp(ship) <= 0 && !npc.rewarded) {
        npc.rewarded = true;
        npc.isAlive = false;
        if (npc.stationGuard) this.scheduleFrontierGuardRespawn(npc);
        // Arena pirates can be damaged by other NPCs as well as the player.
        // Still grant the local pilot combat XP for a 3v3 arena kill, even if an
        // NPC delivered the final blow; keep bounty and module drops player-tagged.
        if (npc.ship._minispaceNpcDamageAt && !npc.ship._minispacePlayerTagged) {
          if (currentMapId === 'public_space' && typeof window.awardPlayerXP === 'function') {
            window.awardPlayerXP('combat', 75, '3v3 pirate destroyed');
            if (typeof window.showCorpNotification === 'function') {
              window.showCorpNotification('ARENA PIRATE DESTROYED · +75 XP');
            }
          }
          return;
        }
        if (playerData && playerData.isk !== undefined) {
          playerData.isk += Math.floor(npc.bounty);
        }
        const pirateXP = 75;
        if (typeof window.awardPlayerXP === 'function') {
          window.awardPlayerXP('combat', pirateXP, 'Pirate destroyed');
        }
        if(playerData){
          if(!Array.isArray(playerData.moduleDrops))playerData.moduleDrops=[];
          const system = npc.mapId && (window.MINISPACE_UNIVERSE_SYSTEMS || []).find(s => s.id === npc.mapId);
          // Rarer spawns improve both the chance of a module and its minimum quality.
          const spawnPower = npc.rarityPower || PIRATE_RARITY_POWER.common;
          const baseDropChance = npc.elite ? 0.75 : (system ? Math.min(0.52, 0.16 + system.ring * 0.036) : 1);
          const dropChance = Math.min(0.98, baseDropChance + spawnPower.loot);
          const lootRank = { white: 0, green: 1, blue: 2, purple: 3 };
          const spawnLootRank = spawnPower.rank || 0;
          if (Math.random() < dropChance) {
            const rr=Math.random();
            const rolledRarity=rr<.48?'white':rr<.78?'green':rr<.94?'blue':'purple';
            const rarity=Object.keys(lootRank).find(key=>lootRank[key]===Math.max(lootRank[rolledRarity],spawnLootRank))||'white';
            const hull=npc.className==='Capital'?'Siege Capital':npc.className;
            const mods=({
              'Carrier':['droneTether','shieldExtender','resistance','propulsion'],
              'Siege Battleship':['missiles','shield','propulsion'],
              'Siege Cruiser':['guns','shield','resistance','shieldRecharge'],
              'Siege Capital':['guns','shieldPlating','propulsion','resistance'],
              'Combat Frigate':['missiles','shield','scrambler','propulsion'],
              'Mining Frigate':['laser','shield','cargo','propulsion'],
              'Mining Barge':['laser','shield','cargo','propulsion'],
              'Command Ship':['dronesTether','shield','cargo','propulsion'],
              'Mining Capital':['laser','shield','cargo','propulsion'],
              'Exploration Frigate':['cloaking','hacking','propulsion','cargo'],
              'Improved Explorer Frigate':['cloaking','hacking','propulsion','cargo'],
              'Explorer Cruiser':['cloaking','hacking','propulsion','cargo']
            })[hull]||['propulsion'];
            const module=mods[Math.floor(Math.random()*mods.length)];
            playerData.moduleDrops.push({id:'mod-'+npc.id+'-'+Date.now(),rarity:rarity,hull:hull,module:module,name:rarity.toUpperCase()+' '+module+' Module',level:1});
            if(typeof window.showCorpNotification==='function')window.showCorpNotification('LOOT DROP: '+rarity.toUpperCase()+' '+module+' Module');
            // Blue and purple spawns can drop an extra module, with purple being more generous.
            const bonusChance = npc.rarity === 'epic' ? 0.65 : (npc.rarity === 'rare' ? 0.30 : 0);
            if (bonusChance && Math.random() < bonusChance) {
              const bonusModule=mods[Math.floor(Math.random()*mods.length)];
              playerData.moduleDrops.push({id:'mod-'+npc.id+'-bonus-'+Date.now(),rarity:rarity,hull:hull,module:bonusModule,name:rarity.toUpperCase()+' '+bonusModule+' Module',level:1});
              if(typeof window.showCorpNotification==='function')window.showCorpNotification('BONUS LOOT: '+rarity.toUpperCase()+' '+bonusModule+' Module');
            }
          }
        }
        if (typeof window.showCorpNotification === 'function') {
          window.showCorpNotification('PIRATE DESTROYED · +' + Math.floor(npc.bounty).toLocaleString() + ' Scrap Metals · +' + pirateXP + ' XP');
        }
        if (typeof updateStationUI === 'function') updateStationUI();
        if (typeof saveGameSession === 'function') saveGameSession();
        return;
      }

      // The manager owns every pirate's position. Anything another system did to ship.x / ship.y since the
      // last frame (collision push, its own steering, a controller) is undone here, so nothing can drag a
      // pirate onto the player.
      if (npc.pos) {
        if (DEBUG_NPC && !npc._warnedMoved && Math.hypot(ship.x - npc.pos.x, ship.y - npc.pos.y) > 3) {
          npc._warnedMoved = true;
          console.warn('[NPC] ' + npc.className + ' was moved by something else: manager had',
            Math.round(npc.pos.x), Math.round(npc.pos.y), 'found', Math.round(ship.x), Math.round(ship.y));
        }
        this.setPos(ship, npc.pos.x, npc.pos.y);
      }

      const playerPresent = !!(playerShip && !playerShip.docked);
      const distToPlayer = playerPresent
        ? Math.hypot(playerShip.x - ship.x, playerShip.y - ship.y)
        : Infinity;

      // Engaged = attacking the player: close enough, or an auto-aggro combat hull hunting them across the belt
      const hunting = npc.autoAggro && playerPresent;
      const engaged = playerPresent && (distToPlayer < PEACE_RANGE || hunting);
      if(npc.combat||engaged){
        const keepX=ship.x,keepY=ship.y;
        this.runShipUpdate(npc,playerShip,playerPresent,engaged);
        this.setPos(ship,keepX,keepY);
      }
      if(engaged){
        npc.isAgro=true;
        this.engagePlayer(npc,playerShip);
        const wr=Number(ship.weaponRange)>0?Number(ship.weaponRange):RING_DEFAULT_RANGE;
        if(distToPlayer<=Math.max(wr,this.ringRadius(npc)*1.1)){
          if(typeof playerShip.takeDamage==='function')playerShip.takeDamage(0.85*(npc.dpsScale||1));
          else playerShip.structure-=0.85*(npc.dpsScale||1);
        }
      }else{
        npc.isAgro=false;
        this.peacefulBehaviour(npc,asteroidBelt);
      }

      // Debug: engaged but not getting anywhere? Report once with everything needed to see why.
      if (DEBUG_NPC && engaged && npc.pos) {
        const moved = Math.hypot(ship.x - npc.pos.x, ship.y - npc.pos.y);
        const ringErr = Math.abs(Math.hypot(ship.x - playerShip.x, ship.y - playerShip.y) - this.ringRadius(npc));
        npc._still = (moved < 0.01 && ringErr > 30) ? (npc._still || 0) + 1 : 0;
        if (npc._still === 120 && !npc._warnedStill) {
          npc._warnedStill = true;
          console.warn('[NPC] ' + npc.className + ' has not moved for 120 frames while engaged:',
            { dist: Math.round(Math.hypot(ship.x - playerShip.x, ship.y - playerShip.y)), ring: Math.round(this.ringRadius(npc)),
              speed: this.npcSpeed(npc, playerShip), vx: ship.vx, vy: ship.vy, x: ship.x, y: ship.y, aliveFlag: npc.isAlive });
        }
      }

      // Remember where the manager put it
      npc.pos = { x: ship.x, y: ship.y };
      } catch (err) {
        this.reportError(npc, 'update', err);
      }
    });

    // Filter out dead NPCs
    this.publicNpcMiners = this.publicNpcMiners.filter(n => n.isAlive);
    if (isFrontier) this.updateFrontierRespawn(currentMapId);
  }

  // Shield, armor and hull bars, each showing the ship's real current / max values
  drawBars(ctx, npc) {
    const s = npc.ship;
    const bw = 70, bh = 6;
    const bx = s.x - 35;
    const rows = [
      { label: 'SH', val: s.shield, max: s.maxShield, color: '#38bdf8', y: s.y - 40 },
      { label: 'AR', val: s.armor, max: s.maxArmor, color: '#d29922', y: s.y - 32 },
      { label: 'HL', val: s.structure, max: s.maxStructure, color: '#3fb950', y: s.y - 24 }
    ];
    ctx.save();
    ctx.textAlign = 'center';
    for (const r of rows) {
      if (!(r.max > 0)) continue;   // this hull has no such layer
      const v = Math.max(0, r.val || 0);
      const frac = Math.max(0, Math.min(1, v / r.max));
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(bx - 1, r.y - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#21262d';
      ctx.fillRect(bx, r.y, bw, bh);
      ctx.fillStyle = r.color;
      ctx.fillRect(bx, r.y, bw * frac, bh);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 6px "Courier New"';
      ctx.fillText(r.label + ' ' + Math.ceil(v).toLocaleString() + ' / ' + Math.ceil(r.max).toLocaleString(), s.x, r.y + bh - 1);
    }
    ctx.restore();
  }

  draw(ctx, currentMapId) {
    const isFrontier = String(currentMapId || '').indexOf('frontier_') === 0;
    if (currentMapId !== 'public_space' && !isFrontier) return;

    // Draw Central Station Boss and its health bar
    if (currentMapId === 'public_space' && window.centralStationBoss && typeof window.centralStationBoss.draw === 'function') {
      ctx.save();
      try {
        window.centralStationBoss.draw(ctx);
      } finally {
        ctx.restore();
      }
      let frac = Math.max(0, Math.min(1, window.centralStationBoss.structure / window.centralStationBoss.maxStructure));
      ctx.save();
      ctx.fillStyle = '#f85149';
      ctx.font = '10px "Courier New"';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ ROGUE STATION BOSS ⚡ [HP: ' + Math.floor(window.centralStationBoss.structure) + '/' + window.centralStationBoss.maxStructure + ']', window.centralStationBoss.x, window.centralStationBoss.y - 85);

      ctx.fillStyle = '#21262d';
      ctx.fillRect(window.centralStationBoss.x - 40, window.centralStationBoss.y - 75, 80, 6);
      ctx.fillStyle = '#f85149';
      ctx.fillRect(window.centralStationBoss.x - 40, window.centralStationBoss.y - 75, 80 * frac, 6);
      ctx.restore();
    }

    if (isFrontier && window.MINISPACE_FRONTIER_STATION && window.MINISPACE_FRONTIER_STATION.structure > 0) {
      const station = window.MINISPACE_FRONTIER_STATION;
      const frac = Math.max(0, Math.min(1, station.structure / station.maxStructure));
      ctx.save();
      ctx.textAlign = 'center'; ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = '#ff6b6b'; ctx.shadowColor = '#ff3030'; ctx.shadowBlur = 10;
      ctx.fillText('HOSTILE STRONGHOLD · ' + Math.ceil(station.structure).toLocaleString() + ' / ' + Math.ceil(station.maxStructure).toLocaleString(), station.x, station.y - 520);
      ctx.shadowBlur = 0; ctx.fillStyle = '#24151a'; ctx.fillRect(station.x - 260, station.y - 495, 520, 18);
      ctx.fillStyle = '#ef4444'; ctx.fillRect(station.x - 260, station.y - 495, 520 * frac, 18);
      ctx.strokeStyle = '#fecaca'; ctx.lineWidth = 2; ctx.strokeRect(station.x - 260, station.y - 495, 520, 18);
      ctx.restore();
    }

    // Draw all live NPC pirate ships, health bars, and labels
    this.publicNpcMiners.forEach(npc => {
      try {
      if (npc.mapId ? npc.mapId !== currentMapId : currentMapId !== 'public_space') return;
      if (npc.isAlive && npc.ship && typeof npc.ship.draw === 'function') {
        // Draw at the manager's position, in case something moved the ship after update()
        if (npc.pos) this.setPos(npc.ship, npc.pos.x, npc.pos.y);
        // Isolate each hull's drawing state so particle, drone, or ship-art
        // effects cannot leak transforms/compositing/alpha into the rest of the world.
        ctx.save();
        try {
          npc.ship.draw(ctx);
        } finally {
          ctx.restore();
        }

        // Gate-style nameplate, scaled down for ships. Rarity colours the frame and title.
        ctx.save();
        const rarity = npc.rarity || 'common';
        const accent = rarity === 'epic' ? '#bc8cff'
          : rarity === 'rare' ? '#58a6ff'
          : rarity === 'uncommon' ? '#3fb950'
          : '#e6edf3';
        const zoom = Math.max(0.45, Number(window.cameraZoom) || 1);
        const label = (rarity === 'epic' ? 'PURPLE' : rarity === 'rare' ? 'BLUE' : rarity === 'uncommon' ? 'GREEN' : 'PIRATE') + (npc.elite ? ' ELITE' : '');
        const fontSize = 13 / zoom;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
        const width = ctx.measureText(label).width + 22 / zoom;
        const height = 28 / zoom;
        const labelY = npc.ship.y - ((npc.ship.radius || 20) + 24) / zoom;
        ctx.fillStyle = 'rgba(3, 15, 22, 0.92)';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.roundRect(npc.ship.x - width / 2, labelY - height / 2, width, height, 7 / zoom);
        ctx.fill();
        ctx.stroke();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 7 / zoom;
        ctx.fillStyle = accent;
        ctx.fillText(label, npc.ship.x, labelY);
        ctx.restore();

        this.drawBars(ctx, npc);
      }
      } catch (err) {
        this.reportError(npc, 'draw', err);
      }
    });
  }
}
