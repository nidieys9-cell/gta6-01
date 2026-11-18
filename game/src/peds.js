// peds.js — the people of Sunhaven: civilians strolling the sidewalk rings, foot
// cops who chase and shoot, and the named cast (Dede, Vince Marlowe and his guards).
// Pedestrians are also the game's witnesses: wanted.js asks them what they saw.

import { collideBuildings, lineOfSight, randomSidewalkPoint } from './city.js';
import { pick, range } from './random.js';
import { PED_COLORS } from './config.js';

let nextPedId = 1;

export function makePed(state, kind, x, y, opts = {}) {
  const ped = {
    id: nextPedId++, kind, // 'civ' | 'cop' | 'dede' | 'target' | 'guard'
    x, y, angle: range(state.rng, 0, Math.PI * 2),
    hp: kind === 'target' ? 60 : kind === 'guard' ? 45 : kind === 'cop' ? 55 : 30,
    color: kind === 'cop' ? '#2c3e70' : kind === 'target' ? '#20232a' : kind === 'dede' ? '#e8e3d5' : pick(state.rng, PED_COLORS),
    target: null,         // current walk destination
    fleeT: 0, fleeX: 0, fleeY: 0,
    dead: false, deadT: 0,
    fireCd: range(state.rng, 0.2, 0.9),
    walkPhase: range(state.rng, 0, 6),
    name: opts.name || null,
    guardPost: opts.post || null,
  };
  state.peds.push(ped);
  return ped;
}

export function spawnCivilians(state, count) {
  for (let i = 0; i < count; i += 1) {
    const p = randomSidewalkPoint(state.city, state.rng);
    makePed(state, 'civ', p.x, p.y);
  }
}

export function spawnFootCop(state, x, y) {
  return makePed(state, 'cop', x, y);
}

function pickSidewalkTarget(state, ped) {
  ped.target = randomSidewalkPoint(state.city, state.rng);
}

function movePed(state, ped, tx, ty, speed, dt) {
  const dx = tx - ped.x;
  const dy = ty - ped.y;
  const d = Math.hypot(dx, dy);
  if (d < 3) return true;
  ped.angle = Math.atan2(dy, dx);
  const step = Math.min(d, speed * dt);
  const fixed = collideBuildings(state.city, ped.x + (dx / d) * step, ped.y + (dy / d) * step, 9);
  ped.x = fixed.x;
  ped.y = fixed.y;
  ped.walkPhase += dt * (speed / 14);
  return d < 12;
}

function threatNear(state, ped) {
  // Gunfire, a fast car or an aimed gun nearby sends civilians running.
  const player = state.player;
  if (state.time - (state.lastNoiseT || -9) < 0.7 && Math.hypot(state.lastNoiseX - ped.x, state.lastNoiseY - ped.y) < 170) {
    return { x: state.lastNoiseX, y: state.lastNoiseY };
  }
  const px = player.car ? player.car.x : player.x;
  const py = player.car ? player.car.y : player.y;
  const d = Math.hypot(px - ped.x, py - ped.y);
  if (player.car && Math.abs(player.car.speed) > 130 && d < 95) return { x: px, y: py };
  if (!player.car && state.inp && state.inp.fire && d < 130) return { x: px, y: py };
  return null;
}

function updateCivilian(state, ped, dt) {
  const threat = threatNear(state, ped);
  if (threat) { ped.fleeT = 1.1; ped.fleeX = threat.x; ped.fleeY = threat.y; }
  if (ped.fleeT > 0) {
    ped.fleeT -= dt;
    const away = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
    movePed(state, ped, ped.x + Math.cos(away) * 90, ped.y + Math.sin(away) * 90, 205, dt);
    return;
  }
  if (!ped.target || movePed(state, ped, ped.target.x, ped.target.y, 62, dt)) {
    if (state.rng() < 0.02 || !ped.target) pickSidewalkTarget(state, ped);
  }
}

function updateCop(state, ped, dt) {
  const player = state.player;
  const dist = Math.hypot(player.x - ped.x, player.y - ped.y);
  const seen = dist < 460 && lineOfSight(state.city, ped.x, ped.y, player.x, player.y);
  if (seen) state.wanted.lastSeen = state.time;
  // No eyes on the player? Search where they were last seen, like the cars do —
  // a cop who always knows where you are is neither fair nor fun.
  const searching = !seen && state.wanted.lastSeen >= 0;
  const tx = searching ? state.wanted.lastSeenX : player.x;
  const ty = searching ? state.wanted.lastSeenY : player.y;
  const targetDist = Math.hypot(tx - ped.x, ty - ped.y);
  if (player.car) {
    // Foot cops converge on the search point when the player is driving.
    if (targetDist > 60) movePed(state, ped, tx, ty, 96, dt);
    return;
  }
  if (targetDist > 42) {
    movePed(state, ped, tx, ty, 178, dt);
  } else if (!searching) {
    ped.angle = Math.atan2(player.y - ped.y, player.x - ped.x);
  }
  // Cops open fire at 3+ stars when they have a shot.
  ped.fireCd -= dt;
  if (state.wanted.stars >= 3 && seen && dist < 250 && dist > 30 && ped.fireCd <= 0) {
    ped.fireCd = range(state.rng, 0.55, 0.95);
    state.events.push({ type: 'copShoot', ped, tx: player.x, ty: player.y });
  }
}

function updateGuard(state, ped, dt) {
  const player = state.player;
  const post = ped.guardPost || ped;
  const distP = Math.hypot(player.x - ped.x, player.y - ped.y);
  // Marlowe's men turn hostile once Vince is confronted; the bank guards once
  // Marco is close to (or inside) the cash truck.
  const hostile = (state.mission.i === 3 && state.mission.phase >= 1)
    || (state.mission.i === 5 && (player.car === state.mission.data.car || distP < 170));
  if (hostile && distP < 300 && lineOfSight(state.city, ped.x, ped.y, player.x, player.y)) {
    if (distP > 110) movePed(state, ped, player.x, player.y, 150, dt);
    else ped.angle = Math.atan2(player.y - ped.y, player.x - ped.x);
    ped.fireCd -= dt;
    if (distP < 235 && ped.fireCd <= 0) {
      ped.fireCd = range(state.rng, 0.6, 1.0);
      state.events.push({ type: 'copShoot', ped, tx: player.x, ty: player.y, guard: true });
    }
  } else if (Math.hypot(post.x - ped.x, post.y - ped.y) > 14) {
    movePed(state, ped, post.x, post.y, 70, dt);
  }
}

function updateTarget(state, ped, dt) {
  // Vince Marlowe paces his yard; once the mission turns hostile he runs.
  const player = state.player;
  const hostile = state.mission.i === 3 && state.mission.phase >= 1;
  const distP = Math.hypot(player.x - ped.x, player.y - ped.y);
  if (hostile && distP < 260) {
    const away = Math.atan2(ped.y - player.y, ped.x - player.x);
    movePed(state, ped, ped.x + Math.cos(away) * 120, ped.y + Math.sin(away) * 120, 172, dt);
    return;
  }
  if (!ped.target || movePed(state, ped, ped.target.x, ped.target.y, 46, dt)) {
    const post = ped.guardPost || ped;
    ped.target = { x: post.x + range(state.rng, -46, 46), y: post.y + range(state.rng, -46, 46) };
  }
}

export function updatePeds(state, dt) {
  for (const ped of state.peds) {
    if (ped.dead) { ped.deadT += dt; continue; }
    if (ped.kind === 'civ') updateCivilian(state, ped, dt);
    else if (ped.kind === 'cop') updateCop(state, ped, dt);
    else if (ped.kind === 'guard') updateGuard(state, ped, dt);
    else if (ped.kind === 'target') updateTarget(state, ped, dt);
    else if (ped.kind === 'dede') {
      ped.angle += Math.sin(state.time * 0.7 + ped.id) * 0.12 * dt;
    }
  }
  // Bodies fade; the living stay.
  state.peds = state.peds.filter((ped) => !ped.dead || ped.deadT < 6);
}

export function damagePed(state, ped, amount, cause) {
  if (ped.dead) return;
  ped.hp -= amount;
  ped.fleeT = Math.max(ped.fleeT, 0.8);
  ped.fleeX = state.player.x;
  ped.fleeY = state.player.y;
  if (ped.hp <= 0) {
    ped.dead = true;
    ped.deadT = 0;
    state.events.push({ type: 'pedDown', ped, cause, x: ped.x, y: ped.y });
  }
}

/** Everyone close enough to see a point — the witness pool for a crime. */
export function witnessesAt(state, x, y, radius) {
  const out = [];
  for (const ped of state.peds) {
    if (ped.dead) continue;
    if (Math.hypot(ped.x - x, ped.y - y) < radius) out.push(ped);
  }
  return out;
}
