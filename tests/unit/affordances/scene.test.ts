/**
 * PLAN M7-P5, the table side of play without keys (scene/affordances.ts): where the selection strip stands, which
 * drops go to the hand and the bottom of a library, and when a creature pushed toward an opponent attacks — the same
 * attack the Attack shortcut makes (DESIGN "Combat and annotation", Combat shortcuts 1: "slide forward across their
 * controller's front line and tap"; PLAN M7-P5: "attack by dragging a creature toward an opponent (existing combat
 * model)"). Drafts run through the real reducer.
 */
import { describe, expect, it } from 'vitest';
import { GEOMETRY, SCREEN_LAYER } from '../../../src/core/geometry';
import type { CardInstance, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg';
import { mayShowDrag } from '../../../src/scene/presence';
import { attackDrop, attackPose, inHandBand, libraryBottomSlot, opponents, pastFrontLine, rectsOverlap, sameSelectionAnchor, selectionAnchorOf, STRIP_ROOM_PX, unionRect } from '../../../src/scene/affordances';
import { pointInRect } from '../../../src/scene/math';
import { act, applyDrafts, board, card, ok, P, press } from '../combat/helpers';

const view = { x: 0, y: 0, width: 1440, height: 900 };

describe('the selection strip anchor', () => {
  it('is the selected cards\' screen box, above them when there is room, below them at the top of the screen', () => {
    const a = selectionAnchorOf(['x', 'y'], [{ x: 100, y: 300, width: 60, height: 80 }, { x: 200.4, y: 320, width: 60, height: 80 }], ['battlefield:s0', 'battlefield:s0'], view)!;
    expect(a).toEqual({ cards: ['x', 'y'], rect: { x: 100, y: 300, width: 160, height: 100 }, zone: 'battlefield:s0', above: true });
    const top = selectionAnchorOf(['x'], [{ x: 100, y: STRIP_ROOM_PX - 1, width: 60, height: 80 }], ['battlefield:s1'], view)!;
    expect(top.above).toBe(false);
  });

  it('names one zone only when every card is in it, and is null for cards off screen or none', () => {
    expect(selectionAnchorOf(['x', 'y'], [{ x: 0, y: 200, width: 10, height: 10 }, { x: 50, y: 200, width: 10, height: 10 }], ['battlefield:s0', 'stack'], view)!.zone).toBeNull();
    expect(selectionAnchorOf(['x'], [{ x: -400, y: 200, width: 60, height: 80 }], ['battlefield:s0'], view)).toBeNull();
    expect(selectionAnchorOf([], [], [], view)).toBeNull();
    expect(unionRect([])).toBeNull();
  });

  it('compares by value, so an unchanged anchor is not reported again', () => {
    const a = selectionAnchorOf(['x'], [{ x: 10, y: 300, width: 60, height: 80 }], ['battlefield:s0'], view);
    const b = selectionAnchorOf(['x'], [{ x: 10.2, y: 300, width: 60, height: 80 }], ['battlefield:s0'], view);
    expect(sameSelectionAnchor(a, b)).toBe(true);
    expect(sameSelectionAnchor(a, selectionAnchorOf(['x'], [{ x: 40, y: 300, width: 60, height: 80 }], ['battlefield:s0'], view))).toBe(false);
    expect(sameSelectionAnchor(null, null)).toBe(true);
    expect(sameSelectionAnchor(a, null)).toBe(false);
  });

  it('overlap of two boxes (the strip never covers the cards it acts on)', () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('drops into the hand and onto the bottom of a library', () => {
  it('the hand band is the bottom of the screen where the hand fan sits', () => {
    const vh = 900;
    const top = vh - vh * SCREEN_LAYER.handCardViewportFraction;
    expect(inHandBand(top + 1, vh, vh)).toBe(true);
    expect(inHandBand(vh - 2, vh, vh)).toBe(true);
    expect(inHandBand(top - 2, vh, vh)).toBe(false);
    expect(inHandBand(Number.NaN, vh, vh)).toBe(false);
  });

  it("the bottom slot sits one gap beside the library, on the battlefield side, card-sized, in the owner's frame", () => {
    const layout = mtg.layout('1v1');
    for (const sl of layout.seats) {
      const lib = sl.zones.library;
      const slot = libraryBottomSlot(lib);
      expect(slot.w).toBe(GEOMETRY.card.w);
      expect(slot.d).toBe(GEOMETRY.card.h);
      expect(Math.hypot(slot.x - lib.x, slot.y - lib.y)).toBeCloseTo(GEOMETRY.card.w + GEOMETRY.gap, 6);
      // It does not cover the library itself and stays inside the owner's territory.
      expect(pointInRect({ x: lib.x, y: lib.y }, slot)).toBe(false);
      expect(pointInRect({ x: slot.x, y: slot.y }, sl.territory)).toBe(true);
    }
  });
});

describe('a creature pushed toward an opponent attacks', () => {
  const layout = mtg.layout('1v1');
  const ctx = (s: TableState, over: Partial<Parameters<typeof attackDrop>[3]> = {}) => ({
    viewer: 's0',
    seatLayout: (seat: string) => layout.seats[s.seats[seat]?.index ?? -1] ?? null,
    territories: layout.seats.map((sl) => sl.territory),
    lane: layout.stackLane,
    avatarSeat: null,
    battlefield: (z: string) => z.startsWith('battlefield:'),
    ...over,
  });
  const cards = (s: TableState, ...ids: string[]): CardInstance[] => ids.map((id) => card(s, id));

  it('past its own front line, outside every territory: an attack with no named target', () => {
    const s = board();
    const sl = layout.seats[0]!;
    expect(pastFrontLine({ x: -150, y: -100 }, sl)).toBe(true);
    expect(pastFrontLine({ x: -150, y: -120 }, sl)).toBe(false);
    expect(attackDrop(s, cards(s, 'a00'), { x: -300, y: 0 }, ctx(s))).toEqual({ target: null });
    // Past its front line but short of the table's centre: the middle of the table is free space, a plain move.
    expect(attackDrop(s, cards(s, 'a00'), { x: -300, y: -60 }, ctx(s))).toBeNull();
    // Still in its own territory: a plain move.
    expect(attackDrop(s, cards(s, 'a00'), { x: -300, y: -150 }, ctx(s))).toBeNull();
    // Inside the opponent's territory: a permanent move (a change of control), not an attack.
    expect(attackDrop(s, cards(s, 'a00'), { x: -300, y: 300 }, ctx(s))).toBeNull();
  });

  it("onto another seat's avatar (on the table or its plate): an attack on that seat; onto the own avatar: no attack", () => {
    const s = board();
    expect(attackDrop(s, cards(s, 'a00'), { x: 0, y: 600 }, ctx(s, { avatarSeat: 's1' }))).toEqual({ target: 's1' });
    expect(attackDrop(s, cards(s, 'a00'), { x: 0, y: -600 }, ctx(s, { avatarSeat: 's0' }))).toBeNull();
  });

  it('only untapped, non-attacking cards the viewer controls on their controller\'s battlefield attack', () => {
    let s = board();
    expect(attackDrop(s, cards(s, 'b00'), { x: -300, y: 0 }, ctx(s))).toBeNull();
    s = ok(s, act('tap', { card: 'a01', tapped: true }));
    expect(attackDrop(s, cards(s, 'a01'), { x: 0, y: 0 }, ctx(s))).toBeNull();
    expect(attackDrop(s, cards(s, 'a00', 'a01'), { x: -300, y: 0 }, ctx(s))).toBeNull();
    expect(attackDrop(s, cards(s, 'a00', 'a02'), { x: -300, y: 0 }, ctx(s))).toEqual({ target: null });
    // A spectator attacks with nothing.
    expect(attackDrop(s, cards(s, 'a00'), { x: -300, y: 0 }, ctx(s, { viewer: null }))).toBeNull();
    // A card off the battlefield (still in the library) does not attack.
    expect(attackDrop(s, cards(s, 'a04'), { x: -300, y: 0 }, ctx(s))).toBeNull();
  });

  it('an empty stack lane gives way to the attack; with items on the stack a drop there stays a cast', () => {
    let s = board();
    expect(attackDrop(s, cards(s, 'a01'), { x: 0, y: 0 }, ctx(s))).toEqual({ target: null });
    s = ok(s, act('stackPush', { item: 'si1', kind: 'ability', source: 'a02', controller: 's0', round: 'r1' }));
    expect(attackDrop(s, cards(s, 'a01'), { x: 0, y: 0 }, ctx(s))).toBeNull();
    expect(attackDrop(s, cards(s, 'a01'), { x: 300, y: 0 }, ctx(s))).toEqual({ target: null });
  });

  it("lands exactly where the Attack shortcut puts it: 110 mm along the controller's forward axis, tapped", () => {
    const s0 = board();
    const viaKey = applyDrafts(s0, press(s0, 'attack', { hovered: 'a00' }));
    const viaDrag = applyDrafts(s0, [{ type: 'moveTemp', card: 'a00', pose: attackPose(card(s0, 'a00'), 0), combat: 'attack', tap: true }]);
    expect(card(viaDrag, 'a00')).toEqual(card(viaKey, 'a00'));
    // Seat 1 at 180° attacks toward -y.
    expect(attackPose(card(s0, 'b02'), 180)).toEqual(P(150, 90, 180));
    // An attacker that went home and attacks again starts from its home slot.
    const back = { ...card(viaKey, 'a00'), combat: undefined };
    expect(attackPose(back as CardInstance, 0)).toEqual(card(viaKey, 'a00').pose);
  });

  it('names the seats that can be attacked: taken seats other than the viewer', () => {
    const s = board();
    expect(opponents(s, 's0')).toEqual(['s1']);
  });
});

describe('leak scenario: the library card picked up to draw it', () => {
  it('is never shown to the others while it is dragged (which opaque id lies on top would leak the order)', () => {
    const s = board();
    const top = s.zones['library:s0']!.ids.at(-1)!;
    expect(s.cards[top]!.zone).toBe('library:s0');
    expect(mayShowDrag(s, top, 's0', false)).toBe(false);
    expect(mayShowDrag(s, top, 's0', true)).toBe(false);
  });
});
