/**
 * The builder table's model (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "The pool lies on a
 * private table with the same gestures as play … A deck area and a sideboard area are marked on the table; a
 * basic-land dispenser hands out unlimited basics of any chosen printing"; "Card manipulation", Magnetic snapping and
 * piles; PLAN M2-P5/P6: "a deck built in the table view appears identically in the list view and back").
 */
import { describe, expect, it } from 'vitest';
import type { DeckBuild } from '../../../src/core/types';
import { applyDrop, areaOf, columnsFor, columnSlot, columnTopY, columnX, crossOver, derivePiles, dispense, dispensedId, drawOrder, grabbed, reconcile, sortLayout } from '../../../src/scene/builder';
import { listModel, moveToDeck, moveToPool } from '../../../src/ui/builder/list/model';
import { buildOf, draftedPool, lookup, sid } from './helpers';

const colIndex = (key: string) => columnsFor('colour').find((c) => c.key === key)!.index;

describe('where cards lie on the builder table', () => {
  it('a fresh pool (no positions yet) is laid out sorted by colour, all in the sideboard area', () => {
    const b = draftedPool();
    const shown = reconcile(b, lookup, 'colour');
    expect(shown).toEqual(sortLayout(b, lookup, 'colour'));
    for (const c of b.cards) expect(areaOf(shown[c.id]!)).toBe('side');
  });

  it('keeps stored positions that agree with deck membership and places the others at the bottom of their column', () => {
    const b = buildOf(['Shock', 'Lightning Mare', 'Divination', 'Llanowar Elves'], ['p1']);
    b.poses = {
      p1: { x: 200, y: 150, rot: 0 }, // in the deck area, in the deck: kept
      p2: { x: -100, y: -200, rot: 0 }, // sideboard, in the sideboard: kept
      p3: { x: 50, y: 100, rot: 0 }, // deck area but not in the deck: placed in the sideboard
      // p4 has no position: placed
    };
    const shown = reconcile(b, lookup, 'colour');
    expect(shown.p1).toEqual({ x: 200, y: 150, rot: 0 });
    expect(shown.p2).toEqual({ x: -100, y: -200, rot: 0 });
    expect(shown.p3).toEqual({ x: columnX(colIndex('U')), y: columnTopY('side'), rot: 0 });
    expect(shown.p4).toEqual({ x: columnX(colIndex('G')), y: columnTopY('side'), rot: 0 });
  });

  it('cards moved between deck and sideboard in the list view show up in the right area, every other card stays put', () => {
    const b = draftedPool();
    const table: DeckBuild = { ...b, main: ['p1', 'p2'], poses: sortLayout({ ...b, main: ['p1', 'p2'] }, lookup, 'colour') };
    // The list view moves p5 into the deck and p1 out (M2-P6 moveToDeck/moveToPool keep ids, order and positions).
    const listed = moveToPool(moveToDeck(table, ['p5']), ['p1']);
    expect(listed.poses).toEqual(table.poses);
    const shown = reconcile(listed, lookup, 'colour');
    expect(areaOf(shown.p5!)).toBe('deck');
    expect(areaOf(shown.p1!)).toBe('side');
    for (const c of b.cards) if (c.id !== 'p5' && c.id !== 'p1') expect(shown[c.id]).toEqual(table.poses![c.id]);
    // p5 joins the bottom of its colour column in the deck area, below any deck card there.
    const col = Math.round((shown.p5!.x - columnX(0)) / 69);
    expect(shown.p5!.x).toBeCloseTo(columnX(col));
  });

  it('ignores positions that are not numbers', () => {
    const b = buildOf(['Shock', 'Divination']);
    b.poses = { p1: { x: Number.NaN, y: 0, rot: 0 }, p2: { x: -100, y: -100, rot: 0 } };
    const shown = reconcile(b, lookup, 'colour');
    expect(Number.isFinite(shown.p1!.x)).toBe(true);
    expect(shown.p2).toEqual({ x: -100, y: -100, rot: 0 });
  });
});

describe('dropping cards: the area decides deck or sideboard', () => {
  const base = () => {
    const b = buildOf(['Shock', 'Divination', 'Llanowar Elves', '+Forest'], ['p1', 'b4']);
    b.poses = sortLayout(b, lookup, 'colour');
    return b;
  };

  it('a card dropped in the deck area joins the end of the deck; one dropped in the sideboard area leaves it', () => {
    const b = base();
    const shown = b.poses!;
    const into = applyDrop(b, shown, { p2: { x: 0, y: 120, rot: 0 } });
    expect(into.main).toEqual(['p1', 'b4', 'p2']);
    expect(into.poses!.p2).toEqual({ x: 0, y: 120, rot: 0 });
    const out = applyDrop(into, into.poses!, { p1: { x: 10, y: -150, rot: 0 } });
    expect(out.main).toEqual(['b4', 'p2']);
    // Moving within an area changes no membership and keeps deck order.
    const within = applyDrop(out, out.poses!, { p2: { x: 250, y: 300, rot: 0 } });
    expect(within.main).toEqual(['b4', 'p2']);
    // Inputs are untouched.
    expect(b.main).toEqual(['p1', 'b4']);
  });

  it('a dispensed basic dropped in the sideboard goes back to the dispenser (leaves the build); a drafted one stays', () => {
    const b = buildOf(['Forest', '+Forest'], ['p1', 'b2']);
    b.poses = sortLayout(b, lookup, 'colour');
    const r = applyDrop(b, b.poses, { b2: { x: 0, y: -100, rot: 0 }, p1: { x: 70, y: -100, rot: 0 } });
    expect(r.cards.map((c) => c.id)).toEqual(['p1']);
    expect(r.main).toEqual([]);
    expect(Object.keys(r.poses!)).toEqual(['p1']);
  });

  it('carries every card\'s position, so a reload or the other view shows the same table', () => {
    const b = base();
    const r = applyDrop(b, b.poses!, { p3: { x: -20, y: 200, rot: 0 } });
    expect(Object.keys(r.poses!).sort()).toEqual(['b4', 'p1', 'p2', 'p3']);
    expect(r.poses!.p2).toEqual(b.poses!.p2);
  });

  it('a double-click sends cards to the bottom of their column in the other area', () => {
    const b = base();
    const moved = crossOver(b, b.poses!, ['p2', 'p1'], lookup, 'colour');
    expect(areaOf(moved.p2!)).toBe('deck');
    expect(areaOf(moved.p1!)).toBe('side');
    expect(moved.p2!.x).toBe(columnX(colIndex('U')));
    const r = applyDrop(b, b.poses!, moved);
    expect(r.main).toEqual(['b4', 'p2']);
  });
});

describe('the basic-land dispenser (unlimited, any printing)', () => {
  it('adds a dispensed basic of the chosen printing to the deck, in the lands column, as often as asked', () => {
    let b: DeckBuild = buildOf(['Shock'], []);
    b.poses = sortLayout(b, lookup, 'colour');
    const forest = { sid: sid('Forest') };
    for (let i = 0; i < 20; i++) b = dispense(b, b.poses!, forest, lookup, 'colour');
    const basics = b.cards.filter((c) => c.basic);
    expect(basics).toHaveLength(20);
    expect(new Set(basics.map((c) => c.id)).size).toBe(20);
    expect(b.main).toEqual(basics.map((c) => c.id));
    for (const c of basics) {
      expect(c.ref).toEqual(forest);
      expect(areaOf(b.poses![c.id]!)).toBe('deck');
      expect(b.poses![c.id]!.x).toBe(columnX(colIndex('L')));
    }
    // The first two lie one cascade offset apart.
    expect(b.poses![basics[0]!.id]!.y - b.poses![basics[1]!.id]!.y).toBeCloseTo(14);
  });

  it('never reuses an id of the pool', () => {
    const b: DeckBuild = { cards: [{ id: 'table-basic-1', ref: { sid: sid('Forest') }, basic: true }, { id: 'table-basic-3', ref: { sid: sid('Island') }, basic: true }], main: [] };
    expect(dispensedId(b)).toBe('table-basic-2');
  });

  it('a printing chosen per basic is kept as chosen (foil too)', () => {
    const b = dispense({ cards: [], main: [] }, {}, { sid: 'f00', foil: true }, () => null, 'colour');
    expect(b.cards[0]).toEqual({ id: 'table-basic-1', ref: { sid: 'f00', foil: true }, basic: true });
  });
});

describe('piles and snapping read from positions (DESIGN "Card manipulation": piles move as one)', () => {
  it('finds cascades (14 apart, same column) and squared piles (same spot)', () => {
    const poses = {
      a: { x: 0, y: 100, rot: 0 },
      b: { x: 0, y: 86, rot: 0 },
      c: { x: 0, y: 72, rot: 0 },
      d: { x: 100, y: 0, rot: 0 },
      e: { x: 100, y: 0, rot: 0 },
      f: { x: 300, y: 0, rot: 0 },
    };
    const piles = derivePiles(poses, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(piles.get('a')).toEqual({ id: 'cas:a', index: 0, kind: 'cascade' });
    expect(piles.get('c')).toEqual({ id: 'cas:a', index: 2, kind: 'cascade' });
    expect(piles.get('d')).toEqual({ id: 'sq:d', index: 0, kind: 'squared' });
    expect(piles.get('e')).toEqual({ id: 'sq:d', index: 1, kind: 'squared' });
    expect(piles.has('f')).toBe(false);
    // The base card takes the cascade, any other card comes out alone; Alt (single) always takes one.
    expect(grabbed('a', piles, new Set(), false)).toEqual(['a', 'b', 'c']);
    expect(grabbed('b', piles, new Set(), false)).toEqual(['b']);
    expect(grabbed('a', piles, new Set(), true)).toEqual(['a']);
    // A selected card takes the selection.
    expect(grabbed('f', piles, new Set(['f', 'd']), false).sort()).toEqual(['d', 'f']);
  });

  it('draws the lower cards of a cascade over the ones above', () => {
    const order = drawOrder({ a: { x: 0, y: 100, rot: 0 }, b: { x: 0, y: 86, rot: 0 }, c: { x: 0, y: 72, rot: 0 } }, ['c', 'a', 'b']);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('a new card joins the bottom of the cascade in its column', () => {
    const shown = { a: { x: columnX(2), y: columnTopY('deck'), rot: 0 }, b: { x: columnX(2), y: columnTopY('deck') - 14, rot: 0 } };
    expect(columnSlot(shown, 'deck', 2)).toEqual({ x: columnX(2), y: columnTopY('deck') - 28, rot: 0 });
    expect(columnSlot(shown, 'side', 2)).toEqual({ x: columnX(2), y: columnTopY('side'), rot: 0 });
  });
});

describe('two views of one build (PLAN M2-P5 and P6: a deck built in the table view appears identically in the list view and back)', () => {
  it('the list view lists exactly the cards the table shows in the deck area, and its edits come back to the table', () => {
    let b: DeckBuild = draftedPool();
    b.poses = sortLayout(b, lookup, 'colour');
    // Built on the table: drag five cards into the deck area, dispense three Forests.
    const drops: Record<string, { x: number; y: number; rot: number }> = {};
    ['p1', 'p4', 'p9', 'p41', 'p42'].forEach((id, i) => (drops[id] = { x: -300 + 70 * i, y: 250, rot: 0 }));
    b = applyDrop(b, b.poses!, drops);
    for (let i = 0; i < 3; i++) b = dispense(b, b.poses!, { sid: sid('Forest') }, lookup, 'colour');
    const shown = reconcile(b, lookup, 'colour');
    const onTableDeck = b.cards.filter((c) => areaOf(shown[c.id]!) === 'deck').map((c) => c.id).sort();
    const m = listModel(b, lookup, 'colour');
    const listDeck = m.deck.groups.flatMap((g) => g.rows.flatMap((r) => r.ids)).sort();
    expect(listDeck).toEqual(onTableDeck);
    expect(m.deck.total).toBe(8);
    expect(m.pool.total + m.deck.total).toBe(b.cards.length);
    // Back: the list moves one card out; the table keeps every other card where it was.
    const back = moveToPool(b, ['p9']);
    const after = reconcile(back, lookup, 'colour');
    expect(areaOf(after.p9!)).toBe('side');
    for (const c of back.cards) if (c.id !== 'p9') expect(after[c.id]).toEqual(shown[c.id]);
  });
});
