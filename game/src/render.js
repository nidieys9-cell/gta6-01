// render.js — everything the player sees: the pre-rendered city (day plate plus
// a lit-windows plate for night), cars, people, bullets, pickups, particles,
// the day/night grade, the HUD with its minimap, and every screen (title,
// how-to, pause, WASTED, BUSTED). The simulation never reads the canvas back.

import { BLOCK, COLS, DAY_LENGTH, DISTRICTS, PITCH, ROAD, ROWS, WORLD_H, WORLD_W, districtKeyAt } from './config.js';
import { blockRect } from './city.js';

const TAU = Math.PI * 2;

// ——— Particles (owned here; main feeds them from game events) ———

export function spawnParticles(state, x, y, kind, n = 6) {
  const palettes = {
    sparks: ['#ffd76a', '#ffb84d', '#fff3c4'],
    smoke: ['#55565c', '#6e6f76', '#43444a'],
    fire: ['#ff7a3c', '#ffb84d', '#e8483c'],
    flash: ['#fff3c4', '#ffd76a'],
    puff: ['#d8d3c8', '#c9c2b2'],
  };
  const colors = palettes[kind] || palettes.puff;
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * TAU;
    const sp = kind === 'smoke' ? 12 + Math.random() * 22 : 40 + Math.random() * 130;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (kind === 'smoke' || kind === 'fire' ? 26 : 0),
      life: 0, maxLife: kind === 'smoke' ? 0.9 + Math.random() * 0.7 : 0.3 + Math.random() * 0.35,
      size: kind === 'smoke' ? 5 + Math.random() * 6 : 1.6 + Math.random() * 2.2,
      color: colors[Math.floor(Math.random() * colors.length)],
      grow: kind === 'smoke',
    });
  }
  if (state.particles.length > 420) state.particles.splice(0, state.particles.length - 420);
}

export function updateParticles(state, dt) {
  for (const p of state.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
  state.particles = state.particles.filter((p) => p.life < p.maxLife);
}

// ——— Sun ———

/** 0 at full day, ~0.85 at deep night; dusk warmth peaks near the horizon. */
export function sunLevels(dayT) {
  const phase = (dayT % DAY_LENGTH) / DAY_LENGTH; // 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
  const sun = Math.sin(phase * TAU);
  const darkness = Math.max(0, Math.min(1, 0.55 - sun * 0.85)) * 0.88;
  const dusk = Math.max(0, 1 - Math.abs(sun) * 3.2) * (sun > -0.25 ? 1 : 0);
  return { darkness, dusk, sun };
}

// ——— Renderer ———

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let dayPlate = null;
  let nightPlate = null;
  let glowPlate = null;

  function makePlate(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** Pre-render the static city once per generated city. */
  function buildCityPlates(city) {
    dayPlate = makePlate(WORLD_W, WORLD_H);
    nightPlate = makePlate(WORLD_W, WORLD_H);
    glowPlate = makePlate(WORLD_W, WORLD_H);
    const g = dayPlate.getContext('2d');
    const n = nightPlate.getContext('2d');
    const gl = glowPlate.getContext('2d');

    // Asphalt everywhere; blocks sit on top.
    g.fillStyle = '#43464c';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    // Lane dashes and edge lines.
    g.strokeStyle = 'rgba(232, 216, 150, 0.55)';
    g.lineWidth = 3;
    g.setLineDash([26, 30]);
    for (let i = 0; i <= COLS; i += 1) {
      g.beginPath(); g.moveTo(i * PITCH + ROAD / 2, 0); g.lineTo(i * PITCH + ROAD / 2, WORLD_H); g.stroke();
    }
    for (let i = 0; i <= ROWS; i += 1) {
      g.beginPath(); g.moveTo(0, i * PITCH + ROAD / 2); g.lineTo(WORLD_W, i * PITCH + ROAD / 2); g.stroke();
    }
    g.setLineDash([]);
    // Crosswalks at every junction.
    g.fillStyle = 'rgba(230, 230, 225, 0.5)';
    for (let i = 0; i <= COLS; i += 1) {
      for (let j = 0; j <= ROWS; j += 1) {
        const x = i * PITCH;
        const y = j * PITCH;
        for (let s = 0; s < 5; s += 1) {
          g.fillRect(x + 10 + s * 16, y - 9, 9, 7);
          g.fillRect(x + 10 + s * 16, y + ROAD + 2, 9, 7);
          g.fillRect(x - 9, y + 10 + s * 16, 7, 9);
          g.fillRect(x + ROAD + 2, y + 10 + s * 16, 7, 9);
        }
      }
    }
    // Blocks: sidewalk rim, district ground, then buildings.
    for (const block of city.blocks) {
      const r = block.rect;
      const palette = DISTRICTS[block.district];
      g.fillStyle = palette.walk;
      g.fillRect(r.x, r.y, BLOCK, BLOCK);
      g.fillStyle = palette.ground;
      g.fillRect(r.x + 15, r.y + 15, BLOCK - 30, BLOCK - 30);
    }
    for (const b of city.buildings) drawBuilding(g, n, b);
    // Props.
    for (const p of city.props) {
      if (p.kind === 'palm') {
        g.strokeStyle = '#7a6248'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 3, p.y - 4); g.stroke();
        g.fillStyle = '#4d8a4f';
        for (let f = 0; f < 5; f += 1) {
          const a = (f / 5) * TAU + p.s;
          g.beginPath();
          g.ellipse(p.x + 3 + Math.cos(a) * 8 * p.s, p.y - 4 + Math.sin(a) * 5 * p.s, 8 * p.s, 3.4 * p.s, a, 0, TAU);
          g.fill();
        }
      } else if (p.kind === 'tree') {
        g.fillStyle = '#59823f';
        g.beginPath(); g.arc(p.x, p.y, 10 * p.s, 0, TAU); g.fill();
        g.fillStyle = '#6d9a4e';
        g.beginPath(); g.arc(p.x - 3, p.y - 3, 6.5 * p.s, 0, TAU); g.fill();
      } else if (p.kind === 'crate') {
        g.fillStyle = '#8a7a5c';
        g.fillRect(p.x - 8, p.y - 8, 16, 16);
        g.strokeStyle = '#6b5d47'; g.lineWidth = 2;
        g.strokeRect(p.x - 8, p.y - 8, 16, 16);
      } else if (p.kind === 'lamp') {
        g.fillStyle = '#2f3237';
        g.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
        const grad = gl.createRadialGradient(p.x, p.y, 2, p.x, p.y, 46);
        grad.addColorStop(0, 'rgba(255, 196, 110, 0.5)');
        grad.addColorStop(1, 'rgba(255, 196, 110, 0)');
        gl.fillStyle = grad;
        gl.beginPath(); gl.arc(p.x, p.y, 46, 0, TAU); gl.fill();
      }
    }
    // Place signs: a coloured awning and the name, painted on the map itself.
    for (const id of Object.keys(city.places)) {
      const place = city.places[id];
      const b = place.building;
      g.fillStyle = id === 'station' ? '#2c4a8a' : id === 'hospital' ? '#e8e8e8' : '#8a4b3a';
      g.fillRect(b.x, b.y + b.h - 12, b.w, 12);
      g.fillStyle = '#20232a';
      g.font = 'bold 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(place.label.toUpperCase(), b.x + b.w / 2, b.y + b.h + 15);
      if (id === 'hospital') {
        g.fillStyle = '#d23c2e';
        g.fillRect(b.x + b.w / 2 - 3, b.y + 10, 6, 18);
        g.fillRect(b.x + b.w / 2 - 9, b.y + 16, 18, 6);
      }
    }
  }

  function drawBuilding(g, n, b) {
    // Shadow, façade, roof with a parapet, roof furniture, window grid.
    g.fillStyle = 'rgba(15, 15, 20, 0.28)';
    g.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    g.fillStyle = b.wall;
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = b.roof;
    g.fillRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.strokeRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
    // Roof texture ticks, deterministic per building.
    g.fillStyle = 'rgba(0,0,0,0.08)';
    const ticks = Math.floor(b.seedBit * 7) + 3;
    for (let i = 0; i < ticks; i += 1) {
      const fx = b.x + 8 + ((b.seedBit * 131 + i * 47) % Math.max(10, b.w - 20));
      const fy = b.y + 8 + ((b.seedBit * 197 + i * 31) % Math.max(10, b.h - 20));
      g.fillRect(fx, fy, 7, 4);
    }
    for (const rp of b.roofProps) {
      if (rp.kind === 'tower') {
        g.fillStyle = '#9a8d7a';
        g.beginPath(); g.arc(rp.x + rp.w / 2, rp.y + rp.h / 2, rp.w / 2, 0, TAU); g.fill();
        g.fillStyle = '#7d7261';
        g.beginPath(); g.arc(rp.x + rp.w / 2, rp.y + rp.h / 2, rp.w / 3.4, 0, TAU); g.fill();
      } else {
        g.fillStyle = '#b9bcc2';
        g.fillRect(rp.x, rp.y, rp.w, rp.h);
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.strokeRect(rp.x, rp.y, rp.w, rp.h);
      }
    }
    // Windows along the south façade (a second strip for towers); a
    // deterministic share of them light up on the night plate.
    const cols = Math.min(10, b.winCols);
    const strips = b.floors >= 5 ? [8, 16] : [8];
    for (const inset of strips) {
      for (let c = 0; c < cols; c += 1) {
        const wx = b.x + 6 + c * ((b.w - 12) / cols);
        const lit = ((b.seedBit * 997 + c * 61 + inset * 7) % 10) < 5.2;
        g.fillStyle = 'rgba(30, 38, 52, 0.55)';
        g.fillRect(wx, b.y + b.h - inset, 5, 4);
        if (lit) {
          n.fillStyle = 'rgba(255, 205, 120, 0.95)';
          n.fillRect(wx, b.y + b.h - inset, 5, 4);
        }
      }
    }
  }

  function draw(state) {
    const W = canvas.width;
    const H = canvas.height;
    const cam = state.cam;
    const viewX = Math.max(0, Math.min(WORLD_W - W, cam.x - W / 2 + (state.shakeX || 0)));
    const viewY = Math.max(0, Math.min(WORLD_H - H, cam.y - H / 2 + (state.shakeY || 0)));
    const { darkness, dusk } = sunLevels(state.dayT);

    ctx.fillStyle = '#20232a';
    ctx.fillRect(0, 0, W, H);
    if (dayPlate) ctx.drawImage(dayPlate, viewX, viewY, W, H, 0, 0, W, H);

    ctx.save();
    ctx.translate(-viewX, -viewY);
    drawObjectiveMarker(state);
    for (const p of state.pickups) if (!p.taken) drawPickup(state, p);
    for (const car of state.cars) drawCar(state, car, darkness);
    for (const ped of state.peds) drawPed(state, ped);
    if (!state.player.car && state.mode !== 'title') drawPlayer(state);
    drawBullets(state);
    drawParticles(state);
    ctx.restore();

    // Night grade: dusk warmth, then darkness, lit windows, lamp glow, headlights.
    if (dusk > 0.03) {
      ctx.fillStyle = `rgba(255, 122, 60, ${0.13 * dusk})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (darkness > 0.02) {
      ctx.fillStyle = `rgba(7, 10, 34, ${darkness})`;
      ctx.fillRect(0, 0, W, H);
      if (nightPlate) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, darkness * 1.6);
        ctx.drawImage(nightPlate, viewX, viewY, W, H, 0, 0, W, H);
        ctx.restore();
      }
      if (glowPlate) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, darkness * 1.4);
        ctx.drawImage(glowPlate, viewX, viewY, W, H, 0, 0, W, H);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(-viewX, -viewY);
      ctx.globalCompositeOperation = 'lighter';
      for (const car of state.cars) {
        if (car.wrecked || (car.kind === 'parked' && car !== state.player.car)) continue;
        drawHeadlightCone(car);
      }
      ctx.restore();
    }

    if (state.mode === 'title' || state.mode === 'howto') drawTitleScreen(state, W, H);
    else {
      drawHud(state, W, H, viewX, viewY);
      if (state.mode === 'paused') drawPause(state, W, H);
      if (state.over) drawGameOver(state, W, H);
    }
    if (state.player.hurtT > 0 && !state.over) {
      ctx.fillStyle = `rgba(200, 30, 20, ${Math.min(0.3, state.player.hurtT * 0.5)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawHeadlightCone(car) {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const gx = car.x + fx * (car.w / 2);
    const gy = car.y + fy * (car.w / 2);
    const grad = ctx.createRadialGradient(gx, gy, 4, gx + fx * 60, gy + fy * 60, 120);
    grad.addColorStop(0, 'rgba(255, 240, 190, 0.34)');
    grad.addColorStop(1, 'rgba(255, 240, 190, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.arc(gx + fx * 55, gy + fy * 55, 105, car.angle - 0.42, car.angle + 0.42);
    ctx.closePath();
    ctx.fill();
  }

  function drawObjectiveMarker(state) {
    const t = state.objectiveTarget;
    if (!t || state.mode !== 'playing') return;
    const pulse = 15 + Math.sin(state.time * 4.4) * 4;
    ctx.strokeStyle = 'rgba(255, 205, 74, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(t.x, t.y, pulse, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#ffcd4a';
    ctx.save();
    ctx.translate(t.x, t.y - 30 - Math.sin(state.time * 4.4) * 4);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  }

  function drawPickup(state, p) {
    const bobY = Math.sin(state.time * 3 + p.bob) * 3;
    ctx.save();
    ctx.translate(p.x, p.y + bobY);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fillStyle = p.kind === 'cash' ? '#3f9e4d' : p.kind === 'health' ? '#e8e8e8' : '#d98a3a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.fillStyle = p.kind === 'health' ? '#d23c2e' : '#ffffff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.kind === 'cash' ? '$' : p.kind === 'health' ? '+' : '≡', 0, 1);
    ctx.restore();
  }

  function drawCar(state, car, darkness) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // shadow
    ctx.fillStyle = 'rgba(10,10,14,0.3)';
    ctx.fillRect(-car.w / 2 + 3, -car.h / 2 + 4, car.w, car.h);
    // body
    ctx.fillStyle = car.wrecked ? '#33343a' : car.color;
    roundRect(ctx, -car.w / 2, -car.h / 2, car.w, car.h, 6);
    ctx.fill();
    if (car.type === 'truck') {
      ctx.fillStyle = car.wrecked ? '#3d3e44' : '#7d8894';
      ctx.fillRect(-car.w / 2 + 2, -car.h / 2 + 2, car.w * 0.62, car.h - 4);
      ctx.fillStyle = '#c8a13a';
      ctx.fillRect(-car.w / 2 + 6, -4, 16, 8); // the cash cage marking
      ctx.fillStyle = '#22242a';
      ctx.fillRect(car.w / 2 - 13, -car.h / 2 + 2, 11, car.h - 4);
    } else {
      // cabin + windshield
      ctx.fillStyle = car.wrecked ? '#2a2b31' : 'rgba(22, 30, 44, 0.85)';
      roundRect(ctx, -car.w * 0.16, -car.h / 2 + 3.4, car.w * 0.4, car.h - 6.8, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(170, 205, 235, 0.5)';
      ctx.fillRect(car.w * 0.2, -car.h / 2 + 4.4, 3.4, car.h - 8.8);
    }
    if (car.type === 'police') {
      ctx.fillStyle = '#22242a';
      ctx.fillRect(-6, -car.h / 2, 13, car.h);
      const flash = Math.floor(state.time * 5) % 2 === 0;
      ctx.fillStyle = flash ? '#ff4444' : '#7a1616';
      ctx.fillRect(-5, -6, 5, 12);
      ctx.fillStyle = flash ? '#2255ff' : '#16277a';
      ctx.fillRect(1, -6, 5, 12);
    }
    if (car.type === 'taxi') {
      ctx.fillStyle = '#20232a';
      ctx.fillRect(-3, -4, 7, 8);
    }
    // headlights + brake lights
    ctx.fillStyle = darkness > 0.25 || car === state.player.car ? '#ffeec2' : '#d8d8ce';
    ctx.fillRect(car.w / 2 - 2.4, -car.h / 2 + 2.4, 2.6, 4);
    ctx.fillRect(car.w / 2 - 2.4, car.h / 2 - 6.4, 2.6, 4);
    if (car.brake) {
      ctx.fillStyle = '#ff3b30';
      ctx.fillRect(-car.w / 2 - 0.6, -car.h / 2 + 2.4, 2.6, 4);
      ctx.fillRect(-car.w / 2 - 0.6, car.h / 2 - 6.4, 2.6, 4);
    }
    ctx.restore();
    // Mission cars get a bobbing gold chevron.
    if (car.tag && state.mode === 'playing') {
      ctx.fillStyle = '#ffcd4a';
      ctx.save();
      ctx.translate(car.x, car.y - 30 - Math.sin(state.time * 4.4) * 4);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
    // Damage smoke and fire.
    if (!car.wrecked && car.hp < 55 && Math.random() < 0.25) {
      spawnParticles(state, car.x + Math.cos(car.angle) * car.w * 0.4, car.y + Math.sin(car.angle) * car.w * 0.4, 'smoke', 1);
    }
    if (car.wrecked && Math.random() < 0.3) {
      spawnParticles(state, car.x, car.y, Math.random() < 0.5 ? 'fire' : 'smoke', 1);
    }
  }

  function drawPed(state, ped) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    if (ped.dead) {
      ctx.globalAlpha = Math.max(0, 1 - ped.deadT / 6);
      ctx.fillStyle = 'rgba(60, 20, 16, 0.5)';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, ped.angle, 0, TAU); ctx.fill();
      ctx.fillStyle = ped.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 5.4, ped.angle, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = 'rgba(10,10,14,0.28)';
    ctx.beginPath(); ctx.ellipse(1.6, 2.4, 8, 5.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = ped.color;
    ctx.beginPath(); ctx.arc(0, 0, 7.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8b98d';
    ctx.beginPath();
    ctx.arc(Math.cos(ped.angle) * 3.4, Math.sin(ped.angle) * 3.4, 3.6, 0, TAU);
    ctx.fill();
    if (ped.kind === 'cop') {
      ctx.fillStyle = '#1d2c52';
      ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, TAU); ctx.fill();
    }
    if (ped.kind === 'dede' || ped.kind === 'target') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ped.kind === 'dede' ? 'DEDE' : 'VINCE', 0, -13);
    }
    ctx.restore();
  }

  function drawPlayer(state) {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(10,10,14,0.3)';
    ctx.beginPath(); ctx.ellipse(1.6, 2.4, 8.6, 5.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1f8a8a';
    ctx.beginPath(); ctx.arc(0, 0, 8.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#0f5c5c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8b98d';
    ctx.beginPath();
    ctx.arc(Math.cos(p.angle) * 3.6, Math.sin(p.angle) * 3.6, 3.8, 0, TAU);
    ctx.fill();
    // the pistol, when aiming or firing
    if (state.inp && (state.inp.fire || state.mouseWorld)) {
      ctx.strokeStyle = '#22242a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(p.angle) * 6, Math.sin(p.angle) * 6);
      ctx.lineTo(Math.cos(p.angle) * 13, Math.sin(p.angle) * 13);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBullets(state) {
    ctx.strokeStyle = 'rgba(255, 226, 140, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const b of state.bullets) {
      ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = p.color;
      const s = p.grow ? p.size * (1 + p.life * 1.6) : p.size;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud(state, W, H, viewX, viewY) {
    const p = state.player;
    ctx.textBaseline = 'alphabetic';
    // Health + cash, top-left.
    ctx.fillStyle = 'rgba(10, 12, 18, 0.55)';
    ctx.fillRect(14, 12, 168, 52);
    ctx.fillStyle = '#22242c';
    ctx.fillRect(22, 20, 130, 11);
    const hpFrac = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = hpFrac > 0.5 ? '#58c96b' : hpFrac > 0.25 ? '#e8b83a' : '#e8483c';
    ctx.fillRect(22, 20, 130 * hpFrac, 11);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MARCO', 158 - 34, 29);
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillStyle = '#7ddb8a';
    ctx.fillText(`$${Math.floor(p.cash).toLocaleString('en-US')}`, 22, 56);
    if (p.car) {
      const carFrac = Math.max(0, p.car.hp / p.car.maxHp);
      ctx.fillStyle = '#22242c';
      ctx.fillRect(104, 42, 66, 7);
      ctx.fillStyle = '#e88a3a';
      ctx.fillRect(104, 42, 66 * carFrac, 7);
    }
    // Wanted stars, top-right — they strobe while the police have eyes on you.
    const stars = state.wanted.stars;
    const seen = state.wanted.seenNow;
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i < 5; i += 1) {
      const on = i < stars;
      ctx.fillStyle = on ? (seen && Math.floor(state.time * 6) % 2 === 0 ? '#ffffff' : '#ffcd4a') : 'rgba(255,255,255,0.22)';
      ctx.fillText('★', W - 18 - (4 - i) * 30, 38);
    }
    if (state.wanted.grabT > 0.15) {
      ctx.fillStyle = '#ff6b5e';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText('THEY HAVE YOU — BREAK FREE!', W - 18, 62);
    }
    // Objective pill, top-centre.
    if (state.objective) {
      ctx.font = 'bold 14px system-ui, sans-serif';
      const wText = ctx.measureText(state.objective).width + 30;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.6)';
      roundRect(ctx, (W - wText) / 2, 12, wText, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#ffcd4a';
      ctx.textAlign = 'center';
      ctx.fillText(`◆ ${state.objective}`, W / 2, 32);
    }
    // Bottom-right: speed in a car, weapon on foot.
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    if (p.car) {
      ctx.fillText(`${Math.round(Math.abs(p.car.speed) * 0.42)} km/h`, W - 18, H - 18);
    } else {
      ctx.fillText(p.reloading > 0 ? 'RELOADING…' : `PISTOL  ${p.mag} / ${p.ammo}`, W - 18, H - 18);
    }
    drawMinimap(state, viewX, viewY);
    // Banner and toasts.
    if (state.banner) {
      const b = state.banner;
      const a = b.t < 0.3 ? b.t / 0.3 : b.t > b.dur - 0.6 ? Math.max(0, (b.dur - b.t) / 0.6) : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffcd4a';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText(b.title, W / 2, H * 0.3);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(b.sub || '', W / 2, H * 0.3 + 28);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.font = '14px system-ui, sans-serif';
    state.toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.age / 0.3, (4.6 - t.age) / 0.8));
      const wText = ctx.measureText(t.text).width + 26;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.66)';
      roundRect(ctx, (W - wText) / 2, H - 108 - i * 30, wText, 24, 7);
      ctx.fill();
      ctx.fillStyle = '#f2e9d5';
      ctx.fillText(t.text, W / 2, H - 91 - i * 30);
      ctx.globalAlpha = 1;
    });
    void viewX; void viewY;
  }

  function drawMinimap(state, viewX, viewY) {
    const mw = 178;
    const mh = 140;
    const mx = 14;
    const my = canvas.height - mh - 14;
    const scale = mw / WORLD_W;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.72)';
    ctx.fillRect(mx - 3, my - 16, mw + 6, mh + 20);
    for (const block of state.city.blocks) {
      const r = blockRect(block.col, block.row);
      ctx.fillStyle = DISTRICTS[block.district].ground;
      ctx.fillRect(mx + (r.x) * scale, my + (r.y) * scale, BLOCK * scale, BLOCK * scale);
    }
    ctx.fillStyle = '#e8e3d5';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SUNHAVEN — ${DISTRICTS[state.playerDistrict || 'downtown'].name.toUpperCase()}`, mx + 2, my - 5);
    // Pickups as faint dots, police as strobing blips, the objective in gold.
    ctx.fillStyle = 'rgba(125, 219, 138, 0.8)';
    for (const p of state.pickups) {
      if (!p.taken) ctx.fillRect(mx + p.x * scale - 1, my + p.y * scale - 1, 2, 2);
    }
    const flash = Math.floor(state.time * 4) % 2 === 0;
    for (const car of state.cars) {
      if (car.kind !== 'police' || car.wrecked) continue;
      ctx.fillStyle = flash ? '#ff5148' : '#4d7dff';
      ctx.fillRect(mx + car.x * scale - 2, my + car.y * scale - 2, 4, 4);
    }
    for (const ped of state.peds) {
      if (ped.kind !== 'cop' || ped.dead) continue;
      ctx.fillStyle = flash ? '#4d7dff' : '#ff5148';
      ctx.fillRect(mx + ped.x * scale - 1.4, my + ped.y * scale - 1.4, 3, 3);
    }
    if (state.objectiveTarget) {
      ctx.fillStyle = '#ffcd4a';
      ctx.save();
      ctx.translate(mx + state.objectiveTarget.x * scale, my + state.objectiveTarget.y * scale);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
      ctx.restore();
    }
    // Viewport frame + the player arrow.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + viewX * scale, my + viewY * scale, canvas.width * scale, canvas.height * scale);
    const px = state.player.car ? state.player.car.x : state.player.x;
    const py = state.player.car ? state.player.car.y : state.player.y;
    const pa = state.player.car ? state.player.car.angle : state.player.angle;
    ctx.save();
    ctx.translate(mx + px * scale, my + py * scale);
    ctx.rotate(pa);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -3.6);
    ctx.lineTo(-4, 3.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTitleScreen(state, W, H) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(10, 10, 24, 0.42)');
    grad.addColorStop(0.55, 'rgba(10, 10, 24, 0.18)');
    grad.addColorStop(1, 'rgba(10, 10, 24, 0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    if (state.mode === 'howto') {
      panel(ctx, W / 2 - 300, H / 2 - 210, 600, 420);
      ctx.fillStyle = '#ffcd4a';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText('HOW TO PLAY', W / 2, H / 2 - 168);
      ctx.fillStyle = '#f2e9d5';
      ctx.font = '16px system-ui, sans-serif';
      const lines = [
        'WASD / arrows — move and drive      Shift — sprint',
        'Mouse — aim · Click — shoot          F / E — enter or steal a car',
        'Space — handbrake                    P / Esc — pause · S — save there',
        'M — mute',
        '',
        'Crimes only count when somebody sees them.',
        'Stars bring squad cars; at three, foot cops shoot.',
        'Break their line of sight and let the heat cool off.',
        'Follow the gold marker. Dede pays for all six jobs.',
        '',
        'Click or press Esc to go back',
      ];
      lines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 - 122 + i * 27));
      return;
    }
    ctx.fillStyle = '#ffcd4a';
    ctx.font = 'bold 25px system-ui, sans-serif';
    ctx.fillText('S U N H A V E N', W / 2, H * 0.3);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 104px system-ui, sans-serif';
    ctx.fillText('HEAT', W / 2, H * 0.3 + 96);
    ctx.fillStyle = '#f2e9d5';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('An open-world crime story in a sun-soaked city that never cools down.', W / 2, H * 0.3 + 128);
    const items = ['NEW GAME', ...(state.hasSave ? ['CONTINUE'] : []), 'HOW TO PLAY'];
    state._menuRects = [];
    items.forEach((label, i) => {
      const w = 250;
      const h = 44;
      const x = W / 2 - w / 2;
      const y = H * 0.52 + i * 58;
      const hot = state.menuSel === i;
      ctx.fillStyle = hot ? '#ffcd4a' : 'rgba(12, 14, 20, 0.78)';
      roundRect(ctx, x, y, w, h, 9);
      ctx.fill();
      ctx.fillStyle = hot ? '#20232a' : '#ffffff';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(label, W / 2, y + 29);
      state._menuRects.push({ x, y, w, h, action: label });
    });
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('↑ ↓ + Enter, or click a button', W / 2, H - 26);
  }

  function drawPause(state, W, H) {
    ctx.fillStyle = 'rgba(8, 9, 14, 0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 20);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#f2e9d5';
    ctx.fillText('P / Esc — resume · S — save · M — mute', W / 2, H / 2 + 16);
  }

  function drawGameOver(state, W, H) {
    const over = state.over;
    const wasted = over.kind === 'wasted';
    ctx.fillStyle = wasted ? 'rgba(40, 4, 2, 0.6)' : 'rgba(4, 10, 34, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = wasted ? '#e8483c' : '#7ea8ff';
    ctx.font = 'bold 76px system-ui, sans-serif';
    ctx.fillText(wasted ? 'W A S T E D' : 'B U S T E D', W / 2, H / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText(over.text || '', W / 2, H / 2 + 36);
  }

  function panel(c, x, y, w, h) {
    c.fillStyle = 'rgba(10, 12, 18, 0.88)';
    roundRect(c, x, y, w, h, 12);
    c.fill();
    c.strokeStyle = 'rgba(255, 205, 74, 0.5)';
    c.lineWidth = 1.6;
    roundRect(c, x, y, w, h, 12);
    c.stroke();
  }

  return { draw, buildCityPlates };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

