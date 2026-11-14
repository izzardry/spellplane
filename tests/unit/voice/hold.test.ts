/**
 * PLAN Milestone 5, owner decisions, Talk key: "Ctrl, either key, instead of V. It never types into a note field.
 * Chords stay shortcuts: the mic and dictation open only after Ctrl has been held alone for about 200 ms. A key or
 * click during that time makes it a shortcut (Ctrl+Z, Ctrl+Enter, Ctrl+T, Ctrl+click), and no audio or caption is
 * sent." The pure hold-alone gate (voice/hold.ts; contract voice/types.ts HoldAloneGate).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHoldAloneGate } from '../../../src/voice/hold';
import { TALK_HOLD_ALONE_MS, type HoldAloneState } from '../../../src/voice/types';

describe('hold-alone gate', () => {
  it('is idle until the key goes down, pending while held alone, talking once 200 ms passed', () => {
    const g = createHoldAloneGate();
    expect(g.state()).toBe('idle');
    expect(g.tick(1000)).toBe('idle');
    expect(g.down(1000, false)).toBe('pending');
    expect(g.tick(1000 + TALK_HOLD_ALONE_MS - 1)).toBe('pending');
    expect(g.tick(1000 + TALK_HOLD_ALONE_MS)).toBe('talking');
    expect(g.team()).toBe(false);
    expect(g.up(1500)).toBe('idle');
  });

  it('uses the contract value of about 200 ms', () => {
    expect(TALK_HOLD_ALONE_MS).toBe(200);
  });

  it('a key or click during the hold time makes it a shortcut that never talks, until released', () => {
    const g = createHoldAloneGate();
    g.down(0, false);
    expect(g.other(50)).toBe('shortcut');
    expect(g.tick(10_000)).toBe('shortcut');
    expect(g.other(10_001)).toBe('shortcut');
    expect(g.up(10_002)).toBe('idle');
    // The next press starts over.
    expect(g.down(20_000, false)).toBe('pending');
    expect(g.tick(20_000 + TALK_HOLD_ALONE_MS)).toBe('talking');
  });

  it('a release before the hold time never talks, even without a tick in between', () => {
    const g = createHoldAloneGate();
    g.down(0, false);
    expect(g.up(150)).toBe('idle');
    expect(g.tick(400)).toBe('idle');
  });

  it('once talking, a later key does not snatch the mic shut', () => {
    const g = createHoldAloneGate();
    g.down(0, true);
    g.tick(250);
    expect(g.other(300)).toBe('talking');
    expect(g.team()).toBe(true);
  });

  it('a key that arrives after the hold time but before the timer ticked finds the mic due', () => {
    const g = createHoldAloneGate();
    g.down(0, false);
    expect(g.other(TALK_HOLD_ALONE_MS + 5)).toBe('talking');
  });

  it('a second down while held (key repeat, the other Ctrl key) changes nothing', () => {
    const g = createHoldAloneGate();
    g.down(0, true);
    expect(g.down(150, false)).toBe('pending');
    expect(g.tick(TALK_HOLD_ALONE_MS)).toBe('talking');
    expect(g.team()).toBe(true);
  });

  it('reset (blur, a text field took focus) returns to idle without talking', () => {
    const g = createHoldAloneGate();
    g.down(0, false);
    g.reset();
    expect(g.state()).toBe('idle');
    expect(g.tick(1000)).toBe('idle');
    g.down(2000, false);
    g.tick(2300);
    g.reset();
    expect(g.state()).toBe('idle');
  });

  it('takes a custom hold time; a nonsense one falls back to 200 ms', () => {
    const g = createHoldAloneGate(50);
    g.down(0, false);
    expect(g.tick(50)).toBe('talking');
    const bad = createHoldAloneGate(Number.NaN);
    bad.down(0, false);
    expect(bad.tick(199)).toBe('pending');
    expect(bad.tick(200)).toBe('talking');
  });

  it('property: talks exactly when the key was held alone for the hold time before any other key, click or release', () => {
    type Kind = 'other' | 'tick' | 'up';
    const ev = fc.record({ kind: fc.constantFrom<Kind>('other', 'tick', 'up'), dt: fc.integer({ min: 0, max: 150 }) });
    fc.assert(
      fc.property(fc.array(ev, { maxLength: 12 }), fc.boolean(), (events, team) => {
        const g = createHoldAloneGate();
        let t = 0;
        g.down(t, team);
        let model: HoldAloneState = 'pending';
        for (const e of events) {
          t += e.dt;
          const got = e.kind === 'other' ? g.other(t) : e.kind === 'up' ? g.up(t) : g.tick(t);
          if (e.kind === 'up') model = 'idle';
          else if (model === 'pending' && t >= TALK_HOLD_ALONE_MS) model = 'talking';
          else if (model === 'pending' && e.kind === 'other') model = 'shortcut';
          expect(got).toBe(model);
          if (model === 'idle') break;
        }
      }),
    );
  });
});
