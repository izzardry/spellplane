/** Browser-test helpers for M5-P3 (offline and storage): fixture card data, fresh profiles, the service worker, no network. */
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join('tests', 'fixtures');
let cardsScript: string | null = null;

/** An init script that hands the page the recorded Scryfall cards (main.ts then never asks Scryfall). */
export function fixturesScript(): string {
  if (!cardsScript) {
    const cards = ['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as unknown[]);
    cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards })};`;
  }
  return cardsScript;
}

export function decklist(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');
}

export function freshProfile(info: TestInfo, who = 'p'): string {
  return `off-${who}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(5).toString('hex')}`;
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

/**
 * Tests never use the network: every request that would leave the machine is refused (as if the service were down)
 * and recorded, so a spec can assert that none was even tried.
 */
export async function noNetwork(context: BrowserContext): Promise<string[]> {
  const outside: string[] = [];
  await context.route(
    (url) => !LOCAL.test(url.href) && !/^(data|blob):/.test(url.href),
    (route) => {
      outside.push(route.request().url());
      return route.abort('internetdisconnected');
    },
  );
  return outside;
}

/** The page's URL with the harness flags; `sw: true` lets a test build run its service worker (`?sw=on`). */
export function appUrl(opts: { profile: string; sw?: boolean; update?: 'fake'; hash?: string; transport?: 'local' }): string {
  const q = new URLSearchParams({ faces: 'placeholder', profile: opts.profile });
  if (opts.sw) q.set('sw', 'on');
  if (opts.update) q.set('update', opts.update);
  if (opts.transport) q.set('transport', opts.transport);
  return `./?${q.toString()}#${opts.hash ?? '/'}`;
}

export async function waitForSession(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 20_000 }).toBe(true);
}

/** Wait until the service worker controls the page (it precached the whole build before activating). */
export async function waitForWorker(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller && navigator.serviceWorker.controller.state === 'activated'), { timeout: 30_000 })
    .toBe(true);
}

/** Run an async member of window.__spellplane.session and return its JSON result. */
export function call<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([n, a]) => {
      const s = window.__spellplane!.session! as unknown as Record<string, (...x: unknown[]) => unknown>;
      const r = await s[n as string]!(...(a as unknown[]));
      return JSON.parse(JSON.stringify(r ?? null)) as unknown;
    },
    [name, args] as const,
  ) as Promise<T>;
}

/** The update state the debug hook reports (M5-P3 storage part). */
export function updateStatus(page: Page): Promise<string> {
  return page.evaluate(() => window.__spellplane!.storage!.update());
}
