/** Helpers for the M7-P2 HUD specs: a solo table in a chosen look, and the HUD's always-visible parts. */
import { devices, expect, type Page, type TestInfo } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import type { LookId } from '../../../src/themes/types';
import { hook } from '../helpers/app';
import { call, decklist, freshProfile, openSolo } from '../solo/helpers';

export const LOOKS: readonly LookId[] = ['kitchen', 'graphite', 'codex'];

const { defaultBrowserType: _a, ...ipadPortrait } = devices['iPad Pro 11']!;
const { defaultBrowserType: _b, ...ipadLandscape } = devices['iPad Pro 11 landscape']!;
export const IPAD_PORTRAIT = ipadPortrait;
export const IPAD_LANDSCAPE = ipadLandscape;

export function state(page: Page): Promise<TableState> {
  return hook<TableState>(page, 'state');
}

/** Switch the look through the debug hook (HUD tokens and the table theme) and wait for the HUD to wear it. */
export async function setLook(page: Page, look: LookId): Promise<void> {
  await page.evaluate((l) => window.__spellplane!.look!.set(l), look);
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
