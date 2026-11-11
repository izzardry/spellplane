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
 * Cache-first: answer from the cache, else fetch and store a copy of a successful (status 200, non-opaque) response.
 * Opaque responses are never stored: they cannot be read back for a CORS request (WebGL textures) and browsers pad
 * their quota cost. Storing runs in the background through `defer` (the fetch event's waitUntil); its failures
 * (quota) are swallowed because the cache is only an optimisation.
 */
export async function cacheFirst(
  request: Request,
  cache: ImageCache,
  fetchFn: (request: Request) => Promise<Response>,
  defer: (work: Promise<unknown>) => void = () => undefined,
): Promise<Response> {
  const hit = await cache.match(request.url).catch(() => undefined);
  if (hit) return hit;
  const response = await fetchFn(request);
  if (response.status === 200 && response.type !== 'opaque') {
    const copy = response.clone();
    defer(
      cache
        .put(request.url, copy)
        .then(() => trimCache(cache))
        .catch(() => undefined),
    );
  }
  return response;
}

/** Evict the oldest entries (Cache API keys come back in insertion order) until at most `max` remain. */
export async function trimCache(cache: ImageCache, max: number = MAX_IMAGE_ENTRIES): Promise<number> {
  const keys = await cache.keys();
  const excess = keys.length - max;
  if (excess <= 0) return 0;
  await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
  return excess;
}
