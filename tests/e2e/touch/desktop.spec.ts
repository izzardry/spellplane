/**
 * PLAN M5-P1: touch is added beside the mouse, not instead of it (scene/input/touch.ts: only pointerType 'touch' goes
 * to the recogniser; mouse and pen keep the M0–M4 handling). On a desktop without touch there is no thumb bar and the
 * hand fan lifts a card on hover as before.
 */
import { expect, test, type Page } from '@playwright/test';
import { fingers, tableWithCards, thumbBar } from './helpers';

const fanCard = (page: Page, id: string) => page.locator(`[data-testid="hand-card"][data-card="${id}"]`);

test('no thumb bar until a finger touches the page; mouse input is unchanged', async ({ page }, info) => {
  const { hand } = await tableWithCards(page, info, { battlefield: 1, hand: 2 });
  expect(await thumbBar(page)).toEqual([]);
  await expect(page.getByTestId('thumb-bar')).toHaveCount(0);
  // A mouse hover still lifts a hand card and leaving lowers it.
  const b = (await fanCard(page, hand[0]!).boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + b.height - 10);
  await expect.poll(async () => (await fanCard(page, hand[0]!).boundingBox())!.height).toBeGreaterThan(900 * 0.44);
  await page.mouse.move(700, 300);
  await expect.poll(async () => (await fanCard(page, hand[0]!).boundingBox())!.height).toBeLessThan(900 * 0.3);
  // A touch screen on a desktop: once a finger touches the page, the thumb bar shows.
  await fingers(page, [
    { type: 'down', id: 1, x: 700, y: 300 },
    { type: 'up', id: 1, x: 700, y: 300 },
  ]);
  await expect(page.getByTestId('thumb-bar')).toBeVisible();
  expect((await thumbBar(page)).map((t) => t.action)).toEqual(['attack', 'settle', 'resolve', 'ask', 'talk']);
});
