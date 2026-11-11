// BackgroundDecor.js
// - draw():          fixed starfield + nebula, in SCREEN space (call BEFORE your camera transform)
// - drawWorldPlanet(): one rotating ringed planet, in WORLD space (call INSIDE your camera
//                      transform, next to where you draw the station / asteroids)
class BackgroundDecor {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.tileSize = 1024;

        // ---- sky settings ----
        this.staticBackground = true; // true = stars + nebula stay fixed on screen
        this.scrollDir = 1;           // flip to -1 if stars move WITH the ship (parallax mode only)
        this.driftSpeed = 0;          // px/sec constant drift (parallax mode only)
        this.nebulaIntensity = 0.8;

        // ---- planet settings (WORLD units, same as your station/asteroids) ----
        this.planetX = width * 0.7;   // world position of the planet's centre
        this.planetY = height * 0.45;
        this.planetRadius = 180;
        this.planetPalette = 'ice';   // 'ice' | 'dusk' | 'rust'
        this.planetSpin = 0.04;       // radians/sec
        this.ringSpin = 0.025;        // radians/sec
        this.planetTilt = -0.3;       // axis tilt in radians
        this.ringSquash = 0.26;       // ring ellipse flatness (smaller = more edge-on)

        this.nebulae = [
            { tile: this._makeNebulaTile(2048, 7, 0.9), parallax: 0.20 },
            { tile: this._makeNebulaTile(2048, 5, 1.2), parallax: 0.35 }
        ];

        this.starLayers = [
            { tile: this._makeStarTile(this.tileSize, 260, 0.35, 1.0), parallax: 0.15 },
            { tile: this._makeStarTile(this.tileSize, 110, 0.5, 1.4),  parallax: 0.30 },
            { tile: this._makeStarTile(this.tileSize, 35, 0.7, 1.9),   parallax: 0.50 }
        ];

        this._buildPlanet();

        this.twinklers = [];
        for (let i = 0; i < 40; i++) {
            this.twinklers.push({
                x: Math.random() * this.tileSize,
                y: Math.random() * this.tileSize,
                r: Math.random() * 0.8 + 0.8,
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 1.5 + 0.5,
                color: this._starColor()
            });
        }
    }

    // ---------- helpers ----------
    _rand(a, b) { return a + Math.random() * (b - a); }
    _mod(v, m) { return ((v % m) + m) % m; }
    _shade(c, f) { return c.map(v => Math.max(0, Math.min(255, Math.round(v * f)))); }
    _mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

    _starColor() {
        const r = Math.random();
        if (r < 0.45) return [255, 255, 255];
        if (r < 0.75) return [185, 210, 255];
        if (r < 0.92) return [255, 240, 200];
        return [255, 190, 150];
    }

    // ---------- stars ----------
    _makeStarTile(size, count, baseAlpha, maxSize) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');

        for (let i = 0; i < count; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 0.3 + Math.pow(Math.random(), 4) * maxSize;
            const alpha = Math.min(1, baseAlpha + Math.pow(Math.random(), 2) * 0.5);
            const [r, gr, b] = this._starColor();

            if (radius > 1.0) {
                const glowR = radius * 4;
                const grad = g.createRadialGradient(x, y, 0, x, y, glowR);
                grad.addColorStop(0, `rgba(${r},${gr},${b},${alpha * 0.35})`);
                grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
                g.fillStyle = grad;
                g.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
            }
            g.fillStyle = `rgba(${r},${gr},${b},${alpha})`;
            g.beginPath();
            g.arc(x, y, radius, 0, Math.PI * 2);
            g.fill();
        }
        return c;
    }

    // ---------- nebula ----------
    _blob(g, size, x, y, radius, rgb, a) {
        for (let ox = -size; ox <= size; ox += size) {
            for (let oy = -size; oy <= size; oy += size) {
                const cx = x + ox, cy = y + oy;
                if (cx + radius < 0 || cx - radius > size || cy + radius < 0 || cy - radius > size) continue;
                const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
                grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
                grad.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a * 0.4})`);
                grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
                g.fillStyle = grad;
                g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
            }
        }
    }

    _makeNebulaTile(size, clouds, alphaScale) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.globalCompositeOperation = 'lighter';

        const palettes = [
            [[110, 40, 150], [200, 60, 120]],
            [[20, 80, 160],  [40, 180, 200]],
            [[160, 50, 40],  [230, 140, 60]],
            [[30, 110, 90],  [90, 190, 140]]
        ];

        for (let i = 0; i < clouds; i++) {
            const pal = palettes[Math.floor(Math.random() * palettes.length)];
            let x = Math.random() * size;
            let y = Math.random() * size;
            let dir = Math.random() * Math.PI * 2;
            const steps = 40;

            for (let s = 0; s < steps; s++) {
                const col = this._mix(pal[0], pal[1], s / steps);
                const radius = this._rand(70, 190);
                const a = this._rand(0.012, 0.03) * alphaScale * this.nebulaIntensity;
                this._blob(g, size, this._mod(x, size), this._mod(y, size), radius, col, a);

                dir += this._rand(-0.6, 0.6);
                const step = this._rand(25, 60);
                x += Math.cos(dir) * step;
                y += Math.sin(dir) * step;
            }
        }
        return c;
    }

    // ---------- planet ----------
    _buildPlanet() {
        const r = this.planetRadius;
        this.texW = 1024;
        this.texH = 256;
        this.planetTex = this._makePlanetTexture(this.texW, this.texH);
        this.shadeSprite = this._makeShadeSprite(r);
        this.ringTex = this._makeRingTexture(r);

        // Longitude of each pixel column across the sphere
        this.colLon = new Float32Array(Math.ceil(r * 2));
        for (let i = 0; i < this.colLon.length; i++) {
            const nx = (i + 0.5 - r) / r;
            this.colLon[i] = Math.asin(Math.max(-1, Math.min(1, nx)));
        }
    }

    // Clean, soft, seamless banded texture (wraps horizontally)
    _makePlanetTexture(W, H) {
        const palettes = {
            ice:  [[132, 178, 196], [84, 124, 160], [206, 228, 238]],
            dusk: [[150, 130, 190], [88, 80, 150],  [214, 200, 236]],
            rust: [[196, 140, 104], [128, 80, 66],  [232, 196, 160]]
        };
        const [cA, cB, cC] = palettes[this.planetPalette] || palettes.ice;

        const base = document.createElement('canvas');
        base.width = W; base.height = H;
        const g = base.getContext('2d');

        const p = Math.random() * 6;
        for (let y = 0; y < H; y++) {
            const t = y / H;
            // Smooth, low-contrast bands
            const v = 0.5 + 0.5 * Math.sin(t * 14 + Math.sin(t * 5 + p) * 1.4);
            const hi = 0.5 + 0.5 * Math.sin(t * 33 + p * 2);
            let col = this._mix(cA, cB, v * 0.8);
            col = this._mix(col, cC, hi * 0.18);
            g.fillStyle = `rgb(${col.map(Math.round)})`;
            g.fillRect(0, y, W, 1);
        }

        // A few very faint soft streaks for subtle texture (no blotches)
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * W, y = Math.random() * H;
            const len = this._rand(120, 320), h = this._rand(2, 6);
            g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(10,20,40,0.045)';
            for (const px of [x - W, x, x + W]) {
                g.beginPath();
                g.ellipse(px, y, len, h, 0, 0, Math.PI * 2);
                g.fill();
            }
        }

        // Extra pixels on the right so column sampling never runs off the edge
        const out = document.createElement('canvas');
        out.width = W + 8; out.height = H;
        const o = out.getContext('2d');
        o.drawImage(base, 0, 0);
        o.drawImage(base, 0, 0, 8, H, W, 0, 8, H);
        return out;
    }

    // Night-side shadow + atmosphere glow (never rotates)
    _makeShadeSprite(r) {
        const size = Math.ceil(r * 2 * 1.4);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const cx = size / 2, cy = size / 2;

        const atm = g.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.22);
        atm.addColorStop(0, 'rgba(170,215,255,0.28)');
        atm.addColorStop(1, 'rgba(170,215,255,0)');
        g.fillStyle = atm;
        g.beginPath();
        g.arc(cx, cy, r * 1.22, 0, Math.PI * 2);
        g.fill();

        g.save();
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.clip();
        const sh = g.createRadialGradient(cx - r * 0.5, cy - r * 0.5, r * 0.3, cx - r * 0.5, cy - r * 0.5, r * 1.9);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(0.5, 'rgba(0,2,12,0.45)');
        sh.addColorStop(1, 'rgba(0,2,12,0.94)');
        g.fillStyle = sh;
        g.fillRect(0, 0, size, size);

        const limb = g.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);
        limb.addColorStop(0, 'rgba(0,0,0,0)');
        limb.addColorStop(1, 'rgba(0,0,0,0.3)');
        g.fillStyle = limb;
        g.fillRect(0, 0, size, size);
        g.restore();
        return c;
    }

    // Thin, clean rings with just enough angular variation to see them spin
    _makeRingTexture(r) {
        const outer = r * 2.1;
        const R = Math.ceil(outer + 4);
        const c = document.createElement('canvas');
        c.width = c.height = R * 2;
        const g = c.getContext('2d');
        g.translate(R, R);

        // [inner, outer, strength] as multiples of the planet radius
        const bands = [
            [1.35, 1.50, 0.30],
            [1.58, 1.82, 0.50],
            [1.90, 2.02, 0.22]
        ];
        const tint = [214, 226, 238];
        const SEG = 120;

        for (const [i0, i1, strength] of bands) {
            for (let rad = r * i0; rad < r * i1; rad += 1.5) {
                const t = (rad - r * i0) / (r * (i1 - i0));
                const edge = Math.sin(t * Math.PI);          // soft edges
                const fine = 0.85 + 0.15 * Math.sin(rad * 0.6); // faint fine grooves
                for (let s = 0; s < SEG; s++) {
                    const clump = 0.82 + 0.18 * Math.sin(s * 0.35 + rad * 0.02);
                    const a = strength * edge * fine * clump;
                    g.strokeStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
                    g.lineWidth = 2;
                    g.beginPath();
                    const a0 = (s / SEG) * Math.PI * 2;
                    g.arc(0, 0, rad, a0, a0 + (Math.PI * 2) / SEG + 0.02);
                    g.stroke();
                }
            }
        }
        return c;
    }

    _drawRingHalf(ctx, half, spin) {
        const R = this.ringTex.width / 2;
        ctx.save();
        ctx.rotate(this.planetTilt);
        ctx.beginPath();
        if (half === 'back') ctx.rect(-R * 2, -R * 2, R * 4, R * 2);
        else ctx.rect(-R * 2, 0, R * 4, R * 2);
        ctx.clip();
        ctx.scale(1, this.ringSquash);
        ctx.rotate(spin);
        ctx.drawImage(this.ringTex, -R, -R);
        ctx.restore();
    }

    // Call this INSIDE your camera transform (world space), before drawing station/asteroids/ships,
    // so the planet moves exactly like every other world object.
    drawWorldPlanet(ctx) {
        const t = performance.now() / 1000;
        const r = this.planetRadius;
        const rot = t * this.planetSpin;
        const spin = t * this.ringSpin;

        ctx.save();
        ctx.translate(this.planetX, this.planetY);

        // 1. back half of the rings
        this._drawRingHalf(ctx, 'back', spin);

        // 2. rotating sphere
        ctx.save();
        ctx.rotate(this.planetTilt);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        const TW = this.texW, TH = this.texH;
        for (let i = 0; i < this.colLon.length; i++) {
            const u = this._mod((this.colLon[i] - rot) / (Math.PI * 2), 1);
            ctx.drawImage(this.planetTex, u * TW, 0, 2, TH, -r + i, -r, 1.3, r * 2);
        }
        ctx.restore();

        // 3. lighting + atmosphere (fixed light direction)
        const s = this.shadeSprite;
        ctx.drawImage(s, -s.width / 2, -s.height / 2);

        // 4. front half of the rings
        this._drawRingHalf(ctx, 'front', spin);

        ctx.restore();
    }

    // ---------- sky drawing ----------
    _drawTiled(ctx, tile, camX, camY, parallax, screenW, screenH) {
        const s = tile.width;
        let ox = -((camX * parallax) % s);
        let oy = -((camY * parallax) % s);
        if (ox > 0) ox -= s;
        if (oy > 0) oy -= s;
        for (let x = ox; x < screenW; x += s) {
            for (let y = oy; y < screenH; y += s) {
                ctx.drawImage(tile, Math.floor(x), Math.floor(y));
            }
        }
    }

    // Call in SCREEN space, BEFORE your camera transform / zoom is applied.
    draw(ctx, camX, camY, screenW, screenH, zoom = 1) {
        camX *= zoom * this.scrollDir;
        camY *= zoom * this.scrollDir;
        if (this.driftSpeed) camX += (performance.now() / 1000) * this.driftSpeed;
        if (this.staticBackground) { camX = 0; camY = 0; }

        const t = performance.now() / 1000;

        ctx.save();

        ctx.fillStyle = '#04060b';
        ctx.fillRect(0, 0, screenW, screenH);

        for (const n of this.nebulae) {
            this._drawTiled(ctx, n.tile, camX, camY, n.parallax, screenW, screenH);
        }

        const L = this.starLayers;
        for (const layer of L) {
            this._drawTiled(ctx, layer.tile, camX, camY, layer.parallax, screenW, screenH);
        }

        // Twinkling stars
        const s = this.tileSize, par = L[2].parallax;
        for (const st of this.twinklers) {
            const x = this._mod(st.x - camX * par, s);
            const y = this._mod(st.y - camY * par, s);
            const tw = 0.55 + 0.45 * Math.sin(t * st.speed + st.phase);
            const [r, g, b] = st.color;
            ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + tw * 0.5})`;
            for (let px = x; px < screenW; px += s) {
                for (let py = y; py < screenH; py += s) {
                    ctx.beginPath();
                    ctx.arc(px, py, st.r * (0.8 + tw * 0.3), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        ctx.restore();
    }
}
