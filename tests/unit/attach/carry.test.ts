/**
 * PLAN Milestone 6, owner decisions, Attach by overlap (DESIGN "Card manipulation", Placement and piles: "Piles carry
 * like solitaire"; Attach): the carry rule as core computes it (core/clips.ts carryGroup), the tuck in the engine
 * (behind the host, further attachments behind the previous one, a moved host keeps them behind it), and attachments
 * travelling with their host on attack and block moves and coming back with it on Settle.
 */
import { describe, expect, it } from 'vitest';
import { carryGroup } from '../../../src/core/clips';
import { GEOMETRY } from '../../../src/core/geometry';
import { checkInvariants } from '../../../src/core/invariants';
import { tuckPose } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { P, act, card, ok, play, readyTable } from '../core/helpers';

const CASCADE = GEOMETRY.cascadeOffset;

/**
 * Seat 0: a cascade L = [a00, a01, a02, a03] (bottom first), a creature a04 with an Aura a05 tucked behind it and an
 * Equipment a06 attached to the Aura (attachments recurse), a squared pile Q = [a07, a08, a09], a loose a10.
 * Hand: a11.
 */
function table(): TableState {
  let s = readyTable(14);
  s = play(s, 'a00', P(-300, -200));
  for (const [i, id] of ['a01', 'a02', 'a03'].entries()) {
    s = play(s, id, P(-300, -200 - CASCADE * (i + 1)));
    s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 0, kind: 'cascade' } }));
  }
  // Rebuild L cleanly: a00 base, then a01..a03 joined in order.
  s = ok(s, act('pile', { card: 'a00', pile: null }));
  for (const [i, id] of ['a00', 'a01', 'a02', 'a03'].entries()) s = ok(s, act('pile', { card: id, pile: { id: 'L', index: i, kind: 'cascade' } }));
  s = play(s, 'a04', P(0, -200));
  s = play(s, 'a05', P(200, -200));
  s = ok(s, act('attach', { card: 'a05', to: 'a04' }));
  s = play(s, 'a06', P(300, -200));
  s = ok(s, act('attach', { card: 'a06', to: 'a05' }));
  for (const [i, id] of ['a07', 'a08', 'a09'].entries()) {
    s = play(s, id, P(300, -100));
    s = ok(s, act('pile', { card: id, pile: { id: 'Q', index: i, kind: 'squared' } }));
  }
  s = play(s, 'a10', P(400, -300));
  s = ok(s, act('draw', { instanceId: 'a11' }));
  expect(checkInvariants(s)).toEqual([]);
  return s;
}

describe('carry rule (core/clips.ts carryGroup)', () => {
  it('the bottom card of a cascade takes the whole pile', () => {
    const g = carryGroup(table(), 'a00');
    expect(g.cards).toEqual(['a00', 'a01', 'a02', 'a03']);
    expect(g.reason).toEqual({ a01: 'cascade', a02: 'cascade', a03: 'cascade' });
    expect(g.leavesPile).toBeNull();
  });

  it('a card in the middle of a cascade takes itself and the cards below it, and leaves its pile', () => {
    const g = carryGroup(table(), 'a01');
    expect(g.cards).toEqual(['a01', 'a02', 'a03']);
    expect(g.leavesPile).toBe('L');
    expect(carryGroup(table(), 'a03')).toMatchObject({ cards: ['a03'], leavesPile: 'L' });
  });

  it('a host carries its attachments, recursively; an attachment dragged alone leaves its host', () => {
    // Riders bottom to top in draw order: the Equipment is tucked behind the Aura, the Aura behind the creature.
    expect(carryGroup(table(), 'a04')).toMatchObject({ cards: ['a04', 'a06', 'a05'], reason: { a05: 'attached', a06: 'attached' }, leavesHost: null });
    expect(carryGroup(table(), 'a05')).toMatchObject({ cards: ['a05', 'a06'], leavesHost: 'a04' });
    expect(carryGroup(table(), 'a06')).toMatchObject({ cards: ['a06'], leavesHost: 'a05' });
  });

  it('a squared pile: the bottom card takes the pile, the top card comes alone', () => {
    expect(carryGroup(table(), 'a07').cards).toEqual(['a07', 'a08', 'a09']);
    expect(carryGroup(table(), 'a09')).toMatchObject({ cards: ['a09'], leavesPile: 'Q' });
  });

  it('clipped cards move as one group from any of their cards, chained, with everything riding on them', () => {
    let s = ok(table(), act('clipAdd', { clip: 'k1', cards: ['a10', 'a04'], anchor: { card: 'a10', x: 0, y: 0 } }));
    s = ok(s, act('clipAdd', { clip: 'k2', cards: ['a10', 'a02'], anchor: { card: 'a10', x: 0, y: 10 } }));
    const g = carryGroup(s, 'a10');
    expect(new Set(g.cards)).toEqual(new Set(['a10', 'a04', 'a05', 'a06', 'a02', 'a03']));
    expect(g.reason).toMatchObject({ a04: 'clip', a02: 'clip', a05: 'attached', a06: 'attached', a03: 'cascade' });
    // From the Equipment: it is clipped to nothing, but its host chain is not dragged along (it leaves its host).
    expect(carryGroup(s, 'a06').cards).toEqual(['a06']);
    // From the Aura's host's clip-mate a02: the same group.
    expect(new Set(carryGroup(s, 'a02').cards)).toEqual(new Set(g.cards));
    // A tucked card clipped to its host does not leave it: the clip brings the host along.
    s = ok(s, act('clipAdd', { clip: 'k3', cards: ['a04', 'a05'], anchor: { card: 'a04', x: 0, y: 40 } }));
    expect(carryGroup(s, 'a05').leavesHost).toBeNull();
  });

  it('a selection moves every selected battlefield card with its riders; the anchor comes first', () => {
    const g = carryGroup(table(), 'a10', { selection: ['a10', 'a04', 'a11'] });
    expect(g.cards[0]).toBe('a10');
    expect(new Set(g.cards)).toEqual(new Set(['a10', 'a04', 'a05', 'a06']));
    expect(g.reason.a04).toBe('selection');
    // Not in the selection: the selection does not come along.
    expect(carryGroup(table(), 'a10', { selection: ['a04'] }).cards).toEqual(['a10']);
  });

  it('lists the riders bottom to top in draw order', () => {
    const s = table();
    const g = carryGroup(s, 'a04');
    const ids = s.zones['battlefield:s0']!.ids;
    const rest = g.cards.slice(1);
    expect([...rest].sort((x, y) => ids.indexOf(x) - ids.indexOf(y))).toEqual(rest);
  });

  it('cards off the battlefield move alone; unknown cards move nothing', () => {
    expect(carryGroup(table(), 'a11')).toEqual({ anchor: 'a11', cards: ['a11'], reason: {}, leavesPile: null, leavesHost: null });
    expect(carryGroup(table(), 'zz').cards).toEqual([]);
  });

  it('temporary moves leave pile riders behind but keep attachments (piles: false)', () => {
    expect(carryGroup(table(), 'a00', { piles: false }).cards).toEqual(['a00']);
    expect(carryGroup(table(), 'a04', { piles: false }).cards).toEqual(['a04', 'a06', 'a05']);
  });
});

describe('tuck in the engine (attach)', () => {
  it('tucks the attachment behind its host at the tuck offset; further attachments fan behind the previous one', () => {
    let s = readyTable(6);
    s = play(s, 'a00', P(0, -200));
    s = play(s, 'a01', P(100, -200));
    s = play(s, 'a02', P(200, -200));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = ok(s, act('attach', { card: 'a02', to: 'a00' }));
    expect(card(s, 'a01').pose).toEqual(tuckPose(P(0, -200), 1));
    expect(card(s, 'a02').pose).toEqual(tuckPose(P(0, -200), 2));
    expect(card(s, 'a01').pose).toEqual(P(10, -190));
    expect(s.zones['battlefield:s0']!.ids).toEqual(['a02', 'a01', 'a00']);
  });

  it('a host moved to the top of the draw order keeps its attachments directly behind it', () => {
    let s = readyTable(6);
    s = play(s, 'a00', P(0, -200));
    s = play(s, 'a01', P(100, -200));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = play(s, 'a02', P(300, -200));
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(-100, -100) }));
    expect(s.zones['battlefield:s0']!.ids).toEqual(['a02', 'a01', 'a00']);
    expect(card(s, 'a01').pose).toEqual(P(-90, -90));
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('attachments in combat (owner decisions, Combat and Settle)', () => {
  it('an attacking creature takes its attachments, and Settle brings them back', () => {
    let s = readyTable(6);
    s = play(s, 'a00', P(0, -200));
    s = play(s, 'a01', P(100, -200));
    s = play(s, 'a02', P(200, -200));
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = ok(s, act('attach', { card: 'a02', to: 'a01' }));
    const before = { a01: card(s, 'a01').pose, a02: card(s, 'a02').pose };
    s = ok(s, act('moveTemp', { card: 'a00', pose: P(0, -90), combat: 'attack', tap: true }));
    expect(card(s, 'a01').pose).toEqual({ ...before.a01, y: before.a01.y + 110 });
    expect(card(s, 'a02').pose).toEqual({ ...before.a02, y: before.a02.y + 110 });
    expect(card(s, 'a01').attachedTo).toBe('a00');
    s = ok(s, act('settle', {}));
    expect(card(s, 'a00').pose).toEqual(P(0, -200));
    expect(card(s, 'a01').pose).toEqual(before.a01);
    expect(card(s, 'a02').pose).toEqual(before.a02);
    expect(card(s, 'a00').tapped).toBe(true);
  });

  it('a blocker takes its attachments into the block and back', () => {
    let s = readyTable(6);
    s = play(s, 'b00', P(0, 200, 180), 's1');
    s = play(s, 'b01', P(100, 200, 180), 's1');
    s = ok(s, act('attach', { card: 'b01', to: 'b00' }, 's1'), );
    const tucked = card(s, 'b01').pose;
    s = ok(s, act('moveTemp', { card: 'b00', pose: P(0, 50, 180), combat: 'block' }, 's1'));
    expect(card(s, 'b01').pose).toEqual({ ...tucked, y: tucked.y - 150 });
    s = ok(s, act('settle', {}, 's1'));
    expect(card(s, 'b01').pose).toEqual(tucked);
  });
});
