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

## What the schema provides

- One shared stock and unit price for each material across all pilots.
- Server/database-side wallet and inventory records.
- Atomic buy and sell transactions, so two pilots cannot spend the same stock or ISK at once.
- A transaction history.
- New authenticated pilots receive a starter wallet of 1,000,000 ISK.

## Important integration note

The current game stores pilot ISK and hangar inventory in browser save data, and its WebSocket server does not yet authenticate pilots. The SQL schema is deliberately not wired to the live market until the next integration step moves pilot identity, wallet, inventory imports, and market actions behind the online server. This avoids pretending that local browser balances are secure or that the market is already shared.

The corporation bot supply cap (5–10%) will be enforced by the trusted server integration, not by a browser setting.
