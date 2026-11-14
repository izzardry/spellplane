/**
 * PLAN M5-P4 acceptance: "axe reports no serious violations on lobby, table HUD and builder list" (DESIGN "Input and
 * interaction design", Accessibility: Paper meets WCAG AA contrast throughout; seat colours are paired with a shape or
 * pattern; the log is a live region). Runs @axe-core/playwright against the test build in Chromium and WebKit with the
 * default theme (Paper), WCAG 2.x A and AA rules and axe's best practices; serious and critical findings fail.
 */
import { expect, test } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import type { CardFocus } from '../../../src/ui/a11y/index';
import { hook } from '../helpers/app';
import { freshProfile, open, startPageLoaded } from '../lobby/helpers';
import { seriousViolations, sealedBuilder, sceneReady, soloTable, twoInLobby } from './helpers';

test.describe('axe: no serious or critical violations (PLAN M5-P4)', () => {
  test('the start page (create or join a table), empty and with a nickname problem', async ({ page }, info) => {
    await open(page, '/lobby', { profile: freshProfile(info, 'axe'), transport: 'local' });
    await expect(page.getByTestId('start-page')).toBeVisible();
    await startPageLoaded(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('nickname').fill('   ');
    await page.getByTestId('join-link').fill('not a link');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the lobby, with two players seated', async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      // The host's lobby (editable settings) and the guest's (read-only settings) differ: both are checked.
      expect(await seriousViolations(a)).toEqual([]);
      expect(await seriousViolations(b)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('the table HUD, with a hand, the log open, a prompt-free table', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    await expect(page.getByTestId('log')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the table HUD with a spell on the stack, the keyboard context menu and the library viewer open', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    // Keyboard only: focus the first hand card and cast it (C), so the stack chip shows Resolve, its targets and Counter.
    const first = (await hook<SecretStore>(page, 'secrets')).hand[0]!;
    await page.mouse.move(5, 450);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook<CardFocus | null>(page, 'a11y.focus')).toEqual({ zone: 'hand:s0', card: first });
    await page.keyboard.press('KeyC');
    await expect.poll(async () => (await hook<TableState>(page, 'state')).cards[first]?.zone).toBe('stack');
    await expect(page.getByTestId('stack-chip')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    // The context menu of the focused card (the next hand card), opened from the keyboard.
    await page.keyboard.press('ContextMenu');
    await expect(page.getByTestId('context-menu')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    await expect(page.getByTestId('pile-viewer')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the table HUD with the cheat sheet open', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    await page.getByTestId('open-cheat-sheet').click();
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the builder list view', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      await sealedBuilder(a, b);
      expect(await seriousViolations(a)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
