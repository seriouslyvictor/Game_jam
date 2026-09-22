import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { scheduleSave, loadCity, clearCity } from './persistence.js';
import { pushUndo, popUndo, resetUndo } from './history.js';
import { scorePlacement, population, levelFor } from './economy.js';
import { updateHud as renderHud, toast, showGameOver } from './hud.js';

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

const palette = { green:0x9bbc79, darkGreen:0x4f895c, cream:0xf4dda0, coral:0xd9674c, blue:0x72a7ad, yellow:0xe9b842, road:0x767b74, white:0xf5efe0, brown:0x986442,
  red:0xc8453b, grey:0xa9aca3, darkGrey:0x5a5f58, pink:0xe899ae, gold:0xd9a93a };
const mats = {};
Object.entries(palette).forEach(([key,value]) => mats[key] = new THREE.MeshStandardMaterial({color:value, roughness:.72, metalness:0}));
mats.water = new THREE.MeshStandardMaterial({ color:0x5aa6c8, roughness:.18, metalness:.05 });
mats.glow = new THREE.MeshStandardMaterial({ color:0xfff0b8, emissive:0xffd66b, emissiveIntensity:.9, roughness:.4 });
// Every geometry below is shared by every piece that uses it — nothing is allocated per placement.
const studGeo = new THREE.CylinderGeometry(.18,.18,.12,16);
const boxGeo = new THREE.BoxGeometry(1,1,1);
const blobGeo = new THREE.SphereGeometry(.7,14,10);
const wheelGeo = new THREE.CylinderGeometry(.2,.2,.12,12);
const cylGeo = new THREE.CylinderGeometry(1,1,1,20);
const coneGeo = new THREE.ConeGeometry(1,1,8);
const pyramidGeo = new THREE.ConeGeometry(1,1,4);
// A 2x2 roof slope: flat studded strip at the back (-z), falling to a low lip at the front (+z).
const slopeGeo = (() => {
  const s = new THREE.Shape([[1,0],[-1,0],[-1,.2],[.5,1.2],[1,1.2]].map(([a,b]) => new THREE.Vector2(a,b)));
  const g = new THREE.ExtrudeGeometry(s, { depth:2, bevelEnabled:false });
  g.rotateY(Math.PI/2); g.translate(-1,0,0);   // extrude along x; shape x becomes -z
  return g;
})();
// Triangular gable prism, 2.1 wide and 3.1 deep, for pitched roofs.
const gableGeo = (() => {
  const s = new THREE.Shape([new THREE.Vector2(-1.05,0), new THREE.Vector2(1.05,0), new THREE.Vector2(0,.9)]);
  const g = new THREE.ExtrudeGeometry(s, { depth:3.1, bevelEnabled:false });
  g.translate(0,0,-1.55);
  return g;
})();
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

// --- new city pieces ---
function townhouse(g, color=mats.blue){ brick(g,0,.5,0,2,1,3,mats.white,false);brick(g,0,1.4,0,2,.8,3,color,false);mesh(gableGeo,mats.red,[0,1.8,0],[1,1,1],g);brick(g,.55,2.35,-.8,.3,.7,.3,mats.darkGrey,false);
  brick(g,-.45,.45,1.52,.55,.9,.06,mats.brown,false);brick(g,.45,.55,1.52,.5,.45,.06,mats.blue,false);[-.45,.45].forEach(px=>brick(g,px,1.45,1.52,.5,.42,.06,mats.blue,false));}
function bakery(g){ brick(g,0,.6,0,3,1.2,3,mats.cream,false);brick(g,0,1.35,0,3.1,.3,3.1,mats.brown);for(let i=0;i<5;i++)brick(g,-1.2+i*.6,1,1.68,.6,.1,.4,i%2?mats.white:mats.coral,false);
  brick(g,.5,.55,1.52,1.3,.55,.06,mats.blue,false);brick(g,-.85,.5,1.52,.55,1,.06,mats.brown,false);}
function fireStation(g){ brick(g,0,.8,0,5,1.6,4,mats.red,false);brick(g,0,1.75,0,5.2,.3,4.2,mats.white);[-1.2,1.2].forEach(px=>{brick(g,px,.6,2.02,1.7,1.2,.06,mats.cream,false);for(let y=.25;y<1.2;y+=.3)brick(g,px,y,2.06,1.7,.03,.02,mats.grey,false);});
  brick(g,0,1.4,2.02,2,.28,.06,mats.yellow,false);mesh(blobGeo,mats.glow,[0,2.05,-1.2],[.22,.22,.22],g);}
function clockTower(g){ brick(g,0,.6,0,2,1.2,2,mats.cream,false);brick(g,0,2.2,0,1.6,2,1.6,mats.white,false);
  for(let i=0;i<4;i++){const side=new THREE.Group();side.rotation.y=i*Math.PI/2;g.add(side);mesh(cylGeo,mats.cream,[0,2.55,.81],[.5,.05,.5],side).rotation.x=Math.PI/2;brick(side,0,2.68,.85,.06,.3,.02,mats.darkGrey,false);brick(side,.1,2.55,.85,.22,.06,.02,mats.darkGrey,false);}
  brick(g,0,3.55,0,1.8,.7,1.8,mats.coral,false);mesh(pyramidGeo,mats.darkGreen,[0,4.45,0],[1.25,1.1,1.25],g).rotation.y=Math.PI/4;mesh(blobGeo,mats.gold,[0,5.05,0],[.15,.15,.15],g);}
// --- nature ---
function pine(g){ brick(g,0,.35,0,.4,.7,.4,mats.brown,false);[[1.2,.95,1.4],[1.85,.72,1.1],[2.45,.5,.9]].forEach(([y,r,h])=>mesh(coneGeo,mats.darkGreen,[0,y,0],[r,h,r],g));}
function park(g){ brick(g,0,.1,0,2,.2,2,mats.green);brick(g,.35,.21,0,.35,.02,2,mats.cream,false);brick(g,-.55,.5,-.5,.2,.6,.2,mats.brown,false);mesh(blobGeo,mats.darkGreen,[-.55,1.05,-.5],[.55,.55,.55],g);
  brick(g,-.45,.45,.6,.8,.07,.3,mats.brown,false);brick(g,-.45,.62,.76,.8,.28,.05,mats.brown,false);}
function flowerbed(g){ brick(g,0,.12,0,2,.24,2,mats.darkGreen,false);brick(g,0,.27,0,1.7,.08,1.7,mats.brown,false);const cols=[mats.coral,mats.yellow,mats.white,mats.pink];
  for(let i=0;i<4;i++)for(let j=0;j<4;j++)mesh(blobGeo,cols[(i+j*2)%4],[-.6+i*.4,.42,-.6+j*.4],[.17,.17,.17],g);}
function pond(g){ brick(g,0,.1,0,3,.2,3,mats.grey,false);brick(g,0,.16,0,2.4,.12,2.4,mats.water,false);mesh(cylGeo,mats.green,[.55,.23,.4],[.32,.02,.32],g);
  mesh(blobGeo,mats.yellow,[-.4,.33,-.3],[.22,.16,.18],g);mesh(blobGeo,mats.yellow,[-.28,.5,-.3],[.12,.12,.12],g);brick(g,-.15,.5,-.3,.1,.04,.06,mats.coral,false);}
// --- decor ---
function fountain(g){ mesh(cylGeo,mats.grey,[0,.18,0],[.95,.36,.95],g);mesh(cylGeo,mats.water,[0,.37,0],[.8,.04,.8],g);mesh(cylGeo,mats.grey,[0,.75,0],[.16,.8,.16],g);
  mesh(cylGeo,mats.grey,[0,1.12,0],[.45,.12,.45],g);mesh(blobGeo,mats.water,[0,1.2,0],[.3,.2,.3],g);}
function lamp(g){ mesh(cylGeo,mats.darkGrey,[0,.08,0],[.24,.16,.24],g);mesh(cylGeo,mats.darkGrey,[0,.95,0],[.06,1.75,.06],g);brick(g,0,1.92,0,.42,.14,.42,mats.darkGrey,false);mesh(blobGeo,mats.glow,[0,1.76,0],[.17,.17,.17],g);}
// --- basic parts ---
function arch(g,c){ [-1.25,1.25].forEach(px=>brick(g,px,.45,0,.5,.9,1,c,false));brick(g,0,1.05,0,3,.3,1,c);brick(g,0,.84,0,2,.12,.9,c,false);}
function slope(g,c){ mesh(slopeGeo,c,[0,0,0],[1,1,1],g);studs(0,1.26,-.75,2,.5,c);}

// `h` is the height of the piece's brick body, NOT including its studs -- so the next
// piece up sits flush on the body and the studs bury into it, the way real bricks clutch.
// `kind` is what economy.js scores by (a pine is a tree, a bakery is a shop); `pop` feeds
// the population number; `cap` pieces have nothing to clutch on top, so nothing stacks on
// them; `tint` pieces take the colour picked in the build menu. `color` is their default.
const PIECES = {
  home:        { name:'Cozy Home',    cat:'city',   color:'#e96d4c', cost:24, w:4, d:4, h:2,    scale:1,   kind:'home',     pop:4,  tint:true, build:(g,c)=>house(g,c) },
  townhouse:   { name:'Townhouse',    cat:'city',   color:'#72a7ad', cost:20, w:2, d:3, h:2.7,  scale:1,   kind:'home',     pop:3,  tint:true, cap:true, build:(g,c)=>townhouse(g,c) },
  tower:       { name:'Sunny Tower',  cat:'city',   color:'#f0b832', cost:42, w:4, d:4, h:3.4,  scale:1,   kind:'tower',    pop:10, build:g=>tower(g) },
  shop:        { name:'Corner Shop',  cat:'city',   color:'#65a5b9', cost:31, w:5, d:4, h:1.6,  scale:1,   kind:'shop',     build:g=>shop(g) },
  bakery:      { name:'Bakery',       cat:'city',   color:'#f4dda0', cost:22, w:3, d:3, h:1.5,  scale:1,   kind:'shop',     build:g=>bakery(g) },
  firestation: { name:'Fire Station', cat:'city',   color:'#c8453b', cost:38, w:5, d:4, h:1.9,  scale:1,   kind:'civic',    build:g=>fireStation(g) },
  clocktower:  { name:'Clock Tower',  cat:'city',   color:'#f5efe0', cost:60, w:2, d:2, h:5.2,  scale:1,   kind:'landmark', cap:true, build:g=>clockTower(g) },
  tree:        { name:'Round Tree',   cat:'nature', color:'#65a86e', cost:8,  w:2, d:2, h:2.38, scale:.85, kind:'tree',     cap:true, build:g=>tree(g) },
  pine:        { name:'Pine Tree',    cat:'nature', color:'#4f895c', cost:8,  w:2, d:2, h:2.9,  scale:1,   kind:'tree',     cap:true, build:g=>pine(g) },
  park:        { name:'Tiny Park',    cat:'nature', color:'#89b85d', cost:16, w:2, d:2, h:1.45, scale:1,   kind:'park',     cap:true, build:g=>park(g) },
  flowerbed:   { name:'Flower Bed',   cat:'nature', color:'#e899ae', cost:5,  w:2, d:2, h:.6,   scale:1,   kind:'garden',   cap:true, build:g=>flowerbed(g) },
  pond:        { name:'Duck Pond',    cat:'nature', color:'#5aa6c8', cost:14, w:3, d:3, h:.25,  scale:1,   kind:'water',    cap:true, build:g=>pond(g) },
  fountain:    { name:'Fountain',     cat:'decor',  color:'#a9aca3', cost:18, w:2, d:2, h:1.35, scale:1,   kind:'plaza',    cap:true, build:g=>fountain(g) },
  lamp:        { name:'Street Lamp',  cat:'decor',  color:'#5a5f58', cost:3,  w:1, d:1, h:2,    scale:1,   kind:'deco',     cap:true, build:g=>lamp(g) },
  brick:       { name:'2 × 4 Brick',  cat:'basic',  color:'#d85545', cost:1,  w:2, d:1, h:.6,   scale:1,   kind:'part',     tint:true, build:(g,c)=>brick(g,0,.3,0,2,.6,1,c) },
  brick1:      { name:'2 × 2 Brick',  cat:'basic',  color:'#f0b832', cost:1,  w:1, d:1, h:.6,   scale:1,   kind:'part',     tint:true, build:(g,c)=>brick(g,0,.3,0,1,.6,1,c) },
  brick2:      { name:'4 × 4 Brick',  cat:'basic',  color:'#3f6fb5', cost:2,  w:2, d:2, h:.6,   scale:1,   kind:'part',     tint:true, build:(g,c)=>brick(g,0,.3,0,2,.6,2,c) },
  plate:       { name:'4 × 4 Plate',  cat:'basic',  color:'#9bbc79', cost:1,  w:2, d:2, h:.2,   scale:1,   kind:'part',     tint:true, build:(g,c)=>brick(g,0,.1,0,2,.2,2,c) },
  arch:        { name:'2 × 6 Arch',   cat:'basic',  color:'#f5efe0', cost:3,  w:3, d:1, h:1.2,  scale:1,   kind:'part',     tint:true, build:(g,c)=>arch(g,c) },
  slope:       { name:'Roof Slope',   cat:'basic',  color:'#c8453b', cost:3,  w:2, d:2, h:1.2,  scale:1,   kind:'part',     tint:true, cap:true, build:(g,c)=>slope(g,c) },
};

/* ---------- column grid ----------
 * One cell = one world unit in x/z. A piece with an even span centres on an integer, an
 * odd span on a half — so its footprint always lands on exact cell boundaries. Each cell
 * owns a column: the stack of pieces sitting on it, bottom-up. Height is continuous
 * rather than quantised into levels, because the piece bodies aren't all multiples of
 * one brick and stacking on the real body top is what makes them sit flush. */
const columns = new Map();
const placed = [];
const BOUNDS = { x: 14, z: 11.5 };
const MAX_HEIGHT = 12;      // world units; keeps stacks inside the shadow frustum

const snapAxis = (v, span) => span % 2 ? Math.round(v - .5) + .5 : Math.round(v);
const spanOf = (type, rot) => rot % 2 ? [PIECES[type].d, PIECES[type].w] : [PIECES[type].w, PIECES[type].d];
const column = key => columns.get(key) || (columns.set(key, { road:false, stack:[], top:0 }), columns.get(key));

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
    for (let cz = Math.floor(z - d/2); cz < Math.ceil(z + d/2); cz++) column(cx + ',' + cz).road = true;
}

// The height a footprint would rest at, or null when it can't sit there at all: roads are
// never buildable, and a footprint spanning columns of differing heights has nothing flat
// to clutch onto, so it would float or intersect. Ground level is a support height of 0.
function supportHeight(cells) {
  let h = null;
  for (const key of cells) {
    const col = columns.get(key);
    if (col && col.road) return null;
    if (col && col.stack[col.stack.length - 1]?.cap) return null;
    const top = col ? col.top : 0;
    if (h === null) h = top;
    else if (Math.abs(top - h) > 1e-6) return null;
  }
  return h;
}
// A piece is only removable while nothing rests on it -- pull the stack apart from the top.
function isExposed(record) {
  return record.cells.every(key => {
    const col = columns.get(key);
    return col && col.stack[col.stack.length - 1] === record;
  });
}

let nextId = 1;
// `id` is stable across demolish/respawn so an undo entry can find the live record
// even after an intervening undo rebuilt that piece as a new object.
function spawn(type, x, z, rot, color, starter = false, id = nextId++, y = 0) {
  const def = PIECES[type];
  const [w, d] = spanOf(type, rot);
  x = snapAxis(x, w); z = snapAxis(z, d);
  const g = assemble(gg => def.build(gg, color || mats.coral));
  g.position.set(x, y, z);
  g.rotation.y = rot * Math.PI / 2;
  if (def.scale !== 1) g.scale.setScalar(def.scale);
  scene.add(g);
  // rot/color/starter/y ride along on the record so persistence and undo can rebuild this exact piece.
  const record = { id, type, group: g, cells: cellsFor(x, z, w, d), w, d, h: def.h, x, y, z, rot, color: color ? '#' + color.color.getHexString() : null, starter, score: 0, refund: starter ? 0 : def.cost,
    kind: def.kind, pop: def.pop || 0, cap: !!def.cap };
  if (id >= nextId) nextId = id + 1;
  g.userData.record = record;
  record.cells.forEach(key => { const col = column(key); col.stack.push(record); col.top = y + def.h; });
  placed.push(record);
  return record;
}
function demolish(record) {
  const i = placed.indexOf(record);
  if (i < 0) return false;            // stale record: indexOf -1 would splice off the last live piece
  record.cells.forEach(key => {
    const col = columns.get(key);
    if (!col) return;
    const at = col.stack.indexOf(record);
    if (at >= 0) col.stack.splice(at, 1);
    const below = col.stack[col.stack.length - 1];
    col.top = below ? below.y + below.h : 0;
  });
  scene.remove(record.group);
  record.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });   // shared geo/materials stay alive
  placed.splice(i, 1);
  return true;
}
const byId = id => placed.find(r => r.id === id);
const isRoadCell = (cx, cz) => !!columns.get(cx + ',' + cz)?.road;

/* ---------- starting borough ---------- */
road(0,1.2,30,3); road(4.5,0,3,25);
reserve(0,1.2,30,3); reserve(4.5,0,3,25);

let bricks = 640, runScore = 0, gameOver = false;   // declared here so a restored save can overwrite them before the HUD reads them
function defaultCity() {
  spawn('home',-7,-4.3,0,mats.coral,true); spawn('home',10,-4.1,0,mats.blue,true);
  spawn('tower',-10,6.3,0,null,true); spawn('shop',9,6.1,0,null,true); spawn('tower',.7,-6.2,0,null,true);
  [[-12,-6],[-5,-7],[-2,7],[7,-7],[13,7],[12,-9],[-7,9],[-13,1]].forEach(p=>spawn('tree',p[0],p[1],0,null,true));
  // Tucked against the edges and roads so every big lot stays open for the player.
  spawn('pine',13,-4,0,null,true); spawn('pine',-13,10,0,null,true); spawn('bakery',9.5,9.5,2,null,true);
  [[7.5,-1.5],[2.5,-1.5],[6.5,3.5],[-9.5,3.5]].forEach(p=>spawn('lamp',p[0],p[1],0,null,true));
}
// A saved city (P1.4) fully replaces the default starter borough, so a bulldozed
// starter piece stays gone across reloads instead of reappearing.
const savedCity = loadCity();
if (savedCity) {
  // Replay bottom-up: a piece's column has to exist beneath it before it can rest on it.
  [...savedCity.placed].sort((a, b) => (a.y || 0) - (b.y || 0))
    .forEach(r => { spawn(r.type, r.x, r.z, r.rot, r.color ? colorMat(r.color) : null, r.starter, r.id, r.y || 0).score = r.score || 0; });
  bricks = savedCity.bricks;
  runScore = savedCity.runScore || 0;
} else defaultCity();
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

/* ---------- build menu ----------
 * The piece buttons are generated from PIECES, so a new piece only needs a PIECES entry.
 * Thumbnails are rendered from the real models once at startup on a throwaway renderer. */
const SWATCHES = ['#d85545','#e96d4c','#f08a3c','#f0b832','#9bbc79','#4f895c','#72a7ad','#3f6fb5','#f5efe0','#a9aca3','#4a4e48','#986442'];

function renderThumbnails() {
  const r = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  r.setSize(150, 110, false);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xfff9e8, 0x74866b, 2.3));
  const key = new THREE.DirectionalLight(0xfff4d2, 3.4); key.position.set(-6, 10, 8); s.add(key);
  const cam = new THREE.PerspectiveCamera(30, 150/110, .1, 100);
  const dir = new THREE.Vector3(1, .9, 1.25).normalize(), box = new THREE.Box3(), sphere = new THREE.Sphere();
  const out = {};
  for (const [type, def] of Object.entries(PIECES)) {
    const g = assemble(gg => def.build(gg, colorMat(def.color)));
    if (def.scale !== 1) g.scale.setScalar(def.scale);
    s.add(g); g.updateMatrixWorld(true);
    box.setFromObject(g).getBoundingSphere(sphere);
    cam.position.copy(sphere.center).addScaledVector(dir, sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * .95);
    cam.lookAt(sphere.center);
    r.render(s, cam);
    out[type] = r.domElement.toDataURL();
    s.remove(g); g.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
  r.dispose(); r.forceContextLoss();
  return out;
}

function selectColor(hex) {
  selectedColor = colorMat(hex);
  document.querySelector('.swatch').style.background = hex;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === hex));
}
function selectPiece(type) {
  const def = PIECES[type];
  selected = type;
  document.querySelectorAll('.piece').forEach(x => x.classList.toggle('selected', x.dataset.piece === type));
  document.querySelector('#selectedName').textContent = def.name;
  document.querySelector('#colors').classList.toggle('locked', !def.tint);
  selectColor(def.color);
  rebuildGhost();
}
function buildMenu() {
  const thumbs = renderThumbnails();
  const list = document.querySelector('#pieces');
  for (const [type, def] of Object.entries(PIECES)) {
    const b = document.createElement('button');
    b.className = 'piece'; b.dataset.piece = type; b.dataset.category = def.cat;
    b.innerHTML = `<span class="piece-art"></span><strong></strong><small>${def.cost} brick${def.cost === 1 ? '' : 's'}</small>`;
    b.querySelector('strong').textContent = def.name;
    b.querySelector('.piece-art').style.backgroundImage = `url(${thumbs[type]})`;
    b.addEventListener('click', () => selectPiece(type));
    list.append(b);
  }
  const colors = document.querySelector('#colors');
  for (const hex of SWATCHES) {
    const d = document.createElement('button');
    d.className = 'color-dot'; d.dataset.color = hex; d.style.background = hex; d.title = hex;
    d.addEventListener('click', () => selectColor(hex));
    colors.append(d);
  }
  selectPiece(selected);
}

/* ---------- interaction ---------- */
let selected='home', selectedColor=colorMat(PIECES.home.color), tool='build', rotation=0;
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(), plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
const hover = { x:0, z:0, valid:false, target:null };
const hitPoint = new THREE.Vector3();

function updateHover(e) {
  if (gameOver) return hideCursors();
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

  // Aim at whatever is actually under the cursor: the nearest placed piece if there is
  // one, otherwise the ground. Using the ground plane alone would make tall stacks
  // unaimable, since their tops sit well away from where the plane projects.
  const hits = raycaster.intersectObjects(placed.map(r => r.group), true);
  if (hits.length) hitPoint.copy(hits[0].point);
  else if (!raycaster.ray.intersectPlane(plane, hitPoint)) { hideCursors(); return; }

  const [w, d] = aim(hitPoint.x, hitPoint.z);
  setGhostValid(hover.valid);
  ghost.visible = true; ghost.position.set(hover.x, hover.y, hover.z);
  pad.visible = true; pad.position.set(hover.x, hover.y + .09, hover.z); pad.scale.set(w, .06, d);
}

// Resolves where the selected piece would land over a world x/z -- the snapped cell, the
// height it would rest at, and whether it may go there. The single source of truth for
// placement legality: the ghost, the click handler and the run-over check all read it.
function aim(x, z) {
  const [w, d] = spanOf(selected, rotation);
  const sx = snapAxis(x, w), sz = snapAxis(z, d);
  const y = supportHeight(cellsFor(sx, sz, w, d));
  hover.x = sx; hover.z = sz; hover.y = y ?? 0;
  hover.valid = y !== null && y + PIECES[selected].h <= MAX_HEIGHT
    && inBounds(sx, sz, w, d) && bricks >= PIECES[selected].cost;
  return [w, d];
}

function place() {
  if (gameOver) return;
  const def = PIECES[selected];
  if (bricks < def.cost) return toast('Not enough bricks', '');
  if (!hover.valid) return toast('No room there', '');
  const record = spawn(selected, hover.x, hover.z, rotation, selectedColor, false, nextId++, hover.y);
  const { total, notes } = scorePlacement(record, placed, isRoadCell);
  record.score = total;
  runScore += total;
  bricks -= def.cost;
  updateHud();
  // Surface the strongest single rule that fired, so the feedback stays readable.
  const best = notes.slice().sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))[0];
  toast(`${document.querySelector('#selectedName').textContent} `, best ? `${best[1]} ${total >= 0 ? '+' : ''}${total}` : `${total >= 0 ? '+' : ''}${total}`);
  updateGhostValidity();
  const id = record.id;
  pushUndo({ undo: () => { const r = byId(id); if (!r || !demolish(r)) return; bricks += r.refund; runScore -= r.score; updateHud(); persistNow(); } });
  persistNow();
  if (bricks <= 0 || !canStillBuild()) endRun();
}
function bulldoze() {
  if (gameOver) return;
  const record = hover.target;
  if (!record) return;
  if (!isExposed(record)) return toast('Something is stacked on that', '');
  // Snapshot before demolish() so undo can rebuild the exact same piece, id included.
  const snap = { id: record.id, type: record.type, x: record.x, y: record.y, z: record.z, rot: record.rot, color: record.color, starter: record.starter, score: record.score, refund: record.refund };
  if (!demolish(record)) return;
  bricks += record.refund;
  runScore -= record.score;
  updateHud();
  highlight.visible = false;
  hover.target = null;
  toast('Cleared ', record.refund ? `+${record.refund} bricks` : '');
  pushUndo({ undo: () => {
    const r = spawn(snap.type, snap.x, snap.z, snap.rot, snap.color ? colorMat(snap.color) : null, snap.starter, snap.id, snap.y);
    r.score = snap.score; bricks -= snap.refund; runScore += snap.score; updateHud(); persistNow();
  } });
  persistNow();
}

// After anything changes the board or the budget, the ghost's colour may be stale.
function updateGhostValidity() {
  if (tool !== 'build' || !ghost) return;
  const [w, d] = aim(hover.x, hover.z);
  if (ghost.visible) {
    ghost.position.set(hover.x, hover.y, hover.z);
    pad.position.set(hover.x, hover.y + .09, hover.z); pad.scale.set(w, .06, d);
  }
  setGhostValid(hover.valid);
}

const updateHud = () => renderHud({ placed, runScore, bricks });
const persistNow = () => scheduleSave({ bricks, runScore, placed: placed.map(r => ({ id:r.id, type:r.type, x:r.x, y:r.y, z:r.z, rot:r.rot, color:r.color, starter:r.starter, score:r.score })) });

// True while at least one affordable piece still has somewhere legal to go.
function canStillBuild() {
  return Object.keys(PIECES).some(type => {
    if (bricks < PIECES[type].cost) return false;
    for (let rot = 0; rot < 2; rot++) {
      const [w, d] = spanOf(type, rot);
      for (let x = -BOUNDS.x; x <= BOUNDS.x; x++) for (let z = -BOUNDS.z; z <= BOUNDS.z; z++) {
        const sx = snapAxis(x, w), sz = snapAxis(z, d);
        if (!inBounds(sx, sz, w, d)) continue;
        const y = supportHeight(cellsFor(sx, sz, w, d));   // stacking counts: a full plate isn't a dead end
        if (y !== null && y + PIECES[type].h <= MAX_HEIGHT) return true;
      }
    }
    return false;
  });
}

function endRun() {
  gameOver = true;
  hideCursors();
  showGameOver({ placed, runScore, bricks }, () => { clearCity(); resetUndo(); location.reload(); });
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
document.addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='z' && (e.ctrlKey||e.metaKey) && !gameOver && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){ e.preventDefault(); if(popUndo()) hideCursors(); } });
document.querySelector('#newCity')?.addEventListener('click',()=>{ if(confirm('Start a new city? This clears your saved progress.')){ clearCity(); resetUndo(); location.reload(); } });
buildMenu();   // also selects the first piece and builds its ghost
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

updateHud();
if (bricks <= 0 || !canStillBuild()) endRun();

function animate(){controls.update();renderer.render(scene,camera);requestAnimationFrame(animate)}animate();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75))});



