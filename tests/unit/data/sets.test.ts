/** The default booster set and kept card fields (decks.md D9, section 6; PLAN M8-P3). */
import { describe, expect, it } from 'vitest';
import { trimCard } from '../../../src/data/cards';
import { boosterSetOrder, FEATURED_SET_INFO, latestCoreSet } from '../../../src/data/sets';
import { setListSummaries } from '../../../src/data/mtgjson';
import { fixtureSetSource } from '../../../src/debug/fixture-sets';
import { setData } from '../decks/fixture-decks';

describe('latestCoreSet', () => {
  it('answers M21 for the featured list alone and with nothing', () => {
    expect(latestCoreSet(FEATURED_SET_INFO)).toBe('M21');
    expect(latestCoreSet([])).toBe('M21');
  });

  it('picks the newest core entry and ignores newer expansions', () => {
    const list = [
      ...FEATURED_SET_INFO,
      { code: 'FDN', name: 'Foundations', releaseDate: '2024-11-15', featured: false, type: 'core' },
      { code: 'DSK', name: 'Duskmourn', releaseDate: '2024-09-27', featured: false, type: 'expansion' },
      { code: 'ZZZ', name: 'Later expansion', releaseDate: '2025-01-01', featured: false, type: 'expansion' },
    ];
    expect(latestCoreSet(list)).toBe('FDN');
    expect(boosterSetOrder(list).map((s) => s.code).slice(0, 3)).toEqual(['FDN', 'M21', 'M20']);
  });

  it('the MTGJSON set list keeps the type, and the fixture source marks its sets core', async () => {
    expect(setListSummaries({ data: [{ code: 'fdn', name: 'Foundations', releaseDate: '2024-11-15', type: 'core' }] })[0]!.type).toBe('core');
    const list = await fixtureSetSource([setData('M19')]).listSets();
    expect(list[0]!.type).toBe('core');
    expect(latestCoreSet(list)).toBe('M19');
  });
});

describe('trimCard edhrec_rank', () => {
  const raw = { id: 'x', name: 'X', set: 'm19', collector_number: '1' };
  it('keeps a positive integer and drops anything else', () => {
    expect(trimCard({ ...raw, edhrec_rank: 120 })!.edhrec_rank).toBe(120);
    for (const bad of [0, -3, 1.5, '12', null]) expect(trimCard({ ...raw, edhrec_rank: bad })!.edhrec_rank).toBeUndefined();
  });
});
