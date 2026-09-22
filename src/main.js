import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const canvas = document.querySelector('#world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdce8d8);
scene.fog = new THREE.FogExp2(0xdce8d8, 0.016);
const camera = new THREE.PerspectiveCamera(33, innerWidth / innerHeight, .1, 180);
camera.position.set(25, 28, 35);
const controls = new OrbitControls(camera, canvas);
controls.target.set(1, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = .06;
controls.maxPolarAngle = Math.PI * .46;
controls.minDistance = 17;
controls.maxDistance = 58;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.update();

scene.add(new THREE.HemisphereLight(0xfff9e8, 0x74866b, 2.1));
const sun = new THREE.DirectionalLight(0xfff4d2, 4.2);
sun.position.set(-18, 32, 14); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -28; sun.shadow.camera.right = 28; sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
scene.add(sun);

const palette = { green:0x9bbc79, darkGreen:0x4f895c, cream:0xf4dda0, coral:0xd9674c, blue:0x72a7ad, yellow:0xe9b842, road:0x767b74, white:0xf5efe0, brown:0x986442 };
const mats = {};
Object.entries(palette).forEach(([key,value]) => mats[key] = new THREE.MeshStandardMaterial({color:value, roughness:.72, metalness:0}));
const studGeo = new THREE.CylinderGeometry(.18,.18,.12,16);
const boxGeo = new THREE.BoxGeometry(1,1,1);

function mesh(geo, mat, pos, scale=[1,1,1], parent=scene) {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...scale); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
function studs(parent, width, depth, y, colorMat, spacing=.5) {
  for(let x=-width/2+spacing/2;x<width/2;x+=spacing) for(let z=-depth/2+spacing/2;z<depth/2;z+=spacing) mesh(studGeo,colorMat,[x,y,z],[1,1,1],parent);
}
function brick(parent, x,y,z,w,h,d,mat, withStuds=true) {
  const b=mesh(boxGeo,mat,[x,y,z],[w,h,d],parent);
  b.geometry.computeBoundingSphere();
  if(withStuds && w<6) {
    const holder=new THREE.Group(); holder.position.set(x,y,z); parent.add(holder); studs(holder,w,d,h/2+.06,mat);
  }
  return b;
}

// Base plate and a sparse stud field use InstancedMesh to keep draw calls low.
brick(scene,0,-.65,0,30,1,25,mats.green,false);
const baseStuds = new THREE.InstancedMesh(studGeo,mats.green,50*42); const dummy=new THREE.Object3D(); let si=0;
for(let x=-14.75;x<15;x+=.6) for(let z=-12.25;z<12.5;z+=.6){ dummy.position.set(x,-.09,z);dummy.updateMatrix();baseStuds.setMatrixAt(si++,dummy.matrix); }
baseStuds.count=si;baseStuds.receiveShadow=true;scene.add(baseStuds);

function road(x,z,w,d){ brick(scene,x,-.02,z,w,.15,d,mats.road,false); const dashMat=mats.cream; if(w>d){for(let dx=x-w/2+1;dx<x+w/2;dx+=2.2)brick(scene,dx,.07,z,.85,.02,.08,dashMat,false)} else {for(let dz=z-d/2+1;dz<z+d/2;dz+=2.2)brick(scene,x,.07,dz,.08,.02,.85,dashMat,false)} }
road(0,1.2,30,3); road(4.5,0,3,25);

function house(x,z,color=mats.coral){ const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);brick(g,0,.45,0,4,.9,3.5,mats.white);brick(g,0,1.25,0,3.5,.8,3,color);brick(g,0,1.82,0,4,.35,3.5,color);studs(g,4,3.5,2.06,color,.5);brick(g,0,.75,1.77,.8,1.25,.08,mats.brown,false);[-1.15,1.15].forEach(px=>brick(g,px,1.15,1.78,.75,.65,.08,mats.blue,false));return g;}
function tower(x,z){const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);brick(g,0,.55,0,3.8,1.1,3.6,mats.yellow);brick(g,0,1.7,0,3.2,1.2,3,mats.cream);brick(g,0,2.85,0,2.5,1.1,2.4,mats.yellow);studs(g,2.5,2.4,3.46,mats.yellow,.5);for(let y=.5;y<3.2;y+=.85) for(const side of [-1,1]) brick(g,side*(y<1?1.91:y<2.4?1.61:1.26),y,0,.06,.42,.65,mats.blue,false);return g;}
function tree(x,z,s=1){const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(s);scene.add(g);brick(g,0,.7,0,.45,1.4,.45,mats.brown);[[0,1.6,0],[.55,1.55,0],[-.5,1.55,.1],[0,1.75,.5],[0,2.1,0]].forEach(p=>mesh(new THREE.SphereGeometry(.7,14,10),mats.darkGreen,p,[1,1,1],g));return g;}
function shop(x,z){const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);brick(g,0,.55,0,4,1.1,3.2,mats.blue);brick(g,0,1.35,0,4.2,.5,3.4,mats.coral);studs(g,4.2,3.4,1.66,mats.coral,.5);brick(g,0,.65,1.61,1.5,.85,.08,mats.white,false);return g;}
function car(x,z,color){const g=new THREE.Group();g.position.set(x,.12,z);scene.add(g);brick(g,0,.3,0,1.8,.45,.9,color);brick(g,0,.72,0,.9,.4,.8,mats.cream);[[-.55,.11,.48],[.55,.11,.48],[-.55,.11,-.48],[.55,.11,-.48]].forEach(p=>{const wheel=mesh(new THREE.CylinderGeometry(.2,.2,.12,12),mats.road,p,[1,1,1],g);wheel.rotation.x=Math.PI/2});}

house(-7,-4.3); house(10,-4.1,mats.blue); tower(-10,6.3); shop(9,6.1); tower(.7,-6.2);
[[-12,-6],[-5,-7],[-2,7],[7,-7],[13,7],[12,-9],[-7,9],[-13,1]].forEach((p,i)=>tree(p[0],p[1],.75+(i%3)*.12));
car(-5,1.2,mats.coral);car(8,1.2,mats.yellow);

const grid = new THREE.GridHelper(30,50,0xffffff,0xffffff);grid.position.y=.05;grid.material.opacity=.09;grid.material.transparent=true;scene.add(grid);

let selected='home', selectedColor=mats.coral, tool='build', bricks=640, rotation=0;
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(), plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
canvas.addEventListener('click',e=>{
  if(Math.abs(e.movementX)>2||tool!=='build')return;
  pointer.x=e.clientX/innerWidth*2-1;pointer.y=-(e.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);const point=new THREE.Vector3();raycaster.ray.intersectPlane(plane,point);
  if(!point||Math.abs(point.x)>14||Math.abs(point.z)>11.5)return;
  point.x=Math.round(point.x*2)/2;point.z=Math.round(point.z*2)/2;
  let obj;if(selected==='tree'||selected==='park')obj=tree(point.x,point.z,.75);else if(selected==='tower')obj=tower(point.x,point.z);else if(selected==='shop')obj=shop(point.x,point.z);else if(selected==='brick'){obj=new THREE.Group();obj.position.set(point.x,0,point.z);scene.add(obj);brick(obj,0,.3,0,2,.6,1,selectedColor);}else obj=house(point.x,point.z,selectedColor);obj.rotation.y=rotation;
  bricks=Math.max(0,bricks-(selected==='brick'?1:12));document.querySelector('#brickCount').textContent=bricks;
  const toast=document.querySelector('#toast');toast.firstChild.textContent=`${document.querySelector('#selectedName').textContent} placed! `;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1600);
});
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='r')rotation+=Math.PI/2});
document.querySelectorAll('.piece').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.piece').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');selected=el.dataset.piece;selectedColor=new THREE.MeshStandardMaterial({color:el.dataset.color,roughness:.72});document.querySelector('#selectedName').textContent=el.querySelector('strong').textContent;document.querySelector('.swatch').style.background=el.dataset.color;}));
document.querySelectorAll('.category').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.category').forEach(x=>x.classList.remove('active'));el.classList.add('active');document.querySelectorAll('.piece').forEach(p=>p.hidden=el.dataset.category!=='all'&&p.dataset.category!==el.dataset.category)}));
document.querySelector('#search').addEventListener('input',e=>document.querySelectorAll('.piece').forEach(p=>p.hidden=!p.textContent.toLowerCase().includes(e.target.value.toLowerCase())));
document.querySelector('#closePanel').addEventListener('click',()=>document.querySelector('.build-panel').classList.toggle('closed'));
document.querySelectorAll('.tool').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));el.classList.add('active');tool=el.dataset.tool;}));
document.querySelector('#zoomIn').onclick=()=>{camera.position.multiplyScalar(.86)};document.querySelector('#zoomOut').onclick=()=>{camera.position.multiplyScalar(1.14)};

function animate(){controls.update();renderer.render(scene,camera);requestAnimationFrame(animate)}animate();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75))});
