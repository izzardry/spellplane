/**
 * PLAN M0-P1 acceptance: "A table of unit tests covers each action family once", plus the edge cases of
 * DESIGN "Table model", "Card manipulation", "Combat and annotation", "The effect stack", "Turn flow and
 * confirmation" and "Specification: geometry, layout and motion".
 */
import { describe, expect, it } from 'vitest';
import { ACTION_FAMILIES, type Action } from '../../../src/core/actions';
import { GEOMETRY } from '../../../src/core/geometry';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, pileMemberPose, reduce, tuckPose } from '../../../src/core/reducer';
import { checkInvariants } from '../../../src/core/invariants';
import type { TableState } from '../../../src/core/types';
import { P, TEST_GAME, act, card, deepFreeze, fresh, hiddenZonesOpaque, libIds, no, ok, play, readyTable } from './helpers';

const CASCADE = GEOMETRY.cascadeOffset; // 14 mm
const TUCK = GEOMETRY.attachTuck; // 10 sideways, 10 up

function clean(s: TableState): void {
  expect(checkInvariants(s)).toEqual([]);
  expect(hiddenZonesOpaque(s)).toEqual([]);
}

describe('createTable', () => {
  it('creates seats, every zone of the game definition, the first phase and starting life', () => {
    const s = fresh();
    expect(s.seq).toBe(0);
    expect(s.game).toBe('test');
    expect(Object.keys(s.seats)).toEqual(['s0', 's1']);
    expect(s.seats.s0).toMatchObject({ id: 's0', index: 0, name: 'Anna', colour: 0, life: 20, counters: {}, ready: false, autoPass: false });
    expect(s.zones['library:s0']).toEqual({ id: 'library:s0', kind: 'library', owner: 's0', visibility: 'nobody', count: 0, ids: [] });
    expect(s.zones['hand:s1']).toMatchObject({ visibility: 'owner', count: 0, ids: [] });
    expect(s.zones['battlefield:s1']).toEqual({ id: 'battlefield:s1', kind: 'battlefield', owner: 's1', visibility: 'public', ids: [] });
    expect(s.zones.stack).toEqual({ id: 'stack', kind: 'stack', owner: null, visibility: 'public', ids: [] });
    expect(s.turn).toEqual({ number: 1, active: 's0', phase: 'untap' });
    expect(s.stack).toEqual([]);
    expect(s.confirm).toBeNull();
    clean(s);
  });

  it('gives Two-Headed Giant teams a shared life of 30 and a team turn marker', () => {
    const s = fresh('2hg', 4);
    expect(s.teams.t0).toEqual({ id: 't0', seats: ['s0', 's1'], life: 30, counters: {} });
    expect(s.teams.t1?.seats).toEqual(['s2', 's3']);
    expect(s.turn.active).toBe('t0');
    clean(s);
  });

  it('adds the table stack zone even when the game definition does not list it', () => {
    const s = createTable({ game: { ...TEST_GAME, zones: TEST_GAME.zones.filter((z) => z.id !== 'stack') }, format: '1v1', seats: [{ name: 'A', colour: 0 }] });
    expect(s.zones.stack?.visibility).toBe('public');
  });

  it('is plain JSON', () => {
    const s = readyTable(3);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(() => canonicalJson(s)).not.toThrow();
  });
});

describe('reducer contract', () => {
  it('returns the same object and a reason for an action that does not apply', () => {
    const s = readyTable(2);
    no(s, act('tap', { card: 'nope', tapped: true }), /unknown card/);
    no(s, act('move', { card: 'a00', to: 'nowhere' }), /unknown zone/);
  });

  it('never mutates its input (deep-frozen state and action)', () => {
    let s = readyTable(4);
    s = play(s, 'a00', P(0, -200));
    s = play(s, 'a01', P(100, -200));
    deepFreeze(s);
    const actions: Action[] = [
      act('tap', { card: 'a00', tapped: true }),
      act('move', { card: 'a00', to: 'graveyard:s0' }),
      act('pile', { card: 'a01', pile: { id: 'p', index: 0, kind: 'cascade' } }),
      act('attach', { card: 'a01', to: 'a00' }),
      act('toZone', { card: 'a00', to: 'hand:s0', position: 'any' }),
      act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }),
      act('lineAdd', { line: 'l1', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's1' } }),
      act('life', { seat: 's1', delta: -3 }),
      act('turnPass', { to: 's1' }),
    ];
    const before = canonicalJson(s);
    for (const a of actions) {
      deepFreeze(a);
      expect(explain(s, a)).toBeNull();
      expect(() => reduce(s, a)).not.toThrow();
    }
    expect(canonicalJson(s)).toBe(before);
  });

  it('stamps seq from a sequenced action', () => {
    const s = readyTable(1);
    const a = { ...act('life', { seat: 's0', delta: -1 }), seq: 42 };
    expect(reduce(s, a).seq).toBe(42);
  });

  it('rejects malformed actions without throwing', () => {
    const s = readyTable(1);
    const bad = [
      { type: 'tap', by: 's0', cid: 'x' },
      { type: 'nonsense', by: 's0', cid: 'x' },
      { type: 'move', by: 's0', cid: 'x', card: 'a00', to: 'battlefield:s0', pose: { x: Number.NaN, y: 0, rot: 0 } },
      { type: 'counter', by: 's0', cid: 'x', card: 'a00', kind: '+1/+1', delta: 0.5 },
      { type: 'createToken', by: 's0', cid: 'x', card: '__proto__', zone: 'battlefield:s0', pose: P(0, 0), label: 'x' },
      null,
    ] as unknown as Action[];
    for (const a of bad) {
      expect(() => reduce(s, a)).not.toThrow();
      expect(reduce(s, a)).toBe(s);
      expect(explain(s, a)).toEqual(expect.any(String));
    }
  });

  it('does not treat inherited object keys as ids', () => {
    const s = readyTable(1);
    no(s, act('tap', { card: 'constructor', tapped: true }), /unknown card/);
    no(s, act('move', { card: 'a00', to: 'toString' }), /unknown zone/);
  });

  it('explains, rather than applies, the actions owned by later packages', () => {
    let s = readyTable(2);
    s = play(s, 'a00', P(0, -200));
    const later: Action[] = [
      act('moveTemp', { card: 'a00', pose: P(0, -90) }),
      act('settle', {}),
      act('ask', { round: 'r1' }),
      act('respond', { round: 'r1', seat: 's1', response: 'ok' }),
      act('autoPass', { on: true }),
      act('shuffleCommit', { sid: 'sh', zone: 'library:s0', h: 'h' }),
      act('shuffleNonce', { sid: 'sh', nonce: 'n' }),
      act('shuffleDone', { sid: 'sh', orderHash: 'o' }),
      act('rngCommit', { rid: 'r', purpose: 'die', n: 6, h: 'h' }),
      act('rngReveal', { rid: 'r', nonce: 'n' }),
      act('packOpen', { packId: 'p', commits: [], count: 0 }),
      act('pick', { packId: 'p', count: 1 }),
      act('packPass', { packId: 'p', to: 's1', count: 1 }),
      act('pileLook', { pile: 0, take: false }),
      act('gridTake', { grid: 0, line: 'row', index: 0 }),
    ];
    for (const a of later) no(s, a, /M1-P|M2/);
  });
});

describe('card family', () => {
  const base = (): TableState => play(play(readyTable(6), 'a00', P(0, -200)), 'a01', P(100, -200));

  it('move: public zones, draw order, controller and ordered index', () => {
    let s = base();
    expect(s.zones['battlefield:s0']!.ids).toEqual(['a00', 'a01']);
    // A newly moved card takes the highest draw order in its territory (geometry spec).
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(10, -180) }));
    expect(s.zones['battlefield:s0']!.ids).toEqual(['a01', 'a00']);
    expect(card(s, 'a00').pose).toEqual(P(10, -180));
    // To the opponent's territory: the controller follows the territory, the owner does not.
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s1', pose: P(0, 200, 180) }));
    expect(card(s, 'a00')).toMatchObject({ owner: 's0', controller: 's1', zone: 'battlefield:s1' });
    // Into an ordered zone at an index (0 = bottom).
    s = ok(s, act('move', { card: 'a00', to: 'graveyard:s0' }));
    s = ok(s, act('move', { card: 'a01', to: 'graveyard:s0', index: 0 }));
    expect(s.zones['graveyard:s0']!.ids).toEqual(['a01', 'a00']);
    expect(card(s, 'a00').controller).toBe('s0');
    no(s, act('move', { card: 'a00', to: 'hand:s0' }), /hidden/);
    no(s, act('move', { card: 'a00', to: 'stack' }), /stackPush/);
    clean(s);
  });

  it('move: a card from a hidden zone without a public identity arrives face down', () => {
    let s = readyTable(3);
    s = ok(s, act('move', { card: 'a02', to: 'battlefield:s0', pose: P(0, -150) }));
    expect(card(s, 'a02')).toMatchObject({ face: 'down', zone: 'battlefield:s0' });
    expect(card(s, 'a02').identity).toBeUndefined();
    // Flipping it up needs the identity (DESIGN "Table model": hidden-to-public needs a reveal).
    no(s, act('flip', { card: 'a02', face: 'up' }), /identity/);
    s = ok(s, act('flip', { card: 'a02', face: 'up', ref: { sid: 'x' }, salt: 'y' }));
    expect(card(s, 'a02')).toMatchObject({ face: 'up', identity: { sid: 'x' } });
    clean(s);
  });

  it('tap, flip, transform, rotate', () => {
    let s = base();
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    expect(card(s, 'a00').tapped).toBe(true);
    s = ok(s, act('flip', { card: 'a00', face: 'down' }));
    expect(card(s, 'a00').face).toBe('down');
    s = ok(s, act('flip', { card: 'a00', face: 'up' }));
    expect(card(s, 'a00').face).toBe('up');
    s = ok(s, act('transform', { card: 'a00', faceIndex: 1 }));
    expect(card(s, 'a00').faceIndex).toBe(1);
    s = ok(s, act('rotate', { card: 'a00', delta: 180 }));
    expect(card(s, 'a00').pose.rot).toBe(180);
    s = ok(s, act('rotate', { card: 'a00', delta: 270 }));
    expect(card(s, 'a00').pose.rot).toBe(90);
    s = ok(s, act('rotate', { card: 'a00', delta: -90.5 }));
    expect(card(s, 'a00').pose.rot).toBe(359.5);
    // Card actions do not reach into hidden zones.
    no(s, act('tap', { card: 'a05', tapped: true }), /hidden/);
    clean(s);
  });

  it('counter: adds, removes and drops the key at zero', () => {
    let s = base();
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    expect(card(s, 'a00').counters).toEqual({ '+1/+1': 2 });
    s = ok(s, act('counter', { card: 'a00', kind: 'loyalty', delta: 3 }));
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: -2 }));
    expect(card(s, 'a00').counters).toEqual({ loyalty: 3 });
    s = ok(s, act('counter', { card: 'a00', kind: 'loyalty', delta: -5 }));
    expect(card(s, 'a00').counters).toEqual({});
    clean(s);
  });

  it('note: sets and clears', () => {
    let s = base();
    s = ok(s, act('note', { card: 'a00', text: 'X = 3' }));
    expect(card(s, 'a00').note).toBe('X = 3');
    s = ok(s, act('note', { card: 'a00', text: '' }));
    expect('note' in card(s, 'a00')).toBe(false);
  });

  it('pile: cascade offset 14 mm toward the owner, squared piles share the pose, indices contiguous', () => {
    let s = play(play(base(), 'a02', P(200, -200)), 'a03', P(300, -200));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a01', pile: { id: 'L', index: 1, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a02', pile: { id: 'L', index: 9, kind: 'cascade' } }));
    expect(card(s, 'a00').pose).toEqual(P(0, -200));
    expect(card(s, 'a01').pose).toEqual(P(0, -200 - CASCADE));
    expect(card(s, 'a02')).toMatchObject({ pose: P(0, -200 - 2 * CASCADE), pile: { id: 'L', index: 2, kind: 'cascade' } });
    // Joining with the wrong kind is refused.
    no(s, act('pile', { card: 'a03', pile: { id: 'L', index: 0, kind: 'squared' } }), /kind/);
    // Pulling the base out: the next card becomes the base at the old anchor; indices stay contiguous.
    s = ok(s, act('pile', { card: 'a00', pile: null, pose: P(-100, -200) }));
    expect(card(s, 'a01')).toMatchObject({ pose: P(0, -200), pile: { index: 0 } });
    expect(card(s, 'a02')).toMatchObject({ pose: P(0, -200 - CASCADE), pile: { index: 1 } });
    expect(card(s, 'a00').pile).toBeUndefined();
    // Squared pile: every member on the base pose.
    s = ok(s, act('pile', { card: 'a03', pile: { id: 'Q', index: 0, kind: 'squared' } }));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'Q', index: 1, kind: 'squared' } }));
    expect(card(s, 'a00').pose).toEqual(card(s, 'a03').pose);
    clean(s);
  });

  it('pile: an opponent-side cascade (seat at 180 deg) runs toward its owner, i.e. +y', () => {
    let s = readyTable(4);
    s = play(s, 'b00', P(0, 200, 180), 's1');
    s = play(s, 'b01', P(50, 250, 180), 's1');
    s = ok(s, act('pile', { card: 'b00', pile: { id: 'O', index: 0, kind: 'cascade' } }, 's1'));
    s = ok(s, act('pile', { card: 'b01', pile: { id: 'O', index: 1, kind: 'cascade' } }, 's1'));
    expect(card(s, 'b01').pose).toEqual(P(0, 200 + CASCADE, 180));
    clean(s);
  });

  it('move: dragging a pile by its bottom card moves the pile; any other card pulls out singly', () => {
    let s = play(base(), 'a02', P(200, -200));
    for (const [i, id] of ['a00', 'a01', 'a02'].entries()) s = ok(s, act('pile', { card: id, pile: { id: 'L', index: i, kind: 'cascade' } }));
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(-300, -150) }));
    expect(card(s, 'a02').pose).toEqual(P(-300, -150 - 2 * CASCADE));
    s = ok(s, act('move', { card: 'a01', to: 'battlefield:s0', pose: P(300, -150) }));
    expect(card(s, 'a01').pile).toBeUndefined();
    expect(card(s, 'a02')).toMatchObject({ pose: P(-300, -150 - CASCADE), pile: { index: 1 } });
    // Leaving the zone leaves the pile.
    s = ok(s, act('move', { card: 'a00', to: 'graveyard:s0' }));
    expect(card(s, 'a00').pile).toBeUndefined();
    expect(card(s, 'a02')).toMatchObject({ pose: P(-300, -150), pile: { index: 0 } });
    clean(s);
  });

  it('attach and detach: tuck 10 sideways and 10 up behind the host, move with it, detach on leaving', () => {
    let s = play(play(base(), 'a02', P(200, -200)), 'a03', P(300, -200));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    expect(card(s, 'a01')).toMatchObject({ attachedTo: 'a00', pose: P(TUCK.x, -200 + TUCK.y) });
    s = ok(s, act('attach', { card: 'a02', to: 'a00' }));
    expect(card(s, 'a02').pose).toEqual(P(2 * TUCK.x, -200 + 2 * TUCK.y));
    // The attachments move with the host.
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(50, -150) }));
    expect(card(s, 'a01').pose).toEqual(P(50 + TUCK.x, -150 + TUCK.y));
    // Pulled apart: still attached.
    s = ok(s, act('move', { card: 'a01', to: 'battlefield:s0', pose: P(400, -100) }));
    expect(card(s, 'a01').attachedTo).toBe('a00');
    // No self-attachment and no cycles; both cards must share the zone.
    no(s, act('attach', { card: 'a00', to: 'a00' }), /itself/);
    no(s, act('attach', { card: 'a00', to: 'a01' }), /cycle/);
    s = ok(s, act('detach', { card: 'a02', pose: P(0, -300) }));
    expect(card(s, 'a02')).toMatchObject({ pose: P(0, -300) });
    expect(card(s, 'a02').attachedTo).toBeUndefined();
    no(s, act('detach', { card: 'a02' }), /not attached/);
    // When the host leaves the battlefield its attachments come off.
    s = ok(s, act('move', { card: 'a00', to: 'graveyard:s0' }));
    expect(card(s, 'a01').attachedTo).toBeUndefined();
    s = ok(s, act('move', { card: 'a03', to: 'graveyard:s0' }));
    no(s, act('attach', { card: 'a02', to: 'a03' }), /zone/);
    clean(s);
  });

  it('tidy: applies the client poses to the seat battlefield, keeping piles and attachments together', () => {
    let s = play(base(), 'a02', P(200, -200));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
    s = ok(s, act('pile', { card: 'a01', pile: { id: 'L', index: 1, kind: 'cascade' } }));
    s = play(s, 'a03', P(400, -200));
    s = ok(s, act('attach', { card: 'a03', to: 'a02' }));
    s = ok(s, act('tidy', { seat: 's0', poses: { a00: P(-500, -100), a02: P(-400, -100) } }));
    expect(card(s, 'a01').pose).toEqual(P(-500, -100 - CASCADE));
    expect(card(s, 'a03').pose).toEqual(P(-400 + TUCK.x, -100 + TUCK.y));
    expect(s.zones['battlefield:s0']!.ids).toEqual(['a00', 'a01', 'a02', 'a03']);
    no(s, act('tidy', { seat: 's0', poses: { b00: P(0, 0) } }), /not on/);
    clean(s);
  });

  it('createToken, copy and remove', () => {
    let s = base();
    s = ok(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(0, -50), ref: { sid: 'tok-goblin' } }));
    expect(card(s, 't1')).toMatchObject({ isToken: true, owner: 's0', controller: 's0', face: 'up', identity: { sid: 'tok-goblin' } });
    s = ok(s, act('createToken', { card: 't2', zone: 'battlefield:s0', pose: P(0, -60), label: 'Monarch' }));
    expect(card(s, 't2').tokenLabel).toBe('Monarch');
    no(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(0, 0), label: 'x' }), /exists/);
    no(s, act('createToken', { card: 't3', zone: 'hand:s0', pose: P(0, 0), label: 'x' }), /hidden/);
    no(s, act('createToken', { card: 't3', zone: 'battlefield:s0', pose: P(0, 0) }), /ref or a label/);
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 1 }));
    s = ok(s, act('copy', { card: 'c1', of: 'a00', pose: P(70, -200) }));
    expect(card(s, 'c1')).toMatchObject({ isToken: true, identity: card(s, 'a00').identity, counters: {}, zone: 'battlefield:s0' });
    s = ok(s, act('lineAdd', { line: 'l', kind: 'mark', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'a00' } }));
    s = ok(s, act('remove', { card: 'c1' }));
    expect(s.cards.c1).toBeUndefined();
    expect(s.lines.l).toBeUndefined();
    expect(s.zones['battlefield:s0']!.ids).not.toContain('c1');
    no(s, act('remove', { card: 'a00' }), /token/);
    clean(s);
  });
});

describe('zone and secrecy family', () => {
  it('toZone: public to hidden drops identity and public state; hidden zones stay sorted with a count', () => {
    let s = play(readyTable(5), 'a03', P(0, -200));
    s = ok(s, act('tap', { card: 'a03', tapped: true }));
    s = ok(s, act('counter', { card: 'a03', kind: '+1/+1', delta: 1 }));
    s = ok(s, act('note', { card: 'a03', text: 'n' }));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'mark', from: { kind: 'card', id: 'a03' }, to: { kind: 'seat', id: 's1' } }));
    s = ok(s, act('toZone', { card: 'a03', to: 'library:s0', position: 'top' }));
    const c = card(s, 'a03');
    expect(c.identity).toBeUndefined();
    expect(c).toMatchObject({ zone: 'library:s0', tapped: false, counters: {} });
    expect(c.note).toBeUndefined();
    expect(s.lines.l).toBeUndefined();
    expect(s.zones['library:s0']).toMatchObject({ count: 5, ids: libIds('s0', 5) });
    // Hidden zones of another seat are not a destination for this card.
    no(s, act('toZone', { card: 'a03', to: 'hand:s1', position: 'any' }), /belongs/);
    no(s, act('toZone', { card: 'a03', to: 'battlefield:s0', position: 'any' }), /public/);
    clean(s);
  });

  it('tokens cannot enter hidden zones', () => {
    let s = readyTable(1);
    s = ok(s, act('createToken', { card: 't', zone: 'battlefield:s0', pose: P(0, 0), label: 'x' }));
    no(s, act('toZone', { card: 't', to: 'hand:s0', position: 'any' }), /token/);
  });

  it('draw: names an opaque id in the library and moves it to the hand by default', () => {
    let s = readyTable(3);
    s = ok(s, act('draw', { instanceId: 'a01' }));
    expect(card(s, 'a01').zone).toBe('hand:s0');
    expect(s.zones['hand:s0']).toMatchObject({ count: 1, ids: ['a01'] });
    expect(s.zones['library:s0']).toMatchObject({ count: 2, ids: ['a00', 'a02'] });
    expect(card(s, 'a01').identity).toBeUndefined();
    no(s, act('draw', { instanceId: 'a01' }), /library/);
    no(s, act('draw', { instanceId: 'a00', to: 'battlefield:s0' }), /hidden/);
    clean(s);
  });

  it('reveal attaches an identity; hide drops it and turns the card face down', () => {
    let s = readyTable(2);
    s = ok(s, act('reveal', { instanceId: 'a00', ref: { sid: 'bolt', foil: true }, salt: 's' }));
    expect(card(s, 'a00').identity).toEqual({ sid: 'bolt', foil: true });
    s = ok(s, act('move', { card: 'a00', to: 'exile:s0' }));
    expect(card(s, 'a00').face).toBe('up');
    s = ok(s, act('hide', { card: 'a00' }));
    expect(card(s, 'a00')).toMatchObject({ face: 'down', zone: 'exile:s0' });
    expect(card(s, 'a00').identity).toBeUndefined();
    no(s, act('hide', { card: 'a00' }), /identity/);
    no(s, act('hide', { card: 'a01' }), /hidden/);
    clean(s);
  });

  it("mulligan: the hand goes into the library (the shuffle and draws follow as their own actions)", () => {
    let s = readyTable(10);
    for (const id of ['a03', 'a05', 'a07']) s = ok(s, act('draw', { instanceId: id }));
    s = ok(s, act('mulligan', { count: 1 }));
    expect(s.zones['hand:s0']).toMatchObject({ count: 0, ids: [] });
    expect(s.zones['library:s0']).toMatchObject({ count: 10, ids: libIds('s0', 10) });
    clean(s);
  });

  it('revealTo, lookAt and reorder are public records only', () => {
    const s = readyTable(3);
    expect(reduce(s, act('lookAt', { zone: 'library:s0', count: 2 }))).toBe(s);
    expect(reduce(s, act('revealTo', { instanceId: 'a00', seats: ['s1'] }))).toBe(s);
    expect(reduce(s, act('reorder', { zone: 'library:s0', count: 2, orderHash: 'h' }))).toBe(s);
    expect(explain(s, act('lookAt', { zone: 'library:s0', count: 2 }))).toBeNull();
    no(s, act('lookAt', { zone: 'library:s0', count: 9 }), /count/);
    no(s, act('revealTo', { instanceId: 'a00', seats: ['s7'] }), /seat/);
  });
});

describe('stack family', () => {
  const setup = (): TableState => {
    let s = readyTable(6);
    s = ok(s, act('draw', { instanceId: 'a00' }));
    s = ok(s, act('reveal', { instanceId: 'a00', ref: { sid: 'bear' }, salt: 's' }));
    return play(s, 'a01', P(0, -200));
  };

  it('stackPush: a spell card leaves the hand for the stack zone; markers carry a source; copies sit on top', () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00', note: 'kicked' }));
    expect(s.stack).toEqual([{ id: 'i1', kind: 'spell', controller: 's0', card: 'a00', note: 'kicked' }]);
    expect(card(s, 'a00')).toMatchObject({ zone: 'stack', face: 'up' });
    expect(s.zones.stack!.ids).toEqual(['a00']);
    expect(s.zones['hand:s0']!.ids).toEqual([]);
    s = ok(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a01' }, 's1'));
    expect(s.stack[1]).toEqual({ id: 'i2', kind: 'ability', controller: 's1', source: 'a01' });
    expect(card(s, 'a01').zone).toBe('battlefield:s0');
    s = ok(s, act('stackPush', { item: 'i3', kind: 'copy', copyOf: 'i1' }));
    expect(s.stack.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    no(s, act('stackPush', { item: 'i1', kind: 'trigger' }), /exists/);
    no(s, act('stackPush', { item: 'i4', kind: 'spell' }), /card/);
    no(s, act('stackPush', { item: 'i4', kind: 'spell', card: 'a00' }), /already/);
    no(s, act('stackPush', { item: 'i4', kind: 'copy', copyOf: 'zz' }), /unknown stack item/);
    clean(s);
  });

  it('stackNote and stackReorder', () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00' }));
    s = play(s, 'a02', P(100, -200));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'spell', card: 'a02' }));
    s = ok(s, act('stackPush', { item: 'i3', kind: 'trigger', source: 'a01' }));
    s = ok(s, act('stackNote', { item: 'i3', note: 'X = 3' }));
    expect(s.stack[2]!.note).toBe('X = 3');
    s = ok(s, act('stackNote', { item: 'i3', note: '' }));
    expect('note' in s.stack[2]!).toBe(false);
    s = ok(s, act('stackReorder', { item: 'i1', index: 2 }));
    expect(s.stack.map((i) => i.id)).toEqual(['i2', 'i3', 'i1']);
    expect(s.zones.stack!.ids).toEqual(['a02', 'a00']);
    clean(s);
  });

  it('stackResolve: top only; default destination is the controller battlefield; markers vanish; target lines go', () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00' }));
    s = ok(s, act('lineAdd', { line: 'tgt', kind: 'target', from: { kind: 'stackItem', id: 'i1' }, to: { kind: 'card', id: 'a01' } }));
    s = ok(s, act('lineAdd', { line: 'mk', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'card', id: 'a01' } }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'trigger', source: 'a01' }));
    no(s, act('stackResolve', { item: 'i1' }), /top/);
    s = ok(s, act('stackResolve', { item: 'i2' }));
    expect(s.stack.map((i) => i.id)).toEqual(['i1']);
    s = ok(s, act('stackResolve', { item: 'i1', pose: P(0, -100) }));
    expect(s.stack).toEqual([]);
    expect(card(s, 'a00')).toMatchObject({ zone: 'battlefield:s0', controller: 's0', pose: P(0, -100), face: 'up' });
    expect(s.lines.tgt).toBeUndefined();
    expect(s.lines.mk).toBeDefined();
    expect(s.zones.stack!.ids).toEqual([]);
    clean(s);
  });

  it('stackResolve with a given destination (an instant to the owner graveyard)', () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00', controller: 's0' }));
    s = ok(s, act('stackResolve', { item: 'i1', to: 'graveyard:s0' }));
    expect(card(s, 'a00').zone).toBe('graveyard:s0');
    expect(s.zones['graveyard:s0']!.ids).toEqual(['a00']);
    clean(s);
  });

  it("stackCounter: the top spell goes to its owner's graveyard, a marker is removed", () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00', controller: 's1' }, 's1'));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'copy', copyOf: 'i1' }));
    s = ok(s, act('stackCounter', { item: 'i2' }));
    s = ok(s, act('stackCounter', { item: 'i1' }));
    expect(card(s, 'a00')).toMatchObject({ zone: 'graveyard:s0', controller: 's0' });
    expect(s.stack).toEqual([]);
    clean(s);
  });

  it('dragging a spell out of the stack removes its item', () => {
    let s = setup();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a00' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'copy', copyOf: 'i1' }));
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(0, -300) }));
    expect(s.stack).toEqual([{ id: 'i2', kind: 'copy', controller: 's0' }]);
    clean(s);
  });
});

describe('lines family', () => {
  it('lineAdd, lineRemove, ping', () => {
    let s = play(readyTable(2), 'a00', P(0, -200));
    s = ok(s, act('lineAdd', { line: 'l1', kind: 'attack', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's1' }, label: 'go' }));
    expect(s.lines.l1).toEqual({ id: 'l1', kind: 'attack', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's1' }, by: 's0', label: 'go' });
    no(s, act('lineAdd', { line: 'l1', kind: 'mark', from: { kind: 'card', id: 'a00' }, to: { kind: 'seat', id: 's0' } }), /exists/);
    no(s, act('lineAdd', { line: 'l2', kind: 'mark', from: { kind: 'card', id: 'a01' }, to: { kind: 'seat', id: 's0' } }), /hidden/);
    no(s, act('lineAdd', { line: 'l2', kind: 'mark', from: { kind: 'seat', id: 's0' }, to: { kind: 'seat', id: 's0' } }), /itself/);
    // Ping flashes and leaves no state.
    expect(reduce(s, act('ping', { target: { kind: 'card', id: 'a00' } }))).toBe(s);
    no(s, act('ping', { target: { kind: 'card', id: 'zz' } }), /unknown/);
    s = ok(s, act('lineRemove', { line: 'l1' }));
    expect(s.lines).toEqual({});
    no(s, act('lineRemove', { line: 'l1' }), /unknown line/);
  });
});

describe('turn family', () => {
  it('phaseSet and turnPass (clears every auto-pass)', () => {
    let s = fresh();
    s = ok(s, act('phaseSet', { phase: 'main1' }));
    expect(s.turn.phase).toBe('main1');
    s = ok(s, act('turnPass', { to: 's1' }));
    expect(s.turn).toMatchObject({ number: 2, active: 's1' });
    no(s, act('turnPass', { to: 's9' }), /unknown seat or team/);
    const t = fresh('2hg', 4);
    expect(ok(t, act('turnPass', { to: 't1' })).turn.active).toBe('t1');
  });
});

describe('players family', () => {
  it('life and playerCounter; Two-Headed Giant changes the team total', () => {
    let s = fresh();
    s = ok(s, act('life', { seat: 's1', delta: -6 }));
    expect(s.seats.s1!.life).toBe(14);
    s = ok(s, act('playerCounter', { seat: 's1', kind: 'poison', delta: 2 }));
    expect(s.seats.s1!.counters).toEqual({ poison: 2 });
    s = ok(s, act('playerCounter', { seat: 's1', kind: 'poison', delta: -3 }));
    expect(s.seats.s1!.counters).toEqual({});
    no(s, act('life', { seat: 's5', delta: 1 }), /unknown seat/);
    let t = fresh('2hg', 4);
    t = ok(t, act('life', { seat: 's1', delta: -4 }));
    expect(t.teams.t0!.life).toBe(26);
    expect(t.seats.s1!.life).toBe(30);
  });

  it('seatTake, seatLeave', () => {
    let s = fresh();
    s = ok(s, act('seatLeave', { seat: 's1' }, 's1'));
    expect(s.seats.s1).toMatchObject({ name: '', ready: false });
    s = ok(s, act('seatTake', { seat: 's1', name: 'Cleo', colour: 4, peer: 'p1' }, 's1'));
    expect(s.seats.s1).toMatchObject({ name: 'Cleo', colour: 4, peer: 'p1' });
    no(s, act('seatTake', { seat: 's1', name: 'Dan', colour: 2, peer: 'p2' }), /taken/);
    no(s, act('seatTake', { seat: 's1', name: 'Dan', colour: 9 }), /colour/);
  });

  it('ready: publishes the commitment and creates the hidden library of opaque ids', () => {
    let s = fresh();
    s = ok(s, { ...act('ready', { commits: ['c2', 'c1'], instanceIds: ['z', 'y'], zone: 'library:s0' }), seq: 7 });
    expect(s.seats.s0!.ready).toBe(true);
    expect(s.commitments.s0).toEqual({ seat: 's0', commits: ['c2', 'c1'], instanceIds: ['y', 'z'], atSeq: 7 });
    expect(s.zones['library:s0']).toMatchObject({ count: 2, ids: ['y', 'z'] });
    expect(card(s, 'y')).toMatchObject({ owner: 's0', controller: 's0', zone: 'library:s0', face: 'down' });
    expect(card(s, 'y').identity).toBeUndefined();
    no(s, act('ready', { commits: ['c'], instanceIds: ['y'], zone: 'library:s1' }, 's1'), /exists/);
    no(s, act('ready', { commits: ['c'], instanceIds: ['q'], zone: 'library:s0' }, 's1'), /belongs/);
    no(s, act('ready', { commits: [], instanceIds: ['q'], zone: 'library:s1' }, 's1'), /commit/);
    clean(s);
  });
});

describe('meta family', () => {
  it('settings, stageSet, chat and caption', () => {
    let s = fresh();
    s = ok(s, act('settings', { settings: { passTimerMs: 8000 } }));
    expect(s.settings.passTimerMs).toBe(8000);
    no(s, act('settings', { settings: { passTimerMs: 500 } }), /pass timer/);
    s = ok(s, act('stageSet', { stage: 'match' }));
    expect(s.stage).toBe('match');
    expect(reduce(s, act('chat', { text: 'hi', channel: 'table' }))).toBe(s);
    expect(reduce(s, act('caption', { text: 'hi' }))).toBe(s);
  });

  it('undo applies its inverse', () => {
    let s = play(readyTable(2), 'a00', P(0, -200));
    const t = ok(s, act('tap', { card: 'a00', tapped: true }));
    s = ok(t, act('undo', { of: 'x', inverse: act('tap', { card: 'a00', tapped: false }) }));
    expect(card(s, 'a00').tapped).toBe(false);
    no(t, act('undo', { of: 'x', inverse: act('reveal', { instanceId: 'a01', ref: { sid: 'q' }, salt: 's' }) as never }), /undoable/);
  });
});

describe('geometry and edge cases', () => {
  it('cascades and tucks follow the seat angle (seats at 90 and 270 degrees)', () => {
    // Seat at 90 deg: toward its owner is -x; its right is -y.
    expect(pileMemberPose(P(0, 0, 90), 2, 'cascade')).toEqual(P(-2 * CASCADE, 0, 90));
    expect(pileMemberPose(P(0, 0, 270), 1, 'cascade')).toEqual(P(CASCADE, 0, 270));
    expect(pileMemberPose(P(5, 5, 90), 3, 'squared')).toEqual(P(5, 5, 90));
    expect(tuckPose(P(0, 0, 90), 1)).toEqual(P(TUCK.y, -TUCK.x, 90));
    expect(tuckPose(P(0, 0, 180), 2)).toEqual(P(-2 * TUCK.x, -2 * TUCK.y, 180));
  });

  it('stores poses quantised to 0.01 mm and angles in [0, 360)', () => {
    let s = readyTable(1);
    s = play(s, 'a00', P(10.004, -20.006, -90));
    expect(card(s, 'a00').pose).toEqual(P(10, -20.01, 270));
    no(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(1e9, 0) }), /pose\.x/);
  });

  it('a counter or note key such as "constructor" is data, not an inherited member', () => {
    let s = play(readyTable(1), 'a00', P(0, -200));
    s = ok(s, act('counter', { card: 'a00', kind: 'constructor', delta: 2 }));
    expect(card(s, 'a00').counters).toEqual({ constructor: 2 });
    s = ok(s, act('playerCounter', { seat: 's0', kind: 'toString', delta: 1 }));
    expect(s.seats.s0!.counters).toEqual({ toString: 1 });
    no(s, act('counter', { card: 'a00', kind: '__proto__', delta: 1 }), /counter kind/);
  });

  it('a spell resolving into its owner hand drops its identity there', () => {
    let s = readyTable(2);
    s = ok(s, act('draw', { instanceId: 'a00' }));
    s = ok(s, act('reveal', { instanceId: 'a00', ref: { sid: 'x' }, salt: 's' }));
    s = ok(s, act('stackPush', { item: 'i', kind: 'spell', card: 'a00' }));
    s = ok(s, act('stackResolve', { item: 'i', to: 'hand:s0' }));
    expect(card(s, 'a00').zone).toBe('hand:s0');
    expect(card(s, 'a00').identity).toBeUndefined();
    clean(s);
  });

  it('removing a token clears what pointed at it: attachments, piles, lines and marker sources', () => {
    let s = play(readyTable(2), 'a00', P(0, -200));
    s = ok(s, act('createToken', { card: 't', zone: 'battlefield:s0', pose: P(100, -100), label: 'Germ' }));
    s = ok(s, act('createToken', { card: 'u', zone: 'battlefield:s0', pose: P(200, -100), label: 'Germ' }));
    s = ok(s, act('pile', { card: 't', pile: { id: 'G', index: 0, kind: 'squared' } }));
    s = ok(s, act('pile', { card: 'u', pile: { id: 'G', index: 1, kind: 'squared' } }));
    s = ok(s, act('stackPush', { item: 'i', kind: 'ability', source: 't' }));
    s = ok(s, act('remove', { card: 't' }));
    expect(card(s, 'u')).toMatchObject({ pile: { index: 0 }, pose: P(100, -100) });
    expect(s.stack[0]).toEqual({ id: 'i', kind: 'ability', controller: 's0' });
    clean(s);
  });

  it('works for four seats: zones per seat, turn order by seat id', () => {
    let s = readyTable(3, 'ffa4', 4);
    expect(Object.keys(s.zones).filter((z) => z.startsWith('hand:'))).toHaveLength(4);
    s = play(s, 'c00', P(0, 500, 180), 's2');
    expect(card(s, 'c00').controller).toBe('s2');
    s = ok(s, act('turnPass', { to: 's3' }));
    expect(s.turn.active).toBe('s3');
    clean(s);
  });
});

describe('coverage of the unit table', () => {
  it('this file exercises every action family', () => {
    const families = new Set(Object.values(ACTION_FAMILIES));
    expect([...families].sort()).toEqual(['card', 'draft', 'lines', 'meta', 'players', 'randomness', 'social', 'stack', 'turn', 'zone']);
  });
});
