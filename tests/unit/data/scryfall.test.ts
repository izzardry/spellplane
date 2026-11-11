// M0-P2: Scryfall client (DESIGN "Specification: card data, packs and draft formats", Scryfall access): set loading
// via /cards/search with next_page paging, /cards/collection in batches of 75, token search. Fixtures only.
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/data/limiter';
import { COLLECTION_BATCH, ScryfallClient, ScryfallError, type FetchLike } from '../../../src/data/scryfall';
import { FakeScryfall, loadFixtureSet } from './fakeScryfall';

/** A limiter that never waits, so these tests run on real timers. */
const unlimited = () => new RateLimiter({ perWindow: 1_000_000 });

describe('set loading', () => {
  it('loads every M19 card with the design query, following next_page across pages', async () => {
    const fake = new FakeScryfall({ pageSize: 100 });
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    const cards = await client.loadSet('M19');
    expect(cards).toEqual(loadFixtureSet('m19.json'));
    const calls = fake.callsTo('/cards/search');
    expect(calls).toHaveLength(4);
    const first = new URL(calls[0]!.url);
    expect(first.searchParams.get('q')).toBe('e:m19 game:paper');
    expect(first.searchParams.get('unique')).toBe('prints');
    expect(first.searchParams.get('order')).toBe('set');
    expect(new URL(calls[3]!.url).searchParams.get('page')).toBe('4');
  });

  it('returns cards trimmed to the stored fields', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    const [card] = await client.loadSet('m19');
    expect(card).not.toHaveProperty('prices');
    expect(card).not.toHaveProperty('object');
  });

  it('an unknown set (Scryfall 404) gives no cards rather than an error', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    expect(await client.loadSet('zzz')).toEqual([]);
  });

  it('does not follow a next_page that leaves the API host, nor loop on a repeated page', async () => {
    const page = (next: string) =>
      new Response(JSON.stringify({ object: 'list', has_more: true, next_page: next, data: [loadFixtureSet('m19.json')[0]] }), { status: 200 });
    let n = 0;
    const evil: FetchLike = async () => (n++ === 0 ? page('https://evil.example/cards/search?page=2') : page('x'));
    expect(await new ScryfallClient({ fetch: evil, limiter: unlimited() }).search('e:m19')).toHaveLength(1);
    expect(n).toBe(1);
    const loop: FetchLike = async () => page('https://api.scryfall.com/cards/search?q=e%3Am19&page=2');
    const looped = await new ScryfallClient({ fetch: loop, limiter: unlimited() }).search('e:m19');
    expect(looped).toHaveLength(2);
  });

  it('throws on server errors other than 404 and 429', async () => {
    const portal: FetchLike = async () => new Response('<html>captive portal</html>', { status: 200 });
    const err: unknown = await new ScryfallClient({ fetch: portal, limiter: unlimited() }).loadSet('m19').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScryfallError);
    expect(err).toMatchObject({ status: 200, message: 'Scryfall: invalid JSON' });
    const broken: FetchLike = async () => new Response('{}', { status: 500 });
    await expect(new ScryfallClient({ fetch: broken, limiter: unlimited() }).loadSet('m19')).rejects.toMatchObject({ status: 500 });
  });
});

describe('collection', () => {
  it('splits identifiers into batches of 75 and keeps request order', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    const ids = fake.cards.slice(0, 160).map((c) => ({ id: c.id }));
    const res = await client.collection(ids);
    const posts = fake.callsTo('/cards/collection');
    expect(COLLECTION_BATCH).toBe(75);
    expect(posts.map((c) => (c.body as { identifiers: unknown[] }).identifiers.length)).toEqual([75, 75, 10]);
    expect(posts.every((c) => c.method === 'POST')).toBe(true);
    expect(res.cards.map((c) => c?.id)).toEqual(ids.map((i) => i.id));
    expect(res.notFound).toEqual([]);
  });

  it('maps not-found identifiers to null in place and lists them', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    const res = await client.collection([
      { name: 'Shock' },
      { name: 'Not A Real Card Name' },
      { set: 'm19', collector_number: '218' },
      { set: 'm19', collector_number: '9999' },
      { name: 'llanowar elves' },
    ]);
    expect(res.cards.map((c) => c?.name ?? null)).toEqual(['Shock', null, 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen', null, 'Llanowar Elves']);
    expect(res.notFound).toEqual([{ name: 'Not A Real Card Name' }, { set: 'm19', collector_number: '9999' }]);
  });

  it('an empty request makes no call', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    expect(await client.collection([])).toEqual({ cards: [], notFound: [] });
    expect(fake.calls).toEqual([]);
  });
});

describe('tokens', () => {
  it('token search returns tokens only, matching the query', async () => {
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: unlimited() });
    const angels = await client.searchTokens('angel');
    expect(angels.map((c) => c.name)).toEqual(['Angel']);
    expect(angels[0]!.layout).toBe('token');
    expect(new URL(fake.calls[0]!.url).searchParams.get('q')).toBe('t:token angel');
    expect(await client.searchTokens('no such token')).toEqual([]);
  });
});
