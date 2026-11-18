[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/nidieys9-cell/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/nidieys9-cell/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Sunhaven Heat

An original open-world crime game that plays offline in a desktop browser from
static files — no build step, no network requests, no libraries. You are Marco
Reyes, fresh in the sun-soaked city of Sunhaven, running jobs for Dede while the
SH Police keep score.

## Play

Serve `game/` with any static file server and open `index.html` in desktop
Chrome, or from this repository root:

```
node serve.ts        # then open http://localhost:8080
```

## What's in the city

- **A living city** — a 9×7-block road grid with four districts (Palmera Beach,
  Downtown, Port Solana, Las Colinas), ~200 buildings with roofs, shadows and
  lit windows at night, palms, lamps, crosswalks and parked cars.
- **On foot and by car** — walk, sprint, aim and shoot with the mouse; steal any
  car (pull the driver out of a slow one), drive it with arcade physics,
  handbrake, damage, smoke and wrecks.
- **Traffic & pedestrians** — lane-following traffic that yields and turns at
  crossings; civilians who stroll the sidewalks and flee gunfire and fast cars.
- **A wanted system** — crimes raise heat only when witnessed; 1–5 stars bring
  squad cars that ram and foot cops who shoot. Break their sight to cool off.
  Get caught at low stars and you're **BUSTED**; hit zero health, **WASTED**.
- **A six-mission story** — meet Dede, steal and deliver cars, run a hot package
  under police pressure, settle a score, lose the heat, and pull the Solana
  Score: an armoured van, the whole force, one safehouse.
- **HUD & minimap** — health, cash, wanted stars, weapon and ammo (or speed in a
  car), the current objective, and a live minimap with police blips and the
  objective marker.
- **Save & continue** — progress (cash, story, position) persists in
  localStorage.
- **Sound, all synthesised** — WebAudio gunshots, crashes, sirens that swell as
  cops close in, an engine hum, mission jingles and a lazy procedural loop. M
  mutes.
- **Day & night** — a full sun cycle: dusk grade, streetlamp pools, headlight
  cones and lit windows after dark.

## Controls

| Keys | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Shift | Sprint |
| Space | Handbrake |
| Mouse | Aim · Click to shoot |
| F or E | Enter / exit car (steal) |
| P or Esc | Pause · S saves while paused |
| M | Mute |

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to the
  output and writes `dossier.json` with `vendor/makefun-game.ts`.
- `game/index.html` — the page; loads `game/src/main.js` as a module.
- `game/src/` — the game, one job per file: `config` (tuning & palette),
  `random` (seeded RNG), `city` (city generation & collision), `cars` (traffic,
  police & driving physics), `peds` (pedestrians & foot cops), `wanted` (heat,
  stars & the police director), `combat` (pistol, bullets, pickups),
  `missions` (Dede's six jobs), `audio` (synth SFX & music), `input`,
  `render` (world, HUD, minimap, screens), `save`, `shots` (screenshot scenes).

Screenshot scenes for the entry's pictures live in `shots.json`
(`?shot=mission`, `?shot=chase`, `?shot=night` pose deterministic scenes).

## License

MIT — see `LICENSE`.
