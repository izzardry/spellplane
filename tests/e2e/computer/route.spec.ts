/**
 * M8-P6: the computer route in the app (`#/c/<room>`, contracts.md Part C), opened the way Home's `PLAY` with
 * `SOLO · SPARRING` leads to it: with no selected deck the route deals a starter deck against Sparring; Leave goes
 * Home with the solo toast and releases both sessions, the bot and the in-page network; `Continue` resumes the same
 * table. Fixture cards, placeholder faces, no network; Sparring's pace on the debug hook's manual clock.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../helpers/app';
import { fixturesScript } from '../offline/helpers';

const memory = (page: Page) => page.evaluate(() => (window.__spellplane?.render?.memory?.() ?? null) as Record<string, number> | null);
const botView = (page: Page) =>
  page.evaluate(() => {
    const v = window.__spellplane!.bot!.view();
    return v ? { hand: v.hand.length, oppHand: v.oppHand, library: v.library, oppLibrary: v.oppLibrary, turn: v.turn.number, active: v.turn.active, ids: v.hand.map((c) => c.id).sort() } : null;
  });

test('the app opens #/c/<room> against Sparring, leaves Home and continues the same table', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript({ content: fixturesScript() });
  const room = `c-route-${test.info().project.name}-${Date.now()}`;
  await openApp(page, { profile: room, hash: `/c/${room}` });
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
  await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));

  let before: Awaited<ReturnType<typeof botView>> = null;
  await test.step('a starter deck against Sparring, seven cards each', async () => {
    await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer');
    await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
    await expect.poll(() => botView(page)).toMatchObject({ hand: 7, oppHand: 7, library: 33, oppLibrary: 33 });
    await expect(page.getByTestId('computer-badge').first()).toHaveText('COMPUTER');
    await expect.poll(async () => (await memory(page))?.botRunners).toBe(1);
    before = await botView(page);
  });

  await test.step('Leave goes Home with the solo toast and releases the game', async () => {
    await page.locator('[data-testid="frame-leave"], [data-testid="leave"]').first().click();
    await expect(page.getByTestId('route-home')).toBeVisible();
    await expect(page.getByTestId('toast').first()).toContainText('Game saved. Continue any time.');
    await expect
      .poll(async () => {
        const m = await memory(page);
        return m ? { botRunners: m.botRunners, sessions: m.sessions, engines: m.engines, transports: m.transports, timers: m.timers } : null;
      })
      .toEqual({ botRunners: 0, sessions: 0, engines: 0, transports: 0, timers: 0 });
    expect(await page.evaluate(() => window.__spellplane!.bot!.active())).toBe(false);
  });

  await test.step('Continue resumes the same table', async () => {
    await page.getByTestId('toast').first().getByRole('button', { name: /continue/i }).click();
    await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer');
    await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
    await expect.poll(() => botView(page)).toEqual(before);
  });
  expect(errors).toEqual([]);
});
