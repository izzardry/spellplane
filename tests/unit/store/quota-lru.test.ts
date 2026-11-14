/**
 * PLAN M5-P3: image cache limits with LRU eviction (store/images.ts cacheFirst and trimCache, the limit from
 * store/quota.ts). The Cache API keeps insertion order; a hit re-inserts its entry, so eviction from the front removes
 * the images unused the longest. The cache and the network are fakes; no request leaves the test.
 */
import { describe, expect, it, vi } from 'vitest';
import { cacheFirst, touch, trimCache, type ImageCache } from '../../../src/store/images';
import { imageEntryLimit, IMAGE_ENTRY_BYTES } from '../../../src/store/quota';

const url = (n: number): string => `https://cards.scryfall.io/normal/front/0/0/card-${n}.jpg`;

/** Cache API stand-in: keys in insertion order; `put` of an existing key replaces it in place, as `Cache.put` may. */
class OrderedCache implements ImageCache {
  readonly entries = new Map<string, Response>();
  failPut = false;
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(String(request instanceof Request ? request.url : request))?.clone();
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failPut) throw new DOMException('quota', 'QuotaExceededError');
    // Map#set on an existing key keeps its place: a re-insert must delete first to move to the end.
    this.entries.set(String(request instanceof Request ? request.url : request), response);
  }
  async keys(): Promise<readonly Request[]> {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(String(request instanceof Request ? request.url : request));
  }
  order(): number[] {
    return [...this.entries.keys()].map((k) => Number(/card-(\d+)/.exec(k)![1]));
  }
}

function deferrals(): { defer: (p: Promise<unknown>) => void; settle: () => Promise<void> } {
  const work: Promise<unknown>[] = [];
  return {
    defer: (p) => void work.push(p),
    settle: async () => {
      while (work.length) await work.shift();
    },
  };
}

const image = (n: number): Response => new Response(`jpeg-${n}`, { status: 200, headers: { 'content-type': 'image/jpeg' } });

async function load(cache: OrderedCache, n: number, limit: () => number | Promise<number>, fetchFn = vi.fn(async () => image(n))): Promise<string> {
  const { defer, settle } = deferrals();
  const res = await cacheFirst(new Request(url(n)), cache, fetchFn, defer, limit);
  await settle();
  return res.text();
}

describe('LRU eviction of the image cache', () => {
  it('evicts the least recently used image, not the oldest stored one', async () => {
    const cache = new OrderedCache();
    const limit = () => 3;
    for (const n of [1, 2, 3]) await load(cache, n, limit);
    expect(cache.order()).toEqual([1, 2, 3]);
    // Card 1 is shown again: answered from the cache, and now the most recently used.
    const network = vi.fn(async () => image(99));
    const { defer, settle } = deferrals();
    expect(await (await cacheFirst(new Request(url(1)), cache, network, defer, limit)).text()).toBe('jpeg-1');
    await settle();
    expect(network).not.toHaveBeenCalled();
    expect(cache.order()).toEqual([2, 3, 1]);
    // A fourth image makes room by evicting card 2, the one unused the longest.
    await load(cache, 4, limit);
    expect(cache.order()).toEqual([3, 1, 4]);
  });

  it('keeps the cache at the limit the quota allows, evicting more when the origin is over its share', async () => {
    const cache = new OrderedCache();
    for (let n = 0; n < 10; n++) await load(cache, n, () => 100);
    expect(cache.entries.size).toBe(10);
    // The origin now uses its share plus three entries' worth: the next store trims to 10 + 1 - 3 entries.
    const quota = 1_000_000;
    const limit = async () => imageEntryLimit({ usage: quota / 2 + 3 * IMAGE_ENTRY_BYTES, quota, persisted: false, imageEntries: cache.entries.size });
    await load(cache, 10, limit);
    expect(cache.order()).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('an image answered from the cache still comes back when moving it fails', async () => {
    const cache = new OrderedCache();
    await load(cache, 1, () => 10);
    cache.failPut = true;
    const { defer, settle } = deferrals();
    const res = await cacheFirst(new Request(url(1)), cache, vi.fn(), defer, () => 10);
    expect(await res.text()).toBe('jpeg-1');
    await expect(settle()).resolves.toBeUndefined();
  });

  it('a failed store (quota exceeded) still returns the image and evicts nothing', async () => {
    const cache = new OrderedCache();
    for (const n of [1, 2]) await load(cache, n, () => 2);
    cache.failPut = true;
    expect(await load(cache, 3, () => 2)).toBe('jpeg-3');
    expect(cache.order()).toEqual([1, 2]);
  });

  it('touch moves an entry to the end; trimCache never evicts below zero or on a negative limit', async () => {
    const cache = new OrderedCache();
    for (const n of [1, 2, 3]) await cache.put(url(n), image(n));
    await touch(cache, url(1), image(1));
    expect(cache.order()).toEqual([2, 3, 1]);
    expect(await trimCache(cache, -5)).toBe(3);
    expect(cache.entries.size).toBe(0);
    expect(await trimCache(cache, 10)).toBe(0);
  });
});
