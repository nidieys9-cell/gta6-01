// save.js — progress in localStorage: money, story position, player position and
// health. Continue on the title screen reads it back. Guarded so the game still
// runs where storage is unavailable (it just cannot save).

import { SAVE_KEY } from './config.js';

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null || typeof s.money !== 'number') return null;
    return s;
  } catch { return null; }
}

export function writeSave(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money,
      missionIndex: state.missionIndex,
      storyDone: state.storyDone,
      x: Math.round(state.player.x),
      y: Math.round(state.player.y),
      health: Math.round(state.player.health),
      ammo: state.player.ammo,
    }));
  } catch { /* storage full or blocked: play on without saving */ }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
