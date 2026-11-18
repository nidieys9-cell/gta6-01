// missions.js — Dede's six jobs: a short crime story chained end to end, each
// with an on-screen objective, a banner, and a cash reward (250+400+500+650+
// 500+700 = $3,000 for the whole chain). After the finale the city is free roam.

import { MISSION_REWARDS } from './config.js';
import { makeCar } from './cars.js';
import { makePed } from './peds.js';
import { clearWanted, setStars } from './wanted.js';

export const MISSION_TITLES = [
  'First Contact',
  'Hot Wheels',
  'Hot Package',
  'Settle the Score',
  'Cool Off',
  'The Solana Score',
];

function banner(state, title, sub) {
  state.events.push({ type: 'banner', title, sub });
}
function toast(state, text) {
  state.events.push({ type: 'toast', text });
}
function distTo(state, p) {
  return Math.hypot(state.player.x - p.x, state.player.y - p.y);
}

/** Set up the persistent cast and start the chain. Call once per new game. */
export function setupMissions(state) {
  const diner = state.city.places.diner;
  const dede = makePed(state, 'dede', diner.door.x + 14, diner.door.y + 8, { name: 'Dede' });
  state.mission.dede = dede;
  startMission(state, 0);
}

export function startMission(state, i) {
  const m = state.mission;
  m.i = i;
  m.phase = 0;
  m.timer = 0;
  m.data = {};
  const places = state.city.places;

  if (i === 1) {
    // A very stealable magenta coupe, parked up in Downtown.
    const bank = places.bank;
    const car = makeCar(state.rng, 'coupe', bank.pad.x + 90, bank.pad.y - 130, Math.PI, 'parked');
    car.color = '#d1345b';
    car.tag = 'm2-target';
    state.cars.push(car);
    m.data.car = car;
    toast(state, 'Dede: "That magenta coupe downtown? It is yours. Bring it to my garage."');
  } else if (i === 3) {
    const yard = places.yard;
    const vince = makePed(state, 'target', yard.pad.x, yard.pad.y - 30, { name: 'Vince Marlowe', post: { x: yard.pad.x, y: yard.pad.y - 30 } });
    vince.guardPost = { x: vince.x, y: vince.y };
    m.data.target = vince;
    m.data.guards = [
      makePed(state, 'guard', yard.pad.x - 42, yard.pad.y + 6, { post: { x: yard.pad.x - 42, y: yard.pad.y + 6 } }),
      makePed(state, 'guard', yard.pad.x + 42, yard.pad.y + 6, { post: { x: yard.pad.x + 42, y: yard.pad.y + 6 } }),
    ];
    for (const g of m.data.guards) g.guardPost = g.guardPost || { x: g.x, y: g.y };
    toast(state, 'Dede: "Vince Marlowe shorted us for the last time. His yard, down at the port."');
  } else if (i === 5) {
    const bank = places.bank;
    const truck = makeCar(state.rng, 'truck', bank.pad.x - 60, bank.pad.y - 120, 0, 'parked');
    truck.tag = 'm6-truck';
    state.cars.push(truck);
    m.data.car = truck;
    m.data.guards = [
      makePed(state, 'guard', truck.x - 30, truck.y + 26, { post: { x: truck.x - 30, y: truck.y + 26 } }),
      makePed(state, 'guard', truck.x + 34, truck.y - 24, { post: { x: truck.x + 34, y: truck.y - 24 } }),
    ];
    toast(state, 'Dede: "One last score, Marco. The bank\'s cash truck. Take it to the safehouse."');
  }
}

function completeMission(state) {
  const m = state.mission;
  const reward = MISSION_REWARDS[m.i];
  state.player.cash += reward;
  banner(state, `MISSION COMPLETE — ${MISSION_TITLES[m.i]}`, `+$${reward}`);
  state.events.push({ type: 'missionComplete', i: m.i, reward });
  const next = m.i + 1;
  if (next < MISSION_TITLES.length) {
    startMission(state, next);
  } else {
    m.i = MISSION_TITLES.length;
    m.phase = 0;
    m.data = {};
    state.freeRoam = true;
    banner(state, 'THE SOLANA SCORE — STORY COMPLETE', 'Sunhaven is yours now');
  }
}

export function updateMissions(state, dt) {
  const m = state.mission;
  const places = state.city.places;
  const player = state.player;
  state.objective = '';

  switch (m.i) {
    case 0: {
      state.objective = "Meet Dede outside the diner in Palmera Beach";
      if (distTo(state, places.diner.pad) < 58) completeMission(state);
      break;
    }
    case 1: {
      const car = m.data.car;
      if (!car || car.wrecked) {
        state.objective = 'The coupe is wrecked — Dede is sourcing another…';
        if (!m.data.wreckT) m.data.wreckT = state.time;
        if (state.time - m.data.wreckT > 4) startMissionKeepPhase(state);
      } else if (m.phase === 0) {
        state.objective = 'Steal the magenta coupe in Downtown';
        if (player.car === car) {
          m.phase = 1;
          toast(state, 'Dede: "That is the one. Now the garage — and try to keep the paint on."');
        }
      } else {
        state.objective = "Deliver the coupe to Dede's Garage";
        if (player.car === car && distTo(state, places.garage.pad) < 66) completeMission(state);
      }
      break;
    }
    case 2: {
      if (m.phase === 0) {
        state.objective = 'Pick up the package at the downtown payphone';
        if (distTo(state, places.payphone.pad) < 42) {
          m.phase = 1;
          m.timer = 150;
          setStars(state, 2);
          banner(state, 'HOT PACKAGE', 'The whole district just heard about it');
        }
      } else {
        m.timer -= dt;
        const left = Math.max(0, Math.ceil(m.timer));
        state.objective = `Deliver the package to the Harbour Drop — ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
        if (distTo(state, places.drop.pad) < 66) {
          completeMission(state);
        } else if (m.timer <= 0) {
          m.phase = 0;
          toast(state, 'Too late — the package went cold. Pick it up again.');
        }
      }
      break;
    }
    case 3: {
      const vince = m.data.target;
      state.objective = 'Settle the score with Vince Marlowe at Marlowe Yard';
      if (vince && !vince.dead && m.phase === 0 && distTo(state, vince) < 250) {
        m.phase = 1;
        banner(state, 'SETTLE THE SCORE', 'Vince has seen you');
      }
      if (vince && vince.dead) completeMission(state);
      break;
    }
    case 4: {
      if (m.phase === 0) {
        state.objective = 'Cause enough trouble to earn 3 stars';
        if (state.wanted.stars >= 3) {
          m.phase = 1;
          banner(state, 'COOL OFF', 'Now break their sight and let the heat die');
        }
      } else {
        state.objective = 'Lose the heat — stay out of sight until the stars are gone';
        if (state.wanted.stars === 0) completeMission(state);
      }
      break;
    }
    case 5: {
      const truck = m.data.car;
      if (m.phase === 0) {
        state.objective = "Steal the armoured cash truck at Solana Bank";
        if (truck && state.player.car === truck) {
          m.phase = 1;
          setStars(state, 4);
          banner(state, 'THE SOLANA SCORE', 'Every cop in Sunhaven is awake now');
        }
      } else {
        state.objective = 'Deliver the cash truck to the Safehouse in Port Solana';
        if (truck && player.car === truck && distTo(state, places.safehouse.pad) < 72) completeMission(state);
      }
      break;
    }
    default: {
      state.objective = 'Free roam — Sunhaven is yours';
    }
  }
}

function startMissionKeepPhase(state) {
  // Respawn the mission-2 coupe after a wreck, keeping the mission index.
  const bank = state.city.places.bank;
  const car = makeCar(state.rng, 'coupe', bank.pad.x + 90, bank.pad.y - 130, Math.PI, 'parked');
  car.color = '#d1345b';
  car.tag = 'm2-target';
  state.cars.push(car);
  state.mission.data = { car };
  state.mission.phase = 0;
}

/** Where the gold marker points right now, or null when there is no target. */
export function objectiveTarget(state) {
  const m = state.mission;
  const places = state.city.places;
  switch (m.i) {
    case 0: return places.diner.pad;
    case 1: return m.phase === 0 && m.data.car ? { x: m.data.car.x, y: m.data.car.y } : places.garage.pad;
    case 2: return m.phase === 0 ? places.payphone.pad : places.drop.pad;
    case 3: return m.data.target && !m.data.target.dead ? { x: m.data.target.x, y: m.data.target.y } : null;
    case 5: return m.phase === 0 && m.data.car ? { x: m.data.car.x, y: m.data.car.y } : places.safehouse.pad;
    default: return null;
  }
}

/** Save-file restore: jump the chain to a mission index without side effects. */
export function restoreMission(state, index) {
  state.mission.i = index;
  state.mission.phase = 0;
  state.mission.data = {};
  if (index >= MISSION_TITLES.length) {
    state.freeRoam = true;
    return;
  }
  if (index > 0) startMission(state, index);
}

/** When the player is wasted mid-mission, reset the fragile bits fairly. */
export function onPlayerWasted(state) {
  const m = state.mission;
  if (m.i === 2 && m.phase === 1) { m.phase = 0; m.timer = 0; }
  if (m.i === 3 && m.data.target && !m.data.target.dead) {
    m.data.target.hp = 60;
    m.phase = 0;
  }
  if (m.i === 4 && m.phase === 1) m.phase = 0;
  clearWanted(state);
}
