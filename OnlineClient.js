
/* Minispace Online: opt-in WebSocket presence, chat and friend requests.
   Set window.MINISPACE_SERVER_URL to your deployed wss:// endpoint before this script. */
(function(){
 const state={socket:null,id:null,players:new Map(),connected:false,channel:'global'};
 const $=id=>document.getElementById(id);
 function panel(){
  if($('online-panel'))return;
  const el=document.createElement('section');el.id='online-panel';
  el.innerHTML=`<header>MINISPACE ONLINE <span id="online-status">OFFLINE</span></header>
  <div id="online-count">0 pilots nearby</div><div id="online-roster"></div>
  <div class="online-actions"><input id="online-friend-name" maxlength="16" placeholder="Pilot callsign"><button id="online-add-friend">ADD FRIEND</button></div>
  <div id="online-chat-log" aria-live="polite"></div>
  <div class="online-actions"><select id="online-channel"><option value="global">Global</option><option value="local">Local</option><option value="fleet">Fleet</option></select><input id="online-chat-input" maxlength="240" placeholder="Message"><button id="online-send">SEND</button></div>`;
  document.body.appendChild(el);
  $('online-add-friend').onclick=()=>send({type:'friend-request',name:$('online-friend-name').value});
  $('online-send').onclick=chat;
  $('online-chat-input').addEventListener('keydown',e=>{if(e.key==='Enter')chat()});
 }
 function send(m){if(state.socket&&state.socket.readyState===1)state.socket.send(JSON.stringify(m));}
 function log(line){const box=$('online-chat-log');if(!box)return;const d=document.createElement('div');d.textContent=line;box.appendChild(d);box.scrollTop=box.scrollHeight;while(box.children.length>60)box.firstChild.remove();}
 function chat(){const input=$('online-chat-input');if(input.value.trim())send({type:'chat',channel:$('online-channel').value,text:input.value});input.value='';}
 function render(){if(!$('online-roster'))return;const arr=[...state.players.values()];$('online-count').textContent=arr.length+' pilots online';$('online-roster').replaceChildren();arr.slice(0,12).forEach(p=>{const row=document.createElement('div');row.className='online-pilot';const name=document.createElement('span');name.textContent=p.name+' · '+p.ship;const btn=document.createElement('button');btn.textContent='FRIEND';btn.onclick=()=>send({type:'friend-request',name:p.name});row.append(name,btn);$('online-roster').append(row);});}
 function connect(){
  panel();const url=window.MINISPACE_SERVER_URL;
  if(!url){$('online-status').textContent='SERVER NOT CONFIGURED';return;}
  try{state.socket=new WebSocket(url);}catch(e){$('online-status').textContent='CONNECTION ERROR';return;}
  state.socket.onopen=()=>{state.connected=true;$('online-status').textContent='CONNECTED';send({type:'hello',name:localStorage.getItem('minispace_pilot_name')||'Pilot'});};
  state.socket.onclose=()=>{$('online-status').textContent='DISCONNECTED';state.connected=false;};
  state.socket.onerror=()=>{$('online-status').textContent='CONNECTION ERROR';};
  state.socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return;}
   if(m.type==='welcome'){state.id=m.id;(m.players||[]).forEach(p=>state.players.set(p.id,p));render();}
   if(m.type==='player'){state.players.set(m.player.id,m.player);render();}
   if(m.type==='player-left'){state.players.delete(m.id);render();}
   if(m.type==='chat')log('['+m.channel+'] '+m.from+': '+m.text);
   if(m.type==='friend-request')log('Friend request from '+m.from+' (use /accept '+m.from+' in chat is not yet enabled)');
   if(m.type==='friend-added')log('You and '+m.name+' are now friends.');
  };
 }
 function tick(){
  if(state.socket?.readyState===1&&window.playerShip){
   const s=window.playerShip;
   send({type:'state',x:Number(s.x)||0,y:Number(s.y)||0,angle:Number(s.angle)||0,ship:s.className||s.type||'Ship',system:$('system-text')?.textContent||'Unknown'});
  }
 }
 window.MinispaceOnline={connect,send,state};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{panel();connect();setInterval(tick,250);});
 else{panel();connect();setInterval(tick,250);}
})();
