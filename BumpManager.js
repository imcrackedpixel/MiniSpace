// BumpCollide.js - automatic ship-on-ship collisions based on the drawn ship art.
// Replaces BumpManager.js. No button: bumps happen whenever two ships' artwork overlaps.
//
// Load AFTER ShipArt.js and the ship class files, BEFORE MainGameController.js:
//   <script src="BumpCollide.js"></script>
//
// Hook-up: call once per frame, after every ship has moved:
//   BumpCollide.resolveAll([playerShip, ...npcShips, ...botShips]);

(function () {
  const TUNING = {
    restitution: 0.5,     // 0 = dead stop, 1 = bouncy
    fallbackW: 80,        // used if a ship has no artwork size
    fallbackH: 80
  };

  // Drawn size of a ship: [across, along-heading]. Art is nose-up, so its height runs along the nose.
  function dimsOf(s) {
    let dims = null;
    if (window.ShipArt && typeof window.ShipArt.size === 'function') {
      dims = window.ShipArt.size(s.className);
    }
    if (!dims && window.ShipArt && window.ShipArt.ART && window.ShipArt.ART[s.className]) {
      dims = window.ShipArt.ART[s.className].size;
    }
    if (!dims) dims = [TUNING.fallbackW, TUNING.fallbackH];
    return { across: dims[0], along: dims[1] };
  }

  function alive(s) {
    return s && !s.docked && (s.structure === undefined || s.structure > 0);
  }

  // Oriented box for a ship: centre, nose axis, side axis, half sizes.
  function boxOf(s) {
    const d = dimsOf(s);
    const a = s.angle || 0;
    const c = Math.cos(a), sn = Math.sin(a);
    return {
      s: s,
      x: s.x, y: s.y,
      nx: c, ny: sn,          // along the nose
      px: -sn, py: c,         // across the ship
      hl: d.along / 2,        // half length along the nose
      hw: d.across / 2        // half width across
    };
  }

  // Half-extent of a box when projected onto axis (ax, ay).
  function extentOn(b, ax, ay) {
    return b.hl * Math.abs(b.nx * ax + b.ny * ay) + b.hw * Math.abs(b.px * ax + b.py * ay);
  }

  // Separating Axis Test between two oriented boxes.
  // Returns null if they do not overlap, or { ax, ay, depth } for the smallest push-out axis.
  function overlapAxis(A, B) {
    const cdx = B.x - A.x, cdy = B.y - A.y;
    const axes = [[A.nx, A.ny], [A.px, A.py], [B.nx, B.ny], [B.px, B.py]];
    let best = null;
    for (const [ax, ay] of axes) {
      const dist = Math.abs(cdx * ax + cdy * ay);
      const depth = extentOn(A, ax, ay) + extentOn(B, ax, ay) - dist;
      if (depth <= 0) return null;          // found a gap: no collision
      if (!best || depth < best.depth) best = { ax: ax, ay: ay, depth: depth };
    }
    // point the push axis from A toward B
    if (cdx * best.ax + cdy * best.ay < 0) { best.ax = -best.ax; best.ay = -best.ay; }
    return best;
  }

  function collide(a, b) {
    const A = boxOf(a), B = boxOf(b);
    const hit = overlapAxis(A, B);
    if (!hit) return false;

    // push apart, half each
    const half = hit.depth / 2;
    a.x -= hit.ax * half; a.y -= hit.ay * half;
    b.x += hit.ax * half; b.y += hit.ay * half;

    // trade velocity only if they are moving into each other
    const rv = ((b.vx || 0) - (a.vx || 0)) * hit.ax + ((b.vy || 0) - (a.vy || 0)) * hit.ay;
    if (rv < 0) {
      const j = -(1 + TUNING.restitution) * rv / 2;   // equal masses
      a.vx = (a.vx || 0) - j * hit.ax; a.vy = (a.vy || 0) - j * hit.ay;
      b.vx = (b.vx || 0) + j * hit.ax; b.vy = (b.vy || 0) + j * hit.ay;
    }
    return true;
  }

  // Call once per frame. Two passes stop ships jittering when packed together.
  function resolveAll(ships) {
    const list = (ships || []).filter(alive);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          collide(list[i], list[j]);
        }
      }
    }
  }

  window.BumpCollide = { resolveAll: resolveAll };
})();
