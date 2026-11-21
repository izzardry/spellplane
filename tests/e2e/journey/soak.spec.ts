/**
 * M8-P8 journey: the page-wide soak (docs/PLAN.md Milestone 8, acceptance "M8-P8", soak.spec.ts; contracts.md Part C
 * "Lifecycle counters"; owner: "make sure to not mess up the system with memory leaks"). Ten enter-and-leave cycles
 * each on a practice table, a computer table and a local networked table, all through Home: after every return Home
 * shows every count of `live()` at 0 and `residue()` all zeros (geometries, textures, programs). Fixtures, the local
 * transport, placeholder faces.
 */
import { expect, test, type Page } from '@playwright/test';
import { atTable, dispatch, decklist, homeIsClean, leaveByArrow, mode, openFreshHome, residue, seedDeck, soloOpponent, state } from '../helpers/journey';

const CYCLES = 10;

/** The disposals counter after a cycle (each table visit disposes at least one renderer). */
const disposals = async (p: Page): Promise<number> => (await residue(p))?.disposals ?? 0;

test.describe('journey: soak', () => {
  test('ten practice tables entered and left: every count 0 on Home', async ({ page }, info) => {
    test.setTimeout(180_000);
    await openFreshHome(page, info, 'soak-p');
    await seedDeck(page);
    await soloOpponent(page, 'ALONE');
    for (let i = 0; i < CYCLES; i++) {
      await test.step(`cycle ${i + 1}`, async () => {
        await page.getByTestId('home-primary').click();
        await atTable(page, 'practice');
        await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => (await residue(page))?.contexts ?? 0, { timeout: 15_000 }).toBe(1);
        await leaveByArrow(page);
        await homeIsClean(page);
      }, { timeout: 30_000 });
    }
    expect(await disposals(page)).toBeGreaterThanOrEqual(CYCLES);
  });

  test('ten computer tables entered and left: every count 0 on Home', async ({ page }, info) => {
    test.setTimeout(180_000);
    await openFreshHome(page, info, 'soak-c');
    await seedDeck(page);
    await soloOpponent(page, 'SPARRING');
    for (let i = 0; i < CYCLES; i++) {
      await test.step(`cycle ${i + 1}`, async () => {
        await page.getByTestId('home-primary').click();
        await atTable(page, 'computer');
        await expect.poll(() => page.evaluate(() => window.__spellplane?.bot?.active?.() ?? false), { timeout: 20_000 }).toBe(true);
        await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => (await residue(page))?.botRunners ?? 0, { timeout: 15_000 }).toBe(1);
        await leaveByArrow(page);
        await homeIsClean(page);
      }, { timeout: 30_000 });
    }
    expect(await disposals(page)).toBeGreaterThanOrEqual(CYCLES);
  });

  test('a local networked table entered and left ten times: every count 0 on Home', async ({ page }, info) => {
    test.setTimeout(180_000);
    await openFreshHome(page, info, 'soak-n');
    await seedDeck(page);
    await test.step('CREATE TABLE; the table is set to play', async () => {
      await mode(page, 'private');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
      await page.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist('gw-m19-60.txt'));
      await dispatch(page, { type: 'stageSet', stage: 'match' });
      await expect.poll(async () => (await state(page)).stage, { timeout: 15_000 }).toBe('match');
      await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      // Ten own moves so the game is worth keeping in History either way.
      for (let i = 0; i < 10; i++) await dispatch(page, { type: 'life', seat: 's0', delta: i % 2 ? 1 : -1 });
    }, { timeout: 45_000 });
    for (let i = 0; i < CYCLES; i++) {
      await test.step(`cycle ${i + 1}`, async () => {
        await leaveByArrow(page);
        await homeIsClean(page);
        await page.getByTestId('home-continue').click();
        await atTable(page, 'room');
        await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => (await residue(page))?.transports ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
      }, { timeout: 40_000 });
    }
    await leaveByArrow(page);
    await homeIsClean(page);
    expect(await disposals(page)).toBeGreaterThanOrEqual(CYCLES);
  });
});
