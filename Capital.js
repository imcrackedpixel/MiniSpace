// Capital.js - Heavy Industrial Capital Ship (Command-Ship drone logic, Mining Barge drones)
const CAPITAL_THRUSTER_LAYOUT = [
 { back: 0.926, y: -0.188, s: 1.0 },
 { back: 0.885, y: 0, s: 1.3 },
 { back: 0.926, y: 0.188, s: 1.0 },
 { back: 0.742, y: -0.35, s: 0.8 },
 { back: 0.742, y: 0.35, s: 0.8 }
];

const CAPITAL_EXHAUST_SCALE = 1.8;
const CAPITAL_DOCK_FORWARD = -140; // Moved back to the yellow highlighted hangar bay at the rear!
const CAPITAL_DRONE_FALLBACK_CARGO = 200;
const CAPITAL_SHOW_TETHERS = false;
const CAPITAL_SHOW_ANCHOR_BEAMS = false;

// Transport Capital sprite is drawn 480 units long (ShipArt.js). Engines are at the rear of the art.
// back = units behind ship center, y = units to the side, s = flame size
const TRANSPORT_THRUSTER_LAYOUT = [
 { back: 169, y: -21, s: 1.0 },
 { back: 169, y: 21, s: 1.0 },
 { back: 158, y: -64, s: 0.8 },
 { back: 158, y: 64, s: 0.8 }
];

function getCapitalThrusters(className) {
 if (className === 'Transport Capital') return TRANSPORT_THRUSTER_LAYOUT.map(t => ({ back: t.back, y: t.y, s: t.s }));
 const hh = 460 / 2;
 const hw = 170 / 2;
 const k = hh / 256;
 return CAPITAL_THRUSTER_LAYOUT.map(t => ({ back: t.back * hh, y: t.y * hw, s: t.s * k }));
}

function getCapitalScaleK() {
 return 460 / 512;
}

// Spread-out drone spacing: a drone won't claim a rock within this distance of another drone's rock
const DRONE_ROCK_SPACING = 180;

class CapitalShip {
 constructor(x, y) {
 this.x = x;
 this.y = y;
 this.vx = 0;
 this.vy = 0;
 this.angle = 0;
 this.maxSpeed = 4.0;
 this.accel = 0.06;
 this.friction = 0.94;
 this.cargo = 0;
 this.maxCargo = 100000;
 this.laserRange = 1100;
 this.miningPower = 0;
 this.shield = 6000;
 this.maxShield = 6000;
 this.armor = 8000;
 this.maxArmor = 8000;
 this.structure = 10000;
 this.maxStructure = 10000;
 this.docked = false;
 this.className = 'Mining Capital';
 this.oreType = 'veldspar';
 this.type = 'ship';
 this.isAnchored = false;
 this.cooldownTimer = 0;

 this.moduleLevels = {
 laser: 1,
 shield: 1,
 cargo: 1,
 propulsion: 1,
 siegeCore: 1
 };
 this.currentTarget = null;
 this.particles = [];
 this.maxParticles = 550;
 this.animTimer = 0;

 this.drones = [];
 const numDrones = 5;
 for (let i = 0; i < numDrones; i++) {
 const droneShip = new MiningBarge(x, y);
 droneShip.docked = false;
 droneShip.cargo = 0;
 this.drones.push({
 ship: droneShip,
 isDocked: true,
 dockingProgress: 1,
 launchAngleOffset: (i - (numDrones - 1) / 2) * 0.45,
 targetRock: null,
 mining: false,
 stuckTimer: 0
 });
 }

 this.applyStats();
 }

 applyStats() {
 const l = Number(this.moduleLevels.laser) || 1;
 const s = Number(this.moduleLevels.shield) || 1;
 const c = Number(this.moduleLevels.cargo) || 1;
 const p = Number(this.moduleLevels.propulsion) || 1;

 this.maxCargo = 100000 + (c - 1) * 35000;
 this.maxShield = 6000 + (s - 1) * 1200;
 this.shield = this.maxShield;
 this.maxSpeed = this.isAnchored ? 0 : (1.0 + (p - 1) * 0.1);
 this.accel = 0.06 * (1 + (p - 1) * 0.1);
 this.laserRange = 1100 + (l - 1) * 120;
 this.miningPower = 6 + (l - 1) * 1.5;

 if (this.drones) {
 this.drones.forEach(d => {
 if (d.ship && d.ship.moduleLevels) {
 d.ship.moduleLevels.laser = Math.min(5, l);
 d.ship.moduleLevels.propulsion = Math.min(5, p);
 if (typeof d.ship.applyStats === 'function') d.ship.applyStats();
 }
 });
 }
 }

 toggleIndustrialCore() {
 if (this.cooldownTimer > 0) return;
 this.isAnchored = !this.isAnchored;
 if (!this.isAnchored) {
 this.cooldownTimer = 300;
 } else {
 this.maxSpeed = 0;
 this.vx = 0;
 this.vy = 0;
 }
 this.applyStats();
 }

 upgradeModule(modKey) {
 if (this.moduleLevels[modKey] < 5) {
 this.moduleLevels[modKey]++;
 this.applyStats();
 }
 }

 takeDamage(rawDmg) {
 let dmg = rawDmg * (1.0 - (this.damageResistance || 0));
 if (this.shield > 0) {
 this.shield -= dmg;
 if (this.shield < 0) { dmg = -this.shield; this.shield = 0; } else { dmg = 0; }
 }
 if (dmg > 0 && this.armor > 0) {
 this.armor -= dmg;
 if (this.armor < 0) { dmg = -this.armor; this.armor = 0; } else { dmg = 0; }
 }
 if (dmg > 0) this.structure -= dmg;
 this.shield = Math.max(0, this.shield);
 this.armor = Math.max(0, this.armor);
 this.structure = Math.max(0, this.structure);
 }

 emitThrusters() {
 const speed = Math.hypot(this.vx, this.vy);
 if (speed < 0.1 || this.docked || this.isAnchored) return;

 const cos = Math.cos(this.angle);
 const sin = Math.sin(this.angle);

 for (const t of getCapitalThrusters(this.className)) {
 const px = this.x - cos * t.back + sin * t.y;
 const py = this.y - sin * t.back - cos * t.y;
 const f = t.s * CAPITAL_EXHAUST_SCALE;

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

 _moveDrone(dr, desVx, desVy, maxA, fric) {
 let ax = desVx / fric - dr.vx, ay = desVy / fric - dr.vy;
 const am = Math.hypot(ax, ay);
 if (am > maxA) { ax = ax / am * maxA; ay = ay / am * maxA; }
 dr.vx = (dr.vx + ax) * fric;
 dr.vy = (dr.vy + ay) * fric;
 dr.x += dr.vx;
 dr.y += dr.vy;
 }

 _steerDrone(dr, gx, gy, cruise, accel, fric) {
 const dx = gx - dr.x, dy = gy - dr.y;
 const dist = Math.hypot(dx, dy);
 if (dist > 2) {
 const a = Math.atan2(dy, dx);
 dr.vx += Math.cos(a) * accel;
 dr.vy += Math.sin(a) * accel;
 }
 const speed = Math.hypot(dr.vx, dr.vy);
 if (speed > cruise) {
 dr.vx = (dr.vx / speed) * cruise;
 dr.vy = (dr.vy / speed) * cruise;
 }
 dr.vx *= fric;
 dr.vy *= fric;
 dr.x += dr.vx;
 dr.y += dr.vy;

 if (speed > 0.2) {
 const want = Math.atan2(dr.vy, dr.vx);
 let diff = want - dr.angle;
 while (diff < -Math.PI) diff += Math.PI * 2;
 while (diff > Math.PI) diff -= Math.PI * 2;
 dr.angle += diff * 0.15;
 }
 }

 // Picks the closest mineable rock to the capital that no other drone is already on (or near).
 // Falls back to the closest rock overall if every rock is taken, so drones never sit idle.
 _pickDroneRock(entry, mineable) {
 const others = this.drones
 .filter(d => d !== entry && d.targetRock)
 .map(d => d.targetRock);
 let best = null, bestD = Infinity;
 let fallback = null, fallbackD = Infinity;
 for (const r of mineable) {
 const d = Math.hypot(r.x - this.x, r.y - this.y);
 if (d < fallbackD) { fallbackD = d; fallback = r; }
 const crowded = others.some(o => o === r || Math.hypot(o.x - r.x, o.y - r.y) < DRONE_ROCK_SPACING);
 if (!crowded && d < bestD) { bestD = d; best = r; }
 }
 return best || fallback;
 }

 updateDrones(rocks, canMine) {
 const laser = this.laserRange;
 const N = this.drones.length || 1;
 const mineable = canMine
 ? rocks.filter(r => r.oreYield > 0 && Math.hypot(r.x - this.x, r.y - this.y) <= laser + 300)
 : [];

 // Compute dock position matching the bottom rear bay coordinates relative to ship heading
 const dockX = this.x - Math.cos(this.angle) * CAPITAL_DOCK_FORWARD;
 const dockY = this.y - Math.sin(this.angle) * CAPITAL_DOCK_FORWARD;

 for (let i = 0; i < N; i++) {
 const entry = this.drones[i];
 const dr = entry && entry.ship;
 if (!dr) continue;

 const maxC = dr.maxCargo || CAPITAL_DRONE_FALLBACK_CARGO;
 const cruise = (dr.maxSpeed || 2.2) * 0.9;
 const accel = dr.accel || 0.08;
 const fric = dr.friction || 0.92;
 const dLaser = dr.laserRange || 300;

 const isFull = (dr.cargo || 0) >= maxC;

 if (!canMine || isFull || (entry.targetRock && entry.targetRock.oreYield <= 0)) {
 entry.targetRock = null;
 }
 if (!isFull && !entry.targetRock && mineable.length > 0) {
 entry.targetRock = this._pickDroneRock(entry, mineable);
 }

 const needDock = isFull || !entry.targetRock;

 if (entry.isDocked) {
 dr.x = dockX; dr.y = dockY; dr.vx = this.vx; dr.vy = this.vy; dr.angle = this.angle;

 if ((dr.cargo || 0) > 0) {
 const spaceLeft = this.maxCargo - this.cargo;
 const transfer = Math.min(dr.cargo, spaceLeft, 150);
 if (transfer > 0) {
 if (window.addOreToCargo) window.addOreToCargo(this, dr.oreType || 'veldspar', transfer);
 else this.cargo += transfer;
 dr.cargo -= transfer;
 }
 } else {
 dr.cargo = 0;
 }

 if (!needDock && dr.cargo <= 0) {
 entry.isDocked = false;
 entry.dockingProgress = 1.0;
 }
 } else if (entry.dockingProgress > 0 && !needDock && dr.cargo <= 0) {
 entry.dockingProgress = Math.max(0, entry.dockingProgress - 0.04);
 const p = 1 - entry.dockingProgress;
 const arcAngle = this.angle + entry.launchAngleOffset;
 const dist = 20 + p * 100;

 dr.x = dockX + Math.cos(arcAngle) * dist;
 dr.y = dockY + Math.sin(arcAngle) * dist;
 dr.angle = arcAngle;
 dr.vx = this.vx + Math.cos(arcAngle) * cruise;
 dr.vy = this.vy + Math.sin(arcAngle) * cruise;

 if (entry.dockingProgress <= 0) {
 entry.isDocked = false;
 }
 } else if (needDock) {
 const distToDock = Math.hypot(dockX - dr.x, dockY - dr.y);
 if (distToDock > 15) {
 this._steerDrone(dr, dockX, dockY, cruise, accel, fric);
 } else {
 dr.vx *= 0.5;
 dr.vy *= 0.5;
 dr.x = dockX;
 dr.y = dockY;
 entry.isDocked = true;
 entry.dockingProgress = 1.0;
 }
 } else {
 const rock = entry.targetRock;
 const parkDist = dLaser * 0.9;
 const distToRock = Math.hypot(rock.x - dr.x, rock.y - dr.y);

 if (distToRock > parkDist) {
 this._steerDrone(dr, rock.x, rock.y, cruise, accel, fric);
 } else {
 dr.vx *= 0.8;
 dr.vy *= 0.8;
 dr.x += dr.vx;
 dr.y += dr.vy;

 const angleToRock = Math.atan2(rock.y - dr.y, rock.x - dr.x);
 let diff = angleToRock - dr.angle;
 while (diff < -Math.PI) diff += Math.PI * 2;
 while (diff > Math.PI) diff -= Math.PI * 2;
 dr.angle += diff * 0.15;
 }

 const mining = distToRock <= dLaser;
 entry.mining = mining;
 dr.currentTarget = mining ? rock : null;

 if (mining) {
 const amt = Math.min((this.miningPower || 6) / N, rock.oreYield, maxC - (dr.cargo || 0));
 rock.oreYield -= amt;
 dr.cargo = (dr.cargo || 0) + amt;
 dr.oreType = rock.oreType || 'veldspar';
 }
 }

 const dSpeed = Math.hypot(dr.vx, dr.vy);
 if (!entry.isDocked && dSpeed > 0.3 && Math.random() < 0.45) {
 const dCos = Math.cos(dr.angle);
 const dSin = Math.sin(dr.angle);
 const back = 25;
 this.particles.push({
 type: 'soot',
 x: dr.x + dCos * back + (Math.random() - 0.5) * 4,
 y: dr.y + dSin * back + (Math.random() - 0.5) * 4,
 vx: dCos * (dSpeed * 1.3) + (Math.random() - 0.5) * 0.2,
 vy: dSin * (dSpeed * 1.3) + (Math.random() - 0.5) * 0.2,
 size: 2.5 + Math.random() * 2.0,
 grow: 0.15,
 alpha: 0.35,
 decay: 0.02,
 baseColor: 'rgba(180, 190, 205,'
 });
 }
 }
 }

 update(targetPos, targetAst, autoTargetStation, forceStop = false, asteroidBeltRef = null) {
 this.animTimer += 0.08;
 if (this.cooldownTimer > 0) {
 this.cooldownTimer--;
 if (this.cooldownTimer === 0) this.applyStats();
 }

 if (this.docked) {
 this.currentTarget = null;
 return;
 }

 const rocks = asteroidBeltRef && typeof asteroidBeltRef.getEntities === 'function' ? asteroidBeltRef.getEntities() : [];

 if (this.cargo >= this.maxCargo) {
 if (this.isAnchored && this.cooldownTimer <= 0) {
 this.isAnchored = false;
 this.cooldownTimer = 100;
 this.applyStats();
 }
 } else if (this.isAnchored && this.cooldownTimer <= 0 && targetAst &&
 !rocks.some(r => Math.hypot(r.x - this.x, r.y - this.y) <= this.laserRange)) {
 this.isAnchored = false;
 this.cooldownTimer = 100;
 this.applyStats();
 } else if (targetAst && !this.isAnchored && this.cooldownTimer <= 0) {
 const distToBelt = Math.hypot(targetAst.x - this.x, targetAst.y - this.y);
 if (distToBelt <= 450) {
 this.isAnchored = true;
 this.maxSpeed = 0;
 this.vx = 0;
 this.vy = 0;
 this.applyStats();
 }
 }

 let destX = null, destY = null, isHolding = false;
 if (autoTargetStation) {
 destX = autoTargetStation.x; destY = autoTargetStation.y;
 } else if (this.isAnchored) {
 isHolding = true;
 this.vx = 0; this.vy = 0;
 } else if (targetAst) {
 const dx = targetAst.x - this.x, dy = targetAst.y - this.y, dist = Math.hypot(dx, dy);
 if (dist > 350) {
 const a = Math.atan2(dy, dx);
 destX = targetAst.x - Math.cos(a) * 350;
 destY = targetAst.y - Math.sin(a) * 350;
 } else {
 isHolding = true;
 this.vx *= this.friction;
 this.vy *= this.friction;
 }
 } else if (targetPos) {
 const dx = targetPos.x - this.x, dy = targetPos.y - this.y;
 if (Math.hypot(dx, dy) > 30) {
 destX = targetPos.x; destY = targetPos.y;
 } else {
 isHolding = true;
 this.vx *= this.friction;
 this.vy *= this.friction;
 }
 }

 if (!isHolding && destX !== null && !this.isAnchored) {
 const dx = destX - this.x, dy = destY - this.y, dist = Math.hypot(dx, dy);
 if (dist > 5) {
 const targetAngle = Math.atan2(dy, dx), diff = targetAngle - this.angle;
 let ndiff = diff;
 while (ndiff < -Math.PI) ndiff += Math.PI * 2;
 while (ndiff > Math.PI) ndiff -= Math.PI * 2;
 this.angle += ndiff * 0.05;
 this.vx += Math.cos(this.angle) * this.accel;
 this.vy += Math.sin(this.angle) * this.accel;
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

 this.emitThrusters();
 this.updateParticles();
 this.updateDrones(rocks, !autoTargetStation);
 }

 draw(ctx, asteroidBeltRef) {
 if (this.particles.length > 0) {
 ctx.save();
 for (const p of this.particles) {
 const alpha = Math.max(0, p.alpha);
 if (p.type === 'soot') {
 ctx.globalCompositeOperation = 'source-over';
 ctx.fillStyle = p.baseColor + alpha.toFixed(3) + ')';
 ctx.beginPath();
 ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
 ctx.fill();
 } else if (p.type === 'flame') {
 ctx.globalCompositeOperation = 'lighter';
 ctx.fillStyle = p.color;
 ctx.globalAlpha = alpha;
 ctx.beginPath();
 ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
 ctx.fill();
 } else if (p.type === 'spark') {
 ctx.globalCompositeOperation = 'lighter';
 ctx.fillStyle = p.color;
 ctx.globalAlpha = alpha;
 ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
 }
 }
 ctx.restore();
 ctx.globalAlpha = 1.0;
 ctx.globalCompositeOperation = 'source-over';
 }

 if (window.ShipArt) {
 window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle);
 } else {
 ctx.save();
 ctx.translate(this.x, this.y);
 ctx.rotate(this.angle);
 ctx.fillStyle = '#1e293b';
 ctx.beginPath();
 ctx.moveTo(150, 0); ctx.lineTo(-150, -80); ctx.lineTo(-150, 80);
 ctx.closePath();
 ctx.fill();
 ctx.restore();
 }

 for (let i = 0; i < this.drones.length; i++) {
 const entry = this.drones[i];
 if (entry.ship && !entry.isDocked) {
 if (typeof entry.ship.draw === 'function') {
 entry.ship.draw(ctx, asteroidBeltRef);
 }

 const dr = entry.ship;
 // Make the Mining Capital's actual drone work readable: each active drone
 // projects a visible mining beam onto the asteroid it is extracting.
 if (entry.mining && entry.targetRock && entry.targetRock.oreYield > 0) {
   const rock = entry.targetRock;
   const pulse = 0.72 + Math.sin(this.animTimer * 5 + i) * 0.18;
   ctx.save();
   ctx.globalCompositeOperation = 'lighter';
   ctx.lineCap = 'round';
   ctx.strokeStyle = 'rgba(45,212,191,' + pulse + ')';
   ctx.shadowColor = '#2dd4bf';
   ctx.shadowBlur = 13;
   ctx.lineWidth = 2.5;
   ctx.beginPath();
   ctx.moveTo(dr.x, dr.y);
   ctx.lineTo(rock.x, rock.y);
   ctx.stroke();
   ctx.fillStyle = 'rgba(45,212,191,0.22)';
   ctx.beginPath();
   ctx.arc(rock.x, rock.y, Math.max(12, (rock.radius || 30) * 0.75), 0, Math.PI * 2);
   ctx.fill();
   ctx.restore();
 }
 const c = dr.cargo || 0;
 const maxC = dr.maxCargo || CAPITAL_DRONE_FALLBACK_CARGO;
 if (maxC > 0 && c > 0) {
 const pct = Math.round((c / maxC) * 100);
 ctx.save();
 ctx.translate(dr.x, dr.y);
 ctx.fillStyle = '#8aa8b3';
 ctx.font = 'bold 11px monospace';
 ctx.textAlign = 'center';
 ctx.fillText(`${pct}%`, 0, -45);
 ctx.restore();
 }
 }
 }
 }
}