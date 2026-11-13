// Dusk's muted sound set (DESIGN "Themes and rendering", Sound: "card slide, tap, shuffle, turn chime, prompt tick";
// theme table, Dusk: "muted ambience"). Played into a recording AudioContext stand-in (no Web Audio in Node): every
// cue is quiet (its summed envelopes stay under CUE_PEAK of the gain), starts and ends at silence (no clicks), reaches
// the destination, and stops by itself within CUE_MAX_S; the room tone fades in, stays under AMBIENCE_PEAK and fades
// out on stop. The browser spec renders the same set with a real OfflineAudioContext.
import { describe, expect, it } from 'vitest';
import { AMBIENCE_FADE_S, AMBIENCE_PEAK, CUE_MAX_S, CUE_PEAK, DUSK_SOUNDS } from '../../../../src/themes/dusk/sounds';

type Ev = { kind: 'set' | 'linear' | 'exp' | 'target'; v: number; t: number; tau?: number };

class Param {
  events: Ev[] = [];
  constructor(public value = 1) {}
  setValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'set', v, t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'linear', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
    this.events.push({ kind: 'exp', v, t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.events.push({ kind: 'target', v, t, tau });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  /** The automation's value at `t` (Web Audio semantics for set, linear and exponential events). */
  at(t: number): number {
    let v = this.value;
    let prev: { v: number; t: number } = { v, t: -Infinity };
    for (const e of [...this.events].sort((a, b) => a.t - b.t)) {
      if (e.kind === 'target') {
        if (e.t > t) break;
        const v0 = this.at(e.t - 1e-9);
        return e.v + (v0 - e.v) * Math.exp(-(t - e.t) / e.tau!);
      }
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
  out: (Node | Param)[] = [];
  constructor(public type: string) {}
  connect(n: Node | Param) {
    this.out.push(n);
    return n;
  }
}
class Gain extends Node {
  gain = new Param(1);
  constructor() {
    super('gain');
  }
}
class Source extends Node {
  started: number | null = null;
  stopped: number | null = null;
  loop = false;
  buffer: unknown = null;
  frequency = new Param(440);
  oscType = 'sine';
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
  filterType = 'lowpass';
  constructor() {
    super('filter');
  }
}

function fakeContext(now = 10) {
  const nodes: Node[] = [];
  const destination = new Node('destination');
  const ctx = {
    currentTime: now,
    sampleRate: 8000,
    destination,
    createGain() {
      const g = new Gain();
      nodes.push(g);
      return g;
    },
    createOscillator() {
      const o = new Source('oscillator');
      nodes.push(o);
      return o;
    },
    createBufferSource() {
      const s = new Source('buffer');
      nodes.push(s);
      return s;
    },
    createBiquadFilter() {
      const f = new Filter();
      nodes.push(f);
      return f;
    },
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data, length };
    },
  };
  return { ctx: ctx as unknown as AudioContext, nodes, destination, raw: ctx };
}

const sources = (nodes: Node[]) => nodes.filter((n): n is Source => n instanceof Source && n.type !== 'gain');

/** Whether a path of connections leads from `n` to the destination. */
function reaches(n: Node, dest: Node, seen = new Set<Node>()): boolean {
  if (n === dest) return true;
  if (seen.has(n)) return false;
  seen.add(n);
  return n.out.some((o) => o instanceof Node && reaches(o, dest, seen));
}

/** Gains on the way from a source to the destination (excluding the master, the first gain after the destination). */
function gainsOnPath(n: Node, dest: Node): Gain[] {
  if (n === dest) return [];
  for (const o of n.out) {
    if (!(o instanceof Node)) continue;
    if (o === dest || reaches(o, dest)) return [...(o instanceof Gain ? [o] : []), ...gainsOnPath(o, dest)];
  }
  return [];
}

const CUES = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick'] as const;

describe('Dusk cues', () => {
  for (const name of CUES) {
    it(`${name}: quiet, click-free, routed to the speakers, over within ${CUE_MAX_S} s`, () => {
      const { ctx, nodes, destination } = fakeContext();
      const gain = 0.8;
      DUSK_SOUNDS[name]!.play(ctx, gain);
      const src = sources(nodes);
      expect(src.length).toBeGreaterThan(0);
      for (const s of src) {
        expect(reaches(s, destination), `${s.type} reaches the destination`).toBe(true);
        expect(s.started).not.toBeNull();
        expect(s.started!).toBeGreaterThanOrEqual(10);
        expect(s.stopped, 'stops by itself').not.toBeNull();
        expect(s.stopped! - 10).toBeLessThanOrEqual(CUE_MAX_S);
        expect(s.loop).toBe(false);
      }
      // The master gain is the viewer's gain.
      const master = nodes.find((n): n is Gain => n instanceof Gain && n.out.includes(destination))!;
      expect(master.gain.at(10)).toBeCloseTo(gain, 6);
      // Envelopes: silent at the start and at the end of each source; their sum (sources at full scale) stays under CUE_PEAK.
      const envelopes = src.map((s) => gainsOnPath(s, destination).filter((g) => g !== master));
      for (const [i, env] of envelopes.entries()) {
        expect(env.length, `source ${i} has an envelope`).toBeGreaterThan(0);
        const s = src[i]!;
        const level = (t: number) => env.reduce((a, g) => a * g.gain.at(t), 1);
        expect(level(s.started!)).toBeLessThan(1e-3);
        expect(level(s.stopped!)).toBeLessThan(1e-3);
      }
      let peak = 0;
      for (let t = 10; t <= 10 + CUE_MAX_S; t += 0.0005) {
        let sum = 0;
        for (const [i, env] of envelopes.entries()) {
          const s = src[i]!;
          if (t < s.started! || t > s.stopped!) continue;
          sum += env.reduce((a, g) => a * g.gain.at(t), 1);
        }
        peak = Math.max(peak, sum);
      }
      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThanOrEqual(CUE_PEAK);
    });
  }

  it('make no sound at gain 0 or with a broken gain', () => {
    for (const g of [0, -1, Number.NaN]) {
      const { ctx, nodes } = fakeContext();
      for (const name of CUES) DUSK_SOUNDS[name]!.play(ctx, g);
      expect(nodes).toEqual([]);
    }
  });

  it('use the same noise every time (deterministic)', () => {
    const a = fakeContext();
    const b = fakeContext();
    DUSK_SOUNDS.slide!.play(a.ctx, 1);
    DUSK_SOUNDS.slide!.play(b.ctx, 1);
    const data = (x: ReturnType<typeof fakeContext>) => (sources(x.nodes)[0]!.buffer as { getChannelData(): Float32Array }).getChannelData();
    expect(data(a)).toEqual(data(b));
    expect(data(a).some((v) => v !== 0)).toBe(true);
  });
});

describe('Dusk room tone', () => {
  it('fades in, stays under AMBIENCE_PEAK of the gain and fades out on stop', () => {
    const { ctx, nodes, destination, raw } = fakeContext(5);
    const gain = 0.6;
    const handle = DUSK_SOUNDS.ambience!.start(ctx, gain);
    const src = sources(nodes);
    const loop = src.find((s) => s.type === 'buffer')!;
    expect(loop.loop).toBe(true);
    expect(reaches(loop, destination)).toBe(true);
    const out = nodes.find((n): n is Gain => n instanceof Gain && n.out.includes(destination))!;
    const lfoDepth = nodes.find((n): n is Gain => n instanceof Gain && n.out.includes(out.gain))!;
    expect(out.gain.at(5)).toBe(0);
    const level = out.gain.at(5 + AMBIENCE_FADE_S);
    expect(level).toBeGreaterThan(0);
    // The breath adds at most its depth on top of the level.
    expect(level + lfoDepth.gain.at(5 + AMBIENCE_FADE_S)).toBeLessThanOrEqual(AMBIENCE_PEAK * gain);
    // The brown noise stays within full scale.
    const data = (loop.buffer as { getChannelData(): Float32Array }).getChannelData();
    expect(Math.max(...Array.from(data, Math.abs))).toBeLessThanOrEqual(1);
    expect(loop.stopped).toBeNull();
    raw.currentTime = 20;
    handle.stop();
    for (const s of src) {
      expect(s.stopped).not.toBeNull();
      expect(s.stopped! - 20).toBeLessThanOrEqual(AMBIENCE_FADE_S);
    }
    // Silent (below -40 dB of the level) when the sources stop.
    expect(out.gain.at(20 + AMBIENCE_FADE_S / 3)).toBeLessThan(level / 100);
    const stoppedAt = loop.stopped;
    raw.currentTime = 30;
    handle.stop();
    expect(loop.stopped).toBe(stoppedAt);
  });
});
