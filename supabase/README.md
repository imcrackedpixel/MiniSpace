# MiniSpace shared market — Supabase setup

This is the persistent database foundation for the shared Trade Hub market.

## Before connecting the game

1. Create a Supabase project at https://supabase.com/dashboard.
2. In the project, open **SQL Editor**, create a new query, paste all of `market.sql`, and run it.
3. In **Authentication → Providers**, make sure the Email provider or Anonymous Sign-ins are enabled. MiniSpace account integration will be connected in the next code step.
4. In **Project Settings → API**, copy the Project URL and the **service_role** key. Never put the service-role key in browser code, GitHub, chat, or the public game page.
5. Add the URL and service-role key as private environment variables on the Render service that runs `server.js`. Use names:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

Do not add these values to `index.html`, `OnlineClient.js`, or any committed file.

## Pooled market upgrade

After running `market.sql` and `pilot_saves.sql`, run all of `market_pool.sql` in a new SQL Editor query. This upgrades the starter market to a pooled shared-stock model:

- Player sales add goods to shared stock and player market volume.
- Buyers purchase from one shared pool; the interface can show one quote per material instead of individual tiny listings.
- Prices move with available stock, bounded between 50% and 150% of each material's baseline.
- NPC liquidity starts with a small 10-unit buffer per material. Further NPC supply is capped at 10% of player-supplied market volume.
- A one-time authenticated import function moves the old pilot wallet and private hangar quantities into the secure market wallet/inventory. The game client will call this during the integration step.

Do not delete or rerun the original tables manually. The upgrade is additive and replaces the market buy/sell RPCs.

## What the schema provides

- One shared stock and unit price for each material across all pilots.
- Server/database-side wallet and inventory records.
- Atomic buy and sell transactions, so two pilots cannot spend the same stock or ISK at once.
- A transaction history.
- New authenticated pilots receive a starter wallet of 1,000,000 ISK.

## Important integration note

The current game stores pilot ISK and hangar inventory in browser save data, and its WebSocket server does not yet authenticate pilots. The SQL schema is deliberately not wired to the live market until the next integration step moves pilot identity, wallet, inventory imports, and market actions behind the online server. This avoids pretending that local browser balances are secure or that the market is already shared.

The corporation bot supply cap (5–10%) will be enforced by the trusted server integration, not by a browser setting.


## Separate hangars upgrade

After `market_pool.sql` succeeds, run `market_hangars.sql` in a new SQL Editor query. This creates separate database storage for:

- `private_highsec`: the pilot's private High-Sec station hangar.
- `trade_hub`: goods bought from or transferred to the shared Trade Hub.

The legacy-save import writes existing goods to the private hangar. Market purchases go into the Trade Hub hangar, market sales can only use Trade Hub goods, and `market_transfer_to_trade` moves goods between the two without changing the wallet. The game UI still needs its next integration change before these actions are available in-game.
