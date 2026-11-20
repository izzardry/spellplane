/**
 * PLAN Milestone 8, M7-P2 acceptance (chunk P2-2): the View control. A click cycles the three tilt presets (first
 * person → leaning in → bird's-eye), a vertical drag scrubs the tilt (200 px for the whole range); read through the
 * harness's recorded scene calls and, on the solo table, through the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { openHud, ui } from '../ui/harness';
import { soloWithDeck } from './helpers';

async function tilts(page: Page): Promise<number[]> {
  const calls = await ui<{ method: string; args: unknown[] }[]>(page, 'scene');
  return calls.filter((c) => c.method === 'camera.setTilt').map((c) => c.args[0] as number);
}

test('a click cycles first person, leaning in and bird\'s-eye', async ({ page }) => {
  await openHud(page);
  await page.evaluate(() => window.__uiHarness!.clear());
  const view = page.getByTestId('view-control');
  await expect(view).toBeVisible();
  // The harness camera starts at bird's-eye: the next stop is first person, then leaning in, then bird's-eye again.
  await view.click();
  await view.click();
  await view.click();
  expect(await tilts(page)).toEqual([0, 0.5, 1]);
});

test('the View control stays on screen while the log drawer is open', async ({ page }) => {
  await openHud(page);
  await page.getByTestId('open-log').click();
  await expect(page.locator('[data-testid="log"][data-open="true"]')).toBeVisible();
  const view = page.getByTestId('view-control');
  await expect(view).toBeVisible();
  // Beside the drawer, not under it: a click reaches it and moves the tilt.
  await page.evaluate(() => window.__uiHarness!.clear());
  await view.click();
  expect(await tilts(page)).toEqual([0]);
});

test('a vertical drag scrubs the tilt, 200 px for the whole range, and is not a click', async ({ page }) => {
  await openHud(page);
  const view = page.getByTestId('view-control');
  await view.click(); // to first person (0)
  await page.evaluate(() => window.__uiHarness!.clear());
  const b = (await view.boundingBox())!;
  // Whole pixels: WebKit rounds a fractional pointer position, which shortened the 100 px drag by one pixel.
  const x = Math.round(b.x + b.width / 2);
  const y = Math.round(b.y + b.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 50, { steps: 5 });
  await page.mouse.move(x, y - 100, { steps: 5 });
  await page.mouse.up();
  const t = await tilts(page);
  expect(t.length).toBeGreaterThan(1);
  expect(t.at(-1)).toBeCloseTo(0.5, 2);
  // Monotonic upward drag: the tilt never goes back.
  for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThanOrEqual(t[i - 1]!);
});

test('on the solo table the click moves the real camera', async ({ page }, info) => {
  await soloWithDeck(page, info);
  const cam = async () => JSON.stringify(await hook(page, 'camera'));
  const before = await cam();
  await page.getByTestId('view-control').click();
  await expect.poll(cam).not.toBe(before);
});
