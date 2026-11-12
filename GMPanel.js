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
      #minispace-gm-status{min-height:34px;margin-top:12px;color:#9bdcc9;line-height:1.4;overflow-wrap:anywhere}\n      #gm-online-pilots{margin-top:8px;padding:8px;background:#081116;border:1px solid #314b52;border-radius:6px;max-height:180px;overflow:auto;font-size:11px}\n      #gm-online-pilots .pilot{padding:6px 0;border-bottom:1px solid #243941;overflow-wrap:anywhere}
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
        <label>Online administration</label>
        <div class="gm-row"><button id="gm-refresh-online">REFRESH PILOTS</button><button id="gm-toggle-invisible">GO INVISIBLE</button></div>
        <div id="gm-online-pilots">Press REFRESH PILOTS to inspect online pilots.</div>
        <label for="gm-target-name">Target pilot callsign</label>
        <input id="gm-target-name" maxlength="24" placeholder="Exact pilot callsign">
        <input id="gm-ban-reason" maxlength="180" placeholder="Ban reason (optional)" style="margin-top:7px">
        <div class="gm-row"><button id="gm-inspect-target">INSPECT</button><button id="gm-ban-target">BAN PILOT</button><button id="gm-unban-target">UNBAN</button></div>
        <div id="gm-target-details" style="margin-top:8px;padding:8px;background:#081116;border:1px solid #314b52;border-radius:6px;max-height:130px;overflow:auto;font-size:11px;white-space:pre-wrap">No pilot selected.</div>
        <label for="gm-scrap-amount">Scrap Metals amount</label>
        <input id="gm-scrap-amount" type="number" min="1" max="1000000000000" value="1000000" inputmode="numeric">
        <div class="gm-row"><button id="gm-give-scrap">GIVE SCRAP METALS</button></div>
        <div class="gm-row"><button id="gm-give-target-isk">GIVE ISK TO PILOT</button><button id="gm-remove-target-isk">REMOVE ISK</button></div>
        <label for="gm-item">Give items to Private High-Sec hangar</label>
        <select id="gm-item"></select>
        <input id="gm-item-amount" type="number" min="1" max="1000000000" value="100" inputmode="numeric" style="margin-top:7px">
        <div class="gm-row"><button id="gm-give-item">GIVE ITEM</button></div>
        <div class="gm-row"><button id="gm-give-target-item">GIVE TO PILOT</button><button id="gm-remove-target-item">REMOVE FROM PILOT</button></div>
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

    const onlineBox=document.getElementById('gm-online-pilots');
    function renderOnlinePilots(pilots){
      onlineBox.replaceChildren();
      if(!pilots.length){onlineBox.textContent='No pilots currently online.';return;}
      pilots.forEach(pilot=>{
        const row=document.createElement('div');row.className='pilot';
        row.textContent=pilot.name+' · '+(pilot.ship||'Unknown ship')+' · '+(pilot.system||pilot.mapId||'Unknown location')+(pilot.invisible?' · INVISIBLE':'');
        onlineBox.appendChild(row);
      });
    }
    window.addEventListener('minispace-gm-online-list',event=>renderOnlinePilots(event.detail||[]));
    window.addEventListener('minispace-gm-invisibility',event=>{
      document.getElementById('gm-toggle-invisible').textContent=event.detail?'BECOME VISIBLE':'GO INVISIBLE';
      status(event.detail?'You are now invisible to other pilots.':'You are visible to other pilots.');
    });
    window.addEventListener('minispace-gm-error',event=>status(event.detail||'GM command failed.'));
    window.addEventListener('minispace-gm-result',event=>status(event.detail||'Command complete.'));
    const targetName=()=>document.getElementById('gm-target-name').value.trim();
    const targetDetails=document.getElementById('gm-target-details');
    document.getElementById('gm-inspect-target').onclick=async()=>{
      if(!targetName())return status('Enter the exact pilot callsign first.');
      try{const info=await window.MINISPACE_GM.inspectPilot(targetName());targetDetails.textContent='PILOT: '+info.pilotName+'\nWALLET: '+Number(info.wallet||0).toLocaleString()+' ISK\\nBAN: '+(info.banned?'YES — '+info.banReason:'No')+'\nHANGARS: '+JSON.stringify(info.hangars||[]);status('Pilot inspection complete.');}
      catch(error){status(error.message||'Could not inspect pilot.');}
    };
    document.getElementById('gm-ban-target').onclick=async()=>{
      if(!targetName())return status('Enter the exact pilot callsign first.');
      if(!confirm('Ban '+targetName()+'? They will be disconnected and blocked from logging in.'))return;
      try{const result=await window.MINISPACE_GM.banPilot(targetName(),document.getElementById('gm-ban-reason').value);window.MinispaceOnline?.send({type:'gm-kick-account',accountId:result.pilotId});status(targetName()+' banned and disconnected if online.');}
      catch(error){status(error.message||'Could not ban pilot.');}
    };
    document.getElementById('gm-unban-target').onclick=async()=>{
      if(!targetName())return status('Enter the exact pilot callsign first.');
      try{await window.MINISPACE_GM.unbanPilot(targetName());status(targetName()+' unbanned.');}
      catch(error){status(error.message||'Could not unban pilot.');}
    };
    document.getElementById('gm-give-target-isk').onclick=async()=>adjustWallet(1);
    document.getElementById('gm-remove-target-isk').onclick=async()=>adjustWallet(-1);
    async function adjustWallet(direction){
      if(!targetName())return status('Enter the exact pilot callsign first.');
      const amount=Number(document.getElementById('gm-scrap-amount').value);
      if(!Number.isSafeInteger(amount)||amount<1)return status('Enter a valid whole-number amount.');
      try{const result=await window.MINISPACE_GM.adjustPilotWallet(targetName(),amount*direction);window.MinispaceOnline?.send({type:'gm-kick-account',accountId:result.pilotId});status('Wallet updated. Pilot will reconnect to load the new balance.');}
      catch(error){status(error.message||'Could not adjust pilot wallet.');}
    }
    document.getElementById('gm-give-target-item').onclick=async()=>adjustItem(1);
    document.getElementById('gm-remove-target-item').onclick=async()=>adjustItem(-1);
    async function adjustItem(direction){
      if(!targetName())return status('Enter the exact pilot callsign first.');
      const amount=Number(document.getElementById('gm-item-amount').value);
      if(!Number.isSafeInteger(amount)||amount<1)return status('Enter a valid whole-number quantity.');
      try{const result=await window.MINISPACE_GM.adjustPilotItem(targetName(),select.value,amount*direction,'private_highsec');window.MinispaceOnline?.send({type:'gm-kick-account',accountId:result.pilotId});status('Hangar updated. Pilot will reconnect to load the new inventory.');}
      catch(error){status(error.message||'Could not adjust pilot hangar.');}
    }
    document.getElementById('gm-refresh-online').onclick=()=>{
      if(!window.MinispaceOnline?.state?.isGM)return status('Server has not verified GM permissions yet.');
      window.MinispaceOnline.send({type:'gm-list-online'});
      status('Refreshing online pilot list…');
    };
    document.getElementById('gm-toggle-invisible').onclick=()=>{
      if(!window.MinispaceOnline?.state?.isGM)return status('Server has not verified GM permissions yet.');
      window.MinispaceOnline.send({type:'gm-toggle-invisible'});
      status('Updating invisibility…');
    };
    document.getElementById('gm-close').onclick = () => { panel.style.display = 'none'; };
    document.getElementById('gm-give-scrap').onclick = async () => {
      const amount = Number(document.getElementById('gm-scrap-amount').value);
      if (!Number.isSafeInteger(amount) || amount < 1) return status('Enter a valid whole-number amount.');
      try {
        await window.MINISPACE_GM.grantScrapMetals(amount);
        status('Scrap Metals added. Reloading your cloud pilot…');
        window.location.reload();
      } catch (error) { status(error.message || 'Could not grant Scrap Metals.'); }
    };
    document.getElementById('gm-give-item').onclick = async () => {
      const amount = Number(document.getElementById('gm-item-amount').value);
      if (!Number.isSafeInteger(amount) || amount < 1) return status('Enter a valid whole-number quantity.');
      try {
        await window.MINISPACE_GM.grantItem(select.value, amount);
        status(labels[select.value] + ' added. Reloading your cloud pilot…');
        window.location.reload();
      } catch (error) { status(error.message || 'Could not grant item.'); }
    };
  }
  window.MINISPACE_AUTH_READY.then(async function () {
    try { if (await window.MINISPACE_GM.isAuthorized()) buildPanel(); }
    catch (error) { console.warn('GM setup migration may be missing:', error); }
  }).catch(function () {});
})();
