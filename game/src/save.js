// save.js — progress in localStorage: cash, story position, where Marco is
// standing and what he is carrying. Guarded everywhere, so the game also runs
// where storage is unavailable (private windows, headless tests).

const KEY = 'sunhaven-heat-save-v1';
let memoryFallback = null;

export function hasSave() {
  try {
    return Boolean(window.localStorage.getItem(KEY)) || memoryFallback !== null;
  } catch {
    return memoryFallback !== null;
  }
}

export function writeSave(state) {
  const data = {
    cash: state.player.cash,
    mission: state.mission.i,
    x: state.player.x,
    y: state.player.y,
    hp: state.player.hp,
    ammo: state.player.ammo,
    dayT: state.dayT,
    freeRoam: state.freeRoam,
  };
  memoryFallback = data;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* storage unavailable: the in-memory copy still serves Continue */ }
}

export function readSave() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to the memory copy */ }
  return memoryFallback;
}

export function clearSave() {
  memoryFallback = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nothing to clear */ }
}
