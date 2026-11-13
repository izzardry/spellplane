// The theme's sound set, played (DESIGN "Themes and rendering", What a theme package contains: Sound, "off by default in
// Paper"; theme table, Dusk: "muted ambience"; Settings.sound 'theme' | 'on' | 'off').
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { LogEntry } from '../../../src/core/types';
import type { SoundCue, SoundSet } from '../../../src/themes/types';
import { DUSK_SOUNDS } from '../../../src/themes/dusk/sounds';
import { paper } from '../../../src/themes/paper/index';
import { cuesFor, soundModeOf, soundOn, ThemeSoundPlayer, type SoundContext } from '../../../src/ui/sound';

const entry = (seq: number, action: Partial<Action> & { type: Action['type'] }, by = 's0'): LogEntry => ({ kind: 'action', seq, at: 0, action: { by, cid: `c${seq}`, seq, ...action } as Action });

function fakeContext() {
  const ctx = { state: 'suspended' as AudioContextState, resumed: 0, closed: 0 };
  const api = {
    get state() {
      return ctx.state;
    },
    resume: () => {
      ctx.resumed++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    close: () => {
      ctx.closed++;
      ctx.state = 'closed';
      return Promise.resolve();
    },
  };
  return { ctx, audio: api as unknown as SoundContext };
}

function recordingSet(onByDefault: boolean): { set: SoundSet; log: string[] } {
  const log: string[] = [];
  const cue = (c: SoundCue) => ({ play: (_: AudioContext, gain: number) => void log.push(`${c}@${gain}`) });
  return {
    log,
    set: {
      slide: cue('slide'),
      tap: cue('tap'),
      shuffle: cue('shuffle'),
      turnChime: cue('turnChime'),
      promptTick: cue('promptTick'),
      ambience: {
        start: () => {
          log.push('ambience:start');
          return { stop: () => void log.push('ambience:stop') };
        },
      },
      onByDefault,
    },
  };
}

describe('which sets play', () => {
  it("'theme' plays a set the theme turns on, 'on' any set, 'off' none; Paper has none", () => {
    expect(paper.sounds).toBeUndefined();
    expect(soundOn(paper.sounds, 'on')).toBe(false);
    expect(soundOn(DUSK_SOUNDS, 'theme')).toBe(true);
    expect(soundOn({ ...DUSK_SOUNDS, onByDefault: false }, 'theme')).toBe(false);
    expect(soundOn({ ...DUSK_SOUNDS, onByDefault: false }, 'on')).toBe(true);
    expect(soundOn(DUSK_SOUNDS, 'off')).toBe(false);
    expect(soundModeOf('off')).toBe('off');
    expect(soundModeOf('loud')).toBe('theme');
  });
});

describe('cues from the log', () => {
  it('maps moves, taps, shuffles, the turn and another seat asking; one of each per batch, in a fixed order', () => {
    const log = [
      entry(1, { type: 'move', card: 'a', to: 'battlefield:s0' }),
      entry(2, { type: 'move', card: 'b', to: 'battlefield:s0' }),
      entry(3, { type: 'tap', card: 'a', tapped: true }),
      entry(4, { type: 'shuffleDone', sid: 'x', orderHash: 'h' }),
      entry(5, { type: 'turnPass', to: 's1' }),
      entry(6, { type: 'ask', round: 'r' }, 's1'),
      entry(7, { type: 'life', seat: 's0', delta: -2 }),
    ];
    expect(cuesFor(log, 's0')).toEqual(['turnChime', 'promptTick', 'shuffle', 'slide', 'tap']);
    // The viewer's own ask rings no prompt tick; system lines and other actions ring nothing.
    expect(cuesFor([entry(1, { type: 'ask', round: 'r' }, 's0')], 's0')).toEqual([]);
    expect(cuesFor([{ kind: 'system', seq: 1, at: 0, level: 'info', text: 'x' }, entry(2, { type: 'life', seat: 's0', delta: 1 })], 's0')).toEqual([]);
  });
});

describe('the player', () => {
  it('stays silent until a gesture, then plays cues and the room tone; a theme switch stops the old room tone', () => {
    const { ctx, audio } = fakeContext();
    const a = recordingSet(true);
    const b = recordingSet(true);
    let made = 0;
    const p = new ThemeSoundPlayer(() => (made++, audio), 0.5);
    p.setTheme(a.set);
    p.play(['tap']);
    expect(a.log).toEqual([]);
    expect(made).toBe(0);
    p.unlock();
    expect(made).toBe(1);
    expect(ctx.resumed).toBe(1);
    expect(a.log).toEqual(['ambience:start']);
    p.play(['slide', 'tap']);
    expect(a.log).toEqual(['ambience:start', 'slide@0.5', 'tap@0.5']);
    expect(p.played).toEqual(['slide', 'tap']);
    p.setTheme(b.set);
    expect(a.log.at(-1)).toBe('ambience:stop');
    expect(b.log).toEqual(['ambience:start']);
    p.unlock();
    expect(made).toBe(1);
    p.dispose();
    expect(b.log.at(-1)).toBe('ambience:stop');
    expect(ctx.closed).toBe(1);
    p.play(['tap']);
    expect(b.log).not.toContain('tap@0.5');
  });

  it("'off' stops the room tone and plays nothing; a set off by default waits for 'on'; no set never makes a context", () => {
    const { audio } = fakeContext();
    const quiet = recordingSet(false);
    let made = 0;
    const p = new ThemeSoundPlayer(() => (made++, audio));
    p.setTheme(undefined);
    p.unlock();
    expect(made).toBe(0);
    p.setTheme(quiet.set);
    p.unlock();
    p.play(['tap']);
    expect(made).toBe(0);
    expect(quiet.log).toEqual([]);
    p.setMode('on');
    p.unlock();
    p.play(['tap']);
    expect(quiet.log).toEqual(['ambience:start', 'tap@0.8']);
    p.setMode('off');
    expect(quiet.log.at(-1)).toBe('ambience:stop');
    p.play(['tap']);
    expect(quiet.log.filter((l) => l.startsWith('tap'))).toHaveLength(1);
  });

  it('a failing cue or room tone stays silent and never throws', () => {
    const { audio } = fakeContext();
    const p = new ThemeSoundPlayer(() => audio);
    p.setTheme({
      tap: { play: () => { throw new Error('boom'); } },
      ambience: { start: () => { throw new Error('boom'); } },
      onByDefault: true,
    });
    expect(() => p.unlock()).not.toThrow();
    expect(() => p.play(['tap'])).not.toThrow();
    expect(p.ambient()).toBe(false);
    expect(p.played).toEqual([]);
  });

  it('without Web Audio nothing plays and nothing throws', () => {
    const p = new ThemeSoundPlayer(() => null);
    p.setTheme(DUSK_SOUNDS);
    expect(() => p.unlock()).not.toThrow();
    expect(() => p.play(['tap'])).not.toThrow();
    expect(p.played).toEqual([]);
  });
});
