
# Minispace Online — first multiplayer foundation

This build adds a WebSocket-based shared-universe presence/chat foundation and a standalone Node.js server.

## Run locally
1. Install Node.js 18+.
2. In `Minispace/server`, run `npm install`.
3. Run `npm start` (default port 8080).
4. Serve the `Minispace` folder over HTTP (not `file://`).
5. Before `OnlineClient.js` loads, set `window.MINISPACE_SERVER_URL = "ws://localhost:8080"`; use `wss://` for a deployed HTTPS game.

## Included in this milestone
- Shared connected-player roster and position updates.
- Global/local/fleet chat channel plumbing.
- Friend request and acceptance message plumbing.
- Server-defined high-sec safe area and low-sec/frontier PvP zone classification.

## Important limits before public launch
This is a development scaffold, not a production MMO backend. Friend relationships and player state are currently in memory and reset when the server restarts. Chat channel access is not yet permission-enforced; fleet membership, persistent accounts/database, authentication, server-authoritative movement/combat, anti-cheat, rate limits, moderation/reporting, and production hosting/TLS still need implementation. PvP zone labels are server-side classifications only; weapon damage and ship destruction must be moved to the server before enabling real PvP.
