/**
 * Stonetable's sound set (DESIGN "Themes and rendering", Sound: "an optional set (card slide, tap, shuffle, turn chime,
 * prompt tick)"). All procedural Web Audio: card on stone is a short band-passed noise, a tap is a low knock, the turn
 * chime a struck stone bell, the prompt tick a dry click, and the ambience the crackle of the torch. Nothing bundled.
 * Noise comes from a seeded generator, so a cue sounds the same each time.
 */
import type { AmbientSoundSource, SoundSet, SoundSource } from '../types';
import { hash2 } from './stone';

/** A buffer of `seconds` of white noise (seeded), optionally sparse crackle impulses instead. */
function noiseBuffer(ctx: AudioContext, seconds: number, seed: number, crackle = false): AudioBuffer {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let pop = 0;
  for (let i = 0; i < n; i++) {
    const r = hash2(i, seed, 4049) * 2 - 1;
    if (!crackle) {
      data[i] = r;
      continue;
    }
    // A pop starts rarely and decays over a few milliseconds; a low hiss underneath.
    if (hash2(i, seed + 1, 4049) > 0.99975) pop = 0.9;
    data[i] = r * (0.04 + pop);
    pop *= 0.996;
  }
  return buffer;
}

/** Play `buffer` through a filter and an envelope: attack to `peak` × gain, exponential decay over `decay` s. */
function burst(ctx: AudioContext, gain: number, buffer: AudioBuffer, filter: { type: BiquadFilterType; hz: number; q: number }, peak: number, decay: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = filter.type;
  f.frequency.value = filter.hz;
  f.Q.value = filter.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * gain), t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f);
  f.connect(g);
  g.connect(ctx.destination);
  src.start(t);
  src.stop(t + decay + 0.05);
}

/** A sine partial with an exponential decay. */
function tone(ctx: AudioContext, gain: number, hz: number, peak: number, decay: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * gain), t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t);
  o.stop(t + decay + 0.05);
}

const slide: SoundSource = {
  play(ctx, gain) {
    burst(ctx, gain, noiseBuffer(ctx, 0.2, 1), { type: 'bandpass', hz: 2200, q: 0.8 }, 0.35, 0.16);
  },
};

const tap: SoundSource = {
  play(ctx, gain) {
    tone(ctx, gain, 190, 0.5, 0.09);
    burst(ctx, gain, noiseBuffer(ctx, 0.05, 2), { type: 'lowpass', hz: 1400, q: 0.7 }, 0.3, 0.04);
  },
};

const shuffle: SoundSource = {
  play(ctx, gain) {
    const buffer = noiseBuffer(ctx, 0.08, 3);
    for (let i = 0; i < 7; i++) burst(ctx, gain, buffer, { type: 'bandpass', hz: 2600 + 300 * (i % 3), q: 1.1 }, 0.22, 0.06, i * 0.045);
  },
};

const turnChime: SoundSource = {
  play(ctx, gain) {
    // A struck stone bell: inharmonic partials, the low one ringing longest.
    tone(ctx, gain, 196, 0.32, 1.6);
    tone(ctx, gain, 196 * 2.76, 0.12, 0.9);
    tone(ctx, gain, 196 * 5.4, 0.05, 0.4);
  },
};

const promptTick: SoundSource = {
  play(ctx, gain) {
    tone(ctx, gain, 1900, 0.18, 0.035);
  },
};

const ambience: AmbientSoundSource = {
  start(ctx, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4, 5, true);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.12 * gain;
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start();
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        src.stop();
        src.disconnect();
        g.disconnect();
      },
    };
  },
};

/** The Stonetable sound set; on until the viewer turns it off (Settings.sound 'theme'). */
export const STONETABLE_SOUNDS: SoundSet = { slide, tap, shuffle, turnChime, promptTick, ambience, onByDefault: true };
