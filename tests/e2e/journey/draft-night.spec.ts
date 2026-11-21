/**
 * M8-P8 journey: Draft night (docs/PLAN.md Milestone 8, acceptance "M8-P8", draft-night.spec.ts; journey.md 4.1
 * "Draft night", 4.4, 4.8). Home in `DRAFT NIGHT` shows closed boosters of the fixture set and no deck; `OPEN DRAFT
 * TABLE` opens a waiting room whose lobby settings equal Home's booster setup; a second profile opens the invite link
 * and sits down; the host starts the draft and both pages are in the draft stage. Fixtures, the local transport.
 */
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_HOME_PREFS } from '../../../src/store/types';
import { boosterToLobby } from '../../../src/ui/home/view';
import { freshProfile, mode, openSite, pages, state } from '../helpers/journey';

test.describe('journey: Draft night', () => {
  test("Home's boosters, OPEN DRAFT TABLE, lobby settings equal the booster setup, start leads to the draft", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    try {
      await test.step('Home in DRAFT NIGHT: closed boosters of the fixture set, no deck', async () => {
        await openSite(a, freshProfile(info, 'host'));
        await expect(a.getByTestId('route-home')).toBeVisible();
        await mode(a, 'draft');
        await expect(a.getByTestId('home-hero')).toHaveAttribute('data-hero', 'boosters');
        await expect(a.getByTestId('home-boosters')).toBeVisible();
        await expect(a.getByTestId('home-hero')).toContainText('M19');
        await expect(a.getByTestId('hero-name')).toHaveCount(0);
        await expect(a.getByTestId('home-prev')).toHaveCount(0);
        await a.getByTestId('opt-draft-players').getByRole('radio', { name: '2', exact: true }).click();
        await expect(a.getByTestId('home-primary')).toHaveText('OPEN DRAFT TABLE');
      }, { timeout: 30_000 });

      let link = '';
      await test.step('OPEN DRAFT TABLE: a waiting room whose lobby settings equal the booster setup', async () => {
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
        // A fresh profile's booster setup is Home's default (Settings.home.draft.boosters): the waiting room's lobby
        // settings are exactly that setup.
        const expected = boosterToLobby(DEFAULT_HOME_PREFS.draft.boosters);
        expect(expected.draft).toEqual({ format: 'pass', packs: 3, picks: 1 });
        await expect.poll(async () => (await state(a)).lobby, { timeout: 15_000 }).toEqual(expected);
        const s = await state(a);
        expect(s.settings.autoSetup).toBe(true);
        expect(s.format).toBe('1v1');
        link = await a.getByTestId('share-link').inputValue();
      }, { timeout: 30_000 });

      await test.step('Ben opens the link and sits; the host starts the draft; both are drafting', async () => {
        await openSite(b, freshProfile(info, 'guest'), link.slice(link.indexOf('#') + 1));
        await expect(b.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
        await expect(a.getByTestId('room-start-draft')).toBeVisible({ timeout: 15_000 });
        await a.getByTestId('room-start-draft').click();
        for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'draft', { timeout: 30_000 });
        for (const p of [a, b]) await expect.poll(async () => (await state(p)).stage).toBe('draft');
      }, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });
});
