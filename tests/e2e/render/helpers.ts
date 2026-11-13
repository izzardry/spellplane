import { expect, type Page } from '@playwright/test';
import type { HarnessThemeId, RenderHarnessApi } from '../../../src/scene/render-harness';

export type { HarnessThemeId };

/** Every theme the pipeline must carry: the four real ones and the test-only lit theme (PLAN M4-P2). */
export const ALL_THEMES: HarnessThemeId[] = ['lit', 'paper', 'dusk', 'wyrm', 'stonetable'];

/** Open the render harness and wait for the first frame with every face uploaded. Page errors fail the test. */
export async function openRender(page: Page, opts: { theme?: HarnessThemeId; scenario?: 'empty' | 'demo' | 'bench'; quality?: 'high' | 'medium' | 'low' } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const q = new URLSearchParams({ harness: 'render', faces: 'placeholder', scenario: opts.scenario ?? 'empty', theme: opts.theme ?? 'paper', quality: opts.quality ?? 'high' });
  await page.goto(`./?${q.toString()}`);
  await ready(page);
  return errors;
}

/** Wait until the harness drew a frame and every requested face texture is uploaded. */
export async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__renderHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
}

/** Wait until nothing animates and textures are in. */
export async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__renderHarness?.idle() ?? false) && (window.__renderHarness?.ready() ?? false)), { timeout: 15_000 }).toBe(true);
}

/** Call a __renderHarness function (awaiting promises) and return its JSON result. */
export function rh<T = unknown>(page: Page, fn: keyof RenderHarnessApi, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([name, a]) => {
      const h = window.__renderHarness as unknown as Record<string, (...x: unknown[]) => unknown>;
      const v = await h[name as string]!(...(a as unknown[]));
      return JSON.parse(JSON.stringify(v ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;
}

export async function setTheme(page: Page, id: HarnessThemeId): Promise<void> {
  await rh(page, 'setTheme', id);
  await ready(page);
}

/**
 * Average sRGB colour (0..255) of a screen rectangle as displayed, from a real screenshot decoded in the page (the
 * canvas itself cannot be read back: preserveDrawingBuffer is off). `inset` cuts that fraction off each side.
 */
export async function screenAverage(page: Page, rect: { x: number; y: number; width: number; height: number }, inset: number): Promise<[number, number, number]> {
  const clip = { x: rect.x + rect.width * inset, y: rect.y + rect.height * inset, width: rect.width * (1 - 2 * inset), height: rect.height * (1 - 2 * inset) };
  const png = await page.screenshot({ clip, animations: 'allow' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
    }
    return [r / n, g / n, b / n] as [number, number, number];
  }, png.toString('base64'));
}

/** Largest per-channel difference of two average colours as a fraction of full scale. */
export const colourDelta = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!) / 255));

/**
 * The live GPU texture count (renderer.info.memory.textures) once it stopped changing: SDF text builds its glyph atlas
 * in a worker a moment after the first frame, so a count taken right away is not a baseline.
 */
export async function stableTextures(page: Page): Promise<number> {
  let last = -1;
  let same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    const n = (await rh<{ textures: number }>(page, 'stats')).textures;
    same = n === last ? same + 1 : 0;
    last = n;
    await page.waitForTimeout(200);
  }
  return last;
}
