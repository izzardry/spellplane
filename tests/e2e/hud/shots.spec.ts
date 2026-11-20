/**
 * PLAN M7-P2 acceptance: "screenshots of the HUD per look on desktop and iPad (the start page became Home, M8-P2)". Evidence for the owner's
 * review under artifacts/shots/M7/, not pixel baselines; each shot first checks what it shows (the look worn, the HUD's
 * always-visible parts).
 */
import { expect, test } from '@playwright/test';
import { shot } from '../helpers/app';
import { settled } from '../helpers/hud';
import { IPAD_LANDSCAPE, IPAD_PORTRAIT, LOOKS, soloWithDeck } from './helpers';

const M = 'M8';

test.describe('desktop', () => {
  for (const look of LOOKS) {
    test(`the table HUD in ${look}`, async ({ page }, info) => {
      await soloWithDeck(page, info, { hand: 7, look });
      await expect(page.getByTestId('turn-strip')).toBeVisible();
      await expect(page.getByTestId('primary-action')).toBeVisible();
      await settled(page);
      await shot(page, M, `hud-${look}`, info.project.name);
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      await settled(page);
      await shot(page, M, `hud-menu-${look}`, info.project.name);
      await page.keyboard.press('Escape');
      await page.getByTestId('open-log').click();
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toBeVisible();
      await settled(page);
      await shot(page, M, `hud-log-${look}`, info.project.name);
    });
  }
});

for (const [name, device] of [
  ['ipad-landscape', IPAD_LANDSCAPE],
  ['ipad-portrait', IPAD_PORTRAIT],
] as const) {
  test.describe(name, () => {
    test.use({ ...device });
    for (const look of LOOKS) {
      test(`the table HUD in ${look}`, async ({ page }, info) => {
        await soloWithDeck(page, info, { hand: 7, look });
        await expect(page.getByTestId('primary-action')).toBeVisible();
        await expect(page.getByTestId('opening-hand')).toBeVisible();
        await settled(page);
        await shot(page, M, `${name}-hud-${look}`, info.project.name);
      });
    }
  });
}
