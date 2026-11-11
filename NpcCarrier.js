// NpcCarrier.js - Uses exact player Carrier graphics/mechanics with active drone combat targeting against the player
class NpcCarrier {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.maxSpeed = 2.2;
    this.accel = 0.085;
    this.friction = 0.93;
    this.cargo = 0;
    this.maxCargo = 40000;
    this.weaponRange = 800;

    this.maxShield = 10000;
    this.shield = 10000;
    this.maxArmor = 8000;
    this.armor = 8000;
    this.maxStructure = 4000;
    this.structure = 4000;

    this.docked = false;
    this.className = 'Carrier';
    this.type = 'ship';

    this.moduleLevels = {
      droneTether: 1,
      shieldExtender: 1,
      resistance: 1,
      jumpDrive: 1,
      propulsion: 1,
      laser: 1,
      shield: 1,
      cargo: 1
    };

    this.currentTarget = null;
    this.particles = [];
    this.animTimer = 0;

    this.sprite = new Image();
    this.sprite.src = 'images/nidhoggur_topdown.png';

    // 6 drones deployed with balanced missile damage
    this.drones = [];
    for (let i = 0; i < 6; i++) {
      let initAngle = (Math.PI * 2 / 6) * i;
      let droneObj = new CombatFrigate(x + Math.cos(initAngle) * 200, y + Math.sin(initAngle) * 200);
      droneObj.docked = false;
      droneObj.missileDamage = 5; // Balanced damage per drone so the swarm poses a real threat
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
    this.maxSpeed = 1.65;
    this.damageResistance = 0.15;
  }

  upgradeModule(modKey) { }

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
              entry.targetEnemy = targetEnemy && targetEnemy.structure > 0 ? targetEnemy : null;

              if (!entry.targetEnemy && enemyListRef && enemyListRef.length > 0) {
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
                }
              }
            }

            const hasTarget = !!(entry.targetEnemy && entry.targetEnemy.structure > 0);
            const centre = hasTarget ? entry.targetEnemy : this;
            const droneRange = Math.min(drone.weaponRange || 550, drone.scramblerRange || 550);
            const ringR = hasTarget ? droneRange * 0.55 + i * 18 : 200 + i * 25;
            const dir = entry.launchSide;
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
            if (typeof playerShip !== 'undefined' && playerShip && !playerShip.docked && near(playerShip) &&
                !combatEnemies.includes(playerShip)) combatEnemies.push(playerShip);
          }
          // Drone missiles at 80% of a level-1 player Carrier drone, times this ship's damage scale
          // (0.2 for belt ships, GUARD_DMG_SCALE for station guards)
          drone.missileDamage = 19 * 0.8 * (this.npcDamageScale || 1);
          drone.update(null, inCombat ? entry.targetEnemy : null, false, combatEnemies);
        }
      }
    }

    let activePrey = targetEnemy;
    if (!activePrey && isAutoplayActive && enemyListRef && enemyListRef.length > 0) {
      let bd = Infinity;
      for (const e of enemyListRef) {
        let ent = e.ship || e;
        if (!ent || !(ent.structure > 0)) continue;
        const dd = Math.hypot(ent.x - this.x, ent.y - this.y);
        if (dd < bd) { bd = dd; activePrey = ent; }
      }
    }

    if (activePrey) {
      let distToTarget = Math.hypot(activePrey.x - this.x, activePrey.y - this.y);
      let idealStandoff = 350;
      let angleToTarget = Math.atan2(activePrey.y - this.y, activePrey.x - this.x);

      // (heading is set by PublicNpcManager: it faces the direction of travel, so no snapping to the target here)
      if (distToTarget > idealStandoff + 50) {
        this.vx += Math.cos(angleToTarget) * this.accel;
        this.vy += Math.sin(angleToTarget) * this.accel;
      } else if (distToTarget < idealStandoff - 30) {
        this.vx -= Math.cos(angleToTarget) * this.accel * 0.9;
        this.vy -= Math.sin(angleToTarget) * this.accel * 0.9;
      } else {
        this.vx *= 0.80;
        this.vy *= 0.80;
      }
    } else {
      if (autoTargetStation) {
        let dx = autoTargetStation.x - this.x, dy = autoTargetStation.y - this.y;
        if (Math.hypot(dx, dy) > 5) {
          let targetAngle = Math.atan2(dy, dx), diff = targetAngle - this.angle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.angle += diff * 0.02;
          this.vx += Math.cos(this.angle) * this.accel;
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
          ctx.strokeStyle = 'rgba(248, 81, 73, 0.45)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(this.x, this.y);
          ctx.lineTo(d.ship.x, d.ship.y);
          ctx.stroke();
        }
      }
    }

    // Blue engine glow behind the hull
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const pulse = 1 + Math.sin(this.animTimer * 0.7) * 0.08;
    ctx.globalAlpha = 0.11 + Math.sin(this.animTimer * 0.7) * 0.03;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 280 * pulse, 95 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Same hull art as the player's Carrier
    window.ShipArt.draw(ctx, 'Carrier', this.x, this.y, this.angle);

    if (this.drones) {
      for (let d of this.drones) {
        if (d && d.ship && !d.isDocked && typeof d.ship.draw === 'function') {
          d.ship.draw(ctx);
        }
      }
    }
  }

  // Original hand-drawn hull (no longer used)
  drawHandDrawn(ctx) {
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
          ctx.strokeStyle = 'rgba(248, 81, 73, 0.45)';
          ctx.lineWidth = 2;
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

    ctx.rotate(-Math.PI / 2);

    ctx.fillStyle = '#1a1512';
    ctx.strokeStyle = '#3a2e28';
    ctx.lineWidth = 1.8;

    ctx.beginPath();
    ctx.moveTo( 0, -215);
    ctx.lineTo( 16, -190);
    ctx.lineTo( 24, -160);
    ctx.lineTo( 30, -125);
    ctx.lineTo( 36, -85);
    ctx.lineTo( 40, -45);
    ctx.lineTo( 44, -5);
    ctx.lineTo( 48, 35);
    ctx.lineTo( 52, 75);
    ctx.lineTo( 56, 115);
    ctx.lineTo( 60, 150);
    ctx.lineTo( 58, 175);
    ctx.lineTo( 48, 195);
    ctx.lineTo( 32, 210);
    ctx.lineTo( 42, 228);
    ctx.lineTo( 28, 242);
    ctx.lineTo( 14, 230);
    ctx.lineTo( 6, 218);
    ctx.lineTo( 0, 222);
    ctx.lineTo( -6, 218);
    ctx.lineTo(-14, 230);
    ctx.lineTo(-28, 242);
    ctx.lineTo(-42, 228);
    ctx.lineTo(-32, 210);
    ctx.lineTo(-48, 195);
    ctx.lineTo(-58, 175);
    ctx.lineTo(-60, 150);
    ctx.lineTo(-56, 115);
    ctx.lineTo(-52, 75);
    ctx.lineTo(-48, 35);
    ctx.lineTo(-44, -5);
    ctx.lineTo(-40, -45);
    ctx.lineTo(-36, -85);
    ctx.lineTo(-30, -125);
    ctx.lineTo(-24, -160);
    ctx.lineTo(-16, -190);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#221c18';
    ctx.beginPath();
    ctx.moveTo( 16, 155);
    ctx.lineTo( 34, 155);
    ctx.lineTo( 38, 190);
    ctx.lineTo( 30, 215);
    ctx.lineTo( 16, 200);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-16, 155);
    ctx.lineTo(-34, 155);
    ctx.lineTo(-38, 190);
    ctx.lineTo(-30, 215);
    ctx.lineTo(-16, 200);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1e1915';
    ctx.beginPath();
    ctx.moveTo( 34, 25);
    ctx.lineTo( 50, -5);
    ctx.lineTo( 48, -50);
    ctx.lineTo( 28, -65);
    ctx.lineTo(-28, -65);
    ctx.lineTo(-48, -50);
    ctx.lineTo(-50, -5);
    ctx.lineTo(-34, 25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1c1713';
    ctx.beginPath();
    ctx.moveTo( 36, -95);
    ctx.lineTo( 82, -112);
    ctx.lineTo( 76, -145);
    ctx.lineTo( 34, -135);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-36, -95);
    ctx.lineTo(-82, -112);
    ctx.lineTo(-76, -145);
    ctx.lineTo(-34, -135);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo( 32, -155);
    ctx.lineTo( 60, -168);
    ctx.lineTo( 55, -188);
    ctx.lineTo( 28, -178);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-32, -155);
    ctx.lineTo(-60, -168);
    ctx.lineTo(-55, -188);
    ctx.lineTo(-28, -178);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const lights = [
      [ 26, 185], [-26, 185],
      [ 20, 160], [-20, 160],
      [ 42, 95], [-42, 95],
      [ 46, 50], [-46, 50],
      [ 44, 5], [-44, 5],
      [ 40, -35], [-40, -35],
      [ 36, -75], [-36, -75],
      [ 30, -115], [-30, -115],
      [ 24, -155], [-24, -155],
      [ 12, -195], [-12, -195]
    ];

    ctx.fillStyle = '#facc15';
    lights.forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(lx, ly, 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.ellipse(0, -215, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.restore();

    if (this.drones) {
      for (let d of this.drones) {
        if (d && d.ship && !d.isDocked && typeof d.ship.draw === 'function') {
          d.ship.draw(ctx);
        }
      }
    }
  }
}
