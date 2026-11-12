// Carrier.js - Heavy Combat & Drone Carrier Ship (Player Version)
//
// Engine cups, measured on carrier.png (351x711) as fractions of the image from its centre:
// fx = sideways, fy = along the hull (positive = tail). They are drawn in the SAME rotated space as the
// hull artwork (see ShipArt.js), so they always sit on the real cups, whichever way the ship faces.
// [fx, fy, size]
const CARRIER_CUPS = [
  // four big cups
  [-0.215, 0.387, 1.0],
  [-0.130, 0.387, 1.0],
  [ 0.130, 0.387, 1.0],
  [ 0.219, 0.387, 1.0],
  // two small cups in the middle
  [-0.041, 0.358, 0.55],
  [ 0.041, 0.358, 0.55]
];

// Returns {rot, w, h} for the carrier art, using ShipArt's own settings.
function carrierArtInfo() {
  const e = window.ShipArt && window.ShipArt.ART && window.ShipArt.ART['Carrier'];
  const rot = e && e.rot !== undefined ? e.rot : Math.PI / 2;
  const size = (e && e.size) || [351, 711];
  return { rot, w: size[0], h: size[1] };
}

class Carrier {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.throttle = 0;   // 0..1, set by the thrust lines in update()
    this.flameLevel = 0; // smoothed throttle for the flames
    this.smoke = [];     // thruster smoke particles
    this.frame = 0;
    this.maxSpeed = 6.2;
    this.accel = 0.085;
    this.friction = 0.93;
    this.cargo = 0;
    this.maxCargo = 40000;
    this.weaponRange = 800;

    // Powerful player stats
    this.maxShield = 15000;
    this.shield = 15000;
    this.maxArmor = 3500;
    this.armor = 3500;
    this.maxStructure = 2000;
    this.structure = 2000;

    this.docked = false;
    this.className = 'Carrier';          // internal key (ShipArt, caps) - leave as is
    this.displayName = 'Siege Carrier';  // name shown in game
    this.type = 'ship';

    this.moduleLevels = {
      droneTether: 1,
      shieldExtender: 1,
      resistance: 1,
      propulsion: 1
    };

    this.currentTarget = null;
    this.particles = [];
    this.animTimer = 0;

    this.drones = [];
    for (let i = 0; i < 6; i++) {
      let initAngle = (Math.PI * 2 / 6) * i;
      let droneObj = new CombatFrigate(x + Math.cos(initAngle) * 200, y + Math.sin(initAngle) * 200);
      droneObj.docked = false;
      droneObj.slowFactor = 0.985;
      this.drones.push({
        ship: droneObj,
        orbitAngle: initAngle,
        targetEnemy: null,
        isDocked: false,
        dockingProgress: 0,
        launchSide: (i % 2 === 0) ? 1 : -1,
        stuckTimer: 0
      });
    }

    this.applyStats();
  }

  applyStats() {
    let dt = Number(this.moduleLevels.droneTether) || 1;
    let se = Number(this.moduleLevels.shieldExtender) || 1;
    let res = Number(this.moduleLevels.resistance) || 1;
    let pr = Number(this.moduleLevels.propulsion) || 1;

    // Drone tether levels 4 and up add 5% shield and 5% resistance each
    const tetherBonus = 0.05 * Math.max(0, dt - 3);
    let oldMax = this.maxShield;
    this.maxShield = 15000 * Math.pow(1.05, se - 1) * (1 + tetherBonus);
    if (oldMax > 0) {
      let ratio = this.shield / oldMax;
      this.shield = Math.min(this.maxShield, this.maxShield * ratio);
    } else {
      this.shield = this.maxShield;
    }

    this.maxSpeed = Math.min(window.STAT_CAPS.carrierSpeed, 1.65 + (pr - 1) * 0.15);
    this.damageResistance = Math.min(window.STAT_CAPS.carrierResistance, 0.15 + (res - 1) * 0.02 + tetherBonus);

    if (this.drones) {
      this.drones.forEach(d => {
        if (d.ship && d.ship.moduleLevels) {
          d.ship.moduleLevels.missiles = Math.min(4, dt * 1.5);
          if (typeof d.ship.applyStats === 'function') d.ship.applyStats();
        }
      });
    }
  }

  upgradeModule(modKey) {
    if (this.moduleLevels[modKey] < window.getCap(modKey, this.className)) {
      this.moduleLevels[modKey]++;
      this.applyStats();
    }
  }

  takeDamage(rawDmg) {
    let mitigated = rawDmg * (1.0 - this.damageResistance);

    if (this.shield > 0) {
      this.shield -= mitigated;
      if (this.shield < 0) {
        let overflow = -this.shield;
        this.shield = 0;
        this.armor -= overflow;
      }
    } else if (this.armor > 0) {
      this.armor -= mitigated;
      if (this.armor < 0) {
        let overflow = -this.armor;
        this.armor = 0;
        this.structure -= overflow;
      }
    } else {
      this.structure -= mitigated;
    }

    this.shield = Math.max(0, this.shield);
    this.armor = Math.max(0, this.armor);
    this.structure = Math.max(0, this.structure);
  }

  update(targetPos, targetEnemy, autoTargetStation, forceStop = false, enemyListRef = [], isAutoplayActive = false) {
    this.throttle = 0;
    this.frame = (this.frame || 0) + 1;
    this.animTimer += 0.08;
    if (this.docked) {
      this.currentTarget = null;
      return;
    }

    if (forceStop) {
      this.vx *= 0.75;
      this.vy *= 0.75;
    }

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 0.15) {
      for (let p = 0; p < 2; p++) {
        const rearDist = 210;
        const spread = (Math.random() - 0.5) * 20;
        const px = this.x - Math.cos(this.angle) * rearDist + Math.cos(this.angle + Math.PI / 2) * spread;
        const py = this.y - Math.sin(this.angle) * rearDist + Math.sin(this.angle + Math.PI / 2) * spread;

        this.particles.push({
          x: px,
          y: py,
          vx: -Math.cos(this.angle) * (1.3 + Math.random() * 2.3) + (Math.random() - 0.5) * 0.7,
          vy: -Math.sin(this.angle) * (1.3 + Math.random() * 2.3) + (Math.random() - 0.5) * 0.7,
          life: 1.0,
          size: 2.8 + Math.random() * 3.5,
          color: Math.random() > 0.4 ? '#f97316' : '#fbbf24'
        });
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.035;
      p.size *= 0.96;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this.drones) {
      let inCombat = false;
      
      if (targetEnemy && targetEnemy.structure > 0 && Math.hypot(targetEnemy.x - this.x, targetEnemy.y - this.y) <= this.weaponRange) {
        inCombat = true;
      } else if (window.centralStationBoss && window.centralStationBoss.structure > 0 && Math.hypot(window.centralStationBoss.x - this.x, window.centralStationBoss.y - this.y) <= this.weaponRange) {
        inCombat = true; 
      } else if (enemyListRef && enemyListRef.length > 0) {
        for (let e of enemyListRef) {
          let ent = e.ship || e;
          if (ent && ent.structure > 0 && Math.hypot(ent.x - this.x, ent.y - this.y) <= this.weaponRange) {
            inCombat = true;
            break;
          }
        }
      }

      for (let i = 0; i < this.drones.length; i++) {
        let entry = this.drones[i];
        if (!entry || !entry.ship) continue;
        let drone = entry.ship;

        const dockDist = 195;
        const predict = 22;
        const dockX = this.x + Math.cos(this.angle) * (dockDist + predict) + this.vx * 5;
        const dockY = this.y + Math.sin(this.angle) * (dockDist + predict) + this.vy * 5;

        if (inCombat) {
          if (entry.isDocked || entry.dockingProgress > 0) {
            entry.dockingProgress = Math.max(0, entry.dockingProgress - 0.045);
            entry.stuckTimer = 0;

            const progress = 1 - entry.dockingProgress;
            const arcAngle = this.angle + (entry.launchSide * 0.85) + (progress * entry.launchSide * 1.1);
            const arcDist = 30 + progress * 170;

            drone.x = dockX + Math.cos(arcAngle) * arcDist;
            drone.y = dockY + Math.sin(arcAngle) * arcDist;
            drone.angle = arcAngle;

            if (entry.dockingProgress <= 0) {
              entry.isDocked = false;
              entry.dockingProgress = 0;
              drone.vx = Math.cos(arcAngle) * 2.4;
              drone.vy = Math.sin(arcAngle) * 2.4;
            }
          }

          if (!entry.isDocked && entry.dockingProgress <= 0) {
            if (!entry.targetEnemy || entry.targetEnemy.structure <= 0 ||
                Math.hypot(entry.targetEnemy.x - this.x, entry.targetEnemy.y - this.y) > this.weaponRange) {
                
              if (targetEnemy && targetEnemy.structure > 0) {
                entry.targetEnemy = targetEnemy;
              } else if (window.centralStationBoss && window.centralStationBoss.structure > 0 && Math.hypot(window.centralStationBoss.x - this.x, window.centralStationBoss.y - this.y) <= this.weaponRange) {
                entry.targetEnemy = window.centralStationBoss;
              } else if (enemyListRef && enemyListRef.length > 0) {
                let valid = enemyListRef.filter(e => {
                  let ent = e.ship || e;
                  return ent && ent.structure > 0 && Math.hypot(ent.x - this.x, ent.y - this.y) <= this.weaponRange;
                });
                if (valid.length > 0) {
                  valid.sort((a, b) => {
                    let ea = a.ship || a;
                    let eb = b.ship || b;
                    return Math.hypot(ea.x - drone.x, ea.y - drone.y) - Math.hypot(eb.x - drone.x, eb.y - drone.y);
                  });
                  let chosen = valid[0];
                  entry.targetEnemy = chosen.ship || chosen;
                } else {
                    entry.targetEnemy = null;
                }
              } else {
                  entry.targetEnemy = null;
              }
            }

            const hasTarget = !!(entry.targetEnemy && entry.targetEnemy.structure > 0);
            const centre = hasTarget ? entry.targetEnemy : this;
            const droneRange = Math.min(drone.weaponRange || 550, drone.scramblerRange || 550);
            const ringR = hasTarget ? droneRange * 0.55 + i * 18 : 200 + i * 25;
            const dir = 1; 
            const orbitSpeed = Math.min(drone.maxSpeed * 0.6, 3.2);

            let rx = drone.x - centre.x, ry = drone.y - centre.y;
            let d = Math.hypot(rx, ry);
            if (d < 1) { rx = Math.cos(entry.orbitAngle); ry = Math.sin(entry.orbitAngle); d = 1; }
            const nx = rx / d, ny = ry / d;
            entry.orbitAngle = Math.atan2(ry, rx);

            const radialSpeed = Math.max(-orbitSpeed, Math.min(drone.maxSpeed * 0.9, (ringR - d) * 0.05));
            const tangentWeight = 1 - Math.min(1, Math.abs(d - ringR) / 150) * 0.8;
            const desVx = (centre.vx || 0) + (-ny * dir) * orbitSpeed * tangentWeight + nx * radialSpeed;
            const desVy = (centre.vy || 0) + ( nx * dir) * orbitSpeed * tangentWeight + ny * radialSpeed;

            let ax = desVx - drone.vx, ay = desVy - drone.vy;
            const am = Math.hypot(ax, ay), maxA = drone.accel || 0.28;
            if (am > maxA) { ax = ax / am * maxA; ay = ay / am * maxA; }
            drone.vx += ax;
            drone.vy += ay;
          }
        } else {
          entry.targetEnemy = null;

          if (!entry.isDocked) {
            const dx = dockX - drone.x;
            const dy = dockY - drone.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 120) {
              entry.stuckTimer += 1;
            } else {
              entry.stuckTimer = 0;
            }

            if (entry.stuckTimer > 90) {
              entry.isDocked = true;
              entry.dockingProgress = 1;
              entry.stuckTimer = 0;
            }

            if (dist > 55) {
              const side = entry.launchSide * 100;
              const approachX = dockX + Math.cos(this.angle + Math.PI / 2) * side;
              const approachY = dockY + Math.sin(this.angle + Math.PI / 2) * side;

              let ax = approachX - drone.x;
              let ay = approachY - drone.y;

              let targetAngle = Math.atan2(ay, ax);
              let angleDiff = targetAngle - drone.angle;
              while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
              while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
              drone.angle += angleDiff * 0.14;

              let thrust = Math.min(0.38, Math.hypot(ax, ay) * 0.028);
              drone.vx += Math.cos(drone.angle) * thrust;
              drone.vy += Math.sin(drone.angle) * thrust;
            } else {
              entry.dockingProgress = Math.min(1, entry.dockingProgress + 0.08);

              const forceMult = 1 + (entry.stuckTimer / 60);
              drone.vx += dx * 0.12 * forceMult;
              drone.vy += dy * 0.12 * forceMult;
              drone.vx += this.vx * 0.25;
              drone.vy += this.vy * 0.25;

              if (dist < 30) {
                drone.x += (dockX - drone.x) * 0.45;
                drone.y += (dockY - drone.y) * 0.45;
              }

              if (entry.dockingProgress >= 1 || dist < 12) {
                entry.isDocked = true;
                entry.dockingProgress = 1;
                entry.stuckTimer = 0;
              }
            }
          }
        }

        if (entry.isDocked) {
          drone.x = dockX;
          drone.y = dockY;
          drone.vx = this.vx;
          drone.vy = this.vy;
        }

        if (typeof drone.update === 'function' && !entry.isDocked) {
          const near = (ent) => ent && ent.structure > 0 &&
            Math.hypot(ent.x - this.x, ent.y - this.y) <= this.weaponRange * 1.25;
          let combatEnemies = [];
          if (inCombat) {
            combatEnemies = enemyListRef.map(e => e.ship || e).filter(near);
            if (near(targetEnemy) && !combatEnemies.includes(targetEnemy)) combatEnemies.push(targetEnemy);
            if (near(window.centralStationBoss)) combatEnemies.push(window.centralStationBoss);
          }
          drone.update(null, inCombat ? entry.targetEnemy : null, false, combatEnemies);
        }
      }
    }

    let destX = null, destY = null, isHolding = false;
    let activePrey = targetEnemy;
    
    // REMOVED ALL AUTOMATIC STATION PREY LOCKS: Station is completely optional to shoot, never forced.
    
    if (!activePrey && isAutoplayActive && enemyListRef && enemyListRef.length > 0) {
      let bd = Infinity;
      for (const e of enemyListRef) {
        let ent = e.ship || e;
        if (!ent || !(ent.structure > 0)) continue;
        const dd = Math.hypot(ent.x - this.x, ent.y - this.y);
        if (dd < bd) { bd = dd; activePrey = ent; }
      }
    }

    // A manual waypoint always takes priority over combat positioning.
    // The drones continue fighting while the Carrier follows the tapped destination.
    if (activePrey && !targetPos) {
      let distToTarget = Math.hypot(activePrey.x - this.x, activePrey.y - this.y);
      let idealStandoff = 350;
      let angleToTarget = Math.atan2(activePrey.y - this.y, activePrey.x - this.x);

      let turn = angleToTarget - this.angle;
      while (turn < -Math.PI) turn += Math.PI * 2;
      while (turn > Math.PI) turn -= Math.PI * 2;
      const maxTurn = 0.03;
      this.angle += Math.max(-maxTurn, Math.min(maxTurn, turn));
      const facing = Math.abs(turn) < 0.5;
      if (distToTarget > idealStandoff + 50) {
        if (facing) {
          this.vx += Math.cos(this.angle) * this.accel;
          this.throttle = 1;
          this.vy += Math.sin(this.angle) * this.accel;
        }
      } else if (distToTarget < idealStandoff - 30) {
        this.vx -= Math.cos(this.angle) * this.accel * 0.9;
        this.vy -= Math.sin(this.angle) * this.accel * 0.9;
      } else {
        this.vx *= 0.80;
        this.vy *= 0.80;
      }
    } else {
      // PURE MANUAL CONTROL ONLY: Station auto-maneuvers have been completely removed.
      if (targetPos) {
        let dx = targetPos.x - this.x, dy = targetPos.y - this.y;
        if (Math.hypot(dx, dy) > 25) { 
          destX = targetPos.x; 
          destY = targetPos.y; 
        } else { 
          isHolding = true; 
          this.vx *= 0.75; 
          this.vy *= 0.75; 
        }
      }

      if (!isHolding && destX !== null) {
        let dx = destX - this.x, dy = destY - this.y, dist = Math.hypot(dx, dy);
        if (dist > 5) {
          let targetAngle = Math.atan2(dy, dx), diff = targetAngle - this.angle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.angle += diff * 0.02;
          this.vx += Math.cos(this.angle) * this.accel;
          this.throttle = 1;
          this.vy += Math.sin(this.angle) * this.accel;
        }
      }
    }

    let speedNow = Math.hypot(this.vx, this.vy);
    if (speedNow > this.maxSpeed) {
      this.vx = (this.vx / speedNow) * this.maxSpeed;
      this.vy = (this.vy / speedNow) * this.maxSpeed;
    }
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.x += this.vx;
    this.y += this.vy;
  }

  cupWorld(fx, fy) {
    const { rot, w, h } = carrierArtInfo();
    const a = this.angle + rot;
    const lx = fx * w, ly = fy * h;
    const c = Math.cos(a), s = Math.sin(a);
    return {
      x: this.x + lx * c - ly * s,
      y: this.y + lx * s + ly * c,
      dx: -s, dy: c
    };
  }

  drawThrustersBack(ctx) {
    this.flameLevel = (this.flameLevel || 0) + (this.throttle - (this.flameLevel || 0)) * 0.15;
    const power = this.flameLevel;
    const t = this.frame || 0;
    if (!this.smoke) this.smoke = [];
    if (power < 0.03 && this.smoke.length === 0) return;

    if (power > 0.05 && this.smoke.length < 220) {
      CARRIER_CUPS.forEach(([fx, fy, size]) => {
        if (Math.random() > 0.3 + 0.5 * power) return;
        const p = this.cupWorld(fx, fy);
        const spd = 0.8 + Math.random() * 1.2 + power * 1.2;
        const side = (Math.random() - 0.5) * 0.5;
        this.smoke.push({
          x: p.x + p.dx * 18, y: p.y + p.dy * 18,
          vx: p.dx * spd - p.dy * side + this.vx * 0.3,
          vy: p.dy * spd + p.dx * side + this.vy * 0.3,
          r: (5 + Math.random() * 4) * size,
          grow: 0.28 + Math.random() * 0.2,
          life: 0,
          max: 45 + Math.random() * 35
        });
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.life++;
      if (p.life >= p.max) { this.smoke.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.97; p.vy *= 0.97;
      p.r += p.grow;
      const k = p.life / p.max;
      const a = (1 - k) * (1 - k) * 0.38;
      const r = Math.round(230 - 90 * k), g = Math.round(150 + 30 * k), b = Math.round(90 + 80 * k);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')');
      grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (power < 0.03) return;

    const { rot, w, h } = carrierArtInfo();
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + rot);
    ctx.globalCompositeOperation = 'lighter';
    CARRIER_CUPS.forEach(([fx, fy, size], i) => {
      const x = fx * w, y = fy * h;
      const flicker = 0.85 + 0.15 * Math.sin(t * 1.3 + i * 2.1) + Math.random() * 0.1;
      const len = (16 + 34 * power) * flicker * size + 6;
      const wd = 11 * size * (0.7 + 0.3 * power);
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(255,255,255,' + (power * 0.9) + ')');
      g.addColorStop(0.3, 'rgba(255,200,120,' + (power * 0.7) + ')');
      g.addColorStop(0.65, 'rgba(249,115,22,' + (power * 0.5) + ')');
      g.addColorStop(1, 'rgba(120,50,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - wd, y);
      ctx.quadraticCurveTo(x - wd * 0.8, y + len * 0.5, x, y + len);
      ctx.quadraticCurveTo(x + wd * 0.8, y + len * 0.5, x + wd, y);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  drawThrusters(ctx) {
    const power = Math.max(this.flameLevel || 0, 0.12);
    const t = this.frame || 0;
    const { rot, w, h } = carrierArtInfo();
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + rot);
    ctx.globalCompositeOperation = 'lighter';
    CARRIER_CUPS.forEach(([fx, fy, size], i) => {
      const x = fx * w, y = fy * h;
      const flicker = 0.9 + 0.1 * Math.sin(t * 0.9 + i * 1.7);
      const r = 13 * size;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, 'rgba(255,230,190,' + (0.6 * power * flicker) + ')');
      glow.addColorStop(0.5, 'rgba(251,146,60,' + (0.35 * power) + ')');
      glow.addColorStop(1, 'rgba(251,146,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = p.life * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    if (this.drones) {
      for (let d of this.drones) {
        if (d && d.ship && !d.isDocked) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(this.x, this.y);
          ctx.lineTo(d.ship.x, d.ship.y);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(this.x, this.y);
          ctx.lineTo(d.ship.x, d.ship.y);
          ctx.stroke();
        }
      }
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const pulse = 1 + Math.sin(this.animTimer * 0.7) * 0.08;
    ctx.globalAlpha = 0.11 + Math.sin(this.animTimer * 0.7) * 0.03;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 280 * pulse, 95 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.restore();

    this.drawThrustersBack(ctx);
    if (window.ShipArt) window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle);
    this.drawThrusters(ctx);

    if (this.drones) {
      for (let d of this.drones) {
        if (d && d.ship && !d.isDocked && typeof d.ship.draw === 'function') {
          d.ship.draw(ctx);
        }
      }
    }
  }
}
