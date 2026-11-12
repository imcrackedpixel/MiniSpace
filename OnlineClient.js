
/* MiniSpace Online: multiplayer with reconnect identity */
(function(){
 const state={
  socket:null,
  id:null,
  players:new Map(),
  connected:false,
  channel:'global',
  roomId:null,
  roomType:null,
  mapId:null,
  reconnectTimer:null,
  reconnectAttempts:0
 };

 const $=id=>document.getElementById(id);

 function getResumeToken(){
  let token=localStorage.getItem('minispace_resume_token');

  if(!token){
   if(window.crypto&&crypto.randomUUID){
    token=crypto.randomUUID();
   }else{
    const bytes=new Uint8Array(24);
    crypto.getRandomValues(bytes);
    token=Array.from(bytes)
     .map(b=>b.toString(16).padStart(2,'0'))
     .join('');
   }

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
    <button id="online-collapse">−</button>
   </header>
   <div id="online-content">
    <div id="online-count">0 pilots nearby</div>
    <div id="online-roster"></div>
    <div class="online-actions">
     <input id="online-friend-name" maxlength="16" placeholder="Pilot callsign">
     <button id="online-add-friend">ADD FRIEND</button>
    </div>
    <div id="online-chat-log" aria-live="polite"></div>
    <div class="online-actions">
     <select id="online-channel">
      <option value="global">Global</option>
      <option value="local">Local</option>
      <option value="fleet">Fleet</option>
     </select>
     <input id="online-chat-input" maxlength="240" placeholder="Message">
     <button id="online-send">SEND</button>
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

  $('online-add-friend').onclick=()=>{
   send({
    type:'friend-request',
    name:$('online-friend-name').value
   });
  };

  $('online-send').onclick=chat;

  $('online-chat-input').addEventListener('keydown',e=>{
   if(e.key==='Enter')chat();
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

  while(box.children.length>60){
   box.firstChild.remove();
  }
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

 function updatePlayer(p){
  if(!p||!p.id)return;

  if(state.roomId&&p.roomId&&p.roomId!==state.roomId){
   return;
  }

  const old=state.players.get(p.id)||{};

  state.players.set(p.id,{
   ...old,
   ...p,
   renderX:old.renderX??p.x,
   renderY:old.renderY??p.y,
   renderAngle:old.renderAngle??p.angle
  });
 }

 function render(){
  if(!$('online-roster'))return;

  const players=[...state.players.values()];

  $('online-count').textContent=
   players.length+' pilots online';

  $('online-roster').replaceChildren();

  players.slice(0,12).forEach(p=>{
   const row=document.createElement('div');
   row.className='online-pilot';

   const name=document.createElement('span');
   name.textContent=p.name+' · '+p.ship;

   const button=document.createElement('button');
   button.textContent='FRIEND';

   button.onclick=()=>{
    send({
     type:'friend-request',
     name:p.name
    });
   };

   row.append(name,button);
   $('online-roster').append(row);
  });
 }

 function drawRemotePlayers(ctx){
  const local=window.playerShip;
  if(!local||local.docked||!window.ShipArt)return;

  const localSystem=$('system-text')?.textContent||'';

  for(const p of state.players.values()){
   if(!p.id||p.id===state.id)continue;
   if(state.roomId&&p.roomId!==state.roomId)continue;
   if(!p.system||p.system!==localSystem)continue;

   p.renderX+=(p.x-p.renderX)*0.35;
   p.renderY+=(p.y-p.renderY)*0.35;

   let angleDiff=(p.angle||0)-(p.renderAngle||0);
   while(angleDiff>Math.PI)angleDiff-=Math.PI*2;
   while(angleDiff< -Math.PI)angleDiff+=Math.PI*2;
   p.renderAngle+=angleDiff*0.35;

   const drawn=originalShipDraw(
    ctx,
    p.ship,
    p.renderX,
    p.renderY,
    p.renderAngle
   );

   if(!drawn){
    ctx.save();
    ctx.fillStyle='#58a6ff';
    ctx.beginPath();
    ctx.arc(p.renderX,p.renderY,15,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
   }

   ctx.save();
   ctx.font='bold 13px Arial';
   ctx.textAlign='center';
   ctx.lineWidth=3;
   ctx.strokeStyle='#071018';
   ctx.fillStyle='#8fc7d5';
   ctx.strokeText(p.name||'Pilot',p.renderX,p.renderY-55);
   ctx.fillText(p.name||'Pilot',p.renderX,p.renderY-55);
   ctx.restore();
  }
 }

 let originalShipDraw=null;

 function installShipRenderer(){
  if(!window.ShipArt||!window.ShipArt.draw)return false;
  if(window.ShipArt.draw._onlineRenderer)return true;

  originalShipDraw=window.ShipArt.draw;

  const wrapped=function(ctx,className,x,y,angle){
   const result=originalShipDraw.apply(this,arguments);

   const local=window.playerShip;

   if(local&&x===local.x&&y===local.y){
    drawRemotePlayers(ctx);
   }

   return result;
  };

  wrapped._onlineRenderer=true;
  window.ShipArt.draw=wrapped;
  return true;
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
  installShipRenderer();

  if(state.socket&&(
   state.socket.readyState===WebSocket.OPEN||
   state.socket.readyState===WebSocket.CONNECTING
  )){
   return;
  }

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

   send({
    type:'hello',
    name:localStorage.getItem('minispace_pilot_name')||'Pilot',
    resumeToken:getResumeToken()
   });

   tick();
  };

  socket.onclose=()=>{
   if(state.socket!==socket)return;

   state.connected=false;
   state.socket=null;
   state.roomId=null;
   state.players.clear();
   render();

   scheduleReconnect();
  };

  socket.onerror=()=>{
   if(state.socket===socket){
    $('online-status').textContent='CONNECTION ERROR';
   }
  };

  socket.onmessage=e=>{
   if(state.socket!==socket)return;

   let message;

   try{
    message=JSON.parse(e.data);
   }catch{
    return;
   }

   if(message.type==='welcome'){
    state.id=message.id;
    render();

    if(message.resumed){
     log('Welcome back! Your pilot session was restored.');
    }
   }

   if(message.type==='room-joined'){
    state.roomId=message.roomId;
    state.roomType=message.roomType;
    state.mapId=message.mapId;

    state.players.clear();
    render();

    log('Entered '+message.mapId+' ('+message.roomType+' instance)');
   }

   if(message.type==='player'){
    updatePlayer(message.player);
    render();
   }

   if(message.type==='player-left'){
    state.players.delete(message.id);
    render();
   }

   if(message.type==='chat'){
    log(
     '['+message.channel+'] '+
     message.from+': '+message.text
    );
   }

   if(message.type==='friend-request'){
    log('Friend request from '+message.from);
   }

   if(message.type==='friend-added'){
    log('You and '+message.name+' are now friends.');
   }
  };
 }

 function tick(){
  installShipRenderer();

  if(state.socket?.readyState===1&&window.playerShip){
   const ship=window.playerShip;

   send({
    type:'state',
    x:Number(ship.x)||0,
    y:Number(ship.y)||0,
    angle:Number(ship.angle)||0,
    ship:ship.className||ship.type||'Ship',
    system:$('system-text')?.textContent||'Unknown',
    mapId:window.getMiniSpaceMapId?.()||'private_highsec'
   });
  }
 }

 function resumeConnection(){
  if(state.socket&&state.socket.readyState===WebSocket.OPEN){
   tick();
  }else{
   connect();
  }
 }

 window.addEventListener('online',resumeConnection);
 window.addEventListener('pageshow',resumeConnection);

 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
   resumeConnection();
  }
 });

 window.MinispaceOnline={
  connect,
  send,
  tick,
  state
 };

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

// TEMPORARY MULTIPLAYER MOVEMENT TEST
setInterval(function(){
 const online=window.MinispaceOnline;
 if(!online)return;

 const players=[...online.state.players.values()];
 const other=players.find(p=>p.id!==online.state.id);
 const count=document.getElementById('online-count');

 if(count&&other){
  count.textContent=
   'Other pilot: X '+Math.round(other.x)+
   ' · Y '+Math.round(other.y);
 }
},500);

// USE THE GAME'S REAL PILOT NAME
setInterval(function(){
 const name=document.getElementById('ui-pilot-name')?.textContent?.trim();

 if(
  name&&
  name!=='Pilot'&&
  window.MinispaceOnline?.state?.socket?.readyState===1
 ){
  window.MinispaceOnline.send({
   type:'hello',
   name:name.slice(0,16)
  });
 }
},2000);
