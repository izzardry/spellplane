// M0-P2: card data source — deck resolution with unresolved-name reporting, IndexedDB card cache with fetched-at
// time and background refresh after 30 days, token lookup via all_parts (DESIGN "Card data and images";
// "Specification: card data, packs and draft formats"; "Specification: network protocol and secrecy", Local persistence).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecklist } from '../../../src/data/decklist';
import { RateLimiter } from '../../../src/data/limiter';
import { ScryfallClient } from '../../../src/data/scryfall';
import { ScryfallCardDataSource } from '../../../src/data/source';
import { CARD_REFRESH_AGE_MS, IdbCardCache, MemoryCardCache } from '../../../src/store/cards';
import { openDb } from '../../../src/store/db';
import { FakeScryfall, fixtureDecklist, loadFixtureSet } from './fakeScryfall';

const DAY = 24 * 60 * 60 * 1000;
const m19 = loadFixtureSet('m19.json');
const shock = m19.find((c) => c.name === 'Shock')!;
const angel = m19.find((c) => c.name === 'Resplendent Angel')!;

let dbCount = 0;
function setup(opts: { now?: () => number; cache?: 'idb' | 'memory' | null; fake?: FakeScryfall } = {}) {
  const fake = opts.fake ?? new FakeScryfall();
  const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter({ perWindow: 1_000_000 }) });
  const dbName = `cards-test-${++dbCount}`;
  const cache = opts.cache === null ? null : opts.cache === 'memory' ? new MemoryCardCache() : new IdbCardCache(() => openDb(dbName));
  const source = new ScryfallCardDataSource({ client, cache, now: opts.now ?? (() => 1_000 * DAY) });
  return { fake, client, cache, source, dbName };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveDeck', () => {
  it('resolves the plain 60-card fixture deck A by name', async () => {
    const { source, fake } = setup();
    const deck = await source.resolveDeck(parseDecklist(fixtureDecklist('gw-m19-60.txt')).list);
    expect(deck.errors).toEqual([]);
    expect(deck.main).toHaveLength(60);
    expect(deck.side).toHaveLength(3);
    expect(deck.main.filter((r) => deck.cards[r.sid]?.name === 'Forest')).toHaveLength(12);
    for (const r of [...deck.main, ...deck.side]) expect(deck.cards[r.sid]).toBeDefined();
    // 17 distinct names in one /cards/collection request, Revitalize and Gigantosaurus looked up once.
    expect(fake.callsTo('/cards/collection')).toHaveLength(1);
  });

  it('resolves the MTGA fixture deck B by set and collector number, including the double-faced card', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist(fixtureDecklist('ur-m19-60.mtga.txt')).list);
    expect(deck.errors).toEqual([]);
    expect(deck.main).toHaveLength(60);
    expect(deck.side).toHaveLength(4);
    const bolas = m19.find((c) => c.collector_number === '218')!;
    expect(deck.main.filter((r) => r.sid === bolas.id)).toHaveLength(1);
    const island = Object.values(deck.cards).find((c) => c.name === 'Island')!;
    expect(island.collector_number).toBe('268');
  });

  it('reports the unresolvable name of deck C with its line number and still resolves the rest', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist(fixtureDecklist('mixed-40.mtgo.txt')).list);
    expect(deck.main).toHaveLength(40);
    expect(deck.side.map((r) => deck.cards[r.sid]!.name)).toEqual(['Tormenting Voice']);
    expect(deck.errors).toHaveLength(1);
    expect(deck.errors[0]).toMatchObject({ line: 17, kind: 'unresolved', text: 'SB: 1 Not A Real Card Name' });
    expect(deck.errors[0]!.message).toContain('Not A Real Card Name');
  });

  it('offers near matches for a misspelt name', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('4 Shock\n2 Llanowar Elfs\n1 Gigantosarus').list);
    expect(deck.main).toHaveLength(4);
    expect(deck.errors.map((e) => [e.line, e.nearMatches[0]])).toEqual([
      [2, 'Llanowar Elves'],
      [3, 'Gigantosaurus'],
    ]);
  });

  it('reports an unresolved line with the text as pasted', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('4 Shock\n2x Foo Bar Baz (abc) 12').list);
    expect(deck.errors.map((e) => [e.line, e.text])).toEqual([[2, '2x Foo Bar Baz (abc) 12']]);
  });

  it('a set and number that is a different card is not accepted: the named card is resolved by name', async () => {
    const { source } = setup();
    const bolas = m19.find((c) => c.collector_number === '218')!;
    expect(bolas.name).not.toBe('Shock');
    const deck = await source.resolveDeck(parseDecklist('4 Shock (M19) 218\n1 Nicol Bolas, the Ravager (M19) 218').list);
    expect(deck.errors).toEqual([]);
    expect(deck.main).toEqual([...Array(4).fill({ sid: shock.id }), { sid: bolas.id }]);
  });

  it('a set and number that is a different card, with a name Scryfall does not know, is reported, not replaced', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('4 Not A Real Card Name (M19) 218').list);
    expect(deck.main).toEqual([]);
    expect(deck.cards).toEqual({});
    expect(deck.errors).toHaveLength(1);
    expect(deck.errors[0]).toMatchObject({ line: 1, kind: 'unresolved', text: '4 Not A Real Card Name (M19) 218' });
  });

  it('an unknown set and number falls back to the name', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('2 Shock (XYZ) 999').list);
    expect(deck.errors).toEqual([]);
    expect(deck.main).toEqual([{ sid: shock.id }, { sid: shock.id }]);
  });

  it('a set without a number picks that set\'s printing of the name; an unknown set falls back to the name', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('1 Island (M20)\n1 Island (M19)\n1 Shock (ZZZ)').list);
    expect(deck.errors).toEqual([]);
    expect(deck.main.map((r) => deck.cards[r.sid]!.set)).toEqual(['m20', 'm19', 'm19']);
  });

  it('keeps commander and companion sections apart from main and side', async () => {
    const { source } = setup();
    const deck = await source.resolveDeck(parseDecklist('Commander\n1 Nicol Bolas, the Ravager\nCompanion\n1 Skyscanner\nDeck\n4 Shock').list);
    expect(deck.main).toEqual(Array(4).fill({ sid: shock.id }));
    expect(deck.side).toEqual([]);
    expect(deck.commander?.map((r) => deck.cards[r.sid]!.collector_number)).toEqual(['218']);
    expect(deck.companion).toHaveLength(1);
  });

  it('resolves more than 75 distinct printings in batches of 75', async () => {
    const { source, fake } = setup();
    const text = m19
      .slice(0, 100)
      .map((c) => `1 ${c.name.split(' // ')[0]} (M19) ${c.collector_number}`)
      .join('\n');
    const deck = await source.resolveDeck(parseDecklist(text).list);
    expect(deck.errors).toEqual([]);
    expect(deck.main.map((r) => r.sid)).toEqual(m19.slice(0, 100).map((c) => c.id));
    expect(fake.callsTo('/cards/collection').map((c) => (c.body as { identifiers: unknown[] }).identifiers.length)).toEqual([75, 25]);
  });
});

describe('card cache', () => {
  it('stores fetched cards in the IndexedDB `cards` store with their fetched-at time', async () => {
    const now = 1_000 * DAY;
    const { source, dbName } = setup({ now: () => now });
    await source.resolveDeck(parseDecklist('4 Shock').list);
    const db = await openDb(dbName);
    expect(await db.get('cards', shock.id)).toEqual({ id: shock.id, data: shock, fetchedAt: now });
    db.close();
  });

  it('a second source on the same profile answers from the cache without fetching', async () => {
    const first = setup();
    await first.source.get(shock.id);
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter({ perWindow: 1_000_000 }) });
    const second = new ScryfallCardDataSource({ client, cache: new IdbCardCache(() => openDb(first.dbName)), now: () => 1_001 * DAY });
    expect(second.peek(shock.id)).toBeNull();
    expect(await second.get(shock.id)).toEqual(shock);
    expect(second.peek(shock.id)).toEqual(shock);
    await second.idle();
    expect(fake.calls).toEqual([]);
  });

  it('refreshes an entry older than 30 days in the background, returning the cached copy at once', async () => {
    let now = 1_000 * DAY;
    const fake = new FakeScryfall();
    const { source, cache } = setup({ now: () => now, fake, cache: 'memory' });
    const old = { ...shock, oracle_text: 'old text' };
    await cache!.put([{ id: shock.id, data: old, fetchedAt: now - 31 * DAY }]);
    expect(await source.get(shock.id)).toEqual(old);
    await source.idle();
    expect(fake.callsTo('/cards/collection')).toHaveLength(1);
    expect(source.peek(shock.id)).toEqual(shock);
    expect(await cache!.get(shock.id)).toEqual({ id: shock.id, data: shock, fetchedAt: now });
    now += DAY;
    await source.get(shock.id);
    await source.idle();
    expect(fake.callsTo('/cards/collection')).toHaveLength(1);
  });

  it('does not refresh entries younger than 30 days', async () => {
    const now = 1_000 * DAY;
    const fake = new FakeScryfall();
    const { cache } = setup({ fake, cache: 'memory' });
    await cache!.put([{ id: shock.id, data: shock, fetchedAt: now - 29 * DAY }]);
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter({ perWindow: 1_000_000 }) });
    const source = new ScryfallCardDataSource({ client, cache, now: () => now });
    await source.get(shock.id);
    await source.refreshStale();
    await source.idle();
    expect(fake.calls).toEqual([]);
  });

  it('refreshStale fetches every cached entry older than 30 days', async () => {
    const now = 1_000 * DAY;
    const fake = new FakeScryfall();
    const { source, cache } = setup({ fake, now: () => now });
    const [a, b, c] = m19;
    await cache!.put([
      { id: a!.id, data: a, fetchedAt: now - 40 * DAY },
      { id: b!.id, data: b, fetchedAt: now - 2 * DAY },
      { id: c!.id, data: c, fetchedAt: now - 31 * DAY },
    ]);
    await source.refreshStale();
    const posts = fake.callsTo('/cards/collection');
    expect(posts).toHaveLength(1);
    expect((posts[0]!.body as { identifiers: { id: string }[] }).identifiers.map((i) => i.id).sort()).toEqual([a!.id, c!.id].sort());
    expect(await cache!.stale(now - CARD_REFRESH_AGE_MS)).toEqual([]);
  });

  it('ignores a corrupt cache record and fetches the card instead', async () => {
    const { source, cache, fake } = setup({ cache: 'memory' });
    await cache!.put([{ id: shock.id, data: { nonsense: true }, fetchedAt: 1_000 * DAY }]);
    expect(await source.get(shock.id)).toEqual(shock);
    expect(fake.callsTo('/cards/collection')).toHaveLength(1);
  });

  it('works without a cache, and a missing id resolves to null', async () => {
    const { source } = setup({ cache: null });
    expect(await source.get(shock.id)).toEqual(shock);
    expect(await source.get('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('concurrent lookups made together share one /cards/collection request', async () => {
    const { source, fake } = setup({ cache: null });
    const ids = m19.slice(0, 30).map((c) => c.id);
    const cards = await Promise.all([...ids, ...ids].map((id) => source.get(id)));
    expect(cards.map((c) => c?.id)).toEqual([...ids, ...ids]);
    expect(fake.callsTo('/cards/collection')).toHaveLength(1);
  });

  it('getMany returns only found cards, keyed by id', async () => {
    const { source } = setup();
    const res = await source.getMany([shock.id, 'missing-id', shock.id]);
    expect(Object.keys(res)).toEqual([shock.id]);
  });
});

describe('tokens', () => {
  it('relatedTokens follows all_parts to the token card', async () => {
    const { source } = setup();
    const tokens = await source.relatedTokens(angel);
    expect(tokens.map((t) => [t.name, t.layout])).toEqual([['Angel', 'token']]);
    expect(await source.relatedTokens(shock)).toEqual([]);
  });

  it('searchTokens finds tokens and caches them for peek', async () => {
    const { source } = setup();
    const [zombie] = await source.searchTokens('zombie');
    expect(zombie?.name).toBe('Zombie');
    expect(source.peek(zombie!.id)).toEqual(zombie);
  });
});

describe('IdbCardCache', () => {
  it('put, get, getMany and stale against the schema v1 `cards` store', async () => {
    const cache = new IdbCardCache(() => openDb(`cards-unit-${++dbCount}`));
    const [a, b] = m19;
    await cache.put([
      { id: a!.id, data: a, fetchedAt: 10 },
      { id: b!.id, data: b, fetchedAt: 20 },
    ]);
    expect(await cache.get(a!.id)).toEqual({ id: a!.id, data: a, fetchedAt: 10 });
    expect(await cache.get('nope')).toBeNull();
    expect((await cache.getMany([b!.id, 'nope', a!.id])).map((r) => r.id)).toEqual([b!.id, a!.id]);
    expect(await cache.stale(20)).toEqual([a!.id]);
    expect((await cache.stale(21)).sort()).toEqual([a!.id, b!.id].sort());
    await cache.put([{ id: a!.id, data: a, fetchedAt: 30 }]);
    expect(await cache.stale(21)).toEqual([b!.id]);
  });
});
