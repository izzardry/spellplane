/**
 * Node-side helper for the net engine's Playwright specs: bundles ./page.ts from source with Vite (once per worker)
 * and serves it, through a Playwright route, as a page on the app's own origin. Same origin means the pages share
 * BroadcastChannel (the ?transport=local harness) and IndexedDB (namespaced by ?profile=), as app pages would.
 * Nothing touches the network: the route answers the request itself.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { build, type Rollup } from 'vite';

const code = new Map<string, Promise<string>>();

function bundle(entry: string): Promise<string> {
  let c = code.get(entry);
  if (!c) {
    c = build1(entry);
    code.set(entry, c);
  }
  return c;
}

async function build1(entry: string): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    define: { __SPELLPLANE_DEBUG__: 'true' },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.resolve('tests/e2e/net', entry), formats: ['es'], fileName: 'page' },
      // One script: Trystero (loaded lazily by its transport, smoke bundle only) is inlined rather than split off.
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('net harness bundle has no entry chunk');
  return chunk.code;
}

/** Serve the harness page at <base>net-harness.html in this context; `entry` 'smoke-page.ts' adds Trystero. */
export async function routeHarness(context: BrowserContext, entry: 'page.ts' | 'smoke-page.ts' = 'page.ts'): Promise<void> {
  const js = await bundle(entry);
  await context.route('**/net-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta charset="utf-8"><title>net harness</title></head><body><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
}

/** Open the harness page with a profile (its own IndexedDB namespace, hence its own identity). */
export async function openHarness(context: BrowserContext, profile: string): Promise<Page> {
  const page = await context.newPage();
  // Tests never use the network (CLAUDE.md); the @network smoke test opts out.
  if (!test.info().tags.includes('@network') && !test.info().title.includes('@network')) {
    page.on('websocket', (ws) => {
      throw new Error(`the net harness opened a WebSocket to ${ws.url()}`);
    });
  }
  await page.goto(`./net-harness.html?profile=${profile}&transport=local`);
  await expect.poll(() => page.evaluate(() => document.body.dataset.ready === '1')).toBe(true);
  return page;
}

type Harness = {
  identity(nickname: string): Promise<{ peerId: string }>;
  close(): void;
  start(room: string, peers: string[], kind?: 'local' | 'trystero'): Promise<void>;
  propose(a: unknown): boolean;
  hash(): string;
  info(): { status: string; seq: number; sequencer: string | null; sequencing: boolean; seat: string | null; pending: number; peers: number; system: string[] };
};

/** Call a member of window.__netHarness in the page. */
export function harness<K extends keyof Harness>(page: Page, name: K, ...args: unknown[]): Promise<Awaited<ReturnType<Harness[K]>>> {
  return page.evaluate(
    async ([n, a]) => {
      const h = (window as unknown as { __netHarness: Record<string, (...x: unknown[]) => unknown> }).__netHarness;
      return (await h[n as string]!(...(a as unknown[]))) as never;
    },
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<Harness[K]>>>;
}

export type HarnessInfo = ReturnType<Harness['info']>;
