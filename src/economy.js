// src/economy.js — Dorfromantik-style adjacency scoring for Brick Borough.
// Pure-ish helpers over the placement records main.js already tracks (`placed`, `columns`).
// Nothing here touches the scene graph; main.js calls in with records and gets numbers back.

const RADIUS = 2; // world units of clearance that still counts as "next to"

// Chebyshev gap between two axis-aligned boxes, in world units. 0 means touching.
// Records carry x/y/z corners-of-mass and w/h/d spans; `cells` are Map keys, not numbers.
// Height counts: two pieces sharing a footprint but six units apart are not neighbours.
function gap(a, b) {
  const ay = a.y || 0, by = b.y || 0, ah = a.h || 0, bh = b.h || 0;
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  const dy = Math.max(0, Math.abs((ay + ah / 2) - (by + bh / 2)) - (ah + bh) / 2);
  return Math.max(dx, dz, dy);
}

function neighbours(rec, placed) {
  return placed.filter(o => o !== rec && gap(rec, o) <= RADIUS);
}

// Walks the ring of cells just outside the footprint looking for road. Only ground-level
// pieces can be "connected" -- a house stacked three storeys up has no road frontage.
function touchesRoad(rec, isRoadCell) {
  if ((rec.y || 0) > 0) return false;
  const x0 = Math.round(rec.x - rec.w / 2), x1 = Math.round(rec.x + rec.w / 2) - 1;
  const z0 = Math.round(rec.z - rec.d / 2), z1 = Math.round(rec.z + rec.d / 2) - 1;
  for (let cx = x0 - 1; cx <= x1 + 1; cx++) if (isRoadCell(cx, z0 - 1) || isRoadCell(cx, z1 + 1)) return true;
  for (let cz = z0; cz <= z1; cz++) if (isRoadCell(x0 - 1, cz) || isRoadCell(x1 + 1, cz)) return true;
  return false;
}

// Anything green counts as "nature" for the homes and groves that care about it.
const GREEN = new Set(['tree', 'park', 'garden', 'water', 'plaza']);

// Scores one placement against its current neighbours. Rules key off `kind` (set from
// PIECES in main.js), so a pine scores as a tree and a bakery as a shop.
// `isRoadCell(cx,cz)` lets main.js answer the road-adjacency question without economy.js
// knowing about road geometry. Returns {total, notes} — notes are short labels, for the toast.
export function scorePlacement(rec, placed, isRoadCell) {
  let total = 0;
  const notes = [];
  const near = neighbours(rec, placed);
  const has = k => near.some(o => o.kind === k);
  const green = near.some(o => GREEN.has(o.kind));
  const add = (amount, label) => { total += amount; notes.push([amount, label]); };
  const road = (bonus, penalty) => { if (touchesRoad(rec, isRoadCell)) add(bonus, 'Connected'); else if (penalty) add(penalty, 'Isolated'); };

  switch (rec.kind) {
    case 'home':
      if (green) add(18, 'Cozy');
      if (has('shop')) add(14, 'Convenient');
      if (has('civic')) add(10, 'Safe');
      if (has('landmark')) add(8, 'Postcard view');
      if (has('tower')) add(-12, 'Overshadowed');
      road(10, -6);
      break;
    case 'tower':
      if (has('tower')) add(16, 'Downtown');
      if (has('landmark')) add(6, 'Skyline');
      road(8, -6);
      break;
    case 'shop':
      if (has('home')) add(10, 'Popular');
      if (has('plaza') || has('landmark')) add(8, 'Busy square');
      road(6);
      break;
    case 'civic':
      if (has('home')) add(12, 'On call');
      road(8, -6);
      break;
    case 'landmark': {
      // Rewards putting it at the heart of things: +4 for every different kind of neighbour.
      const kinds = new Set(near.map(o => o.kind).filter(k => k !== 'part'));
      if (kinds.size) add(Math.min(24, kinds.size * 4), 'Centerpiece');
      road(6);
      break;
    }
    case 'tree': case 'park':
      if (green) add(6, 'Grove');
      break;
    case 'garden':
      if (has('home')) add(8, 'Blooming');
      else if (green) add(4, 'Grove');
      break;
    case 'water':
      if (green) add(10, 'Oasis');
      break;
    case 'plaza':
      if (has('shop') || has('landmark')) add(12, 'Town square');
      else if (has('home')) add(6, 'Meeting spot');
      break;
    case 'deco':
      if (has('home') || has('shop') || has('plaza')) add(4, 'Charming');
      break;
  }
  return { total, notes };
}

// Population is derived fresh from whatever is currently placed — no running counter to drift.
export function population(placed) {
  return placed.reduce((sum, r) => sum + (r.pop || 0), 0);
}

export const LEVELS = [
  { name: 'Sketchy Lot', min: 0 },
  { name: 'Rising Builder', min: 80 },
  { name: 'Tidy Block', min: 220 },
  { name: 'Thriving Quarter', min: 420 },
  { name: 'Model Borough', min: 680 },
  { name: 'Legendary Borough', min: 1000 },
];

export function levelFor(score) {
  const s = Math.max(0, score);
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (s >= LEVELS[i].min) idx = i;
  const cur = LEVELS[idx], next = LEVELS[idx + 1];
  const progress = next ? (s - cur.min) / (next.min - cur.min) : 1;
  return { index: idx, name: cur.name, progress: Math.min(1, Math.max(0, progress)) };
}

// Happiness is the average per-placement score, rescaled to a 0-100% band centered on 50%.
// Clamped so a rough start doesn't read as 0% and a great run doesn't blow past 100%.
export function happiness(placed) {
  const scored = placed.filter(r => typeof r.score === 'number' && !r.starter);
  if (!scored.length) return 78; // baseline for the pre-built starter city, nobody's placed anything yet
  const avg = scored.reduce((s, r) => s + r.score, 0) / scored.length;
  return Math.round(Math.min(100, Math.max(15, 55 + avg * 1.8)));
}
