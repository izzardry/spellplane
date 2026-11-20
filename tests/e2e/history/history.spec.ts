/**
 * M8-P2 acceptance on `?harness=history` (PLAN Milestone 8, "M8-P2"; journey.md 4.14; persistence.md section 3;
 * contracts.md Part G "History and saving" items 3 and 4): rows newest first named by players, the state line, the
 * filter with ended solo games hidden under ALL, Remove with UNDO, Remove and the clock run on removes, the design
 * audit.
 */
import { expect, test, type Page } from '@playwright/test';
import { designAudit } from '../helpers/design-audit';
import { fixtureGame, openHomeHarness, seedGames } from '../helpers/home';

const uniq = (label: string): string => `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date('2026-11-20T10:00:00Z').getTime();

async function seeded(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + 1000);
  const profile = uniq('hist');
  await openHomeHarness(page, { profile, harness: 'history' });
  await seedGames(page, [
    fixtureGame('older-game-one-11', NOW - 3 * 3600_000, { players: [{ seat: 's0', name: 'Ann', colour: 0, life: 20, away: false, me: true }, { seat: 's1', name: 'Cleo', colour: 1, life: 9, away: false, me: false }, { seat: 's2', name: 'Dan', colour: 2, life: 12, away: true, me: false }], format: 'ffa3', active: 's0', turn: 11 }),
    fixtureGame('amber-fox-river-93', NOW - 12 * 60_000),
    fixtureGame('p-ended-solo', NOW - 60_000, { kind: 'solo', key: '', opponent: 'dummy', players: [{ seat: 's0', name: 'Ann', colour: 0, life: 20, away: false, me: true }], ended: 'replaced', endedAt: NOW - 30_000 }),
    fixtureGame('won-game-two-12', NOW - 2 * 86400_000, { result: { winners: ['s0'], reason: 'concede', atSeq: 80 }, ended: 'result', endedAt: NOW - 2 * 86400_000 }),
  ]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
}

test('rows newest first, named by the other players, with the state line; ended solo games hide under ALL', async ({ page }) => {
  await seeded(page);
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByTestId('history-title')).toHaveText('VS BEN');
  await expect(rows.nth(0).getByTestId('history-state')).toHaveText("Turn 3 · Ben's turn");
  await expect(rows.nth(0)).toContainText('12 min');
  await expect(rows.nth(0)).toContainText('AMBER FOX RIVER 93');
  await expect(rows.nth(0)).toContainText('Gruul Stompy');
  await expect(rows.nth(1).getByTestId('history-title')).toHaveText('CLEO AND DAN');
  await expect(rows.nth(1).getByTestId('history-state')).toHaveText('Turn 11 · your turn');
  await expect(rows.nth(2).getByTestId('history-state')).toHaveText('Ended · you 20, Ben 17');

  await test.step('the filter', async () => {
    const filter = page.getByTestId('history-filter');
    await filter.getByRole('radio', { name: 'UNFINISHED', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await filter.getByRole('radio', { name: 'FINISHED', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-code="p-ended-solo"]')).toBeVisible();
    await filter.getByRole('radio', { name: 'ALL', exact: true }).click();
    await expect(rows).toHaveCount(3);
    await expect(page.locator('[data-code="p-ended-solo"]')).toHaveCount(0);
  });
  await designAudit(page);

  await test.step('opening a row goes to its table', async () => {
    await rows.nth(0).getByRole('button', { name: /^Open/ }).click();
    await expect(page.getByTestId('harness-table')).toHaveAttribute('data-hash', '#/t/amber-fox-river-93/a2V5LWtleS1rZXkta2V5AA');
  });
});

test('Remove then UNDO restores; Remove and the clock running on removes the records', async ({ page }) => {
  await seeded(page);
  const rows = page.getByTestId('history-row');
  await test.step('undo', async () => {
    await page.locator('[data-code="amber-fox-river-93"]').getByTestId('history-remove').click();
    await expect(rows).toHaveCount(2);
    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('Game removed. Your hand in it goes with it.');
    await toast.getByRole('button', { name: 'UNDO' }).click();
    await expect(rows).toHaveCount(3);
    await page.clock.runFor(10_000);
    expect((await page.evaluate(() => window.__homeHarness!.allGames())).map((g) => g.code)).toContain('amber-fox-river-93');
  });
  await test.step('the clock runs on', async () => {
    await page.locator('[data-code="amber-fox-river-93"]').getByTestId('history-remove').click();
    await expect(rows).toHaveCount(2);
    await page.clock.runFor(5_000);
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await expect.poll(async () => (await page.evaluate(() => window.__homeHarness!.allGames())).map((g) => g.code)).not.toContain('amber-fox-river-93');
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
    await expect(rows).toHaveCount(2);
  });
});

test('the empty line', async ({ page }) => {
  await openHomeHarness(page, { profile: uniq('empty'), harness: 'history' });
  await expect(page.getByTestId('history-empty')).toHaveText('No games yet. Games you play are kept here, on this device, so you can leave and come back.');
  await designAudit(page);
});
