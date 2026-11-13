import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { Action } from '../../../../src/core/actions';
import type { WyrmDebugInstance } from '../../../../src/themes/wyrm/debug';

export type { WyrmDebugInstance };

let cid = 0;
/** Dispatch an action on the render harness's table (its reducer stub, scene/harness-fixture.ts). */
export async function act(page: Page, a: Record<string, unknown>): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { by: 's0', cid: `wy-${++cid}`, ...a });
}

/** Live Wyrm builds through the debug hook (themes/wyrm/debug.ts); [] when none or the part was never registered. */
export function wyrmBuilds(page: Page): Promise<WyrmDebugInstance[]> {
  return page.evaluate(() => (window.__spellplane as { wyrm?: { instances(): unknown[] } } | undefined)?.wyrm?.instances() ?? []) as Promise<WyrmDebugInstance[]>;
}

/** The one live Wyrm build of the page. */
export async function wyrmBuild(page: Page): Promise<WyrmDebugInstance> {
  const all = await wyrmBuilds(page);
  if (all.length !== 1) throw new Error(`expected one live Wyrm build, found ${all.length}`);
  return all[0]!;
}

/** Wait for `n` animation frames. */
export async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(k);
      }),
    n,
  );
}

/** Evidence for review (screenshots are evidence, not baselines): artifacts/shots/M4/wyrm/<name>-<project>.png. */
export async function evidence(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = path.join('artifacts', 'shots', 'M4', 'wyrm');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${info.project.name}.png`), animations: 'allow' });
}

type Rect = { x: number; y: number; width: number; height: number };

/** RGBA bytes of a screen rectangle as displayed (a real screenshot decoded in the page; the canvas has no read-back). */
export async function screenPixels(page: Page, rect: Rect): Promise<number[]> {
  const png = await page.screenshot({ clip: rect, animations: 'allow' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
  }, png.toString('base64'));
}

/** Largest channel difference between two equally sized RGBA arrays, 0..255. */
export function maxChannelDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('pixel arrays differ in size');
  let m = 0;
  for (let i = 0; i < a.length; i++) if ((i & 3) !== 3) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

/** A rectangle shrunk by `inset` (fraction of each side). */
export const inner = (r: Rect, inset: number): Rect => ({ x: r.x + r.width * inset, y: r.y + r.height * inset, width: r.width * (1 - 2 * inset), height: r.height * (1 - 2 * inset) });
