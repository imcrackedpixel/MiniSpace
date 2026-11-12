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
const PATROL_SPEED_FRAC = 0.62;     // patrol cruising speed as a fraction of maxSpeed
const MINE_SPEED_FRAC = 0.5;       // speed flying in to a rock, as a fraction of maxSpeed

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

class PublicNpcManager {
  constructor() {
    this.publicNpcMiners = [];
    this.CARRIER_PROXIMITY_AGGRO = 1000;
    this.CARRIER_AGGRO_MEMORY = 1800;
    this.CARRIER_HUNT_RANGE = 1200;
    this.CARRIER_HUNT_SPEED = 2.2;
    this.CARRIER_IDEAL_DIST = 320;
    this._dbgFrame = 0;
    this.frontierMapId = null;
    window.addEventListener('minispace-frontier-npc-state', e => this.applyFrontierState(e.detail));
    window.addEventListener('minispace-frontier-npc-death', e => this.applyFrontierDeath(e.detail));
    window.addEventListener('minispace-frontier-npc-respawn', e => this.applyFrontierRespawn(e.detail));
  }
  initFrontier(system) {
    this.publicNpcMiners=[];this.frontierMapId=system.id;this.playerSlot=0;window.centralStationBoss=null;
    let seed=0;for(let i=0;i<system.id.length;i++)seed=(seed*31+system.id.charCodeAt(i))>>>0;
    const oldRandom=Math.random;let state=seed||1;Math.random=function(){state=(state*1664525+1013904223)>>>0;return state/4294967296;};
    try {
      const level=system.level||1,c=4500,count=3+Math.floor(Math.random()*3);
      const gx=c+(Math.random()-.5)*900,gy=c+(Math.random()-.5)*900;
      for(let i=0;i<count;i++){
        let cfg,combat=false;
        if(system.kind==='Mining Fleet')cfg=pickPirate(MINER_POOL);
        else if(level===5){cfg=Math.random()<.10?PIRATE_TYPES.carrier:(Math.random()<.55?PIRATE_TYPES.siegeBattleship:PIRATE_TYPES.siegeCruiser);combat=true;}
        else if(level===4){cfg=Math.random()<.35?PIRATE_TYPES.siegeCruiser:PIRATE_TYPES.siegeBattleship;combat=true;}
        else if(level===3){cfg=Math.random()<.6?PIRATE_TYPES.combatFrigate:PIRATE_TYPES.siegeCruiser;combat=true;}
        else if(system.kind==='Mixed Fleets'&&Math.random()<.45)cfg=pickPirate(MINER_POOL);
        else {cfg=PIRATE_TYPES.combatFrigate;combat=true;}
        const a=Math.random()*Math.PI*2,d=100+i*95,rr=Math.random();
        const rarity=rr<.58?'common':rr<.84?'uncommon':rr<.97?'rare':'elite';
        const elite=rarity==='elite'&&level===5&&combat;
        const hpScale=level===1?.34:level===2?.40:level===3?.48:level===4?.60:.72;
        const dmgScale=level===1?.055:level===2?.075:level===3?.105:level===4?.16:.22;
        const isMiner = system.kind === 'Mining Fleet' || (system.kind === 'Mixed Fleets' && !combat);
        this.addPirate(cfg,gx+Math.cos(a)*d,gy+Math.sin(a)*d,'frontier_'+system.id+'_squad_n'+i,{dmg:combat?dmgScale:.04,aggro:false,slot:-1,role:isMiner?'mine':'patrol',faction:isMiner?'miners':'pirates',elite:elite,frontierLevel:level,frontierKind:system.kind,frontierRarity:rarity,hpScale:hpScale});
      }
    } finally {Math.random=oldRandom;}
  }
  applyFrontierState(d){if(!d||d.mapId!==this.frontierMapId)return;(d.deadNpcs||[]).forEach(x=>this.applyFrontierDeath(x));}
  applyFrontierDeath(d){if(!d||!d.npcId)return;const n=this.publicNpcMiners.find(x=>x.id===d.npcId);if(n){n.isAlive=false;n.respawnAt=Number(d.respawnAt)||Date.now()+90000;}}
  applyFrontierRespawn(d){if(!d||!d.npcId)return;const n=this.publicNpcMiners.find(x=>x.id===d.npcId);if(n&&!n.isAlive)this.reviveFrontierNpc(n);}
  reviveFrontierNpc(n){
    if(!n||!n.cfg)return;
    let seed=0;for(let i=0;i<n.id.length;i++)seed=(seed*31+n.id.charCodeAt(i))>>>0;
    seed=(seed+Math.floor((n.respawnAt||Date.now())/1000))>>>0;
    const oldRandom=Math.random;let st=seed||1;
    Math.random=function(){st=(st*1664525+1013904223)>>>0;return st/4294967296;};
    try{
      let cfg=n.cfg;
      const deadEnd=String(this.frontierMapId||'').includes('blackstar')||String(this.frontierMapId||'').includes('crypt');
      const roll=Math.random(),level=n.frontierLevel||1;
      let rarity=deadEnd?(roll<.48?'common':roll<.76?'uncommon':roll<.94?'rare':'elite'):(roll<.58?'common':roll<.84?'uncommon':roll<.97?'rare':'elite');
      if(level<5&&rarity==='elite')rarity='rare';
      if(n.frontierKind!=='Mining Fleet'){
        if(level>=5)cfg=rarity==='elite'?(Math.random()<.5?PIRATE_TYPES.carrier:(Math.random()<.5?PIRATE_TYPES.siegeBattleship:PIRATE_TYPES.siegeCruiser)):(Math.random()<.55?PIRATE_TYPES.siegeBattleship:PIRATE_TYPES.siegeCruiser);
        else if(level>=4)cfg=PIRATE_TYPES.siegeBattleship;
        else if(level===3)cfg=rarity==='rare'?PIRATE_TYPES.siegeBattleship:PIRATE_TYPES.siegeCruiser;
        else if(level<=2&&rarity==='rare')cfg=PIRATE_TYPES.combatFrigate;
        else if(Math.random()<.30)cfg=pickPirate(MINER_POOL);
      }else if(rarity==='rare'||rarity==='elite')cfg=pickPirate([{t:'barge',w:2},{t:'command',w:1}]);
      const elite=rarity==='elite'&&level===5&&n.frontierKind!=='Mining Fleet';
      const hull=cfg.name==='Capital'?'Siege Capital':cfg.name;
      const old=this.publicNpcMiners;this.publicNpcMiners=[];
      const levelScale=level===1?.34:level===2?.40:level===3?.48:level===4?.60:.72;const damageScale=level===1?.055:level===2?.075:level===3?.105:level===4?.16:.22;this.addPirate(cfg,n.home.x,n.home.y,n.id,{dmg:COMBAT_HULLS[cfg.name]?damageScale:.04,aggro:!!COMBAT_HULLS[cfg.name],slot:n.beltSlot,elite:elite,frontierLevel:n.frontierLevel,frontierKind:n.frontierKind,frontierRarity:rarity,hpScale:levelScale});
      const fresh=this.publicNpcMiners.pop();this.publicNpcMiners=old;
      if(fresh)Object.assign(n,fresh);
    }finally{Math.random=oldRandom;}
  }


  // playerSlot is the belt the player spawned in (0-2). Every pirate spawns in that belt only.
  init(playerShip, playerSlot = 0) {
    this.publicNpcMiners = [];
    const M = PUBLIC_MAP;

    // Rogue station boss at the centre of the map (unchanged)
    const centralStation = new SpaceStation(M.cx, M.cy, 'Rogue NPC Station');
    centralStation.structure = 20000;
    centralStation.maxStructure = 20000;
    window.centralStationBoss = centralStation;

    const slot = Math.max(0, Math.min(M.spawns.length - 1, playerSlot | 0));
    this.playerSlot = slot;
    const sp = M.spawns[slot];
    const plan = ENTRY_SPAWNS[playerHullGroup(playerShip)];

    // Flatten the plan into one list and shuffle it, so hunters and miners are mixed around the belt
    const list = [];
    for (const e of plan) {
      for (let k = 0; k < e.n; k++) {
        const cfg = e.t === 'miners' ? pickPirate(MINER_POOL) : PIRATE_TYPES[e.t];
        list.push({ cfg: cfg, dmg: e.dmg });
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
        { dmg: combat ? COMBAT_DPS_SCALE : item.dmg, aggro: combat, slot: slot });
    });
  }

  addPirate(cfg, x, y, id, opts) {
    opts = opts || {};
    const scale = (opts.dmg !== undefined ? opts.dmg : (DPS_DAMPEN[cfg.name] || 1)) * (opts.elite ? 1.5 : 1);
    // Instant aggro only for combat-capable hulls that belong to the player's own belt
    const autoAggro = !!opts.aggro && opts.slot === this.playerSlot;
    const shipObj = cfg.makeShip(x, y);
    shipObj.npcDamageScale = scale;
    shipObj.isPirate = true;   // NPC-owned
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
    this.publicNpcMiners.push({
      id: id,
      cfg: cfg,
      elite: !!opts.elite,
      frontierLevel: Number(opts.frontierLevel)||0,
      frontierKind: opts.frontierKind || '',
      frontierRarity: opts.frontierRarity || (opts.elite ? 'elite' : 'common'),
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
      role: opts.role || 'patrol',   // frontier miners mine; pirate hulls patrol
      faction: opts.faction || 'pirates',
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
        const r = 350 + Math.random() * 850;
        npc.patrolPt = { x: npc.home.x + Math.cos(a) * r, y: npc.home.y + Math.sin(a) * r };
      }
      this.flyTo(ship, npc.patrolPt, speed * PATROL_SPEED_FRAC);
      ship.currentTarget = null;
      return;
    }

    // Mining: keep the current rock until it is used up, otherwise pick the nearest one in range
    const rocks = belt && typeof belt.getEntities === 'function' ? belt.getEntities() : [];
    if (!npc.rock || !(npc.rock.oreYield > 0)) {
      npc.rock = null;
      let best = null, bd = 1400;
      for (const r of rocks) {
        if (!r || !(r.oreYield > 0)) continue;
        const d = Math.hypot(r.x - ship.x, r.y - ship.y);
        if (d < bd) { bd = d; best = r; }
      }
      npc.rock = best;
    }

    if (!npc.rock) {
      // no rocks nearby: drift back to its area
      this.flyTo(ship, npc.home, speed * PATROL_SPEED_FRAC);
      ship.currentTarget = null;
      return;
    }

    const rock = npc.rock;
    const parkDist = 220;
    const dx = rock.x - ship.x, dy = rock.y - ship.y, d = Math.hypot(dx, dy);
    if (d > parkDist + 20) {
      // fly in from the side it is already on
      const a = Math.atan2(ship.y - rock.y, ship.x - rock.x);
      this.flyTo(ship, { x: rock.x + Math.cos(a) * parkDist, y: rock.y + Math.sin(a) * parkDist }, speed * MINE_SPEED_FRAC);
      ship.currentTarget = null;
    } else {
      // in position: hold, face the rock and show the mining laser
      ship.vx = 0;
      ship.vy = 0;
      ship._vel = { x: 0, y: 0 };
      ship.angle = Math.atan2(dy, dx);
      ship.currentTarget = rock;
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
    if (currentMapId !== 'public_space' && String(currentMapId).indexOf('frontier_') !== 0) return;

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
      if (!npc.isAlive) { if(npc.frontierLevel && npc.respawnAt && Date.now()>=npc.respawnAt)this.reviveFrontierNpc(npc); else return; }
      if (!npc.ship) return;
      const ship = npc.ship;

      // Check if NPC was killed
      if (this.totalHp(ship) <= 0 && !npc.rewarded) {
        npc.rewarded = true;
        npc.isAlive = false;
        // NPC-versus-NPC battles should not pay the player for kills they did not make.
        if (npc.npcKilledByNpc) {
          if (npc.frontierLevel) {
            npc.respawnAt = Date.now() + 60000 + Math.floor(Math.random() * 60001);
            if (window.MinispaceOnline && window.MinispaceOnline.send) window.MinispaceOnline.send({type:'frontier-npc-killed',mapId:currentMapId,npcId:npc.id,respawnAt:npc.respawnAt});
          }
          return;
        }
        if(npc.frontierLevel){npc.respawnAt=Date.now()+60000+Math.floor(Math.random()*60001);if(window.MinispaceOnline&&window.MinispaceOnline.send)window.MinispaceOnline.send({type:'frontier-npc-killed',mapId:currentMapId,npcId:npc.id,respawnAt:npc.respawnAt});}
        if (playerData && playerData.isk !== undefined) {
          playerData.isk += Math.floor(npc.bounty);
        }
        const frontierXP = npc.frontierLevel ? Math.round(140 + npc.frontierLevel * 110 + (npc.elite ? 450 : 0)) : 75;
        if(playerData){
          if(!playerData.stationOre)playerData.stationOre={};
          const salvageTier=Math.max(1,Math.min(5,Number(npc.frontierLevel)||1));
          const salvageKey='debris_t'+salvageTier;
          const salvageQty=Math.round((350+salvageTier*250+Math.random()*200)*(npc.elite?2:1));
          const loaded=typeof window.addOreToCargo==='function'?window.addOreToCargo(playerShip,salvageKey,salvageQty):0;
          const overflow=Math.max(0,salvageQty-loaded);
          // Any salvage that does not fit stays as a mineable wreck at the pirate's death position.
          npc.salvageReward={key:salvageKey,qty:salvageQty,loaded:loaded,overflow:overflow};
        }
        if (typeof window.awardPlayerXP === 'function') {
          window.awardPlayerXP('combat', frontierXP, 'Pirate destroyed');
        }
        if(playerData){
          if(!Array.isArray(playerData.moduleDrops))playerData.moduleDrops=[];
          const rr=Math.random(),rarity=rr<.48?'white':rr<.78?'green':rr<.94?'blue':'purple';
          const hull=npc.className==='Capital'?'Siege Capital':npc.className;
          const mods=({'Carrier':['droneTether','shieldExtender','resistance','propulsion'],'Siege Battleship':['missiles','shield','propulsion'],'Siege Cruiser':['guns','shield','resistance','shieldRecharge'],'Siege Capital':['guns','shieldPlating','propulsion','resistance'],'Combat Frigate':['missiles','shield','scrambler','propulsion']})[hull]||['shield','propulsion'];
          const module=mods[Math.floor(Math.random()*mods.length)];
          playerData.moduleDrops.push({id:'mod-'+npc.id+'-'+Date.now(),rarity:rarity,hull:hull,module:module,name:rarity.toUpperCase()+' '+module+' Module',level:1});
          if(typeof window.showCorpNotification==='function')window.showCorpNotification('MODULE DROP: '+rarity.toUpperCase()+' '+module);
        }
        if(npc.elite&&npc.frontierLevel===5&&playerData){
          const hull=npc.className==='Capital'?'Siege Capital':(npc.className||'Combat Frigate');
          const keys=({'Carrier':['droneTether','shieldExtender','resistance','propulsion'],'Siege Battleship':['missiles','shield','propulsion'],'Siege Cruiser':['guns','shield','resistance','shieldRecharge'],'Siege Capital':['guns','shieldPlating','propulsion','resistance'],'Combat Frigate':['missiles','shield','scrambler','propulsion']})[hull]||['shield','propulsion'];
          const module=keys[Math.floor(Math.random()*keys.length)];
          if(!Array.isArray(playerData.skillChips))playerData.skillChips=[];
          playerData.skillChips.push({id:'chip-'+npc.id+'-'+Date.now(),hull:hull,module:module,rarity:'purple',name:'Purple '+hull+' Skill Chip',source:'Elite Frontier Pirate'});
          if(typeof window.showCorpNotification==='function')window.showCorpNotification('✦ PURPLE SKILL CHIP: '+hull+' · '+module+' max level +1 when fitted');
          if(typeof saveGameSession==='function')saveGameSession();
        }
        if (typeof window.showCorpNotification === 'function') {
          window.showCorpNotification('PIRATE DESTROYED · +' + Math.floor(npc.bounty).toLocaleString() + ' Scrap Metals · +' + frontierXP + ' XP · SALVAGE +' + (npc.salvageReward ? npc.salvageReward.qty + ' ' + npc.salvageReward.key.replace('debris_','T') : 'secured'));
        }
        if (typeof updateStationUI === 'function') updateStationUI();
        if (typeof saveGameSession === 'function') saveGameSession();
        // Spawn only the cargo overflow as a visible, mineable salvage wreck.
        const overflowDrop=npc.salvageReward&&Number(npc.salvageReward.overflow)||0;
        if (overflowDrop>0 && debrisField && Array.isArray(debrisField.entities)) {
          debrisField.entities.push({
            x: ship.x,
            y: ship.y,
            radius: Math.max(26,Math.min(54,24+Math.sqrt(overflowDrop)*0.35)),
            oreYield: overflowDrop,
            oreType: npc.salvageReward.key,
            salvageWreck: true,
            sourceNpcId: npc.id
          });
        }
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
      // Frontier NPCs have their own local conflict: pirate ships hunt miners and miners flee/defend
      // only through their normal mining behaviour. This runs without a player being present.
      let npcTarget = null;
      let npcTargetDistance = 1550;
      if (String(currentMapId).indexOf('frontier_') === 0 && !engaged) {
        for (const other of this.publicNpcMiners) {
          if (!other || other === npc || !other.isAlive || !other.ship || other.faction === npc.faction) continue;
          const d = Math.hypot(other.ship.x - ship.x, other.ship.y - ship.y);
          if (d < npcTargetDistance) { npcTarget = other; npcTargetDistance = d; }
        }
      }
      const fightingNpc = !!(npcTarget && npc.combat);

      if (DEBUG_NPC && this._dbgFrame % 120 === 0 && SIEGE_HULLS[npc.className]) {
        console.log('[NPC]', npc.className, 'dist', Math.round(distToPlayer), 'ring', Math.round(this.ringRadius(npc)),
          'weaponRange', ship.weaponRange, 'speed', this.npcSpeed(npc, playerShip).toFixed(2),
          'pos', Math.round(ship.x), Math.round(ship.y), 'engaged', engaged);
      }

      // 1-3. Let the ship's own update() run, then undo whatever movement it made.
      // Combat hulls always run it (so missiles keep moving); other hulls only when engaged.
      if (npc.combat || engaged || fightingNpc) {
        const keepX = ship.x, keepY = ship.y;
        if (fightingNpc) this.runShipUpdate(npc, npcTarget.ship, true, true);
        else this.runShipUpdate(npc, playerShip, playerPresent, engaged);
        this.setPos(ship, keepX, keepY);
      }

      // 4. Movement
      if (engaged) {
        npc.isAgro = true;
        this.engagePlayer(npc, playerShip);

        // Deal damage to the player if inside weapon range (or on the ring, whichever is further)
        const wr = Number(ship.weaponRange) > 0 ? Number(ship.weaponRange) : RING_DEFAULT_RANGE;
        if (distToPlayer <= Math.max(wr, this.ringRadius(npc) * 1.1)) {
          if (typeof playerShip.takeDamage === 'function') {
            playerShip.takeDamage(0.85 * (npc.dpsScale || 1));
          } else {
            playerShip.structure -= 0.85 * (npc.dpsScale || 1);
          }
        }
      } else if (fightingNpc) {
        npc.isAgro = true;
        this.engagePlayer(npc, npcTarget.ship);
        const wr = Number(ship.weaponRange) > 0 ? Number(ship.weaponRange) : RING_DEFAULT_RANGE;
        if (npcTargetDistance <= Math.max(wr, this.ringRadius(npc) * 1.1)) {
          const damage = 0.85 * (npc.dpsScale || 1);
          npcTarget.npcKilledByNpc = true;
          if (typeof npcTarget.ship.takeDamage === 'function') npcTarget.ship.takeDamage(damage);
          else if (typeof npcTarget.ship.structure === 'number') npcTarget.ship.structure -= damage;
        }
        ship.currentTarget = npcTarget.ship;
      } else {
        // Player is away: miners work asteroid fields; pirates patrol their system.
        npc.isAgro = false;
        this.peacefulBehaviour(npc, asteroidBelt);
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
    this.publicNpcMiners = this.publicNpcMiners.filter(n => n.isAlive || (n.frontierLevel && n.respawnAt));
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
    if (currentMapId !== 'public_space' && String(currentMapId).indexOf('frontier_') !== 0) return;

    // Draw Central Station Boss and its health bar
    if (currentMapId === 'public_space' && window.centralStationBoss && typeof window.centralStationBoss.draw === 'function') {
      window.centralStationBoss.draw(ctx);
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

    // Draw all live NPC pirate ships, health bars, and labels
    this.publicNpcMiners.forEach(npc => {
      try {
      if (npc.isAlive && npc.ship && typeof npc.ship.draw === 'function') {
        // Draw at the manager's position, in case something moved the ship after update()
        if (npc.pos) this.setPos(npc.ship, npc.pos.x, npc.pos.y);
        npc.ship.draw(ctx);

        // Gate-style nameplate, scaled down for ships. Rarity colours the frame and title.
        ctx.save();
        const rarity = npc.frontierLevel ? (npc.frontierRarity || 'common') : 'common';
        const accent = rarity === 'elite' ? '#bc8cff'
          : rarity === 'rare' ? '#58a6ff'
          : rarity === 'uncommon' ? '#3fb950'
          : '#e6edf3';
        const zoom = Math.max(0.45, Number(window.cameraZoom) || 1);
        const label = 'PIRATE';
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
