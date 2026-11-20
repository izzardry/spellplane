/** Search chips (decks.md section 3 "Filter chips", "Quick chips"; PLAN M8-P3 unit acceptance). */
import { describe, expect, it } from 'vitest';
import { colourTerm, compileQuery, matchesQuery, mvTerm, quickQuery } from '../../../src/data/deck/query';
import { named, source } from './fixture-decks';

describe('chips compile to query terms', () => {
  it('colours, mana value, type, rarity, set and format', () => {
    expect(colourTerm(['W', 'U'])).toBe('id<=wu');
    expect(colourTerm(['C'])).toBe('id:c');
    expect(colourTerm([])).toBeNull();
    expect(mvTerm([2])).toBe('mv=2');
    expect(mvTerm([3, 2])).toBe('(mv=2 or mv=3)');
    expect(mvTerm([7])).toBe('mv>=7');
    expect(compileQuery({ text: 'elves', colours: ['G'], mv: [1, 2], types: ['creature'], rarity: 'rare', set: 'M21', format: 'modern' })).toBe('elves id<=g (mv=1 or mv=2) t:creature r:rare e:m21 f:modern');
    expect(compileQuery({ types: ['instant', 'sorcery'] })).toBe('(t:instant or t:sorcery)');
  });

  it('quick chips search within the deck colours', () => {
    expect(quickQuery('cheapCreatures', ['G', 'W'])).toBe('t:creature mv<=3 id<=wg');
    expect(quickQuery('lands', [])).toBe('t:land -t:basic');
  });
});

describe('the local evaluator', () => {
  it('matches type, identity, mana value, rarity, oracle text and negation', () => {
    const elves = named('Llanowar Elves');
    expect(matchesQuery(elves, 't:creature id<=g mv=1')).toBe(true);
    expect(matchesQuery(elves, 'id<=w')).toBe(false);
    expect(matchesQuery(named('Shock'), '(o:"damage to any target" or o:"destroy target")')).toBe(true);
    expect(matchesQuery(named('Forest'), 't:land -t:basic')).toBe(false);
    expect(matchesQuery(named('Colossal Dreadmaw'), 't:creature mv>=5 r>=rare')).toBe(false);
  });

  it('the fixture source answers chip queries', async () => {
    const res = await source.searchCards('t:creature id<=g mv=1');
    expect(res.map((c) => c.name)).toContain('Llanowar Elves');
    expect(res.every((c) => c.cmc === 1 && c.color_identity.every((x) => x === 'G'))).toBe(true);
    const elves = await source.searchCards('elves');
    expect(elves.map((c) => c.name)).toContain('Llanowar Elves');
  });
});
