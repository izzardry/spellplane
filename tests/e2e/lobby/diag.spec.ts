/**
 * The `#/diag` connection check (PLAN M1 Connectivity check: joins a room through the configured transport and reports
 * time to connect, peers and a ping round trip; a second machine joins through the page's link).
 */
import { expect, test } from '@playwright/test';
import { freshProfile, open, twoPages } from './helpers';

test('two pages: the second joins through the shown link; both report time to connect and a round trip', async ({ browser }, info) => {
  const { context, a, b } = await twoPages(browser);
  await open(a, '/diag', { profile: freshProfile(info, 'da'), transport: 'local' });
  await expect(a.getByTestId('diag')).toBeVisible();
  await expect(a.getByTestId('diag-joined')).toContainText('after');
  await expect(a.getByTestId('diag-nopeers')).toBeVisible();
  const link = await a.getByTestId('diag-link').inputValue();
  const [, hash] = /#(\/diag\/[^/]+\/[A-Za-z0-9_-]{22})$/.exec(link)!;

  await open(b, hash!, { profile: freshProfile(info, 'db'), transport: 'local' });
  for (const page of [a, b]) {
    await expect(page.getByTestId('diag-peer')).toHaveCount(1);
    await expect(page.getByTestId('diag-peer')).toContainText(/round trip \d+ ms/);
    await expect(page.getByTestId('diag-ok')).toBeVisible();
    await expect(page.getByTestId('diag-error')).toHaveCount(0);
  }
  await context.close();
});

test('relays out of reach: a plain failure message after the timeout', async ({ page }, info) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__spellplaneTransport = 'unreachable';
  });
  await open(page, '/diag', { profile: freshProfile(info, 'du') });
  await expect(page.getByTestId('diag-joined')).toContainText('joining');
  await page.clock.fastForward(21_000);
  await expect(page.getByTestId('diag-error')).toContainText('Could not reach the signalling relays');
  await expect(page.getByTestId('diag-error')).toContainText('another network, a phone hotspot or a VPN');
});

test('nobody else joins: a plain failure message after the timeout', async ({ page }, info) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__spellplaneTransport = 'silent';
  });
  await open(page, '/diag', { profile: freshProfile(info, 'ds') });
  await expect(page.getByTestId('diag-joined')).toContainText('after');
  await page.clock.fastForward(21_000);
  await expect(page.getByTestId('diag-error')).toContainText('No other browser connected');
});
