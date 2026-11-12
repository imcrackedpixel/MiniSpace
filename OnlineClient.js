
/* MiniSpace Online - count, chat and friends only */
(function(){
 const state={
  socket:null,
  id:null,
  connected:false,
  roomId:null,
  reconnectTimer:null,
  reconnectAttempts:0
 };

 const $=id=>document.getElementById(id);

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
    <button id="online-collapse">−</button>
   </header>
   <div id="online-content">
    <div id="online-count">0 pilots online</div>
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
   try{message=JSON.parse(e.data);}catch{return;}

   if(message.type==='online-count'){
    const count=$('online-count');
    if(count)count.textContent=message.count+' pilots online';
   }

   if(message.type==='welcome'){
    state.id=message.id;
    if(message.resumed)log('Welcome back! Your pilot session was restored.');
   }

   if(message.type==='room-joined'){
    state.roomId=message.roomId;
    log('Entered '+message.mapId+' ('+message.roomType+' instance)');
   }

   if(message.type==='chat'){
    log('['+message.channel+'] '+message.from+': '+message.text);
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
  if(state.socket&&state.socket.readyState===WebSocket.OPEN)tick();
  else connect();
 }

 window.addEventListener('online',resumeConnection);
 window.addEventListener('pageshow',resumeConnection);
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)resumeConnection();
 });

 window.MinispaceOnline={connect,send,tick,state};

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
