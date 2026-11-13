/**
 * PLAN M4-P5 acceptance: "Each theme renders the twelve gate states without console errors". The twelve gate states are
 * the functional signals of themes/signals.ts (DESIGN "Themes and rendering": "Functional signals (tapped, selected,
 * attacking, whose card, who is speaking) are defined once in the engine and every theme must render all of them
 * distinguishably").
 *
 * Stonetable is rendered by the real table scene in the render harness (`?harness=render&theme=stonetable`), reduced
 * motion on (no flicker, drift or tweens). Every scene-drawn state the harness's table can reach is set up as a
 * controlled pair: the same table neutral (twice, for the noise floor) and signalled; the pair must differ over the
 * signal's region by the signal's threshold (themes/signals.ts), the debug hook must report the state, and the page must
 * log no error. The HUD-drawn states (speaking, away) and pending confirmation need the app's HUD and engine, which pick
 * their theme through M4-P6's switcher: tests/e2e/signals.spec.ts runs them for Stonetable once both have landed. The
 * table scene draws no foil sheen yet (only the draft and builder surfaces do), so foil is only rendered here, inside
 * the all-states table, not measured (docs/DECISIONS.md M4-P5). Screenshots go to artifacts/shots/M4/stonetable/ as
 * evidence, not baselines.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { GEOMETRY } from '../../../../src/core/geometry';
import { SIGNALS, type SignalId } from '../../../../src/themes/signals';
import { openRender, rh, settle } from '../../render/helpers';
import { changed, evidence, segmentRect, shot, union, type Band, type Rect } from './helpers';

type Card = { id: string; screen: Rect; tapped: boolean; selected: boolean; face: 'up' | 'down'; shows: 'face' | 'back'; displaced: boolean; ghost: unknown; tier: string | null };
type Drawn = { id: string; kind: string; by: string; from: { x: number; y: number }; to: { x: number; y: number } };

let cid = 0;
async function dispatch(page: Page, a: Record<string, unknown>): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as never), { by: 's0', cid: `st-${++cid}`, ...a });
}
const cards = (page: Page) => rh<Card[]>(page, 'cards');
const card = async (page: Page, id: string) => (await cards(page)).find((c) => c.id === id)!;
const drawn = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window.__spellplane as unknown as { drawnLines(): unknown[] }).drawnLines())) as Drawn[]);
const screenOf = async (page: Page, p: { x: number; y: number }) => (await rh<{ x: number; y: number }>(page, 'toScreen', p.x, p.y, 0))!;

const C1 = { x: -120, y: -230, rot: 0 };
const C2 = { x: 120, y: -230, rot: 0 };
const O1 = { x: -120, y: 230, rot: 180 };

/** Stonetable with reduced motion: c1 and c2 on s0's side, o1 on s1's; every face loaded and at rest. */
async function controlledTable(page: Page): Promise<{ errors: string[]; pxPerMm: number }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openRender(page, { theme: 'stonetable', scenario: 'empty' });
  await dispatch(page, { type: 'createToken', card: 'c1', zone: 'battlefield:s0', pose: C1, ref: { sid: 'fx-3' } });
  await dispatch(page, { type: 'createToken', card: 'c2', zone: 'battlefield:s0', pose: C2, ref: { sid: 'fx-11' } });
  await dispatch(page, { type: 'createToken', by: 's1', card: 'o1', zone: 'battlefield:s1', pose: O1, ref: { sid: 'fx-17' } });
  await expect.poll(async () => (await cards(page)).filter((c) => c.tier !== null).length).toBe(3);
  await settle(page);
  expect((await rh<{ theme: string }>(page, 'stats')).theme).toBe('stonetable');
  const c1 = await card(page, 'c1');
  return { errors, pxPerMm: c1.screen.height / GEOMETRY.card.h };
}

const spec = (id: SignalId) => SIGNALS.find((s) => s.id === id)!;

/**
 * Capture neutral twice and signalled once over the union of `region` in both phases; the change above the noise
 * floor must reach the signal's threshold.
 */
async function pair(page: Page, info: TestInfo, id: SignalId, marginPx: number, region: () => Promise<Rect[]>, signal: () => Promise<void>, bands?: () => Promise<Band[]>): Promise<number> {
  const s = spec(id);
  const vp = page.viewportSize()!;
  const before = await region();
  const n1 = await shot(page);
  await rh(page, 'redraw');
  const n2 = await shot(page);
  await signal();
  await settle(page);
  const sig = await shot(page);
  const rect = union([...before, ...(await region())], marginPx, vp);
  const mask = bands ? await bands() : [];
  const noise = await changed(page, n1, n2, rect, s.threshold.channelDelta, mask);
  const delta = await changed(page, n1, sig, rect, s.threshold.channelDelta, mask);
  evidence(info, `${id}-neutral`, n1);
  evidence(info, `${id}-signalled`, sig);
  info.annotations.push({ type: 'signal', description: `${id}: changed ${delta.toFixed(4)}, noise ${noise.toFixed(4)}, region ${Math.round(rect.width)}x${Math.round(rect.height)}` });
  expect(delta - noise, `${id}: changed ${delta}, noise ${noise}`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
  return delta - noise;
}

test.describe('Stonetable renders the gate states (themes/signals.ts) without console errors', () => {
  test.describe.configure({ timeout: 90_000 });

  test('tapped', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    await pair(page, info, 'tapped', 6 * pxPerMm, async () => [(await card(page, 'c1')).screen], async () => {
      await dispatch(page, { type: 'tap', card: 'c1', tapped: true });
      await expect.poll(async () => (await card(page, 'c1')).tapped).toBe(true);
    });
    expect(errors).toEqual([]);
  });

  test('selected', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    await pair(page, info, 'selected', 4 * pxPerMm, async () => [(await card(page, 'c1')).screen], async () => {
      await rh(page, 'setView', { selection: ['c1'] });
      await expect.poll(async () => (await card(page, 'c1')).selected).toBe(true);
    });
    expect((await card(page, 'c2')).selected).toBe(false);
    expect(errors).toEqual([]);
  });

  test('hovered', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    await pair(page, info, 'hovered', 4 * pxPerMm, async () => [(await card(page, 'c1')).screen], async () => {
      await rh(page, 'setView', { hovered: 'c1' });
    });
    expect(errors).toEqual([]);
  });

  test('displaced (with its ghost outline at home)', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    await pair(page, info, 'displaced', 4 * pxPerMm, async () => [(await card(page, 'c1')).screen], async () => {
      await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: C1.x - 30, y: C1.y + 120, rot: 0 } });
      await expect.poll(async () => (await card(page, 'c1')).displaced).toBe(true);
      expect((await card(page, 'c1')).ghost).not.toBeNull();
    });
    expect(errors).toEqual([]);
  });

  test('attacking (displaced forward, glowing attack line to the defender)', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    const lines = async () => {
      const out: Rect[] = [];
      for (const l of (await drawn(page)).filter((x) => x.kind === 'attack')) out.push(segmentRect(await screenOf(page, l.from), await screenOf(page, l.to)));
      return out;
    };
    await pair(page, info, 'attacking', 4 * pxPerMm, async () => [(await card(page, 'c1')).screen, ...(await lines())], async () => {
      await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: C1.x, y: C1.y + GEOMETRY.attackDisplacement, rot: 0 }, combat: 'attack' });
      await dispatch(page, { type: 'lineAdd', line: 'atk', kind: 'attack', from: { kind: 'card', id: 'c1' }, to: { kind: 'seat', id: 's1' } });
      await expect.poll(async () => (await drawn(page)).filter((l) => l.kind === 'attack').length).toBe(1);
    });
    expect(errors).toEqual([]);
  });

  test('blocking (blocker in front of the attacker, block line)', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    const attackAt = { x: C1.x, y: C1.y + GEOMETRY.attackDisplacement, rot: 0 };
    await dispatch(page, { type: 'moveTemp', card: 'c1', pose: attackAt, combat: 'attack' });
    await dispatch(page, { type: 'lineAdd', line: 'atk', kind: 'attack', from: { kind: 'card', id: 'c1' }, to: { kind: 'seat', id: 's1' } });
    await settle(page);
    const lines = async () => {
      const out: Rect[] = [];
      for (const l of (await drawn(page)).filter((x) => x.kind === 'block')) out.push(segmentRect(await screenOf(page, l.from), await screenOf(page, l.to)));
      return out;
    };
    await pair(page, info, 'blocking', 4 * pxPerMm, async () => [(await card(page, 'o1')).screen, ...(await lines())], async () => {
      await dispatch(page, { by: 's1', type: 'moveTemp', card: 'o1', pose: { x: attackAt.x, y: attackAt.y + GEOMETRY.blockerDistance, rot: 180 }, combat: 'block' });
      await dispatch(page, { by: 's1', type: 'lineAdd', line: 'blk', kind: 'block', from: { kind: 'card', id: 'o1' }, to: { kind: 'card', id: 'c1' } });
      await expect.poll(async () => (await drawn(page)).filter((l) => l.kind === 'block').length).toBe(1);
    });
    expect(errors).toEqual([]);
  });

  test('face-down (the Stonetable back)', async ({ page }, info) => {
    const { errors, pxPerMm } = await controlledTable(page);
    await pair(page, info, 'faceDown', 0 * pxPerMm, async () => [(await card(page, 'o1')).screen], async () => {
      await dispatch(page, { by: 's1', type: 'flip', card: 'o1', face: 'down' });
      await expect.poll(async () => (await card(page, 'o1')).shows).toBe('back');
    });
    expect(errors).toEqual([]);
  });

  test('seat colour (a target line in each seat’s colour, on the stone)', async ({ page }, info) => {
    const { errors } = await controlledTable(page);
    const segments = async (by: string) => {
      const out: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
      for (const l of (await drawn(page)).filter((x) => x.kind === 'target' && x.by === by)) out.push({ a: await screenOf(page, l.from), b: await screenOf(page, l.to) });
      return out;
    };
    const rects = async (by: string) => (await segments(by)).map((g) => segmentRect(g.a, g.b));
    // The band a 2.5 px rune ribbon may cover, its glow included; between the cards (the line is trimmed to their edges).
    const bands = async (by: string): Promise<Band[]> => (await segments(by)).map((g) => ({ ...g, half: 4 }));
    // Seat s0's colour against the bare stone, then seat s1's.
    const a = await pair(
      page,
      info,
      'seatColour',
      0,
      () => rects('s0'),
      async () => {
        await dispatch(page, { type: 'lineAdd', line: 't0', kind: 'target', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'c2' } });
        await expect.poll(async () => (await drawn(page)).filter((l) => l.by === 's0').length).toBe(1);
      },
      () => bands('s0'),
    );
    const b = await pair(
      page,
      info,
      'seatColour',
      0,
      () => rects('s1'),
      async () => {
        await dispatch(page, { by: 's1', type: 'lineAdd', line: 't1', kind: 'target', from: { kind: 'card', id: 'o1' }, to: { kind: 'card', id: 'c2' } });
        await expect.poll(async () => (await drawn(page)).filter((l) => l.by === 's1').length).toBe(1);
      },
      () => bands('s1'),
    );
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('every state at once, at every quality level, still without errors', async ({ page }, info) => {
    const { errors } = await controlledTable(page);
    await dispatch(page, { type: 'tap', card: 'c2', tapped: true });
    await dispatch(page, { type: 'moveTemp', card: 'c1', pose: { x: C1.x, y: C1.y + GEOMETRY.attackDisplacement, rot: 0 }, combat: 'attack' });
    await dispatch(page, { type: 'lineAdd', line: 'atk', kind: 'attack', from: { kind: 'card', id: 'c1' }, to: { kind: 'seat', id: 's1' } });
    await dispatch(page, { by: 's1', type: 'moveTemp', card: 'o1', pose: { x: C1.x, y: C1.y + GEOMETRY.attackDisplacement + GEOMETRY.blockerDistance, rot: 180 }, combat: 'block' });
    await dispatch(page, { by: 's1', type: 'lineAdd', line: 'blk', kind: 'block', from: { kind: 'card', id: 'o1' }, to: { kind: 'card', id: 'c1' } });
    await dispatch(page, { type: 'createToken', card: 'f1', zone: 'battlefield:s0', pose: { x: 300, y: -230, rot: 0 }, ref: { sid: 'fx-21', foil: true } });
    await dispatch(page, { type: 'createToken', card: 'd1', zone: 'battlefield:s0', pose: { x: 420, y: -230, rot: 0 }, ref: { sid: 'fx-22' } });
    await dispatch(page, { type: 'flip', card: 'd1', face: 'down' });
    await dispatch(page, { type: 'lineAdd', line: 'mk', kind: 'mark', from: { kind: 'card', id: 'c2' }, to: { kind: 'card', id: 'f1' } });
    await rh(page, 'setView', { selection: ['c2'], hovered: 'f1' });
    for (const q of ['high', 'medium', 'low', 'high'] as const) {
      await rh(page, 'setQuality', q);
      await settle(page);
      expect((await rh<{ quality: string }>(page, 'stats')).quality).toBe(q);
      evidence(info, `all-states-${q}`, await shot(page));
    }
    expect((await drawn(page)).map((l) => l.kind).sort()).toEqual(['attack', 'block', 'mark']);
    expect(errors).toEqual([]);
  });
});
