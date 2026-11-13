/**
 * First-run hints on a tablet (PLAN M5-P5; DESIGN "Input and interaction design", Touch: tap, double-tap, long-press,
 * two-finger camera; PLAN Milestone 5, owner decisions, Tablet: iPad with Safari). A touch screen gets the gestures
 * instead of the hover keys, and the hint's button and the settings panel's controls are sized for thumbs.
 */
import { expect, test } from '@playwright/test';
import { openHud } from '../ui/harness';

test.use({ hasTouch: true, viewport: { width: 1194, height: 834 } });

test('a touch screen gets the gesture hint after the welcome, with a thumb-sized button', async ({ page }) => {
  await openHud(page);
  const hint = page.getByTestId('hint');
  await expect(hint).toHaveAttribute('data-hint', 'welcome');
  const button = hint.getByTestId('hint-dismiss');
  const box = (await button.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  await expect(hint).toHaveAttribute('data-hint', 'touchGestures');
  await expect(hint).toContainText('Two fingers move the camera');
  await hint.getByTestId('hint-dismiss').tap();
  await expect(hint).toHaveCount(0);
});

test('the settings panel opens by tap and its tabs are sized for thumbs', async ({ page }) => {
  await openHud(page);
  await page.getByTestId('open-settings').tap();
  const tabs = page.getByTestId('settings-tab');
  await expect(tabs).toHaveCount(7);
  for (const t of await tabs.all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-testid="settings-tab"][data-section="cardBack"]').tap();
  await expect(page.getByTestId('card-back-settings')).toBeVisible();
});
