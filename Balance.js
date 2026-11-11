// Balance.js - one table for ship speed, acceleration and friction.
// Applied every frame to the player ship, corp bots, pirates and guards before they move,
// so the numbers here always win over whatever applyStats() set on the class.
//
// Load AFTER the ship class files and BEFORE MainGameController.js:
//   <script src="Balance.js"></script>
//
// Tune a ship by editing its row. Ships not listed here keep their own stats.
// Rows are ordered smallest to largest. Rows marked PLACEHOLDER are starting guesses, not tuned values.

(function () {
  const TABLE = {
    //                                maxSpeed  accel  friction

    // ---- Frigates ----
    'Mining Frigate':            { maxSpeed: 4.0, accel: 0.18, friction: 0.94 }, // 120 long: fastest miner
    'Combat Frigate':            { maxSpeed: 5.2, accel: 0.28, friction: 0.93 },
    'Exploration Frigate':       { maxSpeed: 6.0, accel: 0.32, friction: 0.94 },
    'Improved Explorer Frigate': { maxSpeed: 6.6, accel: 0.32, friction: 0.94 },

    // ---- Cruisers ----
    'Explorer Cruiser':          { maxSpeed: 5.0, accel: 0.25, friction: 0.94 }, // PLACEHOLDER
    'Siege Cruiser':             { maxSpeed: 4.6, accel: 0.18, friction: 0.94 }, // PLACEHOLDER
    'Mining Barge':              { maxSpeed: 4.6, accel: 0.18, friction: 0.93 }, // 120 long: same size as old frigate
    'Command Ship':              { maxSpeed: 4.8, accel: 0.12, friction: 0.90 }, // 260 long

    // ---- Battleships ----
    'Siege Battleship':          { maxSpeed: 4.2, accel: 0.19, friction: 0.95 }, // matches the class's own base stats

    // ---- Capitals ----
    'Carrier':                   { maxSpeed: 3.8, accel: 0.20, friction: 0.93 }, // 460 long
    'Capital':                   { maxSpeed: 3.0, accel: 0.08, friction: 0.94 }, // PLACEHOLDER
    'Transport Capital':         { maxSpeed: 3.2, accel: 0.08, friction: 0.94 },
    'Mining Capital':            { maxSpeed: 2.5, accel: 0.05, friction: 0.95 }  // 460 long: heaviest hauler
  };

  function apply(ship) {
    if (!ship) return;
    const t = TABLE[ship.className];
    if (!t) return;
    ship.maxSpeed = t.maxSpeed;
    ship.accel = t.accel;
    ship.friction = t.friction;
  }

  function applyAll(ships) {
    (ships || []).forEach(apply);
  }

  window.Balance = { TABLE: TABLE, apply: apply, applyAll: applyAll };
})();
