/**
 * PLAN M7-P5: "drag from library to hand draws (and a click on the library pile offers Draw); hovering or pressing a
 * pile shows its few actions on the pile (Draw, Shuffle, Search, Reveal top) as small buttons"; docs/design/
 * m7-hud-proposal.md, Pile actions: "Library: Draw · Shuffle · Search…; Graveyard and Exile: Open". The buttons stand
 * beside the pile, never over it, and run the library's existing routes (draw, shuffle, the search viewer).
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { affordances, goldfish, state, handIds, keydowns, pileCentre, settledTable, tableToScreen } from './helpers';

const box = async (page: Page, testid: string) => (await page.getByTestId(testid).boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('resting the pointer on the library shows Draw, Shuffle and Search beside it; they stay while the pointer moves onto them and go after it leaves', async ({ page }, info) => {
  await goldfish(page, info);
  const lib = await pileCentre(page, 'library');
  await page.mouse.move(lib.x, lib.y, { steps: 4 });
  const actions = page.getByTestId('pile-actions');
  await expect(actions).toHaveAttribute('data-zone', 'library:s0');
  await expect(actions).toHaveAttribute('data-via', 'hover');
  await expect(actions.getByRole('button')).toHaveText(['Draw', 'Shuffle', 'Search']);
  // Beside the pile, never over it (the scene's anchor is the pile's drawn top card).
  const pile = (await affordances(page)).pile!;
  expect(pile).toMatchObject({ zone: 'library:s0', owner: 's0', via: 'hover' });
  expect(pile.count).toBe((await state(page)).zones['library:s0']!.ids.length);
  expect(overlap(await box(page, 'pile-actions'), pile.rect)).toBe(false);
  expect(Math.abs(lib.x - (pile.rect.x + pile.rect.width / 2))).toBeLessThan(4);

  // Onto the buttons: they stay; Draw draws.
  const draw = await box(page, 'pile-action-draw');
  const hand = (await handIds(page)).length;
  await page.mouse.move(draw.x + draw.width / 2, draw.y + draw.height / 2, { steps: 6 });
  await page.waitForTimeout(600);
  await expect(actions).toBeVisible();
  await page.getByTestId('pile-action-draw').click();
  await expect.poll(async () => (await handIds(page)).length).toBe(hand + 1);

  // Away from both: they go.
  const away = await tableToScreen(page, { x: -300, y: -300 });
  await page.mouse.move(away.x, away.y, { steps: 6 });
  await expect(actions).toHaveCount(0);
  expect((await affordances(page)).pile).toBeNull();
  expect(await keydowns(page)).toBe(0);
});

test('a click keeps the library\'s actions until a click elsewhere; Search opens the library to search it', async ({ page }, info) => {
  await goldfish(page, info);
  const lib = await pileCentre(page, 'library');
  await page.mouse.click(lib.x, lib.y);
  const actions = page.getByTestId('pile-actions');
  await expect(actions).toHaveAttribute('data-via', 'tap');
  // A click on the pile selects nothing (the strip is for cards on the table).
  await expect(page.getByTestId('selection-strip')).toHaveCount(0);
  // Away from the pile (no click) they stay.
  const away = await tableToScreen(page, { x: -300, y: -300 });
  await page.mouse.move(away.x, away.y, { steps: 6 });
  await page.waitForTimeout(600);
  await expect(actions).toBeVisible();
  await page.getByTestId('pile-action-search').click();
  const viewer = page.getByTestId('pile-viewer');
  await expect(viewer).toHaveAttribute('data-kind', 'library');
  await expect(viewer.getByTestId('pile-card').first()).toBeVisible();
  expect(await keydowns(page)).toBe(0);
});

test('a graveyard offers Open; the solo library offers no Reveal top (nobody to reveal to)', async ({ page }, info) => {
  const { land } = await goldfish(page, info);
  await hook(page, 'dispatch', { type: 'move', card: land, to: 'graveyard:s0' });
  await expect.poll(async () => (await hook<{ zones: Record<string, { ids: string[] }> }>(page, 'state')).zones['graveyard:s0']!.ids).toEqual([land]);
  await settledTable(page);
  const gy = await pileCentre(page, 'graveyard');
  await page.mouse.click(gy.x, gy.y);
  const actions = page.getByTestId('pile-actions');
  await expect(actions).toHaveAttribute('data-zone', 'graveyard:s0');
  await expect(actions.getByRole('button')).toHaveText(['Open']);
  await page.getByTestId('pile-action-open').click();
  await expect(page.getByTestId('pile-viewer')).toHaveAttribute('data-kind', 'graveyard');

  const lib = await pileCentre(page, 'library');
  await page.mouse.click(lib.x, lib.y);
  await expect(actions).toHaveAttribute('data-zone', 'library:s0');
  await expect(page.getByTestId('pile-action-revealTop')).toHaveCount(0);
});

test('double-click on the library draws (as before), and an empty graveyard offers nothing', async ({ page }, info) => {
  await goldfish(page, info);
  const hand = (await handIds(page)).length;
  const lib = await pileCentre(page, 'library');
  await page.mouse.dblclick(lib.x, lib.y);
  await expect.poll(async () => (await handIds(page)).length).toBe(hand + 1);
  await settledTable(page);
  const gy = await pileCentre(page, 'graveyard');
  await page.mouse.click(gy.x, gy.y);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('pile-actions')).toHaveCount(0);
});
