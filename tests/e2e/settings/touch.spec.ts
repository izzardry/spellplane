/**
 * First-run hints on a tablet (PLAN M5-P5; DESIGN "Input and interaction design", Touch: tap, double-tap, long-press,
 * two-finger camera; PLAN Milestone 5, owner decisions, Tablet: iPad with Safari). A touch screen gets the gestures
 * instead of the hover keys, and the hint's button and the settings panel's controls are sized for thumbs.
 */
import { menuItem } from '../helpers/hud';
import { expect, test } from '@playwright/test';
import { openHud } from '../ui/harness';

test.use({ hasTouch: true, viewport: { width: 1194, height: 834 } });

test('a touch screen gets the gesture hint by the own hand, never blocking, with a thumb-sized button', async ({ page }) => {
  await openHud(page);
  const hint = page.getByTestId('hint');
  // No welcome at a table (gate M8 F2): the gestures come first.
  await expect(hint).toHaveAttribute('data-hint', 'touchGestures');
  await expect(hint).toHaveCount(1);
  await expect(hint).toContainText('Two fingers move the camera');
  // By the own hand, not over the opponent's side (m7-adjustments.md section 7, "Entering a table").
  const vh = page.viewportSize()!.height;
  const box = (await hint.boundingBox())!;
  expect(box.y + box.height / 2).toBeGreaterThan(vh / 2);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  // Only its button takes the pointer, and it takes no focus.
  const through = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="hint"]') === null, [box.x + 6, box.y + 6]);
  expect(through).toBe(true);
  await expect(hint).not.toBeFocused();
  const button = hint.getByTestId('hint-dismiss');
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  await expect(hint).toHaveCount(0);
  // Dismissed hints stay dismissed.
  await openHud(page, { keepSettings: true });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('hint')).toHaveCount(0);
});

test('the settings panel opens by tap and its tabs are sized for thumbs', async ({ page }) => {
  await openHud(page);
  await menuItem(page, 'open-settings', 'tap');
  const tabs = page.getByTestId('settings-tab');
  await expect(tabs).toHaveCount(7);
  for (const t of await tabs.all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-testid="settings-tab"][data-section="cardBack"]').tap();
  await expect(page.getByTestId('card-back-settings')).toBeVisible();
});
