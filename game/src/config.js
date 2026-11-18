// config.js — every tuning number and colour for Sunhaven Heat in one place.
// The city is a grid of blocks separated by roads; all distances are world pixels.

export const ROAD = 96;            // road band width
export const BLOCK = 256;          // block interior (buildings + sidewalks)
export const PITCH = ROAD + BLOCK; // distance between neighbouring road starts
export const COLS = 9;             // blocks across
export const ROWS = 7;             // blocks down
export const WORLD_W = COLS * PITCH + ROAD;
export const WORLD_H = ROWS * PITCH + ROAD;

export const STEP = 1 / 60;        // fixed simulation step, seconds
export const DAY_LENGTH = 300;     // one full sun cycle, seconds

export const PLAYER = {
  radius: 11,
  walkSpeed: 128,
  sprintSpeed: 208,
  maxHp: 100,
  startCash: 120,
  startAmmo: 36,
  magSize: 12,
  fireInterval: 0.21,
  reloadTime: 0.9,
  reach: 46,                       // how close to a car door F/E works from
};

export const WANTED = {
  // heat needed to hold each star level (index = stars)
  thresholds: [0, 20, 45, 75, 110, 150],
  maxHeat: 190,
  decayDelay: 4.5,                 // seconds unseen before heat starts cooling
  decayRate: 3.2,                  // heat per second while cooling
  sightRange: 560,                 // how far police can see the player
  witnessRange: 270,               // how far a civilian can witness a crime
  hearRange: 230,                  // how far a gunshot is heard
  policeCars: [0, 1, 2, 3, 4, 6],  // squad cars wanted per star level
  footCops: [0, 0, 0, 2, 3, 5],    // foot cops wanted per star level
  grabTime: 0.9,                   // seconds of cop contact that ends in BUSTED
  crime: {
    gunshot: 7,
    carTheft: 18,
    carjack: 22,
    crash: 6,
    assault: 24,
    murder: 40,
    hitAndRun: 30,
  },
};

export const MISSION_REWARDS = [250, 400, 500, 650, 500, 700]; // sums to 3,000

export const DISTRICTS = {
  beach:   { name: 'Palmera Beach', ground: '#c9b083', walk: '#d8c096', roof: ['#e07856', '#e89b6a', '#d96f4e', '#ecc27f'], wall: '#f2e3c8' },
  downtown:{ name: 'Downtown',      ground: '#8d8d94', walk: '#a7a7ae', roof: ['#5d6a7a', '#6d7684', '#4d5866', '#7b8494'], wall: '#c9ccd4' },
  port:    { name: 'Port Solana',   ground: '#97907f', walk: '#aaa28f', roof: ['#7a6a52', '#8a7a5c', '#6b5d47', '#94855f'], wall: '#d8cdb4' },
  colinas: { name: 'Las Colinas',   ground: '#93a86e', walk: '#c9bd9d', roof: ['#b0563a', '#c06a44', '#a34d33', '#cd7f52'], wall: '#f4ead2' },
};

// Which district a block belongs to. Downtown is the north-centre slab, the beach the
// south-west shore, the port the south-east docks, Las Colinas the leafy north rim.
export function districtKeyAt(col, row) {
  if (row >= 4 && col <= 3) return 'beach';
  if (row >= 4 && col >= 6) return 'port';
  if (row <= 3 && col >= 3 && col <= 5) return 'downtown';
  return 'colinas';
}

export const CAR_COLORS = ['#c94f42', '#e0a458', '#5b84c4', '#63a05e', '#d8d3c8', '#7a5fa0', '#3f4145', '#e3e0d5', '#b56576', '#4e7d8a'];
export const PED_COLORS = ['#d95f4b', '#e8b34b', '#5b8dd9', '#63b06e', '#e3e0d5', '#9a6fc0', '#48a8a0', '#e58bb1', '#8a8f98', '#c97b4a'];
