// ShipArt.js - Shared ship artwork loader.
(function () {
    const ART = {
        'Siege Capital': { file: 'siege_capital.png', length: 460, rot: Math.PI / 2, size: [300, 560] },
        'Siege Battleship': { file: 'siege_battleship.png', length: 460, rot: Math.PI / 2, size: [300, 560] },
        'Carrier': { file: 'carrier.png', length: 460, size: [170, 460] },
        'Mining Capital': { file: 'mining_capital.png', length: 460, size: [420, 180] },
        'Command Ship': { file: 'command_ship.png', length: 200, size: [260, 140] },
        'Combat Frigate': { file: 'combat_frigate.png', length: 100, rot: Math.PI / -2, size: [160, 70] },
        'Explorer Cruiser': { file: 'explorer_cruiser.png', length: 200, rot: 0, size: [60, 100] },
        'Exploration Frigate': { file: 'exploration_frigate.png', length: 70, size: [41, 66] },
        'Improved Explorer Frigate': { file: 'improved_explorer_frigate.png', length: 70, size: [41, 66] },
        'Mining Barge': { file: 'mining_barge.png', length: 100, size: [200, 100] },
        'Mining Frigate': { file: 'mining_frigate.png', length: 110, size: [75, 120] },
        'Transport Capital': { file: 'transport_capital.png', length: 480, rot: Math.PI, size: [420, 200] }
    };

    const cache = {};

    function imageFor(entry) {
        if (!cache[entry.file]) {
            const img = new Image();
            img.src = entry.file;
            cache[entry.file] = img;
        }
        return cache[entry.file];
    }

    function draw(c, className, x, y, angle) {
        const entry = ART[className];
        if (!entry) return false;
        const img = imageFor(entry);
        c.save();
        c.translate(x, y);
        c.rotate((angle || 0) + Math.PI / 2 + (entry.rot || 0));
        if (img.complete && img.naturalWidth > 0) {
            const scale = entry.length
                ? entry.length / Math.max(img.naturalWidth, img.naturalHeight)
                : entry.scale;
            const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
            c.drawImage(img, -w / 2, -h / 2, w, h);
        } else {
            const [w, h] = entry.size;
            c.fillStyle = 'rgba(88, 166, 255,0.25)';
            c.strokeStyle = 'rgba(88, 166, 255, 0.8)';
            c.lineWidth = 2;
            c.fillRect(-w / 2, -h / 2, w, h);
            c.strokeRect(-w / 2, -h / 2, w, h);
        }
        c.restore();
        return true;
    }

    window.ShipArt = { draw: draw, ART: ART };
})();
