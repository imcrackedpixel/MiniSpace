// Global constructor safety aliases for game session manager and bot manager
if (typeof window.CommandShip === 'undefined') {
  window.CommandShip = class CommandShip extends MiningFrigate {
    constructor(x, y) { super(x, y); this.className = 'Command Ship'; }
  };
}
if (typeof window.MiningBarge === 'undefined') {
  window.MiningBarge = class MiningBarge extends MiningFrigate {
    constructor(x, y) { super(x, y); this.className = 'Mining Barge'; }
  };
}
if (typeof window.MiningCapital === 'undefined') {
  window.MiningCapital = class MiningCapital extends MiningFrigate {
    constructor(x, y) { super(x, y); this.className = 'Mining Capital'; }
  };
}
if (typeof window.CombatFrigate === 'undefined') {
  window.CombatFrigate = class CombatFrigate extends MiningFrigate {
    constructor(x, y) { super(x, y); this.className = 'Combat Frigate'; }
  };
}
if (typeof window.ExplorationFrigate === 'undefined') {
  window.ExplorationFrigate = class ExplorationFrigate extends MiningFrigate {
    constructor(x, y) { super(x, y); this.className = 'Exploration Frigate'; }
  };
}
if (typeof window.ImprovedExplorerFrigate === 'undefined') {
  window.ImprovedExplorerFrigate = class ImprovedExplorerFrigate extends ExplorationFrigate {
    constructor(x, y) { super(x, y); this.className = 'Improved Explorer Frigate'; }
  };
}

var EXPLORER_CRUISER_STANDOFF = 120;  
var EXPLORER_CRUISER_CARGO = 800;  
var EXPLORER_CRUISER_SPEED = 4.5;  
var EXPLORER_CRUISER_BLUEPRINT_CHANCE = 0.005;  

var EXPLORER_CRUISER_NOZZLES = [
  [-80, -21.5, 1.3], 
  [-80, 17.5, 1.3]
];  

var EXPLORER_CRUISER_BEAM_SIDES = [-1.2, 1.2];  
var EXPLORER_CRUISER_BEAM_FWD = 30;  
var EXPLORER_CRUISER_SHIELD = 1000;  
var EXPLORER_CRUISER_ARMOR = 2000;  
var EXPLORER_CRUISER_STRUCTURE = 1000;  
  
class ExplorerCruiser extends ExplorationFrigate {  
 constructor(x, y, isCorpBot) {  
   super(x, y, isCorpBot);  
   this.className = 'Explorer Cruiser';  
   this.setCruiserHp(true);  
   
   if (typeof playerData !== 'undefined') {
     playerData.corpExplorer = playerData.corpExplorer || { level: 1, itemLevel: 1 };
     if (this.corpBot) {
       this.explorerLevel = playerData.corpExplorer.level || 1;
       this.itemLevel = playerData.corpExplorer.itemLevel || 1;
     }
   }
 }  
  
 setCruiserHp(fill) {  
   const keep = (cur, max) => (!fill && max > 0 && cur !== undefined) ? Math.min(1, cur / max) : 1;  
   const rs = keep(this.shield, this.maxShield);  
   const ra = keep(this.armor, this.maxArmor);  
   const rt = keep(this.structure, this.maxStructure);  
   this.maxShield = EXPLORER_CRUISER_SHIELD;  
   this.maxArmor = EXPLORER_CRUISER_ARMOR;  
   this.maxStructure = EXPLORER_CRUISER_STRUCTURE;  
   this.shield = this.maxShield * rs;  
   this.armor = this.maxArmor * ra;  
   this.structure = this.maxStructure * rt;  
 }  
  
 applyStats() {  
   if (typeof super.applyStats === 'function') super.applyStats();  
   this.setCruiserHp(false);  
 }  
  
 baseMaxSpeed() { return EXPLORER_CRUISER_SPEED; }  
 baseCargo() { return EXPLORER_CRUISER_CARGO; }  
 hackRange(relic) { const r = relic && relic.radius ? relic.radius : 30; return r + EXPLORER_CRUISER_STANDOFF; }  
 hackLinkOffset() { return 60; }  
 hasBeam() { return true; }  
 beamSides() { return EXPLORER_CRUISER_BEAM_SIDES; }  
 beamForward() { return EXPLORER_CRUISER_BEAM_FWD; }  
 beamDamageMult() { return 2; }  
 gunFocus() { return this.lastAttacker || null; }  
 nozzleList() { return EXPLORER_CRUISER_NOZZLES; }  
  
 draw(ctx) {  
   this.stepEffects();  
   if (this.isCynoActive) {  
     ctx.save();  
     ctx.strokeStyle = '#f85149';  
     ctx.lineWidth = 2.5;  
     ctx.shadowColor = '#f85149';  
     ctx.shadowBlur = 25;  
     ctx.beginPath();  
     ctx.arc(this.x, this.y, 50 + Math.sin(this.frame * 0.1) * 6, 0, Math.PI * 2);  
     ctx.stroke();  
     ctx.fillStyle = 'rgba(248, 81, 73, 0.2)';  
     ctx.fill();  
     ctx.restore();  
   }  

   this.drawHack(ctx);  
   this.drawBeam(ctx);  
   this.drawExhaust(ctx);  
   this.drawPuffs(ctx);  

   ctx.save();  
   ctx.globalAlpha = this.isCloaked ? 0.25 : 1.0;  

   if (window.ShipArt) window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle);  
   this.drawGuns(ctx);  
   this.drawFlames(ctx);  

   ctx.restore();  
 }  

 drawFlames(ctx) {  
   this.flameLevel += (this.throttle - this.flameLevel) * 0.2;  
   const power = this.flameLevel;  
   if (power < 0.01 || this.docked) return;  

   if (!this.exhaust) this.exhaust = [];
   const cosA = Math.cos(this.angle), sinA = Math.sin(this.angle);
   if (Math.random() < 0.9 * power) {
     for (const [nx, ny] of this.nozzleList()) {
       const wx = this.x + nx * cosA - ny * sinA;
       const wy = this.y + nx * sinA + ny * cosA;
       const sp = 2.5 + Math.random() * 2.0;
       this.exhaust.push({
         x: wx, y: wy,
         vx: -cosA * sp + this.vx * 0.3 + (Math.random() - 0.5) * 0.4,
         vy: -sinA * sp + this.vy * 0.3 + (Math.random() - 0.5) * 0.4,
         t: 0, life: 25 + Math.random() * 12
       });
     }
   }

   const pulse = Math.sin(this.frame * 0.6) * 6;  
   ctx.save();  
   ctx.translate(this.x, this.y);  
   ctx.rotate(this.angle);  
   ctx.globalCompositeOperation = 'lighter';  

   for (const [nx, ny, size] of this.nozzleList()) {  
     const len = (35 + pulse + Math.random() * 14) * power * size;  
     const w = 4.5 * size * (0.8 + 0.2 * power);  
     
     ctx.save();  
     ctx.translate(nx, ny);  
     
     const g = ctx.createLinearGradient(0, 0, -len, 0);  
     g.addColorStop(0, 'rgba(255, 255, 255, ' + (0.99 * power) + ')');  
     g.addColorStop(0.2, 'rgba(125, 211, 252, ' + (0.95 * power) + ')');  
     g.addColorStop(0.5, 'rgba(14, 165, 233, ' + (0.75 * power) + ')');  
     g.addColorStop(0.8, 'rgba(3, 105, 161, ' + (0.4 * power) + ')');  
     g.addColorStop(1, 'rgba(3, 105, 161, 0)');  
     
     ctx.fillStyle = g;  
     ctx.beginPath();  
     ctx.moveTo(0, -w * 1.4);  
     ctx.lineTo(-len, 0);  
     ctx.lineTo(0, w * 1.4);  
     ctx.closePath();  
     ctx.fill();  

     ctx.fillStyle = 'rgba(240, 249, 255, 0.95)';
     ctx.beginPath();
     ctx.ellipse(-len * 0.25, 0, len * 0.3, w * 0.6, 0, 0, Math.PI * 2);
     ctx.fill();

     ctx.restore();  
   }  
   ctx.restore();  
 }  

  drawHack(ctx) {
    const t = this.currentTarget;
    if (!t || !(this.hackingTimer > 0) || !this.showScanRing()) return;

    const R = t.radius || 30;
    const p = this.hackingTimer / EXPLORER_HACK_TICKS;
    const f = this.frame;
    const lw = 1 / ((typeof cameraZoom !== 'undefined') ? cameraZoom : 1);

    const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const nx = -uy, ny = ux;
    const beamAngle = Math.atan2(dy, dx);

    // Spawn gravitating data/relic items drifting toward the ship
    if (!this.hackParticles) this.hackParticles = [];
    if (Math.random() < 0.4) {
      const angleOffset = (Math.random() - 0.5) * 1.2;
      const sp = 1.0 + Math.random() * 1.5;
      const rx = t.x + (Math.random() - 0.5) * R;
      const ry = t.y + (Math.random() - 0.5) * R;
      this.hackParticles.push({
        x: rx,
        y: ry,
        vx: Math.cos(beamAngle + angleOffset) * sp,
        vy: Math.sin(beamAngle + angleOffset) * sp,
        t: 0,
        life: 50 + Math.random() * 30
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Scan cone from the hull to the relic, with a core line and data packets
    const sx = this.x + ux * 40, sy = this.y + uy * 40;
    const ex = t.x - ux * R * 0.6, ey = t.y - uy * R * 0.6;
    if (d > R + 50) {
      const pulse = 0.75 + 0.25 * Math.sin(f * 0.25);
      const spread = R * (0.35 + 0.35 * p);
      const cg = ctx.createLinearGradient(sx, sy, ex, ey);
      cg.addColorStop(0, 'rgba(56,189,248,0)');
      cg.addColorStop(1, 'rgba(56,189,248,' + (0.28 * pulse) + ')');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex + nx * spread, ey + ny * spread);
      ctx.lineTo(ex - nx * spread, ey - ny * spread);
      ctx.closePath();
      ctx.fill();

      const lg = ctx.createLinearGradient(sx, sy, ex, ey);
      lg.addColorStop(0, 'rgba(186,230,253,0.1)');
      lg.addColorStop(1, 'rgba(186,230,253,' + (0.8 * pulse) + ')');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.5 * lw;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = '#e0f2fe';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 6 * lw;
      for (let k = 0; k < 4; k++) {
        const u = (f * 0.03 + k / 4) % 1;
        const px = sx + (ex - sx) * u, py = sy + (ey - sy) * u;
        const s = (1.5 + 1.5 * u) * lw;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(beamAngle + Math.PI / 4);
        ctx.fillRect(-s, -s, 2 * s, 2 * s);
        ctx.restore();
      }
      ctx.shadowBlur = 0;
    }

    // Draw gravitating data items/particles flowing toward the ship
    for (const hp of this.hackParticles) {
      const k = 1 - hp.t / hp.life;
      ctx.fillStyle = 'rgba(125,211,252,' + (0.8 * k) + ')';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 4 * lw;
      ctx.fillRect(hp.x - 2, hp.y - 2, 4 * lw, 4 * lw);
    }
    ctx.shadowBlur = 0;

    // 2 and 3. Square corner brackets and scan line, in a frame aligned to the beam
    const half = R * 0.9 + 12 - p * 8;
    const arm = half * 0.4;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(beamAngle);

    ctx.strokeStyle = 'rgba(56,189,248,0.95)';
    ctx.lineWidth = 2 * lw;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 6 * lw;
    ctx.beginPath();
    for (const cx of [-1, 1]) {
      for (const cy of [-1, 1]) {
        ctx.moveTo(cx * half, cy * (half - arm));
        ctx.lineTo(cx * half, cy * half);
        ctx.lineTo(cx * (half - arm), cy * half);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Scan line sweeping back and forth between the brackets
    let scanU = (f * 0.035) % 2;
    scanU = scanU > 1 ? 2 - scanU : scanU;
    const scanY = -half + scanU * 2 * half;
    const sg = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
    sg.addColorStop(0, 'rgba(56,189,248,0)');
    sg.addColorStop(0.5, 'rgba(186,230,253,0.35)');
    sg.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-half, scanY - 10, 2 * half, 20);
    ctx.strokeStyle = 'rgba(224,242,254,0.9)';
    ctx.lineWidth = 1.5 * lw;
    ctx.beginPath();
    ctx.moveTo(-half, scanY);
    ctx.lineTo(half, scanY);
    ctx.stroke();
    ctx.restore();

    // 4. Hex glyphs rising off the relic, brighter as the scan progresses
    ctx.font = '9px Courier New';
    for (let k = 0; k < 6; k++) {
      const life = ((f * 0.012 + k / 6) % 1);
      const seed = Math.floor(f / 10) + k * 13;
      const r = Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
      const ch = '0123456789ABCDEF'[Math.floor(r * 16)];
      const gx = t.x + (k - 2.5) * (R * 0.35);
      const gy = t.y + R * 0.4 - life * R * 1.6;
      ctx.fillStyle = 'rgba(125,211,252,' + (Math.sin(life * Math.PI) * (0.4 + 0.5 * p)) + ')';
      ctx.fillText(ch, gx, gy);
    }

    // 5. Sparks where the beam lands
    ctx.strokeStyle = 'rgba(224,242,254,0.8)';
    ctx.lineWidth = 1 * lw;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = beamAngle + Math.PI + (Math.sin(f * 1.7 + k * 5.1)) * 1.1;
      const l = (3 + Math.abs(Math.sin(f * 0.9 + k * 2.3)) * 7) * (0.6 + p);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a) * l, ey + Math.sin(a) * l);
    }
    ctx.stroke();

    // 6. Segmented progress bar under the relic
    const segs = 10, segW = 5, gap = 2;
    const barW = segs * segW + (segs - 1) * gap;
    const bx = t.x - barW / 2, by = t.y + half + 10;
    for (let k = 0; k < segs; k++) {
      const lit = k < Math.floor(p * segs);
      ctx.fillStyle = lit ? 'rgba(125,211,252,0.95)' : 'rgba(56,189,248,0.2)';
      ctx.fillRect(bx + k * (segW + gap), by, segW, 3 * lw);
    }

    ctx.restore();
  }
  
 rollBlueprint() {  
   if (Math.random() >= EXPLORER_CRUISER_BLUEPRINT_CHANCE) return;  
   
   if (typeof playerData !== 'undefined') {
     playerData.designs = playerData.designs || {};
     if (playerData.designs.cruiserUnlocked) return; 
     playerData.designs.cruiser = (playerData.designs.cruiser || 0) + 1;
     playerData.designs.cruiserUnlocked = true;
   }

   if (this.corpBot) {  
     this.corpBot.hasCruiserBlueprint = true;  
     if (typeof window.showCorpNotification === 'function') {
       window.showCorpNotification('Corp explorer found the EXPLORER CRUISER BLUEPRINT!');  
     }  
   } else if (typeof playerData !== 'undefined') {  
     if (typeof window.showCorpNotification === 'function') {
       window.showCorpNotification('EXPLORER CRUISER DESIGN found in a relic!');  
     }  
   }  
 }  
}  
  
window.ExplorerCruiser = ExplorerCruiser;
