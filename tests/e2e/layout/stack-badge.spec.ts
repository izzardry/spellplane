/**
 * PLAN Milestone 5, owner decisions, Far-zoom stack: "DESIGN's far-zoom behaviour for the stack (it collapses to a count
 * badge that expands on hover, or on tap on touch) is built, because the fitted three- and four-player view made the
 * stack unreadable (M3 gate)." DESIGN "The effect stack", Reading it. (M5-P7)
 *
 * The real table scene (`?harness=scene&format=ffa4`) at its fitted view with three items on the stack: the lane is
 * drawn as a count badge; hovering the badge (tapping it on touch) lists the items readably, with whole card faces;
 * leaving it (tapping elsewhere) collapses it; zooming in brings the lane back. Engine facts from the debug hook
 * (`stackBadge`, `cards`), the badge's DOM by its test ids.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SceneDebugCard } from '../../../src/scene/table-scene';
import type { StackBadgeState } from '../../../src/scene/types';

async function openWithStack(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format: 'ffa4', viewer: 's0' }).toString()}`);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  // Two spells and an ability marker, from three seats.
  for (const a of [
    { type: 'stackPush', by: 's1', item: 'i1', kind: 'spell', card: 's1-c0' },
    { type: 'stackPush', by: 's2', item: 'i2', kind: 'spell', card: 's2-c0' },
    { type: 'stackPush', by: 's3', item: 'i3', kind: 'ability' },
  ])
    await page.evaluate((x) => window.__spellplane!.dispatch!(x as never), { cid: `e2e-${a.item}`, ...a });
  await idle(page);
  expect(errors).toEqual([]);
}
async function idle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
}
const badge = (page: Page) => page.evaluate(() => window.__spellplane!.stackBadge!()) as Promise<StackBadgeState>;
const cards = (page: Page) => page.evaluate(() => window.__spellplane!.cards!()) as Promise<SceneDebugCard[]>;
const centreOf = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

async function expectReadableItems(page: Page): Promise<void> {
  const items = page.getByTestId('stack-badge-item');
  await expect(items).toHaveCount(3);
  // Oldest first, newest last (in front), numbered from the bottom with the kind.
  expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-item')))).toEqual(['i1', 'i2', 'i3']);
  await expect(items.nth(0)).toContainText('1 SPELL');
  await expect(items.nth(2)).toContainText('3 ABILITY');
  // Whole faces at the card's aspect, large enough to read (at least 160 px tall: the normal texture tier).
  for (let i = 0; i < 3; i++) {
    const face = items.nth(i).locator('[data-face]');
    const box = (await face.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(160);
    expect(box.width / box.height).toBeCloseTo(63 / 88, 2);
  }
  // The spells' faces are drawn (placeholder canvases); the marker without a source shows a plain back.
  await expect(items.nth(0).locator('[data-face] canvas')).toHaveCount(1);
  await expect(items.nth(2).locator('[data-face="back"]')).toHaveCount(1);
}

test.describe('far zoom with a mouse', () => {
  // The harness has no HUD insets; at 1280 x 720 its fitted four-seat view draws stack cards at far zoom.
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the fitted four-player view collapses the stack to a count badge that expands on hover', async ({ page }) => {
    await openWithStack(page);
    await expect.poll(() => badge(page)).toMatchObject({ count: 3, collapsed: true, expanded: false });
    await expect(page.getByTestId('stack-badge-count')).toHaveText('3');
    await expect(page.getByTestId('stack-badge-count')).toHaveAttribute('aria-label', '3 items on the stack');
    // The lane's cards are not drawn while it is a badge.
    for (const id of ['s1-c0', 's2-c0']) expect((await cards(page)).find((c) => c.id === id)?.visible).toBe(false);
    await expect(page.getByTestId('stack-badge-items')).toBeHidden();

    // Hover: the items show readably.
    const at = centreOf((await badge(page)).screen!);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await expect(page.getByTestId('stack-badge-items')).toBeVisible();
    await expectReadableItems(page);

    // Hovering an item in the list makes it the hovered stack item (its source and targets light up; the HUD's N, X
    // and I reach it), as hovering it in the lane does; leaving the list clears it.
    // Across the gap to the list at the badge's height (the pointer stays on the badge), then up to the oldest item.
    const list = (await page.getByTestId('stack-badge-items').boundingBox())!;
    const towardList = list.x > at.x ? list.x + 3 : list.x + list.width - 3;
    await page.mouse.move(towardList, at.y, { steps: 8 });
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    const row = (await page.getByTestId('stack-badge-item').nth(0).boundingBox())!;
    await page.mouse.move(towardList, row.y + 12, { steps: 3 });
    await page.mouse.move(row.x + row.width / 2, row.y + 12, { steps: 3 });
    await expect.poll(() => page.evaluate(() => window.__sceneHarness!.stackHover())).toBe('i1');

    // Leaving collapses it again.
    await page.mouse.move(40, 40, { steps: 4 });
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);
    await expect(page.getByTestId('stack-badge-items')).toBeHidden();
    expect(await page.evaluate(() => window.__sceneHarness!.stackHover())).toBeNull();

    // A click pins it open after the pointer leaves; Escape closes it wherever the keyboard focus is (WebKit does not
    // focus a clicked button).
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(40, 40, { steps: 4 });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);

    // Keyboard focus expands it like hover; focus leaving collapses it.
    await page.getByTestId('stack-badge-count').focus();
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);

    // Zooming in on the lane brings it back; fitting again collapses it.
    await page.evaluate(({ x, y }) => window.__sceneHarness!.camera.zoomAt(x, y, 3), at);
    await idle(page);
    await expect.poll(() => badge(page)).toMatchObject({ count: 3, collapsed: false, expanded: false, screen: null });
    await expect(page.getByTestId('stack-badge')).toBeHidden();
    for (const id of ['s1-c0', 's2-c0']) expect((await cards(page)).find((c) => c.id === id)?.visible).toBe(true);
    await page.keyboard.press('0');
    await idle(page);
    await expect.poll(async () => (await badge(page)).collapsed).toBe(true);
  });

  test('an empty stack shows no badge', async ({ page }) => {
    await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format: 'ffa4', viewer: 's0' }).toString()}`);
    await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await idle(page);
    expect(await badge(page)).toEqual({ count: 0, collapsed: false, expanded: false, screen: null });
    await expect(page.getByTestId('stack-badge')).toBeHidden();
  });
});

test.describe('far zoom on touch', () => {
  // A touch screen; the harness has no HUD insets, so a smaller window than the iPad's puts its fit at far zoom.
  test.use({ viewport: { width: 1024, height: 700 }, hasTouch: true });

  test('a tap on the badge expands it; a tap elsewhere collapses it', async ({ page }) => {
    await openWithStack(page);
    await expect.poll(async () => (await badge(page)).collapsed).toBe(true);
    await page.getByTestId('stack-badge-count').tap();
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await expectReadableItems(page);
    // A tap on the table elsewhere closes it.
    await page.touchscreen.tap(60, 60);
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);
    // Tapping the badge twice opens and closes it.
    await page.getByTestId('stack-badge-count').tap();
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await page.getByTestId('stack-badge-count').tap();
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);
    // A badge opened by a tap closes with Escape (a hardware keyboard), though the tapped button has no focus.
    await page.getByTestId('stack-badge-count').tap();
    await expect.poll(async () => (await badge(page)).expanded).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await badge(page)).expanded).toBe(false);
  });
});
