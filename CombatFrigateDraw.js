// CombatFrigateDraw.js   
(function () {  
 if (typeof CombatFrigate === 'undefined') {  
   console.error('CombatFrigateDraw: CombatFrigate.js must load first.');  
   return;  
 }  
  
 CombatFrigate.prototype.draw = function (ctx) {  
   const sp = Math.hypot(this.vx || 0, this.vy || 0) / (this.maxSpeed || 1);  
   
   if (sp > 0.02) {   
     ctx.save();  
     const tailX = this.x - Math.cos(this.angle) * 32;  
     const tailY = this.y - Math.sin(this.angle) * 32;  
     ctx.translate(tailX, tailY);  
     ctx.rotate(this.angle + Math.PI);  
     ctx.globalCompositeOperation = 'lighter';  
   
     const flameLen = (15 + sp * 25) * (0.8 + Math.random() * 0.4);  
     const grad = ctx.createLinearGradient(0, 0, flameLen, 0);  
     grad.addColorStop(0, 'rgba(255,255,255,0.9)');  
     grad.addColorStop(0.3, 'rgba(56,189,248,0.8)');  
     grad.addColorStop(1, 'rgba(56,189,248,0)');  
   
     ctx.fillStyle = grad;  
     ctx.beginPath();  
     ctx.moveTo(0, -5);  
     ctx.quadraticCurveTo(flameLen * 0.5, -2, flameLen, 0);  
     ctx.quadraticCurveTo(flameLen * 0.5, 2, 0, 5);  
     ctx.closePath();  
     ctx.fill();  
     ctx.restore();  
   }  
  
   if (window.ShipArt) {  
     window.ShipArt.draw(ctx, this.className, this.x, this.y, this.angle, Math.min(1, sp));  
   }  
  
   for (const t of this.missileTrails || []) {  
     ctx.save();  
     ctx.globalAlpha = t.alpha;  
     ctx.fillStyle = '#fb7185';  
     ctx.beginPath();  
     ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2);  
     ctx.fill();  
     ctx.restore();  
   }  
  
   for (const m of this.missiles || []) {  
     ctx.save();  
     ctx.translate(m.x, m.y);  
     ctx.rotate(Math.atan2(m.vy, m.vx));  
     ctx.fillStyle = '#fb7185';  
     ctx.beginPath();  
     ctx.moveTo(7, 0);  
     ctx.lineTo(-5, -3);  
     ctx.lineTo(-3, 0);  
     ctx.lineTo(-5, 3);  
     ctx.closePath();  
     ctx.fill();  
     ctx.fillStyle = '#38bdf8';  
     ctx.beginPath();  
     ctx.arc(-4, 0, 1.5, 0, Math.PI * 2);  
     ctx.fill();  
     ctx.restore();  
   }  
  
   const tgt = this.currentTarget;  
   if (tgt && tgt.isScrambled && tgt !== window.centralStationBoss) {  
     const t = performance.now() / 1000;  
     ctx.save();  
     ctx.strokeStyle = `rgba(56, 189, 248, ${0.38 + Math.sin(t * 6) * 0.18})`;  
     ctx.lineWidth = 1.6;  
     ctx.setLineDash([5, 7]);  
     ctx.beginPath();  
     ctx.moveTo(this.x, this.y);  
     ctx.lineTo(tgt.x, tgt.y);  
     ctx.stroke();  
     ctx.setLineDash([]);  
     ctx.strokeStyle = `rgba(125, 211, 252, ${0.45 + Math.sin(t * 4) * 0.22})`;  
     ctx.lineWidth = 2.2;  
     ctx.beginPath();  
     ctx.arc(tgt.x, tgt.y, 30 + Math.sin(t * 5) * 5, 0, Math.PI * 2);  
     ctx.stroke();  
     ctx.restore();  
   }  
   for (const f of this.scrambleFx || []) {  
     ctx.save();  
     ctx.globalAlpha = f.alpha;  
     ctx.fillStyle = '#7dd3fc';  
     ctx.beginPath();  
     ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);  
     ctx.fill();  
     ctx.restore();  
   }  
 };  
})();
