/**
 * PLAN M5-P6 undo edge cases, the pure part (core/undo.ts): what an action changed (`changedObjects`), whether another
 * seat built on it since (`builtOn`), and the undo stack a stored log leaves (`undoStackFromLog`, undo after a reload).
 * DESIGN "Turn flow and confirmation", Undo: own most recent actions, one at a time; undoing a draw puts the card back
 * on top of the library; shuffles, reveals, dice and coin results cannot be undone; no table-wide rewind.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { builtOn, changedObjects, inverse, undoKey, undoStackFromLog } from '../../../src/core/undo';
import { act, ok, P, play, readyTable } from '../core/helpers';

/** Sequence `actions` onto `start`, stamping seqs; returns the log and the end state. */
function sequence(start: TableState, actions: readonly Action[]): { log: Action[]; end: TableState } {
  let s = start;
  const log: Action[] = [];
  for (const a of actions) {
    const stamped = { ...a, seq: s.seq + 1 } as Action;
    s = ok(s, stamped);
    log.push(stamped);
  }
  return { log, end: s };
}

/** A two-seat table, ten hidden library cards each, two public cards on s0's battlefield and one on s1's. */
function base(): TableState {
  let s = readyTable(10);
  s = play(s, 'a00', P(0, -200));
  s = play(s, 'a01', P(70, -200));
  s = play(s, 'b00', P(0, 200), 's1');
  return s;
}

describe('changedObjects', () => {
  it('names the cards, lines and stack items an action changed, and the turn marker', () => {
    const s = base();
    const tap = ok(s, act('tap', { card: 'a00', tapped: true }));
    expect(changedObjects(s, tap)).toEqual(['card:a00']);
    const line = ok(s, act('lineAdd', { line: 'L1', kind: 'target', from: { kind: 'card', id: 'a00' }, to: { kind: 'card', id: 'b00' } }));
    expect(changedObjects(s, line)).toEqual(['card:a00', 'card:b00', 'line:L1']);
    const turn = ok(s, act('phaseSet', { phase: 'combat' }));
    expect(changedObjects(s, turn)).toEqual(['turn']);
  });

  it('leaves out life, player counters and zone order: a delta on them composes with an undo', () => {
    const s = base();
    expect(changedObjects(s, ok(s, act('life', { seat: 's0', delta: -3 }, 's1')))).toEqual([]);
    expect(changedObjects(s, ok(s, act('playerCounter', { seat: 's0', kind: 'poison', delta: 1 }, 's1')))).toEqual([]);
    expect(changedObjects(s, s)).toEqual([]);
  });
});

describe('builtOn', () => {
  it('finds the first later change of another seat to something the undone action changed', () => {
    const entry = { seq: 10, changed: ['card:a', 'line:L'] };
    expect(builtOn(entry, [{ seq: 9, by: 's1', changed: ['card:a'] }])).toBeNull();
    expect(builtOn(entry, [{ seq: 11, by: 's1', changed: ['card:b'] }])).toBeNull();
    expect(builtOn(entry, [{ seq: 11, by: 's1', changed: ['card:b'] }, { seq: 12, by: 's2', changed: ['line:L'] }])).toEqual({ seq: 12, by: 's2', changed: ['line:L'], object: 'line:L' });
  });

  it('a pending action (no seq yet) or one that changed nothing cannot have been built on', () => {
    expect(builtOn({ changed: ['card:a'] }, [{ seq: 1, by: 's1', changed: ['card:a'] }])).toBeNull();
    expect(builtOn({ seq: 0, changed: [] }, [{ seq: 1, by: 's1', changed: ['card:a'] }])).toBeNull();
  });
});

describe('undoStackFromLog: the undo stack after a reload', () => {
  it('holds the own undoable actions in order, each with the inverse planned on the state right before it', () => {
    const start = base();
    const { log, end } = sequence(start, [
      act('tap', { card: 'a00', tapped: true }),
      act('tap', { card: 'b00', tapped: true }, 's1'),
      act('move', { card: 'a01', to: 'battlefield:s0', pose: P(300, -100) }),
      act('draw', { instanceId: end0(start) }),
    ]);
    const { stack, others } = undoStackFromLog(start, log, 's0');
    expect(stack.map((e) => e.cid)).toEqual([log[0]!.cid, log[2]!.cid, log[3]!.cid]);
    expect(stack.map((e) => e.seq)).toEqual([log[0]!.seq, log[2]!.seq, log[3]!.seq]);
    expect(stack[2]!.drew).toBe(end0(start));
    // The other seat's tap is recorded as a change of its card.
    expect(others).toEqual([{ seq: log[1]!.seq, by: 's1', changed: ['card:b00'] }]);
    // Each inverse, applied from the top down, restores the start (seq aside).
    let s = end;
    for (const e of [...stack].reverse()) s = ok(s, { type: 'undo', by: 's0', cid: `u-${e.cid}`, of: e.cid, inverse: e.inverse, seq: s.seq + 1 } as Action);
    const expected = ok(start, { ...log[1]!, seq: start.seq + 1 } as Action);
    expect(undoKey(s)).toBe(undoKey(expected));
  });

  it('matches the inverse the live session plans at proposal time', () => {
    const start = base();
    const a = act('move', { card: 'a00', to: 'graveyard:s0' });
    const { log } = sequence(start, [a]);
    expect(undoStackFromLog(start, log, 's0').stack[0]!.inverse).toEqual(inverse(start, a));
  });

  it('drops the steps the player already undid', () => {
    const start = base();
    const t1 = act('tap', { card: 'a00', tapped: true });
    const t2 = act('tap', { card: 'a01', tapped: true });
    const s1 = reduce(reduce(start, { ...t1, seq: start.seq + 1 } as Action), { ...t2, seq: start.seq + 2 } as Action);
    const u = { type: 'undo', by: 's0', cid: 'u2', of: t2.cid, inverse: inverse(reduce(start, { ...t1, seq: start.seq + 1 } as Action), t2)! } as Action;
    const { log } = sequence(start, [t1, t2, u]);
    expect(s1.seq).toBe(start.seq + 2);
    expect(undoStackFromLog(start, log, 's0').stack.map((e) => e.cid)).toEqual([t1.cid]);
  });

  it('nothing from before an own shuffle, mulligan or Ready comes back; the mulligan’s draws stay off too', () => {
    const start = base();
    const tap = act('tap', { card: 'a00', tapped: true });
    const commit = act('shuffleCommit', { sid: 'sh1', zone: 'library:s0', h: 'h' });
    const { log } = sequence(start, [tap, commit]);
    expect(undoStackFromLog(start, log, 's0').stack).toEqual([]);
    // Another seat's shuffle is no barrier for this seat.
    const theirs = act('shuffleCommit', { sid: 'sh2', zone: 'library:s1', h: 'h' }, 's1');
    expect(undoStackFromLog(start, sequence(start, [tap, theirs]).log, 's0').stack.map((e) => e.cid)).toEqual([tap.cid]);
    // A mulligan's draws (one group) are part of it; a later draw of the player is a step again.
    const mull = act('mulligan', { count: 1 });
    const lib = start.zones['library:s0']!.ids;
    const d1 = act('draw', { instanceId: lib[0]!, group: 'gm' });
    const d2 = act('draw', { instanceId: lib[1]!, group: 'gm' });
    const d3 = act('draw', { instanceId: lib[2]! });
    const { log: l2 } = sequence(start, [tap, mull, d1, d2, d3]);
    expect(undoStackFromLog(start, l2, 's0').stack.map((e) => e.cid)).toEqual([d3.cid]);
  });

  it('a whole-zone private reorder clears the stack on the solo table only (its shuffle); in a networked log it is a scry', () => {
    const start = base();
    const tap = act('tap', { card: 'a00', tapped: true });
    const all = act('reorder', { zone: 'library:s0', count: start.zones['library:s0']!.ids.length, orderHash: 'h' });
    const log = stamped(start, [tap, all]);
    expect(undoStackFromLog(start, log, 's0').stack.map((e) => e.cid)).toEqual([tap.cid]);
    expect(undoStackFromLog(start, log, 's0', { soloShuffles: true }).stack).toEqual([]);
  });

  it('a recovery’s draws stay off the stack however many groups its retries took, until the agreed hand is drawn', () => {
    const start = base();
    const lib = start.zones['library:s0']!.ids;
    const tap = act('tap', { card: 'a00', tapped: true });
    // The recovery's own actions only need to be in the log (a reload replays the stored log; their validity is the
    // live session's business): the agreed hand of three comes as a group of two and a single retry draw.
    const recover = act('recover', { hand: 3, round: '' });
    const commit = act('recoverCommit', { commits: [], instanceIds: [], zone: 'library:s0' });
    const d1 = act('draw', { instanceId: lib[0]!, group: 'g1' });
    const d2 = act('draw', { instanceId: lib[1]!, group: 'g1' });
    const d3 = act('draw', { instanceId: lib[2]! });
    const after = act('draw', { instanceId: lib[3]! });
    const log = stamped(start, [tap, recover, commit, d1, d2, d3, after]);
    expect(undoStackFromLog(start, log, 's0').stack.map((e) => e.cid)).toEqual([after.cid]);
    // Before the hand is full, nothing of the recovery is undoable either.
    expect(undoStackFromLog(start, log.slice(0, 5), 's0').stack).toEqual([]);
  });

  it('stops at a gap in the log and never throws on actions the reducer refuses', () => {
    const start = base();
    const t1 = act('tap', { card: 'a00', tapped: true });
    const { log } = sequence(start, [t1]);
    const gap = { ...act('tap', { card: 'a01', tapped: true }), seq: start.seq + 5 } as Action;
    expect(undoStackFromLog(start, [...log, gap], 's0').stack.map((e) => e.cid)).toEqual([t1.cid]);
    const refused = { ...act('tap', { card: 'nope', tapped: true }), seq: start.seq + 2 } as Action;
    expect(() => undoStackFromLog(start, [...log, refused], 's0')).not.toThrow();
  });

  it('keeps groups, so a reloaded gesture is still undone as one step', () => {
    const start = base();
    const g1 = act('tap', { card: 'a00', tapped: true, group: 'g' });
    const g2 = act('tap', { card: 'a01', tapped: true, group: 'g' });
    const { log } = sequence(start, [g1, g2]);
    expect(undoStackFromLog(start, log, 's0').stack.map((e) => e.group)).toEqual(['g', 'g']);
  });
});

/** `actions` with consecutive seqs after `start`, applied or not (undoStackFromLog replays what the reducer takes). */
function stamped(start: TableState, actions: readonly Action[]): Action[] {
  return actions.map((a, i) => ({ ...a, seq: start.seq + 1 + i }) as Action);
}

function end0(s: TableState): string {
  return s.zones['library:s0']!.ids[0]!;
}
