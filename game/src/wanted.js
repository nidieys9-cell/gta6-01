// wanted.js — Sunhaven's heat: crimes raise it only when somebody sees them,
// police eyes pin it in place, and breaking sight lets it cool. The director
// keeps the right number of squad cars and foot cops on the street per star.

import { WANTED } from './config.js';
import { lineOfSight, randomRoadPoint } from './city.js';
import { spawnFootCop, witnessesAt } from './peds.js';
import { spawnPoliceCar } from './cars.js';

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED.thresholds.length; i += 1) {
    if (heat >= WANTED.thresholds[i]) stars = i;
  }
  return stars;
}

/** Did anyone see (or clearly hear) what happened at (x, y)? */
export function crimeWitnessed(state, x, y, heard = false) {
  const radius = heard ? WANTED.hearRange : WANTED.witnessRange;
  const witnesses = witnessesAt(state, x, y, radius);
  for (const ped of witnesses) {
    if (ped.kind === 'cop') return true;
    if (heard) return true;
    if (lineOfSight(state.city, ped.x, ped.y, x, y)) return true;
  }
  // Police cars carry radios and dashcams: a crime in front of one is seen.
  for (const car of state.cars) {
    if (car.kind !== 'police' || car.wrecked) continue;
    if (Math.hypot(car.x - x, car.y - y) < 300 && lineOfSight(state.city, car.x, car.y, x, y)) return true;
  }
  return false;
}

/**
 * Report a crime. amount is a WANTED.crime key. Unwitnessed crimes still count
 * for a little (cameras, luck), heard gunfire for half. Returns true if seen.
 */
export function reportCrime(state, kind, x, y) {
  const base = WANTED.crime[kind] || 5;
  const heard = kind === 'gunshot';
  const seen = crimeWitnessed(state, x, y, heard);
  const gain = seen ? base : heard ? base * 0.5 : base * 0.22;
  addHeat(state, gain);
  if (seen) {
    state.wanted.lastSeen = state.time;
    state.wanted.lastSeenX = x;
    state.wanted.lastSeenY = y;
  }
  return seen;
}

export function addHeat(state, amount) {
  const w = state.wanted;
  w.heat = Math.min(WANTED.maxHeat, w.heat + amount);
  w.stars = starsForHeat(w.heat);
}

export function setStars(state, stars) {
  const w = state.wanted;
  w.heat = WANTED.thresholds[stars] + 1;
  w.stars = stars;
  w.lastSeen = state.time;
  w.lastSeenX = state.player.x;
  w.lastSeenY = state.player.y;
}

export function clearWanted(state) {
  state.wanted.heat = 0;
  state.wanted.stars = 0;
  state.wanted.grabT = 0;
}

/** Are the police looking at the player right now? (Staggered, cheap.) */
function policeSeePlayer(state) {
  const player = state.player;
  const px = player.car ? player.car.x : player.x;
  const py = player.car ? player.car.y : player.y;
  for (const car of state.cars) {
    if (car.kind !== 'police' || car.wrecked) continue;
    if (Math.hypot(car.x - px, car.y - py) < WANTED.sightRange && lineOfSight(state.city, car.x, car.y, px, py)) return true;
  }
  for (const ped of state.peds) {
    if (ped.kind !== 'cop' || ped.dead) continue;
    if (Math.hypot(ped.x - px, ped.y - py) < 460 && lineOfSight(state.city, ped.x, ped.y, px, py)) return true;
  }
  return false;
}

function director(state, dt) {
  const w = state.wanted;
  w.spawnT = (w.spawnT || 0) - dt;
  const cars = state.cars.filter((c) => c.kind === 'police' && !c.wrecked);
  const cops = state.peds.filter((p) => p.kind === 'cop' && !p.dead);
  const px = state.player.car ? state.player.car.x : state.player.x;
  const py = state.player.car ? state.player.car.y : state.player.y;

  if (w.spawnT <= 0) {
    w.spawnT = 0.8;
    if (cars.length < WANTED.policeCars[w.stars]) {
      const p = randomRoadPoint(state.rng, { x: px, y: py }, 640);
      if (Math.hypot(p.x - px, p.y - py) > 560) spawnPoliceCar(state, p.x, p.y);
    }
    if (cops.length < WANTED.footCops[w.stars]) {
      const p = randomRoadPoint(state.rng, { x: px, y: py }, 430);
      spawnFootCop(state, p.x, p.y);
    }
  }
  // Surplus or distant units drift away and are removed offstage.
  if (w.stars === 0) {
    state.cars = state.cars.filter((c) => c.kind !== 'police' || Math.hypot(c.x - px, c.y - py) < 900);
    state.peds = state.peds.filter((p) => p.kind !== 'cop' || Math.hypot(p.x - px, p.y - py) < 700);
  }
}

export function updateWanted(state, dt) {
  const w = state.wanted;
  const seen = w.stars > 0 && policeSeePlayer(state);
  w.seenNow = seen;
  if (seen) {
    w.lastSeen = state.time;
    w.lastSeenX = state.player.car ? state.player.car.x : state.player.x;
    w.lastSeenY = state.player.car ? state.player.car.y : state.player.y;
  } else if (w.heat > 0 && state.time - w.lastSeen > WANTED.decayDelay) {
    w.heat = Math.max(0, w.heat - WANTED.decayRate * dt);
    w.stars = starsForHeat(w.heat);
  }
  director(state, dt);

  // BUSTED: at one or two stars, a foot cop holding onto the player ends the chase.
  if (!state.player.car && w.stars >= 1 && w.stars <= 2 && !state.over) {
    let grabbed = false;
    for (const ped of state.peds) {
      if (ped.kind === 'cop' && !ped.dead && Math.hypot(ped.x - state.player.x, ped.y - state.player.y) < 26) grabbed = true;
    }
    w.grabT = grabbed ? w.grabT + dt : 0;
    if (w.grabT >= WANTED.grabTime) {
      state.events.push({ type: 'busted' });
      w.grabT = 0;
    }
  } else {
    w.grabT = 0;
  }
}
