// audio.js — every sound in Sunhaven is synthesised with WebAudio: gunshots,
// crashes, a siren that swells as the nearest cop closes in, an engine hum,
// pickup chimes, mission jingles and a lazy procedural music loop. No audio
// files, no network. Everything degrades silently where WebAudio is absent.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;
  let engineOsc = null;
  let engineGain = null;
  let musicT = 0;
  let musicStep = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function env(node, t0, peak, dur) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.012);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function blip(freqA, freqB, dur, type, peak) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqB, 1), t0 + dur);
    env(gain, t0, peak, dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, freq) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    env(gain, t0, peak, dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.value = muted ? 0 : 0.5;
  }

  return {
    unlock() { ensure(); },
    toggleMute() { setMuted(!muted); return muted; },
    get muted() { return muted; },

    shot() { noise(0.13, 0.5, 3200); blip(220, 55, 0.1, 'square', 0.18); },
    dryFire() { blip(1200, 700, 0.04, 'square', 0.1); },
    crash(power) { noise(0.28, Math.min(0.7, 0.2 + power / 220), 900); blip(120, 40, 0.25, 'triangle', 0.3); },
    honk() { blip(370, 340, 0.22, 'square', 0.12); },
    pickup() { blip(660, 990, 0.12, 'sine', 0.22); },
    uiClick() { blip(520, 520, 0.05, 'sine', 0.12); },
    busted() { blip(392, 392, 0.16, 'triangle', 0.25); setTimeout(() => blip(311, 311, 0.3, 'triangle', 0.25), 140); },
    wasted() { blip(330, 82, 0.8, 'sawtooth', 0.2); },
    jingle() {
      if (!ensure() || muted) return;
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => setTimeout(() => blip(f, f, 0.22, 'triangle', 0.22), i * 95));
    },

    /** Continuous voices, driven once per frame from the game loop. */
    update(dt, situation) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      // Siren: two-tone wail, louder and faster as the nearest cop closes in.
      if (situation.nearestCop < 520 && situation.stars > 0) {
        if (!sirenOsc) {
          sirenOsc = ctx.createOscillator();
          sirenGain = ctx.createGain();
          sirenLfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          sirenOsc.type = 'triangle';
          sirenLfo.frequency.value = 0.55;
          lfoGain.gain.value = 130;
          sirenLfo.connect(lfoGain).connect(sirenOsc.frequency);
          sirenOsc.frequency.value = 760;
          sirenGain.gain.value = 0;
          sirenOsc.connect(sirenGain).connect(master);
          sirenOsc.start();
          sirenLfo.start();
        }
        const closeness = 1 - situation.nearestCop / 520;
        sirenGain.gain.setTargetAtTime(muted ? 0 : 0.015 + closeness * 0.075, t, 0.2);
        sirenLfo.frequency.setTargetAtTime(0.45 + closeness * 0.6, t, 0.3);
      } else if (sirenGain) {
        sirenGain.gain.setTargetAtTime(0, t, 0.15);
      }
      // Engine: a low saw whose pitch follows the player's speed.
      if (situation.inCar) {
        if (!engineOsc) {
          engineOsc = ctx.createOscillator();
          engineGain = ctx.createGain();
          engineOsc.type = 'sawtooth';
          engineGain.gain.value = 0;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 420;
          engineOsc.connect(lp).connect(engineGain).connect(master);
          engineOsc.start();
        }
        engineOsc.frequency.setTargetAtTime(52 + Math.abs(situation.speed) * 0.55, t, 0.08);
        engineGain.gain.setTargetAtTime(muted ? 0 : 0.05, t, 0.1);
      } else if (engineGain) {
        engineGain.gain.setTargetAtTime(0, t, 0.1);
      }
      // Music: a slow four-chord loop, one soft step every half second.
      if (situation.playing && !muted) {
        musicT -= dt;
        if (musicT <= 0) {
          musicT = 0.5;
          const roots = [110, 87.3, 130.8, 98];
          const root = roots[Math.floor(musicStep / 4) % 4];
          const beat = musicStep % 4;
          if (beat === 0) blip(root, root, 0.5, 'sine', 0.16);
          if (beat === 2) blip(root * 1.5, root * 1.5, 0.3, 'sine', 0.07);
          if (musicStep % 16 === 8) blip(root * 2, root * 2, 0.4, 'triangle', 0.05);
          musicStep += 1;
        }
      }
    },
  };
}
