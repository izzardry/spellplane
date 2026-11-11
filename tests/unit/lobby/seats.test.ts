/**
 * Chair and seat-colour rules (DESIGN "Players, seats and formats", Seats: players click a chair and pick a seat
 * colour; seat colour is used for lines, pings, cursors, captions and log attribution, so colours stay apart;
 * Identity: a nickname plus a key pair that identifies the seat; "Specification: card data, packs and draft formats",
 * Evening stages: the host advances from the lobby; "Pre-game": Ready locks the deck).
 */
import { describe, expect, it } from 'vitest';
import {
  chairChoice,
  chairs,
  colourClash,
  colourTakenBy,
  firstFreeChair,
  freeColours,
  hostSeat,
  isOccupied,
  nicknameProblem,
  normaliseNickname,
  pickColour,
  readiness,
  seatOf,
  startProblem,
  viewRotation,
} from '../../../src/ui/lobby/seats';
import { act, freshTable, sit } from './helpers';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

describe('chairs', () => {
  it('a fresh table has only free chairs, even though seq-0 seats carry default colours', () => {
    const st = freshTable();
    expect(chairs(st, A).map((c) => [c.seat, c.occupied, c.name, c.mine])).toEqual([
      ['s0', false, '', false],
      ['s1', false, '', false],
    ]);
    expect(firstFreeChair(st)).toBe('s0');
    expect(freeColours(st, null)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('marks the chair this key pair holds as mine, and the next free chair is the lowest index', () => {
    const st = sit(freshTable('ffa3'), 's1', 'Ann', 4, A);
    const list = chairs(st, A);
    expect(list.find((c) => c.seat === 's1')).toMatchObject({ occupied: true, mine: true, name: 'Ann', colour: 4, peer: A });
    expect(chairs(st, B).find((c) => c.seat === 's1')?.mine).toBe(false);
    expect(seatOf(st, A)).toBe('s1');
    expect(seatOf(st, B)).toBeNull();
    expect(firstFreeChair(st)).toBe('s0');
  });

  it('a full table has no free chair', () => {
    const st = sit(sit(freshTable(), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B);
    expect(firstFreeChair(st)).toBeNull();
  });

  it('a chair left with seatLeave is free again (name cleared, peer dropped)', () => {
    let st = sit(freshTable(), 's0', 'Ann', 3, A);
    st = act(st, 's0', { type: 'seatLeave', seat: 's0' });
    expect(isOccupied(st, 's0')).toBe(false);
    expect(firstFreeChair(st)).toBe('s0');
    expect(colourTakenBy(st, 3, null)).toBeNull();
  });
});

describe('chair selection', () => {
  it('a free chair can be taken, a taken one cannot', () => {
    const st = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(chairChoice(st, 's1', B)).toEqual({ ok: true });
    expect(chairChoice(st, 's0', B)).toEqual({ ok: false, reason: 'Ann sits here.' });
    expect(chairChoice(st, 's0', A)).toEqual({ ok: true });
    expect(chairChoice(st, 's9', B).ok).toBe(false);
  });

  it('a player may move to another free chair before Ready, not after (the deck is committed to the chair)', () => {
    let st = sit(freshTable('ffa3'), 's0', 'Ann', 0, A);
    expect(chairChoice(st, 's2', A)).toEqual({ ok: true });
    st = act(st, 's0', { type: 'ready', commits: ['c1'], instanceIds: ['x1'], zone: 'library:s0' });
    expect(chairChoice(st, 's2', A)).toEqual({ ok: false, reason: 'You are ready; your deck is locked to your chair.' });
    // Staying put is still fine.
    expect(chairChoice(st, 's0', A)).toEqual({ ok: true });
  });

  it('no chair changes once the game has started', () => {
    let st = sit(freshTable('ffa3'), 's0', 'Ann', 0, A);
    st = act(st, 's0', { type: 'stageSet', stage: 'match' });
    expect(chairChoice(st, 's1', A)).toEqual({ ok: false, reason: 'The game has started.' });
  });
});

describe('seat colours (unique at a table, so cursors and lines stay apart)', () => {
  it('a colour another seated player uses is taken; the own colour is not taken for oneself', () => {
    const st = sit(sit(freshTable(), 's0', 'Ann', 2, A), 's1', 'Ben', 5, B);
    expect(colourTakenBy(st, 2, 's1')).toBe('s0');
    expect(colourTakenBy(st, 2, 's0')).toBeNull();
    expect(freeColours(st, 's1')).toEqual([0, 1, 3, 4, 5, 6, 7]);
    expect(freeColours(st, null)).toEqual([0, 1, 3, 4, 6, 7]);
  });

  it('keeps the preferred colour when free, else falls back to the lowest free one', () => {
    const st = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(pickColour(st, 's1', 6)).toBe(6);
    expect(pickColour(st, 's1', 0)).toBe(1);
    expect(pickColour(st, 's0', 0)).toBe(0);
  });

  it('a player moving to another chair keeps their colour (their old chair does not count as using it)', () => {
    const st = sit(sit(freshTable('ffa3'), 's0', 'Ann', 3, A), 's2', 'Cat', 5, C);
    expect(pickColour(st, 's1', 3)).toBe(0);
    expect(pickColour(st, 's1', 3, 's0')).toBe(3);
    // Another player's colour is still taken while moving.
    expect(pickColour(st, 's1', 5, 's0')).toBe(0);
    expect(freeColours(st, 's1', 's0')).toEqual([0, 1, 2, 3, 4, 6, 7]);
  });

  it('treats an out-of-range preference as colour 0', () => {
    const st = freshTable();
    expect(pickColour(st, 's0', 9)).toBe(0);
    expect(pickColour(st, 's0', -1)).toBe(0);
    expect(pickColour(st, 's0', 1.5)).toBe(0);
  });

  it('two players who picked the same colour at once: the higher chair gives way to the lowest free colour', () => {
    const st = sit(sit(sit(freshTable('ffa3'), 's0', 'Ann', 3, A), 's1', 'Ben', 0, B), 's2', 'Cat', 3, C);
    expect(colourClash(st, 's0')).toBeNull();
    expect(colourClash(st, 's2')).toBe(1);
    expect(colourClash(st, 's1')).toBeNull();
  });

  it('free chairs never clash (their stored colours are seq-0 defaults)', () => {
    const st = sit(freshTable(), 's1', 'Ben', 0, B);
    expect(colourClash(st, 's1')).toBeNull();
    expect(colourClash(st, 's0')).toBeNull();
  });
});

describe('nicknames', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(normaliseNickname('  Ann \t  Lee\n')).toBe('Ann Lee');
    expect(normaliseNickname('A\u0000n\u0007n')).toBe('Ann');
  });

  it('needs one to 24 characters', () => {
    expect(nicknameProblem('')).toBe('Enter a nickname.');
    expect(nicknameProblem('   ')).toBe('Enter a nickname.');
    expect(nicknameProblem('x'.repeat(24))).toBeNull();
    expect(nicknameProblem('x'.repeat(25))).toBe('Use at most 24 characters.');
    // Counted in characters, not UTF-16 units.
    expect(nicknameProblem('🦊'.repeat(24))).toBeNull();
  });
});

describe('readiness, host and start', () => {
  it('counts seated players and how many are ready', () => {
    let st = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(readiness(st)).toEqual({ seated: 1, ready: 0, allReady: false });
    st = act(st, 's0', { type: 'ready', commits: ['c1'], instanceIds: ['x1'], zone: 'library:s0' });
    expect(readiness(st)).toEqual({ seated: 1, ready: 1, allReady: true });
  });

  it('the host is the present seated player with the lowest index (the sequencer rule)', () => {
    const st = sit(sit(freshTable(), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B);
    expect(hostSeat(st, () => true)).toBe('s0');
    expect(hostSeat(st, (s) => s !== 's0')).toBe('s1');
    // An away seat (set by the sequencer's `away` action, reducer M1-P7) is not the host.
    const away = structuredClone(st);
    away.seats.s0!.away = true;
    expect(hostSeat(away, () => true)).toBe('s1');
    expect(hostSeat(freshTable(), () => true)).toBeNull();
  });

  it('the host starts once every chair is taken and everyone is ready; others wait for the host', () => {
    let st = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(startProblem(st, 's0', 's0')).toBe('Waiting for one more player.');
    st = sit(st, 's1', 'Ben', 1, B);
    expect(startProblem(st, 's0', 's0')).toBe('Waiting for everyone to press Ready.');
    st = act(st, 's0', { type: 'ready', commits: ['c1'], instanceIds: ['x1'], zone: 'library:s0' });
    expect(startProblem(st, 's0', 's0')).toBe('Waiting for everyone to press Ready.');
    st = act(st, 's1', { type: 'ready', commits: ['c2'], instanceIds: ['x2'], zone: 'library:s1' });
    expect(startProblem(st, 's0', 's0')).toBeNull();
    expect(startProblem(st, 's1', 's0')).toBe('Waiting for Ann to start the game.');
    st = act(st, 's0', { type: 'stageSet', stage: 'match' });
    expect(startProblem(st, 's0', 's0')).toBe('The game has started.');
  });

  it('counts the missing players of a larger table', () => {
    const st = sit(freshTable('ffa4'), 's0', 'Ann', 0, A);
    expect(startProblem(st, 's0', 's0')).toBe('Waiting for 3 more players.');
  });
});

describe('view rotation (every viewer sees their own seat at the bottom)', () => {
  it('turns the seat angle back to 0', () => {
    expect(viewRotation(0)).toBe(0);
    expect(viewRotation(180)).toBe(180);
    expect(viewRotation(90)).toBe(270);
    expect(viewRotation(null)).toBe(0);
  });
});
