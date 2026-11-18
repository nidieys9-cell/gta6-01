// peds.js — pedestrians: civilians strolling the sidewalks who flee danger, and
// foot police who chase and shoot at higher wanted levels. Plain objects, updated
// against the shared state; effects go to state.fx.

import { PALETTE, TILE, PITCH } from './config.js';
import { clamp, dist } from './random.js';
import { blockRect, collideCircleBuildings } from './city.js';

let nextPedId = 1;

export function makePed(rng, x, y, kind = 'civ') {
  return {
    id: nextPedId++,
    x, y,
    angle: rng.range(0, Math.PI * 2),
    speed: 0,
    kind,                       // 'civ' | 'cop' | 'target' | 'guard'
    health: kind === 'cop' ? 60 : kind === 'guard' ? 80 : 40,
    state: 'walk',              // 'walk' | 'flee' | 'chase' | 'shoot' | 'dead'
    tx: x, ty: y,               // walk target
    fleeFrom: null,
    fleeTime: 0,
    shootCd: rng.range(0.5, 1.6),
    shirt: kind === 'cop' ? '#2c4a73' : rng.pick(PALETTE.pedShirts),
    pants: kind === 'cop' ? '#1f2c3d' : rng.pick(PALETTE.pedPants),
    dead: false,
    fallAngle: 0,
    walkPhase: rng.range(0, 6),
  };
}

// A random point on a random block's sidewalk ring near (x, y).
export function sidewalkPointNear(rng, x, y, spread = 2) {
  const bx = clamp(Math.floor(x / PITCH) - 1 + rng.int(0, spread), 0, 8);
  const by = clamp(Math.floor(y / PITCH) - 1 + rng.int(0, spread), 0, 6);
  const r = blockRect(bx, by);
  const side = rng.int(0, 3);
  const t = rng.range(0.05, 0.95);
  const inset = TILE.sidewalk / 2;
  if (side === 0) return { x: r.x + t * r.w, y: r.y + inset };
  if (side === 1) return { x: r.x + t * r.w, y: r.y + r.h - inset };
  if (side === 2) return { x: r.x + inset, y: r.y + t * r.h };
  return { x: r.x + r.w - inset, y: r.y + t * r.h };
}

export function spawnCivilians(state, count) {
  for (let i = 0; i < count; i++) {
    const p = sidewalkPointNear(state.rng, state.player.x, state.player.y, 3);
    if (dist(p.x, p.y, state.player.x, state.player.y) < 60) continue;
    state.peds.push(makePed(state.rng, p.x, p.y, 'civ'));
  }
}

function movePed(state, ped, tx, ty, speed, dt) {
  const dx = tx - ped.x, dy = ty - ped.y;
  const d = Math.hypot(dx, dy);
  if (d < 3) return true;
  ped.angle = Math.atan2(dy, dx);
  ped.speed = speed;
  ped.x += Math.cos(ped.angle) * speed * dt;
  ped.y += Math.sin(ped.angle) * speed * dt;
  const pos = { x: ped.x, y: ped.y };
  collideCircleBuildings(state.city, pos, 9);
  ped.x = pos.x; ped.y = pos.y;
  ped.walkPhase += dt * (speed / 16);
  return false;
}

export function updatePed(state, ped, dt) {
  if (ped.dead) return;
  const p = state.player;
  const dPlayer = dist(ped.x, ped.y, p.x, p.y);

  if (ped.kind === 'cop') { updateFootCop(state, ped, dt, dPlayer); return; }
  if (ped.kind === 'guard') { updateGuard(state, ped, dt, dPlayer); return; }
  if (ped.kind === 'target') {
    // The story target strolls until hurt, then runs.
    if (ped.state === 'flee') fleeStep(state, ped, dt);
    else if (movePed(state, ped, ped.tx, ped.ty, 42, dt)) {
      const t = sidewalkPointNear(state.rng, ped.x, ped.y, 1);
      ped.tx = t.x; ped.ty = t.y;
    }
    return;
  }

  // Civilian: flee danger, otherwise stroll between sidewalk points.
  const threat = ped.fleeFrom;
  if (ped.state === 'flee' && threat) { fleeStep(state, ped, dt); return; }
  // A fast car or a drawn gun nearby spooks them (also how crimes get witnessed).
  const pSpeed = p.car ? Math.abs(p.car.speed) : 0;
  if ((dPlayer < 74 && pSpeed > 165) || (dPlayer < 60 && p.aiming)) {
    startFlee(state, ped, p.x, p.y);
    return;
  }
  if (movePed(state, ped, ped.tx, ped.ty, 52, dt)) {
    const t = sidewalkPointNear(state.rng, ped.x, ped.y, 2);
    ped.tx = t.x; ped.ty = t.y;
  }
  if (dPlayer > 1000) ped.dead = true; // far away: let the spawner recycle
}

export function startFlee(state, ped, fromX, fromY) {
  ped.state = 'flee';
  ped.fleeFrom = { x: fromX, y: fromY };
  ped.fleeTime = 2.6;
  state.fx.push({ type: 'scream', x: ped.x, y: ped.y });
}

function fleeStep(state, ped, dt) {
  ped.fleeTime -= dt;
  const a = Math.atan2(ped.y - ped.fleeFrom.y, ped.x - ped.fleeFrom.x);
  const tx = ped.x + Math.cos(a) * 120, ty = ped.y + Math.sin(a) * 120;
  movePed(state, ped, tx, ty, 168, dt);
  if (ped.fleeTime <= 0) { ped.state = 'walk'; ped.fleeFrom = null; }
}

function updateFootCop(state, ped, dt, dPlayer) {
  const p = state.player;
  if (state.wanted.stars === 0) {
    // No longer wanted: foot cops give up and walk off, then despawn.
    if (movePed(state, ped, ped.tx, ped.ty, 60, dt) || dPlayer > 700) ped.dead = true;
    return;
  }
  ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
  if (dPlayer > 130) {
    movePed(state, ped, p.x, p.y, 178, dt);
    ped.state = 'chase';
  } else if (dPlayer < 74) {
    movePed(state, ped, ped.x - Math.cos(ped.angle) * 40, ped.y - Math.sin(ped.angle) * 40, 90, dt);
    ped.state = 'shoot';
  } else {
    ped.speed = 0;
    ped.state = 'shoot';
  }
  // Bust: a foot cop who touches an on-foot player at low wanted ends the chase.
  if (!p.car && dPlayer < 20 && state.wanted.stars <= 2) {
    state.fx.push({ type: 'busted' });
  }
  ped.shootCd -= dt;
  if (ped.state === 'shoot' && ped.shootCd <= 0 && dPlayer < 260) {
    ped.shootCd = state.rng.range(0.9, 1.5);
    state.fx.push({ type: 'copShoot', ped });
  }
}

function updateGuard(state, ped, dt, dPlayer) {
  const p = state.player;
  // Guards protect the story target: they engage only when the player is close
  // or has hurt anyone nearby.
  if (ped.state !== 'shoot' && dPlayer > 190 && !ped.aggro) {
    if (movePed(state, ped, ped.tx, ped.ty, 40, dt)) {
      const t = sidewalkPointNear(state.rng, ped.x, ped.y, 1);
      ped.tx = t.x; ped.ty = t.y;
    }
    return;
  }
  ped.aggro = true;
  ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
  if (dPlayer > 120) movePed(state, ped, p.x, p.y, 150, dt);
  else ped.speed = 0;
  ped.state = 'shoot';
  ped.shootCd -= dt;
  if (ped.shootCd <= 0 && dPlayer < 250) {
    ped.shootCd = state.rng.range(1.0, 1.7);
    state.fx.push({ type: 'copShoot', ped });
  }
}

// Keep civilians topped up; remove the dead and the far-gone.
export function maintainPeds(state, civCount) {
  state.peds = state.peds.filter((ped) => !(ped.dead && ped.kind === 'civ' && dist(ped.x, ped.y, state.player.x, state.player.y) > 420));
  let civs = 0;
  for (const ped of state.peds) if (!ped.dead && ped.kind === 'civ') civs++;
  if (civs < civCount) spawnCivilians(state, Math.min(3, civCount - civs));
}
