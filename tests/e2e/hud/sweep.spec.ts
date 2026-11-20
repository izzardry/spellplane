/**
 * PLAN Milestone 8, M7-P2 acceptance ("Sweep"; contracts.md Part G, Visual 4): with the context menu, the pile viewer,
 * inspect, token search and the confirm prompt open in the ui harness, every button has a kit height and nothing
 * computes a blur or a backdrop-filter.
 */
import { expect, test, type Page } from '@playwright/test';
import { menuItem, offSizes, openZone } from '../helpers/hud';
import { openHud } from '../ui/harness';

async function blurred(page: Page): Promise<string[]> {
  return page.getByTestId('hud').evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('*')]
      .filter((e) => {
        const s = getComputedStyle(e) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
        return /blur/.test(s.filter) || (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
      })
      .map((e) => e.dataset.testid ?? e.className),
  );
}

async function clean(page: Page): Promise<void> {
  expect(await offSizes(page)).toEqual([]);
  expect(await blurred(page)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await openHud(page);
});

test('the context menu', async ({ page }) => {
  await page.locator('[data-testid="scene-card"][data-card="bf1"]').click({ button: 'right' });
  await expect(page.locator('[role="menu"] [data-action="tap"]')).toBeVisible();
  await clean(page);
});

test('the pile viewer with its library actions', async ({ page }) => {
  await openZone(page, 'library:s0');
  await expect(page.getByTestId('search-library')).toBeVisible();
  await clean(page);
});

test('inspect', async ({ page }) => {
  await page.locator('[data-testid="scene-card"][data-card="bf1"]').click({ button: 'middle' });
  await expect(page.getByTestId('inspect')).toBeVisible();
  await clean(page);
});

test('token search', async ({ page }) => {
  await menuItem(page, 'open-token');
  await expect(page.getByTestId('token-search')).toBeVisible();
  await clean(page);
});

test('the confirm prompt', async ({ page }) => {
  await page.evaluate(() =>
    window.__uiHarness!.update((st) => {
      st.confirm = { id: 'r1', askedBy: 's1', durationMs: 60000, startSeq: 0, responses: {} } as unknown as typeof st.confirm;
    }),
  );
  await expect(page.getByTestId('prompt-ok')).toBeVisible();
  await clean(page);
});
