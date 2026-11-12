/**
 * Node-side helper for the builder's Playwright specs (like tests/e2e/draft/bundle.ts): bundles ./page.ts from source
 * with Vite and the Svelte plugin (once per worker) and serves it, through a Playwright route, as a page on the app's
 * own origin. Nothing touches the network.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import type { BuilderDebugCard } from '../../../src/scene/builder';
import type { BuilderHarnessApi } from '../../../src/ui/builder/harness';

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
      lib: { entry: path.resolve('tests/e2e/builder/page.ts'), formats: ['es'], fileName: 'page' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('builder harness bundle has no entry chunk');
  return chunk.code;
}

/** Open the builder harness page with these query options (src/ui/builder/harness.ts). */
export async function openBuilder(page: Page, query: Record<string, string> = {}): Promise<{ errors: string[]; external: string[] }> {
  code ??= build1();
  const js = await code;
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.protocol !== 'blob:' && u.protocol !== 'data:') external.push(r.url());
  });
  await page.route('**/builder-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>builder harness</title></head><body><div id="app"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
  await page.goto(`./builder-harness.html?${new URLSearchParams(query).toString()}`);
  await expect.poll(() => page.evaluate(() => typeof window.__builderHarness === 'object'), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
  return { errors, external };
}

/** Call the harness API and return its JSON result. */
export function bh<K extends keyof BuilderHarnessApi>(page: Page, name: K, ...args: Parameters<BuilderHarnessApi[K]>): Promise<ReturnType<BuilderHarnessApi[K]>> {
  return page.evaluate(
    ([n, a]) => {
      const h = window.__builderHarness as unknown as Record<string, (...x: unknown[]) => unknown>;
      return JSON.parse(JSON.stringify(h[n as string]!(...(a as unknown[])) ?? null)) as unknown;
    },
    [name, args] as const,
  ) as Promise<ReturnType<BuilderHarnessApi[K]>>;
}

/** Wait until the table drew every card with its face and stopped moving. */
export async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__builderHarness!.ready() && window.__builderHarness!.idle()), { timeout: 30_000 }).toBe(true);
}

/** Screen centre of a builder card by id. */
export async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const c = (await bh(page, 'cards')).find((x) => x.id === id);
  if (!c) throw new Error(`no builder card ${id}`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

/**
 * Cards of an area whose centre no card above them in draw order covers (the last card of each cascade), so a press
 * at their centre takes them; in draw order, bottom first.
 */
export async function free(page: Page, area: 'deck' | 'side' = 'side'): Promise<BuilderDebugCard[]> {
  const cards = await bh(page, 'cards');
  return cards.filter((c, i) => c.area === area && !cards.slice(i + 1).some((o) => Math.abs(o.pose.x - c.pose.x) < 31.5 && Math.abs(o.pose.y - c.pose.y) < 44));
}

/** Screen point of a table point. */
export async function screenOf(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const s = await bh(page, 'toScreen', p);
  if (!s) throw new Error('no builder surface');
  return s;
}

/**
 * Drag from a screen point to another in steps. The point grabbed on the card keeps its offset, so grab cards at their
 * centre to drop their centre at `to`.
 */
export async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { shift?: boolean; ctrl?: boolean } = {}): Promise<void> {
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Ctrl after the press (macOS turns a Ctrl+press into a secondary click); the drop reads it on release.
  if (opts.ctrl) await page.keyboard.down('Control');
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (opts.ctrl) await page.keyboard.up('Control');
  if (opts.shift) await page.keyboard.up('Shift');
}
