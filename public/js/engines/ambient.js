// engines/ambient.js
// Ambient Sound Engine — v1
//
// Soft Recovery promised "play ambient sound" and only spoke the words aloud.
// This makes it real.
//
// The sound is SYNTHESISED, not a file: no build step to add one, no network
// fetch (the app must work offline, and recovery is exactly when someone is
// least able to deal with a spinner), and no licensing to track. Filtered brown
// noise with a slow breathing motion reads as warm and non-musical — nothing to
// pattern-match onto, which is the point when you're depleted.

const FADE_IN = 1.6;    // seconds — never start abruptly on a depleted nervous system
const FADE_OUT = 1.2;
const BUFFER_SECONDS = 8;
const CROSSFADE = 0.35; // seconds blended end-into-start so the loop can't click

class AmbientEngine {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.playing = false;
  }

  get supported() {
    return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
  }

  /** Brown noise, seamlessly loopable. */
  buildBuffer(ctx) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * BUFFER_SECONDS);
    const fade = Math.floor(rate * CROSSFADE);

    // Generate length + fade samples, then blend the tail back over the head.
    const raw = new Float32Array(length + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last * 3.5;
    }

    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    data.set(raw.subarray(0, length));

    // Equal-power crossfade removes the discontinuity at the loop seam.
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      const headGain = Math.cos((1 - t) * 0.5 * Math.PI);
      const tailGain = Math.cos(t * 0.5 * Math.PI);
      data[i] = data[i] * headGain + raw[length + i] * tailGain;
    }

    return buffer;
  }

  async play() {
    if (!this.supported || this.playing) return this.playing;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = this.ctx || new Ctx();

    // Browsers start the context suspended until a user gesture — this is
    // always called from a button click, so resuming here is legitimate.
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { return false; }
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = this.buildBuffer(ctx);
    source.loop = true;

    // Roll the top end off hard — brown noise through a low filter is closer
    // to rain-on-a-window than to static.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.6;

    // Very slow drift so it breathes instead of sitting flat.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05; // one cycle per 20s
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + FADE_IN);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    lfo.start(now);

    this.nodes = { source, lfo, gain };
    this.playing = true;
    return true;
  }

  stop() {
    if (!this.playing || !this.nodes) return;

    const { source, lfo, gain } = this.nodes;
    const now = this.ctx.currentTime;

    // Ramp down rather than cut — a hard stop is its own little jolt.
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + FADE_OUT);

    const stopAt = now + FADE_OUT + 0.05;
    try { source.stop(stopAt); } catch { /* already stopped */ }
    try { lfo.stop(stopAt); } catch { /* already stopped */ }

    this.nodes = null;
    this.playing = false;
  }

  toggle() {
    if (this.playing) {
      this.stop();
      return Promise.resolve(false);
    }
    return this.play();
  }
}

export const ambientEngine = new AmbientEngine();
