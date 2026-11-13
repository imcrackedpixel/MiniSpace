
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const MAX_PUBLIC_PLAYERS = 20;
const RECONNECT_GRACE_MS = 60000;
const DEFAULT_SUPABASE_URL = 'https://fatejbbzgfeeebzkgcao.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_zfoeW5SNimEZynC-bobT4g_5sGyOtfX';
const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

async function verifyPilotToken(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 40 || accessToken.length > 5000) return null;

  // Render environment values can be stale or copied from another Supabase project.
  // Try the configured pair first, then the exact public project credentials used
  // by Auth.js. Never log or expose the pilot's access token.
  const urls = [...new Set([SUPABASE_URL, DEFAULT_SUPABASE_URL])];
  const keys = [...new Set([SUPABASE_KEY, DEFAULT_SUPABASE_KEY])];
  let user = null;
  let verifiedUrl = null;
  let verifiedKey = null;

  for (const url of urls) {
    for (const key of keys) {
      try {
        const response = await fetch(url + '/auth/v1/user', {
          method: 'GET',
          headers: { apikey: key, Authorization: 'Bearer ' + accessToken }
        });
        if (!response.ok) continue;
        const candidate = await response.json();
        if (candidate && typeof candidate.id === 'string') {
          user = candidate;
          verifiedUrl = url;
          verifiedKey = key;
          break;
        }
      } catch (error) {
        console.warn('Pilot authentication endpoint unavailable:', error.message || error);
      }
    }
    if (user) break;
  }

  if (!user) {
    console.warn('Pilot authentication failed: no configured or built-in Supabase credential pair accepted the session.');
    return null;
  }

  let isGM = false;
  try {
    const gmResponse = await fetch(verifiedUrl + '/rest/v1/rpc/gm_is_authorized', {
      method: 'POST',
      headers: { apikey: verifiedKey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (gmResponse.ok) isGM = (await gmResponse.json()) === true;
  } catch (error) {
    console.warn('GM permission check unavailable:', error.message || error);
  }

  let banned = false;
  let banReason = '';
  try {
    const statusResponse = await fetch(verifiedUrl + '/rest/v1/rpc/gm_admin_account_status', {
      method: 'POST',
      headers: { apikey: verifiedKey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      banned = !!(status && status.banned);
      banReason = String(status && status.reason || '');
    }
  } catch (error) {
    console.warn('Ban status check unavailable:', error.message || error);
  }

  return { accountId: user.id, isGM, banned, banReason };
}

async function hasCurrentGM(player) {
  const identity=await verifyPilotToken(player.accessToken);
  const allowed=!!(identity&&!identity.banned&&identity.isGM&&identity.accountId===player.accountId);
  if(!allowed)player.isGM=false;
  return allowed;
}

const PUBLIC_MAPS = new Set([
 'public_trade_hub','public_lowsec','public_nullsec',
 'frontier_ashen','frontier_iron','frontier_vanta','frontier_cinder',
 'frontier_umbra','frontier_nexus','frontier_redline','frontier_blackstar','frontier_crypt'
]);

const MATCH_MAPS = new Set(['public_space']);

function isPublicMap(mapId) {
  return PUBLIC_MAPS.has(mapId) || /^frontier_ring(?:[1-9]|10)_sector[1-6]$/.test(String(mapId || ''));
}

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
const teams = new Map();
const publicRooms = new Map();
const frontierStationStates = new Map();
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
      players:new Set(),
      deadNpcs:new Map()
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

  if(isPublicMap(mapId)) {
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
  if(p.teamId&&teams.has(p.teamId)){
    const members=[...teams.get(p.teamId)].map(id=>players.get(id)).filter(Boolean);
    send(p.ws,{type:'team-state',teamId:p.teamId,members:members.map(member=>({id:member.id,name:member.name,mapId:member.mapId,system:member.system,x:member.x,y:member.y,docked:member.docked,panicActive:!!member.panicActive}))});
  }
}

function sendRoomSnapshot(p) {
  if(!p.roomId)return;
  const room=publicRooms.get(p.roomId);
  if(room&&String(p.mapId).indexOf('frontier_')===0)send(p.ws,{type:'frontier-npc-state',mapId:p.mapId,deadNpcs:[...room.deadNpcs.entries()].map(([npcId,respawnAt])=>({npcId,respawnAt}))});
  if(String(p.mapId).indexOf('frontier_')===0){
    const siege=frontierStationStates.get(p.mapId);
    if(siege)send(p.ws,{type:'frontier-station-state',mapId:p.mapId,hp:siege.hp,maxHp:siege.maxHp,wavesSpawned:siege.wavesSpawned});
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
    pvp:p.pvp,
    shield:p.shield, armor:p.armor, structure:p.structure,
    maxShield:p.maxShield, maxArmor:p.maxArmor, maxStructure:p.maxStructure,
    damageResistance:p.damageResistance, docked:p.docked,
    teamId:p.teamId||null
  };
}

function sendTeamLocation(p) {
  if(!p.teamId||!teams.has(p.teamId))return;
  const playerData={id:p.id,name:p.name,mapId:p.mapId,system:p.system,x:p.x,y:p.y,docked:p.docked,panicActive:!!p.panicActive};
  const payload={type:'team-location',player:playerData};
  if(p.panicActive&&!p._lastTeamPanicActive){
    for(const id of teams.get(p.teamId)){
      if(id===p.id)continue;
      const teammate=players.get(id);
      if(teammate&&teammate.ws)send(teammate.ws,{type:'team-panic',player:playerData});
    }
  }
  p._lastTeamPanicActive=!!p.panicActive;
  for(const id of teams.get(p.teamId)){
    if(id===p.id)continue;
    const teammate=players.get(id);
    if(teammate&&teammate.ws)send(teammate.ws,payload);
  }
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
function sendTeamState(teamId) {
  const team=teams.get(teamId);if(!team)return;
  const members=[...team].map(id=>players.get(id)).filter(Boolean);
  const payload={type:'team-state',teamId,members:members.map(member=>({id:member.id,name:member.name,mapId:member.mapId,system:member.system,x:member.x,y:member.y,docked:member.docked}))};
  members.forEach(member=>{
    send(member.ws,payload);
    if(member.roomId)broadcastRoom(member.roomId,{type:'player',player:publicPlayer(member)});
  });
}
function removeFromTeam(p) {
  if(!p.teamId)return;
  const teamId=p.teamId,team=teams.get(teamId);
  if(team)team.delete(p.id);
  p.teamId=null;
  if(team&&team.size<=1){
    const lastId=[...team][0],last=players.get(lastId);
    if(last)last.teamId=null;
    teams.delete(teamId);
    if(last&&last.ws)send(last.ws,{type:'team-state',teamId:null,members:[]});
    if(last&&last.roomId)broadcastRoom(last.roomId,{type:'player',player:publicPlayer(last)});
  }else if(team)sendTeamState(teamId);
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
    shield:0, armor:0, structure:1000,
    maxShield:0, maxArmor:0, maxStructure:1000,
    damageResistance:0, docked:false,
    last:Date.now(),
    resumeToken:null,
    graceTimer:null,
    invisible:false,
    authenticated:false,
    isGM:false,
    accountId:null,
    teamId:null,
    teamInvites:new Set()
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

      // Authenticate first, then resume only a session owned by this exact account.
      // Browser localStorage can survive an account switch, so a shared resume token
      // must never carry another pilot's name, ship or combat stats into this account.
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

      const token=safeText(m.resumeToken,100);
      if(token) {
        const oldId=resumeTokens.get(token);
        const oldPlayer=oldId ? players.get(oldId) : null;
        if(oldPlayer && oldPlayer!==p && !oldPlayer.ws && oldPlayer.graceTimer &&
           oldPlayer.accountId===identity.accountId) {
          clearTimeout(oldPlayer.graceTimer);
          players.delete(p.id);
          friends.delete(p.id);
          p=oldPlayer;
          p.ws=ws;
          p.graceTimer=null;
          p.last=Date.now();
        } else if(oldPlayer && oldPlayer!==p && oldPlayer.accountId!==identity.accountId) {
          // Detach the token from the previous account before assigning it below.
          // Its grace cleanup must not delete the new account's token mapping.
          if(oldPlayer.resumeToken===token) oldPlayer.resumeToken=null;
          resumeTokens.delete(token);
        }
        if(p.resumeToken && p.resumeToken!==token) resumeTokens.delete(p.resumeToken);
        p.resumeToken=token;
        resumeTokens.set(token,p.id);
      }

      helloProcessed=true;
      p.name=safeText(m.name,16)||p.name||'Pilot';
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
      if(!(await hasCurrentGM(p))){send(ws,{type:'gm-error',message:'GM access required'});return;}
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
      if(!(await hasCurrentGM(p))){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const target=[...players.values()].find(q=>q.accountId===String(m.accountId||'')&&q.ws&&q.authenticated);
      if(!target){send(ws,{type:'gm-error',message:'Pilot is not online.'});return;}
      if(!p.roomId||p.roomId!==target.roomId||p.mapId!==target.mapId){send(ws,{type:'gm-error',message:'Teleport requires you and the pilot to be in the same shared map instance.'});return;}
      send(ws,{type:'gm-teleport',x:target.x,y:target.y,mapId:target.mapId,name:target.name});
      return;
    }

    if(m.type==='gm-unstick-pilot') {
      if(!(await hasCurrentGM(p))){send(ws,{type:'gm-error',message:'GM access required'});return;}
      const target=[...players.values()].find(q=>q.accountId===String(m.accountId||'')&&q.ws&&q.authenticated);
      if(!target){send(ws,{type:'gm-error',message:'Pilot is not online.'});return;}
      send(target.ws,{type:'gm-unstick',message:'A Game Master returned your ship to Private High-Sec.'});
      send(ws,{type:'gm-command-result',message:target.name+' returned to Private High-Sec.'});
      return;
    }

    if(m.type==='gm-toggle-invisible') {
      if(!(await hasCurrentGM(p))){send(ws,{type:'gm-error',message:'GM access required'});return;}
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

    if(m.type==='pvp-damage') {
      const mapId=safeText(m.mapId,48);
      const target=players.get(safeText(m.targetId,100));
      const allowedMap=mapId==='public_space'||mapId.indexOf('frontier_')===0;
      if(!allowedMap||!p.roomId||!['public','match'].includes(p.roomType)||p.mapId!==mapId||!p.pvp||p.docked||
         !target||target.id===p.id||(p.teamId&&target.teamId===p.teamId)||target.roomId!==p.roomId||target.roomType!==p.roomType||target.mapId!==mapId||!target.pvp||target.docked||
         target.structure<=0||p.structure<=0||Math.hypot(p.x-target.x,p.y-target.y)>1600)return;
      const now=Date.now();
      if(!p.pvpHitTimes)p.pvpHitTimes=new Map();
      if(now-(p.pvpHitTimes.get(target.id)||0)<120)return;
      p.pvpHitTimes.set(target.id,now);
      let remaining=Math.min(500,Math.max(0,Number(m.damage)||0));
      remaining *= 1 - Math.max(0,Math.min(0.85,Number(target.damageResistance)||0));
      if(!remaining)return;
      if(target.shield>0){const hit=Math.min(target.shield,remaining);target.shield-=hit;remaining-=hit;}
      if(remaining>0&&target.armor>0){const hit=Math.min(target.armor,remaining);target.armor-=hit;remaining-=hit;}
      if(remaining>0)target.structure=Math.max(0,(target.structure||0)-remaining);
      send(target.ws,{type:'pvp-hit',mapId:mapId,attackerId:p.id,damage:Math.min(500,Number(m.damage)||0),
        shield:target.shield,armor:target.armor,structure:target.structure});
      broadcastRoom(p.roomId,{type:'player',player:publicPlayer(target)},target.ws);
      return;
    }

    if(m.type==='frontier-station-state') {
      const mapId=String(m.mapId||'');
      if(!p.roomId||p.roomType!=='public'||p.mapId!==mapId||mapId.indexOf('frontier_')!==0)return;
      const maxHp=Number(m.maxHp),incomingHp=Number(m.hp);
      if(!Number.isFinite(maxHp)||!Number.isFinite(incomingHp)||maxHp<1000||maxHp>10000000)return;
      let siege=frontierStationStates.get(mapId);
      if(!siege)siege={maxHp:maxHp,hp:Math.max(0,Math.min(maxHp,incomingHp)),wavesSpawned:[]};
      if(Math.abs(siege.maxHp-maxHp)>1)return;
      siege.hp=Math.min(siege.hp,Math.max(0,Math.min(siege.maxHp,incomingHp)));
      if(Array.isArray(m.wavesSpawned))m.wavesSpawned.forEach(w=>{const n=Number(w);if(Number.isInteger(n)&&n>=0&&n<3&&!siege.wavesSpawned.includes(n))siege.wavesSpawned.push(n);});
      frontierStationStates.set(mapId,siege);
      broadcastRoom(p.roomId,{type:'frontier-station-state',mapId:mapId,hp:siege.hp,maxHp:siege.maxHp,wavesSpawned:siege.wavesSpawned});
      return;
    }

    if(m.type==='frontier-npc-killed') {
      const mapId=String(m.mapId||'');
      if(!p.roomId||p.roomType!=='public'||p.mapId!==mapId||mapId.indexOf('frontier_')!==0)return;
      const room=publicRooms.get(p.roomId);if(!room)return;
      const npcId=safeText(m.npcId,100);if(!npcId)return;
      const existing=room.deadNpcs.get(npcId);if(existing&&existing>Date.now())return;
      const now=Date.now();
      const respawnAt=Math.max(now+180000,Math.min(now+300000,Number(m.respawnAt)||now+240000));
      room.deadNpcs.set(npcId,respawnAt);
      broadcastRoom(p.roomId,{type:'frontier-npc-killed',mapId:mapId,npcId:npcId,respawnAt:respawnAt});
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
      const frontierRoom=publicRooms.get(p.roomId);
      if(frontierRoom&&String(mapId).indexOf('frontier_')===0&&p.frontierSnapshotRoom!==p.roomId){send(ws,{type:'frontier-npc-state',mapId:mapId,deadNpcs:[...frontierRoom.deadNpcs.entries()].map(([npcId,respawnAt])=>({npcId,respawnAt}))});p.frontierSnapshotRoom=p.roomId;}
      if(String(mapId).indexOf('frontier_')!==0)p.frontierSnapshotRoom=null;

      p.x=Number.isFinite(+m.x)
        ? Math.max(-10000,Math.min(10000,+m.x))
        : p.x;

      p.y=Number.isFinite(+m.y)
        ? Math.max(-10000,Math.min(10000,+m.y))
        : p.y;

      p.angle=Number(m.angle)||0;
      p.ship=safeText(m.ship,32);
      p.system=safeText(m.system,48);
      p.docked=!!m.docked;
      p.panicActive=!!m.panicActive;
      for (const key of ['shield','armor','structure','maxShield','maxArmor','maxStructure','damageResistance']) {
        const value=Number(m[key]);
        if(Number.isFinite(value))p[key]=Math.max(0,Math.min(100000000,value));
      }

      const z=zoneAt(p.x,p.y);
      p.zone=z.id;

      // Frontier and 3v3 maps are PvP everywhere, independent of local x/y zone coordinates.
      // The Trade Hub is always non-PvP; private High-Sec remains in a private room.
      p.pvp = p.mapId === 'public_trade_hub'
        ? false
        : (p.mapId === 'public_space' || String(p.mapId).indexOf('frontier_') === 0 ? true : z.pvp);

      p.last=Date.now();

      broadcastRoom(
        p.roomId,
        {
          type:'player',
          player:publicPlayer(p)
        },
        ws
      );
      sendTeamLocation(p);

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

    if(m.type==='team-invite') {
      const name=safeText(m.name,16).toLowerCase();
      const target=[...players.values()].find(q=>q.name.toLowerCase()===name&&q.id!==p.id&&q.authenticated&&q.ws);
      if(!target){send(ws,{type:'team-error',message:'That pilot is not online.'});return;}
      if(p.teamId&&target.teamId&&p.teamId!==target.teamId){send(ws,{type:'team-error',message:'That pilot is already in another team.'});return;}
      if(!p.teamId&&target.teamId){send(ws,{type:'team-error',message:'That pilot is already in a team.'});return;}
      target.teamInvites.add(p.id);send(target.ws,{type:'team-invite',from:p.name});
      send(ws,{type:'chat',channel:'system',from:'TEAM',text:'Invitation sent to '+target.name+'.'});return;
    }
    if(m.type==='team-accept') {
      const inviterName=safeText(m.name,16).toLowerCase();
      const inviter=[...players.values()].find(q=>q.name.toLowerCase()===inviterName&&p.teamInvites.has(q.id));
      if(!inviter){send(ws,{type:'team-error',message:'That team invitation has expired.'});return;}
      if(p.teamId&&p.teamId!==inviter.teamId){send(ws,{type:'team-error',message:'Leave your current team first.'});return;}
      let teamId=inviter.teamId;
      if(!teamId){teamId='team:'+crypto.randomUUID();teams.set(teamId,new Set([inviter.id]));inviter.teamId=teamId;}
      const team=teams.get(teamId);
      if(!team){send(ws,{type:'team-error',message:'That team no longer exists.'});return;}
      if(team.size>=8){send(ws,{type:'team-error',message:'Teams can have up to 8 pilots.'});return;}
      team.add(p.id);p.teamId=teamId;p.teamInvites.delete(inviter.id);sendTeamState(teamId);return;
    }
    if(m.type==='team-decline') {
      const inviterName=safeText(m.name,16).toLowerCase();
      const inviter=[...players.values()].find(q=>q.name.toLowerCase()===inviterName);
      if(inviter&&p.teamInvites)p.teamInvites.delete(inviter.id);
      if(inviter&&inviter.ws)send(inviter.ws,{type:'team-invite-declined',name:p.name});
      return;
    }
    if(m.type==='team-leave') {
      removeFromTeam(p);send(ws,{type:'team-state',teamId:null,members:[]});return;
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
      removeFromTeam(p);
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
  for(const room of publicRooms.values()){
    if(String(room.mapId).indexOf('frontier_')!==0||!room.deadNpcs)continue;
    for(const [npcId,respawnAt] of room.deadNpcs.entries())if(respawnAt<=now){room.deadNpcs.delete(npcId);broadcastRoom(room.id,{type:'frontier-npc-respawn',mapId:room.mapId,npcId:npcId});}
  }

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
      .map(target=>({id:target.id,name:target.name,ship:target.ship,teamId:target.teamId||null}));
    send(viewer.ws,{type:'online-directory',players:directory});
  }
},3000);
