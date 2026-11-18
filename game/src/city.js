// city.js — generates Sunhaven: the block grid, buildings with roof detail, props,
// named places, and the geometry helpers every other system navigates by
// (roads, lanes, sidewalks, collision, line of sight).

import { BLOCK, COLS, PITCH, ROAD, ROWS, WORLD_H, WORLD_W, DISTRICTS, districtKeyAt } from './config.js';
import { chance, pick, range, rangeInt, streamRng } from './random.js';

export const SIDEWALK = 15; // paved margin inside each block, around the buildings

/** World rect of block (col,row)'s interior. */
export function blockRect(col, row) {
  return { x: col * PITCH + ROAD, y: row * PITCH + ROAD, w: BLOCK, h: BLOCK };
}

/** The district key of the block containing a world point. */
export function districtAtPoint(x, y) {
  const col = Math.max(0, Math.min(COLS - 1, Math.floor((x - ROAD) / PITCH)));
  const row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - ROAD) / PITCH)));
  return districtKeyAt(col, row);
}

export function isOnRoadX(x) { const m = ((x % PITCH) + PITCH) % PITCH; return m < ROAD; }
export function isOnRoadY(y) { const m = ((y % PITCH) + PITCH) % PITCH; return m < ROAD; }
export function isOnRoad(x, y) { return isOnRoadX(x) || isOnRoadY(y); }

/** Start coordinate of the road band containing x (for lane maths). */
export function roadBandStart(v) { return Math.floor(v / PITCH) * PITCH; }

/**
 * Lane centre for a car travelling in direction dir (0=E, 1=S, 2=W, 3=N) on the road
 * band starting at band (the perpendicular coordinate of the band's near edge).
 * Right-hand traffic: east rides the south lane, west the north, south the west,
 * north the east.
 */
export function laneCenter(dir, band) {
  if (dir === 0) return band + ROAD * 0.74;
  if (dir === 2) return band + ROAD * 0.26;
  if (dir === 1) return band + ROAD * 0.26;
  return band + ROAD * 0.74;
}

const PLACE_DEFS = [
  { id: 'diner',    label: "Dede's Diner",   col: 1, row: 4, district: 'beach' },
  { id: 'garage',   label: "Dede's Garage",  col: 2, row: 5, district: 'beach' },
  { id: 'station',  label: 'SH Police HQ',   col: 4, row: 1, district: 'downtown' },
  { id: 'bank',     label: 'Solana Bank',    col: 3, row: 2, district: 'downtown' },
  { id: 'hospital', label: 'St. Solana Hospital', col: 7, row: 1, district: 'colinas' },
  { id: 'payphone', label: 'Payphone',       col: 5, row: 3, district: 'downtown' },
  { id: 'drop',     label: 'Harbour Drop',   col: 8, row: 5, district: 'port' },
  { id: 'yard',     label: 'Marlowe Yard',   col: 7, row: 5, district: 'port' },
  { id: 'safehouse',label: 'Safehouse',      col: 6, row: 4, district: 'port' },
];

/**
 * Build the whole city from a seed. Buildings carry everything the renderer needs
 * (roof colour, floors, window grid, roof props) plus the collision rect the
 * physics uses; places are anchored to a lot inside their block with a ground pad
 * point the missions aim at.
 */
export function generateCity(seed) {
  const rng = streamRng(seed, 1);
  const buildings = [];
  const props = [];
  const blocks = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const rect = blockRect(col, row);
      const key = districtKeyAt(col, row);
      const palette = DISTRICTS[key];
      const block = { col, row, rect, district: key, buildings: [] };
      blocks.push(block);

      const place = PLACE_DEFS.find((p) => p.col === col && p.row === row);
      const lots = lotGrid(key);
      for (const lot of lots) {
        const isPlaceLot = place && lot === lots[0];
        const b = makeBuilding(rng, rect, lot, key, palette, isPlaceLot ? place : null);
        buildings.push(b);
        block.buildings.push(b);
      }

      // Props on the sidewalk ring: palms at the beach, lamps downtown, trees in
      // Las Colinas, crates and lamps at the port.
      const propKind = key === 'beach' ? 'palm' : key === 'colinas' ? 'tree' : key === 'port' ? 'crate' : 'lamp';
      const count = rangeInt(rng, 2, 4);
      for (let i = 0; i < count; i += 1) {
        const side = rangeInt(rng, 0, 3);
        const t = rng();
        const px = side === 0 ? rect.x + 8 + t * (BLOCK - 16) : side === 1 ? rect.x + 8 + t * (BLOCK - 16) : side === 2 ? rect.x + 8 : rect.x + BLOCK - 8;
        const py = side === 0 ? rect.y + 8 : side === 1 ? rect.y + BLOCK - 8 : rect.y + 8 + t * (BLOCK - 16);
        props.push({ kind: chance(rng, 0.3) ? 'lamp' : propKind, x: px, y: py, s: range(rng, 0.8, 1.25) });
      }
    }
  }

  const places = {};
  for (const def of PLACE_DEFS) {
    const building = buildings.find((b) => b.placeId === def.id);
    const rect = blockRect(def.col, def.row);
    places[def.id] = {
      ...def,
      building,
      // the pad sits on the sidewalk just south of the place's building
      pad: { x: building.x + building.w / 2, y: Math.min(rect.y + BLOCK - 10, building.y + building.h + 26) },
      door: { x: building.x + building.w / 2, y: building.y + building.h + 4 },
    };
  }

  return { seed, buildings, props, blocks, places, w: WORLD_W, h: WORLD_H };
}

function lotGrid(district) {
  // Each lot is a fraction rect inside the block: [fx, fy, fw, fh].
  if (district === 'port') return [[0.04, 0.04, 0.92, 0.42], [0.04, 0.54, 0.44, 0.42], [0.52, 0.54, 0.44, 0.42]];
  return [[0.04, 0.04, 0.44, 0.44], [0.52, 0.04, 0.44, 0.44], [0.04, 0.52, 0.44, 0.44], [0.52, 0.52, 0.44, 0.44]];
}

function makeBuilding(rng, block, lot, district, palette, place) {
  const inset = SIDEWALK + 4;
  const x = block.x + inset + lot[0] * (BLOCK - inset * 2);
  const y = block.y + inset + lot[1] * (BLOCK - inset * 2);
  const w = lot[2] * (BLOCK - inset * 2);
  const h = lot[3] * (BLOCK - inset * 2);
  const floors = district === 'downtown' ? rangeInt(rng, 6, 14) : district === 'port' ? rangeInt(rng, 1, 2) : rangeInt(rng, 1, 4);
  const roofProps = [];
  const propCount = district === 'downtown' ? rangeInt(rng, 1, 3) : rangeInt(rng, 0, 2);
  for (let i = 0; i < propCount; i += 1) {
    roofProps.push({
      kind: chance(rng, 0.35) ? 'tower' : 'ac',
      x: x + range(rng, 8, Math.max(9, w - 26)),
      y: y + range(rng, 8, Math.max(9, h - 26)),
      w: range(rng, 12, 22), h: range(rng, 10, 18),
    });
  }
  return {
    x, y, w, h, floors,
    roof: place ? '#8a4b3a' : pick(rng, palette.roof),
    wall: palette.wall,
    district,
    winCols: Math.max(2, Math.floor(w / 16)),
    winRows: Math.max(2, Math.floor(h / 16)),
    roofProps,
    placeId: place ? place.id : null,
    label: place ? place.label : null,
    seedBit: rng(),
  };
}

/** Push a circle out of every building rect it overlaps; returns the corrected point. */
export function collideBuildings(city, x, y, radius) {
  let px = x;
  let py = y;
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(px, b.x + b.w));
    const ny = Math.max(b.y, Math.min(py, b.y + b.h));
    const dx = px - nx;
    const dy = py - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      px = nx + (dx / d) * radius;
      py = ny + (dy / d) * radius;
    } else {
      // centre inside the rect: leave by the shallowest side
      const left = px - b.x; const right = b.x + b.w - px;
      const top = py - b.y; const bottom = b.y + b.h - py;
      const m = Math.min(left, right, top, bottom);
      if (m === left) px = b.x - radius;
      else if (m === right) px = b.x + b.w + radius;
      else if (m === top) py = b.y - radius;
      else py = b.y + b.h + radius;
    }
  }
  return { x: Math.max(radius, Math.min(WORLD_W - radius, px)), y: Math.max(radius, Math.min(WORLD_H - radius, py)) };
}

export function pointInBuilding(city, x, y, pad = 0) {
  for (const b of city.buildings) {
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return b;
  }
  return null;
}

/** Rough line of sight: sample the segment, blocked if it passes through a building. */
export function lineOfSight(city, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(dist / 26));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (pointInBuilding(city, x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
}

/** A random point on a block's sidewalk ring. */
export function randomSidewalkPoint(city, rng) {
  const block = pick(rng, city.blocks);
  const r = block.rect;
  const side = rangeInt(rng, 0, 3);
  const t = rng();
  if (side === 0) return { x: r.x + t * BLOCK, y: r.y + 7 };
  if (side === 1) return { x: r.x + t * BLOCK, y: r.y + BLOCK - 7 };
  if (side === 2) return { x: r.x + 7, y: r.y + t * BLOCK };
  return { x: r.x + BLOCK - 7, y: r.y + t * BLOCK };
}

/** A random point in the middle of a road, at least minDist from (x,y) when given. */
export function randomRoadPoint(rng, awayFrom = null, minDist = 0) {
  for (let tries = 0; tries < 12; tries += 1) {
    const vertical = chance(rng, 0.5);
    const band = rangeInt(rng, 0, vertical ? COLS : ROWS) * PITCH;
    const along = range(rng, 20, (vertical ? WORLD_H : WORLD_W) - 20);
    const p = vertical ? { x: band + ROAD / 2, y: along } : { x: along, y: band + ROAD / 2 };
    if (!awayFrom || Math.hypot(p.x - awayFrom.x, p.y - awayFrom.y) >= minDist) return p;
  }
  return { x: ROAD / 2, y: ROAD / 2 };
}
