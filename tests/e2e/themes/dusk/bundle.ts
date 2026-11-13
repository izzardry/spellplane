/**
 * Node-side helpers for Dusk's Playwright specs (like tests/e2e/builder/bundle.ts): bundles ./page.ts from source with
 * Vite and the Svelte plugin (once per worker) and serves it, through a Playwright route, as a page on the app's own
 * origin; plus screenshot measurement (decoded in the page, so no image library is needed). Nothing touches the
 * network: every request that leaves localhost is recorded and fails the spec.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import type { DuskPageApi } from './page';

let code: Promise<string> | null = null;

async function build1(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [svelte({ emitCss: false })],
    define: { __SPELLPLANE_DEBUG__: 'true' },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.resolve('tests/e2e/themes/dusk/page.ts'), formats: ['es'], fileName: 'page' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('dusk page bundle has no entry chunk');
  return chunk.code;
}

export interface Opened {
  /** Console errors and page errors seen so far. */
  errors: string[];
  /** Requests that left localhost (must stay empty: tests never use the network). */
  external: string[];
  /** Every URL the page requested. */
  requests: string[];
}

/** Open the Dusk page (reduced motion on unless asked otherwise) and wait for its first frame with every face uploaded. */
export async function openDusk(page: Page, query: { theme?: 'dusk' | 'paper'; quality?: 'high' | 'medium' | 'low' } = {}, opts: { reducedMotion?: boolean } = {}): Promise<Opened> {
  code ??= build1();
  const js = await code;
  const opened: Opened = { errors: [], external: [], requests: [] };
  page.on('pageerror', (e) => opened.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') opened.errors.push(m.text());
  });
  page.on('request', (r) => {
    opened.requests.push(r.url());
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.protocol !== 'blob:' && u.protocol !== 'data:') opened.external.push(r.url());
  });
  if (opts.reducedMotion !== false) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/dusk-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>dusk harness</title></head><body><div id="app"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
  const q = new URLSearchParams({ theme: query.theme ?? 'dusk', quality: query.quality ?? 'high' });
  await page.goto(`./dusk-harness.html?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => window.__dusk?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  return opened;
}

/** Call a member of window.__dusk (awaiting promises) and return its JSON result. */
export function dusk<T = unknown>(page: Page, fn: keyof DuskPageApi, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([name, a]) => {
      const h = window.__dusk as unknown as Record<string, (...x: unknown[]) => unknown>;
      const v = await h[name as string]!(...(a as unknown[]));
      return JSON.parse(JSON.stringify(v ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;
}

/** Call a part of window.__spellplane (e.g. 'cards', 'drawnLines', 'stack'). */
export function hookCall<T = unknown>(page: Page, part: string): Promise<T> {
  return page.evaluate((p) => {
    const f = (window.__spellplane as unknown as Record<string, () => unknown>)[p]!;
    return JSON.parse(JSON.stringify(f() ?? null)) as unknown;
  }, part) as Promise<T>;
}

/** Wait until nothing animates, every face texture is in, and a fresh frame reached the screen. */
export async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await expect.poll(() => page.evaluate(() => (window.__dusk?.idle() ?? false) && (window.__dusk?.ready() ?? false)), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => window.__dusk!.redraw());
    if (await page.evaluate(() => window.__dusk!.idle() && window.__dusk!.ready())) return;
  }
  throw new Error('the dusk page never settled');
}

export type Rect = { x: number; y: number; width: number; height: number };

/** The union of rectangles grown by `margin` and clipped to the viewport. */
export function unionRect(rects: Rect[], margin: number, vp: { width: number; height: number }): Rect {
  const x0 = Math.max(0, Math.min(...rects.map((r) => r.x)) - margin);
  const y0 = Math.max(0, Math.min(...rects.map((r) => r.y)) - margin);
  const x1 = Math.min(vp.width, Math.max(...rects.map((r) => r.x + r.width)) + margin);
  const y1 = Math.min(vp.height, Math.max(...rects.map((r) => r.y + r.height)) + margin);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** A viewport screenshot as base64 PNG. */
export async function shot(page: Page): Promise<string> {
  return (await page.screenshot({ animations: 'allow', caret: 'hide' })).toString('base64');
}

/**
 * The fraction of a region's pixels whose largest channel difference between two screenshots exceeds `delta`
 * (themes/signals.ts SignalThreshold). Decoded in the page; `region` in CSS px, scaled to the screenshot's pixels.
 */
export function changedFraction(page: Page, a: string, b: string, region: Rect, delta: number): Promise<number> {
  return page.evaluate(
    async ({ a, b, region, delta }) => {
      const decode = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const scale = img.naturalWidth / innerWidth;
        const x = Math.round(region.x * scale);
        const y = Math.round(region.y * scale);
        const w = Math.max(1, Math.round(region.width * scale));
        const h = Math.max(1, Math.round(region.height * scale));
        return ctx.getImageData(x, y, w, h).data;
      };
      const [p, q] = [await decode(a), await decode(b)];
      let changed = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i]! - q[i]!), Math.abs(p[i + 1]! - q[i + 1]!), Math.abs(p[i + 2]! - q[i + 2]!));
        if (d > delta) changed++;
      }
      return changed / (p.length / 4);
    },
    { a, b, region, delta },
  );
}

/** Average sRGB colour (0..255) of a region of a screenshot. */
export function averageColour(page: Page, png: string, region: Rect): Promise<[number, number, number]> {
  return page.evaluate(
    async ({ png, region }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const scale = img.naturalWidth / innerWidth;
      const d = ctx.getImageData(Math.round(region.x * scale), Math.round(region.y * scale), Math.max(1, Math.round(region.width * scale)), Math.max(1, Math.round(region.height * scale))).data;
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
    },
    { png, region },
  );
}
