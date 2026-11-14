/**
 * The page's side of the service worker (PLAN M5-P3: precache of the app shell; PLAN Milestone 5, owner decisions,
 * Updates only between games): registration, and the AppUpdate (ui/update.ts) that holds a new version back until the
 * page is somewhere `updateMayApply` allows.
 *
 * Lifecycle: the first worker of a browser activates at once and takes control of the page (src/sw.ts claims its
 * clients), so the shell is cached after the first visit. A later version installs in the background into its own
 * cache and then waits ('available'); the old worker keeps serving the old version's files meanwhile. `applyAt` posts
 * `SW_MESSAGE.skipWaiting` to the waiting worker ('applying') and reloads once it controls the page. Closing every tab
 * of the app also lets the browser activate the waiting worker on the next visit, as browsers do anyway.
 */
import { SW_MESSAGE, type UpdateStatus } from '../../util/pwa';
import { updateMayApply, type AppUpdate, type UpdatePlace } from '../update';

/** How often a long-open page asks for a new version (the browser also checks on every navigation). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** The worker script, next to index.html (vite.config.ts builds src/sw.ts to `sw.js`). */
export const WORKER_FILE = 'sw.js';

/** The parts of ServiceWorker the page uses. */
export interface WorkerLike {
  readonly state: ServiceWorkerState;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** The parts of ServiceWorkerRegistration the page uses. */
export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** The parts of ServiceWorkerContainer the page uses; injectable for tests. */
export interface ContainerLike {
  readonly controller: WorkerLike | null;
  register(url: string, options?: RegistrationOptions): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface WorkerOptions {
  container: ContainerLike;
  /** The worker script URL (absolute, or relative to the page). */
  url: string;
  /** The worker's scope: the app's base path. */
  scope: string;
  /** Reload the page once the new version controls it. */
  reload: () => void;
  /** Interval timer for the periodic update check; injectable for tests. */
  every?: (fn: () => void, ms: number) => unknown;
  /** Reports a failed registration (the app keeps working online without a worker). */
  onError?: (e: unknown) => void;
}

/**
 * Register the app's worker and return the AppUpdate over it. Never throws: a page whose registration fails (private
 * mode, blocked storage) stays 'current' and works online as before.
 */
export function registerWorker(opts: WorkerOptions): AppUpdate & { ready: Promise<RegistrationLike | null> } {
  let status: UpdateStatus = 'current';
  let registration: RegistrationLike | null = null;
  const listeners = new Set<(s: UpdateStatus) => void>();
  const set = (next: UpdateStatus): void => {
    if (next === status) return;
    status = next;
    for (const l of [...listeners]) l(next);
  };
  // A waiting worker is an update only when an older one already controlled this page when it appeared: the first
  // install of a fresh page activates by itself (and some browsers report its states late, after it took control).
  const updates = new WeakSet<WorkerLike>();
  const controlledAtStart = opts.container.controller !== null;
  const offer = (): void => {
    const waiting = registration?.waiting;
    if (status !== 'current' || !waiting || waiting.state !== 'installed' || !updates.has(waiting)) return;
    if (!opts.container.controller || opts.container.controller === waiting) return;
    set('available');
  };
  const watch = (worker: WorkerLike | null): void => {
    if (!worker) return;
    if (opts.container.controller) updates.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer();
    });
  };

  let reloading = false;
  /** Set when another tab applied the update: the new version already controls this page and waits for a reload. */
  let activatedElsewhere = false;
  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    opts.reload();
  };
  opts.container.addEventListener('controllerchange', () => {
    // A change this page asked for reloads it. Another tab applying the update does not reload a page mid-game: the
    // page keeps its notice and reloads when it reaches a place where the update may apply. The first worker taking
    // control of a fresh page changes nothing.
    if (status === 'applying') reload();
    else if (status === 'available') activatedElsewhere = true;
  });

  const ready = opts.container
    .register(opts.url, { scope: opts.scope, updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      if (reg.waiting && controlledAtStart) updates.add(reg.waiting);
      offer();
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      (opts.every ?? ((fn, ms) => setInterval(fn, ms)))(() => void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
      return reg;
    })
    .catch((e: unknown) => {
      opts.onError?.(e);
      return null;
    });

  return {
    ready,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    applyAt(place: UpdatePlace): boolean {
      if (status !== 'available' || !updateMayApply(place)) return false;
      const waiting = registration?.waiting;
      if (waiting) {
        set('applying');
        waiting.postMessage({ type: SW_MESSAGE.skipWaiting });
        return true;
      }
      if (activatedElsewhere) {
        set('applying');
        reload();
        return true;
      }
      return false;
    },
  };
}

/**
 * The page's AppUpdate when it runs a worker: production builds always, test builds only with `?sw=on` (the browser
 * tests of offline loading and updates; every other test runs without a worker, so their request routing is not
 * answered by a worker), dev builds never. Null without service-worker support (an insecure page, some private modes).
 */
export function pageWorker(env: { production: boolean; dev: boolean; search: string; base: string }): (AppUpdate & { ready: Promise<RegistrationLike | null> }) | null {
  if (env.dev) return null;
  const params = new URLSearchParams(env.search);
  if (!env.production && params.get('sw') !== 'on') return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const container = navigator.serviceWorker as unknown as ContainerLike;
  // Test builds: `?swv=<v>` registers the same script under another URL, which the browser treats as a new version (the
  // update spec's second version, served without the network). Production ignores it.
  const version = env.production ? null : params.get('swv');
  return registerWorker({
    container,
    url: `${env.base}${WORKER_FILE}${version ? `?v=${encodeURIComponent(version)}` : ''}`,
    scope: env.base,
    reload: () => location.reload(),
    onError: (e) => console.warn('Spellplane: the offline cache is unavailable', e),
  });
}

/**
 * An AppUpdate a test drives (dev and test builds, `?update=fake`): `offer()` makes a version available, `applyAt`
 * follows the real policy and records where it applied instead of reloading.
 */
export class FakeAppUpdate implements AppUpdate {
  private current: UpdateStatus = 'current';
  private readonly listeners = new Set<(s: UpdateStatus) => void>();
  /** Every place an update was applied at, oldest first. */
  readonly applied: UpdatePlace[] = [];

  status(): UpdateStatus {
    return this.current;
  }
  subscribe(listener: (s: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  offer(): void {
    this.set('available');
  }
  applyAt(place: UpdatePlace): boolean {
    if (this.current !== 'available' || !updateMayApply(place)) return false;
    this.applied.push({ ...place });
    this.set('applying');
    return true;
  }
  private set(next: UpdateStatus): void {
    if (next === this.current) return;
    this.current = next;
    for (const l of [...this.listeners]) l(next);
  }
}
