
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const MAX_PUBLIC_PLAYERS = 20;
const RECONNECT_GRACE_MS = 60000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fatejbbzgfeeebzkgcao.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_zfoeW5SNimEZynC-bobT4g_5sGyOtfX';

async function verifyPilotToken(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 40 || accessToken.length > 5000) return null;
  try {
    const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken }
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user || typeof user.id !== 'string') return null;
    let isGM = false;
    try {
      const gmResponse = await fetch(SUPABASE_URL + '/rest/v1/rpc/gm_is_authorized', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (gmResponse.ok) isGM = (await gmResponse.json()) === true;
    } catch (error) {
      console.warn('GM permission check unavailable:', error.message || error);
    }
    let banned = false;
    let banReason = '';
    try {
      const statusResponse = await fetch(SUPABASE_URL + '/rest/v1/rpc/gm_admin_account_status', {
        method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:'{}'
      });
      if(statusResponse.ok){const status=await statusResponse.json();banned=!!(status&&status.banned);banReason=String(status&&status.reason||'');}
    } catch (error) {
      console.warn('Ban status check unavailable:',error.message||error);
    }
    return { accountId: user.id, isGM, banned, banReason };
  } catch (error) {
    console.warn('Pilot authentication check failed:', error.message || error);
    return null;
  }
}

async function hasCurrentGM(player) {
  const identity=await verifyPilotToken(player.accessToken);
  const allowed=!!(identity&&!identity.banned&&identity.isGM&&identity.accountId===player.accountId);
  if(!allowed)player.isGM=false;
  return allowed;
}

const PUBLIC_MAPS = new Set([
  'public_trade_hub',
  'public_lowsec',
  'public_nullsec'
]);

const MATCH_MAPS = new Set(['public_space']);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'application/json'});
    return res.end(JSON.stringify({
      ok: true,
      service: 'minispace-online'
    }));
  }

  res.writeHead(200, {'content-type': 'text/plain'});
  res.end('Minispace Online server');
});

const wss = new WebSocket.Server({server});

const players = new Map();
const friends = new Map();
const publicRooms = new Map();
const resumeTokens = new Map();

const zones = [
  {id:'high-sec',name:'High Security',x:0,y:0,radius:1800,pvp:false},
  {id:'low-sec',name:'Low Security',x:2600,y:0,radius:1800,pvp:true},
  {id:'null-sec',name:'Frontier',x:0,y:2600,radius:2200,pvp:true}
];

function zoneAt(x,y) {
  return zones.find(z =>
    Math.hypot(x-z.x,y-z.y)<=z.radius
  ) || {id:'deep-space',name:'Deep Space',pvp:true};
}

function send(ws,obj) {
  if(ws && ws.readyState===WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function safeText(s,n=240) {
  return String(s||'')
    .replace(/[<>]/g,'')
    .slice(0,n);
}

function publicRoomFor(mapId) {
  let room=null;

  for(const candidate of publicRooms.values()) {
    if(
      candidate.mapId===mapId &&
      candidate.players.size<MAX_PUBLIC_PLAYERS
    ) {
      room=candidate;
      break;
    }
  }

  if(!room) {
    const number=1+
      [...publicRooms.values()]
        .filter(r=>r.mapId===mapId).length;

    room={
      id:'public:'+mapId+':'+number,
      mapId,
      players:new Set()
    };

    publicRooms.set(room.id,room);
  }

  return room;
}

function leaveRoom(p) {
  if(!p.roomId)return;

  const oldRoomId=p.roomId;
  const oldRoom=publicRooms.get(oldRoomId);

  if(oldRoom) {
    oldRoom.players.delete(p.id);

    if(oldRoom.players.size===0) {
      publicRooms.delete(oldRoomId);
    }
  }

  for(const other of players.values()) {
    if(other.id!==p.id && other.roomId===oldRoomId) {
      send(other.ws,{
        type:'player-left',
        id:p.id
      });
    }
  }

  p.roomId=null;
}

function joinRoom(p,mapId) {
  if(p.mapId===mapId && p.roomId)return;

  leaveRoom(p);
  p.mapId=mapId;

  if(PUBLIC_MAPS.has(mapId)) {
    const room=publicRoomFor(mapId);
    room.players.add(p.id);
    p.roomId=room.id;
    p.roomType='public';

  } else if(MATCH_MAPS.has(mapId)) {
    p.roomId='match:station-loot';
    p.roomType='match';

  } else {
    p.roomId='private:'+p.id;
    p.roomType='private';
  }

  send(p.ws,{
    type:'room-joined',
    mapId:p.mapId,
    roomId:p.roomId,
    roomType:p.roomType,
    capacity:p.roomType==='public'
      ? MAX_PUBLIC_PLAYERS
      : (p.roomType==='match' ? 6 : 1)
  });

  for(const other of players.values()) {
    if(
      other.id!==p.id &&
      other.roomId===p.roomId &&
      other.ws && (!other.invisible || p.isGM)
    ) {
      send(p.ws,{
        type:'player',
        player:publicPlayer(other)
      });
    }
  }
}

function sendRoomSnapshot(p) {
  if(!p.roomId)return;

  send(p.ws,{
    type:'room-joined',
    mapId:p.mapId,
    roomId:p.roomId,
    roomType:p.roomType,
    capacity:p.roomType==='public'
      ? MAX_PUBLIC_PLAYERS
      : (p.roomType==='match' ? 6 : 1)
  });

  for(const other of players.values()) {
    if(
      other.id!==p.id &&
      other.roomId===p.roomId &&
      other.ws && (!other.invisible || p.isGM)
    ) {
      send(p.ws,{
        type:'player',
        player:publicPlayer(other)
      });
    }
  }
}

function publicPlayer(p) {
  return {
    id:p.id,
    name:p.name,
    x:p.x,
    y:p.y,
    angle:p.angle,
    ship:p.ship,
    system:p.system,
    mapId:p.mapId,
    roomId:p.roomId,
    zone:p.zone,
    pvp:p.pvp
  };
}

function broadcastRoom(roomId,obj,except) {
  for(const p of players.values()) {
    if(p.roomId===roomId && p.ws && p.ws!==except) {
      const source=obj && obj.player ? players.get(obj.player.id) : null;
      if(source && source.invisible && !p.isGM) continue;
      send(p.ws,obj);
    }
  }
}

function broadcastAll(obj,except) {
  for(const p of players.values()) {
    if(p.ws && p.ws!==except)send(p.ws,obj);
  }
}

wss.on('connection',ws=>{
  let helloProcessed=false;

  let p={
    id:crypto.randomUUID(),
    ws,
    name:'Pilot',
    x:0,
    y:0,
    angle:0,
    ship:'Unknown',
    system:'High-sec 1.0',
    mapId:null,
    roomId:null,
    roomType:'private',
    zone:'high-sec',
    last:Date.now(),
    resumeToken:null,
    graceTimer:null,
    invisible:false,
    authenticated:false,
    isGM:false,
    accountId:null
  };

  players.set(p.id,p);
  friends.set(p.id,new Set());

  send(ws,{
    type:'welcome',
    id:p.id,
    players:[],
    zones
  });

  ws.on('message',async buf=>{
    let m;

    try {
      m=JSON.parse(buf.toString());
    } catch {
      return;
    }

    if(m.type==='hello') {
      if (helloProcessed) {
        p.name=safeText(m.name,16)||p.name||'Pilot';
        if (p.roomId && !p.invisible) broadcastRoom(p.roomId,{type:'player',player:publicPlayer(p)},ws);
        return;
      }
      const token=safeText(m.resumeToken,100);

      if(!helloProcessed && token) {
        const oldId=resumeTokens.get(token);
        const oldPlayer=oldId ? players.get(oldId) : null;

        if(
          oldPlayer &&
          oldPlayer!==p &&
          !oldPlayer.ws &&
          oldPlayer.graceTimer
        ) {
          clearTimeout(oldPlayer.graceTimer);

          players.delete(p.id);
          friends.delete(p.id);

          p=oldPlayer;
          p.ws=ws;
          p.graceTimer=null;
          p.last=Date.now();
        }
      }

      if(token) {
        if(p.resumeToken && p.resumeToken!==token) {
          resumeTokens.delete(p.resumeToken);
        }

        p.resumeToken=token;
        resumeTokens.set(token,p.id);
      }

      helloProcessed=true;
      p.name=safeText(m.name,16)||p.name||'Pilot';
      const identity=await verifyPilotToken(m.accessToken);
      if(identity&&identity.banned){
        send(ws,{type:'auth-status',authenticated:false,isGM:false,banned:true,reason:identity.banReason});
        try{ws.close(4003,'Pilot account banned');}catch(error){}
        return;
      }
      if(!identity){
        send(ws,{type:'auth-status',authenticated:false,isGM:false});
        try{ws.close(4001,'Pilot authentication required');}catch(error){}
        return;
      }
      p.accountId=identity.accountId;
      p.accessToken=m.accessToken;
      p.isGM=!!identity.isGM;
      p.authenticated=true;
      send(ws,{type:'welcome',id:p.id,players:[],zones,resumed:!!p.roomId,authenticated:true,isGM:p.isGM});
      send(ws,{type:'auth-status',authenticated:true,isGM:p.isGM});
      if(p.roomId)sendRoomSnapshot(p);
      return;
    }

    if(m.type!=='hello'&&!p.authenticated)return;

    if(m.type==='gm-list-online') {
      if(!(await hasCurrentGM(p))){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const online=[...players.values()].filter(q=>q.ws&&q.ws.readyState===WebSocket.OPEN&&q.authenticated).map(q=>({
        id:q.id,accountId:q.accountId||null,name:q.name,ship:q.ship,mapId:q.mapId,
        system:q.system,x:q.x,y:q.y,invisible:!!q.invisible
      }));
      send(ws,{type:'gm-online-list',players:online});
      return;
    }

    if(m.type==='gm-kick-account') {
      if(!p.isGM){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const accountId=String(m.accountId||'');
      const targets=[...players.values()].filter(q=>q.accountId===accountId&&q.id!==p.id&&q.ws);
      if(!targets.length){send(ws,{type:'gm-command-result',message:'That pilot is not currently online.'});return;}
      const isBan=m.banned===true;
      const targetName=targets[0].name;
      for(const target of targets){
        send(target.ws,{type:isBan?'account-banned':'account-kicked',message:isBan?'Your pilot account has been banned by a Game Master.':'A Game Master updated your pilot data. Reconnecting to load the changes.'});
        try{target.ws.close(isBan?4003:4000,isBan?'Pilot account banned':'Pilot data updated');}catch(error){}
        leaveRoom(target);
        players.delete(target.id);
        friends.delete(target.id);
        if(target.resumeToken)resumeTokens.delete(target.resumeToken);
      }
      send(ws,{type:'gm-command-result',message:targetName+' disconnected ('+targets.length+' session'+(targets.length===1?'':'s')+').'});
      return;
    }

    if(m.type==='gm-teleport-to-player') {
      if(!p.isGM){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const target=[...players.values()].find(q=>q.accountId===String(m.accountId||'')&&q.ws&&q.authenticated);
      if(!target){send(ws,{type:'gm-error',message:'Pilot is not online.'});return;}
      if(!p.roomId||p.roomId!==target.roomId||p.mapId!==target.mapId){send(ws,{type:'gm-error',message:'Teleport requires you and the pilot to be in the same shared map instance.'});return;}
      send(ws,{type:'gm-teleport',x:target.x,y:target.y,mapId:target.mapId,name:target.name});
      return;
    }

    if(m.type==='gm-unstick-pilot') {
      if(!p.isGM){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const target=[...players.values()].find(q=>q.accountId===String(m.accountId||'')&&q.ws&&q.authenticated);
      if(!target){send(ws,{type:'gm-error',message:'Pilot is not online.'});return;}
      send(target.ws,{type:'gm-unstick',message:'A Game Master returned your ship to Private High-Sec.'});
      send(ws,{type:'gm-command-result',message:target.name+' returned to Private High-Sec.'});
      return;
    }

    if(m.type==='gm-toggle-invisible') {
      if(!p.isGM){send(ws,{type:'gm-error',message:'GM access required'});return;}
      p.invisible=!p.invisible;
      if(p.roomId){
        if(p.invisible){
          for(const other of players.values()) if(other.id!==p.id&&other.roomId===p.roomId&&!other.isGM) send(other.ws,{type:'player-left',id:p.id});
        } else {
          broadcastRoom(p.roomId,{type:'player',player:publicPlayer(p)},ws);
        }
      }
      send(ws,{type:'gm-invisibility',enabled:p.invisible});
      return;
    }

    if(m.type==='state') {
      const requestedMap=safeText(m.mapId,48);

      const mapId=
        PUBLIC_MAPS.has(requestedMap) ||
        MATCH_MAPS.has(requestedMap)
          ? requestedMap
          : (
            requestedMap &&
            requestedMap!=='public_space'
              ? requestedMap
              : 'private_highsec'
          );

      joinRoom(p,mapId);

      p.x=Number.isFinite(+m.x)
        ? Math.max(-10000,Math.min(10000,+m.x))
        : p.x;

      p.y=Number.isFinite(+m.y)
        ? Math.max(-10000,Math.min(10000,+m.y))
        : p.y;

      p.angle=Number(m.angle)||0;
      p.ship=safeText(m.ship,32);
      p.system=safeText(m.system,48);

      const z=zoneAt(p.x,p.y);
      p.zone=z.id;

      // TRADE HUB IS ALWAYS NON-PVP
      p.pvp=p.mapId==='public_trade_hub'
        ? false
        : z.pvp;

      p.last=Date.now();

      broadcastRoom(
        p.roomId,
        {
          type:'player',
          player:publicPlayer(p)
        },
        ws
      );

      return;
    }

    if(m.type==='chat') {
      const text=safeText(m.text,240).trim();
      if(!text)return;

      const channel=[
        'global',
        'local',
        'fleet',
        'whisper'
      ].includes(m.channel)
        ? m.channel
        : 'global';

      if(channel==='whisper') {
        const target=[...players.values()].find(q =>
          q.name.toLowerCase()===
          safeText(m.to,16).toLowerCase()
        );

        if(target) {
          send(target.ws,{
            type:'chat',
            from:p.name,
            channel,
            text
          });
        }

        send(ws,{
          type:'chat',
          from:p.name,
          channel,
          text,
          to:m.to
        });

      } else if(channel==='local') {
        for(const other of players.values()) {
          if(other.roomId===p.roomId) {
            send(other.ws,{
              type:'chat',
              from:p.name,
              channel,
              text
            });
          }
        }

      } else {
        broadcastAll({
          type:'chat',
          from:p.name,
          channel,
          text
        });
      }

      return;
    }

    if(m.type==='friend-request') {
      const target=[...players.values()].find(q =>
        q.name.toLowerCase()===
        safeText(m.name,16).toLowerCase()
      );

      if(target&&target.id!==p.id) {
        send(target.ws,{
          type:'friend-request',
          from:p.name
        });
      }

      return;
    }

    if(m.type==='friend-accept') {
      const other=[...players.values()].find(q =>
        q.name.toLowerCase()===
        safeText(m.name,16).toLowerCase()
      );

      if(other) {
        friends.get(p.id)?.add(other.id);
        friends.get(other.id)?.add(p.id);

        send(ws,{
          type:'friend-added',
          name:other.name
        });

        send(other.ws,{
          type:'friend-added',
          name:p.name
        });
      }
    }
  });

  ws.on('close',()=>{
    if(p.ws!==ws)return;

    p.ws=null;

    p.graceTimer=setTimeout(()=>{
      if(p.ws)return;

      leaveRoom(p);
      players.delete(p.id);
      friends.delete(p.id);

      if(p.resumeToken) {
        resumeTokens.delete(p.resumeToken);
      }
    },RECONNECT_GRACE_MS);
  });
});

setInterval(()=>{
  const now=Date.now();

  for(const p of players.values()) {
    if(p.ws && now-p.last>45000) {
      send(p.ws,{type:'ping'});
    }
  }
},15000);

// GLOBAL ONLINE PLAYER COUNT
setInterval(()=>{
  for(const viewer of players.values()) {
    const onlineCount=[...players.values()].filter(target=>
      target.ws && target.ws.readyState===WebSocket.OPEN && target.authenticated && (!target.invisible || viewer.isGM || target.id===viewer.id)
    ).length;
    send(viewer.ws,{type:'online-count',count:onlineCount});
  }
},2000);

server.listen(PORT,()=>{
  console.log(
    `Minispace Online listening on ${PORT}`
  );
});

// GLOBAL PILOT DIRECTORY
setInterval(()=>{
  for(const viewer of players.values()) {
    const directory=[...players.values()]
      .filter(target=>target.ws && target.ws.readyState===WebSocket.OPEN && target.authenticated && (!target.invisible || viewer.isGM || target.id===viewer.id))
      .map(target=>({id:target.id,name:target.name,ship:target.ship}));
    send(viewer.ws,{type:'online-directory',players:directory});
  }
},3000);
