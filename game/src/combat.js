// combat.js — the pistol, bullets, damage, deaths and pickups. The player shoots
// toward the mouse; foot cops and guards shoot back with spread. Bullets are fast
// projectiles stepped each tick so they stop at buildings and bodies.

import { dist } from './random.js';
import { pointInBuilding } from './city.js';
import { reportCrime } from './wanted.js';
import { startFlee } from './peds.js';

export const PISTOL = { damage: 26, cooldown: 0.21, range: 460, speed: 980, spread: 0.028 };

export function playerShoot(state, aimAngle) {
  const p = state.player;
  if (p.car || p.shootCd > 0) return;
  if (p.ammo <= 0) {
    state.fx.push({ type: 'dryFire' });
    p.shootCd = 0.3;
    return;
  }
  p.ammo--;
  p.shootCd = PISTOL.cooldown;
  const a = aimAngle + state.rng.range(-PISTOL.spread, PISTOL.spread);
  state.bullets.push({
    x: p.x + Math.cos(aimAngle) * 16, y: p.y + Math.sin(aimAngle) * 16,
    vx: Math.cos(a) * PISTOL.speed, vy: Math.sin(a) * PISTOL.speed,
    life: PISTOL.range / PISTOL.speed, from: 'player', damage: PISTOL.damage,
  });
  state.fx.push({ type: 'shot', x: p.x, y: p.y, angle: aimAngle });
  // Gunfire panics nearby civilians and, if witnessed, is a crime.
  for (const ped of state.peds) {
    if (!ped.dead && ped.kind === 'civ' && dist(ped.x, ped.y, p.x, p.y) < 190) startFlee(state, ped, p.x, p.y);
  }
  reportCrime(state, p.x, p.y, 3);
}

export function copShoot(state, ped) {
  const p = state.player;
  const base = Math.atan2(p.y - ped.y, p.x - ped.x);
  const a = base + state.rng.range(-0.09, 0.09);
  const speed = 820;
  state.bullets.push({
    x: ped.x + Math.cos(base) * 14, y: ped.y + Math.sin(base) * 14,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    life: 300 / speed, from: 'cop', damage: state.rng.range(6, 12),
  });
  state.fx.push({ type: 'shot', x: ped.x, y: ped.y, angle: base, quiet: true });
}

function hurtPed(state, ped, damage, angle) {
  if (ped.dead) return;
  ped.health -= damage;
  state.fx.push({ type: 'hitmark', x: ped.x, y: ped.y });
  if (ped.health <= 0) {
    ped.dead = true;
    ped.fallAngle = angle;
    state.fx.push({ type: 'pedDown', x: ped.x, y: ped.y, kind: ped.kind });
    if (ped.kind === 'cop') reportCrime(state, ped.x, ped.y, 10, true);
    else if (ped.kind === 'target' || ped.kind === 'guard') reportCrime(state, ped.x, ped.y, 6);
    else reportCrime(state, ped.x, ped.y, 8);
    // The fallen sometimes drop cash.
    if (state.rng.chance(0.4)) {
      state.pickups.push({ x: ped.x + 8, y: ped.y + 4, kind: 'cash', value: state.rng.int(8, 30), t: 0 });
    }
  } else if (ped.kind === 'civ') {
    startFlee(state, ped, state.player.x, state.player.y);
  } else if (ped.kind === 'target') {
    ped.state = 'flee';
    ped.fleeFrom = { x: state.player.x, y: state.player.y };
    ped.fleeTime = 3.5;
  } else if (ped.kind === 'guard') {
    ped.aggro = true;
  }
}

export function hurtPlayer(state, damage) {
  const p = state.player;
  if (p.dead) return;
  p.health -= damage;
  p.hurtFlash = 0.25;
  state.fx.push({ type: 'playerHurt' });
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    state.fx.push({ type: 'wasted' });
  }
}

export function updateBullets(state, dt) {
  const p = state.player;
  for (const b of state.bullets) {
    b.life -= dt;
    const steps = 3;
    for (let s = 0; s < steps && b.life > 0; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (pointInBuilding(state.city, b.x, b.y)) {
        b.life = 0;
        state.fx.push({ type: 'sparks', x: b.x, y: b.y, n: 2 });
        break;
      }
      if (b.from === 'player') {
        let hit = false;
        for (const ped of state.peds) {
          if (!ped.dead && dist(b.x, b.y, ped.x, ped.y) < 11) {
            hurtPed(state, ped, b.damage, Math.atan2(b.vy, b.vx));
            hit = true; break;
          }
        }
        if (!hit) {
          for (const car of state.cars) {
            if (!car.occupied && dist(b.x, b.y, car.x, car.y) < 20) {
              car.health -= b.damage * 0.5;
              state.fx.push({ type: 'sparks', x: b.x, y: b.y, n: 3 });
              hit = true; break;
            }
          }
        }
        if (hit) { b.life = 0; break; }
      } else {
        // Cop/guard bullet: can hit the player (on foot, or through the car at
        // reduced effect) — cars mostly shield the player.
        const target = p.car || p;
        const rr = p.car ? 20 : 11;
        if (!p.dead && dist(b.x, b.y, target.x, target.y) < rr) {
          hurtPlayer(state, p.car ? b.damage * 0.35 : b.damage);
          b.life = 0; break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);
}

// Pickups scattered around the city: health kits and cash bundles.
export function scatterPickups(state, count) {
  for (let i = 0; i < count; i++) {
    const bx = state.rng.int(0, 8), by = state.rng.int(0, 6);
    const x = 90 + bx * 240 + state.rng.range(-40, 40);
    const y = 90 + by * 240 + state.rng.range(-40, 40);
    const roll = state.rng.next();
    const kind = roll < 0.3 ? 'health' : roll < 0.55 ? 'ammo' : 'cash';
    state.pickups.push({ x, y, kind, value: kind === 'cash' ? state.rng.int(15, 45) : kind === 'health' ? 30 : 12, t: state.rng.range(0, 6) });
  }
}

export function updatePickups(state, dt) {
  const p = state.player;
  for (const pk of state.pickups) {
    pk.t += dt;
    if (pk.taken) continue;
    const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
    if (dist(px, py, pk.x, pk.y) < 24) {
      pk.taken = true;
      if (pk.kind === 'health') {
        p.health = Math.min(100, p.health + pk.value);
        state.fx.push({ type: 'pickup', kind: 'health' });
      } else if (pk.kind === 'ammo') {
        p.ammo += pk.value;
        state.fx.push({ type: 'pickup', kind: 'ammo', value: pk.value });
      } else {
        state.money += pk.value;
        state.fx.push({ type: 'pickup', kind: 'cash', value: pk.value });
      }
    }
  }
  // Collected pickups respawn elsewhere after a while, so the city stays stocked.
  state.pickups = state.pickups.filter((pk) => !pk.taken);
  if (state.pickups.length < 9 && state.rng.chance(dt * 0.25)) scatterPickups(state, 1);
}
