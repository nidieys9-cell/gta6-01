// render.js — everything drawn: the pre-rendered city, cars and people, particles,
// the day/night grade with headlights and lit windows, the HUD and the minimap,
// and the title / pause / wasted / busted screens. Canvas 2D, no images.

import { TILE, PITCH, COLS, ROWS, WORLD_W, WORLD_H, VIEW_W, VIEW_H, PALETTE, districtAt } from './config.js';
import { clamp, lerp } from './random.js';
import { blockRect } from './city.js';
import { currentObjective, currentMarker } from './missions.js';

// --- static city pre-render -------------------------------------------------
// The whole city is painted once to an offscreen canvas (roads, sidewalks,
// buildings with sun shadows and roof detail, props). Each frame blits the
// camera's slice; night lighting is composited on top.
export function prerenderCity(city) {
  const cv = document.createElement('canvas');
  cv.width = WORLD_W; cv.height = WORLD_H;
  const g = cv.getContext('2d');

  // Ground: sand-grass base, then water along the west edge (the bay).
  g.fillStyle = PALETTE.grass;
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  g.fillStyle = PALETTE.water;
  g.fillRect(0, 0, 26, WORLD_H);
  g.fillStyle = 'rgba(255,255,255,0.13)';
  for (let y = 30; y < WORLD_H; y += 64) g.fillRect(4, y, 14, 26);

  // Blocks: sidewalk slab, then buildings.
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      const r = blockRect(bx, by);
      g.fillStyle = PALETTE.sidewalk;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = PALETTE.sidewalkEdge;
      g.lineWidth = 2;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      if (districtAt(bx, by) === 'beach') {
        g.fillStyle = PALETTE.sand;
        g.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
      }
    }
  }

  // Roads: asphalt strips over the ground between blocks.
  g.fillStyle = PALETTE.asphalt;
  for (let i = 0; i <= COLS; i++) g.fillRect(i * PITCH, 0, TILE.road, WORLD_H);
  for (let j = 0; j <= ROWS; j++) g.fillRect(0, j * PITCH, WORLD_W, TILE.road);
  g.fillStyle = PALETTE.asphaltEdge;
  for (let i = 0; i <= COLS; i++) { g.fillRect(i * PITCH, 0, 3, WORLD_H); g.fillRect(i * PITCH + TILE.road - 3, 0, 3, WORLD_H); }
  for (let j = 0; j <= ROWS; j++) { g.fillRect(0, j * PITCH, WORLD_W, 3); g.fillRect(0, j * PITCH + TILE.road - 3, WORLD_W, 3); }
  // Lane dashes.
  g.fillStyle = PALETTE.laneMark;
  for (let i = 0; i <= COLS; i++) {
    const cx = i * PITCH + TILE.road / 2;
    for (let y = 10; y < WORLD_H; y += 44) {
      if ((y % PITCH) < TILE.road) continue; // skip inside intersections
      g.fillRect(cx - 2, y, 4, 22);
    }
  }
  for (let j = 0; j <= ROWS; j++) {
    const cy = j * PITCH + TILE.road / 2;
    for (let x = 10; x < WORLD_W; x += 44) {
      if ((x % PITCH) < TILE.road) continue;
      g.fillRect(x, cy - 2, 22, 4);
    }
  }
  // Crosswalks at intersections.
  g.fillStyle = PALETTE.crosswalk;
  for (let i = 0; i <= COLS; i++) {
    for (let j = 0; j <= ROWS; j++) {
      const x = i * PITCH, y = j * PITCH;
      for (let s = 0; s < 5; s++) {
        g.fillRect(x + 8 + s * 12, y - 6, 7, 6);         // north zebra (over edge)
        g.fillRect(x + 8 + s * 12, y + TILE.road, 7, 6); // south
        g.fillRect(x - 6, y + 8 + s * 12, 6, 7);         // west
        g.fillRect(x + TILE.road, y + 8 + s * 12, 6, 7); // east
      }
    }
  }

  // Buildings: drop shadow (sun from the north-west), wall skirt, roof, detail.
  for (const b of city.buildings) {
    g.fillStyle = 'rgba(30,26,18,0.30)';
    g.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    g.fillStyle = b.wall;
    g.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    g.fillStyle = b.roof;
    g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1.5;
    g.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    // Roof parapet shading: lighter on the sun side.
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(b.x, b.y, b.w, 5);
    g.fillRect(b.x, b.y, 5, b.h);
    // Roof clutter: AC units and the odd water tower (downtown).
    let s = b.seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    g.fillStyle = 'rgba(40,42,48,0.35)';
    for (let i = 0; i < b.acUnits; i++) {
      const aw = 10 + rnd() * 12, ah = 8 + rnd() * 10;
      g.fillRect(b.x + 6 + rnd() * (b.w - aw - 12), b.y + 6 + rnd() * (b.h - ah - 12), aw, ah);
    }
    if (b.waterTower) {
      const tx = b.x + b.w / 2, ty = b.y + b.h / 2;
      g.fillStyle = '#6d5136';
      g.beginPath(); g.arc(tx, ty, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#543e28';
      g.beginPath(); g.moveTo(tx - 12, ty); g.lineTo(tx, ty - 13); g.lineTo(tx + 12, ty); g.closePath(); g.fill();
    }
    // Window grid, drawn dark by day; the night pass re-lights some.
    g.fillStyle = 'rgba(24,32,44,0.5)';
    const cols = Math.max(2, Math.floor(b.w / 16)), rows = Math.max(2, Math.floor(b.h / 16));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        g.fillRect(b.x + 6 + cx * 16, b.y + 6 + cy * 16, 7, 5);
      }
    }
    b._winCols = cols; b._winRows = rows;
  }

  // Props: lamps (dark post + head), trees and palms.
  for (const p of city.props) {
    if (p.kind === 'lamp') {
      g.fillStyle = '#2c2e33';
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
      g.fillStyle = '#f5e3ac';
      g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill();
    } else if (p.kind === 'palm') {
      g.fillStyle = '#7a5c3e';
      g.fillRect(p.x - 2, p.y - 2, 4, 5);
      g.strokeStyle = '#3f7d3a';
      g.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (p.seed % 7);
        g.beginPath(); g.moveTo(p.x, p.y);
        g.quadraticCurveTo(p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10 - 3, p.x + Math.cos(a) * 17, p.y + Math.sin(a) * 17 + 3);
        g.stroke();
      }
    } else {
      g.fillStyle = 'rgba(20,40,16,0.35)';
      g.beginPath(); g.arc(p.x + 3, p.y + 4, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4c8a3f';
      g.beginPath(); g.arc(p.x, p.y, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5da34e';
      g.beginPath(); g.arc(p.x - 3, p.y - 3, 7, 0, Math.PI * 2); g.fill();
    }
  }
  return cv;
}

// --- day/night ---------------------------------------------------------------
// dayTime 0..1 (0 = dawn). Returns darkness 0 (day) .. 1 (deep night).
export function darknessAt(dayTime) {
  const sun = Math.sin(dayTime * Math.PI * 2 - Math.PI / 2); // -1 night .. 1 noon
  return clamp((0.25 - sun) * 1.1, 0, 1);
}

// --- entities ------------------------------------------------------------------
function drawCar(g, car, t) {
  g.save();
  g.translate(car.x, car.y);
  g.rotate(car.angle);
  const L = car.armored ? 54 : 46, W = car.armored ? 26 : 22;
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(g, -L / 2 + 3, -W / 2 + 4, L, W, 6); g.fill();
  // body
  g.fillStyle = car.kind === 'police' ? '#e8e8ec' : car.color;
  if (car.health < 45) g.globalAlpha = 0.92;
  roundRect(g, -L / 2, -W / 2, L, W, 6); g.fill();
  g.globalAlpha = 1;
  // police livery + light bar
  if (car.kind === 'police') {
    g.fillStyle = '#1d2733';
    roundRect(g, -L * 0.18, -W / 2, L * 0.36, W, 3); g.fill();
    const phase = Math.floor(t * 5 + car.sirenPhase) % 2;
    g.fillStyle = phase ? '#ff4444' : '#ffee88';
    g.fillRect(-4, -W / 2 + 2, 8, 5);
    g.fillStyle = phase ? '#ffee88' : '#4488ff';
    g.fillRect(-4, W / 2 - 7, 8, 5);
  }
  // cabin + glass
  g.fillStyle = '#20262e';
  roundRect(g, -L * 0.16, -W / 2 + 3, L * 0.34, W - 6, 3); g.fill();
  g.fillStyle = '#9fc6d8';
  roundRect(g, L * 0.05, -W / 2 + 4, L * 0.1, W - 8, 2); g.fill();
  // mission marker colour band
  if (car.missionTag) {
    g.strokeStyle = '#ffd83d';
    g.lineWidth = 2;
    roundRect(g, -L / 2 - 2, -W / 2 - 2, L + 4, W + 4, 7); g.stroke();
  }
  // headlights / tail lights
  g.fillStyle = '#fff6c9';
  g.fillRect(L / 2 - 2, -W / 2 + 3, 3, 4);
  g.fillRect(L / 2 - 2, W / 2 - 7, 3, 4);
  g.fillStyle = '#d23b2e';
  g.fillRect(-L / 2 - 1, -W / 2 + 3, 3, 4);
  g.fillRect(-L / 2 - 1, W / 2 - 7, 3, 4);
  // damage: dents as dark scuffs
  if (car.health < 70) {
    g.fillStyle = 'rgba(20,20,20,0.35)';
    g.fillRect(L * 0.28, -W / 2, 8, 6);
    if (car.health < 40) g.fillRect(-L * 0.4, W / 2 - 7, 9, 7);
  }
  g.restore();
}

function drawPed(g, ped, t) {
  g.save();
  g.translate(ped.x, ped.y);
  if (ped.dead) {
    g.rotate(ped.fallAngle || 0);
    g.fillStyle = 'rgba(90,20,16,0.55)';
    g.beginPath(); g.ellipse(2, 0, 13, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ped.shirt;
    roundRect(g, -10, -5, 20, 10, 4); g.fill();
    g.fillStyle = '#d9a066';
    g.beginPath(); g.arc(13, 0, 4.5, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }
  // shadow + legs (walk bob) + body + head
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(1, 3, 8, 5, 0, 0, Math.PI * 2); g.fill();
  const bob = Math.sin(ped.walkPhase * 6) * (ped.speed > 4 ? 2 : 0);
  g.rotate(ped.angle);
  g.fillStyle = ped.pants;
  g.fillRect(-6, -5 + bob * 0.4, 6, 4);
  g.fillRect(-6, 1 - bob * 0.4, 6, 4);
  g.fillStyle = ped.shirt;
  roundRect(g, -7, -7, 15, 14, 5); g.fill();
  if (ped.kind === 'cop') { g.fillStyle = '#f2c93d'; g.fillRect(2, -5, 3, 10); } // badge stripe
  if (ped.kind === 'target') { g.strokeStyle = '#ffd83d'; g.lineWidth = 1.6; roundRect(g, -8, -8, 17, 16, 6); g.stroke(); }
  g.fillStyle = '#d9a066';
  g.beginPath(); g.arc(3, 0, 4.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(30,22,16,0.85)';
  g.beginPath(); g.arc(2, 0, 4.6, Math.PI * 0.6, Math.PI * 1.5); g.fill();
  g.restore();
}

function drawPlayer(g, state, t) {
  const p = state.player;
  if (p.car) return;
  g.save();
  g.translate(p.x, p.y);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(1, 3, 9, 5.5, 0, 0, Math.PI * 2); g.fill();
  g.rotate(p.angle);
  const bob = Math.sin(p.walkPhase * 7) * (p.moving ? 2 : 0);
  g.fillStyle = '#2e3440';
  g.fillRect(-6, -5 + bob * 0.4, 6, 4);
  g.fillRect(-6, 1 - bob * 0.4, 6, 4);
  // Marco: teal shirt, the one splash of colour the screenshots read as "you".
  g.fillStyle = '#17b3a6';
  roundRect(g, -7, -7, 15, 14, 5); g.fill();
  g.fillStyle = '#0f7a71';
  g.fillRect(-7, -7, 5, 14);
  // gun arm toward aim
  if (p.aiming || p.shootCd > 0.05) {
    g.fillStyle = '#22242a';
    g.fillRect(6, -2, 13, 4);
    g.fillStyle = '#d9a066';
    g.fillRect(5, -2.5, 5, 5);
  }
  g.fillStyle = '#e8b07d';
  g.beginPath(); g.arc(3, 0, 4.8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#241a12';
  g.beginPath(); g.arc(2, 0, 4.8, Math.PI * 0.55, Math.PI * 1.55); g.fill();
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --- main frame ------------------------------------------------------------------
export function drawFrame(g, state, cityCanvas) {
  const { cam } = state;
  g.fillStyle = '#20222a';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.save();
  g.translate(-Math.round(cam.x), -Math.round(cam.y));
  if (state.shake > 0.2) {
    g.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }
  g.drawImage(cityCanvas, 0, 0);

  // Pickups.
  for (const pk of state.pickups) {
    const bob = Math.sin(pk.t * 3) * 2;
    g.save();
    g.translate(pk.x, pk.y + bob);
    if (pk.kind === 'health') {
      g.fillStyle = '#f2f2f2'; roundRect(g, -8, -8, 16, 16, 3); g.fill();
      g.fillStyle = '#d23b2e'; g.fillRect(-2, -6, 4, 12); g.fillRect(-6, -2, 12, 4);
    } else if (pk.kind === 'ammo') {
      g.fillStyle = '#3c4048'; roundRect(g, -8, -6, 16, 12, 2); g.fill();
      g.fillStyle = '#e3b93c'; g.fillRect(-5, -3, 3, 6); g.fillRect(0, -3, 3, 6); g.fillRect(5, -3, 3, 6);
    } else {
      g.fillStyle = '#3f7d3a'; roundRect(g, -8, -5, 16, 10, 2); g.fill();
      g.fillStyle = '#cfe8c0'; g.fillRect(-8, -1.5, 16, 3);
    }
    g.restore();
  }

  // Objective marker: a bouncing chevron + light pillar.
  const marker = currentMarker(state);
  if (marker && state.mode === 'playing') {
    const bob = Math.sin(state.elapsed * 4) * 5;
    g.fillStyle = 'rgba(255,216,61,0.16)';
    g.fillRect(marker.x - 9, marker.y - 190, 18, 190);
    g.fillStyle = '#ffd83d';
    g.beginPath();
    g.moveTo(marker.x, marker.y - 34 + bob);
    g.lineTo(marker.x - 10, marker.y - 52 + bob);
    g.lineTo(marker.x + 10, marker.y - 52 + bob);
    g.closePath(); g.fill();
  }

  // Cars, peds, player, bullets.
  for (const car of state.cars) drawCar(g, car, state.elapsed);
  for (const ped of state.peds) drawPed(g, ped, state.elapsed);
  drawPlayer(g, state, state.elapsed);
  g.fillStyle = '#ffe9a8';
  for (const b of state.bullets) {
    g.beginPath(); g.arc(b.x, b.y, 2.2, 0, Math.PI * 2); g.fill();
  }
  // Particles.
  for (const pt of state.particles) {
    g.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    g.fillStyle = pt.color;
    g.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  g.globalAlpha = 1;
  g.restore();

  drawNightGrade(g, state);
  if (state.mode !== 'title') drawHUD(g, state);
}

function drawNightGrade(g, state) {
  const dark = darknessAt(state.dayTime);
  if (dark <= 0.02) return;
  const { cam } = state;
  g.fillStyle = `rgba(9,13,38,${(dark * 0.44).toFixed(3)})`;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.translate(-Math.round(cam.x), -Math.round(cam.y));
  // Streetlamp pools.
  for (const p of state.city.props) {
    if (p.kind !== 'lamp') continue;
    if (p.x < cam.x - 60 || p.x > cam.x + VIEW_W + 60 || p.y < cam.y - 60 || p.y > cam.y + VIEW_H + 60) continue;
    const gr = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, 44);
    gr.addColorStop(0, `rgba(255,214,130,${0.30 * dark})`);
    gr.addColorStop(1, 'rgba(255,214,130,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(p.x, p.y, 44, 0, Math.PI * 2); g.fill();
  }
  // Lit windows near the camera.
  g.fillStyle = `rgba(255,196,92,${0.75 * dark})`;
  for (const b of state.city.buildings) {
    if (b.x + b.w < cam.x || b.x > cam.x + VIEW_W || b.y + b.h < cam.y || b.y > cam.y + VIEW_H) continue;
    let s = b.seed;
    for (let cx = 0; cx < b._winCols; cx++) {
      for (let cy = 0; cy < b._winRows; cy++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        if ((s / 0x7fffffff) < 0.36) g.fillRect(b.x + 6 + cx * 16, b.y + 6 + cy * 16, 7, 5);
      }
    }
  }
  // Headlight cones.
  for (const car of state.cars) {
    if (car.dead) continue;
    const a = car.angle;
    const hx = car.x + Math.cos(a) * 24, hy = car.y + Math.sin(a) * 24;
    const gr = g.createRadialGradient(hx, hy, 4, hx + Math.cos(a) * 60, hy + Math.sin(a) * 60, 95);
    gr.addColorStop(0, `rgba(255,240,190,${0.20 * dark})`);
    gr.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(hx, hy);
    g.arc(hx + Math.cos(a) * 55, hy + Math.sin(a) * 55, 88, a - 0.42, a + 0.42);
    g.closePath(); g.fill();
  }
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

// --- HUD ---------------------------------------------------------------------------
function drawHUD(g, state) {
  const p = state.player;
  // Health bar, top-left.
  g.fillStyle = 'rgba(10,12,16,0.55)';
  roundRect(g, 16, 14, 224, 40, 7); g.fill();
  g.fillStyle = '#e8e8e8';
  g.font = 'bold 11px system-ui, sans-serif';
  g.fillText('MARCO REYES', 26, 28);
  g.fillStyle = '#3a3f47';
  roundRect(g, 26, 33, 160, 10, 4); g.fill();
  g.fillStyle = p.health > 30 ? '#59d977' : '#e0483e';
  roundRect(g, 26, 33, 160 * clamp(p.health / 100, 0, 1), 10, 4); g.fill();
  if (p.car) {
    g.fillStyle = '#9fb3c8';
    g.font = '10px system-ui, sans-serif';
    g.fillText(`CAR ${Math.max(0, Math.round(p.car.health))}%`, 192, 42);
  }
  // Money + stars, top-right.
  g.fillStyle = 'rgba(10,12,16,0.55)';
  roundRect(g, VIEW_W - 236, 14, 220, 40, 7); g.fill();
  g.fillStyle = '#7be382';
  g.font = 'bold 19px system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText(`$${state.money.toLocaleString('en-US')}`, VIEW_W - 26, 41);
  g.textAlign = 'left';
  // Wanted stars under the money.
  for (let i = 0; i < 5; i++) {
    const x = VIEW_W - 26 - (5 - i) * 24, y = 76;
    g.font = '21px system-ui, sans-serif';
    if (i < state.wanted.stars) {
      const flash = state.wanted.seenNow && Math.floor(state.elapsed * 3) % 2 === 0;
      g.fillStyle = flash ? '#ff5a4d' : '#ffd83d';
      g.fillText('★', x - 10, y);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillText('★', x - 10, y);
    }
  }
  if (state.wanted.stars > 0 && !state.wanted.seenNow) {
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText('LOSING THEM…', VIEW_W - 26, 94);
    g.textAlign = 'left';
  }
  // Weapon, bottom-right.
  if (!p.car) {
    g.fillStyle = 'rgba(10,12,16,0.55)';
    roundRect(g, VIEW_W - 168, VIEW_H - 58, 152, 44, 7); g.fill();
    g.fillStyle = '#e8e8e8';
    g.font = 'bold 13px system-ui, sans-serif';
    g.fillText('PISTOL', VIEW_W - 152, VIEW_H - 32);
    g.fillStyle = p.ammo > 0 ? '#ffd83d' : '#e0483e';
    g.font = 'bold 15px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${p.ammo}`, VIEW_W - 28, VIEW_H - 31);
    g.textAlign = 'left';
  } else {
    g.fillStyle = 'rgba(10,12,16,0.55)';
    roundRect(g, VIEW_W - 168, VIEW_H - 58, 152, 44, 7); g.fill();
    g.fillStyle = '#e8e8e8';
    g.font = 'bold 15px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${Math.round(Math.abs(p.car.speed) * 0.36)} km/h`, VIEW_W - 28, VIEW_H - 31);
    g.textAlign = 'left';
  }
  // Objective, top-centre.
  const obj = currentObjective(state);
  if (obj && state.mode === 'playing') {
    g.font = 'bold 15px system-ui, sans-serif';
    const w = g.measureText(obj).width + 34;
    g.fillStyle = 'rgba(10,12,16,0.55)';
    roundRect(g, (VIEW_W - w) / 2, 14, w, 30, 7); g.fill();
    g.fillStyle = '#ffd83d';
    g.fillText('◆', (VIEW_W - w) / 2 + 10, 35);
    g.fillStyle = '#f2f2f2';
    g.fillText(obj, (VIEW_W - w) / 2 + 28, 35);
  }
  drawMinimap(g, state);
  // Banner (mission titles, story beats).
  if (state.banner && state.banner.t > 0) {
    const a = clamp(state.banner.t / 0.5, 0, 1);
    g.globalAlpha = a;
    g.fillStyle = 'rgba(8,10,14,0.72)';
    const bw = 620;
    roundRect(g, (VIEW_W - bw) / 2, 96, bw, state.banner.sub ? 84 : 58, 9); g.fill();
    g.fillStyle = '#ffd83d';
    g.font = 'bold 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(state.banner.title, VIEW_W / 2, 132);
    if (state.banner.sub) {
      g.fillStyle = '#e8e8e8';
      g.font = '13.5px system-ui, sans-serif';
      wrapText(g, state.banner.sub, VIEW_W / 2, 156, bw - 48, 17);
    }
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }
  // Hurt vignette.
  if (p.hurtFlash > 0) {
    g.fillStyle = `rgba(200,30,20,${(p.hurtFlash * 0.55).toFixed(3)})`;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (state.toast) {
    g.fillStyle = 'rgba(10,12,16,0.6)';
    g.font = 'bold 14px system-ui, sans-serif';
    const w = g.measureText(state.toast.text).width + 26;
    roundRect(g, (VIEW_W - w) / 2, VIEW_H - 108, w, 28, 7); g.fill();
    g.fillStyle = '#aef0b0';
    g.textAlign = 'center';
    g.fillText(state.toast.text, VIEW_W / 2, VIEW_H - 89);
    g.textAlign = 'left';
  }
}

function wrapText(g, text, cx, y, maxW, lh) {
  const words = text.split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, cx, yy);
      line = w; yy += lh;
    } else line = test;
  }
  if (line) g.fillText(line, cx, yy);
}

// --- minimap ---------------------------------------------------------------------
function drawMinimap(g, state) {
  const mw = 196, mh = 156, x0 = 16, y0 = VIEW_H - mh - 16;
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  g.fillStyle = 'rgba(10,14,18,0.72)';
  roundRect(g, x0 - 4, y0 - 4, mw + 8, mh + 8, 8); g.fill();
  g.save();
  g.beginPath(); g.rect(x0, y0, mw, mh); g.clip();
  g.fillStyle = '#20262e';
  g.fillRect(x0, y0, mw, mh);
  // Blocks by district colour.
  const dc = { downtown: '#5d7ea6', beach: '#d9b77c', port: '#7a6a55', suburb: '#59824c' };
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      const r = blockRect(bx, by);
      g.fillStyle = dc[districtAt(bx, by)];
      g.fillRect(x0 + r.x * sx, y0 + r.y * sy, r.w * sx, r.h * sy);
    }
  }
  // Pickups.
  g.fillStyle = '#7be382';
  for (const pk of state.pickups) g.fillRect(x0 + pk.x * sx - 1, y0 + pk.y * sy - 1, 2, 2);
  // Mission marker.
  const marker = currentMarker(state);
  if (marker) {
    const pulse = 3 + Math.sin(state.elapsed * 5) * 1.2;
    g.fillStyle = '#ffd83d';
    g.beginPath(); g.arc(x0 + marker.x * sx, y0 + marker.y * sy, pulse, 0, Math.PI * 2); g.fill();
  }
  // Police blips, flashing.
  const flash = Math.floor(state.elapsed * 2.4) % 2 === 0;
  for (const car of state.cars) {
    if (car.kind !== 'police' || car.dead) continue;
    g.fillStyle = flash ? '#ff5a4d' : '#5aa0ff';
    g.fillRect(x0 + car.x * sx - 2, y0 + car.y * sy - 2, 4, 4);
  }
  for (const ped of state.peds) {
    if (ped.kind !== 'cop' || ped.dead) continue;
    g.fillStyle = flash ? '#ff5a4d' : '#5aa0ff';
    g.fillRect(x0 + ped.x * sx - 1.5, y0 + ped.y * sy - 1.5, 3, 3);
  }
  // The player's car, if driving.
  if (state.player.car) {
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + state.player.car.x * sx - 2, y0 + state.player.car.y * sy - 2, 4, 4);
  }
  // Player arrow.
  const p = state.player;
  const px = x0 + p.x * sx, py = y0 + p.y * sy;
  g.translate(px, py);
  g.rotate(p.angle);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.font = '10px system-ui, sans-serif';
  g.fillText('SUNHAVEN', x0 + 4, y0 + 12);
}

// --- screens -----------------------------------------------------------------------
export function drawTitle(g, state, hasSave) {
  // Sunset gradient sky over a dimmed city (drawn by drawFrame beneath).
  const gr = g.createLinearGradient(0, 0, 0, VIEW_H);
  gr.addColorStop(0, 'rgba(255,138,76,0.34)');
  gr.addColorStop(0.55, 'rgba(38,24,54,0.45)');
  gr.addColorStop(1, 'rgba(8,10,18,0.78)');
  g.fillStyle = gr;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = '#ffd83d';
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillText('S U N H A V E N', VIEW_W / 2, 168);
  g.fillStyle = '#ffffff';
  g.font = '900 92px system-ui, sans-serif';
  g.fillText('HEAT', VIEW_W / 2, 258);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '16px system-ui, sans-serif';
  g.fillText('An open-world crime story in a sun-soaked city that never cools down.', VIEW_W / 2, 292);
  // Menu.
  const items = hasSave ? ['NEW GAME', 'CONTINUE', 'HOW TO PLAY'] : ['NEW GAME', 'HOW TO PLAY'];
  items.forEach((label, i) => {
    const y = 356 + i * 52;
    const sel = state.menuIndex === i;
    g.fillStyle = sel ? 'rgba(255,216,61,0.92)' : 'rgba(12,14,18,0.66)';
    roundRect(g, VIEW_W / 2 - 150, y - 27, 300, 40, 8); g.fill();
    g.fillStyle = sel ? '#191c20' : '#f2f2f2';
    g.font = 'bold 18px system-ui, sans-serif';
    g.fillText(label, VIEW_W / 2, y);
  });
  if (state.showHelp) {
    g.fillStyle = 'rgba(8,10,14,0.88)';
    roundRect(g, VIEW_W / 2 - 330, 480, 660, 178, 10); g.fill();
    g.fillStyle = '#e8e8e8';
    g.font = '14.5px system-ui, sans-serif';
    const lines = [
      'WASD / arrows — move & drive      SHIFT — sprint      SPACE — handbrake',
      'MOUSE — aim      CLICK — shoot      F — enter / exit car      E — steal',
      'P or ESC — pause      M — mute      Follow the ◆ marker to work Dede\'s jobs.',
      'Crimes raise your wanted stars. Break police sight to cool off.',
      'Get caught at 1–2 stars and you are BUSTED. Hit zero health and you are WASTED.',
    ];
    lines.forEach((ln, i) => g.fillText(ln, VIEW_W / 2, 516 + i * 27));
  }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '12px system-ui, sans-serif';
  g.fillText('↑ ↓ + Enter, or click a button', VIEW_W / 2, VIEW_H - 22);
  g.textAlign = 'left';
}

export function drawPause(g, state) {
  g.fillStyle = 'rgba(6,8,12,0.66)';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.font = '900 54px system-ui, sans-serif';
  g.fillText('PAUSED', VIEW_W / 2, 250);
  g.font = '16px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('P / ESC — resume        S — save game        M — mute', VIEW_W / 2, 300);
  g.fillText(`Cash $${state.money.toLocaleString('en-US')} · Mission ${Math.min(state.missionIndex + 1, 6)} of 6${state.storyDone ? ' · Story complete' : ''}`, VIEW_W / 2, 332);
  g.textAlign = 'left';
}

export function drawEndScreen(g, state, kind) {
  const wasted = kind === 'wasted';
  g.fillStyle = wasted ? 'rgba(60,4,2,0.62)' : 'rgba(6,16,44,0.62)';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = wasted ? '#e0483e' : '#7fb3ff';
  g.font = '900 96px system-ui, sans-serif';
  g.fillText(wasted ? 'WASTED' : 'BUSTED', VIEW_W / 2, 320);
  g.fillStyle = '#f2f2f2';
  g.font = '17px system-ui, sans-serif';
  g.fillText(wasted ? 'Sunhaven General patched you up — for a price.' : 'The SH Police took their cut. Stay out of sight next time.', VIEW_W / 2, 362);
  g.fillText('Press ENTER to get back out there', VIEW_W / 2, 404);
  g.textAlign = 'left';
}
