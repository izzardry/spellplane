/**
 * PLAN Milestone 5, owner decisions, Updates only between games: "The service worker installs a new version in the
 * background, and the HUD shows 'New version available: it applies after this game'. The update is applied at the
 * lobby, never mid-game." The policy (ui/update.ts updateMayApply) and the page's side of the worker
 * (ui/storage/worker.ts) over a fake ServiceWorkerContainer.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Stage } from '../../../src/core/types';
import { FakeAppUpdate, registerWorker, UPDATE_CHECK_MS, type ContainerLike, type RegistrationLike, type WorkerLike } from '../../../src/ui/storage/worker';
import { updateMayApply, type UpdatePlace } from '../../../src/ui/update';
import { SW_MESSAGE, type UpdateStatus } from '../../../src/util/pwa';

describe('updateMayApply', () => {
  it('allows the lobby and pages without a table, never a draft, a build or a game', () => {
    const at = (route: UpdatePlace['route'], stage: Stage | null) => updateMayApply({ route, stage });
    expect(at('room', 'lobby')).toBe(true);
    expect(at('room', 'draft')).toBe(false);
    expect(at('room', 'build')).toBe(false);
    expect(at('room', 'match')).toBe(false);
    expect(at('solo', 'match')).toBe(false);
    expect(at('lobby', null)).toBe(true);
    expect(at('diag', null)).toBe(true);
    expect(at('diagJoin', null)).toBe(true);
    expect(at('notFound', null)).toBe(true);
    // A table page whose table is not open yet (joining, restoring) may be rejoining a game: wait.
    expect(at('room', null)).toBe(false);
    expect(at('solo', null)).toBe(false);
  });
});

class FakeWorker implements WorkerLike {
  state: ServiceWorkerState = 'installing';
  readonly posted: unknown[] = [];
  private readonly listeners: (() => void)[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  become(state: ServiceWorkerState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  private readonly found: (() => void)[] = [];
  update(): Promise<unknown> {
    this.updates++;
    return Promise.resolve();
  }
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.found.push(listener);
  }
  /** A new version arrives: it installs and then waits behind the active one. */
  newVersion(): FakeWorker {
    const w = new FakeWorker();
    this.installing = w;
    for (const l of this.found) l();
    this.installing = null;
    this.waiting = w;
    w.become('installed');
    return w;
  }
}

class FakeContainer implements ContainerLike {
  controller: FakeWorker | null = null;
  readonly registered: { url: string; options: RegistrationOptions | undefined }[] = [];
  private readonly changes: (() => void)[] = [];
  constructor(
    readonly reg = new FakeRegistration(),
    private readonly fail = false,
  ) {}
  register(url: string, options?: RegistrationOptions): Promise<RegistrationLike> {
    this.registered.push({ url, options });
    return this.fail ? Promise.reject(new Error('SecurityError')) : Promise.resolve(this.reg);
  }
  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.changes.push(listener);
  }
  /** The waiting worker took over (skipWaiting, or another tab applied it). */
  takeOver(w: FakeWorker): void {
    this.reg.active = w;
    this.reg.waiting = null;
    this.controller = w;
    w.become('activated');
    for (const l of this.changes) l();
  }
}

function setup(opts: { controlled?: boolean; fail?: boolean } = {}) {
  const container = new FakeContainer(new FakeRegistration(), opts.fail);
  if (opts.controlled !== false) {
    const old = new FakeWorker();
    old.state = 'activated';
    container.reg.active = old;
    container.controller = old;
  }
  const reload = vi.fn();
  const timers: { fn: () => void; ms: number }[] = [];
  const onError = vi.fn();
  const update = registerWorker({ container, url: '/spellplane/sw.js', scope: '/spellplane/', reload, every: (fn, ms) => timers.push({ fn, ms }), onError });
  const seen: UpdateStatus[] = [];
  update.subscribe((s) => seen.push(s));
  return { container, update, reload, timers, onError, seen };
}

const MATCH: UpdatePlace = { route: 'room', stage: 'match' };
const LOBBY: UpdatePlace = { route: 'room', stage: 'lobby' };

describe('the page’s worker', () => {
  it('registers the worker for the app’s scope, bypassing the HTTP cache, and checks for updates hourly', async () => {
    const { container, update, timers } = setup();
    await update.ready;
    expect(container.registered).toEqual([{ url: '/spellplane/sw.js', options: { scope: '/spellplane/', updateViaCache: 'none' } }]);
    expect(timers.map((t) => t.ms)).toEqual([UPDATE_CHECK_MS]);
    timers[0]!.fn();
    expect(container.reg.updates).toBe(1);
  });

  it('a new version waits mid-game, and applies at the lobby: skip-waiting is posted, the page reloads once it controls', async () => {
    const { container, update, reload, seen } = setup();
    await update.ready;
    expect(update.status()).toBe('current');
    const next = container.reg.newVersion();
    expect(update.status()).toBe('available');
    // Mid-game nothing happens: no message to the worker, no reload.
    expect(update.applyAt(MATCH)).toBe(false);
    expect(update.applyAt({ route: 'room', stage: 'draft' })).toBe(false);
    expect(update.applyAt({ route: 'solo', stage: 'match' })).toBe(false);
    expect(next.posted).toEqual([]);
    expect(update.status()).toBe('available');
    // At the lobby it applies.
    expect(update.applyAt(LOBBY)).toBe(true);
    expect(next.posted).toEqual([{ type: SW_MESSAGE.skipWaiting }]);
    expect(update.status()).toBe('applying');
    expect(reload).not.toHaveBeenCalled();
    container.takeOver(next);
    expect(reload).toHaveBeenCalledTimes(1);
    // Asking again does nothing more.
    expect(update.applyAt(LOBBY)).toBe(false);
    container.takeOver(next);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['available', 'applying']);
  });

  it('a version already waiting when the page starts is offered at once', async () => {
    const container = new FakeContainer();
    const old = new FakeWorker();
    container.controller = old;
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    container.reg.waiting = waiting;
    const update = registerWorker({ container, url: 'sw.js', scope: './', reload: vi.fn(), every: () => undefined });
    await update.ready;
    expect(update.status()).toBe('available');
  });

  it('the first worker of a fresh browser activates by itself: no notice, no reload', async () => {
    const { container, update, reload } = setup({ controlled: false });
    await update.ready;
    const first = container.reg.newVersion();
    expect(update.status()).toBe('current');
    expect(update.applyAt(LOBBY)).toBe(false);
    container.takeOver(first);
    expect(reload).not.toHaveBeenCalled();
    expect(update.status()).toBe('current');
  });

  it('another tab applying the update does not reload a page mid-game; it reloads when it reaches the lobby', async () => {
    const { container, update, reload } = setup();
    await update.ready;
    const next = container.reg.newVersion();
    container.takeOver(next);
    expect(reload).not.toHaveBeenCalled();
    expect(update.status()).toBe('available');
    expect(update.applyAt(MATCH)).toBe(false);
    expect(update.applyAt(LOBBY)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(next.posted).toEqual([]);
  });

  it('a failed registration leaves the page working without a worker', async () => {
    const { update, onError } = setup({ fail: true });
    expect(await update.ready).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(update.status()).toBe('current');
    expect(update.applyAt(LOBBY)).toBe(false);
  });

  it('unsubscribing stops the notices', async () => {
    const { container, update } = setup();
    await update.ready;
    const l = vi.fn();
    const off = update.subscribe(l);
    off();
    container.reg.newVersion();
    expect(l).not.toHaveBeenCalled();
  });
});

describe('FakeAppUpdate (the browser tests’ stand-in)', () => {
  it('follows the same policy and records where it applied', () => {
    const fake = new FakeAppUpdate();
    expect(fake.applyAt(LOBBY)).toBe(false);
    fake.offer();
    expect(fake.status()).toBe('available');
    expect(fake.applyAt(MATCH)).toBe(false);
    expect(fake.applyAt({ route: 'lobby', stage: null })).toBe(true);
    expect(fake.applied).toEqual([{ route: 'lobby', stage: null }]);
    expect(fake.status()).toBe('applying');
  });
});
