// audio.js — all sound is synthesised with WebAudio: gunshots, crashes, sirens,
// pickups, mission jingles, an engine hum and a tiny procedural music loop.
// No audio files, nothing loads over the network. Starts on the first user gesture.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = 0;
    this.musicStep = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  tone(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise(dur, vol = 0.3, freq = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  gunshot() { this.noise(0.13, 0.5, 2600); this.tone(140, 0.09, 'square', 0.25, 60); }
  dryFire() { this.tone(900, 0.04, 'square', 0.12); }
  crash(big = false) { this.noise(big ? 0.4 : 0.2, big ? 0.55 : 0.32, 700); this.tone(90, 0.22, 'triangle', 0.3, 40); }
  pickup() { this.tone(880, 0.08, 'sine', 0.22); this.tone(1320, 0.12, 'sine', 0.2, null, 0.07); }
  cash() { this.tone(1180, 0.06, 'triangle', 0.2); this.tone(1560, 0.1, 'triangle', 0.18, null, 0.05); }
  doorSlam() { this.noise(0.08, 0.25, 500); }
  hurt() { this.tone(220, 0.12, 'sawtooth', 0.2, 110); }
  jingle(win = true) {
    const notes = win ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((n, i) => this.tone(n, 0.16, 'triangle', 0.22, null, i * 0.11));
  }
  bustedSting() { this.tone(196, 0.5, 'sawtooth', 0.25, 98); this.noise(0.3, 0.15, 400, 0.05); }

  // Continuous engine hum while the player drives; pitch follows speed.
  setEngine(on, speedRatio = 0) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0.0;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420;
      this.engineOsc.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      const target = on && !this.muted ? 0.05 + speedRatio * 0.05 : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
      this.engineOsc.frequency.setTargetAtTime(55 + speedRatio * 130, this.ctx.currentTime, 0.08);
    }
  }

  // Police siren: a two-tone wail whose volume follows the nearest police car.
  setSiren(level) {
    if (!this.ctx) return;
    if (level > 0.02 && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    }
    if (this.sirenOsc) {
      const t = this.ctx.currentTime;
      this.sirenOsc.frequency.setValueAtTime((Math.floor(t * 1.6) % 2 === 0) ? 720 : 520, t);
      this.sirenGain.gain.setTargetAtTime(this.muted ? 0 : level * 0.06, t, 0.1);
    }
  }

  // A tiny sun-soaked loop: warm bass + offbeat hats + a lazy lead, 8 steps a bar.
  updateMusic(dt, playing) {
    if (!this.ctx || this.muted || !playing) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.24;
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 73.4, 0, 82.4, 0];
    const lead = [220, 0, 0, 261.6, 0, 0, 196, 0, 220, 0, 0, 329.6, 0, 293.7, 0, 0];
    const i = this.musicStep % 16;
    if (bass[i]) this.tone(bass[i], 0.22, 'triangle', 0.16);
    if (lead[i]) this.tone(lead[i], 0.2, 'sine', 0.07);
    if (i % 2 === 0) this.noise(0.03, 0.03, 6000);
    this.musicStep++;
  }
}
