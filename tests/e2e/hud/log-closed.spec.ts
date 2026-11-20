/**
 * PLAN Milestone 8, M7-P2 acceptance (D6; chunk P2-2): the log drawer is closed when a table opens, at 1440 × 900,
 * 1024 × 768 and iPad portrait; it opens on a click and on Enter; it never opens by itself when a line arrives.
 */
import { expect, test } from '@playwright/test';
import { call } from '../solo/helpers';
import { IPAD_PORTRAIT, soloWithDeck } from './helpers';

const drawer = '[data-testid="log"][data-open="true"]';

for (const size of [
  { name: '1440 × 900', viewport: { width: 1440, height: 900 } },
  { name: '1024 × 768', viewport: { width: 1024, height: 768 } },
]) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });
    test('closed on entry; opens on click; a new line does not open it', async ({ page }, info) => {
      await soloWithDeck(page, info);
      await expect(page.getByTestId('open-log')).toBeVisible();
      await expect(page.locator(drawer)).toHaveCount(0);
      await call(page, 'draw', 3);
      await expect(page.getByTestId('log-ticker').locator('li').first()).toBeAttached();
      await expect(page.locator(drawer)).toHaveCount(0);
      await page.getByTestId('open-log').click();
      await expect(page.locator(drawer)).toBeVisible();
    });
  });
}

test.describe('iPad portrait', () => {
  test.use({ ...IPAD_PORTRAIT });
  test('closed on entry; a new line does not open it', async ({ page }, info) => {
    await soloWithDeck(page, info);
    await expect(page.locator(drawer)).toHaveCount(0);
    await call(page, 'draw', 2);
    await expect(page.getByTestId('log-ticker').locator('li').first()).toBeAttached();
    await expect(page.locator(drawer)).toHaveCount(0);
  });
});

test('Enter opens the drawer with the chat field focused', async ({ page }, info) => {
  await soloWithDeck(page, info);
  await page.mouse.move(700, 400);
  await page.keyboard.press('Enter');
  await expect(page.locator(drawer)).toBeVisible();
  await expect(page.getByTestId('chat-input')).toBeFocused();
});
