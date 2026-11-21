/**
 * Helpers of the journey specs (tests/e2e/journey/**, M8-P8) that gate M8 reuses: open a fresh profile on the real app
 * (fixture cards and sets, placeholder faces, the local transport, the clipboard stubbed), seed a fixture deck through
 * Decks' import path, pick a Home mode, create a private table with two pages, start a search, leave a table and come
 * back. Nothing here touches the network; product timers are driven by the clock hooks, never slept through.
 */
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TableState } from '../../../src/core/types';
import type { DeckRecord, GameSummary } from '../../../src/store/types';
import { setsScript } from '../flow/helpers';
import { hook } from './app';

const FIXTURES = path.join('tests', 'fixtures');
let cardsScript: string | null = null;

/** The recorded Scryfall cards of the fixtures (M19, M20, M21 and the M19 tokens), injected before the page loads. */
export function fixturesScript(): string {
  if (!cardsScript) {
    const cards = ['m19.json', 'm20.json', 'm21.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as unknown[]);
    cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards })};`;
  }
  return cardsScript;
}

/** A fixture decklist's text. */
export const decklist = (file: string): string => fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');

/** A profile no other test or earlier run uses. */
export function freshProfile(info: TestInfo, who: string): string {
  return `jr-${who}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(4).toString('hex')}`;
}

/** The clipboard is never read: an init script replaces writeText with a stub that records what was written. */
export const CLIPBOARD = (): void => {
  const w = window as unknown as { __copied: string[] };
  w.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.__copied.push(t) } });
};

/** What the clipboard stub recorded. */
export const copied = (p: Page): Promise<string[]> => p.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

/**
 * Open the real app (no harness) at `hash` (`''` is the bare site, which is Home) with fixtures, placeholder faces,
 * the local transport and the clipboard stub; waits for the debug hook.
 */
export async function openSite(page: Page, profile: string, hash = ''): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.addInitScript({ content: setsScript(['M19']) });
  await page.addInitScript(CLIPBOARD);
  await page.goto(`./?faces=placeholder&transport=local&profile=${encodeURIComponent(profile)}${hash ? `#${hash}` : ''}`);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
}

/** Open a fresh profile on Home. */
export async function openFreshHome(page: Page, info: TestInfo, who: string): Promise<string> {
  const profile = freshProfile(info, who);
  await openSite(page, profile);
  await expect(page.getByTestId('route-home')).toBeVisible();
  return profile;
}

/** `n` pages in one browser context (each spec opens at most four). */
export async function pages(browser: Browser, n: number): Promise<{ context: BrowserContext; list: Page[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const list: Page[] = [];
  for (let i = 0; i < n; i++) list.push(await context.newPage());
  return { context, list };
}

export const state = (p: Page): Promise<TableState> => hook<TableState>(p, 'state');
export const tableHash = (p: Page): Promise<string> => p.evaluate(() => window.__spellplane!.session!.hash());
export const live = (p: Page): Promise<Record<string, number>> => p.evaluate(() => window.__spellplane!.home!.live!());
export const residue = (p: Page): Promise<Record<string, number> | null> => p.evaluate(() => (window.__spellplane?.render?.memory?.() ?? null) as Record<string, number> | null);
export const gamesOf = (p: Page): Promise<GameSummary[]> => p.evaluate(() => window.__spellplane!.games!.list()) as Promise<GameSummary[]>;
export const deckGet = (p: Page, id: string): Promise<DeckRecord | null> => p.evaluate((x) => window.__spellplane!.decks!.get!(x), id) as Promise<DeckRecord | null>;
export const deckList = (p: Page): Promise<DeckRecord[]> => p.evaluate(() => window.__spellplane!.decks!.list()) as Promise<DeckRecord[]>;
export const keydowns = (p: Page): Promise<number> => p.evaluate(() => window.__spellplane!.input!.keydowns());
export const dispatch = (p: Page, action: unknown): Promise<unknown> => p.evaluate((x) => window.__spellplane!.dispatch!(x as never), action);

/** Cards in a zone (a hidden zone reports its count). */
export function countOf(s: TableState, zone: string): number {
  const z = s.zones[zone];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : (z.count ?? z.ids.length);
}

/** The hand sizes of `seats` as `p` sees them, or null while there is no table state. */
export async function hands(p: Page, seats: readonly string[]): Promise<number[] | null> {
  const s = await state(p).catch(() => null);
  return s ? seats.map((seat) => countOf(s, `hand:${seat}`)) : null;
}

/** On Home: every lifecycle count is 0 and nothing a renderer held is left (contracts.md Part C). */
export async function homeIsClean(p: Page): Promise<void> {
  await expect(p.getByTestId('route-home')).toBeVisible();
  await expect.poll(async () => Object.entries(await live(p)).filter(([, v]) => v !== 0), { timeout: 15_000 }).toEqual([]);
  await expect
    .poll(async () => {
      const m = await residue(p);
      return m ? { geometries: m.geometries, textures: m.textures, programs: m.programs } : null;
    })
    .toEqual({ geometries: 0, textures: 0, programs: 0 });
}

/** A nav place of the shell. */
export const navTo = (p: Page, place: 'PLAY' | 'DECKS' | 'HISTORY'): Promise<void> => p.getByTestId('shell-nav').getByRole('radio', { name: place }).click();

/** Pick a Home mode card. */
export async function mode(p: Page, m: 'solo' | 'quick' | 'private' | 'draft'): Promise<void> {
  await p.getByTestId(`mode-${m}`).click();
  await expect(p.getByTestId(`mode-${m}`)).toHaveAttribute('aria-checked', 'true');
}

/** Pick SOLO's opponent on Home. */
export async function soloOpponent(p: Page, who: 'SPARRING' | 'ALONE'): Promise<void> {
  await mode(p, 'solo');
  await p.getByTestId('opt-opponent').getByRole('radio', { name: who }).click();
  await expect(p.getByTestId('opt-opponent').getByRole('radio', { name: who })).toHaveAttribute('aria-checked', 'true');
}

/** Wait until the pages agree on one state hash, and return it. */
export async function sameHash(list: Page[], timeout = 30_000): Promise<string> {
  await expect.poll(async () => new Set(await Promise.all(list.map((p) => tableHash(p).catch(() => `none-${Math.random()}`)))).size, { timeout }).toBe(1);
  return tableHash(list[0]!);
}

/** Store a fixture decklist as this profile's deck (Decks' import path), select it and return Home. Returns its id. */
export async function seedDeck(p: Page, file = 'gw-m19-60.txt'): Promise<string> {
  await p.evaluate((h) => (location.hash = h), '#/decks/new/import');
  await p.getByTestId('deck-text').fill(decklist(file));
  await p.getByTestId('deck-check').click();
  await p.getByTestId('deck-import-go').click();
  await expect(p.getByTestId('deck-page')).toBeVisible();
  const id = decodeURIComponent((await p.evaluate(() => location.hash)).replace('#/decks/', ''));
  await expect.poll(async () => (await deckGet(p, id))?.main.length ?? 0).toBe(60);
  await p.evaluate((x) => window.__spellplane!.decks!.select!(x), id);
  await p.evaluate(() => (location.hash = '#/'));
  await expect(p.getByTestId('route-home')).toBeVisible();
  return id;
}

/** Wait for the table frame of `kind`. */
export async function atTable(p: Page, kind: 'room' | 'matched' | 'computer' | 'practice' | 'sandbox', timeout = 30_000): Promise<void> {
  await expect(p.getByTestId('table-frame')).toHaveAttribute('data-kind', kind, { timeout });
}

/**
 * Ten own actions that change nothing in the end, by the own plate's life buttons: a solo game left after fewer is
 * purged instead of kept (contracts.md Part G "History and saving" item 2).
 */
export async function tenActions(p: Page, seat = 's0'): Promise<void> {
  const plate = p.locator(`[data-testid="avatar"][data-seat="${seat}"]`);
  for (let i = 0; i < 5; i++) {
    await plate.getByTestId('life-minus').click();
    await plate.getByTestId('life-plus').click();
  }
}

/** Leave the table by the HUD's back arrow; resolves on Home. */
export async function leaveByArrow(p: Page): Promise<void> {
  await p.getByTestId('leave').click();
  await expect(p.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
}

/**
 * Ann creates a private table from Home (`PRIVATE GAME` → `CREATE TABLE`) and Ben opens its invite link: both are
 * seated in the waiting room. Returns the link. Ann's page has her deck selected; Ben brings his by pasting a list.
 */
export async function privateTable(a: Page, b: Page, profiles: { a: string; b: string }): Promise<string> {
  await openSite(a, profiles.a);
  await seedDeck(a, 'gw-m19-60.txt');
  await mode(a, 'private');
  await expect(a.getByTestId('home-primary')).toHaveText('CREATE TABLE');
  await a.getByTestId('home-primary').click();
  await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
  const link = await a.getByTestId('share-link').inputValue();
  await openSite(b, profiles.b, link.slice(link.indexOf('#') + 1));
  await expect(b.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
  return link;
}

/** In the waiting room: bring a deck (paste a list when the slot has none) and press READY. */
export async function readyWith(p: Page, file: string): Promise<void> {
  if (!(await p.getByTestId('lobby-deck-text').isVisible().catch(() => false))) {
    const paste = p.getByTestId('paste-instead');
    if (await paste.isVisible().catch(() => false)) await paste.click();
  }
  if (await p.getByTestId('lobby-deck-text').isVisible().catch(() => false)) {
    await p.getByTestId('lobby-deck-text').fill(decklist(file));
    await p.getByTestId('lobby-deck-check').click();
  }
  await p.getByTestId('ready').click();
  await expect(p.getByTestId('ready-done')).toBeVisible({ timeout: 15_000 });
}

/** Start a search from Home in `QUICK MATCH` (the deck must be selected). */
export async function findMatch(p: Page, opts: { format?: '1V1' | '4 FFA'; ranked?: boolean } = {}): Promise<void> {
  await mode(p, 'quick');
  if (opts.format) await p.getByTestId('opt-quick-format').getByRole('radio', { name: opts.format }).click();
  if (opts.ranked !== undefined) await p.getByTestId('home-options').getByRole('radio', { name: opts.ranked ? 'RANKED' : 'UNRANKED', exact: true }).click();
  await expect(p.getByTestId('home-primary')).toHaveText(/FIND MATCH/);
  await p.getByTestId('home-primary').click();
  await expect.poll(() => p.evaluate(() => window.__spellplane!.mm!.status().phase), { timeout: 15_000 }).toMatch(/seeking|check/);
}
