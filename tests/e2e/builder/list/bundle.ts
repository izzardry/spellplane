/**
 * Node-side helper for the list view specs: bundles ./page.ts (with the Svelte plugin) from source with Vite, once per
 * worker, and serves it through a Playwright route as a page on the app's own origin (same origin: the IndexedDB of
 * ?profile= is the app's). Card data is the recorded fixtures; Scryfall's /cards/search is answered from them by a
 * route, so nothing reaches the network.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import type { DeckBuild } from '../../../../src/core/types';
import type { CardData } from '../../../../src/data/types';

let code: Promise<string> | null = null;

async function build1(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    define: { __SPELLPLANE_DEBUG__: 'true' },
    plugins: [svelte({ compilerOptions: { css: 'injected' } })],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.resolve('tests/e2e/builder/list/page.ts'), formats: ['es'], fileName: 'page' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry);
  if (!chunk) throw new Error('list harness bundle has no entry chunk');
  return chunk.code;
}

const FIXTURES = path.join('tests', 'fixtures', 'scryfall');
let m19: CardData[] | null = null;
export function fixtureCards(): CardData[] {
  m19 ??= JSON.parse(fs.readFileSync(path.join(FIXTURES, 'm19.json'), 'utf8')) as CardData[];
  return m19;
}
/** M10 cards: not in the injected card data, so only the search can bring them in. */
export function searchOnlyCards(): CardData[] {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'm10.json'), 'utf8')) as CardData[];
}

export function card(name: string): CardData {
  const c = fixtureCards().find((x) => x.name === name);
  if (!c) throw new Error(`no M19 fixture card ${name}`);
  return c;
}

/** Scryfall /cards/search answered from the fixtures (name substring, as the real API would for a bare word). */
async function routeScryfall(context: BrowserContext, searches: string[]): Promise<void> {
  const cards = [...fixtureCards(), ...searchOnlyCards()].filter((c) => !/Token/.test(c.type_line));
  await context.route('https://api.scryfall.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/cards/search') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error"}' });
    const q = (url.searchParams.get('q') ?? '').replace(/^\((.*)\) game:paper$/, '$1').trim();
    searches.push(q);
    if (q === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"object":"error"}' });
    const hits = cards.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    const seen = new Set<string>();
    const unique = hits.filter((c) => !seen.has(c.name) && seen.add(c.name));
    if (unique.length === 0) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error","code":"not_found"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', has_more: false, data: unique }) });
  });
}

export function freshProfile(info: TestInfo): string {
  return `ls-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(5).toString('hex')}`;
}

export interface OpenedList {
  page: Page;
  /** The queries Scryfall's search was asked, in order. */
  searches: string[];
  /** Requests that left the page for anything but the app's origin and the routed Scryfall stub. */
  external: string[];
}

/** Open the list harness page with fixture card data in a fresh (or given) profile. */
export async function openList(context: BrowserContext, opts: { profile: string; query?: Record<string, string>; page?: Page }): Promise<OpenedList> {
  code ??= build1();
  const js = await code;
  const searches: string[] = [];
  const external: string[] = [];
  await context.route('**/list-harness.html*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>list harness</title></head><body><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }),
  );
  await routeScryfall(context, searches);
  const page = opts.page ?? (await context.newPage());
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.hostname !== 'api.scryfall.com' && u.protocol !== 'blob:' && u.protocol !== 'data:') external.push(r.url());
  });
  const cards = fixtureCards();
  await page.addInitScript({ content: `window.__spellplaneFixtures = ${JSON.stringify({ cards })};` });
  const q = new URLSearchParams({ profile: opts.profile, ...(opts.query ?? {}) });
  await page.goto(`./list-harness.html?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => document.body.dataset.ready === '1')).toBe(true);
  return { page, searches, external };
}

export async function getBuild(page: Page): Promise<DeckBuild> {
  return page.evaluate(() => window.__listHarness!.build());
}

export async function setBuild(page: Page, build: DeckBuild): Promise<void> {
  await page.evaluate((b) => window.__listHarness!.setBuild(b), build);
}

/**
 * A drafted pool as the builder table hands it over: deck cards in the order they were dragged in, table positions for
 * every card, two dispensed Forests, a foil Shock.
 */
export function tableBuild(): DeckBuild {
  const sid = (n: string) => card(n).id;
  const forest = card('Forest').id;
  const cards: DeckBuild['cards'] = [
    { id: 'p1', ref: { sid: sid('Llanowar Elves') } },
    { id: 'p2', ref: { sid: sid('Shock'), foil: true } },
    { id: 'p3', ref: { sid: sid('Divination') } },
    { id: 'p4', ref: { sid: sid('Draconic Disciple') } },
    { id: 'p5', ref: { sid: sid('Llanowar Elves') } },
    { id: 'p6', ref: { sid: sid('Sarkhan, Fireblood') } },
    { id: 'p7', ref: { sid: sid('Cancel') } },
    { id: 'p8', ref: { sid: sid('Meteor Golem') } },
    { id: 'p9', ref: { sid: sid('Detection Tower') } },
    { id: 'p10', ref: { sid: sid('Shock') } },
    { id: 'p11', ref: { sid: forest } },
    { id: 'b1', ref: { sid: forest }, basic: true },
    { id: 'b2', ref: { sid: forest }, basic: true },
  ];
  const poses: NonNullable<DeckBuild['poses']> = {};
  cards.forEach((c, i) => (poses[c.id] = { x: -300 + 70 * i, y: i % 2 ? 120 : -120, rot: 0 }));
  return { cards, main: ['p6', 'p1', 'b1', 'p4', 'p2', 'p5', 'b2', 'p11'], poses };
}
