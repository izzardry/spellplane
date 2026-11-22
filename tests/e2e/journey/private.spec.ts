/**
 * M8-P8 journey: a private game (docs/PLAN.md Milestone 8, acceptance "M8-P8", private.spec.ts; journey.md 4.7, 4.8,
 * 4.9, 4.13). Two profiles: Ann's Home `CREATE TABLE` opens the waiting room with the invite sheet; `COPY LINK` writes
 * the link (the clipboard stubbed); Ben opens the link and is seated; both `READY`; the start presses itself when the
 * page clock runs 3 s; versus; seven cards each with equal state hashes; Ben concedes from the table's menu after one
 * confirm; both see the overlay; Ann's `HOME` leads Home with the networked toast. Fixtures, the local transport.
 */
import { expect, test, type Page } from '@playwright/test';
import { atTable, copied, decklist, dispatch, freshProfile, gamesOf, hands, homeIsClean, leaveByArrow, mode, openSite, pages, privateTable, readyWith, sameHash, seedDeck, soloOpponent, state } from '../helpers/journey';

/**
 * Records the versus screen (journey.md 4.7) without timing: whether it came up, whether its "goes first" line was
 * drawn, and its `data-done` when it went away.
 */
const VERSUS_WATCH = (): void => {
  const w = window as unknown as { __versus: { seen: boolean; first: boolean; gone: boolean; doneAtGone: string | null } };
  w.__versus = { seen: false, first: false, gone: false, doneAtGone: null };
  let last: string | null = null;
  const look = (): void => {
    const v = document.querySelector<HTMLElement>('[data-testid="versus"]');
    if (v) {
      w.__versus.seen = true;
      last = v.dataset.done ?? null;
      if (v.querySelector('[data-testid="versus-first"]')) w.__versus.first = true;
    } else if (w.__versus.seen && !w.__versus.gone) {
      w.__versus.gone = true;
      w.__versus.doneAtGone = last;
    }
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-done'] });
};
const versusOf = (p: Page): Promise<unknown> => p.evaluate(() => (window as unknown as { __versus: unknown }).__versus);

test.describe('journey: a private game', () => {
  test('CREATE TABLE, the invite link, READY, the self-pressing start, seven cards, Concede, the overlay, HOME', async ({ browser }, info) => {
    test.setTimeout(150_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    const errors: string[] = [];
    for (const p of list) p.on('pageerror', (e) => errors.push(e.message));
    try {
      await a.clock.install();
      for (const p of list) await p.addInitScript(VERSUS_WATCH);
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
        // Versus on both pages: it ticks every line, names who goes first, and goes once everyone is dealt.
        for (const p of [a, b]) await expect.poll(() => versusOf(p), { timeout: 30_000 }).toEqual({ seen: true, first: true, gone: true, doneAtGone: 'true' });
        for (const p of [a, b]) await expect(p.getByTestId('versus')).toHaveCount(0);
        await expect.poll(() => hands(b, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await expect.poll(() => hands(a, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await sameHash([a, b]);
        for (const p of [a, b]) {
          await expect(p.getByTestId('lobby')).toHaveCount(0);
          await expect(p.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
          await expect(p.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
        }
      }, { timeout: 60_000 });

      await test.step('a third profile opening the link of the running game: every seat is taken, WATCH and HOME', async () => {
        const c = await context.newPage();
        await openSite(c, freshProfile(info, 'cleo'), link.slice(link.indexOf('#') + 1));
        await expect(c.getByTestId('room-error')).toContainText('This game has started and every seat is taken.', { timeout: 30_000 });
        await expect(c.getByTestId('watch-instead')).toHaveText('WATCH');
        await expect(c.getByTestId('room-home')).toBeVisible();
        await c.close();
      }, { timeout: 45_000 });

      await test.step('Ben concedes from the menu after one confirm; both see the overlay', async () => {
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        await expect(b.getByTestId('concede-confirm')).toBeVisible();
        // KEEP PLAYING keeps the game going (journey.md 4.13).
        await expect(b.getByTestId('concede-cancel')).toHaveText('KEEP PLAYING');
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

      await test.step("Ann's HOME: Home with the ended toast (no REJOIN); the game is in History", async () => {
        await a.getByTestId('game-over-home').click();
        await expect(a.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        // An ended game cannot be continued (journey.md 4.13): the toast says so and offers no way back in.
        const toast = a.getByTestId('toast').filter({ hasText: 'Game over. It is in your History.' });
        await expect(toast).toHaveCount(1);
        await expect(toast.getByRole('button', { name: /rejoin/i })).toHaveCount(0);
        await expect(a.getByTestId('toast').filter({ hasText: 'You left the table.' })).toHaveCount(0);
        const games = await a.evaluate(() => window.__spellplane!.games!.list());
        expect(games[0]?.code).toBe(link.split('/t/')[1]!.split('/')[0]);
      }, { timeout: 30_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('Menu → Invite… at a table with an open seat shows the invite sheet; Back leaves like the arrow', async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    try {
      let link = '';
      await test.step('Ann creates a 4 FFA table from Home; Ben joins; the game starts with two of four seats', async () => {
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await a.getByTestId('opt-private-format').getByRole('radio', { name: '4 FFA' }).click();
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        link = await a.getByTestId('share-link').inputValue();
        await expect.poll(async () => (await state(a)).format, { timeout: 10_000 }).toBe('ffa4');
        // Ben starts on Home and follows the link in the same tab, so his Back has a page to go to.
        await openSite(b, freshProfile(info, 'ben'));
        await expect(b.getByTestId('route-home')).toBeVisible();
        await b.evaluate((h) => (location.hash = h), link.slice(link.indexOf('#')));
        await expect.poll(() => b.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toMatch(/^s\d$/);
        for (const [p, f] of [
          [a, 'gw-m19-60.txt'],
          [b, 'ur-m19-60.mtga.txt'],
        ] as const)
          await p.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist(f));
        await dispatch(a, { type: 'stageSet', stage: 'match' });
        for (const p of [a, b]) await expect(p.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      }, { timeout: 60_000 });

      await test.step('Menu → Invite… opens the invite sheet with the table link', async () => {
        await a.getByTestId('open-menu').click();
        await a.getByRole('menuitem', { name: /invite/i }).click();
        await expect(a.getByTestId('frame-invite')).toBeVisible();
        await expect(a.getByTestId('share-link')).toHaveValue(link);
        await expect(a.getByTestId('qr-plate')).toBeVisible();
        await a.getByTestId('copy-link').click();
        expect(await copied(a)).toEqual([link]);
      }, { timeout: 20_000 });

      await test.step("Ben's browser Back: Home with the networked toast; Ann sees him away", async () => {
        const ben = await b.evaluate(() => window.__spellplane!.session!.seat());
        await b.goBack();
        await expect(b.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        await expect(b.getByTestId('toast').filter({ hasText: 'You left the table. The game goes on; your seat is kept.' })).toHaveCount(1);
        await expect.poll(async () => (await state(a)).seats[ben]?.away === true, { timeout: 10_000 }).toBe(true);
        // His leaving puts a notice on Ann's table; it stays for the HUD toast's 6 s (TableFrame NOTICE_MS), so it is read now.
        await expect(a.getByTestId('hud-notice')).toContainText('left. The game goes on');
        await expect(b.getByTestId('home-continue')).toBeVisible();
        // The summary carries the room key although Back had already changed the address when it was written.
        const code = link.split('/t/')[1]!.split('/')[0]!;
        const key = link.split('/t/')[1]!.split('/')[1]!;
        expect((await gamesOf(b)).find((g) => g.code === code)?.key).toBe(key);
        await b.getByTestId('home-continue').click();
        await expect(b.getByTestId('table-frame')).toHaveAttribute('data-kind', 'room', { timeout: 20_000 });
        await expect.poll(() => b.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toBe(ben);
      }, { timeout: 60_000 });

      await test.step("a table's notice stays with its table: Ann leaves and opens a practice table, no notice there", async () => {
        // Ben leaves again, by the arrow: a fresh notice on Ann's table, and Ann leaves while it shows (its 6 s run on
        // the real clock, so it is not waited for after Ben's return).
        await b.getByTestId('leave').click();
        await expect(a.getByTestId('hud-notice')).toContainText('left. The game goes on', { timeout: 15_000 });
        await leaveByArrow(a);
        await expect(b.getByTestId('route-home')).toBeVisible();
        await soloOpponent(a, 'ALONE');
        await a.getByTestId('home-primary').click();
        await atTable(a, 'practice');
        await expect(a.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await expect(a.getByTestId('hud-notice')).toHaveCount(0);
      }, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });

  test("a joiner's Back from the waiting room keeps the room key; a spectator's Back takes no chair", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, list } = await pages(browser, 3);
    const [a, b, c] = list as [Page, Page, Page];
    try {
      let link = '';
      await test.step('Ann creates a private table from Home', async () => {
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        link = await a.getByTestId('share-link').inputValue();
      }, { timeout: 40_000 });

      await test.step("Ben follows the link from Home, is seated in the waiting room and presses Back: History has the key", async () => {
        await openSite(b, freshProfile(info, 'ben'));
        await expect(b.getByTestId('route-home')).toBeVisible();
        await b.evaluate((h) => (location.hash = h), link.slice(link.indexOf('#')));
        await expect(b.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
        await b.goBack();
        await expect(b.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        const [code, key] = link.split('/t/')[1]!.split('/') as [string, string];
        await expect.poll(async () => (await gamesOf(b)).map((g) => [g.code, g.key]), { timeout: 10_000 }).toEqual([[code, key]]);
      }, { timeout: 40_000 });

      const cleo = freshProfile(info, 'cleo');
      let seq = 0;
      let seats = '';
      await test.step('Cleo follows the watch link from Home', async () => {
        await openSite(c, cleo);
        await expect(c.getByTestId('route-home')).toBeVisible();
        await c.evaluate((h) => (location.hash = h), `${link.slice(link.indexOf('#'))}/watch`);
        await expect(c.getByTestId('spectator-view')).toBeVisible({ timeout: 20_000 });
        const st = await state(a);
        seq = st.seq;
        seats = JSON.stringify(Object.values(st.seats).map((x) => [x.id, x.peer ?? null, x.name]));
      }, { timeout: 40_000 });

      await test.step("Cleo's Back: Home at once; Ann's table keeps its seats and its log; Cleo has no History row", async () => {
        const peer = await c.evaluate(() => window.__spellplane?.net?.self() ?? '');
        await c.goBack();
        await expect(c.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        await homeIsClean(c);
        expect(await gamesOf(c)).toEqual([]);
        const st = await state(a);
        expect(st.seq).toBe(seq);
        expect(JSON.stringify(Object.values(st.seats).map((x) => [x.id, x.peer ?? null, x.name]))).toBe(seats);
        if (peer) expect(Object.values(st.seats).some((x) => x.peer === peer)).toBe(false);
      }, { timeout: 40_000 });
    } finally {
      await context.close();
    }
  });
});
