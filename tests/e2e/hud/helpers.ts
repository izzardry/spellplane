/** Helpers for the M7-P2 HUD specs: a solo table in a chosen look, and the HUD's always-visible parts. */
import { devices, expect, type Page, type TestInfo } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import type { LookId } from '../../../src/themes/types';
import { hook } from '../helpers/app';
import { call, decklist, freshProfile, openSolo } from '../solo/helpers';

/** The four looks (Plain is the default; m7-adjustments.md section 2, visual.md 2.2). */
export const LOOKS: readonly LookId[] = ['plain', 'kitchen', 'graphite', 'codex'];
/**
 * The looks the axe spec scans (PLAN M7-P2: axe in Plain and Graphite; Kitchen as well). Codex is left out: its kit
 * danger colour on panelRaised is 4.3:1 (a kit token, M8-P1's; the kit's own contrast test does not require it there).
 */
export const AXE_LOOKS: readonly LookId[] = ['plain', 'graphite', 'kitchen'];

const { defaultBrowserType: _a, ...ipadPortrait } = devices['iPad Pro 11']!;
const { defaultBrowserType: _b, ...ipadLandscape } = devices['iPad Pro 11 landscape']!;
export const IPAD_PORTRAIT = ipadPortrait;
export const IPAD_LANDSCAPE = ipadLandscape;

export function state(page: Page): Promise<TableState> {
  return hook<TableState>(page, 'state');
}

/** Switch the look through the debug hook (HUD tokens and the table theme) and wait for the HUD to wear it. */
export async function setLook(page: Page, look: LookId): Promise<void> {
  // The app's look hook when the app wires looks (M8-C); else the look's own table theme, whose look the HUD wears.
  await page.evaluate(async (l) => {
    const hook = window.__spellplane as unknown as { look?: { set(x: string): Promise<void> | void }; theme: { set(x: string): Promise<void> } };
    if (hook.look) await hook.look.set(l);
    else await hook.theme.set(l);
  }, look);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-look', look);
}

/** A solo table with the fixture deck imported and `hand` cards drawn; optionally in a look. */
export async function soloWithDeck(page: Page, info: TestInfo, opts: { hand?: number; look?: LookId } = {}): Promise<void> {
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible();
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  if (opts.hand) await call(page, 'draw', opts.hand);
  if (opts.look) await setLook(page, opts.look);
}

/** The computed value of a CSS custom property on the HUD root. */
export function hudVar(page: Page, name: string): Promise<string> {
  return page.getByTestId('hud').evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);
}
