/**
 * Rochester and Grid on the shared table (DESIGN "Pre-game: draft, sealed and deck building": Rochester "one pack at a
 * time is laid face up on the shared table … snake order", Grid "a face-up 3×3 grid; first player takes a row or column,
 * second takes from the remainder"; Drafting interaction: "Rochester picks happen on the shared table").
 */
import { expect, test, type Page } from '@playwright/test';
import { clickCard, dh, openDraft, settled } from './bundle';

const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');

test('Rochester: the pack lies face up on the shared table and only the seat in turn picks', async ({ page }) => {
  await openDraft(page, { format: 'rochester', seats: 'Anna,Ben', packSize: 6, packs: 1 });
  await settled(page);
  expect(await dh(page, 'cards').then((c) => c.length)).toBe(6);
  await expect(page.getByTestId('draft-pack-label')).toHaveText('Shared table · 6 cards');
  await expect(page.getByTestId('draft-prompt')).toHaveText('Click a card to mark it, click again or press Enter to confirm.');
  // Anna opens and picks first.
  const [a] = await packCards(page);
  await clickCard(page, a!.id);
  await settled(page);
  await clickCard(page, a!.id);
  await expect.poll(async () => (await dh(page, 'picks')).map((p) => [p.seat, p.cards])).toEqual([['s0', [a!.id]]]);
  // Snake: Ben picks twice. Anna can still mark a card, but her confirm is refused and nothing is taken.
  await settled(page);
  await expect(page.getByTestId('draft-prompt')).toHaveText('Ben is picking.');
  await expect(page.locator('[data-testid="draft-seat"][data-seat="s1"]')).toHaveAttribute('data-picking', 'true');
  const [b] = await packCards(page);
  await clickCard(page, b!.id);
  await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([b!.id]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('draft-note')).toHaveText('It is not your pick yet.');
  expect(await dh(page, 'picks')).toHaveLength(1);
  expect(await dh(page, 'autoPick', 's1')).toBe(true);
  expect(await dh(page, 'autoPick', 's1')).toBe(true);
  await settled(page);
  await expect(page.getByTestId('draft-pack-label')).toHaveText('Shared table · 3 cards');
  await expect(page.getByTestId('draft-prompt')).not.toHaveText('Ben is picking.');
  expect((await dh(page, 'cards')).filter((c) => c.area === 'pool')).toHaveLength(1);
});

test('Grid: rows and columns of the shared 3×3 are taken with their handles, in turn', async ({ page }) => {
  await openDraft(page, { format: 'grid', seats: 'Anna,Ben', grids: 3 });
  await settled(page);
  const grid = await packCards(page);
  expect(grid).toHaveLength(9);
  await expect(page.getByTestId('draft-pack-label')).toHaveText('Shared table · grid · 9 cards');
  await expect(page.getByTestId('draft-step')).toHaveText('Grid 1 of 3');
  await expect(page.getByTestId('grid-take')).toHaveCount(6);
  // A click on a grid card does not take it: grids are taken by line.
  await clickCard(page, grid[0]!.id);
  expect(await dh(page, 'calls')).toEqual([]);
  // Hovering a handle highlights its line; clicking takes it.
  const row0 = page.locator('[data-testid="grid-take"][data-line="row"][data-index="0"]');
  await row0.click();
  expect(await dh(page, 'calls')).toEqual([{ method: 'gridTake', args: ['row', 0] }]);
  await settled(page);
  expect(await packCards(page)).toHaveLength(6);
  expect((await dh(page, 'cards')).filter((c) => c.area === 'pool').map((c) => c.ref.sid).sort()).toEqual(grid.slice(0, 3).map((c) => c.ref.sid).sort());
  await expect(row0).toBeDisabled();
  await expect(page.getByTestId('draft-prompt')).toHaveText('Ben is choosing.');
  // Not Anna's turn: refused.
  await page.locator('[data-testid="grid-take"][data-line="col"][data-index="1"]').click();
  await expect(page.getByTestId('draft-note')).toHaveText('It is not your turn to take from the grid.');
  expect((await dh(page, 'cards')).filter((c) => c.area === 'pool')).toHaveLength(3);
  // Ben takes column 2; the next grid is laid and Ben chooses first.
  expect(await dh(page, 'gridTake', 's1', 'col', 1)).toBe(true);
  await settled(page);
  expect(await packCards(page)).toHaveLength(9);
  await expect(page.getByTestId('draft-step')).toHaveText('Grid 2 of 3');
  await expect(row0).toBeEnabled();
});
