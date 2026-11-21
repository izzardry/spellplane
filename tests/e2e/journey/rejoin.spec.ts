/**
 * M8-P8 journey: leave, History, rejoin, bring back (docs/PLAN.md Milestone 8, acceptance "M8-P8", rejoin.spec.ts;
 * journey.md 4.10 "Leaving", 4.11, 4.12, 4.14; persistence.md sections 5 to 7). Two profiles in a private game
 * started from Home: Ann leaves by the arrow; Ben sees the notice and Ann's plate away; History lists the game first on
 * Ann's page; Ben plays on; Ann reopens the game from History and is live with Ben's state hash; Ann leaves again; Ben
 * opens Ann's plate menu, `BRING ANN BACK` shows the QR code and the link; a fresh profile opens the link, sits down
 * and the recovery panel opens by itself. The sequencer's 30-second absence rule runs on Ben's injected clock
 * (`net.setClock`), never slept through. Fixtures, the local transport.
 */
import { expect, test, type Page } from '@playwright/test';
import { atTable, decklist, dispatch, freshProfile, gamesOf, hands, leaveByArrow, navTo, openSite, pages, privateTable, readyWith, sameHash, state, tableHash } from '../helpers/journey';

test.describe('journey: leave, History, rejoin and bring back', () => {
  test('Ann leaves and returns from History live on Ben’s copy; Ben brings Ann back to a fresh browser', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, list } = await pages(browser, 3);
    const [a, b, c] = list as [Page, Page, Page];
    const profiles = { a: freshProfile(info, 'ann'), b: freshProfile(info, 'ben') };
    let room = '';
    try {
      await a.clock.install();
      await test.step('a private game from Home: seven cards each', async () => {
        const link = await privateTable(a, b, profiles);
        room = link.split('/t/')[1]!.split('/')[0]!;
        await readyWith(b, 'ur-m19-60.mtga.txt');
        await readyWith(a, 'gw-m19-60.txt');
        await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
        await a.clock.runFor(3_100);
        await expect.poll(() => hands(b, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await sameHash([a, b]);
        await expect(a.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      }, { timeout: 70_000 });

      await test.step('Ann leaves by the arrow: Ben sees the notice and her plate away', async () => {
        await leaveByArrow(a);
        await expect(a.getByTestId('toast').filter({ hasText: 'You left the table. The game goes on; your seat is kept.' })).toHaveCount(1);
        await expect.poll(async () => (await state(b)).seats.s0?.away === true, { timeout: 10_000 }).toBe(true);
        const ann = (await state(b)).seats.s0!.name;
        await expect(b.getByTestId('hud-notice')).toContainText(`${ann} left. The game goes on; ${ann} can come back.`, { timeout: 10_000 });
        await expect(b.locator('[data-testid="avatar"][data-seat="s0"]')).toHaveAttribute('data-away', 'true');
      }, { timeout: 30_000 });

      await test.step('History lists the game first on Ann’s page; Ben plays on', async () => {
        await navTo(a, 'HISTORY');
        // What the History page shows first, not only the store's order.
        await expect(a.getByTestId('history-row').first()).toHaveAttribute('data-code', room);
        expect((await gamesOf(a))[0]?.code).toBe(room);
        for (let i = 0; i < 3; i++) await dispatch(b, { type: 'life', seat: 's1', delta: -1 });
        await expect.poll(async () => (await state(b)).seats.s1?.life).toBe(17);
      }, { timeout: 20_000 });

      await test.step('Ann reopens it from History and is live with Ben’s state hash', async () => {
        await a.getByTestId('history-row').first().click();
        await atTable(a, 'room');
        await expect.poll(() => a.evaluate(() => window.__spellplane?.session?.muster?.().live ?? false), { timeout: 30_000 }).toBe(true);
        // Ben's moves while she was away are on her table, and both browsers hold one state (her return marks her here).
        await expect.poll(async () => (await state(b)).seats.s0?.away ?? false, { timeout: 10_000 }).toBe(false);
        const h = await sameHash([a, b]);
        expect(h).toBe(await tableHash(b));
        expect((await state(a)).seats.s1?.life).toBe(17);
        await expect(a.getByTestId('gathering-card')).toHaveCount(0);
      }, { timeout: 45_000 });

      let inviteLink = '';
      await test.step('Ann leaves again; Ben opens her plate menu: BRING ANN BACK shows the QR code and the link', async () => {
        await leaveByArrow(a);
        await expect.poll(async () => (await state(b)).seats.s0?.away === true, { timeout: 10_000 }).toBe(true);
        const name = (await state(b)).seats.s0!.name;
        // The sequencer accepts an invite after 30 s of absence on its own clock (contracts.md Part G "Rejoin" item 7).
        await b.evaluate(() => window.__spellplane!.net!.setClock!(Date.now() + 31_000));
        await b.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('plate-more').click();
        await expect(b.getByTestId('seat-menu-away')).toBeVisible();
        const bring = b.getByTestId('seat-menu-bring');
        await expect(bring).toHaveText(`BRING ${name.toUpperCase()} BACK`);
        await bring.click();
        await expect(b.getByTestId('qr-plate')).toBeVisible({ timeout: 15_000 });
        await expect(b.getByTestId('share-link')).toHaveValue(/\/rejoin\/s0\//, { timeout: 15_000 });
        inviteLink = await b.getByTestId('share-link').inputValue();
        await b.evaluate(() => window.__spellplane!.net!.setClock!(null));
      }, { timeout: 40_000 });

      await test.step('a fresh profile opens the link, sits down as Ann and recovers', async () => {
        await openSite(c, freshProfile(info, 'ann-new'), inviteLink.slice(inviteLink.indexOf('#') + 1));
        await expect(c.getByTestId('claim-page')).toBeVisible({ timeout: 30_000 });
        await expect(c.getByTestId('claim-warning')).toBeVisible();
        await c.getByTestId('claim-sit').click();
        await expect.poll(() => c.evaluate(() => window.__spellplane?.session?.seat() ?? null), { timeout: 20_000 }).toBe('s0');
        await expect.poll(() => c.evaluate(() => location.hash), { timeout: 10_000 }).not.toContain('/rejoin/');
        await expect(c.getByTestId('recovery')).toBeVisible({ timeout: 20_000 });
        await sameHash([b, c]);
        expect((await gamesOf(c))[0]?.code).toBe(room);
      }, { timeout: 60_000 });

      await test.step('the recovery completes: the deck re-imported, a new hand of 7 agreed by Ben, one state', async () => {
        await expect(c.getByTestId('recovery')).toHaveAttribute('data-phase', 'lost', { timeout: 20_000 });
        await c.getByTestId('recovery-hand').fill('7');
        await c.getByTestId('recovery-start').click();
        const dialog = c.getByTestId('recovery-import');
        await dialog.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
        await dialog.getByTestId('deck-check').click();
        await dialog.getByTestId('deck-import-go').click();
        await expect(dialog).toHaveCount(0);
        await expect(b.getByTestId('confirm-prompt')).toContainText('new hand of 7?', { timeout: 15_000 });
        await b.getByTestId('prompt-ok').click();
        await expect(c.getByTestId('recovery-done')).toContainText('a hand of 7', { timeout: 30_000 });
        for (const p of [b, c]) {
          await expect.poll(async () => (await state(p)).zones['hand:s0']!.ids.length, { timeout: 15_000 }).toBe(7);
          expect((await state(p)).seats.s0!.recovering).toBeUndefined();
        }
        await sameHash([b, c]);
      }, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });
});
