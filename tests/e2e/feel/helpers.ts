/**
 * Browser helpers for the card-feel specs (PLAN Milestone 7, M7-P4 Card feel). Everything is read from the debug hook
 * (`motion()`, `cards()`, `render.framesDrawn()`, the state), never from pixels or timing; mid-animation moments are
 * caught with Playwright's fake clock, so nothing depends on how fast a machine renders.
 */
import { expect, type Page } from '@playwright/test';
import type { MotionDebugState } from '../../../src/scene/types';
import type { SceneDebugCard } from '../../../src/scene/table-scene';
import { hook } from '../helpers/app';

export type Pt = { x: number; y: number };

export const motion = (page: Page) => hook<MotionDebugState>(page, 'motion');
export const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
export const framesDrawn = (page: Page) => hook<number>(page, 'render.framesDrawn');
export const shownCard = async (page: Page, id: string) => (await shown(page)).find((c) => c.id === id);

/** Nothing animates: no animation runs and nothing holds frames. */
export async function motionIdle(page: Page): Promise<void> {
  await expect.poll(async () => {
    const m = await motion(page);
    return m.running.length === 0 && m.holds.length === 0;
  }, { timeout: 15_000 }).toBe(true);
}

/**
 * Render on demand (PLAN Milestone 7, gate M7-G: "Idle frames stop"): once nothing moves, the scene draws no frame
 * across an idle wait. Polled, so a last frame in flight is allowed to land; it fails only if frames keep coming.
 */
export async function idleFramesStop(page: Page): Promise<void> {
  await motionIdle(page);
  await expect
    .poll(
      async () => {
        const a = await framesDrawn(page);
        await page.waitForTimeout(400);
        const b = await framesDrawn(page);
        return b - a;
      },
      { timeout: 15_000 },
    )
    .toBe(0);
}

/** Stop the page's clock (installed before the page loaded): frames run only through `step`. */
export async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  await page.clock.runFor(32);
}

/** Advance the paused clock by `ms` in frame-sized steps. */
export async function step(page: Page, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(16);
}

/** Step the paused clock until `pred` holds on the motion state (at most `maxMs`); returns that state. */
export async function stepUntil(page: Page, pred: (m: MotionDebugState) => boolean, maxMs = 1500): Promise<MotionDebugState> {
  for (let t = 0; t <= maxMs; t += 16) {
    const m = await motion(page);
    if (pred(m)) return m;
    await page.clock.runFor(16);
  }
  throw new Error('the motion state never reached the expected moment');
}

export const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
