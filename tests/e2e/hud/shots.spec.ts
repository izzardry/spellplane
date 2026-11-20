/**
 * PLAN M7-P2 acceptance: "screenshots of HUD and start page per look on desktop and iPad". Evidence for the owner's
 * review under artifacts/shots/M7/, not pixel baselines; each shot first checks what it shows (the look worn, the HUD's
 * always-visible parts).
 */
import { expect, test } from '@playwright/test';
import { shot } from '../helpers/app';
import { open, startPageLoaded, freshProfile as lobbyProfile } from '../lobby/helpers';
import { IPAD_LANDSCAPE, IPAD_PORTRAIT, LOOKS, soloWithDeck } from './helpers';

const M = 'M7';

test.describe('desktop', () => {
  for (const look of LOOKS) {
    test(`the table HUD in ${look}`, async ({ page }, info) => {
      await soloWithDeck(page, info, { hand: 7, look });
      await expect(page.getByTestId('turn-strip')).toBeVisible();
      await expect(page.getByTestId('primary-action')).toBeVisible();
      await shot(page, M, `hud-${look}`, info.project.name);
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      await shot(page, M, `hud-menu-${look}`, info.project.name);
      await page.keyboard.press('Escape');
      await page.getByTestId('open-log').click();
      await shot(page, M, `hud-log-${look}`, info.project.name);
    });

    test(`the start page in ${look}`, async ({ page }, info) => {
      await open(page, '/lobby', { profile: lobbyProfile(info, `shot-${look}`), transport: 'local' });
      await startPageLoaded(page);
      await page.evaluate((l) => window.__spellplane!.look!.set(l), look);
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      await shot(page, M, `start-${look}`, info.project.name);
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
      test(`the table HUD and the start page in ${look}`, async ({ page }, info) => {
        await soloWithDeck(page, info, { hand: 7, look });
        await expect(page.getByTestId('primary-action')).toBeVisible();
        await shot(page, M, `${name}-hud-${look}`, info.project.name);
        await page.evaluate(() => (location.hash = '#/lobby'));
        await startPageLoaded(page);
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await shot(page, M, `${name}-start-${look}`, info.project.name);
      });
    }
  });
}
