// Races.js - racial buffs for the two races (Rock Gobblers = miner, Siege).
// Load AFTER the ship class files and ShieldRegen.js, BEFORE MainGameController.js.
//
// miner: +5% mining amount on Mining Frigate, Mining Barge, Command Ship and Mining Capital.
//        Command Ship and Capital drones mine a share of the parent's miningPower,
//        so the drones get the +5% automatically.
// siege: +5% shield recharge amount (x1.05, in and out of combat) on Combat Frigate,
//        Siege Cruiser, Siege Battleship and Siege Carrier.
//
// Future XP / skills can be added to each entry in DEFS.
(function () {
  const DEFS = {
    miner: {
      id: 'miner', label: 'ROCK GOBBLERS', startShip: 'Mining Frigate',
      ships: ['Mining Frigate', 'Mining Barge', 'Command Ship', 'Mining Capital'],
      buffs: { miningMult: 1.05 }
    },
    siege: {
      id: 'siege', label: 'SIEGE', startShip: 'Combat Frigate',
      ships: ['Combat Frigate', 'Siege Cruiser', 'Siege Battleship', 'Siege Carrier'],
      buffs: { shieldRechargeMult: 1.05 }
    }
  };

  // old saves used 'standard' for the miner race
  function normalize(id) { return id === 'standard' ? 'miner' : id; }

  function current() {
    const id = (typeof playerData !== 'undefined') ? normalize(playerData.race) : null;
    return DEFS[id] || null;
  }

  // Marks a ship with the multipliers it gets from the player's race (1 = no buff).
  function tag(ship) {
    if (!ship) return;
    const race = current();
    const own = !!(race && race.ships.indexOf(ship.className) !== -1);
    ship.racialMining = (own && race.buffs.miningMult) || 1;
    ship.racialShield = (own && race.buffs.shieldRechargeMult) || 1;
  }

  // Mining: wrap applyStats so the buff is re-applied every time the ship recalculates
  // (upgrades, boarding, Capital anchoring). It never stacks because applyStats resets first.
  function wrapMining(C) {
    if (!C || !C.prototype || C.prototype._raceWrapped) return;
    const orig = C.prototype.applyStats;
    if (typeof orig !== 'function') return;
    C.prototype.applyStats = function () {
      orig.apply(this, arguments);
      if (this.racialMining > 1 && this.miningPower > 0) this.miningPower *= this.racialMining;
    };
    C.prototype._raceWrapped = true;
  }
  if (typeof MiningFrigate !== 'undefined') wrapMining(MiningFrigate);
  if (typeof MiningBarge !== 'undefined') wrapMining(MiningBarge);
  if (typeof CommandShip !== 'undefined') wrapMining(CommandShip);
  if (typeof CapitalShip !== 'undefined') wrapMining(CapitalShip);

  // Shield: multiply whatever shield ShieldRegen restored this frame by the racial buff.
  if (typeof ShieldRegen !== 'undefined' && !ShieldRegen._raceWrapped) {
    const origUpdate = ShieldRegen.update;
    ShieldRegen.update = function (ship) {
      const before = ship ? (ship.shield || 0) : 0;
      origUpdate.call(this, ship);
      if (ship && ship.racialShield > 1) {
        const gain = (ship.shield || 0) - before;
        if (gain > 0 && ship.maxShield > 0) {
          ship.shield = Math.min(ship.maxShield, ship.shield + gain * (ship.racialShield - 1));
        }
      }
    };
    ShieldRegen._raceWrapped = true;
  }

  window.Races = { DEFS: DEFS, normalize: normalize, current: current, tag: tag };
})();
