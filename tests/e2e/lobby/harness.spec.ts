/**
 * M8-P4 on `?harness=lobby` (PLAN Milestone 8, "M8-P4" acceptance; journey.md 4.7, 4.8, 4.9, 4.13; matchmaking.md
 * 2.12): the waiting room's seats, pill, line and summary; the 0-life chip only for that seat; a pasted bare code in
 * JOIN A GAME… answers with the whole-link message; BOOSTER DECKS ONLY gives the picker an `allow` that rejects custom
 * decks; a draft table shows boosters in the deck slot and the booster setup in the setup sheet (creator only); the
 * versus screen and its failure copy after 30 s on the page clock; the overlay by kind; the design audit and axe on the
 * waiting room, the invite sheet and the overlay. The fakes are src/ui/lobby/harness.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import type { ActionDraft } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import { seriousViolations } from '../a11y/helpers';
import { lobbyAudit } from './audit';

async function harness(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`./?faces=placeholder&harness=lobby&${query}`);
  await expect(page.getByTestId('lobby-harness')).toBeVisible();
  return errors;
}

const state = (page: Page) => page.evaluate(() => window.__lobbyHarness!.state() as TableState);
const dispatchAs = (page: Page, by: string, draft: ActionDraft) => page.evaluate(([b, d]) => window.__lobbyHarness!.dispatchAs(b as string, d as never), [by, draft] as const);
const chair = (page: Page, seat: string) => page.locator(`[data-testid="chair"][data-seat="${seat}"]`);
const closeInvite = (page: Page) => page.getByTestId('invite-sheet').getByRole('button', { name: 'Close' }).click();

test.describe('lobby harness (M8-P4)', () => {
  test('the waiting room alone: the invite sheet opens by itself, an open seat invites; audit and axe pass', async ({ page }) => {
    const errors = await harness(page, 'view=room');
    await expect(page.getByTestId('room-code')).toHaveText('AMBER FOX 93');
    await expect(page.getByTestId('invite-sheet')).toBeVisible();
    // The sheet stands beside the room and covers nothing of it: the room stays usable.
    await expect(page.getByTestId('ready')).toBeEnabled();
    expect(await lobbyAudit(page)).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);
    await closeInvite(page);
    await expect(page.getByTestId('invite-sheet')).toHaveCount(0);
    await expect(chair(page, 's1')).toHaveAttribute('data-occupied', 'false');
    await expect(page.getByTestId('start-pill')).toHaveText('WAITING · 1 OPEN SEAT');
    await expect(page.getByTestId('missing-line')).toHaveText('Waiting for one more player.');
    await expect(page.getByTestId('setup-summary')).toHaveText('PRIVATE GAME · 1V1 · ANY DECK · PASS 5 S');
    // The newest saved deck is in the slot; its name shows only in my own slot.
    await expect(page.getByTestId('slot-deck-name')).toHaveText('Gruul Stompy');
    await page.getByTestId('seat-invite').click();
    await expect(page.getByTestId('invite-sheet')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('two players: never the other deck name, only its state and after Ready its size; the pill counts down', async ({ page }) => {
    await page.clock.install();
    await harness(page, 'view=room&ben=1&auto=1');
    const ben = chair(page, 's1');
    await expect(ben).toContainText('Ben');
    await expect(ben).toContainText('CHOOSING A DECK');
    await expect(page.getByTestId('start-pill')).toHaveText('WAITING · 0 OF 2 READY');
    await dispatchAs(page, 's1', { type: 'ready', commits: Array.from({ length: 40 }, (_, i) => `h${i}`), instanceIds: Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(2, '0')}`), zone: 'library:s1' });
    await expect(ben).toContainText('DECK READY · 40');
    await expect(page.getByTestId('missing-line')).toHaveText('Choose a deck and press READY.');
    await expect(page.locator('body')).not.toContainText('M19 Booster Deck');
    await expect(page.getByTestId('start-pill')).toHaveText('WAITING · 1 OF 2 READY');
    expect(await lobbyAudit(page)).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('a pair that cannot connect is named calmly on both seats after 15 s, not before', async ({ page }) => {
    await page.clock.install();
    await harness(page, 'view=room&ben=1&apart=1&me=s1');
    // The guest's first line, for 6 s.
    await expect(page.getByTestId('invite-welcome')).toHaveText('◆ Ann invites you to a 1v1.');
    await page.clock.runFor(10_000);
    await expect(page.getByTestId('invite-welcome')).toHaveCount(0);
    await expect(chair(page, 's0')).not.toContainText('CANNOT CONNECT');
    await expect(page.getByTestId('connectivity-problem')).toHaveCount(0);
    await page.clock.runFor(7_000);
    await expect(chair(page, 's0')).toContainText('CANNOT CONNECT');
    await expect(chair(page, 's1')).toContainText('CANNOT CONNECT');
    await expect(page.getByTestId('connectivity-problem')).toContainText('You and Ann cannot connect directly. Try another network, a phone hotspot or a VPN on one side. Spellplane has no relay server');
    // The start waits for every pair: the line says so.
    expect(await lobbyAudit(page)).toEqual([]);
  });

  test('seats stay empty: START WITH 2 PLAYERS once both are ready; the empty chair stays empty', async ({ page }) => {
    await harness(page, 'view=room&format=ffa3&ben=1&annReady=1&benReady=1');
    await expect(page.getByTestId('start-pill')).toHaveCount(0);
    await expect(page.getByTestId('start-short')).toHaveText('START WITH 2 PLAYERS');
    await expect(page.getByTestId('missing-line')).toHaveText('Waiting for one more player.');
    await page.getByTestId('start-short').click();
    await expect.poll(async () => (await state(page)).stage).toBe('match');
  });

  test('a guest tapping READY ✓ is told the deck stays locked; the creator un-readying holds the start', async ({ page }) => {
    await harness(page, 'view=room&ben=1&annReady=1&benReady=1&me=s1');
    await page.getByTestId('ready-on').click();
    await expect(page.getByTestId('lobby-note')).toHaveText('Your deck stays locked to your seat. Ask Ann to wait if you need a moment.');
    await harness(page, 'view=room&ben=1&annReady=1&benReady=1&auto=1');
    await expect(page.getByTestId('start-game')).toHaveText(/^START · [123]$/);
    await page.getByTestId('ready-on').click();
    await expect(page.getByTestId('start-game')).toHaveCount(0);
    await expect(page.getByTestId('start-pill')).toHaveText('WAITING · 1 OF 2 READY');
    await page.getByTestId('ready-on').click();
    await expect(page.getByTestId('start-game')).toHaveText(/^START · [123]$/);
  });

  test('at phone width the room is one column with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await harness(page, 'view=room&ben=1&format=ffa4');
    await expect(page.getByTestId('invite-sheet')).toBeVisible();
    const overflow = await page.getByTestId('lobby-harness').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('ready')).toBeVisible();
  });

  test('BOOSTER DECKS ONLY: the picker gets an allow that rejects custom decks with the reason', async ({ page }) => {
    await harness(page, 'view=room&rule=booster');
    await closeInvite(page);
    await expect(page.getByTestId('setup-summary')).toContainText('BOOSTER DECKS ONLY');
    // The selected custom deck may not be used here: the slot says why and READY stays off.
    await expect(page.getByTestId('slot-reason')).toHaveText('This table plays booster decks only.');
    await expect(page.getByTestId('ready')).toBeDisabled();
    await page.getByTestId('change-deck').click();
    const custom = page.locator('[data-testid="picker-deck"][data-deck="deck-gruul"]');
    const sealed = page.locator('[data-testid="picker-deck"][data-deck="deck-m19"]');
    await expect(custom).toHaveAttribute('data-allowed', 'false');
    await expect(custom.getByTestId('picker-reason')).toHaveText('This table plays booster decks only.');
    await expect(sealed).toHaveAttribute('data-allowed', 'true');
    await sealed.click();
    await expect(page.getByTestId('deck-picker')).toHaveCount(0);
    await expect(page.getByTestId('slot-deck-name')).toHaveText('M19 Booster Deck');
    await expect(page.getByTestId('ready')).toBeEnabled();
    // The creator turns the rule back to any deck in the setup sheet; the custom deck is allowed again.
    await page.getByTestId('setup-edit').click();
    await page.getByTestId('setup-decks').locator('[data-value="any"]').click();
    await expect(page.getByTestId('setup-summary')).toContainText('ANY DECK');
    await page.getByTestId('setup-sheet').getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('change-deck').click();
    await expect(custom).toHaveAttribute('data-allowed', 'true');
  });

  test('a draft table: boosters in the deck slot, the booster setup in the setup sheet, creator only', async ({ page }) => {
    await harness(page, 'view=room&draft=1&ben=1');
    await expect(page.getByTestId('deck-slot')).toHaveAttribute('data-kind', 'boosters');
    await expect(page.getByTestId('slot-boosters')).toBeVisible();
    await expect(page.getByTestId('setup-summary')).toHaveText('DRAFT NIGHT · 1V1 · LIVE DRAFT · PASS 5 S');
    await expect(page.getByTestId('ready')).toHaveCount(0);
    await expect(page.getByTestId('change-deck')).toHaveCount(0);
    await page.getByTestId('setup-edit').click();
    await expect(page.getByTestId('setup-boosters')).toBeVisible();
    expect(await lobbyAudit(page)).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('setup-boosters-edit').click();
    await expect(page.getByTestId('booster-setup')).toHaveAttribute('data-mode', 'draft');
    await page.getByTestId('booster-setup-two').click();
    await expect.poll(async () => (await state(page)).lobby?.draft).toEqual({ format: 'pass', packs: 2, picks: 1 });
    await expect(page.getByTestId('slot-boosters')).toHaveAttribute('data-count', '2');

    await harness(page, 'view=room&draft=1&ben=1&me=s1');
    await expect(page.getByTestId('slot-boosters')).toBeVisible();
    await expect(page.getByTestId('setup-edit')).toHaveCount(0);
    await expect(page.getByTestId('setup-owner')).toHaveText('Ann chooses the setup.');
  });

  test('the invite sheet: QR on a white plate, the link, COPY LINK writes it and reads COPIED ✓ for 2 s', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.__copied.push(t) } });
    });
    await page.clock.install();
    await harness(page, 'view=invite');
    const plate = page.getByTestId('qr-plate');
    await expect(plate).toBeVisible();
    expect(await plate.locator('rect').first().evaluate((r) => getComputedStyle(r).fill)).toBe('rgb(255, 255, 255)');
    await expect(page.getByTestId('invite-code')).toContainText('AMBER FOX 93');
    const link = await page.getByTestId('share-link').inputValue();
    expect(link).toMatch(/#\/t\/amber-fox-93\/A{22}$/);
    await page.getByTestId('copy-link').click();
    await expect(page.getByTestId('copy-link')).toHaveText('COPIED ✓');
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([link]);
    await page.clock.runFor(1900);
    await expect(page.getByTestId('copy-link')).toHaveText('COPIED ✓');
    await page.clock.runFor(200);
    await expect(page.getByTestId('copy-link')).toHaveText('COPY LINK');
    expect(await lobbyAudit(page)).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('join: a bare code asks for the whole link; a link inside a sentence navigates', async ({ page }) => {
    await harness(page, 'view=join');
    for (const code of ['amber fox 93', 'AMBER-FOX-93']) {
      await page.getByTestId('join-field').fill(code);
      await page.getByTestId('join-go').click();
      await expect(page.getByTestId('join-problem')).toHaveText('Paste the whole link: the code alone does not carry the key.');
    }
    await page.getByTestId('join-field').fill('hello');
    await page.getByTestId('join-go').click();
    await expect(page.getByTestId('join-problem')).toHaveText('This is not a complete table link. Ask for it again.');
    await page.getByTestId('join-field').fill('Come play: https://example.test/x/#/t/amber-fox-93/AAAAAAAAAAAAAAAAAAAAAA. See you');
    await page.getByTestId('join-field').press('Enter');
    expect(await page.evaluate(() => window.__lobbyHarness!.joined)).toBe('#/t/amber-fox-93/AAAAAAAAAAAAAAAAAAAAAA');
    expect(await lobbyAudit(page)).toEqual([]);
  });

  test('the 0-life chip is offered only to that seat; CONCEDE ends the game, NOT YET waits for a change', async ({ page }) => {
    await harness(page, 'view=chip&low=1&me=s1');
    await expect(page.getByTestId('concede-chip')).toContainText('You are at 0 life.');
    await page.getByTestId('concede-not-yet').click();
    await expect(page.getByTestId('concede-chip')).toHaveCount(0);
    // A further change of the life total offers it again.
    await dispatchAs(page, 's1', { type: 'life', seat: 's1', delta: -1 });
    await expect(page.getByTestId('concede-chip')).toContainText('You are at -1 life.');
    await page.getByTestId('concede-yes').click();
    await expect.poll(async () => (await state(page)).result?.winners).toEqual(['s0']);
    await expect(page.getByTestId('concede-chip')).toHaveCount(0);
    // The other seat is never prompted.
    await harness(page, 'view=chip&low=1&me=s0');
    await expect(page.getByTestId('concede-chip')).toHaveCount(0);
    await harness(page, 'view=chip&poison=1&me=s1');
    await expect(page.getByTestId('concede-chip')).toContainText('poison');
  });

  test('the overlay: headline, reason, primary by kind, the rating; LOOK AT THE TABLE and RESULT; audit and axe', async ({ page }) => {
    await harness(page, 'view=over&me=s0');
    await expect(page.getByTestId('game-over-headline')).toHaveText('VICTORY');
    await expect(page.getByTestId('game-over-reason')).toHaveText('Ben conceded on turn 9.');
    await expect(page.getByTestId('game-over-primary')).toHaveText('REMATCH');
    await expect(page.getByTestId('game-over-rating')).toHaveCount(0);
    // A flat scrim: nothing blurred or filtered.
    expect(await lobbyAudit(page)).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('game-over-primary').click();
    expect(await page.evaluate(() => window.__lobbyHarness!.proposals)).toEqual(['nextGame']);
    await page.getByTestId('game-over-look').click();
    await expect(page.getByTestId('game-over')).toHaveCount(0);
    await page.getByTestId('result-chip').click();
    await expect(page.getByTestId('game-over')).toBeVisible();
    await page.getByTestId('game-over-home').click();
    expect(await page.evaluate(() => window.__lobbyHarness!.homeCalls)).toBe(1);

    await harness(page, 'view=over&me=s1&kind=matched&rated=1');
    await expect(page.getByTestId('game-over-headline')).toHaveText('DEFEAT');
    await expect(page.getByTestId('game-over-reason')).toHaveText('You conceded on turn 9.');
    await expect(page.getByTestId('game-over-primary')).toHaveText('FIND ANOTHER MATCH');
    await expect(page.getByTestId('game-over-rating')).toContainText('RANK 1512');
    await harness(page, 'view=over&me=s0&kind=draft');
    await expect(page.getByTestId('game-over-primary')).toHaveText('NEXT GAME');
    await harness(page, 'view=over&me=spec');
    await expect(page.getByTestId('game-over-headline')).toHaveText('GAME OVER');
    await expect(page.getByTestId('game-over-primary')).toHaveCount(0);
  });

  test('a rematch proposed by the other player is answered on the overlay', async ({ page }) => {
    await harness(page, 'view=over&me=s0');
    await dispatchAs(page, 's1', { type: 'ask', round: 'r-next', label: 'Next game?' });
    expect((await state(page)).confirm?.id).toBe('r-next');
    await expect(page.getByTestId('rematch-ask')).toHaveText('Ben proposes a rematch.');
    await page.getByTestId('rematch-accept').click();
    await expect.poll(async () => (await state(page)).confirm?.responses['s0']).toBe('ok');
  });

  test('versus: one column per player, never a deck name; the failure copy after 30 s', async ({ page }) => {
    await page.clock.install();
    await harness(page, 'view=versus&auto=1&apart=1');
    await expect(page.getByTestId('versus-col')).toHaveCount(2);
    await expect(page.locator('[data-testid="versus-col"][data-seat="s0"]')).toContainText('DECK · 60');
    await expect(page.locator('[data-testid="versus-col"][data-seat="s1"]')).toContainText('DECK · 40');
    await expect(page.locator('[data-testid="versus-col"][data-seat="s1"] [data-testid="versus-connected"]')).toHaveAttribute('data-on', 'false');
    await expect(page.getByTestId('versus')).not.toContainText('Gruul');
    await page.clock.runFor(29_000);
    await expect(page.getByTestId('versus-failure')).toHaveCount(0);
    await page.clock.runFor(1_500);
    await expect(page.getByTestId('versus-failure')).toHaveText('Ben could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.');
    await page.getByTestId('versus-look').click();
    await expect(page.getByTestId('versus')).toHaveCount(0);
  });
});
