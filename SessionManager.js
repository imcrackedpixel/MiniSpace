// SessionManager.js - Manages saving and loading game sessions across all ships and progression
class SessionManager {
  constructor() {}

  load(playerData, botManager, playerShip) {
    try {
      const savedData = localStorage.getItem('minispace_save');
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (parsed.playerData) {
          Object.assign(playerData, parsed.playerData);
          if (!playerData.stationOre) playerData.stationOre = {};
          ['veldspar', 'scordite', 'pyroxeres', 'omber', 'debris_t1', 'debris_t2', 'debris_t3', 'debris_t4', 'debris_t5'].forEach(k => {
            if (playerData.stationOre[k] === undefined) playerData.stationOre[k] = 0;
          });

          if (botManager) {
            botManager.bots = [];
            // Older saves could contain duplicate miners. Keep at most five hired
            // mining ships, while preserving separate explorer/transport specialists.
            playerData.corpMembersPurchased = Math.max(0, Math.min(5, Number(playerData.corpMembersPurchased) || 0));
            if (Array.isArray(playerData.corpBots) && playerData.corpBots.length) {
              const savedBots = playerData.corpBots;
              const selectedBots = [];
              let minerCount = 0;
              for (const bot of savedBots) {
                if (!bot || !bot.className) continue;
                const cls = String(bot.className).toLowerCase();
                const specialist = cls.includes('explor') || cls.includes('transport') || cls.includes('hauler') || cls.includes('freighter');
                if (!specialist) {
                  if (minerCount >= 5) continue;
                  minerCount++;
                }
                selectedBots.push(bot);
              }
              playerData.corpBots = selectedBots;
              botManager.restoreBots(selectedBots);
            } else {
              for (let i = 0; i < playerData.corpMembersPurchased; i++) {
                botManager.addBot('Mining Frigate');
              }
              if (playerData.explorationCorpPurchased > 0 && typeof botManager.addExplorationBot === 'function') {
                botManager.addExplorationBot();
              }
            }
            if ((playerData.transportManagerPurchased || 0) > 0 && typeof botManager.addTransportBot === 'function') {
              const hasTransport = botManager.bots.some(b =>
                b.className === 'Transport Capital' ||
                b.className === 'Industrial Hauler' ||
                b.className === 'Freighter');
              if (!hasTransport) botManager.addTransportBot();
            }
          }
        }
        if (parsed.pilotName && document.getElementById('pilot-name-input')) {
          document.getElementById('pilot-name-input').value = parsed.pilotName;
        }
        if (parsed.className && playerShip) {
          const restored = this.setShipClass(playerShip, parsed.className, parsed.maxCargo || 200, parsed.maxSpeed || 3.4);
          
          // Restore upgrades for this specific ship from playerData.upgrades or fallback
          const savedMods = (playerData.upgrades && playerData.upgrades[parsed.className]) || parsed.shipModules;
          if (savedMods && restored.moduleLevels) {
            for (let m in restored.moduleLevels) {
              if (savedMods[m] !== undefined) restored.moduleLevels[m] = savedMods[m];
            }
            if (typeof restored.applyStats === 'function') restored.applyStats();
          }
          restored.cargo = Math.max(0, Number(parsed.playerCargo) || 0);
          restored.oreType = parsed.playerOreType || restored.oreType || 'veldspar';
          restored.cargoByOre = parsed.playerCargoByOre && typeof parsed.playerCargoByOre === 'object'
            ? Object.assign({}, parsed.playerCargoByOre) : null;
          return restored;
        }
      }
    } catch (e) {
      console.error('Failed to load save:', e);
    }
    return playerShip;
  }

  save(playerData, playerShip) {
    try {
      if (playerShip && playerShip.moduleLevels) {
        if (!playerData.upgrades) playerData.upgrades = {};
        playerData.upgrades[playerShip.className] = Object.assign({}, playerShip.moduleLevels);
      }
      const saveData = {
        playerData: playerData,
        pilotName: playerData.pilotName,
        className: playerShip ? playerShip.className : null,
        maxCargo: playerShip ? playerShip.maxCargo : null,
        maxSpeed: playerShip ? playerShip.maxSpeed : null,
        playerCargo: playerShip ? (playerShip.cargo || 0) : 0,
        playerOreType: playerShip ? (playerShip.oreType || 'veldspar') : null,
        playerCargoByOre: playerShip ? Object.assign({}, (window.ensureOreCargo ? window.ensureOreCargo(playerShip) : playerShip.cargoByOre) || {}) : {}
      };
      localStorage.setItem('minispace_save', JSON.stringify(saveData));
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }

  setShipClass(playerShip, className, cargoCap, maxSpeed) {
    if (!playerShip) return playerShip;
    let x = playerShip.x;
    let y = playerShip.y;
    let vx = playerShip.vx;
    let vy = playerShip.vy;
    let angle = playerShip.angle;
    let docked = playerShip.docked;

    let nameClean = (className || '').trim();
    let nameLower = nameClean.toLowerCase();
    let mods = playerShip.moduleLevels ? {...playerShip.moduleLevels} : null;
    let newShip = null;

    try {
      if (nameLower === 'siege cruiser') {
        newShip = new SiegeCruiserShip(x, y);
      } else if (nameLower === 'siege capital') {
        newShip = new SiegeCapitalShip(x, y);
      } else if (nameLower === 'carrier' || nameLower.includes('carrier')) {
        newShip = typeof Carrier !== 'undefined' ? new Carrier(x, y) : new MiningFrigate(x, y);
      } else if (nameLower === 'mining capital' || nameLower === 'capital ship' || nameLower.includes('capital')) {
        newShip = new CapitalShip(x, y);
      } else if (nameLower.includes('barge')) {
        newShip = new MiningBarge(x, y);
      } else if (nameLower.includes('command')) {
        newShip = new CommandShip(x, y);
      } else if (nameLower.includes('combat')) {
        newShip = new CombatFrigate(x, y);
      } else if (nameLower === 'improved explorer frigate') {
        newShip = new ExplorationFrigate(x, y, true);
      } else if (nameLower === 'explorer cruiser') {
        newShip = new ExplorerCruiser(x, y);
      } else if (nameLower.includes('exploration')) {
        newShip = new ExplorationFrigate(x, y);
      } else {
        newShip = new MiningFrigate(x, y);
      }
    } catch (err) {
      console.error('Error instantiating ship class:', err);
    }

    if (!newShip) {
      newShip = new MiningFrigate(x, y);
    }

    if (mods && newShip.moduleLevels) {
      for (let m in newShip.moduleLevels) {
        if (mods[m] !== undefined) newShip.moduleLevels[m] = mods[m];
      }
    }

    newShip.x = x;
    newShip.y = y;
    newShip.vx = vx;
    newShip.vy = vy;
    newShip.angle = angle;
    newShip.docked = docked;
    newShip.className = nameClean;
    newShip.maxCargo = cargoCap;
    newShip.maxSpeed = maxSpeed;
    if (typeof newShip.applyStats === 'function') newShip.applyStats();

    return newShip;
  }
}
