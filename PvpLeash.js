// PvpLeash.js - Public PvP map fixes:
//   * Belt pirates are leashed to their own belt (they stop chasing across the map).
//   * Aggro is dropped when the player gets too far away, instead of never ending.
//   * Two Carrier guards sit at the central Rogue Station and are leashed to it.
//
// Load AFTER PublicNpcManager.js and BEFORE MainGameController.js:
//   <script src="PvpLeash.js"></script>
//
// Uses the globals PUBLIC_MAP, PIRATE_TYPES and PublicNpcManager from PublicNpcManager.js
// and MapManager.js. Movement is NOT done here: this file only decides who is aggro / retreating.
// All movement (orbit ring, patrol, mining) and the ship's own update() come from PublicNpcManager.js
// (engagePlayer, peacefulBehaviour, runShipUpdate, setPos, flyTo). Not yet run in the game: test on the public map.

(function () {
  if (typeof PublicNpcManager === 'undefined' || typeof PUBLIC_MAP === 'undefined') {
    console.error('PvpLeash: PublicNpcManager.js and MapManager.js must load first.');
    return;
  }

  // Leash hysteresis: aggro starts only well inside the leash, a pirate pulled past it
  // breaks off and flies home until it is comfortably inside again.
  const AGGRO_INSIDE = 0.85;  // start a chase only inside 85% of the leash
  const RETREAT_DONE = 0.6;   // stop flying home once back inside 60% of the leash
  const RETREAT_SPEED_MULT = 1.2; // flying home: this multiple of the ship's own top speed (was a flat 3.0, too fast for a Carrier)

  const LEASH_BELT = 1800;      // belt pirates stay within this of their own spawn (belt ring is ~1500)
  const LEASH_GUARD = 900;      // station guards stay within this of the station centre
  // Station guard difficulty (on top of the normal pirate scaling in PublicNpcManager.js)
  const GUARD_HP_SCALE = 0.5;   // fraction of a normal pirate's shield / armor / structure (0.5 = half)
  const GUARD_DMG_SCALE = 0.1;  // damage scale; belt combat ships use COMBAT_DPS_SCALE (0.2), so this is half of that
  const AGGRO_RANGE = 1000;     // starts a chase when the player is this close (matches the Siege and Carrier range)
  const DROP_RANGE = 1000;      // give up the chase once the player is this far away
  const GUARD_CLASS = 'carrier'; // key in PIRATE_TYPES used for the two station guards
  const GUARD_OFFSET = 600;      // how far from the station each guard spawns (clears the boss hull)

  const P = PublicNpcManager.prototype;
  const origInit = P.init;
  const origUpdate = P.update;

  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  // Mining-class pirates mine rocks when not fighting, and never damage the player
  function isMinerNpc(npc) { return /Mining/.test(npc.className || ''); }

  function damagePlayer(player, amount, source) {
    if (typeof player.takeDamage === 'function') player.takeDamage(amount, source);
    else player.structure -= amount;
  }

  // Set up the belt pirates as before, then give each one a home and add the station guards.
  // playerSlot must be passed through, or every pirate spawns in belt 0.
  P.init = function (playerShip, playerSlot) {
    origInit.call(this, playerShip, playerSlot);
    const M = PUBLIC_MAP;

    // Belt pirates: home is the spawn their belt rings.
    this.publicNpcMiners.forEach(npc => {
      if (!npc || npc.mapId) return;
      let home = M.spawns[0], best = Infinity;
      for (const sp of M.spawns) {
        const d = dist(npc.ship.x, npc.ship.y, sp.x, sp.y);
        if (d < best) { best = d; home = sp; }
      }
      npc.kind = 'belt';
      npc.homeX = home.x;
      npc.homeY = home.y;
      npc.leash = LEASH_BELT;
    });

    // Central main base: two carrier guards, leashed to the station.
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + Math.PI / 4;
      const gx = M.cx + Math.cos(a) * GUARD_OFFSET;
      const gy = M.cy + Math.sin(a) * GUARD_OFFSET;
      this.addPirate(PIRATE_TYPES[GUARD_CLASS], gx, gy, 'guard_' + i, { dmg: GUARD_DMG_SCALE });
      const g = this.publicNpcMiners[this.publicNpcMiners.length - 1];
      // Weaker than a normal pirate: scale every layer (current and max) down
      for (const layer of ['Shield', 'Armor', 'Structure']) {
        const maxKey = 'max' + layer, curKey = layer.toLowerCase();
        if (g.ship[maxKey] > 0) {
          g.ship[maxKey] *= GUARD_HP_SCALE;
          g.ship[curKey] = (g.ship[curKey] || 0) * GUARD_HP_SCALE;
        }
      }
      g.maxHp *= GUARD_HP_SCALE;
      g.kind = 'guard';
      g.homeX = M.cx;
      g.homeY = M.cy;
      g.leash = LEASH_GUARD;
      g.home = { x: M.cx, y: M.cy };   // patrol area for peacefulBehaviour is the station, not the spawn point
      g.role = 'patrol';               // guards always patrol
    }
  };

  // Replaces the original update(). Same signature and same station-boss behaviour.
  P.update = function (currentMapId, playerShip, asteroidBelt, playerData, updateStationUI, saveGameSession, debrisField) {
    // Frontier systems use the shared base manager for per-system guards and 3–5 minute respawns.
    if (String(currentMapId || '').indexOf('frontier_') === 0) {
      return origUpdate.apply(this, arguments);
    }
    if (currentMapId !== 'public_space') return;

    // Station boss: takes damage while the player is close and not docked.
    const boss = window.centralStationBoss;
    if (boss && boss.structure > 0 && playerShip && !playerShip.docked) {
      if (dist(playerShip.x, playerShip.y, boss.x, boss.y) < 500) {
        boss.structure -= playerShip.className === 'Combat Frigate' ? 3.0 : 1.2;
      }
    }

    this.publicNpcMiners.forEach(npc => {
      try {
        if (npc.mapId ? npc.mapId !== currentMapId : currentMapId !== 'public_space') return;
        if (!npc.isAlive || !npc.ship) return;
        const ship = npc.ship;

        // NPC carrier drones must never shoot their own station boss
        if (Array.isArray(ship.drones)) {
          ship.drones.forEach(d => {
            if (d && d.ship) {
              d.ship.ignoreStationBoss = true;
              d.ship.npcDamageScale = npc.dpsScale || 1;   // drones deal the same reduced damage as their carrier
            }
            if (d) d.launchSide = 1; // one orbit sense, so drones do not fight the drone's own orbit
          });
        }

        // Killed: pay bounty, drop wreck loot, stop.
        if (ship.structure <= 0) {
          npc.isAlive = false;
          if (playerData && playerData.isk !== undefined) playerData.isk += Math.floor(npc.bounty);
          if (typeof window.showCorpNotification === 'function') {
            window.showCorpNotification('🏴‍☠️ Pirate ' + npc.className + ' destroyed! Bounty: +' +
              Math.floor(npc.bounty).toLocaleString() + ' Scrap Metals');
          }
          if (debrisField && debrisField.entities) {
            debrisField.entities.push({ x: ship.x, y: ship.y, radius: 40, oreYield: 8000, oreType: 'debris_t3' });
          }
          return;
        }

        // The manager owns every pirate's position: undo anything another system did to x / y since last frame.
        if (npc.pos) this.setPos(ship, npc.pos.x, npc.pos.y);

        const home = { x: npc.homeX, y: npc.homeY };
        const fromHome = dist(ship.x, ship.y, home.x, home.y);
        const playerOk = !!(playerShip && !playerShip.docked);
        const pDist = playerOk ? dist(playerShip.x, playerShip.y, ship.x, ship.y) : Infinity;

        // Long-range hulls (Carrier) hold a big orbit ring. Stretch the leash and the aggro / drop distances to
        // fit it, otherwise they cross a limit every few frames and flip between attacking and retreating.
        const ring = this.ringRadius(npc);
        const leash = Math.max(npc.leash, ring * 1.3);
        const aggroRange = Math.max(AGGRO_RANGE, ring * 1.2);
        const dropRange = Math.max(DROP_RANGE, ring * 1.5);

        // Leash: aggro starts only well inside the leash and drops when the player gets
        // away. A pirate pulled past its leash breaks off and retreats home.
        if (npc.isAgro) {
          if (pDist > dropRange) {
            npc.isAgro = false;
          } else if (fromHome > leash) {
            // Past the leash: break off and fly home smoothly (no teleport back onto the circle)
            npc.isAgro = false;
            npc.retreating = true;
          }
        } else if (playerOk && pDist < aggroRange && fromHome < leash * AGGRO_INSIDE && !npc.retreating) {
          npc.isAgro = true;
        }

        // Retreating: fly home and ignore the player until comfortably inside the leash.
        // Combat hulls still run their own update() so missiles and drones keep flying.
        if (npc.retreating) {
          if (fromHome < leash * RETREAT_DONE) {
            npc.retreating = false;
          } else {
            if (npc.combat) {
              const kx = ship.x, ky = ship.y;
              this.runShipUpdate(npc, playerShip, playerOk, false);
              this.setPos(ship, kx, ky);
            }
            this.flyTo(ship, home, Math.max(this.npcSpeed(npc, playerShip) * RETREAT_SPEED_MULT, 0.5));
            ship.currentTarget = null;
            npc.pos = { x: ship.x, y: ship.y };
            return;
          }
        }

        const engaged = npc.isAgro && playerOk;

        // Always run the ship's own update() for combat hulls (so missiles / drones keep moving
        // even when the player is out of range), then undo any movement it made.
        if (npc.combat || engaged) {
          const kx = ship.x, ky = ship.y;
          this.runShipUpdate(npc, playerShip, playerOk, engaged);
          this.setPos(ship, kx, ky);
        }

        if (engaged) {
          // Orbit ring: 70% of weapon range for siege hulls, 90% for the rest (see ringRadius)
          this.engagePlayer(npc, playerShip);
          // mining NPCs chase but never damage the player
          if (!isMinerNpc(npc) && pDist <= (ship.weaponRange || 550)) {
            damagePlayer(playerShip, 0.35 * (npc.dpsScale || 1), ship);
          }
        } else {
          // Not fighting: patrol the home area or mine rocks
          this.peacefulBehaviour(npc, asteroidBelt);
        }

        // Remember where the manager put it
        npc.pos = { x: ship.x, y: ship.y };
      } catch (err) {
        this.reportError(npc, 'leash update', err);
      }
    });

    // Remove dead pirates from the list.
    this.publicNpcMiners = this.publicNpcMiners.filter(n => n.isAlive);
  };

  console.log('PvpLeash: belt leash, aggro drop and station guards loaded (movement handled by PublicNpcManager).');
})();
