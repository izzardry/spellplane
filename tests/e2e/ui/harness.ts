import { expect, type Page } from '@playwright/test';
import type { KeyChord } from '../../../src/games/types';

/** Open the HUD module test page (src/ui/harness.ts) with a fresh settings store. */
export async function openHud(page: Page, opts: { seats?: string[]; keepSettings?: boolean } = {}) {
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'ui' });
  if (opts.seats) q.set('seats', opts.seats.join(','));
  await page.goto(`./?${q.toString()}`);
  if (!opts.keepSettings) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await expect.poll(() => page.evaluate(() => typeof window.__uiHarness === 'object')).toBe(true);
  await expect(page.getByTestId('hud')).toBeVisible();
}

/** Call the harness API and return its JSON result. */
export function ui<T = unknown>(page: Page, fn: 'actions' | 'calls' | 'scene' | 'voice' | 'settingsWrites' | 'view' | 'state'): Promise<T> {
  return page.evaluate((name) => (window.__uiHarness as unknown as Record<string, () => unknown>)[name]!(), fn) as Promise<T>;
}

/** Dispatched actions without the stamped fields. */
export async function drafts(page: Page): Promise<Record<string, unknown>[]> {
  const acts = await ui<Record<string, unknown>[]>(page, 'actions');
  return acts.map(({ by: _b, cid: _c, seq: _s, ...rest }) => rest);
}

const NAMED: Record<string, string> = { ' ': 'Space', '-': 'Minus', '=': 'Equal', '+': 'Shift+Equal', '?': 'Shift+Slash' };

/** Playwright key string for a chord, US layout, e.g. { key: 'l', shift: true } → 'Shift+KeyL'. */
export function pwKey(chord: KeyChord): string {
  const k = chord.key;
  const base = /^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : (NAMED[k] ?? k);
  const mods = [chord.ctrl && 'Control', chord.alt && 'Alt', chord.shift && 'Shift'].filter(Boolean);
  return [...mods, base].join('+');
}

/** Hover a card on the fake table or in the hand by instance id. */
export async function hoverCard(page: Page, id: string) {
  await page.locator(`[data-card="${id}"]`).first().hover();
}

/** Move the pointer to an empty spot on the table, away from every card. */
export async function hoverNothing(page: Page) {
  await page.mouse.move(700, 120);
}
