/**
 * Node-side helper for the draft UI's Playwright specs (like tests/e2e/net/bundle.ts): bundles ./page.ts from source
 * with Vite and the Svelte plugin (once per worker) and serves it, through a Playwright route, as a page on the app's
 * own origin. The app's entry (src/main.ts) needs no route for it. Nothing touches the network.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import type { DraftHarnessApi } from '../../../src/ui/draft/harness';

let code: Promise<string> | null = null;

async function build1(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    // CSS of the components is injected by their code: the page is a single script.
    plugins: [svelte({ emitCss: false })],
    define: { __SPELLPLANE_DEBUG__: 'true' },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.resolve('tests/e2e/draft/page.ts'), formats: ['es'], fileName: 'page' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('draft harness bundle has no entry chunk');
  return chunk.code;
}

/** Open the draft harness page with these query options (src/ui/draft/harness.ts optionsFromQuery). */
export async function openDraft(page: Page, query: Record<string, string | number> = {}): Promise<void> {
  code ??= build1();
  const js = await code;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) => {
    throw new Error(`the draft harness opened a WebSocket to ${ws.url()}`);
  });
  await page.route('**/draft-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>draft harness</title></head><body><div id="app"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  await page.goto(`./draft-harness.html?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => typeof window.__draftHarness === 'object'), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
}

/** Wait until the draft surface drew its cards with their faces and stopped moving. */
export async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__draftHarness!.ready() && window.__draftHarness!.idle()), { timeout: 30_000 }).toBe(true);
}

/** Call the harness API and return its JSON result. */
export function dh<K extends keyof DraftHarnessApi>(page: Page, name: K, ...args: Parameters<DraftHarnessApi[K]>): Promise<ReturnType<DraftHarnessApi[K]>> {
  return page.evaluate(
    ([n, a]) => {
      const h = window.__draftHarness as unknown as Record<string, (...x: unknown[]) => unknown>;
      return JSON.parse(JSON.stringify(h[n as string]!(...(a as unknown[])) ?? null)) as unknown;
    },
    [name, args] as const,
  ) as Promise<ReturnType<DraftHarnessApi[K]>>;
}

/** Click the centre of a draft card on the surface by its id. */
export async function clickCard(page: Page, id: string): Promise<void> {
  const c = (await dh(page, 'cards')).find((x) => x.id === id);
  if (!c) throw new Error(`no draft card ${id}`);
  await page.mouse.click(c.screen.x + c.screen.width / 2, c.screen.y + c.screen.height / 2);
}
