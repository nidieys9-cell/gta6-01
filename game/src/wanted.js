// wanted.js — the wanted system: heat from witnessed crimes, stars from heat,
// decay while hidden, and the police director that spawns squad cars and foot
// cops to match the star level and retires them when the heat dies down.

import { WANTED } from './config.js';
import { clamp, dist } from './random.js';
import { roadXs, roadYs, nearestRoadIndex, lanePoint } from './city.js';
import { makePoliceCar } from './cars.js';
import { makePed } from './peds.js';

export function makeWanted() {
  return { heat: 0, stars: 0, lastSeen: -99, seenNow: false, bustTimer: 0 };
}

export function starsForHeat(heat) {
  let s = 0;
  for (let i = 1; i < WANTED.thresholds.length; i++) {
    if (heat >= WANTED.thresholds[i]) s = i;
  }
  return s;
}

// Can any witness (pedestrian or police) see this point right now?
export function witnessed(state, x, y) {
  for (const ped of state.peds) {
    if (!ped.dead && dist(ped.x, ped.y, x, y) < WANTED.sightRange * 0.8) return true;
  }
  for (const car of state.cars) {
    if (car.kind === 'police' && !car.dead && dist(car.x, car.y, x, y) < WANTED.sightRange) return true;
  }
  return false;
}

// A crime at (x,y) with a severity in heat points. Unwitnessed crimes are free —
// but committing one in front of a cop is the same as being seen yourself.
export function reportCrime(state, x, y, severity, alwaysSeen = false) {
  if (alwaysSeen || witnessed(state, x, y)) {
    state.wanted.heat += severity;
    state.wanted.lastSeen = state.elapsed;
    state.fx.push({ type: 'crimeSeen', x, y });
  }
}

// Is the player currently visible to any police unit?
export function playerSeen(state) {
  const p = state.player;
  for (const car of state.cars) {
    if (car.kind === 'police' && !car.dead && dist(car.x, car.y, p.x, p.y) < WANTED.sightRange) return true;
  }
  for (const ped of state.peds) {
    if (ped.kind === 'cop' && !ped.dead && dist(ped.x, ped.y, p.x, p.y) < WANTED.sightRange * 0.8) return true;
  }
  return false;
}

export function updateWanted(state, dt) {
  const w = state.wanted;
  w.seenNow = playerSeen(state);
  if (w.seenNow) w.lastSeen = state.elapsed;
  if (!w.seenNow && state.elapsed - w.lastSeen > WANTED.decayDelaySec && w.heat > 0) {
    w.heat = Math.max(0, w.heat - WANTED.decayPerSec * dt * (w.stars >= 3 ? 0.55 : 1));
  }
  const before = w.stars;
  w.stars = starsForHeat(w.heat);
  if (w.stars > before) state.fx.push({ type: 'starsUp', stars: w.stars });
  if (w.stars === 0 && before > 0) state.fx.push({ type: 'escaped' });

  // Bust pressure: police close to a slow/on-foot player at low stars.
  const p = state.player;
  if (w.stars >= 1 && w.stars <= 2) {
    let close = false;
    for (const car of state.cars) {
      if (car.kind === 'police' && !car.dead && dist(car.x, car.y, p.x, p.y) < 30 && (!p.car || Math.abs(p.car.speed) < 14)) close = true;
    }
    if (close) {
      w.bustTimer += dt;
      if (w.bustTimer > 1.1) state.fx.push({ type: 'busted' });
    } else w.bustTimer = Math.max(0, w.bustTimer - dt * 2);
  } else w.bustTimer = 0;

  directPolice(state, dt);
}

// Spawn/retire police so the counts match the star level. Cars arrive on roads
// a few blocks away, close enough to join the chase but never on top of the player.
function directPolice(state, dt) {
  const w = state.wanted;
  let cars = 0, foot = 0;
  for (const c of state.cars) if (c.kind === 'police' && !c.dead) cars++;
  for (const ped of state.peds) if (ped.kind === 'cop' && !ped.dead) foot++;

  const wantCars = WANTED.policeCarsByStars[w.stars];
  const wantFoot = WANTED.policeFootByStars[w.stars];
  state.policeSpawnCd = (state.policeSpawnCd || 0) - dt;

  if (cars < wantCars && state.policeSpawnCd <= 0) {
    state.policeSpawnCd = 1.6;
    const p = state.player;
    // Pick a road point 480–680 px away, on a road, inside the world.
    for (let tries = 0; tries < 8; tries++) {
      const horizontal = state.rng.chance(0.5);
      const idx = nearestRoadIndex(horizontal ? p.y : p.x, horizontal);
      const along = clamp((horizontal ? p.x : p.y) + state.rng.sign() * state.rng.range(480, 680), 40, (horizontal ? state.city.worldW : state.city.worldH) - 40);
      const pt = lanePoint(idx, horizontal, 1, along);
      if (dist(pt.x, pt.y, p.x, p.y) > 380) {
        state.cars.push(makePoliceCar(state.rng, pt.x, pt.y));
        break;
      }
    }
  }
  if (foot < wantFoot && state.policeSpawnCd <= 0) {
    state.policeSpawnCd = 2.2;
    const p = state.player;
    const a = state.rng.range(0, Math.PI * 2);
    const x = clamp(p.x + Math.cos(a) * 330, 20, state.city.worldW - 20);
    const y = clamp(p.y + Math.sin(a) * 330, 20, state.city.worldH - 20);
    state.peds.push(makePed(state.rng, x, y, 'cop'));
  }
  // When the heat is gone, police cars leave the world on their own (updatePoliceCar
  // retires them); foot cops walk off in updatePed.
}
