// MapManager.js - Procedural 3-Player Instance Generator with Dynamic Boss & Extraction  
// Public PvP map: three spawns, each with its own asteroid belt ring. Station boss at the centre.  
const PUBLIC_MAP = {  
 size: 9000,  
 cx: 4500,  
 cy: 4500,  
 beltRadius: 1500,  
 rocksPerBelt: 48,  
 spawns: [  
 { x: 1700, y: 7000 }, // Spawn 1 (bottom-left) - gate P1  
 { x: 7100, y: 6700 }, // Spawn 2 (bottom-right) - gate P2  
 { x: 3600, y: 1800 } // Spawn 3 (top) - gate P3  
 ]  
};  

// ---------------------------------------------------------------------------
// Space rift visuals (shared by the PvP gate and the return gates)
// A jagged tear in space: dark core with a bright photon ring, spiral arms being dragged in,
// lensing arcs around it, crackling edge lightning and streaks of light falling into the hole.
// ---------------------------------------------------------------------------
const RIFT_PALETTES = {
  // Public PvP gate: hot, dangerous red / orange with a magenta accent
  pvp: { glow: '255,80,40',  mid: '190,30,40', deep: '45,4,16', arm: '251,146,60', accent: '236,72,153', rim: '#fb923c', rimCore: '#fff1e6', spark: '#fecaca' },
  // Return gates: calm emerald / mint with a cyan accent
  ret: { glow: '16,185,129', mid: '5,130,100', deep: '2,40,32', arm: '110,231,183', accent: '34,211,238', rim: '#34d399', rimCore: '#ecfdf5', spark: '#a7f3d0' }
};

const PUBLIC_SPAWN_OFFSET = 150; // how far from the return gate's centre the player appears on entering PvP

const RIFT_EDGE_POINTS = 40;
const RIFT_SQUASH = 0.68; // the tear is a flattened, tilted slit rather than a circle

function riftHash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Jagged outline of the tear, in rift space. Slowly breathes and flickers.
function riftEdge(R, t, seed) {
  const pts = [];
  const n = RIFT_EDGE_POINTS;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = R * (0.78 + 0.10 * Math.sin(2 * a + t * 0.7 + seed) + 0.07 * Math.sin(5 * a - t * 1.1 + seed * 2));
    r *= 1 + (riftHash(i + seed * 13) - 0.5) * (i % 2 ? 0.34 : 0.2);
    r *= 1 + 0.03 * Math.sin(t * 6 + i * 1.7);
    pts.push([Math.cos(a) * r, Math.sin(a) * r * RIFT_SQUASH]);
  }
  return pts;
}

function riftTrace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function drawSpaceRift(ctx, x, y, R, pal, seed) {
  const t = Date.now() * 0.001;
  const pulse = 1 + Math.sin(t * 2) * 0.06;
  const pts = riftEdge(R, t, seed);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.45 + Math.sin(t * 0.3 + seed) * 0.12);

  // 1. Soft halo of leaking energy around the tear
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.scale(1, 0.82);
  const hr = R * 2.1 * pulse;
  const hg = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, hr);
  hg.addColorStop(0, 'rgba(' + pal.glow + ',0)');
  hg.addColorStop(0.45, 'rgba(' + pal.glow + ',0.26)');
  hg.addColorStop(0.7, 'rgba(' + pal.accent + ',0.12)');
  hg.addColorStop(1, 'rgba(' + pal.accent + ',0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Lensing arcs: thin curved streaks of bent light circling the rift
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 3; k++) {
    const rx = R * (1.2 + 0.22 * k) + Math.sin(t * 1.5 + k) * 3;
    const a0 = t * (0.4 + 0.2 * k) * (k % 2 ? -1 : 1) + k * 2;
    ctx.strokeStyle = 'rgba(' + pal.accent + ',' + (0.3 - 0.07 * k) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * RIFT_SQUASH, 0, a0, a0 + 1.3 + 0.3 * k);
    ctx.stroke();
  }
  ctx.restore();

  // 3. The tear itself: near-black void with a coloured lining toward the edge
  riftTrace(ctx, pts);
  const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
  bg.addColorStop(0, 'rgba(0,0,0,1)');
  bg.addColorStop(0.5, 'rgba(' + pal.deep + ',0.98)');
  bg.addColorStop(1, 'rgba(' + pal.mid + ',0.9)');
  ctx.fillStyle = bg;
  ctx.fill();

  // 4. Inside the tear (clipped): spiral arms being dragged toward the centre, then the dark core
  ctx.save();
  riftTrace(ctx, pts);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const arms = 4;
  for (let arm = 0; arm < arms; arm++) {
    const base = (arm / arms) * Math.PI * 2 + t * 1.6;
    ctx.beginPath();
    for (let s = 0; s <= 36; s++) {
      const u = s / 36;
      const a = base + u * 5.2;
      const r = R * 1.05 * (1 - u * 0.95);
      const px = Math.cos(a) * r, py = Math.sin(a) * r * RIFT_SQUASH;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(' + pal.arm + ',0.12)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(' + pal.arm + ',0.5)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const cr = R * 0.45;
  const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, cr);
  cg.addColorStop(0, 'rgba(0,0,0,1)');
  cg.addColorStop(0.45, 'rgba(0,0,0,1)');
  cg.addColorStop(0.65, 'rgba(' + pal.arm + ',0.6)');
  cg.addColorStop(1, 'rgba(' + pal.arm + ',0)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(0, 0, cr, cr * RIFT_SQUASH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Glowing torn rim: a wide soft stroke under a thin bright one
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  riftTrace(ctx, pts);
  ctx.strokeStyle = 'rgba(' + pal.glow + ',0.3)';
  ctx.lineWidth = 8;
  ctx.shadowColor = pal.rim;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.strokeStyle = pal.rim;
  ctx.lineWidth = 2.6;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.strokeStyle = pal.rimCore;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.restore();

  // 6. Cracks of lightning leaking out through the edge, flickering on and off
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.3;
  ctx.shadowColor = pal.rim;
  ctx.shadowBlur = 6;
  const frameStep = Math.floor(t * 9);
  for (let k = 0; k < 7; k++) {
    const flick = Math.max(0, Math.sin(t * 3 + k * 2.1));
    if (flick < 0.05) continue;
    const idx = Math.floor(riftHash(k + seed * 5) * pts.length);
    const bx = pts[idx][0], by = pts[idx][1];
    const bl = Math.hypot(bx, by) || 1;
    let dx = bx / bl, dy = by / bl;
    const len = R * (0.3 + 0.45 * riftHash(k * 3 + seed));
    const segs = 4;
    ctx.strokeStyle = 'rgba(' + pal.arm + ',' + (0.75 * flick) + ')';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    let cx = bx, cy = by;
    for (let s = 1; s <= segs; s++) {
      const j = (riftHash(k * 17 + s * 5 + frameStep) - 0.5) * 0.9;
      const step = len / segs;
      cx += (dx - dy * j) * step;
      cy += (dy + dx * j) * step;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 7. Streaks of light and dust pulled into the rift, spiralling faster as they fall
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.spark;
  ctx.lineWidth = 1.2;
  const pos = function (sp, u) {
    const r = R * 2.0 * Math.pow(1 - u, 1.5);
    const a = sp * Math.PI * 2 + u * u * 3.6 * (sp > 0.5 ? 1 : -1);
    return [Math.cos(a) * r, Math.sin(a) * r * 0.78];
  };
  for (let i = 0; i < 30; i++) {
    const sp = riftHash(i + seed * 7);
    const u = (t * (0.16 + 0.16 * sp) + sp * 5) % 1;
    const p1 = pos(sp, u);
    const p0 = pos(sp, Math.max(0, u - 0.05));
    ctx.globalAlpha = Math.sin(u * Math.PI) * 0.85;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}
  
// Shared high-visibility portal label, styled to match the Trade Hub entrance.
function drawPortalLabel(ctx, x, y, radius, title, subtitle, accent) {
  const zoom = Math.max(0.45, Number(window.cameraZoom) || 1);
  const fontSize = 18 / zoom;
  const titleText = String(title || '').toUpperCase();
  const subText = subtitle ? String(subtitle).toUpperCase() : '';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
  const titleWidth = ctx.measureText(titleText).width;
  ctx.font = '600 ' + (13 / zoom) + 'px system-ui, sans-serif';
  const subWidth = subText ? ctx.measureText(subText).width : 0;
  const width = Math.max(titleWidth, subWidth) + 24 / zoom;
  const height = (subText ? 48 : 30) / zoom;
  const labelY = y - radius - (subText ? 48 : 34) / zoom;
  ctx.fillStyle = 'rgba(3, 15, 22, 0.9)';
  ctx.strokeStyle = accent || '#34d399';
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, labelY - height / 2, width, height, 7 / zoom);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = accent || '#34d399';
  ctx.shadowBlur = 8 / zoom;
  ctx.fillStyle = '#ecfdf5';
  ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
  ctx.fillText(titleText, x, labelY - (subText ? 8 : 0) / zoom);
  if (subText) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#a7f3d0';
    ctx.font = '600 ' + (13 / zoom) + 'px system-ui, sans-serif';
    ctx.fillText(subText, x, labelY + 13 / zoom);
  }
  ctx.restore();
}


const FRONTIER_SYSTEMS=[
{id:'frontier_ashen',name:'Ashen Reach',level:1,kind:'Mining Fleet',links:['frontier_iron','frontier_vanta']},
{id:'frontier_iron',name:'Ironwake',level:2,kind:'Pirate Patrols',links:['frontier_ashen','frontier_cinder','frontier_umbra']},
{id:'frontier_vanta',name:'Vanta Expanse',level:2,kind:'Mining Fleet',links:['frontier_ashen','frontier_nexus']},
{id:'frontier_cinder',name:'Cinder Drift',level:3,kind:'Mixed Fleets',links:['frontier_iron','frontier_redline']},
{id:'frontier_umbra',name:'Umbra Verge',level:4,kind:'Pirate Armada',links:['frontier_iron','frontier_blackstar']},
{id:'frontier_nexus',name:'Nexus Scar',level:4,kind:'Mixed Fleets',links:['frontier_vanta','frontier_redline','frontier_crypt']},
{id:'frontier_redline',name:'Redline Abyss',level:5,kind:'Elite Pirate Fleet',links:['frontier_cinder','frontier_nexus']},
{id:'frontier_blackstar',name:'Blackstar End',level:5,kind:'Elite Carrier Territory',links:['frontier_umbra']},
{id:'frontier_crypt',name:'The Crypt',level:5,kind:'Relic Graveyard',links:['frontier_nexus']}
];
window.MINISPACE_UNIVERSE_SYSTEMS=FRONTIER_SYSTEMS;

class MapManager {  
 constructor() {  
 this.currentMapId = 'private_highsec';  
 this.missionReturnGate = null;
 this.frontierReturnGate = null;
 this.frontierGates = [];
 this.frontierEntryGate = {
   x: 3500, y: 1450, radius: 115,
   draw: function(ctx) {
     drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.pvp, 18);
     drawPortalLabel(ctx, this.x, this.y, this.radius, 'ASHEN REACH', 'FRONTIER GATE · PVP ZONE', '#fb923c');
   }
 };
 this.missionEntryGate = { x: 4450, y: 4450, radius: 105, destinationName: '', draw: function(ctx) {
   drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.ret, 12);
   drawPortalLabel(ctx, this.x, this.y, this.radius, 'MISSION PORTAL',
     this.destinationName ? 'TO ' + this.destinationName.toUpperCase() : 'MISSION DESTINATION', '#34d399');
 } };
 this.anomalyAngle = 0;  
 this.anomalyPulse = 0;
  
 this.publicGate = {
 x: 2500,
 y: 4200,
 radius: 90,
 draw: function(ctx) {
   drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.pvp, 1);
   drawPortalLabel(ctx, this.x, this.y, this.radius, '3V3 ARENA', 'PUBLIC PVP', '#fb923c');
 }
 };

 this.playerGates = [  
 {  
 x: 1000, y: 4500, radius: 80, playerIndex: 0,  
 draw(ctx) { if (typeof this.drawGate === 'function') this.drawGate(ctx, 'P1 RETURN GATE'); }  
 },  
 {  
 x: 4000, y: 4500, radius: 80, playerIndex: 1,  
 draw(ctx) { if (typeof this.drawGate === 'function') this.drawGate(ctx, 'P2 RETURN GATE'); }  
 },  
 {  
 x: 2500, y: 800, radius: 80, playerIndex: 2,  
 draw(ctx) { if (typeof this.drawGate === 'function') this.drawGate(ctx, 'P3 RETURN GATE'); }  
 }  
 ];  
  
 this.playerGates.forEach(g => g.drawGate = this.drawGate.bind(g));  
 this.returnGate = this.playerGates[0];  
 }  
  
 // Called with the gate as `this` (bound in the constructor)
 drawGate(ctx, label) {
 drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.ret, 2 + (this.playerIndex || 0) * 3);
 drawPortalLabel(ctx, this.x, this.y, this.radius, label.replace(' RETURN GATE', ''), 'RETURN TO HIGH-SEC', '#34d399');
 }  
  

 jumpToFrontierSystem(playerShip,systemId){
  const system=FRONTIER_SYSTEMS.find(s=>s.id===systemId);if(!system||!playerShip)return null;
  this.currentMapId=system.id;const size=9000,cx=size/2,cy=size/2;
  this.frontierReturnGate={x:650,y:cy,radius:105,draw(ctx){drawSpaceRift(ctx,this.x,this.y,this.radius,RIFT_PALETTES.ret,31);drawPortalLabel(ctx,this.x,this.y,this.radius,'UNIVERSE RIFT','SAFE RETURN','#34d399');}};
  this.frontierGates=system.links.map((id,i)=>{const a=2*Math.PI*i/Math.max(1,system.links.length)-Math.PI/2;const g={x:cx+Math.cos(a)*3300,y:cy+Math.sin(a)*3000,radius:90,destinationId:id};g.draw=function(ctx){drawSpaceRift(ctx,this.x,this.y,this.radius,RIFT_PALETTES.pvp,40+i);const d=FRONTIER_SYSTEMS.find(s=>s.id===this.destinationId);drawPortalLabel(ctx,this.x,this.y,this.radius,'FRONTIER ROUTE',d?d.name:'UNKNOWN','#fb923c');};return g;});
  let seed=0;for(let k=0;k<system.id.length;k++)seed=(seed*33+system.id.charCodeAt(k))>>>0;const oldRandom=Math.random;let rng=seed||1;Math.random=function(){rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;};
  let belt,debris;
  try{belt=new AsteroidBelt(cx,cy,0,size);belt.generate(75+system.level*12,system.level>=4?['pyroxeres','omber','scordite']:['veldspar','scordite','pyroxeres']);
   if(belt.entities)belt.entities.forEach((r,i)=>{const a=Math.random()*Math.PI*2,d=900+Math.random()*3300;r.x=cx+Math.cos(a)*d+(i%5-2)*180;r.y=cy+Math.sin(a)*d;});
   debris=typeof DebrisField!=='undefined'?new DebrisField(cx,cy,system.level,size,system.level):null;if(debris&&debris.generate)debris.generate(system.level);
  }finally{Math.random=oldRandom;}
  playerShip.x=this.frontierReturnGate.x+260;playerShip.y=this.frontierReturnGate.y;playerShip.vx=0;playerShip.vy=0;playerShip.angle=0;playerShip.docked=false;
  return {asteroidBelt:belt,debrisField:debris,size:size,system:system};
 }

 jumpToMissionSystem(playerShip, mission) {
   const size = 7000;
   this.currentMapId = 'mission_' + String(mission.systemName || mission.id || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
   const cx = size / 2, cy = size / 2;
   this.missionReturnGate = { x: 700, y: cy, radius: 95, draw(ctx) {
     drawSpaceRift(ctx, this.x, this.y, this.radius, RIFT_PALETTES.ret, 24);
     drawPortalLabel(ctx, this.x, this.y, this.radius, 'RETURN PORTAL', 'HIGH-SEC 1.0', '#34d399');
   }};
   const belt = new AsteroidBelt(cx, cy, 0, size);
   belt.generate(65, ['veldspar', 'scordite', 'pyroxeres', 'omber']);
   const debris = typeof DebrisField !== 'undefined' ? new DebrisField(cx, cy, 1, size) : null;
   if (debris && typeof debris.generate === 'function') debris.generate(1);
   playerShip.x = this.missionReturnGate.x + 260; playerShip.y = this.missionReturnGate.y;
   playerShip.vx = 0; playerShip.vy = 0; playerShip.angle = 0; playerShip.docked = false;
   return { asteroidBelt: belt, debrisField: debris, size: size };
 }

 jumpToPublicSpace(playerShip, mainStation, publicNpcManager, playerSlot = 0) {  
 this.currentMapId = 'public_space';  
 if (window.showCorpNotification) window.showCorpNotification('⚠️ Entering Fresh 3-Player Instance! Clear your sector, destroy the central station boss, and extract.');  
  
 if (typeof publicNpcManager !== 'undefined' && typeof publicNpcManager.init === 'function') {  
 publicNpcManager.init(playerShip, playerSlot);  
 }  
  
 const M = PUBLIC_MAP;  
 this.playerGates.forEach((g, i) => { g.x = M.spawns[i].x; g.y = M.spawns[i].y; });  
 // Place the player beside their own return gate (not on it), on the side facing the map centre
 const myGate = this.playerGates[Math.max(0, Math.min(this.playerGates.length - 1, playerSlot | 0))];
 if (playerShip && myGate) {
 const toCentre = Math.atan2(M.cy - myGate.y, M.cx - myGate.x);
 playerShip.x = myGate.x + Math.cos(toCentre) * PUBLIC_SPAWN_OFFSET;
 playerShip.y = myGate.y + Math.sin(toCentre) * PUBLIC_SPAWN_OFFSET;
 playerShip.vx = 0;
 playerShip.vy = 0;
 playerShip.angle = toCentre;
 }
  
 const newAsteroidBelt = new AsteroidBelt(M.cx, M.cy, 0, M.size);  
 M.spawns.forEach(function (sp) {  
 for (let i = 0; i < M.rocksPerBelt; i++) {  
 const a = (i / M.rocksPerBelt) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;  
 const r = M.beltRadius + (Math.random() - 0.5) * 240;  
 const oreData = ASTEROID_ORE_TYPES[Math.floor(Math.random() * ASTEROID_ORE_TYPES.length)];  
 const baseRadius = 35 + Math.random() * 55;  
 const pointsCount = 8 + Math.floor(Math.random() * 7);  
 const vertices = [];  
 for (let v = 0; v < pointsCount; v++) {  
 const ang = (v / pointsCount) * Math.PI * 2;  
 const vRad = baseRadius * (0.55 + Math.random() * 0.7);  
 vertices.push({ x: Math.cos(ang) * vRad, y: Math.sin(ang) * vRad });  
 }  
 newAsteroidBelt.entities.push({  
 x: sp.x + Math.cos(a) * r, y: sp.y + Math.sin(a) * r,  
 radius: baseRadius, vertices: vertices,  
 oreYield: 1500 + Math.random() * 3500, maxYield: 5000,  
 oreType: oreData.name, colors: oreData, rotation: Math.random() * Math.PI * 2,  
 rotSpeed: (Math.random() - 0.5) * 0.0015, craters: [], veins: []  
 });  
 }  
 });  
  
 let newDebrisField = typeof DebrisField !== 'undefined' ? new DebrisField(M.cx, M.cy, 3, M.size) : null;  
 if (newDebrisField && typeof newDebrisField.generate === 'function') newDebrisField.generate(3);  
  
 mapManager.publicGate.x = M.cx;  
 mapManager.publicGate.y = M.cy;  
  
 if (window.centralStationBoss && typeof window.centralStationBoss.respawn === 'function') {  
 window.centralStationBoss.respawn(M.cx, M.cy);  
 }  
  
 return { asteroidBelt: newAsteroidBelt, debrisField: newDebrisField };  
 }  
  
 jumpToPrivateSec(playerShip, mainStation) {  
 this.currentMapId = 'private_highsec';  
 this.missionReturnGate = null;
 if (window.showCorpNotification) window.showCorpNotification('Returned through the mission tear to High-Sec 1.0. Your ship remains at the return tear; fly back to the station.');  
 this.publicGate.x = 2500;  
 this.publicGate.y = 4200;  
 const newAsteroidBelt = new AsteroidBelt(2500, 3800, 150, 5000);  
 newAsteroidBelt.generate(150, ['veldspar', 'scordite']);  
 const newDebrisField = new DebrisField(2500, 3800, 3, 5000);  
 return { asteroidBelt: newAsteroidBelt, debrisField: newDebrisField };  
 }  
}
