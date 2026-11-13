import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const canvas=document.querySelector('#space');
const loading=document.querySelector('#loading');
const status=document.querySelector('#flight-status');
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x050a12);
scene.fog=new THREE.FogExp2(0x071321,0.00042);
const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,0.1,18000);
camera.position.set(0,900,1250);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;

scene.add(new THREE.HemisphereLight(0x9acbff,0x17202b,1.45));
const keyLight=new THREE.DirectionalLight(0xb6e2ff,2.5);
keyLight.position.set(-700,1200,500);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);scene.add(keyLight);
const tealLight=new THREE.PointLight(0x20d6c2,85,1700);tealLight.position.set(300,100,100);scene.add(tealLight);

const world=new THREE.Group();scene.add(world);
const starGeo=new THREE.BufferGeometry(),starPos=[];
for(let i=0;i<1800;i++){starPos.push((Math.random()-.5)*12000,(Math.random()-.5)*6500,(Math.random()-.5)*12000)}
starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPos,3));
const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xc9e8ff,size:8,sizeAttenuation:true,transparent:true,opacity:.82}));
scene.add(stars);

function makeNebula(){
 const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d');
 const grad=g.createRadialGradient(256,256,8,256,256,250);
 grad.addColorStop(0,'rgba(37,130,160,.23)');grad.addColorStop(.4,'rgba(46,65,145,.12)');grad.addColorStop(1,'rgba(0,0,0,0)');
 g.fillStyle=grad;g.fillRect(0,0,512,512);
 const tex=new THREE.CanvasTexture(c);const m=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 const s=new THREE.Sprite(m);s.position.set(-1100,650,-1900);s.scale.set(3000,2100,1);scene.add(s);
}
makeNebula();

const floor=new THREE.Mesh(new THREE.CircleGeometry(3600,96),new THREE.MeshBasicMaterial({color:0x0a1c29,transparent:true,opacity:.12,side:THREE.DoubleSide}));
floor.rotation.x=-Math.PI/2;floor.position.y=-160;world.add(floor);
const grid=new THREE.GridHelper(7000,70,0x24506a,0x163448);grid.position.y=-155;grid.material.transparent=true;grid.material.opacity=.18;world.add(grid);

function mat(color,metalness=.35,roughness=.48,emissive=0x000000,intensity=0){return new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:intensity})}
const station=new THREE.Group();station.position.set(0,0,-680);world.add(station);
const core=new THREE.Mesh(new THREE.CylinderGeometry(115,145,340,16),mat(0x526d7c,.8,.36));core.castShadow=true;core.receiveShadow=true;station.add(core);
const coreBand=new THREE.Mesh(new THREE.CylinderGeometry(155,155,32,32),mat(0x8ca7ae,.7,.3,0x1c5260,.7));coreBand.position.y=70;station.add(coreBand);
for(let j=0;j<2;j++){const ring=new THREE.Mesh(new THREE.TorusGeometry(j?330:245,j?17:13,10,72),mat(j?0x3d758b:0x7897a5,.75,.3,j?0x0c536c:0x153c50,.8));ring.rotation.x=Math.PI/2;ring.position.y=j?10:-35;ring.castShadow=true;station.add(ring)}
for(let i=0;i<8;i++){const a=i*Math.PI/4;const arm=new THREE.Mesh(new THREE.BoxGeometry(210,34,58),mat(0x536c78,.7,.4));arm.position.set(Math.cos(a)*190,0,Math.sin(a)*190);arm.rotation.y=-a;arm.castShadow=true;station.add(arm);const pod=new THREE.Mesh(new THREE.BoxGeometry(90,55,110),mat(0x263f50,.65,.35,0x0a3545,.7));pod.position.set(Math.cos(a)*285,4,Math.sin(a)*285);station.add(pod)}
const stationGlow=new THREE.PointLight(0x45bde0,90,950);stationGlow.position.set(0,90,0);station.add(stationGlow);
const stationLabel=new THREE.Sprite(new THREE.SpriteMaterial({map:textTexture('ORBITAL STATION', '#a9eaff'),transparent:true,depthTest:false}));
stationLabel.position.set(0,300,0);stationLabel.scale.set(390,48,1);station.add(stationLabel);

function textTexture(text,color){const c=document.createElement('canvas');c.width=512;c.height=64;const x=c.getContext('2d');x.font='bold 28px sans-serif';x.textAlign='center';x.fillStyle=color;x.fillText(text,256,42);return new THREE.CanvasTexture(c)}
function asteroid(x,z,r,seed){const geo=new THREE.IcosahedronGeometry(r,1);const p=geo.attributes.position;for(let i=0;i<p.count;i++){const f=1+Math.sin(i*12.989+seed)*.12+Math.cos(i*4.1+seed)*.09;p.setXYZ(i,p.getX(i)*f,p.getY(i)*f,p.getZ(i)*f)}geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat(seed%2?0x52616b:0x384955,.25,.92));mesh.position.set(x,r*.55,z);mesh.rotation.set(Math.random(),Math.random(),Math.random());mesh.castShadow=true;mesh.receiveShadow=true;world.add(mesh);return mesh}
const rocks=[];for(let i=0;i<46;i++){const a=Math.random()*Math.PI*2,d=650+Math.random()*1700;rocks.push(asteroid(Math.cos(a)*d,Math.sin(a)*d-700,22+Math.random()*75,i))}
for(let i=0;i<18;i++){const a=i/18*Math.PI*2;const d=1450+Math.random()*160;asteroid(Math.cos(a)*d,Math.sin(a)*d-650,45+Math.random()*95,i+70)}

const ship=new THREE.Group();world.add(ship);
const hullMat=mat(0x8aaab6,.8,.28,0x123e46,.45),darkMat=mat(0x203b4b,.72,.3),glassMat=new THREE.MeshStandardMaterial({color:0x55d9e8,metalness:.6,roughness:.12,emissive:0x1aa8bd,emissiveIntensity:1.4});
const hullShape=new THREE.Shape();hullShape.moveTo(0,150);hullShape.lineTo(52,-70);hullShape.lineTo(30,-118);hullShape.lineTo(0,-92);hullShape.lineTo(-30,-118);hullShape.lineTo(-52,-70);hullShape.closePath();
const hullGeo=new THREE.ExtrudeGeometry(hullShape,{depth:24,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:8,bevelThickness:8});
hullGeo.rotateX(Math.PI/2);hullGeo.rotateY(Math.PI);hullGeo.translate(0,18,0);
const hull=new THREE.Mesh(hullGeo,hullMat);hull.castShadow=true;ship.add(hull);
const cockpit=new THREE.Mesh(new THREE.SphereGeometry(24,16,12),glassMat);cockpit.scale.set(.75,.5,1.5);cockpit.position.set(0,38,-45);ship.add(cockpit);
for(const side of [-1,1]){const wing=new THREE.Mesh(new THREE.BoxGeometry(20,12,110),darkMat);wing.position.set(side*48,6,10);wing.rotation.y=side*.12;wing.castShadow=true;ship.add(wing);const engine=new THREE.Mesh(new THREE.CylinderGeometry(10,14,55,12),mat(0x385b68,.6,.35,0x18a8bd,1.2));engine.rotation.x=Math.PI/2;engine.position.set(side*28,12,90);ship.add(engine);const flame=new THREE.Mesh(new THREE.ConeGeometry(10,65,12),new THREE.MeshBasicMaterial({color:0x36d9ff,transparent:true,opacity:.75}));flame.rotation.x=-Math.PI/2;flame.position.set(side*28,12,148);flame.name='engineFlame';ship.add(flame)}
ship.position.set(0,35,350);
const shipLight=new THREE.PointLight(0x37d9ff,32,360);shipLight.position.set(0,30,90);ship.add(shipLight);

const target=new THREE.Vector3(0,0,0);let yaw=0, pitch=.48, zoom=1200, boost=false;
let keys={},touch={x:0,y:0};let velocity=new THREE.Vector3();
window.addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault()});
window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
let dragging=false,lastX=0,lastY=0;
canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!dragging)return;yaw-=(e.clientX-lastX)*.004;pitch=Math.max(.18,Math.min(1.15,pitch+(e.clientY-lastY)*.003));lastX=e.clientX;lastY=e.clientY});
canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
canvas.addEventListener('wheel',e=>{zoom=Math.max(650,Math.min(2200,zoom+e.deltaY*.7))},{passive:true});
document.querySelector('#reset-camera').addEventListener('click',()=>{yaw=0;pitch=.48;zoom=1200});
const stick=document.querySelector('#stick'),knob=document.querySelector('#stick-knob');let stickId=null;
stick.addEventListener('pointerdown',e=>{stickId=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e)});
stick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)moveStick(e)});
function moveStick(e){const r=stick.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),len=Math.hypot(dx,dy),s=Math.min(34,len)/(len||1);touch.x=dx*s/34;touch.y=dy*s/34;knob.style.transform=`translate(${dx*s}px,${dy*s}px)`}
function endStick(){stickId=null;touch.x=touch.y=0;knob.style.transform='translate(0,0)'}
stick.addEventListener('pointerup',endStick);stick.addEventListener('pointercancel',endStick);
const boostButton=document.querySelector('#boost');boostButton.addEventListener('pointerdown',e=>{boost=true;e.preventDefault()});['pointerup','pointercancel','pointerleave'].forEach(ev=>boostButton.addEventListener(ev,()=>boost=false));

const clock=new THREE.Clock();
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04),t=clock.elapsedTime;
 const forward=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-touch.y;
 const strafe=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+touch.x;
 const turn=(keys.q?1:0)-(keys.e?1:0);
 ship.rotation.y+=turn*dt*1.5;
 const thrust=boost||keys[' ']||keys.shift;
 const speed=thrust?520:280;
 const desired=new THREE.Vector3(strafe*speed,0,-forward*speed).applyAxisAngle(new THREE.Vector3(0,1,0),ship.rotation.y);
 velocity.lerp(desired,Math.min(1,dt*2.6));
 ship.position.addScaledVector(velocity,dt);
 ship.position.y=35+Math.sin(t*2)*3;
 ship.rotation.z=THREE.MathUtils.lerp(ship.rotation.z,-strafe*.18,.08);
 ship.rotation.x=THREE.MathUtils.lerp(ship.rotation.x,forward*.06,.08);
 ship.children.filter(o=>o.name==='engineFlame').forEach(o=>{o.scale.y=thrust?1.6:1;o.material.opacity=thrust?.95:.55});
 status.textContent=thrust?'BOOSTING':velocity.length()>18?'IN FLIGHT':'READY';
 rocks.forEach((r,i)=>{r.rotation.y+=dt*(.03+i*.001);r.rotation.x+=dt*.012});
 station.rotation.y=Math.sin(t*.08)*.025;
 const distance=new THREE.Vector3(ship.position.x,0,ship.position.z).distanceTo(new THREE.Vector3(0,0,-680));
 target.lerp(new THREE.Vector3(ship.position.x*.28,0,ship.position.z*.28-130),.035);
 const horizontal=zoom*Math.cos(pitch);
 camera.position.set(target.x+Math.sin(yaw)*horizontal, target.y+zoom*Math.sin(pitch), target.z+Math.cos(yaw)*horizontal);
 camera.lookAt(target);
 renderer.render(scene,camera);
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setSize(innerWidth,innerHeight)});
animate();
loading.classList.add('hidden');setTimeout(()=>loading.remove(),600);
document.querySelector('#hint').textContent='DRAG TO LOOK · WASD / ARROWS TO FLY · TOUCH JOYSTICK ON MOBILE';
