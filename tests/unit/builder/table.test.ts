/**
 * The builder table's model (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "The pool lies on a
 * private table with the same gestures as play … A deck area and a sideboard area are marked on the table; a
 * basic-land dispenser hands out unlimited basics of any chosen printing"; "Card manipulation", Magnetic snapping and
 * piles; PLAN M2-P5/P6: "a deck built in the table view appears identically in the list view and back").
 */
import { describe, expect, it } from 'vitest';
import type { DeckBuild } from '../../../src/core/types';
import { applyDrop, areaOf, areasOf, cascadeStep, columnBottomY, columnsFor, columnSlot, columnTopY, columnX, crossOver, derivePiles, dispense, dispensedId, drawOrder, grabbed, reconcile, selectionPowerToughness, sortLayout, type Poses } from '../../../src/scene/builder';
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
    // One cascade, compressed to fit the area once 20 cards no longer fit 14 apart.
    expect(b.poses![basics[0]!.id]!.y - b.poses![basics[1]!.id]!.y).toBeCloseTo(cascadeStep(20, 'deck'));
    expect(cascadeStep(20, 'deck')).toBeLessThan(14);
  });

  it('a full column re-lays itself instead of stacking cards on one spot: 17 dispensed basics plus 2 drafted lands are all in sight', () => {
    // The usual limited deck: two drafted lands in the deck, then 17 Forests from the dispenser under the colour sort.
    let b: DeckBuild = buildOf(['Shock', 'Forest', 'Island'], ['p2', 'p3']);
    b.poses = sortLayout(b, lookup, 'colour');
    for (let i = 0; i < 17; i++) b = dispense(b, b.poses!, { sid: sid('Forest') }, lookup, 'colour');
    const lands = b.cards.filter((c) => c.id !== 'p1');
    expect(lands).toHaveLength(19);
    const spots = new Set(lands.map((c) => `${b.poses![c.id]!.x}:${b.poses![c.id]!.y.toFixed(3)}`));
    expect(spots.size).toBe(19);
    // One cascade from the top of the column to its bottom, every card inside the deck area: no squared pile hides a card.
    const piles = derivePiles(b.poses!, b.cards.map((c) => c.id));
    for (const c of lands) {
      expect(piles.get(c.id)?.kind).toBe('cascade');
      expect(b.poses![c.id]!.y).toBeGreaterThanOrEqual(columnBottomY('deck') - 1e-6);
      expect(b.poses![c.id]!.y).toBeLessThanOrEqual(columnTopY('deck') + 1e-6);
    }
    expect(new Set(lands.map((c) => piles.get(c.id)!.id)).size).toBe(1);
    // Membership is untouched by the re-lay.
    expect(b.main).toEqual(['p2', 'p3', ...b.cards.filter((c) => c.basic).map((c) => c.id)]);
    expect(reconcile(b, lookup, 'colour')).toEqual(b.poses);
  });

  it('a double-click into a full column re-lays it too; the column keeps its cards in the deck', () => {
    let b: DeckBuild = buildOf(['Forest'], []);
    b.poses = sortLayout(b, lookup, 'colour');
    for (let i = 0; i < 18; i++) b = dispense(b, b.poses!, { sid: sid('Forest') }, lookup, 'colour');
    const moved = crossOver(b, b.poses!, ['p1'], lookup, 'colour');
    expect(Object.keys(moved).length).toBeGreaterThan(1);
    const r = applyDrop(b, b.poses!, moved);
    expect(r.main).toContain('p1');
    expect(r.main).toHaveLength(19);
    const spots = new Set(r.cards.map((c) => `${r.poses![c.id]!.x}:${r.poses![c.id]!.y.toFixed(3)}`));
    expect(spots.size).toBe(19);
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
    // A squared pile's bottom card lies under its top card: a press on the count badge (pileGrab) takes the whole pile,
    // bottom first; elsewhere on the top card, the top card comes off alone.
    expect(grabbed('e', piles, new Set(), false, true)).toEqual(['d', 'e']);
    expect(grabbed('e', piles, new Set(), false, false)).toEqual(['e']);
    expect(grabbed('e', piles, new Set(), true, true)).toEqual(['e']);
    // The badge means nothing on a cascade's lower card or a loose card.
    expect(grabbed('b', piles, new Set(), false, true)).toEqual(['b']);
    expect(grabbed('f', piles, new Set(), false, true)).toEqual(['f']);
  });

  it('a drop never changes the membership of a card nobody touched, even when the dropped card becomes the base of a cascade over it', () => {
    // Divination lies in the sideboard band just below the line; Shock is dropped in the deck band 14 above it, so the
    // two read as a cascade whose base is in the deck.
    const b = buildOf(['Shock', 'Divination', 'Llanowar Elves', 'Duress'], ['p3']);
    b.poses = { p1: { x: -200, y: -150, rot: 0 }, p2: { x: 200, y: -6, rot: 0 }, p3: { x: -200, y: 200, rot: 0 }, p4: { x: 0, y: -200, rot: 0 } };
    const r = applyDrop(b, b.poses, { p1: { x: 200, y: 8, rot: 0 } });
    expect(derivePiles(r.poses!, ['p1', 'p2', 'p3']).get('p2')).toMatchObject({ kind: 'cascade', index: 1 });
    expect(r.main).toEqual(['p3', 'p1']);
    // The table keeps both where they lie (Divination is not re-laid into a sideboard column).
    expect(reconcile(r, lookup, 'colour')).toEqual(r.poses);
    // A card dropped onto the bottom of a cascade whose base lies in the deck joins the deck, even below the line; the
    // untouched card between them still stays in the sideboard.
    const c = applyDrop(r, r.poses!, { p4: { x: 200, y: -6 - 14, rot: 0 } });
    expect(c.main).toEqual(['p3', 'p1', 'p4']);
    // Moved along (dragged as part of the cascade), it follows the base too.
    const d = applyDrop(r, r.poses!, { p4: { x: 200, y: -6 - 14, rot: 0 }, p2: { x: 200, y: -6, rot: 0 } });
    expect(d.main).toEqual(['p3', 'p1', 'p4', 'p2']);
  });

  it('a pile lying across the line between the areas belongs wholly to its base card\'s area', () => {
    // A cascade at y = 20, 6, -8 (base at the top, in the deck area) and a squared pile on a spot just below the line.
    const poses: Poses = { p1: { x: 0, y: 20, rot: 0 }, p2: { x: 0, y: 6, rot: 0 }, p3: { x: 0, y: -8, rot: 0 }, p4: { x: 200, y: -5, rot: 0 }, p5: { x: 200, y: -5, rot: 0 } };
    const areas = areasOf(poses, ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect([areas.get('p1'), areas.get('p2'), areas.get('p3')]).toEqual(['deck', 'deck', 'deck']);
    expect([areas.get('p4'), areas.get('p5')]).toEqual(['side', 'side']);
    // Dropping such a cascade puts all of it in the deck, in drop order; the stored layout then reconciles unchanged.
    const b = buildOf(['Shock', 'Divination', 'Llanowar Elves', 'Duress', 'Shock']);
    b.poses = sortLayout(b, lookup, 'colour');
    const r = applyDrop(b, b.poses, { p1: poses.p1!, p2: poses.p2!, p3: poses.p3! });
    expect(r.main).toEqual(['p1', 'p2', 'p3']);
    expect(reconcile(r, lookup, 'colour')).toEqual(r.poses);
    // A card in the unmarked band between the outlines counts for the nearer area.
    expect(areaOf({ y: 12 })).toBe('deck');
    expect(areaOf({ y: -12 })).toBe('side');
  });

  it('sums the power and toughness of the selected creatures (front face; * counts 0)', () => {
    const b = buildOf(['Shock', 'Llanowar Elves', 'Llanowar Elves', 'Divination']);
    expect(selectionPowerToughness(b, ['p1', 'p2', 'p3', 'p4'], lookup)).toEqual({ creatures: 2, power: 2, toughness: 2 });
    expect(selectionPowerToughness(b, ['p1'], lookup)).toEqual({ creatures: 0, power: 0, toughness: 0 });
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
