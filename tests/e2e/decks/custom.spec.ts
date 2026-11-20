/**
 * The custom deck page on the decks harness (PLAN M8 "M8-P3 Decks"; decks.md section 3 "D5 Deck page", section 4;
 * visual.md board 3): search in the fixtures, clicks add, autosave without DONE, undo and redo, the copy warning that
 * never blocks, the curve's text alternative, the land helper as one undo step, the search disabled offline while the
 * list still edits, and the whole flow by keyboard alone.
 */
import { expect, test, type Page } from '@playwright/test';
import type { DeckRecord } from '../../../src/store/types';
import { deckAudit } from './audit';
import { decklist, decks, faceRatios, openDecks, profileOf } from './helpers';

async function newCustomDeck(page: Page): Promise<string> {
  await page.getByTestId('new-deck').click();
  await page.getByTestId('new-custom').click();
  await expect(page.getByTestId('card-search')).toBeVisible();
  return decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/decks/', ''));
}

const row = (page: Page, name: string) => page.locator(`[data-testid="deck-row"][data-name="${name}"]`);

async function stored(page: Page, id: string): Promise<DeckRecord | null> {
  return decks<DeckRecord | null>(page, 'get', id);
}

test('search, click four times, autosave without DONE, undo and redo, five copies warn and still save', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info) });
  const id = await newCustomDeck(page);
  await test.step('search "elves" and add Llanowar Elves four times', async () => {
    await page.getByTestId('card-search').fill('elves');
    const card = page.locator('[data-testid="result-card"][data-name="Llanowar Elves"]');
    await expect(card).toBeVisible();
    for (let i = 0; i < 4; i++) await card.click();
    await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('4');
    await expect(card.getByTestId('result-count-badge')).toHaveText('×4');
    await expect.poll(async () => (await stored(page, id))?.main.length, { timeout: 2000 }).toBe(4);
  });
  await test.step('faces keep 63:88 and the page passes the design audit', async () => {
    for (const r of await faceRatios(page)) expect(Math.abs(r - 63 / 88) / (63 / 88)).toBeLessThan(0.01);
    await page.mouse.move(5, 895);
    expect(await deckAudit(page)).toEqual([]);
  });
  await test.step('undo and redo walk the edits', async () => {
    await page.getByTestId('deck-undo').click();
    await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('3');
    await page.getByTestId('deck-undo').click();
    await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('2');
    await page.getByTestId('deck-redo').click();
    await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('3');
    await expect.poll(async () => (await stored(page, id))?.main.length).toBe(3);
  });
  await test.step('five copies show the warning and still save', async () => {
    const card = page.locator('[data-testid="result-card"][data-name="Llanowar Elves"]');
    await card.click();
    await expect(page.getByTestId('copy-warning')).toHaveCount(0);
    await card.click();
    await expect(page.getByTestId('copy-warning')).toContainText('5 copies of Llanowar Elves');
    await expect.poll(async () => (await stored(page, id))?.main.length).toBe(5);
    await page.getByTestId('deck-done').click();
    await expect(page.getByTestId('deck-library')).toBeVisible();
    expect((await stored(page, id))?.main.length).toBe(5);
  });
});

test('an imported deck: the curve text, the land note and +N LANDS as one undo step', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info), hash: '/decks/new/import' });
  await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
  await page.getByTestId('deck-check').click();
  await expect(page.getByTestId('deck-import-go')).toBeEnabled();
  await page.getByTestId('deck-import-go').click();
  await expect(page.getByTestId('deck-page')).toBeVisible();
  await expect(page.getByTestId('deck-count')).toContainText('60');
  await expect(page.getByTestId('curve-text')).toHaveText('Mana curve: 0 at 0, 4 at 1, 15 at 2, 8 at 3, 4 at 4, 1 at 5, 2 at 6, 2 at 7 or more.');
  await expect(page.getByTestId('land-helper')).toContainText('24 lands');
  await expect(page.getByTestId('land-helper')).toContainText('23 suggested');
  await expect(page.getByTestId('land-note')).toHaveCount(0);
  // Remove six basics.
  for (let i = 0; i < 3; i++) await row(page, 'Forest').getByTestId('row-minus').click();
  for (let i = 0; i < 3; i++) await row(page, 'Plains').getByTestId('row-minus').click();
  await expect(page.getByTestId('land-helper')).toContainText('18 lands');
  await expect(page.getByTestId('land-note')).toBeVisible();
  const add = page.getByTestId('add-lands');
  await expect(add).toBeVisible();
  const n = Number((await add.textContent())!.replace(/\D+/g, ''));
  expect(n).toBeGreaterThan(1);
  await add.click();
  await expect(page.getByTestId('land-helper')).toContainText(`${18 + n} lands`);
  await expect(page.getByTestId('land-note')).toHaveCount(0);
  await page.getByTestId('deck-undo').click();
  await expect(page.getByTestId('land-helper')).toContainText('18 lands');
});

test('offline: the search is disabled and the list still edits', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info), hash: '/decks/new/import' });
  await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
  await page.getByTestId('deck-check').click();
  await page.getByTestId('deck-import-go').click();
  await expect(page.getByTestId('deck-page')).toBeVisible();
  await page.evaluate(() => window.__spellplane!.decks!.setOffline(true));
  await expect(page.getByTestId('card-search')).toBeDisabled();
  await expect(page.getByTestId('search-offline')).toBeVisible();
  await row(page, 'Llanowar Elves').getByTestId('row-plus').click();
  await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('5');
  await page.evaluate(() => window.__spellplane!.decks!.setOffline(false));
  await expect(page.getByTestId('card-search')).toBeEnabled();
});

test('the flow works by keyboard alone', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info) });
  const tabTo = async (testid: string): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      if (await page.evaluate((t) => document.activeElement?.closest(`[data-testid="${t}"]`) !== null, testid)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`could not reach ${testid} by Tab`);
  };
  await tabTo('new-deck');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('new-deck-chooser')).toBeVisible();
  await tabTo('new-custom');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('deck-page')).toBeVisible();
  await tabTo('card-search');
  await page.keyboard.type('elves');
  await expect(page.locator('[data-testid="result-card"][data-name="Llanowar Elves"]')).toBeVisible();
  await tabTo('result-card');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('2');
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('board').getByRole('radio', { name: /Side 1/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('board').getByRole('radio', { name: /Side 0/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'Llanowar Elves').getByTestId('row-count')).toHaveText('1');
  await tabTo('deck-done');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('deck-library')).toBeVisible();
  await expect(page.getByTestId('deck-tile')).toHaveCount(1);
});
