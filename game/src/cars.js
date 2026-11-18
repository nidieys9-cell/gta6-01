// cars.js — every vehicle in Sunhaven: parked cars, lane-following traffic with
// junction turns, police pursuit, and the arcade driving physics the player uses.
// Cars report crashes and bumps through state.events for main.js to answer with
// sound, shake and (when witnessed) wanted heat.

import { BLOCK, COLS, PITCH, ROAD, ROWS } from './config.js';
import { collideBuildings, isOnRoadX, isOnRoadY, laneCenter, roadBandStart } from './city.js';
import { chance, pick, range, rangeInt } from './random.js';
import { CAR_COLORS } from './config.js';

export const CAR_TYPES = {
  sedan: { w: 42, h: 21, topSpeed: 228, accel: 185, hp: 100 },
  taxi:  { w: 42, h: 21, topSpeed: 228, accel: 185, hp: 100 },
  coupe: { w: 40, h: 20, topSpeed: 268, accel: 225, hp: 90 },
  van:   { w: 48, h: 23, topSpeed: 196, accel: 150, hp: 130 },
  truck: { w: 58, h: 26, topSpeed: 168, accel: 118, hp: 280 },
  police:{ w: 44, h: 22, topSpeed: 292, accel: 245, hp: 140 },
};

const DIR_VEC = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const DIR_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
let nextCarId = 1;

export function makeCar(rng, type, x, y, angle, kind) {
  const spec = CAR_TYPES[type];
  return {
    id: nextCarId++, kind, type,
    x, y, angle, speed: 0,
    w: spec.w, h: spec.h,
    hp: spec.hp, maxHp: spec.hp,
    color: type === 'police' ? '#e8e8ec' : type === 'taxi' ? '#e8b83a' : type === 'truck' ? '#5d6a72' : pick(rng, CAR_COLORS),
    dir: angleToDir(angle),
    decidedFor: '',
    cruise: range(rng, 0.62, 0.85),
    driver: kind === 'traffic',
    wrecked: false,
    brake: false,
    honkT: 0,
    tag: null,          // mission tag: 'm2-target', 'm6-truck'
    occupant: null,     // ped reference while a traffic driver sits inside
  };
}

export function angleToDir(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= Math.PI * 1.75) return 0;
  if (a < Math.PI * 0.75) return 1;
  if (a < Math.PI * 1.25) return 2;
  return 3;
}

export function spawnParkedCars(state, count) {
  const rng = state.rng;
  for (let i = 0; i < count; i += 1) {
    // A few tries per car to keep parked cars from spawning nose-to-tail.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const horizontal = chance(rng, 0.5);
      const col = rangeInt(rng, 0, COLS - 1);
      const row = rangeInt(rng, 0, ROWS - 1);
      const bandX = col * PITCH;
      const bandY = row * PITCH;
      const along = range(rng, 24, BLOCK - 24);
      let x; let y; let angle;
      if (horizontal) {
        x = bandX + ROAD + along;
        y = bandY + (chance(rng, 0.5) ? 13 : ROAD - 13);
        angle = y < bandY + ROAD / 2 ? 0 : Math.PI;
      } else {
        x = bandX + (chance(rng, 0.5) ? 13 : ROAD - 13);
        y = bandY + ROAD + along;
        angle = x < bandX + ROAD / 2 ? Math.PI / 2 : -Math.PI / 2;
      }
      const crowded = state.cars.some((c) => Math.hypot(c.x - x, c.y - y) < 56);
      if (crowded && attempt < 7) continue;
      const type = pick(rng, ['sedan', 'sedan', 'coupe', 'van', 'taxi']);
      state.cars.push(makeCar(rng, type, x, y, angle, 'parked'));
      break;
    }
  }
}

export function spawnTraffic(state, count) {
  const rng = state.rng;
  for (let i = 0; i < count; i += 1) {
    const dir = rangeInt(rng, 0, 3);
    const band = rangeInt(rng, 0, dir % 2 === 0 ? ROWS : COLS) * PITCH;
    const along = range(rng, 30, (dir % 2 === 0 ? state.city.w : state.city.h) - 30);
    const lane = laneCenter(dir, band);
    const x = dir % 2 === 0 ? along : lane;
    const y = dir % 2 === 0 ? lane : along;
    const type = pick(rng, ['sedan', 'sedan', 'taxi', 'coupe', 'van']);
    const car = makeCar(rng, type, x, y, DIR_ANGLE[dir], 'traffic');
    car.dir = dir;
    state.cars.push(car);
  }
}

export function spawnPoliceCar(state, x, y) {
  const car = makeCar(state.rng, 'police', x, y, 0, 'police');
  state.cars.push(car);
  return car;
}

export function nearestCar(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of state.cars) {
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/** The slowest thing blocking the lane ahead of a car, or null. */
function obstacleAhead(state, car, dist) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let limit = null;
  const consider = (ox, oy, ospeed, radius) => {
    const dx = ox - car.x;
    const dy = oy - car.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < 4 || ahead > dist + radius) return;
    const side = Math.abs(-dx * fy + dy * fx);
    if (side > 17 + radius * 0.4) return;
    if (limit === null || ospeed < limit) limit = ospeed;
  };
  for (const other of state.cars) {
    if (other === car || other.wrecked) continue;
    consider(other.x, other.y, Math.abs(other.speed), 16);
  }
  for (const ped of state.peds) {
    if (!ped.dead) consider(ped.x, ped.y, 0, 8);
  }
  if (state.player && !state.player.car) consider(state.player.x, state.player.y, 0, 8);
  return limit;
}

function steerToward(car, tx, ty, dt, rate) {
  const want = Math.atan2(ty - car.y, tx - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
  car.angle += turn;
  return Math.abs(diff);
}

function updateTrafficCar(state, car, dt) {
  const spec = CAR_TYPES[car.type];
  const inIntersection = isOnRoadX(car.x) && isOnRoadY(car.y);
  if (inIntersection) {
    const key = `${roadBandStart(car.x)},${roadBandStart(car.y)}`;
    if (car.decidedFor !== key) {
      car.decidedFor = key;
      const roll = state.rng();
      if (roll >= 0.55) car.dir = (car.dir + (roll < 0.78 ? 1 : 3)) % 4;
    }
  }
  const vec = DIR_VEC[car.dir];
  let tx = car.x + vec.x * 130;
  let ty = car.y + vec.y * 130;
  if (!inIntersection) {
    if (car.dir % 2 === 0) ty = laneCenter(car.dir, roadBandStart(car.y));
    else tx = laneCenter(car.dir, roadBandStart(car.x));
  }
  const misalignment = steerToward(car, tx, ty, dt, 2.4);
  let target = spec.topSpeed * car.cruise * (misalignment > 0.6 ? 0.45 : 1);
  const blocker = obstacleAhead(state, car, 58);
  car.brake = blocker !== null && blocker < Math.abs(car.speed);
  if (blocker !== null) target = Math.min(target, blocker > 4 ? blocker * 0.92 : 0);
  if (car.brake && blocker === 0 && car.honkT <= 0) {
    car.honkT = range(state.rng, 2.5, 6);
    state.events.push({ type: 'honk', x: car.x, y: car.y });
  }
  car.honkT -= dt;
  approachSpeed(car, target, dt, spec);
}

function updatePoliceCar(state, car, dt) {
  const spec = CAR_TYPES[car.type];
  const player = state.player;
  const target = player.car ? player.car : player;
  const dist = Math.hypot(target.x - car.x, target.y - car.y);
  const seenRecently = state.time - state.wanted.lastSeen < 6;
  const tx = seenRecently ? target.x : state.wanted.lastSeenX;
  const ty = seenRecently ? target.y : state.wanted.lastSeenY;
  const misalignment = steerToward(car, tx, ty, dt, 3.1);
  let targetSpeed = spec.topSpeed * (misalignment > 0.7 ? 0.5 : 1);
  if (!player.car && dist < 64) targetSpeed = 0; // foot cops make the arrest, cars hold off
  if (!seenRecently && Math.hypot(tx - car.x, ty - car.y) < 60) targetSpeed = spec.topSpeed * 0.3;
  const blocker = obstacleAhead(state, car, 40);
  car.brake = blocker !== null && blocker < Math.abs(car.speed) && dist > 90;
  if (car.brake) targetSpeed = Math.min(targetSpeed, blocker);
  approachSpeed(car, targetSpeed, dt, spec);
}

function approachSpeed(car, target, dt, spec) {
  if (car.wrecked) target = 0;
  if (car.speed < target) car.speed = Math.min(target, car.speed + spec.accel * dt);
  else car.speed = Math.max(target, car.speed - 320 * dt);
}

/** Arcade driving for the player's car: throttle, steering, handbrake, damage. */
export function drivePlayerCar(state, car, inp, dt) {
  const spec = CAR_TYPES[car.type];
  if (car.wrecked) { approachSpeed(car, 0, dt, spec); return; }
  const throttle = -inp.moveY;
  const steer = inp.moveX;
  if (throttle > 0) {
    car.speed += spec.accel * throttle * dt * (car.speed < 0 ? 2.6 : 1);
  } else if (throttle < 0) {
    car.speed += spec.accel * 0.72 * throttle * dt * (car.speed > 0 ? 2.6 : 1);
  }
  car.speed -= car.speed * (inp.handbrake ? 1.9 : 0.32) * dt;
  if (!throttle) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
  car.speed = Math.max(-spec.topSpeed * 0.38, Math.min(spec.topSpeed, car.speed));
  const grip = inp.handbrake ? 1.65 : 1;
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 90) * (Math.abs(car.speed) > spec.topSpeed * 0.75 ? 0.72 : 1);
  car.angle += steer * 2.15 * grip * steerAuthority * Math.sign(car.speed) * dt * Math.min(1, Math.abs(car.speed) / 60 + 0.25);
  car.brake = throttle < 0 && car.speed > 4;
}

/** Integrate every car, resolve collisions, age damage states. Call once per step. */
export function updateCars(state, dt) {
  for (const car of state.cars) {
    if (car === state.player.car) drivePlayerCar(state, car, state.inp, dt);
    else if (car.kind === 'traffic' && !car.wrecked) updateTrafficCar(state, car, dt);
    else if (car.kind === 'police') updatePoliceCar(state, car, dt);
    else approachSpeed(car, 0, dt, CAR_TYPES[car.type]);

    const beforeX = car.x;
    const beforeY = car.y;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const fixed = collideBuildings(state.city, car.x, car.y, 17);
    if (fixed.x !== car.x || fixed.y !== car.y) {
      const impact = Math.abs(car.speed);
      car.x = fixed.x;
      car.y = fixed.y;
      if (impact > 90) damageCar(state, car, (impact - 80) * 0.16, car.x, car.y);
      car.speed *= 0.34;
    }
    void beforeX; void beforeY;
  }
  // Car-to-car: soft circles, hard hits cost health and make noise.
  for (let i = 0; i < state.cars.length; i += 1) {
    for (let j = i + 1; j < state.cars.length; j += 1) {
      const a = state.cars[i];
      const b = state.cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = 33;
      if (d === 0 || d >= minD) continue;
      const push = (minD - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const closing = Math.abs(a.speed - b.speed) + Math.min(Math.abs(a.speed), Math.abs(b.speed)) * 0.4;
      if (closing > 55 && state.time - (a.lastHitT || 0) > 0.25) {
        a.lastHitT = state.time;
        b.lastHitT = state.time;
        const dmg = (closing - 45) * 0.13;
        damageCar(state, a, dmg, a.x, a.y);
        damageCar(state, b, dmg, b.x, b.y);
        const playerInvolved = state.player.car === a || state.player.car === b;
        state.events.push({ type: 'crash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: closing, player: playerInvolved, other: state.player.car === a ? b : a });
        a.speed *= 0.55; b.speed *= 0.55;
      }
    }
  }
}

export function damageCar(state, car, amount, x, y) {
  if (car.wrecked) return;
  car.hp -= amount;
  state.events.push({ type: 'sparks', x, y, n: 3 });
  if (car.hp <= 0) {
    car.hp = 0;
    car.wrecked = true;
    car.speed = 0;
    state.events.push({ type: 'wreck', x: car.x, y: car.y, car });
  }
}
