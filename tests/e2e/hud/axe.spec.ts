/**
 * PLAN M7-P2 acceptance: "axe in Plain and Graphite" for the redesigned HUD (and Kitchen) (PLAN
 * Milestone 7, Principles: "accessibility (contrast, focus, nothing by hue alone) is kept through the redesign").
 * Serious and critical findings fail (tests/e2e/a11y/helpers.ts), with the Menu, the log drawer, a plate's details and
 * the leave confirmation open as well as closed.
 */
import { expect, test } from '@playwright/test';
import { openLog, plateDetails, settled } from '../helpers/hud';
import { seriousViolations } from '../a11y/helpers';
import { AXE_LOOKS, IPAD_PORTRAIT, setLook, soloWithDeck } from './helpers';

for (const look of AXE_LOOKS) {
  test.describe(`axe in ${look}`, () => {
    test('the table HUD: resting, with the Menu, the log drawer and a plate open', async ({ page }, info) => {
      await soloWithDeck(page, info, { hand: 7, look });
      await settled(page);
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      await settled(page);
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await openLog(page);
      await settled(page);
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByTestId('close-log').click();
      await plateDetails(page, 's0');
      await settled(page);
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

test.describe('axe on an iPad', () => {
  test.use({ ...IPAD_PORTRAIT });
  test('the touch HUD in each look', async ({ page }, info) => {
    await soloWithDeck(page, info, { hand: 7 });
    for (const look of AXE_LOOKS) {
      await setLook(page, look);
      await settled(page);
      expect(await seriousViolations(page)).toEqual([]);
    }
  });
});
