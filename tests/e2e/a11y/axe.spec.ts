/**
 * PLAN M5-P4 acceptance: "axe reports no serious violations on lobby, table HUD and builder list" (DESIGN "Input and
 * interaction design", Accessibility: Paper meets WCAG AA contrast throughout; seat colours are paired with a shape or
 * pattern; the log is a live region). Runs @axe-core/playwright against the test build in Chromium and WebKit with the
 * default theme (Paper), WCAG 2.x A and AA rules and axe's best practices; serious and critical findings fail.
 */
import { expect, test } from '@playwright/test';
import { seriousViolations, sealedBuilder, sceneReady, soloTable, twoInLobby } from './helpers';

test.describe('axe: no serious or critical violations (PLAN M5-P4)', () => {
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
