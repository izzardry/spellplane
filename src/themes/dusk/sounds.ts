/**
 * Dusk's muted sound set (DESIGN "Themes and rendering": Sound, "an optional set (card slide, tap, shuffle, turn
 * chime, prompt tick)"; theme table, Dusk: "muted ambience"). Every cue is synthesised with Web Audio from filtered
 * noise and soft sine partials, so no audio file is bundled (docs/ASSETS.md lists the set as procedural).
 *
 * Muted means: every cue peaks at most at CUE_PEAK of the viewer's gain, the room tone at AMBIENCE_PEAK, every
 * envelope starts and ends at silence (no clicks), and every source stops by itself within CUE_MAX_S. The noise is a
 * deterministic sequence (themes/dusk/textures.ts prng), so a cue sounds the same each time.
 */
import type { AmbientSoundSource, SoundSet, SoundSource } from '../types';
import { prng } from './textures';

/** The loudest a cue gets, as a fraction of the gain the player passes in. */
export const CUE_PEAK = 0.25;
/** The loudest the room tone gets, as a fraction of the gain. */
export const AMBIENCE_PEAK = 0.05;
/** Every cue's sources have stopped this many seconds after it started. */
export const CUE_MAX_S = 1.6;
/** Fade of the room tone when it starts and stops, seconds. */
export const AMBIENCE_FADE_S = 1.5;

/** Silence for an exponential ramp (it cannot reach 0). */
const QUIET = 0.0001;

const noiseBuffers = new WeakMap<BaseAudioContext, { white: AudioBuffer; brown: AudioBuffer }>();

/** Two seconds of white and of brown noise for this context, made once. */
function noise(ctx: BaseAudioContext): { white: AudioBuffer; brown: AudioBuffer } {
  let n = noiseBuffers.get(ctx);
  if (!n) {
    const length = Math.max(1, Math.round(ctx.sampleRate * 2));
    const white = ctx.createBuffer(1, length, ctx.sampleRate);
    const brown = ctx.createBuffer(1, length, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    const rnd = prng(1907);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const v = rnd() * 2 - 1;
      w[i] = v;
      last = (last + 0.02 * v) / 1.02;
      b[i] = last * 3.5;
    }
    n = { white, brown };
    noiseBuffers.set(ctx, n);
  }
  return n;
}

/** A gain envelope: silence → `peak` in `attack` s → silence at `attack + decay` s, from `at`. */
function envelope(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(QUIET, at);
  g.gain.linearRampToValueAtTime(Math.max(QUIET, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(QUIET, at + attack + decay);
  g.gain.linearRampToValueAtTime(0, at + attack + decay + 0.01);
  return g;
}

/** A scheduled source and the time it stops. */
interface Scheduled {
  node: AudioScheduledSourceNode;
  end: number;
}

/** A burst of band-passed noise. */
function noiseBurst(ctx: BaseAudioContext, out: AudioNode, at: number, o: { peak: number; attack: number; decay: number; freq: number; q: number; offset: number }): Scheduled {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx).white;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(o.freq, at);
  filter.Q.setValueAtTime(o.q, at);
  const env = envelope(ctx, at, o.peak, o.attack, o.decay);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  const end = at + o.attack + o.decay + 0.02;
  src.start(at, o.offset % 1.5, end - at);
  src.stop(end);
  return { node: src, end };
}

/** A soft sine partial gliding from `from` to `to` Hz. */
function tone(ctx: BaseAudioContext, out: AudioNode, at: number, o: { from: number; to: number; peak: number; attack: number; decay: number; type?: OscillatorType }): Scheduled {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.attack + o.decay);
  const env = envelope(ctx, at, o.peak, o.attack, o.decay);
  osc.connect(env);
  env.connect(out);
  const end = at + o.attack + o.decay + 0.02;
  osc.start(at);
  osc.stop(end);
  return { node: osc, end };
}

/**
 * A cue: its sources go through one master gain of `gain` into the destination; the master is disconnected when the
 * last source has ended, so a played cue leaves nothing attached to the destination.
 */
function cue(play: (ctx: AudioContext, out: AudioNode, at: number) => Scheduled[]): SoundSource {
  return {
    play(ctx, gain) {
      const g = Math.max(0, Number.isFinite(gain) ? gain : 0);
      if (g === 0) return;
      const master = ctx.createGain();
      master.gain.setValueAtTime(g, ctx.currentTime);
      master.connect(ctx.destination);
      const scheduled = play(ctx, master, ctx.currentTime + 0.005);
      const last = scheduled.reduce<Scheduled | null>((a, x) => (a && a.end >= x.end ? a : x), null);
      if (last) last.node.onended = () => master.disconnect();
      else master.disconnect();
    },
  };
}

/** A card sliding over felt: a soft, low hiss. */
const slide = cue((ctx, out, at) => [noiseBurst(ctx, out, at, { peak: 0.14, attack: 0.03, decay: 0.16, freq: 900, q: 0.7, offset: 0.1 })]);

/** A tap on felt: a muffled thump with a little cloth noise. */
const tap = cue((ctx, out, at) => [
  tone(ctx, out, at, { from: 150, to: 70, peak: 0.17, attack: 0.004, decay: 0.12 }),
  noiseBurst(ctx, out, at, { peak: 0.06, attack: 0.002, decay: 0.05, freq: 2200, q: 0.9, offset: 0.4 }),
]);

/** A riffle shuffle: a run of short paper bursts, slowing at the end. */
const shuffle = cue((ctx, out, at) => {
  const parts: Scheduled[] = [];
  let t = at;
  for (let i = 0; i < 14; i++) {
    parts.push(noiseBurst(ctx, out, t, { peak: 0.08 + 0.04 * ((i * 7) % 3) * 0.5, attack: 0.003, decay: 0.035, freq: 2600 + 300 * (i % 4), q: 1.2, offset: 0.05 * i }));
    t += 0.035 + i * 0.004;
  }
  parts.push(noiseBurst(ctx, out, t + 0.04, { peak: 0.12, attack: 0.01, decay: 0.12, freq: 700, q: 0.8, offset: 0.9 }));
  return parts;
});

/** The turn chime: two quiet bell partials a fifth apart. */
const turnChime = cue((ctx, out, at) => [
  tone(ctx, out, at, { from: 523.25, to: 523.25, peak: 0.12, attack: 0.01, decay: 1.2 }),
  tone(ctx, out, at + 0.09, { from: 783.99, to: 783.99, peak: 0.08, attack: 0.01, decay: 1.1 }),
  tone(ctx, out, at, { from: 1046.5, to: 1046.5, peak: 0.025, attack: 0.005, decay: 0.5 }),
]);

/** The prompt tick: a short, soft wooden blip. */
const promptTick = cue((ctx, out, at) => [tone(ctx, out, at, { from: 1320, to: 1100, peak: 0.1, attack: 0.002, decay: 0.05, type: 'triangle' })]);

/**
 * Cancel a parameter's automation after `t` and keep its value at `t` (Web Audio cancelAndHoldAtTime; where a browser
 * lacks it, cancelScheduledValues plus a set to the current value).
 */
export function hold(param: AudioParam, t: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
    return;
  }
  const v = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
}

/** A room tone that was never started (gain 0): nothing to stop. */
const SILENT_AMBIENCE = { stop(): void {} };

/** The room tone: low brown noise breathing slowly, faded in and out; at gain 0 it builds nothing. */
const ambience: AmbientSoundSource = {
  start(ctx, gain) {
    const g = Math.max(0, Number.isFinite(gain) ? gain : 0);
    if (g === 0) return SILENT_AMBIENCE;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx).brown;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, at);
    filter.Q.setValueAtTime(0.5, at);
    const level = 0.7 * AMBIENCE_PEAK * g;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(level, at + AMBIENCE_FADE_S);
    // A slow breath of ±30% around the level, so the tone never sits completely still.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.07, at);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.3 * level, at);
    lfo.connect(depth);
    depth.connect(out.gain);
    src.connect(filter);
    filter.connect(out);
    out.connect(ctx.destination);
    src.start(at);
    lfo.start(at);
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        const fade = AMBIENCE_FADE_S / 3;
        // Hold the level and the breath where they are now (also mid fade-in), then glide both to silence: six time
        // constants within the fade. Cancelling alone would drop a pending ramp and jump back to its start (a click).
        hold(out.gain, now);
        hold(depth.gain, now);
        out.gain.setTargetAtTime(0, now, fade / 6);
        depth.gain.setTargetAtTime(0, now, fade / 6);
        // Detach the chain from the speakers once the noise has ended.
        src.onended = () => out.disconnect();
        src.stop(now + fade);
        lfo.stop(now + fade);
      },
    };
  },
};

/** Dusk's sound set: muted cues and a quiet room tone, on until the viewer turns sound off (Settings.sound). */
export const DUSK_SOUNDS: SoundSet = { slide, tap, shuffle, turnChime, promptTick, ambience, onByDefault: true };
