/**
 * Touch keeps its gestures on the one continuous tilt (PLAN Milestone 7, Owner decisions, Mouse controls: "touch keeps
 * its gestures (pinch zooms, two-finger vertical swipe tilts)"; PLAN Milestone 8, M7-P1 Camera: "the two-finger swipe
 * tilts"). iPad emulation in WebKit (PLAN M5), the scene harness, read through the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import { openScene, screenOf, settle } from '../scene/helpers';
import { IPAD, fingers, twoFingers } from '../touch/helpers';

test.use(IPAD);
test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');

const tilt = (page: Page) => page.evaluate(() => window.__sceneHarness!.camera.tilt!());

test('a two-finger vertical swipe tilts from mid-tilt, both ways; a pinch zooms and leaves the tilt', async ({ page }) => {
  await openScene(page);
  await page.evaluate(() => window.__sceneHarness!.camera.setTilt!(0.5, { animate: false }));
  await settle(page);
  const vp = page.viewportSize()!;
  const x = Math.round(vp.width / 2);
  const y = Math.round(vp.height * 0.45);
  await test.step('swipe up: toward first person', async () => {
    await fingers(page, twoFingers({ x: x - 60, y }, { x: x + 60, y }, { x: x - 60, y: y - 100 }, { x: x + 60, y: y - 100 }));
    await settle(page);
    expect(await tilt(page)).toBeLessThan(0.4);
  });
  const mid = await tilt(page);
  await test.step('swipe down: toward bird’s-eye', async () => {
    await fingers(page, twoFingers({ x: x - 60, y: y - 100 }, { x: x + 60, y: y - 100 }, { x: x - 60, y: y + 60 }, { x: x + 60, y: y + 60 }));
    await settle(page);
    expect(await tilt(page)).toBeGreaterThan(mid + 0.15);
  });
  await test.step('pinch: zoom, same tilt', async () => {
    const t0 = await tilt(page);
    const a0 = await screenOf(page, -100, 0);
    const b0 = await screenOf(page, 100, 0);
    await fingers(page, twoFingers({ x: x - 40, y }, { x: x + 40, y }, { x: x - 160, y }, { x: x + 160, y }));
    await settle(page);
    const a1 = await screenOf(page, -100, 0);
    const b1 = await screenOf(page, 100, 0);
    expect(Math.hypot(b1.x - a1.x, b1.y - a1.y)).toBeGreaterThan(Math.hypot(b0.x - a0.x, b0.y - a0.y) * 1.2);
    expect(await tilt(page)).toBeCloseTo(t0, 2);
  });
});
