
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 8080);
const server = http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'minispace-online'}));}
  res.writeHead(200,{'content-type':'text/plain'});res.end('Minispace Online server');
});
const wss = new WebSocket.Server({server});
const players = new Map(), friends = new Map();
const zones = [{id:'high-sec',name:'High Security',x:0,y:0,radius:1800,pvp:false},{id:'low-sec',name:'Low Security',x:2600,y:0,radius:1800,pvp:true},{id:'null-sec',name:'Frontier',x:0,y:2600,radius:2200,pvp:true}];
function zoneAt(x,y){return zones.find(z=>Math.hypot(x-z.x,y-z.y)<=z.radius)||{id:'deep-space',name:'Deep Space',pvp:true};}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function broadcast(obj,except){const raw=JSON.stringify(obj);for(const p of players.values())if(p.ws!==except&&p.ws.readyState===WebSocket.OPEN)p.ws.send(raw);}
function safeText(s,n=240){return String(s||'').replace(/[<>]/g,'').slice(0,n);}
wss.on('connection',ws=>{
 const id=crypto.randomUUID();
 const p={id,ws,name:'Pilot',x:0,y:0,angle:0,ship:'Unknown',system:'High-sec 1.0',zone:'high-sec',last:Date.now()};
 players.set(id,p); friends.set(id,new Set());
 send(ws,{type:'welcome',id,players:[...players.values()].filter(q=>q.id!==id).map(({ws,...q})=>q),zones});
 ws.on('message',buf=>{
  let m;try{m=JSON.parse(buf.toString())}catch{return;}
  if(m.type==='hello'){p.name=safeText(m.name,16)||'Pilot';}
  if(m.type==='state'){
   p.x=Number.isFinite(+m.x)?Math.max(-10000,Math.min(10000,+m.x)):p.x;
   p.y=Number.isFinite(+m.y)?Math.max(-10000,Math.min(10000,+m.y)):p.y;
   p.angle=Number(m.angle)||0;p.ship=safeText(m.ship,32);p.system=safeText(m.system,48);
   const z=zoneAt(p.x,p.y);p.zone=z.id;p.pvp=z.pvp;p.last=Date.now();
   broadcast({type:'player',player:{id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,ship:p.ship,system:p.system,zone:p.zone,pvp:p.pvp}},ws);
  }
  if(m.type==='chat'){
   const text=safeText(m.text,240).trim();if(!text)return;
   const channel=['global','local','fleet','whisper'].includes(m.channel)?m.channel:'global';
   if(channel==='whisper'){const target=[...players.values()].find(q=>q.name.toLowerCase()===safeText(m.to,16).toLowerCase());if(target)send(target.ws,{type:'chat',from:p.name,channel,text});send(ws,{type:'chat',from:p.name,channel,text,to:m.to});}
   else broadcast({type:'chat',from:p.name,channel,text,zone:p.zone});
  }
  if(m.type==='friend-request'){
   const target=[...players.values()].find(q=>q.name.toLowerCase()===safeText(m.name,16).toLowerCase());
   if(target&&target.id!==id)send(target.ws,{type:'friend-request',from:p.name});
  }
  if(m.type==='friend-accept'){const other=[...players.values()].find(q=>q.name.toLowerCase()===safeText(m.name,16).toLowerCase());if(other){friends.get(id).add(other.id);friends.get(other.id)?.add(id);send(ws,{type:'friend-added',name:other.name});send(other.ws,{type:'friend-added',name:p.name});}}
 });
 ws.on('close',()=>{players.delete(id);friends.delete(id);broadcast({type:'player-left',id});});
});
setInterval(()=>{const now=Date.now();for(const [id,p] of players)if(now-p.last>45000){send(p.ws,{type:'ping'});}},15000);
server.listen(PORT,()=>console.log(`Minispace Online listening on ${PORT}`));
