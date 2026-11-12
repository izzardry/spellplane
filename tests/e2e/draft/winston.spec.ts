/**
 * Winston on the draft table (DESIGN "Pre-game: draft, sealed and deck building", mode table, Winston: "look at a pile
 * and take it, or add a card and move on"). The pile looked at lies on the private table; it is taken or declined
 * whole with the HUD's buttons, so a click on one of its cards neither marks nor takes anything.
 */
import { expect, test, type Page } from '@playwright/test';
import { clickCard, dh, openDraft, settled } from './bundle';

const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');
const poolCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pool');
const calls = async (page: Page) => (await dh(page, 'calls')).map((c) => [c.method, ...c.args]);

test('Winston: card clicks on the pile do nothing; the pile is taken or declined whole', async ({ page }) => {
  await openDraft(page, { format: 'winston', seats: 'Anna,Ben', packs: 1, packSize: 10 });
  await settled(page);
  await expect(page.getByTestId('draft-title')).toHaveText('Winston draft');
  await expect(page.getByTestId('draft-prompt')).toHaveText('Your turn: take this pile, or add a card to it and look at the next.');
  const [a] = await packCards(page);
  expect(a).toBeDefined();
  await clickCard(page, a!.id);
  await settled(page);
  await clickCard(page, a!.id);
  await page.keyboard.press('Enter');
  expect(await calls(page)).toEqual([]);
  expect((await packCards(page)).some((c) => c.marked)).toBe(false);
  await expect(page.getByTestId('draft-note')).toHaveCount(0);
  await expect(page.getByTestId('draft-confirm')).toHaveCount(0);

  // Decline the first pile (it gains a card), take the second.
  await page.getByTestId('pile-pass').click();
  await expect.poll(async () => (await dh(page, 'state')).draft!.winston!.pile).toBe(1);
  await settled(page);
  await page.getByTestId('pile-take').click();
  await expect.poll(async () => (await poolCards(page)).length).toBe(1);
  expect(await calls(page)).toEqual([
    ['pileLook', false],
    ['pileLook', true],
  ]);
  await expect(page.getByTestId('draft-prompt')).toHaveText('Ben is looking at a pile.');
  expect(await packCards(page)).toHaveLength(0);
  await expect(page.getByTestId('pile-take')).toHaveCount(0);
});
