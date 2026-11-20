/**
 * The deck list's rows and the copy warning (decks.md section 3 "Deck list"; D17: warnings never block; D21: four
 * copies, one at size 100, basic lands aside).
 */
import { describe, expect, it } from 'vitest';
import { groupsOf, overCopies, rowsOf } from '../../../src/ui/decks/state/rows';
import { lookup, ref } from './fixture-decks';

describe('deck list rows', () => {
  it('one row per card with its count, by mana value then name, grouped by type', () => {
    const list = [ref('Llanowar Elves'), ref('Forest'), ref('Llanowar Elves'), ref('Shock'), ref('Colossal Dreadmaw')];
    const rows = rowsOf(list, lookup);
    expect(rows.map((r) => [r.card?.name, r.n])).toEqual([
      ['Forest', 1],
      ['Llanowar Elves', 2],
      ['Shock', 1],
      ['Colossal Dreadmaw', 1],
    ]);
    expect(groupsOf(list, lookup).map((g) => [g.title, g.n])).toEqual([
      ['Creatures', 3],
      ['Spells', 1],
      ['Lands', 1],
    ]);
  });

  it('a card without data is its own group and counts', () => {
    const groups = groupsOf([{ sid: 'nope' }, { sid: 'nope' }], lookup);
    expect(groups).toEqual([{ title: 'Unknown', n: 2, rows: [{ sid: 'nope', card: null, n: 2, mv: 0 }] }]);
  });
});

describe('the copy warning', () => {
  it('names the card over four copies; basics never count; size 100 allows one', () => {
    const five = Array.from({ length: 5 }, () => ref('Shock'));
    const forests = Array.from({ length: 20 }, () => ref('Forest'));
    expect(overCopies([...five, ...forests], lookup, 60)).toEqual({ name: 'Shock', n: 5, limit: 4 });
    expect(overCopies([...five.slice(0, 4), ...forests], lookup, 60)).toBeNull();
    expect(overCopies([ref('Shock'), ref('Shock')], lookup, 100)).toEqual({ name: 'Shock', n: 2, limit: 1 });
  });
});
