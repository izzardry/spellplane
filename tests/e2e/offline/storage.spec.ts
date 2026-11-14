/**
 * PLAN M5-P3 and Milestone 5 owner decisions, Installable on iPad, in the browser:
 * - the storage section shows the estimate and whether the browser keeps the data; the storage-persistence prompt
 *   shows once;
 * - decks and saved tables export to a versioned JSON file and import again in another (wiped) profile, which then
 *   resumes the same table;
 * - the one-time Home Screen hint shows on iPad and iPhone (not on a desktop) and explains Safari's 7-day wipe;
 * - the page is installable: manifest with Spellplane's own icons, apple-touch-icon and the iOS meta tags;
 * - Scryfall out of reach: a clear message instead of an endless "Working…".
 */
import { devices, expect, test } from '@playwright/test';
import fs from 'node:fs';
import type { SecretStore } from '../../../src/core/types';
import { BACKUP_FILE_FORMAT, BACKUP_FILE_VERSION, type BackupFile } from '../../../src/store/types';
import { hook } from '../helpers/app';
import { appUrl, call, decklist, fixturesScript, freshProfile, noNetwork, waitForSession } from './helpers';

test('the storage section shows the estimate and persistence; the persistence prompt is answered once', async ({ context, page }, info) => {
  await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const profile = freshProfile(info);
  await page.goto(appUrl({ profile, hash: '/lobby' }));
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  await expect(page.getByTestId('storage-estimate')).toContainText(/Spellplane stores [\d.]+ (B|kB|MB|GB)( of about [\d.]+ (MB|GB|TB) this browser allows it)?\./);
  const status = await page.evaluate(() => window.__spellplane!.storage!.status());
  expect(status.usage).not.toBeNull();
  await expect(page.getByTestId('storage-persisted')).toHaveAttribute('data-persisted', String(status.persisted));

  // The browser decides about persistence by itself; while it has not granted it, the prompt explains and asks once.
  const supported = await page.evaluate(() => typeof navigator.storage?.persist === 'function');
  test.skip(!supported || status.persisted, 'this browser keeps the data already or cannot be asked');
  const hint = page.getByTestId('hint-persist');
  await expect(hint).toBeVisible();
  await hint.getByTestId('hint-persist-later').click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect(page.getByTestId('hint-persist')).toHaveCount(0);
  // Asking from the storage section still works, and says what the browser answered.
  await page.getByTestId('storage-persist').click();
  await expect(page.getByTestId('storage-persist-result')).toContainText(/keeps Spellplane’s data for good|did not agree/);
});

test('export a backup, import it into a wiped profile: decks and the saved table come back and the table resumes', async ({ context, page }, info) => {
  const outside = await noNetwork(context);
  await context.addInitScript({ content: fixturesScript() });
  const profile = freshProfile(info, 'ann');

  // A solo game in progress.
  await page.goto(appUrl({ profile }));
  await waitForSession(page);
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  await call(page, 'saved');
  const hash = await call<string>(page, 'hash');
  const secrets = await hook<SecretStore>(page, 'secrets');

  // Export from the start page.
  await page.evaluate(() => (location.hash = '#/lobby'));
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-export').click()]);
  expect(download.suggestedFilename()).toMatch(/^spellplane-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8')) as BackupFile;
  expect(backup).toMatchObject({ format: BACKUP_FILE_FORMAT, version: BACKUP_FILE_VERSION });
  expect(backup.tables.map((t) => t.table.roomId)).toEqual(['solo']);
  expect(backup.tables[0]!.secrets).toEqual(secrets);
  expect(backup.identity?.privateJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
  await expect(page.getByTestId('backup-export-result')).toContainText('1 saved table');

  // Another profile: a browser whose storage Safari wiped.
  const other = await context.newPage();
  const wiped = freshProfile(info, 'wiped');
  await other.goto(appUrl({ profile: wiped, hash: '/lobby' }));
  await expect(other.getByTestId('storage-panel')).toBeVisible();
  await other.getByTestId('backup-file').setInputFiles(file);
  await expect(other.getByTestId('backup-preview')).toContainText('holds 0 decks and 1 saved table');
  await expect(other.getByTestId('backup-replace-identity')).toBeChecked();
  await other.getByTestId('backup-restore').click();
  await expect(other.getByTestId('backup-result')).toContainText('Restored 0 decks and 1 saved table.');
  await other.getByTestId('backup-reload').click();
  await other.evaluate(() => (location.hash = '#/'));
  await waitForSession(other);
  expect(await call<string>(other, 'hash')).toBe(hash);
  expect(await hook<SecretStore>(other, 'secrets')).toEqual(secrets);

  // Importing the same file again keeps what is there and says so.
  await other.evaluate(() => (location.hash = '#/lobby'));
  await other.getByTestId('backup-file').setInputFiles(file);
  await other.getByTestId('backup-restore').click();
  await expect(other.getByTestId('backup-result')).toContainText('already has it');
  expect(outside).toEqual([]);
});

test('a file that is not a backup is reported, nothing is restored', async ({ context, page }, info) => {
  await noNetwork(context);
  await page.goto(appUrl({ profile: freshProfile(info), hash: '/lobby' }));
  await expect(page.getByTestId('storage-panel')).toBeVisible();
  await page.getByTestId('backup-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": "world"}') });
  await expect(page.getByTestId('backup-read-errors')).toContainText('The file is not a Spellplane backup.');
  await expect(page.getByTestId('backup-restore')).toHaveCount(0);
  await page.getByTestId('backup-file').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: BACKUP_FILE_FORMAT, version: 99, decks: [], tables: [] })) });
  await expect(page.getByTestId('backup-read-errors')).toContainText('newer Spellplane (version 99)');
});

test('the page is installable: manifest, own icons, apple-touch-icon and the iOS meta tags', async ({ page, context }, info) => {
  await noNetwork(context);
  await page.goto(appUrl({ profile: freshProfile(info), hash: '/lobby' }));
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/spellplane/manifest.webmanifest');
  const manifest = (await (await page.request.get(manifestHref!)).json()) as { name: string; display: string; icons: { src: string; sizes: string }[] };
  expect(manifest).toMatchObject({ name: 'Spellplane', display: 'standalone' });
  for (const icon of manifest.icons) {
    const res = await page.request.get(`/spellplane/${icon.src}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touch).toBe('/spellplane/icons/apple-touch-icon.png');
  expect((await page.request.get(touch!)).status()).toBe(200);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111111');
  // No Home Screen hint on a desktop browser.
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect(page.getByTestId('hint-home-screen')).toHaveCount(0);
});

test('Scryfall out of reach: the deck import says so clearly and stops working, instead of waiting forever', async ({ context, page }, info) => {
  // No injected fixtures: the app's real Scryfall client, with Scryfall refusing every connection.
  const outside = await noNetwork(context);
  await page.goto(appUrl({ profile: freshProfile(info) }));
  await waitForSession(page);
  await page.getByTestId('open-deck-import').click();
  await page.getByTestId('deck-text').fill('4 Shock\n20 Mountain');
  await page.getByTestId('deck-check').click();
  const dialog = page.getByTestId('deck-import');
  await expect(dialog).toContainText('Scryfall cannot be reached right now (no connection to it). Cards already loaded on this device still work; try again later.');
  await expect(dialog).not.toContainText('Working…');
  await expect(page.getByTestId('deck-check')).toBeEnabled();
  expect(outside.some((u) => u.startsWith('https://api.scryfall.com/cards/collection'))).toBe(true);
});

// iPad Safari's viewport, user agent, touch and scale; the browser stays the project's (Chromium and WebKit both run it).
const { defaultBrowserType: _browser, ...IPAD } = devices['iPad Pro 11 landscape'];

test.describe('on an iPad', () => {
  test.use(IPAD);

  test('a one-time hint explains why to add Spellplane to the Home Screen', async ({ context, page }, info) => {
    await noNetwork(context);
    await context.addInitScript({ content: fixturesScript() });
    await page.goto(appUrl({ profile: freshProfile(info), hash: '/lobby' }));
    const hint = page.getByTestId('hint-home-screen');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('7 days');
    await expect(hint).toContainText('Add to Home Screen');
    await hint.getByTestId('hint-home-screen-ok').tap();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('start-page')).toBeVisible();
    await expect(page.getByTestId('storage-panel')).toBeVisible();
    await expect(page.getByTestId('hint-home-screen')).toHaveCount(0);
  });

  test('in a table’s lobby the hint sits in a corner, clear of the lobby’s controls', async ({ context, page }, info) => {
    await noNetwork(context);
    await context.addInitScript({ content: fixturesScript() });
    const room = `ipad-room-${Math.random().toString(36).slice(2, 8)}-42`;
    await page.goto(appUrl({ profile: freshProfile(info), transport: 'local', hash: `/t/${room}/AAAAAAAAAAAAAAAAAAAAAA` }));
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    const hint = page.getByTestId('hint-home-screen');
    await expect(hint).toBeVisible();
    const box = (await hint.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // Nothing the lobby needs is under it: the deck check stays clear.
    const ready = page.getByTestId('lobby-deck-check');
    await expect(ready).toBeVisible();
    const r = (await ready.boundingBox())!;
    const overlaps = r.x < box.x + box.width && box.x < r.x + r.width && r.y < box.y + box.height && box.y < r.y + r.height;
    expect(overlaps).toBe(false);
  });
});
