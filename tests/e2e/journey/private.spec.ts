/**
 * M8-P8 journey: a private game (docs/PLAN.md Milestone 8, acceptance "M8-P8", private.spec.ts; journey.md 4.7, 4.8,
 * 4.9, 4.13). Two profiles: Ann's Home `CREATE TABLE` opens the waiting room with the invite sheet; `COPY LINK` writes
 * the link (the clipboard stubbed); Ben opens the link and is seated; both `READY`; the start presses itself when the
 * page clock runs 3 s; versus; seven cards each with equal state hashes; Ben concedes from the table's menu after one
 * confirm; both see the overlay; Ann's `HOME` leads Home with the networked toast. Fixtures, the local transport.
 */
import { expect, test, type Page } from '@playwright/test';
import { copied, freshProfile, hands, pages, privateTable, readyWith, sameHash, state } from '../helpers/journey';

test.describe('journey: a private game', () => {
  test('CREATE TABLE, the invite link, READY, the self-pressing start, seven cards, Concede, the overlay, HOME', async ({ browser }, info) => {
    test.setTimeout(150_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    const errors: string[] = [];
    for (const p of list) p.on('pageerror', (e) => errors.push(e.message));
    try {
      await a.clock.install();
      let link = '';
      await test.step('Ann creates the table from Home; the invite sheet; COPY LINK; Ben opens the link', async () => {
        link = await privateTable(a, b, { a: freshProfile(info, 'ann'), b: freshProfile(info, 'ben') });
        expect(link).toMatch(/#\/t\/[^/]+\/[A-Za-z0-9_-]{22}$/);
        await a.getByTestId('copy-link').click();
        expect(await copied(a)).toEqual([link]);
        expect((await state(a)).settings.autoSetup).toBe(true);
        await expect(a.getByTestId('lobby')).toBeVisible();
        await expect(b.getByTestId('lobby')).toBeVisible();
      }, { timeout: 60_000 });

      await test.step('both READY; the start presses itself after 3 s on the page clock; versus; seven cards each', async () => {
        await readyWith(b, 'ur-m19-60.mtga.txt');
        await readyWith(a, 'gw-m19-60.txt');
        await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
        await a.clock.runFor(3_100);
        for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 20_000 });
        await expect.poll(() => hands(b, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await expect.poll(() => hands(a, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await sameHash([a, b]);
        for (const p of [a, b]) {
          await expect(p.getByTestId('lobby')).toHaveCount(0);
          await expect(p.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
          await expect(p.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
        }
      }, { timeout: 60_000 });

      await test.step('Ben concedes from the menu after one confirm; both see the overlay', async () => {
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        await expect(b.getByTestId('concede-confirm')).toBeVisible();
        // CANCEL keeps the game going.
        await b.getByTestId('concede-cancel').click();
        await expect(b.getByTestId('concede-confirm')).toHaveCount(0);
        expect((await state(b)).result).toBeUndefined();
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        await b.getByTestId('concede-ok').click();
        for (const p of [a, b]) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 20_000 });
        await expect(a.getByTestId('game-over-headline')).toHaveText(/victory/i);
        await expect(b.getByTestId('game-over-headline')).toHaveText(/defeat/i);
        expect((await state(a)).result?.winners).toEqual(['s0']);
      }, { timeout: 40_000 });

      await test.step("Ann's HOME: Home with the networked toast; the game is in History", async () => {
        await a.getByTestId('game-over-home').click();
        await expect(a.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        await expect(a.getByTestId('toast').filter({ hasText: 'You left the table. The game goes on; your seat is kept.' })).toHaveCount(1);
        const games = await a.evaluate(() => window.__spellplane!.games!.list());
        expect(games[0]?.code).toBe(link.split('/t/')[1]!.split('/')[0]);
      }, { timeout: 30_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
