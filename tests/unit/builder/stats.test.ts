/**
 * PLAN M2-P5 acceptance: "the stats readout matches a hand-computed fixture pool" (DESIGN "Pre-game: draft, sealed
 * and deck building", Deck building: "A live readout shows card count, mana curve, colour split and land count"; "The
 * limited minimum of 40 cards is shown as a hint, not enforced"). ui/types.ts BuilderStats: main deck only; curve over
 * non-land cards by mana value 0…7+; colours count coloured mana symbols in costs, C counts {C}.
 */
import { describe, expect, it } from 'vitest';
import type { DeckBuild } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import { builderStats, cardsToGo, costSymbols } from '../../../src/ui/builder/stats';
import { buildOf, lookup, M19 } from './helpers';

/**
 * The hand-computed pool. Main deck (21 cards), costs from tests/fixtures/scryfall/m19.json:
 *   Llanowar Elves ×2 {G} mv1 · Draconic Disciple {1}{R}{G} mv3 · Sarkhan, Fireblood {1}{R}{R} mv3 · Shock (foil) {R} mv1
 *   Lightning Mare {R}{R} mv2 · Volcanic Dragon {4}{R}{R} mv6 · Colossal Dreadmaw {4}{G}{G} mv6
 *   Gigantosaurus {G}{G}{G}{G}{G} mv5 · Meteor Golem {7} mv7 · Banefire {X}{R} mv1 · Skyscanner {3} mv3
 *   Nicol Bolas, the Ravager // the Arisen (transform; front {1}{U}{B}{R}) mv4
 *   Lands: Rupture Spire, Detection Tower, Mountain (drafted), Forest ×3 and Mountain ×2 from the dispenser.
 * Sideboard (must not count): Divination, Cancel, Murder, Phylactery Lich, Island.
 *
 * By hand: 21 cards, 8 lands, 13 non-lands.
 *   Curve: mv0 0 · mv1 4 (Elves ×2, Shock, Banefire) · mv2 1 (Mare) · mv3 3 (Disciple, Sarkhan, Skyscanner) · mv4 1
 *   (Bolas) · mv5 1 (Gigantosaurus) · mv6 2 (Volcanic Dragon, Dreadmaw) · 7+ 1 (Meteor Golem).
 *   Colours: W 0 · U 1 (Bolas) · B 1 (Bolas) · R 10 (Disciple 1, Sarkhan 2, Shock 1, Mare 2, Volcanic 2, Banefire 1,
 *   Bolas 1) · G 10 (Elves 2, Disciple 1, Dreadmaw 2, Gigantosaurus 5) · C 0.
 */
function fixturePool(): DeckBuild {
  const names = [
    'Llanowar Elves', // p1
    'Llanowar Elves', // p2
    'Draconic Disciple', // p3
    'Sarkhan, Fireblood', // p4
    'Shock*', // p5
    'Lightning Mare', // p6
    'Volcanic Dragon', // p7
    'Colossal Dreadmaw', // p8
    'Gigantosaurus', // p9
    'Meteor Golem', // p10
    'Banefire', // p11
    'Skyscanner', // p12
    'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen', // p13
    'Rupture Spire', // p14
    'Detection Tower', // p15
    'Mountain', // p16
    '+Forest', // b17
    '+Forest', // b18
    '+Forest', // b19
    '+Mountain', // b20
    '+Mountain', // b21
    'Divination', // p22 (sideboard)
    'Cancel', // p23
    'Murder', // p24
    'Phylactery Lich', // p25
    'Island', // p26
  ];
  const b = buildOf(names);
  b.main = b.cards.slice(0, 21).map((c) => c.id);
  return b;
}

describe('the readout of a hand-computed fixture pool (PLAN M2-P5 acceptance)', () => {
  it('matches card count, land count, curve and colour split computed by hand', () => {
    const s = builderStats(fixturePool(), lookup);
    expect(s).toEqual({
      cards: 21,
      lands: 8,
      curve: [0, 4, 1, 3, 1, 1, 2, 1],
      colours: { W: 0, U: 1, B: 1, R: 10, G: 10, C: 0 },
      belowMinimum: true,
    });
    expect(cardsToGo(s)).toBe(19);
  });

  it('counts the main deck only: moving sideboard cards in changes it by exactly their share', () => {
    const b = fixturePool();
    // Divination {2}{U} mv3 and Murder {1}{B}{B} mv3 into the deck.
    b.main.push('p22', 'p24');
    const s = builderStats(b, lookup);
    expect(s.cards).toBe(23);
    expect(s.lands).toBe(8);
    expect(s.curve).toEqual([0, 4, 1, 5, 1, 1, 2, 1]);
    expect(s.colours).toEqual({ W: 0, U: 2, B: 3, R: 10, G: 10, C: 0 });
  });

  it('is independent of deck order and ignores deck ids the pool lacks and repeated ids', () => {
    const b = fixturePool();
    const reversed = { ...b, main: [...b.main].reverse() };
    expect(builderStats(reversed, lookup)).toEqual(builderStats(b, lookup));
    const noisy = { ...b, main: [...b.main, 'gone', 'p1', 'p13'] };
    expect(builderStats(noisy, lookup)).toEqual(builderStats(b, lookup));
  });

  it('an empty deck reads zero everywhere and shows the hint', () => {
    const s = builderStats({ cards: fixturePool().cards, main: [] }, lookup);
    expect(s).toEqual({ cards: 0, lands: 0, curve: [0, 0, 0, 0, 0, 0, 0, 0], colours: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, belowMinimum: true });
    expect(cardsToGo(s)).toBe(40);
  });
});

describe('the 40-card hint (shown, never enforced)', () => {
  const forty = () => {
    const names = [...Array.from({ length: 23 }, () => 'Shock'), ...Array.from({ length: 17 }, () => '+Mountain')];
    const b = buildOf(names);
    b.main = b.cards.map((c) => c.id);
    return b;
  };
  it('is below at 39 and met at 40 and above', () => {
    const b = forty();
    expect(builderStats(b, lookup).belowMinimum).toBe(false);
    expect(cardsToGo(builderStats(b, lookup))).toBe(0);
    expect(builderStats({ ...b, main: b.main.slice(1) }, lookup).belowMinimum).toBe(true);
    expect(cardsToGo(builderStats({ ...b, main: b.main.slice(1) }, lookup))).toBe(1);
    const more = buildOf([...Array.from({ length: 45 }, () => 'Shock')]);
    more.main = more.cards.map((c) => c.id);
    expect(builderStats(more, lookup)).toMatchObject({ cards: 45, belowMinimum: false, curve: [0, 45, 0, 0, 0, 0, 0, 0], colours: { R: 45 } });
  });
});

describe('mana symbols', () => {
  it('counts hybrid, Phyrexian, two-brid and colourless symbols; generic, X and snow count nothing', () => {
    expect(costSymbols('{2}{W}{W}')).toEqual({ W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(costSymbols('{W/U}{W/U}{B/P}{2/G}{C}{X}{S}{10}')).toEqual({ W: 2, U: 2, B: 1, R: 0, G: 1, C: 1 });
    expect(costSymbols('{1}{R} // {1}{U}')).toEqual({ W: 0, U: 1, B: 0, R: 1, G: 0, C: 0 });
    expect(costSymbols('')).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  });

  it('reads a transforming card by its front cost and a split card by both halves; curve buckets 7 and above together', () => {
    const extra: CardData[] = [
      { id: 'split', name: 'Fire // Ice', set: 'x', collector_number: '1', rarity: 'uncommon', layout: 'split', mana_cost: '{1}{R} // {1}{U}', cmc: 4, type_line: 'Instant // Instant', colors: ['R', 'U'] },
      { id: 'big', name: 'Emrakul', set: 'x', collector_number: '2', rarity: 'mythic', layout: 'normal', mana_cost: '{15}', cmc: 15, type_line: 'Legendary Creature', colors: [] },
      { id: 'eldrazi', name: 'Thought-Knot Seer', set: 'x', collector_number: '3', rarity: 'rare', layout: 'normal', mana_cost: '{3}{C}', cmc: 4, type_line: 'Creature — Eldrazi', colors: [] },
      { id: 'mdfc', name: 'Valakut Awakening // Valakut Stoneforge', set: 'x', collector_number: '4', rarity: 'rare', layout: 'modal_dfc', cmc: 3, type_line: 'Instant // Land', card_faces: [{ name: 'Valakut Awakening', mana_cost: '{2}{R}', type_line: 'Instant' }, { name: 'Valakut Stoneforge', mana_cost: '', type_line: 'Land' }] },
    ] as CardData[];
    const all = [...M19, ...extra];
    const card = (ref: { sid: string }) => all.find((c) => c.id === ref.sid) ?? null;
    const b: DeckBuild = { cards: extra.map((c, i) => ({ id: `x${i}`, ref: { sid: c.id } })), main: ['x0', 'x1', 'x2', 'x3'] };
    const s = builderStats(b, card);
    expect(s.cards).toBe(4);
    // The modal double-faced card is cast as its front (an instant): no land.
    expect(s.lands).toBe(0);
    expect(s.curve).toEqual([0, 0, 0, 1, 2, 0, 0, 1]);
    expect(s.colours).toEqual({ W: 0, U: 1, B: 0, R: 2, G: 0, C: 1 });
  });

  it('a modal double-faced or transforming card counts its front cost only; an adventure counts both halves', () => {
    const extra: CardData[] = [
      { id: 'esika', name: 'Esika, God of the Tree // The Prismatic Bridge', set: 'x', collector_number: '1', rarity: 'mythic', layout: 'modal_dfc', cmc: 3, type_line: 'Legendary Creature — God // Legendary Enchantment', card_faces: [{ name: 'Esika, God of the Tree', mana_cost: '{1}{G}{G}', type_line: 'Legendary Creature — God' }, { name: 'The Prismatic Bridge', mana_cost: '{W}{U}{B}{R}{G}', type_line: 'Legendary Enchantment' }] },
      { id: 'tf', name: 'Delver of Secrets // Insectile Aberration', set: 'x', collector_number: '2', rarity: 'common', layout: 'transform', cmc: 1, type_line: 'Creature — Human Wizard // Creature — Human Insect', card_faces: [{ name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard' }, { name: 'Insectile Aberration', mana_cost: '{R}', type_line: 'Creature — Human Insect' }] },
      { id: 'adv', name: 'Bonecrusher Giant // Stomp', set: 'x', collector_number: '3', rarity: 'rare', layout: 'adventure', cmc: 3, type_line: 'Creature — Giant // Instant — Adventure', card_faces: [{ name: 'Bonecrusher Giant', mana_cost: '{2}{R}', type_line: 'Creature — Giant' }, { name: 'Stomp', mana_cost: '{1}{W}', type_line: 'Instant — Adventure' }] },
    ] as CardData[];
    const card = (ref: { sid: string }) => extra.find((c) => c.id === ref.sid) ?? null;
    const one = (i: number) => builderStats({ cards: extra.map((c, k) => ({ id: `x${k}`, ref: { sid: c.id } })), main: [`x${i}`] }, card).colours;
    expect(one(0)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 });
    expect(one(1)).toEqual({ W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 });
    expect(one(2)).toEqual({ W: 1, U: 0, B: 0, R: 1, G: 0, C: 0 });
  });

  it('cards whose data is still loading count toward the total only, and join the rest when it arrives', () => {
    const b = fixturePool();
    const loading = builderStats(b, () => null);
    expect(loading).toEqual({ cards: 21, lands: 0, curve: [0, 0, 0, 0, 0, 0, 0, 0], colours: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, belowMinimum: true });
    expect(builderStats(b, lookup).lands).toBe(8);
  });
});
