
/* MiniSpace Online - friends, requests, chat and online count */
(function(){
 const state={
  socket:null,
  id:null,
  connected:false,
  authReady:false,
  authenticated:false,
  authFailed:false,
  accountBanned:false,
  accountKicked:false,
  isGM:false,
  roomId:null,
  reconnectTimer:null,
  reconnectAttempts:0,
  requests:[],
  teamRequests:[],
  teamId:null,
  teamMembers:[],
  teamLocations:[],
  directory:[],
  remotePlayers:{},
  gmPlayers:[],
  invisible:false
 };

 const $=id=>document.getElementById(id);
 const FRIEND_KEY='minispace_friends';

 function getFriends(){
  try{return JSON.parse(localStorage.getItem(FRIEND_KEY)||'[]');}
  catch{return [];}
 }

 function saveFriend(name){
  const friends=getFriends();
  if(!friends.some(n=>n.toLowerCase()===name.toLowerCase())){
   friends.push(name);
   localStorage.setItem(FRIEND_KEY,JSON.stringify(friends));
  }
  renderFriends();
 }

 function getResumeToken(){
  let token=localStorage.getItem('minispace_resume_token');
  if(!token){
   token=window.crypto?.randomUUID
    ? crypto.randomUUID()
    : String(Date.now())+Math.random().toString(36).slice(2);
   localStorage.setItem('minispace_resume_token',token);
  }
  return token;
 }

 function panel(){
  if($('online-panel'))return;

  const el=document.createElement('section');
  el.id='online-panel';
  el.innerHTML=`
   <header id="online-header">
    <span>MINISPACE ONLINE <span id="online-status">OFFLINE</span></span>
    <button id="online-chat-collapse" type="button" title="Fold chat">CHAT −</button>
    <button id="online-collapse" type="button" title="Fold online panel">−</button>
   </header>
   <div id="online-content">
    <div id="online-count">0 pilots online</div>
    <div class="online-actions" style="margin-top:8px;">
     <button id="online-friends-button" style="width:100%;">FRIENDS</button>
    </div>
    <div id="online-friends-window" style="display:none;padding:8px;margin:5px 0;background:#101923;color:#e6edf3;border:1px solid #36b99a;border-radius:7px;max-height:150px;overflow-y:auto;font-size:13px"></div>
    <div class="online-actions" style="margin-top:5px"><button id="online-team-button" style="width:100%">TEAM · <span id="online-team-status">NO TEAM</span></button></div>
    <div id="online-team-window" style="display:none;padding:8px;margin:5px 0;background:#101923;color:#e6edf3;border:1px solid #38bdf8;border-radius:7px;max-height:150px;overflow-y:auto;font-size:12px">
     <div id="online-team-roster">You are not in a team.</div>
     <div class="online-actions"><input id="online-team-name" maxlength="16" placeholder="Online pilot callsign"><button id="online-team-invite">INVITE</button></div>
     <button id="online-team-leave" style="width:100%;margin-top:5px;display:none">LEAVE TEAM</button>
    </div>
    <div class="online-actions">
     <input id="online-friend-name" maxlength="16" placeholder="Pilot callsign">
     <button id="online-add-friend">ADD FRIEND</button>
    </div>
    <div id="online-chat-content">
     <div id="online-chat-log" aria-live="polite"></div>
     <div class="online-actions" id="online-chat-controls">
     <select id="online-channel">
      <option value="global">Global</option>
      <option value="local">Local</option>
      <option value="fleet">Fleet</option>
     </select>
     <input id="online-chat-input" maxlength="240" placeholder="Message">
     <button id="online-send">SEND</button>
     </div>
    </div>
   </div>
  `;
  document.body.appendChild(el);

  $('online-collapse').onclick=()=>{
   const content=$('online-content');
   const hidden=content.style.display==='none';
   content.style.display=hidden?'block':'none';
   $('online-collapse').textContent=hidden?'−':'+';
  };

  $('online-chat-collapse').onclick=()=>{
   const chat=$('online-chat-content');
   const hidden=chat.style.display==='none';
   chat.style.display=hidden?'block':'none';
   $('online-chat-collapse').textContent=hidden?'CHAT −':'CHAT +';
   $('online-chat-collapse').title=hidden?'Fold chat':'Expand chat';
  };

  $('online-friends-button').onclick=()=>{
   const box=$('online-friends-window');const opening=box.style.display==='none';
   box.style.display=opening?'block':'none';if(opening)renderFriends();
  };
  $('online-team-button').onclick=()=>{
   const box=$('online-team-window');const opening=box.style.display==='none';
   box.style.display=opening?'block':'none';if(opening)renderTeam();
  };
  $('online-team-invite').onclick=()=>{
   const name=$('online-team-name').value.trim();
   if(name){send({type:'team-invite',name});$('online-team-name').value='';}
  };
  $('online-team-name').addEventListener('keydown',e=>{if(e.key==='Enter')$('online-team-invite').click();});
  $('online-team-leave').onclick=()=>send({type:'team-leave'});

  $('online-add-friend').onclick=()=>{
   const name=$('online-friend-name').value.trim();
   if(name){
    send({type:'friend-request',name});
    $('online-friend-name').value='';
   }
  };

  $('online-send').onclick=chat;
  $('online-chat-input').addEventListener('keydown',e=>{
   if(e.key==='Enter')chat();
  });

  requestWindow();
  renderFriends();
 }

 function renderFriends(){
  const box=$('online-friends-window');
  if(!box)return;

  box.replaceChildren();
  const friends=getFriends();

  if(!friends.length){
   box.textContent='No friends saved yet. Accept a friend request to add someone.';
   return;
  }

  const onlineNames=state.directory
   .filter(p=>p&&p.name)
   .map(p=>p.name.toLowerCase());

  friends.forEach(name=>{
   const row=document.createElement('div');
   row.style.padding='5px 2px';
   row.style.borderBottom='1px solid #34414d';

   const online=onlineNames.includes(name.toLowerCase());
   row.textContent=name+' · '+(online?'ONLINE':'OFFLINE');
   row.style.color=online?'#3fb950':'#8b949e';

   box.appendChild(row);
  });
 }

 function renderTeam(){
  const box=$('online-team-window');if(!box)return;
  const status=$('online-team-status'),roster=$('online-team-roster'),leave=$('online-team-leave');
  const members=Array.isArray(state.teamMembers)?state.teamMembers:[];
  if(status)status.textContent=state.teamId?'TEAM OF '+members.length:'NO TEAM';
  if(roster){
   roster.replaceChildren();
   if(!state.teamId)roster.textContent='No team yet. Invite an online pilot by callsign.';
   else members.forEach(member=>{
    const row=document.createElement('div');row.style.padding='3px 0';
    row.textContent=(member.id===state.id?'★ ':'• ')+String(member.name||'Pilot')+(member.id===state.id?' (YOU)':'');
    row.style.color='#9cebd7';roster.appendChild(row);
   });
  }
  if(leave)leave.style.display=state.teamId?'block':'none';
 }

 function requestWindow(){
  if($('friend-request-window'))return;

  const style=document.createElement('style');
  style.textContent=`
   #friend-request-window{
    position:fixed;
    right:12px;
    bottom:145px;
    z-index:99999;
    width:250px;
    max-width:calc(100vw - 24px);
    max-height:220px;
    overflow-y:auto;
    padding:10px;
    color:#e6edf3;
    background:#101923;
    border:1px solid #36b99a;
    border-radius:9px;
    box-shadow:0 4px 18px #0009;
    font:13px Arial,sans-serif;
    display:none;
   }
   #friend-request-window .request-row{
    padding:8px 0;
    border-top:1px solid #34414d;
   }
   #friend-request-window button{
    margin:6px 5px 0 0;
    padding:6px 10px;
    border:0;
    border-radius:5px;
    font-weight:bold;
   }
   #friend-request-window .accept-request{
    background:#238636;
    color:white;
   }
   #friend-request-window .deny-request{
    background:#30363d;
    color:white;
   }
  `;
  document.head.appendChild(style);

  const box=document.createElement('div');
  box.id='friend-request-window';
  document.body.appendChild(box);
  renderRequests();
 }

 function renderRequests(){
  const box=$('friend-request-window');
  if(!box)return;
  box.replaceChildren();

  if(!state.requests.length&&!state.teamRequests.length){box.style.display='none';return;}
  box.style.display='block';
  if(state.requests.length){const heading=document.createElement('strong');heading.textContent='FRIEND REQUESTS';box.appendChild(heading);}
  state.requests.forEach((name,index)=>{
   const row=document.createElement('div');
   row.className='request-row';

   const label=document.createElement('div');
   label.textContent=name+' wants to be your friend.';
   row.appendChild(label);

   const accept=document.createElement('button');
   accept.className='accept-request';
   accept.textContent='ACCEPT';
   accept.onclick=()=>{
    send({type:'friend-accept',name});
    state.requests.splice(index,1);
    renderRequests();
   };

   const deny=document.createElement('button');
   deny.className='deny-request';
   deny.textContent='DENY';
   deny.onclick=()=>{
    state.requests.splice(index,1);
    renderRequests();
   };

   row.append(accept,deny);box.appendChild(row);
  });
  if(state.teamRequests.length){
   const heading=document.createElement('strong');heading.textContent='TEAM INVITATIONS';heading.style.display='block';heading.style.marginTop='8px';box.appendChild(heading);
  }
  state.teamRequests.forEach((name,index)=>{
   const row=document.createElement('div');row.className='request-row';
   const label=document.createElement('div');label.textContent=name+' invited you to join their team.';row.appendChild(label);
   const accept=document.createElement('button');accept.className='accept-request';accept.textContent='JOIN TEAM';
   accept.onclick=()=>{send({type:'team-accept',name});state.teamRequests.splice(index,1);renderRequests();};
   const deny=document.createElement('button');deny.className='deny-request';deny.textContent='DECLINE';
   deny.onclick=()=>{send({type:'team-decline',name});state.teamRequests.splice(index,1);renderRequests();};
   row.append(accept,deny);box.appendChild(row);
  });
 }

 function send(message){
  if(state.socket&&state.socket.readyState===1){
   state.socket.send(JSON.stringify(message));
  }
 }

 function log(line){
  const box=$('online-chat-log');
  if(!box)return;
  const d=document.createElement('div');
  d.textContent=line;
  box.appendChild(d);
  box.scrollTop=box.scrollHeight;
  while(box.children.length>60)box.firstChild.remove();
 }

 function chat(){
  const input=$('online-chat-input');
  if(input.value.trim()){
   send({
    type:'chat',
    channel:$('online-channel').value,
    text:input.value
   });
  }
  input.value='';
 }

 function scheduleReconnect(){
  if(state.reconnectTimer)return;
  state.reconnectAttempts++;
  const delay=Math.min(
   15000,
   1000*Math.pow(2,Math.min(state.reconnectAttempts-1,4))
  );
  $('online-status').textContent='RECONNECTING';
  state.reconnectTimer=setTimeout(()=>{
   state.reconnectTimer=null;
   connect();
  },delay);
 }

 function connect(){
  panel();
  if(!state.authReady||state.authFailed||state.accountBanned||state.accountKicked)return;

  const accessToken=window.MINISPACE_AUTH?.getAccessToken?.();
  if(typeof accessToken!=='string'||accessToken.length<40){
   $('online-status').textContent='SIGN IN REQUIRED';
   if(!state.missingTokenReported){
    log('Online login is waiting for a valid account session. Please log in again.');
    state.missingTokenReported=true;
   }
   return;
  }
  state.missingTokenReported=false;

  if(state.socket&&(
   state.socket.readyState===WebSocket.OPEN||
   state.socket.readyState===WebSocket.CONNECTING
  ))return;

  const url=window.MINISPACE_SERVER_URL;
  if(!url){
   $('online-status').textContent='SERVER NOT CONFIGURED';
   return;
  }

  let socket;
  try{
   socket=new WebSocket(url);
   state.socket=socket;
  }catch(error){
   $('online-status').textContent='CONNECTION ERROR';
   scheduleReconnect();
   return;
  }

  socket.onopen=()=>{
   if(state.socket!==socket)return;
   state.connected=true;
   state.reconnectAttempts=0;
   $('online-status').textContent='CONNECTED';
   console.log('MiniSpace auth handshake:', {
    tokenPresent: typeof accessToken === 'string' && accessToken.length > 0,
    tokenLength: typeof accessToken === 'string' ? accessToken.length : 0,
    authBridgeAvailable: !!window.MINISPACE_AUTH
   });
   send({
    type:'hello',
    name:localStorage.getItem('minispace_pilot_name')||'Pilot',
    resumeToken:getResumeToken(),
    accessToken:accessToken
   });
   tick();
  };

  socket.onclose=()=>{
   if(state.socket!==socket)return;
   state.connected=false;
   state.socket=null;
   state.roomId=null;
   if(!state.authFailed&&!state.accountBanned&&!state.accountKicked)scheduleReconnect();
  };

  socket.onerror=()=>{
   if(state.socket===socket){
    $('online-status').textContent='CONNECTION ERROR';
   }
  };

  socket.onmessage=e=>{
   if(state.socket!==socket)return;
   let message;
   try{message=JSON.parse(e.data);}catch{return;}

   if(message.type==='online-count'){
    const count=$('online-count');
    if(count)count.textContent=message.count+' pilots online';
   }

   if(message.type==='online-directory'){
    state.directory=Array.isArray(message.players)?message.players:[];
    renderFriends();renderTeam();
   }

   if(message.type==='welcome'){
    state.id=message.id;
    if(message.resumed)log('Welcome back! Your pilot session was restored.');
   }

   if(message.type==='auth-status'){
    state.authenticated=!!message.authenticated;
    state.isGM=!!message.isGM;
    if(message.banned){state.accountBanned=true;log('ACCOUNT BANNED: '+String(message.reason||'Contact a Game Master.'));}
    else if(!state.authenticated){state.authFailed=true;log('Account verification failed. Please reload and sign in again.');}
    else if(state.isGM)log('GAME MASTER permissions verified by server.');
   }
   if(message.type==='gm-command-result')window.dispatchEvent(new CustomEvent('minispace-gm-result',{detail:String(message.message||'Command complete.')}));
   if(message.type==='gm-teleport')window.dispatchEvent(new CustomEvent('minispace-gm-teleport',{detail:message}));
   if(message.type==='gm-unstick')window.dispatchEvent(new CustomEvent('minispace-gm-unstick',{detail:message}));
   if(message.type==='account-banned'){state.accountBanned=true;log(message.message||'This account has been banned.');setTimeout(()=>window.location.reload(),900);}
   if(message.type==='account-kicked'){state.accountKicked=true;log(message.message||'Your pilot data was updated.');setTimeout(()=>window.location.reload(),900);}

   if(message.type==='gm-online-list'){
    state.gmPlayers=Array.isArray(message.players)?message.players:[];
    window.dispatchEvent(new CustomEvent('minispace-gm-online-list',{detail:state.gmPlayers}));
   }
   if(message.type==='gm-invisibility'){
    state.invisible=!!message.enabled;
    window.dispatchEvent(new CustomEvent('minispace-gm-invisibility',{detail:state.invisible}));
   }
   if(message.type==='gm-error'){
    window.dispatchEvent(new CustomEvent('minispace-gm-error',{detail:String(message.message||'GM command failed')}));
   }

   if(message.type==='room-joined'){
    if(state.roomId!==message.roomId)state.remotePlayers={};
    state.roomId=message.roomId;
    log('Entered '+message.mapId+' ('+message.roomType+' instance)');
   }
   if(message.type==='player'&&message.player&&message.player.id)state.remotePlayers[message.player.id]=message.player;
   if(message.type==='team-invite'){
    const name=String(message.from||'Pilot').slice(0,16);
    if(!state.teamRequests.includes(name)){state.teamRequests.push(name);renderRequests();}
   }
   if(message.type==='team-state'){
    state.teamId=message.teamId||null;state.teamMembers=Array.isArray(message.members)?message.members:[];
    state.teamLocations=state.teamMembers.map(member=>({...member}));
    Object.values(state.remotePlayers).forEach(p=>{if(p)p.teamId=state.teamMembers.some(m=>m.id===p.id)?state.teamId:null;});
    renderTeam();window.dispatchEvent(new CustomEvent('minispace-team-state',{detail:{teamId:state.teamId,members:state.teamMembers}}));
    log(state.teamId?'Team updated · '+state.teamMembers.length+' pilots.':'You are no longer in a team.');
   }
   if(message.type==='team-panic'&&message.player&&message.player.id){
    const member=message.player;
    const index=state.teamLocations.findIndex(entry=>entry.id===member.id);
    if(index>=0)state.teamLocations[index]={...state.teamLocations[index],...member};
    else state.teamLocations.push(member);
    state.teamMembers=state.teamLocations.map(entry=>({...entry}));
    window.dispatchEvent(new CustomEvent('minispace-team-panic',{detail:member}));
   }
   if(message.type==='team-location'&&message.player&&message.player.id){
    const incoming=message.player;
    const index=state.teamLocations.findIndex(member=>member.id===incoming.id);
    if(index>=0)state.teamLocations[index]={...state.teamLocations[index],...incoming};
    else if(incoming.id!==state.id)state.teamLocations.push(incoming);
    state.teamMembers=state.teamLocations.map(member=>({...member}));
    window.dispatchEvent(new CustomEvent('minispace-team-location',{detail:incoming}));
   }
   if(message.type==='team-error')log(String(message.message||'Team action unavailable.'));
   if(message.type==='team-invite-declined')log(String(message.name||'Pilot')+' declined your team invitation.');
   if(message.type==='player-left'&&message.id)delete state.remotePlayers[message.id];
   if(message.type==='frontier-npc-state'||message.type==='frontier-npc-killed'||message.type==='frontier-npc-respawn'){
    window.dispatchEvent(new CustomEvent('minispace-'+message.type,{detail:message}));
   }
   if(message.type==='frontier-station-state'){
    window.dispatchEvent(new CustomEvent('minispace-frontier-station-state',{detail:message}));
   }
   if(message.type==='pvp-hit'){
    window.dispatchEvent(new CustomEvent('minispace-pvp-hit',{detail:message}));
   }
if(message.type==='chat'){
    log('['+message.channel+'] '+message.from+': '+message.text);
   }

   if(message.type==='friend-request'){
    const name=String(message.from||'Pilot').slice(0,16);
    if(!state.requests.includes(name)){
     state.requests.push(name);
     renderRequests();
    }
   }

   if(message.type==='friend-added'){
    saveFriend(String(message.name||'').slice(0,16));
    log('You and '+message.name+' are now friends.');
   }
  };
 }

 function tick(){
  if(state.socket?.readyState===1&&window.playerShip){
   const ship=window.playerShip;
   send({
    type:'state',
    x:Number(ship.x)||0,
    y:Number(ship.y)||0,
    angle:Number(ship.angle)||0,
    ship:ship.className||ship.type||'Ship',
    system:$('system-text')?.textContent||'Unknown',
    mapId:window.mapManager?.currentMapId||window.getMiniSpaceMapId?.()||'private_highsec',
    shield:Number(ship.shield)||0, armor:Number(ship.armor)||0, structure:Number(ship.structure)||0,
    maxShield:Number(ship.maxShield)||0, maxArmor:Number(ship.maxArmor)||0, maxStructure:Number(ship.maxStructure)||0,
    damageResistance:Number(ship.damageResistance)||Number(ship.resist)||0,
    panicActive:!!ship.isPanicButtonActive,
    docked:!!ship.docked
   });
  }
 }

 function resumeConnection(){
  if(state.socket&&state.socket.readyState===WebSocket.OPEN)tick();
  else connect();
 }

 window.addEventListener('online',resumeConnection);
 window.addEventListener('pageshow',resumeConnection);
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)resumeConnection();
 });

 window.MinispaceOnline={connect,send,tick,state};

 // Wait for Supabase login/session restoration before opening the online socket,
 // so the first hello always carries the real account token.
 window.MINISPACE_AUTH_READY.then(()=>{
  state.authReady=true;
  connect();
 }).catch(error=>{
  const status=$('online-status');
  if(status)status.textContent='ACCOUNT NOT READY';
  console.warn('MiniSpace online authentication is not ready:',error);
 });

 if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>{
   panel();
   connect();
   setInterval(tick,250);
  });
 }else{
  panel();
  connect();
  setInterval(tick,250);
 }
})();

/* Keep the actual in-game pilot name updated */
setInterval(function(){
 const name=document.getElementById('ui-pilot-name')?.textContent?.trim();
 if(name&&name!=='Pilot'&&window.MinispaceOnline?.state?.socket?.readyState===1){
  window.MinispaceOnline.send({
   type:'hello',
   name:name.slice(0,16)
  });
 }
},2000);
