# MiniSpace Supabase setup

MiniSpace uses Supabase Auth and authenticated database functions for pilot wallets, separate hangars, and the shared Trade Hub market. The browser uses the public publishable/anon key with the signed-in pilot session. **Never put a Supabase service-role key in browser code, GitHub, chat, or the public game page.**

## Database setup order

Run each SQL file once in Supabase → SQL Editor, in this order:

1. `market.sql` — base wallet, inventory, market, and transaction tables.
2. `pilot_saves.sql` — cloud pilot save storage.
3. `market_pool.sql` — pooled player stock, dynamic prices, and the small NPC starter buffer.
4. `market_hangars.sql` — separate Private High-Sec and Trade Hub hangars.
5. `market_game_sync.sql` — one-time bootstrap and ongoing sync between the game wallet/private hangar and the secure market records.
6. `market_transfer_to_private.sql` — allows bought Trade Hub goods to be moved back to Private High-Sec for shipbuilding.
7. `market_corp_supply.sql` — allows the Corporation Transport Manager to add its full shipments to shared market stock. Shipment IDs make retries safe and prevent duplicate stock.
8. `market_transport_sales.sql` — supports player-initiated Transport Manager sales from the Private High-Sec hangar, including the 10% commission. Run after `market_corp_supply.sql`.
9. `gm_setup.sql` — optional GM permissions. Run this before the next file if you want the GM panel enabled.
10. `gm_admin_commands.sql` — optional GM inspect, ban/unban, wallet and item adjustment commands. Run after `gm_setup.sql`.

Do not skip ahead or rerun older migrations to fix a newer feature. Each migration is designed to be additive or replace its own RPC functions.

## How the economy works

- Private High-Sec and Trade Hub use separate hangars.
- Market purchases arrive in the Trade Hub hangar.
- Move goods to Private High-Sec before using them in ship recipes.
- Market sales use Trade Hub goods only.
- The market uses one pooled stock and one current price per item, not individual tiny fixed-price orders.
- NPC liquidity provides a small starter buffer of 10 units per item. Further NPC supply is capped at 10% of player-supplied market volume.
- The Corporation Transport Manager loads only goods from the corporation hangar at Private High-Sec. It waits for a full cargo, travels to the Trade Hub, adds the shipment to shared player stock, credits the corporation wallet, and returns.
- Corporation shipment deposits are idempotent: a retry of the same shipment cannot add the stock twice.

## Security notes

- Market and GM actions are authenticated RPCs that use `auth.uid()` to identify the pilot.
- Browser clients do not receive or use the service-role key.
- GM access is checked against the private `minispace_gm_accounts` table; hiding the GM button is not the security boundary.
- **Economy trust limitation:** the current game still sends browser-side wallet/private-hangar snapshots through `market_sync_game_state`, and corporation cargo originates in the browser save. Authenticated users can tamper with those client-supplied values. The pooled market stores balances and stock in the database, but this is not yet a full anti-cheat economy. Before competitive/public launch, progression rewards, build costs, corp storage, and shipment cargo need to be written or verified by a trusted server.
- The WebSocket multiplayer service is separate from the Supabase market and save functions.
