/* MiniSpace GM panel - rendered only after the database confirms GM access. */
(function () {
  'use strict';
  const labels = {
    veldspar: 'Copper', scordite: 'Steel', pyroxeres: 'Titanium', omber: 'Gold',
    debris_t1: 'Resistor', debris_t2: 'Capacitor', debris_t3: 'Circuit Board',
    debris_t4: 'Microchip', debris_t5: 'Processor'
  };
  function buildPanel() {
    if (document.getElementById('minispace-gm-button')) return;
    const style = document.createElement('style');
    style.textContent = `
      #minispace-gm-button{position:fixed;right:12px;top:76px;z-index:100020;background:#174d49;color:#b9fff0;border:1px solid #42d6b5;border-radius:7px;padding:8px 13px;font:bold 12px monospace;box-shadow:0 3px 12px #0009}
      #minispace-gm-panel{position:fixed;inset:0;z-index:100021;background:#000b;display:flex;align-items:center;justify-content:center;padding:14px;font:13px monospace;color:#e6f4f1}
      #minispace-gm-card{width:100%;max-width:360px;max-height:85vh;overflow:auto;background:#101c22;border:1px solid #42d6b5;border-radius:10px;padding:16px;box-shadow:0 12px 35px #000}
      #minispace-gm-card h2{margin:0 0 14px;color:#75e8cd;letter-spacing:2px}
      #minispace-gm-card label{display:block;margin:12px 0 5px;color:#b4c9c8}
      #minispace-gm-card input,#minispace-gm-card select{box-sizing:border-box;width:100%;padding:10px;background:#071116;color:#fff;border:1px solid #45636a;border-radius:5px;font:14px monospace}
      #minispace-gm-card button{padding:9px 12px;border:1px solid #438f80;border-radius:5px;background:#174d49;color:#eafffa;font:bold 12px monospace}
      #minispace-gm-card .gm-row{display:flex;gap:8px;margin-top:12px}
      #minispace-gm-card .gm-row button{flex:1}
      #minispace-gm-status{min-height:34px;margin-top:12px;color:#9bdcc9;line-height:1.4;overflow-wrap:anywhere}
    `;
    document.head.appendChild(style);
    const button = document.createElement('button');
    button.id = 'minispace-gm-button';
    button.textContent = 'GM';
    button.onclick = () => { const p = document.getElementById('minispace-gm-panel'); if (p) p.style.display = 'flex'; };
    document.body.appendChild(button);
    const panel = document.createElement('div');
    panel.id = 'minispace-gm-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div id="minispace-gm-card">
        <h2>GAME MASTER</h2>
        <div style="color:#9bb4b6">Account-verified administration tools</div>
        <label for="gm-scrap-amount">Give yourself Scrap Metals</label>
        <input id="gm-scrap-amount" type="number" min="1" max="1000000000000" value="1000000" inputmode="numeric">
        <div class="gm-row"><button id="gm-give-scrap">GIVE SCRAP METALS</button></div>
        <label for="gm-item">Give items to Private High-Sec hangar</label>
        <select id="gm-item"></select>
        <input id="gm-item-amount" type="number" min="1" max="1000000000" value="100" inputmode="numeric" style="margin-top:7px">
        <div class="gm-row"><button id="gm-give-item">GIVE ITEM</button></div>
        <div id="minispace-gm-status" role="status"></div>
        <div class="gm-row"><button id="gm-close" style="background:#26343a">CLOSE</button></div>
      </div>`;
    document.body.appendChild(panel);
    const select = document.getElementById('gm-item');
    Object.keys(labels).forEach(key => {
      const option = document.createElement('option');
      option.value = key; option.textContent = labels[key]; select.appendChild(option);
    });
    const status = message => { document.getElementById('minispace-gm-status').textContent = message; };
    document.getElementById('gm-close').onclick = () => { panel.style.display = 'none'; };
    document.getElementById('gm-give-scrap').onclick = async () => {
      const amount = Number(document.getElementById('gm-scrap-amount').value);
      if (!Number.isSafeInteger(amount) || amount < 1) return status('Enter a valid whole-number amount.');
      try {
        await window.MINISPACE_GM.grantScrapMetals(amount);
        status('Scrap Metals added. Refreshing wallet…');
        await window.MINISPACE_MARKET?.refresh?.();
      } catch (error) { status(error.message || 'Could not grant Scrap Metals.'); }
    };
    document.getElementById('gm-give-item').onclick = async () => {
      const amount = Number(document.getElementById('gm-item-amount').value);
      if (!Number.isSafeInteger(amount) || amount < 1) return status('Enter a valid whole-number quantity.');
      try {
        await window.MINISPACE_GM.grantItem(select.value, amount);
        status(labels[select.value] + ' added to your Private High-Sec hangar.');
        await window.MINISPACE_MARKET?.refresh?.();
      } catch (error) { status(error.message || 'Could not grant item.'); }
    };
  }
  window.MINISPACE_AUTH_READY.then(async function () {
    try { if (await window.MINISPACE_GM.isAuthorized()) buildPanel(); }
    catch (error) { console.warn('GM setup migration may be missing:', error); }
  }).catch(function () {});
})();
