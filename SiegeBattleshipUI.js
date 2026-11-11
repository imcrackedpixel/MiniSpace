// SiegeBattleshipUI.js - Hangar hookup for the Siege Battleship.
// The market row comes from MainGameController.js (marketShipRows) and the price from SHIP_PRICES in Market.js.
// Load in Index.html AFTER SiegeCruiserUI.js (it wraps functions that MainGameController.js defines).
(function () {
  const SHIP_NAME = 'Siege Battleship';
  const UNLOCK_KEY = 'siegeBattleship';
  const CARGO = 2000;
  const SPEED = 3.2;

  function isOwned() {
    const u = playerData.unlockedShips;
    return !!(u && u[UNLOCK_KEY]);
  }

  // ---- Hangar: list the ship under COMBAT SHIPS once owned ----
  // The hangar list element is 'items-hanger-list' (as in Index.html and MainGameController.js).
  const origStationUI = window.updateStationUI;
  if (typeof origStationUI === 'function' && !origStationUI._siegeBattleshipUI) {
    window.updateStationUI = function () {
      origStationUI.apply(this, arguments);

      const isCur = !!(playerShip && playerShip.className === SHIP_NAME);
      const owned = isOwned() || isCur ||
        (playerData.shipsOwned && playerData.shipsOwned.indexOf(SHIP_NAME) !== -1);
      if (!owned) return;

      const root = document.getElementById('items-hanger-list');
      if (!root) return;
      for (const d of root.querySelectorAll('details')) {
        const sum = d.querySelector('summary');
        if (!sum || sum.textContent.indexOf('COMBAT SHIPS') !== 0) continue;

        // The hangar already lists this ship (or this hook already added it): do not add a second copy
        if (d.textContent.toUpperCase().indexOf(SHIP_NAME.toUpperCase()) !== -1) break;

        const table = d.querySelector('table');
        if (!table) continue;

        // Drop the "None" placeholder row if the group was empty
        table.querySelectorAll('td[colspan]').forEach(function (td) {
          if (td.parentNode) td.parentNode.remove();
        });

        const action = isCur
          ? '<span style="color:#8b949e;">Aboard</span>'
          : '<button onclick="window.boardShip(\'' + SHIP_NAME + '\', ' + CARGO + ', ' + SPEED + ')">Board</button>';
        table.insertAdjacentHTML('beforeend',
          '<tr><td>' + SHIP_NAME.toUpperCase() + '</td><td>1</td><td>' + action + '</td></tr>');

        sum.textContent = sum.textContent.replace(/\((\d+)\)/, function (m, n) {
          return '(' + (parseInt(n, 10) + 1) + ')';
        });
        break;
      }
    };
    window.updateStationUI._siegeBattleshipUI = true;
  }

  // Refresh the UI once so the new rows show up straight away
  try { window.updateStationUI(); } catch (e) { console.error('SiegeBattleshipUI refresh failed:', e); }
})();
