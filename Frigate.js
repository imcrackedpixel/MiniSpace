// Frigate.js - Mining Frigate. Hull art comes from mining_frigate.png via ShipArt.js.
// The mining laser fires from the red dot at the nose of the art, MUZZLE_FORWARD units ahead of the ship's centre.
// Visuals: layered pulsing "super" mining beam + animated engine thrusters (flames scale with speed).
//
// Autoplay ON : ship parks at standoff from its rock / flies to station / follows waypoint on its own.
// Autoplay OFF: player tap-to-move (targetPos) is the only thing that moves the ship. The laser still
//               mines the current target whenever it is within range.

const MUZZLE_FORWARD = 42;

// How far from the rock the frigate parks, as a fraction of its mining laser range (0.5 = half, 0.75 = three quarters).
// Keep it under about 0.85 or the beam will not reach the rock.
const FRIGATE_STANDOFF = 0.75;

// Engine nozzles in ship space: b = distance behind centre, y = sideways, s = flame size.
const FRIGATE_NOZZLES = [
  { b: 48, y: -8.0,  s: 0.7 }, 
  { b: 48, y: -3.5,  s: 0.7 },
  { b: 48, y: 3.5,   s: 0.7 }, 
  { b: 48, y: 8.0,   s: 0.7 },
  { b: 42, y: -15.0, s: 0.8 }, 
  { b: 42, y: 15.0,  s: 0.8 }
];

class MiningFrigate {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.maxSpeed = 3.4;
    this.accel = 0.16;
    this.friction = 0.94;

    this.cargo = 0;
    this.maxCargo = 200;
    this.laserRange = 180;
    this.miningPower = 0.15;

    this.shield = 100;
    this.maxShield = 100;
    this.armor = 150;
    this.maxArmor = 150;
    this.structure = 200;
    this.maxStructure = 200;

    this.docked = true;
    this.className = 'Mining Frigate';
    this.oreType = 'veldspar';
    this.type = 'ship';

    this.autoplay = true; // set this from your game's autoplay toggle

    this.moduleLevels = {
      laser: 1,
      shield: 1,
      cargo: 1,
      propulsion: 1
    };

    this.particles = [];
    this.maxParticles = 90;
    this.currentTarget = null;

    this.applyStats();
  }

  applyStats() {
    let l = Number(this.moduleLevels.laser) || 1;
    let s = Number(this.moduleLevels.shield) || 1;
    let c = Number(this.moduleLevels.cargo) || 1;
    let p = Number(this.moduleLevels.propulsion) || 1;

    this.maxCargo = 200 + (c - 1) * 90;
    this.miningPower = 0.15 + (l - 1) * 0.05;

    let oldMaxShield = this.maxShield;
    this.maxShield = 100 + (s - 1) * 40;
    // Preserve shield percentage ratio instead of fully recharging on upgrade
    if (oldMaxShield > 0) {
      let shieldRatio = this.shield / oldMaxShield;
      this.shield = Math.min(this.maxShield, this.maxShield * shieldRatio);
    } else {
      this.shield = this.maxShield;
    }

    this.maxSpeed = 3.4 + (p - 1) * 0.45;
    this.laserRange = 180 + (l - 1) * 22;
  }

  upgradeModule(modKey) {
    if (this.moduleLevels[modKey] < 5) {
      this.moduleLevels[modKey]++;
      this.applyStats();
    }
  }

  takeDamage(rawDmg) {
    // shield -> armor -> structure
    let dmg = rawDmg * (1.0 - (this.damageResistance || 0));
    if ((this.shield || 0) > 0) {
      this.shield -= dmg;
      if (this.shield < 0) { dmg = -this.shield; this.shield = 0; } else { dmg = 0; }
    }
    if (dmg > 0 && (this.armor || 0) > 0) {
      this.armor -= dmg;
      if (this.armor < 0) { dmg = -this.armor; this.armor = 0; } else { dmg = 0; }
    }
    if (dmg > 0) this.structure -= dmg;
    this.shield = Math.max(0, this.shield || 0);
    this.armor = Math.max(0, this.armor || 0);
    this.structure = Math.max(0, this.structure);
  }

  // Where the mining laser leaves the hull: the red dot at the nose of the art
  muzzle() {
    return {
      x: this.x + Math.cos(this.angle) * MUZZLE_FORWARD,
      y: this.y + Math.sin(this.angle) * MUZZLE_FORWARD
    };
  }

  update(targetPos, targetAst, autoTargetStation, autoplay) {
    if (this.docked) {
      this.currentTarget = null;
      return;
    }

    // Mining target is always kept, so the laser keeps working in both modes
    this.currentTarget = targetAst || null;

    // Use the argument if the caller passes it, otherwise the property
    const auto = (autoplay !== undefined) ? autoplay : this.autoplay;

    let destX = null, destY = null, isHolding = false;

    // Move toward a tap-to-move point (shared by both modes)
    const goToPos = () => {
      let dx = targetPos.x - this.x;
      let dy = targetPos.y - this.y;
      if (Math.hypot(dx, dy) > 18) {
        destX = targetPos.x;
        destY = targetPos.y;
      } else {
        isHolding = true;
        this.vx *= 0.8;
        this.vy *= 0.8;
      }
    };

    if (auto) {
      // ---- AUTOPLAY: station / park at standoff from rock / waypoint ----
      if (autoTargetStation) {
        destX = autoTargetStation.x;
        destY = autoTargetStation.y;
      } else if (targetAst) {
        let dx = targetAst.x - this.x;
        let dy = targetAst.y - this.y;
        let dist = Math.hypot(dx, dy);
        // Park at FRIGATE_STANDOFF x laser range from the rock
        const standoff = Math.max(40, (this.laserRange || 180) * FRIGATE_STANDOFF);
        if (dist > standoff) {
          if (dist < standoff + 45) { this.vx *= 0.9; this.vy *= 0.9; }   // ease in so it doesn't overshoot
          let a = Math.atan2(dy, dx);
          destX = targetAst.x - Math.cos(a) * standoff;
          destY = targetAst.y - Math.sin(a) * standoff;
        } else {
          isHolding = true;
          this.vx *= 0.75;
          this.vy *= 0.75;
        }
      } else if (targetPos) {
        goToPos();
      }
    } else if (targetPos) {
      // ---- MANUAL: player tap-to-move is the only thing that moves the ship ----
      // Mining still happens on currentTarget whenever it is inside laser range.
      goToPos();
    }
    // Manual with no targetPos: no thrust, ship coasts to a stop via friction.

    if (!isHolding && destX !== null) {
      let dx = destX - this.x;
      let dy = destY - this.y;
      let dist = Math.hypot(dx, dy);

      if (dist > 4) {
        let targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * 0.15;

        this.vx += Math.cos(this.angle) * this.accel;
        this.vy += Math.sin(this.angle) * this.accel;
      }
    }

    let speed = Math.hypot(this.vx, this.vy);
    if (speed > this.maxSpeed) {
      this.vx = (this.vx / speed) * this.maxSpeed;
      this.vy = (this.vy / speed) * this.maxSpeed;
    }

    this.vx *= this.friction;
    this.vy *= this.friction;
    this.x += this.vx;
    this.y += this.vy;
  }

  // Animated engine flames. Positioned correctly at the rear of the ship.
  drawThrusters(ctx) {
    const speed = Math.hypot(this.vx, this.vy);
    const power = Math.min(1, speed / (this.maxSpeed || 1));
    const k = 0.28 + 0.72 * power;
    const now = performance.now() / 1000;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < FRIGATE_NOZZLES.length; i++) {
      const n = FRIGATE_NOZZLES[i];
      const flick = 0.85 + 0.15 * Math.sin(now * 42 + i * 1.9) + 0.1 * Math.sin(now * 23 + i * 0.7);
      const L = (12 + 40 * k) * flick * n.s;
      const w = (2.8 + 2.4 * k) * n.s;
      
      // Flipped back to negative so flames trail backward behind the ship correctly
      const x0 = -n.b; 
      const x1 = x0 - L;

      // outer flame
      let g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(255, 235, 190, 0.95)');
      g.addColorStop(0.35, 'rgba(255, 150, 40, 0.75)');
      g.addColorStop(1, 'rgba(255, 70, 10, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, n.y - w);
      ctx.quadraticCurveTo(x0 - L * 0.55, n.y - w * 0.9, x1, n.y);
      ctx.quadraticCurveTo(x0 - L * 0.55, n.y + w * 0.9, x0, n.y + w);
      ctx.closePath();
      ctx.fill();

      // hot core
      let g2 = ctx.createLinearGradient(x0, 0, x0 - L * 0.55, 0);
      g2.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g2.addColorStop(1, 'rgba(255, 220, 140, 0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(x0, n.y - w * 0.4);
      ctx.lineTo(x0 - L * 0.55, n.y);
      ctx.lineTo(x0, n.y + w * 0.4);
      ctx.closePath();
      ctx.fill();

      // nozzle glow
      let gl = ctx.createRadialGradient(x0, n.y, 0, x0, n.y, w * 2.6);
      gl.addColorStop(0, 'rgba(255, 190, 90, ' + (0.45 * k) + ')');
      gl.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(x0, n.y, w * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // "Super" mining beam: layered pulsing glow, bright core, crackle arcs, energy pulses
  // travelling to the rock, muzzle flare and an impact flare with sparks.
  drawLaser(ctx, m, t) {
    const dx = t.x - m.x, dy = t.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const ux = dx / dist, uy = dy / dist;
    const nx = -uy, ny = ux;
    const now = performance.now() / 1000;
    const pulse = 0.82 + 0.18 * Math.sin(now * 18);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';

    // layered glow
    const layers = [
      [18, 0.10, '63, 185, 80'],
      [10, 0.22, '90, 235, 110'],
      [5, 0.55, '170, 255, 190']
    ];
    for (const [wd, al, col] of layers) {
      ctx.strokeStyle = 'rgba(' + col + ', ' + al + ')';
      ctx.lineWidth = wd * pulse;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    // white-hot core
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(t.x, t.y); ctx.stroke();

    // crackling side arcs
    const steps = Math.max(6, Math.floor(dist / 16));
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = 'rgba(190, 255, 200, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const amp = Math.sin(f * Math.PI) * 5 * (k ? -1 : 1);
        const off = Math.sin(now * 14 + f * 14 + k * 2.1) * amp;
        const px = m.x + dx * f + nx * off;
        const py = m.y + dy * f + ny * off;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // energy pulses racing along the beam
    for (let i = 0; i < 5; i++) {
      const f = (now * 1.8 + i / 5) % 1;
      const px = m.x + dx * f, py = m.y + dy * f;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120, 255, 150, 0.35)';
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    }

    // muzzle flare
    let mg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 15);
    mg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    mg.addColorStop(0.4, 'rgba(120, 255, 150, 0.6)');
    mg.addColorStop(1, 'rgba(63, 185, 80, 0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(m.x, m.y, 15, 0, Math.PI * 2); ctx.fill();

    // impact flare + sparks
    const ir = 20 + 4 * Math.sin(now * 22);
    let ig = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, ir);
    ig.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    ig.addColorStop(0.35, 'rgba(140, 255, 170, 0.55)');
    ig.addColorStop(1, 'rgba(63, 185, 80, 0)');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(t.x, t.y, ir, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(210, 255, 220, 0.85)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 4 + Math.random() * 4, r1 = r0 + 5 + Math.random() * 10;
      ctx.beginPath();
      ctx.moveTo(t.x + Math.cos(a) * r0, t.y + Math.sin(a) * r0);
      ctx.lineTo(t.x + Math.cos(a) * r1, t.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx, asteroidBeltRef) {
    if (!this.docked) this.drawThrusters(ctx);

    if (!this.docked && this.currentTarget && this.currentTarget.oreYield > 0 && this.cargo < this.maxCargo) {
      const m = this.muzzle();
      let dist = Math.hypot(this.currentTarget.x - m.x, this.currentTarget.y - m.y);
      if (dist <= this.laserRange + 30) {
        // Corp miners are mined by BotManager; they only show the beam here (no double mining)
        if (!this.isCorpMember) {
          let mined = Math.min(this.miningPower, this.currentTarget.oreYield, this.maxCargo - this.cargo);
          this.currentTarget.oreYield -= mined;
          if (window.addOreToCargo) window.addOreToCargo(this, this.currentTarget.oreType || 'veldspar', mined);
          else { this.cargo += mined; this.oreType = this.currentTarget.oreType || 'veldspar'; }
        }

        this.drawLaser(ctx, m, this.currentTarget);
      }
    }

    // Hull art comes from the PNG
    if (window.ShipArt) window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle);
  }
}
