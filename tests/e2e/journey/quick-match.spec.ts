/**
 * M8-P8 journey: Quick match (docs/PLAN.md Milestone 8, acceptance "M8-P8", quick-match.spec.ts; journey.md 4.5,
 * 4.6, 4.7, 4.13; matchmaking.md 2.4 to 2.10). Two profiles with a deck each press `FIND MATCH` in ranked 1v1; Ann
 * browses Decks with the queue bar meanwhile (her deck locked); the match-found card shows on both; both accept; both
 * are at the same table with no waiting room, seven cards each and equal state hashes; Ben concedes from the menu and
 * the overlay shows the rating change on both pages (opposite signs). Fixtures, the local transport, no network.
 */
import { expect, test, type Page } from '@playwright/test';
import { atTable, findMatch, freshProfile, gamesOf, hands, leaveByArrow, navTo, openSite, pages, sameHash, seedDeck, soloOpponent, state, tenActions } from '../helpers/journey';

/** Records, in order, every mount of a waiting room (and of the matched entry) in this page, without timing. */
const ROOM_WATCH = (): void => {
  const w = window as unknown as { __seen: string[] };
  w.__seen = [];
  new MutationObserver(() => {
    for (const id of ['matched-entry', 'lobby', 'waiting-room']) {
      const there = !!document.querySelector(`[data-testid="${id}"]`);
      const last = w.__seen.lastIndexOf(id) > w.__seen.lastIndexOf(`-${id}`);
      if (there && !last) w.__seen.push(id);
      if (!there && last) w.__seen.push(`-${id}`);
    }
  }).observe(document, { childList: true, subtree: true });
};
const seenOf = (p: Page): Promise<string[]> => p.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

test.describe('journey: Quick match', () => {
  test('two profiles find a ranked 1v1, accept, sit without a waiting room; a concession shows the rating change', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    const errors: string[] = [];
    for (const p of list) p.on('pageerror', (e) => errors.push(e.message));
    const phase = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.status().phase);
    try {
      for (const p of list) await p.addInitScript(ROOM_WATCH);
      await test.step('each profile has a deck', async () => {
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await openSite(b, freshProfile(info, 'ben'));
        await seedDeck(b, 'ur-m19-60.mtga.txt');
      }, { timeout: 40_000 });

      await test.step('Ann searches ranked 1v1 and browses Decks with the queue bar; her deck is locked', async () => {
        await findMatch(a, { format: '1V1', ranked: true });
        await expect.poll(() => phase(a)).toBe('seeking');
        await expect(a.getByTestId('home-prev')).toBeDisabled();
        await navTo(a, 'DECKS');
        await expect(a.getByTestId('deck-library')).toBeVisible();
        await expect(a.getByTestId('queue-bar')).toBeVisible();
      }, { timeout: 30_000 });

      let room = '';
      await test.step('Ben searches; the match-found card on both; both accept; one table, no waiting room', async () => {
        await findMatch(b, { format: '1V1', ranked: true });
        for (const p of [a, b]) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 15_000 });
        for (const p of [a, b]) await p.getByTestId('match-accept').click();
        for (const p of [a, b]) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toMatch(/^#\/t\//);
        room = await a.evaluate(() => location.hash);
        expect(await b.evaluate(() => location.hash)).toBe(room);
        for (const p of [a, b]) {
          await atTable(p, 'room');
          await expect
            .poll(async () => {
              const s = await state(p).catch(() => null);
              return s ? { stage: s.stage, matched: s.settings.matched === true } : null;
            }, { timeout: 45_000 })
            .toEqual({ stage: 'match', matched: true });
          await expect.poll(() => hands(p, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
          await expect(p.getByTestId('lobby')).toHaveCount(0);
          await expect(p.getByTestId('invite-sheet')).toHaveCount(0);
          // No waiting room was ever mounted on the way, not even before the frame found the MatchRecord.
          expect(await seenOf(p)).toContain('matched-entry');
          expect((await seenOf(p)).filter((x) => x === 'lobby' || x === 'waiting-room')).toEqual([]);
        }
        await sameHash([a, b]);
        // A matched game takes no invite (contracts.md Part G "Rejoin" item 7).
        await a.getByTestId('open-menu').click();
        await expect(a.getByRole('menuitem', { name: /invite/i })).toHaveCount(0);
        await a.keyboard.press('Escape');
      }, { timeout: 90_000 });

      await test.step('Ben concedes; the overlay shows the rating change on both pages', async () => {
        const me = await b.evaluate(() => window.__spellplane!.session!.seat());
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        await b.getByTestId('concede-ok').click();
        for (const p of [a, b]) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 20_000 });
        expect((await state(a)).result?.winners).not.toContain(me);
        await expect(a.getByTestId('game-over-rating')).toHaveText(/\+\d+/, { timeout: 15_000 });
        await expect(b.getByTestId('game-over-rating')).toHaveText(/[−-]\d+/, { timeout: 15_000 });
      }, { timeout: 45_000 });

      await test.step('FIND ANOTHER MATCH: Home, searching again with the same setup', async () => {
        await expect(a.getByTestId('game-over-primary')).toHaveText('FIND ANOTHER MATCH');
        await a.getByTestId('game-over-primary').click();
        await expect(a.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => phase(a), { timeout: 15_000 }).toMatch(/connecting|seeking/);
        await expect.poll(() => a.evaluate(() => {
          const s = window.__spellplane!.mm!.status();
          return s.phase === 'seeking' ? s.queues : null;
        }), { timeout: 15_000 }).toEqual([expect.stringMatching(/ranked/)]);
        // The game ended: the toast offers no way back in.
        await expect(a.getByTestId('toast').filter({ hasText: 'Game over. It is in your History.' })).toHaveCount(1);
      }, { timeout: 45_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('practise while you wait: the match-found card over a practice table; ACCEPT saves it and opens the match', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    const errors: string[] = [];
    for (const p of list) p.on('pageerror', (e) => errors.push(e.message));
    const phase = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.status().phase);
    try {
      for (const p of list) await p.addInitScript(ROOM_WATCH);
      let practice = '';
      await test.step('Ann plays a practice game and leaves it; both profiles have a deck', async () => {
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await soloOpponent(a, 'ALONE');
        await a.getByTestId('home-primary').click();
        await atTable(a, 'practice');
        practice = (await a.evaluate(() => location.hash)).replace(/^#\/p\//, '');
        await expect(a.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await tenActions(a);
        await leaveByArrow(a);
        await openSite(b, freshProfile(info, 'ben'));
        await seedDeck(b, 'ur-m19-60.mtga.txt');
      }, { timeout: 60_000 });

      await test.step('Ann searches, then CONTINUEs the practice game: the queue bar at the table', async () => {
        await findMatch(a, { format: '1V1', ranked: false });
        await expect.poll(() => phase(a)).toBe('seeking');
        await a.getByTestId('home-continue').click();
        await atTable(a, 'practice');
        await expect(a.getByTestId('queue-chip')).toBeVisible({ timeout: 15_000 });
        expect(await phase(a)).toBe('seeking');
      }, { timeout: 40_000 });

      await test.step('Ben searches: the match-found card over the table; both accept; the practice game is saved', async () => {
        await findMatch(b, { format: '1V1', ranked: false });
        await expect(a.getByTestId('match-found')).toBeVisible({ timeout: 15_000 });
        await expect(a.locator('[data-testid="table-frame"][data-kind="practice"]')).toBeVisible();
        for (const p of [a, b]) await p.getByTestId('match-accept').click();
        for (const p of [a, b]) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toMatch(/^#\/t\//);
        expect(await b.evaluate(() => location.hash)).toBe(await a.evaluate(() => location.hash));
        await expect.poll(async () => (await gamesOf(a)).find((g) => g.code === practice)?.leftAt ?? null, { timeout: 15_000 }).toEqual(expect.any(Number));
      }, { timeout: 90_000 });

      await test.step('the matched table mounts on both pages: one join each, seven cards each, equal hashes', async () => {
        for (const p of [a, b]) {
          await atTable(p, 'room');
          await expect
            .poll(async () => {
              const s = await state(p).catch(() => null);
              return s ? { stage: s.stage, matched: s.settings.matched === true } : null;
            }, { timeout: 45_000 })
            .toEqual({ stage: 'match', matched: true });
          await expect.poll(() => hands(p, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
          // Each page joined the room once (gate M8 R2: the leave guard's two hash changes joined it twice, and the
          // second join with the same identity stalled the first): the other page sees exactly one peer, connected.
          await expect
            .poll(() => p.evaluate(() => window.__spellplane!.net!.peers().map((x) => x.status)), { timeout: 15_000 })
            .toEqual(['connected']);
          // No waiting room was ever mounted on the way, not even before the frame found the MatchRecord.
          expect(await seenOf(p)).toContain('matched-entry');
          expect((await seenOf(p)).filter((x) => x === 'lobby' || x === 'waiting-room')).toEqual([]);
        }
        await sameHash([a, b]);
        // The search ended with the match on both pages.
        for (const p of [a, b]) expect(await phase(p)).toBe('off');
      }, { timeout: 90_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
