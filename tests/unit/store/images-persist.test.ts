/**
 * Service-worker image cache (DESIGN "Card data and images", Caching: images go through a service worker into the
 * Cache API, cache-first; all caches are rebuildable) and the storage persistence request (the app requests
 * persistent storage but never depends on it). No network: fetch is a fake.
 */
import { describe, expect, it, vi } from 'vitest';
import { cacheFirst, isCardImageRequest, trimCache, type ImageCache } from '../../../src/store/images';
import { requestPersistentStorage, isStoragePersisted, type PersistApi } from '../../../src/store/persist';

const IMG = 'https://cards.scryfall.io/normal/front/0/0/0000579f-7b35-4ed3-b44c-db2a538066fe.jpg?1562894979';

/** An in-memory Cache API stand-in keyed by URL, keys in insertion order like the real one. */
class FakeCache implements ImageCache {
  readonly entries = new Map<string, Response>();
  failPut = false;
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(String(request instanceof Request ? request.url : request));
    return hit?.clone();
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failPut) throw new DOMException('quota', 'QuotaExceededError');
    const key = String(request instanceof Request ? request.url : request);
    this.entries.delete(key);
    this.entries.set(key, response);
  }
  async keys(): Promise<readonly Request[]> {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(String(request instanceof Request ? request.url : request));
  }
}

function jpeg(body = 'jpeg-bytes', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'image/jpeg' } });
}

/** Collects the work handed to waitUntil so tests can await it. */
function deferrals(): { defer: (p: Promise<unknown>) => void; settle: () => Promise<void> } {
  const work: Promise<unknown>[] = [];
  return { defer: (p) => void work.push(p), settle: async () => void (await Promise.all(work)) };
}

describe('isCardImageRequest', () => {
  it('handles GETs of Scryfall card images only', () => {
    expect(isCardImageRequest(new Request(IMG))).toBe(true);
    expect(isCardImageRequest(new Request('https://cards.scryfall.io/large/back/a/b/ab.webp'))).toBe(true);
    expect(isCardImageRequest(new Request(IMG, { method: 'HEAD' }))).toBe(false);
    expect(isCardImageRequest({ method: 'POST', url: IMG })).toBe(false);
    expect(isCardImageRequest(new Request('https://api.scryfall.com/cards/collection'))).toBe(false);
    expect(isCardImageRequest(new Request('https://cards.scryfall.io.evil.test/x.jpg'))).toBe(false);
    expect(isCardImageRequest(new Request('http://cards.scryfall.io/x.jpg'))).toBe(false);
    expect(isCardImageRequest(new Request('https://example.test/spellplane/assets/index.js'))).toBe(false);
    expect(isCardImageRequest({ method: 'GET', url: 'not a url' })).toBe(false);
  });
});

describe('cacheFirst', () => {
  it('fetches on a miss, stores a copy, and answers the next request from the cache without the network', async () => {
    const cache = new FakeCache();
    const fetchFn = vi.fn(async () => jpeg('first'));
    const { defer, settle } = deferrals();

    const r1 = await cacheFirst(new Request(IMG), cache, fetchFn, defer);
    expect(await r1.text()).toBe('first');
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cache.entries.has(IMG)).toBe(true);

    const r2 = await cacheFirst(new Request(IMG), cache, fetchFn, defer);
    expect(await r2.text()).toBe('first');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not store failed or opaque responses', async () => {
    const cache = new FakeCache();
    const { defer, settle } = deferrals();
    const notFound = await cacheFirst(new Request(IMG), cache, async () => jpeg('nope', 404), defer);
    expect(notFound.status).toBe(404);
    const opaque = { status: 0, type: 'opaque', ok: false, clone: () => opaque } as unknown as Response;
    expect(await cacheFirst(new Request(IMG), cache, async () => opaque, defer)).toBe(opaque);
    await settle();
    expect(cache.entries.size).toBe(0);
  });

  it('still answers when storing fails (quota) or the cache cannot be read', async () => {
    const cache = new FakeCache();
    cache.failPut = true;
    const { defer, settle } = deferrals();
    const r = await cacheFirst(new Request(IMG), cache, async () => jpeg('ok'), defer);
    expect(await r.text()).toBe('ok');
    await expect(settle()).resolves.toBeUndefined();

    const broken: ImageCache = { ...cache, match: () => Promise.reject(new Error('gone')), put: cache.put.bind(cache), keys: cache.keys.bind(cache), delete: cache.delete.bind(cache) };
    expect(await (await cacheFirst(new Request(IMG), broken, async () => jpeg('net'))).text()).toBe('net');
  });

  it('passes network errors through like no worker would', async () => {
    await expect(cacheFirst(new Request(IMG), new FakeCache(), async () => Promise.reject(new TypeError('offline')))).rejects.toThrow('offline');
  });

  it('keeps the cache bounded by evicting the oldest entries', async () => {
    const cache = new FakeCache();
    for (let i = 0; i < 5; i++) await cache.put(`https://cards.scryfall.io/n/${i}.jpg`, jpeg());
    expect(await trimCache(cache, 3)).toBe(2);
    expect([...cache.entries.keys()]).toEqual([2, 3, 4].map((i) => `https://cards.scryfall.io/n/${i}.jpg`));
    expect(await trimCache(cache, 3)).toBe(0);
  });
});

describe('storage persistence request', () => {
  function api(persisted: boolean, grant: boolean | Error): PersistApi & { persist: ReturnType<typeof vi.fn> } {
    return {
      persisted: vi.fn(async () => persisted),
      persist: vi.fn(async () => {
        if (grant instanceof Error) throw grant;
        return grant;
      }),
    };
  }

  it('asks the browser and reports the answer', async () => {
    const granted = api(false, true);
    expect(await requestPersistentStorage(granted)).toBe(true);
    expect(granted.persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistentStorage(api(false, false))).toBe(false);
  });

  it('does not ask again when storage is already persistent', async () => {
    const already = api(true, false);
    expect(await requestPersistentStorage(already)).toBe(true);
    expect(already.persist).not.toHaveBeenCalled();
    expect(await isStoragePersisted(already)).toBe(true);
  });

  it('never throws: unsupported or failing APIs resolve false', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({} as PersistApi)).toBe(false);
    expect(await requestPersistentStorage(api(false, new Error('denied')))).toBe(false);
    expect(await isStoragePersisted(undefined)).toBe(false);
    expect(await isStoragePersisted({ persisted: () => Promise.reject(new Error('x')) } as unknown as PersistApi)).toBe(false);
  });

  it('works with the default (absent in Node or present in a browser) navigator.storage', async () => {
    await expect(requestPersistentStorage()).resolves.toBeTypeOf('boolean');
  });
});
