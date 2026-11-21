/**
 * M8-P8 journey: the first run (docs/PLAN.md Milestone 8, acceptance "M8-P8", first-run.spec.ts; journey.md section 6
 * and 4.10 "On entry"). A fresh profile opens the bare site and sees Home, not a table; one press of `PLAY` makes a
 * starter deck and opens a table against Sparring with seven cards in hand, the log closed, no dialog and no key
 * pressed (`debug.input`); Decks then lists the new deck. Fixtures, placeholder faces, the local transport.
 */
import { expect, test } from '@playwright/test';
import { atTable, deckList, homeIsClean, keydowns, navTo, openFreshHome } from '../helpers/journey';

test.describe('journey: the first run', () => {
  test('a fresh profile presses PLAY once and sits at a table against Sparring with seven cards', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await test.step('the bare site is Home with an empty hero and PLAY', async () => {
      await openFreshHome(page, info, 'first');
      await expect(page.locator('canvas')).toHaveCount(0);
      await expect(page.getByTestId('home-empty-hero')).toBeVisible();
      await expect(page.getByTestId('mode-solo')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('home-primary')).toHaveText(/PLAY/);
      await expect(page.getByTestId('home-primary')).toBeEnabled();
      expect(await deckList(page)).toEqual([]);
      await homeIsClean(page);
      await page.evaluate(() => window.__spellplane!.input!.reset());
    }, { timeout: 30_000 });

    await test.step('one press: a starter deck, a table against Sparring, seven cards, the log closed, no dialog', async () => {
      await page.getByTestId('home-primary').click();
      await atTable(page, 'computer', 45_000);
      await expect(page).toHaveURL(/#\/c\/[^/]+$/);
      await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
      await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
      await expect.poll(() => page.evaluate(() => window.__spellplane!.secrets!().hand.length), { timeout: 30_000 }).toBe(7);
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.oppHand ?? -1)).toBe(7);
      await expect(page.getByTestId('hud')).toBeVisible();
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible')).toHaveCount(0);
      await expect(page.getByTestId('first-run-sheet')).toHaveCount(0);
      expect(await keydowns(page)).toBe(0);
    }, { timeout: 60_000 });

    await test.step('Decks lists the new deck', async () => {
      const decks = await deckList(page);
      expect(decks).toHaveLength(1);
      await page.getByTestId('leave').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await expect(page.locator(`[data-testid="deck-tile"][data-deck-id="${decks[0]!.id}"]`)).toBeVisible();
      await expect(page.getByTestId('deck-tile')).toHaveCount(1);
    }, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
