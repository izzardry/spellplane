import { expect, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import type { Pose, TableState } from '../../../src/core/types';
import type { SceneHarnessApi } from '../../../src/scene/harness';
import type { SceneDebugCard } from '../../../src/scene/table-scene';

export type Scenario = 'demo' | 'bench' | 'empty';

/** Open the scene harness and wait until the first frame is drawn and textures are uploaded. */
export async function openScene(page: Page, opts: { scenario?: Scenario; viewer?: 's0' | 's1' | 'none' } = {}): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'scene', scenario: opts.scenario ?? 'empty' });
  if (opts.viewer) q.set('viewer', opts.viewer);
  await page.goto(`./?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
}

/** Call a __sceneHarness function in the page. */
export function harness<K extends keyof SceneHarnessApi>(page: Page, fn: K, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(([name, a]) => {
    const h = window.__sceneHarness as unknown as Record<string, (...x: unknown[]) => unknown>;
    return JSON.parse(JSON.stringify(h[name as string]!(...(a as unknown[])) ?? null)) as unknown;
  }, [fn, args] as const);
}

export const state = (page: Page) => page.evaluate(() => window.__spellplane!.state!()) as Promise<TableState>;
export const cards = (page: Page) => harness(page, 'cards') as Promise<SceneDebugCard[]>;
export const card = async (page: Page, id: string) => (await cards(page)).find((c) => c.id === id);
export const actions = (page: Page) => harness(page, 'actions') as Promise<Record<string, unknown>[]>;

let n = 0;
/** Put a card on the table through the hook (as if another action created it). */
export async function addCard(page: Page, id: string, pose: Pose, zone = 'battlefield:s0', sid = `fx-${100 + ++n}`): Promise<void> {
  const action: Action = { type: 'createToken', by: 's0', cid: `t-${id}`, card: id, zone, pose, ref: { sid } };
  await page.evaluate((a) => window.__spellplane!.dispatch!(a), action);
}

export async function dispatch(page: Page, action: Action): Promise<void> {
  await page.evaluate((a) => window.__spellplane!.dispatch!(a), action);
}

/** Screen point (CSS px) of a table point, rounded to whole pixels like real pointer input. */
export async function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const p = (await harness(page, 'toScreen', x, y)) as { x: number; y: number };
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export async function tableOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return (await harness(page, 'toTable', x, y)) as { x: number; y: number };
}

/** Wait until nothing animates. */
export async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
}

/** Zoom the camera so 1 mm is several pixels around a table point (precise pointer placement). */
export async function zoomTo(page: Page, x: number, y: number, factor: number): Promise<void> {
  await page.evaluate(
    ([px, py, f]) => {
      const h = window.__sceneHarness!;
      h.camera.fit(false);
      const s = h.toScreen(px!, py!)!;
      h.camera.zoomAt(s.x, s.y, f!);
    },
    [x, y, factor] as const,
  );
  // Centre the point: pan by the difference.
  const s = await harness(page, 'toScreen', x, y) as { x: number; y: number };
  const vp = page.viewportSize()!;
  await page.evaluate(([dx, dy]) => window.__sceneHarness!.camera.panBy(dx!, dy!), [vp.width / 2 - s.x, vp.height / 2 - s.y] as const);
  await settle(page);
}

/**
 * Drag with the mouse from the table point `from` (grabbing there) to the table point `to`, with real pointer
 * events. Returns the screen points used.
 */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { ctrl?: boolean; alt?: boolean; steps?: number } = {}) {
  const a = await screenOf(page, from.x, from.y);
  const b = await screenOf(page, to.x, to.y);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) / 2, a.y + (b.y - a.y) / 2, { steps: opts.steps ?? 6 });
  await page.mouse.move(b.x, b.y, { steps: opts.steps ?? 6 });
  if (opts.ctrl) await page.keyboard.down('Control');
  await page.mouse.up();
  if (opts.ctrl) await page.keyboard.up('Control');
  if (opts.alt) await page.keyboard.up('Alt');
  return { a, b };
}

export const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
