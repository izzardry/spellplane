/**
 * Card image cache logic for the service worker (DESIGN "Card data and images", Caching: images go through a service
 * worker into the Cache API, cache-first; all caches are rebuildable). Kept free of service-worker globals so it is
 * unit-testable; `src/sw.ts` wires it to the fetch event.
 */
import { parseFlags } from '../util/flags';
import { cacheName } from './profile';

/** Base name of the image cache; namespaced per ?profile= like the database. */
export const IMAGE_CACHE_BASE = 'spellplane-images';

/** Host that serves Scryfall card images (DESIGN "Card data and images"). */
export const CARD_IMAGE_HOST = 'cards.scryfall.io';

/** Entries kept before the oldest are evicted (a normal-tier image is roughly 50–100 kB). */
export const MAX_IMAGE_ENTRIES = 2000;

/** Whether the service worker should answer this request from the image cache. */
export function isCardImageRequest(request: Pick<Request, 'method' | 'url'>): boolean {
  if (request.method !== 'GET') return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' && url.hostname === CARD_IMAGE_HOST;
  } catch {
    return false;
  }
}

/** Cache name for the page at `clientUrl`: `spellplane-images`, or `spellplane-images-<profile>` with ?profile=. */
export function imageCacheName(clientUrl: string | null | undefined): string {
  let profile: string | null = null;
  if (clientUrl) {
    try {
      profile = parseFlags(new URL(clientUrl).search).profile;
    } catch {
      profile = null;
    }
  }
  return cacheName(IMAGE_CACHE_BASE, profile);
}

/** The Cache API methods used here. */
export type ImageCache = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;

/**
 * Cache-first with least-recently-used eviction (PLAN M5-P3: image cache limits with LRU eviction). A hit is answered
 * from the cache and re-inserted in the background, so the Cache API's insertion order (`keys()`) is least-recently-used
 * order. A miss is fetched and a copy of a successful (status 200, non-opaque) response is stored, then the cache is
 * trimmed from the front to `limit()` entries (default MAX_IMAGE_ENTRIES; the service worker passes the quota-aware
 * limit of store/quota.ts). Opaque responses are never stored: they cannot be read back for a CORS request (WebGL
 * textures) and browsers pad their quota cost. Background work runs through `defer` (the fetch event's waitUntil); its
 * failures (quota) are swallowed because the cache is only an optimisation.
 */
export async function cacheFirst(
  request: Request,
  cache: ImageCache,
  fetchFn: (request: Request) => Promise<Response>,
  defer: (work: Promise<unknown>) => void = () => undefined,
  limit: () => Promise<number> | number = () => MAX_IMAGE_ENTRIES,
): Promise<Response> {
  const hit = await cache.match(request.url).catch(() => undefined);
  if (hit) {
    defer(touch(cache, request.url, hit.clone()));
    return hit;
  }
  const response = await fetchFn(request);
  if (response.status === 200 && response.type !== 'opaque') {
    const copy = response.clone();
    defer(
      cache
        .put(request.url, copy)
        .then(async () => trimCache(cache, await limit()))
        .catch(() => undefined),
    );
  }
  return response;
}

/**
 * Mark an entry as just used: delete and put it again, so it moves to the end of the insertion order. Never throws; an
 * entry evicted meanwhile is not brought back by a failed put.
 */
export async function touch(cache: ImageCache, url: string, response: Response): Promise<void> {
  try {
    await cache.delete(url);
    await cache.put(url, response);
  } catch {
    // The cache is only an optimisation.
  }
}

/** Evict the least recently used entries (Cache API keys come back in insertion order) until at most `max` remain. */
export async function trimCache(cache: ImageCache, max: number = MAX_IMAGE_ENTRIES): Promise<number> {
  const keys = await cache.keys();
  const excess = keys.length - Math.max(0, Math.floor(max));
  if (excess <= 0) return 0;
  await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
  return excess;
}
