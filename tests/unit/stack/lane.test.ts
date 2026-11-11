/**
 * The stack lane's geometry and reading (PLAN M1-P3; DESIGN "The effect stack", Reading it; "Specification: geometry,
 * layout and motion": stack lane 200 × 320 at the table centre, cascade offset 22, rotated for each viewer so it
 * cascades toward them).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import type { Rect } from '../../../src/games/types';
import { placeCards } from '../../../src/scene/layout';
import { entryAt, hoverHighlights, itemAnchor, slotAt, stackEntries, stackSlotPose, STACK_STEP } from '../../../src/scene/stack';
import { fakeGame } from '../../../src/ui/fakes';
import { P, act, ok, play, readyTable } from '../core/helpers';

const LANE: Rect = { x: 0, y: 0, w: 200, d: 320, rot: 0 };
const seqd = (s: TableState, a: Action): TableState => ok(s, { ...a, seq: s.seq + 1 } as Action);

/** Anna (s0) and Ben (s1); Anna's creature a00 and Ben's b00 on the battlefields, spells a01 and b01 revealed. */
function table(): TableState {
  let s = readyTable(4);
  s = play(s, 'a00', P(-100, -300));
  s = play(s, 'b00', P(100, 300, 180), 's1');
  s = ok(s, act('reveal', { instanceId: 'a01', ref: { sid: 'sid-a01' }, salt: 'x' }));
  s = ok(s, act('reveal', { instanceId: 'b01', ref: { sid: 'sid-b01' }, salt: 'x' }, 's1'));
  return s;
}

/** A spell by Anna, Ben's ability of b00, then Anna's copy of the spell. */
function stacked(): TableState {
  let s = table();
  s = seqd(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1', note: 'X = 3' }));
  s = seqd(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'b00', round: 'r2' }, 's1'));
  s = seqd(s, act('stackPush', { item: 'i3', kind: 'copy', copyOf: 'i1', round: 'r3' }));
  return s;
}

describe('cascade (DESIGN "Specification: geometry, layout and motion", Stack lane)', () => {
  it('bottom item at the far end of the lane, each newer one 22 mm toward the viewer', () => {
    expect(STACK_STEP).toBe(22);
    expect(stackSlotPose(LANE, 0, 0)).toEqual({ x: 0, y: 160 - 44, rot: 0 });
    expect(stackSlotPose(LANE, 1, 0)).toEqual({ x: 0, y: 160 - 44 - 22, rot: 0 });
    // Ben (seat at 180°) sees the lane rotated so it cascades toward him.
    const p = stackSlotPose(LANE, 1, 180);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-(160 - 44 - 22));
    expect(p.rot).toBe(180);
  });

  it('every item takes a slot in stack order, numbered from the bottom; markers show their source\'s face', () => {
    const s = stacked();
    const e = stackEntries(s, LANE, 0);
    expect(e.map((x) => [x.item.id, x.number, x.kindLabel, x.marker, x.face])).toEqual([
      ['i1', 1, 'Spell', false, 'a01'],
      ['i2', 2, 'Ability', true, 'b00'],
      ['i3', 3, 'Copy', true, 'a01'],
    ]);
    expect(e.map((x) => x.pose.y)).toEqual([116, 94, 72]);
    expect(e[1]!.source).toBe('b00');
  });

  it('a spell card is drawn in its item\'s slot, so markers between spells keep theirs', () => {
    let s = stacked();
    s = seqd(s, act('stackPush', { item: 'i4', kind: 'spell', card: 'b01', round: 'r4' }, 's1'));
    const game = fakeGame();
    const placed = placeCards(s, { selection: [], hovered: null, privateFaces: {}, reducedMotion: true, pings: [], openPile: null }, { game, layout: game.layout('1v1'), viewerSeat: 's0' });
    expect(placed.get('a01')?.rest).toEqual(stackSlotPose(LANE, 0, 0));
    expect(placed.get('b01')?.rest).toEqual(stackSlotPose(LANE, 3, 0));
    expect(placed.get('b01')?.sort[2]).toBe(3);
  });

  it('every title strip stays visible: a newer item never covers the top 22 mm of an older one', () => {
    const e = stackEntries(stacked(), LANE, 0);
    for (let i = 1; i < e.length; i++) {
      const olderTop = e[i - 1]!.pose.y + 44;
      const newerTop = e[i]!.pose.y + 44;
      expect(olderTop - newerTop).toBe(22);
    }
  });

  it('the item whose round still waits pulses; it stops once everyone passed', () => {
    let s = stacked();
    expect(stackEntries(s, LANE, 0).map((x) => x.pending)).toEqual([false, false, true]);
    s = seqd(s, act('respond', { round: 'r3', seat: 's1', response: 'ok' }, 's1'));
    expect(stackEntries(s, LANE, 0).map((x) => x.pending)).toEqual([false, false, false]);
  });
});

describe('reading and handling the lane (DESIGN "The effect stack")', () => {
  it('the topmost entry wins under the pointer', () => {
    const e = stackEntries(stacked(), LANE, 0);
    expect(entryAt(e, { x: 0, y: 116 + 40 })?.item.id).toBe('i1'); // only the bottom item reaches that far
    expect(entryAt(e, { x: 0, y: 72 })?.item.id).toBe('i3');
    expect(entryAt(e, { x: 0, y: -300 })).toBeNull();
  });

  it('lines meet an item at its visible title strip', () => {
    const e = stackEntries(stacked(), LANE, 0);
    expect(itemAnchor(e[0]!.pose)).toEqual({ x: 0, y: 116 + 44 - 11 });
    const ben = stackEntries(stacked(), LANE, 180);
    const a = itemAnchor(ben[0]!.pose);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(-(116 + 44 - 11));
  });

  it('a drop in the lane picks the slot whose title strip is nearest, clamped to the stack', () => {
    expect(slotAt(LANE, 0, { x: 0, y: 149 }, 3)).toBe(0);
    expect(slotAt(LANE, 0, { x: 0, y: 127 }, 3)).toBe(1);
    expect(slotAt(LANE, 0, { x: 0, y: 105 }, 3)).toBe(2);
    expect(slotAt(LANE, 0, { x: 0, y: -150 }, 3)).toBe(2);
    expect(slotAt(LANE, 0, { x: 0, y: 400 }, 3)).toBe(0);
    // Ben's lane runs the other way.
    expect(slotAt(LANE, 180, { x: 0, y: -149 }, 3)).toBe(0);
    expect(slotAt(LANE, 180, { x: 0, y: -105 }, 3)).toBe(2);
    expect(slotAt(LANE, 0, { x: 0, y: 0 }, 1)).toBe(0);
  });

  it('hovering an item highlights its source and its targets', () => {
    let s = stacked();
    s = ok(s, act('lineAdd', { line: 'l1', kind: 'target', from: { kind: 'stackItem', id: 'i2' }, to: { kind: 'card', id: 'a00' } }, 's1'));
    s = ok(s, act('lineAdd', { line: 'l2', kind: 'target', from: { kind: 'card', id: 'a01' }, to: { kind: 'card', id: 'b00' } }));
    s = ok(s, act('lineAdd', { line: 'l3', kind: 'mark', from: { kind: 'stackItem', id: 'i2' }, to: { kind: 'card', id: 'b00' } }, 's1'));
    expect(hoverHighlights(s, 'i2')).toEqual(['a00', 'b00']);
    expect(hoverHighlights(s, 'i1')).toEqual(['b00']);
    expect(hoverHighlights(s, 'nope')).toEqual([]);
  });

  it('target lines live exactly as long as the item', () => {
    let s = stacked();
    s = ok(s, act('lineAdd', { line: 'l1', kind: 'target', from: { kind: 'stackItem', id: 'i3' }, to: { kind: 'card', id: 'b00' } }));
    s = ok(s, act('lineAdd', { line: 'l2', kind: 'target', from: { kind: 'card', id: 'a01' }, to: { kind: 'seat', id: 's1' } }));
    s = seqd(s, act('respond', { round: 'r3', seat: 's1', response: 'ok' }, 's1'));
    s = ok(s, act('stackResolve', { item: 'i3' }));
    expect(s.lines.l1).toBeUndefined();
    expect(s.lines.l2).toBeDefined();
    s = ok(s, act('stackResolve', { item: 'i2' }, 's1'));
    s = ok(s, act('stackResolve', { item: 'i1', to: 'graveyard:s0' }));
    expect(s.lines).toEqual({});
  });
});
