/**
 * Personal undo as inverse actions (DESIGN "Turn flow and confirmation", Undo; PLAN M0-P1 "Undo after any undoable
 * action restores the previous hash"). The property test covers random sequences; these cases pin the design's
 * named behaviours and the lossy effects an inverse has to bring back.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { reduce } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { inverse, undoPlan, withoutReveals } from '../../../src/core/undo';
import { P, act, card, no, ok, play, readyTable, withoutSeq } from './helpers';

/** Apply `a`, undo it through an `undo` action, and expect the exact previous state (seq aside). */
function roundTrip(before: TableState, a: Action): { after: TableState; undone: TableState } {
  const after = ok(before, a);
  const inv = inverse(before, a);
  expect(inv, `inverse of ${a.type}`).not.toBeNull();
  const undone = ok(after, act('undo', { of: a.cid, inverse: JSON.parse(JSON.stringify(inv)) }, a.by));
  expect(withoutSeq(undone)).toBe(withoutSeq(before));
  return { after, undone };
}

describe('inverse', () => {
  it('undoing a draw puts the card back into the library (on top in the owner order)', () => {
    const s = readyTable(4);
    const a = act('draw', { instanceId: 'a02' });
    const inv = inverse(s, a);
    expect(inv).toMatchObject({ type: 'toZone', card: 'a02', to: 'library:s0', position: 'top' });
    roundTrip(s, a);
  });

  it('returns null for shuffles, reveals, dice, coins, mulligans, pings, seats and actions that did not apply', () => {
    let s = play(readyTable(4), 'a00', P(0, -200));
    s = ok(s, act('flip', { card: 'a00', face: 'down' }));
    s = ok(s, act('hide', { card: 'a00' }));
    const never: Action[] = [
      act('shuffleCommit', { sid: 'x', zone: 'library:s0', h: 'h' }),
      act('reveal', { instanceId: 'a01', ref: { sid: 'q' }, salt: 's' }),
      act('flip', { card: 'a00', face: 'up', ref: { sid: 'q' }, salt: 's' }),
      act('rngCommit', { rid: 'r', purpose: 'die', n: 6, h: 'h' }),
      act('rngReveal', { rid: 'r', nonce: 'n' }),
      act('mulligan', { count: 1 }),
      act('hide', { card: 'a00' }),
      act('ping', { target: { kind: 'seat', id: 's1' } }),
      act('seatLeave', { seat: 's1' }),
      act('ready', { commits: [], instanceIds: [], zone: 'library:s0' }),
      act('tap', { card: 'nope', tapped: true }),
    ];
    for (const a of never) expect(inverse(s, a), a.type).toBeNull();
  });

  it('a move back restores zone, index, pose, pile and controller', () => {
    let s = play(play(play(readyTable(5), 'a00', P(0, -200)), 'a01', P(80, -200)), 'a02', P(160, -200));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a01', pile: { id: 'L', index: 1, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a02', pile: { id: 'L', index: 2, kind: 'cascade' } }));
    roundTrip(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(-300.37, -111.11) })); // whole pile
    roundTrip(s, act('move', { card: 'a01', to: 'battlefield:s0', pose: P(300, -150) })); // pulled out
    roundTrip(s, act('move', { card: 'a00', to: 'graveyard:s0' })); // base leaves the zone
    roundTrip(s, act('move', { card: 'a02', to: 'battlefield:s1', pose: P(0, 200, 180) }));
  });

  it('a card sent to a hidden zone comes back face down with counters, note, tap, attachments and lines; its owner re-reveals it', () => {
    let s = play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200));
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    s = ok(s, act('note', { card: 'a00', text: 'copy of X' }));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's1' } }, 's1'));
    const a = act('toZone', { card: 'a00', to: 'hand:s0', position: 'any' });
    const plan = undoPlan(s, a)!;
    // M1-P2: a restore patch never puts a committed identity back (the reducer could not check it).
    expect(plan.reveals).toEqual([{ card: 'a00', ref: { sid: 'sid-a00' }, face: 'up' }]);
    expect(plan.inverse.restore?.cards?.a00).not.toHaveProperty('identity');
    const after = ok(s, a);
    expect(card(after, 'a00').identity).toBeUndefined();
    const undone = ok(after, act('undo', { of: a.cid, inverse: JSON.parse(JSON.stringify(plan.inverse)) }));
    expect(withoutSeq(undone)).toBe(withoutSeq(withoutReveals(s, plan.reveals)));
    expect(card(undone, 'a00')).toMatchObject({ zone: 'battlefield:s0', face: 'down', tapped: true, counters: { '+1/+1': 2 }, note: 'copy of X' });
    expect(card(undone, 'a00').identity).toBeUndefined();
    // The owner's verified re-reveal completes the previous state.
    const again = ok(undone, act('flip', { card: 'a00', face: 'up', ref: { sid: 'sid-a00' }, salt: 'salt-a00' }));
    expect(withoutSeq(again)).toBe(withoutSeq(s));
  });

  it('a restore patch cannot put an identity on a committed card (M1-P2), only on a token', () => {
    let s = readyTable(4);
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(0, -200) }));
    expect(card(s, 'a00')).toMatchObject({ face: 'down' });
    expect(card(s, 'a00').identity).toBeUndefined();
    const forged = act('undo', {
      of: 'zzz',
      inverse: { type: 'tap', by: 's1', cid: 'x', card: 'a00', tapped: false, restore: { cards: { a00: { identity: { expect: null, put: { sid: 'black-lotus' } } } } } },
    }, 's1');
    no(s, forged, /cannot reveal card a00/);
    no(s, { ...forged, by: 's0', inverse: { ...(forged as { inverse: object }).inverse, by: 's0' } } as Action, /cannot reveal card a00/);
    // A token's identity is public from its creation; an undo may put it back.
    s = ok(s, act('createToken', { card: 't', zone: 'battlefield:s0', pose: P(100, -100), ref: { sid: 'goblin' } }));
    s = ok(s, act('hide', { card: 't' }));
    ok(s, act('undo', { of: 'h', inverse: { type: 'tap', by: 's0', cid: 'y', card: 't', tapped: false, restore: { cards: { t: { identity: { expect: null, put: { sid: 'goblin' } }, face: { expect: 'down', put: 'up' } } } } } }));
  });

  it('a resolved or countered item comes back with its target lines', () => {
    let s = play(readyTable(4), 'a01', P(0, -200));
    s = ok(s, act('draw', { instanceId: 'a00' }));
    s = ok(s, act('reveal', { instanceId: 'a00', ref: { sid: 'bolt' }, salt: 's' }));
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00' }));
    s = ok(s, act('lineAdd', { line: 't', kind: 'target', from: { kind: 'stackItem', id: 'i1' }, to: { kind: 'card', id: 'a01' } }));
    roundTrip(s, act('stackResolve', { item: 'i1', to: 'graveyard:s0' }));
    roundTrip(s, act('stackCounter', { item: 'i1' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'trigger', source: 'a01', note: 'n' }));
    s = ok(s, act('stackPush', { item: 'i3', kind: 'copy', copyOf: 'i2' }));
    roundTrip(s, act('stackResolve', { item: 'i3' }));
    roundTrip(s, act('stackPush', { item: 'i4', kind: 'ability', source: 'a01' }));
    roundTrip(s, act('stackReorder', { item: 'i1', index: 2 }));
    roundTrip(s, act('stackNote', { item: 'i1', note: 'kicked' }));
  });

  it('a removed token comes back with its counters, pile place and lines', () => {
    let s = play(readyTable(2), 'a00', P(0, -200));
    s = ok(s, act('createToken', { card: 't', zone: 'battlefield:s0', pose: P(100, -100), ref: { sid: 'goblin' } }));
    s = ok(s, act('createToken', { card: 'u', zone: 'battlefield:s0', pose: P(200, -100), label: 'Treasure' }));
    s = ok(s, act('pile', { card: 't', pile: { id: 'T', index: 0, kind: 'squared' } }));
    s = ok(s, act('pile', { card: 'u', pile: { id: 'T', index: 1, kind: 'squared' } }));
    s = ok(s, act('counter', { card: 't', kind: '+1/+1', delta: 1 }));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'block', from: { kind: 'card', id: 't' }, to: { kind: 'card', id: 'a00' } }));
    roundTrip(s, act('remove', { card: 't' }));
    roundTrip(s, act('createToken', { card: 'v', zone: 'battlefield:s0', pose: P(0, 0), label: 'Clue' }));
    roundTrip(s, act('copy', { card: 'w', of: 'a00', pose: P(70, -200) }));
  });

  it("a removed line comes back with its creator, not the undoer", () => {
    let s = play(readyTable(2), 'a00', P(0, -200));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's0' }, label: 'x' }, 's1'));
    const { undone } = roundTrip(s, act('lineRemove', { line: 'l' }, 's0'));
    expect(undone.lines.l?.by).toBe('s1');
    roundTrip(s, act('lineAdd', { line: 'm', kind: 'target', from: { kind: 'seat', id: 's1' }, to: { kind: 'card', id: 'a00' } }));
  });

  it('turn, phase, life and counters', () => {
    let s = readyTable(1);
    s = ok(s, act('phaseSet', { phase: 'combat' }));
    roundTrip(s, act('turnPass', { to: 's1' }));
    roundTrip(s, act('phaseSet', { phase: 'end' }));
    roundTrip(s, act('life', { seat: 's1', delta: -7 }));
    roundTrip(s, act('playerCounter', { seat: 's0', kind: 'poison', delta: 3 }));
    s = ok(s, act('playerCounter', { seat: 's0', kind: 'poison', delta: 1 }));
    roundTrip(s, act('playerCounter', { seat: 's0', kind: 'poison', delta: -4 })); // clamped at 0
  });

  it('card state actions', () => {
    let s = play(play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200)), 'a02', P(200, -200));
    s = ok(s, act('attach', { card: 'a02', to: 'a01' }));
    for (const a of [
      act('tap', { card: 'a00', tapped: true }),
      act('flip', { card: 'a00', face: 'down' }),
      act('transform', { card: 'a00', faceIndex: 1 }),
      act('rotate', { card: 'a00', delta: 33.333 }),
      act('rotate', { card: 'a01', delta: -450 }),
      act('counter', { card: 'a00', kind: 'charge', delta: 4 }),
      act('note', { card: 'a00', text: 'hi' }),
      act('attach', { card: 'a00', to: 'a01' }),
      act('attach', { card: 'a02', to: 'a00', pose: P(1.005, 2.675) }),
      act('detach', { card: 'a02', pose: P(-7.1, 3.3) }),
      act('pile', { card: 'a00', pile: { id: 'N', index: 0, kind: 'cascade' }, pose: P(0.1, 0.2) }),
      act('tidy', { seat: 's0', poses: { a01: P(-500.555, -100.123), a00: P(5, 5) } }),
      act('move', { card: 'a01', to: 'battlefield:s0', pose: P(0.3, 0.7) }),
    ]) {
      roundTrip(s, a);
    }
  });

  it('temporary moves and settle', () => {
    let s = play(play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200)), 'b00', P(0, 200, 180), 's1');
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a01', pile: { id: 'L', index: 1, kind: 'cascade' } }));
    roundTrip(s, act('moveTemp', { card: 'a00', pose: P(0, -90), combat: 'attack', tap: true })); // base leaves its pile
    s = ok(s, act('moveTemp', { card: 'a01', pose: P(100, -90), combat: 'attack', tap: true }));
    roundTrip(s, act('moveTemp', { card: 'a01', pose: P(120, -60), combat: 'block' })); // already displaced
    s = ok(s, act('moveTemp', { card: 'b00', pose: P(100, -50, 180), combat: 'block' }, 's1'));
    s = ok(s, act('lineAdd', { line: 'blk', kind: 'block', from: { kind: 'card', id: 'b00' }, to: { kind: 'card', id: 'a01' } }, 's1'));
    s = ok(s, act('lineAdd', { line: 'mrk', kind: 'mark', from: { kind: 'card', id: 'b00' }, to: { kind: 'card', id: 'a01' } }, 's1'));
    const { after } = roundTrip(s, act('settle', {}));
    expect(Object.keys(after.lines)).toEqual(['mrk']);
    roundTrip(s, act('settle', { cards: ['b00'] }, 's1'));
  });

  it('a pile dragged to another battlefield and a card sent to the graveyard come back whole', () => {
    let s = play(play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200)), 'a02', P(200, -200));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a02', pile: { id: 'L', index: 1, kind: 'cascade' } }));
    s = ok(s, act('move', { card: 'a01', to: 'battlefield:s0', pose: P(300, -200) })); // a01 on top of the draw order
    roundTrip(s, act('move', { card: 'a00', to: 'battlefield:s1', pose: P(0, 250, 180) }));
    s = ok(s, act('tap', { card: 'a01', tapped: true }));
    s = ok(s, act('counter', { card: 'a01', kind: '+1/+1', delta: 2 }));
    s = ok(s, act('transform', { card: 'a01', faceIndex: 1 }));
    roundTrip(s, act('move', { card: 'a01', to: 'graveyard:s0' }));
  });

  it('undoing a move out of the hand of a card revealed there returns it without its identity', () => {
    let s = readyTable(3);
    s = ok(s, act('draw', { instanceId: 'a01' }));
    s = ok(s, act('reveal', { instanceId: 'a01', ref: { sid: 'land' }, salt: 's' }));
    const before = s;
    const a = act('move', { card: 'a01', to: 'battlefield:s0', pose: P(0, -200) });
    const after = ok(s, a);
    const inv = inverse(before, a);
    expect(inv).not.toBeNull();
    const undone = ok(after, act('undo', { of: a.cid, inverse: inv! }));
    expect(card(undone, 'a01')).toMatchObject({ zone: 'hand:s0', face: 'down' });
    expect(card(undone, 'a01').identity).toBeUndefined();
    const { identity: _drop, ...opaque } = card(before, 'a01');
    expect(withoutSeq(undone)).toBe(withoutSeq({ ...before, cards: { ...before.cards, a01: opaque } }));
  });

  it('inverse never mutates its input and does not depend on the action being sequenced', () => {
    const s = play(readyTable(2), 'a00', P(0, -200));
    const frozen = JSON.parse(JSON.stringify(s)) as TableState;
    Object.freeze(frozen);
    const a = { ...act('tap', { card: 'a00', tapped: true }), seq: 9 };
    const inv = inverse(frozen, a);
    expect(inv).toMatchObject({ type: 'tap', card: 'a00', tapped: false });
    expect(canonicalJson(frozen)).toBe(canonicalJson(s));
    expect(withoutSeq(reduce(reduce(s, a), inv!))).toBe(withoutSeq(s));
  });
});

describe('restore patch (DESIGN "Turn flow and confirmation", Undo: no table-wide rewind)', () => {
  const table = (): TableState => {
    let s = play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200));
    s = play(s, 'b00', P(0, 200, 180), 's1');
    return s;
  };
  const undoWith = (inv: Record<string, unknown>, by = 's1'): Action => act('undo', { of: 'x', inverse: inv as never }, by);
  const tap = (restore: unknown): Record<string, unknown> => ({ type: 'tap', by: 's1', cid: 'f', card: 'b00', tapped: true, restore });

  it('refuses forged patches that reach beyond what an inverse cannot rebuild', () => {
    const s = table();
    const lib = s.zones['library:s0']!;
    const seat = s.seats.s0!;
    const forged: unknown[] = [
      // Zone kind, owner or visibility: zones only take a new draw order.
      { zones: { 'library:s0': { ...lib, visibility: 'public' } } },
      { zones: { 'library:s0': { expect: lib.ids, put: [] } } },
      // Seats: only auto-pass; teams never.
      { seats: { s0: { ...seat, life: -999, peer: 'attacker', name: 'pwned' } } },
      { seats: { s0: { life: { expect: 20, put: -999 } } } },
      { seats: { s0: { autoPass: { expect: false, put: true }, peer: { expect: null, put: 'attacker' } } } },
      { teams: {} },
      // Turn: only the number.
      { turn: { number: 0, active: 'nobody', phase: 'zzz' } },
      { turn: { active: { expect: 's0', put: 'nobody' } } },
      { turn: { number: { expect: 1, put: 0 } } },
      // Cards: never id, owner, zone or token-ness; never a hidden card; never a new or deleted card.
      { cards: { a00: { owner: { expect: 's0', put: 's1' } } } },
      { cards: { a00: { zone: { expect: 'battlefield:s0', put: 'hand:s1' } } } },
      { cards: { a00: { isToken: { expect: null, put: true } } } },
      { cards: { a02: { identity: { expect: null, put: { sid: 'x' } } } } },
      { cards: { a02: { face: { expect: 'down', put: 'up' } } } },
      { cards: { zz: { tapped: { expect: false, put: true } } } },
      { cards: { a00: { tapped: { expect: false, put: 'yes' } } } },
      { cards: { a00: { controller: { expect: 's0', put: 'nobody' } } } },
      { cards: { a00: { tokenLabel: { expect: null, put: 'Treasure' } } } },
      { cards: { a00: { attachedTo: { expect: null, put: 'a00' } } } },
      // Lines and the stack are validated and checked against the table.
      { lines: { l: { expect: null, put: { id: 'l', kind: 'mark', from: { kind: 'card', id: 'a03' }, to: { kind: 'seat', id: 's0' }, by: 's0' } } } },
      { lines: { l: { expect: null, put: { id: 'other', kind: 'mark', from: { kind: 'seat', id: 's1' }, to: { kind: 'seat', id: 's0' }, by: 's0' } } } },
      { stack: { expect: [], put: [{ id: 'i', kind: 'spell', controller: 's0', card: 'a00' }] } },
      // The old whole-record form.
      { cards: { a00: { ...card(s, 'a00'), zone: 'hand:s1' } } },
      'nonsense',
    ];
    for (const restore of forged) {
      no(s, undoWith(tap(restore)));
    }
    // The reviewer's probe: library made public, seat taken over, turn marker on a seat that does not exist.
    no(
      s,
      undoWith({
        type: 'tap',
        by: 's1',
        cid: 'f',
        card: 'a00',
        tapped: true,
        restore: { zones: { 'library:s1': { ...s.zones['library:s1']!, visibility: 'public' } }, seats: { s0: { ...seat, life: -999, peer: 'attacker', name: 'pwned' } }, turn: { number: 0, active: 'nobody', phase: 'zzz' } },
      }),
    );
  });

  it('refuses a restore patch outside an undo', () => {
    const s = table();
    const a = act('tap', { card: 'a00', tapped: true });
    no(s, { ...a, restore: { cards: { a00: { tapped: { expect: true, put: false } } } } }, /inside an undo/);
  });

  it('an undo after another seat changed other fields of a patched card keeps their change', () => {
    let s = table();
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    const a = act('toZone', { card: 'a00', to: 'hand:s0', position: 'any' });
    const inv = inverse(s, a);
    expect(inv?.restore?.cards?.a01).toEqual({ attachedTo: { expect: null, put: 'a00' } });
    s = ok(s, a);
    s = ok(s, act('tap', { card: 'a01', tapped: true }, 's1'));
    s = ok(s, act('counter', { card: 'a01', kind: 'charge', delta: 3 }, 's1'));
    const undone = ok(s, act('undo', { of: a.cid, inverse: inv! }));
    expect(card(undone, 'a00').zone).toBe('battlefield:s0');
    expect(card(undone, 'a01')).toMatchObject({ attachedTo: 'a00', tapped: true, counters: { charge: 3 } });
  });

  it('an undo after another seat changed a patched value is refused, not silently reverted', () => {
    let s = table();
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    // Into the graveyard: tap and counters fall off; the undo puts them back.
    const a = act('move', { card: 'a00', to: 'graveyard:s0' });
    const inv = inverse(s, a)!;
    expect(inv.restore?.cards?.a00).toMatchObject({ tapped: { expect: false, put: true }, counters: { expect: {}, put: { '+1/+1': 2 } } });
    s = ok(s, a);
    // s1 then puts a counter on the card in the graveyard: the undo would wipe it, so it is refused.
    s = ok(s, act('counter', { card: 'a00', kind: 'time', delta: 1 }, 's1'));
    no(s, act('undo', { of: a.cid, inverse: inv }), /stale: card a00 counters/);

    // The turn number: a second turn pass since makes the first one's undo stale.
    let t = table();
    const pass = act('turnPass', { to: 's1' });
    const passInv = inverse(t, pass)!;
    expect(passInv.restore).toEqual({ turn: { number: { expect: 3, put: 1 } } });
    t = ok(t, pass);
    t = ok(t, act('phaseSet', { phase: 'main1' }, 's1'));
    // A phase change since is not touched by the patch.
    const undone = ok(t, act('undo', { of: pass.cid, inverse: passInv }));
    expect(undone.turn).toEqual({ number: 1, active: 's0', phase: 'main1' });
    t = ok(t, act('turnPass', { to: 's0' }, 's1'));
    no(t, act('undo', { of: pass.cid, inverse: passInv }), /stale/);
  });
});
