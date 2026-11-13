/**
 * PLAN M4-P3 acceptance: "Each theme renders the twelve gate states without console errors" — Dusk's own evidence for
 * the ten scene signals. The gate and the official measure for all twelve, in the real app, are M4-P6's
 * tests/e2e/signals.spec.ts, which runs Dusk too; speaking, away and pending confirmation are measured only there,
 * in the real app with a real confirmation round (Dusk's pending colour is unit-tested against its seats). DESIGN "Themes
 * and rendering": "Functional signals … every theme must render all of them distinguishably". Each state is put on
 * screen in Dusk through the real reducer and the real table scene, as a controlled pair with everything else
 * unchanged and reduced motion on, and must
 *   - raise no console or page error, and
 *   - differ from its neutral version by the signal's threshold (themes/signals.ts: at least `changedFraction` of the
 *     region's pixels change by more than `channelDelta`), minus the noise between two neutral captures.
 * Foil is the exception: the play table draws no foil marker in any theme yet (scene/table-scene.ts, M4-P2's table;
 * M4-P6 records it as a known gap), so Dusk renders that state without errors and the pair is recorded as evidence.
 * The cropped pairs are written to artifacts/shots/M4/dusk/ as evidence, not baselines.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { SceneDebugCard } from '../../../../src/scene/table-scene';
import type { DrawnLine } from '../../../../src/scene/lines';
import { SIGNALS, type SignalId, type SignalSpec } from '../../../../src/themes/signals';
import { changedFraction, dusk, hookCall, openDusk, settle, shot, unionRect, type Opened, type Rect } from './bundle';

const SID = { c1: 'fx-3', c2: 'fx-11', o1: 'fx-20' } as const;

function spec(id: SignalId): SignalSpec {
  const s = SIGNALS.find((x) => x.id === id);
  if (!s) throw new Error(`no signal ${id}`);
  return s;
}

const cards = (page: Page) => hookCall<SceneDebugCard[]>(page, 'cards');
async function card(page: Page, id: string): Promise<SceneDebugCard> {
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c;
}
const rect = async (page: Page, id: string): Promise<Rect> => {
  const s = (await card(page, id)).screen;
  return { x: s.x, y: s.y, width: s.width, height: s.height };
};
const act = (page: Page, a: Record<string, unknown>) => dusk(page, 'dispatch', a);

/** The controlled table: c1 and c2 in the own front row, o1 in the far seat's front row, nothing selected or hovered. */
async function controlled(page: Page): Promise<{ opened: Opened; pxPerMm: number }> {
  const opened = await openDusk(page);
  await act(page, { type: 'createToken', card: 'c1', zone: 'battlefield:s0', pose: { x: -100, y: -200, rot: 0 }, ref: { sid: SID.c1 } });
  await act(page, { type: 'createToken', card: 'c2', zone: 'battlefield:s0', pose: { x: 100, y: -200, rot: 0 }, ref: { sid: SID.c2 } });
  await act(page, { by: 's1', type: 'createToken', card: 'o1', zone: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 }, ref: { sid: SID.o1 } });
  await settle(page);
  const c1 = await card(page, 'c1');
  return { opened, pxPerMm: c1.screen.height / 88 };
}

function evidence(info: TestInfo, name: string, pngs: Record<string, string>): void {
  const dir = path.join('artifacts', 'shots', 'M4', 'dusk', 'signals');
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, b64] of Object.entries(pngs)) fs.writeFileSync(path.join(dir, `${name}-${k}-${info.project.name}.png`), Buffer.from(b64, 'base64'));
}

interface Pair {
  region(phase: 'neutral' | 'signalled'): Promise<Rect[]>;
  /** Margin around the region in CSS px. */
  margin: number;
  signal(): Promise<void>;
}

/** Capture neutral twice and signalled once; returns the change beyond the noise floor. */
async function measure(page: Page, info: TestInfo, s: SignalSpec, pair: Pair, name: string = s.id): Promise<number> {
  await settle(page);
  const n1 = await shot(page);
  const rects = await pair.region('neutral');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await settle(page);
  const n2 = await shot(page);
  await pair.signal();
  await settle(page);
  const sg = await shot(page);
  rects.push(...(await pair.region('signalled')));
  const region = unionRect(rects, pair.margin, page.viewportSize()!);
  const noise = await changedFraction(page, n1, n2, region, s.threshold.channelDelta);
  const changed = await changedFraction(page, n1, sg, region, s.threshold.channelDelta);
  evidence(info, name, { neutral: n1, signalled: sg });
  const signal = changed - noise;
  info.annotations.push({ type: 'signal', description: `dusk ${name}: ${(signal * 100).toFixed(2)}% changed beyond ${s.threshold.channelDelta}/255 (noise ${(noise * 100).toFixed(2)}%, threshold ${(s.threshold.changedFraction * 100).toFixed(1)}%, region ${Math.round(region.width)}×${Math.round(region.height)} px)` });
  return signal;
}

const marginOf = (s: SignalSpec, pxPerMm: number): number => ('marginMm' in s.probe ? s.probe.marginMm : 2) * pxPerMm;

test.describe('Dusk renders the scene gate states', () => {
  test.describe.configure({ timeout: 90_000 });

  test('there are twelve, in the PLAN’s order', () => {
    expect(SIGNALS.map((s) => s.id)).toEqual(['tapped', 'selected', 'hovered', 'displaced', 'attacking', 'blocking', 'faceDown', 'foil', 'seatColour', 'speaking', 'pendingConfirmation', 'away']);
  });

  test('tapped', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('tapped');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async () => [await rect(page, 'c1')],
      signal: async () => {
        await act(page, { type: 'tap', card: 'c1', tapped: true });
        await expect.poll(async () => (await card(page, 'c1')).tapped).toBe(true);
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('selected', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('selected');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async () => [await rect(page, 'c1')],
      signal: async () => {
        await dusk(page, 'setView', { selection: ['c1'] });
        await expect.poll(async () => (await card(page, 'c1')).selected).toBe(true);
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('hovered', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('hovered');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async () => [await rect(page, 'c1')],
      signal: async () => {
        await dusk(page, 'setView', { hovered: 'c1' });
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('hovered and selected read apart', async ({ page }, info) => {
    // DESIGN "Themes and rendering", Card dressing: "selection and hover treatment" are two signals; in Dusk the
    // selection outline is brighter and thicker than the hover outline, so a selected card does not look hovered.
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('selected');
    await dusk(page, 'setView', { hovered: 'c1' });
    const m = await measure(
      page,
      info,
      s,
      {
        margin: marginOf(s, pxPerMm),
        region: async () => [await rect(page, 'c1')],
        signal: async () => {
          await dusk(page, 'setView', { hovered: null, selection: ['c1'] });
        },
      },
      'hover-vs-selected',
    );
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('displaced', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('displaced');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      // The ghost outline stays at the home slot, which is the neutral rectangle.
      region: async () => [await rect(page, 'c1')],
      signal: async () => {
        await act(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -110, rot: 0 } });
        await expect.poll(async () => (await card(page, 'c1')).displaced).toBe(true);
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect((await card(page, 'c1')).ghost).toEqual({ x: -100, y: -200, rot: 0 });
    expect(opened.errors).toEqual([]);
  });

  test('attacking', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('attacking');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async () => [await rect(page, 'c1')],
      signal: async () => {
        // What A does (DESIGN "Combat and annotation"): 110 mm toward the centre, tapped, marked attacking.
        await act(page, { type: 'moveTemp', card: 'c1', pose: { x: -100, y: -90, rot: 0 }, combat: 'attack', tap: true });
        await expect.poll(async () => (await dusk<{ cards: Record<string, { combat?: string }> }>(page, 'state')).cards.c1?.combat).toBe('attack');
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('blocking', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('blocking');
    // The far seat attacks first; that is part of the neutral state.
    await act(page, { by: 's1', type: 'moveTemp', card: 'o1', pose: { x: 0, y: 90, rot: 180 }, combat: 'attack', tap: true });
    const blockLines = async (): Promise<Rect[]> => {
      const lines = (await hookCall<DrawnLine[]>(page, 'drawnLines')).filter((l) => l.kind === 'block');
      const out: Rect[] = [];
      for (const l of lines) {
        const a = await dusk<{ x: number; y: number } | null>(page, 'toScreen', l.from.x, l.from.y);
        const b = await dusk<{ x: number; y: number } | null>(page, 'toScreen', l.to.x, l.to.y);
        if (a && b) out.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
      }
      return out;
    };
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async (phase) => [await rect(page, 'c1'), ...(phase === 'signalled' ? await blockLines() : [])],
      signal: async () => {
        await act(page, { type: 'moveTemp', card: 'c1', pose: { x: 0, y: -6, rot: 0 }, combat: 'block', group: 'blk' });
        await act(page, { type: 'lineAdd', line: 'blk', kind: 'block', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'o1' }, group: 'blk' });
        await expect.poll(async () => (await hookCall<DrawnLine[]>(page, 'drawnLines')).some((l) => l.kind === 'block')).toBe(true);
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('face-down shows Dusk’s own neutral back', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('faceDown');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async () => [await rect(page, 'o1')],
      signal: async () => {
        await act(page, { by: 's1', type: 'flip', card: 'o1', face: 'down' });
        await expect.poll(async () => (await card(page, 'o1')).face).toBe('down');
      },
    });
    expect(m).toBeGreaterThanOrEqual(s.threshold.changedFraction);
    expect(opened.errors).toEqual([]);
  });

  test('foil renders without errors (the table’s foil marker is a known gap in every theme)', async ({ page }, info) => {
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('foil');
    const m = await measure(page, info, s, {
      margin: marginOf(s, pxPerMm),
      region: async (phase) => [await rect(page, phase === 'neutral' ? 'c1' : 'c1f')],
      signal: async () => {
        // The same printing, foil, in the same place (CardRef.foil).
        await act(page, { type: 'remove', card: 'c1', group: 'foil' });
        await act(page, { type: 'createToken', card: 'c1f', zone: 'battlefield:s0', pose: { x: -100, y: -200, rot: 0 }, ref: { sid: SID.c1, foil: true }, group: 'foil' });
        await expect.poll(async () => (await cards(page)).map((c) => c.id).sort()).toEqual(['c1f', 'c2', 'o1']);
      },
    });
    info.annotations.push({ type: 'known-gap', description: `the play table draws no foil marker yet (scene/table-scene.ts); Dusk's pair measured ${(m * 100).toFixed(2)}%` });
    expect((await card(page, 'c1f')).tier).not.toBeNull();
    expect(opened.errors).toEqual([]);
  });

  test('seat colour: each of the eight against the felt and against each other', async ({ page }, info) => {
    test.setTimeout(150_000);
    const { opened, pxPerMm } = await controlled(page);
    const s = spec('seatColour');
    const [c1, c2] = [await rect(page, 'c1'), await rect(page, 'c2')];
    const y = c1.y + c1.height / 2;
    const half = Math.max(4, 3 * pxPerMm);
    const gap = 2 * pxPerMm;
    // The felt between the two cards, around the target line from c1 to c2.
    const region: Rect = { x: c1.x + c1.width + gap, y: y - half, width: c2.x - gap - (c1.x + c1.width + gap), height: 2 * half };
    expect(region.width).toBeGreaterThan(20);
    await settle(page);
    const neutral = await shot(page);
    await settle(page);
    const noise = await changedFraction(page, neutral, await shot(page), region, s.threshold.channelDelta);
    const lines: string[] = [];
    for (let colour = 0; colour < 8; colour++) {
      await act(page, { type: 'seatTake', seat: 's0', name: 'Ada', colour });
      await expect.poll(async () => (await dusk<{ seats: Record<string, { colour: number }> }>(page, 'state')).seats.s0!.colour).toBe(colour);
      await act(page, { type: 'lineAdd', line: `t${colour}`, kind: 'target', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'c2' } });
      await expect.poll(async () => (await hookCall<DrawnLine[]>(page, 'drawnLines')).some((l) => l.id === `t${colour}`)).toBe(true);
      await settle(page);
      const img = await shot(page);
      lines.push(img);
      const vsFelt = (await changedFraction(page, neutral, img, region, s.threshold.channelDelta)) - noise;
      info.annotations.push({ type: 'signal', description: `dusk seat colour ${colour} vs felt: ${(vsFelt * 100).toFixed(2)}%` });
      expect.soft(vsFelt, `seat colour ${colour} against the felt`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
      await act(page, { type: 'lineRemove', line: `t${colour}` });
    }
    evidence(info, 'seat-colours', Object.fromEntries(lines.map((l, i) => [`seat-${i}`, l])));
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const f = (await changedFraction(page, lines[i]!, lines[j]!, region, s.threshold.channelDelta)) - noise;
        expect.soft(f, `seat colours ${i} and ${j} tell apart`).toBeGreaterThanOrEqual(s.threshold.changedFraction);
      }
    expect(opened.errors).toEqual([]);
  });
});
