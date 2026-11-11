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
import { inverse } from '../../../src/core/undo';
import { P, act, card, ok, play, readyTable, withoutSeq } from './helpers';

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

  it('a card sent to a hidden zone comes back with identity, counters, note, tap, attachments and lines', () => {
    let s = play(play(readyTable(4), 'a00', P(0, -200)), 'a01', P(100, -200));
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    s = ok(s, act('note', { card: 'a00', text: 'copy of X' }));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's1' } }, 's1'));
    const { after } = roundTrip(s, act('toZone', { card: 'a00', to: 'hand:s0', position: 'any' }));
    expect(card(after, 'a00').identity).toBeUndefined();
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
