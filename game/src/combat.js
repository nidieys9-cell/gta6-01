// combat.js — the pistol: bullets with tracers, hits on cars, people and the
// player, and the cash / health / ammo pickups scattered over Sunhaven.

import { lineOfSight } from './city.js';
import { damageCar } from './cars.js';
import { damagePed } from './peds.js';
import { range } from './random.js';

const BULLET_SPEED = 880;
const BULLET_LIFE = 0.55;

export function fireBullet(state, x, y, angle, owner) {
  state.bullets.push({
    x, y,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    life: BULLET_LIFE,
    owner, // 'player' | 'cop' | 'guard'
    dmg: owner === 'player' ? 22 : 8,
  });
  state.events.push({ type: 'muzzle', x, y, angle });
}

export function updateBullets(state, dt) {
  const player = state.player;
  const kept = [];
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) continue;
    let dead = false;

    // Buildings stop bullets cold.
    if (state.city.buildings.some((bd) => b.x >= bd.x && b.x <= bd.x + bd.w && b.y >= bd.y && b.y <= bd.y + bd.h)) {
      state.events.push({ type: 'sparks', x: b.x, y: b.y, n: 2 });
      continue;
    }

    // Cars soak bullets meant for the people behind them.
    for (const car of state.cars) {
      if (Math.abs(b.x - car.x) < car.w / 2 + 2 && Math.abs(b.y - car.y) < car.h / 2 + 2) {
        damageCar(state, car, b.dmg * 0.7, b.x, b.y);
        if (b.owner === 'player' && car === player.car) { /* own car: no crime */ }
        else if (b.owner === 'player') state.events.push({ type: 'crime', kind: 'assault', x: b.x, y: b.y });
        dead = true;
        break;
      }
    }
    if (dead) continue;

    if (b.owner === 'player') {
      for (const ped of state.peds) {
        if (ped.dead) continue;
        if (Math.hypot(ped.x - b.x, ped.y - b.y) < 11) {
          const wasAlive = ped.hp > 0;
          damagePed(state, ped, b.dmg, 'shot');
          state.events.push({ type: 'crime', kind: wasAlive && ped.hp <= 0 ? 'murder' : 'assault', x: b.x, y: b.y });
          dead = true;
          break;
        }
      }
    } else if (!player.car) {
      if (Math.hypot(player.x - b.x, player.y - b.y) < 12) {
        state.events.push({ type: 'playerHit', dmg: b.dmg, x: player.x, y: player.y });
        dead = true;
      }
    } else if (Math.abs(b.x - player.car.x) < player.car.w / 2 && Math.abs(b.y - player.car.y) < player.car.h / 2) {
      damageCar(state, player.car, b.dmg * 0.5, b.x, b.y);
      dead = true;
    }
    if (!dead) kept.push(b);
  }
  state.bullets = kept;
}

// ——— Pickups ———

const PICKUP_KINDS = ['cash', 'health', 'ammo'];

export function spawnPickups(state, count) {
  for (let i = 0; i < count; i += 1) {
    state.pickups.push(makePickup(state));
  }
}

function makePickup(state) {
  const block = state.city.blocks[Math.floor(state.rng() * state.city.blocks.length)];
  const r = block.rect;
  return {
    kind: PICKUP_KINDS[Math.floor(state.rng() * PICKUP_KINDS.length)],
    x: r.x + range(state.rng, 14, r.w - 14),
    y: r.y + range(state.rng, 14, r.h - 14),
    taken: false,
    respawnT: 0,
    bob: range(state.rng, 0, 6),
  };
}

export function updatePickups(state, dt) {
  const player = state.player;
  const px = player.car ? player.car.x : player.x;
  const py = player.car ? player.car.y : player.y;
  for (const p of state.pickups) {
    if (p.taken) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        const fresh = makePickup(state);
        p.kind = fresh.kind; p.x = fresh.x; p.y = fresh.y; p.taken = false;
      }
      continue;
    }
    if (Math.hypot(p.x - px, p.y - py) < 24) {
      p.taken = true;
      p.respawnT = range(state.rng, 14, 26);
      if (p.kind === 'cash') player.cash += 25;
      else if (p.kind === 'health') player.hp = Math.min(player.maxHp, player.hp + 30);
      else player.ammo += 12;
      state.events.push({ type: 'pickup', kind: p.kind, x: p.x, y: p.y });
    }
  }
}

/** A straight shot from a cop or guard at the player, with street-level accuracy. */
export function npcShootAt(state, ped, tx, ty, spread = 0.09) {
  const angle = Math.atan2(ty - ped.y, tx - ped.x) + range(state.rng, -spread, spread);
  if (!lineOfSight(state.city, ped.x, ped.y, tx, ty)) return;
  fireBullet(state, ped.x, ped.y, angle, ped.kind === 'guard' ? 'guard' : 'cop');
}
