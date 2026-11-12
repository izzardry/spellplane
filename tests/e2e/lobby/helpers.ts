/** Browser-test helpers for the lobby: fixture card data, fresh profiles, room links and pages on the local transport. */
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join('tests', 'fixtures');
let cardsScript: string | null = null;

/** An init script that sets window.__spellplaneFixtures to the recorded Scryfall cards (the app never touches the network). */
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

/** A profile no other test or earlier run uses, so every page starts with an empty IndexedDB and a new key pair. */
export function freshProfile(info: TestInfo, who: string): string {
  return `lb-${who}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(5).toString('hex')}`;
}

/** A fresh room id and 16-byte base64url key (DESIGN "Specification: network protocol and secrecy", Room). */
export function freshRoom(): { roomId: string; roomKey: string } {
  return { roomId: `test-room-${crypto.randomBytes(4).toString('hex')}-42`, roomKey: crypto.randomBytes(16).toString('base64url') };
}

/** Open `hash` with placeholder faces, a profile and optionally the local transport. */
export async function open(page: Page, hash: string, opts: { profile: string; transport?: 'local' }): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  const q = new URLSearchParams({ faces: 'placeholder', profile: opts.profile });
  if (opts.transport) q.set('transport', opts.transport);
  await page.goto(`./?${q.toString()}#${hash}`);
}

/** Open the table of `room` on the local transport and wait for the lobby. */
export async function openTable(page: Page, room: { roomId: string; roomKey: string }, profile: string): Promise<void> {
  await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile, transport: 'local' });
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
}

/** Set the nickname in the lobby (Enter saves it). */
export async function setNickname(page: Page, name: string): Promise<void> {
  const input = page.getByTestId('lobby-nickname');
  await input.fill(name);
  await input.press('Enter');
}

/** A chair button by seat id. */
export function chair(page: Page, seat: string) {
  return page.locator(`[data-testid="chair"][data-seat="${seat}"]`);
}

/** Two pages in one browser context, so BroadcastChannel joins them into one room. */
export async function twoPages(browser: Browser): Promise<{ context: BrowserContext; a: Page; b: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  const b = await context.newPage();
  return { context, a, b };
}
