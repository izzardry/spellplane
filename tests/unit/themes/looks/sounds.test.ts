// The looks' sound sets (DESIGN "Themes and rendering", Sound: "card slide, tap, shuffle, turn chime, prompt tick";
// PLAN Milestone 7, Owner decisions, Almost haptic card handling: "every common move has a short animation and sound
// (draw, shuffle, tap and untap, play, to graveyard, attach, clip)"; themes/types.ts FeelCue). Played into an
// AudioContext stand-in that records the graph (no Web Audio in Node): every cue reaches the speakers, stays under
// CUE_PEAK of the gain at every moment, starts and ends at silence (no clicks), stops by itself within CUE_MAX_S, and
// leaves nothing connected afterwards; a gain of 0 builds nothing.
import { describe, expect, it } from 'vitest';
import { LISTED_THEME_IDS, loadTheme, type SoundCue, type Theme } from '../../../../src/themes/index';
import { CUE_MAX_S, CUE_PEAK } from '../../../../src/themes/kit/sounds';

type Ev = { kind: 'set' | 'linear' | 'exp'; v: number; t: number };

class Param {
  events: Ev[] = [];
  constructor(public value = 1) {}
  setValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'set', v, t });
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'linear', v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
    this.events.push({ kind: 'exp', v, t });
  }
  /** The automation's value at `t` (Web Audio semantics for set, linear and exponential events). */
  at(t: number): number {
    let v = this.value;
    let prev = { v, t: -Infinity };
    for (const e of [...this.events].sort((a, b) => a.t - b.t)) {
      if (e.kind === 'set') {
        if (e.t > t) break;
        v = e.v;
        prev = { v, t: e.t };
        continue;
      }
      if (e.t <= t) {
        v = e.v;
        prev = { v, t: e.t };
        continue;
      }
      const k = (t - prev.t) / (e.t - prev.t);
      if (!Number.isFinite(k)) return v;
      return e.kind === 'linear' ? prev.v + (e.v - prev.v) * k : prev.v * (e.v / prev.v) ** k;
    }
    return v;
  }
}

class Node {
  out: Node[] = [];
  constructor(public type: string) {}
  connect(n: Node) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
  }
}
class Gain extends Node {
  gain = new Param(1);
}
class Source extends Node {
  started: number | null = null;
  stopped: number | null = null;
  buffer: unknown = null;
  onended: (() => void) | null = null;
  frequency = new Param(440);
  start(t = 0) {
    this.started = t;
  }
  stop(t = 0) {
    this.stopped = t;
  }
}
class Filter extends Node {
  frequency = new Param(350);
  Q = new Param(1);
}

function fakeContext(now = 10) {
  const nodes: Node[] = [];
  const destination = new Node('destination');
  const make = <N extends Node>(n: N): N => {
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: now,
    sampleRate: 8000,
    destination,
    createGain: () => make(new Gain('gain')),
    createOscillator: () => make(new Source('oscillator')),
    createBufferSource: () => make(new Source('buffer')),
    createBiquadFilter: () => make(new Filter('filter')),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, nodes, destination };
}

/** The product of the gains on every path from a source to the destination, at time t (the loudest path). */
function level(src: Node, destination: Node, t: number): number {
  const walk = (n: Node): number => {
    if (n === destination) return 1;
    let best = 0;
    for (const o of n.out) best = Math.max(best, walk(o) * (o instanceof Gain ? o.gain.at(t) : 1));
    return best;
  };
  return walk(src);
}

const looks: Theme[] = await Promise.all(LISTED_THEME_IDS.map((id) => loadTheme(id)));
const CUES: SoundCue[] = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick', 'draw', 'untap', 'play', 'toGraveyard', 'toExile', 'toHand', 'attach', 'clip', 'pickup', 'drop', 'snap'];

describe.each(looks.map((t) => [t.id, t] as const))('%s', (_id, theme) => {
  it.each(CUES)('%s: reaches the speakers, quiet at every moment, silent at its start and end, stops within CUE_MAX_S', (cue) => {
    const { ctx, nodes, destination } = fakeContext(10);
    const gain = 0.8;
    theme.sounds![cue]!.play(ctx, gain);
    const sources = nodes.filter((n): n is Source => n instanceof Source);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.started).not.toBeNull();
      expect(s.started!).toBeGreaterThanOrEqual(10);
      expect(s.stopped).not.toBeNull();
      expect(s.stopped! - 10).toBeLessThanOrEqual(CUE_MAX_S);
    }
    const end = Math.max(...sources.map((s) => s.stopped!));
    let peak = 0;
    for (let t = 10; t <= end; t += 0.002) {
      // A source sounds only between its start and its stop.
      const sum = sources.reduce((a, s) => (t >= s.started! && t <= s.stopped! ? a + level(s, destination, t) : a), 0);
      peak = Math.max(peak, sum);
    }
    expect(peak).toBeGreaterThan(0);
    // Overlapping parts of one cue together stay under the cap (a little slack for the sampling step).
    expect(peak).toBeLessThanOrEqual(CUE_PEAK * gain * 1.02);
    for (const s of sources) {
      expect(level(s, destination, s.started!)).toBeLessThan(0.001);
      expect(level(s, destination, s.stopped!)).toBeLessThan(0.001);
    }
    // Once its last source ended, the cue's master gain lets go of the speakers.
    const last = sources.reduce((a, s) => (a.stopped! >= s.stopped! ? a : s));
    last.onended?.();
    expect(nodes.filter((n) => n.out.includes(destination))).toEqual([]);
  });

  it('builds nothing at gain 0 or a gain that is not a number', () => {
    for (const g of [0, Number.NaN, -1]) {
      const { ctx, nodes } = fakeContext();
      theme.sounds!.tap!.play(ctx, g);
      expect(nodes).toEqual([]);
    }
  });
});

it('gives each look its own timbre: the same cue sounds different in the four looks', () => {
  const freqs = looks.map((t) => {
    const { ctx, nodes } = fakeContext();
    t.sounds!.slide!.play(ctx, 1);
    const f = nodes.find((n): n is Filter => n instanceof Filter)!;
    return f.frequency.at(10.006);
  });
  expect(new Set(freqs).size).toBe(looks.length);
});
