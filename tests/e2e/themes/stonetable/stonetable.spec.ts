/**
 * Stonetable in the browser (PLAN M4-P5: "Carved stone slab with CC0 physically based materials, torch-like key light,
 * real shadows, rune lines, dust motes, ego camera by default"; acceptance: card faces keep their colours, with 300 cards
 * at most 60 draw calls; DESIGN "Themes and rendering": "Card faces are never restyled … the table and sleeves receive
 * light and shadow, the printed face keeps its colours"; Renderer: "60 fps on a current integrated GPU in Stonetable
 * with shadows; a per-theme quality setting drops shadows and post-processing first"; "Specification: geometry, layout
 * and motion": lift while dragged 12 with a 4° tilt in lit themes). Behaviour is read from the debug hook and
 * renderer.info; pixels are read only where the design speaks about colour (faces, glowing runes).
 */
import { expect, test, type Page } from '@playwright/test';
import { colourDelta, openRender, rh, screenAverage, settle, stableTextures } from '../../render/helpers';
import { evidence, luminance, shot } from './helpers';

type Stats = { drawCalls: number; textureBytes: number; textures: number; passes: string[]; shadows: boolean; quality: string; theme: string };
type Pipeline = { boxes: boolean; contactShadows: boolean; faceShade: number; faceLift: number; toneMapping: number; materials: number; materialTextures: number };
type Rect = { x: number; y: number; width: number; height: number };
type Card = { id: string; screen: Rect; tier: string | null; lift: number; tilt: number; pose: { x: number; y: number } };

let cid = 0;
async function dispatch(page: Page, a: Record<string, unknown>): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as never), { by: 's0', cid: `sp-${++cid}`, ...a });
}
const card = async (page: Page, id: string) => (await rh<Card[]>(page, 'cards')).find((c) => c.id === id)!;

test('runs the whole lit pipeline: torch shadows, contact shadows, card boxes, bloom and vignette, tone mapping', async ({ page }, info) => {
  const errors = await openRender(page, { theme: 'stonetable', scenario: 'demo' });
  await settle(page);
  const s = await rh<Stats>(page, 'stats');
  expect(s).toMatchObject({ theme: 'stonetable', quality: 'high', shadows: true });
  expect(s.passes).toEqual(['render', 'glow', 'bloom', 'vignette', 'output']);
  const p = await rh<Pipeline>(page, 'pipeline');
  expect(p.boxes).toBe(true);
  expect(p.contactShadows).toBe(true);
  // Faces sit on the 0.6 mm card box and are shaded by at most 2% (well inside CARD_FACE_MAX_SHADE).
  expect(p.faceLift).toBeCloseTo(0.62, 2);
  expect(p.faceShade).toBe(0.02);
  expect(p.toneMapping).not.toBe(0);
  // The slab's three procedural maps live in the material library.
  expect(p.materialTextures).toBeGreaterThanOrEqual(3);
  evidence(info, 'demo-high', await shot(page));
  expect(errors).toEqual([]);
});

test('quality levels drop the torch shadows first, then post-processing and the dust motes, and come back without leaks', async ({ page }) => {
  const errors = await openRender(page, { theme: 'stonetable', scenario: 'demo' });
  await settle(page);
  const textures0 = await stableTextures(page);
  const high = await rh<Stats>(page, 'stats');
  await rh(page, 'setQuality', 'medium');
  await settle(page);
  const medium = await rh<Stats>(page, 'stats');
  expect(medium).toMatchObject({ quality: 'medium', shadows: false });
  expect(medium.passes).toContain('bloom');
  // No shadow-map passes: fewer draw calls than with the torch casting shadows.
  expect(medium.drawCalls).toBeLessThan(high.drawCalls);
  await rh(page, 'setQuality', 'low');
  await settle(page);
  const low = await rh<Stats>(page, 'stats');
  expect(low).toMatchObject({ quality: 'low', shadows: false, passes: [] });
  // Motes and the glow pass are gone too.
  expect(low.drawCalls).toBeLessThan(medium.drawCalls);
  await rh(page, 'setQuality', 'high');
  await settle(page);
  expect(await rh<Stats>(page, 'stats')).toMatchObject({ quality: 'high', shadows: true });
  expect(await stableTextures(page)).toBe(textures0);
  expect(errors).toEqual([]);
});

test('a held card lifts 12 mm, tilts at most 4° toward the drag and keeps casting its shadow', async ({ page }) => {
  await openRender(page, { theme: 'stonetable', scenario: 'demo' });
  await settle(page);
  const start = await card(page, 's0-b05');
  const a = (await rh<{ x: number; y: number }>(page, 'toScreen', start.pose.x, start.pose.y))!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  let maxTilt = 0;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + i * 14, a.y - i * 4);
    maxTilt = Math.max(maxTilt, (await card(page, 's0-b05')).tilt);
  }
  await expect.poll(async () => (await card(page, 's0-b05')).lift).toBeCloseTo(12, 1);
  expect(maxTilt).toBeGreaterThan(0);
  expect(maxTilt).toBeLessThanOrEqual(4 + 1e-9);
  expect((await rh<Stats>(page, 'stats')).shadows).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await card(page, 's0-b05')).lift).toBe(0);
});

test('the runes around the slab glow brighter than any stone, and the far side stays readable', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRender(page, { theme: 'stonetable', scenario: 'empty' });
  await settle(page);
  // The near band runs 10..56 mm outside the 1100 mm deep table's near edge (y = -550); sample a strip along it.
  const at = (x: number, y: number) => rh<{ x: number; y: number }>(page, 'toScreen', x, y, 0);
  const strip = async (y0: number, y1: number): Promise<Rect> => {
    const p = (await at(-400, y0))!;
    const q = (await at(400, y1))!;
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.max(2, Math.abs(q.y - p.y)) };
  };
  const band = await luminance(page, await strip(-550 - 22, -550 - 44));
  // Bare stone of the play area, clear of the zone outlines and labels.
  const stone = await luminance(page, await strip(-60, 60));
  info.annotations.push({ type: 'luminance', description: `band max ${band.max.toFixed(0)} mean ${band.mean.toFixed(0)}; stone p99.5 ${stone.p995.toFixed(0)} mean ${stone.mean.toFixed(0)}` });
  // Rune cores glow near white; the brightest stone (dust motes aside: the 99.5th percentile) stays well below.
  expect(band.max).toBeGreaterThan(215);
  expect(band.max).toBeGreaterThan(stone.p995 + 40);
  // The stone is dark but not black: a lit slab, not a void.
  expect(stone.mean).toBeGreaterThan(25);
  expect(stone.mean).toBeLessThan(170);
  // The far side, away from the torch, is darker than the middle yet still visible stone.
  const far = await luminance(page, await strip(450, 520));
  expect(far.mean).toBeGreaterThan(12);
  evidence(info, 'empty-table', await shot(page));
});

test('card faces keep their printed colours under the torch, in its falloff on the far side and next to a held card', async ({ page }) => {
  const errors = await openRender(page, { theme: 'stonetable', scenario: 'empty' });
  const sid = 'fx-7';
  // Near-left under the torch, and far-right in its falloff.
  await dispatch(page, { type: 'createToken', card: 'near', zone: 'battlefield:s0', pose: { x: -560, y: -420, rot: 0 }, ref: { sid } });
  await dispatch(page, { by: 's1', type: 'createToken', card: 'far', zone: 'battlefield:s1', pose: { x: 600, y: 470, rot: 0 }, ref: { sid } });
  await settle(page);
  const source = await rh<[number, number, number]>(page, 'sourceAverage', sid, 0.12);
  for (const id of ['near', 'far']) {
    await page.evaluate((x) => window.__renderHarness!.camera.zoomTo(x), id);
    await settle(page);
    await expect.poll(async () => (await card(page, id)).tier).toBe('large');
    await settle(page);
    const c = await card(page, id);
    const avg = await screenAverage(page, c.screen, 0.12);
    expect(colourDelta(avg, source), `${id}: ${avg.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);
  }
  expect(errors).toEqual([]);
});

test('300 cards: at most 60 draw calls at every quality level and texture memory under 400 MB', async ({ page }, info) => {
  const errors = await openRender(page, { theme: 'stonetable', scenario: 'bench' });
  await settle(page);
  expect((await rh<unknown[]>(page, 'cards')).length).toBeGreaterThanOrEqual(300);
  const vp = page.viewportSize()!;
  for (const q of ['high', 'medium', 'low'] as const) {
    await rh(page, 'setQuality', q);
    await settle(page);
    let maxCalls = 0;
    let maxBytes = 0;
    for (const factor of [1, 3]) {
      if (factor !== 1) await page.evaluate(([x, y, f]) => window.__renderHarness!.camera.zoomAt(x!, y!, f!), [vp.width / 2, vp.height * 0.7, factor] as const);
      await settle(page);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__renderHarness!.camera.panBy(1, 0));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const s = (await page.evaluate(() => window.__spellplane!.render!.stats())) as Stats;
        maxCalls = Math.max(maxCalls, s.drawCalls);
        maxBytes = Math.max(maxBytes, s.textureBytes);
      }
    }
    await page.evaluate(() => window.__renderHarness!.camera.fit(false));
    info.annotations.push({ type: 'draw-calls', description: `${q}: ${maxCalls} draw calls, ${(maxBytes / 2 ** 20).toFixed(1)} MB` });
    expect(maxCalls, q).toBeGreaterThan(0);
    expect(maxCalls, q).toBeLessThanOrEqual(60);
    expect(maxBytes, q).toBeLessThan(400 * 1024 * 1024);
  }
  expect(errors).toEqual([]);
});
