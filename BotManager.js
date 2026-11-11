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
    ship.maxCargo = ship.maxCargo || 50000;
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
      cruiserBuilt: false
    };
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
        cargoByOre: Object.assign({}, (window.ensureOreCargo ? window.ensureOreCargo(ship) : ship.cargoByOre) || {})
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
      const ship = bot.ship;
      if (ship && ship.moduleLevels && s.moduleLevels) {
        for (const m in s.moduleLevels) {
          if (ship.moduleLevels[m] !== undefined) ship.moduleLevels[m] = s.moduleLevels[m];
        }
        if (typeof ship.applyStats === 'function') ship.applyStats();
      }
      if (ship) {
        ship.cargo = s.cargo || 0;
        if (s.oreType) ship.oreType = s.oreType;
        ship.cargoByOre = s.cargoByOre && typeof s.cargoByOre === 'object' ? Object.assign({}, s.cargoByOre) : null;
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
    if (!bot) return;
    let transferredAny = false;
    const ship = bot.ship;

    if (bot.tempStock) {
      bot.stock = bot.stock || {};
      for (const [itemKey, qty] of Object.entries(bot.tempStock)) {
        if (qty > 0) {
          const price = (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[itemKey]) || 10;
          const sold = Math.floor(qty * CRUISER_RELIC_SELL_SHARE);
          bot.wallet = (bot.wallet || 0) + sold * price;
          bot.stock[itemKey] = (bot.stock[itemKey] || 0) + (qty - sold);
          transferredAny = true;
        }
      }
      bot.tempStock = {};
    }

    if (ship) ship.cargo = 0;

    if (bot.stock && this.playerData) {
      this.playerData.stationOre = this.playerData.stationOre || {};
      for (const [itemKey, qty] of Object.entries(bot.stock)) {
        if (qty > 0) {
          this.playerData.stationOre[itemKey] = (this.playerData.stationOre[itemKey] || 0) + qty;
          bot.stock[itemKey] = 0;
          transferredAny = true;
        }
      }
    }

    if (bot.wallet && bot.wallet > 0 && this.playerData) {
      this.playerData.isk = (this.playerData.isk || 0) + bot.wallet;
      bot.wallet = 0;
      transferredAny = true;
    }

    if (transferredAny) {
      if (typeof window.showCorpNotification === 'function') {
        window.showCorpNotification('📦 Corp explorer docked: Delivered cargo, sold relics, and deposited ISK & loot!');
      }
      if (typeof window.saveGameSession === 'function') window.saveGameSession();
      if (typeof window.updateStationUI === 'function') window.updateStationUI();
    }
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
    const so = this.playerData && this.playerData.stationOre;
    return k && so && so[k] !== undefined ? k : 'veldspar';
  }

  creditMinerShare(bot, key, amount) {
    const ship = bot.ship;
    if (!ship || amount <= 0) return;
    const unitPrice = (typeof ITEM_PRICES !== 'undefined' && ITEM_PRICES[key]) ? ITEM_PRICES[key] : 2;

    if (!this.nextMinerUpgrade(bot)) {
      this.playerData.stationOre[key] = (this.playerData.stationOre[key] || 0) + amount;
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
        this.playerData.stationOre[k] = (this.playerData.stationOre[k] || 0) + take;
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

      if (ship.className === 'Transport Capital' || ship.className === 'Industrial Hauler' || ship.className === 'Freighter') {
        if (!bot.transportState) bot.transportState = 'seeking';
        const maxC = ship.maxCargo || 50000;
        const SF = window.TransportSiphon;
        ship.siphonFeed = [];

        if (bot.transportState === 'returning') {
          const dx = this.station.x - ship.x;
          const dy = this.station.y - ship.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 80) {
            ship.update({ x: this.station.x, y: this.station.y }, null, false);
          } else {
            this.deliver(bot);
          }
          return;
        }

        if ((ship.cargo || 0) >= maxC * 0.95) {
          bot.transportState = 'returning';
          bot.targetMiner = null;
          return;
        }

        let activeMiners = [];
        if (playerShip && !playerShip.docked && !isExplorerShip(playerShip) && SF.hasLoad(playerShip, 10)) activeMiners.push(playerShip);
        // Corp mining ships are valid sources too; skip explorers and all transport hulls.
        this.bots.forEach(function (candidate) {
          if (!candidate || candidate === bot || !candidate.ship) return;
          const minerShip = candidate.ship;
          const name = minerShip.className || candidate.className || '';
          if (isExplorerBot(candidate) || isExplorerShip(minerShip)) return;
          if (name === 'Transport Capital' || name === 'Industrial Hauler' || name === 'Freighter') return;
          if (!minerShip.docked && SF.hasLoad(minerShip, 10)) activeMiners.push(minerShip);
        });

        if (!bot.targetMiner || activeMiners.indexOf(bot.targetMiner) === -1 || !SF.hasLoad(bot.targetMiner, 5) || (bot.targetMiner.docked)) {
          let nearestMiner = null;
          let minD = Infinity;
          activeMiners.forEach(m => {
            const d = Math.hypot(m.x - ship.x, m.y - ship.y);
            if (d < minD) { minD = d; nearestMiner = m; }
          });
          bot.targetMiner = nearestMiner;
        }

        if (bot.targetMiner) {
          const miner = bot.targetMiner;
          const aim = SF.aimPoint(miner, ship);
          const STAND = SF.STANDOFF || 720;
          const GAP = SF.MIN_GAP || 430;

          if (bot.parkFor !== miner || bot.parkAng == null) {
            bot.parkFor = miner;
            bot.parkAng = Math.atan2(ship.y - aim.y, ship.x - aim.x);
            if (!isFinite(bot.parkAng)) bot.parkAng = 0;
          }
          const park = { x: aim.x + Math.cos(bot.parkAng) * STAND, y: aim.y + Math.sin(bot.parkAng) * STAND };
          const dist = Math.hypot(aim.x - ship.x, aim.y - ship.y);
          const parkDist = Math.hypot(park.x - ship.x, park.y - ship.y);

          if (!bot.siphoning && dist > STAND * 2) bot.parkAng = Math.atan2(ship.y - aim.y, ship.x - aim.x);

          if (bot.siphoning) { if (dist > STAND + 1100) bot.siphoning = false; }
          else if (dist < STAND + 220) bot.siphoning = true;

          const pushAway = function () {
            const others = [];
            if (playerShip && !playerShip.docked) others.push(playerShip);
            activeMiners.forEach(function (m) { others.push(m); });
            bots_all.forEach(function (b) { if (b.ship) others.push(b.ship); });
            // Transport ships keep clearance from ships only; drones are not logistics targets.
            others.forEach(function (o) {
              if (o === ship) return;
              const ox = ship.x - o.x, oy = ship.y - o.y;
              const od = Math.hypot(ox, oy);
              if (od < GAP) {
                const nx = od > 0.001 ? ox / od : 1, ny = od > 0.001 ? oy / od : 0;
                const f = (1 - od / GAP) * 0.12;
                ship.vx += nx * f; ship.vy += ny * f;
              }
            });
          };
          const bots_all = this.bots;

          if (!bot.siphoning) {
            ship.update({ x: park.x, y: park.y }, null, false);
            pushAway();
          } else {
            if (parkDist > 260) {
              ship.update({ x: park.x, y: park.y }, null, false);
            } else {
              ship.vx *= 0.9; ship.vy *= 0.9;
              ship.x += ship.vx; ship.y += ship.vy;
              ship.thrust = 0;
              ship.updateParticles();
            }
            pushAway();

            let room = maxC - (ship.cargo || 0);

            const self = this;
            const sources = [miner];

            sources.forEach(function (src) {
              if ((src.cargo || 0) > 0 && room > 0 && Math.hypot(src.x - ship.x, src.y - ship.y) <= SF.SHIP_RANGE) {
                const siphonRate = Math.max(1, src.cargo * 0.00083);
                const transferred = Math.min(siphonRate, src.cargo, room);
                if (transferred > 0) {
                  const siphonKey = self.oreKey(src.oreType);
                  if (window.removeOreFromCargo) window.removeOreFromCargo(src, siphonKey, transferred);
                  else src.cargo -= transferred;
                  if (window.addOreToCargo) window.addOreToCargo(ship, siphonKey, transferred);
                  else { ship.cargo = (ship.cargo || 0) + transferred; ship.oreType = siphonKey; }
                  self.recordSiphon(ship, src, siphonKey, transferred);
                  room -= transferred;
                  ship.siphonFeed.push({ ref: src, kind: 'ship' });
                }
              }

              // Deliberately ship-only: never inspect or transfer cargo from drones.
            });
          }
        } else {
          const hasBelt = asteroidBelt && isFinite(asteroidBelt.x) && isFinite(asteroidBelt.y);
          const homeX = hasBelt ? asteroidBelt.x : this.station.x + 300;
          const homeY = hasBelt ? asteroidBelt.y : this.station.y + 300;
          if (Math.hypot(homeX - ship.x, homeY - ship.y) > 150) {
            ship.update({ x: homeX, y: homeY }, null, false);
          } else {
            ship.vx *= 0.9; ship.vy *= 0.9;
            ship.x += ship.vx; ship.y += ship.vy;
            ship.thrust = 0;
            ship.updateParticles();
          }
        }
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
