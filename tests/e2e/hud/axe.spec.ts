/**
 * PLAN M7-P2 acceptance: "axe clean" for the redesigned HUD and start page in each of the three looks (PLAN
 * Milestone 7, Principles: "accessibility (contrast, focus, nothing by hue alone) is kept through the redesign").
 * Serious and critical findings fail (tests/e2e/a11y/helpers.ts), with the Menu, the log drawer, a plate's details and
 * the leave confirmation open as well as closed.
 */
import { expect, test } from '@playwright/test';
import { menuItem, openLog, plateDetails } from '../helpers/app';
import { seriousViolations } from '../a11y/helpers';
import { open, startPageLoaded, freshProfile as lobbyProfile } from '../lobby/helpers';
import { IPAD_PORTRAIT, LOOKS, soloWithDeck } from './helpers';

for (const look of LOOKS) {
  test.describe(`axe in ${look}`, () => {
    test('the table HUD: resting, with the Menu, the log drawer and a plate open', async ({ page }, info) => {
      await soloWithDeck(page, info, { hand: 7, look });
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await openLog(page);
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByTestId('close-log').click();
      await plateDetails(page, 's0');
      expect(await seriousViolations(page)).toEqual([]);
      await menuItem(page, 'open-theme-settings');
      await expect(page.getByTestId('theme-settings')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('the start page', async ({ page }, info) => {
      await open(page, '/lobby', { profile: lobbyProfile(info, `axe-${look}`), transport: 'local' });
      await startPageLoaded(page);
      await page.evaluate((l) => window.__spellplane!.look!.set(l), look);
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByTestId('nickname').fill('  ');
      await expect(page.locator('#start-nickname-help')).toHaveClass(/error/);
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

test.describe('axe on an iPad', () => {
  test.use({ ...IPAD_PORTRAIT });
  test('the touch HUD in each look', async ({ page }, info) => {
    await soloWithDeck(page, info, { hand: 7 });
    for (const look of LOOKS) {
      await page.evaluate((l) => window.__spellplane!.look!.set(l), look);
      await expect(page.getByTestId('hud')).toHaveAttribute('data-look', look);
      expect(await seriousViolations(page)).toEqual([]);
    }
  });
});
