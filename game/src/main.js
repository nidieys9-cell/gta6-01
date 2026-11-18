// main.js — Sunhaven Heat's glue: builds the game state, runs the fixed-step
// simulation (player, cars, people, bullets, wanted, missions), answers game
// events with sound, shake and consequences, and — in a browser — boots the
// page, the menu flow and the render loop. The simulation half is pure enough
// to run headless: createGame + stepGame never touch the DOM.

import { DAY_LENGTH, PLAYER, WORLD_H, WORLD_W } from './config.js';
import { districtAtPoint, generateCity, collideBuildings } from './city.js';
import { nearestCar, spawnParkedCars, spawnTraffic, updateCars } from './cars.js';
import { makePed, spawnCivilians, updatePeds } from './peds.js';
import { addHeat, clearWanted, reportCrime, updateWanted } from './wanted.js';
import { fireBullet, npcShootAt, spawnPickups, updateBullets, updatePickups } from './combat.js';
import { objectiveTarget, onPlayerWasted, restoreMission, setupMissions, updateMissions } from './missions.js';
import { createRenderer, spawnParticles, updateParticles } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { hasSave, readSave, writeSave } from './save.js';
import { applyShot, readShotParams } from './shots.js';
import { streamRng } from './random.js';

export function createGame(seed) {
  const city = generateCity(seed);
  const state = {
    seed,
    city,
    rng: streamRng(seed, 7),
    time: 0,
    dayT: 70, // mid-morning
    mode: 'title',
    menuSel: 0,
    hasSave: false,
    freeRoam: false,
    player: {
      x: city.places.diner.pad.x + 170, y: city.places.diner.pad.y + 96,
      angle: -Math.PI / 2, hp: PLAYER.maxHp, maxHp: PLAYER.maxHp,
      cash: PLAYER.startCash, ammo: PLAYER.startAmmo, mag: PLAYER.magSize,
      reloading: 0, fireCd: 0, hurtT: 0, car: null, walkPhase: 0,
    },
    cars: [], peds: [], bullets: [], pickups: [], particles: [],
    wanted: { heat: 0, stars: 0, lastSeen: -99, lastSeenX: 0, lastSeenY: 0, seenNow: false, grabT: 0, spawnT: 0 },
    mission: { i: 0, phase: 0, data: {}, timer: 0, dede: null },
    objective: '', objectiveTarget: null,
    banner: null, toasts: [],
    cam: { x: 0, y: 0, trauma: 0 },
    shakeX: 0, shakeY: 0,
    events: [], inp: null,
    over: null,
    lastNoiseX: -9999, lastNoiseY: -9999, lastNoiseT: -99,
    playerDistrict: 'beach',
    mouseWorld: null,
    stats: { shotsFired: 0, crimes: 0 },
    audio: null,
  };
  state.cam.x = state.player.x;
  state.cam.y = state.player.y;
  spawnParkedCars(state, 26);
  spawnTraffic(state, 15);
  spawnCivilians(state, 26);
  spawnPickups(state, 14);
  setupMissions(state);
  return state;
}

const EMPTY_INP = { moveX: 0, moveY: 0, sprint: false, handbrake: false, interact: false, fire: false, aimX: 0, aimY: 0, reload: false };

export function stepGame(state, inp, dt) {
  state.inp = inp || EMPTY_INP;
  state.time += dt;

  if (state.mode === 'title' || state.mode === 'howto') {
    // A slow pan across Downtown behind the menu.
    state.cam.x = state.city.places.bank.pad.x + Math.sin(state.time * 0.07) * 320;
    state.cam.y = state.city.places.bank.pad.y + Math.cos(state.time * 0.05) * 200;
    updateParticles(state, dt);
    drainEvents(state, true);
    return;
  }
  if (state.mode === 'paused') return;

  state.dayT = (state.dayT + dt) % DAY_LENGTH;
  const player = state.player;

  if (state.over) {
    state.over.t += dt;
    updateCars(state, dt);
    updatePeds(state, dt);
    updateParticles(state, dt);
    drainEvents(state, true);
    if (state.over.t > 2.6) respawn(state);
    ageOverlays(state, dt);
    return;
  }

  if (inp.interact) handleInteract(state);
  if (!player.car) updatePlayerOnFoot(state, inp, dt);
  updateCars(state, dt);
  if (player.car) {
    player.x = player.car.x;
    player.y = player.car.y;
    player.angle = player.car.angle;
  }
  carPedCollisions(state);
  updatePeds(state, dt);
  updateBullets(state, dt);
  updatePickups(state, dt);
  updateWanted(state, dt);
  updateMissions(state, dt);
  updateParticles(state, dt);
  drainEvents(state, false);

  // Camera, overlays, bookkeeping.
  const focus = player.car || player;
  state.cam.x += (focus.x - state.cam.x) * Math.min(1, dt * 5.2);
  state.cam.y += (focus.y - state.cam.y) * Math.min(1, dt * 5.2);
  state.cam.trauma = Math.max(0, state.cam.trauma - dt * 1.7);
  state.shakeX = (Math.random() * 2 - 1) * state.cam.trauma * 13;
  state.shakeY = (Math.random() * 2 - 1) * state.cam.trauma * 13;
  player.hurtT = Math.max(0, player.hurtT - dt);
  player.fireCd = Math.max(0, player.fireCd - dt);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const take = Math.min(PLAYER.magSize - player.mag, player.ammo);
      player.mag += take;
      player.ammo -= take;
    }
  }
  state.objectiveTarget = objectiveTarget(state);
  state.playerDistrict = districtAtPoint(player.x, player.y);
  ageOverlays(state, dt);
}

function ageOverlays(state, dt) {
  if (state.banner) {
    state.banner.t += dt;
    if (state.banner.t > state.banner.dur) state.banner = null;
  }
  for (const t of state.toasts) t.age += dt;
  state.toasts = state.toasts.filter((t) => t.age < 4.6).slice(-3);
}

function handleInteract(state) {
  const player = state.player;
  if (player.car) {
    const car = player.car;
    const side = car.angle + Math.PI / 2;
    const spot = collideBuildings(state.city, car.x + Math.cos(side) * 27, car.y + Math.sin(side) * 27, PLAYER.radius);
    player.x = spot.x;
    player.y = spot.y;
    player.car = null;
    car.driver = false;
    if (car.kind === 'traffic') car.kind = 'parked';
    return;
  }
  const car = nearestCar(state, player.x, player.y, PLAYER.reach);
  if (!car || car.wrecked) return;
  if (car.kind === 'traffic') {
    if (Math.abs(car.speed) > 62) return; // too fast to yank the driver out
    const driver = makePed(state, 'civ', car.x, car.y);
    driver.fleeT = 2.2;
    driver.fleeX = player.x;
    driver.fleeY = player.y;
    reportCrime(state, 'carjack', car.x, car.y);
    car.kind = 'parked';
  } else if (car.kind === 'parked') {
    reportCrime(state, 'carTheft', car.x, car.y);
  }
  player.car = car;
  car.driver = true;
  player.x = car.x;
  player.y = car.y;
}

function updatePlayerOnFoot(state, inp, dt) {
  const player = state.player;
  const mag = Math.hypot(inp.moveX, inp.moveY);
  if (mag > 0.05) {
    const speed = inp.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const nx = player.x + (inp.moveX / Math.max(1, mag)) * speed * dt;
    const ny = player.y + (inp.moveY / Math.max(1, mag)) * speed * dt;
    const fixed = collideBuildings(state.city, nx, ny, PLAYER.radius);
    player.x = fixed.x;
    player.y = fixed.y;
    player.walkPhase += dt * speed / 12;
    if (!inp.fire) player.angle = Math.atan2(inp.moveY, inp.moveX);
  }
  if (inp.aimX !== undefined && (inp.fire || inp.aiming)) {
    player.angle = Math.atan2(inp.aimY - player.y, inp.aimX - player.x);
  }
  if (inp.reload && player.reloading <= 0 && player.mag < PLAYER.magSize && player.ammo > 0) {
    player.reloading = PLAYER.reloadTime;
  }
  if (inp.fire && player.fireCd <= 0 && player.reloading <= 0) {
    if (player.mag <= 0) {
      if (state.audio) state.audio.dryFire();
      player.fireCd = 0.3;
      if (player.ammo > 0) player.reloading = PLAYER.reloadTime;
    } else {
      player.mag -= 1;
      player.fireCd = PLAYER.fireInterval;
      player.angle = Math.atan2(inp.aimY - player.y, inp.aimX - player.x);
      const mx = player.x + Math.cos(player.angle) * 15;
      const my = player.y + Math.sin(player.angle) * 15;
      fireBullet(state, mx, my, player.angle, 'player');
      state.stats.shotsFired += 1;
      state.lastNoiseX = player.x;
      state.lastNoiseY = player.y;
      state.lastNoiseT = state.time;
      reportCrime(state, 'gunshot', player.x, player.y);
      if (state.audio) state.audio.shot();
    }
  }
}

/** Cars versus people: fast metal wins, and somebody usually sees it. */
function carPedCollisions(state) {
  for (const car of state.cars) {
    if (Math.abs(car.speed) < 46 || car.wrecked) continue;
    for (const ped of state.peds) {
      if (ped.dead) continue;
      if (Math.hypot(ped.x - car.x, ped.y - car.y) < 17) {
        const away = Math.atan2(ped.y - car.y, ped.x - car.x);
        ped.x += Math.cos(away) * 14;
        ped.y += Math.sin(away) * 14;
        damagePedFromCar(state, ped, car);
      }
    }
    const player = state.player;
    if (!player.car && Math.hypot(player.x - car.x, player.y - car.y) < 16 && car !== player.car) {
      hurtPlayer(state, Math.min(34, Math.abs(car.speed) * 0.16), car.x, car.y);
      const away = Math.atan2(player.y - car.y, player.x - car.x);
      const fixed = collideBuildings(state.city, player.x + Math.cos(away) * 16, player.y + Math.sin(away) * 16, PLAYER.radius);
      player.x = fixed.x;
      player.y = fixed.y;
    }
  }
}

function damagePedFromCar(state, ped, car) {
  const wasAlive = ped.hp > 0;
  ped.hp -= Math.min(70, Math.abs(car.speed) * 0.42);
  if (ped.hp <= 0 && wasAlive) {
    ped.dead = true;
    ped.deadT = 0;
    state.events.push({ type: 'pedDown', ped, cause: 'car', byPlayer: state.player.car === car, x: ped.x, y: ped.y });
  } else {
    ped.fleeT = 1.4;
    ped.fleeX = car.x;
    ped.fleeY = car.y;
    if (state.player.car === car) reportCrime(state, 'assault', ped.x, ped.y);
  }
}

export function hurtPlayer(state, dmg, fromX, fromY) {
  const player = state.player;
  if (state.over) return;
  player.hp -= dmg;
  player.hurtT = 0.8;
  spawnParticles(state, player.x, player.y, 'sparks', 3);
  void fromX; void fromY;
  if (player.hp <= 0) {
    player.hp = 0;
    const fine = Math.min(player.cash, 150);
    player.cash -= fine;
    state.over = { kind: 'wasted', t: 0, text: `You woke up at St. Solana Hospital — $${fine} lighter` };
    if (state.audio) state.audio.wasted();
  }
}

function respawn(state) {
  const player = state.player;
  const over = state.over;
  state.over = null;
  player.car = null;
  if (over.kind === 'wasted') {
    const hospital = state.city.places.hospital;
    player.x = hospital.door.x;
    player.y = hospital.door.y + 10;
    player.hp = player.maxHp;
    onPlayerWasted(state);
  } else {
    const station = state.city.places.station;
    player.x = station.door.x;
    player.y = station.door.y + 10;
    player.hp = Math.max(player.hp, 40);
    clearWanted(state);
  }
  state.cam.x = player.x;
  state.cam.y = player.y;
}

/** Answer everything the world reported this step: sound, shake, heat, UI. */
function drainEvents(state) {
  const events = state.events;
  state.events = [];
  const camDist = (x, y) => Math.hypot(x - state.cam.x, y - state.cam.y);
  for (const ev of events) {
    switch (ev.type) {
      case 'crime':
        state.stats.crimes += 1;
        reportCrime(state, ev.kind, ev.x, ev.y);
        break;
      case 'crash':
        spawnParticles(state, ev.x, ev.y, 'sparks', 6);
        if (state.audio && camDist(ev.x, ev.y) < 760) state.audio.crash(ev.power);
        if (ev.player) {
          state.cam.trauma = Math.min(1, state.cam.trauma + ev.power / 300);
          reportCrime(state, 'crash', ev.x, ev.y);
          if (ev.power > 175) hurtPlayer(state, (ev.power - 175) * 0.055, ev.x, ev.y);
        }
        break;
      case 'sparks':
        spawnParticles(state, ev.x, ev.y, 'sparks', ev.n || 3);
        break;
      case 'muzzle':
        spawnParticles(state, ev.x, ev.y, 'flash', 2);
        break;
      case 'copShoot':
        npcShootAt(state, ev.ped, ev.tx, ev.ty);
        if (state.audio && camDist(ev.ped.x, ev.ped.y) < 640) state.audio.shot();
        break;
      case 'pedDown':
        if (ev.ped.kind === 'cop') addHeat(state, 12);
        if (ev.cause === 'car' && ev.byPlayer) reportCrime(state, 'hitAndRun', ev.x, ev.y);
        spawnParticles(state, ev.x, ev.y, 'puff', 5);
        break;
      case 'wreck': {
        if (state.audio && camDist(ev.x, ev.y) < 700) state.audio.crash(170);
        spawnParticles(state, ev.x, ev.y, 'fire', 8);
        if (state.player.car === ev.car) {
          const car = ev.car;
          const side = car.angle + Math.PI / 2;
          const spot = collideBuildings(state.city, car.x + Math.cos(side) * 28, car.y + Math.sin(side) * 28, PLAYER.radius);
          state.player.x = spot.x;
          state.player.y = spot.y;
          state.player.car = null;
          car.driver = false;
        }
        break;
      }
      case 'pickup':
        if (state.audio) state.audio.pickup();
        break;
      case 'honk':
        if (state.audio && camDist(ev.x, ev.y) < 520) state.audio.honk();
        break;
      case 'banner':
        state.banner = { title: ev.title, sub: ev.sub, t: 0, dur: 3.4 };
        break;
      case 'toast':
        state.toasts.push({ text: ev.text, age: 0 });
        break;
      case 'missionComplete':
        if (state.audio) state.audio.jingle();
        writeSave(state);
        state.hasSave = true;
        break;
      case 'busted': {
        if (state.over) break;
        const fine = Math.min(state.player.cash, 100 + 50 * state.wanted.stars);
        state.player.cash -= fine;
        state.over = { kind: 'busted', t: 0, text: `The SH Police took $${fine} in fines — released at HQ` };
        if (state.audio) state.audio.busted();
        break;
      }
      case 'playerHit':
        hurtPlayer(state, ev.dmg, ev.x, ev.y);
        break;
      default:
        break;
    }
  }
}

/** Apply a save object (from save.js) to a fresh game state. */
export function applySave(state, data) {
  if (!data) return;
  state.player.cash = data.cash ?? state.player.cash;
  state.player.x = data.x ?? state.player.x;
  state.player.y = data.y ?? state.player.y;
  state.player.hp = data.hp ?? state.player.hp;
  state.player.ammo = data.ammo ?? state.player.ammo;
  state.dayT = data.dayT ?? state.dayT;
  state.freeRoam = Boolean(data.freeRoam);
  state.cam.x = state.player.x;
  state.cam.y = state.player.y;
  restoreMission(state, data.mission ?? 0);
}

// ——— Browser boot (never runs headless) ———

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('game');
  const statusEl = document.getElementById('status');
  const renderer = createRenderer(canvas);
  const input = createInput(canvas);
  const audio = createAudio();
  const shot = readShotParams(window.location.search);
  const seed = shot && Number.isFinite(shot.seed) ? shot.seed : 1;

  let state = createGame(seed);
  state.audio = audio;
  state.hasSave = hasSave();
  renderer.buildCityPlates(state.city);
  if (shot) applyShot(state, shot.name);
  else state.mode = 'title';

  function freshRun(withSave) {
    state = createGame(seed);
    state.audio = audio;
    state.hasSave = hasSave();
    if (withSave) applySave(state, readSave());
    renderer.buildCityPlates(state.city);
    state.mode = 'playing';
    audio.unlock();
  }

  function menuItems() {
    return ['NEW GAME', ...(state.hasSave ? ['CONTINUE'] : []), 'HOW TO PLAY'];
  }

  function activateMenu(action) {
    audio.unlock();
    audio.uiClick();
    if (action === 'NEW GAME') freshRun(false);
    else if (action === 'CONTINUE') freshRun(true);
    else if (action === 'HOW TO PLAY') state.mode = 'howto';
  }

  input.setMenuTarget((mx, my) => {
    if (state.mode === 'howto') { state.mode = 'title'; return; }
    if (state.mode !== 'title' || !state._menuRects) return;
    state._menuRects.forEach((rect, i) => {
      if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
        state.menuSel = i;
        activateMenu(rect.action);
      }
    });
  });

  function buildInp(firstStep) {
    const axis = input.axis();
    const viewX = Math.max(0, Math.min(WORLD_W - canvas.width, state.cam.x - canvas.width / 2));
    const viewY = Math.max(0, Math.min(WORLD_H - canvas.height, state.cam.y - canvas.height / 2));
    const aimX = viewX + input.mouse.x;
    const aimY = viewY + input.mouse.y;
    state.mouseWorld = { x: aimX, y: aimY };
    return {
      moveX: axis.x, moveY: axis.y,
      sprint: input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'),
      handbrake: input.keys.has('Space'),
      interact: firstStep && (input.wasPressed('KeyF') || input.wasPressed('KeyE')),
      fire: input.mouse.down,
      aiming: true,
      aimX, aimY,
      reload: input.wasPressed('KeyR'),
    };
  }

  function handleKeys() {
    if (input.wasPressed('KeyM')) {
      const muted = audio.toggleMute();
      state.toasts.push({ text: muted ? 'Sound off' : 'Sound on', age: 0 });
    }
    if (state.mode === 'title') {
      const items = menuItems();
      if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) state.menuSel = (state.menuSel + items.length - 1) % items.length;
      if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) state.menuSel = (state.menuSel + 1) % items.length;
      if (input.wasPressed('Enter')) activateMenu(items[state.menuSel]);
    } else if (state.mode === 'howto') {
      if (input.wasPressed('Escape') || input.wasPressed('Enter')) state.mode = 'title';
    } else if (state.mode === 'playing') {
      if (input.wasPressed('KeyP') || input.wasPressed('Escape')) state.mode = 'paused';
    } else if (state.mode === 'paused') {
      if (input.wasPressed('KeyP') || input.wasPressed('Escape')) state.mode = 'playing';
      if (input.wasPressed('KeyS')) {
        writeSave(state);
        state.hasSave = true;
        state.toasts.push({ text: 'Progress saved', age: 0 });
      }
    }
    // Mouse hover picks the menu item under the cursor.
    if (state.mode === 'title' && state._menuRects) {
      state._menuRects.forEach((rect, i) => {
        if (input.mouse.x >= rect.x && input.mouse.x <= rect.x + rect.w && input.mouse.y >= rect.y && input.mouse.y <= rect.y + rect.h) state.menuSel = i;
      });
    }
  }

  let last = performance.now();
  let acc = 0;
  let lastObjective = '';
  function frame(now) {
    requestAnimationFrame(frame);
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    handleKeys();
    if (state.mode !== 'paused') {
      acc += delta;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 5) {
        stepGame(state, buildInp(steps === 0), 1 / 60);
        acc -= 1 / 60;
        steps += 1;
      }
      if (steps === 5) acc = 0;
    }
    let nearestCop = Infinity;
    for (const car of state.cars) {
      if (car.kind === 'police') nearestCop = Math.min(nearestCop, Math.hypot(car.x - state.player.x, car.y - state.player.y));
    }
    for (const ped of state.peds) {
      if (ped.kind === 'cop') nearestCop = Math.min(nearestCop, Math.hypot(ped.x - state.player.x, ped.y - state.player.y));
    }
    audio.update(delta, {
      nearestCop,
      stars: state.wanted.stars,
      inCar: Boolean(state.player.car),
      speed: state.player.car ? state.player.car.speed : 0,
      playing: state.mode === 'playing',
    });
    renderer.draw(state);
    if (statusEl && state.objective !== lastObjective) {
      lastObjective = state.objective;
      statusEl.textContent = state.objective;
    }
    input.endFrame();
  }
  requestAnimationFrame(frame);
}
