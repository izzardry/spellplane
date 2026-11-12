/**
 * Touch on the draft table (DESIGN "Input and interaction design": "tablets with touch are fully supported"; Touch:
 * "Tap selects", "two-finger gestures always drive the camera"; "Camera and navigation": two-finger pinch zooms,
 * centred between the fingers). A tap marks a pack card, a held touch inspects it (touch has no hover key or middle
 * button), and two fingers zoom and pan without marking anything. Touches are synthetic pointer events, so the
 * timing does not depend on the runner's round trips.
 */
import { expect, test, type Page } from '@playwright/test';
import { dh, openDraft, settled } from './bundle';

const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');
const calls = async (page: Page) => (await dh(page, 'calls')).map((c) => [c.method, ...c.args]);

type Step = { type: 'pointerdown' | 'pointermove' | 'pointerup'; id: number; x: number; y: number; waitMs?: number };

/** Fire touch pointer events at the draft canvas, in order, waiting `waitMs` after a step where given. */
async function touch(page: Page, steps: Step[]): Promise<void> {
  await page.evaluate(async (list) => {
    const canvas = document.querySelector('canvas[data-scene="draft"]')!;
    for (const s of list) {
      canvas.dispatchEvent(
        new PointerEvent(s.type, { pointerId: s.id, pointerType: 'touch', isPrimary: s.id === 1, clientX: s.x, clientY: s.y, button: 0, buttons: s.type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }),
      );
      await new Promise((r) => setTimeout(r, s.waitMs ?? 16));
    }
  }, steps);
}

/** Two fingers from (x ± d0, y) to (x + dx ± d1, y + dy), in eight steps. */
function twoFingers(x: number, y: number, d0: number, d1: number, dx = 0, dy = 0): Step[] {
  const steps: Step[] = [
    { type: 'pointerdown', id: 1, x: x - d0, y },
    { type: 'pointerdown', id: 2, x: x + d0, y },
  ];
  for (let i = 1; i <= 8; i++) {
    const d = d0 + ((d1 - d0) * i) / 8;
    const cx = x + (dx * i) / 8;
    const cy = y + (dy * i) / 8;
    steps.push({ type: 'pointermove', id: 1, x: cx - d, y: cy, waitMs: 0 }, { type: 'pointermove', id: 2, x: cx + d, y: cy });
  }
  const end = { x: x + dx, y: y + dy };
  steps.push({ type: 'pointerup', id: 1, x: end.x - d1, y: end.y }, { type: 'pointerup', id: 2, x: end.x + d1, y: end.y });
  return steps;
}

test.describe('touch on the draft table', () => {
  test('two fingers pinch-zoom around the point between them, and pan; a pinch on a card never marks it', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    const [a] = await packCards(page);
    const x = a!.screen.x + a!.screen.width / 2;
    const y = a!.screen.y + a!.screen.height / 2;
    const v0 = (await dh(page, 'camera'))!;

    // Fingers spread from 40 px to 240 px apart, centred on the card: the view closes in, the card stays put.
    await touch(page, twoFingers(x, y, 20, 120));
    await settled(page);
    const v1 = (await dh(page, 'camera'))!;
    expect(v1.dist).toBeLessThan(v0.dist * 0.5);
    const zoomed = (await packCards(page)).find((c) => c.id === a!.id)!;
    expect(zoomed.screen.height).toBeGreaterThan(a!.screen.height * 2);
    expect(zoomed.screen.x).toBeLessThan(x);
    expect(zoomed.screen.right).toBeGreaterThan(x);
    expect(zoomed.screen.y).toBeLessThan(y);
    expect(zoomed.screen.bottom).toBeGreaterThan(y);
    expect(await calls(page)).toEqual([]);

    // Two fingers moving together pan the table with them, at the same zoom.
    await touch(page, twoFingers(x, y, 60, 60, -150, 0));
    await settled(page);
    const v2 = (await dh(page, 'camera'))!;
    expect(v2.dist).toBeCloseTo(v1.dist, 0);
    expect(v2.cx).toBeGreaterThan(v1.cx);
    const panned = (await packCards(page)).find((c) => c.id === a!.id)!;
    expect(panned.screen.x).toBeCloseTo(zoomed.screen.x - 150, -1);
    expect(await calls(page)).toEqual([]);
    expect(await dh(page, 'picks')).toEqual([]);

    // Pinching in again zooms back out.
    await touch(page, twoFingers(x, y, 120, 20));
    await settled(page);
    expect((await dh(page, 'camera'))!.dist).toBeGreaterThan(v2.dist * 2);
  });

  test('a second finger turns a one-finger press into a camera gesture: lifting it marks nothing', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    const [a] = await packCards(page);
    const x = a!.screen.x + a!.screen.width / 2;
    const y = a!.screen.y + a!.screen.height / 2;
    await touch(page, [
      { type: 'pointerdown', id: 1, x, y },
      { type: 'pointerdown', id: 2, x: x + 80, y },
      { type: 'pointerup', id: 2, x: x + 80, y },
      { type: 'pointerup', id: 1, x, y },
    ]);
    expect(await calls(page)).toEqual([]);
  });

  test('a tap marks a card and a second tap takes it; a held touch inspects instead', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    const [a, b] = await packCards(page);
    const at = (c: typeof a) => ({ x: c!.screen.x + c!.screen.width / 2, y: c!.screen.y + c!.screen.height / 2 });

    // Hold: the inspect view opens and the release marks nothing.
    const pb = at(b);
    await touch(page, [
      { type: 'pointerdown', id: 1, ...pb, waitMs: 700 },
      { type: 'pointerup', id: 1, ...pb },
    ]);
    await expect(page.getByTestId('inspect')).toBeVisible();
    expect(await calls(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inspect')).toHaveCount(0);

    // Tap, tap: marked, then taken.
    const pa = at(a);
    await touch(page, [
      { type: 'pointerdown', id: 1, ...pa },
      { type: 'pointerup', id: 1, ...pa },
    ]);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([a!.id]);
    await settled(page);
    const marked = (await packCards(page)).find((c) => c.id === a!.id)!;
    const pm = at(marked);
    await touch(page, [
      { type: 'pointerdown', id: 1, ...pm },
      { type: 'pointerup', id: 1, ...pm },
    ]);
    await expect.poll(async () => (await dh(page, 'picks')).map((p) => p.cards)).toEqual([[a!.id]]);
  });
});
