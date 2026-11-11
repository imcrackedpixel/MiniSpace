// Station.js - Space Station class
// Used for the High-Sec Ore HQ and the Rogue NPC Station in PvP space.
// Draws the station artwork (station_hq.png) and keeps the docking radius.
// Falls back to a simple hex drawing if the image has not loaded yet.

const SPACE_STATION_IMG = new Image();
SPACE_STATION_IMG.src = 'station_hq.png';

const SPACE_STATION_SCALE = 2.0; // 2012 px wide, about four times the length of the largest ship

class SpaceStation {
    constructor(x, y, name = 'High Sec 1.0') {
        this.x = x;
        this.y = y;
        this.name = name;
        this.radius = 950;          // very large docking radius
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (SPACE_STATION_IMG.complete && SPACE_STATION_IMG.naturalWidth > 0) {
            const w = SPACE_STATION_IMG.naturalWidth * SPACE_STATION_SCALE;
            const h = SPACE_STATION_IMG.naturalHeight * SPACE_STATION_SCALE;
            ctx.drawImage(SPACE_STATION_IMG, -w / 2, -h / 2, w, h);
        } else {
            this.drawFallback(ctx);
        }

        ctx.restore();
    }

    // Simple stand-in shown only until station_hq.png has loaded
    drawFallback(ctx) {
        const drawHex = (size, fill, stroke, lineW = 3) => {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const px = Math.cos(a) * size;
                const py = Math.sin(a) * size;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineW;
            ctx.fill();
            ctx.stroke();
        };

        drawHex(420, '#1a1d24', '#3f4654', 6);
        drawHex(320, '#151819', '#2d3340', 5);
        drawHex(190, '#0f1218', '#3f4654', 4);
        drawHex(110, '#1c1f26', '#4b5563', 3);

        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.name, 0, 590);
    }

    checkDocking(ship) {
        if (!ship) return false;
        const dist = Math.hypot(this.x - ship.x, this.y - ship.y);
        return dist <= 200;
    }
}
