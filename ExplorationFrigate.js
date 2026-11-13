// ExplorationFrigate.js - Relic-scanning frigate.
// It only works on a relic the player tapped (or the one autoplay picks). It flies to the relic,
// holds position outside it, and runs a 60-tick scan. Its hull art comes from exploration_frigate.png via ShipArt.js.
// Ships built on this class (the Explorer Cruiser, in ExplorerCruiser.js) override the hook methods below
// instead of adding special cases here.

const EXPLORER_HACK_STANDOFF = 90; // hold this far beyond a relic's edge while scanning, so it never sits on top of it
const EXPLORER_HACK_TICKS = 60;   // frames per scan attempt
const EXPLORER_TURN_RATE = 0.06;  // radians per frame the hull can turn
// Improved frigate's small beam: half of a Combat Frigate's level-1 missile DPS (0.13 x 60 x 15)
const EXPLORER_GUN_DPS = 0.5 * 0.13 * 60 * 15;
const EXPLORER_GUN_RANGE = 550;
// The beam only fires for this many frames (5 seconds) after the frigate takes damage
const EXPLORER_GUN_WINDOW = 300;
// Engine nozzles in ship space, measured from exploration_frigate.png. x is along the hull (negative = rear).
const EXPLORER_NOZZLES = [[-30, -4, 0.5], [-30, 4, 0.5], [-31, 0, 0.45]];
// Stabilisation thrusters at the four arm tips, measured from exploration_frigate.png.
// [x, y]; the sign of y is the outward side of the hull.
const EXPLORER_RCS = [[20, -17], [20, 17], [-22, -18], [-22, 17]];

class ExplorationFrigate {
  constructor(x, y, improved = false) {
    this.improved = !!improved;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;

    this.maxSpeed = this.baseMaxSpeed();
    this.accel = 0.32;
    this.friction = 0.94;

    this.cargo = 0;
    this.maxCargo = 150;
    this.weaponRange = 550;
    this.scramblerRange = 550;

    this.shield = 120;
    this.maxShield = 120;
    this.armor = 100;
    this.maxArmor = 100;
    this.structure = 150;
    this.maxStructure = 150;

    this.docked = false;
    this.className = this.improved ? 'Improved Explorer Frigate' : 'Exploration Frigate';
    this.gunTarget = null;
    this.gunPulse = 0;
    this.hitTimer = 0;     // frames left in which the beam may fire, set when this ship is shot
    this.type = 'ship';

    this.isCloaked = false;
    this.isPanicButtonActive = false;
    this.lastHackedDebrisKey = 'debris_t1';

    this.moduleLevels = {
      cloaking: 1,
      hacking: 1,
      propulsion: 1,
      cargo: 1
    };

    this.currentTarget = null;
    this.hackingTimer = 0;
    this.throttle = 0;     // 0..1, drives the engine flames
    this.flameLevel = 0;   // smoothed throttle
    this.frame = 0;
    this.applyStats();
  }

  // ---- Hooks: ships built on this class override these ----
  baseMaxSpeed() { return 6.0; }          // top speed before propulsion upgrades
  baseCargo() { return 150; }             // hold size at cargo level 1
  // How far it holds from a relic's centre: the relic's radius plus a standoff, so big wrecks are not covered
  hackRange(relic) { const r = relic && relic.radius ? relic.radius : 30; return r + EXPLORER_HACK_STANDOFF; }
  hasBeam() { return this.improved; }     // whether it has a gun at all
  beamSides() { return [0]; }             // lateral offsets of each beam origin on the hull
  beamForward() { return 34; }            // how far forward of the ship centre the beams fire from
  beamDamageMult() { return 1; }          // multiplier on the beam's damage
  gunFocus() { return null; }             // ship the beam always goes for, if any
  nozzleList() { return EXPLORER_NOZZLES; } // engine exit points in ship space
  showScanRing() { return true; }         // draw the hacking visuals on the relic being worked on
  drawGuns(ctx) {}                        // draw gun barrels on the hull (none by default)
  rollBlueprint() {}                      // called on each successful relic scan (none by default)

  applyStats() {
    const cl = Number(this.moduleLevels.cloaking) || 1;
    const pr = Number(this.moduleLevels.propulsion) || 1;
    const cg = Number(this.moduleLevels.cargo) || 1;

    let baseCargo = this.baseCargo();
    for (let i = 1; i < cg; i++) baseCargo *= 1.10;
    if (this.improved) baseCargo *= 1 + (cg - 1) / 4; // double the explorer's cargo at max level
    this.maxCargo = Math.floor(baseCargo);

    let propMultiplier = 1.0 + (pr - 1) * 0.025;
    if (this.isCloaked) propMultiplier += (cl - 1) * 0.025;
    this.maxSpeed = this.baseMaxSpeed() * propMultiplier;
    if (this.improved) this.maxSpeed *= 1.1; // 10% faster than the explorer at the same level
    this.maxSpeed = Math.min(window.STAT_CAPS.explorerSpeed, this.maxSpeed);

    if (this.isPanicButtonActive) this.maxSpeed = 0;
  }

  toggleCloak() {
    this.isCloaked = !this.isCloaked;
    if (this.isCloaked && this.isPanicButtonActive) this.isPanicButtonActive = false;
    this.applyStats();
  }

  togglePanicButton() {
    if (this.isCloaked) return;
    this.isPanicButtonActive = !this.isPanicButtonActive;
    this.applyStats();
  }

  upgradeModule(modKey) {
    if (this.moduleLevels[modKey] < window.getCap(modKey, this.className)) {
      this.moduleLevels[modKey]++;
      this.applyStats();
    }
  }

  // Shield, then armor, then structure
  takeDamage(rawDmg, source) {
    // A dispatched Corp Explorer is protected while its 10-second Panic Button hold is active.
    const corpMission = this.corpBot && this.corpBot.explorerMission;
    if (this.isPanicButtonActive && corpMission && corpMission.phase === 'panic' && Date.now() < corpMission.panicUntil) return;
    // being shot opens the beam window, and remembers who shot (a cruiser focuses that ship)
    if (rawDmg > 0) { this.hitTimer = EXPLORER_GUN_WINDOW; if (source) this.lastAttacker = source; }
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

  // Turn at a limited rate and push along the hull heading, only while roughly facing the goal
  steerToward(desiredAngle) {
    let turn = desiredAngle - this.angle;
    while (turn < -Math.PI) turn += Math.PI * 2;
    while (turn > Math.PI) turn -= Math.PI * 2;
    const step = Math.max(-EXPLORER_TURN_RATE, Math.min(EXPLORER_TURN_RATE, turn));
    this.angle += step;
    this.turnDir = step / EXPLORER_TURN_RATE;
    const facing = Math.max(0, Math.cos(turn));
    this.throttle = Math.max(this.throttle, facing);
    this.vx += Math.cos(this.angle) * this.accel * facing;
    this.vy += Math.sin(this.angle) * this.accel * facing;
  }

  update(targetPos, targetDebris, autoTargetStation) {
    if (this.docked) {
      this.currentTarget = null;
      this.hackingTimer = 0;
      this.hackParticles = [];
      return;
    }
    if (this.isPanicButtonActive) {
      this.vx = 0;
      this.vy = 0;
      this.hackingTimer = 0;
      this.hackParticles = [];
      return;
    }
    this.frame++;
    this.throttle = 0;
    this.turnDir = 0;
    this.holding = false;

    // No automatic targeting: only the relic the player tapped (or autoplay's pick) is worked on
    if (targetDebris && !(targetDebris.oreYield > 0)) targetDebris = null;
    if (targetDebris !== this.currentTarget) {
      this.hackingTimer = 0;
      this.hackParticles = [];
    }
    this.currentTarget = targetDebris || null;

    const relicMode = !!targetDebris && !autoTargetStation;
    const dest = autoTargetStation || targetDebris || targetPos || null;

    if (dest) {
      const dx = dest.x - this.x;
      const dy = dest.y - this.y;
      const dist = Math.hypot(dx, dy);
      const stopAt = relicMode ? this.hackRange(targetDebris) : 18;
      if (dist > stopAt) {
        this.steerToward(Math.atan2(dy, dx));
      } else {
        // Hold position off the relic's edge
        this.holding = true;
        this.vx *= 0.8;
        this.vy *= 0.8;
      }
    }

    // Scan while parked beside a relic. A cloaked explorer cannot scan: it has to uncloak first.
    if (this.isCloaked) {
      this.hackingTimer = 0;
      this.hackParticles = [];
    }
    if (relicMode && !this.isCloaked) {
      const d = Math.hypot(targetDebris.x - this.x, targetDebris.y - this.y);
      if (d <= this.hackRange(targetDebris) + 15) {
        this.hackingTimer++;
        if (this.hackingTimer >= EXPLORER_HACK_TICKS) {
          this.hackingTimer = 0;
          this.executeJankyHack(targetDebris);
        }
      } else {
        this.hackingTimer = 0;
        this.hackParticles = [];
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
    this.emitExhaust();
    this.emitPuffs();
  }

  // Exhaust particles from the rear nozzles, in world space
  emitExhaust() {
    if (!this.exhaust) this.exhaust = [];
    const cosA = Math.cos(this.angle), sinA = Math.sin(this.angle);
    if (this.throttle > 0.1) {
      for (const [nx, ny] of this.nozzleList()) {
        const sp = 1.2 + Math.random() * 1.2;
        this.exhaust.push({
          x: this.x + nx * cosA - ny * sinA,
          y: this.y + nx * sinA + ny * cosA,
          vx: -cosA * sp + this.vx * 0.3 + (Math.random() - 0.5) * 0.3,
          vy: -sinA * sp + this.vy * 0.3 + (Math.random() - 0.5) * 0.3,
          t: 0,
          life: 14 + Math.random() * 8
        });
      }
    }
  }

  // Moves exhaust and puff particles one step. Runs from draw(), so the smoke keeps moving when the ship is still.
  stepEffects() {
    if (this.exhaust) {
      for (let i = this.exhaust.length - 1; i >= 0; i--) {
        const p = this.exhaust[i];
        p.t++;
        p.x += p.vx;
        p.y += p.vy;
        if (p.t >= p.life) this.exhaust.splice(i, 1);
      }
    }
    if (this.puffs) {
      for (let i = this.puffs.length - 1; i >= 0; i--) {
        const p = this.puffs[i];
        p.t++;
        p.x += p.vx;
        p.y += p.vy;
        if (p.t >= p.life) this.puffs.splice(i, 1);
      }
    }
    if (this.hackParticles) {
      for (let i = this.hackParticles.length - 1; i >= 0; i--) {
        const hp = this.hackParticles[i];
        hp.t++;
        const dx = this.x - hp.x;
        const dy = this.y - hp.y;
        const dist = Math.hypot(dx, dy) || 1;
        hp.vx += (dx / dist) * 0.15;
        hp.vy += (dy / dist) * 0.15;
        hp.vx *= 0.92;
        hp.vy *= 0.92;
        hp.x += hp.vx;
        hp.y += hp.vy;
        if (hp.t >= hp.life || dist < 15) {
          this.hackParticles.splice(i, 1);
        }
      }
    }
  }

  // Small beam at the nearest enemy in range. Only fires while the window opened by being shot is open.
  updateGun(enemies) {
    this.gunTarget = null;
    if (this.hitTimer > 0) this.hitTimer--;
    if (!this.hasBeam() || this.docked || this.isPanicButtonActive || this.isCloaked) return;
    if (this.hitTimer <= 0) return;
    let best = null, bestD = EXPLORER_GUN_RANGE;
    const focus = this.gunFocus();
    if (focus && focus.structure > 0 && Math.hypot(focus.x - this.x, focus.y - this.y) <= EXPLORER_GUN_RANGE) best = focus;
    for (const e of (best ? [] : enemies || [])) {
      if (!e || !(e.structure > 0)) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    this.gunTarget = best;
    const dmg = this.beamDamageMult() * EXPLORER_GUN_DPS / 60;
    if (typeof best.takeDamage === 'function') best.takeDamage(dmg);
    else best.structure -= dmg;
  }

  drawBeam(ctx) {
    if (!this.gunTarget) return;
    this.gunPulse++;
    const lw = 1 / ((typeof cameraZoom !== 'undefined') ? cameraZoom : 1);
    const t = this.gunTarget;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(88, 166, 255, ' + (0.6 + 0.3 * Math.sin(this.gunPulse * 0.8)) + ')';
    ctx.lineWidth = 1.6 * lw;
    ctx.shadowColor = '#58a6ff';
    ctx.shadowBlur = 6 * lw;
    for (const side of this.beamSides()) {
      const fwd = this.beamForward();
      const ox = this.x + Math.cos(this.angle) * fwd - Math.sin(this.angle) * side;
      const oy = this.y + Math.sin(this.angle) * fwd + Math.cos(this.angle) * side;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Hacking visual for the relic being scanned. Scan cone, brackets, scan line, rising hex glyphs, and gravitating particles.
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

  executeJankyHack(debris) {
    if (this.cargo >= this.maxCargo) return;

    const hk = Number(this.moduleLevels.hacking) || 1;
    const successChance = 0.30 + (hk * 0.12);
    if (Math.random() > successChance) {
      if (typeof window.showCorpNotification === 'function') window.showCorpNotification('Relic scan failed.');
      return;
    }

    const debrisTier = debris && debris.tier ? debris.tier : hk;
    this.lastHackedDebrisKey = 'debris_t' + debrisTier;

    const baseLootYield = debrisTier === 1 ? 5 : (debrisTier === 2 ? 15 : (debrisTier === 3 ? 30 : (debrisTier === 4 ? 60 : 120)));
    const acquired = Math.min(baseLootYield, this.maxCargo - this.cargo);

    if (this.corpBot) {
      this.cargo += acquired;
      this.oreType = this.lastHackedDebrisKey;
      this.corpBot.tempStock = this.corpBot.tempStock || {};
      this.corpBot.tempStock[this.lastHackedDebrisKey] = (this.corpBot.tempStock[this.lastHackedDebrisKey] || 0) + acquired;
    } else {
      if (window.addOreToCargo) window.addOreToCargo(this, this.lastHackedDebrisKey, acquired);
      else this.cargo += acquired;
    }

    this.rollBlueprint();

    debris.oreYield = Math.max(0, (debris.oreYield || 100) - acquired);
    if (typeof window.showCorpNotification === 'function') {
      window.showCorpNotification('Relic scanned: +' + acquired + ' debris');
    }
  }

  draw(ctx) {
    this.stepEffects();
    if (this.isPanicButtonActive) {
      ctx.save();
      ctx.strokeStyle = '#f85149';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#f85149';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(248, 81, 73, 0.15)';
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

  drawExhaust(ctx) {
    if (!this.exhaust || !this.exhaust.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.exhaust) {
      const k = 1 - p.t / p.life;
      const rgb = k > 0.5 ? '251,146,60' : '148,163,184';
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.5 * k) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 + p.t * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  emitPuffs() {
    if (!this.puffs) this.puffs = [];
    const cosA = Math.cos(this.angle), sinA = Math.sin(this.angle);
    const speed = Math.hypot(this.vx, this.vy);
    for (const [px, py] of EXPLORER_RCS) {
      const front = px > 0 ? 1 : -1;
      const turning = Math.abs(this.turnDir) > 0.2 && front * this.turnDir > 0;
      const holding = this.holding && speed < 0.8;
      if (!turning && !holding) continue;
      if (Math.random() > (turning ? 0.6 : 0.15)) continue;
      const side = Math.sign(py);
      const wx = this.x + px * cosA - py * sinA;
      const wy = this.y + px * sinA + py * cosA;
      const lx = -sinA * side, ly = cosA * side;
      const sp = 0.8 + Math.random() * 0.8;
      this.puffs.push({
        x: wx, y: wy,
        vx: lx * sp + this.vx * 0.2,
        vy: ly * sp + this.vy * 0.2,
        t: 0, life: 10 + Math.random() * 6
      });
    }
  }

  drawPuffs(ctx) {
    if (!this.puffs || !this.puffs.length) return;
    ctx.save();
    for (const p of this.puffs) {
      const k = 1 - p.t / p.life;
      ctx.fillStyle = 'rgba(226, 232, 240, ' + (0.45 * k) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1 + p.t * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFlames(ctx) {
    this.flameLevel += (this.throttle - this.flameLevel) * 0.15;
    const power = this.flameLevel;
    if (power < 0.03) return;
    const flicker = 0.92 + 0.08 * Math.sin(this.frame * 0.9);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.globalCompositeOperation = 'lighter';
    for (const [nx, ny, size] of this.nozzleList()) {
      const len = (14 + 22 * power) * flicker * (size / 0.5);
      const w = 4 * (size / 0.5) * (0.7 + 0.3 * power);
      ctx.save();
      ctx.translate(nx, ny);
      const g = ctx.createLinearGradient(0, 0, -len, 0);
      g.addColorStop(0, 'rgba(255,255,255,' + power + ')');
      g.addColorStop(0.25, 'rgba(186,230,253,' + (0.9 * power) + ')');
      g.addColorStop(0.6, 'rgba(251,146,60,' + (0.7 * power) + ')');
      g.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(2, -w);
      ctx.lineTo(-len, 0);
      ctx.lineTo(2, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

window.ExplorationFrigate = ExplorationFrigate;
