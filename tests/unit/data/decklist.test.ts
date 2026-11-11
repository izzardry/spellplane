// M0-P2 acceptance: the parser accepts plain, MTGA and MTGO lists, sideboard separators and set-and-number
// suffixes, and rejects bad lines with line numbers (DESIGN "Specification: card data, packs and draft formats",
// Decklist grammar).
import { describe, expect, it } from 'vitest';
import { editDistance, nearMatches, parseDecklist, sectionCount } from '../../../src/data/decklist';
import { fixtureDecklist } from './fakeScryfall';

describe('fixture decklists', () => {
  it('parses the plain 60-card list with a Sideboard header (deck A)', () => {
    const { list, errors } = parseDecklist(fixtureDecklist('gw-m19-60.txt'));
    expect(errors).toEqual([]);
    expect(sectionCount(list.main)).toBe(60);
    expect(list.main).toHaveLength(17);
    expect(list.side.map((e) => [e.count, e.name])).toEqual([
      [2, 'Revitalize'],
      [1, 'Gigantosaurus'],
    ]);
    expect(list.main[0]).toEqual({ count: 12, name: 'Forest', section: 'main', line: 2, text: '12 Forest' });
    expect(list.main[4]).toMatchObject({ count: 3, name: 'Daybreak Chaplain', line: 6 });
    expect(list.main.find((e) => e.name === "Ajani's Pridemate")).toBeDefined();
    expect(list.side[0]!.line).toBe(21);
    expect(list.commander).toEqual([]);
    expect(list.companion).toEqual([]);
  });

  it('parses the MTGA list with (SET) collector-number suffixes (deck B)', () => {
    const { list, errors } = parseDecklist(fixtureDecklist('ur-m19-60.mtga.txt'));
    expect(errors).toEqual([]);
    expect(sectionCount(list.main)).toBe(60);
    expect(sectionCount(list.side)).toBe(4);
    for (const e of [...list.main, ...list.side]) {
      expect(e.set).toBe('m19');
      expect(e.collectorNumber).toMatch(/^\d+$/);
    }
    expect(list.main.find((e) => e.name === 'Nicol Bolas, the Ravager')).toEqual({
      count: 1,
      name: 'Nicol Bolas, the Ravager',
      set: 'm19',
      collectorNumber: '218',
      section: 'main',
      line: 14,
      text: '1 Nicol Bolas, the Ravager (M19) 218',
    });
    expect(list.side.map((e) => e.name)).toEqual(['Sift', 'Tormenting Voice']);
  });

  it('parses the MTGO list with 2x counts, SB: lines and a # comment (deck C)', () => {
    const { list, errors } = parseDecklist(fixtureDecklist('mixed-40.mtgo.txt'));
    expect(errors).toEqual([]);
    expect(sectionCount(list.main)).toBe(40);
    expect(list.main.find((e) => e.name === 'Llanowar Elves')).toEqual({ count: 2, name: 'Llanowar Elves', section: 'main', line: 4, text: '2x Llanowar Elves' });
    expect(list.side).toEqual([
      { count: 1, name: 'Tormenting Voice', section: 'side', line: 16, text: 'SB: 1 Tormenting Voice' },
      { count: 1, name: 'Not A Real Card Name', section: 'side', line: 17, text: 'SB: 1 Not A Real Card Name' },
    ]);
  });
});

describe('grammar', () => {
  it('accepts "<count>x", "<count> x" and plain counts', () => {
    const { list, errors } = parseDecklist('4x Shock\n3 x Cancel\n2X Divination\n1 Xenagos, the Reveler');
    expect(errors).toEqual([]);
    expect(list.main.map((e) => [e.count, e.name])).toEqual([
      [4, 'Shock'],
      [3, 'Cancel'],
      [2, 'Divination'],
      [1, 'Xenagos, the Reveler'],
    ]);
  });

  it('a blank line after the main deck starts the sideboard, without a header', () => {
    const { list } = parseDecklist('4 Shock\n4 Cancel\n\n2 Sift\n1 Dwindle');
    expect(list.main.map((e) => e.name)).toEqual(['Shock', 'Cancel']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift', 'Dwindle']);
  });

  it('blank lines before any main-deck card do not start the sideboard', () => {
    const { list } = parseDecklist('\n\n// comment\n\nDeck\n\n4 Shock\n\n\n2 Sift');
    expect(list.main.map((e) => e.name)).toEqual(['Shock']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift']);
  });

  it('SB: lines go to the sideboard without switching the section', () => {
    const { list } = parseDecklist('4 Shock\nSB: 2 Sift\n4 Cancel\nsb:1 Dwindle');
    expect(list.main.map((e) => e.name)).toEqual(['Shock', 'Cancel']);
    expect(list.side.map((e) => [e.count, e.name, e.line])).toEqual([
      [2, 'Sift', 2],
      [1, 'Dwindle', 4],
    ]);
  });

  it('Deck, Sideboard, Commander and Companion headers switch section, in any case and with a colon or count', () => {
    const text = ['Commander', '1 Nicol Bolas, the Ravager', '', 'Companion:', '1 Skyscanner', '', 'DECK', '4 Shock', 'sideboard (2)', '2 Sift'].join('\n');
    const { list, errors } = parseDecklist(text);
    expect(errors).toEqual([]);
    expect(list.commander.map((e) => [e.name, e.section, e.line])).toEqual([['Nicol Bolas, the Ravager', 'commander', 2]]);
    expect(list.companion.map((e) => [e.name, e.section])).toEqual([['Skyscanner', 'companion']]);
    expect(list.main.map((e) => e.name)).toEqual(['Shock']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift']);
  });

  it('a blank line ends a commander or companion block: back to the main deck, or the sideboard once main has cards', () => {
    const { list } = parseDecklist('Commander\n1 Nicol Bolas, the Ravager\n\n4 Shock\n4 Cancel\n\n2 Sift');
    expect(list.commander.map((e) => e.name)).toEqual(['Nicol Bolas, the Ravager']);
    expect(list.main.map((e) => e.name)).toEqual(['Shock', 'Cancel']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift']);
    const later = parseDecklist('4 Shock\nCompanion\n1 Skyscanner\n\n2 Sift').list;
    expect(later.main.map((e) => e.name)).toEqual(['Shock']);
    expect(later.companion.map((e) => e.name)).toEqual(['Skyscanner']);
    expect(later.side.map((e) => e.name)).toEqual(['Sift']);
    // A blank line straight after the header (before any card) does not end the block.
    const gap = parseDecklist('Commander\n\n1 Nicol Bolas, the Ravager\n\n4 Shock').list;
    expect(gap.commander.map((e) => e.name)).toEqual(['Nicol Bolas, the Ravager']);
    expect(gap.main.map((e) => e.name)).toEqual(['Shock']);
  });

  it('keeps each entry\'s source line as pasted', () => {
    const { list } = parseDecklist('  2x Foo (abc) 12\nSB: 1 Bar');
    expect(list.main[0]!.text).toBe('  2x Foo (abc) 12');
    expect(list.side[0]!.text).toBe('SB: 1 Bar');
  });

  it('a Deck header after the sideboard returns to the main deck', () => {
    const { list } = parseDecklist('4 Shock\n\n2 Sift\nDeck\n4 Cancel');
    expect(list.main.map((e) => e.name)).toEqual(['Shock', 'Cancel']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift']);
  });

  it('ignores // and # comments anywhere, including indented ones', () => {
    const { list, errors } = parseDecklist('# title\n4 Shock\n   // note\n#4 Cancel\n2 Sift');
    expect(errors).toEqual([]);
    expect(list.main.map((e) => [e.name, e.line])).toEqual([
      ['Shock', 2],
      ['Sift', 5],
    ]);
  });

  it('keeps set codes lower-case and collector numbers verbatim; a name with parentheses but no number stays a name', () => {
    const { list } = parseDecklist('1 Island (m19) 268\n1 Forest (M21) 273a\n1 Some Card (Showcase)\n1 Fire // Ice');
    expect(list.main[0]).toMatchObject({ name: 'Island', set: 'm19', collectorNumber: '268' });
    expect(list.main[1]).toMatchObject({ name: 'Forest', set: 'm21', collectorNumber: '273a' });
    expect(list.main[2]).toEqual({ count: 1, name: 'Some Card (Showcase)', section: 'main', line: 3, text: '1 Some Card (Showcase)' });
    expect(list.main[3]!.name).toBe('Fire // Ice');
  });

  it('a set code without a collector number pins the set only', () => {
    const { list, errors } = parseDecklist('4 Shock (M19)\n2 Island (M20)');
    expect(errors).toEqual([]);
    expect(list.main[0]).toEqual({ count: 4, name: 'Shock', set: 'm19', section: 'main', line: 1, text: '4 Shock (M19)' });
    expect(list.main[1]).toEqual({ count: 2, name: 'Island', set: 'm20', section: 'main', line: 2, text: '2 Island (M20)' });
  });

  it('handles CRLF line endings, a BOM, tabs and surrounding spaces', () => {
    const { list, errors } = parseDecklist('﻿4 Shock\r\n  2\tCancel  \r\n\r\nSideboard\r\n1   Sift');
    expect(errors).toEqual([]);
    expect(list.main.map((e) => [e.count, e.name])).toEqual([
      [4, 'Shock'],
      [2, 'Cancel'],
    ]);
    expect(list.side.map((e) => [e.name, e.line])).toEqual([['Sift', 5]]);
  });

  it('skips an MTGA "About" block', () => {
    const { list, errors } = parseDecklist('About\nName Izzet Tempo\n\nDeck\n4 Shock\n\nSideboard\n2 Sift');
    expect(errors).toEqual([]);
    expect(list.main.map((e) => e.name)).toEqual(['Shock']);
    expect(list.side.map((e) => e.name)).toEqual(['Sift']);
  });
});

describe('bad lines', () => {
  it('rejects lines that do not match the grammar with their 1-based line numbers, and parses the rest', () => {
    const text = [
      '4 Shock', // 1
      'Lightning Bolt', // 2: no count
      '0 Cancel', // 3: zero count
      '2x', // 4: no name
      '', // 5
      'SB: Sift', // 6: SB without count
      '1 Dwindle', // 7
      'Maybeboard', // 8: unknown header
      '4 -- ', // 9: no name
      '1000 Island', // 10: absurd count
    ].join('\n');
    const { list, errors } = parseDecklist(text);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 6, 8, 9, 10]);
    for (const e of errors) {
      expect(e.kind).toBe('syntax');
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.nearMatches).toEqual([]);
    }
    expect(errors[0]!.text).toBe('Lightning Bolt');
    expect(list.main.map((e) => e.name)).toEqual(['Shock']);
    expect(list.side.map((e) => [e.name, e.line])).toEqual([['Dwindle', 7]]);
  });

  it('names the bound a bad count breaks, also for counts too long to be exact', () => {
    const { errors } = parseDecklist('0 Cancel\n1000 Island\n99999999999999999999 Island');
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [1, 'The count must be at least 1'],
      [2, 'The count must be at most 999'],
      [3, 'The count must be at most 999'],
    ]);
  });

  it('a list of only bad lines gives an empty deck and one error per line', () => {
    const { list, errors } = parseDecklist('foo\nbar baz');
    expect(errors.map((e) => e.line)).toEqual([1, 2]);
    expect(list.main).toEqual([]);
  });

  it('an empty text gives an empty deck and no errors', () => {
    expect(parseDecklist('')).toEqual({ list: { main: [], side: [], commander: [], companion: [] }, errors: [] });
  });
});

describe('near matches', () => {
  const names = ['Llanowar Elves', 'Lightning Mare', 'Lava Axe', 'Shock', 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen'];

  it('suggests the closest names for a misspelling, best first', () => {
    expect(nearMatches('Llanowar Elfs', names)[0]).toBe('Llanowar Elves');
    expect(nearMatches('lightnig mare', names)).toEqual(['Lightning Mare']);
  });

  it('matches the front face of a double-faced card', () => {
    expect(nearMatches('Nicol Bolas, the Ravagr', names)).toEqual(['Nicol Bolas, the Ravager // Nicol Bolas, the Arisen']);
  });

  it('suggests nothing for a name unlike every candidate, and caps the list', () => {
    expect(nearMatches('Not A Real Card Name', names)).toEqual([]);
    expect(nearMatches('Shock', ['Shock', 'Shocks', 'Shack', 'Smock', 'Stock'], 3)).toHaveLength(3);
  });

  it('edit distance is the Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});
