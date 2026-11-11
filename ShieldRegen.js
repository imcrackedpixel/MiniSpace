// ShieldRegen.js - out-of-combat shield recharge for any ship.
// Ships that define combatRegenFactor() (e.g. the Siege Cruiser) also get a passive in-combat recharge.
const ShieldRegen = {
  DELAY_FRAMES: 600,       // 10s without taking damage before recharge starts
  BROKEN_DELAY_FRAMES: 900,// 15s if shields were knocked to 0
  BASE_PCT_PER_SEC: 0.012, // 1.2% of max shield per second
  LEVEL_BONUS: 0.15,       // +15% regen per shield module level

  classMultiplier(className) {
    const n = (className || '').toLowerCase();
    if (n.includes('capital') || n.includes('carrier')) return 0.6;
    if (n.includes('command') || n.includes('barge')) return 0.8;
    return 1.0;
  },

  // Level of the ship's shield module (the Siege Capital calls it shieldPlating, the Carrier shieldExtender)
  shieldLevel(ship) {
    const m = ship.moduleLevels || {};
    return Number(m.shield) || Number(m.shieldPlating) || Number(m.shieldExtender) || 1;
  },

  // Fraction of the out-of-combat rate that applies mid-fight. Ships can define their own
  // combatRegenFactor(); every other Siege ship gets 30% at level 1, +5 points per level.
  combatFactor(ship) {
    if (typeof ship.combatRegenFactor === 'function') return ship.combatRegenFactor();
    if (/^siege/i.test(ship.className || '')) return 0.30 + 0.05 * (this.shieldLevel(ship) - 1);
    return 0;
  },

  update(ship) {
    if (!ship || ship.docked || !(ship.maxShield > 0)) return;

    // Ensure properties exist to prevent NaN or undefined UI rendering
    if (ship.shield === undefined) ship.shield = ship.maxShield;
    if (ship.armor === undefined) ship.armor = ship.maxArmor || 0;
    if (ship.structure === undefined) ship.structure = ship.maxStructure || 100;

    const hp = (ship.shield || 0) + (ship.armor || 0) + (ship.structure || 0);
    if (ship._regenLastHp === undefined) {
      ship._regenLastHp = hp;
      ship._combatTimer = 0;
    }

    // Any HP loss since last frame = combat
    if (hp < ship._regenLastHp - 0.001) {
      ship._combatTimer = (ship.shield || 0) <= 0 ? this.BROKEN_DELAY_FRAMES : this.DELAY_FRAMES;
    }

    ship.inCombat = ship._combatTimer > 0;
    if (ship._combatTimer > 0) ship._combatTimer--;

    ship.isRegenShield = false;

    // Out-of-combat recharge
    if (ship._combatTimer <= 0 && (ship.shield || 0) < ship.maxShield) {
      const lvl = this.shieldLevel(ship);
      const rate = this.BASE_PCT_PER_SEC * this.classMultiplier(ship.className) *
        (1 + (lvl - 1) * this.LEVEL_BONUS);

      ship.shield = Math.min(ship.maxShield, (ship.shield || 0) + ship.maxShield * rate / 60);
      ship.isRegenShield = true;
    }

    // Passive in-combat recharge: a fraction of the out-of-combat rate, set by the ship's
    // shield recharge module (Siege Cruiser: 30% at level 1, +5 points per level).
    if (ship._combatTimer > 0 && this.combatFactor(ship) > 0 &&
        (ship.shield || 0) < ship.maxShield) {
      const lvl = this.shieldLevel(ship);
      const outRate = this.BASE_PCT_PER_SEC * this.classMultiplier(ship.className) *
        (1 + (lvl - 1) * this.LEVEL_BONUS);

      ship.shield = Math.min(ship.maxShield,
        (ship.shield || 0) + ship.maxShield * outRate * this.combatFactor(ship) / 60);
      ship.isRegenShield = true;
    }

    ship._regenLastHp = (ship.shield || 0) + (ship.armor || 0) + (ship.structure || 0);
  }
};
