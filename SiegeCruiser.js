// SiegeCruiser.js - Mid-size gunship. Bought in the Market, listed under Combat Ships in the hangar.
// Load in Index.html BEFORE MainGameController.js.
// Art: siege_cruiser.png (registered in ShipArt.js as 'Siege Cruiser').
//
// Modules (all start at level 1, max level comes from getCap() like every other ship):
//   guns            +2.5% gun damage per level
//   shield          +5% max shield per level
//   resistance      15% damage reduction + 2% per level, capped at 60%
//   shieldRecharge  passive in-combat shield recharge. Starts at 30% of the out-of-combat
//                   recharge rate, +5 points per level (capped at 100% of out-of-combat).
(function () {
  const SHIP_NAME = 'Siege Cruiser';

  // ----- Tuning -----
  const STATS = {
    maxSpeed: 3.2,
    maxShield: 1200,
    maxArmor: 800,
    maxStructure: 600,
    maxCargo: 500
  };

  const CFG = {
    damage: 30,        // damage per hit at gun level 1
    cooldown: 60,      // frames between shots per gun (1 per second)
    hitChance: 0.8,
    range: 900,
    turnRate: 0.08,    // radians per frame a gun can rotate
    fireArc: 0.15,     // gun must be this close to aimed before firing
    shotFrames: 14     // visual flight time of a shot
  };

  const UPGRADE = {
    guns: 0.025,       // +2.5% gun damage per level
    shield: 0.05       // +5% max shield per level
  };

  const RESIST_BASE = 0.15;
  const RESIST_STEP = 0.02;
  const RESIST_CAP = 0.6;

  const RECHARGE_START = 0.30; // in-combat recharge as a fraction of out-of-combat recharge at level 1
  const RECHARGE_STEP = 0.05;  // +5 points per level
  const RECHARGE_CAP = 1.0;

  // Engine plumes. Positions are fractions of the drawn hull size.
  // Make flames bigger: raise minLen / extraLen / width. Move them: edit rear and nozzles[].f
  const ENGINE = {
    rear: 0.46,        // how far back from centre the nozzles sit (fraction of hull length)
    nozzles: [         // f = sideways position (fraction of hull width), s = size multiplier
      { f: -0.22, s: 1.0 },
      { f: 0.0, s: 0.8 },
      { f: 0.22, s: 1.0 }
    ],
    minLen: 0.06,      // plume length (fraction of hull length) at the first hint of thrust
    extraLen: 0.55,    // extra length at full speed
    width: 0.10,       // plume width (fraction of hull width)
    speedGain: 1.25,   // reaches full flames at 80% of max speed
    rampUp: 0.18,      // how fast flames ignite (0..1 per frame)
    rampDown: 0.12     // how fast flames die when the ship stops
  };

  // Gun mounts [forward, side] relative to the hull centre (nose is +forward). 6 guns total.
  const MOUNTS = [
    [40, -14], [40, 14],
    [0, -16], [0, 16],
    [-40, -14], [-40, 14]
  ];

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  class SiegeCruiserShip {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.angle = 0;
      this.accel = 0.1;
      this.friction = 0.95;
      this.docked = false;
      this.className = SHIP_NAME;
      this.type = 'ship';

      this.cargo = 0;
      this.maxCargo = STATS.maxCargo;
      this.maxSpeed = STATS.maxSpeed;
      this.maxShield = STATS.maxShield;
      this.shield = STATS.maxShield;
      this.maxArmor = STATS.maxArmor;
      this.armor = STATS.maxArmor;
      this.maxStructure = STATS.maxStructure;
      this.structure = STATS.maxStructure;

      this.moduleLevels = { guns: 1, shield: 1, resistance: 1, shieldRecharge: 1 };
      this.resist = RESIST_BASE;

      this.currentTarget = null;
      this.guns = MOUNTS.map((m, i) => ({
        fwd: m[0], side: m[1], angle: 0, cooldown: i * 10, flash: 0, ready: false
      }));
      this.shots = [];
      this.thrust = 0;      // 0..1, drives the engine plumes
      this.exhaust = [];    // world-space exhaust particles
      this.frame = 0;
      this.applyStats();
    }

    level(key) {
      const v = this.moduleLevels ? Number(this.moduleLevels[key]) : 1;
      return v >= 1 ? v : 1;
    }

    applyStats() {
      this.maxSpeed = STATS.maxSpeed;
      this.maxShield = STATS.maxShield * (1 + UPGRADE.shield * (this.level('shield') - 1));
      this.maxArmor = STATS.maxArmor;
      this.maxStructure = STATS.maxStructure;
      this.maxCargo = STATS.maxCargo;
      this.resist = Math.min(RESIST_CAP, RESIST_BASE + RESIST_STEP * (this.level('resistance') - 1));
      this.shield = Math.min(this.shield, this.maxShield);
      this.armor = Math.min(this.armor, this.maxArmor);
      this.structure = Math.min(this.structure, this.maxStructure);
    }

    gunDamage() {
      return CFG.damage * (1 + UPGRADE.guns * (this.level('guns') - 1));
    }

    // Used by ShieldRegen.js: fraction of the out-of-combat recharge rate applied while in combat.
    combatRegenFactor() {
      const f = RECHARGE_START + RECHARGE_STEP * (this.level('shieldRecharge') - 1);
      return Math.min(RECHARGE_CAP, f);
    }

    upgradeModule(modKey) {
      if (this.moduleLevels[modKey] < window.getCap(modKey, this.className)) {
        this.moduleLevels[modKey]++;
        this.applyStats();
      }
    }

    // Shield, then armor, then structure. Resistance applies to every hit.
    takeDamage(raw) {
      let remaining = raw * (1 - this.resist);
      if (this.shield > 0) {
        const a = Math.min(this.shield, remaining);
        this.shield -= a;
        remaining -= a;
      }
      if (remaining > 0 && this.armor > 0) {
        const a = Math.min(this.armor, remaining);
        this.armor -= a;
        remaining -= a;
      }
      if (remaining > 0) this.structure = Math.max(0, this.structure - remaining);
    }

    pickTarget(enemies) {
      const range = CFG.range;
      // Keep the current target while it is alive and still roughly in range
      const cur = this.currentTarget;
      if (cur && cur.structure > 0 && Math.hypot(cur.x - this.x, cur.y - this.y) <= range * 1.15) return cur;

      let best = null, bestD = range;
      for (const e of enemies) {
        const ent = e && (e.ship || e);
        if (!ent || ent.structure <= 0 || e.isAlive === false) continue;
        const d = Math.hypot(ent.x - this.x, ent.y - this.y);
        if (d <= bestD) { bestD = d; best = ent; }
      }
      // The station boss is the last target: only when nothing else is in range.
      // NPC pirates never shoot it (it is their own base).
      const boss = window.centralStationBoss;
      if (!best && typeof mapManager !== 'undefined' && mapManager.currentMapId === 'public_space' && boss && boss.structure > 0 && !this.ignoreStationBoss && !this.isPirate) {
        if (Math.hypot(boss.x - this.x, boss.y - this.y) <= range) best = boss;
      }
      return best;
    }

    mountPos(g) {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      return { x: this.x + g.fwd * c - g.side * s, y: this.y + g.fwd * s + g.side * c };
    }

    fire(g, target, pos) {
      const hit = Math.random() < CFG.hitChance;
      if (hit) {
        const dmg = this.gunDamage();
        if (typeof target.takeDamage === 'function') target.takeDamage(dmg);
        else target.structure = Math.max(0, target.structure - dmg);
      }
      g.cooldown = CFG.cooldown;
      g.flash = 4;
      const ex = hit ? target.x : target.x + (Math.random() - 0.5) * 100;
      const ey = hit ? target.y : target.y + (Math.random() - 0.5) * 100;
      this.shots.push({ x1: pos.x, y1: pos.y, x2: ex, y2: ey, t: 0, miss: !hit });
    }

    update(targetPos, targetEnemy, autoTargetStation, availableEnemies) {
      if (this.docked) {
        this.currentTarget = null;
        this.shots.length = 0;
        return;
      }

      // ---- movement: go where the player taps, turn slowly like a cruiser ----
      let destX = null, destY = null, thrustTarget = 0;
      if (autoTargetStation) {
        destX = autoTargetStation.x; destY = autoTargetStation.y;
      } else if (targetPos) {
        const dx = targetPos.x - this.x, dy = targetPos.y - this.y;
        if (Math.hypot(dx, dy) > 25) { destX = targetPos.x; destY = targetPos.y; }
        else { this.vx *= 0.8; this.vy *= 0.8; }
      }

      if (destX !== null) {
        const dx = destX - this.x, dy = destY - this.y;
        if (Math.hypot(dx, dy) > 5) {
          const diff = angleDiff(Math.atan2(dy, dx), this.angle);
          const maxTurn = 0.045;
          this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff * 0.5));
          const facing = Math.max(0, Math.cos(diff));
          thrustTarget = facing;
          this.vx += Math.cos(this.angle) * this.accel * facing;
          this.vy += Math.sin(this.angle) * this.accel * facing;
        }
      }

      const speed = Math.hypot(this.vx, this.vy);
      if (speed > this.maxSpeed) {
        this.vx = (this.vx / speed) * this.maxSpeed;
        this.vy = (this.vy / speed) * this.maxSpeed;
      }
      this.vx *= this.friction;
      this.vy *= this.friction;
      this.x += this.vx;
      this.y += this.vy;

      // ---- guns ----
      const enemies = availableEnemies ||
        ((typeof publicNpcManager !== 'undefined' && publicNpcManager && publicNpcManager.publicNpcMiners) || []);
      const target = this.weaponsEnabled === false ? null : (targetEnemy || this.pickTarget(enemies));
      this.currentTarget = target || null;

      const heading = this.angle || 0;
      for (const g of this.guns) {
        if (g.cooldown > 0) g.cooldown--;
        if (g.flash > 0) g.flash--;
        const pos = this.mountPos(g);
        if (!g.ready) { g.angle = heading; g.ready = true; }

        let want = heading;
        if (target) want = Math.atan2(target.y - pos.y, target.x - pos.x);
        g.angle += Math.max(-CFG.turnRate, Math.min(CFG.turnRate, angleDiff(want, g.angle)));

        if (target && g.cooldown <= 0 && Math.abs(angleDiff(want, g.angle)) < CFG.fireArc) {
          if (Math.hypot(target.x - pos.x, target.y - pos.y) <= CFG.range) this.fire(g, target, pos);
        }
      }

      for (let i = this.shots.length - 1; i >= 0; i--) {
        this.shots[i].t++;
        if (this.shots[i].t >= CFG.shotFrames) this.shots.splice(i, 1);
      }
    }

    // Drawn hull size [across, along] in game units
    dims() {
      const d = window.ShipArt && window.ShipArt.size && window.ShipArt.size(this.className);
      return d || [60, 160];
    }

    // World position of each engine nozzle
    nozzles() {
      const d = this.dims();
      const w = d[0], h = d[1];
      const rear = -h * ENGINE.rear;
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      return ENGINE.nozzles.map(function (n) {
        const side = n.f * w;
        return { x: rear, y: side, s: n.s };
      }).map((n) => ({
        wx: this.x + n.x * cos - n.y * sin,
        wy: this.y + n.x * sin + n.y * cos,
        lx: n.x, ly: n.y, s: n.s
      }));
    }

    updateExhaust() {
      for (let i = this.exhaust.length - 1; i >= 0; i--) {
        const p = this.exhaust[i];
        p.t++; p.x += p.vx; p.y += p.vy;
        if (p.t >= p.life) this.exhaust.splice(i, 1);
      }
      if (this.thrust > 0.12 && !this.docked) {
        const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
        for (const n of this.nozzles()) {
          const sp = 1.2 + Math.random() * 1.6;
          this.exhaust.push({
            x: n.wx, y: n.wy,
            vx: -cos * sp + this.vx * 0.3 + (Math.random() - 0.5) * 0.5,
            vy: -sin * sp + this.vy * 0.3 + (Math.random() - 0.5) * 0.5,
            t: 0, life: 22 + Math.random() * 14, size: n.s
          });
        }
        if (this.exhaust.length > 160) this.exhaust.splice(0, this.exhaust.length - 160);
      }
    }

    drawEngines(c) {
      // Runs every frame (update() is skipped while the ship is idle), so flames follow real speed:
      // full speed = full flames, stopped = flames fade out.
      this.frame++;
      const speedFrac = Math.min(1, Math.hypot(this.vx, this.vy) / (this.maxSpeed || 1) * ENGINE.speedGain);
      const rate = speedFrac > this.thrust ? ENGINE.rampUp : ENGINE.rampDown;
      this.thrust += (speedFrac - this.thrust) * rate;
      if (this.thrust < 0.01) this.thrust = 0;
      this.updateExhaust();

      const d = this.dims();
      const w = d[0], h = d[1];
      const power = this.thrust;
      const flick = 0.9 + 0.1 * Math.sin(this.frame * 0.9) + Math.random() * 0.1;

      c.save();
      c.globalCompositeOperation = 'lighter';

      // Exhaust trail (world space)
      for (const p of this.exhaust) {
        const k = 1 - p.t / p.life;
        c.fillStyle = 'rgba(' + (k > 0.5 ? '125,211,252' : '251,146,60') + ',' + (0.5 * k) + ')';
        c.beginPath();
        c.arc(p.x, p.y, (w * 0.05 + p.t * 0.35) * p.size, 0, Math.PI * 2);
        c.fill();
      }

      // Plumes (ship space, nose is +x, flames point to -x)
      c.translate(this.x, this.y);
      c.rotate(this.angle);
      for (const n of (power > 0.04 ? ENGINE.nozzles : [])) {
        const ny = n.f * w;
        const rx = -h * ENGINE.rear;
        const len = h * (ENGINE.minLen + ENGINE.extraLen * power) * flick * n.s;
        const wid = w * ENGINE.width * (0.7 + 0.3 * power) * n.s;

        const g = c.createLinearGradient(rx, ny, rx - len, ny);
        g.addColorStop(0, 'rgba(255,255,255,0.98)');
        g.addColorStop(0.2, 'rgba(186,230,253,0.95)');
        g.addColorStop(0.55, 'rgba(251,146,60,0.75)');
        g.addColorStop(1, 'rgba(249,115,22,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(rx + wid * 0.6, ny - wid);
        c.lineTo(rx - len, ny);
        c.lineTo(rx + wid * 0.6, ny + wid);
        c.closePath();
        c.fill();

        const r = wid * 2.6;
        const glow = c.createRadialGradient(rx, ny, 0, rx, ny, r);
        glow.addColorStop(0, 'rgba(186,230,253,' + (0.6 * power) + ')');
        glow.addColorStop(1, 'rgba(56,189,248,0)');
        c.fillStyle = glow;
        c.beginPath();
        c.arc(rx, ny, r, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    draw(c) {
      if (this.docked) { this.thrust = 0; this.exhaust.length = 0; return; }
      this.drawEngines(c);

      const drawn = window.ShipArt && window.ShipArt.draw(c, this.className, this.x, this.y, this.angle);
      if (!drawn) {
        // Fallback hull if the art is not registered
        c.save();
        c.translate(this.x, this.y);
        c.rotate(this.angle);
        c.fillStyle = '#334155';
        c.strokeStyle = '#58a6ff';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(70, 0); c.lineTo(-60, -28); c.lineTo(-45, 0); c.lineTo(-60, 28);
        c.closePath();
        c.fill(); c.stroke();
        c.restore();
      }

      const zoom = (typeof cameraZoom !== 'undefined') ? cameraZoom : 1;
      const lw = 1 / zoom;
      c.save();
      c.lineCap = 'round';
      c.globalCompositeOperation = 'lighter';

      // Muzzle flashes
      for (const g of this.guns) {
        if (g.flash <= 0) continue;
        const pos = this.mountPos(g);
        const k = g.flash / 4;
        c.strokeStyle = 'rgba(254,243,199,' + k + ')';
        c.lineWidth = 2 * lw;
        c.beginPath();
        c.moveTo(pos.x, pos.y);
        c.lineTo(pos.x + Math.cos(g.angle) * 20, pos.y + Math.sin(g.angle) * 20);
        c.stroke();
        c.fillStyle = 'rgba(253,186,116,' + (0.8 * k) + ')';
        c.beginPath();
        c.arc(pos.x, pos.y, 8 + (1 - k) * 8, 0, Math.PI * 2);
        c.fill();
      }

      // Tracer rounds
      for (const s of this.shots) {
        const k = Math.min(1, s.t / CFG.shotFrames);
        const hx = s.x1 + (s.x2 - s.x1) * k;
        const hy = s.y1 + (s.y2 - s.y1) * k;
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const tx = hx - Math.cos(ang) * 42;
        const ty = hy - Math.sin(ang) * 42;
        const rgb = s.miss ? '148,163,184' : '253,230,138';
        const trail = c.createLinearGradient(tx, ty, hx, hy);
        trail.addColorStop(0, 'rgba(' + rgb + ',0)');
        trail.addColorStop(1, 'rgba(' + rgb + ',1)');
        c.strokeStyle = trail;
        c.lineWidth = 3 * lw;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(hx, hy);
        c.stroke();
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(hx, hy, 2 * lw, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
  }

  window.SiegeCruiserShip = SiegeCruiserShip;
  window.SiegeCruiser = { STATS: STATS, CFG: CFG, UPGRADE: UPGRADE };

  // ----- Self-install (no edits to ShipArt.js or SessionManager.js needed) -----

  // Artwork. If the ship looks too big or small in game, change ART_SCALE.
  const ART_SCALE = 0.15;
  if (window.ShipArt && window.ShipArt.ART) {
    window.ShipArt.ART[SHIP_NAME] = { file: 'siege_cruiser.png', scale: ART_SCALE, size: [60, 160] };
  }

  // Teach SessionManager to build this ship (boarding, loading a save)
  if (typeof SessionManager === 'function' && !SessionManager.prototype._siegeCruiserPatched) {
    const origSetShipClass = SessionManager.prototype.setShipClass;
    SessionManager.prototype.setShipClass = function (playerShip, className, cargoCap, maxSpeed) {
      const clean = String(className || '').trim();
      if (clean.toLowerCase() !== SHIP_NAME.toLowerCase()) {
        return origSetShipClass.call(this, playerShip, className, cargoCap, maxSpeed);
      }
      if (!playerShip) return playerShip;

      const mods = playerShip.moduleLevels ? Object.assign({}, playerShip.moduleLevels) : null;
      const s = new SiegeCruiserShip(playerShip.x, playerShip.y);
      if (mods) {
        for (const m in s.moduleLevels) {
          if (mods[m] !== undefined) s.moduleLevels[m] = mods[m];
        }
      }
      s.vx = playerShip.vx;
      s.vy = playerShip.vy;
      s.angle = playerShip.angle;
      s.docked = playerShip.docked;
      s.className = SHIP_NAME;
      s.maxCargo = cargoCap;
      s.applyStats();
      return s;
    };
    SessionManager.prototype._siegeCruiserPatched = true;
  }
})();
