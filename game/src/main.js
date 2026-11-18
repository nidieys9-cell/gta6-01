// main.js — Sunhaven Heat's entry point: builds the world, runs the loop, owns the
// state machine (title / playing / paused / wasted / busted) and turns the fx
// events every other module pushes into sound, particles, banners and consequences.

import { VIEW_W, VIEW_H, WORLD_W, WORLD_H, PLAYER, DAY_LENGTH_SEC } from './config.js';
import { makeRng, clamp, dist } from './random.js';
import { generateCity, collideCircleBuildings } from './city.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { updateTrafficCar, updatePoliceCar, drivePlayerCar, maintainTraffic } from './cars.js';
import { updatePed, maintainPeds, makePed } from './peds.js';
import { makeWanted, updateWanted, reportCrime } from './wanted.js';
import { playerShoot, copShoot, updateBullets, updatePickups, scatterPickups } from './combat.js';
import { startMission, updateMission } from './missions.js';
import { prerenderCity, drawFrame, drawTitle, drawPause, drawEndScreen } from './render.js';
import { loadSave, writeSave } from './save.js';
import { shotName, seedParam, applyShot } from './shots.js';

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const input = new Input(canvas);
const sound = new SoundBank();

function freshPlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2,
    health: PLAYER.maxHealth,
    car: null,
    ammo: 60,
    shootCd: 0,
    aiming: false,
    moving: false,
    walkPhase: 0,
    hurtFlash: 0,
    dead: false,
  };
}

function createState(seed) {
  const rng = makeRng(seed);
  const city = generateCity(rng);
  const state = {
    rng, city,
    mode: 'title',
    elapsed: 0,
    dayTime: 0.3,
    cam: { x: 0, y: 0 },
    shake: 0,
    fx: [],
    particles: [],
    bullets: [],
    pickups: [],
    cars: [],
    peds: [],
    player: freshPlayer(city.places.hideout.x + 40, city.places.hideout.y + 130),
    wanted: makeWanted(),
    money: 25,
    missionIndex: 0,
    mission: null,
    nextMissionIn: 0,
    storyDone: false,
    banner: null,
    toast: null,
    menuIndex: 0,
    showHelp: false,
    endKind: null,
    endTimer: 0,
    policeSpawnCd: 0,
    hurtSoundCd: 0,
    saveExists: !!loadSave(),
  };
  maintainTraffic(state, 13);
  // A few parked cars near the start so the first steal is seconds away.
  scatterPickups(state, 10);
  return state;
}

let state = createState(seedParam(20261117));
const cityCanvas = prerenderCity(state.city);

// --- fx: the consequences layer ------------------------------------------------
function spawnParticles(state, x, y, n, color, speed, life, size, gravity = 0) {
  for (let i = 0; i < n; i++) {
    const a = state.rng.range(0, Math.PI * 2);
    const v = state.rng.range(speed * 0.3, speed);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - gravity * 0.3,
      life: life * state.rng.range(0.5, 1), maxLife: life,
      color, size: size * state.rng.range(0.6, 1.3), gravity,
    });
  }
}

function toast(state, text, t = 2.2) { state.toast = { text, t }; }

function processFx(state) {
  for (const e of state.fx) {
    switch (e.type) {
      case 'shot':
        if (dist(e.x, e.y, state.player.x, state.player.y) < 760) sound.gunshot();
        spawnParticles(state, e.x + Math.cos(e.angle) * 20, e.y + Math.sin(e.angle) * 20, 3, '#ffd873', 60, 0.12, 3);
        break;
      case 'dryFire': sound.dryFire(); break;
      case 'crash':
        if (dist(e.x, e.y, state.player.x, state.player.y) < 700) sound.crash(e.big);
        spawnParticles(state, e.x, e.y, e.big ? 12 : 6, '#f5c86b', 130, 0.4, 3);
        break;
      case 'sparks': spawnParticles(state, e.x, e.y, e.n, '#ffd873', 120, 0.3, 2.5); break;
      case 'fire': spawnParticles(state, e.x, e.y, e.n, '#e06a2e', 60, 0.8, 5); break;
      case 'hitmark': spawnParticles(state, e.x, e.y, 4, '#c93a30', 80, 0.3, 3); break;
      case 'pedHit':
        sound.crash(false);
        reportCrime(state, e.x, e.y, 9);
        spawnParticles(state, e.x, e.y, 8, '#c93a30', 90, 0.4, 3.5);
        break;
      case 'carHit':
        reportCrime(state, e.x, e.y, e.police ? 5 : 2);
        break;
      case 'pedDown':
        spawnParticles(state, e.x, e.y, 7, '#c93a30', 70, 0.45, 3.5);
        break;
      case 'copShoot': copShoot(state, e.ped); break;
      case 'playerHurt':
        if (state.hurtSoundCd <= 0) { sound.hurt(); state.hurtSoundCd = 0.35; }
        break;
      case 'pickup':
        if (e.kind === 'cash') { sound.cash(); toast(state, `+$${e.value} found`); }
        else if (e.kind === 'ammo') { sound.pickup(); toast(state, `+${e.value} rounds`); }
        else { sound.pickup(); toast(state, 'Patched up +30'); }
        break;
      case 'banner': state.banner = { title: e.title, sub: e.sub, t: 4.4 }; break;
      case 'jingle': sound.jingle(e.win); break;
      case 'missionDone':
        state.banner = { title: 'MISSION COMPLETE', sub: `${e.title} — +$${e.reward}`, t: 4.4 };
        state.missionIndex += 1;
        state.nextMissionIn = 3.4;
        writeSave(state);
        break;
      case 'starsUp': toast(state, `WANTED ${'★'.repeat(e.stars)}`, 1.8); sound.tone(660, 0.14, 'square', 0.16, 440); break;
      case 'escaped': toast(state, 'You lost the heat', 2.4); break;
      case 'eject':
        if (state.player.car) exitCar(state, true);
        toast(state, 'This car is wrecked — out!', 2.4);
        break;
      case 'busted':
        if (state.mode === 'playing') doBusted(state);
        break;
      case 'wasted':
        if (state.mode === 'playing') doWasted(state);
        break;
    }
  }
  state.fx.length = 0;
}

// --- player actions ---------------------------------------------------------------
function enterCar(state, car) {
  const p = state.player;
  if (car.driver) {
    // Pull the driver out: a fleeing pedestrian and a witnessed crime.
    const ped = makePed(state.rng, car.x + 14, car.y + 10, 'civ');
    ped.state = 'flee';
    ped.fleeFrom = { x: p.x, y: p.y };
    ped.fleeTime = 3;
    state.peds.push(ped);
    car.driver = false;
    reportCrime(state, car.x, car.y, 4);
    toast(state, 'Car jacked!', 1.6);
  } else if (car.kind === 'police') {
    reportCrime(state, car.x, car.y, 5);
  }
  p.car = car;
  car.occupied = true;
  p.x = car.x; p.y = car.y;
  sound.doorSlam();
}

function exitCar(state, wrecked = false) {
  const p = state.player;
  const car = p.car;
  if (!car) return;
  car.occupied = false;
  if (car.kind === 'traffic' && !car.driver) car.kind = 'parked';
  p.car = null;
  p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 26;
  p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 26;
  const pos = { x: p.x, y: p.y };
  collideCircleBuildings(state.city, pos, PLAYER.radius);
  p.x = pos.x; p.y = pos.y;
  sound.doorSlam();
}

function tryEnterExit(state) {
  const p = state.player;
  if (p.car) { exitCar(state); return; }
  let best = null, bd = 40;
  for (const car of state.cars) {
    if (car.dead) continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < bd) { bd = d; best = car; }
  }
  if (!best) return;
  if (best.driver && Math.abs(best.speed) > 42) { toast(state, 'Too fast to jack — block it first', 1.8); return; }
  enterCar(state, best);
}

function doWasted(state) {
  state.mode = 'wasted';
  state.endKind = 'wasted';
  state.endTimer = 0;
  sound.jingle(false);
  sound.setEngine(false);
  sound.setSiren(0);
}

function doBusted(state) {
  state.mode = 'busted';
  state.endKind = 'busted';
  state.endTimer = 0;
  sound.bustedSting();
  sound.setEngine(false);
  sound.setSiren(0);
}

function respawn(state) {
  const p = state.player;
  const place = state.endKind === 'wasted' ? state.city.places.hospital : state.city.places.station;
  const fine = state.endKind === 'wasted' ? Math.min(state.money, 150) : Math.min(state.money, 80 + state.wanted.stars * 60);
  state.money -= fine;
  if (p.car) { p.car.occupied = false; p.car = null; }
  p.x = place.x + 30; p.y = place.y + 120;
  p.health = PLAYER.maxHealth;
  p.dead = false;
  state.wanted = makeWanted();
  state.cars = state.cars.filter((c) => c.kind !== 'police');
  state.peds = state.peds.filter((ped) => ped.kind !== 'cop');
  state.mode = 'playing';
  toast(state, fine > 0 ? `-$${fine} — ${state.endKind === 'wasted' ? 'hospital bill' : 'fine paid'}` : 'Back on the street', 2.6);
  writeSave(state);
}

// --- per-frame updates ------------------------------------------------------------
function updatePlaying(state, dt) {
  const p = state.player;
  state.elapsed += dt;
  state.dayTime = (state.dayTime + dt / DAY_LENGTH_SEC) % 1;
  p.shootCd -= dt;
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  state.hurtSoundCd -= dt;

  // Player: driving or on foot.
  if (p.car) {
    drivePlayerCar(state, p.car, input, dt);
    p.x = p.car.x; p.y = p.car.y;
    p.angle = p.car.angle;
    sound.setEngine(true, Math.abs(p.car.speed) / 342);
  } else {
    sound.setEngine(false);
    const ax = input.moveAxis();
    const sprint = input.down('ShiftLeft', 'ShiftRight');
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    p.moving = ax.x !== 0 || ax.y !== 0;
    if (p.moving) {
      p.x += ax.x * speed * dt;
      p.y += ax.y * speed * dt;
      p.walkPhase += dt * (sprint ? 1.5 : 1);
      if (!p.aiming) p.angle = Math.atan2(ax.y, ax.x);
    }
    const pos = { x: p.x, y: p.y };
    collideCircleBuildings(state.city, pos, PLAYER.radius);
    p.x = pos.x; p.y = pos.y;
    // Aim + fire with the mouse.
    const aimWorld = { x: input.mouseX + state.cam.x, y: input.mouseY + state.cam.y };
    p.aiming = input.mouseDown;
    if (input.mouseDown) {
      p.angle = Math.atan2(aimWorld.y - p.y, aimWorld.x - p.x);
      playerShoot(state, p.angle);
    }
  }
  if (input.justPressed('KeyF', 'KeyE')) tryEnterExit(state);

  // World systems.
  for (const car of state.cars) {
    if (car.occupied || car.dead) continue;
    if (car.kind === 'traffic' && car.ai) updateTrafficCar(state, car, dt);
    else if (car.kind === 'police') updatePoliceCar(state, car, dt);
  }
  state.cars = state.cars.filter((c) => !c.dead || c.occupied);
  for (const ped of state.peds) updatePed(state, ped, dt);
  updateBullets(state, dt);
  updatePickups(state, dt);
  updateWanted(state, dt);
  updateMission(state, dt);
  if (!state.mission && !state.storyDone && state.mode === 'playing') {
    state.nextMissionIn -= dt;
    if (state.nextMissionIn <= 0) startMission(state, state.missionIndex);
  }
  maintainTraffic(state, 13);
  maintainPeds(state, 16);

  // Particles.
  for (const pt of state.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += (pt.gravity || 0) * dt;
  }
  state.particles = state.particles.filter((pt) => pt.life > 0);
  // Burning wrecks keep smoking.
  for (const car of state.cars) {
    if (car.health <= 0 && !car.dead) {
      car.smokeAcc += dt;
      if (car.smokeAcc > 0.12) {
        car.smokeAcc = 0;
        spawnParticles(state, car.x, car.y - 4, 1, '#3a3a3f', 22, 1.1, 6);
      }
    } else if (car.health < 35 && !car.dead) {
      car.smokeAcc += dt;
      if (car.smokeAcc > 0.3) {
        car.smokeAcc = 0;
        spawnParticles(state, car.x, car.y - 4, 1, '#6a6a70', 16, 0.8, 4);
      }
    }
  }

  // Siren volume follows the nearest squad car.
  let nearest = Infinity;
  for (const car of state.cars) {
    if (car.kind === 'police' && !car.dead) nearest = Math.min(nearest, dist(car.x, car.y, p.x, p.y));
  }
  sound.setSiren(nearest === Infinity ? 0 : clamp(1 - nearest / 620, 0, 1));
  sound.updateMusic(dt, true);

  // Camera follows the player (or their car), clamped to the world.
  const fx = p.car ? p.car.x : p.x, fy = p.car ? p.car.y : p.y;
  state.cam.x = clamp(fx - VIEW_W / 2, 0, Math.max(0, WORLD_W - VIEW_W));
  state.cam.y = clamp(fy - VIEW_H / 2, 0, Math.max(0, WORLD_H - VIEW_H));
  state.shake = Math.max(0, state.shake - dt * 16);
  if (state.banner) { state.banner.t -= dt; if (state.banner.t <= 0) state.banner = null; }
  if (state.toast) { state.toast.t -= dt; if (state.toast.t <= 0) state.toast = null; }
  processFx(state);
}

function startNewGame() {
  const seed = seedParam(20261117);
  state = createState(seed);
  state.mode = 'playing';
  startMission(state, 0);
  processFx(state);
}

function continueGame() {
  const save = loadSave();
  if (!save) { startNewGame(); return; }
  const seed = seedParam(20261117);
  state = createState(seed);
  state.mode = 'playing';
  state.money = save.money;
  state.storyDone = !!save.storyDone;
  state.player.x = save.x; state.player.y = save.y;
  state.player.health = clamp(save.health || 100, 10, 100);
  state.player.ammo = save.ammo ?? 60;
  state.missionIndex = save.missionIndex || 0;
  if (!state.storyDone) startMission(state, state.missionIndex);
  processFx(state);
  toast(state, 'Welcome back to Sunhaven', 2.2);
}

// Title menu: keyboard + click.
function updateTitle(dt) {
  state.elapsed += dt;
  state.dayTime = (state.dayTime + dt / (DAY_LENGTH_SEC * 2.4)) % 1;
  // The title camera drifts over downtown.
  state.cam.x = clamp(900 + Math.sin(state.elapsed * 0.045) * 300, 0, WORLD_W - VIEW_W);
  state.cam.y = clamp(760 + Math.cos(state.elapsed * 0.037) * 200, 0, WORLD_H - VIEW_H);
  for (const car of state.cars) {
    if (car.kind === 'traffic' && car.ai && !car.dead) updateTrafficCar(state, car, dt);
  }
  state.cars = state.cars.filter((c) => !c.dead);
  for (const ped of state.peds) updatePed(state, ped, dt);
  maintainPeds(state, 10);
  sound.updateMusic(dt, true);

  const items = state.saveExists ? 3 : 2;
  if (input.justPressed('ArrowUp', 'KeyW')) state.menuIndex = (state.menuIndex + items - 1) % items;
  if (input.justPressed('ArrowDown', 'KeyS')) state.menuIndex = (state.menuIndex + 1) % items;
  let activate = input.justPressed('Enter', 'Space');
  if (input.mouseClicked) {
    for (let i = 0; i < items; i++) {
      const y = 356 + i * 52;
      if (input.mouseX > VIEW_W / 2 - 150 && input.mouseX < VIEW_W / 2 + 150 && input.mouseY > y - 27 && input.mouseY < y + 13) {
        state.menuIndex = i;
        activate = true;
      }
    }
  }
  if (activate) {
    sound.ensure();
    const label = state.saveExists ? ['new', 'continue', 'help'][state.menuIndex] : ['new', 'help'][state.menuIndex];
    if (label === 'new') startNewGame();
    else if (label === 'continue') continueGame();
    else state.showHelp = !state.showHelp;
  }
  processFx(state);
}

// --- boot + loop --------------------------------------------------------------------
const shot = shotName();
if (shot && shot !== 'title') {
  state.mode = 'playing';
  startMission(state, shot === 'mission' ? 0 : 2);
  state.fx.length = 0;
  state.banner = null;
  applyShot(state, shot);
  processFx(state);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (input.justPressed('KeyM')) {
    sound.ensure();
    sound.setMuted(!sound.muted);
    toast(state, sound.muted ? 'Sound off' : 'Sound on', 1.4);
  }

  if (state.mode === 'title') {
    updateTitle(dt);
    drawFrame(g, state, cityCanvas);
    drawTitle(g, state, state.saveExists);
  } else if (state.mode === 'playing') {
    if (input.justPressed('KeyP', 'Escape')) {
      state.mode = 'paused';
    } else {
      updatePlaying(state, dt);
      drawFrame(g, state, cityCanvas);
    }
  } else if (state.mode === 'paused') {
    drawFrame(g, state, cityCanvas);
    drawPause(g, state);
    if (input.justPressed('KeyP', 'Escape')) state.mode = 'playing';
    if (input.justPressed('KeyS')) { writeSave(state); toast(state, 'Game saved', 1.6); }
  } else if (state.mode === 'wasted' || state.mode === 'busted') {
    state.endTimer += dt;
    drawFrame(g, state, cityCanvas);
    drawEndScreen(g, state, state.endKind);
    if ((input.justPressed('Enter') || input.mouseClicked) && state.endTimer > 0.6) respawn(state);
  }

  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
