/**
 * M2-P1 MTGJSON client, cache and set picker data (DESIGN "Specification: card data, packs and draft formats",
 * Booster data: the set file trimmed to `data.booster` and the uuid → Scryfall id map, booster type draft, else
 * default, else play; the lobby lists the ten featured sets first, then every other set by release date; "Card data
 * and images", Caching: set files go to IndexedDB). Network access is a fake fetch over the recorded fixtures.
 */
import { describe, expect, it } from 'vitest';
import { createSetDataSource, MTGJSON_SET_LIST_URL, mtgjsonFileCode, scryfallIdOf, SET_REFRESH_AGE_MS, trimSetFile } from '../../../src/data/mtgjson';
import { FEATURED_SET_INFO, orderSets } from '../../../src/data/sets';
import { FEATURED_SETS, MTGJSON_SET_URL, type SetData, type SetSummary } from '../../../src/data/types';
import { createSetCache, IdbSetCache, MemorySetCache } from '../../../src/store/sets';
import { openDb } from '../../../src/store/db';
import type { SetCache, SetRecord } from '../../../src/store/types';
import { preferredConfig, rawFixture, TARGET_SETS } from './model';

// ---------------------------------------------------------------------------------------------------------------------
// trimSetFile
// ---------------------------------------------------------------------------------------------------------------------

describe('trimSetFile on the recorded target sets', () => {
  for (const code of TARGET_SETS) {
    it(`${code}: keeps the draft booster and maps every sheet card to its Scryfall id`, () => {
      const raw = rawFixture(code);
      const set = trimSetFile(raw)!;
      expect(set.code).toBe(code);
      expect(set.name).toBe(raw.data.name);
      expect(set.releaseDate).toBe(raw.data.releaseDate);
      expect(set.boosterType).toBe('draft');
      const cfg = preferredConfig(raw);
      expect(set.booster.boosters).toEqual(cfg.boosters);
      expect(set.booster.boostersTotalWeight).toBe(cfg.boostersTotalWeight);
      const sheetUuids = new Set<string>();
      for (const [name, sheet] of Object.entries(cfg.sheets)) {
        expect(set.booster.sheets[name]!.cards).toEqual(sheet.cards);
        expect(set.booster.sheets[name]!.totalWeight).toBe(sheet.totalWeight);
        expect(set.booster.sheets[name]!.foil).toBe(sheet.foil);
        expect(set.booster.sheets[name]!.balanceColors === true).toBe(sheet.balanceColors === true);
        for (const u of Object.keys(sheet.cards)) sheetUuids.add(u);
      }
      // Trimmed to the cards the sheets name, each with its fixture Scryfall id.
      expect(new Set(Object.keys(set.cards))).toEqual(sheetUuids);
      for (const u of sheetUuids) expect(scryfallIdOf(set, u)).toBe(raw.data.cards[u]!.scryfallId);
      // Plain JSON (it goes to IndexedDB and must hash identically everywhere).
      expect(JSON.parse(JSON.stringify(set))).toEqual(set);
    });
  }
});

/** A small MTGJSON-shaped file: cards as an array with `identifiers.scryfallId`, as the live API serves it. */
function apiFile(booster: Record<string, unknown>, extraCards: unknown[] = []): unknown {
  const cards = [
    { uuid: 'u-a', name: 'Alpha', rarity: 'common', colors: ['W'], types: ['Creature'], number: '1', manaCost: '{W}', identifiers: { scryfallId: 'sid-a' }, text: 'dropped' },
    { uuid: 'u-b', name: 'Beta', rarity: 'rare', colors: [], types: ['Artifact'], number: '2', identifiers: { scryfallId: 'sid-b' } },
    { uuid: 'u-c', name: 'Gamma', rarity: 'uncommon', colors: ['U'], types: ['Instant'], number: '3', identifiers: { scryfallId: 'sid-c' } },
    ...extraCards,
  ];
  return { meta: { version: '5' }, data: { code: 'abc', name: 'Alphabet', releaseDate: '2001-02-03', type: 'expansion', booster, cards } };
}
const config = (sheetCards: Record<string, number>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  boosters: [{ contents: { s: 1 }, weight: 1 }],
  boostersTotalWeight: 1,
  sheets: { s: { cards: sheetCards, totalWeight: 99, foil: false, ...extra } },
});

describe('trimSetFile on MTGJSON-shaped input', () => {
  it('reads cards from an array with identifiers and keeps only what generation needs', () => {
    const set = trimSetFile(apiFile({ draft: config({ 'u-a': 2, 'u-b': 1 }) }))!;
    expect(set.code).toBe('ABC');
    expect(set.cards).toEqual({
      'u-a': { scryfallId: 'sid-a', name: 'Alpha', rarity: 'common', colors: ['W'], types: ['Creature'], number: '1', manaCost: '{W}' },
      'u-b': { scryfallId: 'sid-b', name: 'Beta', rarity: 'rare', colors: [], types: ['Artifact'], number: '2' },
    });
    // The total weight is recomputed from the cards kept, not copied.
    expect(set.booster.sheets.s!.totalWeight).toBe(3);
  });

  it('prefers draft, else default, else play, and ignores other booster types', () => {
    const all = { play: config({ 'u-c': 1 }), default: config({ 'u-b': 1 }), draft: config({ 'u-a': 1 }), collector: config({ 'u-b': 1 }) };
    expect(trimSetFile(apiFile(all))!.boosterType).toBe('draft');
    expect(trimSetFile(apiFile({ play: all.play, default: all.default, collector: all.collector }))!.boosterType).toBe('default');
    const play = trimSetFile(apiFile({ play: all.play, collector: all.collector }))!;
    expect(play.boosterType).toBe('play');
    expect(Object.keys(play.cards)).toEqual(['u-c']);
    expect(trimSetFile(apiFile({ collector: all.collector, arena: all.draft }))).toBeNull();
  });

  it('drops sheet cards without a Scryfall id, and falls back to the next type when a layout cannot be filled', () => {
    const tokenOnly = { uuid: 'u-x', name: 'No Id', rarity: 'common', identifiers: {} };
    const draft = config({ 'u-x': 5, 'u-missing': 5 });
    const set = trimSetFile(apiFile({ draft, default: config({ 'u-a': 1, 'u-x': 1 }) }, [tokenOnly]))!;
    expect(set.boosterType).toBe('default');
    expect(set.booster.sheets.s!.cards).toEqual({ 'u-a': 1 });
    expect(Object.keys(set.cards)).toEqual(['u-a']);
  });

  it('drops layouts whose sheet cannot yield the count without duplicates and recomputes the layout total', () => {
    const booster = {
      boosters: [
        { contents: { s: 3 }, weight: 5 },
        { contents: { s: 2 }, weight: 2 },
        { contents: { t: 3 }, weight: 1 },
        { contents: { nope: 1 }, weight: 9 },
      ],
      boostersTotalWeight: 17,
      sheets: { s: { cards: { 'u-a': 1, 'u-b': 1 }, foil: false }, t: { cards: { 'u-c': 1 }, foil: false, allowDuplicates: true } },
    };
    const set = trimSetFile(apiFile({ draft: booster }))!;
    expect(set.booster.boosters).toEqual([
      { contents: { s: 2 }, weight: 2 },
      { contents: { t: 3 }, weight: 1 },
    ]);
    expect(set.booster.boostersTotalWeight).toBe(3);
    expect(set.booster.sheets.t!.allowDuplicates).toBe(true);
  });

  it('reads tokens and ignores malformed weights', () => {
    const token = { uuid: 'u-t', name: 'Token', rarity: 'token', identifiers: { scryfallId: 'sid-t' } };
    const raw = apiFile({ draft: config({ 'u-a': 0, 'u-b': -1, 'u-c': 1.5, 'u-t': 2 }) });
    (raw as { data: { tokens: unknown[] } }).data.tokens = [token];
    const set = trimSetFile(raw)!;
    expect(set.booster.sheets.s!.cards).toEqual({ 'u-t': 2 });
  });

  it('answers null for anything that is not a set file with booster data', () => {
    expect(trimSetFile(null)).toBeNull();
    expect(trimSetFile('M19')).toBeNull();
    expect(trimSetFile({ data: { code: 'X' } })).toBeNull();
    expect(trimSetFile({ data: { code: 'X', booster: { draft: { boosters: [], sheets: {} } }, cards: [] } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Set picker order
// ---------------------------------------------------------------------------------------------------------------------

describe('set picker order', () => {
  it('lists the ten featured sets first in the design order, then the rest by release date', () => {
    const others: SetSummary[] = [
      { code: 'FDN', name: 'Foundations', releaseDate: '2024-11-15', featured: false },
      { code: 'LEA', name: 'Limited Edition Alpha', releaseDate: '1993-08-05', featured: false },
      { code: 'ZEN', name: 'Zendikar', releaseDate: '2009-10-02', featured: false },
      { code: 'ARN', name: 'Arabian Nights', releaseDate: '1993-12-17', featured: false },
    ];
    const shuffledFeatured = [...FEATURED_SET_INFO].reverse().map((s) => ({ ...s, featured: false }));
    const out = orderSets([...others, ...shuffledFeatured]);
    expect(out.map((s) => s.code)).toEqual([...FEATURED_SETS, 'LEA', 'ARN', 'ZEN', 'FDN']);
    expect(out.slice(0, 10).every((s) => s.featured)).toBe(true);
    expect(out.slice(10).some((s) => s.featured)).toBe(false);
    expect(FEATURED_SETS).toEqual(['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21']);
  });

  it('merges duplicate codes case-insensitively and breaks release-date ties by code', () => {
    const out = orderSets([
      { code: 'xyz', name: 'X', releaseDate: '2000-01-01', featured: false },
      { code: 'ABC', name: 'A', releaseDate: '2000-01-01', featured: false },
      { code: 'XYZ', name: 'X again', releaseDate: '2000-01-01', featured: false },
      { code: 'm19', name: 'Core Set 2019', releaseDate: '2018-07-13', featured: false },
    ]);
    expect(out.map((s) => [s.code, s.featured])).toEqual([
      ['M19', true],
      ['ABC', false],
      ['XYZ', false],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The data source over a fake MTGJSON
// ---------------------------------------------------------------------------------------------------------------------

interface FakeMtgjson {
  fetch: typeof fetch;
  calls: string[];
}

function fakeMtgjson(opts: { setList?: unknown; fail?: boolean; status?: number } = {}): FakeMtgjson {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (opts.fail) throw new TypeError('offline');
    if (opts.status) return new Response('error', { status: opts.status });
    if (url === MTGJSON_SET_LIST_URL) {
      return opts.setList === undefined ? new Response('missing', { status: 404 }) : Response.json(opts.setList);
    }
    const m = /\/api\/v5\/([A-Z0-9_]+)\.json$/.exec(url);
    if (m && (TARGET_SETS as readonly string[]).includes(m[1]!)) return Response.json(rawFixture(m[1]!));
    if (m && m[1] === 'NOB') return Response.json({ meta: {}, data: { code: 'NOB', name: 'No Boosters', releaseDate: '2000-01-01', booster: {}, cards: [] } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe('createSetDataSource', () => {
  it('fetches the per-set file once, caches it in memory and in the sets store, and serves peek', async () => {
    const net = fakeMtgjson();
    const cache = new MemorySetCache();
    const src = createSetDataSource({ fetch: net.fetch, cache, now: () => 1000, setList: false });
    expect(src.peek('M19')).toBeNull();
    const [a, b] = await Promise.all([src.get('M19'), src.get('m19')]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(net.calls).toEqual([MTGJSON_SET_URL('M19')]);
    expect(src.peek('M19')).toBe(a);
    expect(await src.get('M19')).toBe(a);
    expect(net.calls).toHaveLength(1);
    const record = await cache.get('M19');
    expect(record).toEqual({ code: 'M19', data: a, fetchedAt: 1000 });
  });

  it('serves a cached set without the network, and refreshes one older than 30 days in the background', async () => {
    const cache = new MemorySetCache();
    const fresh = createSetDataSource({ fetch: fakeMtgjson().fetch, cache, now: () => 0, setList: false });
    const set = (await fresh.get('M10'))!;

    const offline = fakeMtgjson({ fail: true });
    const second = createSetDataSource({ fetch: offline.fetch, cache, now: () => SET_REFRESH_AGE_MS, setList: false });
    expect(await second.get('M10')).toEqual(set);
    expect(offline.calls).toEqual([]);

    const net = fakeMtgjson();
    const third = createSetDataSource({ fetch: net.fetch, cache, now: () => SET_REFRESH_AGE_MS + 1, setList: false });
    expect(await third.get('M10')).toEqual(set);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(net.calls).toEqual([MTGJSON_SET_URL('M10')]);
    expect((await cache.get('M10'))!.fetchedAt).toBe(SET_REFRESH_AGE_MS + 1);
  });

  it('refetches a cached record that is not a trimmed set (older format)', async () => {
    const cache = new MemorySetCache();
    await cache.put({ code: 'M11', data: { old: true }, fetchedAt: 0 });
    const net = fakeMtgjson();
    const src = createSetDataSource({ fetch: net.fetch, cache, now: () => 5, setList: false });
    expect((await src.get('M11'))!.code).toBe('M11');
    expect(net.calls).toHaveLength(1);
  });

  it('answers null for an unknown set or one without usable booster data, and drops it from the picker', async () => {
    const net = fakeMtgjson();
    const src = createSetDataSource({ fetch: net.fetch, cache: null, setList: false });
    expect(await src.get('ZZZ')).toBeNull();
    expect(await src.get('NOB')).toBeNull();
    expect(await src.get('NOB')).toBeNull();
    expect(net.calls.filter((u) => u.endsWith('NOB.json'))).toHaveLength(1);
    expect(src.peek('NOB')).toBeNull();
  });

  it('rejects on a network or server error so the caller can retry, without remembering the failure', async () => {
    const down = fakeMtgjson({ status: 503 });
    const src = createSetDataSource({ fetch: down.fetch, cache: null, setList: false });
    await expect(src.get('M12')).rejects.toThrow(/503/);
    await expect(createSetDataSource({ fetch: fakeMtgjson({ fail: true }).fetch, cache: null }).get('M12')).rejects.toThrow();
    expect(down.calls).toHaveLength(1);
    await expect(src.get('M12')).rejects.toThrow();
    expect(down.calls).toHaveLength(2);
  });

  it('keeps working when the cache fails', async () => {
    const broken: SetCache = {
      get: () => Promise.reject(new Error('blocked')),
      put: () => Promise.reject(new Error('blocked')),
      codes: () => Promise.reject(new Error('blocked')),
    };
    const src = createSetDataSource({ fetch: fakeMtgjson().fetch, cache: broken, setList: false });
    expect((await src.get('M13'))!.code).toBe('M13');
    expect((await src.listSets()).map((s) => s.code)).toEqual([...FEATURED_SETS]);
  });

  it('uses MTGJSON file names: upper case, and CON_ for Conflux', () => {
    expect(mtgjsonFileCode('m19')).toBe('M19');
    expect(mtgjsonFileCode('con')).toBe('CON_');
  });

  it('lists featured sets first, then SetList booster sets and cached sets by release date', async () => {
    const setList = {
      data: [
        { code: 'ZEN', name: 'Zendikar', releaseDate: '2009-10-02', type: 'expansion' },
        { code: 'LEA', name: 'Limited Edition Alpha', releaseDate: '1993-08-05', type: 'core' },
        { code: 'M19', name: 'Core Set 2019', releaseDate: '2018-07-13', type: 'core' },
        { code: 'PLST', name: 'The List', releaseDate: '2020-01-01', type: 'promo' },
        { code: 'Y22', name: 'Alchemy', releaseDate: '2021-12-09', type: 'alchemy', isOnlineOnly: true },
        { code: 'AKR', name: 'Amonkhet Remastered', releaseDate: '2020-08-13', type: 'expansion', isOnlineOnly: true },
        { code: 'NOB', name: 'No Boosters', releaseDate: '2000-01-01', type: 'expansion' },
        { code: 'MH2', name: 'Modern Horizons 2', releaseDate: '2021-06-18', type: 'draft_innovation' },
      ],
    };
    const cache = new MemorySetCache();
    const foreign: SetData = { ...trimSetFile(rawFixture('M20'))!, code: 'OLD', name: 'Cached Old Set', releaseDate: '1995-01-01' };
    await cache.put({ code: 'OLD', data: foreign, fetchedAt: 0 });
    const net = fakeMtgjson({ setList });
    const src = createSetDataSource({ fetch: net.fetch, cache, now: () => 0 });
    const first = (await src.listSets()).map((s) => s.code);
    expect(first).toEqual([...FEATURED_SETS, 'LEA', 'OLD', 'NOB', 'ZEN', 'MH2']);
    // A cached set is available to peek once listed.
    expect(src.peek('OLD')!.name).toBe('Cached Old Set');
    // A set found to have no booster data leaves the list; the SetList is fetched once.
    await src.get('NOB');
    expect((await src.listSets()).map((s) => s.code)).toEqual([...FEATURED_SETS, 'LEA', 'OLD', 'ZEN', 'MH2']);
    expect(net.calls.filter((u) => u === MTGJSON_SET_LIST_URL)).toHaveLength(1);
  });

  it('lists the featured sets offline and asks for the SetList again later', async () => {
    const net = fakeMtgjson({ fail: true });
    const src = createSetDataSource({ fetch: net.fetch, cache: null });
    const list = await src.listSets();
    expect(list).toEqual(FEATURED_SET_INFO);
    await src.listSets();
    expect(net.calls.filter((u) => u === MTGJSON_SET_LIST_URL)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The sets store
// ---------------------------------------------------------------------------------------------------------------------

let dbCounter = 0;
describe('sets store (IndexedDB)', () => {
  it('round-trips a trimmed set and lists cached codes', async () => {
    const name = `test-sets-${++dbCounter}-${Math.random().toString(36).slice(2, 8)}`;
    const db = await openDb(name);
    try {
      const cache = createSetCache(db);
      expect(await cache.get('M19')).toBeNull();
      const set = trimSetFile(rawFixture('M19'))!;
      const record: SetRecord = { code: 'M19', data: set, fetchedAt: 42 };
      await cache.put(record);
      await cache.put({ code: 'M10', data: trimSetFile(rawFixture('M10'))!, fetchedAt: 43 });
      expect(await cache.get('M19')).toEqual(record);
      expect((await cache.codes()).sort()).toEqual(['M10', 'M19']);

      // A data source over the store serves the set without fetching.
      const offline = fakeMtgjson({ fail: true });
      const src = createSetDataSource({ fetch: offline.fetch, cache, now: () => 50, setList: false });
      expect(await src.get('M19')).toEqual(set);
      expect(offline.calls).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('opens the profile database lazily and retries after a failed open', async () => {
    let attempts = 0;
    const name = `test-sets-${++dbCounter}-${Math.random().toString(36).slice(2, 8)}`;
    const cache = new IdbSetCache(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('blocked')) : openDb(name);
    });
    expect(attempts).toBe(0);
    await expect(cache.get('M19')).rejects.toThrow('blocked');
    expect(await cache.get('M19')).toBeNull();
    expect(attempts).toBe(2);
  });
});
