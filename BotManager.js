// BotManager.js - Automated Fleet & Mining Corp Manager (with Transport Capital logistics, 10% cut & upgrades)

const CORP_TIERS = [
  { name: 'Mining Frigate', hauls: 5 },
  { name: 'Mining Barge', hauls: 7 },
  { name: 'Command Ship', hauls: 11 },
  { name: 'Capital', hauls: 25 },
];

const TRANSPORT_TIERS = [
  { name: 'Transport Capital', hauls: 25 },
  { name: 'Industrial Hauler', hauls: 5000 },
  { name: 'Freighter', hauls: 10090 }
];

const CRUISER_BUILD_ISK = 10000000;
const CRUISER_BUILD_ITEMS = 10000000;
const CRUISER_RELIC_SELL_SHARE = 0.5;

// Surplus payout: once a corp ship is fully maxed, it pays this share of its unused wallet and stock to the player.
const SURPLUS_PAYOUT_SHARE = 0.5;
const SURPLUS_PAYOUT_FRAMES = 300;

function isExplorerShip(ship) {
  return !!ship && (ship.className === 'Exploration Frigate' || ship.className === 'Improved Explorer Frigate' || ship.className === 'Explorer Cruiser');
}

function isExplorerBot(bot) {
  return !!bot && (bot.className === 'Exploration Frigate' || bot.className === 'Explorer Cruiser');
}

class BotManager {
  constructor(playerData, station, asteroidBelt, debrisField) {
    this.playerData = playerData;
    this.station = station;
    this.asteroidBelt = asteroidBelt;
    this.debrisField = debrisField;
    this.bots = [];
    this.donationTimer = 0;
    this.tiers = CORP_TIERS;
  }

  createShip(shipClassName, x, y) {
    const nameLower = (shipClassName || '').toLowerCase();
    let ship;
    if (nameLower.includes('cruiser')) ship = new ExplorerCruiser(x, y);
    else if (nameLower.includes('barge')) ship = new MiningBarge(x, y);
    else if (nameLower.includes('command')) ship = new CommandShip(x, y);
    else if (nameLower.includes('carrier')) ship = new Carrier(x, y);
    else if (nameLower.includes('capital') && !nameLower.includes('transport')) ship = new CapitalShip(x, y);
    else if (nameLower.includes('combat')) ship = new CombatFrigate(x, y);
    else if (nameLower.includes('freighter') || nameLower.includes('industrial') || nameLower.includes('hauler') || nameLower.includes('transport') || nameLower.includes('manager')) {
      ship = new TransportCapitalShip(x, y);
      if (nameLower.includes('freighter')) ship.className = 'Freighter';
      else if (nameLower.includes('industrial') || nameLower.includes('hauler')) ship.className = 'Industrial Hauler';
      else ship.className = 'Transport Capital';
    } else if (nameLower.includes('exploration')) ship = new ExplorationFrigate(x, y);
    else ship = new MiningFrigate(x, y);

    ship.isCorpMember = true;
    ship.isAlly = true;
    ship.isTargetable = false;
    ship.docked = false;
    ship.cargo = 0;
    const isTransportHull = ship.className === 'Transport Capital' || ship.className === 'Industrial Hauler' || ship.className === 'Freighter';
    ship.maxCargo = isTransportHull ? 20000 : (ship.maxCargo || 50000);

    // Corp carrier drones keep combat behaviour but emit no exhaust smoke.
    if (Array.isArray(ship.drones)) {
      ship.drones.forEach(entry => {
        const drone = entry && (entry.ship || entry);
        if (!drone) return;
        drone.isCorpMemberDrone = true;
        drone.disableThrusterEffects = true;
        if (Array.isArray(drone.particles)) drone.particles.length = 0;
        if (Array.isArray(drone.missileTrails)) drone.missileTrails.length = 0;
      });
    }

    return ship;
  }

  addBot(shipClassName) {
    const spawnX = this.station.x + (Math.random() - 0.5) * 300;
    const spawnY = this.station.y + (Math.random() - 0.5) * 300;
    const ship = this.createShip(shipClassName, spawnX, spawnY);
    
    const bot = {
      id: 'bot_' + Math.random().toString(36).substring(2, 9),
      ship: ship,
      className: shipClassName,
      hauls: 0,
      haulProgress: 0,
      mineTimer: 0,
      wallet: 0,
      stock: {},
      hasCruiserBlueprint: false,
      cruiserBuilt: false,
      transportState: ship.className === 'Transport Capital' ? 'loading' : null,
      transportMapId: ship.className === 'Transport Capital' ? 'private_highsec' : null,
      transportLevel: ship.className === 'Transport Capital' ? 1 : null
    };
    if (ship.className === 'Transport Capital') {
      bot.transportLevel = 1;
      ship.maxCargo = 20000;
    }
    ship.corpBot = bot;

    // Set corp explorers to have max level items by default
    if (isExplorerBot(bot)) {
      bot.explorerLevel = 5;
      bot.itemLevel = 5;
      if (ship.moduleLevels) {
        for (const mod of Object.keys(ship.moduleLevels)) {
          ship.moduleLevels[mod] = typeof window.getCap === 'function' ? window.getCap(mod, ship.className) : 5;
        }
      }
      if (typeof ship.applyStats === 'function') ship.applyStats();
    }

    this.bots.push(bot);
    return bot;
  }

  addExplorationBot() {
    return this.addBot('Exploration Frigate');
  }

  addTransportBot() {
    return this.addBot('Transport Capital');
  }

  transportUpgradeCost(bot) {
    const level = Math.max(1, Math.floor(Number(bot && bot.transportLevel) || 1));
    return 25000 * level;
  }

  upgradeTransportManager() {
    const bot = this.bots.find(function (entry) {
      return entry && entry.ship && entry.ship.className === 'Transport Capital';
    });
    if (!bot || !bot.ship) return { success: false, message: 'Transport Manager not found.' };
    // Cargo capacity can be upgraded during any route; the current trip continues unchanged.
    const level = Math.max(1, Math.floor(Number(bot.transportLevel) || 1));
    const cost = this.transportUpgradeCost(bot);
    if ((Number(this.playerData.isk) || 0) < cost) {
      return { success: false, message: 'Need ' + cost.toLocaleString() + ' Scrap Metals for the next cargo upgrade.' };
    }
    this.playerData.isk -= cost;
    bot.transportLevel = level + 1;
    bot.ship.maxCargo = 10000 + (10000 * bot.transportLevel);
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
    if (typeof window.updateStationUI === 'function') window.updateStationUI();
    if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
    return { success: true, level: bot.transportLevel, capacity: bot.ship.maxCargo, cost: cost };
  }

  // Keep corporation logistics moving while the pilot is visiting the public Trade Hub,
  // without advancing private corporation miners in the public map.
  updateTransportOnly(player, asteroidBelt, debrisField) {
    const allBots = this.bots;
    this.bots = allBots.filter(function (bot) {
      const name = bot && bot.ship && bot.ship.className;
      return name === 'Transport Capital' ||
        name === 'Industrial Hauler' ||
        name === 'Freighter';
    });
    try {
      return this.update(player, asteroidBelt, debrisField);
    } finally {
      this.bots = allBots;
    }
  }

  serializeBots() {
    return this.bots.map(function (b) {
      const ship = b.ship || {};
      return {
        className: b.className,
        wallet: b.wallet || 0,
        stock: Object.assign({}, b.stock || {}),
        tempStock: Object.assign({}, b.tempStock || {}),
        hauls: b.hauls || 0,
        haulProgress: b.haulProgress || 0,
        cargoContrib: Object.values((b.ship && b.ship.cargoContrib) || {}).map(c => ({ sourceIndex: c.bot ? this.bots.indexOf(c.bot) : -1, ore: Object.assign({}, c.ore || {}), haulSize: c.haulSize || 0 })),
        hasCruiserBlueprint: !!b.hasCruiserBlueprint,
        cruiserBuilt: !!b.cruiserBuilt,
        moduleLevels: ship.moduleLevels ? Object.assign({}, ship.moduleLevels) : null,
        cargo: ship.cargo || 0,
        oreType: ship.oreType || null,
        cargoByOre: Object.assign({}, (window.ensureOreCargo ? window.ensureOreCargo(ship) : ship.cargoByOre) || {}),
        transportState: b.transportState || null,
        transportMapId: b.transportMapId || null,
        transportShipmentId: b.transportShipmentId || null,
        transportTask: b.transportTask ? JSON.parse(JSON.stringify(b.transportTask)) : null,
        playerSaleTask: b.playerSaleTask ? JSON.parse(JSON.stringify(b.playerSaleTask)) : null,
        playerSaleQueue: Array.isArray(b.playerSaleQueue) ? JSON.parse(JSON.stringify(b.playerSaleQueue)) : [],
        playerSaleIdleSince: Number(b.playerSaleIdleSince) || 0,
        transportLevel: b.transportLevel || null,
        transportBuildQueue: Array.isArray(b.transportBuildQueue) ? JSON.parse(JSON.stringify(b.transportBuildQueue)) : []
      };
    });
  }

  restoreBots(saved) {
    this.bots = [];
    const filteredSaved = [];
    let restoredMinerCount = 0;
    for (const entry of (Array.isArray(saved) ? saved : [])) {
      if (!entry || !entry.className) continue;
      const cls = String(entry.className).toLowerCase();
      const specialist = cls.includes('explor') || cls.includes('transport') || cls.includes('hauler') || cls.includes('freighter');
      if (!specialist && restoredMinerCount >= 5) continue;
      if (!specialist) restoredMinerCount++;
      filteredSaved.push(entry);
    }
    saved = filteredSaved;
    for (const s of saved) {
      if (!s || !s.className) continue;
      const bot = this.addBot(s.className);
      bot.wallet = s.wallet || 0;
      bot.stock = Object.assign({}, s.stock || {});
      bot.tempStock = Object.assign({}, s.tempStock || {});
      bot.hauls = s.hauls || 0;
      bot.haulProgress = Math.max(0, Number(s.haulProgress) || 0);
      bot.hasCruiserBlueprint = !!s.hasCruiserBlueprint;
      bot.cruiserBuilt = !!s.cruiserBuilt;
      bot.transportState = s.transportState || (String(s.className).toLowerCase().includes('transport') ? 'loading' : null);
      bot.transportMapId = s.transportMapId || (bot.transportState ? 'private_highsec' : null);
      bot.transportShipmentId = s.transportShipmentId || null;
      bot.transportTask = s.transportTask ? JSON.parse(JSON.stringify(s.transportTask)) : null;
      bot.playerSaleTask = s.playerSaleTask ? JSON.parse(JSON.stringify(s.playerSaleTask)) : null;
      bot.playerSaleQueue = Array.isArray(s.playerSaleQueue) ? JSON.parse(JSON.stringify(s.playerSaleQueue)) : [];
      bot.playerSaleIdleSince = Number(s.playerSaleIdleSince) || 0;
      bot.transportLevel = String(s.className).toLowerCase().includes('transport') ? Math.max(1, Math.floor(Number(s.transportLevel) || 1)) : null;
      bot.transportBuildQueue = Array.isArray(s.transportBuildQueue) ? JSON.parse(JSON.stringify(s.transportBuildQueue)) : [];
      bot._corpMarketSupplyPending = false;
      const ship = bot.ship;
      if (ship && ship.moduleLevels && s.moduleLevels) {
        for (const m in s.moduleLevels) {
          if (ship.moduleLevels[m] !== undefined) ship.moduleLevels[m] = s.moduleLevels[m];
        }
        if (typeof ship.applyStats === 'function') ship.applyStats();
      }
      if (ship) {
        if (ship.className === 'Transport Capital') ship.maxCargo = 10000 + (10000 * (bot.transportLevel || 1));
        ship.cargo = s.cargo || 0;
        if (s.oreType) ship.oreType = s.oreType;
        ship.cargoByOre = s.cargoByOre && typeof s.cargoByOre === 'object' ? Object.assign({}, s.cargoByOre) : null;

        // Migrate any cargo left by the retired miner-siphoning transport
        // into corporation storage once, then start the new station-loading loop.
        const isTransportHull =
          ship.className === 'Transport Capital' ||
          ship.className === 'Industrial Hauler' ||
          ship.className === 'Freighter';
        if (isTransportHull && (ship.cargo || 0) > 0 && !s.transportState) {
          const corpHangar = this.playerData.corpStationOre ||
            (this.playerData.corpStationOre = {});
          const oldCargo = ship.cargoByOre || {
            [ship.oreType || 'veldspar']: ship.cargo
          };
          for (const key of Object.keys(oldCargo)) {
            const qty = Math.max(0, Math.floor(Number(oldCargo[key]) || 0));
            if (qty > 0) {
              corpHangar[key] = (corpHangar[key] || 0) + qty;
            }
          }
          ship.cargo = 0;
          ship.cargoByOre = {};
          bot.transportState = 'loading';
          bot.transportMapId = 'private_highsec';
        }
      }
    }
    // Reconnect saved transport cargo to its original corp miner after all bots exist.
    for (let i = 0; i < saved.length && i < this.bots.length; i++) {
      const transportShip = this.bots[i].ship;
      const records = saved[i] && saved[i].cargoContrib;
      if (!transportShip || !Array.isArray(records) || !records.length) continue;
      transportShip.cargoContrib = {};
      records.forEach((record, ri) => {
        const sourceIndex = Number(record.sourceIndex);
        const sourceBot = sourceIndex >= 0 ? (this.bots[sourceIndex] || null) : null;
        const id = sourceBot ? sourceBot.id : 'player_' + ri;
        transportShip.cargoContrib[id] = { bot: sourceBot, ore: Object.assign({}, record.ore || {}), haulSize: Math.max(1, Number(record.haulSize) || (sourceBot && sourceBot.ship && sourceBot.ship.maxCargo) || 200) };
      });
    }
  }

  stockValue(bot) {
    let total = 0;
    for (const k in (bot.stock || {})) {
      total += (bot.stock[k] || 0) * ((typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[k]) || 10);
    }
    return total;
  }

  consumeStock(bot, value) {
    let remaining = value;
    const keys = Object.keys(bot.stock || {}).filter(function (k) { return (bot.stock[k] || 0) > 0; });
    keys.sort(function () { return Math.random() - 0.5; });
    for (const k of keys) {
      if (remaining <= 0) break;
      const price = (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[k]) || 10;
      const qty = bot.stock[k];
      const take = Math.min(qty, Math.ceil(remaining / price));
      bot.stock[k] = qty - take;
      remaining -= take * price;
    }
  }

  rebalanceCruiserFunds(bot) {
    if (!bot.stock) bot.stock = {};
    const price = function (k) { return (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[k]) || 10; };
    let wallet = bot.wallet || 0;
    let stockVal = this.stockValue(bot);
    if (wallet + stockVal < CRUISER_BUILD_ISK + CRUISER_BUILD_ITEMS) return;

    if (wallet < CRUISER_BUILD_ISK && stockVal > CRUISER_BUILD_ITEMS) {
      let need = CRUISER_BUILD_ISK - wallet;
      let spare = stockVal - CRUISER_BUILD_ITEMS;
      const keys = Object.keys(bot.stock).filter(function (k) { return (bot.stock[k] || 0) > 0; })
        .sort(function (a, b) { return price(b) - price(a); });
      for (const k of keys) {
        if (need <= 0 || spare <= 0) break;
        const p = price(k);
        const qty = Math.min(bot.stock[k], Math.ceil(need / p), Math.floor(spare / p));
        if (qty <= 0) continue;
        bot.stock[k] -= qty;
        bot.wallet = (bot.wallet || 0) + qty * p;
        need -= qty * p;
        spare -= qty * p;
      }
    } else if (stockVal < CRUISER_BUILD_ITEMS && wallet > CRUISER_BUILD_ISK) {
      const p = price('omber');
      const qty = Math.min(Math.ceil((CRUISER_BUILD_ITEMS - stockVal) / p), Math.floor((wallet - CRUISER_BUILD_ISK) / p));
      if (qty > 0) {
        bot.wallet -= qty * p;
        bot.stock.omber = (bot.stock.omber || 0) + qty;
      }
    }
  }

  tryBuildCruiser(bot) {
    if (!bot.hasCruiserBlueprint || bot.cruiserBuilt || bot.className === 'Explorer Cruiser') return;
    if (!isExplorerBot(bot)) return;
    this.rebalanceCruiserFunds(bot);
    if ((bot.wallet || 0) < CRUISER_BUILD_ISK) return;
    if (this.stockValue(bot) < CRUISER_BUILD_ITEMS) return;

    bot.wallet -= CRUISER_BUILD_ISK;
    this.consumeStock(bot, CRUISER_BUILD_ITEMS);

    const old = bot.ship;
    const built = this.createShip('Explorer Cruiser', old.x, old.y);
    built.vx = old.vx;
    built.vy = old.vy;
    built.angle = old.angle;
    built.corpBot = bot;
    this.carryModuleLevels(old, built);
    bot.ship = built;
    bot.className = 'Explorer Cruiser';
    bot.cruiserBuilt = true;
    if (window.showCorpNotification) window.showCorpNotification('Corp explorer built an EXPLORER CRUISER!');
    if (typeof window.saveGameSession === 'function') window.saveGameSession();
  }

  donateIsk(amount) {
    const eb = this.bots.find(isExplorerBot);
    if (!eb) return false;
    eb.wallet = (eb.wallet || 0) + amount;
    this.tryBuildCruiser(eb);
    return true;
  }

  donateItems(stationOre) {
    const eb = this.bots.find(isExplorerBot);
    if (!eb) return 0;
    if (!eb.stock) eb.stock = {};
    
    // Calculate how much item value is still needed
    const currentStockVal = this.stockValue(eb);
    const neededVal = Math.max(0, CRUISER_BUILD_ITEMS - currentStockVal);
    if (neededVal <= 0) return 0;

    let movedVal = 0;
    const price = function (k) { return (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[k]) || 10; };

    for (const k in stationOre) {
      const q = stationOre[k] || 0;
      if (q > 0 && movedVal < neededVal) {
        const p = price(k);
        const valNeeded = neededVal - movedVal;
        const takeQty = Math.min(q, Math.ceil(valNeeded / p));
        
        if (takeQty > 0) {
          eb.stock[k] = (eb.stock[k] || 0) + takeQty;
          stationOre[k] -= takeQty; // Only subtract what was taken from station!
          movedVal += takeQty * p;
        }
      }
    }

    this.tryBuildCruiser(eb);
    return movedVal;
  }

  processCorpExplorerDocking(bot) {
    if (!bot || !bot.ship || !this.playerData) return;

    const ship = bot.ship;
    const personalHangar = this.playerData.stationOre ||
      (this.playerData.stationOre = {});
    const corporationHangar = this.playerData.corpStationOre ||
      (this.playerData.corpStationOre = {});

    bot.stock = bot.stock || {};
    let personalValue = 0;
    let explorerValue = 0;
    let corporationValue = 0;

    // Explorer salvage is split 50% to the pilot, 25% to Explorer
    // development, and 25% to the corporation logistics hangar.
    const recovered = bot.tempStock || {};
    for (const [itemKey, rawQty] of Object.entries(recovered)) {
      const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
      if (!qty) continue;

      const personalQty = Math.floor(qty * 0.50);
      const explorerQty = Math.floor(qty * 0.25);
      const corporationQty = qty - personalQty - explorerQty;

      // Pilot's half goes straight into the personal High-Sec hangar.
      if (personalQty > 0) {
        personalHangar[itemKey] =
          (personalHangar[itemKey] || 0) + personalQty;
      }

      // Half of the Explorer's quarter becomes development materials;
      // the other half becomes the Explorer's own ISK reserve.
      const developmentItems = Math.floor(explorerQty * 0.50);
      const developmentIskItems = explorerQty - developmentItems;
      if (developmentItems > 0) {
        bot.stock[itemKey] = (bot.stock[itemKey] || 0) + developmentItems;
      }
      if (developmentIskItems > 0) {
        const unitPrice =
          (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[itemKey]) || 10;
        bot.wallet = (bot.wallet || 0) + developmentIskItems * unitPrice;
      }

      // The corporation's quarter is reserved for the Transport Manager.
      if (corporationQty > 0) {
        corporationHangar[itemKey] =
          (corporationHangar[itemKey] || 0) + corporationQty;
      }

      const price =
        (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[itemKey]) || 10;
      personalValue += personalQty * price;
      explorerValue += explorerQty * price;
      corporationValue += corporationQty * price;
    }

    bot.tempStock = {};
    ship.cargo = 0;
    ship.cargoByOre = {};

    if (personalValue || explorerValue || corporationValue) {
      if (typeof window.showCorpNotification === 'function') {
        window.showCorpNotification(
          'Explorer delivery split: 50% personal hangar, 25% Explorer development, 25% corporation hangar.'
        );
      }
      if (typeof window.saveGameSession === 'function') {
        window.saveGameSession();
      }
      if (typeof window.updateStationUI === 'function') {
        window.updateStationUI();
      }
    }

    // Keep the Explorer's own stock and wallet for its Cruiser progression.
    this.tryBuildCruiser(bot);
  }

  deliver(bot) {
    const ship = bot.ship;
    const amount = Math.floor(ship.cargo || 0);

    if (isExplorerBot(bot)) {
      this.processCorpExplorerDocking(bot);
      ship.cargo = 0;
      ship.cargoByOre = {};
      bot.target = null;
      ship.docked = true;
      setTimeout(() => { ship.docked = false; }, 1000);
      return;
    }

    if (amount > 0 && this.playerData && this.playerData.stationOre) {
      const cargoMap = window.ensureOreCargo ? window.ensureOreCargo(ship) : (ship.cargoByOre || { [ship.oreType || 'veldspar']: amount });
      const cargoKeys = Object.keys(cargoMap).filter(k => (Number(cargoMap[k]) || 0) > 0);
      if (!cargoKeys.length && amount > 0) { cargoMap[ship.oreType || 'veldspar'] = amount; cargoKeys.push(ship.oreType || 'veldspar'); }
      const key = cargoKeys[0] || 'veldspar';

      if (ship.className === 'Transport Capital' || ship.className === 'Industrial Hauler' || ship.className === 'Freighter') {
        const parts = [];
        let accounted = 0;
        const contrib = ship.cargoContrib || {};
        for (const id in contrib) {
          const c = contrib[id];
          for (const k in c.ore) {
            const q = Math.floor(c.ore[k]);
            if (q > 0) { parts.push({ bot: c.bot, key: this.oreKey(k), qty: q }); accounted += q; }
          }
        }
        const contributedByKey = {};
        parts.forEach(part => { contributedByKey[part.key] = (contributedByKey[part.key] || 0) + part.qty; });
        for (const oreKey of cargoKeys) {
          const remainder = Math.max(0, Math.floor(Number(cargoMap[oreKey]) || 0) - (contributedByKey[oreKey] || 0));
          if (remainder > 0) parts.push({ bot: null, key: this.oreKey(oreKey), qty: remainder });
        }

        bot.stock = bot.stock || {};
        const minerDelivered = new Map();
        parts.forEach((part) => {
          const cutAmt = Math.ceil(part.qty * 0.10);
          const share = part.qty - cutAmt;
          bot.stock[part.key] = (bot.stock[part.key] || 0) + cutAmt;
          if (part.bot && part.bot.ship && part.bot !== bot) {
            this.creditMinerShare(part.bot, part.key, share);
            const existing = minerDelivered.get(part.bot) || { qty: 0, haulSize: 200 };
            existing.qty += part.qty;
            const sourceRecord = Object.values(contrib).find(c => c && c.bot === part.bot);
            existing.haulSize = sourceRecord && sourceRecord.haulSize > 0 ? sourceRecord.haulSize : (part.bot.ship.maxCargo || existing.haulSize);
            minerDelivered.set(part.bot, existing);
          } else {
            this.playerData.stationOre[part.key] = (this.playerData.stationOre[part.key] || 0) + share;
          }
        });
        minerDelivered.forEach((delivery, minerBot) => {
          const progress = Math.max(0, Number(minerBot.haulProgress) || 0) + delivery.qty / Math.max(1, delivery.haulSize);
          const earnedHauls = Math.floor(progress + 1e-9);
          minerBot.haulProgress = Math.max(0, progress - earnedHauls);
          if (earnedHauls > 0) {
            minerBot.hauls = (minerBot.hauls || 0) + earnedHauls;
            for (let i = 0; i < this.tiers.length; i++) {
              const before = minerBot.className;
              this.maybePromote(minerBot);
              if (minerBot.className === before) break;
            }
          }
        });
        ship.cargoContrib = {};

        if (ship.moduleLevels) {
          let modToUpgrade = null;
          for (const mod in ship.moduleLevels) {
            if (ship.moduleLevels[mod] < 5) { modToUpgrade = mod; break; }
          }
          if (modToUpgrade) {
            const upgradeCost = ship.moduleLevels[modToUpgrade] * 20000;
            if (this.stockValue(bot) >= upgradeCost) {
              this.consumeStock(bot, upgradeCost);
              ship.moduleLevels[modToUpgrade]++;
              if (typeof ship.applyStats === 'function') ship.applyStats();
              if (typeof window.showCorpNotification === 'function') {
                window.showCorpNotification(`Transport Capital upgraded ${modToUpgrade.toUpperCase()} to Lv${ship.moduleLevels[modToUpgrade]}!`);
              }
            }
          }
        }

        ship.cargo = 0;
        ship.cargoByOre = {};
        bot.targetMiner = null;
        bot.transportState = 'seeking';

        bot.hauls = (bot.hauls || 0) + 1;
        const tIdx = TRANSPORT_TIERS.findIndex(t => t.name === ship.className);
        if (tIdx !== -1 && tIdx < TRANSPORT_TIERS.length - 1 && bot.hauls >= TRANSPORT_TIERS[tIdx].hauls) {
          const nextT = TRANSPORT_TIERS[tIdx + 1].name;
          const upgradedT = this.createShip(nextT, ship.x, ship.y);
          upgradedT.vx = ship.vx; upgradedT.vy = ship.vy; upgradedT.angle = ship.angle;
          upgradedT.corpBot = bot;
          bot.ship = upgradedT;
          bot.className = nextT;
          bot.hauls = 0;
          if (window.showCorpNotification) window.showCorpNotification('Transport Manager promoted to ' + nextT + '!');
          if (typeof window.saveGameSession === 'function') window.saveGameSession();
        }
        return;
      }

      for (const oreKey of cargoKeys) {
        const oreAmount = Math.floor(Number(cargoMap[oreKey]) || 0);
        if (oreAmount > 0) this.creditMinerShare(bot, this.oreKey(oreKey), oreAmount);
      }
    }

    ship.cargo = 0;
    ship.cargoByOre = {};
    bot.target = null;
    bot.hauls = (bot.hauls || 0) + 1;

    this.maybePromote(bot);
  }

  oreKey(k) {
    return k && typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[k] !== undefined ? k : 'veldspar';
  }

  creditMinerShare(bot, key, amount) {
    const ship = bot.ship;
    if (!ship || amount <= 0) return;
    const unitPrice = (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[key]) ? ITEM_PRICES[key] : 2;

    if (!this.nextMinerUpgrade(bot)) {
      this.playerData.corpStationOre = this.playerData.corpStationOre || {};
      this.playerData.corpStationOre[key] = (this.playerData.corpStationOre[key] || 0) + amount;
      return;
    }

    bot.wallet = (bot.wallet || 0) + amount * unitPrice;
    this.buyMinerUpgrades(bot);
  }

  nextMinerUpgrade(bot) {
    const ship = bot.ship;
    if (!ship || !ship.moduleLevels) return null;
    let pick = null, pickCost = Infinity;
    for (const mod in ship.moduleLevels) {
      const lvl = ship.moduleLevels[mod] || 1;
      const cap = typeof window.getCap === 'function' ? window.getCap(mod, ship.className) : 5;
      if (lvl >= cap) continue;
      const cost = lvl * 4000;
      if (cost < pickCost) { pick = mod; pickCost = cost; }
    }
    return pick ? { mod: pick, cost: pickCost } : null;
  }

  buyMinerUpgrades(bot) {
    const ship = bot.ship;
    let bought = 0;
    let next;
    while ((next = this.nextMinerUpgrade(bot)) && (bot.wallet || 0) >= next.cost && bought < 50) {
      bot.wallet -= next.cost;
      ship.moduleLevels[next.mod]++;
      bought++;
    }
    if (bought > 0) {
      if (typeof ship.applyStats === 'function') ship.applyStats();
      if (typeof window.showCorpNotification === 'function') {
        window.showCorpNotification('Corp ' + bot.className + ' bought ' + bought + ' upgrade' + (bought === 1 ? '' : 's') + '!');
      }
    }
  }

  isFullyMaxed(bot) {
    const ship = bot.ship;
    if (!ship || !ship.moduleLevels) return false;
    if (isExplorerBot(bot) && bot.hasCruiserBlueprint && !bot.cruiserBuilt) return false;
    const capOf = (mod) => (typeof window.getCap === 'function' ? window.getCap(mod, ship.className) : 5);
    for (const mod in ship.moduleLevels) {
      if ((ship.moduleLevels[mod] || 1) < capOf(mod)) return false;
    }
    return true;
  }

  paySurplus(bot) {
    // Explorer reserves belong to its own Cruiser progression.
    if (isExplorerBot(bot)) return null;
    if (SURPLUS_PAYOUT_SHARE <= 0) return null;
    if (!this.isFullyMaxed(bot)) return null;
    const share = Math.min(1, SURPLUS_PAYOUT_SHARE);

    let iskPaid = 0;
    const wallet = Math.floor(bot.wallet || 0);
    const iskTake = Math.floor(wallet * share);
    if (iskTake > 0) {
      bot.wallet -= iskTake;
      this.playerData.isk = (this.playerData.isk || 0) + iskTake;
      iskPaid = iskTake;
    }

    let itemsPaid = 0;
    if (bot.stock) {
      for (const k in bot.stock) {
        const q = Math.floor(bot.stock[k] || 0);
        const take = Math.floor(q * share);
        if (take <= 0) continue;
        bot.stock[k] = q - take;
        this.playerData.corpStationOre = this.playerData.corpStationOre || {};
        this.playerData.corpStationOre[k] = (this.playerData.corpStationOre[k] || 0) + take;
        itemsPaid += take;
      }
    }

    if (iskPaid <= 0 && itemsPaid <= 0) return null;
    return { isk: iskPaid, items: itemsPaid };
  }

  payMaxedSurplus() {
    let paidAny = false;
    for (const bot of this.bots) {
      const result = this.paySurplus(bot);
      if (!result) continue;
      paidAny = true;
      const fmt = (typeof fmtISK === 'function') ? fmtISK : (n) => String(n);
      const parts = [];
      if (result.isk > 0) parts.push(fmt(result.isk) + ' Scrap Metals');
      if (result.items > 0) parts.push(result.items.toLocaleString() + ' ore/components');
      if (typeof window.showCorpNotification === 'function') {
        window.showCorpNotification((bot.className || 'Corp ship') + ' paid you ' + parts.join(' and ') + ' from its surplus.');
      }
    }
    if (paidAny && typeof window.saveGameSession === 'function') window.saveGameSession();
  }

  recordSiphon(transportShip, ownerShip, key, amt) {
    const owner = ownerShip && ownerShip.corpBot ? ownerShip.corpBot : null;
    const id = owner ? owner.id : 'player';
    if (!transportShip.cargoContrib) transportShip.cargoContrib = {};
    const c = transportShip.cargoContrib[id] || (transportShip.cargoContrib[id] = { bot: owner, ore: {}, haulSize: ownerShip && ownerShip.maxCargo ? ownerShip.maxCargo : 200 });
    c.ore[key] = (c.ore[key] || 0) + amt;
  }

  carryModuleLevels(from, to) {
    if (!from || !to || !from.moduleLevels || !to.moduleLevels) return;
    for (const mod in from.moduleLevels) {
      if (to.moduleLevels[mod] === undefined) continue;
      let lvl = from.moduleLevels[mod];
      if (typeof window.getCap === 'function') lvl = Math.min(lvl, window.getCap(mod, to.className));
      to.moduleLevels[mod] = Math.max(to.moduleLevels[mod], lvl);
    }
    if (typeof to.applyStats === 'function') to.applyStats();
  }

  upgradeExplorerModules(bot) {
    const ship = bot.ship;
    if (!ship || !ship.moduleLevels || typeof window.getCap !== 'function') return;
    const reserve = (bot.hasCruiserBlueprint && !bot.cruiserBuilt) ? CRUISER_BUILD_ISK : 0;
    let pick = null, pickCost = Infinity;
    for (const mod in ship.moduleLevels) {
      const lvl = ship.moduleLevels[mod];
      if (lvl >= window.getCap(mod, ship.className)) continue;
      const cost = lvl * 4000;
      if (cost < pickCost) { pick = mod; pickCost = cost; }
    }
    if (!pick || (bot.wallet || 0) - pickCost < reserve) return;
    bot.wallet -= pickCost;
    ship.moduleLevels[pick]++;
    if (typeof ship.applyStats === 'function') ship.applyStats();
    if (typeof window.showCorpNotification === 'function') {
      window.showCorpNotification('Corp ' + bot.className + ' upgraded ' + pick.toUpperCase() + ' to Lv' + ship.moduleLevels[pick] + '!');
    }
  }

  updateExplorerBot(bot, target) {
    const ship = bot.ship;
    const full = (ship.cargo || 0) >= (ship.maxCargo || 150);
    const hr = typeof ship.hackRange === 'function' ? ship.hackRange() : 60;
    const arrive = hr + 40;

    let goal, dist;
    if (full) {
      goal = { x: this.station.x, y: this.station.y };
      dist = Math.hypot(goal.x - ship.x, goal.y - ship.y);
    } else {
      const dx = target.x - ship.x, dy = target.y - ship.y;
      dist = Math.hypot(dx, dy) || 1;
      goal = { x: target.x - (dx / dist) * hr * 0.9, y: target.y - (dy / dist) * hr * 0.9 };
    }

    const scanning = !full && dist <= arrive;
    const wantCloak = full ? true : (ship.isCloaked ? dist > arrive + 60 : dist > arrive + 300);
    if (typeof ship.toggleCloak === 'function' && !!ship.isCloaked !== wantCloak) ship.toggleCloak();

    if (full) {
      if (dist > 60) ship.update(goal, null, false);
      else this.deliver(bot);
      return;
    }

    ship.update(goal, null, false);

    if (scanning && !ship.isCloaked) {
      bot.mineTimer++;
      if (bot.mineTimer >= 60) {
        bot.mineTimer = 0;
        if (target.isHacked !== true) {
          target.isHacked = true;
          const tier = target.tier || 1;
          const key = 'debris_t' + tier;
          
          if (typeof ship.executeJankyHack === 'function') {
            ship.executeJankyHack(target);
          } else {
            const acquired = Math.min(tier === 1 ? 5 : 15, ship.maxCargo - (ship.cargo || 0));
            if (window.addOreToCargo) window.addOreToCargo(ship, key, acquired);
            else { ship.cargo = (ship.cargo || 0) + acquired; ship.oreType = key; }
            bot.tempStock = bot.tempStock || {};
            bot.tempStock[key] = (bot.tempStock[key] || 0) + acquired;
          }
          if (tier >= 3 && Math.random() < 0.2) bot.hasCruiserBlueprint = true;
          target.oreYield = 0;
          bot.target = null;
          this.upgradeExplorerModules(bot);
          this.tryBuildCruiser(bot);
        }
      }
    } else {
      bot.mineTimer = 0;
    }
  }

  maybePromote(bot) {
    const ship = bot.ship;
    const idx = this.tiers.findIndex(t => t.name === bot.className);
    if (idx !== -1 && idx < this.tiers.length - 1 && bot.hauls >= this.tiers[idx].hauls) {
      const next = this.tiers[idx + 1].name;
      let upgraded = null;
      try {
        upgraded = this.createShip(next, ship.x, ship.y);
      } catch (err) {
        return;
      }
      upgraded.vx = ship.vx;
      upgraded.vy = ship.vy;
      upgraded.angle = ship.angle;
      upgraded.corpBot = bot;
      bot.ship = upgraded;
      bot.className = next;
      bot.hauls = 0;
      if (window.showCorpNotification) window.showCorpNotification('Corp pilot promoted to ' + next + '!');
      if (typeof window.saveGameSession === 'function') window.saveGameSession();
    }
  }

  spacingFor(bot) {
    if (bot.className === 'Mining Capital') return 1200;
    if (bot.className === 'Command Ship') return 900;
    if (bot.className === 'Mining Barge') return 400;
    return 300;
  }

  pickTarget(bot, list, playerShip) {
    const ship = bot.ship;
    const claimed = [];
    this.bots.forEach(function(o) {
      if (o !== bot && o.target && (o.target.oreYield > 0 || isExplorerBot(bot))) {
        claimed.push(o.target);
      }
    });
    if (playerShip && playerShip.currentTarget) claimed.push(playerShip.currentTarget);
    const spacing = this.spacingFor(bot);

    let best = null, bestD = Infinity, fallback = null, fallbackD = Infinity;
    for (const t of list) {
      const isValidTarget = isExplorerBot(bot)
        ? (t.isHacked !== true && t.oreYield > 0)
        : (t.oreYield > 0);

      if (!isValidTarget) continue;
      if (claimed.indexOf(t) !== -1) continue;
      const d = Math.hypot(t.x - ship.x, t.y - ship.y);
      if (d < fallbackD) { fallbackD = d; fallback = t; }
      let crowded = false;
      for (const c of claimed) {
        if (Math.hypot(c.x - t.x, c.y - t.y) < spacing) { crowded = true; break; }
      }
      if (!crowded && d < bestD) { bestD = d; best = t; }
    }
    if (best) return best;
    if (fallback) return fallback;
    return list[0] || null;
  }

  update(playerShip, asteroidBelt, debrisField) {
    // Fleet snapshots are captured by MainGameController.saveGameSession().
    // Do not serialize every bot, inventory and cargo record on every animation frame.

    this._cruiserCheck = ((this._cruiserCheck || 0) + 1) % 60;
    if (this._cruiserCheck === 0) {
      this.bots.forEach((b) => { if (isExplorerBot(b) && b.hasCruiserBlueprint && !b.cruiserBuilt) this.tryBuildCruiser(b); });
    }

    this._payoutTimer = ((this._payoutTimer || 0) + 1) % SURPLUS_PAYOUT_FRAMES;
    if (this._payoutTimer === 0) this.payMaxedSurplus();

    const beltEntities = asteroidBelt && typeof asteroidBelt.getEntities === 'function' ? asteroidBelt.getEntities() : (asteroidBelt ? asteroidBelt.entities : []);
    const debrisEntities = debrisField && typeof debrisField.getEntities === 'function' ? debrisField.getEntities() : [];

    this.bots.forEach((bot) => {
      const ship = bot.ship;
      if (!ship) return;

      if (
        ship.className === 'Transport Capital' ||
        ship.className === 'Industrial Hauler' ||
        ship.className === 'Freighter'
      ) {
        if (!bot.transportState) bot.transportState = 'loading';
        if (!bot.transportMapId) bot.transportMapId = 'private_highsec';

        const maxCargo = Math.max(1, ship.maxCargo || 50000);
        if (bot.transportState === 'full') {
          bot.transportState = 'to_trade_gate';
          if (!bot.transportShipmentId) {
            bot.transportShipmentId = 'corp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
          }
          if (typeof window.saveGameSession === 'function') window.saveGameSession();
        }
        const inventory = this.playerData.corpStationOre ||
          (this.playerData.corpStationOre = {});
        ship.cargoByOre = ship.cargoByOre || {};

        const moveTo = function (x, y) {
          ship.docked = false;
          ship.update({ x: x, y: y }, null, false);
        };

        // Visible round trip for player shipyard supply orders.
        if (bot.transportState === 'buy_to_trade_gate') {
          const gateX = 4200, gateY = 2500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) moveTo(gateX, gateY);
          else {
            bot.transportMapId = 'public_trade_hub';
            ship.x = 880; ship.y = 3500; ship.vx = 0; ship.vy = 0;
            bot.transportState = 'buy_to_market';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }
        if (bot.transportState === 'buy_to_market') {
          const marketX = 3500, marketY = 3500;
          if (Math.hypot(marketX - ship.x, marketY - ship.y) > 300) { moveTo(marketX, marketY); return; }
          if (bot._materialPickupPending) return;
          bot._materialPickupPending = true;
          if (!window.completeTransportMaterialPickup) {
            bot._materialPickupPending = false;
            bot.transportTask.status = 'failed';
            bot.transportTask.message = 'Shipyard pickup service unavailable.';
            bot.transportState = 'buy_to_return_gate';
            return;
          }
          window.completeTransportMaterialPickup(bot).then((result) => {
            bot.transportTask.status = result && result.success ? 'delivered' : 'failed';
            bot.transportTask.message = result && result.message ? result.message : '';
            bot._materialPickupPending = false;
            bot.transportState = 'buy_to_return_gate';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }).catch((error) => {
            bot.transportTask.status = 'failed';
            bot.transportTask.message = error.message || String(error);
            bot._materialPickupPending = false;
            bot.transportState = 'buy_to_return_gate';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          });
          return;
        }
        if (bot.transportState === 'buy_to_return_gate') {
          const gateX = 700, gateY = 3500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) moveTo(gateX, gateY);
          else {
            bot.transportMapId = 'private_highsec';
            ship.x = 4200; ship.y = 2500; ship.vx = 0; ship.vy = 0;
            bot.transportState = 'buy_returning';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }
        if (bot.transportState === 'buy_returning') {
          if (Math.hypot(this.station.x - ship.x, this.station.y - ship.y) > 110) moveTo(this.station.x, this.station.y);
          else {
            ship.docked = true; ship.vx = 0; ship.vy = 0;
            const task = bot.transportTask;
            const result = { success: !!(task && task.status === 'delivered'), message: task && task.message };
            bot.transportTask = null;
            bot.transportState = 'loading';
            if (typeof window.finishTransportShipBuild === 'function') window.finishTransportShipBuild(task, result);
            if (typeof window.startNextTransportShipBuild === 'function') window.startNextTransportShipBuild(bot);
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
            if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
          }
          return;
        }

        if (bot.transportState === 'sell_to_trade_gate') {
          const gateX = 4200, gateY = 2500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) moveTo(gateX, gateY);
          else {
            bot.transportMapId = 'public_trade_hub';
            ship.x = 880; ship.y = 3500; ship.vx = 0; ship.vy = 0;
            bot.transportState = 'sell_to_market';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }

        if (bot.transportState === 'sell_to_market') {
          const marketX = 3500, marketY = 3500;
          if (Math.hypot(marketX - ship.x, marketY - ship.y) > 850) {
            moveTo(marketX, marketY);
            return;
          }
          const task = bot.playerSaleTask;
          const shipments = task && Array.isArray(task.shipments)
            ? task.shipments
            : (task && task.shipmentId ? [task] : []);
          if (!shipments.length) {
            bot.transportState = 'sell_to_return_gate';
            return;
          }
          if (bot._playerMarketSalePending) return;
          if (bot._playerMarketRetryAt && Date.now() < bot._playerMarketRetryAt) return;
          if (!window.MINISPACE_MARKET || typeof window.MINISPACE_MARKET.completeTransportSale !== 'function') return;
          bot._playerMarketSalePending = true;
          (async () => {
            const completed = [];
            for (const shipment of shipments) {
              const raw = await window.MINISPACE_MARKET.completeTransportSale(shipment.shipmentId);
              const receipt = Array.isArray(raw) ? raw[0] : raw;
              if (!receipt || receipt.success === false) throw new Error('The market did not confirm shipment ' + shipment.shipmentId + '.');
              completed.push({
                receipt: receipt,
                shipment: shipment
              });
            }
            if (window.MINISPACE_MARKET.applyToGame(this.playerData)) {
              if (typeof window.updateStationUI === 'function') window.updateStationUI();
            }
            this.playerData.marketSales = Array.isArray(this.playerData.marketSales) ? this.playerData.marketSales : [];
            let grossTotal = 0, feeTotal = 0, netTotal = 0;
            completed.forEach(({ receipt, shipment }) => {
              const gross = Math.max(0, Math.floor(Number(receipt.gross) || 0));
              const fee = Math.max(0, Math.floor(Number(receipt.fee) || 0));
              const net = Math.max(0, Math.floor(Number(receipt.net) || 0));
              grossTotal += gross; feeTotal += fee; netTotal += net;
              this.playerData.marketSales.push({
                source: 'player_transport_sale',
                shipmentId: shipment.shipmentId,
                items: Object.keys(shipment.items || {}).map(function (key) {
                  return Math.max(0, Math.floor(Number(shipment.items[key]) || 0)).toLocaleString() + ' ' + key;
                }),
                gross: gross, fee: fee, proceeds: net, time: Date.now()
              });
            });
            if (this.playerData.marketSales.length > 100) this.playerData.marketSales.splice(0, this.playerData.marketSales.length - 100);
            ship.cargo = 0;
            ship.cargoByOre = {};
            bot.playerSaleTask = null;
            bot.transportState = 'sell_to_return_gate';
            bot._playerMarketSalePending = false;
            bot._playerMarketRetryAt = 0;
            if (typeof window.showCorpNotification === 'function') {
              window.showCorpNotification('Delivery sold: ' + grossTotal.toLocaleString() + ' gross, ' + feeTotal.toLocaleString() + ' Transport Manager fee, ' + netTotal.toLocaleString() + ' Scrap Metals credited to the submitting pilot.');
            }
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
            if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
          })().catch((error) => {
            bot._playerMarketSalePending = false;
            bot._playerMarketRetryAt = Date.now() + 15000;
            if (typeof window.showCorpNotification === 'function') {
              window.showCorpNotification('Transport Manager reached the market but could not complete every queued sale. Cargo and shipment records are safe; he will retry. ' + (error.message || error));
            }
          });
          return;
        }

        if (bot.transportState === 'sell_to_return_gate') {
          const gateX = 700, gateY = 3500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) moveTo(gateX, gateY);
          else {
            bot.transportMapId = 'private_highsec';
            ship.x = 4200; ship.y = 2500; ship.vx = 0; ship.vy = 0;
            bot.transportState = 'sell_returning';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }

        if (bot.transportState === 'sell_returning') {
          if (Math.hypot(this.station.x - ship.x, this.station.y - ship.y) > 110) moveTo(this.station.x, this.station.y);
          else {
            bot.transportState = 'loading';
            ship.docked = true; ship.vx = 0; ship.vy = 0;
            bot.playerSaleIdleSince = 0;
            if (typeof window.showCorpNotification === 'function') {
              const waiting = Array.isArray(bot.playerSaleQueue) ? bot.playerSaleQueue.length : 0;
              window.showCorpNotification(waiting ? 'Back at High-Sec. ' + waiting + ' deposited sale(s) waiting; loading for the next trip.' : 'All deposited sales delivered. Transport Manager is ready.');
            }
            if (typeof window.startNextTransportShipBuild === 'function') window.startNextTransportShipBuild(bot);
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
            if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
          }
          return;
        }

        if (bot.transportState === 'loading') {
          ship.docked = true;
          ship.vx = 0;
          ship.vy = 0;

          // Player deposits collect in the manager's hangar while he is away.
          // At High-Sec he batches whole orders, leaving when full or after 30 seconds idle.
          if (Array.isArray(bot.playerSaleQueue) && bot.playerSaleQueue.length > 0 && !bot.playerSaleTask && (ship.cargo || 0) <= 0) {
            if (!bot.playerSaleIdleSince) bot.playerSaleIdleSince = Date.now();
            const staged = [];
            const batchItems = {};
            let batchTotal = 0;
            for (const order of bot.playerSaleQueue) {
              const orderTotal = Object.keys(order.items || {}).reduce(function (sum, key) {
                return sum + Math.max(0, Math.floor(Number(order.items[key]) || 0));
              }, 0);
              if (orderTotal < 1 || batchTotal + orderTotal > maxCargo) break;
              staged.push(order);
              batchTotal += orderTotal;
              Object.keys(order.items || {}).forEach(function (key) {
                batchItems[key] = (batchItems[key] || 0) + Math.max(0, Math.floor(Number(order.items[key]) || 0));
              });
              if (batchTotal >= maxCargo) break;
            }
            const full = batchTotal >= maxCargo;
            const timerExpired = Date.now() - bot.playerSaleIdleSince >= 30000;
            if (staged.length && (full || timerExpired)) {
              bot.playerSaleQueue.splice(0, staged.length);
              bot.playerSaleTask = { shipments: staged, items: batchItems, status: 'in_transit' };
              ship.cargoByOre = Object.assign({}, batchItems);
              ship.cargo = batchTotal;
              bot.playerSaleIdleSince = 0;
              bot.transportState = 'sell_to_trade_gate';
              if (typeof window.showCorpNotification === 'function') {
                window.showCorpNotification('Transport Manager departing with ' + batchTotal.toLocaleString() + ' goods from ' + staged.length + ' deposited sale(s).');
              }
              if (typeof window.saveGameSession === 'function') window.saveGameSession();
              if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
              return;
            }
            bot._saleQueueUiTick = ((bot._saleQueueUiTick || 0) + 1) % 60;
            if (bot._saleQueueUiTick === 0 && typeof window.updateCorpUI === 'function') window.updateCorpUI();
            return;
          }
          if (bot.playerSaleTask && (ship.cargo || 0) <= 0) {
            // Recover legacy single-shipment saves into the new batching queue.
            bot.playerSaleQueue = Array.isArray(bot.playerSaleQueue) ? bot.playerSaleQueue : [];
            bot.playerSaleQueue.unshift(bot.playerSaleTask);
            bot.playerSaleTask = null;
            bot.playerSaleIdleSince = Date.now();
            return;
          }
          ship.vx = 0;
          ship.vy = 0;

          let room = Math.max(0, maxCargo - (ship.cargo || 0));
          const keys = Object.keys(inventory).sort();
          for (const key of keys) {
            if (room <= 0) break;
            const available = Math.max(0, Math.floor(Number(inventory[key]) || 0));
            if (!available) continue;
            const loaded = Math.min(available, room);
            inventory[key] = available - loaded;
            ship.cargoByOre[key] = (ship.cargoByOre[key] || 0) + loaded;
            ship.cargo += loaded;
            room -= loaded;
          }

          // Never depart with a partial load. Wait for the corporation hangar
          // to contain enough goods to fill the transport ship completely.
          bot._corpUiTick = ((bot._corpUiTick || 0) + 1) % 60;
          if (bot._corpUiTick === 0 && typeof window.updateCorpUI === 'function') {
            window.updateCorpUI();
          }

          if ((ship.cargo || 0) >= maxCargo) {
            bot.transportState = 'to_trade_gate';
            if (!bot.transportShipmentId) {
              bot.transportShipmentId = 'corp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
            }
            if (typeof window.showCorpNotification === 'function') {
              window.showCorpNotification('Transport Manager loaded to 100% and is departing for the Trade Hub.');
            }
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
            if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
          }
          return;
        }

        if (bot.transportState === 'to_trade_gate') {
          const gateX = 4200, gateY = 2500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) {
            moveTo(gateX, gateY);
          } else {
            bot.transportMapId = 'public_trade_hub';
            ship.x = 880;
            ship.y = 3500;
            ship.vx = 0;
            ship.vy = 0;
            bot.transportState = 'to_market';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }

        if (bot.transportState === 'to_market') {
          const marketX = 3500, marketY = 3500;
          if (Math.hypot(marketX - ship.x, marketY - ship.y) > 850) {
            moveTo(marketX, marketY);
            return;
          }

          if (bot._corpMarketSupplyPending) return;
          if (bot._corpMarketRetryAt && Date.now() < bot._corpMarketRetryAt) return;
          if (!window.MINISPACE_MARKET ||
              typeof window.MINISPACE_MARKET.corpSupply !== 'function') {
            if (!bot._corpMarketWarnedAt || Date.now() - bot._corpMarketWarnedAt > 15000) {
              bot._corpMarketWarnedAt = Date.now();
              if (typeof window.showCorpNotification === 'function') {
                window.showCorpNotification('Transport Manager is waiting for the shared market connection.');
              }
            }
            return;
          }

          if (!bot.transportShipmentId) {
            bot.transportShipmentId = 'corp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }

          const shipmentItems = {};
          Object.keys(ship.cargoByOre || {}).forEach(function (key) {
            const qty = Math.max(0, Math.floor(Number(ship.cargoByOre[key]) || 0));
            if (qty > 0) shipmentItems[key] = qty;
          });

          bot._corpMarketSupplyPending = true;
          window.MINISPACE_MARKET.corpSupply(bot.transportShipmentId, shipmentItems)
            .then((result) => {
              const receipt = Array.isArray(result) ? result[0] : result;
              if (!receipt || receipt.success === false) {
                throw new Error('The shared market did not confirm the shipment.');
              }

              const proceeds = Math.max(0, Math.floor(Number(receipt.proceeds) || 0));
              this.playerData.corpIsk = (this.playerData.corpIsk || 0) + proceeds;
              this.playerData.marketSales = Array.isArray(this.playerData.marketSales)
                ? this.playerData.marketSales : [];
              this.playerData.marketSales.push({
                source: 'corporation_transport',
                items: Object.keys(shipmentItems).map(function (key) {
                  return shipmentItems[key].toLocaleString() + ' ' + key;
                }),
                proceeds: proceeds,
                time: Date.now()
              });
              if (this.playerData.marketSales.length > 100) {
                this.playerData.marketSales.splice(0, this.playerData.marketSales.length - 100);
              }

              ship.cargo = 0;
              ship.cargoByOre = {};
              bot.transportShipmentId = null;
              bot.transportState = 'to_return_gate';
              bot._corpMarketSupplyPending = false;
              bot._corpMarketRetryAt = 0;
              bot._corpMarketWarnedAt = 0;
              if (typeof window.showCorpNotification === 'function') {
                window.showCorpNotification(
                  'Transport Manager added the corporation shipment to the shared market for ' +
                  proceeds.toLocaleString() + ' Scrap Metals.'
                );
              }
              if (typeof window.saveGameSession === 'function') window.saveGameSession();
              if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
            })
            .catch((error) => {
              bot._corpMarketSupplyPending = false;
              bot._corpMarketRetryAt = Date.now() + 15000;
              if (typeof window.showCorpNotification === 'function') {
                window.showCorpNotification('Transport Manager market delivery failed; cargo is safe and will retry. ' + (error.message || error));
              }
            });
          return;
        }

        if (bot.transportState === 'to_return_gate') {
          const gateX = 700, gateY = 3500;
          if (Math.hypot(gateX - ship.x, gateY - ship.y) > 110) {
            moveTo(gateX, gateY);
          } else {
            bot.transportMapId = 'private_highsec';
            ship.x = 4200;
            ship.y = 2500;
            ship.vx = 0;
            ship.vy = 0;
            bot.transportState = 'returning';
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
          }
          return;
        }

        if (bot.transportState === 'returning') {
          if (Math.hypot(this.station.x - ship.x, this.station.y - ship.y) > 110) {
            moveTo(this.station.x, this.station.y);
          } else {
            bot.transportState = 'loading';
            ship.docked = true;
            ship.vx = 0;
            ship.vy = 0;
            if (typeof window.showCorpNotification === 'function') {
              window.showCorpNotification('Transport Manager returned to High-Sec and is ready to load the next shipment.');
            }
            if (typeof window.startNextTransportShipBuild === 'function') window.startNextTransportShipBuild(bot);
            if (typeof window.saveGameSession === 'function') window.saveGameSession();
            if (typeof window.updateCorpUI === 'function') window.updateCorpUI();
          }
          return;
        }

        bot.transportState = 'loading';
        return;
      }

      ship.currentTarget = null;
      const list = isExplorerBot(bot) ? debrisEntities : beltEntities;
      if (!bot.target || bot.target.oreYield <= 0) {
        bot.target = this.pickTarget(bot, list, playerShip);
      }

      const target = bot.target;
      if (!target) return;

      if (isExplorerBot(bot)) { this.updateExplorerBot(bot, target); return; }

      // Command Ship uses its internal drone mining / tether logic
      if (ship.className === 'Command Ship') {
        ship.update(null, target, false, false, asteroidBelt);
        // Check if cargo is full or needs delivering back to station
        const maxC = ship.maxCargo || 20000;
        if ((ship.cargo || 0) >= maxC * 0.95) {
          const dx = this.station.x - ship.x;
          const dy = this.station.y - ship.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= 60) {
            this.deliver(bot);
          }
        }
        return;
      }

      const maxC = ship.maxCargo || 200;
      const full = (ship.cargo || 0) >= maxC;

      if (full) {
        const dx = this.station.x - ship.x;
        const dy = this.station.y - ship.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 60) {
          ship.vx += (dx / dist) * 0.08;
          ship.vy += (dy / dist) * 0.08;
          ship.vx *= 0.94; ship.vy *= 0.94;
          ship.x += ship.vx; ship.y += ship.vy;
          ship.angle = Math.atan2(dy, dx);
        } else {
          this.deliver(bot);
        }
        return;
      }

      const dx = target.x - ship.x;
      const dy = target.y - ship.y;
      const dist = Math.hypot(dx, dy);
      const mineDist = ship.laserRange || 300;

      if (dist > mineDist * 0.85) {
        ship.vx += (dx / dist) * 0.07;
        ship.vy += (dy / dist) * 0.07;
        ship.vx *= 0.94; ship.vy *= 0.94;
        ship.x += ship.vx; ship.y += ship.vy;
        ship.angle = Math.atan2(dy, dx);
        bot.mineTimer = 0;
      } else {
        ship.vx *= 0.85;
        ship.vy *= 0.85;
        ship.x += ship.vx; ship.y += ship.vy;
        const angleToTarget = Math.atan2(dy, dx);
        ship.angle += (angleToTarget - ship.angle) * 0.15;

        if (!isExplorerBot(bot) && target.oreYield > 0) ship.currentTarget = target;

        if (!isExplorerBot(bot) && target.oreYield > 0) {
          const perFrame = ship.miningPower || 6;
          const amtF = Math.min(perFrame, target.oreYield, maxC - (ship.cargo || 0));
          if (amtF > 0) {
            target.oreYield -= amtF;
            if (window.addOreToCargo) window.addOreToCargo(ship, target.oreType || 'veldspar', amtF);
            else { ship.cargo = (ship.cargo || 0) + amtF; ship.oreType = target.oreType || 'veldspar'; }
          }
        }
        bot.mineTimer++;
        if (bot.mineTimer >= 60) {
          bot.mineTimer = 0;
        }
      }
    });
  }

  draw(ctx, asteroidBelt, debrisField) {
    this.bots.forEach(function(bot) {
      const ship = bot.ship;
      if (!ship) return;
      if (typeof ship.draw === 'function') {
        ship.draw(ctx, asteroidBelt, debrisField);
      } else {
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle || 0);
        ctx.fillStyle = bot.className.includes('Transport') || bot.className.includes('Hauler') || bot.className.includes('Freighter') ? '#f59e0b' : '#3fb950';
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(-10, -8); ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const c = ship.cargo || 0;
      const maxC = ship.maxCargo || 50000;
      if (c > 0) {
        const pct = Math.round((c / maxC) * 100);
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.fillStyle = bot.className.includes('Transport') || bot.className.includes('Hauler') || bot.className.includes('Freighter') ? '#fbbf24' : '#8aa8b3';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(bot.className.includes('Transport') || bot.className.includes('Hauler') || bot.className.includes('Freighter') ? `HAUL ${pct}%` : `${pct}%`, 0, -35);
        ctx.restore();
      }
    });
  }
}

window.BotManager = BotManager;
