/**
 * The one continuous tilt by mouse, wheel, touch and keys (PLAN Milestone 7, Owner decisions, Mouse controls: "The mouse
 * wheel zooms (toward the cursor). Left-click dragging stays as it is … Right-click dragging on the empty table orbits
 * vertically, between first person (front view) and bird's-eye (top view); horizontal movement does not turn the view.
 * There is no free look-around"; "touch keeps its gestures (pinch zooms, two-finger vertical swipe tilts)"; PLAN
 * Milestone 8, M7-P1 Camera). In the scene harness, read through the debug hook (`rig.pose`, `camera.tilt`), never on
 * pixels or timing.
 */
import { expect, test, type Page } from '@playwright/test';
import type { CameraPose } from '../../../src/scene/types';
import { openScene, screenOf, settle } from '../scene/helpers';

const tilt = (page: Page) => page.evaluate(() => window.__sceneHarness!.camera.tilt!());
const pose = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { rig: { pose(): CameraPose } }).rig.pose());
const setTilt = async (page: Page, t: number) => {
  await page.evaluate((v) => window.__sceneHarness!.camera.setTilt!(v, { animate: false }), t);
  await settle(page);
};
/** The screen direction of the table's x axis around a point: a yaw turns it, a tilt or zoom does not. */
async function heading(page: Page): Promise<number> {
  const a = await screenOf(page, -200, 0);
  const b = await screenOf(page, 200, 0);
  return Math.atan2(b.y - a.y, b.x - a.x);
}
/** A point of empty table between the two territories, on screen. */
const emptyPoint = (page: Page) => screenOf(page, 0, 0);

async function rightDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
  await page.mouse.up({ button: 'right' });
  await settle(page);
}

test.describe('tilt by mouse', () => {
  test('a vertical right-drag on the empty table tilts: down toward bird’s-eye, up toward first person; no context menu', async ({ page }) => {
    await openScene(page);
    await setTilt(page, 0.5);
    const t0 = await tilt(page);
    await rightDrag(page, await emptyPoint(page), 0, -90);
    const t1 = await tilt(page);
    expect(t1).toBeLessThan(t0 - 0.1);
    await rightDrag(page, await emptyPoint(page), 0, 140);
    expect(await tilt(page)).toBeGreaterThan(t1 + 0.2);
    expect((await page.evaluate(() => window.__sceneHarness!.events())).filter((e) => e.type === 'contextMenu')).toEqual([]);
  });

  test('a horizontal right-drag leaves yaw (and tilt) unchanged: no free look-around', async ({ page }) => {
    await openScene(page);
    for (const t of [0, 0.5, 1]) {
      await setTilt(page, t);
      const h0 = await heading(page);
      const p0 = await pose(page);
      await rightDrag(page, await emptyPoint(page), 220, 0);
      expect(Math.abs((await heading(page)) - h0), `heading at tilt ${t}`).toBeLessThan(1e-3);
      expect((await pose(page)).pitchDeg).toBeCloseTo(p0.pitchDeg, 3);
      expect(await tilt(page)).toBeCloseTo(t, 3);
    }
  });

  test('the wheel zooms toward the cursor and leaves the tilt alone, at every tilt', async ({ page }) => {
    await openScene(page);
    for (const t of [0, 0.5, 1]) {
      await setTilt(page, t);
      const at = await screenOf(page, 120, -80);
      const a0 = await screenOf(page, -100, 0);
      const b0 = await screenOf(page, 100, 0);
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel(0, -300);
      await settle(page);
      const a1 = await screenOf(page, -100, 0);
      const b1 = await screenOf(page, 100, 0);
      expect(Math.hypot(b1.x - a1.x, b1.y - a1.y), `zoomed in at tilt ${t}`).toBeGreaterThan(Math.hypot(b0.x - a0.x, b0.y - a0.y) * 1.05);
      // Toward the cursor: the table point under it stays near it.
      const still = await screenOf(page, 120, -80);
      expect(Math.hypot(still.x - at.x, still.y - at.y), `cursor point at tilt ${t}`).toBeLessThan(12);
      expect(await tilt(page)).toBeCloseTo(t, 3);
    }
  });

  test('a left-drag on the empty table still moves the view and never tilts', async ({ page }) => {
    await openScene(page);
    await setTilt(page, 0.5);
    const from = await emptyPoint(page);
    const p0 = await pose(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 12 * i, from.y + 6 * i);
    await page.mouse.up();
    await settle(page);
    const p1 = await pose(page);
    expect(Math.hypot(p1.position[0] - p0.position[0], p1.position[1] - p0.position[1])).toBeGreaterThan(5);
    expect(await tilt(page)).toBeCloseTo(0.5, 3);
  });

  test('keys are accelerators: the preset keys and P still move the tilt', async ({ page }) => {
    await openScene(page);
    await setTilt(page, 1);
    await page.mouse.move(400, 300);
    await page.keyboard.press('p');
    await settle(page);
    expect(await tilt(page)).toBeLessThan(0.5);
    await page.keyboard.press('p');
    await settle(page);
    expect(await tilt(page)).toBeGreaterThan(0.5);
  });
});
