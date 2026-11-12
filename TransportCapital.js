// TransportCapital.js - Transport Capital Logistics Vessel (Fixed Thruster Alignment & Flight)
(function () {
  const SHIP_NAME = 'Transport Capital';

  const STATS = {
    baseMaxSpeed: 3.2,
    maxShield: 5000,
    maxArmor: 4000,
    maxStructure: 3000,
    baseMaxCargo: 50000
  };

  const ACCEL = 0.08;
  const FRICTION = 0.94;
  const TURN_RATE = 0.035;

  // Same thruster layout as the player's Transport Capital (defined in Capital.js),
  // so the corp Transport Manager's ship has identical engines and flames.
  const FALLBACK_THRUSTERS = [
    { back: 169, y: -21, s: 1.0 },
    { back: 169, y: 21, s: 1.0 },
    { back: 158, y: -64, s: 0.8 },
    { back: 158, y: 64, s: 0.8 }
  ];
  const EXHAUST_SCALE = 1.8;
  const MAX_PARTICLES = 400;

  // ===== SIPHON VISUAL SETTINGS =====
  // Most beams drawn at once. Extra beams still drain ore; they just aren't drawn.
  const MAX_DRAWN_BEAMS = 1;

  // ===== SIPHON SUPPORT =====
  // Transport Capital does not siphon drones. Only mothership ore is drained.
  const SHIP_SIPHON_RANGE = 1000;   // how far a miner/mothership can be and still be drained (doubled)
  const SIPHON_STANDOFF = 720;      // distance the transport parks from the miners so it never sits on top of them
  const SIPHON_MIN_GAP = 430;       // closest any ship may get to the transport before it gets nudged away

  // Transport Capital never siphons drones, so this always returns an empty list.
  function loadedDrones(m, minCargo) {
    return [];
  }
  function hasLoad(m, th) {
    if (!m) return false;
    const t = th == null ? 10 : th;
    return (m.cargo || 0) > t;
  }
  // Point the transport flies to: the mothership, if it holds ore.
  function aimPoint(m, from) {
    if (m && (m.cargo || 0) > 5) return { x: m.x, y: m.y };
    return { x: m.x, y: m.y };
  }
  // Only player-owned miners may be siphoned. Adjust this check to match how the
  // codebase marks player ships (e.g. ref.isPlayer, ref.owner === 'player').
  function isPlayerMiner(ref) {
    if (!ref) return false;
    return ref.isPlayer === true || ref.owner === 'player' || ref === window.player;
  }
  window.TransportSiphon = {
    isPlayerMiner: isPlayerMiner,
    loadedDrones: loadedDrones,
    hasLoad: hasLoad,
    aimPoint: aimPoint,
    SHIP_RANGE: SHIP_SIPHON_RANGE,
    STANDOFF: SIPHON_STANDOFF,
    MIN_GAP: SIPHON_MIN_GAP
  };

  // Intake ports on the hull (local coords: x forward, y sideways). Each beam docks at the nearest one.
  const INTAKE_PORTS = [
    { x: 175, y: 0 }, { x: 70, y: -72 }, { x: 70, y: 72 }, { x: -30, y: -78 }, { x: -30, y: 78 }
  ];
  const TAU = Math.PI * 2;

  const BEAM_STYLE = {
    ship:  { glow: '56,189,248', flare: '186,230,253' },
    drone: { glow: '45,212,191', flare: '204,251,241' }
  };

  function thrusterLayout() {
    if (typeof getCapitalThrusters === 'function') return getCapitalThrusters('Transport Capital');
    return FALLBACK_THRUSTERS;
  }

  class TransportCapitalShip {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.angle = 0;
      this.docked = false;
      this.className = SHIP_NAME;
      this.type = 'ship';

      this.cargo = 0;
      this.maxCargo = STATS.baseMaxCargo;
      this.maxSpeed = STATS.baseMaxSpeed;

      this.maxShield = STATS.maxShield;
      this.shield = STATS.maxShield;
      this.maxArmor = STATS.maxArmor;
      this.armor = STATS.maxArmor;
      this.maxStructure = STATS.maxStructure;
      this.structure = STATS.maxStructure;

      this.moduleLevels = { cargo: 1, propulsion: 1, shield: 1 };
      this.thrust = 0;
      this.particles = [];
      this.maxParticles = MAX_PARTICLES;
      this.siphonFeed = [];   // set each frame by BotManager: [{ ref, kind }]
      this._beams = [];       // visual beam state
      this._siphonLast = 0;
      this.applyStats();
    }

    applyStats() {
      const cargoLevel = (this.moduleLevels && this.moduleLevels.cargo) || 1;
      const propLevel = (this.moduleLevels && this.moduleLevels.propulsion) || 1;

      this.maxCargo = Math.floor(STATS.baseMaxCargo * Math.pow(1.1, cargoLevel - 1));
      this.maxSpeed = STATS.baseMaxSpeed * Math.pow(1.1, propLevel - 1);

      this.shield = Math.min(this.shield, this.maxShield);
      this.armor = Math.min(this.armor, this.maxArmor);
      this.structure = Math.min(this.structure, this.maxStructure);
      this.cargo = Math.min(this.cargo, this.maxCargo);
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
        this.shield -= a;
        remaining -= a;
      }
      if (remaining > 0 && this.armor > 0) {
        const a = Math.min(this.armor, remaining);
        this.armor -= a;
        remaining -= a;
      }
      if (remaining > 0) {
        this.structure = Math.max(0, this.structure - remaining);
      }
    }

    emitThrusters() {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed < 0.1 || this.docked) return;
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);

      for (const t of thrusterLayout()) {
        const px = this.x - cos * t.back + sin * t.y;
        const py = this.y - sin * t.back - cos * t.y;
        const f = t.s * EXHAUST_SCALE;

        this.particles.push({
          type: 'flame',
          x: px + (Math.random() - 0.5) * 1.8 * f,
          y: py + (Math.random() - 0.5) * 1.8 * f,
          vx: -cos * (4.0 + Math.random() * 2.5) + (Math.random() - 0.5) * 0.3,
          vy: -sin * (4.0 + Math.random() * 2.5) + (Math.random() - 0.5) * 0.3,
          size: (4.5 + Math.random() * 3.5) * f,
          alpha: 1.0,
          decay: 0.09,
          color: Math.random() > 0.3 ? '#38bdf8' : '#ffffff'
        });

        this.particles.push({
          type: 'flame',
          x: px + (Math.random() - 0.5) * 1.2 * f,
          y: py + (Math.random() - 0.5) * 1.2 * f,
          vx: -cos * (4.8 + Math.random() * 2.0) + (Math.random() - 0.5) * 0.2,
          vy: -sin * (4.8 + Math.random() * 2.0) + (Math.random() - 0.5) * 0.2,
          size: (3.0 + Math.random() * 3.0) * f,
          alpha: 0.9,
          decay: 0.11,
          color: Math.random() > 0.4 ? '#ff9e0b' : '#ff4400'
        });

        if (Math.random() < 0.5) {
          this.particles.push({
            type: 'spark',
            x: px,
            y: py,
            vx: -cos * (5.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 0.5,
            vy: -sin * (5.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 0.5,
            size: (1.2 + Math.random() * 1.5) * f,
            alpha: 1.0,
            decay: 0.08,
            color: '#ffd24d'
          });
        }

        if (Math.random() < 0.45) {
          this.particles.push({
            type: 'soot',
            x: px + (Math.random() - 0.5) * 2.5 * f,
            y: py + (Math.random() - 0.5) * 2.5 * f,
            vx: -cos * (2.2 + Math.random() * 1.0) + (Math.random() - 0.5) * 0.2,
            vy: -sin * (2.2 + Math.random() * 1.0) + (Math.random() - 0.5) * 0.2,
            size: (4.0 + Math.random() * 3.0) * f,
            grow: (0.2 + Math.random() * 0.25) * f,
            alpha: 0.35 + Math.random() * 0.2,
            decay: 0.015 + Math.random() * 0.01,
            baseColor: 'rgba(180, 190, 205,'
          });
        }
      }
    }

    updateParticles() {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.alpha -= p.decay;
        if (p.grow) p.size += p.grow;
        if (p.alpha <= 0) this.particles.splice(i, 1);
      }
      if (this.particles.length > this.maxParticles) {
        this.particles.splice(0, this.particles.length - this.maxParticles);
      }
    }

    drawParticles(c) {
      if (this.particles.length === 0) return;
      c.save();
      for (const p of this.particles) {
        const alpha = Math.max(0, p.alpha);
        if (p.type === 'soot') {
          c.globalCompositeOperation = 'source-over';
          c.fillStyle = p.baseColor + alpha.toFixed(3) + ')';
          c.beginPath();
          c.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
          c.fill();
        } else if (p.type === 'flame') {
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = p.color;
          c.globalAlpha = alpha;
          c.beginPath();
          c.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
          c.fill();
        } else if (p.type === 'spark') {
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = p.color;
          c.globalAlpha = alpha;
          c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
      c.restore();
      c.globalAlpha = 1.0;
      c.globalCompositeOperation = 'source-over';
    }

    // ---------- SIPHON EFFECT (lightweight) ----------
    _syncBeams(dt) {
      // Only player miners are drained; bot and corp miners are ignored.
      const feed = (this.siphonFeed || []).filter(function (f) { return isPlayerMiner(f.ref); });
      const beams = this._beams;
      for (const b of beams) b.want = 0;
      for (const f of feed) {
        let b = null;
        for (const q of beams) { if (q.ref === f.ref) { b = q; break; } }
        if (!b) {
          b = { ref: f.ref, kind: f.kind, strength: 0, want: 1, lx: f.ref.x, ly: f.ref.y };
          beams.push(b);
        }
        b.want = 1;
        b.kind = f.kind;
      }
      const k = Math.min(1, dt * 7);
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        b.strength += (b.want - b.strength) * k;
        if (b.ref) { b.lx = b.ref.x; b.ly = b.ref.y; }
        if (b.want === 0 && b.strength < 0.02) beams.splice(i, 1);
      }
    }

    drawSiphon(c) {
      const now = performance.now() / 1000;
      const dt = this._siphonLast ? Math.min(0.1, now - this._siphonLast) : 0.016;
      this._siphonLast = now;
      this._syncBeams(dt);
      const beams = this._beams;
      if (!beams.length) return;

      // Hull rotation, computed once for all ports
      const cs = Math.cos(this.angle), sn = Math.sin(this.angle);

      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';

      const drawn = Math.min(beams.length, MAX_DRAWN_BEAMS);
      for (let i = 0; i < drawn; i++) {
        const b = beams[i];
        const s = b.strength;
        if (s <= 0.02) continue;
        const st = BEAM_STYLE[b.kind] || BEAM_STYLE.ship;
        const sx = b.lx, sy = b.ly;

        // Nearest intake port on the hull
        let ex = this.x, ey = this.y, pd = Infinity;
        for (let p = 0; p < INTAKE_PORTS.length; p++) {
          const port = INTAKE_PORTS[p];
          const wx = this.x + cs * port.x - sn * port.y;
          const wy = this.y + sn * port.x + cs * port.y;
          const d = Math.hypot(wx - sx, wy - sy);
          if (d < pd) { pd = d; ex = wx; ey = wy; }
        }

        // Glow under-stroke
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(ex, ey);
        c.lineWidth = 6 * s;
        c.strokeStyle = 'rgba(' + st.glow + ',' + (0.18 * s).toFixed(3) + ')';
        c.stroke();

        // Flowing core: a bright dashed line that moves toward the hull
        c.setLineDash([12, 10]);
        c.lineDashOffset = -now * 60;
        c.lineWidth = 2 * s;
        c.strokeStyle = 'rgba(' + st.flare + ',' + (0.8 * s).toFixed(3) + ')';
        c.stroke();
        c.setLineDash([]);

        // Source end: a small pulsing dot where ore is being drawn from
        const srcR = (b.kind === 'drone' ? 6 : 12) * (0.9 + 0.1 * Math.sin(now * 6 + i));
        c.fillStyle = 'rgba(' + st.glow + ',' + (0.45 * s).toFixed(3) + ')';
        c.beginPath();
        c.arc(sx, sy, srcR, 0, TAU);
        c.fill();

        // Intake end: a small bright dot on the hull
        c.fillStyle = 'rgba(255,255,255,' + (0.6 * s).toFixed(3) + ')';
        c.beginPath();
        c.arc(ex, ey, 3, 0, TAU);
        c.fill();
      }

      c.restore();
      c.globalAlpha = 1.0;
      c.globalCompositeOperation = 'source-over';
      c.setLineDash([]);
    }

    update(targetPos, targetEnemy, autoTargetStation) {
      this.updateParticles();

      // Logistics ships fly to explicit route destinations; they no longer
      // depend on miner siphoning to undock or move.
      const hasDestination = !!autoTargetStation || !!targetPos;
      this.docked = !hasDestination;

      if (this.docked) {
        this.thrust = 0;
        this.vx = 0;
        this.vy = 0;
        return;
      }

      let destX = null, destY = null;
      if (autoTargetStation) {
        destX = autoTargetStation.x;
        destY = autoTargetStation.y;
      } else if (targetPos) {
        const dx = targetPos.x - this.x, dy = targetPos.y - this.y;
        if (Math.hypot(dx, dy) > 25) {
          destX = targetPos.x;
          destY = targetPos.y;
        }
      }

      if (destX !== null && destY !== null) {
        const targetAngle = Math.atan2(destY - this.y, destX - this.x);
        let diff = targetAngle - this.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.angle += Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
        if (this.angle > Math.PI) this.angle -= Math.PI * 2;
        else if (this.angle < -Math.PI) this.angle += Math.PI * 2;

        if (Math.abs(diff) < 1.2) {
          this.vx += Math.cos(this.angle) * ACCEL;
          this.vy += Math.sin(this.angle) * ACCEL;
          this.thrust = 1;
        } else {
          this.thrust = 0.3;
        }
      } else {
        this.thrust *= 0.85;
      }

      this.vx *= FRICTION;
      this.vy *= FRICTION;

      const curSpeed = Math.hypot(this.vx, this.vy);
      if (curSpeed > this.maxSpeed) {
        this.vx = (this.vx / curSpeed) * this.maxSpeed;
        this.vy = (this.vy / curSpeed) * this.maxSpeed;
      }

      this.x += this.vx;
      this.y += this.vy;
      this.emitThrusters();
    }

    draw(c) {
      this.drawParticles(c);
      c.save();
      c.translate(this.x, this.y);
      c.rotate(this.angle);

      if (window.ShipArt) {
        window.ShipArt.draw(c, SHIP_NAME, 0, 0, 0);
      } else {
        c.fillStyle = '#334155';
        c.strokeStyle = '#64748b';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(50, 0);
        c.lineTo(20, -28);
        c.lineTo(-40, -35);
        c.lineTo(-55, -15);
        c.lineTo(-55, 15);
        c.lineTo(-40, 35);
        c.lineTo(20, 28);
        c.closePath();
        c.fill();
        c.stroke();
      }

      c.restore();
      this.drawSiphon(c);
    }
  }

  window.TransportCapitalShip = TransportCapitalShip;
})();
