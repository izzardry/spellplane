/**
 * PLAN M4-P4 Wyrm in the browser. Acceptance (PLAN M4-P3 to P5): "Each theme renders the twelve gate states without
 * console errors; every asset is listed in docs/ASSETS.md with a CC0 source or is procedural." DESIGN "Themes and
 * rendering": Wyrm is an obsidian slab with a geometric scale relief and ember-lit seams, fiery line glow, drifting
 * ember particles and a heat shimmer on the stack, ego camera by default; card faces are never restyled; a per-theme
 * quality setting drops shadows and post-processing first.
 *
 * The table is the render harness (`?harness=render&theme=wyrm`: the real table scene and lit pipeline on a scripted
 * 1v1 board). Behaviour is asserted on the debug hook (`__spellplane.render`, `__spellplane.wyrm`) and the harness;
 * pixels only where the design's rule is about pixels (a card face keeps its printed colours and is not distorted).
 * Screenshots of every state go to artifacts/shots/M4/wyrm/ as evidence.
 *
 * Of the twelve gate states (themes/signals.ts SIGNALS), the ten drawn by the table scene are scripted here. "Speaking"
 * and "away" are HUD avatars and "pending confirmation" needs a confirmation round, neither of which the harness table
 * has; the app reaches them once M4-P6's theme switch lands, and its conformance spec (tests/e2e/signals.spec.ts)
 * measures all twelve for every theme. Their Wyrm tokens are checked in tests/unit/themes/wyrm/theme.test.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { colourDelta, openRender, rh, screenAverage, setTheme, settle, stableTextures } from '../../render/helpers';
import { act, evidence, frames, inner, maxChannelDelta, screenPixels, wyrmBuild, wyrmBuilds } from './helpers';

type Rect = { x: number; y: number; width: number; height: number };
type Card = { id: string; pose: { x: number; y: number; rot: number }; screen: Rect; tapped: boolean; face: string; shows: string; selected: boolean; displaced: boolean; ghost: unknown; zone: string; tier: string | null };
type Stats = { drawCalls: number; textureBytes: number; passes: string[]; shadows: boolean; quality: string; theme: string; textures: number; geometries: number };

const card = async (page: Page, id: string): Promise<Card> => {
  const c = (await rh<Card[]>(page, 'cards')).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c;
};
const stats = (page: Page) => rh<Stats>(page, 'stats');
const lines = (page: Page) => page.evaluate(() => Object.values(window.__spellplane!.state!().lines).map((l) => ({ kind: l.kind, by: l.by })));

/** The scene-drawn gate states, applied one after the other on the demo board (each leaves the earlier ones in place). */
const STATES: { id: string; apply: (page: Page) => Promise<void>; check: (page: Page) => Promise<void> }[] = [
  {
    id: 'tapped',
    apply: (page) => act(page, { type: 'tap', card: 's0-b02', tapped: true }),
    check: async (page) => {
      const c = await card(page, 's0-b02');
      expect(c.tapped).toBe(true);
      expect(Math.round(c.pose.rot)).toBe(90);
    },
  },
  {
    id: 'selected',
    apply: (page) => page.evaluate(() => window.__renderHarness!.setView({ selection: ['s0-b03'] })),
    check: async (page) => expect((await card(page, 's0-b03')).selected).toBe(true),
  },
  {
    id: 'hovered',
    apply: (page) => page.evaluate(() => window.__renderHarness!.setView({ hovered: 's0-b04' })),
    check: async (page) => expect(await page.evaluate(() => window.__spellplane!.state!().cards['s0-b04']!.zone)).toBe('battlefield:s0'),
  },
  {
    id: 'displaced',
    apply: (page) => act(page, { type: 'moveTemp', card: 's0-b05', pose: { x: -6, y: -110, rot: 0 } }),
    check: async (page) => {
      const c = await card(page, 's0-b05');
      expect(c.displaced).toBe(true);
      expect(c.ghost).not.toBeNull();
    },
  },
  {
    id: 'attacking',
    apply: async (page) => {
      await act(page, { type: 'moveTemp', card: 's0-b00', pose: { x: -240, y: -70, rot: 0 }, combat: 'attack' });
      await act(page, { type: 'lineAdd', line: 'atk', kind: 'attack', from: { kind: 'card', id: 's0-b00' }, to: { kind: 'seat', id: 's1' } });
    },
    check: async (page) => {
      expect((await card(page, 's0-b00')).displaced).toBe(true);
      expect(await lines(page)).toContainEqual({ kind: 'attack', by: 's0' });
    },
  },
  {
    id: 'blocking',
    apply: async (page) => {
      await act(page, { type: 'moveTemp', by: 's1', card: 's1-b00', pose: { x: -240, y: 26, rot: 180 }, combat: 'block' });
      await act(page, { type: 'lineAdd', by: 's1', line: 'blk', kind: 'block', from: { kind: 'card', id: 's1-b00' }, to: { kind: 'card', id: 's0-b00' } });
    },
    check: async (page) => {
      expect((await card(page, 's1-b00')).displaced).toBe(true);
      expect(await lines(page)).toContainEqual({ kind: 'block', by: 's1' });
    },
  },
  {
    id: 'face-down',
    apply: (page) => act(page, { type: 'flip', card: 's0-b01', face: 'down' }),
    check: async (page) => {
      expect((await card(page, 's0-b01')).shows).toBe('back');
      // The opponent's face-down card on the demo board shows Wyrm's neutral back too.
      expect((await card(page, 's1-d0')).shows).toBe('back');
    },
  },
  {
    id: 'foil',
    apply: (page) => act(page, { type: 'createToken', card: 'foil-1', zone: 'battlefield:s0', pose: { x: 160, y: -240, rot: 0 }, ref: { sid: 'fx-40', foil: true } }),
    check: async (page) => expect((await card(page, 'foil-1')).shows).toBe('face'),
  },
  {
    id: 'seat-colour',
    apply: async (page) => {
      await act(page, { type: 'lineAdd', line: 'tg0', kind: 'target', from: { kind: 'card', id: 's0-b03' }, to: { kind: 'card', id: 's1-b03' } });
      await act(page, { type: 'lineAdd', by: 's1', line: 'tg1', kind: 'target', from: { kind: 'card', id: 's1-b04' }, to: { kind: 'card', id: 's0-b04' } });
    },
    check: async (page) => {
      const ls = await lines(page);
      expect(ls).toContainEqual({ kind: 'target', by: 's0' });
      expect(ls).toContainEqual({ kind: 'target', by: 's1' });
    },
  },
  {
    id: 'stack-item',
    apply: (page) => act(page, { type: 'stackPush', item: 'st1', kind: 'spell', card: 's0-b04' }),
    check: async (page) => {
      expect((await card(page, 's0-b04')).zone).toBe('stack');
      // The heat shimmer rises over the stack.
      await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
    },
  },
];

for (const rig of ['birdseye', 'ego'] as const) {
  test(`renders the table's gate states in Wyrm without console errors (${rig})`, async ({ page }, info) => {
    const errors = await openRender(page, { theme: 'wyrm', scenario: 'demo' });
    if (rig === 'ego') {
      await page.evaluate(() => window.__renderHarness!.camera.setRig('ego', { animate: false }));
      const now = await page.evaluate(() => window.__renderHarness!.camera.rig());
      test.skip(now !== 'ego', 'the ego rig arrives with M4-P1; on this branch the table has the bird’s-eye rig only');
    }
    await settle(page);
    const s0 = await stats(page);
    expect(s0.theme).toBe('wyrm');
    expect(s0.passes).toEqual(['render', 'glow', 'bloom', 'vignette', 'output']);
    await evidence(page, info, `${rig}-neutral`);
    for (const st of STATES) {
      const before = await rh<number>(page, 'frames');
      await st.apply(page);
      await settle(page);
      await st.check(page);
      expect(await rh<number>(page, 'frames'), `${st.id}: frames drawn`).toBeGreaterThan(before);
      await evidence(page, info, `${rig}-${st.id}`);
      expect(errors, `console errors after ${st.id}`).toEqual([]);
    }
    expect((await stats(page)).passes).toEqual(['render', 'glow', 'bloom', 'wyrm-shimmer', 'vignette', 'output']);
    expect(errors).toEqual([]);
  });
}

test('the default build is lit: shadows, card boxes, bloom and vignette, embers over the slab, no shimmer without a stack', async ({ page }) => {
  const errors = await openRender(page, { theme: 'wyrm', scenario: 'demo' });
  await settle(page);
  const s = await stats(page);
  expect(s).toMatchObject({ theme: 'wyrm', quality: 'high', shadows: true });
  const p = await rh<{ boxes: boolean; contactShadows: boolean; faceShade: number; toneMapping: number }>(page, 'pipeline');
  expect(p.boxes).toBe(true);
  expect(p.contactShadows).toBe(true);
  expect(p.faceShade).toBeLessThanOrEqual(0.03);
  const w = await wyrmBuild(page);
  expect(w).toMatchObject({ quality: 'high', post: true, reducedMotion: false });
  expect(w.embers.count).toBeGreaterThan(0);
  expect(w.embers.visible).toBe(true);
  expect(w.shimmer).toMatchObject({ allowed: true, inChain: false, focus: null, strength: 0 });
  // The embers drift: their clock runs with the frames.
  const t0 = w.embers.time;
  await frames(page, 10);
  expect((await wyrmBuild(page)).embers.time).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
});

test('quality: medium drops shadows and the shimmer, low drops post-processing and the embers, high brings all back', async ({ page }) => {
  const errors = await openRender(page, { theme: 'wyrm', scenario: 'demo', quality: 'high' });
  await act(page, { type: 'stackPush', item: 'q1', kind: 'spell', card: 's0-b05' });
  await settle(page);
  await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
  const high = await stats(page);
  expect(high.shadows).toBe(true);
  expect(high.passes).toEqual(['render', 'glow', 'bloom', 'wyrm-shimmer', 'vignette', 'output']);
  expect((await wyrmBuild(page)).embers.visible).toBe(true);

  await rh(page, 'setQuality', 'medium');
  await frames(page, 3);
  const medium = await stats(page);
  expect(medium).toMatchObject({ quality: 'medium', shadows: false });
  expect(medium.passes).toEqual(['render', 'glow', 'bloom', 'vignette', 'output']);
  let w = await wyrmBuild(page);
  expect(w.quality).toBe('medium');
  expect(w.shimmer).toMatchObject({ allowed: false, inChain: false, strength: 0 });
  expect(w.embers.visible).toBe(true);
  expect(w.embers.count).toBeGreaterThan(0);

  await rh(page, 'setQuality', 'low');
  await frames(page, 3);
  const low = await stats(page);
  expect(low).toMatchObject({ quality: 'low', shadows: false, passes: [] });
  w = await wyrmBuild(page);
  expect(w.embers).toMatchObject({ visible: false, count: 0 });
  expect(w.shimmer).toMatchObject({ allowed: false, inChain: false });
  expect(low.drawCalls).toBeLessThan(high.drawCalls);

  // Back to high without a reload: the stack still burns, so the shimmer returns, and the embers with it.
  await rh(page, 'setQuality', 'high');
  await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
  expect((await stats(page)).passes).toEqual(high.passes);
  expect((await wyrmBuild(page)).embers.visible).toBe(true);
  expect(await wyrmBuilds(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const viewer of ['s0', 's1'] as const) {
  test(`the heat shimmer covers the stack lane and never distorts or recolours the card face on it (${viewer})`, async ({ page }, info) => {
    const errors = await openRender(page, { theme: 'wyrm', scenario: 'empty', viewer });
    await page.evaluate(() => window.__renderHarness!.addCard('probe', 'fx-7', { x: 0, y: -260, rot: 0 }));
    await act(page, { type: 'stackPush', item: 'p1', kind: 'spell', card: 'probe' });
    await settle(page);
    await evidence(page, info, `shimmer-${viewer}`);
    // The shimmer is centred on the lane (the harness table's lane is at the table centre) and holds the card.
    await expect.poll(async () => (await wyrmBuild(page)).shimmer?.strength).toBe(1);
    let w = await wyrmBuild(page);
    expect(w.shimmer!.focus).toEqual({ x: 0, y: 0 });
    const centre = (await rh<{ x: number; y: number }>(page, 'toScreen', 0, 0))!;
    const region = w.shimmer!.region!;
    expect(Math.abs(region.x - centre.x)).toBeLessThan(region.rx * 0.25);
    expect(Math.abs(region.y - centre.y)).toBeLessThan(region.ry * 0.25);
    const small = await card(page, 'probe');
    expect(small.zone).toBe('stack');
    const inside = (x: number, y: number) => ((x - region.x) / region.rx) ** 2 + ((y - region.y) / region.ry) ** 2 < 1;
    for (const [x, y] of [[small.screen.x, small.screen.y], [small.screen.x + small.screen.width, small.screen.y + small.screen.height]] as const) expect(inside(x, y)).toBe(true);

    // Close up: the face fills most of the viewport, right in the hot air.
    await page.evaluate(() => window.__renderHarness!.camera.zoomTo('probe'));
    await settle(page);
    await expect.poll(async () => (await card(page, 'probe')).tier).toBe('large');
    await settle(page);
    w = await wyrmBuild(page);
    expect(w.shimmer).toMatchObject({ inChain: true, strength: 1 });
    const face = await card(page, 'probe');
    await evidence(page, info, `shimmer-closeup-${viewer}`);
    expect(face.screen.height).toBeGreaterThan(page.viewportSize()!.height * 0.6);

    // The shimmer moves on between two captures, the printed face does not.
    const rect = inner(face.screen, 0.12);
    const a = await screenPixels(page, rect);
    const tA = (await wyrmBuild(page)).shimmer!.time;
    await frames(page, 20);
    const b = await screenPixels(page, rect);
    const tB = (await wyrmBuild(page)).shimmer!.time;
    expect(tB).toBeGreaterThan(tA);
    expect((await wyrmBuild(page)).shimmer!.inChain).toBe(true);
    expect(maxChannelDelta(a, b)).toBeLessThanOrEqual(2);

    // And it keeps its printed colours (PLAN M4-P2: within 3% of the source).
    const source = await rh<[number, number, number]>(page, 'sourceAverage', 'fx-7', 0.12);
    const shown = await screenAverage(page, face.screen, 0.12);
    expect(colourDelta(shown, source), `face ${shown.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);
    expect(errors).toEqual([]);
  });
}

test('with reduced motion the shimmer stays off and the embers stand still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openRender(page, { theme: 'wyrm', scenario: 'demo' });
  await act(page, { type: 'stackPush', item: 'r1', kind: 'spell', card: 's0-b05' });
  await settle(page);
  const w0 = await wyrmBuild(page);
  expect(w0.reducedMotion).toBe(true);
  expect(w0.shimmer).toMatchObject({ allowed: false, inChain: false, strength: 0, focus: { x: 0, y: 0 } });
  // Embers are still drawn (a still picture), they just do not move.
  expect(w0.embers.visible).toBe(true);
  await rh(page, 'redraw');
  await page.evaluate(() => window.__renderHarness!.camera.panBy(20, 0));
  await settle(page);
  const w1 = await wyrmBuild(page);
  expect(w1.embers.time).toBe(w0.embers.time);
  expect((await stats(page)).passes).not.toContain('wyrm-shimmer');
  expect(errors).toEqual([]);
});

test('Wyrm fetches no asset files: switching to it loads only its code chunk', async ({ page }) => {
  await openRender(page, { theme: 'paper', scenario: 'demo' });
  await settle(page);
  const requests: { url: string; type: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
  await setTheme(page, 'wyrm');
  await settle(page);
  await frames(page, 10);
  expect((await stats(page)).theme).toBe('wyrm');
  // Procedural slab, embers, shimmer and back: no image, font, media or other fetch, only script chunks.
  expect(requests.filter((r) => r.type !== 'script'), JSON.stringify(requests)).toEqual([]);
  expect(requests.every((r) => new URL(r.url).origin === new URL(page.url()).origin)).toBe(true);
});

test('switching away from Wyrm and back leaves no build, pass or texture behind', async ({ page }) => {
  const errors = await openRender(page, { theme: 'wyrm', scenario: 'demo' });
  await act(page, { type: 'stackPush', item: 's1', kind: 'spell', card: 's0-b05' });
  await settle(page);
  await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
  // Warm-up round (one-time caches: the physically based DFG table, the glyph atlas), then the baseline in Paper.
  await setTheme(page, 'paper');
  await setTheme(page, 'wyrm');
  await setTheme(page, 'paper');
  await settle(page);
  const base = await stableTextures(page);
  const geometries = (await stats(page)).geometries;
  expect(await wyrmBuilds(page)).toEqual([]);
  for (let i = 0; i < 4; i++) {
    await setTheme(page, 'wyrm');
    // A fresh build hears where the stack is and lights the shimmer again.
    await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
    await setTheme(page, 'paper');
    expect(await wyrmBuilds(page)).toEqual([]);
    expect((await stats(page)).passes).toEqual([]);
  }
  await settle(page);
  expect(await stableTextures(page)).toBe(base);
  expect((await stats(page)).geometries).toBe(geometries);
  expect(errors).toEqual([]);
});

test('300 cards in Wyrm with the stack burning: at most 60 draw calls, texture memory under 400 MB', async ({ page }, info) => {
  const errors = await openRender(page, { theme: 'wyrm', scenario: 'bench' });
  await act(page, { type: 'stackPush', item: 'b1', kind: 'spell', card: 's0-b00' });
  await settle(page);
  expect((await rh<unknown[]>(page, 'cards')).length).toBeGreaterThanOrEqual(300);
  await expect.poll(async () => (await wyrmBuild(page)).shimmer?.inChain).toBe(true);
  const samples: Stats[] = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__renderHarness!.camera.panBy(1, 0));
    await frames(page, 2);
    samples.push((await page.evaluate(() => window.__spellplane!.render!.stats())) as unknown as Stats);
  }
  const calls = Math.max(...samples.map((s) => s.drawCalls));
  const bytes = Math.max(...samples.map((s) => s.textureBytes));
  // PLAN M4 Performance names 60 draw calls for Stonetable, the other lit ego theme; Wyrm keeps to the same budget.
  expect(calls).toBeLessThanOrEqual(60);
  expect(bytes).toBeLessThan(400 * 1024 * 1024);
  info.annotations.push({ type: 'wyrm-bench', description: `${info.project.name}: ${calls} draw calls, ${(bytes / 2 ** 20).toFixed(1)} MB` });
  expect(errors).toEqual([]);
});
