// Asteroids.js - AsteroidBelt (industrial ship-matched art + live mining destruction)

const ASTEROID_ORE_TYPES = [
  { name: 'veldspar',  base: '#6b5c45', dark: '#2c261c', mid: '#8a7655', glow: '#c9a227', vein: '#e8d48b' },
  { name: 'scordite',  base: '#3d5a6e', dark: '#1a2a35', mid: '#5a7a90', glow: '#58a6ff', vein: '#9ecbff' },
  { name: 'pyroxeres', base: '#6e3a3a', dark: '#2e1818', mid: '#8c4a4a', glow: '#f85149', vein: '#ff9b9b' },
  { name: 'omber',     base: '#3a6b48', dark: '#1c3324', mid: '#4f8a5e', glow: '#3fb950', vein: '#8fdf9f' }
];

// ---- performance tuning ----------------------------------------------------
// Fraction of the requested rocks that generate() actually creates (1 = all of them).
const ASTEROID_DENSITY = 0.6;
// Level of detail by on-screen rock radius in pixels (so zooming out switches to cheaper drawing):
//   below FAR  -> flat filled shape
//   below MID  -> shape with a simple highlight and outline
//   above MID  -> the full textured, lit rock
const AST_LOD_FAR = 9;
const AST_LOD_MID = 22;

// ---- helpers ---------------------------------------------------------------
const _astHexCache = {};
const _astRgbCache = {};
function _astParse(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _astHex(a, b, t) {
  const key = a + b + t;
  if (_astHexCache[key]) return _astHexCache[key];
  const pa = _astParse(a), pb = _astParse(b);
  const h = '#' + pa.map((v, i) => {
    const x = Math.round(v + (pb[i] - v) * t);
    return (x < 16 ? '0' : '') + x.toString(16);
  }).join('');
  return (_astHexCache[key] = h);
}
function _astRgba(hex, alpha) {
  const c = _astRgbCache[hex] || (_astRgbCache[hex] = _astParse(hex));
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
}
function _astRng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}
function _astShard(n) {
  const pts = [];
  const off = Math.random() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
    const r = 0.55 + Math.random() * 0.6;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.85 });
  }
  return pts;
}
function _astAngDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

const _AST_RUST = { base: '#46301f', mid: '#8a5a3a', dark: '#100907', lit: '#d9a066' };
const _AST_HOT = '#ff9a3c';
function _astPal(c) {
  if (c._pal) return c._pal;
  const mid = _astHex(c.mid, _AST_RUST.mid, 0.5);
  return (c._pal = {
    base: _astHex(c.base, _AST_RUST.base, 0.58),
    mid: mid,
    dark: _astHex(c.dark, _AST_RUST.dark, 0.62),
    lit: _astHex(mid, _AST_RUST.lit, 0.5),
    glow: c.glow,
    vein: c.vein,
    hot: _astHex(c.glow, _AST_HOT, 0.55)
  });
}

const _astTexCache = {};
function _astTexture(ctx, c) {
  const key = c.name || c.base;
  if (_astTexCache[key] !== undefined) return _astTexCache[key];
  if (typeof document === 'undefined') return (_astTexCache[key] = null);
  const pal = _astPal(c);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return (_astTexCache[key] = null);
  const rnd = _astRng(key.length * 977 + key.charCodeAt(0) * 131);
  const wrapRect = (x, y, w, h, fn) => {
    for (const ox of [0, -S]) for (const oy of [0, -S]) fn(x + ox, y + oy, w, h);
  };

  g.fillStyle = pal.base;
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 60; i++) {
    const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 38;
    g.fillStyle = _astRgba(rnd() > 0.45 ? pal.mid : pal.dark, 0.13);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 30; i++) {
    const x = rnd() * S, y = rnd() * S, l = 14 + rnd() * 50;
    g.strokeStyle = rnd() > 0.5 ? 'rgba(150,80,30,0.10)' : 'rgba(0,0,0,0.12)';
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y + l); g.stroke();
  }
  for (let i = 0; i < 520; i++) {
    const w = 2 + Math.floor(rnd() * 5), h = 2 + Math.floor(rnd() * 4);
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,215,170,0.07)' : 'rgba(0,0,0,0.16)';
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), w, h);
  }
  for (let i = 0; i < 26; i++) {
    const w = 18 + rnd() * 56, h = 12 + rnd() * 38;
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    wrapRect(x, y, w, h, (px, py, pw, ph) => {
      g.fillStyle = rnd() > 0.5 ? 'rgba(255,220,180,0.06)' : 'rgba(0,0,0,0.15)';
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, pw, ph);
      g.strokeStyle = _astRgba(pal.lit, 0.40);
      g.beginPath(); g.moveTo(px + 1.5, py + ph); g.lineTo(px + 1.5, py + 1.5); g.lineTo(px + pw, py + 1.5); g.stroke();
    });
    if (rnd() > 0.35) {
      for (const p of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) {
        wrapRect(p[0], p[1], 0, 0, (px, py) => {
          g.fillStyle = 'rgba(0,0,0,0.65)';
          g.beginPath(); g.arc(px, py, 1.7, 0, Math.PI * 2); g.fill();
          g.fillStyle = _astRgba(pal.lit, 0.6);
          g.fillRect(px - 1, py - 1, 1, 1);
        });
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), n = 3 + Math.floor(rnd() * 4), w = 8 + rnd() * 12;
    for (let s = 0; s < n; s++) {
      wrapRect(x, y + s * 3, w, 2, (px, py, pw) => {
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(px, py, pw, 1.5);
        g.fillStyle = _astRgba(pal.lit, 0.18);
        g.fillRect(px, py + 1.5, pw, 1);
      });
    }
  }
  g.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    let x = rnd() * S, y = rnd() * S;
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      if (rnd() > 0.5) x += (rnd() - 0.5) * 36; else y += (rnd() - 0.5) * 36;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,225,190,0.12)' : 'rgba(0,0,0,0.22)';
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1 + (rnd() > 0.75 ? 1 : 0), 1);
  }
  for (let i = 0; i < 30; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 6 + rnd() * 22;
    g.strokeStyle = 'rgba(255,225,190,0.17)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 34; i++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    g.fillStyle = _astRgba(pal.glow, 0.18);
    g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle = _astRgba(pal.vein, 0.85);
    g.fillRect(x, y, 1, 1);
  }
  return (_astTexCache[key] = ctx.createPattern(cv, 'repeat'));
}

const _AST_LIGHT = { x: -0.62, y: -0.78 };
const _AST_MAX_PARTS = 260;

const _AST_SHIP_COLORS = [
  { glow: '#3fe07a', core: '#d2ffe2' },  // player: green
  { glow: '#38d8ff', core: '#d6f7ff' },
  { glow: '#ff52d9', core: '#ffd8f6' },
  { glow: '#ffb21f', core: '#fff1c8' },
  { glow: '#9b6bff', core: '#e8deff' },
  { glow: '#ff5648', core: '#ffd3cd' },
  { glow: '#d8ff3a', core: '#f7ffc8' },
  { glow: '#7aa8ff', core: '#e0eaff' }
];

class AsteroidBelt {
  constructor(x, y, count = 150, radius = 5000) {
    this.x = x;
    this.y = y;
    this.count = count;
    this.radius = radius;
    this.entities = [];
    this.oreTypes = ASTEROID_ORE_TYPES;
    this._tick = 0;
    this._target = undefined;
    this.parts = [];
    this._ship = null;
    this._fleet = null;
    this._hooked = false;
    this._live = null;      // cached list of rocks with ore left, see getEntities()
    this._liveTick = -1;
    this._liveLen = -1;
  }

  makeRock(ore) {
    const rx = 500 + Math.random() * 4000;
    const ry = 2800 + Math.random() * 1900;
    const baseRadius = 35 + Math.random() * 55;
    const pointsCount = 8 + Math.floor(Math.random() * 7);
    const vertices = [];
    for (let v = 0; v < pointsCount; v++) {
      const angle = (v / pointsCount) * Math.PI * 2;
      const vRad = baseRadius * (0.55 + Math.random() * 0.7);
      vertices.push({ x: Math.cos(angle) * vRad, y: Math.sin(angle) * vRad });
    }
    return {
      x: rx, y: ry, radius: baseRadius, vertices: vertices,
      oreYield: 1500 + Math.random() * 3500,
      maxYield: 5000,
      oreType: ore.name,
      colors: ore,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.0015,
      craters: Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => ({
        x: (Math.random() - 0.5) * baseRadius * 1.2,
        y: (Math.random() - 0.5) * baseRadius * 1.2,
        r: 3 + Math.random() * 7
      })),
      veins: Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
        x1: (Math.random() - 0.5) * baseRadius, y1: (Math.random() - 0.5) * baseRadius,
        x2: (Math.random() - 0.5) * baseRadius, y2: (Math.random() - 0.5) * baseRadius
      }))
    };
  }

  // count is scaled by ASTEROID_DENSITY. Pass exact = true to create exactly `count` rocks.
  generate(count, oreNames, exact) {
    let pool = this.oreTypes.filter(o => !oreNames || oreNames.includes(o.name));
    if (pool.length === 0) pool = this.oreTypes;
    const n = exact ? count : Math.max(1, Math.round(count * ASTEROID_DENSITY));
    for (let i = 0; i < n; i++) {
      this.entities.push(this.makeRock(pool[Math.floor(Math.random() * pool.length)]));
    }
  }

  // Rocks that still have ore. Cached per tick, because NPC miners and drones call this every frame.
  getEntities() {
    if (!this._live || this._liveTick !== this._tick || this._liveLen !== this.entities.length) {
      this._live = this.entities.filter(e => e.oreYield > 0);
      this._liveTick = this._tick;
      this._liveLen = this.entities.length;
    }
    return this._live;
  }

  _findShip(view) {
    let s = null;
    try { if (typeof playerShip !== 'undefined' && playerShip) s = playerShip; } catch (_) {}
    if (!s && typeof window !== 'undefined' && window.playerShip) s = window.playerShip;
    if (s && isFinite(s.x) && isFinite(s.y)) return { x: s.x, y: s.y };
    if (view) return { x: (view.x1 + view.x2) / 2, y: (view.y1 + view.y2) / 2 };
    return this._ship;
  }

  update() {
    this._hookFleet();
    const ship = this._ship;
    for (const e of this.entities) {
      e.rotation += e.rotSpeed;
      this._track(e, ship);
    }
    this._stepParts(ship);

    if (this._target === undefined) this._target = this.entities.length || this.count;

    this._tick++;
    if (this._tick % 300 !== 0) return;
    this.entities = this.entities.filter(e => e.oreYield > 0);
    if (this.entities.length < this._target * 0.6) {
      const names = Array.from(new Set(this.entities.map(e => e.oreType)));
      this.generate(Math.ceil(this._target * 0.2), names.length ? names : null, true);
    }
  }

  _hookFleet() {
    if (this._hooked) return;
    try {
      if (typeof BotManager === 'undefined') return;
      if (!BotManager.prototype._astHooked) {
        const orig = BotManager.prototype.update;
        BotManager.prototype._astHooked = true;
        BotManager.prototype.update = function (playerShip, belt) {
          const b = belt || this.asteroidBelt;
          if (b && typeof b._setFleet === 'function') b._setFleet(this, playerShip);
          return orig.apply(this, arguments);
        };
      }
    } catch (_) {}
    this._hooked = true;
  }
  _setFleet(mgr, player) { this._fleet = { bots: (mgr && mgr.bots) || [], player: player || null }; }

  _colFor(bot, idx) {
    if (!bot) return _AST_SHIP_COLORS[0];
    if (!bot._astCol) bot._astCol = _AST_SHIP_COLORS[1 + (idx % (_AST_SHIP_COLORS.length - 1))];
    return bot._astCol;
  }

  // Returns only the drones/ships that are actually pulling ore from this rock right now
  _minersOf(e, fallback) {
    const out = [];
    const f = this._fleet;

    const checkShipOrDrones = (s, bot, colIdx) => {
      if (!s || !isFinite(s.x) || !isFinite(s.y)) return;
      const col = bot ? this._colFor(bot, colIdx) : _AST_SHIP_COLORS[0];
      const drones = (bot && bot.drones) || (s && s.drones) || (bot && bot.activeDrones) || (s && s.activeDrones) || [];
      let droneMiningCount = 0;

      for (const d of drones) {
        if (!d) continue;
        const dr = d.ship || d;
        const isDocked = d.isDocked !== undefined ? d.isDocked : (dr.docked || false);
        if (isDocked) continue;

        // Only a drone that is in range and mining counts, not one still flying to the rock
        if (d.mining === true && (d.targetRock === e || dr.currentTarget === e)) {
          out.push({ ship: dr, rawShip: s, bot: bot, col: col });
          droneMiningCount++;
        }
      }

      if (droneMiningCount === 0) {
        // A ship only counts as mining when it is targeting this rock AND the rock is inside its laser range
        const targeted = (s.currentTarget === e || s.target === e || (bot && bot.target === e));
        const inRange = Math.hypot(e.x - s.x, e.y - s.y) <= (s.laserRange || 0);
        if (targeted && inRange) out.push({ ship: s, rawShip: s, bot: bot, col: col });
      }
    };

    if (f) {
      if (f.player) checkShipOrDrones(f.player, null, 0);
      if (f.bots) f.bots.forEach((b, i) => { if (b && b.ship) checkShipOrDrones(b.ship, b, i); });
    }

    return out.slice(0, 8);
  }

  _track(e, ship) {
    if (e._lastY === undefined) { e._lastY = e.oreYield; e._y0 = Math.max(e.oreYield, 1); return; }
    const delta = e._lastY - e.oreYield;
    e._lastY = e.oreYield;
    if (e._heat) { e._heat *= 0.955; if (e._heat < 0.01) e._heat = 0; }

    if (e.oreYield <= 0) {
      if (!e._shattered && e._fx) { e._shattered = true; this._burst(e, 20, 2.2); }
      return;
    }
    if (delta <= 0.0001) return;
    const miners = this._minersOf(e, ship);
    if (!miners.length) return;

    const fx = this._ensureFx(e);
    const R = e.radius;
    const prevDmg = e._dmg || 0;
    e._dmg = Math.min(1, 1 - e.oreYield / e._y0);
    e._heat = Math.min(1, (e._heat || 0) + 0.22);
    e._hit = miners[0].col;
    const share = delta / miners.length;
    const k = 0.55 + 0.45 * Math.min(1, e.oreYield / (e.maxYield || 5000));
    const pal = _astPal(e.colors || ASTEROID_ORE_TYPES[0]);
    let firstAng = 0;

    miners.forEach((m, mi) => {
      const worldAng = Math.atan2(m.ship.y - e.y, m.ship.x - e.x);
      const la = worldAng - e.rotation;
      if (mi === 0) { firstAng = worldAng; fx.hitAng = la; }

      let bite = null;
      for (const b of fx.bites) if (Math.abs(_astAngDiff(b.ang, la)) < 0.55) { bite = b; break; }
      if (!bite && fx.bites.length < 5) {
        bite = { ang: la, depth: 0, w: 0.6 + Math.random() * 0.45 };
        fx.bites.push(bite);
      }
      if (!bite) bite = fx.bites[0];
      bite.depth = Math.min(1, bite.depth + (share / e._y0) * 2.8);

      const hx = e.x + Math.cos(worldAng) * R * k * 0.5, hy = e.y + Math.sin(worldAng) * R * k * 0.5;
      if (this.parts.length < _AST_MAX_PARTS) {
        if (Math.random() < 0.65) this._spawnOre(hx, hy, pal, m.col, m);
        if (Math.random() < 0.30) this._spawnChunk(hx, hy, worldAng, pal, 2 + Math.random() * 3.5, false, m.col);
        if (Math.random() < 0.55) this._spawnDust(hx, hy, worldAng, pal);
        this._spawnSpark(hx, hy, worldAng, pal, m.col);
        if (Math.random() < 0.5) this._spawnSpark(hx, hy, worldAng, pal, m.col);
      }
    });

    for (const th of [0.33, 0.66]) {
      if (prevDmg < th && e._dmg >= th) this._burst(e, 9, 1.2, firstAng, e._hit);
    }
  }

  _spawnOre(x, y, pal, col, src) {
    const j = () => (Math.random() - 0.5) * 8;
    this.parts.push({
      type: 'ore', x0: x + j(), y0: y + j(), x: x, y: y, p: 0,
      sp: 1 / (40 + Math.random() * 36), ph: Math.random() * 6.28, wa: 4 + Math.random() * 9,
      size: 2.2 + Math.random() * 3.2, pts: _astShard(4 + Math.floor(Math.random() * 2)),
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35, trail: [], pal: pal, col: col, src: src
    });
  }

  _spawnChunk(x, y, ang, pal, size, hot, col) {
    const dir = ang + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 1.3;
    const sp = 0.5 + Math.random() * 1.5;
    const life = 60 + Math.floor(Math.random() * 70);
    this.parts.push({
      type: 'chunk', x: x, y: y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, drag: 0.985,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.25, life: life, max: life,
      size: size, pts: _astShard(5 + Math.floor(Math.random() * 2)), pal: pal, hot: hot, col: col
    });
  }

  _spawnDust(x, y, ang, pal) {
    const dir = ang + Math.PI + (Math.random() - 0.5) * 2.2;
    const sp = 0.2 + Math.random() * 0.7;
    const life = 24 + Math.floor(Math.random() * 22);
    this.parts.push({
      type: 'dust', x: x, y: y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, drag: 0.96,
      rot: 0, vr: 0, life: life, max: life, size: 2 + Math.random() * 3.5, pal: pal
    });
  }

  _spawnSpark(x, y, ang, pal, col) {
    const dir = ang + (Math.random() - 0.5) * 2.6;
    const sp = 2.5 + Math.random() * 3;
    const life = 10 + Math.floor(Math.random() * 9);
    this.parts.push({
      type: 'spark', x: x, y: y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, drag: 0.93,
      rot: 0, vr: 0, life: life, max: life, size: 1, pal: pal, col: col
    });
  }

  _burst(e, n, power, dirAng, col) {
    col = col || e._hit || _AST_SHIP_COLORS[0];
    const pal = _astPal(e.colors || ASTEROID_ORE_TYPES[0]);
    const R = e.radius;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, d = Math.random() * R * 0.5;
      const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d;
      this._spawnChunk(x, y, a, pal, R * (0.06 + Math.random() * 0.1) * power, true, col);
      const c = this.parts[this.parts.length - 1];
      const sp = (1 + Math.random() * 2.2) * Math.min(power, 1.8);
      c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp; c.drag = 0.98;
      if (i % 2 === 0) this._spawnDust(x, y, a, pal);
      if (i % 3 === 0) this._spawnSpark(x, y, a, pal, col);
    }
    this.parts.push({ type: 'flash', x: e.x, y: e.y, vx: 0, vy: 0, drag: 1, rot: 0, vr: 0,
                      life: 16, max: 16, size: R * (power > 2 ? 2.2 : 1.3), pal: pal, col: col });
  }

  _stepParts(ship) {
    if (!this.parts.length) return;
    const keep = [];
    for (const p of this.parts) {
      if (p.type === 'ore') {
        const tgt = (p.src && p.src.ship) || ship;
        if (!tgt) continue;
        p.p += p.sp * (0.8 + p.p * 1.6);
        if (p.p >= 1) continue;
        const q = Math.pow(p.p, 1.6);
        const dx = tgt.x - p.x0, dy = tgt.y - p.y0, dl = Math.hypot(dx, dy) || 1;
        const wob = Math.sin(p.p * 10 + p.ph) * p.wa * (1 - p.p);
        p.x = p.x0 + dx * q + (-dy / dl) * wob;
        p.y = p.y0 + dy * q + (dx / dl) * wob;
        p.trail.push(p.x, p.y);
        if (p.trail.length > 10) p.trail.splice(0, 2);
        p.rot += p.vr;
        keep.push(p);
      } else {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.drag; p.vy *= p.drag;
        p.rot += p.vr;
        if (--p.life > 0) keep.push(p);
      }
    }
    this.parts = keep;
  }

  _ensureFx(e) {
    if (e._fx) return e._fx;
    const R = e.radius;
    const rnd = _astRng(Math.floor(e.x * 31 + e.y * 17 + R * 1000));
    const fx = { outline: [], ang: [], jag: [], craters: [], cracks: [], pockets: [], fractures: [],
                 bites: [], hitAng: 0, cur: null, f: null,
                 phase: rnd() * Math.PI * 2, ox: Math.floor(rnd() * 256), oy: Math.floor(rnd() * 256) };

    const verts = e.vertices, n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[i], b = verts[(i + 1) % n];
      fx.outline.push({ x: a.x, y: a.y });
      const segs = 2 + (rnd() > 0.5 ? 1 : 0);
      for (let s = 1; s <= segs; s++) {
        const t = s / (segs + 1);
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        const len = Math.hypot(px, py) || 1;
        const j = (rnd() - 0.45) * R * 0.17;
        fx.outline.push({ x: px + (px / len) * j, y: py + (py / len) * j });
      }
    }
    for (const p of fx.outline) { fx.ang.push(Math.atan2(p.y, p.x)); fx.jag.push(rnd()); }

    if (e.craters && e.craters.length) {
      fx.craters = e.craters;
    } else {
      const cn = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < cn; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.6;
        fx.craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: R * (0.07 + rnd() * 0.13) });
      }
    }

    const kn = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < kn; i++) fx.cracks.push(this._zigzag(fx, rnd, R, true));

    const fn = 7;
    for (let i = 0; i < fn; i++) {
      fx.fractures.push({ pts: this._zigzag(fx, rnd, R, false), th: 0.05 + i * 0.11 + rnd() * 0.05 });
    }

    const pn = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < pn; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.55;
      const s = R * (0.07 + rnd() * 0.08);
      const pts = [];
      const sides = 5 + Math.floor(rnd() * 2);
      for (let v = 0; v < sides; v++) {
        const va = (v / sides) * Math.PI * 2 + rnd() * 0.4;
        const vr = s * (0.6 + rnd() * 0.7);
        pts.push({ x: Math.cos(va) * vr, y: Math.sin(va) * vr * 0.8 });
      }
      fx.pockets.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: s, pts: pts, ph: rnd() * Math.PI * 2 });
    }
    e._fx = fx;
    return fx;
  }

  _zigzag(fx, rnd, R, fromEdge) {
    const pts = [];
    let cx, cy, ang;
    if (fromEdge) {
      const p = fx.outline[Math.floor(rnd() * fx.outline.length)];
      cx = p.x; cy = p.y; ang = Math.atan2(-p.y, -p.x) + (rnd() - 0.5) * 0.9;
    } else {
      const a = rnd() * Math.PI * 2;
      cx = Math.cos(a) * R * 0.15 * rnd(); cy = Math.sin(a) * R * 0.15 * rnd(); ang = a;
    }
    pts.push({ x: cx, y: cy });
    const steps = 3 + Math.floor(rnd() * 3);
    for (let s = 0; s < steps; s++) {
      const l = R * (0.16 + rnd() * 0.2);
      ang += (rnd() - 0.5) * 1.5;
      cx += Math.cos(ang) * l; cy += Math.sin(ang) * l;
      pts.push({ x: cx, y: cy });
    }
    return pts;
  }

  _deform(fx) {
    const ol = fx.outline;
    if (!fx.bites.length) { fx.cur = ol; fx.f = null; return ol; }
    const n = ol.length;
    if (!fx.cur || fx.cur === ol) { fx.cur = ol.map(p => ({ x: p.x, y: p.y })); fx.f = new Float32Array(n); }
    for (let i = 0; i < n; i++) {
      let f = 0;
      for (const b of fx.bites) {
        const w = b.w + b.depth * 0.5;
        const a = Math.abs(_astAngDiff(fx.ang[i], b.ang));
        if (a < w) {
          const v = Math.pow(1 - a / w, 0.8) * b.depth * (0.78 + 0.22 * fx.jag[i]);
          if (v > f) f = v;
        }
      }
      fx.f[i] = f;
      const s = 1 - 0.62 * f * (0.8 + 0.2 * fx.jag[i]);
      fx.cur[i].x = ol[i].x * s; fx.cur[i].y = ol[i].y * s;
    }
    return fx.cur;
  }

  _path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  // Pixels per world unit, used to pick a level of detail. Falls back to the context transform.
  _scale(ctx, view) {
    const cv = ctx.canvas;
    if (view && cv && view.x2 > view.x1) return cv.width / (view.x2 - view.x1);
    try {
      const m = ctx.getTransform();
      return Math.hypot(m.a, m.b) || 1;
    } catch (_) {
      return 1;
    }
  }

  // Cheap rock for zoomed-out views: no clip, no texture, no gradients, no per-facet loops.
  // tiny = just a flat filled shape; otherwise adds a highlight blob and an outline.
  _drawSimple(ctx, e, pal, tiny) {
    const R = e.radius;
    const richness = Math.min(1, e.oreYield / (e.maxYield || 5000));
    const k = 0.55 + 0.45 * richness;
    const fx = e._fx;
    const pts = (fx && fx.bites.length) ? this._deform(fx) : e.vertices;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rotation);
    ctx.scale(k, k);
    this._path(ctx, pts);
    ctx.fillStyle = pal.base;
    ctx.fill();

    if (!tiny) {
      const cs = Math.cos(-e.rotation), sn = Math.sin(-e.rotation);
      const lx = _AST_LIGHT.x * cs - _AST_LIGHT.y * sn;
      const ly = _AST_LIGHT.x * sn + _AST_LIGHT.y * cs;
      ctx.save();
      ctx.translate(lx * R * 0.14, ly * R * 0.14);
      ctx.scale(0.72, 0.72);
      this._path(ctx, pts);
      ctx.fillStyle = pal.mid;
      ctx.fill();
      ctx.restore();
      this._path(ctx, pts);
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    const heat = e._heat || 0;
    if (heat > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = _astRgba(e._hit ? e._hit.glow : pal.hot, 0.35 * heat);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  draw(ctx, view) {
    const fs = this._findShip(view);
    if (fs) { if (!this._ship) this._ship = { x: 0, y: 0 }; this._ship.x = fs.x; this._ship.y = fs.y; }
    const t = this._tick;
    const sc = this._scale(ctx, view);
    for (const e of this.entities) {
      if (e.oreYield <= 0) continue;
      const m = e.radius * 1.9;
      if (view && (e.x + m < view.x1 || e.x - m > view.x2 ||
                   e.y + m < view.y1 || e.y - m > view.y2)) continue;

      const c = e.colors || ASTEROID_ORE_TYPES[0];
      const pal = _astPal(c);

      // Zoomed out: draw a cheap version instead of the full textured rock
      const screenR = e.radius * sc;
      if (screenR < AST_LOD_MID) {
        this._drawSimple(ctx, e, pal, screenR < AST_LOD_FAR);
        continue;
      }

      const fx = this._ensureFx(e);
      const R = e.radius;
      const richness = Math.min(1, e.oreYield / (e.maxYield || 5000));
      const k = 0.55 + 0.45 * richness;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.04 + fx.phase);
      const heat = e._heat || 0;
      const dmg = e._dmg || 0;
      const cur = this._deform(fx);
      const hotC = e._hit ? e._hit.glow : pal.hot;

      const cs = Math.cos(-e.rotation), sn = Math.sin(-e.rotation);
      const lx = _AST_LIGHT.x * cs - _AST_LIGHT.y * sn;
      const ly = _AST_LIGHT.x * sn + _AST_LIGHT.y * cs;

      ctx.save();
      const jit = heat > 0.05 ? heat * 1.4 : 0;
      ctx.translate(e.x + (jit ? (Math.random() - 0.5) * jit : 0), e.y + (jit ? (Math.random() - 0.5) * jit : 0));

      ctx.save();
      ctx.scale(k, k);
      const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.6);
      halo.addColorStop(0, _astRgba(heat > 0 ? hotC : pal.glow, 0.04 + 0.09 * richness * (0.6 + 0.4 * pulse) + 0.14 * heat));
      halo.addColorStop(1, _astRgba(pal.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.rotate(e.rotation);
      ctx.scale(k, k);
      this._path(ctx, cur);
      ctx.fillStyle = pal.base;
      ctx.fill();

      ctx.save();
      ctx.clip();

      const tex = _astTexture(ctx, c);
      if (tex) {
        ctx.save();
        ctx.translate(-fx.ox, -fx.oy);
        ctx.fillStyle = tex;
        ctx.fillRect(fx.ox - R * 2, fx.oy - R * 2, R * 4, R * 4);
        ctx.restore();
      }

      const lg = ctx.createLinearGradient(lx * R, ly * R, -lx * R, -ly * R);
      lg.addColorStop(0,    'rgba(255,205,150,0.32)');
      lg.addColorStop(0.45, 'rgba(0,0,0,0)');
      lg.addColorStop(1,    'rgba(0,0,0,0.66)');
      ctx.fillStyle = lg;
      ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);

      const cn = cur.length;
      for (let i = 0; i < cn; i++) {
        const a = cur[i], b = cur[(i + 1) % cn];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ml = Math.hypot(mx, my) || 1;
        const facing = (mx / ml) * lx + (my / ml) * ly;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.closePath();
        ctx.fillStyle = facing > 0
          ? 'rgba(255,200,150,' + (facing * 0.14).toFixed(3) + ')'
          : 'rgba(0,0,0,' + (-facing * 0.32).toFixed(3) + ')';
        ctx.fill();
      }

      const la = Math.atan2(ly, lx);
      for (const cr of fx.craters) {
        ctx.fillStyle = 'rgba(8,5,3,0.74)';
        ctx.beginPath(); ctx.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = _astRgba(pal.lit, 0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cr.x, cr.y, cr.r, la + Math.PI - 1.2, la + Math.PI + 1.2); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.arc(cr.x, cr.y, cr.r, la - 1.2, la + 1.2); ctx.stroke();
      }

      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      for (const pts of fx.cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3.4;
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = _astRgba(pal.glow, 0.30 + 0.25 * pulse + 0.2 * heat);
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = _astRgba(pal.vein, 0.9);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      if (dmg > 0.03) {
        for (const fr of fx.fractures) {
          const prog = Math.min(1, Math.max(0, (dmg - fr.th) / 0.14));
          if (prog <= 0) continue;
          const pts = fr.pts, segs = pts.length - 1;
          const upto = prog * segs;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i <= segs; i++) {
            if (i <= upto) { ctx.lineTo(pts[i].x, pts[i].y); continue; }
            const f = upto - (i - 1);
            if (f > 0) ctx.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
            break;
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth = 1.8 + 3.2 * dmg;
          ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = _astRgba(hotC, 0.16 + 0.12 * pulse + 0.55 * heat);
          ctx.lineWidth = 1.2 + 1.6 * dmg;
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = _astRgba(pal.vein, 0.35 + 0.5 * heat);
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }

      for (const p of fx.pockets) {
        const tw = 0.6 + 0.4 * Math.sin(t * 0.07 + p.ph);
        ctx.save();
        ctx.translate(p.x, p.y);
        this._path(ctx, p.pts);
        ctx.fillStyle = 'rgba(8,5,3,0.85)';
        ctx.fill();
        ctx.save();
        ctx.scale(0.72, 0.72);
        this._path(ctx, p.pts);
        const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, p.s * 1.1);
        pg.addColorStop(0, _astRgba(pal.vein, Math.min(1, 0.95 * tw + 0.3 * heat)));
        pg.addColorStop(1, _astRgba(pal.glow, 0.75 * tw));
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.restore();
        this._path(ctx, p.pts);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      if (heat > 0.02) {
        const hxl = Math.cos(fx.hitAng) * R * 0.55, hyl = Math.sin(fx.hitAng) * R * 0.55;
        const hg = ctx.createRadialGradient(hxl, hyl, 0, hxl, hyl, R * 0.85);
        hg.addColorStop(0, _astRgba('#ffffff', 0.55 * heat));
        hg.addColorStop(0.25, _astRgba(hotC, 0.6 * heat));
        hg.addColorStop(1, _astRgba(hotC, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hg;
        ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
        ctx.globalCompositeOperation = 'source-over';
      }

      this._path(ctx, cur);
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.lineWidth = R * 0.28;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.restore();

      this._path(ctx, cur);
      ctx.strokeStyle = _astHex(pal.dark, '#000000', 0.4);
      ctx.lineWidth = 3.4;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.lineWidth = 1.3;
      for (let i = 0; i < cn; i++) {
        const a = cur[i], b = cur[(i + 1) % cn];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ml = Math.hypot(mx, my) || 1;
        const facing = (mx / ml) * lx + (my / ml) * ly;
        if (facing < 0.15) continue;
        ctx.strokeStyle = _astRgba(pal.lit, Math.min(0.85, 0.35 + facing * 0.55));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      if (fx.f) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 2.4;
        for (let i = 0; i < cn; i++) {
          const f = fx.f[i];
          if (f < 0.06) continue;
          const a = cur[i], b = cur[(i + 1) % cn];
          ctx.strokeStyle = _astRgba(hotC, Math.min(1, f * (0.28 + 0.2 * pulse + 0.9 * heat)));
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();
    }

    this._drawParts(ctx, view, sc);
  }

  _drawParts(ctx, view, sc) {
    if (!this.parts.length) return;
    // When zoomed far out, dust and sparks are too small to see, so skip them
    const skipFine = sc !== undefined && sc < 0.4;
    for (const p of this.parts) {
      if (skipFine && (p.type === 'dust' || p.type === 'spark')) continue;
      if (view && (p.x < view.x1 - 80 || p.x > view.x2 + 80 || p.y < view.y1 - 80 || p.y > view.y2 + 80)) continue;
      const pal = p.pal;

      if (p.type === 'ore') {
        const s = p.size * (1 - p.p * 0.45);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (p.trail.length >= 4) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0], p.trail[1]);
          for (let i = 2; i < p.trail.length; i += 2) ctx.lineTo(p.trail[i], p.trail[i + 1]);
          ctx.strokeStyle = _astRgba(p.col.glow, 0.38);
          ctx.lineWidth = s * 0.8;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        ctx.fillStyle = _astRgba(p.col.glow, 0.22);
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = _astRgba(p.col.glow, 0.45);
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x * s, p.pts[0].y * s);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x * s, p.pts[i].y * s);
        ctx.closePath();
        ctx.fillStyle = pal.vein;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();

      } else if (p.type === 'chunk') {
        const lf = p.life / p.max;
        const al = lf < 0.3 ? lf / 0.3 : 1;
        const s = p.size;
        ctx.save();
        ctx.globalAlpha = al;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x * s, p.pts[0].y * s);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x * s, p.pts[i].y * s);
        ctx.closePath();
        ctx.fillStyle = pal.base;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x * s, p.pts[0].y * s);
        ctx.lineTo(p.pts[1].x * s, p.pts[1].y * s);
        ctx.lineTo(p.pts[2].x * s * 0.5, p.pts[2].y * s * 0.5);
        ctx.closePath();
        ctx.fillStyle = _astRgba(pal.lit, 0.6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(p.pts[0].x * s, p.pts[0].y * s);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x * s, p.pts[i].y * s);
        ctx.closePath();
        ctx.stroke();
        if (p.hot && lf > 0.45) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = _astRgba(p.col.glow, (lf - 0.45) * 1.1);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.restore();

      } else if (p.type === 'dust') {
        const lf = p.life / p.max;
        ctx.fillStyle = _astRgba(pal.lit, 0.30 * lf);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - lf * 0.6), 0, Math.PI * 2); ctx.fill();

      } else if (p.type === 'spark') {
        const lf = p.life / p.max;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = _astRgba(lf > 0.5 ? p.col.core : p.col.glow, lf);
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
        ctx.stroke();
        ctx.restore();

      } else if (p.type === 'flash') {
        const lf = p.life / p.max;
        const r = p.size * (1.5 - lf * 0.7);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, _astRgba('#ffffff', 0.7 * lf));
        g.addColorStop(0.3, _astRgba(p.col.glow, 0.55 * lf));
        g.addColorStop(1, _astRgba(p.col.glow, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
}
