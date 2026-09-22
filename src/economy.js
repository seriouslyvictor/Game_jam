// src/economy.js — Dorfromantik-style adjacency scoring for Brick Borough.
// Pure-ish helpers over the placement records main.js already tracks (`placed`, `columns`).
// Nothing here touches the scene graph; main.js calls in with records and gets numbers back.

export const POP = { home: 4, tower: 10 }; // population contributed per piece, for the HUD number
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

// Scores one placement against its current neighbours. `isRoadCell(cx,cz)` lets main.js
// answer the road-adjacency question without economy.js knowing about road geometry.
// Returns {total, notes} — notes are short labels in score order, for the toast.
export function scorePlacement(rec, placed, isRoadCell) {
  let total = 0;
  const notes = [];
  const near = neighbours(rec, placed);
  const has = t => near.some(o => o.type === t);
  const add = (amount, label) => { total += amount; notes.push([amount, label]); };

  if (rec.type === 'home') {
    if (near.some(o => o.type === 'tree' || o.type === 'park')) add(18, 'Cozy');
    if (has('shop')) add(14, 'Convenient');
    if (has('tower')) add(-12, 'Overshadowed');
    if (touchesRoad(rec, isRoadCell)) add(10, 'Connected'); else add(-6, 'Isolated');
  } else if (rec.type === 'tower') {
    if (has('tower')) add(16, 'Downtown');
    if (touchesRoad(rec, isRoadCell)) add(8, 'Connected'); else add(-6, 'Isolated');
  } else if (rec.type === 'tree' || rec.type === 'park') {
    if (near.some(o => o.type === 'tree' || o.type === 'park')) add(6, 'Grove');
  } else if (rec.type === 'shop') {
    if (has('home')) add(10, 'Popular');
    if (touchesRoad(rec, isRoadCell)) add(6, 'Connected');
  }
  return { total, notes };
}

// Population is derived fresh from whatever is currently placed — no running counter to drift.
export function population(placed) {
  return placed.reduce((sum, r) => sum + (POP[r.type] || 0), 0);
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
