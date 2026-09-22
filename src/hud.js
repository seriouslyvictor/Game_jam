// src/hud.js — reads live game state and writes the HUD DOM + end-of-run overlay.
// Nothing here mutates game state; main.js calls update() after anything changes.
import { population, happiness, levelFor } from './economy.js';

const el = id => document.getElementById(id);

export function updateHud(state) {
  const { placed, runScore, bricks } = state;
  const pop = population(placed);
  const happy = happiness(placed);
  const lvl = levelFor(runScore);
  el('population').textContent = pop.toLocaleString();
  el('happiness').textContent = `${happy > 70 ? '😊' : happy > 40 ? '😐' : '😟'} ${happy}%`;
  el('brickCount').textContent = bricks;
  el('levelNum').textContent = lvl.index + 1;
  el('levelName').textContent = lvl.name;
  el('progressBar').style.width = `${Math.round(lvl.progress * 100)}%`;
}

let toastTimer = null;
export function toast(message, note) {
  const t = el('toast');
  t.firstChild.textContent = message;
  const b = t.querySelector('b');
  if (note) { b.textContent = note; b.style.display = ''; } else { b.style.display = 'none'; }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

export function showGameOver(state, onRestart) {
  const { placed, runScore, bricks } = state;
  el('goScore').textContent = Math.round(runScore);
  el('goPopulation').textContent = population(placed).toLocaleString();
  el('goHappiness').textContent = `${happiness(placed)}%`;
  el('goLevel').textContent = levelFor(runScore).name;
  const overlay = el('gameOver');
  overlay.classList.add('show');
  el('restartBtn').onclick = onRestart;
}
