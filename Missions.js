// Missions.js - ship-scaled contracts and pirate encounters.
class MissionManager {
  constructor() {
    this.activeMission = null;
    this.systemNames = ['Kestrel Reach', 'Vanta Expanse', 'Orion Scar', 'Cinder Drift', 'Nexus Verge'];
    this.availableMissions = [];
    this.generateMissions();
  }
  generateMissions() {
    const systems = this.systemNames.slice().sort(() => Math.random() - 0.5);
    this.availableMissions = [
      { id:'easy', difficulty:'Easy', title:'Clear the Outpost', targetCount:2, rewardIsk:75000, enemyShield:55, enemyArmor:65, enemyStructure:75, enemyDamage:1.5, description:'Destroy 2 lightly armed pirate ships.' },
      { id:'medium', difficulty:'Medium', title:'Break the Raider Patrol', targetCount:4, rewardIsk:180000, enemyShield:85, enemyArmor:95, enemyStructure:110, enemyDamage:2.5, description:'Destroy 4 pirate raiders protecting a supply route.' },
      { id:'hard', difficulty:'Hard', title:'Disrupt the Pirate Wing', targetCount:6, rewardIsk:350000, enemyShield:115, enemyArmor:130, enemyStructure:145, enemyDamage:4, description:'Destroy 6 hardened pirate ships. Expect heavier resistance.' }
    ].map((m,i)=>Object.assign({},m,{systemName:systems[i]}));
  }
  shipRating(ship) {
    if (!ship) return 1;
    const cls=ship.className||'';
    const classPower = cls==='Combat Frigate'?1:cls==='Carrier'?3.8:cls==='Siege Cruiser'?2.1:cls==='Siege Battleship'?3.2:cls==='Siege Capital'?4.5:cls==='Explorer Cruiser'?1.35:1;
    const mods=ship.moduleLevels||{};
    const levels=Object.keys(mods).reduce((n,k)=>n+Math.max(0,(Number(mods[k])||1)-1),0);
    return Math.max(1,classPower + levels*0.12);
  }
  shipEnemyProfile(ship) {
    const cls=ship&&ship.className||'Combat Frigate';
    if (cls==='Carrier' || cls==='Siege Capital') return { tier:3, name:'Pirate Carrier', make:(x,y)=>new NpcCarrier(x,y) };
    if (cls==='Siege Battleship') return { tier:2, name:'Pirate Battleship', make:(x,y)=>new window.SiegeBattleshipShip(x,y) };
    if (cls==='Siege Cruiser' || cls==='Explorer Cruiser') return { tier:1, name:'Pirate Cruiser', make:(x,y)=>new window.SiegeCruiserShip(x,y) };
    return { tier:0, name:'Pirate Frigate', make:(x,y)=>new CombatFrigate(x,y) };
  }
  acceptMission(id, ship) {
    if (this.activeMission) return false;
    const source=this.availableMissions.find(m=>m.id===id); if(!source)return false;
    const rating=this.shipRating(ship);
    const profile=this.shipEnemyProfile(ship);
    const scale=1+(rating-1)*0.24;
    const rewardScale=1+(rating-1)*0.22;
    this.activeMission=Object.assign({},source,{
      accepted:true, spawnedFleet:false, fleet:[], completed:false, returned:false, kills:0,
      shipClass:ship&&ship.className||'Combat Frigate', shipRating:rating,
      shipTier:profile.tier, enemyClass:profile.name, targetCount:Math.max(1,source.targetCount-profile.tier), difficultyScale:scale,
      rewardIsk:Math.round(source.rewardIsk*rewardScale),
      enemyShield:Math.round(source.enemyShield*scale), enemyArmor:Math.round(source.enemyArmor*scale),
      enemyStructure:Math.round(source.enemyStructure*scale), enemyDamage:source.enemyDamage*scale
    });
    return true;
  }
  spawnMissionFleet(asteroidBeltRef, playerShip) {
    const m=this.activeMission; if(!m||m.spawnedFleet||!playerShip)return;
    m.spawnedFleet=true; m.fleet=[];
    const profile=this.shipEnemyProfile({className:m.shipClass});
    const difficultyFactor=m.difficulty==='Easy'?0.68:(m.difficulty==='Medium'?0.88:1.08);
    const upgradeFactor=1+Math.max(0,(m.shipRating||1)-({ 'Combat Frigate':1, 'Explorer Cruiser':1.35, 'Siege Cruiser':2.1, 'Siege Battleship':3.2, 'Carrier':3.8, 'Siege Capital':4.5 }[m.shipClass]||1))*0.025;
    const spawnRadius=m.difficulty==='Easy'?420:(m.difficulty==='Medium'?520:640);
    for(let i=0;i<m.targetCount;i++){
      const angle=(Math.PI*2*i/m.targetCount)+Math.random()*0.22, dist=spawnRadius+Math.random()*180;
      const x=playerShip.x+Math.cos(angle)*dist, y=playerShip.y+Math.sin(angle)*dist;
      let enemy=profile.make(x,y);
      // Mission NPC Carriers keep their complete six-drone wing.
      // Exhaust effects remain disabled on these NPC escorts to limit
      // rendering cost while testing the full drone count.
      if (profile.tier===3 && Array.isArray(enemy.drones)) {
        enemy.drones.forEach(entry => {
          if (entry && entry.ship) {
            entry.ship.disableThrusterEffects = true;
            entry.ship.particles = [];
            entry.ship.missileTrails = [];
          }
        });
      }
      enemy.displayName=profile.name; enemy.isPirate=true; enemy.faction='pirate';
      enemy.isMissionTarget=true; enemy.missionTarget=true; enemy.docked=false; enemy.vx=0; enemy.vy=0;
      enemy.angle=Math.atan2(playerShip.y-enemy.y,playerShip.x-enemy.x);
      enemy.isPirate=true; enemy.ignoreStationBoss=true; enemy.currentTarget=playerShip;
      // Scale each pirate hull to the mission difficulty and the upgrades on the ship
      // used to accept the contract. This keeps capital-vs-capital fights meaningful.
      const hullScale=difficultyFactor*upgradeFactor;
      ['Shield','Armor','Structure'].forEach(kind=>{
        const maxKey='max'+kind, currentKey=kind.toLowerCase();
        const base=Number(enemy[maxKey]||enemy[currentKey]||100);
        enemy[maxKey]=Math.max(1,Math.round(base*hullScale));
        enemy[currentKey]=enemy[maxKey];
      });
      if (enemy.maxShield!==undefined) enemy.shield=enemy.maxShield;
      if (enemy.maxArmor!==undefined) enemy.armor=enemy.maxArmor;
      if (enemy.maxStructure!==undefined) enemy.structure=enemy.maxStructure;
      if (profile.tier===0) {
        enemy.shield=enemy.maxShield=m.enemyShield;
        enemy.armor=enemy.maxArmor=m.enemyArmor;
        enemy.structure=enemy.maxStructure=m.enemyStructure;
        enemy.missileDamage=m.enemyDamage;
      } else {
        if (enemy.missileDamage!==undefined) enemy.missileDamage=Math.max(2,enemy.missileDamage*hullScale);
        if (enemy.weaponDamage!==undefined) enemy.weaponDamage=Math.max(2,enemy.weaponDamage*hullScale);
      }
      enemy.weaponRange=enemy.weaponRange||900; enemy.scramblerRange=enemy.scramblerRange||enemy.weaponRange;
      enemy.autoplay=true;
      m.fleet.push(enemy);
    }
    m.enemyClass=profile.name;
  }
  updateMissionFleet(playerShip) {
    const m=this.activeMission; if(!m||!m.spawnedFleet||m.completed)return;
    m.fleet.forEach(enemy=>{
      if(!enemy||enemy.structure<=0||!playerShip||playerShip.docked)return;
      const d=Math.hypot(playerShip.x-enemy.x,playerShip.y-enemy.y);
      if(d<1400){enemy.docked=false;enemy.currentTarget=playerShip;enemy.update(null,playerShip,false,[],true);}
      else {const a=Math.atan2(playerShip.y-enemy.y,playerShip.x-enemy.x);enemy.vx=(enemy.vx+Math.cos(a)*0.04)*0.96;enemy.vy=(enemy.vy+Math.sin(a)*0.04)*0.96;enemy.x+=enemy.vx;enemy.y+=enemy.vy;}
    });
    this.checkMissionCompletion();
  }
  getLivingEnemies(){return !this.activeMission||!Array.isArray(this.activeMission.fleet)?[]:this.activeMission.fleet.filter(e=>e&&e.structure>0);}
  drawMissionFleet(ctx){this.getLivingEnemies().forEach(enemy=>{if(typeof enemy.draw==='function')enemy.draw(ctx);ctx.save();ctx.strokeStyle='#ff5b62';ctx.lineWidth=2;ctx.beginPath();ctx.arc(enemy.x,enemy.y,34,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ff777d';ctx.font='bold 13px Courier New';ctx.textAlign='center';ctx.fillText((enemy.displayName||'PIRATE RAIDER').toUpperCase(),enemy.x,enemy.y-48);const hp=Math.max(0,Math.min(1,(enemy.shield+enemy.armor+enemy.structure)/Math.max(1,enemy.maxShield+enemy.maxArmor+enemy.maxStructure)));ctx.fillStyle='#35191d';ctx.fillRect(enemy.x-28,enemy.y-39,56,5);ctx.fillStyle='#f85149';ctx.fillRect(enemy.x-28,enemy.y-39,56*hp,5);ctx.restore();});}
  checkMissionCompletion(){
    const m=this.activeMission;if(!m||!m.spawnedFleet||m.completed)return false;
    m.fleet.forEach(enemy=>{if(enemy&&enemy.structure<=0&&!enemy._missionXpAwarded){enemy._missionXpAwarded=true;m.kills++;if(typeof window.awardPlayerXP==='function')window.awardPlayerXP('combat',m.difficulty==='Easy'?65:(m.difficulty==='Medium'?100:145),'Pirate destroyed');}});
    if(m.fleet.every(e=>!e||e.structure<=0)){m.completed=true;if(typeof window.showCorpNotification==='function')window.showCorpNotification('Mission complete! Return through the green space tear to claim your reward.');if(typeof updateMissionsUI==='function')updateMissionsUI();if(typeof saveGameSession==='function')saveGameSession();return true;}return false;
  }
  claimReward(playerData){
    if(!this.activeMission||!this.activeMission.completed||!this.activeMission.returned)return 0;
    const reward=Math.round(this.activeMission.rewardIsk*(typeof window.getMissionRewardTalentMultiplier==='function'?window.getMissionRewardTalentMultiplier():1));playerData.isk=(playerData.isk||0)+reward;
    // The station boss level-up chip is also a rare mission reward: exactly a 1-in-20 roll.
    const chipDrop=Math.random()<0.05;if(chipDrop)playerData.chips=(playerData.chips||0)+1;
    this.activeMission=null;this.generateMissions();return {reward:reward,chip:chipDrop};
  }
}
