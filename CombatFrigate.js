// CombatFrigate.js – High-detail player/drone frigate with working homing missiles, engine disruptor, formation spacing & station targeting  
// Autoplay ON : ship engages / orbits / flies to station / follows waypoint on its own.  
// Autoplay OFF: only player movement (targetPos) moves the ship; missiles + scrambler still fire at targets in range.  
class CombatFrigate {  
  constructor(x, y) {  
    this.x = x;  
    this.y = y;  
    this.vx = 0;  
    this.vy = 0;  
    this.angle = 0;  
  
    this.maxSpeed = 5.2;  
    this.accel = 0.28;  
    this.friction = 0.93;  
  
    this.cargo = 0;  
    this.maxCargo = 100;  
    this.weaponRange = 550;  
    this.missileDamage = 15;  
    this.scramblerRange = 550;  
    this.slowFactor = 0.85;  
  
    this.shield = 150;  
    this.maxShield = 150;  
    this.armor = 150;  
    this.maxArmor = 150;  
    this.structure = 200;  
    this.maxStructure = 200;  
  
    this.docked = false;  
    this.className = 'Combat Frigate';  
    this.type = 'ship';  
  
    this.autoplay = true; // set this from your game's autoplay toggle  
  
    this.moduleLevels = {  
      missiles: 1,  
      shield: 1,  
      scrambler: 1,  
      propulsion: 1  
    };  
  
    this.particles = [];  
    this.maxParticles = 90;  
    this.thrustIntensity = 0;  
    this.glowPulse = 0;  
  
    this.currentTarget = null;  
    this.missiles = [];  
    this.missileTrails = [];  
    this.scrambleFx = [];  
    this.preferredOrbitDist = 180 + Math.random() * 80; // Unique offset per ship to prevent stacking  
  
    this.applyStats();  
  }  
  
  applyStats() {  
    let m = Number(this.moduleLevels.missiles) || 1;  
    let s = Number(this.moduleLevels.shield) || 1;  
    let sc = Number(this.moduleLevels.scrambler) || 1;  
    let p = Number(this.moduleLevels.propulsion) || 1;  
  
    this.missileDamage = 15 + (m - 1) * 8;  
    this.maxShield = 150 + (s - 1) * 60;  
    this.shield = Math.min(this.shield, this.maxShield);  
    this.maxSpeed = Math.min(window.STAT_CAPS.combatFrigateSpeed, 5.2 + (p - 1) * 0.6);  
    this.weaponRange = 550 + (m - 1) * 35;  
    this.scramblerRange = this.weaponRange + (sc - 1) * 50;  
  }  
  
  takeDamage(amount) {  
    let remaining = amount;  
    if (this.shield > 0) {  
      if (this.shield >= remaining) { this.shield -= remaining; return; }  
      remaining -= this.shield;  
      this.shield = 0;  
    }  
    if (this.armor > 0) {  
      if (this.armor >= remaining) { this.armor -= remaining; return; }  
      remaining -= this.armor;  
      this.armor = 0;  
    }  
    this.structure -= remaining;  
  }  
  
  upgradeModule(modKey) {  
    if (this.moduleLevels[modKey] < window.getCap(modKey, this.className)) {  
      this.moduleLevels[modKey]++;  
      this.applyStats();  
    }  
  }  
  
  update(targetPos, targetEnemy, autoTargetStation, availableEnemies, autoplay) {  
    if (this.docked) {  
      this.releaseScrambler();  
      this.currentTarget = null;  
      this.thrustIntensity = 0;  
      return;  
    }  
  
    let enemyList = availableEnemies || (typeof publicNpcMiners !== 'undefined' ? publicNpcMiners : []);  
  
    // Include Central Station Boss if active in public space  
    // NPC-owned drones (flagged by PvpLeash) never target their own station boss  
    if (window.centralStationBoss && window.centralStationBoss.structure > 0 && !this.ignoreStationBoss) {  
      if (!enemyList.includes(window.centralStationBoss)) {  
        enemyList.push(window.centralStationBoss);  
      }  
    }  
  
    if (targetEnemy) {  
      if (this.currentTarget !== targetEnemy) {  
        this.releaseScrambler();  
        this.currentTarget = targetEnemy;  
      }  
    } else if (!this.currentTarget || this.currentTarget.structure <= 0) {  
      this.releaseScrambler();  
      this.currentTarget = null;  
      let nearestDist = this.weaponRange;  
      if (enemyList && enemyList.length > 0) {  
        enemyList.forEach(e => {  
          let ent = e.ship || e;  
          if (ent && ent.structure > 0) {  
            let dist = Math.hypot(ent.x - this.x, ent.y - this.y);  
            if (dist <= nearestDist) {  
              nearestDist = dist;  
              this.currentTarget = ent;  
            }  
          }  
        });  
      }  
    }  
  
    let activeTarget = this.currentTarget;  
    let isThrusting = false;  
    let destAngle = null;  
    let inOrbit = false;  
  
    // Use the argument if the caller passes it, otherwise the property  
    const auto = (autoplay !== undefined) ? autoplay : this.autoplay;  
  
    if (auto) {  
      // ---- AUTOPLAY: engage / orbit / station / waypoint ----  
      if (activeTarget && activeTarget.structure > 0) {  
        let dist = Math.hypot(activeTarget.x - this.x, activeTarget.y - this.y);  
        let angleToTarget = Math.atan2(activeTarget.y - this.y, activeTarget.x - this.x);  
  
        if (this.noOrbitWhileFiring) {
          const firingDistance = Math.max(180, this.weaponRange * 0.82);
          if (dist > firingDistance) {
            destAngle = angleToTarget;
            isThrusting = true;
          } else {
            // Hold a stable firing position instead of circling the target.
            this.vx *= 0.90;
            this.vy *= 0.90;
          }
        } else if (dist > this.preferredOrbitDist + 40) {  
          destAngle = angleToTarget;  
          isThrusting = true;  
        } else if (dist < this.preferredOrbitDist - 40) {  
          destAngle = angleToTarget + Math.PI;  
          isThrusting = true;  
        } else {  
          inOrbit = true;  
          const rx = this.x - activeTarget.x, ry = this.y - activeTarget.y;  
          const rd = Math.hypot(rx, ry) || 1;  
          const ux = rx / rd, uy = ry / rd;  
          const vOrbit = this.maxSpeed * 0.8;  
          const radialErr = rd - this.preferredOrbitDist;  
          const wantVx = -uy * vOrbit - ux * radialErr * 0.05;  
          const wantVy = ux * vOrbit - uy * radialErr * 0.05;  
          const ax = wantVx - this.vx, ay = wantVy - this.vy;  
          const am = Math.hypot(ax, ay);  
          if (am > 0.01) {  
            const f = Math.min(this.accel, am) / am;  
            this.vx += ax * f;  
            this.vy += ay * f;  
          }  
        }  
      } else if (autoTargetStation) {  
        let dx = autoTargetStation.x - this.x;  
        let dy = autoTargetStation.y - this.y;  
        if (Math.hypot(dx, dy) > 25) {  
          destAngle = Math.atan2(dy, dx);  
          isThrusting = true;  
        }  
      } else if (targetPos) {  
        let dx = targetPos.x - this.x;  
        let dy = targetPos.y - this.y;  
        if (Math.hypot(dx, dy) > 18) {  
          destAngle = Math.atan2(dy, dx);  
          isThrusting = true;  
        }  
      }  
    } else if (targetPos) {  
      // ---- MANUAL: fully manual player movement, strict response to targetPos clicks only ----  
      let dx = targetPos.x - this.x;  
      let dy = targetPos.y - this.y;  
      if (Math.hypot(dx, dy) > 18) {  
        destAngle = Math.atan2(dy, dx);  
        isThrusting = true;  
      }  
    }  
  
    // face the direction of travel  
    let targetAngle = this.angle;  
    if (Math.hypot(this.vx, this.vy) > 0.3) {  
      targetAngle = Math.atan2(this.vy, this.vx);  
    }  
  
    let angleDiff = targetAngle - this.angle;  
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;  
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;  
    this.angle += angleDiff * 0.18;  
  
    if (isThrusting) {  
      let thrustDir = destAngle !== null ? destAngle : this.angle;  
      this.vx += Math.cos(thrustDir) * this.accel;  
      this.vy += Math.sin(thrustDir) * this.accel;  
    }  
  
    if (activeTarget && activeTarget.structure > 0 && activeTarget !== window.centralStationBoss) {  
      let distToTarget = Math.hypot(activeTarget.x - this.x, activeTarget.y - this.y);  
      if (distToTarget <= this.scramblerRange) {  
        this.applyScrambler(activeTarget);  
        activeTarget.vx *= this.slowFactor;  
        activeTarget.vy *= this.slowFactor;  
      } else {  
        this.releaseScrambler();  
      }  
    } else {  
      this.releaseScrambler();  
    }  
  
    let currentSpeed = Math.hypot(this.vx, this.vy);  
    if (currentSpeed > this.maxSpeed) {  
      this.vx = (this.vx / currentSpeed) * this.maxSpeed;  
      this.vy = (this.vy / currentSpeed) * this.maxSpeed;  
    }  
    const fr = inOrbit ? 0.985 : this.friction;  
    this.vx *= fr;  
    this.vy *= fr;  
    this.x += this.vx;  
    this.y += this.vy;  
  
    this.thrustIntensity += ((isThrusting ? 1 : 0) - this.thrustIntensity) * 0.18;  
    this.glowPulse = (this.glowPulse + 0.08) % (Math.PI * 2);  
  
    if (this.disableThrusterEffects) {
      this.particles.length = 0;
      this.missileTrails.length = 0;
    } else {
      if (this.thrustIntensity > 0.05) {
        for (let i = 0; i < 3; i++) {
          if (this.particles.length >= this.maxParticles) this.particles.shift();
          this.particles.push({
            x: this.x - Math.cos(this.angle) * 28 + (Math.random() - 0.5) * 8,
            y: this.y - Math.sin(this.angle) * 28 + (Math.random() - 0.5) * 8,
            vx: -Math.cos(this.angle) * (2.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.4,
            vy: -Math.sin(this.angle) * (2.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.4,
            size: 2.2 + Math.random() * 3,
            alpha: 0.95,
            color: Math.random() > 0.4 ? '#38bdf8' : '#818cf8'
          });
        }
      }

      for (let p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.038;
      }
      this.particles = this.particles.filter(p => p.alpha > 0);
    }  
  
    if (activeTarget && activeTarget.structure > 0) {  
      let distToTarget = Math.hypot(activeTarget.x - this.x, activeTarget.y - this.y);  
      if (distToTarget <= this.weaponRange && Math.random() < 0.13) {  
        let side = Math.random() < 0.5 ? 1 : -1;  
        let launchAngle = this.angle + side * (0.6 + Math.random() * 0.4);  
        let launchSpeed = 6.8 + Math.random() * 1.6;  
  
        this.missiles.push({  
          x: this.x + Math.cos(this.angle) * 22,  
          y: this.y + Math.sin(this.angle) * 22,  
          vx: Math.cos(launchAngle) * launchSpeed,  
          vy: Math.sin(launchAngle) * launchSpeed,  
          target: activeTarget,  
          damage: this.missileDamage,  
          life: 145,  
          age: 0,  
          maxSpeed: 14.5,  
          turnRate: 0.25  
        });  
      }  
    }  
  
    for (let m of this.missiles) {  
      m.age++;  
  
      if (!m.target || m.target.structure <= 0) {  
        let nearest = null;  
        let minD = 999999;  
        if (enemyList && enemyList.length > 0) {  
          enemyList.forEach(e => {  
            let ent = e.ship || e;  
            if (ent && ent.structure > 0) {  
              let d = Math.hypot(ent.x - m.x, ent.y - m.y);  
              if (d < minD) {  
                minD = d;  
                nearest = ent;  
              }  
            }  
          });  
        }  
        m.target = nearest;  
      }  
  
      if (m.target && m.target.structure > 0) {  
        let tx = m.target.x + (m.target.vx || 0) * 10;  
        let ty = m.target.y + (m.target.vy || 0) * 10;  
        let dx = tx - m.x;  
        let dy = ty - m.y;  
        let desired = Math.atan2(dy, dx);  
  
        let lockStrength = Math.min(1, m.age / 20);  
        m.turnRate = 0.35 + lockStrength * 0.45;  
        m.vx += Math.cos(desired) * m.turnRate * 4.2;  
        m.vy += Math.sin(desired) * m.turnRate * 4.2;  
  
        let spd = Math.hypot(m.vx, m.vy);  
        if (spd > m.maxSpeed) {  
          m.vx = (m.vx / spd) * m.maxSpeed;  
          m.vy = (m.vy / spd) * m.maxSpeed;  
        }  
      }  
  
      m.x += m.vx;  
      m.y += m.vy;  
      m.life--;  
  
      if (m.age % 2 === 0) {  
        this.missileTrails.push({ x: m.x, y: m.y, alpha: 0.72, size: 2.3 });  
      }  
  
      let hitDist = m.target === window.centralStationBoss ? 120 : 24;  
      if (m.target && m.target.structure > 0 &&  
        Math.hypot(m.target.x - m.x, m.target.y - m.y) < hitDist) {  
        if (typeof m.target.takeDamage === 'function') {  
          m.target.takeDamage(m.damage);  
        } else {  
          m.target.structure -= m.damage;  
        }  
        m.life = 0;  
      }  
    }  
    this.missiles = this.missiles.filter(m => m.life > 0);  
  
    for (let t of this.missileTrails) t.alpha -= 0.045;  
    this.missileTrails = this.missileTrails.filter(t => t.alpha > 0);  
  
    if (this.currentTarget && this.currentTarget.isScrambled) {  
      for (let i = 0; i < 2; i++) {  
        this.scrambleFx.push({  
          x: this.currentTarget.x + (Math.random() - 0.5) * 42,  
          y: this.currentTarget.y + (Math.random() - 0.5) * 42,  
          vx: (Math.random() - 0.5) * 1.6,  
          vy: (Math.random() - 0.5) * 1.6,  
          alpha: 0.85,  
          size: 1.6 + Math.random() * 2.2  
        });  
      }  
    }  
    for (let f of this.scrambleFx) {  
      f.x += f.vx;  
      f.y += f.vy;  
      f.alpha -= 0.04;  
    }  
    this.scrambleFx = this.scrambleFx.filter(f => f.alpha > 0);  
  }  
  
  applyScrambler(target) {  
    if (target === window.centralStationBoss) return;  
    target.isScrambled = true;  
    this.currentTarget = target;  
  }  
  
  releaseScrambler() {  
    if (this.currentTarget && this.currentTarget !== window.centralStationBoss) {  
      this.currentTarget.isScrambled = false;  
    }  
  }  
  
  draw(ctx) {  
    if (!this.disableThrusterEffects) {
      for (let p of this.particles) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color || '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (let t of this.missileTrails) {
        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    for (let m of this.missiles) {  
      ctx.save();  
      ctx.translate(m.x, m.y);  
      ctx.rotate(Math.atan2(m.vy, m.vx));  
      ctx.fillStyle = '#f43f5e';  
      ctx.beginPath();  
      ctx.moveTo(6, 0);  
      ctx.lineTo(-4, -3);  
      ctx.lineTo(-2, 0);  
      ctx.lineTo(-4, 3);  
      ctx.closePath();  
      ctx.fill();  
      ctx.restore();  
    }  
  
    for (let f of this.scrambleFx) {  
      ctx.save();  
      ctx.globalAlpha = f.alpha;  
      ctx.strokeStyle = '#38bdf8';  
      ctx.lineWidth = 1.5;  
      ctx.beginPath();  
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);  
      ctx.stroke();  
      ctx.restore();  
    }  
  
    ctx.save();  
    ctx.translate(this.x, this.y);  
    ctx.rotate(this.angle);  
  
    if (window.ShipArt) {  
      window.ShipArt.draw(ctx, this.className, 0, 0, 0);  
    } else {  
      ctx.fillStyle = '#38bdf8';  
      ctx.beginPath();  
      ctx.moveTo(16, 0);  
      ctx.lineTo(-12, -10);  
      ctx.lineTo(-8, 0);  
      ctx.lineTo(-12, 10);  
      ctx.closePath();  
      ctx.fill();  
    }  
  
    ctx.restore();  
  }  
}  
  
window.CombatFrigate = CombatFrigate;
