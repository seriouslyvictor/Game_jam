import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { scheduleSave, loadCity, clearCity } from './persistence.js';
import { pushUndo, popUndo, resetUndo } from './history.js';

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
controls.touches.ONE = THREE.TOUCH.PAN;           // match the mouse: one finger pans, two orbit/zoom
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
controls.update();

scene.add(new THREE.HemisphereLight(0xfff9e8, 0x74866b, 2.1));
const sun = new THREE.DirectionalLight(0xfff4d2, 4.2);
sun.position.set(-18, 32, 14); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -28; sun.shadow.camera.right = 28; sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
scene.add(sun);

const palette = { green:0x9bbc79, darkGreen:0x4f895c, cream:0xf4dda0, coral:0xd9674c, blue:0x72a7ad, yellow:0xe9b842, road:0x767b74, white:0xf5efe0, brown:0x986442 };
const mats = {};
Object.entries(palette).forEach(([key,value]) => mats[key] = new THREE.MeshStandardMaterial({color:value, roughness:.72, metalness:0}));
// Every geometry below is shared by every piece that uses it — nothing is allocated per placement.
const studGeo = new THREE.CylinderGeometry(.18,.18,.12,16);
const boxGeo = new THREE.BoxGeometry(1,1,1);
const blobGeo = new THREE.SphereGeometry(.7,14,10);
const wheelGeo = new THREE.CylinderGeometry(.2,.2,.12,12);
const dummy = new THREE.Object3D();

// Placement colours are cached so re-picking a swatch doesn't leak a material each click.
const colorMats = new Map();
function colorMat(hex) {
  if (!colorMats.has(hex)) colorMats.set(hex, new THREE.MeshStandardMaterial({color:hex, roughness:.72, metalness:0}));
  return colorMats.get(hex);
}

/* ---------- brick building ----------
 * While a piece is under construction `studBatch` collects every stud position
 * keyed by material, so the finished piece carries one InstancedMesh per colour
 * instead of ~200 individual stud meshes. */
let studBatch = null;

function mesh(geo, mat, pos, scale=[1,1,1], parent=scene) {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...scale); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
function studs(x, y, z, width, depth, mat, spacing=.5) {
  if (!studBatch) return;
  let list = studBatch.get(mat);
  if (!list) studBatch.set(mat, list = []);
  for(let sx=-width/2+spacing/2;sx<width/2;sx+=spacing) for(let sz=-depth/2+spacing/2;sz<depth/2;sz+=spacing) list.push(x+sx, y, z+sz);
}
function brick(parent, x,y,z,w,h,d,mat, withStuds=true) {
  const b=mesh(boxGeo,mat,[x,y,z],[w,h,d],parent);
  if(withStuds && w<6) studs(x, y+h/2+.06, z, w, d, mat);
  return b;
}

// Runs `build` inside a fresh stud batch and returns the finished, unparented piece.
function assemble(build) {
  const previous = studBatch; studBatch = new Map();
  const g = new THREE.Group();
  build(g);
  for (const [mat, list] of studBatch) {
    const count = list.length / 3;
    const im = new THREE.InstancedMesh(studGeo, mat, count);
    for (let i = 0; i < count; i++) { dummy.position.set(list[i*3], list[i*3+1], list[i*3+2]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;           // studs are tiny; their shadows cost far more than they add
    im.receiveShadow = true;
    g.add(im);
  }
  studBatch = previous;
  return g;
}

/* ---------- world ---------- */
brick(scene,0,-.65,0,30,1,25,mats.green,false);
const baseStuds = new THREE.InstancedMesh(studGeo,mats.green,60*50); let si=0;
for(let x=-14.75;x<15;x+=.5) for(let z=-12.25;z<12.5;z+=.5){ dummy.position.set(x,-.09,z);dummy.updateMatrix();baseStuds.setMatrixAt(si++,dummy.matrix); }
baseStuds.count=si;baseStuds.receiveShadow=true;scene.add(baseStuds);

function road(x,z,w,d){ brick(scene,x,-.02,z,w,.15,d,mats.road,false); const dashMat=mats.cream; if(w>d){for(let dx=x-w/2+1;dx<x+w/2;dx+=2.2)brick(scene,dx,.07,z,.85,.02,.08,dashMat,false)} else {for(let dz=z-d/2+1;dz<z+d/2;dz+=2.2)brick(scene,x,.07,dz,.08,.02,.85,dashMat,false)} }

/* ---------- piece definitions ----------
 * w/d are footprints in whole grid cells; they drive snapping, collision and the ghost pad. */
function house(g, color=mats.coral){ brick(g,0,.45,0,4,.9,3.5,mats.white);brick(g,0,1.25,0,3.5,.8,3,color);brick(g,0,1.82,0,4,.35,3.5,color);studs(0,2.06,0,4,3.5,color);brick(g,0,.75,1.77,.8,1.25,.08,mats.brown,false);[-1.15,1.15].forEach(px=>brick(g,px,1.15,1.78,.75,.65,.08,mats.blue,false));}
function tower(g){ brick(g,0,.55,0,3.8,1.1,3.6,mats.yellow);brick(g,0,1.7,0,3.2,1.2,3,mats.cream);brick(g,0,2.85,0,2.5,1.1,2.4,mats.yellow);studs(0,3.46,0,2.5,2.4,mats.yellow);for(let y=.5;y<3.2;y+=.85) for(const side of [-1,1]) brick(g,side*(y<1?1.91:y<2.4?1.61:1.26),y,0,.06,.42,.65,mats.blue,false);}
function tree(g){ brick(g,0,.7,0,.45,1.4,.45,mats.brown);[[0,1.6,0],[.55,1.55,0],[-.5,1.55,.1],[0,1.75,.5],[0,2.1,0]].forEach(p=>mesh(blobGeo,mats.darkGreen,p,[1,1,1],g));}
function shop(g){ brick(g,0,.55,0,4,1.1,3.2,mats.blue);brick(g,0,1.35,0,4.2,.5,3.4,mats.coral);studs(0,1.66,0,4.2,3.4,mats.coral);brick(g,0,.65,1.61,1.5,.85,.08,mats.white,false);}
function car(x,z,color){const g=new THREE.Group();g.position.set(x,.12,z);scene.add(g);brick(g,0,.3,0,1.8,.45,.9,color,false);brick(g,0,.72,0,.9,.4,.8,mats.cream,false);[[-.55,.11,.48],[.55,.11,.48],[-.55,.11,-.48],[.55,.11,-.48]].forEach(p=>{const wheel=mesh(wheelGeo,mats.road,p,[1,1,1],g);wheel.rotation.x=Math.PI/2});}

const PIECES = {
  home:  { w:4, d:4, cost:12, scale:1,   build:(g,c)=>house(g,c) },
  tower: { w:4, d:4, cost:12, scale:1,   build:g=>tower(g) },
  tree:  { w:2, d:2, cost:4,  scale:.85, build:g=>tree(g) },
  shop:  { w:5, d:4, cost:12, scale:1,   build:g=>shop(g) },
  brick: { w:2, d:1, cost:1,  scale:1,   build:(g,c)=>brick(g,0,.3,0,2,.6,1,c) },
  park:  { w:2, d:2, cost:4,  scale:.85, build:g=>tree(g) },   // TODO(P3): give the park its own model
};

/* ---------- occupancy grid ----------
 * One cell = one world unit. A piece with an even span centres on an integer, an odd
 * span on a half — so its footprint always lands on exact cell boundaries. */
const occupied = new Map();
const placed = [];
const ROAD = { road: true };
const BOUNDS = { x: 14, z: 11.5 };

const snapAxis = (v, span) => span % 2 ? Math.round(v - .5) + .5 : Math.round(v);
const spanOf = (type, rot) => rot % 2 ? [PIECES[type].d, PIECES[type].w] : [PIECES[type].w, PIECES[type].d];

function cellsFor(x, z, w, d) {
  const out = [];
  for (let cx = Math.round(x - w/2); cx < Math.round(x + w/2); cx++)
    for (let cz = Math.round(z - d/2); cz < Math.round(z + d/2); cz++) out.push(cx + ',' + cz);
  return out;
}
function inBounds(x, z, w, d) {
  return x - w/2 >= -BOUNDS.x && x + w/2 <= BOUNDS.x && z - d/2 >= -BOUNDS.z && z + d/2 <= BOUNDS.z;
}
function reserve(x, z, w, d) {
  for (let cx = Math.floor(x - w/2); cx < Math.ceil(x + w/2); cx++)
    for (let cz = Math.floor(z - d/2); cz < Math.ceil(z + d/2); cz++) occupied.set(cx + ',' + cz, ROAD);
}

function spawn(type, x, z, rot, color, starter = false) {
  const def = PIECES[type];
  const [w, d] = spanOf(type, rot);
  x = snapAxis(x, w); z = snapAxis(z, d);
  const g = assemble(gg => def.build(gg, color || mats.coral));
  g.position.set(x, 0, z);
  g.rotation.y = rot * Math.PI / 2;
  if (def.scale !== 1) g.scale.setScalar(def.scale);
  scene.add(g);
  // rot/color/starter ride along on the record so persistence and undo can rebuild this exact piece.
  const record = { type, group: g, cells: cellsFor(x, z, w, d), w, d, x, z, rot, color: color ? '#' + color.color.getHexString() : null, starter, refund: starter ? 0 : def.cost };
  g.userData.record = record;
  record.cells.forEach(c => occupied.set(c, record));
  placed.push(record);
  return record;
}
function demolish(record) {
  record.cells.forEach(c => { if (occupied.get(c) === record) occupied.delete(c); });
  scene.remove(record.group);
  record.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });   // shared geo/materials stay alive
  placed.splice(placed.indexOf(record), 1);
}

/* ---------- starting borough ---------- */
road(0,1.2,30,3); road(4.5,0,3,25);
reserve(0,1.2,30,3); reserve(4.5,0,3,25);

let bricks = 640;   // declared here so a restored save can overwrite it before the HUD reads it
function defaultCity() {
  spawn('home',-7,-4.3,0,mats.coral,true); spawn('home',10,-4.1,0,mats.blue,true);
  spawn('tower',-10,6.3,0,null,true); spawn('shop',9,6.1,0,null,true); spawn('tower',.7,-6.2,0,null,true);
  [[-12,-6],[-5,-7],[-2,7],[7,-7],[13,7],[12,-9],[-7,9],[-13,1]].forEach(p=>spawn('tree',p[0],p[1],0,null,true));
}
// A saved city (P1.4) fully replaces the default starter borough, so a bulldozed
// starter piece stays gone across reloads instead of reappearing.
const savedCity = loadCity();
if (savedCity) { savedCity.placed.forEach(r => spawn(r.type, r.x, r.z, r.rot, r.color ? colorMat(r.color) : null, r.starter)); bricks = savedCity.bricks; }
else defaultCity();
car(-5,1.2,mats.coral);car(8,1.2,mats.yellow);

const grid = new THREE.GridHelper(30,30,0xffffff,0xffffff);grid.position.y=.05;grid.material.opacity=.09;grid.material.transparent=true;scene.add(grid);

/* ---------- ghost preview ---------- */
const ghostMat = new THREE.MeshStandardMaterial({ color:0x6fbf73, roughness:.6, transparent:true, opacity:.5, depthWrite:false });
const padMat = new THREE.MeshBasicMaterial({ color:0x6fbf73, transparent:true, opacity:.34, depthWrite:false });
const pad = new THREE.Mesh(boxGeo, padMat); pad.scale.set(1,.06,1); pad.visible = false; scene.add(pad);
const hiMat = new THREE.MeshBasicMaterial({ color:0xd9534f, transparent:true, opacity:.26, depthWrite:false });
const highlight = new THREE.Mesh(boxGeo, hiMat); highlight.visible = false; scene.add(highlight);

let ghost = null;
function rebuildGhost() {
  if (ghost) { scene.remove(ghost); ghost.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
  const def = PIECES[selected];
  ghost = assemble(g => def.build(g, selectedColor));
  ghost.traverse(o => { if (o.isMesh || o.isInstancedMesh) { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; } });
  ghost.rotation.y = rotation * Math.PI / 2;
  if (def.scale !== 1) ghost.scale.setScalar(def.scale);
  ghost.visible = false;
  scene.add(ghost);
}
function setGhostValid(valid) {
  ghostMat.color.set(valid ? 0x6fbf73 : 0xd9534f);
  padMat.color.set(valid ? 0x6fbf73 : 0xd9534f);
}
function hideCursors() { if (ghost) ghost.visible = false; pad.visible = false; highlight.visible = false; hover.valid = false; hover.target = null; }

/* ---------- interaction ---------- */
let selected='home', selectedColor=mats.coral, tool='build', rotation=0;
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(), plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
const hover = { x:0, z:0, valid:false, target:null };
const hitPoint = new THREE.Vector3();

function updateHover(e) {
  pointer.x = e.clientX / innerWidth * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (tool === 'bulldoze') {
    if (ghost) ghost.visible = false;
    pad.visible = false;
    const hits = raycaster.intersectObjects(placed.map(r => r.group), true);
    let record = null;
    for (const hit of hits) { let o = hit.object; while (o && !o.userData.record) o = o.parent; if (o) { record = o.userData.record; break; } }
    hover.target = record;
    highlight.visible = !!record;
    if (record) { highlight.scale.set(record.w, 3, record.d); highlight.position.set(record.x, 1.5, record.z); }
    return;
  }

  hover.target = null;
  highlight.visible = false;
  if (!raycaster.ray.intersectPlane(plane, hitPoint)) { hideCursors(); return; }

  const [w, d] = spanOf(selected, rotation);
  const x = snapAxis(hitPoint.x, w), z = snapAxis(hitPoint.z, d);
  const clear = cellsFor(x, z, w, d).every(c => !occupied.has(c));
  hover.x = x; hover.z = z;
  hover.valid = clear && inBounds(x, z, w, d) && bricks >= PIECES[selected].cost;

  setGhostValid(hover.valid);
  ghost.visible = true; ghost.position.set(x, 0, z);
  pad.visible = true; pad.position.set(x, .09, z); pad.scale.set(w, .06, d);
}

function place() {
  const def = PIECES[selected];
  if (bricks < def.cost) return toast('Out of bricks!', '');
  if (!hover.valid) return toast('No room there', '');
  const record = spawn(selected, hover.x, hover.z, rotation, selectedColor);
  bricks -= def.cost;
  updateHud();
  toast(`${document.querySelector('#selectedName').textContent} placed! `, `+${def.cost} XP`);
  updateGhostValidity();
  pushUndo({ undo: () => { demolish(record); bricks += record.refund; updateHud(); persistNow(); } });
  persistNow();
}
function bulldoze() {
  const record = hover.target;
  if (!record) return;
  // Snapshot before demolish() so undo can rebuild the exact same piece.
  const snap = { type: record.type, x: record.x, z: record.z, rot: record.rot, color: record.color, starter: record.starter, refund: record.refund };
  demolish(record);
  bricks += record.refund;
  updateHud();
  highlight.visible = false;
  hover.target = null;
  toast('Cleared. ', record.refund ? `+${record.refund} bricks` : '');
  pushUndo({ undo: () => { spawn(snap.type, snap.x, snap.z, snap.rot, snap.color ? colorMat(snap.color) : null, snap.starter); bricks -= snap.refund; updateHud(); persistNow(); } });
  persistNow();
}

// After anything changes the board or the budget, the ghost's colour may be stale.
function updateGhostValidity() {
  if (tool !== 'build' || !ghost || !ghost.visible) return;
  const [w, d] = spanOf(selected, rotation);
  const clear = cellsFor(hover.x, hover.z, w, d).every(c => !occupied.has(c));
  hover.valid = clear && inBounds(hover.x, hover.z, w, d) && bricks >= PIECES[selected].cost;
  setGhostValid(hover.valid);
}

const updateHud = () => { document.querySelector('#brickCount').textContent = bricks; };
const persistNow = () => scheduleSave({ bricks, placed: placed.map(r => ({ type:r.type, x:r.x, z:r.z, rot:r.rot, color:r.color, starter:r.starter })) });
let toastTimer;
function toast(message, note = '') {
  const el = document.querySelector('#toast');
  el.firstChild.textContent = message;
  el.querySelector('b').textContent = note;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

/* A click is a pointerdown and pointerup in nearly the same spot. The old
 * `movementX` check misfired at the end of a slow pan and was undefined on
 * touch, so every camera drag dropped a building. */
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button }; });
canvas.addEventListener('pointermove', updateHover);
canvas.addEventListener('pointerleave', hideCursors);
canvas.addEventListener('pointercancel', () => { down = null; });
canvas.addEventListener('pointerup', e => {
  const start = down; down = null;
  if (!start || start.id !== e.pointerId || start.button !== 0) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;   // that was a drag, not a click
  updateHover(e);
  if (tool === 'build') place(); else bulldoze();
});

document.addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='r' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){ rotation=(rotation+1)%4; if(ghost) ghost.rotation.y=rotation*Math.PI/2; } });
// Ctrl/Cmd+Z undoes the last place() or bulldoze(); each action re-saves and re-deducts/refunds itself.
document.addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='z' && (e.ctrlKey||e.metaKey) && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){ e.preventDefault(); if(popUndo()) hideCursors(); } });
document.querySelector('#newCity')?.addEventListener('click',()=>{ if(confirm('Start a new city? This clears your saved progress.')){ clearCity(); resetUndo(); location.reload(); } });
document.querySelectorAll('.piece').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.piece').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');selected=el.dataset.piece;selectedColor=colorMat(el.dataset.color);document.querySelector('#selectedName').textContent=el.querySelector('strong').textContent;document.querySelector('.swatch').style.background=el.dataset.color;rebuildGhost();}));
document.querySelectorAll('.category').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.category').forEach(x=>x.classList.remove('active'));el.classList.add('active');document.querySelectorAll('.piece').forEach(p=>p.hidden=el.dataset.category!=='all'&&p.dataset.category!==el.dataset.category)}));
document.querySelector('#search').addEventListener('input',e=>document.querySelectorAll('.piece').forEach(p=>p.hidden=!p.textContent.toLowerCase().includes(e.target.value.toLowerCase())));
document.querySelector('#closePanel').addEventListener('click',()=>document.querySelector('.build-panel').classList.toggle('closed'));
document.querySelectorAll('.tool').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));el.classList.add('active');tool=el.dataset.tool;hideCursors();}));
// Scales the camera's distance from the orbit target (the old multiplyScalar
// scaled toward the world origin instead, drifting off-centre and ignoring the limits).
function zoomBy(factor) {
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(offset);
  controls.update();
}
document.querySelector('#zoomIn').onclick=()=>zoomBy(1/1.16);
document.querySelector('#zoomOut').onclick=()=>zoomBy(1.16);

rebuildGhost();
updateHud();

function animate(){controls.update();renderer.render(scene,camera);requestAnimationFrame(animate)}animate();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75))});

