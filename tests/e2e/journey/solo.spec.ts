/**
 * M8-P8 journey: solo play (docs/PLAN.md Milestone 8, acceptance "M8-P8", solo.spec.ts; journey.md 4.10 "Leaving",
 * 4.13; computer.md; contracts.md Part G "Computer opponent" and "Journey and Home"). Home's `PLAY` in
 * `SOLO · SPARRING` and in `SOLO · ALONE`; the HUD's primary shows the combat cue; the back arrow leads Home without
 * a dialog, the toast reads `Game saved. Continue any time.`, the `CONTINUE` strip names the game, continuing restores
 * the same state hash and Sparring goes on; the browser's Back does the same; `Sparring concedes` shows the overlay.
 *
 * Sparring's pace runs on the debug hook's manual clock (`bot.setClock('manual')`, `bot.tick`), never slept through.
 */
import { expect, test, type Page } from '@playwright/test';
import { atTable, homeIsClean, keydowns, leaveByArrow, openFreshHome, seedDeck, soloOpponent, state, tableHash, tenActions } from '../helpers/journey';

const SAVED = 'Game saved. Continue any time.';

/** A creature in the own hand (from the injected fixture cards), drawing until one is there. */
async function creatureInHand(page: Page): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const id = await page.evaluate(() => {
      const sec = window.__spellplane!.secrets!();
      const cards = window.__spellplaneFixtures!.cards;
      for (const id of sec.hand) {
        const c = cards.find((x) => x.id === sec.identities[id]?.card.sid);
        if (c && /Creature/.test(c.type_line) && /^\d+$/.test(c.power ?? '')) return id;
      }
      return null;
    });
    if (id) return id;
    await page.evaluate(() => window.__spellplane!.session!.draw(1));
  }
  throw new Error('no creature in the deck');
}

/** Open a Sparring table from Home on the manual bot clock with seven cards dealt. */
async function sparringFromHome(page: Page): Promise<string> {
  await soloOpponent(page, 'SPARRING');
  await expect(page.getByTestId('home-primary')).toHaveText(/PLAY/);
  await page.getByTestId('home-primary').click();
  await atTable(page, 'computer', 45_000);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
  await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
  await expect.poll(() => page.evaluate(() => window.__spellplane!.secrets!().hand.length), { timeout: 30_000 }).toBe(7);
  return (await page.evaluate(() => location.hash)).replace(/^#\/c\//, '');
}

/** Sparring takes at least one step once the turn is its. */
async function sparringGoesOn(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active()), { timeout: 15_000 }).toBe(true);
  const before = await page.evaluate(() => window.__spellplane!.bot!.steps());
  if ((await state(page)).turn.active === 's0') await page.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__spellplane!.bot!.tick(5_000));
      return page.evaluate(() => window.__spellplane!.bot!.steps());
    }, { timeout: 20_000 })
    .toBeGreaterThan(before);
}

test.describe('journey: solo', () => {
  test('SOLO · SPARRING: the cue on the primary, leave by the arrow, CONTINUE, Back, Sparring concedes', async ({ page }, info) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openFreshHome(page, info, 'sparring');
    await seedDeck(page);
    let room = '';
    let hash = '';

    await test.step('PLAY opens Sparring; marking an attacker puts ATTACK on the HUD primary', async () => {
      room = await sparringFromHome(page);
      await page.evaluate(() => window.__spellplane!.input!.reset());
      const primary = page.getByTestId('primary-action');
      await expect(primary).toBeVisible();
      await expect(primary).not.toHaveText(/attack/i);
      const id = await creatureInHand(page);
      await page.evaluate((c) => window.__spellplane!.dispatch!({ type: 'move', card: c, to: 'battlefield:s0', pose: { x: -60, y: -300, rot: 0 } } as never), id);
      await page.evaluate((c) => window.__spellplane!.dispatch!({ type: 'moveTemp', card: c, pose: { x: -60, y: -150, rot: 0 }, combat: 'attack', tap: true } as never), id);
      await expect(primary).toHaveText(/attack/i);
      await expect(page.getByTestId('frame-bar')).toHaveCount(0);
      // Counted and brought home again by the cue; the attack is taken back so the game stays where it was.
      await primary.click();
      await expect(primary).not.toHaveText(/^\s*attack\s*$/i, { timeout: 10_000 });
      await tenActions(page);
      expect(await keydowns(page)).toBe(0);
    }, { timeout: 90_000 });

    await test.step('the back arrow: Home without a dialog, the toast, the CONTINUE strip names the game', async () => {
      hash = await tableHash(page);
      await leaveByArrow(page);
      await expect(page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible')).toHaveCount(0);
      await expect(page.getByTestId('toast').filter({ hasText: SAVED })).toHaveCount(1);
      await expect(page.getByTestId('home-continue')).toBeVisible();
      await expect(page.getByTestId('home-continue-game')).toContainText(/sparring/i);
      await expect(page.getByTestId('home-primary')).toHaveText(/PLAY/);
      await homeIsClean(page);
    }, { timeout: 30_000 });

    await test.step('CONTINUE restores the same state hash and Sparring goes on', async () => {
      await page.getByTestId('home-continue').click();
      await atTable(page, 'computer');
      await expect(page).toHaveURL(new RegExp(`#/c/${room}$`));
      await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.hash() ?? ''), { timeout: 20_000 }).toBe(hash);
      await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
      await sparringGoesOn(page);
    }, { timeout: 45_000 });

    await test.step("the browser's Back leaves the same way", async () => {
      hash = await tableHash(page);
      await page.goBack();
      await expect(page.getByTestId('route-home')).toBeVisible();
      await expect(page.getByTestId('toast').filter({ hasText: SAVED })).toHaveCount(1);
      await expect(page.getByTestId('home-continue')).toBeVisible();
      await homeIsClean(page);
      await page.getByTestId('home-continue').click();
      await atTable(page, 'computer');
      await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.hash() ?? ''), { timeout: 20_000 }).toBe(hash);
    }, { timeout: 45_000 });

    await test.step('Sparring concedes: the overlay', async () => {
      await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
      await page.locator('[data-testid="avatar"][data-seat="s1"]').getByTestId('plate-more').click();
      await page.getByTestId('sparring-sparringConcedes').click();
      await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('game-over-headline')).toHaveText(/victory/i);
      expect((await state(page)).result?.winners).toEqual(['s0']);
      await page.getByTestId('game-over-home').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      await homeIsClean(page);
    }, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('SOLO · ALONE: a practice table with seven cards; leave, CONTINUE, the same hash', async ({ page }, info) => {
    test.setTimeout(90_000);
    await openFreshHome(page, info, 'alone');
    await seedDeck(page);
    let hash = '';
    let room = '';
    await test.step('PLAY opens a practice table with the deck dealt', async () => {
      await soloOpponent(page, 'ALONE');
      await page.getByTestId('home-primary').click();
      await atTable(page, 'practice');
      room = (await page.evaluate(() => location.hash)).replace(/^#\/p\//, '');
      await expect.poll(() => page.evaluate(() => window.__spellplane?.secrets?.().hand.length ?? 0), { timeout: 20_000 }).toBe(7);
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.getByTestId('primary-action')).toBeVisible();
      await tenActions(page);
    }, { timeout: 45_000 });
    await test.step('leave by the arrow; CONTINUE; the same state hash', async () => {
      hash = await tableHash(page);
      await leaveByArrow(page);
      await expect(page.getByTestId('toast').filter({ hasText: SAVED })).toHaveCount(1);
      await homeIsClean(page);
      await page.getByTestId('home-continue').click();
      await atTable(page, 'practice');
      await expect(page).toHaveURL(new RegExp(`#/p/${room}$`));
      await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.hash() ?? ''), { timeout: 20_000 }).toBe(hash);
    }, { timeout: 45_000 });
  });

  test('a solo game left after fewer than ten own actions is not kept and shows no toast', async ({ page }, info) => {
    await openFreshHome(page, info, 'short');
    await seedDeck(page);
    await soloOpponent(page, 'ALONE');
    await page.getByTestId('home-primary').click();
    await atTable(page, 'practice');
    await expect(page.getByTestId('primary-action')).toBeVisible();
    await leaveByArrow(page);
    await expect(page.getByTestId('toast').filter({ hasText: SAVED })).toHaveCount(0);
    await expect(page.getByTestId('home-continue')).toHaveCount(0);
    await homeIsClean(page);
  });
});
