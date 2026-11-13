// SiegeBattleship.js - Siege Battleship. 8k shield / 8k armor / 5k structure. Massive capital class.
// Auto-fire only: it locks and shoots anything in range, but never steers itself toward a target or station.
// It only moves when it is given a move point (the player's tap-to-move, or an NPC manager's orbit code).
(function () {
  const SHIP_NAME = 'Siege Battleship';

  const STATS = {
    maxSpeed: 3.2,
    maxShield: 6000,
    maxArmor: 5000,
    maxStructure: 5000,
    maxCargo: 1000
  };

  const ACCEL = 0.1;
  const FRICTION = 0.95;
  const TURN_RATE = 0.045;

  const RANGE = 800;
  const VOLLEY = {
    interval: 30,       // Faster fire rate (down from 60)
    dpsTotal: 800,      // Buffed damage to punch through capital shields
    missiles: 10,       // Clustered burst
    stagger: 0.1,
    speedStart: 8.0,    // Snappier initial launch speed
    speedMax: 16.0,     // Instant travel to target
    turnRate: 0.35,     // Better tracking
    life: 180
  };
  const BASE_VOLLEY_DAMAGE = (VOLLEY.dpsTotal * (VOLLEY.interval / 60)) / VOLLEY.missiles;

  const LAUNCHERS = [
    { along: -0.15, across: -0.28, side: -1 },
    { along: -0.15, across: 0.28, side: 1 }
  ];
  const TUBE_OFFSETS = [-0.08, -0.04, 0, 0.04, 0.08];

  // Dual rear engine nozzles
  const NOZZLES = [
    { along: -0.32, across: 0.12, size: 1.4, big: true },
    { along: -0.32, across: -0.12, size: 1.4, big: true }
  ];

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Capture ships, enemies, and stations/bases
  function resolveEnemies(list, owner) {
    const pool = [];

    if (Array.isArray(list)) {
      pool.push(...list.map(e => entityOf(e)));
    }

    // NPC pirates only fight what they are handed (the player), never other NPCs or stations
    if (owner && owner.isPirate) return pool.filter(Boolean);

    if (typeof window !== 'undefined') {
      if (Array.isArray(window.ships)) pool.push(...window.ships);
      if (window.game && Array.isArray(window.game.ships)) pool.push(...window.game.ships);
      if (window.centralStationBoss && typeof mapManager !== 'undefined' && mapManager.currentMapId === 'public_space') pool.push(window.centralStationBoss);
      if (Array.isArray(window.stations)) pool.push(...window.stations);
      if (window.game && Array.isArray(window.game.stations)) pool.push(...window.game.stations);
      if (window.stationManager && Array.isArray(window.stationManager.stations)) {
        pool.push(...window.stationManager.stations);
      }
    }

    if (typeof inPublicSpace === 'function' && inPublicSpace() &&
        typeof publicNpcManager !== 'undefined' && publicNpcManager) {
      if (Array.isArray(publicNpcManager.publicNpcMiners)) {
        pool.push(...publicNpcManager.publicNpcMiners.map(n => n.ship || n));
      }
      if (Array.isArray(publicNpcManager.enemies)) {
        pool.push(...publicNpcManager.enemies.map(n => n.ship || n));
      }
    }

    return pool.filter(Boolean);
  }

  function entityOf(e) {
    return e && (e.ship || e);
  }

  function isLive(ent) {
    return !!ent && (ent.structure > 0 || ent.hp > 0) && ent.isAlive !== false;
  }

  function artEntry(name) {
    return window.ShipArt && window.ShipArt.ART && window.ShipArt.ART[name];
  }

  function hullSize(name) {
    const e = artEntry(name);
    return (e && e.size) || [300, 560];
  }

  function localToWorld(x, y, angle, lx, ly) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: x + lx * c - ly * s, y: y + lx * s + ly * c };
  }

  function applyDamage(target, dmg) {
    if (typeof target.takeDamage === 'function') target.takeDamage(dmg);
    else if (typeof target.hp === 'number') target.hp = Math.max(0, target.hp - dmg);
    else target.structure = Math.max(0, (target.structure || target.hp || 1000) - dmg);
  }

  class Blast {
    constructor(x, y, size) {
      this.x = x; this.y = y; this.size = size; this.t = 0; this.life = 40;
      this.sparks = [];
      for (let i = 0; i < 18; i++) {
        this.sparks.push({
          a: Math.random() * Math.PI * 2,
          sp: 2 + Math.random() * 6,
          r: 1 + Math.random() * 2
        });
      }
    }
    update() {
      this.t++;
      return this.t < this.life;
    }
    draw(c) {
      const k = this.t / this.life;
      const r = this.size * (0.3 + k * 1.4);
      const alpha = 1 - k;

      c.save();
      c.globalCompositeOperation = 'lighter';

      const g = c.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
      g.addColorStop(0, `rgba(255,255,240,${1.0 * alpha})`);
      g.addColorStop(0.3, `rgba(56,189,248,${0.8 * alpha})`);
      g.addColorStop(0.65, `rgba(251,146,60,${0.6 * alpha})`);
      g.addColorStop(1, 'rgba(180,30,0,0)');

      c.fillStyle = g;
      c.beginPath(); c.arc(this.x, this.y, r, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  class SiegeBattleshipMissile {
    constructor(x, y, heading, owner) {
      this.x = x; this.y = y; this.angle = heading;
      this.speed = VOLLEY.speedStart;
      this.vx = Math.cos(heading) * this.speed;
      this.vy = Math.sin(heading) * this.speed;
      this.owner = owner;
      const missileLevel = owner.moduleLevels ? (owner.moduleLevels.missiles || 1) : 1;
      this.damage = BASE_VOLLEY_DAMAGE * (1 + 0.10 * (missileLevel - 1)) * (owner._fittedDamageMultiplier || 1) * (owner.npcDamageScale || 1);
      this.age = 0; this.life = VOLLEY.life;
      this.trail = [];
      this.smokePuffs = [];
      this.alive = true;
    }
    update() {
      this.age++;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 45) this.trail.shift();

      if (this.age % 2 === 0) {
        this.smokePuffs.push({
          x: this.x,
          y: this.y,
          r: 3 + Math.random() * 4,
          alpha: 0.45,
          life: 45
        });
      }

      for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
        const sp = this.smokePuffs[i];
        sp.life--;
        sp.r += 0.25;
        sp.alpha *= 0.94;
        if (sp.life <= 0) this.smokePuffs.splice(i, 1);
      }

      const t = this.owner.getTarget();
      if (t) {
        const desired = Math.atan2(t.y - this.y, t.x - this.x);
        const rate = this.age < 10 ? 0.03 : VOLLEY.turnRate;
        this.angle += Math.max(-rate, Math.min(rate, angleDiff(desired, this.angle)));
      }
      this.speed = Math.min(VOLLEY.speedMax, this.speed + 0.35);
      this.vx = Math.cos(this.angle) * this.speed;
      this.vy = Math.sin(this.angle) * this.speed;
      this.x += this.vx; this.y += this.vy;

      if (t && Math.hypot(t.x - this.x, t.y - this.y) < 140) {
        applyDamage(t, this.damage);
        this.alive = false;
        this.owner.blasts.push(new Blast(this.x, this.y, 45));
        return;
      }
      if (--this.life <= 0) this.alive = false;
    }
    draw(c) {
      for (const sp of this.smokePuffs) {
        c.save();
        c.fillStyle = `rgba(180, 185, 195, ${sp.alpha})`;
        c.beginPath(); c.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const k = i / this.trail.length;
        c.save();
        c.globalCompositeOperation = 'lighter';

        c.fillStyle = `rgba(251,146,60,${0.4 * k})`;
        c.beginPath(); c.arc(p.x, p.y, 2.5 + 4.5 * k, 0, Math.PI * 2); c.fill();

        c.fillStyle = `rgba(56,189,248,${0.85 * k})`;
        c.beginPath(); c.arc(p.x, p.y, 1 + 2 * k, 0, Math.PI * 2); c.fill();

        c.restore();
      }
    }
  }

  class SiegeBattleshipShip {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0; this.angle = 0;
      this.accel = ACCEL; this.friction = FRICTION;
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
      this.moduleLevels = { missiles: 1, shield: 1, propulsion: 1 };
      this.frame = 0; this.thrust = 0; this.launchFlare = 0;
      this.cooldown = 0; this.lockTarget = null;
      this.lastEnemies = []; this.pendingLaunches = [];
      this.missiles = []; this.blasts = [];
      this.exhaustParticles = [];
      this.exhaustSmoke = [];
      this.applyStats();
    }

    applyStats() {
      const shieldLvl = (this.moduleLevels && this.moduleLevels.shield) || 1;
      const propLvl = (this.moduleLevels && this.moduleLevels.propulsion) || 1;

      this.maxSpeed = STATS.maxSpeed * (1 + 0.10 * (propLvl - 1));
      const oldMaxShield = this.maxShield;
      this.maxShield = STATS.maxShield * (1 + 0.05 * (shieldLvl - 1));
      if (this.shield >= oldMaxShield) {
        this.shield = this.maxShield;
      } else {
        this.shield = Math.min(this.maxShield, this.shield);
      }
      this.shieldRegenRate = 2.0 * (1 + 0.05 * (shieldLvl - 1));

      this.maxArmor = STATS.maxArmor;
      this.maxStructure = STATS.maxStructure;
      this.maxCargo = STATS.maxCargo;
      this.armor = Math.min(this.armor, this.maxArmor);
      this.structure = Math.min(this.structure, this.maxStructure);
    }

    upgradeModule(modKey) {
      if (this.moduleLevels[modKey] < window.getCap(modKey, this.className)) {
        this.moduleLevels[modKey]++;
        this.applyStats();
      }
    }

    takeDamage(raw) {
      let remaining = raw;
      if (this.shield > 0) {
        const a = Math.min(this.shield, remaining);
        this.shield -= a; remaining -= a;
      }
      if (remaining > 0 && this.armor > 0) {
        const a = Math.min(this.armor, remaining);
        this.armor -= a; remaining -= a;
      }
      if (remaining > 0) this.structure = Math.max(0, this.structure - remaining);
    }

    getTarget() {
      const cur = this.lockTarget;
      if (cur && isLive(cur) && dist(cur, this) <= RANGE) return cur;

      const pool = [];
      for (const e of this.lastEnemies) {
        const ent = entityOf(e);
        if (isLive(ent) && ent !== this && dist(ent, this) <= RANGE) {
          pool.push(ent);
        }
      }

      pool.sort((a, b) => dist(a, this) - dist(b, this));

      this.lockTarget = pool[0] || null;
      return this.lockTarget;
    }

    fireVolley() {
      let n = 0;
      for (const L of LAUNCHERS) {
        for (const off of TUBE_OFFSETS) {
          this.pendingLaunches.push({ at: this.frame + n * VOLLEY.stagger, L, off });
          n++;
        }
      }
    }

    launchMissile(L, off) {
      const [w, h] = hullSize(this.className);
      const pos = localToWorld(this.x, this.y, this.angle, L.along * h, (L.across + off) * w);
      const heading = this.angle + L.side * 0.35;
      this.missiles.push(new SiegeBattleshipMissile(pos.x, pos.y, heading, this));
      this.blasts.push(new Blast(pos.x, pos.y, 12));
      this.launchFlare = 1;
    }

    update(targetPos, targetEnemy, autoTargetStation, availableEnemies) {
      this.frame++;
      if (this.docked) {
        this.lockTarget = null;
        this.missiles.length = 0;
        this.pendingLaunches.length = 0;
        this.thrust = 0;
        return;
      }

      if (!this.docked && this.shield < this.maxShield) {
        this.shield = Math.min(this.maxShield, this.shield + (this.shieldRegenRate || 2.0));
      }

      let destX = null, destY = null;
      if (targetPos) {
        const dx = targetPos.x - this.x, dy = targetPos.y - this.y;
        if (Math.hypot(dx, dy) > 25) { destX = targetPos.x; destY = targetPos.y; }
        else { this.vx *= 0.8; this.vy *= 0.8; }
      }

      if (destX !== null && destY !== null) {
        const dx = destX - this.x, dy = destY - this.y;
        if (Math.hypot(dx, dy) > 5) {
          const targetAngle = Math.atan2(dy, dx);
          const diff = angleDiff(targetAngle, this.angle);
          this.angle += Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
          const facing = Math.max(0, Math.cos(diff));
          this.thrust = facing;
          this.vx += Math.cos(this.angle) * this.accel * facing;
          this.vy += Math.sin(this.angle) * this.accel * facing;
        }
      } else {
        this.thrust *= 0.9;
      }

      const speed = Math.hypot(this.vx, this.vy);
      const burn = Math.max(this.thrust, Math.min(1, speed / this.maxSpeed));

      if (burn > 0.1 && this.frame % 2 === 0) {
        const [w, h] = hullSize(this.className);
        for (const nz of NOZZLES) {
          const worldPos = localToWorld(this.x, this.y, this.angle, nz.along * h, nz.across * w);
          const ejectAngle = this.angle + Math.PI + (Math.random() - 0.5) * 0.3;

          this.exhaustParticles.push({
            x: worldPos.x,
            y: worldPos.y,
            vx: Math.cos(ejectAngle) * (4 + Math.random() * 5) + this.vx * 0.5,
            vy: Math.sin(ejectAngle) * (4 + Math.random() * 5) + this.vy * 0.5,
            r: 1 + Math.random() * 2,
            alpha: 0.9,
            life: 20 + Math.random() * 15
          });

          if (this.frame % 4 === 0) {
            this.exhaustSmoke.push({
              x: worldPos.x,
              y: worldPos.y,
              vx: Math.cos(ejectAngle) * 1.5 + (Math.random() - 0.5) * 0.5,
              vy: Math.sin(ejectAngle) * 1.5 + (Math.random() - 0.5) * 0.5,
              r: 4 + Math.random() * 4,
              alpha: 0.35,
              life: 35
            });
          }
        }
      }

      for (let i = this.exhaustParticles.length - 1; i >= 0; i--) {
        const p = this.exhaustParticles[i];
        p.x += p.vx; p.y += p.vy;
        p.life--;
        p.alpha *= 0.92;
        if (p.life <= 0) this.exhaustParticles.splice(i, 1);
      }

      for (let i = this.exhaustSmoke.length - 1; i >= 0; i--) {
        const s = this.exhaustSmoke[i];
        s.x += s.vx; s.y += s.vy;
        s.r += 0.3;
        s.life--;
        s.alpha *= 0.93;
        if (s.life <= 0) this.exhaustSmoke.splice(i, 1);
      }

      if (speed > this.maxSpeed) {
        this.vx = (this.vx / speed) * this.maxSpeed;
        this.vy = (this.vy / speed) * this.maxSpeed;
      }
      this.vx *= this.friction;
      this.vy *= this.friction;
      this.x += this.vx; this.y += this.vy;

      this.lastEnemies = resolveEnemies(availableEnemies, this);

      const target = this.weaponsEnabled === false ? null : this.getTarget();

      if (this.cooldown > 0) {
        this.cooldown--;
      } else if (target && dist(target, this) <= RANGE) {
        this.fireVolley();
        this.cooldown = VOLLEY.interval;
      }

      if (this.weaponsEnabled === false) this.pendingLaunches.length = 0;
      if (this.pendingLaunches.length > 0) {
        const next = [];
        for (const l of this.pendingLaunches) {
          if (this.frame >= l.at) this.launchMissile(l.L, l.off);
          else next.push(l);
        }
        this.pendingLaunches = next;
      }

      for (let i = this.missiles.length - 1; i >= 0; i--) {
        this.missiles[i].update();
        if (!this.missiles[i].alive) this.missiles.splice(i, 1);
      }
      for (let i = this.blasts.length - 1; i >= 0; i--) {
        if (!this.blasts[i].update()) this.blasts.splice(i, 1);
      }
      if (this.launchFlare > 0) this.launchFlare = Math.max(0, this.launchFlare - 0.1);
    }

    draw(c) {
      for (const s of this.exhaustSmoke) {
        c.save();
        c.fillStyle = `rgba(160, 165, 175, ${s.alpha})`;
        c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      for (const p of this.exhaustParticles) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = `rgba(255, 220, 100, ${p.alpha})`;
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      if (window.ShipArt && window.ShipArt.draw(c, this.className, this.x, this.y, this.angle)) {
        // Drawn via ShipArt
      }

      c.save();
      c.translate(this.x, this.y);
      c.rotate(this.angle);

      const speed = Math.hypot(this.vx, this.vy);
      const burn = Math.max(this.thrust, Math.min(1, speed / this.maxSpeed));
      if (burn > 0.05 || this.launchFlare > 0) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (const nz of NOZZLES) {
          const [w, h] = hullSize(this.className);
          const nx = nz.along * h;
          const ny = nz.across * w;
          const intensity = burn * 0.85 + (this.launchFlare || 0) * 0.25;
          const len = (nz.big ? 110 : 55) * intensity * (0.9 + Math.random() * 0.35);
          const r = (nz.big ? 12 : 6);

          const grad = c.createLinearGradient(nx, ny, nx - len, ny);
          grad.addColorStop(0, 'rgba(255,255,255,0.95)');
          grad.addColorStop(0.2, 'rgba(56,189,248,0.9)');
          grad.addColorStop(0.6, 'rgba(251,146,60,0.7)');
          grad.addColorStop(1, 'rgba(251,146,60,0)');

          c.fillStyle = grad;
          c.beginPath();
          c.moveTo(nx, ny - r);
          c.lineTo(nx - len, ny);
          c.lineTo(nx, ny + r);
          c.closePath();
          c.fill();

          if (Math.random() < 0.6) {
            c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(nx, ny);
            c.lineTo(nx - len * 0.3, ny + (Math.random() - 0.5) * r);
            c.lineTo(nx - len * 0.7, ny + (Math.random() - 0.5) * r * 1.5);
            c.lineTo(nx - len, ny);
            c.stroke();
          }
        }
        c.restore();
      }

      c.restore();

      for (const m of this.missiles) m.draw(c);
      for (const b of this.blasts) b.draw(c);
    }
  }

  if (typeof SessionManager === 'function' && !SessionManager.prototype._siegeBattleshipPatched) {
    const origSetShipClass = SessionManager.prototype.setShipClass;
    SessionManager.prototype.setShipClass = function (playerShip, className, cargoCap, maxSpeed) {
      if (className === SHIP_NAME) {
        const s = new SiegeBattleshipShip(playerShip ? playerShip.x : 0, playerShip ? playerShip.y : 0);
        s.className = SHIP_NAME;
        s.maxCargo = cargoCap;
        s.maxSpeed = maxSpeed;
        s.applyStats();
        return s;
      }
      return origSetShipClass ? origSetShipClass.call(this, playerShip, className, cargoCap, maxSpeed) : playerShip;
    };
    SessionManager.prototype._siegeBattleshipPatched = true;
  }

  window.SiegeBattleship = SiegeBattleshipShip;
  window.SiegeBattleshipShip = SiegeBattleshipShip;
})();
