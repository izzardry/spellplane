/**
 * The private game path end to end on two local pages (PLAN Milestone 8, "M8-P4" acceptance; journey.md 4.7, 4.8,
 * 4.13; matchmaking.md 2.12). The room link is built by the spec (not through Home); the launcher's part, a table with
 * automatic setup, is set through the debug hook. The clipboard is never read: an init script replaces
 * navigator.clipboard.writeText and the spec asserts the stub. Product timers (COPIED for 2 s, START · 3) run on
 * page.clock; hands, first player and the result are read through the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname, twoPages } from './helpers';

const STUB = () => {
  const w = window as unknown as { __copied: string[] };
  w.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.__copied.push(t) } });
  // Whether the versus screen was ever on this page (it may be up for a moment only).
  const seen = window as unknown as { __versus?: string[] };
  seen.__versus = [];
  new MutationObserver(() => {
    const v = document.querySelector('[data-testid="versus"]');
    if (v && seen.__versus!.length === 0) seen.__versus!.push(v.textContent ?? '');
  }).observe(document, { subtree: true, childList: true });
};

const state = (p: Page) => hook<TableState>(p, 'state');
function countOf(s: TableState, zone: string): number {
  const z = s.zones[zone];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : (z.count ?? z.ids.length);
}
const handOf = (s: TableState, seat: string) => countOf(s, `hand:${seat}`);
const libraryOf = (s: TableState, seat: string) => countOf(s, `library:${seat}`);
const dispatch = (p: Page, action: unknown) => p.evaluate((a) => (window.__spellplane as unknown as { dispatch(a: unknown): void }).dispatch(a), action);

async function ready(p: Page, file: string): Promise<void> {
  await p.getByTestId('lobby-deck-text').fill(decklist(file));
  await p.getByTestId('lobby-deck-check').click();
  await expect(p.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await p.getByTestId('ready').click();
  await expect(p.getByTestId('ready-done')).toContainText('60 cards is committed', { timeout: 15_000 });
}

/** Both pages hold 7 cards in each hand and 53 in each library, dealt once for the current game, on one first player. */
async function dealtOnce(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        // A page that was just reloaded registers its state hook only once its table is open (the muster may hold it
        // for a moment): until then it counts as not dealt yet, and the poll asks again.
        const [sa, sb] = [await state(a).catch(() => null), await state(b).catch(() => null)];
        if (!sa || !sb) return null;
        const g = sa.games ?? 0;
        return [handOf(sa, 's0'), handOf(sa, 's1'), libraryOf(sa, 's0'), libraryOf(sa, 's1'), sa.seats.s0?.dealt === g, sa.seats.s1?.dealt === g, sa.turn.active === sb.turn.active, sa.seq === sb.seq];
      },
      { timeout: 30_000 },
    )
    .toEqual([7, 7, 53, 53, true, true, true, true]);
}

test('private table: invite, seats, ready, START · 3, versus, seven cards each, concede, overlay, rematch', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const { context, a, b } = await twoPages(browser);
  await context.addInitScript(STUB);
  await a.clock.install();
  const room = freshRoom();

  await test.step('the creator sees the waiting room with the invite sheet; COPY LINK writes the room link', async () => {
    await openTable(a, room, freshProfile(info, 'a'));
    await setNickname(a, 'Ann');
    await expect(a.getByTestId('invite-sheet')).toBeVisible();
    const link = await a.getByTestId('share-link').inputValue();
    expect(link).toMatch(new RegExp(`#/t/${room.roomId}/${room.roomKey}$`));
    expect(link).not.toContain('profile=');
    await expect(a.getByTestId('qr-plate')).toBeVisible();
    // The kit's QrPlate (M8-P1): black modules on a white plate in every look.
    expect(await a.getByTestId('qr-plate').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await a.getByTestId('qr-plate').locator('svg path').first().getAttribute('fill')).toBe('#000');
    await a.getByTestId('copy-link').click();
    await expect(a.getByTestId('copy-link')).toHaveText('COPIED ✓');
    expect(await a.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([link]);
    await a.clock.runFor(2100);
    await expect(a.getByTestId('copy-link')).toHaveText('COPY LINK');
    await expect(a.getByTestId('start-pill')).toHaveText('WAITING · 1 OPEN SEAT');
    // The launcher's part (Home's CREATE GAME): a table with automatic setup.
    await dispatch(a, { type: 'settings', settings: { autoSetup: true } });
  });

  await test.step('B opens the link and is seated; the pill counts readiness; neither sees the other deck name', async () => {
    await openTable(b, room, freshProfile(info, 'b'));
    await setNickname(b, 'Ben');
    await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true', { timeout: 15_000 });
    await expect(chair(a, 's1')).toContainText('Ben');
    await expect(b.getByTestId('invite-sheet')).toHaveCount(0);
    await expect(a.getByTestId('start-pill')).toHaveText('WAITING · 0 OF 2 READY');
    await ready(a, 'gw-m19-60.txt');
    await expect(a.getByTestId('start-pill')).toHaveText('WAITING · 1 OF 2 READY');
    await expect(b.getByTestId('missing-line')).toHaveText('Choose a deck and press READY.');
    await expect(chair(b, 's0')).toContainText('DECK READY · 60');
    // The creator takes READY back before Ben is ready, so the count cannot start (and race the spec) while it looks.
    await a.getByTestId('ready-on').click();
    await expect(a.getByTestId('start-pill')).toHaveText('WAITING · 0 OF 2 READY');
    await ready(b, 'ur-m19-60.mtga.txt');
    await expect(chair(a, 's1')).toContainText('DECK READY · 60');
    // Deck names stay with their owner: each pasted list was saved as "Deck with …" in its own library only, and
    // each page shows its own name only in its own slot.
    await expect(a.getByTestId('slot-deck-name')).toHaveText('Pasted list');
    for (const p of [a, b]) {
      const seats = p.locator('section[aria-label="Seats"]');
      await expect(seats).not.toContainText('Pasted list');
      await expect(seats).not.toContainText('Deck with');
    }
    expect(JSON.stringify(await state(b))).not.toContain('Deck with');
    expect(JSON.stringify(await state(a))).not.toContain('Deck with');
  });

  await test.step('un-ready holds START; READY again counts START · 3 and it presses itself when the clock runs 3 s', async () => {
    await expect(a.getByTestId('start-pill')).toHaveText('WAITING · 1 OF 2 READY');
    await expect(a.getByTestId('start-game')).toHaveCount(0);
    await a.clock.runFor(5000);
    expect((await state(a)).stage).toBe('lobby');
    await expect(b.getByTestId('missing-line')).toHaveText('Waiting for Ann to start the game.');
    // Stop the page clock where it is, so only runFor moves the count (a slow remote browser adds no time).
    await a.clock.pauseAt((await a.evaluate(() => Date.now())) + 50);
    await a.getByTestId('ready-on').click();
    await expect(a.getByTestId('start-game')).toHaveText('START · 3');
    // Un-readying while the count runs stops it: the clock runs on and nothing starts.
    await a.clock.runFor(1000);
    await expect(a.getByTestId('start-game')).toHaveText('START · 2');
    await a.getByTestId('ready-on').click();
    await expect(a.getByTestId('start-game')).toHaveCount(0);
    await a.clock.runFor(5000);
    expect((await state(a)).stage).toBe('lobby');
    await a.getByTestId('ready-on').click();
    await expect(a.getByTestId('start-game')).toHaveText('START · 3');
    await a.clock.runFor(3100);
    // The page clock runs on its own again: the setup and the versus screen's timers follow real time from here.
    await a.clock.resume();
    await expect(b.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 15_000 });
  });

  await test.step('versus, then seven cards each and the same first player; a reload during versus deals once', async () => {
    // B's versus screen is up (it stays at least 1.2 s): reload B during it, before anything else is read.
    await expect(b.getByTestId('versus')).toBeVisible();
    await b.reload();
    await expect(a.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 15_000 });
    // The versus screen came up on the creator's page, with both players and no deck name.
    await expect.poll(() => a.evaluate(() => (window as unknown as { __versus: string[] }).__versus.length)).toBe(1);
    const versus = await a.evaluate(() => (window as unknown as { __versus: string[] }).__versus[0]!);
    expect(versus).toContain('Ann');
    expect(versus).toContain('Ben');
    expect(versus).not.toContain('Deck with');
    await dealtOnce(a, b);
    for (const p of [a, b]) await expect(p.getByTestId('versus')).toHaveCount(0, { timeout: 15_000 });
    // Nothing deals again: one more reload leaves the hands as they are.
    await b.reload();
    await expect(b.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 15_000 });
    await dealtOnce(a, b);
    const after = await state(b);
    expect([handOf(after, 's1'), libraryOf(after, 's1'), handOf(after, 's0')]).toEqual([7, 53, 7]);
  });

  await test.step('concede: both see the overlay; LOOK AT THE TABLE hides it and RESULT brings it back', async () => {
    await dispatch(b, { type: 'concede' });
    await expect(a.getByTestId('game-over-headline')).toHaveText('VICTORY', { timeout: 15_000 });
    await expect(b.getByTestId('game-over-headline')).toHaveText('DEFEAT', { timeout: 15_000 });
    await expect(a.getByTestId('game-over-reason')).toHaveText(/^Ben conceded on turn \d+\.$/);
    await expect(b.getByTestId('game-over-reason')).toHaveText(/^You conceded on turn \d+\.$/);
    await a.getByTestId('game-over-look').click();
    await expect(a.getByTestId('game-over')).toHaveCount(0);
    await a.getByTestId('result-chip').click();
    await expect(a.getByTestId('game-over')).toBeVisible();
  });

  await test.step('REMATCH accepted by both leads to a new game with seven cards each', async () => {
    await expect(a.getByTestId('game-over-primary')).toHaveText('REMATCH');
    await a.getByTestId('game-over-primary').click();
    await expect(b.getByTestId('rematch-ask')).toHaveText('Ann proposes a rematch.', { timeout: 15_000 });
    await b.getByTestId('rematch-accept').click();
    // The existing next-game proposal: back to the builder, where each keeps (or sideboards) the deck and is Ready.
    for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'build', { timeout: 30_000 });
    for (const p of [a, b]) await p.getByTestId('builder-ready').click({ timeout: 15_000 });
    for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 30_000 });
    await dealtOnce(a, b);
    expect((await state(a)).result).toBeUndefined();
    for (const p of [a, b]) await expect(p.getByTestId('game-over')).toHaveCount(0);
  });
  await context.close();
});
