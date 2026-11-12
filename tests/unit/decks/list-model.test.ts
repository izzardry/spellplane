/**
 * M2-P6 acceptance (PLAN "M2-P5 and P6": a deck built in the table view appears identically in the list view and
 * back) and the list view's columns, groups, filters and counts (DESIGN "Pre-game: draft, sealed and deck building",
 * Deck building: "Two views of the same pool, switchable at any time … List view. A compact two-column list (pool and
 * deck) with filters and counts").
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import type { CardRef, DeckBuild } from '../../../src/core/types';
import type { BuilderSort } from '../../../src/scene/types';
import { addCard, cardColours, cardKind, freshId, groupOf, listModel, matches, moveToDeck, moveToPool, NO_FILTERS, oneOf, type ListColumn, type ListFilters } from '../../../src/ui/builder/list/model';
import { lookup, M19, m19, sid, tableBuild } from './helpers';

const BOLAS = 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen';
const FOREST = M19.find((c) => c.name === 'Forest')!.id;

/** Every card of a column as `count × name`, in display order. */
function rows(col: ListColumn): string[] {
  return col.groups.flatMap((g) => g.rows.map((r) => `${r.count} ${r.name}${r.ref.foil ? ' (foil)' : ''}`));
}
/** The multiset of refs a column shows. */
function refs(col: ListColumn): string[] {
  return col.groups.flatMap((g) => g.rows.flatMap((r) => r.ids.map(() => `${r.ref.sid}${r.ref.foil ? '*' : ''}`))).sort();
}
const key = (r: CardRef): string => `${r.sid}${r.foil ? '*' : ''}`;

describe('the same deck in both views (PLAN M2-P6 acceptance)', () => {
  it('the list view shows exactly the table view\'s deck and sideboard, card for card', () => {
    const build = tableBuild();
    const m = listModel(build, lookup, 'colour');
    const byId = new Map(build.cards.map((c) => [c.id, c]));
    expect(refs(m.deck)).toEqual(build.main.map((id) => key(byId.get(id)!.ref)).sort());
    expect(refs(m.pool)).toEqual(build.cards.filter((c) => !build.main.includes(c.id)).map((c) => key(c.ref)).sort());
    expect(m.deck.total).toBe(8);
    expect(m.pool.total).toBe(6);
    // Every pool card id appears in exactly one row of one column.
    const ids = [...m.deck.groups, ...m.pool.groups].flatMap((g) => g.rows.flatMap((r) => r.ids)).sort();
    expect(ids).toEqual(build.cards.map((c) => c.id).sort());
  });

  it('an edit in the list and its reverse give the table view back the very same build (positions, order, ids)', () => {
    const build = tableBuild();
    const before = canonicalJson(build);
    // Move Divination into the deck and back out; move Sarkhan out and back in at the end of the deck.
    const there = moveToDeck(build, ['p3']);
    expect(there.main).toEqual([...build.main, 'p3']);
    expect(canonicalJson(moveToPool(there, ['p3']))).toBe(before);
    expect(canonicalJson(build)).toBe(before); // edits never touch their input
    const out = moveToPool(build, ['p6']);
    expect(out.main).not.toContain('p6');
    expect(out.poses).toEqual(build.poses);
    expect(out.cards).toEqual(build.cards);
  });

  it('a build edited in the list is read back by the table view with every untouched card where it was', () => {
    const build = tableBuild();
    const elves = listModel(build, lookup, 'type').pool.groups.flatMap((g) => g.rows).find((r) => r.name === 'Divination')!;
    const next = moveToDeck(build, oneOf(elves, build, false));
    expect(next.cards).toEqual(build.cards);
    expect(next.poses).toEqual(build.poses);
    expect(next.main.slice(0, build.main.length)).toEqual(build.main);
  });

  it('showing the list changes nothing: the model is derived, and a build passed through it is unchanged', () => {
    const build = tableBuild();
    const before = canonicalJson(build);
    for (const s of ['colour', 'manaValue', 'type'] as BuilderSort[]) listModel(build, lookup, s, { text: 'elf', colours: ['G'], kind: 'creature' });
    expect(canonicalJson(build)).toBe(before);
  });
});

describe('two columns with counts', () => {
  it('identical cards are one row with a count; foils are their own row', () => {
    const m = listModel(tableBuild(), lookup, 'colour');
    expect(rows(m.deck)).toEqual(['1 Shock (foil)', '1 Sarkhan, Fireblood', '2 Llanowar Elves', '1 Draconic Disciple', '3 Forest']);
    expect(rows(m.pool)).toEqual(['1 Cancel', '1 Divination', '1 Shock', `1 ${BOLAS}`, '1 Meteor Golem', '1 Detection Tower']);
    expect(m.deckLands).toBe(3);
  });

  it('group counts add up to the column total', () => {
    const m = listModel(tableBuild(), lookup, 'manaValue');
    for (const col of [m.deck, m.pool]) expect(col.groups.reduce((n, g) => n + g.count, 0)).toBe(col.total);
  });

  it('cards whose data is still loading show in a loading group and count', () => {
    const build: DeckBuild = { cards: [{ id: 'u1', ref: { sid: 'not-loaded' } }, { id: 'p1', ref: { sid: sid('Shock') } }], main: ['u1'] };
    const m = listModel(build, lookup, 'colour');
    expect(m.deck.groups).toEqual([{ key: 'loading', label: 'Loading', count: 1, rows: [expect.objectContaining({ known: false, ids: ['u1'] })] }]);
    expect(m.deck.total).toBe(1);
  });

  it('ids the deck names but the pool lacks are ignored, not shown twice', () => {
    const build = tableBuild();
    build.main.push('ghost');
    expect(listModel(build, lookup, 'colour').deck.total).toBe(8);
  });
});

describe('sorting into groups (DESIGN "Pre-game", Deck building: by colour, mana value or type)', () => {
  const groups = (sort: BuilderSort): string[] => {
    const m = listModel(tableBuild(), lookup, sort);
    return [...m.pool.groups, ...m.deck.groups].map((g) => `${g.label}:${g.rows.map((r) => r.name.split(',')[0]).join('+')}`);
  };

  it('by colour: W U B R G, multicoloured, colourless, then lands; double-faced cards use their faces\' colours', () => {
    expect(groups('colour')).toEqual([
      'Blue:Cancel+Divination',
      'Red:Shock',
      `Multicoloured:Nicol Bolas`,
      'Colourless:Meteor Golem',
      'Lands:Detection Tower',
      'Red:Shock+Sarkhan',
      'Green:Llanowar Elves',
      'Multicoloured:Draconic Disciple',
      'Lands:Forest',
    ]);
    expect(cardColours(m19(BOLAS))).toEqual(['U', 'B', 'R']);
  });

  it('by mana value: one group per value, 7 and above together, lands last', () => {
    expect(groups('manaValue')).toEqual(['1:Shock', '3:Cancel+Divination', '4:Nicol Bolas', '7+:Meteor Golem', 'Lands:Detection Tower', '1:Llanowar Elves+Shock', '3:Draconic Disciple+Sarkhan', 'Lands:Forest']);
  });

  it('by type: creatures first (an artifact creature is a creature), lands last', () => {
    expect(groups('type')).toEqual([
      'Creatures:Nicol Bolas+Meteor Golem',
      'Instants:Shock+Cancel',
      'Sorceries:Divination',
      'Lands:Detection Tower',
      'Creatures:Llanowar Elves+Draconic Disciple',
      'Planeswalkers:Sarkhan',
      'Instants:Shock',
      'Lands:Forest',
    ]);
    expect(cardKind(m19('Meteor Golem'))).toBe('creature');
    expect(cardKind(m19('Gift of Paradise'))).toBe('enchantment');
  });

  it('is stable: the same build in any card order gives the same rows', () => {
    const build = tableBuild();
    const shuffled: DeckBuild = { ...build, cards: [...build.cards].reverse(), main: [...build.main].reverse() };
    for (const s of ['colour', 'manaValue', 'type'] as BuilderSort[]) {
      const a = listModel(build, lookup, s);
      const b = listModel(shuffled, lookup, s);
      expect([rows(b.deck), rows(b.pool)]).toEqual([rows(a.deck), rows(a.pool)]);
    }
  });

  it('every card gets exactly one group under every sort', () => {
    for (const c of M19) for (const s of ['colour', 'manaValue', 'type'] as BuilderSort[]) expect(groupOf(c, s).key).toBeTruthy();
  });
});

describe('filters', () => {
  const f = (over: Partial<ListFilters>): ListFilters => ({ ...NO_FILTERS, ...over });
  const shown = (filters: ListFilters) => {
    const m = listModel(tableBuild(), lookup, 'colour', filters);
    return { deck: rows(m.deck), pool: rows(m.pool), counts: [m.deck.shown, m.deck.total, m.pool.shown, m.pool.total] };
  };

  it('text matches name, type line and rules text, every word, case-insensitive; both columns', () => {
    expect(shown(f({ text: 'SHOCK' })).deck).toEqual(['1 Shock (foil)']);
    expect(shown(f({ text: 'shock' })).pool).toEqual(['1 Shock']);
    expect(shown(f({ text: 'elf druid' })).deck).toEqual(['2 Llanowar Elves']);
    expect(shown(f({ text: 'draw two', kind: 'sorcery' })).pool).toEqual(['1 Divination']);
    // Rules text of either face counts: Bolas's back face draws two cards.
    expect(shown(f({ text: 'draw two' })).pool).toEqual(['1 Divination', `1 ${BOLAS}`]);
    // The back face's text counts for double-faced cards.
    expect(shown(f({ text: 'arisen' })).pool).toEqual([`1 ${BOLAS}`]);
  });

  it('colours: any selected colour matches; M is multicoloured, C colourless (lands included)', () => {
    expect(shown(f({ colours: ['G'] })).deck).toEqual(['2 Llanowar Elves', '1 Draconic Disciple']);
    expect(shown(f({ colours: ['M'] })).pool).toEqual([`1 ${BOLAS}`]);
    expect(shown(f({ colours: ['C'] })).pool).toEqual(['1 Meteor Golem', '1 Detection Tower']);
    expect(shown(f({ colours: ['U', 'R'] })).pool).toEqual(['1 Cancel', '1 Divination', '1 Shock', `1 ${BOLAS}`]);
  });

  it('type, and filters combine', () => {
    expect(shown(f({ kind: 'land' })).deck).toEqual(['3 Forest']);
    expect(shown(f({ kind: 'creature', colours: ['R'] })).deck).toEqual(['1 Draconic Disciple']);
    expect(shown(f({ kind: 'instant', text: 'nothing like this' })).deck).toEqual([]);
  });

  it('counts: the totals stay, the shown counts follow the filter', () => {
    expect(shown(f({ colours: ['G'] })).counts).toEqual([3, 8, 0, 6]);
    expect(shown(NO_FILTERS).counts).toEqual([8, 8, 6, 6]);
  });

  it('a card still loading is hidden by any filter and shown without one', () => {
    expect(matches(null, NO_FILTERS)).toBe(true);
    expect(matches(null, f({ text: 'x' }))).toBe(false);
    expect(matches(null, f({ kind: 'land' }))).toBe(false);
  });
});

describe('edits', () => {
  it('moving a dispensed basic out of the deck returns it to the dispenser (the build forgets it and its position)', () => {
    const build = tableBuild();
    const forests = listModel(build, lookup, 'colour').deck.groups.flatMap((g) => g.rows).find((r) => r.name === 'Forest')!;
    expect(forests.basics).toBe(2);
    // One click takes the most recently added dispensed basic first.
    expect(oneOf(forests, build, true)).toEqual(['b2']);
    const next = moveToPool(build, ['b2']);
    expect(next.cards.map((c) => c.id)).not.toContain('b2');
    expect(next.poses).not.toHaveProperty('b2');
    expect(next.main).toEqual(build.main.filter((id) => id !== 'b2'));
    // A drafted Forest goes to the pool like any other card.
    const all = moveToPool(build, forests.ids);
    expect(all.cards.map((c) => c.id)).toContain('p12');
    expect(rows(listModel(all, lookup, 'colour').pool)).toContain('1 Forest');
  });

  it('one click on a pool row moves its first copy; moving ids that are already there does nothing', () => {
    const build = tableBuild();
    const shock = listModel(build, lookup, 'colour').pool.groups.flatMap((g) => g.rows).find((r) => r.name === 'Shock')!;
    expect(oneOf(shock, build, false)).toEqual(['p11']);
    expect(moveToDeck(build, ['p1', 'nope'])).toEqual(build);
    expect(moveToPool(build, ['p3'])).toEqual(build);
  });

  it('moving several at once keeps their order and adds each once', () => {
    const next = moveToDeck(tableBuild(), ['p9', 'p3', 'p9']);
    expect(next.main.slice(-2)).toEqual(['p9', 'p3']);
  });

  it('adding a searched card gives it a fresh id; basic lands come from the dispenser', () => {
    const build = tableBuild();
    const a = addCard(build, { sid: sid('Gift of Paradise') }, { toDeck: true, basic: false });
    const added = a.cards.at(-1)!;
    expect(added).toEqual({ id: 'list-add-1', ref: { sid: sid('Gift of Paradise') } });
    expect(a.main.at(-1)).toBe('list-add-1');
    const b = addCard(a, { sid: sid('Gift of Paradise') }, { toDeck: false, basic: false });
    expect(b.cards.at(-1)!.id).toBe('list-add-2');
    expect(b.main).toEqual(a.main);
    const c = addCard(b, { sid: FOREST }, { toDeck: true, basic: true });
    expect(c.cards.at(-1)).toEqual({ id: 'list-basic-1', ref: { sid: FOREST }, basic: true });
    expect(build.cards).toHaveLength(14);
  });

  it('fresh ids never collide with ids the table view chose', () => {
    const build: DeckBuild = { cards: [{ id: 'list-add-1', ref: { sid: 'a' } }, { id: 'list-add-2', ref: { sid: 'b' } }], main: [] };
    expect(freshId(build, 'list-add-')).toBe('list-add-3');
  });

  it('a build without table positions stays without them', () => {
    const { poses: _p, ...bare } = tableBuild();
    expect(moveToDeck(bare, ['p3'])).not.toHaveProperty('poses');
    expect(moveToPool(bare, ['b1'])).not.toHaveProperty('poses');
  });
});
