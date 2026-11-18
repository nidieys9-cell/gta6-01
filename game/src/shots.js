// shots.js — deterministic scenes for the entry's screenshots: ?shot=<name>&seed=<n>
// poses the game (a police chase, a mission on foot, a night street) so the maker
// can capture real renders of the game running. Normal play ignores the parameter.

import { makePoliceCar } from './cars.js';
import { reportCrime } from './wanted.js';

export function shotName() {
  try {
    return new URLSearchParams(window.location.search).get('shot');
  } catch { return null; }
}

export function seedParam(fallback) {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    const n = s === null ? NaN : parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

// Pose a scene on a freshly built state. Returns true if a scene was applied.
export function applyShot(state, name) {
  if (!name) return false;
  const p = state.player;
  const diner = state.city.places.diner;
  state.mode = 'playing';
  if (name === 'chase' || name === 'night') {
    // Behind the wheel, three stars, squad cars on the tail, downtown.
    const car = state.cars.find((c) => c.kind === 'traffic') || state.cars[0];
    if (car) {
      car.x = 1180; car.y = 830; car.angle = 0.4; car.speed = 210;
      car.kind = 'traffic'; car.driver = false; car.ai = null;
      p.car = car; car.occupied = true;
      p.x = car.x; p.y = car.y;
    }
    reportCrime(state, p.x, p.y, 20, true);
    for (let i = 0; i < 3; i++) {
      const cop = makePoliceCar(state.rng, p.x - 130 - i * 70, p.y + (i - 1) * 56);
      cop.angle = 0.4;
      cop.speed = 190;
      state.cars.push(cop);
    }
    state.dayTime = name === 'night' ? 0.78 : 0.32;
    state.banner = { title: 'Hot Courier', sub: 'Deliver to the Port Gate — the whole district just heard about it.', t: 999 };
    return true;
  }
  if (name === 'mission') {
    // On foot outside Dede's, mission marker up, pistol out.
    p.x = diner.x - 60; p.y = diner.y + 90;
    p.angle = 0.6;
    p.aiming = true;
    state.dayTime = 0.3;
    return true;
  }
  if (name === 'beach') {
    p.x = diner.x - 190; p.y = diner.y + 40;
    p.angle = -0.4;
    state.dayTime = 0.22;
    return true;
  }
  return false;
}
