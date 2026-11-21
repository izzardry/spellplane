/**
 * M8-P8 journey: the design audit and axe across the journey (docs/PLAN.md Milestone 8, acceptance "M8-P8",
 * audit.spec.ts; visual.md DS-4; PLAN M5-P4's axe rule: no serious or critical violation). `designAudit` (four control
 * heights, one primary per layer, no blur, the look's fonts) and axe on Home, Decks, the deck page, History, the
 * waiting room, Gathering, the table HUD, an open context menu, the pile viewer, the build stage and the recovery
 * panel, each reached through the real app. Fixtures, the local transport, placeholder faces.
 */
import { expect, test, type Page } from '@playwright/test';
import { seriousViolations, sealedBuilder, twoInLobby } from '../a11y/helpers';
import { openZone } from '../helpers/hud';
import { designAudit } from '../helpers/design-audit';
import { atTable, decklist, dispatch, freshProfile, mode, navTo, openFreshHome, openSite, pages, sameHash, seedDeck, soloOpponent, state } from '../helpers/journey';

async function check(page: Page, where: string, scope?: string): Promise<void> {
  await page.mouse.move(2, 2);
  await designAudit(page);
  expect(await seriousViolations(page, scope), where).toEqual([]);
}

test.describe('journey: design audit and axe', () => {
  test('Home, Decks, the deck page, History, the waiting room', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openFreshHome(page, info, 'audit-shell');
    await test.step('Home', () => check(page, 'Home'), { timeout: 30_000 });
    await test.step('Decks and the deck page', async () => {
      await seedDeck(page);
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await check(page, 'Decks');
      await page.locator('[data-testid="deck-tile"]').first().dblclick();
      await expect(page.getByTestId('deck-page')).toBeVisible();
      await check(page, 'the deck page');
    }, { timeout: 40_000 });
    await test.step('History', async () => {
      await navTo(page, 'HISTORY');
      await expect(page.getByTestId('route-history')).toBeVisible();
      await check(page, 'History');
    }, { timeout: 30_000 });
    await test.step('the waiting room', async () => {
      await navTo(page, 'PLAY');
      await mode(page, 'private');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
      await check(page, 'the waiting room');
    }, { timeout: 40_000 });
  });

  test('the table HUD, an open context menu and the pile viewer', async ({ page }, info) => {
    test.setTimeout(90_000);
    await openFreshHome(page, info, 'audit-hud');
    await seedDeck(page);
    await soloOpponent(page, 'ALONE');
    await page.getByTestId('home-primary').click();
    await atTable(page, 'practice');
    await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('hand-card')).toHaveCount(7, { timeout: 20_000 });
    await test.step('the table HUD', () => check(page, 'the table HUD', '[data-testid="hud"]'), { timeout: 30_000 });
    await test.step('an open context menu', async () => {
      await page.getByTestId('hand-card').first().click({ button: 'right' });
      await expect(page.getByTestId('context-menu')).toBeVisible();
      await check(page, 'the context menu');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('context-menu')).toHaveCount(0);
    }, { timeout: 30_000 });
    await test.step('the pile viewer', async () => {
      await openZone(page, 'library:s0', 'click');
      await expect(page.getByTestId('pile-viewer')).toBeVisible();
      await check(page, 'the pile viewer');
    }, { timeout: 30_000 });
  });

  test('the build stage', async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      await sealedBuilder(a, b);
      await check(a, 'the build stage');
    } finally {
      await context.close();
    }
  });

  test('the recovery panel and Gathering', async ({ browser }, info) => {
    test.setTimeout(150_000);
    const { context, list } = await pages(browser, 3);
    const [a, b0, c] = list as [Page, Page, Page];
    let b = b0;
    const room = { roomId: `audit-${Math.random().toString(36).slice(2, 8)}-g`, roomKey: 'QXVkaXRBdWRpdEF1ZGl0QQ' };
    const hash = `/t/${room.roomId}/${room.roomKey}`;
    const profiles = { a: freshProfile(info, 'ann'), b: freshProfile(info, 'ben'), c: freshProfile(info, 'ben-new') };
    try {
      await test.step('Ann and Ben at a table with decks', async () => {
        await openSite(a, profiles.a, hash);
        await expect.poll(() => a.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toBe('s0');
        await openSite(b, profiles.b, hash);
        await expect.poll(() => b.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toBe('s1');
        for (const [p, f] of [
          [a, 'gw-m19-60.txt'],
          [b, 'ur-m19-60.mtga.txt'],
        ] as const)
          await p.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist(f));
        await dispatch(a, { type: 'stageSet', stage: 'match' });
        for (const p of [a, b]) await expect.poll(async () => (await state(p)).stage, { timeout: 20_000 }).toBe('match');
        for (const p of [a, b]) await p.evaluate(() => window.__spellplane!.session!.draw(7));
        await sameHash([a, b]);
      }, { timeout: 60_000 });

      await test.step('Ben’s browser is lost; Ann brings him back to a fresh one: the recovery panel', async () => {
        await b.evaluate(async () => {
          await window.__spellplane!.session!.saved();
          await window.__spellplane!.session!.leave!();
        });
        await b.close();
        await expect.poll(async () => (await state(a)).seats.s1?.away === true, { timeout: 15_000 }).toBe(true);
        const link = await a.evaluate(async () => {
          window.__spellplane!.net!.setClock!(Date.now() + 31_000);
          try {
            return await window.__spellplane!.session!.invite!('s1');
          } finally {
            window.__spellplane!.net!.setClock!(null);
          }
        });
        await openSite(c, profiles.c, link.slice(link.indexOf('#') + 1));
        await expect(c.getByTestId('claim-page')).toBeVisible({ timeout: 30_000 });
        await check(c, 'the claim page');
        await c.getByTestId('claim-sit').click();
        await expect(c.getByTestId('recovery')).toBeVisible({ timeout: 20_000 });
        await check(c, 'the recovery panel');
      }, { timeout: 60_000 });

      await test.step('Ann leaves, then Ben; Ann returns: Gathering waits for Ben', async () => {
        await a.getByTestId('leave').click();
        await expect(a.getByTestId('route-home')).toBeVisible({ timeout: 15_000 });
        await c.evaluate(async () => {
          await window.__spellplane!.session!.saved();
          await window.__spellplane!.session!.leave!();
        });
        await c.close();
        b = a;
        await a.getByTestId('home-continue').click();
        await expect(a.getByTestId('gathering-card')).toBeVisible({ timeout: 30_000 });
        await check(a, 'Gathering');
      }, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });
});
