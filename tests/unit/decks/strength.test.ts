/**
 * Analysis, land suggestion, strength and the simple-deck mark (decks.md sections 4 and 5; contracts.md Part G "Decks"
 * item 3; PLAN M8-P3 unit acceptance). Scores are pinned from this code after landing within 3 points of decks.md's
 * reference table (GW 40, UR 54).
 */
import { describe, expect, it } from 'vitest';
import { analyse, curveOf, curveText, type DeckAnalysis } from '../../../src/data/deck/analyse';
import { suggestedBasics, suggestedLands } from '../../../src/data/deck/lands';
import { isSimpleDeck } from '../../../src/data/deck/simple';
import { bandNumber, bandOf, cardQuality, strength } from '../../../src/data/deck/strength';
import type { CardData } from '../../../src/data/types';
import { CARDS, decklist, lookup, named, ref, times } from './fixture-decks';
import { isLandCard } from '../../../src/data/deck/analyse';

const M19_SPELLS = CARDS.filter((c) => c.set === 'm19' && !isLandCard(c) && !/Token/.test(c.type_line) && Number(c.collector_number) <= 280);

describe('fixture decklists', () => {
  it('GW gives the hand-computed curve, 24 lands against 23 suggested, and 40 Casual', async () => {
    const { main } = await decklist('gw-m19-60.txt');
    const a = analyse(main, lookup);
    // By hand from the list: 1 Llanowar Elves 4; 2 Chaplain 3, Pridemate 3, Druid 3, Rabid Bite 3, Titanic Growth 2,
    // Revitalize 1; 3 Courser 4, Rejuvenator 2, Angel 2; 4 Warleader 2, Inspired Charge 2; 5 Gigantosaurus; 6 Dreadmaw 2; 7+ Wurm 2.
    expect(curveOf(a)).toEqual([0, 4, 15, 8, 4, 1, 2, 2]);
    expect(a.lands).toBe(24);
    expect(a.colours).toEqual(['W', 'G']);
    expect(suggestedLands(a, 60)).toBe(23);
    const s = strength(main, lookup, 60)!;
    expect(s.score).toBe(40);
    expect(s.band).toBe('casual');
    expect(s.parts.interaction).toBe(0);
    expect(s.complete).toBe(true);
  });

  it('UR gives its curve, 22 lands against 26 suggested, and 53 Solid', async () => {
    const { main } = await decklist('ur-m19-60.mtga.txt');
    const a = analyse(main, lookup);
    expect(curveOf(a)).toEqual([0, 4, 9, 14, 4, 3, 4, 0]);
    expect(a.lands).toBe(22);
    expect(suggestedLands(a, 60)).toBe(26);
    const s = strength(main, lookup, 60)!;
    expect(s.score).toBe(53);
    expect(s.band).toBe('solid');
    expect(s.parts.interaction).toBe(1);
  });

  it('the curve has a text alternative', () => {
    expect(curveText([0, 4, 15, 8, 4, 1, 2, 2])).toBe('Mana curve: 0 at 0, 4 at 1, 15 at 2, 8 at 3, 4 at 4, 1 at 5, 2 at 6, 2 at 7 or more.');
  });
});

describe('strength edges', () => {

  it('a deck with no lands scores under 15', () => {
    // Sixty different spells of every colour (decks.md section 5: "60 random spells, no lands").
    const main = M19_SPELLS.filter((_, i) => i % 4 === 0).slice(0, 60).map((c) => ({ sid: c.id }));
    expect(main).toHaveLength(60);
    expect(strength(main, lookup, 60)!.score).toBeLessThan(15);
  });

  it('a deck of only six- and seven-drops scores under 10', () => {
    const big = M19_SPELLS.filter((c) => c.cmc >= 6).map((c) => ({ sid: c.id }));
    const main = [...big, ...times(12, ref('Forest')), ...times(12, ref('Mountain'))];
    expect(strength(main, lookup, 60)!.score).toBeLessThan(10);
  });

  it('is null under half size, without non-land cards, or with more than 10 % unknown cards', () => {
    expect(strength(times(29, ref('Shock')), lookup, 60)).toBeNull();
    expect(strength(times(40, ref('Forest')), lookup, 40)).toBeNull();
    const main = [...times(30, ref('Shock')), ...times(4, { sid: 'missing' })];
    expect(strength(main, lookup, 60)).toBeNull();
  });

  it('edhrec_rank 10 raises quality and 30000 lowers it, both within 0.2 of the rarity', () => {
    const base: CardData = { ...named('Shock'), edhrec_rank: undefined } as CardData;
    delete base.edhrec_rank;
    const plain = cardQuality(base);
    const popular = cardQuality({ ...base, edhrec_rank: 10 });
    const obscure = cardQuality({ ...base, edhrec_rank: 30000 });
    expect(popular).toBeGreaterThan(plain);
    expect(obscure).toBeLessThan(plain);
    expect(Math.abs(popular - plain)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(obscure - plain)).toBeLessThanOrEqual(0.2);
  });

  it('bands map 1 to 5 in order', () => {
    expect([1, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(bandOf)).toEqual(['rough', 'rough', 'casual', 'casual', 'solid', 'solid', 'tuned', 'tuned', 'fierce', 'fierce']);
    expect((['rough', 'casual', 'solid', 'tuned', 'fierce'] as const).map(bandNumber)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('land helper', () => {
  it('removing six lands from GW suggests basics split between Forest and Plains', async () => {
    const { main } = await decklist('gw-m19-60.txt');
    const forest = ref('Forest').sid;
    const plains = ref('Plains').sid;
    let cut = 0;
    const fewer = main.filter((r) => !((r.sid === forest || r.sid === plains) && cut++ < 6));
    const a = analyse(fewer, lookup);
    expect(a.lands).toBe(18);
    const add = suggestedBasics(a, 60);
    expect((add.G ?? 0) + (add.W ?? 0)).toBe(suggestedLands(a, 60) - 18);
    expect(add.G).toBeGreaterThan(0);
    expect(add.W).toBeGreaterThan(0);
    expect(Object.keys(add).sort()).toEqual(['G', 'W']);
  });
});

describe('isSimpleDeck (contracts.md Part G "Decks" item 3)', () => {
  const base: DeckAnalysis = {
    cards: 40,
    lands: 17,
    spells: 23,
    creatures: 16,
    curveCreatures: [0, 3, 5, 4, 3, 1, 0, 0],
    curveOthers: [0, 1, 2, 2, 1, 1, 0, 0],
    avgMv: 2.8,
    symbols: { W: 10, U: 0, B: 0, R: 0, G: 12 },
    sources: { W: 8, U: 0, B: 0, R: 0, G: 9 },
    colours: ['W', 'G'],
    unknown: 0,
    ramp: 0,
    maxCopies: 2,
    sixPlus: 0,
    twoOrLess: 11,
    fivePlus: 2,
    types: { creature: 16, instant: 4, sorcery: 3, artifact: 0, enchantment: 0, planeswalker: 0, other: 0 },
  };
  it('a two-colour creature deck on its lands is simple', () => {
    expect(isSimpleDeck(base, 40)).toBe(true);
  });
  it('three colours are not', () => {
    expect(isSimpleDeck({ ...base, colours: ['W', 'U', 'G'] }, 40)).toBe(false);
  });
  it('fewer than 15 creatures per 40 cards are not', () => {
    expect(isSimpleDeck({ ...base, creatures: 14 }, 40)).toBe(false);
  });
  it('lands more than one off the suggestion are not, nor more than four cards at 5+', () => {
    expect(isSimpleDeck({ ...base, lands: 14 }, 40)).toBe(false);
    expect(isSimpleDeck({ ...base, fivePlus: 5 }, 40)).toBe(false);
  });
});
