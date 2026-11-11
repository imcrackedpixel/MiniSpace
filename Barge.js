// Barge.js - Balanced Mining Barge (2nd tier)   
// Hull art comes from mining_barge.png via ShipArt.js (art is drawn nose-up, 242x340 px).   
// The two mining lasers fire from the arm tips, positioned from the art's pixel coordinates.   
  
// Laser emitter positions in ART PIXELS, measured from the centre of the PNG   
// (x = right, y = down; the nose is at the top, so forward is negative y).   
// If you change the PNG, adjust these.   
const BARGE_LASER_ART = [   
{ x: -98, y: -135 }, // left arm tip   
{ x: 97, y: -130 } // right arm tip   
];   
const BARGE_ART_SCALE_FALLBACK = 0.44;   
  
// Rear engine nozzle exits in ART PIXELS from the centre of the PNG (stern is +y).   
const BARGE_NOZZLES_ART = [   
{ x: -40, y: 166 },   
{ x: -22, y: 166 },   
{ x: 0, y: 166 },   
{ x: 21, y: 166 },   
{ x: 41, y: 166 }   
];   
  
class MiningBarge {   
constructor(x, y) {   
this.x = x;   
this.y = y;   
this.vx = 0;   
this.vy = 0;   
this.angle = 0;   
this.maxSpeed = 2.2;   
this.accel = 0.08;   
this.friction = 0.92;   
this.cargo = 0;   
this.maxCargo = 1000;   
this.laserRange = 300;   
this.miningPower = 0.55; // Balanced - higher than Frigate   
this.shield = 400;   
this.maxShield = 400;   
this.armor = 500;   
this.maxArmor = 500;   
this.structure = 600;   
this.maxStructure = 600;   
this.docked = false;   
this.className = 'Mining Barge';   
this.oreType = 'veldspar';   
this.type = 'ship';   
this.moduleLevels = { laser: 1, shield: 1, cargo: 1, propulsion: 1 };   
this.particles = [];   
this.currentTarget = null;   
this.applyStats();   
}   
  
applyStats() {   
let l = Number(this.moduleLevels.laser) || 1;   
let s = Number(this.moduleLevels.shield) || 1;   
let c = Number(this.moduleLevels.cargo) || 1;   
let p = Number(this.moduleLevels.propulsion) || 1;   
this.maxCargo = 1000 + (c - 1) * 300;   
this.miningPower = 0.55 + (l - 1) * 0.18;   
this.maxShield = 400 + (s - 1) * 120;   
this.shield = this.maxShield;   
this.maxSpeed = 2.2 + (p - 1) * 0.25;   
this.laserRange = 300 + (l - 1) * 40;   
}   
  
upgradeModule(modKey) {   
if (this.moduleLevels[modKey] < 5) {   
this.moduleLevels[modKey]++;   
this.applyStats();   
}   
}   
  
takeDamage(rawDmg) {   
// shield -> armor -> structure (missiles used to hit structure directly)   
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
  
update(targetPos, targetAst, autoTargetStation) {   
if (this.docked) {   
this.currentTarget = null;   
return;   
}   
this.currentTarget = targetAst || null;   
let destX = null, destY = null, isHolding = false;   
  
if (autoTargetStation) {   
destX = autoTargetStation.x; destY = autoTargetStation.y;   
} else if (targetAst) {   
let dx = targetAst.x - this.x, dy = targetAst.y - this.y, dist = Math.hypot(dx, dy);   
if (dist > 110) {   
let a = Math.atan2(dy, dx);   
destX = targetAst.x - Math.cos(a) * 110;   
destY = targetAst.y - Math.sin(a) * 110;   
} else {   
isHolding = true;   
this.vx *= 0.8;   
this.vy *= 0.8;   
}   
} else if (targetPos) {   
let dx = targetPos.x - this.x, dy = targetPos.y - this.y;   
if (Math.hypot(dx, dy) > 25) {   
destX = targetPos.x;   
destY = targetPos.y;   
} else {   
isHolding = true;   
this.vx *= 0.8;   
this.vy *= 0.8;   
}   
}   
  
if (!isHolding && destX !== null) {   
let dx = destX - this.x, dy = destY - this.y, dist = Math.hypot(dx, dy);   
if (dist > 5) {   
let targetAngle = Math.atan2(dy, dx), diff = targetAngle - this.angle;   
while (diff < -Math.PI) diff += Math.PI * 2;   
while (diff > Math.PI) diff -= Math.PI * 2;   
this.angle += diff * 0.08;   
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
  
getArtScale() {  
 const entry = window.ShipArt && window.ShipArt.ART && window.ShipArt.ART[this.className];  
 if (entry && entry.length) return entry.length / 340;  
 if (entry && entry.scale) return entry.scale;  
 return BARGE_ART_SCALE_FALLBACK;  
}   
   
laserOrigins() {   
const k = this.getArtScale();   
const c = Math.cos(this.angle), s = Math.sin(this.angle);   
return BARGE_LASER_ART.map(p => {   
const ax = p.x * k, ay = p.y * k;   
return { x: this.x - ax * s - ay * c, y: this.y + ax * c - ay * s };   
});   
}   
  
drawThrusters(ctx) {   
const k = this.getArtScale();  
const speed = Math.hypot(this.vx, this.vy);   
const power = Math.min(1, speed / (this.maxSpeed || 1));   
const t = performance.now() / 1000;   
  
ctx.save();   
ctx.translate(this.x, this.y);   
ctx.rotate(this.angle + Math.PI / 2);   
ctx.globalCompositeOperation = 'lighter';   
  
BARGE_NOZZLES_ART.forEach((n, i) => {   
const nx = n.x * k, ny = n.y * k;   
const flick = 0.82 + 0.18 * Math.sin(t * 40 + i * 1.9) + Math.random() * 0.12;   
const idle = 0.18;   
const p = idle + (1 - idle) * power;   
const len = (6 + 40 * p) * flick;   
const wid = 2.4 + 1.8 * p;   
  
let g = ctx.createLinearGradient(0, ny, 0, ny + len);   
g.addColorStop(0, 'rgba(255, 235, 190, 0.95)');   
g.addColorStop(0.25, 'rgba(255, 150, 50, 0.85)');   
g.addColorStop(0.7, 'rgba(255, 70, 10, 0.35)');   
g.addColorStop(1, 'rgba(120, 20, 0, 0)');   
ctx.fillStyle = g;   
ctx.beginPath();   
ctx.moveTo(nx - wid, ny);   
ctx.quadraticCurveTo(nx - wid * 0.7, ny + len * 0.55, nx, ny + len);   
ctx.quadraticCurveTo(nx + wid * 0.7, ny + len * 0.55, nx + wid, ny);   
ctx.closePath();   
ctx.fill();   
  
const cl = len * 0.55, cw = wid * 0.45;   
g = ctx.createLinearGradient(0, ny, 0, ny + cl);   
g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');   
g.addColorStop(0.5, 'rgba(190, 220, 255, 0.6)');   
g.addColorStop(1, 'rgba(120, 160, 255, 0)');   
ctx.fillStyle = g;   
ctx.beginPath();   
ctx.moveTo(nx - cw, ny);   
ctx.quadraticCurveTo(nx - cw * 0.6, ny + cl * 0.55, nx, ny + cl);   
ctx.quadraticCurveTo(nx + cw * 0.6, ny + cl * 0.55, nx + cw, ny);   
ctx.closePath();   
ctx.fill();   
  
const gr = 6 + 4 * p;   
const gl = ctx.createRadialGradient(nx, ny, 0, nx, ny, gr);   
gl.addColorStop(0, 'rgba(255, 200, 110, ' + (0.45 + 0.35 * p) + ')');   
gl.addColorStop(1, 'rgba(255, 90, 0, 0)');   
ctx.fillStyle = gl;   
ctx.beginPath();   
ctx.arc(nx, ny, gr, 0, Math.PI * 2);   
ctx.fill();   
});   
  
ctx.restore();   
}   
  
drawLaserBeam(ctx, sx, sy, tx, ty, t, lvl, seed) {   
const dx = tx - sx, dy = ty - sy;   
const len = Math.hypot(dx, dy) || 1;   
const nx = -dy / len, ny = dx / len;   
const pulse = 1 + 0.18 * Math.sin(t * 18 + seed);   
const flicker = 0.85 + Math.random() * 0.15;   
  
ctx.save();   
ctx.globalCompositeOperation = 'lighter';   
ctx.lineCap = 'round';   
  
const layers = [   
{ w: (9 + lvl * 2.0) * pulse, c: 'rgba(30, 190, 80, 0.10)' },   
{ w: (5 + lvl * 1.2) * pulse, c: 'rgba(60, 235, 110, 0.22)' },   
{ w: (2.6 + lvl * 0.5) * pulse, c: 'rgba(140, 255, 170, 0.55)' }   
];   
layers.forEach(L => {   
ctx.strokeStyle = L.c;   
ctx.lineWidth = L.w;   
ctx.beginPath();   
ctx.moveTo(sx, sy);   
ctx.lineTo(tx, ty);   
ctx.stroke();   
});   
  
const g = ctx.createLinearGradient(sx, sy, tx, ty);   
g.addColorStop(0, 'rgba(255, 255, 255, ' + (0.98 * flicker) + ')');   
g.addColorStop(1, 'rgba(190, 255, 205, ' + (0.8 * flicker) + ')');   
ctx.strokeStyle = g;   
ctx.lineWidth = (1.2 + lvl * 0.25) * pulse;   
ctx.beginPath();   
ctx.moveTo(sx, sy);   
ctx.lineTo(tx, ty);   
ctx.stroke();   
  
ctx.setLineDash([8, 30]);   
ctx.lineDashOffset = -(t * 260 + seed * 40);   
ctx.strokeStyle = 'rgba(220, 255, 230, 0.9)';   
ctx.lineWidth = 3 + lvl * 0.4;   
ctx.beginPath();   
ctx.moveTo(sx, sy);   
ctx.lineTo(tx, ty);   
ctx.stroke();   
ctx.setLineDash([]);   
  
ctx.strokeStyle = 'rgba(120, 255, 160, 0.35)';   
ctx.lineWidth = 1;   
ctx.beginPath();   
ctx.moveTo(sx, sy);   
const segs = 7;   
for (let i = 1; i < segs; i++) {   
const f = i / segs;   
const off = (Math.random() - 0.5) * 5;   
ctx.lineTo(sx + dx * f + nx * off, sy + dy * f + ny * off);   
}   
ctx.lineTo(tx, ty);   
ctx.stroke();   
  
const fr = 9 + lvl * 1.5;   
const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, fr);   
fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');   
fg.addColorStop(0.35, 'rgba(120, 255, 160, 0.6)');   
fg.addColorStop(1, 'rgba(40, 200, 90, 0)');   
ctx.fillStyle = fg;   
ctx.beginPath();   
ctx.arc(sx, sy, fr, 0, Math.PI * 2);   
ctx.fill();   
  
const ir = (12 + lvl * 2) * (0.85 + Math.random() * 0.3);   
const ig = ctx.createRadialGradient(tx, ty, 0, tx, ty, ir);   
ig.addColorStop(0, 'rgba(255, 255, 255, 0.9)');   
ig.addColorStop(0.4, 'rgba(110, 255, 150, 0.5)');   
ig.addColorStop(1, 'rgba(40, 200, 90, 0)');   
ctx.fillStyle = ig;   
ctx.beginPath();   
ctx.arc(tx, ty, ir, 0, Math.PI * 2);   
ctx.fill();   
  
ctx.strokeStyle = 'rgba(200, 255, 215, 0.85)';   
ctx.lineWidth = 1.2;   
for (let i = 0; i < 4; i++) {   
const a = Math.random() * Math.PI * 2;   
const r1 = 3 + Math.random() * 4, r2 = r1 + 3 + Math.random() * 7;   
ctx.beginPath();   
ctx.moveTo(tx + Math.cos(a) * r1, ty + Math.sin(a) * r1);   
ctx.lineTo(tx + Math.cos(a) * r2, ty + Math.sin(a) * r2);   
ctx.stroke();   
}   
  
ctx.restore();   
}   
  
draw(ctx, asteroidBeltRef) {   
// Dual Mining Lasers: allow firing as long as the barge is within its maximum laser range capacity   
if (!this.docked && this.currentTarget && this.currentTarget.oreYield > 0 && this.cargo < this.maxCargo) {   
let dist = Math.hypot(this.currentTarget.x - this.x, this.currentTarget.y - this.y);   
if (dist <= this.laserRange && !this.isCorpMember) {   
// Corp barges are mined by BotManager; they only show the beam   
let mined = Math.min(this.miningPower, this.currentTarget.oreYield, this.maxCargo - this.cargo);   
this.currentTarget.oreYield -= mined;   
if (window.addOreToCargo) window.addOreToCargo(this, this.currentTarget.oreType || 'veldspar', mined);
else { this.cargo += mined; this.oreType = this.currentTarget.oreType || 'veldspar'; }   
}   
}   
  
// Engine flames first (under the hull), then the hull art, then the beams on top   
this.drawThrusters(ctx);   
if (window.ShipArt) window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle);   
  
// Beams: show laser beams whenever the target is within maximum laser range   
if (!this.docked && this.currentTarget && this.currentTarget.oreYield > 0 && this.cargo < this.maxCargo) {   
let dist = Math.hypot(this.currentTarget.x - this.x, this.currentTarget.y - this.y);   
if (dist <= this.laserRange) {   
const t = performance.now() / 1000;   
const lvl = this.moduleLevels.laser || 1;   
const origins = this.laserOrigins();   
origins.forEach((org, i) => {   
this.drawLaserBeam(ctx, org.x, org.y, this.currentTarget.x, this.currentTarget.y, t, lvl, i * 4.2);   
});   
}   
}   
}   
}
