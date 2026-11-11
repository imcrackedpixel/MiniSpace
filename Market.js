// Market.js - THE single price list for the whole game.
const ITEM_PRICES = {
 veldspar: 2,
 scordite: 4,
 pyroxeres: 7,
 omber: 10,
 debris_t1: 15,
 debris_t2: 30,
 debris_t3: 50,
 debris_t4: 80,
 debris_t5: 120
};

// Ship values. Ships are no longer bought with Scrap Metals: these prices set the
// total value of the building materials each ship needs (see SHIP_RECIPES below).
const SHIP_PRICES = {
 frigate: 0, // Mining Frigate (Free Starter)
 combatfrigate: 25000, // Combat Frigate
 barge: 250000, // Mining Barge
 command: 1500000, // Command Ship
 carrier: 8000000, // Carrier
 capital: 25000000, // Mining Capital
 explorationfrigate: 50000, // Exploration Frigate
 siegecruiser: 1000000, // Siege Cruiser
 siegebattleship: 2300000, // Siege Battleship
 transportcapital: 4000000 // Transport Manager (corp), built in the Shipyard
};

// Share of each ship's value paid by each material (shares add up to 1).
// Recipes are generated from these so total material value = current market price.
const SHIP_RECIPE_WEIGHTS = {
 combatfrigate: { veldspar: 0.3, scordite: 0.4, pyroxeres: 0.3 },
 explorationfrigate: { scordite: 0.3, pyroxeres: 0.3, omber: 0.2, debris_t1: 0.2 },
 barge: { veldspar: 0.2, scordite: 0.2, pyroxeres: 0.3, omber: 0.3 },
 command: { omber: 0.3, debris_t1: 0.2, debris_t2: 0.3, debris_t3: 0.2 },
 siegecruiser: { pyroxeres: 0.2, omber: 0.3, debris_t1: 0.2, debris_t2: 0.3 },
 siegebattleship: { omber: 0.2, debris_t2: 0.3, debris_t3: 0.3, debris_t4: 0.2 },
 transportcapital: { debris_t1: 0.2, debris_t2: 0.3, debris_t3: 0.3, debris_t4: 0.2 },
 carrier: { debris_t2: 0.2, debris_t3: 0.3, debris_t4: 0.3, debris_t5: 0.2 },
 capital: { debris_t3: 0.2, debris_t4: 0.3, debris_t5: 0.5 }
};

// SHIP_RECIPES.command = [['omber', 45000], ['debris_t1', 20000], ...]
const SHIP_RECIPES = {};
(function buildShipRecipes() {
 for (const key of Object.keys(SHIP_RECIPE_WEIGHTS)) {
 const price = SHIP_PRICES[key] || 0;
 const items = Object.keys(SHIP_RECIPE_WEIGHTS[key]);
 const recipe = [];
 let spent = 0;
 items.forEach(function (item, i) {
 const unit = ITEM_PRICES[item];
 let qty;
 if (i < items.length - 1) {
 qty = Math.floor(price * SHIP_RECIPE_WEIGHTS[key][item] / unit);
 spent += qty * unit;
 } else {
 qty = Math.max(1, Math.round((price - spent) / unit)); // last item absorbs the remainder
 }
 recipe.push([item, qty]);
 });
 SHIP_RECIPES[key] = recipe;
 }
})();

class StationMarket {
 constructor(playerDataRef, stationName) {
 this.playerData = playerDataRef;
 this.stationName = stationName;
 }

 priceOf(item) {
 return ITEM_PRICES[item] || 0;
 }

 // Ores and components only. Ships are built in the Shipyard, not bought.
 instantBuy(ore, qty) {
 let item = (ore || '').toLowerCase().trim();
 const unit = ITEM_PRICES[item];
 if (unit === undefined) return { success: false };
 const cost = (qty || 1) * unit;
 if (this.playerData.isk < cost) return { success: false };
 this.playerData.isk -= cost;
 this.playerData.stationOre[item] = (this.playerData.stationOre[item] || 0) + (qty || 1);
 return { success: true };
 }

 instantSell(ore, qty) {
 let item = (ore || '').toLowerCase().trim();
 const unit = ITEM_PRICES[item];
 if (unit === undefined) return { success: false };
 if ((this.playerData.stationOre[item] || 0) < qty) return { success: false };
 this.playerData.stationOre[item] -= qty;
 this.playerData.isk += qty * unit;
 return { success: true };
 }
}
