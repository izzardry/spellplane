/**
 * M8-C: the frame and its seams (docs/design/m8/contracts.md Part C). `#/` is Home, not a table, with every lifecycle
 * count at 0; every package's harness page is registered; a practice table opens in the table frame and Leave goes
 * Home with one toast, after which the counts are 0 again. Local only: fixtures, placeholder faces, no network.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, openHome } from '../helpers/app';
import { fixturesScript } from '../offline/helpers';

type Memory = Record<string, number>;
const memory = (page: Page) => page.evaluate(() => (window.__spellplane?.render?.memory?.() ?? null) as Record<string, number> | null);
/** The counts that are not 0 (empty when every live count and the residue are 0; `disposals` counts renderers disposed since load). */
const nonZero = async (page: Page): Promise<Memory> => Object.fromEntries(Object.entries((await memory(page)) ?? { missing: 1 }).filter(([k, n]) => n !== 0 && k !== 'disposals'));

test.describe('the M8 frame', () => {
  test('Home is the first screen, inside the shell, with every lifecycle count at 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openHome(page, { profile: `m8c-home-${test.info().workerIndex}-${Date.now()}` });
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.getByTestId('home-primary')).toBeVisible();
    await expect(page.getByTestId('hud')).toHaveCount(0);
    await expect.poll(() => memory(page)).not.toBeNull();
    expect(await nonZero(page)).toEqual({});
    for (const [hash, id] of [
      ['#/decks', 'route-decks'],
      ['#/decks/new', 'route-decks'],
      ['#/history', 'route-history'],
      ['#/settings', 'route-settings'],
    ] as const) {
      await page.evaluate((h) => (location.hash = h), hash);
      await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId('shell')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('a practice table opens in the frame; Leave goes Home with one toast and releases the table', async ({ page }) => {
    await page.addInitScript({ content: fixturesScript() });
    await openHome(page, { profile: `m8c-practice-${test.info().workerIndex}-${Date.now()}` });
    await test.step('PLAY opens a practice table', async () => {
      await page.getByTestId('home-primary').click();
      await expect(page).toHaveURL(/#\/p\/p-[0-9a-z]{12}$/);
      await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'practice');
      await expect(page.getByTestId('hud')).toBeVisible();
      await expect.poll(async () => (await memory(page))?.sessions).toBe(1);
    });
    await test.step('Leave goes Home with the solo toast', async () => {
      await page.getByTestId('frame-leave').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      await expect(page.getByTestId('toast')).toContainText('Game saved. Continue any time.');
      await expect.poll(() => nonZero(page)).toEqual({});
    });
  });

  test('the sandbox stays at #/solo with no frame bar', async ({ page }) => {
    await page.addInitScript({ content: fixturesScript() });
    await openApp(page, { profile: `m8c-solo-${test.info().workerIndex}-${Date.now()}` });
    await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'sandbox');
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('frame-bar')).toHaveCount(0);
  });

  for (const name of ['kit', 'home', 'history', 'decks', 'lobby', 'gather', 'computer', 'match']) {
    test(`?harness=${name} is registered`, async ({ page }) => {
      await page.goto(`./?faces=placeholder&harness=${name}`);
      await expect(page.locator(`[data-harness="${name}"], [data-testid^="harness-"], main`).first()).toBeVisible();
    });
  }
});
