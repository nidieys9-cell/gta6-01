// missions.js — Dede's story: six chained jobs for Marco Reyes in Sunhaven.
// Each mission is data + three small functions (setup, objective, check) run by
// main.js; rewards, banners and the finale all flow through state.fx.

import { dist } from './random.js';
import { makeCar } from './cars.js';
import { makePed, sidewalkPointNear } from './peds.js';
import { reportCrime } from './wanted.js';

function banner(state, title, sub) {
  state.fx.push({ type: 'banner', title, sub });
}

export const MISSIONS = [
  {
    id: 'welcome',
    title: 'First Night in Sunhaven',
    brief: "Dede runs the diner on Palmera Beach and owes you a favour. Go meet her.",
    reward: 50,
    setup(state) { return { place: state.city.places.diner }; },
    objective(rt) { return "Go to Dede's Diner"; },
    marker(state, rt) { return rt.place; },
    check(state, rt) { return dist(state.player.x, state.player.y, rt.place.x, rt.place.y) < 46; },
  },
  {
    id: 'wheels',
    title: 'Borrowed Wheels',
    brief: 'Dede needs a clean sedan — the blue one parked by the beach blocks. Take it, deliver it to Port Solana Garage.',
    reward: 200,
    setup(state) {
      // A specific parked car near the beach, marked for the job.
      const spot = { x: state.city.places.diner.x + 150, y: state.city.places.diner.y + 190 };
      const car = makeCar(state.rng, spot.x, spot.y, 0, 'mission');
      car.color = '#3f6fb5';
      car.driver = false;
      car.missionTag = 'wheels';
      state.cars.push(car);
      return { car, stage: 0 };
    },
    objective(rt) { return rt.stage === 0 ? 'Steal the marked blue sedan' : 'Deliver the sedan to Port Solana Garage'; },
    marker(state, rt) { return rt.stage === 0 ? rt.car : state.city.places.garage; },
    check(state, rt) {
      if (rt.stage === 0 && state.player.car === rt.car) {
        rt.stage = 1;
        banner(state, 'Wheels acquired', 'Take it to the garage — and try not to scratch it.');
      }
      if (rt.stage === 1) {
        const g = state.city.places.garage;
        return state.player.car === rt.car && dist(rt.car.x, rt.car.y, g.x, g.y) < 60;
      }
      return false;
    },
  },
  {
    id: 'courier',
    title: 'Hot Courier',
    brief: 'Pick up the package at the downtown payphone and run it to the Port Gate. The heat will notice — drive fast.',
    reward: 350,
    setup(state) { return { stage: 0, timeLeft: 0 }; },
    objective(rt) {
      return rt.stage === 0 ? 'Pick up the package at the payphone'
        : `Deliver to the Port Gate — ${Math.max(0, Math.ceil(rt.timeLeft))}s left`;
    },
    marker(state, rt) { return rt.stage === 0 ? state.city.places.payphone : state.city.places.portGate; },
    check(state, rt, dt) {
      if (rt.stage === 0) {
        const ph = state.city.places.payphone;
        if (dist(state.player.x, state.player.y, ph.x, ph.y) < 42) {
          rt.stage = 1;
          rt.timeLeft = 110;
          reportCrime(state, state.player.x, state.player.y, 16, true); // the pickup was watched
          banner(state, 'Package on board', 'The whole port district just heard about it. GO.');
        }
        return false;
      }
      rt.timeLeft -= dt;
      if (rt.timeLeft <= 0) {
        rt.stage = 0; // blown it: pick the package up again
        banner(state, 'Too slow', 'The buyer walked. Get the package again.');
        return false;
      }
      const g = state.city.places.portGate;
      const px = state.player.car ? state.player.car.x : state.player.x;
      const py = state.player.car ? state.player.car.y : state.player.y;
      return dist(px, py, g.x, g.y) < 56;
    },
  },
  {
    id: 'score',
    title: 'Settle the Score',
    brief: 'Vince Marlowe stiffed Dede and hired muscle. He strolls downtown with two guards. End the argument.',
    reward: 500,
    setup(state) {
      const c = state.city.places.station;
      const t = sidewalkPointNear(state.rng, c.x + 260, c.y + 120, 1);
      const target = makePed(state.rng, t.x, t.y, 'target');
      target.name = 'Vince Marlowe';
      state.peds.push(target);
      for (let i = 0; i < 2; i++) {
        const g = sidewalkPointNear(state.rng, t.x + 30 * (i + 1), t.y + 18 * i, 1);
        const guard = makePed(state.rng, g.x, g.y, 'guard');
        state.peds.push(guard);
      }
      return { target };
    },
    objective() { return 'Take out Vince Marlowe'; },
    marker(state, rt) { return rt.target.dead ? null : rt.target; },
    check(state, rt) { return rt.target.dead; },
  },
  {
    id: 'cooloff',
    title: 'Cool Off',
    brief: "Too much noise, Marco. Half the force is about to come looking — lose them. Break sight and stay hidden until the stars are gone.",
    reward: 400,
    setup(state) {
      reportCrime(state, state.player.x, state.player.y, 30, true);
      return {};
    },
    objective(rt, state) { return `Lose the heat (wanted: ${state.wanted.stars}★)`; },
    marker() { return null; },
    check(state) { return state.wanted.stars === 0 && state.wanted.heat <= 0.5; },
  },
  {
    id: 'bigscore',
    title: 'The Solana Score',
    brief: 'An armoured cash van sits at the Port Gate with your name on it. Steal it and bring it to the Palmera Safehouse. Every cop in Sunhaven will object.',
    reward: 1500,
    setup(state) {
      const g = state.city.places.portGate;
      const van = makeCar(state.rng, g.x - 60, g.y - 40, Math.PI, 'mission');
      van.color = '#4a4f57';
      van.health = 260;
      van.armored = true;
      van.driver = false;
      van.missionTag = 'van';
      state.cars.push(van);
      for (let i = 0; i < 2; i++) {
        const gp = sidewalkPointNear(state.rng, g.x - 30 + i * 46, g.y + 30, 1);
        state.peds.push(makePed(state.rng, gp.x, gp.y, 'guard'));
      }
      return { van, stage: 0 };
    },
    objective(rt) { return rt.stage === 0 ? 'Steal the armoured van at the Port Gate' : 'Deliver the van to the Palmera Safehouse'; },
    marker(state, rt) { return rt.stage === 0 ? rt.van : state.city.places.hideout; },
    check(state, rt) {
      if (rt.stage === 0 && state.player.car === rt.van) {
        rt.stage = 1;
        reportCrime(state, rt.van.x, rt.van.y, 50, true);
        banner(state, 'The Score is rolling', 'Every unit in Sunhaven is coming. Get to the safehouse.');
      }
      if (rt.stage === 1) {
        const h = state.city.places.hideout;
        return state.player.car === rt.van && dist(rt.van.x, rt.van.y, h.x, h.y) < 64;
      }
      return false;
    },
  },
];

// Start mission `index` (or mark the story done), pushing the title banner.
export function startMission(state, index) {
  if (index >= MISSIONS.length) {
    state.storyDone = true;
    state.mission = null;
    banner(state, 'Story complete', 'Sunhaven is yours, Marco. Free roam — the city keeps turning.');
    state.fx.push({ type: 'jingle', win: true });
    return;
  }
  const m = MISSIONS[index];
  state.missionIndex = index;
  state.mission = { def: m, rt: m.setup(state) };
  banner(state, m.title, m.brief);
  state.fx.push({ type: 'missionStart', title: m.title });
}

// Advance the active mission; on completion pay out and chain the next one.
export function updateMission(state, dt) {
  const cur = state.mission;
  if (!cur) return;
  if (cur.def.check(state, cur.rt, dt)) {
    state.money += cur.def.reward;
    state.fx.push({ type: 'missionDone', title: cur.def.title, reward: cur.def.reward });
    state.fx.push({ type: 'jingle', win: true });
    state.mission = null;
    state.nextMissionIn = 3.2; // a breath before Dede calls again
  }
}

export function currentObjective(state) {
  if (!state.mission) return state.storyDone ? 'Free roam — Sunhaven is yours.' : '';
  return state.mission.def.objective(state.mission.rt, state);
}

export function currentMarker(state) {
  if (!state.mission) return null;
  return state.mission.def.marker(state, state.mission.rt);
}
