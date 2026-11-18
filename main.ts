// Sunhaven Heat — the hand-in program for the gta6-01 entry (Node 22, standard library only).
//
// The game itself is the static site in game/ (open game/index.html in a desktop browser, no
// build step, no network). This program copies game/ and screenshots/ into the output
// directory and writes dossier.json there with the vendored make.fun library, exactly the
// shape the grader rebuilds and compares byte for byte.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (the kit's gate): only the text cap shapes the dossier's
// bytes; the rest make this program refuse an entry the scorer would refuse anyway — more
// than four screenshots or one over 256 KiB, more than 993 entries or 48 MiB under game/,
// or a game/ path longer than 1,000 bytes.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
