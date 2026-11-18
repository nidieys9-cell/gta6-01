// config.js — every constant that shapes Sunhaven: world geometry, palette, tuning.
// One place to tune the game; everything else imports from here.

export const TILE = {
  road: 72,          // width of a road (two lanes + median dashes)
  block: 168,        // city block interior (buildings + sidewalk)
  sidewalk: 14,      // sidewalk ring inside each block
};
export const PITCH = TILE.road + TILE.block;      // 240 px between road centres
export const COLS = 9;                            // blocks across
export const ROWS = 7;                            // blocks down
export const WORLD_W = TILE.road + COLS * PITCH;  // 2232
export const WORLD_H = TILE.road + ROWS * PITCH;  // 1752

export const VIEW_W = 1280;
export const VIEW_H = 720;

export const PLAYER = {
  radius: 11,
  walkSpeed: 148,
  sprintSpeed: 238,
  maxHealth: 100,
};

export const CAR = {
  length: 46,
  width: 22,
  maxSpeed: 342,       // px/s, forward
  maxReverse: 108,
  accel: 265,
  brake: 430,
  drag: 0.62,          // per-second velocity retention factor base
  turnRate: 2.45,      // rad/s at full lock, scaled by speed
  maxHealth: 100,
};

export const WANTED = {
  // heat points needed to hold each star level (index = stars)
  thresholds: [0, 1, 7, 16, 30, 50],
  decayPerSec: 0.55,        // heat lost while unseen
  decayDelaySec: 4.5,       // grace period after last sighting before decay
  sightRange: 330,          // how far cops/peds see the player commit a crime
  policeCarsByStars: [0, 2, 3, 4, 6, 8],
  policeFootByStars: [0, 0, 0, 1, 3, 5],
};

export const DAY_LENGTH_SEC = 300;   // one full day/night cycle

// Sun-soaked coastal palette: warm asphalt, sand sidewalks, pastel + glass towers.
export const PALETTE = {
  asphalt: '#3d3f46',
  asphaltEdge: '#33353b',
  laneMark: '#e8c766',
  crosswalk: '#d8d8d2',
  sidewalk: '#b8a888',
  sidewalkEdge: '#9c8c6e',
  grass: '#69a854',
  sand: '#e3cf9e',
  water: '#3f8ea6',
  roofDowntown: ['#7d8ca3', '#93a5bd', '#6d7f99', '#a8b8cc'],
  roofBeach: ['#e8b4a0', '#f0c8ae', '#dfa58e', '#f5d7bd'],
  roofPort: ['#8a7f72', '#776c5e', '#998b7a'],
  roofSuburb: ['#b0563a', '#9c4f36', '#c4674a', '#a85a40'],
  wallDowntown: '#5d6d84',
  wallBeach: '#e9d9c8',
  wallPort: '#6e6257',
  wallSuburb: '#d9c6a8',
  carColors: ['#c94f42', '#3f6fb5', '#e0e4e8', '#2e2e33', '#e3b93c', '#4d9e6b', '#8e5aa8', '#d97c2e', '#7fb3c9', '#b5b0a4'],
  pedShirts: ['#d95f4b', '#4b7fd9', '#e8e3d5', '#59b06a', '#e0b83c', '#9a62b5', '#3fbfae', '#e07ba0'],
  pedPants: ['#33404f', '#5d5142', '#22242a', '#71543a', '#46586e'],
};

export const DISTRICTS = {
  downtown: { name: 'Downtown', tall: true },
  beach: { name: 'Palmera Beach', tall: false },
  port: { name: 'Port Solana', tall: false },
  suburb: { name: 'Las Colinas', tall: false },
};

// District by block: west strip is the beach, south-east the port, centre downtown,
// north and east suburbs. Keeps the map readable on the minimap and in screenshots.
export function districtAt(bx, by) {
  if (bx <= 1) return 'beach';
  if (by >= ROWS - 2 && bx >= COLS - 3) return 'port';
  if (bx >= 3 && bx <= 5 && by >= 2 && by <= 4) return 'downtown';
  return 'suburb';
}

export const SAVE_KEY = 'sunhaven-heat-save-v1';
