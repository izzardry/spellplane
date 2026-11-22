/**
 * Browser helpers for the attach, carry and clip specs (PLAN Milestone 6, M6-P1). Cards are put on the solo table
 * through the debug hook (as a remote player's actions would arrive); every check reads the state, the log and the
 * debug hook's `clips` part, never pixels or timing.
 */
import { expect, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import type { LogEntry, Pose, TableState } from '../../../src/core/types';
import type { ClipDebugState } from '../../../src/scene/types';
import type { SceneDebugCard } from '../../../src/scene/table-scene';
import { hook } from '../helpers/app';
import { call } from '../solo/helpers';

/** Scryfall ids of the M19 fixtures (tests/fixtures/scryfall/m19.json). */
export const SIDS = ['226f7c45-db9f-4d48-b575-4d2f1904c963', '2f717e04-c078-4696-9ed6-e973033d7be0', 'f4bae0e4-1143-4dc4-afb1-e6b4201ff101', '62d2e929-7ae3-4560-9cfa-53b89c8a6016', 'c2f461b1-c801-4f0c-8fd7-fe68b6078ac6'];

export type Pt = { x: number; y: number };

export const state = (page: Page) => hook<TableState>(page, 'state');
export const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
export const clips = (page: Page) => hook<ClipDebugState>(page, 'clips');

let n = 0;
export async function dispatch(page: Page, a: Record<string, unknown>, by = 's0'): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { by, cid: `e2e-${++n}-${Math.random().toString(36).slice(2, 6)}`, ...a });
}

/** A creature token with a fixture face on a battlefield. */
export async function creature(page: Page, id: string, pose: Pose, sid = SIDS[0]!, zone = 'battlefield:s0'): Promise<void> {
  // The scene registers its debug part after the session does (openSolo waits only for the session).
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.cards === 'function'), { timeout: 15_000 }).toBe(true);
  await dispatch(page, { type: 'createToken', card: id, zone, pose, ref: { sid } });
  await expect.poll(async () => (await shown(page)).some((c) => c.id === id && !c.moving), { timeout: 15_000 }).toBe(true);
}

/** No card animates. */
export async function idle(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving), { timeout: 15_000 }).toBe(true);
}

export async function rect(page: Page, id: string): Promise<SceneDebugCard['screen']> {
  await idle(page);
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c.screen;
}

export async function centre(page: Page, id: string): Promise<Pt> {
  const r = await rect(page, id);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Screen px per table mm along the screen's vertical (a seat-0 card upright in the bird's-eye view). */
export async function pxPerMm(page: Page, id: string): Promise<number> {
  return (await rect(page, id)).height / 88;
}

/** Hover a card (the bare keys act on it). */
export async function hover(page: Page, p: Pt): Promise<void> {
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
}

/** Left-drag from a to b with intermediate moves; `hold` keeps the button down at b (the caller releases). */
export async function mouseDrag(page: Page, a: Pt, b: Pt, opts: { hold?: boolean } = {}): Promise<void> {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (!opts.hold) await page.mouse.up();
}

/** The log's actions (type and fields, without stamps). */
export async function actions(page: Page): Promise<Record<string, unknown>[]> {
  const log = await call<LogEntry[]>(page, 'log');
  return log.filter((e) => e.kind === 'action').map((e) => (e as Extract<LogEntry, { kind: 'action' }>).action as unknown as Record<string, unknown>);
}

/** The centre of a clip on screen (the debug hook's rectangle). */
export async function clipCentre(page: Page, id?: string): Promise<Pt> {
  await idle(page);
  const all = (await clips(page)).clips;
  const c = id ? all.find((x) => x.id === id) : all[0];
  if (!c?.screen) throw new Error('no clip on screen');
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}
