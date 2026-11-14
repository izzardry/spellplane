/**
 * Service worker (DESIGN "Card data and images", Caching; PLAN M5-P3: precache of the app shell, image cache limits
 * with LRU eviction; PLAN Milestone 5, owner decisions, Updates only between games).
 *
 * - App shell: every file of the build (the list vite-plugin-pwa injects as `self.__WB_MANIFEST`) is cached on install
 *   in a cache of its own version (`spellplane-shell-<version>`), and served from there, so the app loads with the
 *   network disabled after one online visit. Navigations to the app (any query, any fragment) get the cached
 *   index.html of this version.
 * - Updates: a new version installs in the background and waits; only the page's `SW_MESSAGE.skipWaiting` (posted where
 *   ui/update.ts allows, never mid-game) or the closing of every tab activates it. The first worker of a browser
 *   activates at once and claims the open page. Activation deletes the shell caches of older versions.
 * - Card images from cards.scryfall.io: cache-first in a cache namespaced by the requesting page's ?profile= flag, with
 *   least-recently-used eviction above the limit of store/quota.ts.
 * Every other request passes through untouched.
 *
 * The project's TypeScript program uses the DOM lib, so the few service-worker types needed are declared locally.
 */
import { cacheFirst, imageCacheName, isCardImageRequest } from './store/images';
import { imageEntryLimit, storageStatus, type QuotaApi } from './store/quota';
import { isShellCache, shellCacheName, shellVersion, SW_MESSAGE, type PrecacheEntry } from './util/pwa';

interface SwExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Response | Promise<Response>): void;
}

interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
}

interface SwGlobalScope {
  readonly location: Location;
  readonly registration: { readonly scope: string };
  readonly navigator: { readonly storage?: QuotaApi };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; get(id: string): Promise<{ url: string } | undefined> };
  caches: CacheStorage;
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
  addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SwMessageEvent) => void): void;
}

const sw = globalThis as unknown as SwGlobalScope;

// The build's file list (vite-plugin-pwa replaces `self.__WB_MANIFEST` with it; see vite.config.ts).
const PRECACHE: PrecacheEntry[] = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST;
const VERSION = shellVersion(PRECACHE);
const SHELL = shellCacheName(VERSION);
/** Absolute URL of every precached file. */
const SHELL_URLS = new Set(PRECACHE.map((e) => new URL(e.url, sw.registration.scope).href));
const INDEX = new URL('index.html', sw.registration.scope).href;

sw.addEventListener('install', (event) => {
  // Fetch every file past the HTTP cache, so a new version never stores an old file. A failed file fails the install:
  // the old version keeps serving and the browser retries later.
  event.waitUntil(
    sw.caches.open(SHELL).then((cache) =>
      Promise.all(
        [...SHELL_URLS].map(async (url) => {
          const res = await sw.fetch(url, { cache: 'reload' });
          if (!res.ok) throw new Error(`precache ${url}: HTTP ${res.status}`);
          await cache.put(url, res);
        }),
      ),
    ),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await sw.caches.keys()) {
        if (isShellCache(name) && name !== SHELL) await sw.caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  const data = event.data;
  if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === SW_MESSAGE.skipWaiting) {
    event.waitUntil(sw.skipWaiting());
  }
});

async function imageCacheFor(event: SwFetchEvent): Promise<{ cache: Cache; name: string }> {
  const id = event.clientId || event.resultingClientId;
  const client = id ? await sw.clients.get(id) : undefined;
  const name = imageCacheName(client?.url);
  return { cache: await sw.caches.open(name), name };
}

async function handleImage(event: SwFetchEvent): Promise<Response> {
  let target: { cache: Cache; name: string };
  try {
    target = await imageCacheFor(event);
  } catch {
    // No Cache API (storage blocked): behave as if the worker were not there.
    return sw.fetch(event.request);
  }
  return cacheFirst(
    event.request,
    target.cache,
    (request) => sw.fetch(request),
    (work) => event.waitUntil(work),
    async () => imageEntryLimit(await storageStatus(sw.navigator.storage, sw.caches, target.name)),
  );
}

/** The shell file for a request: index.html for a navigation into the app, the file itself for a precached URL. */
function shellKey(request: Request): string | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return null;
  url.search = '';
  url.hash = '';
  if (request.mode === 'navigate') {
    const scope = new URL(sw.registration.scope);
    return url.pathname === scope.pathname || url.href === INDEX ? INDEX : null;
  }
  return SHELL_URLS.has(url.href) ? url.href : null;
}

async function handleShell(request: Request, key: string): Promise<Response> {
  try {
    const cache = await sw.caches.open(SHELL);
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    // Fall through to the network.
  }
  return sw.fetch(request);
}

sw.addEventListener('fetch', (event) => {
  if (isCardImageRequest(event.request)) {
    event.respondWith(handleImage(event));
    return;
  }
  const key = shellKey(event.request);
  if (key) event.respondWith(handleShell(event.request, key));
});
