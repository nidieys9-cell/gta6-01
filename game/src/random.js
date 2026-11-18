// random.js — a small seeded RNG (mulberry32) so a seed always builds the same city
// and poses the same screenshot scene. Nothing in the game uses Math.random for
// anything that matters to determinism.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function rangeInt(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export function chance(rng, probability) {
  return rng() < probability;
}

/** A fresh RNG seeded from a base seed and a stream name, so streams stay independent. */
export function streamRng(seed, streamIndex) {
  return mulberry32((seed ^ Math.imul(streamIndex + 1, 0x9e3779b1)) >>> 0);
}
