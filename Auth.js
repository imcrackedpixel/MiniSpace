/* MiniSpace email/password accounts and cloud pilot saves. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://fatejbbzgfeeebzkgcao.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_zfoeW5SNimEZynC-bobT4g_5sGyOtfX';
  const SESSION_KEY = 'minispace_auth_session';
  let session = null;
  let resolveReady;
  let rejectReady;
  let readySettled = false;

  window.MINISPACE_AUTH_READY = new Promise(function (resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function api(path, options) {
    options = options || {};
    const headers = Object.assign({
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, options.headers || {});
    if (session && session.access_token) {
      headers.Authorization = 'Bearer ' + session.access_token;
    } else {
      headers.Authorization = 'Bearer ' + SUPABASE_KEY;
    }
    return fetch(SUPABASE_URL + path, Object.assign({}, options, { headers: headers }))
      .then(async function (response) {
        const body = await response.text();
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (e) {}
        if (!response.ok) {
          throw new Error(data.msg || data.message || data.error_description || data.error || 'Account request failed (' + response.status + ')');
        }
        return data;
      });
  }

  function storeSession(value) {
    session = value;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch (e) {}
  }

  function getSavedSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return value && value.access_token ? value : null;
    } catch (e) { return null; }
  }

  function showMessage(message, isError) {
    const el = document.getElementById('minispace-auth-message');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#e58b83' : '#8bd5b5';
  }

  function createGate() {
    let gate = document.getElementById('minispace-auth-gate');
    if (gate) return gate;
    gate = document.createElement('div');
    gate.id = 'minispace-auth-gate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(5,9,13,.97);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Courier New,monospace;color:#dfe7ea;';
    gate.innerHTML =
      '<div style="width:100%;max-width:380px;background:#121a20;border:1px solid #42606b;border-radius:8px;padding:22px;box-shadow:0 12px 40px #000;">' +
        '<div style="font-size:20px;font-weight:bold;color:#8aa8b3;text-align:center;letter-spacing:2px;">MINISPACE</div>' +
        '<div style="font-size:10px;color:#9aaab1;text-align:center;margin:6px 0 18px;">PILOT ACCOUNT ACCESS</div>' +
        '<label for="minispace-auth-email" style="display:block;font-size:11px;margin:10px 0 5px;">EMAIL ADDRESS</label>' +
        '<input id="minispace-auth-email" type="email" autocomplete="email" placeholder="pilot@example.com" style="box-sizing:border-box;width:100%;padding:11px;background:#080d12;color:#fff;border:1px solid #40535c;border-radius:4px;font:14px monospace;">' +
        '<label for="minispace-auth-password" style="display:block;font-size:11px;margin:12px 0 5px;">PASSWORD</label>' +
        '<input id="minispace-auth-password" type="password" autocomplete="current-password" placeholder="At least 8 characters" style="box-sizing:border-box;width:100%;padding:11px;background:#080d12;color:#fff;border:1px solid #40535c;border-radius:4px;font:14px monospace;">' +
        '<button id="minispace-auth-login" style="width:100%;margin-top:16px;padding:11px;background:#28515b;color:#fff;border:1px solid #527984;border-radius:4px;font-weight:bold;">LOG IN</button>' +
        '<button id="minispace-auth-signup" style="width:100%;margin-top:8px;padding:11px;background:#17272e;color:#b9d3db;border:1px solid #40535c;border-radius:4px;">CREATE ACCOUNT</button>' +
        '<div id="minispace-auth-message" role="status" style="min-height:34px;margin-top:12px;font-size:11px;line-height:1.5;text-align:center;color:#9aaab1;">Log in or create an account to enter space.</div>' +
      '</div>';
    document.body.appendChild(gate);

    const email = document.getElementById('minispace-auth-email');
    const password = document.getElementById('minispace-auth-password');

    async function submit(mode) {
      const address = email.value.trim().toLowerCase();
      const secret = password.value;
      if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        showMessage('Enter a valid email address.', true);
        email.focus();
        return;
      }
      if (secret.length < 8) {
        showMessage('Password must be at least 8 characters.', true);
        password.focus();
        return;
      }
      const buttons = [
        document.getElementById('minispace-auth-login'),
        document.getElementById('minispace-auth-signup')
      ];
      buttons.forEach(function (button) { button.disabled = true; });
      showMessage(mode === 'signup' ? 'Creating your pilot account…' : 'Logging in…', false);
      try {
        let result;
        if (mode === 'signup') {
          result = await fetch(SUPABASE_URL + '/auth/v1/signup', {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: address, password: secret })
          }).then(async function (response) {
            const data = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Could not create account.');
            return data;
          });
          if (!result.access_token) {
            showMessage('Account created. Check your email for the confirmation link, then log in here.', false);
            return;
          }
        } else {
          result = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: address, password: secret })
          }).then(async function (response) {
            const data = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Login failed. Check your email and password.');
            return data;
          });
        }
        storeSession(result);
        await loadCloudSave();
        showMessage('Account ready. Loading your pilot…', false);
        finishReady();
      } catch (error) {
        showMessage(error.message || 'Account request failed.', true);
      } finally {
        buttons.forEach(function (button) { button.disabled = false; });
      }
    }

    document.getElementById('minispace-auth-login').addEventListener('click', function () { submit('login'); });
    document.getElementById('minispace-auth-signup').addEventListener('click', function () { submit('signup'); });
    password.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') submit('login');
    });
    return gate;
  }

  // Authenticated bridge to the pooled market and separate station hangars.
  // The browser can call only user-scoped RPCs; it never receives the service-role key.
  let marketState = { wallet: null, hangars: [], items: [], gameStateSynced: false };
  let marketReadyPromise = null;
  let marketQueue = Promise.resolve();

  function queueMarketTask(task) {
    const next = marketQueue.then(task, task);
    marketQueue = next.catch(function () {});
    return next;
  }

  async function refreshMarketState() {
    if (!session || !session.user || !session.user.id) throw new Error('Pilot login required');
    const pilotId = encodeURIComponent(session.user.id);
    const results = await Promise.all([
      api('/rest/v1/pilot_wallets?select=isk,legacy_imported,game_state_synced&pilot_id=eq.' + pilotId, { method: 'GET' })
        .catch(function () {
          return api('/rest/v1/pilot_wallets?select=isk,legacy_imported&pilot_id=eq.' + pilotId, { method: 'GET' });
        }),
      api('/rest/v1/pilot_hangars?select=station_id,item_key,quantity&pilot_id=eq.' + pilotId + '&order=station_id,item_key', { method: 'GET' }),
      api('/rest/v1/market_items?select=item_key,display_name,unit_price,stock,player_stock,npc_stock&order=item_key', { method: 'GET' })
    ]);
    const wallet = Array.isArray(results[0]) && results[0][0] ? results[0][0] : null;
    marketState = {
      wallet: wallet,
      hangars: Array.isArray(results[1]) ? results[1] : [],
      items: Array.isArray(results[2]) ? results[2] : [],
      gameStateSynced: !!(wallet && wallet.game_state_synced)
    };
    return JSON.parse(JSON.stringify(marketState));
  }

  async function initializeMarketBridge() {
    if (marketReadyPromise) return marketReadyPromise;
    marketReadyPromise = (async function () {
      // One-time import of a real existing pilot save. New accounts with no save
      // keep the starter wallet created by the database trigger.
      const raw = localStorage.getItem('minispace_save');
      let bootstrappedFromSave = false;
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          const data = saved && saved.playerData;
          if (data && data.pilotName && Number.isFinite(Number(data.isk)) &&
              data.stationOre && typeof data.stationOre === 'object') {
            const walletRows = await api('/rest/v1/pilot_wallets?select=legacy_imported&pilot_id=eq.' +
              encodeURIComponent(session.user.id), { method: 'GET' });
            if (Array.isArray(walletRows) && walletRows[0] && !walletRows[0].legacy_imported) {
              await api('/rest/v1/rpc/market_import_legacy_save', {
                method: 'POST',
                body: JSON.stringify({
                  p_isk: Math.max(0, Math.floor(Number(data.isk))),
                  p_inventory: data.stationOre
                })
              });
            }

            // Migrate the latest cloud save into the shared economy exactly once.
            // If the SQL migration is not installed yet, leave the local game alone.
            try {
              await api('/rest/v1/rpc/market_sync_game_state', {
                method: 'POST',
                body: JSON.stringify({
                  p_isk: Math.max(0, Math.floor(Number(data.isk))),
                  p_inventory: data.stationOre,
                  p_bootstrap: true
                })
              });
              bootstrappedFromSave = true;
            } catch (syncError) {
              console.warn('Game economy sync needs the market_game_sync SQL migration:', syncError.message || syncError);
            }
          }
        } catch (error) {
          console.warn('Legacy market import will need retry:', error.message || error);
        }
      }
      if (!bootstrappedFromSave) {
        // No established local pilot save: preserve the database starter wallet.
        try {
          await api('/rest/v1/rpc/market_sync_game_state', {
            method: 'POST',
            body: JSON.stringify({
              p_isk: null,
              p_inventory: null,
              p_bootstrap: true
            })
          });
        } catch (syncError) {
          console.warn('Game economy sync needs the market_game_sync SQL migration:', syncError.message || syncError);
        }
      }
      return refreshMarketState();
    })();
    try { return await marketReadyPromise; }
    catch (error) { marketReadyPromise = null; throw error; }
  }

  window.MINISPACE_MARKET = {
    ready: function () { return initializeMarketBridge(); },
    refresh: refreshMarketState,
    state: function () { return JSON.parse(JSON.stringify(marketState)); },
    applyToGame: function (gameData) {
      if (!gameData || !marketState.gameStateSynced || !marketState.wallet) return false;
      gameData.isk = Math.max(0, Number(marketState.wallet.isk) || 0);
      if (!gameData.stationOre || typeof gameData.stationOre !== 'object') gameData.stationOre = {};
      const keys = ['veldspar','scordite','pyroxeres','omber','debris_t1','debris_t2','debris_t3','debris_t4','debris_t5'];
      keys.forEach(function (key) {
        const row = marketState.hangars.find(function (item) {
          return item.station_id === 'private_highsec' && item.item_key === key;
        });
        gameData.stationOre[key] = row ? Math.max(0, Number(row.quantity) || 0) : 0;
      });
      return true;
    },
    syncGameState: function (isk, inventory) {
      return queueMarketTask(async function () {
        await initializeMarketBridge();
        const result = await api('/rest/v1/rpc/market_sync_game_state', {
          method: 'POST',
          body: JSON.stringify({
            p_isk: Math.max(0, Math.floor(Number(isk) || 0)),
            p_inventory: inventory && typeof inventory === 'object' ? inventory : {},
            p_bootstrap: false
          })
        });
        await refreshMarketState();
        return result;
      });
    },
    buy: function (itemKey, quantity) {
      return queueMarketTask(async function () {
        await initializeMarketBridge();
        if (!marketState.gameStateSynced) throw new Error('Game economy sync is not ready. Install supabase/market_game_sync.sql first.');
        const result = await api('/rest/v1/rpc/market_buy', {
          method: 'POST',
          body: JSON.stringify({ p_item_key: itemKey, p_quantity: Math.floor(Number(quantity)) })
        });
        await refreshMarketState();
        return result;
      });
    },
    sell: function (itemKey, quantity) {
      return queueMarketTask(async function () {
        await initializeMarketBridge();
        if (!marketState.gameStateSynced) throw new Error('Game economy sync is not ready. Install supabase/market_game_sync.sql first.');
        const result = await api('/rest/v1/rpc/market_sell', {
          method: 'POST',
          body: JSON.stringify({ p_item_key: itemKey, p_quantity: Math.floor(Number(quantity)) })
        });
        await refreshMarketState();
        return result;
      });
    },
    transfer: function (itemKey, quantity) {
      return queueMarketTask(async function () {
        await initializeMarketBridge();
        if (!marketState.gameStateSynced) throw new Error('Game economy sync is not ready. Install supabase/market_game_sync.sql first.');
        const result = await api('/rest/v1/rpc/market_transfer_to_trade', {
          method: 'POST',
          body: JSON.stringify({ p_item_key: itemKey, p_quantity: Math.floor(Number(quantity)) })
        });
        await refreshMarketState();
        return result;
      });
    },
    transferToPrivate: function (itemKey, quantity) {
      return queueMarketTask(async function () {
        await initializeMarketBridge();
        if (!marketState.gameStateSynced) throw new Error('Game economy sync is not ready.');
        const result = await api('/rest/v1/rpc/market_transfer_to_private', {
          method: 'POST',
          body: JSON.stringify({ p_item_key: itemKey, p_quantity: Math.floor(Number(quantity)) })
        });
        await refreshMarketState();
        return result;
      });
    }
  };

  // Secure GM tools. The database verifies the signed-in pilot against the private GM table.
  window.MINISPACE_GM = {
    isAuthorized: async function () {
      if (!session || !session.user || !session.user.id) return false;
      return api('/rest/v1/rpc/gm_is_authorized', { method: 'POST', body: '{}' });
    },
    grantScrapMetals: async function (amount) {
      if (!session || !session.user || !session.user.id) throw new Error('Pilot login required');
      return api('/rest/v1/rpc/gm_grant_scrap_metals', {
        method: 'POST',
        body: JSON.stringify({ p_amount: Math.floor(Number(amount)) })
      });
    },
    grantItem: async function (itemKey, quantity) {
      if (!session || !session.user || !session.user.id) throw new Error('Pilot login required');
      return api('/rest/v1/rpc/gm_grant_item', {
        method: 'POST',
        body: JSON.stringify({ p_item_key: itemKey, p_quantity: Math.floor(Number(quantity)) })
      });
    }
  };

  async function loadCloudSave() {
    if (!session || !session.user || !session.user.id) return;
    const rows = await api('/rest/v1/pilot_saves?select=save_data&pilot_id=eq.' + encodeURIComponent(session.user.id), {
      method: 'GET'
    });
    if (Array.isArray(rows) && rows.length && rows[0].save_data) {
      localStorage.setItem('minispace_save', JSON.stringify(rows[0].save_data));
    } else {
      // First login on this browser: preserve and upload the existing local pilot save.
      const local = localStorage.getItem('minispace_save');
      if (local) {
        try {
          const saveData = JSON.parse(local);
          await api('/rest/v1/pilot_saves?on_conflict=pilot_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ pilot_id: session.user.id, save_data: saveData })
          });
        } catch (error) {
          console.warn('Could not upload the first local pilot save:', error.message || error);
        }
      }
    }
    await initializeMarketBridge();
  }

  let saveTimer = null;
  window.MINISPACE_SAVE_CLOUD = function () {
    if (!session || !session.user || !session.user.id) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      try {
        const raw = localStorage.getItem('minispace_save');
        if (!raw) return;
        const saveData = JSON.parse(raw);
        if (saveData && saveData.playerData) {
          try {
            await window.MINISPACE_MARKET.syncGameState(
              saveData.playerData.isk,
              saveData.playerData.stationOre
            );
          } catch (syncError) {
            console.warn('Game economy sync failed; cloud save will still be kept:', syncError.message || syncError);
          }
        }
        await api('/rest/v1/pilot_saves?on_conflict=pilot_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ pilot_id: session.user.id, save_data: saveData })
        });
      } catch (error) {
        console.warn('Cloud pilot save failed:', error.message || error);
      }
    }, 1200);
  };

  function finishReady() {
    if (readySettled) return;
    readySettled = true;
    const gate = document.getElementById('minispace-auth-gate');
    if (gate) gate.remove();
    resolveReady(true);
  }

  async function boot() {
    createGate();
    session = getSavedSession();
    if (session && session.refresh_token) {
      try {
        if (!session.expires_at || session.expires_at * 1000 < Date.now() + 60000) {
          const refreshed = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: session.refresh_token })
          }).then(async function (response) {
            const data = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(data.message || 'Session expired');
            return data;
          });
          storeSession(refreshed);
        }
        if (!session.user || !session.user.id) {
          session = await api('/auth/v1/user', { method: 'GET' });
        }
        await loadCloudSave();
        finishReady();
      } catch (error) {
        session = null;
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        showMessage('Please log in again. ' + (error.message || ''), true);
      }
    } else {
      showMessage('Log in or create an account to enter space.', false);
    }
  }

  boot().catch(function (error) {
    showMessage('Account setup error: ' + (error.message || error), true);
    rejectReady(error);
  });
})();