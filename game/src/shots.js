// shots.js — deterministic screenshot scenes behind ?shot=title|mission|chase|night
// &seed=<n>. Each scene poses the real game state (never a mock-up): the same
// systems, the same city, arranged so a still frame shows as much of the game as
// possible — a chase with its wanted stars, minimap and objective for the chase
// scenes, Dede's first job for the mission scene, the start screen for the title.
// Normal play ignores the parameters entirely.
//
// A note on dayT: the sun cycle is DAY_LENGTH (300) long and sunLevels() maps
// phase 0.25 to noon and 0.5 to dusk — sunset is dayT 150, and by dayT 168 the
// darkness is already ~0.76, i.e. night for every practical purpose. A scene
// that wants daylight must sit near dayT 75, where darkness is exactly 0.

import { PITCH, ROAD } from './config.js';
import { setStars } from './wanted.js';
import { spawnPoliceCar } from './cars.js';

/** Parse the shot parameters from a URL query string; null when absent. */
export function readShotParams(search) {
  try {
    const params = new URLSearchParams(search || '');
    const name = params.get('shot');
    if (!name) return null;
    const seed = Number.parseInt(params.get('seed') || '1', 10);
    return { name, seed: Number.isFinite(seed) ? seed : 1 };
  } catch {
    return null;
  }
}

function placePlayerAt(state, x, y, angle) {
  state.player.x = x;
  state.player.y = y;
  state.player.angle = angle;
  state.cam.x = x;
  state.cam.y = y;
}

/**
 * Move ambient traffic and pedestrians out of a staged scene's way. A stray
 * traffic car parked in the chase corridor (or a civilian stepping off the
 * kerb) would hand the player crimes he never chose — a hit-and-run is worth
 * 30 heat, more than enough to spoil a carefully set star count.
 */
function clearCorridor(state, spareCar, cx, cy) {
  let moved = 0;
  for (const car of state.cars) {
    if (car === spareCar || car.kind === 'police') continue;
    if (Math.hypot(car.x - cx, car.y - cy) < 680) {
      // Exile it to the northernmost road, cruising away from every scene.
      car.x = 220 + (moved % 7) * 140;
      car.y = ROAD * 0.74;
      car.angle = 0;
      car.speed = 60;
      moved += 1;
    }
  }
  for (const ped of state.peds) {
    if (Math.hypot(ped.x - cx, ped.y - cy) < 280) {
      // Walkers wait on the north-west sidewalk corner of their own block.
      ped.x = Math.floor(ped.x / PITCH) * PITCH + ROAD + 8;
      ped.y = Math.floor(ped.y / PITCH) * PITCH + ROAD + 8;
    }
  }
}

/**
 * Pose a three-star car chase on a real traffic lane. Every unit travels the
 * same way at a matched speed with generous gaps: an oncoming or tailgating
 * unit would trade paint with the player within a second, and each witnessed
 * crash is +6 heat — the 34 points of headroom above three stars (110) would
 * be gone before the shutter clicks, and the HUD would show four.
 */
function stageChase(state, { anchorX, laneY, wrongLaneY, angle, playerSpeed }) {
  const coupe = state.cars.find((c) => c.kind === 'parked' && c.type === 'coupe')
    || state.cars.find((c) => c.kind === 'parked')
    || state.cars[0];
  coupe.x = anchorX;
  coupe.y = laneY;
  coupe.angle = angle;
  coupe.speed = playerSpeed;
  coupe.driver = false;
  state.player.car = coupe;
  placePlayerAt(state, coupe.x, coupe.y, coupe.angle);
  clearCorridor(state, coupe, coupe.x, coupe.y);
  state.mission.i = 2;
  state.mission.phase = 1;
  state.mission.timer = 118;
  setStars(state, 3);
  // Two squad cars on his tail in his lane, a third pacing him in the other
  // lane and drifting gently across — a chase, not a demolition derby.
  const dirX = Math.cos(angle);
  const spots = [
    { back: 470, y: laneY, a: angle },
    { back: 620, y: laneY, a: angle },
    { back: 545, y: wrongLaneY, a: angle + 0.06 },
  ];
  for (const s of spots) {
    const cop = spawnPoliceCar(state, coupe.x - dirX * s.back, s.y);
    cop.angle = s.a;
    cop.speed = 120;
  }
  state.mode = 'playing';
}

/** Pose the named scene on a freshly created game state. */
export function applyShot(state, name) {
  const places = state.city.places;
  if (name === 'mission') {
    // On foot outside the diner, Dede waiting, the first job on the HUD.
    placePlayerAt(state, places.diner.pad.x - 120, places.diner.pad.y + 66, -0.5);
    state.dayT = 62;
    state.mode = 'playing';
  } else if (name === 'chase') {
    // Midday downtown: eastbound on the road along the bank block's south
    // side, sun at its peak — darkness 0, no lit windows, no headlight cones.
    const band = (places.bank.row + 1) * PITCH;
    stageChase(state, {
      anchorX: places.bank.pad.x + 60,
      laneY: band + ROAD * 0.74,
      wrongLaneY: band + ROAD * 0.26,
      angle: 0,
      playerSpeed: 235,
    });
    state.dayT = 75; // exact noon
  } else if (name === 'night') {
    // Deep night in Port Solana: westbound on the harbour's south road, the
    // warehouse blocks of the port on both sides — another district, another
    // street, another direction from the downtown chase.
    const band = (places.drop.row + 1) * PITCH;
    stageChase(state, {
      anchorX: places.drop.pad.x - 420,
      laneY: band + ROAD * 0.26,
      wrongLaneY: band + ROAD * 0.74,
      angle: Math.PI,
      playerSpeed: 225,
    });
    state.dayT = 232; // deep night
  } else {
    // title: the start screen over a slow pan of Downtown.
    state.mode = 'title';
    state.dayT = 96;
    state.cam.x = places.bank.pad.x;
    state.cam.y = places.bank.pad.y;
  }
}
