/**
 * Helpers of the Deck mode specs (M8-P3): the decks harness page (`?harness=decks`) with the recorded Scryfall cards
 * and MTGJSON booster data injected before the page loads, so nothing reaches the network; the `decks` debug hook with
 * its promises awaited; and small DOM measures (card face ratio, opacity down the tree, node counts).
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setsScript } from '../flow/helpers';

const FIXTURES = path.join('tests', 'fixtures');
let cardsScript: string | null = null;

function fixturesScript(): string {
  if (!cardsScript) {
    const cards = ['m19.json', 'm20.json', 'm21.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as unknown[]);
    cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards })};`;
  }
  return cardsScript;
}

export function libraryV1(): string {
  return fs.readFileSync(path.join(FIXTURES, 'decks', 'library-v1.json'), 'utf8');
}

export function decklist(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');
}

/** A profile name of its own per test. */
export function profileOf(info: TestInfo): string {
  return `decks-${info.testId.replace(/[^a-z0-9]/gi, '').slice(0, 24)}-${info.project.name}`;
}

/** Open the decks harness at `hash` (default the library) with fixtures and placeholder faces. */
export async function openDecks(page: Page, opts: { profile: string; hash?: string }): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.addInitScript({ content: setsScript(['M19']) });
  await page.goto(`./?harness=decks&faces=placeholder&profile=${encodeURIComponent(opts.profile)}#${opts.hash ?? '/decks'}`);
  await expect.poll(() => page.evaluate(() => window.__decksHarness?.ready === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.decks?.edit === 'function')).toBe(true);
}

/** Call `window.__spellplane.decks.<fn>(...args)` and await its answer (JSON). */
export async function decks<T = unknown>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([name, a]) => {
      const api = window.__spellplane?.decks as unknown as Record<string, (...x: unknown[]) => unknown>;
      const r = await api[name as string]!(...(a as unknown[]));
      return JSON.parse(JSON.stringify(r ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;
}

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash);
}

/** Every card face image's rendered width / height. */
export async function faceRatios(page: Page): Promise<number[]> {
  // The layout box (before the tile's tilt), which is what the face is scaled into.
  return page.locator('img[data-card-face]').evaluateAll((els) =>
    (els as HTMLElement[])
      .filter((e) => e.offsetWidth > 0 && e.offsetHeight > 0)
      .map((e) => e.offsetWidth / e.offsetHeight),
  );
}

/** The product of opacities from an element up to the document (what the eye sees, not only its own value). */
export async function seenOpacity(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  });
}

/** Node and image counts under the harness root. */
export async function domCounts(page: Page): Promise<{ nodes: number; imgs: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="decks-harness"]')!;
    return { nodes: root.querySelectorAll('*').length, imgs: root.querySelectorAll('img').length };
  });
}
