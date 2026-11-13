/**
 * PLAN Milestone 5, owner decisions, Updates only between games: "The service worker installs a new version in the
 * background, and the HUD shows 'New version available: it applies after this game'. The update is applied at the
 * lobby, never mid-game."
 *
 * - With the page's real worker (`?sw=on`): a changed worker script installs and waits; mid-game the notice shows and
 *   nothing reloads; at the start page the update applies and the page reloads into the new version.
 * - With the browser tests' fake update (`?update=fake`, same policy): the in-table lobby applies at once; a table in a
 *   game keeps the notice.
 */
import { expect, test, type Page } from '@playwright/test';
import { UPDATE_NOTICE } from '../../../src/util/pwa';
import { appUrl, decklist, fixturesScript, freshProfile, noNetwork, updateStatus, waitForSession, waitForWorker } from './helpers';

const appliedAt = (page: Page) => page.evaluate(() => (window as unknown as { __spellplaneFakeUpdate: { applied: unknown[] } }).__spellplaneFakeUpdate.applied);
const offer = (page: Page) => page.evaluate(() => (window as unknown as { __spellplaneFakeUpdate: { offer(): void } }).__spellplaneFakeUpdate.offer());

test('a new version waits mid-game with the notice, and applies at the lobby, reloading into it', async ({ context, page }, info) => {
  const outside = await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const profile = freshProfile(info);
  await page.goto(appUrl({ profile, sw: true }));
  await waitForSession(page);
  await waitForWorker(page);
  expect(await updateStatus(page)).toBe('current');

  // The server now has a new version: the worker script changed.
  let served = 0;
  await context.route('**/sw.js', async (route) => {
    const res = await route.fetch();
    served++;
    await route.fulfill({ response: res, body: `${await res.text()}\n// next version\n` });
  });
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg!.update();
  });
  await expect.poll(() => updateStatus(page), { timeout: 30_000 }).toBe('available');
  expect(served).toBeGreaterThan(0);

  // Mid-game (the solo table is a game): the notice, no reload.
  await expect(page.getByTestId('update-notice')).toHaveText(UPDATE_NOTICE);
  const marker = await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = Math.random()));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(marker);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const waitingBefore = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
  expect(waitingBefore).toBe(true);

  // At the start page the update applies: the new worker takes over and the page reloads (the marker is gone).
  await page.evaluate(() => (location.hash = '#/lobby'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? null), { timeout: 30_000 }).toBeNull();
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => updateStatus(page)).toBe('current');
  await expect(page.getByTestId('update-notice')).toHaveCount(0);
  expect(outside).toEqual([]);
});

test('the solo table keeps the notice; leaving for the start page applies the update there', async ({ context, page }, info) => {
  await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  await page.goto(appUrl({ profile: freshProfile(info), update: 'fake' }));
  await waitForSession(page);
  await expect(page.getByTestId('update-notice')).toHaveCount(0);
  await offer(page);
  await expect(page.getByTestId('update-notice')).toHaveText('New version available: it applies after this game');
  expect(await updateStatus(page)).toBe('available');
  // The notice never takes a click meant for the table.
  expect(await page.getByTestId('update-notice').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await appliedAt(page)).toEqual([]);

  await page.evaluate(() => (location.hash = '#/lobby'));
  await expect.poll(() => appliedAt(page)).toEqual([{ route: 'lobby', stage: null }]);
  await expect(page.getByTestId('update-applying')).toBeVisible();
});

test('a networked table in its lobby applies at once', async ({ context, page }, info) => {
  await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const room = `upd-room-${Math.random().toString(36).slice(2, 8)}-42`;
  await page.goto(appUrl({ profile: freshProfile(info), update: 'fake', transport: 'local', hash: `/t/${room}/AAAAAAAAAAAAAAAAAAAAAA` }));
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  await offer(page);
  await expect.poll(() => appliedAt(page)).toEqual([{ route: 'room', stage: 'lobby' }]);
});

test('a networked table in a game keeps the notice and never applies; both players play on', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const room = `upd-game-${Math.random().toString(36).slice(2, 8)}-42`;
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const [p, who] of [[a, 'a'], [b, 'b']] as const) {
    await p.goto(appUrl({ profile: freshProfile(info, who), update: 'fake', transport: 'local', hash: `/t/${room}/AAAAAAAAAAAAAAAAAAAAAA` }));
    await expect(p.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  }
  for (const p of [a, b]) await expect.poll(() => p.evaluate(() => window.__spellplane!.net!.status()), { timeout: 15_000 }).toBe('connected');
  for (const [p, file] of [[a, 'gw-m19-60.txt'], [b, 'ur-m19-60.mtga.txt']] as const) {
    await p.getByTestId('lobby-deck-text').fill(decklist(file));
    await p.getByTestId('lobby-deck-check').click();
    await expect(p.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
    await p.getByTestId('ready').click();
  }
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });

  await offer(a);
  await expect(a.getByTestId('update-notice')).toHaveText(UPDATE_NOTICE);
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(1));
  await expect.poll(() => a.evaluate(() => window.__spellplane!.secrets!().hand.length)).toBe(1);
  expect(await appliedAt(a)).toEqual([]);
  expect(await updateStatus(a)).toBe('available');
  await context.close();
});
