/**
 * PLAN Milestone 5, owner decisions, Ego framing: "The ego seat is reframed (pulled back, raised or widened, within
 * DESIGN's limits) so your own pile column (library, graveyard, exile, command) and your whole battlefield row are on
 * screen at the default ego view, at 1440x900 and on an iPad landscape viewport." (M5-P7; scene/types.ts
 * EGO_FRAMING_VIEWPORTS.) DESIGN "Camera and navigation", Ego perspective: pitched about 35°, field of view 45°.
 *
 * The real table scene opened in the ego rig at its default view (`?harness=scene&rig=ego`), for the 1v1 harness table
 * and the three-, four-seat and Two-Headed Giant tables, from two seats each; the corners of the own territory, pile
 * column and command area are read projected on screen from the debug hook (`tableView().seats[].zones`).
 */
import { devices, expect, test, type Page } from '@playwright/test';
import type { DebugTableView } from '../../../src/scene/lines';

const CASES: { format: string | null; viewers: string[] }[] = [
  { format: null, viewers: ['s0', 's1'] },
  { format: 'ffa3', viewers: ['s0', 's2'] },
  { format: 'ffa4', viewers: ['s0', 's1'] },
  { format: '2hg', viewers: ['s0', 's3'] },
];

async function openEgo(page: Page, format: string | null, viewer: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'scene', viewer, rig: 'ego' });
  if (format) q.set('format', format);
  await page.goto(`./?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
  expect(errors).toEqual([]);
}

async function expectOwnPilesOnScreen(page: Page, viewer: string, label: string): Promise<void> {
  expect(await page.evaluate(() => window.__spellplane!.rig!.rig())).toBe('ego');
  const pose = await page.evaluate(() => window.__spellplane!.rig!.pose());
  // The default ego view, within DESIGN's limits.
  expect(pose.pitchDeg).toBeCloseTo(35, 6);
  expect(pose.fovDeg).toBe(45);
  const v = (await page.evaluate(() => window.__spellplane!.tableView!())) as DebugTableView;
  const own = v.seats.find((s) => s.seat === viewer)!;
  expect(own.zones, label).toBeDefined();
  const vp = page.viewportSize()!;
  for (const [zone, corners] of Object.entries(own.zones!)) {
    expect(corners).toHaveLength(4);
    for (const c of corners) {
      expect(c, `${label}: ${zone} corner in front of the camera`).not.toBeNull();
      expect(c!.x, `${label}: ${zone} x`).toBeGreaterThanOrEqual(4);
      expect(c!.x, `${label}: ${zone} x`).toBeLessThanOrEqual(vp.width - 4);
      expect(c!.y, `${label}: ${zone} y`).toBeGreaterThanOrEqual(4);
      expect(c!.y, `${label}: ${zone} y`).toBeLessThanOrEqual(vp.height - 4);
    }
  }
  // Still an ego view of the own seat: its near edge in the lower part of the screen.
  const nearY = Math.max(...own.zones!.territory.map((c) => c!.y));
  expect(nearY, `${label}: near edge low on screen`).toBeGreaterThan(vp.height * 0.6);
}

test.describe('the default ego view at 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const { format, viewers } of CASES) {
    for (const viewer of viewers) {
      test(`${format ?? '1v1'}, seat ${viewer}: own pile column, command area and battlefield row on screen`, async ({ page }) => {
        await openEgo(page, format, viewer);
        await expectOwnPilesOnScreen(page, viewer, `${format ?? '1v1'} ${viewer}`);
      });
    }
  }
});

// iPad Pro 11" in landscape (1194 x 834, touch), the owner's tablet; the browser is the project's (WebKit is Safari's).
const { defaultBrowserType: _browser, ...ipad } = devices['iPad Pro 11 landscape'];

test.describe('the default ego view on an iPad in landscape', () => {
  test.use(ipad);
  for (const { format, viewers } of CASES) {
    for (const viewer of viewers) {
      test(`${format ?? '1v1'}, seat ${viewer}: own pile column, command area and battlefield row on screen`, async ({ page }) => {
        expect(page.viewportSize()).toEqual({ width: 1194, height: 834 });
        await openEgo(page, format, viewer);
        await expectOwnPilesOnScreen(page, viewer, `iPad ${format ?? '1v1'} ${viewer}`);
      });
    }
  }
});
