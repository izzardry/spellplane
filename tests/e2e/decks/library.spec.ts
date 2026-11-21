/**
 * The deck library on the decks harness (PLAN M8 "M8-P3 Decks"; journey.md 4.2 with the ruling "no summary panel";
 * decks.md section 3 D1; contracts.md Part G "Decks" item 4): the empty state with four paths, one CUSTOM and one
 * BOOSTER tile from a version 1 library file, click selects the deck Home plays with, EDIT and double-click open the
 * deck page, delete with an undo toast driven by the page clock, the picker sheet's reason badge over a face at full
 * opacity, the design audit, and the DOM counts after opening and closing the deck page twenty times.
 */
import { expect, test } from '@playwright/test';
import type { DeckRecord } from '../../../src/store/types';
import { settleAnimations } from '../helpers/design-audit';
import { designAudit } from '../helpers/design-audit';
import { decks, domCounts, faceRatios, go, libraryV1, openDecks, profileOf, seenOpacity } from './helpers';

test('an empty library shows the new-deck tile and the four paths', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info) });
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await expect(page.getByTestId('new-deck-tile')).toBeVisible();
  for (const p of ['boosters', 'custom', 'simple', 'import']) await expect(page.getByTestId(`path-${p}`)).toBeVisible();
  await expect(page.getByTestId('deck-tile')).toHaveCount(0);
  await page.getByTestId('new-deck').click();
  await expect(page.getByTestId('new-deck-chooser')).toBeVisible();
  for (const w of ['boosters', 'custom', 'simple', 'import']) await expect(page.getByTestId(`way-${w}`)).toBeVisible();
  // The starter generator is in this build (M8-P6): no 'Not in this build yet.', and a colour makes a simple deck of
  // the fixture set's cards in the library.
  await expect(page.getByTestId('simple-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('simple-G')).toBeEnabled();
  await page.getByTestId('simple-G').click();
  await expect(page.getByTestId('deck-library')).toBeVisible();
  await expect(page.getByTestId('deck-tile')).toHaveCount(1);
  await expect.poll(async () => ((await decks<{ main: unknown[] }[]>(page, 'list'))[0]?.main.length ?? 0)).toBeGreaterThan(0);
});

test.describe('a seeded library', () => {
  test.beforeEach(async ({ page }, info) => {
    await openDecks(page, { profile: profileOf(info) });
    await page.evaluate((text) => window.__decksHarness!.seedLibrary(text), libraryV1());
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__decksHarness?.ready === true)).toBe(true);
    await expect(page.getByTestId('deck-tile')).toHaveCount(2);
  });

  test('shows one CUSTOM and one BOOSTER tile; the filter and the hook agree', async ({ page }) => {
    await expect(page.locator('[data-testid="deck-tile"][data-kind="custom"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="deck-tile"][data-kind="sealed"]')).toHaveCount(1);
    await expect(page.locator('[data-kind="sealed"] [data-testid="seal-band"]')).toBeVisible();
    const list = await decks<DeckRecord[]>(page, 'list');
    expect(list.map((d) => d.kind).sort()).toEqual(['custom', 'sealed']);
    await page.getByTestId('deck-filter').getByRole('radio', { name: 'Booster' }).click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(1);
    await expect(page.getByTestId('deck-tile')).toHaveAttribute('data-kind', 'sealed');
    await page.getByTestId('deck-filter').getByRole('radio', { name: 'Custom' }).click();
    await expect(page.getByTestId('deck-tile')).toHaveAttribute('data-kind', 'custom');
    await page.getByTestId('deck-filter').getByRole('radio', { name: 'All' }).click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(2);
    // Summaries were computed from card data and kept on the records (tiles and Home need no card data later).
    await expect.poll(async () => (await decks<DeckRecord[]>(page, 'list')).every((d) => !!d.summary)).toBe(true);
    // The seal band lies below the cover card and never crosses its face.
    const boxes = await page.locator('[data-kind="sealed"]').evaluate((t) => {
      const c = t.querySelector('[data-testid="tile-cover"]')!.getBoundingClientRect();
      const b = t.querySelector('[data-testid="seal-band"]')!.getBoundingClientRect();
      return { coverBottom: c.bottom, bandTop: b.top };
    });
    expect(boxes.bandTop).toBeGreaterThanOrEqual(boxes.coverBottom - 0.5);
  });

  test('a click selects the deck Home plays with; EDIT and double-click open the deck page; PLAY goes Home', async ({ page }) => {
    const custom = page.locator('[data-testid="deck-tile"][data-kind="custom"]');
    const id = (await custom.getAttribute('data-deck-id'))!;
    await custom.click();
    await expect(custom.getByTestId('tile-selected')).toBeVisible();
    await expect.poll(() => decks(page, 'selected')).toBe(id);
    await custom.hover();
    await custom.getByTestId('tile-edit').click();
    await expect(page.getByTestId('deck-page')).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(`#/decks/${id}`);
    await page.getByTestId('deck-done').click();
    await expect(page.getByTestId('deck-library')).toBeVisible();
    const sealed = page.locator('[data-testid="deck-tile"][data-kind="sealed"]');
    const sid = (await sealed.getAttribute('data-deck-id'))!;
    await sealed.dblclick();
    await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'sealed');
    expect(await page.evaluate(() => location.hash)).toBe(`#/decks/${sid}`);
    // The double-click selected it on its way (two clicks).
    expect(await decks(page, 'selected')).toBe(sid);
    await go(page, '#/decks');
    // While a search runs the selected deck is locked: PLAY on another deck answers the lock line.
    await page.evaluate(() => window.__decksHarness!.setSearching(true));
    await custom.hover();
    await custom.getByTestId('tile-play').click();
    await expect(page.getByTestId('library-notice')).toHaveText('Cancel the search to change deck.');
    expect(await decks(page, 'selected')).toBe(sid);
    await page.evaluate(() => window.__decksHarness!.setSearching(false));
    await custom.getByTestId('tile-play').click();
    await expect(page.getByTestId('harness-home')).toBeVisible();
    expect(await decks(page, 'selected')).toBe(id);
  });

  test('delete then UNDO restores; delete and the clock run on removes the record', async ({ page }) => {
    await page.clock.install();
    const tile = page.locator('[data-testid="deck-tile"][data-kind="custom"]');
    const id = (await tile.getAttribute('data-deck-id'))!;
    await tile.hover();
    await tile.getByTestId('tile-more').click();
    await page.getByTestId('deck-delete').click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(1);
    const toast = page.getByTestId('toast').filter({ hasText: 'removed' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(2);
    await page.clock.runFor(6000);
    expect(await decks(page, 'get', id)).not.toBeNull();

    await page.locator(`[data-deck-id="${id}"]`).hover();
    await page.locator(`[data-deck-id="${id}"]`).getByTestId('tile-more').click();
    await page.getByTestId('deck-delete').click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(1);
    expect(await decks(page, 'get', id)).not.toBeNull();
    await page.clock.runFor(6000);
    await expect.poll(() => decks(page, 'get', id)).toBeNull();
    await expect(page.getByTestId('toast').filter({ hasText: 'removed' })).toHaveCount(0);
  });

  test('the tile menu: rename, duplicate, and convert a booster deck into a custom copy', async ({ page }) => {
    const custom = page.locator('[data-testid="deck-tile"][data-kind="custom"]');
    const id = (await custom.getAttribute('data-deck-id'))!;
    await custom.hover();
    await custom.getByTestId('tile-more').click();
    await expect(page.getByTestId('deck-menu')).toBeVisible();
    await expect(page.getByTestId('deck-convert')).toHaveCount(0);
    await page.getByTestId('deck-rename').click();
    await page.getByTestId('rename-field').fill('Elf stompy');
    await page.getByTestId('rename-save').click();
    await expect(custom).toContainText('Elf stompy');
    await expect.poll(async () => (await decks<DeckRecord>(page, 'get', id))!.name).toBe('Elf stompy');
    await custom.hover();
    await custom.getByTestId('tile-more').click();
    await page.getByTestId('deck-duplicate').click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(3);
    const sealed = page.locator('[data-testid="deck-tile"][data-kind="sealed"]');
    const sid = (await sealed.getAttribute('data-deck-id'))!;
    const before = JSON.stringify(await decks(page, 'get', sid));
    await sealed.hover();
    await sealed.getByTestId('tile-more').click();
    await page.getByTestId('deck-convert').click();
    await expect(page.getByTestId('deck-tile')).toHaveCount(4);
    await expect(page.locator('[data-testid="deck-tile"][data-kind="custom"]')).toHaveCount(3);
    const list = await decks<DeckRecord[]>(page, 'list');
    expect(list.filter((d) => d.name.endsWith('(custom)'))).toHaveLength(1);
    expect(JSON.stringify(await decks(page, 'get', sid))).toBe(before);
    // The copy's tile keeps "(custom)" in sight; only the name before it may be cut (gate M8 F14).
    const suffix = page.getByTestId('tile-suffix');
    await expect(suffix).toHaveText('(custom)');
    expect(await suffix.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test('the picker with allow rejecting custom decks dims text and well, shows the reason, keeps the face at full opacity', async ({ page }) => {
    await expect.poll(async () => (await decks<DeckRecord[]>(page, 'list')).every((d) => !!d.summary?.cover)).toBe(true);
    await page.evaluate(() => window.__decksHarness!.openPicker('booster'));
    const picker = page.getByTestId('deck-picker');
    await expect(picker).toBeVisible();
    const locked = picker.locator('[data-testid="deck-tile"][data-kind="custom"]');
    await expect(locked.getByTestId('tile-reason')).toHaveText('Booster decks only');
    await expect(locked).toHaveAttribute('aria-disabled', 'true');
    await expect(locked.locator('img[data-card-face]')).toBeVisible();
    // The sheet fades in (the kit's entry animation): measure once it has settled.
    await settleAnimations(page);
    expect(await seenOpacity(page, '[data-testid="deck-picker"] [data-kind="custom"] img[data-card-face]')).toBe(1);
    expect(await seenOpacity(page, '[data-testid="deck-picker"] [data-kind="custom"] .text')).toBeLessThan(0.6);
    // Picking the locked one does nothing; the booster deck is picked.
    await locked.click({ force: true });
    expect(await page.evaluate(() => window.__decksHarness!.picked())).toBeNull();
    await picker.locator('[data-testid="deck-tile"][data-kind="sealed"]').click();
    expect(await page.evaluate(() => window.__decksHarness!.picked())).not.toBeNull();
  });

  test('card faces keep 63:88; the design audit passes; the deck page opened and closed 20 times leaves the DOM as it was', async ({ page }) => {
    await expect.poll(async () => (await faceRatios(page)).length).toBe(2);
    for (const r of await faceRatios(page)) expect(Math.abs(r - 63 / 88) / (63 / 88)).toBeLessThan(0.01);
    // A tile's actions show on hover (and always for the selected tile on a coarse pointer): audit with them shown.
    await page.locator('[data-testid="deck-tile"][data-kind="custom"]').hover();
    await expect(page.locator('[data-testid="deck-tile"][data-kind="custom"]').getByTestId('tile-play')).toBeVisible();
    await designAudit(page);
    await page.mouse.move(1400, 880);
    await designAudit(page);
    const id = (await page.locator('[data-testid="deck-tile"][data-kind="custom"]').getAttribute('data-deck-id'))!;
    const before = await domCounts(page);
    for (let i = 0; i < 20; i++) {
      await go(page, `#/decks/${id}`);
      await expect(page.getByTestId('deck-row').first()).toBeVisible();
      await go(page, '#/decks');
      await expect(page.getByTestId('deck-tile')).toHaveCount(2);
    }
    await expect.poll(() => faceRatios(page).then((r) => r.length)).toBe(2);
    expect(await domCounts(page)).toEqual(before);
  });
});
