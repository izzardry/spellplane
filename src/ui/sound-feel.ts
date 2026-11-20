/**
 * The card-feel sound cues of the three looks (PLAN Milestone 7, Owner decisions after the first design round, Almost
 * haptic card handling: "every common move has a short animation and sound (draw, shuffle, tap and untap, play, to
 * graveyard, attach, clip)"; M7-P4). Synthesised with Web Audio from filtered noise and short tones: no audio file is
 * downloaded or bundled. Each look has its own timbre, from its mood (docs/design/m7-directions.html):
 *
 * - Kitchen Table: warm and woody, card stock on a wooden table, soft low thumps.
 * - Graphite: clean and precise, short high clicks and tight ticks.
 * - Codex: papery and hushed, parchment rustle and a muffled leather thud.
 *
 * Modest volume: every cue peaks at most at FEEL_PEAK of the gain the player passes, starts and ends at silence (no
 * clicks) and has stopped within FEEL_MAX_S. A look's theme set (M7-P1) wins over these cue by cue (ui/sound.ts).
 */
import type { FeelCue, LookId, SoundCue, SoundSet, SoundSource } from '../themes/types';
import { mulberry32 } from '../util/prng';

/** The loudest a feel cue gets, as a fraction of the gain the player passes in (modest: the table, not a game show). */
export const FEEL_PEAK = 0.3;
/** Every feel cue's sources have stopped this many seconds after it started. */
export const FEEL_MAX_S = 0.6;

/** Silence for an exponential ramp (it cannot reach 0). */
const QUIET = 0.0001;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise for this context, made once and the same every time (a seeded sequence). */
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const length = Math.max(1, Math.round(ctx.sampleRate));
    b = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = b.getChannelData(0);
    const rnd = mulberry32(7093);
    for (let i = 0; i < length; i++) d[i] = rnd() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/** A gain envelope: silence → `peak` in `attack` s → silence after `decay` s more, from `at`. */
function envelope(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(QUIET, at);
  g.gain.linearRampToValueAtTime(Math.max(QUIET, Math.min(FEEL_PEAK, peak)), at + attack);
  g.gain.exponentialRampToValueAtTime(QUIET, at + attack + decay);
  g.gain.linearRampToValueAtTime(0, at + attack + decay + 0.01);
  return g;
}

interface Scheduled {
  node: AudioScheduledSourceNode;
  end: number;
}

interface Burst {
  peak: number;
  attack: number;
  decay: number;
  freq: number;
  /** Where the filter's centre ends (a sweep), else `freq`. */
  to?: number;
  q: number;
  type: BiquadFilterType;
  offset: number;
}

/** A burst of filtered noise (a slide, a rustle, the paper part of a tap). */
function burst(ctx: BaseAudioContext, out: AudioNode, at: number, o: Burst): Scheduled {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = o.type;
  filter.frequency.setValueAtTime(o.freq, at);
  if (o.to !== undefined && o.to !== o.freq) filter.frequency.exponentialRampToValueAtTime(o.to, at + o.attack + o.decay);
  filter.Q.setValueAtTime(o.q, at);
  const env = envelope(ctx, at, o.peak, o.attack, o.decay);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  const end = at + o.attack + o.decay + 0.02;
  src.start(at, o.offset % 0.8, end - at);
  src.stop(end);
  return { node: src, end };
}

interface Tone {
  from: number;
  to: number;
  peak: number;
  attack: number;
  decay: number;
  type?: OscillatorType;
}

/** A short tone gliding from `from` to `to` Hz (a thump, a click's body, a clip's snap). */
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

/** A cue: its parts go through one master gain into the destination, disconnected when the last part has ended. */
function cue(play: (ctx: AudioContext, out: AudioNode, at: number) => Scheduled[]): SoundSource {
  return {
    play(ctx, gain) {
      const g = Math.max(0, Number.isFinite(gain) ? Math.min(1, gain) : 0);
      if (g === 0) return;
      const master = ctx.createGain();
      master.gain.setValueAtTime(g, ctx.currentTime);
      master.connect(ctx.destination);
      const parts = play(ctx, master, ctx.currentTime + 0.005);
      const last = parts.reduce<Scheduled | null>((a, x) => (a && a.end >= x.end ? a : x), null);
      if (last) last.node.onended = () => master.disconnect();
      else master.disconnect();
    },
  };
}

/** A look's voice: the few parameters its cues are made from. */
interface Voice {
  /** Body of a thump (Hz, start and end) and how long it rings. */
  thump: { from: number; to: number; decay: number; peak: number };
  /** The paper or card part: noise filter type, centre, Q. */
  paper: { type: BiquadFilterType; freq: number; q: number; peak: number };
  /** The click of a tap or a clip: tone type and pitch. */
  click: { type: OscillatorType; freq: number; peak: number };
}

const VOICES: Readonly<Record<LookId, Voice>> = {
  // Warm wood: low bodies, a soft card hiss.
  kitchen: { thump: { from: 190, to: 85, decay: 0.12, peak: 0.22 }, paper: { type: 'lowpass', freq: 1700, q: 0.7, peak: 0.12 }, click: { type: 'triangle', freq: 900, peak: 0.1 } },
  // Clean and precise: short high clicks, little body.
  graphite: { thump: { from: 260, to: 140, decay: 0.06, peak: 0.14 }, paper: { type: 'highpass', freq: 3200, q: 0.8, peak: 0.08 }, click: { type: 'sine', freq: 2100, peak: 0.12 } },
  // Parchment and leather: a rustle and a muffled thud.
  codex: { thump: { from: 140, to: 65, decay: 0.16, peak: 0.2 }, paper: { type: 'bandpass', freq: 2600, q: 1.1, peak: 0.13 }, click: { type: 'triangle', freq: 650, peak: 0.1 } },
};

/** The feel cues of one look, from its voice. */
function feelSet(v: Voice, seed: number): Required<Pick<SoundSet, FeelCue | 'slide' | 'tap' | 'shuffle'>> {
  const rnd = mulberry32(seed);
  const offset = () => rnd() * 0.7;
  const paper = (peak: number, attack: number, decay: number, sweep = 1): Burst => ({ peak, attack, decay, freq: v.paper.freq, to: v.paper.freq * sweep, q: v.paper.q, type: v.paper.type, offset: offset() });
  const thump = (k = 1): Tone => ({ from: v.thump.from * k, to: v.thump.to * k, peak: v.thump.peak, attack: 0.004, decay: v.thump.decay });
  const click = (k = 1, peak = v.click.peak): Tone => ({ from: v.click.freq * k, to: v.click.freq * k * 0.8, peak, attack: 0.002, decay: 0.035, type: v.click.type });
  return {
    // Picked up: a light lift off the table.
    pickup: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak * 0.6, 0.01, 0.07, 1.4))]),
    // Pulled toward a slot: a tiny tick.
    snap: cue((ctx, out, at) => [tone(ctx, out, at, click(1.25, v.click.peak * 0.7))]),
    // Put down: a soft landing.
    drop: cue((ctx, out, at) => [tone(ctx, out, at, thump()), burst(ctx, out, at, paper(v.paper.peak * 0.5, 0.004, 0.05))]),
    // A card slid on the table.
    slide: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak, 0.025, 0.14, 0.7)), tone(ctx, out, at + 0.12, { ...thump(1.1), peak: v.thump.peak * 0.5 })]),
    // Drawn: a quick slide off the library, toward the hand.
    draw: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak, 0.02, 0.12, 1.6))]),
    // Played: a slide that lands.
    play: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak * 0.8, 0.02, 0.1, 0.8)), tone(ctx, out, at + 0.1, thump())]),
    // Tapped: a click with a little body; untapped: the same, higher and lighter.
    tap: cue((ctx, out, at) => [tone(ctx, out, at, click()), tone(ctx, out, at, { ...thump(1.3), peak: v.thump.peak * 0.5 })]),
    untap: cue((ctx, out, at) => [tone(ctx, out, at, click(1.2, v.click.peak * 0.8))]),
    // A riffle: a run of short paper flicks, closing with a soft square-up.
    shuffle: cue((ctx, out, at) => {
      const parts: Scheduled[] = [];
      let t = at;
      for (let i = 0; i < 12; i++) {
        parts.push(burst(ctx, out, t, { ...paper(v.paper.peak * (0.6 + 0.1 * (i % 3)), 0.002, 0.025), freq: v.paper.freq * (1 + 0.08 * (i % 4)) }));
        t += 0.022 + i * 0.002;
      }
      parts.push(tone(ctx, out, Math.min(t + 0.03, at + FEEL_MAX_S - 0.2), { ...thump(1.2), peak: v.thump.peak * 0.6 }));
      return parts;
    }),
    // To the graveyard: tossed, a slide falling in pitch; to exile: a brighter, airier sweep; to the hand: a quick lift.
    toGraveyard: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak, 0.02, 0.16, 0.5)), tone(ctx, out, at + 0.14, { ...thump(0.9), peak: v.thump.peak * 0.7 })]),
    toExile: cue((ctx, out, at) => [burst(ctx, out, at, { ...paper(v.paper.peak * 0.8, 0.04, 0.2, 2), q: v.paper.q * 1.5 })]),
    toHand: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak * 0.8, 0.015, 0.09, 1.8))]),
    // Attached: tucked under, a short slide and a light tap; clipped: a crisp metal-ish snap.
    attach: cue((ctx, out, at) => [burst(ctx, out, at, paper(v.paper.peak * 0.7, 0.015, 0.08, 0.7)), tone(ctx, out, at + 0.08, click(0.8))]),
    clip: cue((ctx, out, at) => [tone(ctx, out, at, { from: 3200, to: 2400, peak: v.click.peak, attack: 0.001, decay: 0.03, type: 'square' }), tone(ctx, out, at + 0.04, click(1.5, v.click.peak * 0.7))]),
  };
}

/** Every look's synthesised card-feel cues (M7-P4). */
export const LOOK_FEEL_SOUNDS: Readonly<Record<LookId, SoundSet>> = {
  kitchen: feelSet(VOICES.kitchen, 11),
  graphite: feelSet(VOICES.graphite, 23),
  codex: feelSet(VOICES.codex, 37),
};

/** The cues every look synthesises (the feel cues plus slide, tap and shuffle). */
export const LOOK_FEEL_CUES: readonly SoundCue[] = ['slide', 'tap', 'shuffle', 'draw', 'play', 'untap', 'attach', 'clip', 'toGraveyard', 'toExile', 'toHand', 'pickup', 'snap', 'drop'];
