/**
 * PLAN Milestone 5, owner decisions: "Three-player layout: opponents top-left and top-right from every seat, as DESIGN's
 * format table says … every viewer sees the same shape." (M5-P7; DESIGN "Players, seats and formats": three players,
 * "You at the bottom, opponents at top-left and top-right"; per player, clockwise.)
 *
 * The real table scene (`?harness=scene&format=ffa3&viewer=s0|s1|s2`) from each of the three seats, in the bird's-eye
 * view the scene opens with and in the ego view (P): the own territory at the bottom, the next seat clockwise at the
 * top-left, the last at the top-right, and every point of that arrangement at the same place on screen from every seat.
 * Positions come from the debug hook (`tableView`), never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { DebugTableView } from '../../../src/scene/lines';

const SEATS = ['s0', 's1', 's2'];

async function openSeat(page: Page, viewer: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format: 'ffa3', viewer }).toString()}`);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  await idle(page);
  expect(errors).toEqual([]);
}
async function idle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
}
const tableView = (page: Page) => page.evaluate(() => window.__spellplane!.tableView!()) as Promise<DebugTableView>;

type Shape = { territory: { x: number; y: number }; avatar: { x: number; y: number } }[];

/** Where the viewer sees itself (k = 0), the next seat clockwise (1) and the last (2), on screen. */
async function shape(page: Page, viewer: string): Promise<Shape> {
  const v = await tableView(page);
  const i = SEATS.indexOf(viewer);
  return [0, 1, 2].map((k) => {
    const s = v.seats.find((x) => x.seat === SEATS[(i + k) % 3])!;
    expect(s.screen, `seat ${s.seat}`).not.toBeNull();
    return { territory: s.screen!.territory, avatar: s.screen!.avatar };
  });
}

function expectArrangement(sh: Shape, vp: { width: number; height: number }, label: string): void {
  const [me, next, last] = sh as [Shape[0], Shape[0], Shape[0]];
  expect(me.territory.y, `${label}: own seat in the lower half`).toBeGreaterThan(vp.height / 2);
  expect(Math.abs(me.territory.x - vp.width / 2), `${label}: own seat centred`).toBeLessThan(vp.width * 0.15);
  expect(me.avatar.y, `${label}: own avatar under the own territory`).toBeGreaterThan(me.territory.y);
  expect(next.territory.x, `${label}: next seat on the left`).toBeLessThan(me.territory.x - 100);
  expect(next.territory.y, `${label}: next seat above`).toBeLessThan(me.territory.y);
  expect(last.territory.x, `${label}: last seat on the right`).toBeGreaterThan(me.territory.x + 100);
  expect(last.territory.y, `${label}: last seat above`).toBeLessThan(me.territory.y);
}

for (const rig of ['birdseye', 'ego'] as const) {
  test(`three players, ${rig}: from seats 1, 2 and 3 the opponents sit top-left and top-right, the same shape for all`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const shapes: Shape[] = [];
    for (const viewer of SEATS) {
      const page = await context.newPage();
      await openSeat(page, viewer);
      const v = await tableView(page);
      expect(v.format).toBe('ffa3');
      expect(v.viewerAngle).toBe([0, 120, 240][SEATS.indexOf(viewer)]);
      if (rig === 'ego') {
        await page.keyboard.press('p');
        await expect.poll(() => page.evaluate(() => window.__spellplane!.rig!.rig())).toBe('ego');
        await expect.poll(() => page.evaluate(() => window.__spellplane!.rig!.blend())).toBeNull();
        // Fit (0) brings the ego rig back to the seat, whatever point the switch held.
        await page.keyboard.press('0');
      }
      await idle(page);
      const sh = await shape(page, viewer);
      expectArrangement(sh, { width: 1440, height: 900 }, `viewer ${viewer}`);
      shapes.push(sh);
      await page.close();
    }
    // Every seat sees the same shape: each point within a pixel of where seat 1 (s0) sees its counterpart.
    for (let v = 1; v < 3; v++) {
      for (let k = 0; k < 3; k++) {
        for (const part of ['territory', 'avatar'] as const) {
          expect(Math.abs(shapes[v]![k]![part].x - shapes[0]![k]![part].x), `viewer s${v} seat +${k} ${part} x`).toBeLessThan(1);
          expect(Math.abs(shapes[v]![k]![part].y - shapes[0]![k]![part].y), `viewer s${v} seat +${k} ${part} y`).toBeLessThan(1);
        }
      }
    }
    await context.close();
  });
}

test('three players: the seat keys still go clockwise from every seat (2 is the top-left seat)', async ({ page }) => {
  for (const viewer of SEATS) {
    await openSeat(page, viewer);
    const v = await tableView(page);
    const next = v.seats.find((s) => s.seat === SEATS[(SEATS.indexOf(viewer) + 1) % 3])!;
    await page.keyboard.press('2');
    await idle(page);
    const c = (await tableView(page)).camera;
    // The camera centres the next seat clockwise: the closest territory to the view centre.
    const d = (s: { territory: { x: number; y: number } }) => Math.hypot(c.x - s.territory.x, c.y - s.territory.y);
    for (const s of v.seats) if (s.seat !== next.seat) expect(d(next)).toBeLessThan(d(s));
    const sh = await shape(page, viewer);
    // It sits top-left of the own seat in the fitted arrangement, so the camera moved up and to the left.
    expect(sh[1]!.territory.y).toBeGreaterThan(0);
  }
});
