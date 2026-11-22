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

  test('sandbox: "Import deck…" is never in the Menu, with or without it (journey.md 4.10; gate M8 N10)', async ({ page }) => {
    for (const sandbox of [false, true]) {
      await setShell(page, { onleave: true, sandbox });
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      await expect(page.getByTestId('open-deck-import'), `sandbox ${sandbox}`).toHaveCount(0);
      await expect(page.getByTestId('menu-popover')).not.toContainText('Import deck');
      await page.keyboard.press('Escape');
    }
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
    // Ben's plate sits in the row under the tracker (the harness scene reports no seat edges): what follows the status.
    const row = page.locator('.plates-row');
    const rowTop = async () => (await row.boundingBox())!.y;
    const without = await rowTop();
    await setShell(page, { status: 'line' });
    await expect(page.getByTestId('fixture-status')).toBeVisible();
    const tracker = (await page.getByTestId('turn-strip').boundingBox())!;
    const status = (await page.getByTestId('fixture-status').boundingBox())!;
    expect(status.y).toBeGreaterThanOrEqual(tracker.y + tracker.height - 1);
    expect(await rowTop()).toBeGreaterThan(without);
    // A status that renders nothing visible adds neither height nor a gap: the row returns to where it was.
    await setShell(page, { status: 'empty' });
    await expect(page.getByTestId('fixture-status')).toHaveCount(0);
    await expect.poll(rowTop).toBe(without);
  });

  test("notice: shows under chrome 'plates' too, and a HUD toast still shows beside it", async ({ page }) => {
    await setShell(page, { chrome: 'plates', notice: { id: 7, text: 'Ben left the table. The game is saved.' } });
    await expect(page.getByTestId('hud-notice')).toContainText('Ben left the table.');
    await setShell(page, { chrome: 'full' });
    await expect(page.getByTestId('hud-notice')).toContainText('Ben left the table.');
    // A HUD toast while the notice shows ("Revealed your hand to Ben"): both are on screen.
    await plate(page, 's1').getByTestId('plate-more').click();
    await plate(page, 's1').getByTestId('plate-reveal-hand').click();
    await expect(page.getByTestId('toast')).toContainText('Revealed your hand to Ben');
    await expect(page.getByTestId('hud-notice')).toBeVisible();
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
    await page.keyboard.press('Escape');
    await expect(plate(page, 's1').getByTestId('plate-details')).toHaveCount(0);
    // No hand, Undo or primary is shown, so no key acts behind them: D, U and Ctrl+Enter do nothing.
    await page.evaluate(() => window.__uiHarness!.clear());
    await page.evaluate(() => window.__uiHarness!.hover('bf1'));
    for (const k of ['KeyD', 'KeyU', 'KeyT', 'Control+Enter']) await page.keyboard.press(k);
    expect(await page.evaluate(() => window.__uiHarness!.actions().length + window.__uiHarness!.calls().length)).toBe(0);
    // View-only on every route: the plates show no steppers or hand reveal, and the scene is told not to act.
    await setShell(page, { chrome: 'full' });
    await setShell(page, { chrome: 'plates' });
    await expect.poll(() => page.evaluate(() => window.__uiHarness!.scene().filter((c) => c.method === 'setReadOnly').map((c) => c.args[0]))).toEqual([false, true]);
    await expect(page.getByTestId('life-plus')).toHaveCount(0);
    await expect(page.getByTestId('life-minus')).toHaveCount(0);
    await plate(page, 's1').getByTestId('plate-more').click();
    await expect(plate(page, 's1').getByTestId('plate-details')).toBeVisible();
    await expect(plate(page, 's1').getByTestId('plate-reveal-hand')).toHaveCount(0);
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

  test('readOnly: no route acts — card and table menus look only, piles, stack, untap key, drags', async ({ page }) => {
    await setShell(page, { readOnly: true });
    await page.evaluate(() => window.__uiHarness!.clear());
    const nothing = async () => {
      const n = await page.evaluate(() => ({
        actions: window.__uiHarness!.actions(),
        calls: window.__uiHarness!.calls(),
        drags: window.__uiHarness!.scene().filter((c) => c.method === 'startDrag'),
      }));
      expect(n).toEqual({ actions: [], calls: [], drags: [] });
    };
    const menu = page.getByTestId('context-menu');
    await test.step('the scene is told: it proposes no action', async () => {
      await setShell(page, { readOnly: false });
      await setShell(page, { readOnly: true });
      await expect.poll(() => page.evaluate(() => window.__uiHarness!.scene().filter((c) => c.method === 'setReadOnly').map((c) => c.args[0]))).toEqual([false, true]);
    });
    await test.step('right-click the empty table: only Fit and the key sheet', async () => {
      // A point where the bare table is on top (no card, plate or HUD control over it).
      const at = await page.evaluate(() => {
        for (let y = 0.3; y < 0.9; y += 0.05)
          for (let x = 0.3; x < 0.9; x += 0.05) {
            const px = Math.round(innerWidth * x);
            const py = Math.round(innerHeight * y);
            if ((document.elementFromPoint(px, py) as HTMLElement | null)?.dataset.testid === 'fake-scene') return { x: px, y: py };
          }
        return null;
      });
      expect(at, 'a bare spot of the table').not.toBeNull();
      await page.mouse.click(at!.x, at!.y, { button: 'right' });
      await expect(menu).toBeVisible();
      expect((await menu.locator('[role="menuitem"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-action')))).sort()).toEqual(['fitTable', 'help']);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    });
    await test.step('right-click a table card: only Inspect and Zoom', async () => {
      await page.locator('[data-testid="scene-card"][data-card="bf1"]').click({ button: 'right' });
      await expect(menu).toBeVisible();
      expect((await menu.locator('[role="menuitem"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-action')))).sort()).toEqual(['inspect', 'zoomTo']);
      await page.keyboard.press('Escape');
    });
    await test.step('right-click a hand card, Shift+F10 on a hovered card: the same', async () => {
      await page.locator('[data-testid="hand-card"][data-card="h2"]').click({ button: 'right' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-action="toGraveyard"]')).toHaveCount(0);
      await expect(menu.locator('[data-action="cast"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__uiHarness!.hover('bf1'));
      await page.keyboard.press('Shift+F10');
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-action="tap"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__uiHarness!.hover(null));
    });
    await test.step('the own library from the plate: no Draw, Shuffle, Look, Mill, Search or Mulligan', async () => {
      await plate(page, 's0').getByTestId('plate-more').click();
      await plate(page, 's0').locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
      const viewer = page.getByTestId('pile-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.getByRole('button', { name: /^Draw/ })).toHaveCount(0);
      await expect(viewer.getByTestId('search-library')).toHaveCount(0);
      await expect(viewer.getByTestId('mill')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
    });
    await test.step('a stack item shows without Resolve or Counter', async () => {
      await page.evaluate(() => window.__uiHarness!.update((s) => void (s.stack = [{ id: 'si9', kind: 'spell', controller: 's0', card: 'bf1' }])));
      await expect(page.getByTestId('stack-chip')).toContainText('Stack 1');
      await expect(page.getByTestId('stack-chip').getByRole('button')).toHaveCount(0);
      await page.keyboard.press('KeyR');
    });
    await test.step('a new turn: the untap key does nothing', async () => {
      await page.evaluate(() => window.__uiHarness!.update((s) => void (s.turn = { number: 5, active: 's0', phase: 'untap' })));
      await page.keyboard.press('KeyU');
    });
    await test.step('a hand card dragged out is not handed to the table', async () => {
      const card = page.locator('[data-testid="hand-card"][data-card="h2"]');
      const b = (await card.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height - 20);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y - 120, { steps: 6 });
      await page.mouse.up();
    });
    await nothing();
  });

  test('readOnly turning on closes an acting overlay that is open: the card menu, the draw prompt', async ({ page }) => {
    const menu = page.getByTestId('context-menu');
    await page.locator('[data-testid="scene-card"][data-card="bf1"]').click({ button: 'right' });
    await expect(menu.locator('[data-action="tap"]')).toBeVisible();
    await setShell(page, { readOnly: true });
    await expect(menu).toHaveCount(0);
    await setShell(page, { readOnly: false });
    await page.mouse.move(5, 300);
    await page.keyboard.press('Shift+KeyD');
    await expect(page.getByTestId('draw-n')).toBeVisible();
    await setShell(page, { readOnly: true });
    await expect(page.getByTestId('draw-n')).toHaveCount(0);
    expect(await page.evaluate(() => window.__uiHarness!.actions())).toEqual([]);
  });

  test('primaryOverride: shows its label, runs it, and the button returns to its own step when cleared', async ({ page }) => {
    const primary = page.getByTestId('primary-action');
    // Its text as written (the kit draws button labels in capitals by CSS; toHaveText reads the text content).
    const own = ((await primary.textContent()) ?? '').trim();
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
