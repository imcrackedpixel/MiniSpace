// AutoplayManager.js - mining, exploration and full-difficulty combat mission loops.
const AUTOPLAY_MINING=['Mining Frigate','Mining Barge','Command Ship','Mining Capital'];
const AUTOPLAY_EXPLORER=['Exploration Frigate','Improved Explorer Frigate','Explorer Cruiser'];
const AUTOPLAY_COMBAT=['Combat Frigate','Carrier','Siege Cruiser','Siege Battleship','Siege Capital'];
const AUTOPLAY_ALL=AUTOPLAY_MINING.concat(AUTOPLAY_EXPLORER,AUTOPLAY_COMBAT);
function canAutoplay(cls){return AUTOPLAY_ALL.includes(cls);}
function isExplorerHull(cls){return AUTOPLAY_EXPLORER.includes(cls);}
function isCombatAutoplayHull(cls){return AUTOPLAY_COMBAT.includes(cls);}
class AutoplayManager{
 constructor(playerDataRef,stationRef,beltRef,debrisFieldRef){this.playerData=playerDataRef;this.station=stationRef;this.belt=beltRef;this.debrisField=debrisFieldRef;this.isAutoplay=false;this.combatMode=false;this.combatPhase='';}
 blockReason(ship){if(!ship)return'No ship.';if(!canAutoplay(ship.className))return'Autoplay is not supported by this ship.';if(typeof inPublicSpace==='function'&&inPublicSpace()&&!(typeof isFrontierSpace==='function'&&isFrontierSpace()))return'Autoplay is not available in the public Trade Hub.';return null;}
 toggle(){
  if(this.isAutoplay){this.isAutoplay=false;this.combatMode=false;this.combatPhase='';if(typeof isDockingRequested!=='undefined')isDockingRequested=false;return;}
  const ship=typeof playerShip!=='undefined'?playerShip:null;
  const reason=this.blockReason(ship);
  if(reason){window.showCorpNotification(reason);return;}
  this.isAutoplay=true;
  this.combatMode=isCombatAutoplayHull(ship.className);
  if(this.combatMode && !this.playerData.offensiveMode && typeof window.toggleOffensiveMode==='function') window.toggleOffensiveMode();
  if(this.combatMode){
   const active=missionManager&&missionManager.activeMission;
   if(active&&active.returned&&typeof window.claimMissionReward==='function')window.claimMissionReward();
   
   if(!ship.docked){
    this.combatPhase='docking';
    isDockingRequested=true;
    targetMovePos={x:this.station.x,y:this.station.y};
    window.showCorpNotification('Combat autoplay ON: returning to station to prepare an Easy mission.');
    return;
   }
   this.startEasyMissionAtStation();
   return;
  }
  if(ship.docked)autoUndockTimer=60;
  else if(typeof window.showCorpNotification==='function'){
   const label=isExplorerHull(ship.className)?'relic exploration':(isCombatAutoplayHull(ship.className)?'Easy mission combat':'mining');
   window.showCorpNotification('Autoplay ON: '+label+' engaged.');
  }
 }
 startEasyMissionAtStation(){
  const ship=typeof playerShip!=='undefined'?playerShip:null;
  if(!ship||!ship.docked)return;
  const active=missionManager&&missionManager.activeMission;
  if(!active){
   // Pick from every available difficulty and mission type. Shuffle first so
   // the autoplay loop does not keep favouring the same contract after a reload.
   const choices=(missionManager.availableMissions||[]).filter(m=>m&&m.id&&m.difficulty);
   const selected=choices.length?choices[Math.floor(Math.random()*choices.length)]:null;
   if(!selected||!missionManager.acceptMission(selected.id,ship)){
    this.isAutoplay=false;this.combatMode=false;this.combatPhase='';
    if(typeof window.showCorpNotification==='function')window.showCorpNotification('No missions are currently available. Autoplay stopped.');
    if(typeof syncAutoplayButton==='function')syncAutoplayButton();
    return;
   }
   missionManager.activeMission.autoplayContract=true;
   if(mapManager&&mapManager.missionEntryGate)mapManager.missionEntryGate.destinationName=missionManager.activeMission.systemName;
   saveGameSession();updateMissionsUI();
  }
  this.isAutoplay=true;
  this.combatMode=true;
  this.combatPhase='travel';
  autoUndockTimer=180;
  if(typeof syncAutoplayButton==='function')syncAutoplayButton();
  window.showCorpNotification('Mission autoplay ON: '+missionManager.activeMission.difficulty+' '+missionManager.activeMission.title+'. Undocking shortly.');
 }
 onCombatDocked(){
  if(!this.isAutoplay||!this.combatMode||this.combatPhase!=='docking')return;
  this.isAutoplay=true;this.combatMode=true;
  const active=missionManager&&missionManager.activeMission;
  if(active&&active.returned&&typeof window.claimMissionReward==='function'){
   window.claimMissionReward();
  }
  this.startEasyMissionAtStation();
  if(typeof syncAutoplayButton==='function')syncAutoplayButton();
 }

 oreList(belt){return belt&&typeof belt.getEntities==='function'?belt.getEntities():(belt&&belt.entities?belt.entities:[]);}
 relicList(){const f=this.debrisField;return f&&typeof f.getEntities==='function'?f.getEntities():(f&&f.entities?f.entities:[]);}
 nearest(list,ship){let best=null,bd=Infinity;for(const e of list){if(!e||!(e.oreYield>0)||isNearGate(e))continue;const d=Math.hypot(e.x-ship.x,e.y-ship.y);if(d<bd){bd=d;best=e;}}return best;}
 moveShip(ship,pos,target,belt){
  const c=ship.className;
  // Capital hulls take the asteroid belt as their fifth update argument.
  if(c==='Command Ship'||c==='Mining Capital'){
   ship.update(pos,target,false,false,belt);
   return;
  }
  // Explorer hulls inherit the mining-frigate flight controller.
  if(c==='Improved Explorer Frigate'||c==='Explorer Cruiser'){
   ship.update(pos,target,false,true);
   if(typeof ship.updateGun==='function')ship.updateGun([]);
   return;
  }
  // These hulls use the fourth argument to enable autonomous movement.
  if(c==='Mining Frigate'||c==='Mining Barge'||c==='Exploration Frigate'){
   ship.update(pos,target,false,true);
   return;
  }
  ship.update(pos,target,false);
 }
 explorerCloak(ship,target){if(typeof ship.toggleCloak!=='function')return;let want;if(!target)want=true;else{const d=Math.hypot(target.x-ship.x,target.y-ship.y),hr=typeof ship.hackRange==='function'?ship.hackRange(target):60;if(d<=hr+30)want=false;else if(d>hr+80)want=true;else want=!!ship.isCloaked;}if(!!ship.isCloaked!==want){if(ship===playerShip&&typeof window.toggleExplorationCloak==='function')window.toggleExplorationCloak();else ship.toggleCloak();}}
 combatUpdate(ship){
  if(!this.playerData.offensiveMode){
   this.isAutoplay=false;this.combatMode=false;this.combatPhase='';
   if(typeof window.showCorpNotification==='function')window.showCorpNotification('Combat autoplay paused: switch OFFENSIVE ON to allow weapons fire.');
   if(typeof syncAutoplayButton==='function')syncAutoplayButton();
   return;
  }
  if(this.combatPhase==='docking'){
   const stationPos={x:this.station.x,y:this.station.y};
   if(Math.hypot(ship.x-this.station.x,ship.y-this.station.y)<150){performDock();return;}
   targetMovePos=stationPos;
   if(ship.className==='Combat Frigate')ship.update(targetMovePos,null,false,[],true);
   else if(ship.className==='Carrier')ship.update(targetMovePos,null,false,false,[],true);
   else ship.update(targetMovePos,null,false,[]);
   return;
  }
  const mission=missionManager&&missionManager.activeMission;
  if(typeof isFrontierSpace==='function'&&isFrontierSpace()){
   const currentId=mapManager&&mapManager.currentMapId;
   const enemies=publicNpcManager&&Array.isArray(publicNpcManager.publicNpcMiners)?publicNpcManager.publicNpcMiners.filter(n=>n&&n.isAlive&&n.mapId===currentId&&n.structure>0):[];
   this.combatPhase='frontier-hunt';targetMovePos=null;
   if(ship.className==='Combat Frigate')ship.update(null,null,false,enemies,true);
   else if(ship.className==='Carrier')ship.update(null,null,false,false,enemies,true);
   else ship.update(null,null,false,enemies);
   return;
  }
  if(!mission){this.combatPhase='accept';return;}
  const gate=mapManager.missionEntryGate,ret=mapManager.missionReturnGate;
  if(typeof inMissionSpace==='function'&&inMissionSpace()){
   if(mission.completed){this.combatPhase='return';targetMovePos={x:ret.x,y:ret.y};}
   else if(mission.type==='salvage'||mission.type==='recon'){this.combatPhase=mission.type;targetMovePos=missionManager.getAutoplayTarget();}
   else{this.combatPhase='fight';targetMovePos=null;}
   const enemies=missionManager.getLivingEnemies();
   if(ship.className==='Combat Frigate')ship.update(targetMovePos,null,false,enemies,true);
   else if(ship.className==='Carrier')ship.update(targetMovePos,null,false,false,enemies,true);
   else ship.update(targetMovePos,null,false,enemies);
  }else{
   if(mission.returned){
    this.combatPhase='docking';
    const stationPos={x:this.station.x,y:this.station.y};
    if(Math.hypot(ship.x-this.station.x,ship.y-this.station.y)<150){performDock();return;}
    targetMovePos=stationPos;
   }else{
    this.combatPhase='travel';targetMovePos={x:gate.x,y:gate.y};
   }
   const enemies=[];
   if(ship.className==='Combat Frigate')ship.update(targetMovePos,null,false,enemies,true);
   else if(ship.className==='Carrier')ship.update(targetMovePos,null,false,false,enemies,true);
   else ship.update(targetMovePos,null,false,enemies);
  }
 }
 onMissionDocked(){if(!this.isAutoplay||!this.combatMode)return;this.combatPhase='accept';this.startEasyMissionAtStation();window.showCorpNotification('Mission autoplay: next contract queued.');if(typeof syncAutoplayButton==='function')syncAutoplayButton();}
 update(ship,activeBelt){if(!this.isAutoplay||!ship)return;const reason=this.blockReason(ship);if(reason){this.isAutoplay=false;this.combatMode=false;this.combatPhase='';window.showCorpNotification(reason);if(typeof syncAutoplayButton==='function')syncAutoplayButton();return;}if(ship.docked)return;if(this.combatMode){this.combatUpdate(ship);return;}
  const belt=activeBelt||this.belt,explorer=isExplorerHull(ship.className),maxCap=ship.maxCargo||200,full=(ship.cargo||0)>=maxCap-0.5;
  if(full){const dist=Math.hypot(this.station.x-ship.x,this.station.y-ship.y);if(dist<200)performDock(true);else this.moveShip(ship,{x:this.station.x,y:this.station.y},null,belt);return;}
  const target=this.nearest(explorer?this.relicList():this.oreList(belt),ship);if(explorer)this.explorerCloak(ship,target);
  const cargoBefore=Number(ship.cargo)||0;
  this.moveShip(ship,null,target,belt);
  const mined=Math.max(0,(Number(ship.cargo)||0)-cargoBefore);
  if(mined>0&&window.mapManager&&window.mapManager.currentMapId==='private_highsec'){
   const keep=mined*0.45,reduce=mined-keep;
   ship.cargo=Math.max(0,(Number(ship.cargo)||0)-reduce);
   const map=ship.cargoByOre;
   if(map&&typeof map==='object'){
    const key=ship.oreType||Object.keys(map).find(k=>Number(map[k])>0);
    if(key&&Number(map[key])>0)map[key]=Math.max(0,Number(map[key])-reduce);
   }
  }
 }
}
