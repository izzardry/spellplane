// PLAN Milestone 7, M7-P4 Card feel, sound: "every common move has a short animation and sound (draw, shuffle, tap and
// untap, play, to graveyard, attach, clip)"; "Each look has its sound cues (procedural/synthesised, no downloaded
// assets) at a modest volume, respecting the sound setting". The cues the log rings, the look's synthesised set played
// into a recording AudioContext stand-in (no Web Audio in Node), the fallback for older sets, the look's token gain,
// and the viewer's own pickup and snap from the table scene (util/feel.ts).
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { LogEntry } from '../../../src/core/types';
import { FEEL_CUES, type LookId, type SoundCue, type SoundSet } from '../../../src/themes/types';
import { LOOKS } from '../../../src/ui/design/tokens';
import { CUE_FALLBACK, SOUND_GAIN, ThemeSoundPlayer, cuesFor, type SoundContext } from '../../../src/ui/sound';
import { FEEL_MAX_S, FEEL_PEAK, LOOK_FEEL_SOUNDS } from '../../../src/ui/sound-feel';
import { feelCues, tableTheme } from '../../../src/util/feel';

const entry = (seq: number, action: Partial<Action> & { type: Action['type'] }, by = 's0'): LogEntry => ({ kind: 'action', seq, at: 0, action: { by, cid: `c${seq}`, seq, ...action } as Action });

/** A recording stand-in for the parts of an AudioContext the cues use. */
function recordingContext() {
  const params: { max: number; events: number }[] = [];
  const sources: { started: number; stopped: number }[] = [];
  let connectedToDestination = 0;
  const destination = { kind: 'destination' };
  const param = () => {
    const p = { max: 0, events: 0 };
    params.push(p);
    const rec = (v: number) => {
      p.events++;
      p.max = Math.max(p.max, v);
      return api;
    };
    const api = { value: 0, setValueAtTime: rec, linearRampToValueAtTime: rec, exponentialRampToValueAtTime: (v: number) => (v <= 0 ? (() => { throw new RangeError('exp ramp to 0'); })() : rec(v)), setTargetAtTime: rec };
    return api;
  };
  const node = () => ({
    connect(n: unknown) {
      if (n === destination) connectedToDestination++;
      return n;
    },
    disconnect() {},
  });
  const scheduled = () => {
    const s = { started: Number.NaN, stopped: Number.NaN };
    sources.push(s);
    return {
      ...node(),
      onended: null as null | (() => void),
      start(at: number) {
        s.started = at;
      },
      stop(at: number) {
        s.stopped = at;
      },
    };
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: () => ({ ...scheduled(), type: 'sine', frequency: param() }),
    createBufferSource: () => ({ ...scheduled(), buffer: null }),
    createBuffer: (_c: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { ctx: ctx as unknown as AudioContext, params, sources, destinations: () => connectedToDestination };
}

afterEach(() => tableTheme.set(null));

describe('the cues the log rings', () => {
  it('a draw, a play to the stack, a card to a graveyard or exile, into a hand, an untap, an attach and a clip ring their own cue', () => {
    expect(cuesFor([entry(1, { type: 'draw', instanceId: 'x' })], 's0')).toEqual(['draw']);
    expect(cuesFor([entry(1, { type: 'move', card: 'a', to: 'graveyard:s0' })], 's0')).toEqual(['toGraveyard']);
    expect(cuesFor([entry(1, { type: 'move', card: 'a', to: 'exile:s1' })], 's0')).toEqual(['toExile']);
    expect(cuesFor([entry(1, { type: 'move', card: 'a', to: 'stack' })], 's0')).toEqual(['play']);
    expect(cuesFor([entry(1, { type: 'toZone', card: 'a', to: 'hand:s0', position: 'any' })], 's0')).toEqual(['toHand']);
    expect(cuesFor([entry(1, { type: 'toZone', card: 'a', to: 'library:s0', position: 'top' })], 's0')).toEqual(['slide']);
    expect(cuesFor([entry(1, { type: 'tap', card: 'a', tapped: false })], 's0')).toEqual(['untap']);
    expect(cuesFor([entry(1, { type: 'attach', card: 'a', to: 'b' })], 's0')).toEqual(['attach']);
    expect(cuesFor([entry(1, { type: 'clipAdd', clip: 'k', cards: ['a', 'b'], anchor: { card: 'a', x: 0, y: 0 } })], 's0')).toEqual(['clip']);
    // A card moved on a battlefield still slides; a tap still taps (the sets of M4 keep sounding as before).
    expect(cuesFor([entry(1, { type: 'move', card: 'a', to: 'battlefield:s0' })], 's0')).toEqual(['slide']);
    expect(cuesFor([entry(1, { type: 'tap', card: 'a', tapped: true })], 's0')).toEqual(['tap']);
  });

  it('a burst (untap all, a mulligan) rings each cue once', () => {
    const log = [1, 2, 3, 4].map((i) => entry(i, { type: 'tap', card: `c${i}`, tapped: false }));
    expect(cuesFor(log, 's0')).toEqual(['untap']);
    const draws = [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i, { type: 'draw', instanceId: `l${i}` }));
    expect(cuesFor(draws, 's0')).toEqual(['draw']);
  });
});

describe('each look’s synthesised cues', () => {
  for (const look of ['kitchen', 'graphite', 'codex'] as LookId[]) {
    it(`${look}: every feel cue, quiet, from silence to silence, reaching the destination and done within ${FEEL_MAX_S} s`, () => {
      const set = LOOK_FEEL_SOUNDS[look];
      for (const cue of [...FEEL_CUES, 'slide', 'tap', 'shuffle'] as SoundCue[]) {
        const src = set[cue as keyof SoundSet] as { play(ctx: AudioContext, gain: number): void } | undefined;
        expect(src, `${look} ${cue}`).toBeTruthy();
        const rec = recordingContext();
        src!.play(rec.ctx, 1);
        expect(rec.destinations(), `${look} ${cue}`).toBe(1);
        expect(rec.sources.length, `${look} ${cue}`).toBeGreaterThan(0);
        for (const s of rec.sources) {
          expect(s.started).toBeGreaterThanOrEqual(0);
          expect(s.stopped - 0).toBeLessThanOrEqual(FEEL_MAX_S + 1e-9);
        }
        // The master gain is the gain passed in; every envelope peaks under FEEL_PEAK of it.
        const envelopes = rec.params.slice(1).filter((p) => p.events >= 3 && p.max <= 1);
        expect(envelopes.length).toBeGreaterThan(0);
        for (const p of envelopes) expect(p.max).toBeLessThanOrEqual(FEEL_PEAK + 1e-9);
      }
    });
  }

  it('the looks sound different (their own timbre), and a silent gain plays nothing', () => {
    expect(LOOK_FEEL_SOUNDS.kitchen.tap).not.toBe(LOOK_FEEL_SOUNDS.graphite.tap);
    const rec = recordingContext();
    LOOK_FEEL_SOUNDS.codex.draw!.play(rec.ctx, 0);
    expect(rec.sources).toEqual([]);
  });
});

describe('the player and the looks', () => {
  const fake = () => {
    const rec = recordingContext();
    return { rec, player: new ThemeSoundPlayer(() => rec.ctx as unknown as SoundContext) };
  };
  const recording = (cues: SoundCue[], log: string[]): SoundSet => Object.fromEntries(cues.map((c) => [c, { play: (_: AudioContext, g: number) => void log.push(`${c}@${g}`) }]));

  it('a look plays its own cues by default (its tokens: on), at its token gain under the ceiling', () => {
    const { rec, player } = fake();
    tableTheme.set('graphite');
    player.setTheme(undefined);
    expect(player.enabled()).toBe(true);
    player.unlock();
    player.play(['draw', 'untap']);
    expect(player.played).toEqual(['draw', 'untap']);
    // The master gain of each cue is the look's gain times the player's ceiling.
    const masters = rec.params.filter((p) => Math.abs(p.max - SOUND_GAIN * LOOKS.graphite.sound.gain) < 1e-9);
    expect(masters.length).toBe(2);
    player.dispose();
  });

  it("'off' plays nothing, before a gesture nothing plays, and an M4 theme without a set stays silent", () => {
    const { rec, player } = fake();
    tableTheme.set('kitchen');
    player.setTheme(undefined);
    player.play(['draw']);
    expect(rec.sources).toEqual([]);
    player.setMode('off');
    player.unlock();
    player.play(['draw']);
    expect(player.played).toEqual([]);
    player.setMode('theme');
    tableTheme.set('paper');
    player.unlock();
    player.play(['draw', 'tap']);
    expect(player.played).toEqual([]);
    player.dispose();
  });

  it("a theme's set wins cue by cue; a cue it lacks comes from the look, else from the plain cue it refines", () => {
    const { player } = fake();
    const log: string[] = [];
    // An M4-style set (slide and tap only), on a look's table: draw falls back to the look's draw.
    tableTheme.set('codex');
    player.setTheme({ ...recording(['slide', 'tap'], log), onByDefault: true });
    player.unlock();
    player.play(['slide', 'draw', 'tap']);
    expect(log.map((l) => l.split('@')[0])).toEqual(['slide', 'tap']);
    expect(player.played).toEqual(['slide', 'draw', 'tap']);
    // Off a look (an M4 theme): a draw plays the set's slide, an untap its tap; pickup has no plain cue and stays silent.
    tableTheme.set('dusk');
    log.length = 0;
    player.play(['draw', 'untap', 'pickup']);
    expect(log.map((l) => l.split('@')[0])).toEqual(['slide', 'tap']);
    expect(CUE_FALLBACK.draw).toBe('slide');
    expect(CUE_FALLBACK.untap).toBe('tap');
    player.dispose();
  });

  it("the viewer's own pickup and snap come from the table scene; nothing after dispose", () => {
    const { player } = fake();
    tableTheme.set('kitchen');
    player.unlock();
    feelCues.emit('pickup');
    feelCues.emit('snap');
    feelCues.emit('not-a-cue');
    expect(player.played).toEqual(['pickup', 'snap']);
    player.dispose();
    feelCues.emit('pickup');
    expect(player.played).toEqual(['pickup', 'snap']);
  });
});
