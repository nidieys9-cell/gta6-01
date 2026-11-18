// cars.js — every car in Sunhaven: parked cars, lane-following traffic with simple
// yielding, police pursuit cars, and the arcade driving physics the player uses.
// Cars are plain objects; updates push effects into state.fx for main.js to render.

import { CAR, PALETTE, TILE, WORLD_W, WORLD_H } from './config.js';
import { clamp, angleDelta, dist } from './random.js';
import { roadXs, roadYs, lanePoint, nearestRoadIndex, collideCircleBuildings } from './city.js';

let nextCarId = 1;

export function makeCar(rng, x, y, angle, kind) {
  return {
    id: nextCarId++,
    x, y, angle,
    speed: 0,
    steer: 0,
    kind,                                   // 'traffic' | 'parked' | 'police' | 'mission'
    color: kind === 'police' ? '#e8e8ec' : rng.pick(PALETTE.carColors),
    health: CAR.maxHealth,
    driver: kind === 'traffic',
    occupied: false,                        // the player is driving it
    ai: null,                               // traffic lane state
    sirenPhase: rng.range(0, 6),
    dead: false,
    smokeAcc: 0,
  };
}

// A traffic car bound to a lane: it travels along one road, turns at crossings.
export function makeTrafficCar(rng, city) {
  const horizontal = rng.chance(0.5);
  const index = rng.int(0, horizontal ? roadYs.length - 1 : roadXs.length - 1);
  const dir = rng.sign();
  const along = rng.range(60, (horizontal ? WORLD_W : WORLD_H) - 60);
  const p = lanePoint(index, horizontal, dir, along);
  const car = makeCar(rng, p.x, p.y, horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 'traffic');
  car.ai = { horizontal, index, dir, cruise: rng.range(120, 185) };
  car.speed = car.ai.cruise * 0.7;
  return car;
}

export function makeParkedCar(rng, spot) {
  const car = makeCar(rng, spot.x, spot.y, spot.angle, 'parked');
  car.driver = false;
  return car;
}

export function makePoliceCar(rng, x, y) {
  const car = makeCar(rng, x, y, 0, 'police');
  car.driver = true;
  car.health = CAR.maxHealth * 1.4;
  return car;
}

// Is there a car or the player blocking this traffic car within `gap` px ahead?
function blockedAhead(state, car, gap) {
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  for (const other of state.cars) {
    if (other === car || other.dead) continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0 && ahead < gap && side < 20) return true;
  }
  const p = state.player;
  if (!p.car) {
    const dx = p.x - car.x, dy = p.y - car.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0 && ahead < gap && side < 18) return true;
  }
  for (const ped of state.peds) {
    if (ped.dead) continue;
    const dx = ped.x - car.x, dy = ped.y - car.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0 && ahead < gap * 0.8 && side < 16) return true;
  }
  return false;
}

// Traffic: follow the lane, yield when blocked, choose a way at each crossing.
export function updateTrafficCar(state, car, dt) {
  const ai = car.ai;
  const want = blockedAhead(state, car, 58) ? 0 : ai.cruise;
  car.speed += clamp(want - car.speed, -CAR.brake * dt, CAR.accel * 0.5 * dt);
  if (car.speed < 0) car.speed = 0;

  if (ai.horizontal) car.x += ai.dir * car.speed * dt;
  else car.y += ai.dir * car.speed * dt;
  const p = lanePoint(ai.index, ai.horizontal, ai.dir, ai.horizontal ? car.x : car.y);
  if (ai.horizontal) car.y = p.y; else car.x = p.x;
  car.angle = ai.horizontal ? (ai.dir > 0 ? 0 : Math.PI) : (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2);

  // At a crossing, maybe turn onto the crossing road.
  const crossArr = ai.horizontal ? roadXs : roadYs;
  const along = ai.horizontal ? car.x : car.y;
  const ci = nearestRoadIndex(along, !ai.horizontal);
  const crossPos = crossArr[ci];
  if (Math.abs(along - crossPos) < Math.max(4, car.speed * dt) && car.speed > 4) {
    const atEdge = (ai.horizontal && (ci === 0 || ci === roadXs.length - 1)) ||
      (!ai.horizontal && (ci === 0 || ci === roadYs.length - 1));
    const turn = atEdge ? 0.85 : 0.34;
    if (state.rng.chance(turn)) {
      // Turn: new road is the crossing one; direction chosen to stay in the world.
      const newHorizontal = !ai.horizontal;
      const mid = (newHorizontal ? WORLD_H : WORLD_W) / 2;
      const posAcross = newHorizontal ? car.y : car.x;
      let newDir = state.rng.sign();
      if (posAcross < 120) newDir = 1;
      if (posAcross > (newHorizontal ? WORLD_H : WORLD_W) - 120) newDir = -1;
      if (atEdge) newDir = along < mid ? 1 : -1, newDir = (ai.horizontal ? (car.y < WORLD_H / 2 ? 1 : -1) : (car.x < WORLD_W / 2 ? 1 : -1));
      ai.horizontal = newHorizontal;
      ai.index = ci;
      ai.dir = newDir;
      const np = lanePoint(ai.index, ai.horizontal, ai.dir, ai.horizontal ? car.y : car.x);
      if (ai.horizontal) { car.y = np.y; } else { car.x = np.x; }
    }
  }
  // Despawn far traffic and let the spawner replace it near the player.
  if (dist(car.x, car.y, state.player.x, state.player.y) > 1150) car.dead = true;
}

// Police pursuit: steer at the player's predicted position, ram on contact.
export function updatePoliceCar(state, car, dt) {
  const p = state.player;
  const target = p.car ? p.car : p;
  const lead = clamp(dist(car.x, car.y, target.x, target.y) / 300, 0, 0.55);
  const tx = target.x + Math.cos(target.angle || 0) * (target.speed || 0) * lead;
  const ty = target.y + Math.sin(target.angle || 0) * (target.speed || 0) * lead;
  const want = Math.atan2(ty - car.y, tx - car.x);
  const d = angleDelta(car.angle, want);
  const maxSpeed = CAR.maxSpeed * (state.wanted.stars >= 4 ? 1.04 : 0.97);
  const distTo = dist(car.x, car.y, target.x, target.y);
  let throttle = distTo > 46 ? 1 : 0.25;
  if (Math.abs(d) > 2.4) throttle = -0.5; // reverse out of a bad angle
  car.speed += clamp(throttle * maxSpeed - car.speed, -CAR.brake * dt, CAR.accel * dt);
  car.angle += clamp(d, -1, 1) * CAR.turnRate * clamp(Math.abs(car.speed) / 120, 0.25, 1) * dt * (car.speed < 0 ? -1 : 1);
  moveCarBody(state, car, dt);
  if (distTo > 1300 && state.wanted.stars === 0) car.dead = true;
}

// Shared body movement + building collision + damage, used by police and player.
export function moveCarBody(state, car, dt) {
  const before = Math.abs(car.speed);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const pos = { x: car.x, y: car.y };
  const hit = collideCircleBuildings(state.city, pos, 17);
  car.x = pos.x; car.y = pos.y;
  if (hit && before > 60) {
    damageCar(state, car, (before - 60) * 0.055);
    car.speed *= -0.25;
    state.fx.push({ type: 'crash', x: car.x, y: car.y, big: before > 170 });
    state.shake = Math.min(9, state.shake + before / 42);
  } else if (hit) {
    car.speed *= 0.4;
  }
}

export function damageCar(state, car, amount) {
  if (car.health <= 0) return;
  car.health -= amount;
  state.fx.push({ type: 'sparks', x: car.x, y: car.y, n: 5 });
  if (car.health <= 0) {
    car.health = 0;
    state.fx.push({ type: 'fire', x: car.x, y: car.y, n: 14 });
    if (car.occupied) state.fx.push({ type: 'eject' });
  }
}

// The player's driving: input axes in, arcade physics out.
export function drivePlayerCar(state, car, input, dt) {
  const up = input.down('KeyW', 'ArrowUp');
  const down = input.down('KeyS', 'ArrowDown');
  const left = input.down('KeyA', 'ArrowLeft');
  const right = input.down('KeyD', 'ArrowRight');
  const handbrake = input.down('Space');
  const wrecked = car.health <= 0;
  const topSpeed = wrecked ? 26 : CAR.maxSpeed;

  if (up) car.speed += CAR.accel * dt;
  else if (down) car.speed -= (car.speed > 4 ? CAR.brake : CAR.accel * 0.6) * dt;
  else car.speed -= car.speed * (handbrake ? 2.6 : 0.55) * dt;
  if (handbrake) car.speed -= car.speed * 1.9 * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, topSpeed);

  const steerIn = (left ? -1 : 0) + (right ? 1 : 0);
  const speedRatio = clamp(Math.abs(car.speed) / 130, 0, 1);
  car.steer = steerIn;
  if (car.speed !== 0) {
    car.angle += steerIn * CAR.turnRate * speedRatio * dt * (car.speed < 0 ? -1 : 1) * (handbrake ? 1.35 : 1);
  }
  moveCarBody(state, car, dt);
  // Running over a pedestrian is a serious crime (handled by combat/wanted via fx).
  for (const ped of state.peds) {
    if (ped.dead) continue;
    if (Math.abs(car.speed) > 55 && dist(car.x, car.y, ped.x, ped.y) < 21) {
      ped.health -= 100;
      ped.dead = true;
      ped.fallAngle = car.angle;
      state.fx.push({ type: 'pedHit', x: ped.x, y: ped.y, byPlayer: true });
      state.shake = Math.min(8, state.shake + 2.5);
    }
  }
  // Car-to-car bumps.
  for (const other of state.cars) {
    if (other === car) continue;
    const d = dist(car.x, car.y, other.x, other.y);
    if (d < 34 && d > 0.01) {
      const impact = Math.abs(car.speed) * 0.5 + Math.abs(other.speed || 0) * 0.3;
      if (impact > 26) {
        damageCar(state, other, impact * 0.12);
        damageCar(state, car, impact * 0.07);
        state.fx.push({ type: 'crash', x: (car.x + other.x) / 2, y: (car.y + other.y) / 2, big: impact > 90 });
        state.fx.push({ type: 'carHit', x: other.x, y: other.y, byPlayer: true, police: other.kind === 'police' });
        state.shake = Math.min(9, state.shake + impact / 26);
      }
      const push = (34 - d) / 2;
      const nx = (other.x - car.x) / d, ny = (other.y - car.y) / d;
      other.x += nx * push; other.y += ny * push;
      if (other.kind === 'traffic' && other.ai) { /* traffic re-locks to its lane next tick */ }
      car.speed *= 0.72;
    }
  }
}

// Keep the traffic population topped up around the player.
export function maintainTraffic(state, count) {
  let traffic = 0, parked = 0;
  for (const c of state.cars) {
    if (c.dead) continue;
    if (c.kind === 'traffic') traffic++;
    if (c.kind === 'parked') parked++;
  }
  let guard = 0;
  while (traffic < count && guard++ < 8) {
    const car = makeTrafficCar(state.rng, state.city);
    if (dist(car.x, car.y, state.player.x, state.player.y) > 260) { state.cars.push(car); traffic++; }
  }
  if (parked === 0) {
    for (const spot of state.city.parking.slice(0, 14)) {
      if (state.rng.chance(0.75)) state.cars.push(makeParkedCar(state.rng, spot));
    }
  }
}
