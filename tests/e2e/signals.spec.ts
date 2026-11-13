/**
 * PLAN M4-P6 in the browser: the per-viewer theme switcher and the functional-signal conformance check.
 *
 * Conformance (PLAN M4-P6 acceptance): "For each theme and each functional signal (tapped, selected, hovered,
 * displaced, attacking, blocking, face-down, foil, each seat colour, speaking, pending confirmation, away), the
 * signalled card or element differs from its neutral version by a measured contrast threshold in a controlled
 * screenshot pair." DESIGN "Themes and rendering": "Functional signals … are defined once in the engine and every theme
 * must render all of them distinguishably; a theme checklist and a screenshot test per signal enforce this."
 *
 * How a pair is measured (themes/signals.ts; decision M4-C, recorded in docs/DECISIONS.md): the same table is captured
 * neutral twice and signalled once, with everything else unchanged and reduced motion on (no tweens, static foil
 * sheen). The region is found through the debug hook (`cards`, `drawnLines`, `stack`) or the avatar element, as the
 * union of its neutral and signalled extent grown by the signal's margin. The signal passes when the fraction of the
 * region's pixels whose largest channel difference exceeds `threshold.channelDelta`, minus the same fraction between
 * the two neutral captures (the noise floor: particles, flicker), reaches `threshold.changedFraction`. The measured
 * numbers are attached to each test as annotations and the cropped pairs written to artifacts/shots/M4/signals/.
 *
 * Every registered theme runs (THEME_IDS); a theme that is still M4-C's stub on this branch is skipped with a marker
 * naming the package that replaces it, and the M4 gate runs the spec over all four.
 *
 * Switcher (PLAN M4-P6: per-viewer theme picker, lazy chunk loading, HUD token mapping to CSS custom properties,
 * per-theme seat-colour tuning; DESIGN: "Themes are chosen per viewer, loaded on demand as separate chunks and
 * switchable mid-game without reloading; two players at the same table can use different themes").
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { Action } from '../../src/core/actions';
import type { Pose, TableState } from '../../src/core/types';
import type { DrawnLine } from '../../src/scene/lines';
import type { DebugStackEntry } from '../../src/scene/stack';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import { GEOMETRY } from '../../src/core/geometry';
import { SIGNALS, THEME_IDS, THEME_LABELS, contrastRatio, hudCssVars, loadTheme, type SignalId, type SignalSpec, type ThemeId } from '../../src/themes/index';
import { changedFraction, crop, decodePng, encodePng, measurePair, unionRect, type PairMeasure, type Pixels, type Rect } from '../unit/themes/conformance/pixels';
import { hook } from './helpers/app';
import { chair, decklist, freshRoom, openTable, setNickname } from './lobby/helpers';
import { freshProfile, openSolo } from './solo/helpers';

// --- Shared helpers ---------------------------------------------------------------------------------------------------

/** Card faces from the recorded M19 fixtures (tests/fixtures/scryfall). */
const SID = ['226f7c45-db9f-4d48-b575-4d2f1904c963', '2f717e04-c078-4696-9ed6-e973033d7be0', '62d2e929-7ae3-4560-9cfa-53b89c8a6016'];

/** A theme that is still M4-C's stub on this branch names the package that replaces it (themes/stub.ts). */
function stubOf(id: ThemeId): string | null {
  const src = fs.readFileSync(path.join('src', 'themes', id, 'index.ts'), 'utf8');
  if (!src.includes('stubTheme(')) return null;
  return /'(M4-P\d)'/.exec(src)?.[1] ?? 'its theme package';
}

const cards = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const state = (page: Page) => hook<TableState>(page, 'state');
const hash = (page: Page) => page.evaluate(() => window.__spellplane!.session!.hash());
const currentTheme = (page: Page) => hook<ThemeId>(page, 'theme.current');
const loadedThemes = (page: Page) => hook<ThemeId[]>(page, 'theme.loaded');

/** Switch the theme through the debug hook; resolves once the new theme rendered a frame (debug/types.ts ThemeDebug). */
async function setTheme(page: Page, id: ThemeId): Promise<void> {
  await page.evaluate((t) => window.__spellplane!.theme!.set(t), id);
}

let cid = 0;
async function dispatch(page: Page, a: Record<string, unknown>): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { by: 's0', cid: `sig-${++cid}`, ...a });
}

/** Wait for `n` drawn frames. */
async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(k);
      }),
    n,
  );
}

/** Every drawn card is at rest with its texture loaded, and a few more frames have been drawn. */
async function settle(page: Page): Promise<void> {
  await expect.poll(async () => (await cards(page)).every((c) => !c.moving && !c.dragging && (c.visible ? c.tier !== null : true)), { timeout: 15_000 }).toBe(true);
  await frames(page, 4);
}

async function card(page: Page, id: string): Promise<SceneDebugCard> {
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c;
}

const centreOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const rectOf = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/** A full-viewport screenshot, decoded, with its device pixel ratio. */
async function capture(page: Page): Promise<{ img: Pixels; scale: number }> {
  const img = decodePng(await page.screenshot({ animations: 'allow', caret: 'hide' }));
  const vw = page.viewportSize()!.width;
  return { img, scale: img.width / vw };
}

/** Table mm → screen px from three cards' table centres and screen centres (an affine fit; bird's-eye is affine). */
function affine(points: { table: { x: number; y: number }; screen: { x: number; y: number } }[]): (p: { x: number; y: number }) => { x: number; y: number } {
  const [p, q, r] = points as [(typeof points)[0], (typeof points)[0], (typeof points)[0]];
  const det = p.table.x * (q.table.y - r.table.y) - p.table.y * (q.table.x - r.table.x) + (q.table.x * r.table.y - r.table.x * q.table.y);
  if (Math.abs(det) < 1e-6) throw new Error('reference cards are collinear');
  const solve = (v: (s: { x: number; y: number }) => number) => {
    const [a1, a2, a3] = [v(p.screen), v(q.screen), v(r.screen)];
    const a = (a1 * (q.table.y - r.table.y) - p.table.y * (a2 - a3) + (a2 * r.table.y - a3 * q.table.y)) / det;
    const b = (p.table.x * (a2 - a3) - a1 * (q.table.x - r.table.x) + (q.table.x * a3 - r.table.x * a2)) / det;
    const c = (p.table.x * (q.table.y * a3 - r.table.y * a2) - p.table.y * (q.table.x * a3 - r.table.x * a2) + a1 * (q.table.x * r.table.y - r.table.x * q.table.y)) / det;
    return (t: { x: number; y: number }) => a * t.x + b * t.y + c;
  };
  const sx = solve((s) => s.x);
  const sy = solve((s) => s.y);
  return (t) => ({ x: sx(t), y: sy(t) });
}

/** Write the cropped pair as review evidence (screenshots are evidence, not baselines). */
function evidence(info: TestInfo, theme: ThemeId, name: string, images: Record<string, Pixels>): void {
  const dir = path.join('artifacts', 'shots', 'M4', 'signals', theme);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, img] of Object.entries(images)) fs.writeFileSync(path.join(dir, `${name}-${k}-${info.project.name}.png`), encodePng(img));
}

function spec(id: SignalId): SignalSpec {
  const s = SIGNALS.find((x) => x.id === id);
  if (!s) throw new Error(`no signal ${id}`);
  return s;
}

interface PairPlan {
  /** Rectangles (CSS px) the signal covers in this phase; the region is their union over both phases. */
  region(phase: 'neutral' | 'signalled'): Promise<Rect[]>;
  /** Margin around the union in CSS px. */
  margin: number;
  /** Turn the signal on; everything else stays as it is. */
  signal(): Promise<void>;
  /** Wait until the page shows the state of a phase. */
  ready(): Promise<void>;
}

/** Capture and measure a controlled pair, record it, and assert the signal's threshold. */
/** `evidenceOnly`: record the pair and its numbers without asserting the threshold (extra evidence for the gate). */
async function measure(page: Page, info: TestInfo, theme: ThemeId, s: SignalSpec, plan: PairPlan, name: string = s.id, evidenceOnly = false): Promise<PairMeasure> {
  await plan.ready();
  const n1 = await capture(page);
  const rects = await plan.region('neutral');
  await frames(page, 12);
  const n2 = await capture(page);
  await plan.signal();
  await plan.ready();
  const sg = await capture(page);
  rects.push(...(await plan.region('signalled')));
  const region = unionRect(rects, plan.margin);
  const [a, b, c] = [crop(n1.img, region, n1.scale), crop(n2.img, region, n2.scale), crop(sg.img, region, sg.scale)];
  const m = measurePair(a, b, c, s.threshold.channelDelta);
  evidence(info, theme, name, { neutral: a, signalled: c });
  info.annotations.push({ type: 'signal', description: `${theme} ${name}: ${(m.signal * 100).toFixed(2)}% changed beyond ${s.threshold.channelDelta}/255 (noise ${(m.noise * 100).toFixed(2)}%, threshold ${(s.threshold.changedFraction * 100).toFixed(1)}%, region ${Math.round(region.width)}×${Math.round(region.height)} px)` });
  if (!evidenceOnly) expect(m.signal, `${theme} ${name}: changed ${m.changed}, noise ${m.noise}`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
  return m;
}

// --- The controlled table ----------------------------------------------------------------------------------------------

/**
 * The solo table in `theme` with reduced motion and the bird's-eye camera: c1 and c2 in the own front row, o1 in the
 * far seat's front row, the pointer resting on empty table left of c1.
 */
async function controlledTable(page: Page, info: TestInfo, theme: ThemeId): Promise<{ rest: { x: number; y: number }; pxPerMm: number; toScreen: (p: { x: number; y: number }) => { x: number; y: number } }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible();
  await setTheme(page, theme);
  expect(await currentTheme(page)).toBe(theme);
  // The bird's-eye rig for every theme, so regions come from a near-affine view (the gate's matrix covers both rigs).
  await page.evaluate(() => {
    const rig = window.__spellplane!.rig;
    if (rig && rig.rig() !== 'birdseye') rig.setRig('birdseye', { animate: false });
  });
  const tok = (c: string, zone: string, pose: Pose, sid: string) => dispatch(page, { type: 'createToken', card: c, zone, pose, ref: { sid } });
  await tok('c1', 'battlefield:s0', { x: -100, y: -200, rot: 0 }, SID[0]!);
  await tok('c2', 'battlefield:s0', { x: 100, y: -200, rot: 0 }, SID[1]!);
  await tok('o1', 'battlefield:s1', { x: 0, y: 200, rot: 180 }, SID[2]!);
  await expect.poll(async () => (await cards(page)).filter((c) => c.zone.startsWith('battlefield')).length).toBe(3);
  await settle(page);
  const [c1, c2, o1] = [await card(page, 'c1'), await card(page, 'c2'), await card(page, 'o1')];
  const pxPerMm = c1.screen.height / GEOMETRY.card.h;
  const toScreen = affine([
    { table: { x: -100, y: -200 }, screen: centreOf(c1.screen) },
    { table: { x: 100, y: -200 }, screen: centreOf(c2.screen) },
    { table: { x: 0, y: 200 }, screen: centreOf(o1.screen) },
  ]);
  const rest = toScreen({ x: -250, y: -200 });
  await page.mouse.move(rest.x, rest.y);
  await settle(page);
  return { rest, pxPerMm, toScreen };
}

/** The card's screen rectangle now. */
const cardRect = async (page: Page, id: string) => rectOf((await card(page, id)).screen);

/** Screen rectangles around every drawn line of `kind` touching `cardId` (endpoints mapped from table mm). */
async function lineRects(page: Page, kind: string, cardId: string, toScreen: (p: { x: number; y: number }) => { x: number; y: number }): Promise<Rect[]> {
  const lines = (await hook<DrawnLine[]>(page, 'drawnLines')).filter((l) => l.kind === kind);
  const own = lines.filter((l) => l.id.includes(cardId) || l.source === 'state');
  return own.map((l) => {
    const a = toScreen(l.from);
    const b = toScreen(l.to);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  });
}

/** The avatar of a seat on screen. */
async function avatarRect(page: Page, seat: string): Promise<Rect> {
  const box = await page.locator(`[data-testid="avatar"][data-seat="${seat}"]`).boundingBox();
  if (!box) throw new Error(`no avatar for ${seat}`);
  return box;
}

// --- Conformance: one block per theme -----------------------------------------------------------------------------------

for (const theme of THEME_IDS) {
  test.describe(`signal conformance: ${THEME_LABELS[theme]}`, () => {
    const stub = stubOf(theme);
    test.skip(stub !== null, `${THEME_LABELS[theme]} is still the M4-C stub on this branch (replaced by ${stub}); the M4 gate runs it`);
    test.describe.configure({ timeout: 90_000 });

    test('tapped', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('tapped');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async () => [await cardRect(page, 'c1')],
        signal: async () => {
          await dispatch(page, { type: 'tap', card: 'c1', tapped: true });
          await expect.poll(async () => (await card(page, 'c1')).tapped).toBe(true);
        },
        ready: () => settle(page),
      });
    });

    test('selected', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('selected');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async () => [await cardRect(page, 'c1')],
        signal: async () => {
          const c = centreOf(await cardRect(page, 'c1'));
          await page.mouse.click(c.x, c.y);
          await page.mouse.move(t.rest.x, t.rest.y, { steps: 4 });
          await expect.poll(async () => (await card(page, 'c1')).selected).toBe(true);
        },
        ready: () => settle(page),
      });
      expect((await card(page, 'c2')).selected).toBe(false);
    });

    test('hovered', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('hovered');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async () => [await cardRect(page, 'c1')],
        signal: async () => {
          const c = centreOf(await cardRect(page, 'c1'));
          await page.mouse.move(c.x, c.y, { steps: 4 });
        },
        ready: () => settle(page),
      });
      // Hover is view state: nothing was dispatched, nothing selected.
      expect((await card(page, 'c1')).selected).toBe(false);
    });

    test('displaced', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('displaced');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        // The ghost outline sits at the home slot, which is the neutral rectangle.
        region: async () => [await cardRect(page, 'c1')],
        signal: async () => {
          await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -110, rot: 0 } });
          await expect.poll(async () => (await card(page, 'c1')).displaced).toBe(true);
        },
        ready: () => settle(page),
      });
      expect((await card(page, 'c1')).ghost).toEqual({ x: -100, y: -200, rot: 0 });
    });

    test('attacking', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('attacking');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async (phase) => [await cardRect(page, 'c1'), ...(phase === 'signalled' ? await lineRects(page, 'attack', 'c1', t.toScreen) : [])],
        signal: async () => {
          // What A does (DESIGN "Combat and annotation"): 110 mm forward, tapped, an attack line toward the opponent.
          await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -90, rot: 0 }, combat: 'attack', tap: true });
          await expect.poll(async () => (await state(page)).cards.c1?.combat).toBe('attack');
          // With one opponent the target is implicit (DESIGN "Combat and annotation", Attack target): no line is
          // required, but any attack line drawn from c1 is part of the region.
        },
        ready: () => settle(page),
      });
    });

    test('attacking against a plain displaced card at the same pose (evidence only)', async ({ page }, info) => {
      // The attacking pair above is carried mostly by the 110 mm move. This pair isolates the theme's attack styling:
      // the neutral card is already displaced and tapped at the attack pose, the signalled one is the same card marked
      // attacking. Recorded for the gate (annotation and cropped pair), not asserted: M4-C's signal spec measures
      // attacking against the card at home.
      const t = await controlledTable(page, info, theme);
      const s = spec('attacking');
      await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -90, rot: 0 }, tap: true });
      await expect.poll(async () => (await card(page, 'c1')).displaced).toBe(true);
      await measure(
        page,
        info,
        theme,
        s,
        {
          margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
          region: async (phase) => [await cardRect(page, 'c1'), ...(phase === 'signalled' ? await lineRects(page, 'attack', 'c1', t.toScreen) : [])],
          signal: async () => {
            await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -90, rot: 0 }, combat: 'attack', tap: true });
            await expect.poll(async () => (await state(page)).cards.c1?.combat).toBe('attack');
          },
          ready: () => settle(page),
        },
        'attacking-vs-displaced',
        true,
      );
    });

    test('blocking', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('blocking');
      // The far seat attacks first; that is part of the neutral state.
      await dispatch(page, { type: 'moveTemp', card: 'o1', pose: { x: 0, y: 90, rot: 180 }, combat: 'attack', tap: true });
      await expect.poll(async () => (await state(page)).cards.o1?.combat).toBe('attack');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async (phase) => [await cardRect(page, 'c1'), ...(phase === 'signalled' ? await lineRects(page, 'block', 'c1', t.toScreen) : [])],
        signal: async () => {
          await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: 0, y: -6, rot: 0 }, combat: 'block', group: 'blk' });
          await dispatch(page, { type: 'lineAdd', line: 'blk', kind: 'block', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'o1' }, group: 'blk' });
          await expect.poll(async () => Object.values((await state(page)).lines).filter((l) => l.kind === 'block').length).toBe(1);
        },
        ready: () => settle(page),
      });
    });

    test('face-down', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('faceDown');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async () => [await cardRect(page, 'o1')],
        signal: async () => {
          // The far seat's card, as an opponent sees it: face down shows the neutral back.
          await dispatch(page, { type: 'flip', card: 'o1', face: 'down' });
          await expect.poll(async () => (await card(page, 'o1')).face).toBe('down');
        },
        ready: () => settle(page),
      });
    });

    test('foil', async ({ page }, info) => {
      // The play table marks a foil printing with the sheen (a rim outside the face) and a badge over the bottom-left
      // corner (scene/foil.ts TABLE_FOIL); the face itself is never tinted.
      const t = await controlledTable(page, info, theme);
      const s = spec('foil');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async (phase) => [await cardRect(page, phase === 'neutral' ? 'c1' : 'c1f')],
        signal: async () => {
          // The same printing, foil, in the same place (CardRef.foil; reduced motion: a static sheen).
          await dispatch(page, { type: 'remove', card: 'c1', group: 'foil' });
          await dispatch(page, { type: 'createToken', card: 'c1f', zone: 'battlefield:s0', pose: { x: -100, y: -200, rot: 0 }, ref: { sid: SID[0], foil: true }, group: 'foil' });
          await expect.poll(async () => (await cards(page)).map((c) => c.id).sort()).toEqual(['c1f', 'c2', 'o1']);
          expect((await state(page)).cards.c1f?.identity?.foil, 'the foil card is in the state').toBe(true);
          await expect.poll(async () => (await card(page, 'c1f')).foil, 'the table draws the foil marker').toBe(true);
        },
        ready: () => settle(page),
      });
    });

    test('seat colour: each of the eight against the table and against each other', async ({ page }, info) => {
      test.setTimeout(150_000);
      const t = await controlledTable(page, info, theme);
      const s = spec('seatColour');
      const [c1, c2] = [await cardRect(page, 'c1'), await cardRect(page, 'c2')];
      const y = centreOf(c1).y;
      const half = Math.max(4, 3 * t.pxPerMm);
      const gap = 2 * t.pxPerMm;
      // Table surface between the two cards, around the target line from c1 to c2.
      const region: Rect = { x: c1.x + c1.width + gap, y: y - half, width: c2.x - gap - (c1.x + c1.width + gap), height: 2 * half };
      expect(region.width).toBeGreaterThan(20);
      const name = (await state(page)).seats.s0!.name || 'Player';
      const shot = async () => {
        await settle(page);
        const c = await capture(page);
        return crop(c.img, region, c.scale);
      };
      const neutral = await shot();
      await frames(page, 12);
      const noise = changedFraction(neutral, await shot(), s.threshold.channelDelta);
      const lines: Pixels[] = [];
      for (let colour = 0; colour < 8; colour++) {
        await dispatch(page, { type: 'seatTake', seat: 's0', name, colour });
        await expect.poll(async () => (await state(page)).seats.s0!.colour).toBe(colour);
        await dispatch(page, { type: 'lineAdd', line: `t${colour}`, kind: 'target', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'c2' } });
        await expect.poll(async () => (await hook<DrawnLine[]>(page, 'drawnLines')).some((l) => l.id === `t${colour}`)).toBe(true);
        const img = await shot();
        lines.push(img);
        evidence(info, theme, `seat-${colour}`, { line: img });
        const vsSurface = changedFraction(neutral, img, s.threshold.channelDelta) - noise;
        info.annotations.push({ type: 'signal', description: `${theme} seat colour ${colour} vs table: ${(vsSurface * 100).toFixed(2)}% (noise ${(noise * 100).toFixed(2)}%)` });
        expect.soft(vsSurface, `${theme}: seat colour ${colour} against the table surface`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
        await dispatch(page, { type: 'lineRemove', line: `t${colour}` });
        await expect.poll(async () => Object.keys((await state(page)).lines).length).toBe(0);
      }
      evidence(info, theme, 'seat-none', { surface: neutral });
      let closest = { i: -1, j: -1, f: Infinity };
      for (let i = 0; i < 8; i++)
        for (let j = i + 1; j < 8; j++) {
          const f = changedFraction(lines[i]!, lines[j]!, s.threshold.channelDelta) - noise;
          if (f < closest.f) closest = { i, j, f };
          expect.soft(f, `${theme}: seat colours ${i} and ${j} tell apart`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
        }
      info.annotations.push({ type: 'signal', description: `${theme} closest seat pair ${closest.i}/${closest.j}: ${(closest.f * 100).toFixed(2)}%` });
    });

    test('pending confirmation', async ({ page }, info) => {
      const t = await controlledTable(page, info, theme);
      const s = spec('pendingConfirmation');
      // A second player at the table, so a round waits on someone.
      await dispatch(page, { type: 'seatTake', seat: 's1', name: 'Opponent', colour: 1 });
      await dispatch(page, { type: 'stackPush', item: 'i1', kind: 'ability', source: 'c2', note: 'draw a card' });
      const entry = async () => (await hook<DebugStackEntry[]>(page, 'stack')).find((e) => e.item === 'i1');
      // The neutral is themes/signals.ts's: the stack item after every player passed. A first round about i1 runs to
      // the end, so the pair also shows that a finished round is styled apart from a waiting one. This page speaks only
      // for s0, so the opponent's silence is timed out as the sequencer's pass timer would (a timer the round needs; the
      // solo table arms none, and the signal round below gets the table's own setting back).
      const timer = (await state(page)).settings.passTimerMs;
      await dispatch(page, { type: 'settings', settings: { passTimerMs: 30_000 } });
      await expect.poll(async () => (await state(page)).settings.passTimerMs).toBe(30_000);
      await dispatch(page, { type: 'ask', round: 'r0', about: 'i1' });
      await expect.poll(async () => (await entry())?.pending).toBe(true);
      await dispatch(page, { type: 'settings', settings: { passTimerMs: timer } });
      await dispatch(page, { type: 'respond', round: 'r0', seat: 's1', response: 'timeout' });
      await expect.poll(async () => (await state(page)).confirm?.responses.s1).toBe('timeout');
      expect((await state(page)).settings.passTimerMs).toBe(timer);
      await expect.poll(async () => (await entry())?.pending).toBe(false);
      expect((await state(page)).confirm?.about).toBe('i1');
      await measure(page, info, theme, s, {
        margin: (s.probe as { marginMm: number }).marginMm * t.pxPerMm,
        region: async () => {
          const e = await entry();
          if (!e) throw new Error('stack item i1 is not drawn');
          return [rectOf(e.screen)];
        },
        signal: async () => {
          await dispatch(page, { type: 'ask', round: 'r1', about: 'i1' });
          await expect.poll(async () => (await entry())?.pending).toBe(true);
        },
        ready: () => settle(page),
      });
      // Still waiting: the solo table runs no pass timer, so the pair was taken while the round waited.
      expect((await entry())?.pending).toBe(true);
    });

    test('away', async ({ page }, info) => {
      await controlledTable(page, info, theme);
      const s = spec('away');
      const probe = s.probe as { selector: string; attribute: string; on: string; off: string };
      const avatar = page.locator(probe.selector.replace('{seat}', 's0'));
      await expect(avatar).toHaveAttribute(probe.attribute, probe.off);
      await measure(page, info, theme, s, {
        margin: 4,
        region: async () => [await avatarRect(page, 's0')],
        signal: async () => {
          await dispatch(page, { type: 'away', seat: 's0', away: true });
          await expect(avatar).toHaveAttribute(probe.attribute, probe.on);
        },
        ready: () => frames(page, 4),
      });
    });

    test('speaking', async ({ browser, browserName }, info) => {
      test.skip(browserName !== 'chromium', 'live voice needs fake media, which is Chromium-only (WebKit would prompt for the microphone)');
      test.setTimeout(150_000);
      const s = spec('speaking');
      const probe = s.probe as { selector: string; attribute: string; on: string; off: string };
      const { a, close } = await twoAtATable(browser, info, { reducedMotion: 'reduce' });
      try {
        await setTheme(a, theme);
        await a.getByTestId('voice-join').click();
        await expect(a.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
        const avatar = a.locator(probe.selector.replace('{seat}', 's0'));
        await expect(avatar).toHaveAttribute(probe.attribute, probe.off);
        // The pointer rests on the table, so the talk key is not typed into a field.
        await a.mouse.move(700, 420);
        await measure(a, info, theme, s, {
          margin: 6,
          region: async () => [await avatarRect(a, 's0')],
          signal: async () => {
            await a.keyboard.down('v');
            await expect(avatar).toHaveAttribute(probe.attribute, probe.on);
          },
          ready: () => frames(a, 4),
        });
        await a.keyboard.up('v');
        await expect(avatar).toHaveAttribute(probe.attribute, probe.off);
      } finally {
        await close();
      }
    });
  });
}

test('every registered theme and every functional signal is covered', () => {
  expect([...THEME_IDS]).toEqual(['paper', 'dusk', 'wyrm', 'stonetable']);
  // The per-theme block above has one test per signal; these are their ids in PLAN order.
  expect(SIGNALS.map((s) => s.id)).toEqual(['tapped', 'selected', 'hovered', 'displaced', 'attacking', 'blocking', 'faceDown', 'foil', 'seatColour', 'speaking', 'pendingConfirmation', 'away']);
});

// --- Text on a seat colour ----------------------------------------------------------------------------------------------

/** `rgb(r, g, b)` / `rgba(r, g, b, 1)` → `#rrggbb` (seat chips are opaque). */
function rgbHex(css: string): string {
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css.trim());
  if (!m) throw new Error(`cannot read colour ${css}`);
  if (m[4] !== undefined && Number(m[4]) < 1) throw new Error(`translucent colour ${css}`);
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

test('text the HUD draws on a seat colour (the "asks" tag, the attribution flash name) reaches 4.5:1 in every theme and seat colour', async ({ page }, info) => {
  // DESIGN "Input and interaction design", Accessibility: "Paper meets WCAG AA contrast throughout"; "Themes and
  // rendering", Tokens: seat colours "tuned per theme for contrast", exposed to the HUD as CSS custom properties. The
  // check reads the computed colours the browser drew, not the tokens.
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible();
  // Every flash name the page shows, read as it appears (a flash lasts the ping fade time only; on a slow renderer the
  // next animation frame can come after it is gone, so the computed style is read in the observer itself).
  await page.evaluate(() => {
    const w = window as unknown as { __whoSeen: { colour: string; background: string }[] };
    w.__whoSeen = [];
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          for (const who of [n, ...n.querySelectorAll<HTMLElement>('*')].filter((e) => e.classList.contains('who') && e.closest('[data-testid="attribution-flash"]'))) {
            if (!who.isConnected) continue;
            const cs = getComputedStyle(who);
            w.__whoSeen.push({ colour: cs.color, background: cs.backgroundColor });
          }
        }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const name = (await state(page)).seats.s0!.name || 'Player';
  // A second player, so a manual round waits on someone; the solo table runs no pass timer, so it keeps waiting.
  await dispatch(page, { type: 'seatTake', seat: 's1', name: 'Opponent', colour: 0 });
  await dispatch(page, { type: 'createToken', card: 'theirs', zone: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 }, label: 'Their token', controller: 's1' });
  await dispatch(page, { type: 'ask', round: 'ink' });
  const tag = page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="asking"]');
  await expect(tag).toBeVisible();
  let tapped = false;
  for (const theme of THEME_IDS) {
    await setTheme(page, theme);
    const seats = (await loadTheme(theme)).tokens.colours.seats;
    for (let colour = 0; colour < 8; colour++) {
      await dispatch(page, { type: 'seatTake', seat: 's0', name, colour });
      const seatHex = seats[colour]!.colour.toLowerCase();
      await expect.poll(async () => rgbHex(await tag.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(seatHex);
      const ink = rgbHex(await tag.evaluate((el) => getComputedStyle(el).color));
      expect(contrastRatio(ink, seatHex), `${theme} seat ${colour}: "asks" ${ink} on ${seatHex}`).toBeGreaterThanOrEqual(4.5);

      // s0 touches s1's card: the flash names s0 on s0's seat colour.
      const before = await page.evaluate(() => (window as unknown as { __whoSeen: unknown[] }).__whoSeen.length);
      tapped = !tapped;
      await dispatch(page, { type: 'tap', card: 'theirs', tapped });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __whoSeen: unknown[] }).__whoSeen.length), { timeout: 10_000 }).toBeGreaterThan(before);
      const seen = await page.evaluate((i) => (window as unknown as { __whoSeen: { colour: string; background: string }[] }).__whoSeen[i]!, before);
      expect(rgbHex(seen.background), `${theme} seat ${colour}: flash name background`).toBe(seatHex);
      const whoInk = rgbHex(seen.colour);
      expect(contrastRatio(whoInk, seatHex), `${theme} seat ${colour}: flash name ${whoInk} on ${seatHex}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// --- Two players at one networked table ---------------------------------------------------------------------------------

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

/** Ann (s0) and Ben (s1) on the local transport, each with an own profile, past the lobby into a started game. */
async function twoAtATable(browser: Browser, info: TestInfo, opts: { reducedMotion?: 'reduce' } = {}, profiles?: { a: string; b: string }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}) });
  const a = await context.newPage();
  const b = await context.newPage();
  const room = freshRoom();
  const pa = profiles?.a ?? `sig-a-${freshProfile(info)}`;
  const pb = profiles?.b ?? `sig-b-${freshProfile(info)}`;
  await openTable(a, room, pa);
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await openTable(b, room, pb);
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible();
  return { context, a, b, room, pa, pb, close: () => context.close() };
}

// --- The switcher -------------------------------------------------------------------------------------------------------

test.describe('theme switcher', () => {
  /** Script URLs the page has requested so far. */
  function scriptLog(page: Page): Set<string> {
    const seen = new Set<string>();
    page.on('request', (r) => {
      if (r.resourceType() === 'script' || /\.m?js(\?|$)/.test(r.url())) seen.add(r.url());
    });
    return seen;
  }

  test('the HUD picker switches this page’s theme; each theme’s chunk is fetched the first time it is picked, never before and never twice', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const scripts = scriptLog(page);
    await openSolo(page, freshProfile(info));
    await expect(page.getByTestId('hud')).toBeVisible();
    expect(await currentTheme(page)).toBe('paper');
    expect(await loadedThemes(page)).toEqual(['paper']);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');

    await page.getByTestId('open-theme-settings').click();
    const picker = page.getByTestId('theme-settings');
    await expect(picker).toBeVisible();
    const option = (id: ThemeId) => picker.locator(`[data-testid="theme-option"][data-theme="${id}"] input`);
    await expect(option('paper')).toBeChecked();
    for (const id of THEME_IDS) await expect(picker.locator(`[data-testid="theme-option"][data-theme="${id}"]`)).toContainText(THEME_LABELS[id]);

    const pick = async (id: ThemeId): Promise<string[]> => {
      const before = new Set(scripts);
      await option(id).check();
      await expect.poll(() => currentTheme(page)).toBe(id);
      await expect(option(id)).toBeChecked();
      await expect(page.locator('html')).toHaveAttribute('data-theme', id);
      // The scene was handed the new theme without a reload (its render stats name it).
      await expect.poll(() => hook<{ theme: string }>(page, 'render.stats').then((r) => r.theme)).toBe(id);
      await frames(page, 2);
      return [...scripts].filter((u) => !before.has(u));
    };

    expect(await pick('dusk')).not.toHaveLength(0);
    expect(await loadedThemes(page)).toEqual(['paper', 'dusk']);
    expect(await pick('wyrm')).not.toHaveLength(0);
    expect(await loadedThemes(page)).toEqual(['paper', 'dusk', 'wyrm']);
    expect(await pick('paper')).toEqual([]);
    expect(await pick('dusk')).toEqual([]);
    expect(await pick('stonetable')).not.toHaveLength(0);
    expect(await loadedThemes(page)).toEqual(['paper', 'dusk', 'wyrm', 'stonetable']);
    // Closing the picker leaves the choice.
    await page.getByTestId('theme-close').click();
    await expect(picker).toHaveCount(0);
    expect(await currentTheme(page)).toBe('stonetable');
    // It is a dismissible popover: Esc closes it, and so does a press outside it (here on the table).
    await page.getByTestId('open-theme-settings').click();
    await expect(picker).toBeVisible();
    await option('dusk').focus();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await page.getByTestId('open-theme-settings').click();
    await expect(picker).toBeVisible();
    // A press inside it leaves it open.
    await picker.getByTestId('theme-picker').locator('legend').click();
    await expect(picker).toBeVisible();
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await expect(picker).toHaveCount(0);
    expect(await currentTheme(page)).toBe('stonetable');
    expect(errors).toEqual([]);
  });

  test('switching mid-game keeps the table, the HUD takes the theme’s tokens and seat colours, and the choice survives a reload', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const profile = freshProfile(info);
    await openSolo(page, profile);
    await expect(page.getByTestId('hud')).toBeVisible();
    await dispatch(page, { type: 'createToken', card: 'm1', zone: 'battlefield:s0', pose: { x: -60, y: -200, rot: 0 }, ref: { sid: SID[0] } });
    await dispatch(page, { type: 'createToken', card: 'm2', zone: 'battlefield:s0', pose: { x: 60, y: -200, rot: 0 }, ref: { sid: SID[1] } });
    await dispatch(page, { type: 'tap', card: 'm2', tapped: true });
    await expect.poll(async () => (await cards(page)).length).toBeGreaterThanOrEqual(2);
    const before = await hash(page);

    const cssVar = (sel: string, name: string) => page.locator(sel).first().evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);
    for (const id of [...THEME_IDS, 'paper' as const, 'stonetable' as const]) {
      await setTheme(page, id);
      expect(await currentTheme(page)).toBe(id);
      // Theme is per viewer: the shared state does not move.
      expect(await hash(page)).toBe(before);
      expect((await cards(page)).filter((c) => c.id === 'm1' || c.id === 'm2').map((c) => c.visible)).toEqual([true, true]);
      // HUD token mapping: the HUD root and the page carry the theme's custom properties.
      const expected = hudCssVars((await loadTheme(id)).tokens);
      for (const k of ['--sp-bg', '--sp-fg', '--sp-surface', '--sp-hud-panel', '--sp-seat-0', '--sp-seat-1', '--sp-seat-7', '--sp-seat-2-ink', '--sp-font-size']) {
        expect(await cssVar('[data-testid="hud"]', k), `${id} ${k} on the HUD`).toBe(expected[k]);
        expect(await cssVar('html', k), `${id} ${k} on the page`).toBe(expected[k]);
      }
      // Per-theme seat colours reach the HUD: the own avatar's seat stripe is the theme's colour for its seat.
      const seatColour = (await state(page)).seats.s0!.colour;
      const stripe = await page.locator('[data-testid="avatar"][data-seat="s0"]').evaluate((el) => getComputedStyle(el).borderLeftColor);
      const hex = expected[`--sp-seat-${seatColour}`]!;
      const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      expect(stripe, `${id}: seat ${seatColour} stripe`).toBe(rgb);
    }

    // The choice is this browser's setting: a reload comes back in Stonetable, loading only that chunk.
    await page.reload();
    await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.theme?.current === 'function')).toBe(true);
    await expect(page.getByTestId('hud')).toBeVisible();
    expect(await currentTheme(page)).toBe('stonetable');
    expect(await loadedThemes(page)).toEqual(['paper', 'stonetable']);
    await expect.poll(() => hook<{ theme: string }>(page, 'render.stats').then((r) => r.theme)).toBe('stonetable');
    await expect.poll(() => hash(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test('a theme chunk that cannot be loaded leaves the current theme and says so; picking again works once it can', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await expect(page.getByTestId('hud')).toBeVisible();
    // From now on new scripts fail, as an offline page would for a chunk it never fetched.
    let block = true;
    await page.route('**/*.js', (route) => (block ? route.abort('internetdisconnected') : route.continue()));
    await page.getByTestId('open-theme-settings').click();
    const option = (id: ThemeId) => page.locator(`[data-testid="theme-option"][data-theme="${id}"] input`);
    // A click, not check(): the radio springs back to Paper as soon as the load fails, which may be before check() looks.
    await option('wyrm').click();
    await expect(page.getByTestId('theme-error')).toContainText('Wyrm could not be loaded');
    // Picking again on this page would fail the same way (the browser keeps the failed import), so the text says to reload.
    await expect(page.getByTestId('theme-error')).toContainText('reload the page to try again');
    expect(await currentTheme(page)).toBe('paper');
    await expect(option('paper')).toBeChecked();
    await expect(option('wyrm')).not.toBeChecked();
    // Picking it again on the same page fails at once (the failed import is cached): the radio still springs back.
    await option('wyrm').click();
    await expect(page.getByTestId('theme-error')).toContainText('Wyrm could not be loaded');
    await expect(option('paper')).toBeChecked();
    await expect(option('wyrm')).not.toBeChecked();
    await option('dusk').click();
    await expect(page.getByTestId('theme-error')).toContainText('Dusk could not be loaded');
    await expect(option('paper')).toBeChecked();
    await expect(option('dusk')).not.toBeChecked();
    expect(await currentTheme(page)).toBe('paper');
    expect(await loadedThemes(page)).toEqual(['paper']);
    // The table is still live under it (nothing modal).
    await expect(page.getByTestId('hud')).toBeVisible();
    block = false;
    await page.unroute('**/*.js');
    // A failed dynamic import is cached by the browser for that URL; a reload gives the page a fresh module map.
    await page.reload();
    await expect(page.getByTestId('hud')).toBeVisible();
    expect(await currentTheme(page)).toBe('paper');
    await page.getByTestId('open-theme-settings').click();
    await option('wyrm').check();
    await expect.poll(() => currentTheme(page)).toBe('wyrm');
    await expect(page.getByTestId('theme-error')).toHaveCount(0);
  });

  test('the lobby offers the same picker; its chairs and seat swatches take the theme’s seat colours', async ({ page }, info) => {
    const room = freshRoom();
    await openTable(page, room, `sig-l-${freshProfile(info)}`);
    await setNickname(page, 'Ann');
    await expect(chair(page, 's0')).toHaveAttribute('data-mine', 'true');
    const details = page.getByTestId('lobby-theme');
    await expect(details).toContainText('Theme: Paper');
    await details.locator('summary').click();
    await details.locator('[data-testid="theme-option"][data-theme="stonetable"] input').check();
    await expect.poll(() => currentTheme(page)).toBe('stonetable');
    await expect(details).toContainText('Theme: Stonetable');
    const seats = (await loadTheme('stonetable')).tokens.colours.seats;
    const swatches = page.locator('.swatch');
    await expect(swatches).toHaveCount(8);
    for (let i = 0; i < 8; i++) expect(await swatches.nth(i).evaluate((el) => getComputedStyle(el).getPropertyValue('--seat').trim())).toBe(seats[i]!.colour);
    const lobbyVar = await page.getByTestId('lobby').evaluate((el) => getComputedStyle(el).getPropertyValue('--sp-seat-3').trim());
    expect(lobbyVar).toBe(seats[3]!.colour);
    // Starting a game later keeps it: the table opens in the chosen theme (same page, same choice).
    expect(await loadedThemes(page)).toEqual(['paper', 'stonetable']);
  });

  test('the debug hook refuses an unknown theme', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    const err = await page.evaluate(() => window.__spellplane!.theme!.set('neon' as never).then(() => 'resolved', (e: Error) => e.message));
    expect(err).toContain('unknown theme neon');
    expect(await currentTheme(page)).toBe('paper');
  });

  test('two players at one table use different themes; a switch sends nothing and changes nothing for the other', async ({ browser }, info) => {
    test.setTimeout(150_000);
    const t = await twoAtATable(browser, info);
    const { a, b } = t;
    try {
      const sent = async (p: Page) => (await hook<{ dir: string; channel: string; msg: unknown }[]>(p, 'net.messages')).filter((m) => m.dir === 'out');
      // Heartbeats and presence keep flowing; actions and private messages are what a switch must not cause.
      const sentActs = async (p: Page) => (await sent(p)).filter((m) => m.channel === 'act' || m.channel === 'prv').length;
      const outBefore = (await sent(a)).length;
      const actsBefore = await sentActs(a);
      const hashBefore = await hash(a);
      await a.getByTestId('open-theme-settings').click();
      await a.locator('[data-testid="theme-option"][data-theme="dusk"] input').check();
      await expect.poll(() => currentTheme(a)).toBe('dusk');
      await frames(a, 4);
      expect(await currentTheme(b)).toBe('paper');
      await expect(b.locator('html')).toHaveAttribute('data-theme', 'paper');
      expect(await loadedThemes(b)).toEqual(['paper']);
      // Nothing but presence went out for the switch, and the table is the same in both browsers.
      expect(await sentActs(a)).toBe(actsBefore);
      // No message this page sent since names the theme.
      expect(JSON.stringify((await sent(a)).slice(outBefore))).not.toMatch(/"dusk"|theme/i);
      expect(await hash(a)).toBe(hashBefore);
      await expect.poll(() => hash(b)).toBe(hashBefore);

      await setTheme(b, 'wyrm');
      expect(await currentTheme(a)).toBe('dusk');
      expect(await currentTheme(b)).toBe('wyrm');

      // Each browser keeps its own choice across a reload.
      await a.reload();
      await expect(a.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => currentTheme(a)).toBe('dusk');
      expect(await currentTheme(b)).toBe('wyrm');
      // While a reloads, the sequencer marks its seat away and back (and may hand over the sequencer role), so the
      // shared state moves on: wait until both browsers see s0 present again, then until both hold the same state.
      // Never compare with a snapshot of one side taken mid-way.
      for (const p of [a, b]) await expect.poll(async () => (await state(p)).seats.s0?.away ?? false, { timeout: 15_000 }).toBe(false);
      await expect
        .poll(
          async () => {
            const [x, y] = [await hash(a), await hash(b)];
            return x === y;
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    } finally {
      await t.close();
    }
  });
});
