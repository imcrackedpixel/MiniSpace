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
 combatfrigate: 375000, // Combat Frigate (+50%)
 barge: 3750000, // Mining Barge (+50%)
 command: 18000000, // Command Ship (+50%)
 carrier: 150000000, // Carrier (+50%)
 capital: 375000000, // Mining Capital (+50%)
 explorationfrigate: 750000, // Exploration Frigate (+50%)
 siegecruiser: 12000000, // Siege Cruiser (+50%)
 siegebattleship: 52500000, // Siege Battleship (+50%)
 transportcapital: 30000000 // Transport Manager (corp), built in the Shipyard (+50%)
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
