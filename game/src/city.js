// city.js — generates Sunhaven: the road grid, blocks, buildings, props and pickups,
// and the geometry helpers (collision, lanes, sidewalks) every other system uses.
// Pure data + math, no DOM: the headless test exercises this file directly.

import { TILE, PITCH, COLS, ROWS, WORLD_W, WORLD_H, PALETTE, districtAt } from './config.js';
import { clamp } from './random.js';

// Road centre lines: vertical roads at x = road/2 + i*PITCH, horizontal likewise.
export const roadXs = [];
export const roadYs = [];
for (let i = 0; i <= COLS; i++) roadXs.push(TILE.road / 2 + i * PITCH);
for (let j = 0; j <= ROWS; j++) roadYs.push(TILE.road / 2 + j * PITCH);

// Block (bx,by) interior rect (the part inside the surrounding roads).
export function blockRect(bx, by) {
  return {
    x: TILE.road + bx * PITCH,
    y: TILE.road + by * PITCH,
    w: TILE.block,
    h: TILE.block,
  };
}

const ROOFS = {
  downtown: PALETTE.roofDowntown,
  beach: PALETTE.roofBeach,
  port: PALETTE.roofPort,
  suburb: PALETTE.roofSuburb,
};
const WALLS = {
  downtown: PALETTE.wallDowntown,
  beach: PALETTE.wallBeach,
  port: PALETTE.wallPort,
  suburb: PALETTE.wallSuburb,
};

// Builds the whole city for a seeded RNG. Returns buildings (with collision rects),
// props (trees, lamps, signs — decorative), parking spots and named places.
export function generateCity(rng) {
  const buildings = [];
  const props = [];
  const parking = [];   // {x, y, angle} spots along block edges where cars park
  const places = {};    // named story locations, filled in below

  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      const district = districtAt(bx, by);
      const r = blockRect(bx, by);
      const inner = {
        x: r.x + TILE.sidewalk,
        y: r.y + TILE.sidewalk,
        w: r.w - TILE.sidewalk * 2,
        h: r.h - TILE.sidewalk * 2,
      };
      // Subdivide the block interior into a 2x2 plot grid; each plot may hold a building.
      const plotW = inner.w / 2, plotH = inner.h / 2;
      for (let py = 0; py < 2; py++) {
        for (let px = 0; px < 2; px++) {
          if (rng.chance(0.14)) continue; // a vacant lot / plaza corner
          const pad = district === 'downtown' ? 5 : 9;
          const bw = plotW - pad * 2 - rng.range(0, 12);
          const bh = plotH - pad * 2 - rng.range(0, 12);
          const bxr = inner.x + px * plotW + pad + rng.range(0, 6);
          const byr = inner.y + py * plotH + pad + rng.range(0, 6);
          const floors = district === 'downtown' ? rng.int(6, 14)
            : district === 'port' ? rng.int(1, 2)
            : district === 'beach' ? rng.int(2, 5)
            : rng.int(1, 3);
          buildings.push({
            x: bxr, y: byr, w: bw, h: bh,
            district,
            roof: rng.pick(ROOFS[district]),
            wall: WALLS[district],
            floors,
            seed: rng.int(1, 1e9),
            // a few roof props make skylines read in screenshots
            acUnits: rng.int(0, district === 'downtown' ? 3 : 1),
            waterTower: district === 'downtown' && rng.chance(0.3),
          });
        }
      }
      // Props: palm trees on the beach, lamps everywhere, signs downtown.
      const propCount = rng.int(2, 4);
      for (let i = 0; i < propCount; i++) {
        const side = rng.int(0, 3);
        const t = rng.range(0.15, 0.85);
        let x, y;
        if (side === 0) { x = r.x + t * r.w; y = r.y + 6; }
        else if (side === 1) { x = r.x + t * r.w; y = r.y + r.h - 6; }
        else if (side === 2) { x = r.x + 6; y = r.y + t * r.h; }
        else { x = r.x + r.w - 6; y = r.y + t * r.h; }
        const kind = district === 'beach' ? 'palm' : rng.chance(0.45) ? 'lamp' : 'tree';
        props.push({ x, y, kind, seed: rng.int(1, 1e9) });
      }
      // Parking: a couple of spots on the block's south and east edges.
      if (rng.chance(0.85)) parking.push({ x: r.x + r.w * rng.range(0.3, 0.6), y: r.y + r.h + TILE.road / 2, angle: 0 });
      if (rng.chance(0.6)) parking.push({ x: r.x + r.w + TILE.road / 2, y: r.y + r.h * rng.range(0.3, 0.6), angle: Math.PI / 2 });
    }
  }

  // Named places the story uses (block coords chosen to spread across the map).
  const centre = (bx, by) => { const r = blockRect(bx, by); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  places.diner = { ...centre(1, 3), name: "Dede's Diner", bx: 1, by: 3 };
  places.garage = { ...centre(7, 5), name: 'Port Solana Garage', bx: 7, by: 5 };
  places.hideout = { ...centre(0, 0), name: 'Palmera Safehouse', bx: 0, by: 0 };
  places.hospital = { ...centre(4, 1), name: 'Sunhaven General', bx: 4, by: 1 };
  places.station = { ...centre(4, 3), name: 'SH Police HQ', bx: 4, by: 3 };
  places.portGate = { ...centre(8, 6), name: 'Port Gate', bx: 8, by: 6 };
  places.payphone = { ...centre(5, 2), name: 'Payphone', bx: 5, by: 2 };

  return { buildings, props, parking, places, worldW: WORLD_W, worldH: WORLD_H };
}

// --- collision -------------------------------------------------------------
// Circle vs every building AABB; resolves by pushing the circle out. Returns true
// if a collision happened (cars use the hit speed to price damage).
export function collideCircleBuildings(city, pos, radius) {
  let hit = false;
  for (const b of city.buildings) {
    const nx = clamp(pos.x, b.x, b.x + b.w);
    const ny = clamp(pos.y, b.y, b.y + b.h);
    const dx = pos.x - nx, dy = pos.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.y = ny + (dy / d) * radius;
      } else {
        // centre inside the rect: push out along the smallest penetration axis
        const left = pos.x - b.x, right = b.x + b.w - pos.x;
        const top = pos.y - b.y, bottom = b.y + b.h - pos.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = b.x - radius;
        else if (m === right) pos.x = b.x + b.w + radius;
        else if (m === top) pos.y = b.y - radius;
        else pos.y = b.y + b.h + radius;
      }
    }
  }
  pos.x = clamp(pos.x, radius, WORLD_W - radius);
  pos.y = clamp(pos.y, radius, WORLD_H - radius);
  return hit;
}

export function pointInBuilding(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

// --- roads -----------------------------------------------------------------
// Is this point on a road (not inside a block)?
export function onRoad(x, y) {
  const mx = x % PITCH, my = y % PITCH;
  return mx < TILE.road || my < TILE.road;
}

// Sidewalk ring of a block: where pedestrians stroll.
export function onSidewalk(x, y) {
  const mx = x % PITCH, my = y % PITCH;
  if (mx < TILE.road || my < TILE.road) return false;
  const lx = mx - TILE.road, ly = my - TILE.road;
  return lx < TILE.sidewalk + 4 || ly < TILE.sidewalk + 4 ||
    lx > TILE.block - TILE.sidewalk - 4 || ly > TILE.block - TILE.sidewalk - 4;
}

// Lane centre for a car travelling along a road: direction 0=E,1=S,2=W,3=N on the
// nearest vertical/horizontal road. Right-hand traffic: offset to the right.
export function lanePoint(roadIndex, horizontal, dirSign, along) {
  const c = horizontal ? roadYs[roadIndex] : roadXs[roadIndex];
  const off = TILE.road / 4; // 18 px right of centre
  if (horizontal) return { x: along, y: c + (dirSign > 0 ? off : -off) };
  return { x: c + (dirSign > 0 ? -off : off), y: along };
}

// The intersection (road crossing) nearest ahead for a car at (x,y) moving dir.
export function nearestRoadIndex(value, horizontal) {
  const arr = horizontal ? roadYs : roadXs;
  let best = 0, bd = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - value);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
