// ShipArt.js - Shared ship artwork loader.
// Every ship is drawn from a PNG in the same folder as Index.html.
// Art files should be drawn nose-up (pointing to the top of the image).
// Load this file BEFORE any ship class file and before MainGameController.js.
(function () {
  // className -> artwork. scale multiplies the PNG's pixel size into game units.
  // size is the placeholder box shown until the PNG has loaded (also used as a fallback).
  const ART = {
    'Siege Capital':      { file: 'siege_capital.png',      scale: 1.0, size: [300, 560] },
    'Carrier':            { file: 'carrier.png',            scale: 1.0, size: [170, 460] },
    'Mining Capital':     { file: 'mining_capital.png',     scale: 1.0, size: [420, 180] },
    'Command Ship':       { file: 'command_ship.png',       scale: 1.0, size: [260, 140] },
    'Combat Frigate':     { file: 'combat_frigate.png',     scale: 1.0, size: [160, 70] },
    'Exploration Frigate':{ file: 'exploration_frigate.png', scale: 0.5, size: [41, 66] },
    'Improved Explorer Frigate': { file: 'improved_explorer_frigate.png', scale: 0.125, size: [41, 66] },
    'Mining Barge':       { file: 'mining_barge.png',       scale: 1.0, size: [200, 100] },
    'Mining Frigate':     { file: 'mining_frigate.png',     scale: 0.25, size: [75, 120] }
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

  // Draw a ship at world position (x, y) facing `angle` (radians, nose along the heading).
  // Returns false if the className has no artwork registered.
  function draw(c, className, x, y, angle) {
    const entry = ART[className];
    if (!entry) return false;
    const img = imageFor(entry);
    c.save();
    c.translate(x, y);
    c.rotate((angle || 0) + Math.PI / 2); // art is nose-up; the game's heading is nose +x
    if (img.complete && img.naturalWidth > 0) {
      const w = img.naturalWidth * entry.scale, h = img.naturalHeight * entry.scale;
      c.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      // Placeholder until the PNG loads, so the ship is never invisible
      const [w, h] = entry.size;
      c.fillStyle = 'rgba(88, 166, 255, 0.25)';
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
