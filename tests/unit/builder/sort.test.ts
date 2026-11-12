/**
 * PLAN M2-P5 acceptance: "Sorting is stable and reversible" (DESIGN "Pre-game: draft, sealed and deck building", Deck
 * building: "One key sorts into solitaire columns by colour, mana value or type"; scene/types.ts BuilderSurface.sort:
 * "stable; a second sort by the same key restores the previous layout"). Geometry from DESIGN "Specification:
 * geometry, layout and motion": card 63 × 88, cascade offset 14 toward the owner.
 */
import { describe, expect, it } from 'vitest';
import type { DeckBuild, Pose } from '../../../src/core/types';
import { areaOf, BUILDER_LAYOUT, cascadeStep, columnOf, columnsFor, columnX, liveMemo, reconcile, sortLayout, sortToggle, type Poses } from '../../../src/scene/builder';
import type { BuilderSort } from '../../../src/scene/types';
import { buildOf, draftedPool, lookup, m19, shuffled } from './helpers';

const KEYS: BuilderSort[] = ['colour', 'manaValue', 'type'];
const BOLAS = 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen';

/** Cards per column, top to bottom, as `area:column` → names. */
function columns(build: DeckBuild, poses: Poses, key: BuilderSort): Record<string, string[]> {
  const out: Record<string, { y: number; name: string }[]> = {};
  for (const c of build.cards) {
    const p = poses[c.id]!;
    const col = columnsFor(key).find((k) => Math.abs(columnX(k.index) - p.x) < 1e-6)?.key ?? `x${p.x}`;
    const k = `${areaOf(p)}:${col}`;
    (out[k] ??= []).push({ y: p.y, name: c.id });
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.sort((a, b) => b.y - a.y).map((x) => x.name)]));
}

/** A random-looking scatter of every card over the table (a layout made by hand). */
function scatter(build: DeckBuild, seed: number): Poses {
  const out: Poses = {};
  const inMain = new Set(build.main);
  shuffled(build.cards, seed).forEach((c, i) => {
    const x = -300 + ((i * 97 + seed) % 600);
    const y = inMain.has(c.id) ? 60 + ((i * 53) % 250) : -60 - ((i * 53) % 250);
    out[c.id] = { x, y, rot: 0 };
  });
  return out;
}

describe('the sort columns (DESIGN: solitaire columns by colour, mana value or type)', () => {
  it('puts each card in the column its colour, mana value or type names', () => {
    const cases: [string, Record<BuilderSort, string>][] = [
      ['Llanowar Elves', { colour: 'G', manaValue: 'mv1', type: 'creature' }],
      ['Draconic Disciple', { colour: 'M', manaValue: 'mv3', type: 'creature' }],
      ['Sarkhan, Fireblood', { colour: 'R', manaValue: 'mv3', type: 'planeswalker' }],
      ['Meteor Golem', { colour: 'C', manaValue: 'mv7', type: 'creature' }],
      ['Detection Tower', { colour: 'L', manaValue: 'land', type: 'land' }],
      ['Forest', { colour: 'L', manaValue: 'land', type: 'land' }],
      ['Divination', { colour: 'U', manaValue: 'mv3', type: 'sorcery' }],
      ['Shock', { colour: 'R', manaValue: 'mv1', type: 'instant' }],
      ['Dwindle', { colour: 'U', manaValue: 'mv3', type: 'enchantment' }],
      [BOLAS, { colour: 'M', manaValue: 'mv4', type: 'creature' }],
    ];
    for (const [name, want] of cases) for (const key of KEYS) expect([name, key, columnOf(m19(name), key).key]).toEqual([name, key, want[key]]);
    // Columns in a fixed order, lands right of the spells.
    expect(columnsFor('colour').map((c) => c.key)).toEqual(['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L']);
    expect(columnsFor('manaValue').map((c) => c.key)).toEqual(['mv0', 'mv1', 'mv2', 'mv3', 'mv4', 'mv5', 'mv6', 'mv7', 'land']);
    expect(columnsFor('type').map((c) => c.key)).toEqual(['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other']);
    // Cards whose data is loading wait in a column of their own, right of the rest.
    expect(columnOf(null, 'colour')).toMatchObject({ key: 'loading', index: 8 });
  });

  it('lays deck cards in the deck area and the rest in the sideboard area, as cascades of 14 from the top of each column', () => {
    const b = buildOf(['Llanowar Elves', 'Shock', 'Lightning Mare', 'Llanowar Elves', 'Divination', 'Forest'], ['p1', 'p3', 'p6']);
    const poses = sortLayout(b, lookup, 'colour');
    expect(columns(b, poses, 'colour')).toEqual({ 'deck:G': ['p1'], 'deck:R': ['p3'], 'deck:L': ['p6'], 'side:G': ['p4'], 'side:R': ['p2'], 'side:U': ['p5'] });
    for (const c of b.cards) expect(areaOf(poses[c.id]!)).toBe(b.main.includes(c.id) ? 'deck' : 'side');
    // Every pose is upright and every card lies inside its area.
    for (const p of Object.values(poses)) {
      expect(p.rot).toBe(0);
      const r = areaOf(p) === 'deck' ? BUILDER_LAYOUT.deck : BUILDER_LAYOUT.side;
      expect(p.x - 31.5).toBeGreaterThanOrEqual(r.x);
      expect(p.x + 31.5).toBeLessThanOrEqual(r.x + r.w);
      expect(p.y - 44).toBeGreaterThanOrEqual(r.y);
      expect(p.y + 44).toBeLessThanOrEqual(r.y + r.h);
    }
    const red = buildOf(['Shock', 'Lightning Mare', 'Volcanic Dragon']);
    const rp = sortLayout(red, lookup, 'colour');
    // Mana value order inside the column, 14 apart toward the owner.
    expect(rp.p1!.y - rp.p2!.y).toBeCloseTo(14);
    expect(rp.p2!.y - rp.p3!.y).toBeCloseTo(14);
    expect(rp.p1!.x).toBe(rp.p3!.x);
  });

  it('compresses a long column so it stays inside its area', () => {
    const many = buildOf(Array.from({ length: 60 }, () => 'Shock'));
    const poses = sortLayout(many, lookup, 'colour');
    const ys = Object.values(poses).map((p) => p.y);
    expect(Math.min(...ys) - 44).toBeGreaterThanOrEqual(BUILDER_LAYOUT.side.y);
    expect(cascadeStep(60, 'side')).toBeLessThan(14);
    expect(cascadeStep(5, 'side')).toBe(14);
  });
});

describe('sorting is stable (PLAN M2-P5 acceptance)', () => {
  it('gives the same layout whatever the layout before, for every key', () => {
    const b = draftedPool();
    b.main = b.cards.filter((_, i) => i % 3 === 0).map((c) => c.id);
    for (const key of KEYS) {
      const want = sortLayout(b, lookup, key);
      for (const seed of [1, 7, 42]) expect(sortLayout({ ...b, poses: scatter(b, seed) }, lookup, key)).toEqual(want);
      // Deck order does not move cards either.
      expect(sortLayout({ ...b, main: [...b.main].reverse() }, lookup, key)).toEqual(want);
    }
  });

  it('orders a column by mana value, then name, and keeps pool order between equal cards', () => {
    const b = buildOf(['Llanowar Elves', 'Colossal Dreadmaw', 'Llanowar Elves', 'Gigantosaurus', 'Llanowar Elves*']);
    const order = (bb: DeckBuild) => columns(bb, sortLayout(bb, lookup, 'colour'), 'colour')['side:G'];
    // Elves (mv1) p1, p3, then the foil p5 (non-foil first), Gigantosaurus (mv5), Dreadmaw (mv6).
    expect(order(b)).toEqual(['p1', 'p3', 'p5', 'p4', 'p2']);
    // Swapping two equal cards in the pool swaps them in the column, nothing else moves.
    const swapped = { ...b, cards: [b.cards[2]!, b.cards[1]!, b.cards[0]!, b.cards[3]!, b.cards[4]!] };
    expect(order(swapped)).toEqual(['p3', 'p1', 'p5', 'p4', 'p2']);
  });

  it('never changes the deck, the cards or their order', () => {
    const b = draftedPool();
    b.main = ['p3', 'p1', 'p2'];
    const before = JSON.stringify({ cards: b.cards, main: b.main });
    for (const key of KEYS) sortToggle(b, reconcile(b, lookup, 'colour'), lookup, key, null);
    expect(JSON.stringify({ cards: b.cards, main: b.main })).toBe(before);
  });
});

describe('sorting is reversible (PLAN M2-P5 acceptance)', () => {
  it('the same key again restores the hand-made layout exactly', () => {
    const b = draftedPool();
    b.main = b.cards.slice(0, 15).map((c) => c.id);
    const mine = scatter(b, 3);
    for (const key of KEYS) {
      const first = sortToggle(b, mine, lookup, key, null);
      expect(first.restored).toBe(false);
      expect(first.poses).toEqual(sortLayout(b, lookup, key));
      const second = sortToggle(b, first.poses, lookup, key, first.memo);
      expect(second.restored).toBe(true);
      expect(second.poses).toEqual(mine);
      expect(second.memo).toBeNull();
      // And once more sorts again.
      const third = sortToggle(b, second.poses, lookup, key, second.memo);
      expect(third.poses).toEqual(first.poses);
    }
  });

  it('a chain of sorts unwinds one step at a time: colour, then type, then type again gives the colour layout back', () => {
    const b = draftedPool();
    const start = reconcile(b, lookup, 'colour');
    const byColour = sortToggle(b, scatter(b, 9), lookup, 'colour', null);
    const byType = sortToggle(b, byColour.poses, lookup, 'type', byColour.memo);
    expect(byType.poses).not.toEqual(byColour.poses);
    const back = sortToggle(b, byType.poses, lookup, 'type', byType.memo);
    expect(back.poses).toEqual(byColour.poses);
    expect(start).toEqual(sortLayout(b, lookup, 'colour'));
  });

  it('the chain is a stack: hand-made, colour, type, type, colour ends at the hand-made layout', () => {
    const b = draftedPool();
    b.main = b.cards.slice(0, 12).map((c) => c.id);
    const mine = scatter(b, 11);
    const byColour = sortToggle(b, mine, lookup, 'colour', null);
    const byType = sortToggle(b, byColour.poses, lookup, 'type', byColour.memo);
    const backToColour = sortToggle(b, byType.poses, lookup, 'type', byType.memo);
    expect(backToColour.restored).toBe(true);
    expect(backToColour.poses).toEqual(byColour.poses);
    const backToMine = sortToggle(b, backToColour.poses, lookup, 'colour', backToColour.memo);
    expect(backToMine.restored).toBe(true);
    expect(backToMine.poses).toEqual(mine);
    expect(backToMine.memo).toBeNull();
    // A different key in the middle of the chain sorts and goes on top; unwinding passes through it.
    const mv = sortToggle(b, byType.poses, lookup, 'manaValue', byType.memo);
    const u1 = sortToggle(b, mv.poses, lookup, 'manaValue', mv.memo);
    expect(u1.poses).toEqual(byType.poses);
    const u2 = sortToggle(b, u1.poses, lookup, 'type', u1.memo);
    const u3 = sortToggle(b, u2.poses, lookup, 'colour', u2.memo);
    expect(u3.poses).toEqual(mine);
  });

  it('a restore brings back the column key from before the undone sort (labels, double-click and dispenser placement)', () => {
    const b = draftedPool();
    // A fresh pool lies by colour, colour is the key in force.
    const fresh = reconcile(b, lookup, 'colour');
    const byType = sortToggle(b, fresh, lookup, 'type', null, 'colour');
    expect(byType.key).toBe('type');
    const back = sortToggle(b, byType.poses, lookup, 'type', byType.memo, byType.key);
    expect(back.restored).toBe(true);
    expect(back.poses).toEqual(fresh);
    expect(back.key).toBe('colour');
    // A chain: colour, type, mana value, then mana value again shows the type layout under the type key.
    const c1 = sortToggle(b, fresh, lookup, 'colour', null, 'colour');
    const c2 = sortToggle(b, c1.poses, lookup, 'type', c1.memo, c1.key);
    const c3 = sortToggle(b, c2.poses, lookup, 'manaValue', c2.memo, c2.key);
    const u1 = sortToggle(b, c3.poses, lookup, 'manaValue', c3.memo, c3.key);
    expect([u1.restored, u1.key]).toEqual([true, 'type']);
    expect(u1.poses).toEqual(c2.poses);
    const u2 = sortToggle(b, u1.poses, lookup, 'type', u1.memo, u1.key);
    expect([u2.restored, u2.key]).toEqual([true, 'colour']);
    // From a hand-made layout made while mana value was in force, the restore gives mana value back.
    const mine = scatter(b, 4);
    const s1 = sortToggle(b, mine, lookup, 'type', null, 'manaValue');
    const s2 = sortToggle(b, s1.poses, lookup, 'type', s1.memo, s1.key);
    expect([s2.restored, s2.key]).toEqual([true, 'manaValue']);
  });

  it('cards sorted into the loading column: once their data arrives the memo lapses, so the key sorts them in', () => {
    const b = draftedPool();
    const late = new Set(['p1', 'p2']);
    const sidLate = new Set(b.cards.filter((c) => late.has(c.id)).map((c) => c.ref.sid));
    const loading = (ref: { sid: string }) => (sidLate.has(ref.sid) ? null : lookup(ref));
    const mine = scatter(b, 7);
    const sorted = sortToggle(b, mine, loading, 'type', null, 'colour');
    const loadingX = columnX(columnsFor('type').length);
    expect(sorted.poses.p1!.x).toBe(loadingX);
    // Still loading: the memo applies, the same key restores.
    expect(liveMemo(b, sorted.poses, loading, sorted.memo)).toBe(sorted.memo);
    // The data arrived: the memo lapses and the key sorts again, into the right columns.
    expect(liveMemo(b, sorted.poses, lookup, sorted.memo)).toBeNull();
    const again = sortToggle(b, sorted.poses, lookup, 'type', liveMemo(b, sorted.poses, lookup, sorted.memo), sorted.key);
    expect(again.restored).toBe(false);
    expect(again.poses.p1!.x).toBe(columnX(columnOf(lookup(b.cards[0]!.ref), 'type').index));
    // A moved card makes it lapse too.
    expect(liveMemo(b, { ...sorted.poses, p3: { x: 0, y: 0, rot: 0 } }, loading, sorted.memo)).toBeNull();
  });

  it('after a card was moved, the key sorts again instead of restoring', () => {
    const b = draftedPool();
    const mine = scatter(b, 5);
    const sorted = sortToggle(b, mine, lookup, 'manaValue', null);
    const moved: Poses = { ...sorted.poses, p1: { x: 330, y: -200, rot: 0 } as Pose };
    const again = sortToggle(b, moved, lookup, 'manaValue', sorted.memo);
    expect(again.restored).toBe(false);
    expect(again.poses).toEqual(sortLayout(b, lookup, 'manaValue'));
  });

  it('restoring keeps cards that joined the deck since in the deck', () => {
    const b = draftedPool();
    const mine = reconcile(b, lookup, 'colour');
    const sorted = sortToggle(b, mine, lookup, 'type', null);
    // A card moved to the deck in the list view: the shown layout places it in the deck area, so no restore.
    const withDeck = { ...b, main: ['p2'], poses: sorted.poses };
    const shown = reconcile(withDeck, lookup, 'type');
    expect(areaOf(shown.p2!)).toBe('deck');
    const r = sortToggle(withDeck, shown, lookup, 'type', sorted.memo);
    expect(r.restored).toBe(false);
    expect(areaOf(r.poses.p2!)).toBe('deck');
  });
});
