
/* MiniSpace Online: multiplayer presence, chat and friends */
(function(){
 const state={
  socket:null,
  id:null,
  players:new Map(),
  connected:false,
  channel:'global'
 };

 const $=id=>document.getElementById(id);

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

 function connect(){
  panel();

  const url=window.MINISPACE_SERVER_URL;

  if(!url){
   $('online-status').textContent='SERVER NOT CONFIGURED';
   return;
  }

  try{
   state.socket=new WebSocket(url);
  }catch(error){
   $('online-status').textContent='CONNECTION ERROR';
   return;
  }

  state.socket.onopen=()=>{
   state.connected=true;
   $('online-status').textContent='CONNECTED';

   send({
    type:'hello',
    name:localStorage.getItem('minispace_pilot_name')||'Pilot'
   });
  };

  state.socket.onclose=()=>{
   $('online-status').textContent='DISCONNECTED';
   state.connected=false;
  };

  state.socket.onerror=()=>{
   $('online-status').textContent='CONNECTION ERROR';
  };

  state.socket.onmessage=e=>{
   let message;

   try{
    message=JSON.parse(e.data);
   }catch{
    return;
   }

   if(message.type==='welcome'){
    state.id=message.id;

    (message.players||[]).forEach(p=>{
     state.players.set(p.id,p);
    });

    render();
   }

   if(message.type==='player'){
    state.players.set(
     message.player.id,
     message.player
    );

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
  if(state.socket?.readyState===1&&window.playerShip){
   const ship=window.playerShip;

   send({
    type:'state',
    x:Number(ship.x)||0,
    y:Number(ship.y)||0,
    angle:Number(ship.angle)||0,
    ship:ship.className||ship.type||'Ship',
    system:$('system-text')?.textContent||'Unknown'
   });
  }
 }

 window.MinispaceOnline={
  connect,
  send,
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
