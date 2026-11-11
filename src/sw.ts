/**
 * Service worker (DESIGN "Card data and images", Caching): Scryfall card images from cards.scryfall.io are served
 * cache-first from the Cache API, in a cache namespaced by the requesting page's ?profile= flag. Every other request
 * passes through untouched. Built by vite-plugin-pwa (injectManifest, no precache) and registered in production builds
 * only (vite.config.ts).
 *
 * The project's TypeScript program uses the DOM lib, so the few service-worker types needed are declared locally.
 */
import { cacheFirst, imageCacheName, isCardImageRequest } from './store/images';

interface SwExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Response | Promise<Response>): void;
}

interface SwGlobalScope {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; get(id: string): Promise<{ url: string } | undefined> };
  caches: CacheStorage;
  fetch(request: Request): Promise<Response>;
  addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
}

const sw = globalThis as unknown as SwGlobalScope;

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

async function cacheFor(event: SwFetchEvent): Promise<Cache> {
  const id = event.clientId || event.resultingClientId;
  const client = id ? await sw.clients.get(id) : undefined;
  return sw.caches.open(imageCacheName(client?.url));
}

async function handle(event: SwFetchEvent): Promise<Response> {
  let cache: Cache;
  try {
    cache = await cacheFor(event);
  } catch {
    // No Cache API (storage blocked): behave as if the worker were not there.
    return sw.fetch(event.request);
  }
  return cacheFirst(
    event.request,
    cache,
    (request) => sw.fetch(request),
    (work) => event.waitUntil(work),
  );
}

sw.addEventListener('fetch', (event) => {
  if (!isCardImageRequest(event.request)) return;
  event.respondWith(handle(event));
});
