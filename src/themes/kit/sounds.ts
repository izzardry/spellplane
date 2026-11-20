/**
 * Procedural sound sets of the M7 looks (DESIGN "Themes and rendering", Sound; PLAN Milestone 7, Owner decisions,
 * Almost haptic card handling: "every common move has a short animation and sound (draw, shuffle, tap and untap, play,
 * to graveyard, attach, clip)"; themes/types.ts FeelCue: "M7-P1 gives each look its set"). Every cue is synthesised with
 * Web Audio from band-passed noise and soft partials; no audio file is bundled (docs/ASSETS.md lists them as
 * procedural). One synthesiser, three timbres: a look changes the material the cards seem to touch (cloth and wood,
 * slate, leather and parchment), not which cues exist.
 *
 * Every cue peaks at most at CUE_PEAK of the gain the player passes in (cues overlap during play, so they stay quiet),
 * every envelope starts and ends at silence (no clicks), and every source stops by itself within CUE_MAX_S; the noise
 * is a fixed sequence, so a cue sounds the same each time. A gain of 0 (or not a number) builds nothing.
 */
import type { FeelCue, SoundSet, SoundSource } from '../types';
import { prng } from './procedural';

/** The loudest a cue gets, as a fraction of the gain. */
export const CUE_PEAK = 0.3;
/** Every cue's sources have stopped this many seconds after it started. */
export const CUE_MAX_S = 1.6;

/** The material a look's cards seem to touch. */
export interface Timbre {
  /** Centre of the slide hiss, Hz: lower is softer cloth, higher is a hard, smooth surface. */
  hiss: number;
  /** The body of a knock (tap, drop), Hz. */
  knock: number;
  /** Paper crispness of riffles and flicks, Hz. */
  paper: number;
  /** Overall level 0..1 (multiplied into every cue's peak, never above CUE_PEAK). */
  level: number;
  /** The turn chime's two notes, Hz, and its partial waveform. */
  chime: [number, number];
  chimeWave: OscillatorType;
  /** Length factor of decays (a softer room rings a little longer). */
  ring: number;
}

const QUIET = 0.0001;
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const length = Math.max(1, Math.round(ctx.sampleRate * 2));
    b = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = b.getChannelData(0);
    const rnd = prng(2207);
    for (let i = 0; i < length; i++) d[i] = rnd() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/** Silence → `peak` in `attack` s → silence after `decay` s more. */
function envelope(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(QUIET, at);
  g.gain.linearRampToValueAtTime(Math.max(QUIET, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(QUIET, at + attack + decay);
  g.gain.linearRampToValueAtTime(0, at + attack + decay + 0.01);
  return g;
}

interface Scheduled {
  node: AudioScheduledSourceNode;
  end: number;
}

type Burst = { peak: number; attack: number; decay: number; freq: number; q: number; offset: number; sweep?: number };

/** Band-passed noise; `sweep` glides the band's centre by that factor over the burst. */
function burst(ctx: BaseAudioContext, out: AudioNode, at: number, o: Burst): Scheduled {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(o.freq, at);
  if (o.sweep && o.sweep !== 1) filter.frequency.exponentialRampToValueAtTime(o.freq * o.sweep, at + o.attack + o.decay);
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

type Tone = { from: number; to: number; peak: number; attack: number; decay: number; type?: OscillatorType };

function tone(ctx: BaseAudioContext, out: AudioNode, at: number, o: Tone): Scheduled {
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

/** A cue through one master gain into the destination; the master is disconnected when its last source ends. */
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

/** A look's full sound set: the table cues and every card-feel cue, in the look's timbre. */
export function soundSet(t: Timbre, onByDefault: boolean): SoundSet {
  // Peaks are fractions of CUE_PEAK scaled by the look's level, so no cue (or overlap of its own parts) exceeds it.
  const p = (k: number) => CUE_PEAK * Math.min(1, Math.max(0, t.level)) * k;
  const r = (s: number) => s * t.ring;

  const slide = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.5), attack: 0.025, decay: r(0.15), freq: t.hiss, q: 0.7, offset: 0.1, sweep: 0.8 })]);
  const knock = (ctx: AudioContext, out: AudioNode, at: number, k: number): Scheduled[] => [
    tone(ctx, out, at, { from: t.knock * 1.6, to: t.knock * 0.7, peak: p(0.55 * k), attack: 0.003, decay: r(0.1) }),
    burst(ctx, out, at, { peak: p(0.25 * k), attack: 0.002, decay: 0.04, freq: t.paper, q: 1, offset: 0.4 }),
  ];
  const tap = cue((ctx, out, at) => knock(ctx, out, at, 1));
  // Untap: the card turned back, lighter and a little higher than the tap.
  const untap = cue((ctx, out, at) => [
    tone(ctx, out, at, { from: t.knock * 2, to: t.knock * 1.2, peak: p(0.35), attack: 0.003, decay: r(0.08) }),
    burst(ctx, out, at, { peak: p(0.2), attack: 0.004, decay: 0.05, freq: t.hiss * 1.4, q: 0.9, offset: 0.55 }),
  ]);
  const shuffle = cue((ctx, out, at) => {
    const parts: Scheduled[] = [];
    let s = at;
    for (let i = 0; i < 14; i++) {
      parts.push(burst(ctx, out, s, { peak: p(0.3 + 0.1 * (i % 3)), attack: 0.003, decay: 0.03, freq: t.paper + 250 * (i % 4), q: 1.2, offset: 0.05 * i }));
      s += 0.032 + i * 0.004;
    }
    parts.push(...knock(ctx, out, s + 0.04, 0.7));
    return parts;
  });
  const turnChime = cue((ctx, out, at) => [
    tone(ctx, out, at, { from: t.chime[0], to: t.chime[0], peak: p(0.4), attack: 0.01, decay: r(1.0), type: t.chimeWave }),
    tone(ctx, out, at + 0.09, { from: t.chime[1], to: t.chime[1], peak: p(0.28), attack: 0.01, decay: r(0.9), type: t.chimeWave }),
  ]);
  const promptTick = cue((ctx, out, at) => [tone(ctx, out, at, { from: t.paper * 0.5, to: t.paper * 0.42, peak: p(0.3), attack: 0.002, decay: 0.05, type: 'triangle' })]);
  // Draw: a card pulled off the library, a quick rising flick.
  const draw = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.5), attack: 0.015, decay: r(0.12), freq: t.hiss * 0.9, q: 0.8, offset: 0.2, sweep: 1.6 })]);
  // Play: slide then a soft set-down.
  const play = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.4), attack: 0.02, decay: r(0.12), freq: t.hiss, q: 0.7, offset: 0.3, sweep: 0.75 }), ...knock(ctx, out, at + 0.12, 0.6)]);
  // To the graveyard: a lower, duller drop onto a pile.
  const toGraveyard = cue((ctx, out, at) => [
    burst(ctx, out, at, { peak: p(0.35), attack: 0.02, decay: r(0.1), freq: t.hiss * 0.7, q: 0.7, offset: 0.65, sweep: 0.7 }),
    tone(ctx, out, at + 0.08, { from: t.knock * 1.1, to: t.knock * 0.5, peak: p(0.45), attack: 0.004, decay: r(0.14) }),
  ]);
  // To exile: an airy sweep away.
  const toExile = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.4), attack: 0.06, decay: r(0.25), freq: t.hiss * 1.6, q: 0.6, offset: 0.75, sweep: 2.2 })]);
  const toHand = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.4), attack: 0.015, decay: r(0.09), freq: t.hiss * 1.2, q: 0.8, offset: 0.85, sweep: 1.3 })]);
  // Attach: tucked behind its host, two small taps.
  const attach = cue((ctx, out, at) => [...knock(ctx, out, at, 0.5), ...knock(ctx, out, at + 0.07, 0.4)]);
  // Clip: a little metal clip snapping on (two bright partials).
  const clip = cue((ctx, out, at) => [
    tone(ctx, out, at, { from: 2400, to: 2100, peak: p(0.25), attack: 0.001, decay: 0.06, type: 'triangle' }),
    tone(ctx, out, at + 0.012, { from: 3500, to: 3300, peak: p(0.15), attack: 0.001, decay: 0.05 }),
    burst(ctx, out, at, { peak: p(0.2), attack: 0.001, decay: 0.02, freq: 5000, q: 2, offset: 1.1 }),
  ]);
  const pickup = cue((ctx, out, at) => [burst(ctx, out, at, { peak: p(0.25), attack: 0.01, decay: 0.06, freq: t.hiss * 1.3, q: 0.9, offset: 1.2, sweep: 1.4 })]);
  const drop = cue((ctx, out, at) => knock(ctx, out, at, 0.7));
  // Snap: a crisp, very short click as a card is pulled into its slot.
  const snap = cue((ctx, out, at) => [tone(ctx, out, at, { from: t.paper * 0.7, to: t.paper * 0.55, peak: p(0.3), attack: 0.001, decay: 0.03, type: 'triangle' })]);

  const feel: Record<FeelCue, SoundSource> = { draw, untap, play, toGraveyard, toExile, toHand, attach, clip, pickup, drop, snap };
  return { slide, tap, shuffle, turnChime, promptTick, ...feel, onByDefault };
}
