// DebrisField.js - Capped max 3 wrecks with balanced yields and auto-refresh.
// Wrecks are broken satellites or destroyed ships, shaded with gradients, scorch marks, cracks and embers.
class DebrisField {
    constructor(x, y, count = 3, radius = 5000, minTier = 1) {
        this.x = x;
        this.minTier = Math.max(1, Math.min(5, Math.floor(Number(minTier) || 1)));
        this.y = y;
        this.radius = radius;
        this.entities = [];
        this.init(Math.min(3, count), radius);
    }

    init(count, radius) {
        // Wreck salvage is a useful income stream, but should not fund a carrier in one haul.
        // Tier 5 now holds 50 Processors (25m value), down from 150 (75m).
        const tierTypes = [
            { tier: 1, name: 'Frigate Wreck (Tier 1)', color: '#8b949e', yield: 10 },
            { tier: 2, name: 'Destroyer Hull (Tier 2)', color: '#58a6ff', yield: 20 },
            { tier: 3, name: 'Cruiser Wreck (Tier 3)', color: '#3fb950', yield: 30 },
            { tier: 4, name: 'Battleship Remains (Tier 4)', color: '#d29922', yield: 40 },
            { tier: 5, name: 'Capital Derelict (Tier 5)', color: '#f85149', yield: 50 }
        ];

        const mapSize = radius || 5000;
        const spawnCount = 1 + Math.floor(Math.random() * 3); // Spawns 1, 2, or 3 wrecks max

        for (let i = 0; i < spawnCount; i++) {
            const rx = 500 + Math.random() * (mapSize - 1000);
            const ry = 500 + Math.random() * (mapSize - 1000);
            const availableTiers = tierTypes.filter(t => t.tier >= (this.minTier || 1));
            const tierData = availableTiers[Math.floor(Math.random() * availableTiers.length)];
            const baseRadius = 25 + (tierData.tier * 12) + Math.random() * 15;
            // Tier 5 (red) relics are always capital derelicts
            const kind = tierData.tier === 5 ? 'capital' : (Math.random() < 0.5 ? 'satellite' : 'ship');

            // Hull outline for ships. Radius varies so the edges look bent and uneven.
            const pointsCount = 6 + Math.floor(Math.random() * 5);
            const vertices = [];
            for (let v = 0; v < pointsCount; v++) {
                const angle = (v / pointsCount) * Math.PI * 2;
                const vRad = baseRadius * (0.6 + Math.random() * 0.8);
                vertices.push({ x: Math.cos(angle) * vRad, y: Math.sin(angle) * vRad });
            }
            const breakAt = Math.floor(Math.random() * pointsCount);
            const bA = vertices[breakAt], bB = vertices[(breakAt + 1) % pointsCount];
            const breakX = (bA.x + bB.x) / 2;
            const breakY = (bA.y + bB.y) / 2;

            // Cracks: jagged lines running out from random points on the wreck
            const cracks = [];
            const crackCount = 2 + Math.floor(Math.random() * 3);
            for (let c = 0; c < crackCount; c++) {
                const sx = (Math.random() - 0.5) * baseRadius * 1.2;
                const sy = (Math.random() - 0.5) * baseRadius * 1.2;
                const a = Math.random() * Math.PI * 2;
                const len = baseRadius * (0.3 + Math.random() * 0.4);
                const pts = [{ x: sx, y: sy }];
                for (let s = 1; s <= 3; s++) {
                    const f = s / 3;
                    const jitter = (Math.random() - 0.5) * baseRadius * 0.15;
                    pts.push({
                        x: sx + Math.cos(a) * len * f - Math.sin(a) * jitter,
                        y: sy + Math.sin(a) * len * f + Math.cos(a) * jitter
                    });
                }
                cracks.push(pts);
            }

            // Loose fragments drifting off the wreck
            const frags = [];
            const fragCount = 3 + Math.floor(Math.random() * 4);
            for (let f = 0; f < fragCount; f++) {
                const fa = Math.random() * Math.PI * 2;
                const fd = baseRadius * (1.1 + Math.random() * 0.7);
                frags.push({
                    x: Math.cos(fa) * fd,
                    y: Math.sin(fa) * fd,
                    s: baseRadius * (0.04 + Math.random() * 0.07),
                    r: Math.random() * Math.PI * 2,
                    sides: 3 + Math.floor(Math.random() * 2)
                });
            }

            // Satellite parts: bus size, solar panels (one is torn), antenna length
            const bw = baseRadius * (0.6 + Math.random() * 0.3);
            const bh = baseRadius * (0.45 + Math.random() * 0.2);
            const panelW = baseRadius * (0.9 + Math.random() * 0.5);
            const panelH = baseRadius * 0.38;
            const tornSide = Math.random() < 0.5 ? -1 : 1;
            const antennaLen = baseRadius * (0.8 + Math.random() * 0.4);

            // Capital derelict: half-length and half-width of the hull, and the phase of its spark bursts
            const capL = baseRadius * 1.0;
            const capW = baseRadius * 0.4;
            const sparkSeed = Math.random() * 60;

            this.entities.push({
                x: rx,
                y: ry,
                radius: baseRadius,
                kind: kind,
                vertices: vertices,
                breakAt: breakAt,
                breakX: breakX,
                breakY: breakY,
                cracks: cracks,
                frags: frags,
                seed: Math.floor(Math.random() * 100),
                capL: capL,
                capW: capW,
                sparkSeed: sparkSeed,
                bw: bw,
                bh: bh,
                panelW: panelW,
                panelH: panelH,
                tornSide: tornSide,
                antennaLen: antennaLen,
                tier: tierData.tier,
                name: tierData.name,
                color: tierData.color,
                oreYield: tierData.yield,
                maxYield: tierData.yield,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.002,
                t: Math.random() * 100,
                emberPhase: Math.random() * Math.PI * 2
            });
        }
    }

    getEntities() {
        return this.entities.filter(e => e.oreYield > 0);
    }

    update() {
        for (const deb of this.entities) {
            deb.rotation += deb.rotSpeed;
            deb.t += 1;
        }

        // If all wrecks are completely looted, respawn fresh ones (max 3)
        const activeWrecks = this.entities.filter(e => e.oreYield > 0);
        if (activeWrecks.length === 0) {
            this.entities = [];
            this.init(3, this.radius);
        }
    }

    draw(ctx) {
        for (const deb of this.entities) {
            if (deb.oreYield <= 0) continue;
            // Restore the detailed wreck/relic artwork: hull plating, solar panels,
            // broken fragments, glowing cracks and embers.
            ctx.save();
            ctx.translate(deb.x, deb.y);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.ellipse(4, 5, deb.radius * 1.05, deb.radius * 0.85, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.rotate(deb.rotation || 0);
            this.drawFragments(ctx, deb);
            if (deb.kind === 'satellite') this.drawSatellite(ctx, deb);
            else if (deb.kind === 'capital') this.drawCapital(ctx, deb);
            else this.drawShip(ctx, deb);
            this.drawCracks(ctx, deb);
            if (deb.kind !== 'capital') this.drawEmber(ctx, deb);
            ctx.restore();

            ctx.save();
            ctx.translate(deb.x, deb.y - deb.radius - 8);
            ctx.fillStyle = deb.color || '#8b949e';
            ctx.font = 'bold 8px Courier New';
            ctx.textAlign = 'center';
            const kindLabel = deb.kind === 'satellite' ? 'SATELLITE' : (deb.kind === 'capital' ? 'CAPITAL' : 'HULL');
            ctx.fillText('T' + deb.tier + ' ' + kindLabel + ' · ' + Math.floor(deb.oreYield), 0, 0);
            ctx.restore();
        }
    }

    // Small broken plates drifting around the wreck
    drawFragments(ctx, deb) {
        for (const f of deb.frags) {
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.r);
            ctx.beginPath();
            for (let i = 0; i < f.sides; i++) {
                const a = (i / f.sides) * Math.PI * 2;
                const rr = f.s * (i % 2 ? 0.6 : 1);
                const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = '#1a1f27';
            ctx.fill();
            ctx.strokeStyle = deb.color;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }

    // A destroyed ship: shaded plating, rivets and seams, scorched break, bent spar, dim engine core
    drawShip(ctx, deb) {
        const v = deb.vertices, n = v.length, b = deb.breakAt, R = deb.radius;

        const hullPath = () => {
            ctx.beginPath();
            ctx.moveTo(v[0].x, v[0].y);
            for (let i = 1; i < n; i++) ctx.lineTo(v[i].x, v[i].y);
            ctx.closePath();
        };

        // Body: metal gradient, clipped to the hull so all detail stays inside
        ctx.save();
        hullPath();
        const metal = ctx.createLinearGradient(-R, -R * 0.6, R, R * 0.6);
        metal.addColorStop(0, '#2b323c');
        metal.addColorStop(0.5, '#12161c');
        metal.addColorStop(1, '#232a33');
        ctx.fillStyle = metal;
        ctx.fill();
        ctx.clip();

        // Inner plating: a scaled-in polygon, seams to the outline, rivets at the corners
        const inner = v.map(p => ({ x: p.x * 0.68, y: p.y * 0.68 }));
        ctx.beginPath();
        ctx.moveTo(inner[0].x, inner[0].y);
        for (let i = 1; i < n; i++) ctx.lineTo(inner[i].x, inner[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            ctx.moveTo(inner[i].x, inner[i].y);
            ctx.lineTo(v[i].x, v[i].y);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(170,180,195,0.45)';
        for (const p of inner) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.8, R * 0.04), 0, Math.PI * 2);
            ctx.fill();
        }

        // Scorch around the break
        const sg = ctx.createRadialGradient(deb.breakX, deb.breakY, 0, deb.breakX, deb.breakY, R * 0.9);
        sg.addColorStop(0, 'rgba(0,0,0,0.85)');
        sg.addColorStop(0.45, 'rgba(60,28,12,0.55)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);

        // Light from the upper left, shadow on the lower right
        const lg = ctx.createLinearGradient(-R, -R, R * 0.4, R * 0.4);
        lg.addColorStop(0, 'rgba(255,255,255,0.10)');
        lg.addColorStop(0.5, 'rgba(255,255,255,0)');
        lg.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = lg;
        ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
        ctx.restore();

        // Outline, leaving a gap where the hull broke
        ctx.strokeStyle = deb.color;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            if (i === b) continue;
            const p = v[i], q = v[(i + 1) % n];
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();

        // Jagged torn ends on either side of the gap
        const p = v[b], q = v[(b + 1) % n];
        const jag = (fromT, toT) => {
            ctx.moveTo(p.x + (q.x - p.x) * fromT, p.y + (q.y - p.y) * fromT);
            for (let s = 1; s <= 3; s++) {
                const t = fromT + (toT - fromT) * (s / 3);
                const side = s === 3 ? 0 : (s % 2 === 0 ? 3 : -3);
                ctx.lineTo(p.x + (q.x - p.x) * t + side, p.y + (q.y - p.y) * t - side);
            }
        };
        ctx.beginPath();
        jag(0, 0.3);
        jag(0.7, 1);
        ctx.stroke();

        // Bent internal spar with a snapped section
        const sparEnd = v[(b + 2) % n];
        ctx.strokeStyle = deb.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sparEnd.x * 0.2, sparEnd.y * 0.2);
        ctx.lineTo(sparEnd.x * 0.45, sparEnd.y * 0.45);
        ctx.moveTo(sparEnd.x * 0.6, sparEnd.y * 0.6);
        ctx.lineTo(sparEnd.x * 0.85, sparEnd.y * 0.85);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Dim engine core with a soft glow, flickering
        const pulse = 0.5 + 0.5 * Math.sin(deb.t * 0.05 + deb.emberPhase);
        const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.3);
        eg.addColorStop(0, 'rgba(255,255,255,' + (0.25 + 0.15 * pulse) + ')');
        eg.addColorStop(0.4, deb.color);
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.35 + 0.2 * pulse;
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Tier 5 capital derelict: a snapped battleship hull with a sheared bridge tower, dark hangar bays,
    // turret stubs (one with a snapped barrel), exposed conduit across the break, and sparks in short bursts
    drawCapital(ctx, deb) {
        const L = deb.capL, W = deb.capW;
        const off = W * 0.18;      // the aft section has slid sideways where the spine broke
        const brk = -L * 0.08;     // x of the break
        const rearX = -L * 0.02;   // x of the aft section's forward edge

        const poly = (pts) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
        };
        const front = [[L, 0], [L * 0.8, -W * 0.6], [L * 0.5, -W], [brk, -W], [brk, W], [L * 0.5, W], [L * 0.8, W * 0.6]];
        const rear = [
            [rearX, -W * 0.94 + off], [-L * 0.6, -W + off], [-L, -W * 0.7 + off],
            [-L, W * 0.7 + off], [-L * 0.6, W + off], [rearX, W * 0.94 + off]
        ];
        const metal = ctx.createLinearGradient(0, -W, 0, W);
        metal.addColorStop(0, '#2d343e');
        metal.addColorStop(0.5, '#12161c');
        metal.addColorStop(1, '#1f252d');

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = deb.color;

        // Snapped aft section
        poly(rear);
        ctx.fillStyle = metal;
        ctx.fill();
        ctx.stroke();

        // Bridge tower on the top side, its upper part sheared off
        ctx.beginPath();
        ctx.moveTo(L * 0.12, -W * 0.9);
        ctx.lineTo(L * 0.30, -W * 0.9);
        ctx.lineTo(L * 0.28, -W * 1.30);
        ctx.lineTo(L * 0.25, -W * 1.45);
        ctx.lineTo(L * 0.19, -W * 1.30);
        ctx.lineTo(L * 0.16, -W * 1.42);
        ctx.lineTo(L * 0.12, -W * 1.25);
        ctx.closePath();
        ctx.fillStyle = metal;
        ctx.fill();
        ctx.stroke();
        // Bridge windows: most are dark, a few flicker on
        for (let i = 0; i < 3; i++) {
            const lit = Math.sin(deb.t * 0.07 + i * 2.1 + deb.sparkSeed) > 0.7;
            ctx.fillStyle = lit ? 'rgba(255,190,110,0.85)' : 'rgba(40,30,20,0.9)';
            ctx.fillRect(L * 0.14 + i * L * 0.05, -W * 1.02, L * 0.03, W * 0.14);
        }

        // Forward hull
        poly(front);
        ctx.fillStyle = metal;
        ctx.fill();
        ctx.stroke();

        // Plating seams along both sections
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const s of [-1, 1]) {
            ctx.moveTo(L * 0.5, s * W * 0.4);
            ctx.lineTo(brk, s * W * 0.4);
            ctx.moveTo(-L * 0.6, s * W * 0.4 + off);
            ctx.lineTo(rearX, s * W * 0.4 + off);
        }
        ctx.stroke();

        // Dark hangar bays on both flanks
        for (const s of [-1, 1]) {
            for (const bx of [0.1, 0.3]) {
                const y = s > 0 ? W * 0.55 : -W * 0.85;
                ctx.fillStyle = 'rgba(0,0,0,0.85)';
                ctx.fillRect(L * bx, y, L * 0.14, W * 0.3);
                ctx.strokeStyle = 'rgba(139,148,158,0.5)';
                ctx.strokeRect(L * bx, y, L * 0.14, W * 0.3);
            }
        }

        // Turret stubs on the underside: the aft one has a snapped barrel
        const turrets = [[L * 0.36, W, 0.7], [-L * 0.42, W + off, 0.4]];
        ctx.strokeStyle = deb.color;
        for (const [tx, ty, barrel] of turrets) {
            ctx.fillStyle = '#0d1117';
            ctx.beginPath();
            ctx.arc(tx, ty, W * 0.22, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx + W * 0.2, ty + W * barrel);
            ctx.stroke();
        }

        // Exposed conduit bridging the break
        const cx = brk + L * 0.03, cy = -W * 0.25 + off * 0.5;
        ctx.strokeStyle = 'rgba(139,148,158,0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (const s of [-1, 1]) {
            const y0 = s * W * 0.25, y1 = s * W * 0.25 + off;
            ctx.moveTo(brk, y0);
            ctx.lineTo(cx, (y0 + y1) / 2 + s * 2);
            ctx.lineTo(rearX, y1);
        }
        ctx.stroke();

        // Sparks: a short burst of streaks every 60 frames, radiating from the conduit
        const phase = (deb.t + deb.sparkSeed) % 60;
        if (phase < 8) {
            const k = 1 - phase / 8;
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = 'rgba(255,215,160,' + k + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const a = i * 1.26 + deb.sparkSeed;
                const r0 = 2 + phase * 0.8;
                ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
                ctx.lineTo(cx + Math.cos(a) * (r0 + 5), cy + Math.sin(a) * (r0 + 5));
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        // Aft nozzles: three dark bells on the stern
        ctx.fillStyle = '#0d1117';
        ctx.strokeStyle = deb.color;
        ctx.lineWidth = 1.2;
        for (const s of [-0.3, 0, 0.3]) {
            const y = s * W * 0.6 + off;
            ctx.fillRect(-L - 3, y - W * 0.12, 4, W * 0.24);
            ctx.strokeRect(-L - 3, y - W * 0.12, 4, W * 0.24);
        }

        ctx.restore();
    }

    // Panel outline helper: a rectangle, or a ragged-edged shape for the torn panel
    panelPath(ctx, side, xl, xr, pw, ph, torn) {
        ctx.beginPath();
        if (!torn) {
            ctx.rect(xl, -ph / 2, pw, ph);
            return;
        }
        const outer = side > 0 ? xr : xl;
        const inner = side > 0 ? xl : xr;
        ctx.moveTo(inner, -ph / 2);
        ctx.lineTo(outer, -ph / 2);
        const pts = [[-ph / 4, 0.14], [0, 0.04], [ph / 4, 0.18], [ph / 2, 0.03]];
        for (const [y, d] of pts) ctx.lineTo(outer - side * pw * d, y);
        ctx.lineTo(inner, ph / 2);
        ctx.closePath();
    }

    // A destroyed satellite: foil-wrapped bus, damaged solar arrays with dead cells, broken dish, dying beacon
    drawSatellite(ctx, deb) {
        const bw = deb.bw, bh = deb.bh, pw = deb.panelW, ph = deb.panelH, R = deb.radius;

        // Support struts from the bus to each panel
        ctx.strokeStyle = '#3a424d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const side of [-1, 1]) {
            ctx.moveTo(side * bw / 2, 0);
            ctx.lineTo(side * (bw / 2 + 4), 0);
        }
        ctx.stroke();

        // Solar arrays
        for (const side of [-1, 1]) {
            const x0 = side * (bw / 2 + 4);
            const x1 = x0 + side * pw;
            const xl = Math.min(x0, x1), xr = Math.max(x0, x1);
            const torn = side === deb.tornSide;

            ctx.save();
            this.panelPath(ctx, side, xl, xr, pw, ph, torn);
            const pg = ctx.createLinearGradient(xl, -ph / 2, xr, ph / 2);
            pg.addColorStop(0, '#1f5a8a');
            pg.addColorStop(0.5, '#0d2d4a');
            pg.addColorStop(1, '#071827');
            ctx.fillStyle = pg;
            ctx.fill();
            ctx.clip();

            // Cell grid
            ctx.strokeStyle = 'rgba(120,180,230,0.22)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (let k = 1; k < 4; k++) {
                const gx = xl + pw * k / 4;
                ctx.moveTo(gx, -ph / 2);
                ctx.lineTo(gx, ph / 2);
            }
            ctx.moveTo(xl, 0);
            ctx.lineTo(xr, 0);
            ctx.stroke();

            // Dead cells, scattered by the wreck's seed
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            for (let k = 0; k < 4; k++) {
                for (let j = 0; j < 2; j++) {
                    if ((k * 3 + j * 5 + deb.seed + side) % 5 === 0) {
                        ctx.fillRect(xl + pw * k / 4 + 1, -ph / 2 + ph * j / 2 + 1, pw / 4 - 2, ph / 2 - 2);
                    }
                }
            }
            ctx.restore();

            // Frame
            this.panelPath(ctx, side, xl, xr, pw, ph, torn);
            ctx.strokeStyle = deb.color;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Bus: metal gradient with a foil-wrapped patch
        ctx.save();
        const bg = ctx.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2);
        bg.addColorStop(0, '#8c949e');
        bg.addColorStop(0.5, '#3a414b');
        bg.addColorStop(1, '#1a1f26');
        ctx.fillStyle = bg;
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

        ctx.fillStyle = 'rgba(176,132,52,0.55)';
        ctx.fillRect(-bw * 0.42, -bh * 0.42, bw * 0.38, bh * 0.4);
        ctx.strokeStyle = 'rgba(255,220,140,0.25)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
            const yy = -bh * 0.42 + bh * 0.1 * k;
            ctx.moveTo(-bw * 0.42, yy);
            ctx.lineTo(-bw * 0.04, yy + bh * 0.05);
        }
        ctx.stroke();

        // Scorch on the bus
        const sc = ctx.createRadialGradient(bw * 0.2, bh * 0.15, 0, bw * 0.2, bh * 0.15, bw * 0.4);
        sc.addColorStop(0, 'rgba(0,0,0,0.9)');
        sc.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sc;
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        ctx.restore();

        ctx.strokeStyle = deb.color;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

        // Mast
        const topY = -bh / 2 - deb.antennaLen;
        ctx.strokeStyle = '#8c949e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -bh / 2);
        ctx.lineTo(0, topY);
        ctx.stroke();

        // Broken dish: partial arc with mesh spokes and a snapped arm
        const dx = bw * 0.25, dy = -bh / 2 - deb.antennaLen * 0.6, dr = R * 0.18;
        const a0 = Math.PI * 0.1, a1 = Math.PI * 1.2;
        ctx.strokeStyle = deb.color;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, a0, a1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(200,210,220,0.35)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) {
            const a = a0 + (a1 - a0) * (k / 4);
            ctx.moveTo(dx, dy);
            ctx.lineTo(dx + Math.cos(a) * dr, dy + Math.sin(a) * dr);
        }
        ctx.stroke();
        ctx.strokeStyle = '#8c949e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, dy + 2);
        ctx.lineTo(dx * 0.5, dy + 1);
        ctx.stroke();

        // Beacon: flickering glow with a solid core
        const flick = 0.3 + 0.7 * Math.max(0, Math.sin(deb.t * 0.08 + deb.emberPhase));
        const bgl = ctx.createRadialGradient(0, topY, 0, 0, topY, 8);
        bgl.addColorStop(0, 'rgba(248,81,73,' + (0.8 * flick) + ')');
        bgl.addColorStop(1, 'rgba(248,81,73,0)');
        ctx.fillStyle = bgl;
        ctx.beginPath();
        ctx.arc(0, topY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = flick;
        ctx.fillStyle = '#ff8a80';
        ctx.beginPath();
        ctx.arc(0, topY, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Glowing cracks: a soft wide pass under a sharp pulsing line
    drawCracks(ctx, deb) {
        const pulse = 0.5 + 0.5 * Math.sin(deb.t * 0.03 + deb.emberPhase);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const pts of deb.cracks) {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.strokeStyle = 'rgba(255,140,60,' + (0.12 + 0.1 * pulse) + ')';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,170,90,' + (0.5 + 0.3 * pulse) + ')';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
    }

    // Embers at the start of each crack, each flickering on its own phase
    drawEmber(ctx, deb) {
        ctx.globalCompositeOperation = 'lighter';
        deb.cracks.forEach((pts, i) => {
            const k = 0.5 + 0.5 * Math.sin(deb.t * 0.1 + deb.emberPhase + i * 1.7);
            if (k < 0.3) return;
            const ex = pts[0].x, ey = pts[0].y;
            const r = deb.radius * 0.3;
            const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
            g.addColorStop(0, 'rgba(255,200,120,' + (0.6 * k) + ')');
            g.addColorStop(1, 'rgba(249,115,22,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(ex, ey, r, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
    }
}