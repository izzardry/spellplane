/**
 * PLAN M7-P2 acceptance: the start page of docs/design/m7-directions.html ("Three ways in (host, play alone, join),
 * with your decks … Housekeeping shrinks to a footer"; critique, Start page 1–3: an identity, more than one way in,
 * no error before anything was typed, housekeeping after play).
 */
import { expect, test } from '@playwright/test';
import { freshProfile, open, startPageLoaded } from '../lobby/helpers';

test('three ways in side by side, the brand first, housekeeping in the footer', async ({ page }, info) => {
  await open(page, '/lobby', { profile: freshProfile(info, 'start7'), transport: 'local' });
  await startPageLoaded(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spellplane');
  const ways = ['Play with friends', 'Play alone', 'Join a table'];
  for (const w of ways) await expect(page.getByRole('heading', { name: w })).toBeVisible();
  // Side by side on a desktop: the three headings share a row.
  const tops = await Promise.all(ways.map(async (w) => (await page.getByRole('heading', { name: w }).boundingBox())!.y));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(4);
  // Housekeeping follows play: the connection check and storage sit below the ways in, storage folded away.
  const waysBottom = (await page.getByTestId('join-table').boundingBox())!.y;
  const foot = page.locator('footer.housekeeping');
  await expect(foot).toBeVisible();
  expect((await foot.boundingBox())!.y).toBeGreaterThan(waysBottom);
  await expect(foot.getByRole('link', { name: 'Check your connection' })).toBeVisible();
  await expect(page.getByTestId('storage-panel')).toBeHidden();
  await page.getByTestId('start-storage').locator('summary').click();
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  await expect(page.getByTestId('link-settings')).toBeVisible();
  await expect(page.getByTestId('link-about')).toBeVisible();
});

test('no error before anything was typed; a nickname problem shows once the player typed', async ({ page }, info) => {
  await open(page, '/lobby', { profile: freshProfile(info, 'nick7'), transport: 'local' });
  await startPageLoaded(page);
  await expect(page.getByTestId('nickname')).toHaveValue('');
  await expect(page.locator('#start-nickname-help')).not.toHaveClass(/error/);
  await expect(page.getByTestId('nickname')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByTestId('create-table')).toBeDisabled();
  await page.getByTestId('nickname').fill('   ');
  await expect(page.locator('#start-nickname-help')).toHaveClass(/error/);
  await expect(page.getByTestId('nickname')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('nickname').fill('Ann');
  await expect(page.getByTestId('create-table')).toBeEnabled();
});

test('"Play alone" opens the solo table', async ({ page }, info) => {
  await open(page, '/lobby', { profile: freshProfile(info, 'alone7'), transport: 'local' });
  await page.getByTestId('play-alone').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('primary-action')).toBeVisible();
});

test('"Your decks" lists the saved decks, newest first, and says so when there are none', async ({ page }, info) => {
  const profile = freshProfile(info, 'decks7');
  await open(page, '/lobby', { profile, transport: 'local' });
  await startPageLoaded(page);
  await expect(page.getByTestId('no-decks')).toBeVisible();
  await expect(page.getByTestId('saved-deck')).toHaveCount(0);
  // Two decks in the profile's deck store (what the builder or a draft saves).
  await page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const ref = { sid: 'x', set: 'm19', num: '1' };
    const tx = db.transaction('decks', 'readwrite');
    tx.objectStore('decks').put({ id: 'd1', name: 'Selesnya Tokens', main: Array(60).fill(ref), side: [], source: 'pasted', createdAt: 1, updatedAt: 1 });
    tx.objectStore('decks').put({ id: 'd2', name: 'Thursday Draft', main: Array(40).fill(ref), side: Array(5).fill(ref), source: 'drafted', createdAt: 2, updatedAt: 2 });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, `spellplane-${profile}`);
  await page.reload();
  await startPageLoaded(page);
  await expect(page.getByTestId('saved-deck')).toHaveCount(2);
  await expect(page.getByTestId('saved-deck').first()).toContainText('Thursday Draft');
  await expect(page.getByTestId('saved-deck').first()).toContainText('40 cards · 5 sideboard');
  await expect(page.getByTestId('saved-deck').last()).toContainText('Selesnya Tokens');
  await expect(page.getByTestId('no-decks')).toHaveCount(0);
});
