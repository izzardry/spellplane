// m7-adjustments.md, M7-P4 change 2 (now M7-P5): "One shared AudioContext, created on the first gesture, suspended when
// the table is disposed, counted in RenderMemory.audioContexts"; contracts.md Part C: on Home every count is 0. And the
// 'matchFound' cue (SoundCue; visual.md 2.3): one short chime synthesised in ui/sound.ts, scheduled on a fake context.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundSet } from '../../../src/themes/types';
import { MATCH_FOUND_CHIME, ThemeSoundPlayer, pageAudioContext, playMatchFound, setPageAudioFactoryForTests, type SoundContext } from '../../../src/ui/sound';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { feelCues, tableTheme } from '../../../src/util/feel';

/** A fake context that records its state changes and the sources scheduled on it. */
function fakeContext() {
  const calls: string[] = [];
  const started: { freq: number; at: number; stop: number }[] = [];
  const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: (v: number) => { if (v <= 0) throw new RangeError('exp ramp to 0'); } });
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    state: 'running' as AudioContextState,
    destination: {},
    createGain: () => ({ gain: param(), connect: () => undefined, disconnect: () => undefined }),
    createOscillator: () => {
      const rec = { freq: 0, at: Number.NaN, stop: Number.NaN };
      return {
        type: 'sine',
        frequency: { ...param(), setValueAtTime: (f: number) => void (rec.freq = f) },
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null,
        start: (at: number) => {
          rec.at = at;
          started.push(rec);
        },
        stop: (at: number) => void (rec.stop = at),
      };
    },
    resume() {
      calls.push('resume');
      ctx.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      calls.push('suspend');
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      calls.push('close');
      ctx.state = 'closed';
      return Promise.resolve();
    },
  };
  return { ctx: ctx as unknown as SoundContext, raw: ctx, calls, started };
}

let made: ReturnType<typeof fakeContext>[] = [];
beforeEach(() => {
  resetLifecycleForTests();
  made = [];
  setPageAudioFactoryForTests(() => {
    const f = fakeContext();
    made.push(f);
    return f.ctx;
  });
  tableTheme.set('graphite');
});
afterEach(() => tableTheme.set(null));

describe('one audio context for the page', () => {
  it('two tables mounted one after the other share one context; it is counted while a table holds it and suspended, not closed, after dispose', () => {
    const a = new ThemeSoundPlayer();
    expect(live().audioContexts).toBe(0);
    a.unlock();
    expect(made).toHaveLength(1);
    expect(live().audioContexts).toBe(1);
    a.dispose();
    expect(live().audioContexts).toBe(0);
    expect(made[0]!.calls).toEqual(['suspend']);
    expect(made[0]!.raw.state).toBe('suspended');

    const b = new ThemeSoundPlayer();
    b.unlock();
    expect(made).toHaveLength(1);
    expect(made[0]!.raw.state).toBe('running');
    expect(live().audioContexts).toBe(1);
    b.dispose();
    expect(live().audioContexts).toBe(0);
    expect(made[0]!.calls).not.toContain('close');
  });

  it('a table disposed while its first resume is still pending (the context still reads suspended) suspends it anyway', () => {
    const p = new ThemeSoundPlayer();
    p.unlock();
    // As in WebKit: the resume the press asked for has not taken effect yet.
    made[0]!.raw.state = 'suspended';
    made[0]!.calls.length = 0;
    p.dispose();
    expect(made[0]!.calls).toEqual(['suspend']);
    expect(live().audioContexts).toBe(0);
  });

  it('two tables alive at once hold the one context together: the first to leave neither uncounts nor suspends it', () => {
    const a = new ThemeSoundPlayer();
    const b = new ThemeSoundPlayer();
    a.unlock();
    b.unlock();
    expect(made).toHaveLength(1);
    expect(live().audioContexts).toBe(1);
    made[0]!.calls.length = 0;
    a.dispose();
    expect(live().audioContexts).toBe(1);
    expect(made[0]!.calls).toEqual([]);
    expect(made[0]!.raw.state).toBe('running');
    b.dispose();
    expect(live().audioContexts).toBe(0);
    expect(made[0]!.calls).toEqual(['suspend']);
  });

  it('with two tables alive, a feel cue from the scene plays once (on the newest), then on the one left', () => {
    const a = new ThemeSoundPlayer();
    const b = new ThemeSoundPlayer();
    a.unlock();
    b.unlock();
    const playA = vi.spyOn(a, 'play');
    const playB = vi.spyOn(b, 'play');
    feelCues.emit('pickup');
    expect(playA).not.toHaveBeenCalled();
    expect(playB.mock.calls).toEqual([[['pickup']]]);
    b.dispose();
    feelCues.emit('snap');
    expect(playA.mock.calls).toEqual([[['snap']]]);
    a.dispose();
  });

  it('a table that never had a gesture makes no context and counts none', () => {
    const p = new ThemeSoundPlayer();
    p.dispose();
    expect(made).toHaveLength(0);
    expect(live().audioContexts).toBe(0);
  });

  it('a closed page context is replaced by a new one', () => {
    const ctx = pageAudioContext();
    void ctx?.close();
    expect(pageAudioContext()).not.toBe(ctx);
    expect(made).toHaveLength(2);
  });
});

describe('the matchFound cue', () => {
  it('schedules one short chime of two rising notes on the context, ending within 0.6 s', () => {
    const f = fakeContext();
    MATCH_FOUND_CHIME.play(f.ctx, 0.8);
    expect(f.started).toHaveLength(2);
    expect(f.started[0]!.freq).toBeLessThan(f.started[1]!.freq);
    for (const s of f.started) {
      expect(s.at).toBeGreaterThanOrEqual(10);
      expect(s.stop - 10).toBeLessThanOrEqual(0.6);
    }
  });

  it('plays on the page context outside a table, and nothing when sound is off', () => {
    expect(playMatchFound('off')).toBe(false);
    expect(made).toHaveLength(0);
    expect(playMatchFound('theme')).toBe(true);
    expect(made[0]!.started).toHaveLength(2);
    // Home holds no table: the page context is not counted.
    expect(live().audioContexts).toBe(0);
  });

  it('outside a table, the page context is suspended again once the chime is over; a table holding it keeps it running', () => {
    vi.useFakeTimers();
    try {
      expect(playMatchFound('theme')).toBe(true);
      expect(made[0]!.raw.state).toBe('running');
      vi.advanceTimersByTime(1000);
      expect(made[0]!.raw.state).toBe('suspended');
      // A table holding the context: the chime leaves it running.
      const p = new ThemeSoundPlayer();
      p.unlock();
      expect(playMatchFound('theme')).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(made[0]!.raw.state).toBe('running');
      // A table entered right after a chime outside one cancels the pending suspend.
      p.dispose();
      expect(playMatchFound('theme')).toBe(true);
      const q = new ThemeSoundPlayer();
      q.unlock();
      vi.advanceTimersByTime(1000);
      expect(made[0]!.raw.state).toBe('running');
      q.dispose();
      expect(made).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a theme's own matchFound wins; a table's player plays the chime through its context", () => {
    const log: string[] = [];
    const set: SoundSet = { onByDefault: true, matchFound: { play: () => void log.push('theme') } };
    expect(playMatchFound('on', set)).toBe(true);
    expect(log).toEqual(['theme']);
    const p = new ThemeSoundPlayer();
    p.unlock();
    p.play(['matchFound']);
    expect(p.played).toEqual(['matchFound']);
    p.dispose();
  });
});
