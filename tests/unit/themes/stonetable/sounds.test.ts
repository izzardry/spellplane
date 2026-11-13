// Stonetable's sound set (DESIGN "Themes and rendering", Sound: "an optional set (card slide, tap, shuffle, turn chime,
// prompt tick)"; Dusk's "muted ambience" shows a set may loop a background). Procedural Web Audio, checked against a
// recording AudioContext stand-in: every cue reaches the speakers, is scaled by the gain it is given and ends by itself;
// the ambience stops when asked.
import { describe, expect, it } from 'vitest';
import type { SoundCue } from '../../../../src/themes/types';
import { STONETABLE_SOUNDS } from '../../../../src/themes/stonetable/sounds';

interface FakeNode {
  kind: string;
  connections: FakeNode[];
  started: number | null;
  stopped: number | null;
  peaks: number[];
}

function fakeAudio() {
  const nodes: FakeNode[] = [];
  const destination: FakeNode = { kind: 'destination', connections: [], started: null, stopped: null, peaks: [] };
  const node = (kind: string): FakeNode & Record<string, unknown> => {
    const n: FakeNode & Record<string, unknown> = {
      kind,
      connections: [],
      started: null,
      stopped: null,
      peaks: [],
      connect(to: FakeNode) {
        n.connections.push(to);
        return to;
      },
      disconnect() {
        n.connections = [];
      },
      start(t = 0) {
        n.started = t;
      },
      stop(t = 0) {
        n.stopped = t;
      },
    };
    const param = () => ({
      value: 0,
      setValueAtTime: (v: number) => n.peaks.push(v),
      exponentialRampToValueAtTime: (v: number) => n.peaks.push(v),
      linearRampToValueAtTime: (v: number) => n.peaks.push(v),
    });
    n.gain = param();
    n.frequency = param();
    n.Q = param();
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    destination,
    createBuffer: (_ch: number, length: number) => {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    },
    createBufferSource: () => node('source'),
    createBiquadFilter: () => node('filter'),
    createGain: () => node('gain'),
    createOscillator: () => node('oscillator'),
  };
  return { ctx: ctx as unknown as AudioContext, nodes, destination };
}

/** Whether `from` reaches `to` through connections. */
const reaches = (from: FakeNode, to: FakeNode): boolean => from === to || from.connections.some((c) => reaches(c, to));

const CUES: SoundCue[] = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick'];

describe('Stonetable sounds', () => {
  it('provides every cue and an ambience, on until the viewer turns it off', () => {
    for (const cue of CUES) expect(STONETABLE_SOUNDS[cue], cue).toBeDefined();
    expect(STONETABLE_SOUNDS.ambience).toBeDefined();
    expect(STONETABLE_SOUNDS.onByDefault).toBe(true);
  });

  it.each(CUES)('%s: every voice reaches the speakers, starts now and ends within two seconds', (cue) => {
    const { ctx, nodes, destination } = fakeAudio();
    STONETABLE_SOUNDS[cue]!.play(ctx, 1);
    const voices = nodes.filter((n) => n.kind === 'source' || n.kind === 'oscillator');
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(reaches(v, destination)).toBe(true);
      expect(v.started).toBeGreaterThanOrEqual(10);
      expect(v.stopped).not.toBeNull();
      expect(v.stopped! - 10).toBeLessThan(2);
    }
  });

  it.each(CUES)('%s: louder with more gain, silent-ish at none, never above unity', (cue) => {
    const peak = (gain: number) => {
      const { ctx, nodes } = fakeAudio();
      STONETABLE_SOUNDS[cue]!.play(ctx, gain);
      return Math.max(...nodes.filter((n) => n.kind === 'gain').flatMap((n) => n.peaks));
    };
    expect(peak(1)).toBeGreaterThan(peak(0.25));
    expect(peak(1)).toBeLessThanOrEqual(1);
    expect(peak(0)).toBeLessThan(0.001);
  });

  it('plays the same noise every time (seeded)', () => {
    const first = fakeAudio();
    STONETABLE_SOUNDS.slide!.play(first.ctx, 1);
    const second = fakeAudio();
    STONETABLE_SOUNDS.slide!.play(second.ctx, 1);
    const data = (a: ReturnType<typeof fakeAudio>) => Array.from(((a.nodes.find((n) => n.kind === 'source') as unknown as { buffer: { getChannelData(): Float32Array } }).buffer.getChannelData()).slice(0, 50));
    expect(data(first)).toEqual(data(second));
    expect(new Set(data(first)).size).toBeGreaterThan(10);
  });

  it('loops the torch crackle until stopped; stopping twice is harmless', () => {
    const { ctx, nodes, destination } = fakeAudio();
    const handle = STONETABLE_SOUNDS.ambience!.start(ctx, 0.5);
    const src = nodes.find((n) => n.kind === 'source')! as FakeNode & { loop?: boolean };
    expect(src.loop).toBe(true);
    expect(reaches(src, destination)).toBe(true);
    expect(src.stopped).toBeNull();
    handle.stop();
    expect(src.stopped).not.toBeNull();
    expect(reaches(src, destination)).toBe(false);
    expect(() => handle.stop()).not.toThrow();
  });
});
