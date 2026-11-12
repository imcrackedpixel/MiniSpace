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


  // ===== SIPHON SUPPORT =====
  // Which drones of a mothership (Command Ship / Mining Capital) are out in the field holding ore.
  const DRONE_SIPHON_RANGE = 3200;  // how far from the transport a drone can be and still be drained (doubled)
  const SHIP_SIPHON_RANGE = 2800;   // how far a miner/mothership can be and still be drained (doubled)
  const SIPHON_STANDOFF = 720;      // distance the transport parks from the miners so it never sits on top of them
  const SIPHON_MIN_GAP = 430;       // closest any ship/drone may get to the transport before it gets nudged away

  function loadedDrones(m, minCargo) {
    if (!m || !Array.isArray(m.drones)) return [];
    const th = minCargo == null ? 5 : minCargo;
    return m.drones.filter(function (e) {
      return e && e.ship && !e.isDocked && (e.ship.cargo || 0) > th;
    });
  }
  function hasLoad(m, th) {
    if (!m) return false;
    const t = th == null ? 10 : th;
    return (m.cargo || 0) > t || loadedDrones(m, Math.min(5, t)).length > 0;
  }
  // Point the transport flies to: the centre of everything it can drain from this miner
  // (the mothership if it holds ore, plus every loaded drone), so the whole group stays in reach.
  function aimPoint(m, from) {
    let sx = 0, sy = 0, n = 0;
    if ((m.cargo || 0) > 5) { sx += m.x; sy += m.y; n++; }
    loadedDrones(m).forEach(function (e) { sx += e.ship.x; sy += e.ship.y; n++; });
    return n ? { x: sx / n, y: sy / n } : { x: m.x, y: m.y };
  }
  window.TransportSiphon = {
    loadedDrones: loadedDrones,
    hasLoad: hasLoad,
    aimPoint: aimPoint,
    DRONE_RANGE: DRONE_SIPHON_RANGE,
    SHIP_RANGE: SHIP_SIPHON_RANGE,
    STANDOFF: SIPHON_STANDOFF,
    MIN_GAP: SIPHON_MIN_GAP
  };

  // Intake ports on the hull (local coords: x forward, y sideways). Each beam docks at the nearest one.
  const INTAKE_PORTS = [
    { x: 175, y: 0 }, { x: 70, y: -72 }, { x: 70, y: 72 }, { x: -30, y: -78 }, { x: -30, y: 78 }
  ];
  const TAU = Math.PI * 2;
  const frac = function (v) { return v - Math.floor(v); };

  const BEAM_STYLE = {
    ship:  { glow: '56,189,248',  mid: '168,85,247', core: '#e0f7ff', a: '#38bdf8', b: '#e879f9', flare: '186,230,253' },
    drone: { glow: '45,212,191',  mid: '250,204,21', core: '#f0fff8', a: '#2dd4bf', b: '#fde047', flare: '204,251,241' }
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
      this._siphonT = 0;
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


    // ---------- SIPHON EFFECT ----------
    _portWorld(port) {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      return { x: this.x + c * port.x - s * port.y, y: this.y + s * port.x + c * port.y };
    }

    _syncBeams(dt) {
      const feed = this.siphonFeed || [];
      const beams = this._beams;
      for (const b of beams) b.want = 0;
      for (const f of feed) {
        let b = null;
        for (const q of beams) { if (q.ref === f.ref) { b = q; break; } }
        if (!b) {
          b = { ref: f.ref, kind: f.kind, strength: 0, want: 1, seed: Math.random() * 100, lx: f.ref.x, ly: f.ref.y };
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

    _bezier(sx, sy, cx, cy, ex, ey, t) {
      const u = 1 - t;
      return { x: u * u * sx + 2 * u * t * cx + t * t * ex, y: u * u * sy + 2 * u * t * cy + t * t * ey };
    }

    drawSiphon(c) {
      const now = performance.now() / 1000;
      const dt = this._siphonLast ? Math.min(0.1, now - this._siphonLast) : 0.016;
      this._siphonLast = now;
      this._syncBeams(dt);
      const beams = this._beams;
      if (!beams.length) return;
      const time = now;

      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      c.lineJoin = 'round';

      // ---- ambient intake field around the hull ----
      let maxS = 0;
      for (const b of beams) maxS = Math.max(maxS, b.strength);
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      c.save();
      c.translate(this.x, this.y);
      c.rotate(time * 0.35);
      c.setLineDash([26, 18]);
      c.lineWidth = 2.2;
      c.strokeStyle = 'rgba(125,211,252,' + (0.18 * maxS + 0.08 * pulse * maxS).toFixed(3) + ')';
      c.beginPath(); c.arc(0, 0, 150 + pulse * 6, 0, TAU); c.stroke();
      c.rotate(-time * 0.9);
      c.setLineDash([8, 22]);
      c.lineWidth = 1.4;
      c.strokeStyle = 'rgba(232,121,249,' + (0.2 * maxS).toFixed(3) + ')';
      c.beginPath(); c.arc(0, 0, 166 - pulse * 5, 0, TAU); c.stroke();
      c.restore();

      const crowd = beams.length > 4;   // many beams at once: trim the costly bits so phones keep up
      for (const b of beams) {
        const st = BEAM_STYLE[b.kind] || BEAM_STYLE.ship;
        const s = b.strength;
        if (s <= 0.01) continue;
        const sx = b.lx, sy = b.ly;

        // pick the nearest intake port
        let port = null, pd = Infinity, pw = null;
        for (const p of INTAKE_PORTS) {
          const w = this._portWorld(p);
          const d = Math.hypot(w.x - sx, w.y - sy);
          if (d < pd) { pd = d; port = p; pw = w; }
        }
        const ex = pw.x, ey = pw.y;
        const len = Math.max(20, pd);
        const dx = (ex - sx) / len, dy = (ey - sy) / len;
        const nx = -dy, ny = dx;
        const sway = Math.sin(time * 1.4 + b.seed) * 0.11 * len;
        const cx = (sx + ex) / 2 + nx * sway;
        const cy = (sy + ey) / 2 + ny * sway;
        const srcR = b.kind === 'drone' ? 15 : 52;

        // layered glow body
        const bodyPath = function () { c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(cx, cy, ex, ey); };
        c.setLineDash([]);
        bodyPath(); c.lineWidth = 26 * s; c.strokeStyle = 'rgba(' + st.glow + ',' + (0.05 * s).toFixed(3) + ')'; c.stroke();
        bodyPath(); c.lineWidth = 13 * s; c.strokeStyle = 'rgba(' + st.mid + ',' + (0.10 * s).toFixed(3) + ')'; c.stroke();
        bodyPath(); c.lineWidth = 6 * s;  c.strokeStyle = 'rgba(' + st.glow + ',' + (0.22 * s).toFixed(3) + ')'; c.stroke();

        // flowing energy dashes along the core (reads as a current heading INTO the ship)
        bodyPath();
        c.setLineDash([14, 10, 3, 10]);
        c.lineDashOffset = time * 90;
        c.lineWidth = 2.6 * s;
        c.strokeStyle = 'rgba(255,255,255,' + (0.85 * s).toFixed(3) + ')';
        if (!crowd) { c.shadowColor = st.a; c.shadowBlur = 14 * s; }
        c.stroke();
        c.shadowBlur = 0;
        c.setLineDash([]);

        // double helix strands + rungs
        const SEG = Math.max(14, Math.min(crowd ? 24 : 40, Math.floor(len / (crowd ? 14 : 9))));
        const wl = 26;                                   // helix wavelength in px
        const amp0 = (b.kind === 'drone' ? 7 : 11) * s;
        const ptsA = [], ptsB = [];
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG;
          const p = this._bezier(sx, sy, cx, cy, ex, ey, t);
          // tangent for the curve normal
          const p2 = this._bezier(sx, sy, cx, cy, ex, ey, Math.min(1, t + 0.02));
          const p1 = this._bezier(sx, sy, cx, cy, ex, ey, Math.max(0, t - 0.02));
          let tx = p2.x - p1.x, ty = p2.y - p1.y;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const px = -ty, py = tx;
          const env = Math.pow(Math.sin(Math.PI * t), 0.7);          // pinch at both ends
          const ph = t * len / wl * TAU - time * 9 + b.seed;
          const off = Math.sin(ph) * amp0 * env;
          const depth = Math.cos(ph);                                 // fake 3D: strands swap front/back
          ptsA.push({ x: p.x + px * off, y: p.y + py * off, d: depth });
          ptsB.push({ x: p.x - px * off, y: p.y - py * off, d: -depth });
        }
        c.lineWidth = 0.9;
        for (let i = 1; i < SEG; i += (crowd ? 4 : 2)) {
          c.strokeStyle = 'rgba(255,255,255,' + (0.16 * s).toFixed(3) + ')';
          c.beginPath(); c.moveTo(ptsA[i].x, ptsA[i].y); c.lineTo(ptsB[i].x, ptsB[i].y); c.stroke();
        }
        const strand = function (pts, col) {
          for (let i = 1; i < pts.length; i++) {
            const front = (pts[i].d + pts[i - 1].d) * 0.5;
            c.lineWidth = (1.3 + 1.2 * Math.max(0, front)) * Math.max(0.4, s);
            c.globalAlpha = (0.45 + 0.4 * front) * s;
            c.strokeStyle = col;
            c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y); c.stroke();
          }
          c.globalAlpha = 1;
        };
        strand(ptsA, st.a);
        strand(ptsB, st.b);

        // ore packets: glowing comets streaming source -> intake, shrinking & brightening as they arrive
        const NP = Math.max(5, Math.min(crowd ? 8 : 12, Math.floor(len / 28)));
        for (let i = 0; i < NP; i++) {
          const t = frac(time * (0.55 + 0.25 * Math.sin(b.seed + i)) + i / NP + b.seed);
          for (let tr = 0; tr < (crowd ? 3 : 5); tr++) {              // trail samples
            const tt = Math.max(0, t - tr * 0.018);
            const p = this._bezier(sx, sy, cx, cy, ex, ey, tt);
            const a = (1 - tr / 5) * s;
            const r = (4.2 - 2.2 * t) * (1 - tr * 0.14) + 0.8;
            c.fillStyle = 'rgba(' + st.glow + ',' + (0.22 * a).toFixed(3) + ')';
            c.beginPath(); c.arc(p.x, p.y, r * 2.6, 0, TAU); c.fill();
            c.fillStyle = (tr === 0 ? 'rgba(255,255,255,' : 'rgba(' + st.flare + ',') + (0.9 * a).toFixed(3) + ')';
            c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill();
          }
        }

        // drifting sparks shed along the stream
        for (let i = 0; i < 7; i++) {
          const t = frac(time * 0.8 + i * 0.137 + b.seed * 0.3);
          const p = this._bezier(sx, sy, cx, cy, ex, ey, t);
          const side = (i % 2 ? 1 : -1) * (6 + 16 * frac(i * 0.618 + b.seed)) * Math.sin(Math.PI * t);
          c.fillStyle = 'rgba(' + st.flare + ',' + (0.6 * s * (1 - t)).toFixed(3) + ')';
          c.fillRect(p.x + nx * side - 1, p.y + ny * side - 1, 2, 2);
        }

        // ---- source end: draining reticle (rings collapse onto the victim) ----
        c.save();
        c.translate(sx, sy);
        c.rotate(-time * 1.8 + b.seed);
        c.setLineDash([srcR * 0.55, srcR * 0.4]);
        c.lineWidth = 1.8 * s;
        c.strokeStyle = 'rgba(' + st.flare + ',' + (0.75 * s).toFixed(3) + ')';
        c.beginPath(); c.arc(0, 0, srcR * 1.15, 0, TAU); c.stroke();
        c.setLineDash([]);
        for (let k = 0; k < 3; k++) {
          const ph = frac(time * 1.1 + k / 3 + b.seed);
          const r = srcR * (2.6 - 1.9 * ph);                          // contracting ring
          c.lineWidth = 1.4;
          c.strokeStyle = 'rgba(' + st.glow + ',' + (0.5 * s * ph).toFixed(3) + ')';
          c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
        }
        const g = c.createRadialGradient(0, 0, 0, 0, 0, srcR * 1.6);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.35 * s).toFixed(3) + ')');
        g.addColorStop(0.4, 'rgba(' + st.glow + ',' + (0.22 * s).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + st.glow + ',0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, srcR * 1.6, 0, TAU); c.fill();
        c.restore();

        // ---- intake end: spinning vortex + flare ----
        c.save();
        c.translate(ex, ey);
        const vr = 22 + 4 * Math.sin(time * 6 + b.seed);
        const vg = c.createRadialGradient(0, 0, 0, 0, 0, vr * 1.8);
        vg.addColorStop(0, 'rgba(255,255,255,' + (0.8 * s).toFixed(3) + ')');
        vg.addColorStop(0.3, 'rgba(' + st.glow + ',' + (0.45 * s).toFixed(3) + ')');
        vg.addColorStop(1, 'rgba(' + st.mid + ',0)');
        c.fillStyle = vg;
        c.beginPath(); c.arc(0, 0, vr * 1.8, 0, TAU); c.fill();
        for (let k = 0; k < 3; k++) {
          c.save();
          c.rotate((k % 2 ? -1 : 1) * time * (2.2 + k * 1.3) + k);
          c.lineWidth = 2.2 - k * 0.4;
          c.strokeStyle = (k === 1 ? 'rgba(' + st.mid + ',' : 'rgba(' + st.flare + ',') + (0.8 * s).toFixed(3) + ')';
          const rr = vr * (0.55 + k * 0.32);
          c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 1.3); c.stroke();
          c.beginPath(); c.arc(0, 0, rr, Math.PI * 1.5, Math.PI * 1.85); c.stroke();
          c.restore();
        }
        // 4-point lens flare
        c.rotate(time * 0.8);
        const fl = vr * (1.6 + 0.4 * Math.sin(time * 9));
        c.strokeStyle = 'rgba(255,255,255,' + (0.7 * s).toFixed(3) + ')';
        c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(-fl, 0); c.lineTo(fl, 0); c.moveTo(0, -fl); c.lineTo(0, fl); c.stroke();
        c.restore();
      }

      c.restore();
      c.globalAlpha = 1.0;
      c.globalCompositeOperation = 'source-over';
      c.setLineDash([]);
    }

    update(targetPos, targetEnemy, autoTargetStation) {
      this.updateParticles();
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