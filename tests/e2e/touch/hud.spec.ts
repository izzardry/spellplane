/**
 * PLAN M5-P1 acceptance, the touch HUD under Playwright's iPad emulation (WebKit, touch). DESIGN "Input and interaction
 * design", Touch: "A slim action bar above the hand exposes Attack, Settle, Resolve, Ask and the talk button, sized for
 * thumbs. The hand fan scrolls horizontally and lifts cards on touch for reading"; "Camera and navigation": dragging a
 * card from the hand crosses into the scene. PLAN Milestone 5, owner decisions: iPad Safari has no text-selection
 * callout or magnifier, no double-tap zoom and no pull-to-refresh at the table, and safe-area insets are respected.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { IPAD, card, centre, fingers, holdDown, lastActions, path, radial, settled, state, tableWithCards, thumbBar, type Pt } from './helpers';

test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');

const fanCard = (page: Page, id: string) => page.locator(`[data-testid="hand-card"][data-card="${id}"]`);

test.describe('on an iPad', () => {
  test.use(IPAD);

  test('the thumb bar shows Attack, Settle, Resolve, Ask and Talk above the hand, each a thumb-sized target', async ({ page }, info) => {
    await tableWithCards(page, info);
    expect((await thumbBar(page)).map((b) => b.action)).toEqual(['attack', 'settle', 'resolve', 'ask', 'talk']);
    const bar = page.getByTestId('thumb-bar');
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    for (const a of ['attack', 'settle', 'resolve', 'ask', 'talk']) {
      const b = (await page.getByTestId(`thumb-${a}`).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    // Above the hand fan, clear of it.
    const hand = await page.getByTestId('hand-card').first().boundingBox();
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(hand!.y + 1);
  });

  test('Draw N works without a keyboard: the field has a Draw button (no return key needed)', async ({ page }, info) => {
    const { hand } = await tableWithCards(page, info, { battlefield: 0, hand: 1 });
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').tap();
    await expect(page.getByTestId('pile-viewer')).toHaveAttribute('data-kind', 'library');
    await page.getByTestId('pile-viewer').getByRole('button', { name: /^Draw N/ }).tap();
    await expect(page.getByTestId('draw-n-input')).toBeVisible();
    await page.getByTestId('draw-n-input').fill('3');
    await page.getByTestId('draw-n-go').tap();
    await expect.poll(async () => (await hook<{ hand: string[] }>(page, 'secrets')).hand.length).toBe(hand.length + 3);
    await expect(page.getByTestId('draw-n')).toHaveCount(0);
  });

  test('Attack sends the tapped (selected) creature forward and taps it; Settle brings it home', async ({ page }, info) => {
    const { bf } = await tableWithCards(page, info);
    const c = centre(await card(page, bf[1]!));
    await page.touchscreen.tap(c.x, c.y);
    await expect.poll(async () => (await hook<{ id: string; selected: boolean }[]>(page, 'cards')).filter((x) => x.selected).map((x) => x.id)).toEqual([bf[1]]);
    await page.getByTestId('thumb-attack').tap();
    await expect.poll(async () => (await state(page)).cards[bf[1]!]!.combat).toBe('attack');
    const s = (await state(page)).cards[bf[1]!]!;
    expect(s.tapped).toBe(true);
    expect(s.home).toBeTruthy();
    // The same action the A key dispatches.
    expect((await lastActions(page, 1))[0]).toMatchObject({ type: 'moveTemp', card: bf[1], combat: 'attack', tap: true });
    await page.getByTestId('thumb-settle').tap();
    await expect.poll(async () => (await state(page)).cards[bf[1]!]!.combat ?? null).toBeNull();
    expect((await state(page)).cards[bf[1]!]!.pose).toEqual(s.home);
  });

  test('Resolve resolves the top of the stack; Ask starts a confirmation round, with a button to send it', async ({ page }, info) => {
    const { hand } = await tableWithCards(page, info, { battlefield: 1, hand: 1 });
    // Cast the hand card through its radial menu.
    const box = (await fanCard(page, hand[0]!).boundingBox())!;
    const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height - 20) };
    await holdDown(page, at);
    await fingers(page, [{ type: 'up', id: 1, ...at }]);
    const slot = (await radial(page))!.slots.find((s) => s.id === 'stack')!;
    await page.touchscreen.tap(Math.round(slot.screen.x + slot.screen.width / 2), Math.round(slot.screen.y + slot.screen.height / 2));
    await expect.poll(async () => (await state(page)).stack.length).toBe(1);
    await page.getByTestId('thumb-resolve').tap();
    await expect.poll(async () => (await state(page)).stack.length).toBe(0);
    expect((await state(page)).cards[hand[0]!]!.zone).not.toBe('hand:s0');

    await page.getByTestId('thumb-ask').tap();
    await expect(page.getByTestId('ask-field')).toBeVisible();
    await page.getByTestId('ask-submit').tap();
    await expect.poll(async () => (await state(page)).confirm !== null && (await state(page)).confirm !== undefined).toBe(true);
    await expect(page.getByTestId('ask-field')).toHaveCount(0);
  });

  test('Talk talks while the button is held and stops when the finger lifts', async ({ page }, info) => {
    await tableWithCards(page, info);
    const b = (await page.getByTestId('thumb-talk').boundingBox())!;
    const p = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    await fingers(page, [{ type: 'down', id: 1, ...p }]);
    await expect(page.getByTestId('talking')).toBeVisible();
    await expect(page.getByTestId('thumb-talk')).toHaveAttribute('aria-pressed', 'true');
    // Sliding off the button keeps talking until the finger lifts.
    await fingers(page, path(1, p, { x: p.x, y: p.y - 120 }, 4));
    await expect(page.getByTestId('talking')).toBeVisible();
    await fingers(page, [{ type: 'up', id: 1, x: p.x, y: p.y - 120 }]);
    await expect(page.getByTestId('talking')).toHaveCount(0);
    // A quick tap talks for that moment only.
    await page.getByTestId('thumb-talk').tap();
    await expect(page.getByTestId('talking')).toHaveCount(0);
  });

  test('a finger lifts a hand card for reading; it stays lifted until a press elsewhere', async ({ page }, info) => {
    const { hand } = await tableWithCards(page, info, { battlefield: 1, hand: 4 });
    const vh = page.viewportSize()!.height;
    const el = fanCard(page, hand[1]!);
    const rest = (await el.boundingBox())!;
    expect(rest.height).toBeCloseTo(vh * 0.22, 0);
    await page.touchscreen.tap(Math.round(rest.x + 15), Math.round(rest.y + rest.height - 15));
    await expect.poll(async () => (await el.boundingBox())!.height).toBeGreaterThan(vh * 0.44);
    // No text selection or callout: the fan cards and the HUD do not select.
    expect(await el.evaluate((n) => getComputedStyle(n).webkitUserSelect || getComputedStyle(n).userSelect)).toBe('none');
    // Another card lifts instead.
    const other = (await fanCard(page, hand[3]!).boundingBox())!;
    await page.touchscreen.tap(Math.round(other.x + other.width - 15), Math.round(other.y + other.height - 15));
    await expect.poll(async () => (await fanCard(page, hand[3]!).boundingBox())!.height).toBeGreaterThan(vh * 0.44);
    await expect.poll(async () => (await el.boundingBox())!.height).toBeLessThan(vh * 0.3);
    // A press on the table lowers it.
    await page.touchscreen.tap(300, 300);
    await expect.poll(async () => (await fanCard(page, hand[3]!).boundingBox())!.height).toBeLessThan(vh * 0.3);
  });

  test('a large hand scrolls sideways under the finger and keeps every card a touch target wide', async ({ page }, info) => {
    const { hand } = await tableWithCards(page, info, { battlefield: 0, hand: 30 });
    const vw = page.viewportSize()!.width;
    const fan = page.getByTestId('hand');
    const max = Number(await fan.getAttribute('data-max-scroll'));
    expect(max).toBeGreaterThan(0);
    const boxes = await Promise.all(hand.slice(0, 3).map((id) => fanCard(page, id).boundingBox()));
    expect(boxes[1]!.x - boxes[0]!.x).toBeGreaterThanOrEqual(43.5);
    // The last card starts off screen to the right.
    const last = fanCard(page, hand[hand.length - 1]!);
    expect((await last.boundingBox())!.x).toBeGreaterThan(vw);
    // Swipe left along the fan: it scrolls with the finger.
    const y = Math.round(boxes[0]!.y + boxes[0]!.height - 20);
    const from: Pt = { x: Math.round(vw * 0.8), y };
    const to: Pt = { x: Math.round(vw * 0.1), y };
    await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, to, 12), { type: 'up', id: 1, ...to }]);
    // The swipe is longer than the scroll range: the fan ends at the last card, now on screen.
    await expect.poll(async () => Number(await fan.getAttribute('data-scroll'))).toBe(max);
    const lb = (await last.boundingBox())!;
    expect(lb.x).toBeLessThan(vw);
    expect(lb.x + lb.width).toBeLessThanOrEqual(vw);
    // Swiping back scrolls back.
    await fingers(page, [{ type: 'down', id: 1, ...to }, ...path(1, to, { x: to.x + 100, y }, 6), { type: 'up', id: 1, x: to.x + 100, y }]);
    await expect.poll(async () => Number(await fan.getAttribute('data-scroll'))).toBeLessThan(max - 80);
    // A sideways swipe plays nothing.
    expect((await state(page)).zones['hand:s0']!.ids).toHaveLength(30);
  });

  test('dragging a card up out of the hand plays it onto the table where the finger lifts', async ({ page }, info) => {
    const { hand } = await tableWithCards(page, info, { battlefield: 1, hand: 2 });
    const b = (await fanCard(page, hand[0]!).boundingBox())!;
    const from = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height - 20) };
    const to = { x: from.x + 120, y: Math.round(page.viewportSize()!.height * 0.55) };
    await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, to, 14), { type: 'up', id: 1, ...to }]);
    await expect.poll(async () => (await state(page)).cards[hand[0]!]!.zone).toBe('battlefield:s0');
    await settled(page);
    const c = await card(page, hand[0]!);
    expect(Math.hypot(centre(c).x - to.x, centre(c).y - to.y)).toBeLessThan(20);
  });

  test('iPad Safari tuning: no double-tap zoom, pull-to-refresh, callout or page pinch; safe-area insets used', async ({ page }, info) => {
    await tableWithCards(page, info);
    const css = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.querySelector('[data-testid="hud"]')!);
      const canvas = getComputedStyle(document.querySelector('canvas[data-scene="table"]')!);
      const s = root as CSSStyleDeclaration & { webkitTouchCallout?: string; webkitUserSelect?: string };
      return {
        touchAction: html.touchAction,
        overscroll: [html.overscrollBehaviorY, body.overscrollBehaviorY],
        callout: s.webkitTouchCallout ?? null,
        select: s.webkitUserSelect || s.userSelect,
        canvasTouch: canvas.touchAction,
        viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
        safeArea: [...document.styleSheets].some((sh) => {
          try {
            return [...sh.cssRules].some((r) => r.cssText.includes('safe-area-inset'));
          } catch {
            return false;
          }
        }),
      };
    });
    expect(css.touchAction).toBe('manipulation');
    expect(css.overscroll).toEqual(['none', 'none']);
    if (css.callout !== null) expect(css.callout).toBe('none');
    expect(css.select).toBe('none');
    expect(css.canvasTouch).toBe('none');
    expect(css.viewport).toContain('viewport-fit=cover');
    expect(css.safeArea).toBe(true);
    // Text fields still select (the ask field).
    await page.getByTestId('thumb-ask').tap();
    const inputSelect = await page.getByTestId('ask-input').evaluate((n) => getComputedStyle(n).webkitUserSelect || getComputedStyle(n).userSelect);
    expect(inputSelect).not.toBe('none');
    // Safari's page pinch (gesturestart) is cancelled at the table.
    const prevented = await page.evaluate(() => {
      const e = new Event('gesturestart', { cancelable: true, bubbles: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});
