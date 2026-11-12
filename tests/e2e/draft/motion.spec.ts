/**
 * Camera motion and theme on the draft table (DESIGN "Camera and navigation": "Motion uses critically damped springs
 * with release inertia on pan"; "Input and interaction design", Accessibility: reduced motion; "Themes and rendering":
 * the theme's card back). A pan released while moving glides on, but not under reduced motion; a change of the system's
 * reduced-motion setting reaches the surface while it is open; a new theme's card back reaches the waiting packs.
 */
import { expect, test, type Page } from '@playwright/test';
import { dh, openDraft, settled } from './bundle';

/** A quick mouse drag on the draft canvas, released while still moving (synthetic events, timing independent of the runner). */
async function flick(page: Page, x: number, y: number, dx: number): Promise<void> {
  await page.evaluate(
    async ([x0, y0, d]) => {
      const canvas = document.querySelector('canvas[data-scene="draft"]')!;
      const fire = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      fire('pointerdown', x0, y0);
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 10));
        fire('pointermove', x0 + (d * i) / 6, y0);
      }
      fire('pointerup', x0 + d, y0);
    },
    [x, y, dx] as const,
  );
}

async function zoomedIn(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('canvas[data-scene="draft"]').boundingBox())!;
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await settled(page);
  return p;
}

test.describe('motion on the draft table', () => {
  test('a released pan glides on (release inertia); under reduced motion it stops where released', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    const p = await zoomedIn(page);
    const v0 = (await dh(page, 'camera'))!;
    await flick(page, p.x, p.y, -150);
    expect(await dh(page, 'flinging')).toBe(true);
    const released = (await dh(page, 'camera'))!;
    expect(released.cx).toBeGreaterThan(v0.cx);
    await settled(page);
    const glided = (await dh(page, 'camera'))!;
    expect(glided.cx).toBeGreaterThan(released.cx + 1);
    expect(await dh(page, 'calls')).toEqual([]);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => dh(page, 'reducedMotion')).toBe(true);
    await flick(page, p.x, p.y, 150);
    expect(await dh(page, 'flinging')).toBe(false);
    const still = (await dh(page, 'camera'))!;
    await settled(page);
    expect((await dh(page, 'camera'))!.cx).toBeCloseTo(still.cx, 6);
  });

  test('the surface follows the system’s reduced-motion setting while open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    expect(await dh(page, 'reducedMotion')).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => dh(page, 'reducedMotion')).toBe(false);
  });

  test('a new theme’s card back reaches the waiting-pack piles, and the faces load again', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben,Cleo' });
    await settled(page);
    const before = await dh(page, 'back');
    expect(before).not.toBe('test-back');
    const shown = (await dh(page, 'cards')).length;
    await dh(page, 'setBack', 'test-back');
    expect(await dh(page, 'back')).toBe('test-back');
    await settled(page);
    expect(await dh(page, 'cards')).toHaveLength(shown);
    expect((await dh(page, 'queues')).every((q) => q.drawn === q.count)).toBe(true);
  });
});
