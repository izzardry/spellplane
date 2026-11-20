/**
 * PLAN Milestone 8, M7-P2 acceptance: every member of HudShellProps (src/ui/props.ts; docs/design/m8/m7-adjustments.md
 * section 2 and chunk P2-3) on the ui harness with setShell(partial), and HUD_SHELL true. Other packages fill these
 * slots; this spec proves the HUD honours each one without them.
 */
import { expect, test, type Page } from '@playwright/test';
import { HUD_SHELL } from '../../../src/ui/hud/shell';
import type { ShellPartial } from '../../../src/ui/hud/harness-shell.svelte';
import { openHud } from '../ui/harness';

function setShell(page: Page, partial: ShellPartial): Promise<void> {
  return page.evaluate((p) => window.__uiHarness!.setShell(p), partial);
}
function shellCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__uiHarness!.shellCalls());
}
const plate = (page: Page, seat: string) => page.locator(`[data-testid="avatar"][data-seat="${seat}"]`);

test('HUD_SHELL is true: the table frame hides its fallback bar', () => {
  expect(HUD_SHELL).toBe(true);
});

test.describe('HudShellProps on ?harness=ui', () => {
  test.beforeEach(async ({ page }) => {
    await openHud(page);
  });

  test('onleave: the back arrow calls it once, with no confirmation; no arrow without it', async ({ page }) => {
    await expect(page.getByTestId('leave')).toHaveCount(0);
    await setShell(page, { onleave: true });
    const arrow = page.getByTestId('leave');
    await expect(arrow).toBeVisible();
    // Top left, before the Menu.
    const a = (await arrow.boundingBox())!;
    const m = (await page.getByTestId('open-menu').boundingBox())!;
    expect(a.x).toBeLessThan(m.x);
    await arrow.click();
    expect(await shellCalls(page)).toEqual(['leave']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('leave-confirm')).toHaveCount(0);
  });

  test('menuTop: the shell groups come first and run', async ({ page }) => {
    await setShell(page, { menuTop: [{ title: 'This game', items: [{ id: 'leave', label: 'Leave to home' }, { id: 'concede', label: 'Concede', danger: true }] }] });
    await page.getByTestId('open-menu').click();
    const pop = page.getByTestId('menu-popover');
    await expect(pop).toBeVisible();
    const first = pop.locator('[role="menuitem"]').first();
    await expect(first).toHaveText('Leave to home');
    await expect(pop.locator('.ds-menu-group').first()).toContainText('This game');
    await pop.getByTestId('menu-top-concede').click();
    expect(await shellCalls(page)).toEqual(['menuTop:concede']);
    await expect(pop).toHaveCount(0);
  });

  test('sandbox: "Import deck…" is in the Menu only with it', async ({ page }) => {
    await setShell(page, { onleave: true, sandbox: false });
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('menu-popover')).toBeVisible();
    await expect(page.getByTestId('open-deck-import')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await setShell(page, { sandbox: true });
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('open-deck-import')).toBeVisible();
  });

  test('onchoosedeck: a table without my deck shows the no-deck line with "Choose a deck"', async ({ page }) => {
    await page.evaluate(() =>
      window.__uiHarness!.update((st) => {
        for (const [id, c] of Object.entries(st.cards)) if (c.owner === 's0') delete st.cards[id];
        for (const z of Object.values(st.zones)) if (z.id.endsWith(':s0')) z.ids = [];
      }),
    );
    await setShell(page, { onleave: true, onchoosedeck: true });
    const line = page.getByTestId('no-deck');
    await expect(line).toContainText('No deck on this table.');
    await line.getByTestId('choose-deck').click();
    expect(await shellCalls(page)).toEqual(['chooseDeck']);
    // In the sandbox (no picker) the line opens the paste dialog instead.
    await setShell(page, { onchoosedeck: false, sandbox: true });
    await line.getByTestId('empty-import-deck').click();
    await expect(page.getByTestId('deck-import')).toBeVisible();
  });

  test('seatPresence: an away seat plate dims and says AWAY', async ({ page }) => {
    await expect(plate(page, 's1')).toHaveAttribute('data-away', 'false');
    await setShell(page, { seatPresence: { s1: 'away' } });
    await expect(plate(page, 's1')).toHaveAttribute('data-away', 'true');
    await expect(plate(page, 's1').getByTestId('away')).toHaveText('AWAY');
    await expect(plate(page, 's0')).toHaveAttribute('data-away', 'false');
  });

  test('plateMenuTop: renders at the top of that seat menu; its close callback closes it', async ({ page }) => {
    await setShell(page, { plateMenuTop: true });
    await plate(page, 's1').getByTestId('plate-more').click();
    const menu = plate(page, 's1').getByTestId('plate-details');
    await expect(menu).toBeVisible();
    const top = menu.getByTestId('fixture-plate-menu-top');
    await expect(top).toHaveAttribute('data-seat', 's1');
    // It is the first thing in the menu.
    const firstChild = await menu.evaluate((el) => el.firstElementChild?.getAttribute('data-testid'));
    expect(firstChild).toBe('plate-menu-top');
    await top.getByTestId('fixture-plate-menu-close').click();
    await expect(menu).toHaveCount(0);
  });

  test('plateBadge: renders beside the name, at most 28 px high', async ({ page }) => {
    await setShell(page, { plateBadge: true });
    const badge = plate(page, 's1').getByTestId('fixture-plate-badge');
    await expect(badge).toHaveAttribute('data-seat', 's1');
    await expect(plate(page, 's0').getByTestId('fixture-plate-badge')).toHaveAttribute('data-seat', 's0');
    const box = (await plate(page, 's1').getByTestId('plate-badges').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(28.5);
  });

  test('status: renders under the tracker and takes no height when empty', async ({ page }) => {
    await setShell(page, { status: 'line' });
    await expect(page.getByTestId('fixture-status')).toBeVisible();
    const tracker = (await page.getByTestId('turn-strip').boundingBox())!;
    const status = (await page.getByTestId('hud-status').boundingBox())!;
    expect(status.y).toBeGreaterThanOrEqual(tracker.y + tracker.height - 1);
    await setShell(page, { status: 'empty' });
    const h = await page.getByTestId('hud-status').evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBe(0);
  });

  test('notice: shows once per id, and its action runs', async ({ page }) => {
    await setShell(page, { notice: { id: 1, text: 'Ben left the table. The game is saved.', action: 'Bring back' } });
    const n = page.getByTestId('hud-notice');
    await expect(n).toContainText('Ben left the table.');
    await n.getByTestId('hud-notice-action').click();
    expect(await shellCalls(page)).toEqual(['notice:1']);
    await expect(n).toHaveCount(0);
    // The same id again: not shown a second time.
    await setShell(page, { notice: null });
    await setShell(page, { notice: { id: 1, text: 'Ben left the table. The game is saved.', action: 'Bring back' } });
    await expect(n).toHaveCount(0);
    // A new id shows.
    await setShell(page, { notice: { id: 2, text: 'Ben is back.' } });
    await expect(n).toContainText('Ben is back.');
  });

  test("chrome 'plates': only the plates, their menus and the status line", async ({ page }) => {
    await setShell(page, { chrome: 'plates', status: 'line', plateMenuTop: true });
    for (const id of ['turn-strip', 'primary-action', 'open-log', 'open-menu', 'undo', 'view-control', 'hand']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(plate(page, 's0')).toBeVisible();
    await expect(plate(page, 's1')).toBeVisible();
    await expect(page.getByTestId('fixture-status')).toBeVisible();
    await plate(page, 's1').getByTestId('plate-more').click();
    await expect(plate(page, 's1').getByTestId('fixture-plate-menu-top')).toBeVisible();
  });

  test('readOnly: no primary button and no Undo; the Menu still opens; life cannot be changed', async ({ page }) => {
    await setShell(page, { readOnly: true });
    await expect(page.getByTestId('primary-action')).toHaveCount(0);
    await expect(page.getByTestId('undo')).toHaveCount(0);
    await expect(page.getByTestId('life-plus')).toHaveCount(0);
    await expect(page.getByTestId('opening-hand')).toHaveCount(0);
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('menu-popover')).toBeVisible();
    await expect(page.getByTestId('open-token')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Keys that would change the table do nothing.
    await page.evaluate(() => window.__uiHarness!.clear());
    await page.keyboard.press('d');
    await page.keyboard.press('u');
    expect(await page.evaluate(() => window.__uiHarness!.actions().length + window.__uiHarness!.calls().length)).toBe(0);
    await expect(page.getByTestId('view-control')).toBeVisible();
  });

  test('primaryOverride: shows its label, runs it, and the button returns to its own step when cleared', async ({ page }) => {
    const primary = page.getByTestId('primary-action');
    const own = await primary.innerText();
    await setShell(page, { primaryOverride: { label: 'Attack' } });
    await expect(primary).toHaveText('Attack');
    await page.evaluate(() => window.__uiHarness!.clear());
    await primary.click();
    expect(await shellCalls(page)).toEqual(['primaryOverride']);
    expect(await page.evaluate(() => window.__uiHarness!.actions())).toEqual([]);
    await setShell(page, { primaryOverride: null });
    await expect(primary).toHaveText(own);
  });
});
