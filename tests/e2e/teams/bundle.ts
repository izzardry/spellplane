/**
 * Node-side helper for the Two-Headed Giant Playwright specs (like tests/e2e/draft/bundle.ts): bundles ./page.ts from
 * source with Vite and the Svelte plugin (once per worker) and serves it, through a Playwright route, as a page on the
 * app's own origin, so the pages share BroadcastChannel and IndexedDB (namespaced by ?profile=). Nothing touches the
 * network.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { build, type Rollup } from 'vite';

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
      lib: { entry: path.resolve('tests/e2e/teams/page.ts'), formats: ['es'], fileName: 'page' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('team harness bundle has no entry chunk');
  return chunk.code;
}

/** Open the team harness page with its own profile (IndexedDB namespace and key pair). */
export async function openTeamPage(page: Page, profile: string): Promise<void> {
  code ??= build1();
  const js = await code;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) => {
    throw new Error(`the team harness opened a WebSocket to ${ws.url()}`);
  });
  await page.route('**/team-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>team harness</title></head><body><div id="app"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
  await page.goto(`./team-harness.html?faces=placeholder&profile=${profile}`);
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __teamHarness?: unknown }).__teamHarness === 'object'), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
}

/** Call a harness function in the page (awaiting a promise) and return its JSON result. */
export function th<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([n, a]) => {
      const h = (window as unknown as { __teamHarness: Record<string, (...x: unknown[]) => unknown> }).__teamHarness;
      return JSON.parse(JSON.stringify((await h[n as string]!(...(a as unknown[]))) ?? null)) as unknown;
    },
    [name, args] as const,
  ) as Promise<T>;
}
