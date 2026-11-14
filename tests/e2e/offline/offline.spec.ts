/**
 * PLAN Milestone 5 acceptance (M5-P3): "the app loads and resumes a saved table with the network disabled" — a
 * Playwright offline context after a first online load from the test build. The test build runs its service worker
 * with `?sw=on` (production builds always do); the worker precaches the whole build on the first visit (PLAN M5-P3:
 * precache of the app shell). Card data comes from tests/fixtures/, faces are placeholders, and no request leaves the
 * machine at any point.
 */
import { expect, test } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { appUrl, call, decklist, fixturesScript, freshProfile, noNetwork, waitForSession, waitForWorker } from './helpers';

test('after one online visit the app loads offline and resumes the saved solo table: same state hash, same hidden cards', async ({ context, page }, info) => {
  const outside = await noNetwork(context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript({ content: fixturesScript() });
  const profile = freshProfile(info);

  // Online: the first visit installs the worker, which caches the app before it takes control.
  await page.goto(appUrl({ profile, sw: true }));
  await waitForSession(page);
  await waitForWorker(page);
  await expect(page.getByTestId('hud')).toBeVisible();

  // A game in progress, saved.
  expect(await call(page, 'importDecklist', decklist('gw-m19-60.txt'))).toMatchObject({ main: 60 });
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  const hand = (await hook<SecretStore>(page, 'secrets')).hand;
  await hook(page, 'dispatch', { type: 'move', card: hand[0], to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
  await hook(page, 'dispatch', { type: 'tap', card: hand[0], tapped: true });
  await call(page, 'saved');
  const hash = await call<string>(page, 'hash');
  const secrets = await hook<SecretStore>(page, 'secrets');

  // The network goes away; the page is reloaded.
  await context.setOffline(true);
  await page.reload();
  await waitForSession(page);
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(await call<string>(page, 'hash')).toBe(hash);
  expect(await hook<SecretStore>(page, 'secrets')).toEqual(secrets);
  expect((await hook<TableState>(page, 'state')).cards[hand[0]!]).toMatchObject({ zone: 'battlefield:s0', tapped: true, face: 'up' });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  // Play goes on offline and is saved like before.
  await call(page, 'draw', 1);
  await call(page, 'saved');
  const later = await call<string>(page, 'hash');

  // A new tab opened offline (the app was closed) starts from the cache too and finds the table as it was left.
  const tab = await context.newPage();
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.goto(appUrl({ profile, sw: true }));
  await waitForSession(tab);
  expect(await call<string>(tab, 'hash')).toBe(later);

  // A theme chunk this page never loaded comes from the precache as well (every file of the build is cached).
  await tab.evaluate(() => window.__spellplane!.theme!.set('dusk'));
  expect(await tab.evaluate(() => window.__spellplane!.theme!.current())).toBe('dusk');

  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('the start page loads offline with the saved tables, the storage section and the backup', async ({ context, page }, info) => {
  const outside = await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const profile = freshProfile(info);
  await page.goto(appUrl({ profile, sw: true, hash: '/lobby' }));
  await expect(page.getByTestId('start-page')).toBeVisible();
  await waitForWorker(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  // The browser reports what the origin stores; with the precached app it is more than nothing.
  await expect(page.getByTestId('storage-estimate')).toContainText(/Spellplane stores [\d.]+ (kB|MB)/);
  await expect(page.getByTestId('backup-export')).toBeEnabled();
  expect(outside).toEqual([]);
});

test('without ?sw=on a test build runs no worker, so other browser tests are never answered by one', async ({ context, page }, info) => {
  await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  await page.goto(appUrl({ profile: freshProfile(info) }));
  await waitForSession(page);
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
  expect(await page.evaluate(() => window.__spellplane!.storage!.update())).toBe('current');
});
