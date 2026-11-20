/**
 * PLAN Milestone 8, M7-P2 acceptance (chunk P2-2; visual.md V4): every visible button of the HUD has one of the kit's
 * four control heights, read from the --ds-control-* variables (±0.5 px). Checked on the ui harness with the menu, a
 * plate menu, the stack chip and the log drawer open, and on the solo table.
 */
import { expect, test } from '@playwright/test';
import { offSizes } from '../helpers/hud';
import { openHud } from '../ui/harness';
import { soloWithDeck } from './helpers';

test('the control heights are 28, 36, 44 and 56', async ({ page }) => {
  await openHud(page);
  const v = await page.getByTestId('hud').evaluate((el) => ['xs', 'sm', 'md', 'lg'].map((k) => getComputedStyle(el).getPropertyValue(`--ds-control-${k}`).trim()));
  expect(v).toEqual(['28px', '36px', '44px', '56px']);
});

test('every HUD button on the harness has a kit height (menu, plate menu, stack, drawer open in turn)', async ({ page }) => {
  await openHud(page);
  await page.evaluate(() => window.__uiHarness!.setShell({ onleave: true, plateMenuTop: true, plateBadge: true, status: 'line' }));
  expect(await offSizes(page)).toEqual([]);
  // The stack chip with Resolve, its destinations and Counter.
  await page.evaluate(() => window.__uiHarness!.update((s) => void (s.stack = [{ id: 'si9', kind: 'spell', controller: 's0', card: 'bf1' }])));
  await expect(page.getByTestId('stack-chip').getByRole('button')).toHaveCount(6);
  expect(await offSizes(page)).toEqual([]);
  await page.getByTestId('open-menu').click();
  await expect(page.getByTestId('menu-popover')).toBeVisible();
  expect(await offSizes(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="avatar"][data-seat="s1"]').getByTestId('plate-more').click();
  expect(await offSizes(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByTestId('open-log').click();
  await expect(page.locator('[data-testid="log"][data-open="true"]')).toBeVisible();
  expect(await offSizes(page)).toEqual([]);
});

test('every HUD button on the solo table has a kit height', async ({ page }, info) => {
  await soloWithDeck(page, info, { hand: 7 });
  expect(await offSizes(page)).toEqual([]);
});
