/**
 * The service worker (src/sw.ts; PLAN M5-P3: precache of the app shell; PLAN Milestone 5, owner decisions: updates only
 * between games). The worker module runs in a fake service-worker global scope: CacheStorage in memory, a network that
 * can be cut, captured event listeners. No request leaves the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isShellCache, shellCacheName, shellVersion, SW_MESSAGE, type PrecacheEntry } from '../../../src/util/pwa';

const SCOPE = 'https://example.test/spellplane/';
const MANIFEST: PrecacheEntry[] = [
  { url: 'index.html', revision: 'r1' },
  { url: 'assets/index-abc.js', revision: null },
  { url: 'assets/dusk-def.js', revision: null },
  { url: 'assets/Roboto-Medium-123.ttf', revision: null },
  { url: 'manifest.webmanifest', revision: 'm1' },
];

class MemCache {
  readonly entries = new Map<string, Response>();
  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(String(req instanceof Request ? req.url : req))?.clone();
  }
  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    const k = String(req instanceof Request ? req.url : req);
    this.entries.delete(k);
    this.entries.set(k, res);
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(req: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(String(req instanceof Request ? req.url : req));
  }
}

class MemCaches {
  readonly caches = new Map<string, MemCache>();
  async open(name: string): Promise<MemCache> {
    let c = this.caches.get(name);
    if (!c) this.caches.set(name, (c = new MemCache()));
    return c;
  }
  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

type Listener = (event: unknown) => void;

interface Scope {
  listeners: Record<string, Listener[]>;
  caches: MemCaches;
  online: boolean;
  fetched: { url: string; init: RequestInit | undefined }[];
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  clientUrl: string;
  failUrl: string | null;
}

let scope: Scope;

async function loadWorker(manifest: PrecacheEntry[] = MANIFEST): Promise<void> {
  scope = { listeners: {}, caches: new MemCaches(), online: true, fetched: [], skipWaiting: vi.fn(async () => undefined), claim: vi.fn(async () => undefined), clientUrl: `${SCOPE}?profile=ann#/`, failUrl: null };
  const s = scope;
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('__WB_MANIFEST', manifest);
  vi.stubGlobal('registration', { scope: SCOPE });
  vi.stubGlobal('location', new URL(`${SCOPE}sw.js`));
  vi.stubGlobal('caches', s.caches);
  vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1000, quota: 1_000_000_000 }), persisted: async () => false, persist: async () => false } });
  vi.stubGlobal('clients', { claim: s.claim, get: async () => ({ url: s.clientUrl }) });
  vi.stubGlobal('skipWaiting', s.skipWaiting);
  vi.stubGlobal('addEventListener', (type: string, l: Listener) => (s.listeners[type] ??= []).push(l));
  vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    s.fetched.push({ url, init });
    if (!s.online) throw new TypeError('Failed to fetch');
    if (url === s.failUrl) return new Response('gone', { status: 404 });
    return new Response(`body of ${url}`, { status: 200 });
  });
  vi.resetModules();
  await import('../../../src/sw');
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

/** Dispatch an extendable event and wait for everything it handed to waitUntil (and its response). */
async function dispatch(type: string, fields: Record<string, unknown> = {}): Promise<{ response: Response | null; settled: Promise<unknown> }> {
  const work: Promise<unknown>[] = [];
  let response: Promise<Response> | Response | null = null;
  const event = { ...fields, waitUntil: (p: Promise<unknown>) => void work.push(p), respondWith: (r: Promise<Response> | Response) => (response = r) };
  for (const l of scope.listeners[type] ?? []) l(event);
  const res = response ? await response : null;
  return { response: res, settled: Promise.all(work) };
}

const nav = (url: string) => ({ url, method: 'GET', mode: 'navigate' }) as unknown as Request;
const get = (url: string) => ({ url, method: 'GET', mode: 'cors' }) as unknown as Request;

const SHELL = shellCacheName(shellVersion(MANIFEST));

describe('installing a version', () => {
  it('caches every file of the build past the HTTP cache, and waits instead of taking over', async () => {
    await loadWorker();
    const { settled } = await dispatch('install');
    await settled;
    const shell = scope.caches.caches.get(SHELL)!;
    expect([...shell.entries.keys()].sort()).toEqual(MANIFEST.map((e) => new URL(e.url, SCOPE).href).sort());
    expect(scope.fetched.every((f) => f.init?.cache === 'reload')).toBe(true);
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it('fails the install when a file cannot be fetched, so the running version keeps serving', async () => {
    await loadWorker();
    scope.failUrl = `${SCOPE}assets/dusk-def.js`;
    const { settled } = await dispatch('install');
    await expect(settled).rejects.toThrow(/dusk-def\.js: HTTP 404/);
  });

  it('takes over only when the page says so', async () => {
    await loadWorker();
    await (await dispatch('message', { data: { type: 'something-else' } })).settled;
    await (await dispatch('message', { data: 'spellplane:skip-waiting' })).settled;
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    await (await dispatch('message', { data: { type: SW_MESSAGE.skipWaiting } })).settled;
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('activating deletes older versions’ shells, keeps the image caches, and claims open pages', async () => {
    await loadWorker();
    await scope.caches.open('spellplane-shell-old1');
    await scope.caches.open('spellplane-images-ann');
    await scope.caches.open(SHELL);
    await (await dispatch('activate')).settled;
    expect((await scope.caches.keys()).sort()).toEqual([SHELL, 'spellplane-images-ann'].sort());
    expect(scope.claim).toHaveBeenCalledTimes(1);
  });

  it('gives every build its own shell cache', () => {
    const changed = MANIFEST.map((e) => (e.url === 'index.html' ? { ...e, revision: 'r2' } : e));
    expect(shellVersion(changed)).not.toBe(shellVersion(MANIFEST));
    expect(shellVersion([...MANIFEST].reverse())).toBe(shellVersion(MANIFEST));
    expect(isShellCache(SHELL)).toBe(true);
    expect(isShellCache('spellplane-images')).toBe(false);
  });
});

describe('serving with the network cut', () => {
  async function installedOffline(): Promise<void> {
    await loadWorker();
    await (await dispatch('install')).settled;
    await (await dispatch('activate')).settled;
    scope.online = false;
    scope.fetched.length = 0;
  }

  it('answers a navigation into the app (any query, any fragment) with the cached index.html', async () => {
    await installedOffline();
    for (const url of [SCOPE, `${SCOPE}?faces=placeholder&profile=ann`, `${SCOPE}index.html?sw=on`]) {
      const { response } = await dispatch('fetch', { request: nav(url), clientId: '', resultingClientId: 'c1' });
      expect(await response!.text()).toBe(`body of ${SCOPE}index.html`);
    }
    expect(scope.fetched).toEqual([]);
  });

  it('answers the build’s files from the shell, and leaves other requests alone', async () => {
    await installedOffline();
    const { response } = await dispatch('fetch', { request: get(`${SCOPE}assets/dusk-def.js?import`), clientId: 'c1', resultingClientId: '' });
    expect(await response!.text()).toBe(`body of ${SCOPE}assets/dusk-def.js`);
    for (const url of [`${SCOPE}assets/unknown.js`, 'https://api.scryfall.com/cards/collection', 'https://mtgjson.com/api/v5/M19.json', `${SCOPE}sw.js`]) {
      expect((await dispatch('fetch', { request: get(url), clientId: 'c1', resultingClientId: '' })).response).toBeNull();
    }
    // A navigation to another page of the site (the test harness pages) is not the app.
    expect((await dispatch('fetch', { request: nav(`${SCOPE}draft-harness.html`), clientId: '', resultingClientId: 'c1' })).response).toBeNull();
    // Not a GET: never from the cache.
    expect((await dispatch('fetch', { request: { url: `${SCOPE}index.html`, method: 'POST', mode: 'cors' }, clientId: 'c1', resultingClientId: '' })).response).toBeNull();
  });

  it('serves card images cache-first in the page’s profile cache, from there when offline', async () => {
    await loadWorker();
    const img = 'https://cards.scryfall.io/normal/front/a/b/ab.jpg';
    const first = await dispatch('fetch', { request: new Request(img), clientId: 'c1', resultingClientId: '' });
    expect(await first.response!.text()).toBe(`body of ${img}`);
    await first.settled;
    expect([...scope.caches.caches.get('spellplane-images-ann')!.entries.keys()]).toEqual([img]);
    scope.online = false;
    const again = await dispatch('fetch', { request: new Request(img), clientId: 'c1', resultingClientId: '' });
    expect(await again.response!.text()).toBe(`body of ${img}`);
  });
});
