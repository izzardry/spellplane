/**
 * PLAN M5-P4 acceptance: "axe reports no serious violations on lobby, table HUD and builder list" (DESIGN "Input and
 * interaction design", Accessibility: Paper meets WCAG AA contrast throughout; seat colours are paired with a shape or
 * pattern; the log is a live region). Runs @axe-core/playwright against the test build in Chromium and WebKit with the
 * default theme (Paper), WCAG 2.x A and AA rules and axe's best practices; serious and critical findings fail.
 * The M5 review added the touch HUD on an emulated iPad (thumb bar, radial menu), the settings and audit panels, the
 * update, offline and version notices, the confirm prompt, the far-zoom stack badge and an away player's avatar. axe's
 * `incomplete` colour-contrast results (which it cannot decide) are printed, not failed (helpers.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import type { StackBadgeState } from '../../../src/scene/types';
import type { CardFocus } from '../../../src/ui/a11y/index';
import { SETTINGS_SECTIONS } from '../../../src/ui/settings/sections';
import { hook } from '../helpers/app';
import { decklist as lobbyDecklist, freshProfile, freshRoom, open, openTable, startPageLoaded } from '../lobby/helpers';
import { appUrl, fixturesScript, freshProfile as offlineProfile, noNetwork, waitForSession } from '../offline/helpers';
import { IPAD, card, centre, fingers, holdDown, radial, tableWithCards } from '../touch/helpers';
import { openHud } from '../ui/harness';
import { otherVersion, seriousViolations, sealedBuilder, sceneReady, soloTable, twoInLobby } from './helpers';

test.describe('axe: no serious or critical violations (PLAN M5-P4)', () => {
  test('the start page (create or join a table), empty and with a nickname problem', async ({ page }, info) => {
    await open(page, '/lobby', { profile: freshProfile(info, 'axe'), transport: 'local' });
    await expect(page.getByTestId('start-page')).toBeVisible();
    await startPageLoaded(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('nickname').fill('   ');
    await page.getByTestId('join-link').fill('not a link');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the lobby, with two players seated', async ({ browser }, info) => {
    test.setTimeout(120_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      // The host's lobby (editable settings) and the guest's (read-only settings) differ: both are checked.
      expect(await seriousViolations(a)).toEqual([]);
      expect(await seriousViolations(b)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('the table HUD, with a hand, the log open, a prompt-free table', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    await expect(page.getByTestId('log')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the table HUD with a spell on the stack, the keyboard context menu and the library viewer open', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    // Keyboard only: focus the first hand card and cast it (C), so the stack chip shows Resolve, its targets and Counter.
    const first = (await hook<SecretStore>(page, 'secrets')).hand[0]!;
    await page.mouse.move(5, 450);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook<CardFocus | null>(page, 'a11y.focus')).toEqual({ zone: 'hand:s0', card: first });
    await page.keyboard.press('KeyC');
    await expect.poll(async () => (await hook<TableState>(page, 'state')).cards[first]?.zone).toBe('stack');
    await expect(page.getByTestId('stack-chip')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    // The context menu of the focused card (the next hand card), opened from the keyboard.
    await page.keyboard.press('ContextMenu');
    await expect(page.getByTestId('context-menu')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    await expect(page.getByTestId('pile-viewer')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the table HUD with the cheat sheet open', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    await page.getByTestId('open-cheat-sheet').click();
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the builder list view', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      await sealedBuilder(a, b);
      expect(await seriousViolations(a)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});


test.describe('axe: panels, prompts and notices (M5 review)', () => {
  test('the settings panel over the table, every section', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    await page.getByTestId('open-settings').click();
    const panel = page.getByTestId('settings');
    await expect(panel).toBeVisible();
    for (const s of SETTINGS_SECTIONS) {
      await panel.locator(`[data-testid="settings-tab"][data-section="${s.id}"]`).click();
      await expect(panel).toHaveAttribute('data-section', s.id);
      expect(await seriousViolations(page), `settings section ${s.id}`).toEqual([]);
    }
  });

  test('the confirm prompt, waiting and while this player holds', async ({ page }) => {
    const q = new URLSearchParams({ faces: 'placeholder', harness: 'confirm', seat: 's1', timer: '600000', seats: 'Anna,Ben' });
    await page.goto(`./?${q.toString()}`);
    await expect.poll(() => page.evaluate(() => typeof window.__confirmHarness === 'object' && typeof window.__spellplane?.stack === 'function')).toBe(true);
    await expect(page.getByTestId('hud')).toBeVisible();
    // Anna casts Spark Jolt from hand (reveal, then the push with a round): Ben is asked.
    for (const d of [
      { type: 'reveal', instanceId: 'abolt', ref: { sid: 'sid-bolt' }, salt: 'salt-abolt' },
      { type: 'stackPush', item: 'i1', kind: 'spell', card: 'abolt', round: 'r1' },
    ])
      expect((await page.evaluate((x) => window.__confirmHarness!.remote('s0', x as never), d)).refused).toBeNull();
    const prompt = page.getByTestId('confirm-prompt');
    await expect(prompt).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await prompt.getByTestId('prompt-hold').click();
    await expect.poll(() => page.evaluate(() => window.__confirmHarness!.state().confirm?.holder ?? null)).toBe('s1');
    await expect(prompt).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the update and offline notices over the table', async ({ context, page }, info) => {
    await noNetwork(context);
    await context.addInitScript({ content: fixturesScript() });
    await page.goto(appUrl({ profile: offlineProfile(info, 'axe'), update: 'fake' }));
    await waitForSession(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.evaluate(() => (window as unknown as { __spellplaneFakeUpdate: { offer(): void } }).__spellplaneFakeUpdate.offer());
    await expect(page.getByTestId('update-notice')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId('offline-notice')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await context.setOffline(false);
  });

  test('the version notice in the lobby', async ({ page }, info) => {
    const room = freshRoom();
    await openTable(page, room, freshProfile(info, 'axe-v'));
    await otherVersion(page, room.roomId, 1, 'Old Ben');
    await expect(page.getByTestId('version-mismatch')).toBeVisible({ timeout: 15_000 });
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("an away player's avatar", async ({ page }) => {
    await openHud(page);
    const ben = page.locator('[data-testid="avatar"][data-seat="s1"]');
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.seats.s1!.away = true;
      }),
    );
    await expect(ben).toHaveAttribute('data-away', 'true');
    expect(await seriousViolations(page, '[data-testid="avatar"][data-seat="s1"]')).toEqual([]);
    // Still told apart from a present player without dimming: a dashed frame and the "away" label.
    expect(await ben.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
    await expect(ben.getByTestId('away')).toHaveText('away');
  });

  test('the audit panel after a two-player game (and the confirm prompt of "Next game")', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const { context, a, b } = await twoInLobby(browser, info);
    try {
      await a.evaluate((text) => window.__spellplane!.session!.importDecklist(text), lobbyDecklist('gw-m19-60.txt'));
      await b.evaluate((text) => window.__spellplane!.session!.importDecklist(text), lobbyDecklist('ur-m19-60.mtga.txt'));
      await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.', { timeout: 15_000 });
      await a.getByTestId('start-game').click();
      for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 30_000 });
      await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
      await a.evaluate(() => window.__spellplane!.session!.draw(7));
      await b.evaluate(() => window.__spellplane!.session!.draw(7));
      await a.getByTestId('propose-nextGame').click();
      await expect(b.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
      expect(await seriousViolations(b)).toEqual([]);
      await b.getByTestId('prompt-ok').click();
      for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'build', { timeout: 30_000 });
      const panel = b.getByTestId('audit-panel');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      for (const seat of ['s0', 's1']) await expect(panel.locator(`[data-testid="audit-row"][data-seat="${seat}"]`)).toHaveAttribute('data-status', 'verified', { timeout: 30_000 });
      expect(await seriousViolations(b)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe('axe: the far-zoom stack badge (M5 review)', () => {
  // The scene harness's fitted four-seat view at 1280 x 720 draws stack cards at far zoom (tests/e2e/layout/stack-badge.spec.ts).
  test.use({ viewport: { width: 1280, height: 720 } });

  const badge = (page: Page) => page.evaluate(() => window.__spellplane!.stackBadge!()) as Promise<StackBadgeState>;

  test('collapsed and expanded', async ({ page }) => {
    await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format: 'ffa4', viewer: 's0' }).toString()}`);
    await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    for (const a of [
      { type: 'stackPush', by: 's1', item: 'i1', kind: 'spell', card: 's1-c0' },
      { type: 'stackPush', by: 's2', item: 'i2', kind: 'spell', card: 's2-c0' },
      { type: 'stackPush', by: 's3', item: 'i3', kind: 'ability' },
    ])
      await page.evaluate((x) => window.__spellplane!.dispatch!(x as never), { cid: `axe-${a.item}`, ...a });
    await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => badge(page)).toMatchObject({ count: 3, collapsed: true, expanded: false });
    expect(await seriousViolations(page)).toEqual([]);
    const r = (await badge(page)).screen!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 4 });
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await expect(page.getByTestId('stack-badge-item')).toHaveCount(3);
    // Each item names its controller by seat glyph as well as colour (nothing depends on hue alone).
    await expect(page.getByTestId('stack-badge-glyph')).toHaveCount(3);
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe('axe: the touch HUD on an iPad (M5 review)', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');
  test.use(IPAD);

  test('the thumb bar with an empty stack, and the radial menu open', async ({ page }, info) => {
    const { bf } = await tableWithCards(page, info, { battlefield: 1, hand: 2 });
    await expect(page.getByTestId('thumb-bar')).toBeVisible();
    // With nothing on the stack, Resolve is not ready: marked without lowering its text contrast.
    await expect(page.getByTestId('thumb-resolve')).toHaveAttribute('data-ready', 'false');
    expect(await page.getByTestId('thumb-resolve').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await seriousViolations(page)).toEqual([]);
    const at = centre(await card(page, bf[0]!));
    await holdDown(page, at);
    await fingers(page, [{ type: 'up', id: 1, ...at }]);
    await expect.poll(async () => (await radial(page)) !== null).toBe(true);
    await expect(page.getByTestId('radial-menu')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
