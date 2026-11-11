/** Browser-test helpers for the solo table: recorded card data injected into the page, a fresh profile per test. */
import { expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join('tests', 'fixtures');

let cardsScript: string | null = null;

/** An init script that sets window.__spellplaneFixtures to the recorded Scryfall cards (main.ts uses them instead of the network). */
function fixturesScript(): string {
  if (!cardsScript) {
    const cards = ['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as unknown[]);
    cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards })};`;
  }
  return cardsScript;
}

export function decklist(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');
}

/** A profile name no other test or earlier run uses, so every test starts from an empty IndexedDB. */
export function freshProfile(info: TestInfo): string {
  return `solo-${info.project.name.slice(0, 3)}-${info.workerIndex}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Open the solo table with fixture card data, placeholder faces and the given profile; wait for the session. */
export async function openSolo(page: Page, profile: string): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.goto(`./?faces=placeholder&profile=${profile}`);
  await waitForSession(page);
}

export async function waitForSession(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 15_000 }).toBe(true);
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
