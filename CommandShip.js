// CommandShip.js - Balanced Industrial Command Ship (3rd tier)
// Mining drone tuning
const COMMAND_SHIP_SCALE = 1.4;    // Hull size multiplier (1.4x larger command ship)
const COMMAND_DRONE_SCALE = 0.4;   // Drone size as a fraction of a full Mining Frigate
const COMMAND_DRONE_MUZZLE = 42;   // Mining Frigate laser muzzle scaled with drone
const COMMAND_DOCK_FORWARD = Math.round(30 * COMMAND_SHIP_SCALE); // Scaled docking point (42px)
const COMMAND_DRONE_CARGO = 200;   // Standardized cargo capacity per drone

class CommandShip {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.angle = 0;

        // Inertia & Turning Tuning
        this.angularVelocity = 0;
        this.turnAccel = 0.0035;
        this.angularFriction = 0.86;
        this.maxRotSpeed = 0.04;

        this.maxSpeed = 3.2;
        this.accel = 0.12;
        this.friction = 0.92;
        this.cargo = 0;
        this.maxCargo = 20000;
        this.laserRange = 350;
        this.miningPower = 2.5;
        this.shield = 1000;
        this.maxShield = 1000;
        this.armor = 800;
        this.maxArmor = 800;
        this.structure = 600;
        this.maxStructure = 600;
        this.docked = false;
        this.className = 'Command Ship';
        this.oreType = 'veldspar';
        this.type = 'ship';
        this.moduleLevels = { dronesTether: 1, tether: 1, miningRepairer: 1, shield: 1, cargo: 1, propulsion: 1 };
        this.currentTarget = null;
        this.particles = []; // Shared particle pool for flames, sparks, and soot
        this.animTimer = 0;

        this.dronesOut = false;
        this.drones = [];
        const numDrones = 5;
        for (let i = 0; i < numDrones; i++) {
            let initAngle = (Math.PI * 2 / numDrones) * i;
            let droneShip = new MiningFrigate(x, y);
            droneShip.docked = false;
            droneShip.maxCargo = COMMAND_DRONE_CARGO;
            droneShip.cargo = 0;
            this.drones.push({
                ship: droneShip,
                orbitAngle: initAngle,
                targetRock: null,
                isDocked: true,
                dockingProgress: 1,
                launchAngleOffset: (i - (numDrones - 1) / 2) * 0.45,
                approachOffset: (Math.PI * 2 / numDrones) * i,
                stuckTimer: 0
            });
        }
        this.applyStats();
    }

    applyStats() {
        let dt = Number(this.moduleLevels.dronesTether) || 1;
        let p = Number(this.moduleLevels.propulsion) || 1;
        let c = Number(this.moduleLevels.cargo) || 1;
        let s = Number(this.moduleLevels.shield) || 1;
        this.maxCargo = 12000 + (c - 1) * 2000;
        this.maxShield = 800 + (s - 1) * 200;
        this.miningPower = 2.5 + (dt - 1) * 0.8;
        this.maxSpeed = (3.0 + (p - 1) * 0.3) * (1.0 + (dt - 1) * 0.02);

        if (this.drones) {
            this.drones.forEach(d => {
                if (d.ship) {
                    d.ship.maxCargo = COMMAND_DRONE_CARGO;
                    if (d.ship.moduleLevels) {
                        d.ship.moduleLevels.laser = Math.min(5, dt);
                        d.ship.moduleLevels.propulsion = Math.min(5, p);
                        if (typeof d.ship.applyStats === 'function') d.ship.applyStats();
                    }
                    d.ship.maxCargo = COMMAND_DRONE_CARGO;
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

    update(targetPos, targetAst, autoTargetStation, forceStop = false, asteroidBeltRef = null) {
        this.animTimer += 0.08;
        this.currentTarget = (targetAst && targetAst.oreYield > 0) ? targetAst : null;
        if (this.docked) {
            this.currentTarget = null;
            return;
        }

        if (forceStop) {
            this.vx *= 0.80;
            this.vy *= 0.80;
        }

        // ---- Scaled Command Ship Gritty Thrusters ----
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > 0.1) {
            const cos = Math.cos(this.angle);
            const sin = Math.sin(this.angle);

            // Nozzles matched to command_ship.png. Art is 520px long drawn at 200 units (ShipArt) then scaled by
            // COMMAND_SHIP_SCALE, so the bell exits sit ~99 units behind centre before scaling. There are 5 main
            // nozzles, 24px apart in the art (about 13 units after scaling).
            const engineBack = Math.round(99 * COMMAND_SHIP_SCALE);
            const engineMounts = [-25, -13, 0, 13, 25];

            for (let offset of engineMounts) {
                const px = this.x - cos * engineBack - sin * offset;
                const py = this.y - sin * engineBack + cos * offset;

                // 1. Scaled Hot Core Flame
                this.particles.push({
                    type: 'flame',
                    x: px + (Math.random() - 0.5) * 4,
                    y: py + (Math.random() - 0.5) * 4,
                    vx: -cos * (2.4 + Math.random() * 2.8) + (Math.random() - 0.5) * 0.8,
                    vy: -sin * (2.4 + Math.random() * 2.8) + (Math.random() - 0.5) * 0.8,
                    size: 6 + Math.random() * 5,
                    alpha: 1.0,
                    decay: 0.10,
                    color: Math.random() > 0.4 ? '#ff6b00' : (Math.random() > 0.5 ? '#ffc738' : '#38bdf8')
                });

                // 2. Flying Ember Sparks
                if (Math.random() < 0.6) {
                    this.particles.push({
                        type: 'spark',
                        x: px,
                        y: py,
                        vx: -cos * (3.2 + Math.random() * 3.8) + (Math.random() - 0.5) * 1.5,
                        vy: -sin * (3.2 + Math.random() * 3.8) + (Math.random() - 0.5) * 1.5,
                        size: 1.5 + Math.random() * 1.8,
                        alpha: 1.0,
                        decay: 0.08 + Math.random() * 0.05,
                        color: Math.random() > 0.3 ? '#ffd24d' : '#ff4400'
                    });
                }

                // 3. Dense Industrial Soot & Rust Smoke
                if (Math.random() < 0.55) {
                    const isRust = Math.random() < 0.3;
                    this.particles.push({
                        type: 'soot',
                        x: px + (Math.random() - 0.5) * 8,
                        y: py + (Math.random() - 0.5) * 8,
                        vx: -cos * (0.6 + Math.random() * 1.0) + (Math.random() - 0.5) * 0.5,
                        vy: -sin * (0.6 + Math.random() * 1.0) + (Math.random() - 0.5) * 0.5,
                        size: 7 + Math.random() * 5,
                        grow: 0.45 + Math.random() * 0.35,
                        alpha: 0.45 + Math.random() * 0.25,
                        decay: 0.005 + Math.random() * 0.004,
                        baseColor: isRust ? 'rgba(55, 38, 28,' : 'rgba(30, 26, 22,'
                    });
                }
            }
        }

        let rocks = asteroidBeltRef && typeof asteroidBeltRef.getEntities === 'function' ? asteroidBeltRef.getEntities() : [];
        if (targetAst && targetAst.oreYield > 0 && !rocks.includes(targetAst)) {
            rocks.push(targetAst);
        }

        // Drone tuning
        const laser = this.laserRange || 350;
        const parkDist = laser * 0.80;
        const RECALL_RANGE = 900;
        const N = this.drones.length || 1;

        const mineableRocks = rocks.filter(r => r.oreYield > 0 && Math.hypot(r.x - this.x, r.y - this.y) <= RECALL_RANGE);
        this.dronesOut = mineableRocks.length > 0;

        const cruise = (this.accel * this.friction) / (1 - this.friction);
        const droneSpeed = Math.min(this.maxSpeed * 0.85, cruise * 0.9);
        const DRONE_ACCEL = 0.06, DRONE_FRICTION = 0.94;

        const dockX = this.x + Math.cos(this.angle) * COMMAND_DOCK_FORWARD;
        const dockY = this.y + Math.sin(this.angle) * COMMAND_DOCK_FORWARD;

        for (let i = 0; i < this.drones.length; i++) {
            const entry = this.drones[i];
            const dr = entry.ship;
            if (!dr) continue;

            // ---- Drone Gritty Thruster Trail ----
            const drSpeed = Math.hypot(dr.vx, dr.vy);
            if (!entry.isDocked && drSpeed > 0.15) {
                const dCos = Math.cos(dr.angle);
                const dSin = Math.sin(dr.angle);
                const dMounts = [-5, 5];

                for (let offset of dMounts) {
                    const px = dr.x - dCos * 11 - dSin * offset * 0.4;
                    const py = dr.y - dSin * 11 + dCos * offset * 0.4;

                    this.particles.push({
                        type: 'flame',
                        x: px,
                        y: py,
                        vx: -dCos * (1.4 + Math.random() * 1.5),
                        vy: -dSin * (1.4 + Math.random() * 1.5),
                        size: 2.2 + Math.random() * 1.8,
                        alpha: 0.95,
                        decay: 0.14,
                        color: Math.random() > 0.4 ? '#ff7700' : '#38d8ff'
                    });

                    if (Math.random() < 0.4) {
                        this.particles.push({
                            type: 'soot',
                            x: px,
                            y: py,
                            vx: -dCos * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.3,
                            vy: -dSin * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.3,
                            size: 3 + Math.random() * 2.5,
                            grow: 0.22 + Math.random() * 0.2,
                            alpha: 0.35 + Math.random() * 0.2,
                            decay: 0.008 + Math.random() * 0.005,
                            baseColor: 'rgba(32, 28, 24,'
                        });
                    }
                }
            }

            const maxC = dr.maxCargo || COMMAND_DRONE_CARGO;
            const full = (dr.cargo || 0) >= maxC;
            dr.miningPower = 0;
            dr.currentTarget = null;
            entry.mining = false;

            if (full || (entry.targetRock && (entry.targetRock.oreYield <= 0 ||
                Math.hypot(entry.targetRock.x - this.x, entry.targetRock.y - this.y) > RECALL_RANGE))) {
                entry.targetRock = null;
            }

            if (!full && !entry.targetRock && mineableRocks.length > 0) {
                const taken = new Set(this.drones.map(d => d.targetRock).filter(Boolean));
                const pick = mineableRocks.find(r => !taken.has(r)) || mineableRocks[0];
                if (pick) entry.targetRock = pick;
            }

            const needDock = full || !entry.targetRock;

            // Drone separation force
            for (let j = 0; j < this.drones.length; j++) {
                if (i === j) continue;
                const otherEntry = this.drones[j];
                const otherDr = otherEntry && otherEntry.ship;
                if (!otherDr || otherEntry.isDocked) continue;
                const distOther = Math.hypot(dr.x - otherDr.x, dr.y - otherDr.y);
                if (distOther < 34 && distOther > 0.1) {
                    const repel = (34 - distOther) * 0.08;
                    const angOther = Math.atan2(dr.y - otherDr.y, dr.x - otherDr.x);
                    dr.vx += Math.cos(angOther) * repel;
                    dr.vy += Math.sin(angOther) * repel;
                }
            }

            if (entry.isDocked && needDock) {
                // In hangar: deposit ore
                dr.x = dockX; dr.y = dockY; dr.vx = this.vx; dr.vy = this.vy;
                if ((dr.cargo || 0) > 0) {
                    const spaceLeft = (this.maxCargo || 20000) - (this.cargo || 0);
                    const transfer = Math.min(dr.cargo, spaceLeft);
                    if (transfer > 0) {
                        if (window.addOreToCargo) window.addOreToCargo(this, dr.oreType || 'veldspar', transfer);
                        else this.cargo += transfer;
                        dr.cargo -= transfer;
                    }
                }
            } else if ((entry.isDocked || entry.dockingProgress > 0) && !needDock) {
                // Launch sequence: clearance distance adjusted for larger hull
                entry.dockingProgress = Math.max(0, entry.dockingProgress - 0.05);
                entry.stuckTimer = 0;
                const progress = 1 - entry.dockingProgress;
                const arcAngle = this.angle + entry.launchAngleOffset;
                const arcDist = 30 + progress * 160;
                dr.x = dockX + Math.cos(arcAngle) * arcDist;
                dr.y = dockY + Math.sin(arcAngle) * arcDist;
                dr.angle = arcAngle;
                dr.vx = this.vx; dr.vy = this.vy;
                if (entry.dockingProgress <= 0) {
                    entry.isDocked = false;
                    dr.vx = this.vx + Math.cos(arcAngle) * droneSpeed;
                    dr.vy = this.vy + Math.sin(arcAngle) * droneSpeed;
                }
            } else if (needDock) {
                // Return to ship
                const dx = dockX - dr.x, dy = dockY - dr.y;
                const dist = Math.hypot(dx, dy);
                entry.stuckTimer = dist < 90 ? entry.stuckTimer + 1 : 0;
                if (entry.stuckTimer > 90) {
                    entry.isDocked = true; entry.dockingProgress = 1; entry.stuckTimer = 0;
                } else if (dist > 75) {
                    const gx = dockX + Math.cos(this.angle + entry.launchAngleOffset) * 75;
                    const gy = dockY + Math.sin(this.angle + entry.launchAngleOffset) * 75;
                    this._steerDrone(dr, gx, gy, this.vx, this.vy, droneSpeed, 0.04, DRONE_ACCEL, DRONE_FRICTION);
                } else {
                    entry.dockingProgress = Math.min(1, entry.dockingProgress + 0.08);
                    this._steerDrone(dr, dockX, dockY, this.vx, this.vy, droneSpeed, 0.06, DRONE_ACCEL * 2, DRONE_FRICTION);
                    if (entry.dockingProgress >= 1 || Math.hypot(dockX - dr.x, dockY - dr.y) < 16) {
                        entry.isDocked = true; entry.dockingProgress = 1; entry.stuckTimer = 0;
                    }
                }
                const sp = Math.hypot(dr.vx, dr.vy);
                if (!entry.isDocked && sp > 0.1) {
                    let diff = Math.atan2(dr.vy, dr.vx) - dr.angle;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    dr.angle += diff * 0.15;
                }
            } else {
                // Active mining ring
                const rock = entry.targetRock;
                let mining = false;
                if (rock) {
                    const slotAngle = (Math.PI * 2 / N) * i;
                    const gx = rock.x + Math.cos(slotAngle) * parkDist;
                    const gy = rock.y + Math.sin(slotAngle) * parkDist;
                    this._steerDrone(dr, gx, gy, 0, 0, droneSpeed, 0.04, DRONE_ACCEL, DRONE_FRICTION);
                    mining = Math.hypot(rock.x - dr.x, rock.y - dr.y) <= laser;
                }

                const sp = Math.hypot(dr.vx, dr.vy);
                let want = null;
                if (mining && sp < 0.3) want = Math.atan2(rock.y - dr.y, rock.x - dr.x);
                else if (sp > 0.1) want = Math.atan2(dr.vy, dr.vx);
                if (want !== null) {
                    let diff = want - dr.angle;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    dr.angle += diff * 0.15;
                }

                dr.currentTarget = mining ? rock : null;
                entry.mining = mining;
                if (mining) {
                    const amt = Math.min((this.miningPower || 2.5) / N, rock.oreYield);
                    rock.oreYield -= amt;
                    dr.cargo = Math.min(maxC, (dr.cargo || 0) + amt);
                    dr.oreType = rock.oreType || 'veldspar';
                }
            }
        }

        // Command Ship Steering
        let destX = null, destY = null, isHolding = false;
        if (autoTargetStation) {
            destX = autoTargetStation.x; destY = autoTargetStation.y;
        } else if (targetPos) {
            let dx = targetPos.x - this.x, dy = targetPos.y - this.y;
            if (Math.hypot(dx, dy) > 25) { destX = targetPos.x; destY = targetPos.y; }
            else { isHolding = true; }
        } else if (targetAst) {
            let dx = targetAst.x - this.x, dy = targetAst.y - this.y, dist = Math.hypot(dx, dy);
            if (dist > 350) {
                let a = Math.atan2(dy, dx);
                destX = targetAst.x - Math.cos(a) * 350;
                destY = targetAst.y - Math.sin(a) * 350;
            } else { isHolding = true; }
        }

        if (!isHolding && destX !== null) {
            let dx = destX - this.x, dy = destY - this.y, dist = Math.hypot(dx, dy);
            if (dist > 5) {
                let targetAngle = Math.atan2(dy, dx), diff = targetAngle - this.angle;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;

                let turnDir = Math.sign(diff);
                if (Math.abs(diff) > 0.02) {
                    this.angularVelocity += turnDir * this.turnAccel;
                }

                this.vx += Math.cos(this.angle) * this.accel;
                this.vy += Math.sin(this.angle) * this.accel;
            }
        }

        this.angularVelocity = Math.max(-this.maxRotSpeed, Math.min(this.maxRotSpeed, this.angularVelocity));
        this.angle += this.angularVelocity;
        this.angularVelocity *= this.angularFriction;

        if (speed > this.maxSpeed) {
            this.vx = (this.vx / speed) * this.maxSpeed;
            this.vy = (this.vy / speed) * this.maxSpeed;
        }
        this.vx *= this.friction;
        this.vy *= this.friction;
        this.x += this.vx;
        this.y += this.vy;

        // ---- Update Particles ----
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.95;
            p.vy *= 0.95;
            p.alpha -= p.decay;
            if (p.grow) p.size += p.grow;
            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
            }
        }
        if (this.particles.length > 550) {
            this.particles.splice(0, this.particles.length - 550);
        }
    }

    _moveDrone(dr, desVx, desVy, maxA, fric) {
        let ax = desVx / fric - dr.vx, ay = desVy / fric - dr.vy;
        const am = Math.hypot(ax, ay);
        if (am > maxA) { ax = ax / am * maxA; ay = ay / am * maxA; }
        dr.vx = (dr.vx + ax) * fric;
        dr.vy = (dr.vy + ay) * fric;
        dr.x += dr.vx;
        dr.y += dr.vy;
    }

    _steerDrone(dr, gx, gy, baseVx, baseVy, cruise, gain, maxA, fric) {
        const dx = gx - dr.x, dy = gy - dr.y;
        const dist = Math.hypot(dx, dy);
        const want = dist > 0.5 ? Math.min(cruise, dist * gain) : 0;
        const ux = dist > 0.5 ? dx / dist : 0, uy = dist > 0.5 ? dy / dist : 0;
        this._moveDrone(dr, baseVx + ux * want, baseVy + uy * want, maxA, fric);
    }

    drawDrone(ctx, entry) {
        const d = entry && entry.ship;
        if (!d || entry.isDocked) return;
        const k = COMMAND_DRONE_SCALE;

        // Laser beam
        if (entry.mining && d.currentTarget && d.currentTarget.oreYield > 0) {
            const t = d.currentTarget;
            const mx = d.x + Math.cos(d.angle) * COMMAND_DRONE_MUZZLE * k;
            const my = d.y + Math.sin(d.angle) * COMMAND_DRONE_MUZZLE * k;
            ctx.save();
            ctx.strokeStyle = 'rgba(63, 185, 80, 0.4)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(t.x, t.y); ctx.stroke();
            ctx.strokeStyle = '#3fb950';
            ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(t.x, t.y); ctx.stroke();
            ctx.restore();
        }

        // Transfer tether on return
        if (entry.dockingProgress > 0 && (d.cargo || 0) > 0) {
            const dockX = this.x + Math.cos(this.angle) * COMMAND_DOCK_FORWARD;
            const dockY = this.y + Math.sin(this.angle) * COMMAND_DOCK_FORWARD;
            ctx.save();
            ctx.strokeStyle = 'rgba(56, 216, 255, 0.5)';
            ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(dockX, dockY); ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.scale(k, k);
        ctx.translate(-d.x, -d.y);
        if (window.ShipArt) {
            window.ShipArt.draw(ctx, d.className, d.x, d.y, d.angle);
        } else {
            ctx.translate(d.x, d.y);
            ctx.rotate(d.angle);
            ctx.fillStyle = '#58a6ff';
            ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(-30, -25); ctx.lineTo(-30, 25); ctx.closePath(); ctx.fill();
        }
        ctx.restore();

        // Cargo HUD Text
        if (entry.mining || (d.cargo && d.cargo > 0)) {
            const maxC = d.maxCargo || COMMAND_DRONE_CARGO;
            const pct = Math.min(100, Math.floor(((d.cargo || 0) / maxC) * 100));
            ctx.save();
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#000000';
            ctx.fillText(pct + '%', d.x + 1, d.y - 19);
            ctx.fillStyle = pct >= 100 ? '#ff5555' : '#38d8ff';
            ctx.fillText(pct + '%', d.x, d.y - 20);
            ctx.restore();
        }
    }

    draw(ctx, asteroidBeltRef) {
        // ---- Render Gritty Exhaust & Smoke Particles ----
        if (this.particles && this.particles.length > 0) {
            ctx.save();
            for (const p of this.particles) {
                const alpha = Math.max(0, p.alpha);
                if (p.type === 'soot') {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = p.baseColor + alpha.toFixed(3) + ')';
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === 'flame') {
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === 'spark') {
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = alpha;
                    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                }
            }
            ctx.restore();
        }

        const speed = Math.hypot(this.vx, this.vy);
        const power = speed > 0.1 ? Math.min(1, speed / (this.maxSpeed || 1)) : 0;

        // Render Command Ship scaled 1.4x around its center position
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(COMMAND_SHIP_SCALE, COMMAND_SHIP_SCALE);
        ctx.translate(-this.x, -this.y);

        if (window.ShipArt) {
            window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle, power);
        } else {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#1e3a8a';
            ctx.beginPath();
            ctx.moveTo(100, 0); ctx.lineTo(-100, -70); ctx.lineTo(-100, 70);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();

        // Draw drones (unscaled so they retain their proportional drone size)
        if (this.drones) {
            for (let d of this.drones) this.drawDrone(ctx, d);
        }
    }
}
