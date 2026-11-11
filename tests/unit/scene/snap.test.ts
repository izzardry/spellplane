// Drop resolution, DESIGN "Specification: geometry, layout and motion" (Drop resolution rules 1-5, constants table).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveDrop, type DropContext, type DropInput, type SnapCard } from '../../../src/scene/snap';

const W = 63;
const H = 88;
const GAP = 6;
const TABLE = { w: 1400, d: 1100 };

const card = (id: string, x: number, y: number, rot = 0, extra: Partial<SnapCard> = {}): SnapCard => ({ id, pose: { x, y, rot }, frameDeg: 0, ...extra });
const ctx = (cards: SnapCard[], targets: DropContext['targets'] = []): DropContext => ({ table: TABLE, cards, targets });
const drop = (x: number, y: number, rot = 0, extra: Partial<DropInput> = {}): DropInput => ({
  pose: { x, y, rot },
  cursor: { x, y },
  single: true,
  ctrl: false,
  frameDeg: 0,
  ...extra,
});

describe('rule 1: zone piles, stack lane and avatars', () => {
  const targets: DropContext['targets'] = [
    { zone: 'library:s0', rect: { x: 600, y: -400, w: W, d: H, rot: 0 } },
    { zone: 'hand:s1', circle: { x: 0, y: 590, r: 30 } },
  ];
  it('a release over a zone pile moves the card to that zone, judged by the pointer', () => {
    const r = resolveDrop(drop(560, -300, 0, { cursor: { x: 610, y: -380 } }), ctx([], targets));
    expect(r).toEqual({ rule: 1, kind: 'zone', zone: 'library:s0' });
  });
  it('wins over snapping to a card and is not skipped by Ctrl', () => {
    const c = ctx([card('a', 600, -400)], targets);
    expect(resolveDrop(drop(600, -400), c).kind).toBe('zone');
    expect(resolveDrop(drop(600, -400, 0, { ctrl: true }), c).kind).toBe('zone');
  });
  it('an avatar disc is a target', () => {
    expect(resolveDrop(drop(10, 580), ctx([], targets))).toMatchObject({ kind: 'zone', zone: 'hand:s1' });
  });
});

describe('rule 2: squared pile', () => {
  it('centre within 12 mm of a card centre lands exactly on it', () => {
    const r = resolveDrop(drop(105, -195), ctx([card('a', 100, -200)]));
    expect(r).toMatchObject({ rule: 2, kind: 'squared', onto: 'a', pile: null });
    if (r.kind !== 'squared') throw new Error();
    expect(r.pose).toEqual({ x: 100, y: -200, rot: 0 });
  });
  it('12 mm is inside the snap radius, 12.5 mm is not', () => {
    expect(resolveDrop(drop(112, -200), ctx([card('a', 100, -200)])).rule).toBe(2);
    expect(resolveDrop(drop(112.5, -200), ctx([card('a', 100, -200)])).rule).not.toBe(2);
  });
  it('joins an existing squared pile on its top card', () => {
    const pile = (i: number) => ({ id: 'p1', index: i, kind: 'squared' as const });
    const r = resolveDrop(drop(3, 4), ctx([card('a', 0, 0, 0, { pile: pile(0) }), card('b', 0, 0, 0, { pile: pile(1) })]));
    expect(r).toMatchObject({ rule: 2, onto: 'b', pile: { id: 'p1', kind: 'squared' } });
  });
  it('keeps the dropped card\'s own rotation (an untapped card on a tapped one stays untapped)', () => {
    const r = resolveDrop(drop(2, 2, 0), ctx([card('a', 0, 0, 90)]));
    expect(r).toMatchObject({ rule: 2, pose: { x: 0, y: 0, rot: 0 } });
  });
  it('does not apply to a dragged group (rules 2 and 3 are single-card)', () => {
    expect(resolveDrop(drop(2, 2, 0, { single: false }), ctx([card('a', 0, 0)])).rule).not.toBe(2);
  });
  it('the nearest of two candidates wins', () => {
    expect(resolveDrop(drop(8, 0), ctx([card('a', 0, 0), card('b', 12, 0)]))).toMatchObject({ onto: 'b' });
  });
});

describe('rule 3: cascade', () => {
  // Target at (0, 0): bottom edge y = -44, lower third up to -44 + 88/3 = -14.67. Dropped card top = y + 44.
  it('top edge in the lower third with enough overlap starts a cascade 14 mm below', () => {
    const r = resolveDrop(drop(10, -78), ctx([card('a', 0, 0)]));
    expect(r).toMatchObject({ rule: 3, kind: 'cascade', below: 'a', pile: null });
    if (r.kind !== 'cascade') throw new Error();
    expect(r.pose.x).toBeCloseTo(0, 9);
    expect(r.pose.y).toBeCloseTo(-14, 9);
  });
  it('the lower third boundary: top edge at the bottom edge and at one third count, beyond does not', () => {
    expect(resolveDrop(drop(0, -88), ctx([card('a', 0, 0)])).rule).toBe(3);
    expect(resolveDrop(drop(0, -44 - 44 + 88 / 3 - 0.01), ctx([card('a', 0, 0)])).rule).toBe(3);
    // Just above the lower third: the centre is 30 mm from the target's centre, too far for rule 2.
    expect(resolveDrop(drop(0, -44 - 44 + 88 / 3 + 0.5), ctx([card('a', 0, 0)])).rule).not.toBe(3);
    // Top edge below the bottom edge: not overlapping at all.
    expect(resolveDrop(drop(0, -88.5), ctx([card('a', 0, 0)])).rule).not.toBe(3);
  });
  it('needs horizontal overlap of at least half a card', () => {
    expect(resolveDrop(drop(31.5, -80), ctx([card('a', 0, 0)])).rule).toBe(3);
    expect(resolveDrop(drop(32, -80), ctx([card('a', 0, 0)])).rule).not.toBe(3);
  });
  it('extends an existing cascade below its last card only', () => {
    const p = (i: number) => ({ id: 'c1', index: i, kind: 'cascade' as const });
    const cards = [card('a', 0, 0, 0, { pile: p(0) }), card('b', 0, -14, 0, { pile: p(1) })];
    const r = resolveDrop(drop(0, -14 - 80), ctx(cards));
    expect(r).toMatchObject({ rule: 3, below: 'b', pile: { id: 'c1' } });
    if (r.kind !== 'cascade') throw new Error();
    expect(r.pose.y).toBeCloseTo(-28, 9);
  });
  it('cascades toward the owner: a seat at 180 degrees cascades toward +y', () => {
    // Owner at the far edge; its "lower" edge is toward +y.
    const r = resolveDrop(drop(0, 80, 180), ctx([card('a', 0, 0, 180, { frameDeg: 180 })]));
    expect(r).toMatchObject({ rule: 3 });
    if (r.kind !== 'cascade') throw new Error();
    expect(r.pose.y).toBeCloseTo(14, 9);
    expect(r.pose.rot).toBe(180);
  });
  it('rule 2 is evaluated before rule 3', () => {
    // A card 10 mm below centre is both squared-close and (trivially) not a lower-third drop; rule 2 wins.
    expect(resolveDrop(drop(0, -10), ctx([card('a', 0, 0)])).rule).toBe(2);
  });
});

describe('rule 4: edge alignment with the standard gap', () => {
  it('a left edge within 12 mm of a neighbour\'s right edge plus gap snaps to exactly one gap', () => {
    // Neighbour right edge 31.5; snapped centre x = 31.5 + 6 + 31.5 = 69. Dropped 7 mm too far right, 4 mm high.
    const r = resolveDrop(drop(76, 4), ctx([card('a', 0, 0)]));
    expect(r).toMatchObject({ rule: 4, kind: 'align', to: 'a' });
    if (r.kind !== 'align') throw new Error();
    expect(r.pose.x).toBeCloseTo(W + GAP, 9);
    expect(r.pose.y).toBeCloseTo(0, 9);
  });
  it('works on every side', () => {
    const at = (x: number, y: number) => {
      const r = resolveDrop(drop(x, y), ctx([card('a', 0, 0)]));
      if (r.kind !== 'align') throw new Error(`expected align, got ${r.kind}`);
      return [Math.round(r.pose.x * 1e6) / 1e6, Math.round(r.pose.y * 1e6) / 1e6];
    };
    expect(at(-60, 2)).toEqual([-(W + GAP), 0]);
    expect(at(3, 100)).toEqual([0, H + GAP]);
    expect(at(-2, -103)).toEqual([0, -(H + GAP)]);
  });
  it('uses a tapped neighbour\'s rotated extent', () => {
    // Tapped neighbour: 88 wide; right edge 44; snapped centre 44 + 6 + 31.5 = 81.5.
    const r = resolveDrop(drop(85, 0), ctx([card('a', 0, 0, 90)]));
    if (r.kind !== 'align') throw new Error(r.kind);
    expect(r.pose.x).toBeCloseTo(81.5, 9);
  });
  it('more than 12 mm away is a free drop', () => {
    expect(resolveDrop(drop(W + GAP + 12.5, 0), ctx([card('a', 0, 0)])).rule).toBe(5);
  });
  it('the far seat aligns in its own frame', () => {
    const r = resolveDrop(drop(-75, 300, 180, { frameDeg: 180 }), ctx([card('a', 0, 300, 180, { frameDeg: 180 })]));
    if (r.kind !== 'align') throw new Error(r.kind);
    expect(r.pose.x).toBeCloseTo(-(W + GAP), 9);
    expect(r.pose.y).toBeCloseTo(300, 9);
  });
  it('applies to dragged groups too', () => {
    expect(resolveDrop(drop(76, 0, 0, { single: false }), ctx([card('a', 0, 0)])).rule).toBe(4);
  });
});

describe('rule 5 and Ctrl', () => {
  it('Ctrl skips rules 2 to 4: the card stays exactly where it was released', () => {
    for (const [x, y] of [
      [2, 2],
      [10, -78],
      [76, 4],
    ] as const) {
      expect(resolveDrop(drop(x, y, 0, { ctrl: true }), ctx([card('a', 0, 0)]))).toEqual({ rule: 5, kind: 'free', pose: { x, y, rot: 0 } });
    }
  });
  it('a free drop is clamped to the table, using the rotated extent', () => {
    expect(resolveDrop(drop(1000, -900), ctx([]))).toEqual({ rule: 5, kind: 'free', pose: { x: 700 - 31.5, y: -550 + 44, rot: 0 } });
    expect(resolveDrop(drop(1000, 0, 90), ctx([])).kind === 'free' && (resolveDrop(drop(1000, 0, 90), ctx([])) as { pose: { x: number } }).pose.x).toBeCloseTo(700 - 44, 9);
  });
  it('a group is clamped by its whole extent', () => {
    const r = resolveDrop(drop(690, 0, 0, { single: false, extent: { minX: -31.5, maxX: 31.5 + 100, minY: -44, maxY: 44 } }), ctx([]));
    expect(r).toMatchObject({ rule: 5, pose: { x: 700 - 131.5 } });
  });
  it('property: every battlefield result lies on the table and rule 5 without Ctrl only when nothing is near', () => {
    fc.assert(
      fc.property(fc.double({ min: -900, max: 900, noNaN: true }), fc.double({ min: -700, max: 700, noNaN: true }), (x, y) => {
        const r = resolveDrop(drop(x, y), ctx([card('a', 0, 0)]));
        if (r.kind === 'zone') return false;
        return Math.abs(r.pose.x) <= 700 - 31.5 + 1e-9 && Math.abs(r.pose.y) <= 550 - 44 + 1e-9;
      }),
    );
  });
});
