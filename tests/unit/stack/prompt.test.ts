/**
 * The confirmation prompt's model and countdown (PLAN M1-P3; DESIGN "Turn flow and confirmation", Confirmation rounds
 * 2-5: who sees the prompt, OK and Hold, a draining ring; "Specification: network protocol and secrecy", Timers: each
 * client animates its own countdown from the moment it applied the action).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import { createTable } from '../../../src/core/reducer';
import { Countdown, promptModel, roundWhat } from '../../../src/ui/confirm/model';
import { promptShowing, roundPassed } from '../../../src/ui/commands';
import { P, TEST_GAME, act, ok, play, readyTable } from '../core/helpers';

const seqd = (s: TableState, a: Action): TableState => ok(s, { ...a, seq: s.seq + 1 } as Action);
const names = (s: string) => ({ a00: 'Test Bear', a01: 'Spark Jolt' })[s] ?? s;

function three(): TableState {
  let s = readyTable(3, 'ffa3', 3);
  s = play(s, 'a00', P(-100, -300));
  return ok(s, act('reveal', { instanceId: 'a01', ref: { sid: 'sid-a01' }, salt: 'x' }));
}

describe('who sees what', () => {
  it('the asker watches; every other seat answers until it passed; the holder holds', () => {
    let s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    expect(promptModel(s, 's0')).toMatchObject({ mode: 'watching', waitingOn: ['s1', 's2'], allPassed: false, timerRunning: true, item: { id: 'i1' } });
    expect(promptModel(s, 's1')?.mode).toBe('respond');
    expect(promptShowing(s, 's1')).toBe(true);
    expect(promptShowing(s, 's0')).toBe(false);
    s = seqd(s, act('respond', { round: 'r1', seat: 's1', response: 'ok' }, 's1'));
    expect(promptModel(s, 's1')?.mode).toBe('watching');
    expect(promptShowing(s, 's1')).toBe(false);
    s = seqd(s, act('respond', { round: 'r1', seat: 's2', response: 'hold' }, 's2'));
    expect(promptModel(s, 's2')).toMatchObject({ mode: 'holding', holder: 's2', timerRunning: false });
    expect(promptShowing(s, 's2')).toBe(true);
    expect(promptModel(s, 's0')).toMatchObject({ mode: 'watching', holder: 's2', waitingOn: ['s2'] });
    s = seqd(s, act('respond', { round: 'r1', seat: 's2', response: 'release' }, 's2'));
    expect(promptModel(s, 's0')).toMatchObject({ allPassed: true, timerRunning: false, waitingOn: [] });
    expect(roundPassed(s)).toBe(true);
  });

  it('a spectator (no seat) only watches', () => {
    const s = seqd(three(), act('ask', { round: 'k1' }));
    expect(promptModel(s, null)?.mode).toBe('watching');
  });

  it('no round, no prompt', () => {
    expect(promptModel(three(), 's0')).toBeNull();
  });

  it('a solo table\'s empty chair is never waited for, so Resolve needs no second press', () => {
    let s = createTable({ game: TEST_GAME, format: '1v1', seats: [{ name: 'Anna', colour: 0 }, { name: '', colour: 1 }] });
    s = ok(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(0, -200), label: 'Clue' }));
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'ability', source: 't1', round: 'r1' }));
    expect(roundPassed(s)).toBe(true);
    expect(promptShowing(s, 's1')).toBe(false);
    expect(promptModel(s, 's0')).toMatchObject({ participants: [], allPassed: true, timerRunning: false });
  });

  it('says what the round is about', () => {
    let s = three();
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('cast Spark Jolt');
    s = seqd(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00', round: 'r2' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('activated an ability of Test Bear');
    s = seqd(s, act('stackPush', { item: 'i3', kind: 'trigger', source: 'a00', round: 'r3' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('put a trigger of Test Bear on the stack');
    s = seqd(s, act('stackPush', { item: 'i4', kind: 'copy', copyOf: 'i1', round: 'r4' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('copied Spark Jolt');
    s = seqd(s, act('ask', { round: 'k1', label: 'attacks?' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('asks “attacks?”');
    s = seqd(s, act('ask', { round: 'k2' }));
    expect(roundWhat(s, s.confirm!, names)).toBe('asks for responses');
  });
});

describe('the countdown (each client animates its own)', () => {
  it('drains from the moment this client saw the round start, over durationMs', () => {
    const s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    const c = new Countdown();
    c.observe(promptModel(s, 's1'), 1000);
    expect(c.fraction(1000)).toBe(1);
    expect(c.seconds(1000)).toBe(5);
    expect(c.fraction(3500)).toBeCloseTo(0.5);
    expect(c.seconds(3500)).toBe(3);
    expect(c.fraction(7000)).toBe(0);
    // Observing the same round again (another action applied) does not restart it.
    c.observe(promptModel(s, 's1'), 2000);
    expect(c.fraction(3500)).toBeCloseTo(0.5);
  });

  it('a hold freezes it where it stood; a release restarts it full', () => {
    let s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    const c = new Countdown();
    c.observe(promptModel(s, 's0'), 0);
    s = seqd(s, act('respond', { round: 'r1', seat: 's1', response: 'hold' }, 's1'));
    c.observe(promptModel(s, 's0'), 2000);
    expect(c.fraction(2000)).toBeCloseTo(0.6);
    expect(c.fraction(60_000)).toBeCloseTo(0.6);
    s = seqd(s, act('respond', { round: 'r1', seat: 's1', response: 'release' }, 's1'));
    c.observe(promptModel(s, 's0'), 61_000);
    expect(c.fraction(61_000)).toBe(1);
    expect(c.fraction(63_500)).toBeCloseTo(0.5);
  });

  it('a hold that lapses (its seat went away) lets the countdown continue from where it stood', () => {
    let s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    const c = new Countdown();
    c.observe(promptModel(s, 's0'), 0);
    s = seqd(s, act('respond', { round: 'r1', seat: 's1', response: 'hold' }, 's1'));
    c.observe(promptModel(s, 's0'), 1000);
    s = { ...s, seats: { ...s.seats, s1: { ...s.seats.s1!, away: true } } };
    c.observe(promptModel(s, 's0'), 9000);
    expect(c.fraction(9000)).toBeCloseTo(0.8);
    expect(c.fraction(10_000)).toBeCloseTo(0.6);
  });

  it('a new round restarts it', () => {
    let s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    const c = new Countdown();
    c.observe(promptModel(s, 's1'), 0);
    s = seqd(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00', round: 'r2' }));
    c.observe(promptModel(s, 's1'), 4000);
    expect(c.fraction(4000)).toBe(1);
  });
});
