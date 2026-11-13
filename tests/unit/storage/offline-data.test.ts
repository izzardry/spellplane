/**
 * PLAN M5-P3: graceful behaviour when Scryfall or MTGJSON is unreachable — a clear message, cached data still usable,
 * no endless spinners (DESIGN "Card data and images", Caching: card JSON and set files are cached in IndexedDB). The
 * network is a fake that fails, hangs or answers from tests/fixtures/; nothing leaves the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecklist } from '../../../src/data/decklist';
import { RateLimiter } from '../../../src/data/limiter';
import { createSetDataSource, MTGJSON_SET_LIST_URL } from '../../../src/data/mtgjson';
import { guarded, isUnreachable, REQUEST_TIMEOUT_MS, UnreachableError } from '../../../src/data/offline';
import { ScryfallClient, ScryfallError, type FetchLike } from '../../../src/data/scryfall';
import { ScryfallCardDataSource } from '../../../src/data/source';
import { FEATURED_SET_INFO } from '../../../src/data/sets';
import { MTGJSON_SET_URL } from '../../../src/data/types';
import { IdbCardCache } from '../../../src/store/cards';
import { openDb } from '../../../src/store/db';
import { MemorySetCache } from '../../../src/store/sets';
import { FakeScryfall, fixtureDecklist, loadFixtureSet } from '../data/fakeScryfall';
import { readFileSync } from 'node:fs';

afterEach(() => {
  vi.useRealTimers();
});

const unlimited = () => new RateLimiter({ perWindow: 1_000_000 });
const failing: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
/** A request that never gets an answer (a dead connection), but honours its abort signal like fetch does. */
const hanging = vi.fn<FetchLike>((_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));

describe('guarded requests', () => {
  it('turns a failed fetch into a clear message saying whether the device is offline', async () => {
    const offline = await guarded('Scryfall', 'u', () => Promise.reject(new TypeError('Failed to fetch')), { online: () => false }).catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(UnreachableError);
    expect(offline).toMatchObject({ service: 'Scryfall', reason: 'offline' });
    expect((offline as Error).message).toBe('Scryfall cannot be reached: this device is offline. Cards already loaded on this device still work; try again when you are back online.');
    const network = await guarded('MTGJSON', 'u', () => Promise.reject(new TypeError('Load failed')), { online: () => true }).catch((e: unknown) => e);
    expect(network).toMatchObject({ service: 'MTGJSON', reason: 'network' });
    expect((network as Error).message).toMatch(/^MTGJSON cannot be reached right now.*Sets already loaded on this device still work/);
    expect(isUnreachable(network)).toBe(true);
    expect(isUnreachable(new Error('x'))).toBe(false);
  });

  it('gives up on a request without an answer after the timeout and aborts it: no endless wait', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const p = guarded('Scryfall', 'u', (s) => {
      signal = s;
      return new Promise<never>(() => undefined); // ignores the signal, like a stuck polyfill
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.Scryfall - 1);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(err).toMatchObject({ reason: 'timeout' });
    expect((err as Error).message).toBe('Scryfall did not answer within 20 seconds. Cards already loaded on this device still work; try again later.');
    expect(signal!.aborted).toBe(true);
  });

  it('the deadline covers the body too: a stalled download times out', async () => {
    vi.useFakeTimers();
    const p = guarded('MTGJSON', 'u', async () => {
      await Promise.resolve(new Response('{}'));
      return new Promise<never>(() => undefined); // the body never finishes
    }, { timeoutMs: 1000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ reason: 'timeout' });
  });

  it('passes through the caller’s own abort and errors that are not about reaching the service', async () => {
    const ctl = new AbortController();
    const p = guarded('Scryfall', 'u', (s) => new Promise((_, reject) => s.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))), { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await expect(guarded('Scryfall', 'u', () => Promise.reject(new SyntaxError('bad json')))).rejects.toBeInstanceOf(SyntaxError);
    await expect(guarded('Scryfall', 'u', () => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('Scryfall unreachable', () => {
  it('fails at once with the offline message and asks nothing while the browser is offline', async () => {
    const fetchFn = vi.fn(failing);
    const client = new ScryfallClient({ fetch: fetchFn, limiter: unlimited(), online: () => false });
    await expect(client.searchTokens('goblin')).rejects.toMatchObject({ name: 'UnreachableError', reason: 'offline' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a failed connection is reported once, without retries that would hold the screen', async () => {
    const fetchFn = vi.fn(failing);
    const client = new ScryfallClient({ fetch: fetchFn, limiter: unlimited(), online: () => true });
    const err = await client.collection([{ name: 'Shock' }]).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'network' });
    expect((err as Error).message).toMatch(/Cards already loaded on this device still work/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a request without an answer ends after the timeout', async () => {
    vi.useFakeTimers();
    hanging.mockClear();
    const client = new ScryfallClient({ fetch: hanging, limiter: unlimited(), online: () => true, timeoutMs: 5000 });
    const p = client.search('x');
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await caught).toMatchObject({ reason: 'timeout' });
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it('an error page from Scryfall says what happened and that cached cards still work', async () => {
    const client = new ScryfallClient({ fetch: async () => new Response('busy', { status: 503 }), limiter: unlimited(), online: () => true });
    const err = await client.search('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScryfallError);
    expect((err as Error).message).toMatch(/^Scryfall 503: .*Cards already loaded on this device still work/);
  });

  it('cards fetched before stay usable from the IndexedDB cache when Scryfall cannot be reached', async () => {
    const dbName = `offline-cards-${Math.random().toString(36).slice(2)}`;
    const cacheOf = () => new IdbCardCache(() => openDb(dbName));
    const online = new ScryfallCardDataSource({ client: new ScryfallClient({ fetch: new FakeScryfall().fetch, limiter: unlimited(), online: () => true }), cache: cacheOf(), now: () => 1000 });
    const deck = await online.resolveDeck(parseDecklist(fixtureDecklist('gw-m19-60.txt')).list);
    const ids = Object.keys(deck.cards);
    expect(ids.length).toBeGreaterThan(5);

    // A new page, offline: every card of the deck still comes from the cache, without a request.
    const fetchFn = vi.fn(failing);
    const offline = new ScryfallCardDataSource({ client: new ScryfallClient({ fetch: fetchFn, limiter: unlimited(), online: () => false }), cache: cacheOf(), now: () => 2000 });
    const found = await offline.getMany(ids);
    expect(Object.keys(found).sort()).toEqual([...ids].sort());
    expect(fetchFn).not.toHaveBeenCalled();
    // A card never seen before cannot be looked up: a clear error, not a silent hang.
    const unseen = loadFixtureSet('m20.json')[0]!;
    await expect(offline.get(unseen.id)).rejects.toMatchObject({ name: 'UnreachableError', reason: 'offline' });
    // Importing a decklist needs Scryfall's name lookup: the player is told why it fails.
    await expect(offline.resolveDeck(parseDecklist('4 Shock').list)).rejects.toThrow(/Scryfall cannot be reached: this device is offline/);
  });
});

describe('MTGJSON unreachable', () => {
  const rawM19 = JSON.parse(readFileSync(new URL('../../fixtures/mtgjson/M19.json', import.meta.url), 'utf8')) as unknown;

  it('a set used before still loads from the cache; a new one fails with a message naming what still works', async () => {
    const cache = new MemorySetCache();
    const online = createSetDataSource({ fetch: (async () => Response.json(rawM19)) as unknown as typeof fetch, cache, now: () => 0, setList: false, online: () => true });
    const m19 = await online.get('M19');
    expect(m19).not.toBeNull();

    const fetchFn = vi.fn(failing) as unknown as typeof fetch;
    const offline = createSetDataSource({ fetch: fetchFn, cache, now: () => 1, setList: false, online: () => false });
    expect(await offline.get('M19')).toEqual(m19);
    const err = await offline.get('M20').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'UnreachableError', service: 'MTGJSON', reason: 'offline', url: MTGJSON_SET_URL('M20') });
    expect((err as Error).message).toMatch(/Sets already loaded on this device still work/);
    expect(fetchFn).not.toHaveBeenCalled();
    // The failure is not remembered: the set is asked for again once back online.
    expect(offline.peek('M20')).toBeNull();
  });

  it('a stalled set file ends with a timeout instead of an endless spinner', async () => {
    vi.useFakeTimers();
    hanging.mockClear();
    const src = createSetDataSource({ fetch: hanging as unknown as typeof fetch, cache: null, setList: false, online: () => true, timeoutMs: 3000 });
    const caught = src.get('M21').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await caught).toMatchObject({ reason: 'timeout' });
    expect((await caught as Error).message).toMatch(/^MTGJSON did not answer within 3 seconds/);
  });

  it('the set picker still lists the featured and cached sets while MTGJSON is out of reach, and never waits forever', async () => {
    vi.useFakeTimers();
    hanging.mockClear();
    const cache = new MemorySetCache();
    const src = createSetDataSource({ fetch: hanging as unknown as typeof fetch, cache, setList: true, online: () => true, timeoutMs: 60_000 });
    const listed = src.listSets();
    // The list request gives up sooner than a set file (the picker waits for it).
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.Scryfall);
    const sets = await listed;
    expect(hanging.mock.calls.map((c) => c[0])).toEqual([MTGJSON_SET_LIST_URL]);
    expect(sets.map((s) => s.code)).toEqual(FEATURED_SET_INFO.map((s) => s.code));

    const offlineFetch = vi.fn(failing) as unknown as typeof fetch;
    const offline = createSetDataSource({ fetch: offlineFetch, cache, setList: true, online: () => false });
    expect((await offline.listSets()).map((s) => s.code)).toEqual(FEATURED_SET_INFO.map((s) => s.code));
    expect(offlineFetch).not.toHaveBeenCalled();
  });
});
