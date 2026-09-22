// Saves the placed-piece list + brick budget to localStorage, debounced so rapid
// placement doesn't hit disk every frame. Corrupt/missing/version-mismatched saves
// resolve to null so the caller can fall back to the default starting borough.
const KEY = 'brickBorough.save';
const VERSION = 1;
let timer = null;

export function scheduleSave(state, delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...state })); } catch {}
  }, delay);
}

export function loadCity() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== VERSION || !Array.isArray(data.placed) || typeof data.bricks !== 'number') return null;
    // One malformed record shouldn't crash the whole restore -- bail out to the default city instead.
    if (!data.placed.every(r => r && typeof r.type === 'string' && typeof r.x === 'number' && typeof r.z === 'number' && typeof r.rot === 'number')) return null;
    return data;
  } catch { return null; }
}

export function clearCity() {
  clearTimeout(timer);
  try { localStorage.removeItem(KEY); } catch {}
}
