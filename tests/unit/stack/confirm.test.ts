/**
 * Confirmation rounds in the reducer (PLAN M1-P3; DESIGN "Turn flow and confirmation", Confirmation rounds; "The
 * effect stack", Stack and confirmation; "Specification: network protocol and secrecy", Timers).
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { deadlines } from '../../../src/core/deadlines';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { blockingHolder, confirmDeadlines, participants, roundPassed, silentSeats, timerStartSeq, waitingOn } from '../../../src/core/reducer/confirm';
import type { TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import { P, TEST_GAME, act, deepFreeze, fresh, no, ok, play, readyTable } from '../core/helpers';

/** Sequence `a` as the sequencer would: stamp the next seq. */
function seqd(s: TableState, a: Action): TableState {
  return ok(s, { ...a, seq: s.seq + 1 } as Action);
}

/** Three seats (Anna s0, Ben s1, Cleo s2), Anna's creature on the battlefield and a spell card a01 revealed in her library. */
function three(): TableState {
  let s = readyTable(4, 'ffa3', 3);
  s = play(s, 'a00', P(-100, -300));
  s = ok(s, act('reveal', { instanceId: 'a01', ref: { sid: 'sid-bolt' }, salt: 'salt-a01' }));
  return s;
}

const push = (item: string, round: string | undefined, by = 's0', extra: Partial<ActionDraft> = {}): Action =>
  act('stackPush', { item, kind: 'ability', source: 'a00', ...(round ? { round } : {}), ...extra } as never, by);
const respond = (round: string, seat: string, response: 'ok' | 'hold' | 'release' | 'timeout', by = seat): Action => act('respond', { round, seat, response }, by);

describe('start (DESIGN "Turn flow and confirmation", Confirmation rounds 1)', () => {
  it('a stack item with a round id opens a round about it, asked by the pusher, with the table pass timer', () => {
    let s = three();
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(s.confirm).toEqual({ id: 'r1', askedBy: 's1', about: 'i1', durationMs: 5000, startSeq: s.seq, responses: {} });
    expect(participants(s, s.confirm!)).toEqual(['s0', 's2']);
    expect(waitingOn(s)).toEqual(['s0', 's2']);
    expect(roundPassed(s)).toBe(false);
  });

  it('a spell cast to the stack opens a round too', () => {
    let s = three();
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    expect(s.confirm).toMatchObject({ id: 'r1', about: 'i1', askedBy: 's0' });
    expect(s.cards.a01!.zone).toBe('stack');
  });

  it('a push without a round id (an undo putting an item back) opens none', () => {
    let s = three();
    s = ok(s, push('i1', undefined));
    expect(s.confirm).toBeNull();
  });

  it('the round takes the pass timer the host set, or 0 when the timer is off', () => {
    let s = three();
    s = ok(s, act('settings', { settings: { passTimerMs: 12000 } }));
    expect(seqd(s, push('i1', 'r1')).confirm?.durationMs).toBe(12000);
    s = ok(s, act('settings', { settings: { passTimerMs: null } }));
    expect(seqd(s, push('i1', 'r1')).confirm?.durationMs).toBe(0);
  });

  it('Ask starts a round manually, with an optional short label or about a stack item', () => {
    let s = three();
    s = seqd(s, act('ask', { round: 'k1', label: '  attacks? ' }, 's2'));
    expect(s.confirm).toEqual({ id: 'k1', askedBy: 's2', label: 'attacks?', durationMs: 5000, startSeq: s.seq, responses: {} });
    s = ok(s, push('i1', undefined));
    s = seqd(s, act('ask', { round: 'k2', about: 'i1' }, 's1'));
    expect(s.confirm).toMatchObject({ id: 'k2', askedBy: 's1', about: 'i1' });
    expect(s.confirm).not.toHaveProperty('label');
  });

  it('refuses a malformed ask', () => {
    const s = three();
    no(s, act('ask', { round: 'k1', about: 'nope' }), /unknown stack item/);
    no(s, act('ask', { round: 'k1', label: 'x'.repeat(81) }), /label/);
    no(s, act('ask', { round: '' }), /round/);
    const open = ok(s, act('ask', { round: 'k1' }));
    no(open, act('ask', { round: 'k1' }), /already open/);
  });

  it('a new round replaces the open one', () => {
    let s = three();
    s = seqd(s, push('i1', 'r1', 's1'));
    s = seqd(s, respond('r1', 's0', 'ok'));
    s = seqd(s, push('i2', 'r2', 's2'));
    expect(s.confirm).toMatchObject({ id: 'r2', about: 'i2', askedBy: 's2', responses: {} });
    no(s, respond('r1', 's0', 'ok'), /not open/);
  });

  it('an optimistic (unsequenced) start counts from the next seq', () => {
    const s = three();
    expect(reduce(s, push('i1', 'r1')).confirm?.startSeq).toBe(s.seq + 1);
  });
});

describe('answers (DESIGN "Turn flow and confirmation", Confirmation rounds 2-5)', () => {
  const opened = () => seqd(three(), push('i1', 'r1', 's1'));

  it('OK passes; everyone passed lights Resolve', () => {
    let s = opened();
    s = seqd(s, respond('r1', 's0', 'ok'));
    expect(waitingOn(s)).toEqual(['s2']);
    s = seqd(s, respond('r1', 's2', 'ok'));
    expect(roundPassed(s)).toBe(true);
    expect(confirmDeadlines(s)).toEqual([]);
  });

  it('a second OK is a no-op', () => {
    const s = seqd(opened(), respond('r1', 's0', 'ok'));
    expect(reduce(s, respond('r1', 's0', 'ok'))).toBe(s);
  });

  it('Hold gives the seat the floor and stops every timer', () => {
    let s = opened();
    expect(confirmDeadlines(s)).toHaveLength(1);
    s = seqd(s, respond('r1', 's2', 'hold'));
    expect(s.confirm).toMatchObject({ holder: 's2', responses: { s2: 'hold' } });
    expect(blockingHolder(s)).toBe('s2');
    expect(confirmDeadlines(s)).toEqual([]);
    expect(roundPassed(s)).toBe(false);
    // The other silent seat keeps waiting; it cannot be timed out while the floor is held.
    no(s, respond('r1', 's0', 'timeout', 's0'), /stopped while s2 holds/);
    // Only one seat holds at a time.
    no(s, respond('r1', 's0', 'hold'), /already holds/);
    // Holding twice changes nothing.
    expect(reduce(s, respond('r1', 's2', 'hold'))).toBe(s);
  });

  it('Release (or OK from the holder) passes and restarts the countdown from that action', () => {
    let s = seqd(opened(), respond('r1', 's2', 'hold'));
    const held = s;
    s = seqd(s, respond('r1', 's2', 'release'));
    expect(s.confirm).toMatchObject({ responses: { s2: 'ok' }, timerSeq: s.seq });
    expect(s.confirm).not.toHaveProperty('holder');
    expect(timerStartSeq(s.confirm!)).toBe(s.seq);
    expect(confirmDeadlines(s)).toEqual([{ key: `confirm:r1:${s.seq}:s0`, fromSeq: s.seq, afterMs: 5000, emit: [{ type: 'respond', round: 'r1', seat: 's0', response: 'timeout' }] }]);
    const viaOk = seqd(held, respond('r1', 's2', 'ok'));
    expect(viaOk.confirm).toEqual(s.confirm);
    no(held, respond('r1', 's0', 'release'), /does not hold/);
  });

  it('Hold also clears the seat\'s auto-pass', () => {
    let s = three();
    s = ok(s, act('autoPass', { on: true }, 's2'));
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(s.confirm?.responses).toEqual({ s2: 'ok' });
    s = seqd(s, respond('r1', 's2', 'hold'));
    expect(s.seats.s2!.autoPass).toBe(false);
    expect(s.confirm).toMatchObject({ holder: 's2', responses: { s2: 'hold' } });
  });

  it('a seat answers only for itself; the asker does not answer; an empty seat does not answer', () => {
    let s = opened();
    no(s, respond('r1', 's2', 'ok', 's0'), /only for itself/);
    no(s, respond('r1', 's2', 'hold', 's0'), /only for itself/);
    no(s, respond('r1', 's1', 'ok'), /asker/);
    no(s, respond('r9', 's0', 'ok'), /not open/);
    no(s, act('respond', { round: 'r1', seat: 's0', response: 'maybe' as never }), /invalid response/);
    s = ok(s, act('seatLeave', { seat: 's2' }, 's2'));
    no(s, respond('r1', 's2', 'ok'), /empty/);
    // The empty seat is no longer waited for.
    expect(waitingOn(s)).toEqual(['s0']);
  });
});

describe('implicit pass: the sequencer deadline (DESIGN "Specification: network protocol and secrecy", Timers)', () => {
  it('is durationMs after the start, emits a timeout for each silent seat in seat order, and every emit applies', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    const [d] = confirmDeadlines(s);
    expect(d).toEqual({
      key: `confirm:r1:${s.seq}:s0,s2`,
      fromSeq: s.seq,
      afterMs: 5000,
      emit: [
        { type: 'respond', round: 'r1', seat: 's0', response: 'timeout' },
        { type: 'respond', round: 'r1', seat: 's2', response: 'timeout' },
      ],
    });
    expect(deadlines(s)).toEqual([d]);
    // The sequencer (Anna, s0) stamps the emits as itself.
    for (const e of d!.emit) s = seqd(s, { ...e, by: 's0', cid: `clock-${e.type}-${(e as { seat: string }).seat}` } as Action);
    expect(s.confirm?.responses).toEqual({ s0: 'timeout', s2: 'timeout' });
    expect(roundPassed(s)).toBe(true);
    expect(confirmDeadlines(s)).toEqual([]);
  });

  it('is the same pure data on every peer, so a new sequencer re-arms the same timer', () => {
    const s = seqd(three(), push('i1', 'r1', 's1'));
    const copy = JSON.parse(JSON.stringify(s)) as TableState;
    expect(canonicalJson(confirmDeadlines(copy))).toBe(canonicalJson(confirmDeadlines(s)));
  });

  it('none while the timer is off; a timeout is refused then', () => {
    let s = ok(three(), act('settings', { settings: { passTimerMs: null } }));
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(confirmDeadlines(s)).toEqual([]);
    no(s, respond('r1', 's0', 'timeout', 's0'), /timer is off/);
  });

  it('a timeout for a seat that already passed is refused (a stale emit is harmless)', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    s = seqd(s, respond('r1', 's0', 'ok'));
    no(s, respond('r1', 's0', 'timeout', 's0'), /already passed/);
    s = seqd(s, respond('r1', 's2', 'timeout', 's0'));
    no(s, respond('r1', 's2', 'timeout', 's0'), /already passed/);
    // A late OK after the timer changes nothing: the seat has passed.
    expect(reduce(s, respond('r1', 's2', 'ok'))).toBe(s);
  });

  it('a late Hold after passing re-opens the floor while the item is still there', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    s = seqd(s, respond('r1', 's0', 'timeout', 's0'));
    s = seqd(s, respond('r1', 's0', 'hold'));
    expect(s.confirm).toMatchObject({ holder: 's0', responses: { s0: 'hold' } });
    expect(roundPassed(s)).toBe(false);
  });
});

describe('connection loss (DESIGN "Turn flow and confirmation": an away player is treated as passing after the timer)', () => {
  const away = (s: TableState, seat: string): TableState => ({ ...s, seats: { ...s.seats, [seat]: { ...s.seats[seat]!, away: true } } });

  it('an away seat is silent like any other and times out with the timer', () => {
    let s = away(seqd(three(), push('i1', 'r1', 's1')), 's2');
    expect(silentSeats(s)).toEqual(['s0', 's2']);
    expect(confirmDeadlines(s)[0]?.emit.map((e) => (e as { seat: string }).seat)).toEqual(['s0', 's2']);
    s = seqd(s, respond('r1', 's2', 'timeout', 's0'));
    expect(s.confirm?.responses.s2).toBe('timeout');
  });

  it('a hold by a seat that is away no longer stops the clock, and that seat times out', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    s = seqd(s, respond('r1', 's2', 'hold'));
    expect(confirmDeadlines(s)).toEqual([]);
    s = away(s, 's2');
    expect(blockingHolder(s)).toBeNull();
    const [d] = confirmDeadlines(s);
    expect(d?.emit.map((e) => (e as { seat: string }).seat)).toEqual(['s0', 's2']);
    expect(d?.fromSeq).toBe(s.confirm!.startSeq);
    s = seqd(s, respond('r1', 's2', 'timeout', 's0'));
    expect(s.confirm).not.toHaveProperty('holder');
    s = seqd(s, respond('r1', 's0', 'timeout', 's0'));
    expect(roundPassed(s)).toBe(true);
  });

  it('the deadline key changes with the waiting seats, so a sequencer re-arms with a fresh emit (same start)', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    s = seqd(s, respond('r1', 's2', 'hold'));
    expect(confirmDeadlines(s)).toEqual([]);
    const lapsed = away(s, 's2');
    const [d1] = confirmDeadlines(lapsed);
    expect(d1?.key).toBe(`confirm:r1:${s.confirm!.startSeq}:s0,s2`);
    // Ben answers: the key changes, the start does not.
    const after = seqd(lapsed, respond('r1', 's0', 'ok'));
    const [d2] = confirmDeadlines(after);
    expect(d2?.key).toBe(`confirm:r1:${s.confirm!.startSeq}:s2`);
    expect(d2?.fromSeq).toBe(d1?.fromSeq);
    expect(d2?.emit).toEqual([{ type: 'respond', round: 'r1', seat: 's2', response: 'timeout' }]);
  });

  it('a seat that sits down mid-round is in the emit list and the key', () => {
    let s = createTable({ game: TEST_GAME, format: '1v1', seats: [{ name: 'Anna', colour: 0 }, { name: '', colour: 1 }] });
    s = ok(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(0, -200), label: 'Clue' }));
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'ability', source: 't1', round: 'r1' }));
    expect(confirmDeadlines(s)).toEqual([]);
    s = { ...s, seats: { ...s.seats, s1: { ...s.seats.s1!, name: 'Ben' } } };
    const [d] = confirmDeadlines(s);
    expect(d?.key).toBe(`confirm:r1:${s.confirm!.startSeq}:s1`);
    expect(d?.emit).toEqual([{ type: 'respond', round: 'r1', seat: 's1', response: 'timeout' }]);
  });

  it('another seat may take the floor from a holder that is away; the old holder is silent again', () => {
    let s = seqd(three(), push('i1', 'r1', 's1'));
    s = away(seqd(s, respond('r1', 's2', 'hold')), 's2');
    s = seqd(s, respond('r1', 's0', 'hold'));
    expect(s.confirm).toMatchObject({ holder: 's0', responses: { s0: 'hold' } });
    expect(silentSeats(s)).toEqual(['s2']);
  });
});

describe('auto-pass (DESIGN "Turn flow and confirmation", Confirmation rounds 6)', () => {
  it('a seat passing until end of turn answers OK when a round opens and when it turns the toggle on', () => {
    let s = three();
    s = ok(s, act('autoPass', { on: true }, 's2'));
    expect(s.seats.s2!.autoPass).toBe(true);
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(s.confirm?.responses).toEqual({ s2: 'ok' });
    s = seqd(s, act('autoPass', { on: true }, 's0'));
    expect(s.confirm?.responses).toEqual({ s0: 'ok', s2: 'ok' });
    expect(roundPassed(s)).toBe(true);
  });

  it('turning it off does not take back an answer; it is cleared when the turn changes', () => {
    let s = ok(three(), act('autoPass', { on: true }, 's2'));
    s = seqd(s, push('i1', 'r1', 's1'));
    s = seqd(s, act('autoPass', { on: false }, 's2'));
    expect(s.confirm?.responses).toEqual({ s2: 'ok' });
    s = ok(s, act('autoPass', { on: true }, 's2'));
    s = ok(s, act('turnPass', { to: 's1' }));
    expect(s.seats.s2!.autoPass).toBe(false);
    s = seqd(s, push('i2', 'r2', 's1'));
    expect(s.confirm?.responses).toEqual({});
  });

  it('the asker\'s own auto-pass does not answer its own round', () => {
    let s = ok(three(), act('autoPass', { on: true }, 's1'));
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(s.confirm?.responses).toEqual({});
  });

  it('refuses a malformed toggle; repeating the same value is a no-op', () => {
    const s = three();
    no(s, act('autoPass', { on: 'yes' as never }), /boolean/);
    expect(reduce(s, act('autoPass', { on: false }))).toBe(s);
  });
});

describe('empty chairs never stall a round (solo goldfish, DESIGN "Players, seats and formats")', () => {
  it('a round with nobody else at the table has passed at once and runs no timer', () => {
    let s = createTable({ game: TEST_GAME, format: '1v1', seats: [{ name: 'Anna', colour: 0 }, { name: '', colour: 1 }] });
    s = ok(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(0, -200), label: 'Clue' }));
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'ability', source: 't1', round: 'r1' }));
    expect(s.confirm).toMatchObject({ id: 'r1', responses: {} });
    expect(roundPassed(s)).toBe(true);
    expect(confirmDeadlines(s)).toEqual([]);
    // Resolving needs no second press.
    s = ok(s, act('stackResolve', { item: 'i1' }));
    expect(s.stack).toEqual([]);
  });
});

describe('the round ends with its item (DESIGN "The effect stack", Stack and confirmation)', () => {
  const opened = () => seqd(seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' })), respond('r1', 's1', 'ok'));

  it('on resolve, counter, a drag out of the stack and an undo of the push', () => {
    const s = seqd(opened(), respond('r1', 's2', 'ok'));
    expect(ok(s, act('stackResolve', { item: 'i1', to: 'graveyard:s0' })).confirm).toBeNull();
    expect(ok(opened(), act('stackCounter', { item: 'i1' })).confirm).toBeNull();
    expect(ok(opened(), act('move', { card: 'a01', to: 'battlefield:s0', pose: P(0, -200) })).confirm).toBeNull();
  });

  it('but not when the stack is reordered or another item leaves', () => {
    let s = three();
    s = ok(s, push('i0', undefined));
    s = seqd(s, push('i1', 'r1', 's1'));
    expect(ok(s, act('stackReorder', { item: 'i1', index: 0 })).confirm?.id).toBe('r1');
    s = ok(s, act('stackReorder', { item: 'i1', index: 0 }));
    expect(ok(s, act('stackResolve', { item: 'i0' })).confirm?.id).toBe('r1');
  });

  it('a manual round about nothing stays until replaced', () => {
    let s = seqd(three(), act('ask', { round: 'k1' }));
    s = ok(s, push('i1', undefined));
    s = ok(s, act('stackResolve', { item: 'i1' }));
    expect(s.confirm?.id).toBe('k1');
  });
});

describe('determinism and undo (DESIGN "Specification: code interfaces", Reducer contract; "Turn flow and confirmation", Undo)', () => {
  it('never writes to its input', () => {
    const s = deepFreeze(seqd(three(), push('i1', 'r1', 's1')));
    for (const a of [respond('r1', 's0', 'ok'), respond('r1', 's2', 'hold'), act('autoPass', { on: true }, 's2'), act('ask', { round: 'k1', label: 'x' }), push('i2', 'r2')]) {
      expect(() => reduce(s, a)).not.toThrow();
      expect(explain(s, a)).toBeNull();
    }
  });

  it('undoing a push that opened a round leaves the table as it was before the push', () => {
    const before = three();
    const a = push('i1', 'r1');
    const after = reduce(before, a);
    expect(after.confirm?.id).toBe('r1');
    const inv = inverse(before, a);
    expect(inv).not.toBeNull();
    const undone = ok(after, act('undo', { of: a.cid, inverse: inv! }));
    expect(canonicalJson({ ...undone, seq: 0 })).toBe(canonicalJson({ ...before, seq: 0 }));
  });

  /** Undo `a` (applied to `before`) and return the state after the undo; fails when `a` is not undoable. */
  const undoOf = (before: TableState, a: Action): { after: TableState; undone: TableState } => {
    const after = seqd(before, a);
    const inv = inverse(before, a);
    expect(inv, `${a.type} must be undoable`).not.toBeNull();
    return { after, undone: seqd(after, act('undo', { of: a.cid, inverse: inv! }, a.by)) };
  };
  const sameTable = (x: TableState, y: TableState) => expect(canonicalJson({ ...x, seq: 0, confirm: null })).toBe(canonicalJson({ ...y, seq: 0, confirm: null }));
  /** Anna casts a01 with round r1; Ben and Cleo pass. */
  const castAllPassed = () => {
    let s = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    s = seqd(s, respond('r1', 's1', 'ok'));
    return seqd(s, respond('r1', 's2', 'timeout', 's0'));
  };

  it('a resolve after everyone passed is undoable: the item comes back, without the round that ended with it', () => {
    const before = castAllPassed();
    const a = act('stackResolve', { item: 'i1', to: 'battlefield:s0', pose: P(0, -200) });
    const { after, undone } = undoOf(before, a);
    expect(after.confirm).toBeNull();
    expect(undone.stack.map((i) => i.id)).toEqual(['i1']);
    expect(undone.cards.a01!.zone).toBe('stack');
    sameTable(undone, before);
    expect(undone.confirm).toBeNull();
  });

  it('a forced resolve and a counter are undoable too', () => {
    const pending = seqd(three(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    sameTable(undoOf(pending, act('stackResolve', { item: 'i1', force: true })).undone, pending);
    const passed = castAllPassed();
    sameTable(undoOf(passed, act('stackCounter', { item: 'i1' })).undone, passed);
  });

  it('a second push with a round onto a non-empty stack is undoable; the round it replaced stays replaced', () => {
    const before = castAllPassed();
    const a = push('i2', 'r2', 's1');
    const { after, undone } = undoOf(before, a);
    expect(after.confirm?.id).toBe('r2');
    expect(undone.stack.map((i) => i.id)).toEqual(['i1']);
    sameTable(undone, before);
    // The round about the item the undo took away has ended.
    expect(undone.confirm).toBeNull();
  });

  it('a group of pushes (casting a selection) undoes newest first, each one', () => {
    let s = three();
    s = ok(s, act('reveal', { instanceId: 'a02', ref: { sid: 'sid-bear' }, salt: 'salt-a02' }));
    const start = s;
    const p1 = act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1', group: 'g1' });
    const p2 = act('stackPush', { item: 'i2', kind: 'spell', card: 'a02', round: 'r2', group: 'g1' });
    const inv1 = inverse(s, p1);
    s = seqd(s, p1);
    const inv2 = inverse(s, p2);
    s = seqd(s, p2);
    expect(inv1).not.toBeNull();
    expect(inv2).not.toBeNull();
    s = seqd(s, act('undo', { of: p2.cid, inverse: inv2! }));
    s = seqd(s, act('undo', { of: p1.cid, inverse: inv1! }));
    expect(s.stack).toEqual([]);
    expect(canonicalJson({ ...s, seq: 0, confirm: null, cards: {} })).toBe(canonicalJson({ ...start, seq: 0, confirm: null, cards: {} }));
  });

  it('answers are not undoable', () => {
    const before = seqd(three(), push('i1', 'r1', 's1'));
    const a = respond('r1', 's0', 'ok');
    expect(inverse(before, a)).toBeNull();
  });

  it('two orders of the same answers (as two peers would replay a log) agree once sequenced the same way', () => {
    const base = seqd(three(), push('i1', 'r1', 's1'));
    const log = [respond('r1', 's2', 'hold'), respond('r1', 's2', 'release'), respond('r1', 's0', 'timeout', 's0')];
    const replay = (s: TableState) => log.reduce(seqd, s);
    expect(canonicalJson(replay(base))).toBe(canonicalJson(replay(JSON.parse(JSON.stringify(base)) as TableState)));
  });

  it('fresh tables have no round', () => {
    expect(fresh().confirm).toBeNull();
  });
});
