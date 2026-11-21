/**
 * PLAN Milestone 8, M7-P5 "Feel" (m7-adjustments.md, M7-P4): short interruptible animations for draw, shuffle, tap and
 * untap, play, to graveyard and exile and counters; a group of seven draws staggers and is done within 600 ms; every
 * animation ends and the scene then draws no frame for 500 ms (render on demand); disposing a table mid-draw leaves no
 * animation and no frame hold; the page's one audio context is counted while a table holds it. Read through the debug
 * hook on the solo table, with Playwright's clock driving time (nothing is slept through), never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { CardAnimationKind, MotionDebugState } from '../../../src/scene/types';
import type { RenderMemory } from '../../../src/scene/types';
import { hook, shot } from '../helpers/app';
import { call, decklist, openSolo } from '../solo/helpers';
import { cardIn, handIds, profileFor, state } from '../nokeys/helpers';
import { framesDrawn, motion, pauseClock, step } from './helpers';
import { addCard, dispatch, harness, openScene, settle } from '../scene/helpers';

const running = (m: MotionDebugState, kind: CardAnimationKind) => m.running.filter((r) => r.kind === kind);

/** Step the paused clock until an animation of `kind` runs (at most 1.5 s); returns the motion state then. */
async function until(page: Page, pred: (m: MotionDebugState) => boolean, maxMs = 1500): Promise<MotionDebugState> {
  for (let t = 0; t <= maxMs; t += 16) {
    const m = await motion(page);
    if (pred(m)) return m;
    await page.clock.runFor(16);
  }
  throw new Error('the expected moment never came');
}

const idle = (m: MotionDebugState) => m.running.length === 0 && m.holds.length === 0;

/**
 * Every animation has ended and nothing holds frames; then 500 ms of clock draw no frame. A card face or back still
 * loading (in real time, not on the page's paused clock) asks for one frame when it lands: that is waited for first
 * (no texture queued, loading or waiting for upload, the clock stepped so an upload can run), and only then is one
 * strict 500 ms window measured.
 */
async function endsAndStops(page: Page): Promise<void> {
  await until(page, idle, 3000);
  await expect
    .poll(
      async () => {
        await step(page, 32);
        return hook<number>(page, 'faceLoad.pending');
      },
      { timeout: 15_000 },
    )
    .toBe(0);
  await until(page, idle, 3000);
  // One last frame may be in flight.
  await step(page, 64);
  const a = await framesDrawn(page);
  await step(page, 500);
  expect((await framesDrawn(page)) - a, 'frames drawn in 500 ms with nothing moving').toBe(0);
}

async function table(page: Page, tag: string, info: Parameters<typeof profileFor>[0]): Promise<void> {
  await page.clock.install();
  await openSolo(page, profileFor(info, tag));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await expect.poll(async () => (await state(page)).zones['library:s0']?.ids.length ?? 0).toBe(60);
  await pauseClock(page);
  await endsAndStops(page);
}

test('seven cards drawn at once fly one after another, all in hand within 600 ms; then the frames stop', async ({ page }, info) => {
  await table(page, 'feel-draw', info);
  await call(page, 'draw', 7);
  await until(page, (m) => running(m, 'draw').length > 0);
  // Staggered: 48 ms in, seven separate flights (one start each: flights that start together are one entry), the first
  // under way and the last not begun yet.
  await step(page, 48);
  const draws = running(await motion(page), 'draw');
  expect(draws.length).toBe(7);
  expect(new Set(draws.flatMap((r) => r.cards)).size).toBe(7);
  const progresses = draws.map((r) => r.progress);
  expect(Math.max(...progresses)).toBeGreaterThan(0);
  expect(Math.min(...progresses)).toBe(0);
  await shot(page, 'M7', 'feel-mid-draw', info.project.name);
  // 600 ms after the first flight started, no draw runs any more.
  await step(page, 600);
  expect(running(await motion(page), 'draw')).toEqual([]);
  expect((await handIds(page)).length).toBe(7);
  await endsAndStops(page);
});

test('shuffle, play, tap and untap, a counter, to graveyard and to exile each animate and end; then the frames stop', async ({ page }, info) => {
  await table(page, 'feel-kinds', info);
  await call(page, 'draw', 7);
  await endsAndStops(page);
  const [a, b, c] = await handIds(page);

  await test.step('shuffle: the library riffles', async () => {
    await call(page, 'shuffle', 'library:s0');
    await until(page, (m) => running(m, 'shuffle').length > 0);
    await endsAndStops(page);
  });
  await test.step('play: a card put onto the table lands', async () => {
    await hook(page, 'dispatch', { type: 'move', card: a, to: 'battlefield:s0', pose: { x: -200, y: -300, rot: 0 } });
    await until(page, (m) => running(m, 'play').some((r) => r.cards.includes(a!)));
    await endsAndStops(page);
  });
  await test.step('tap and untap turn the card', async () => {
    await hook(page, 'dispatch', { type: 'tap', card: a, tapped: true });
    await until(page, (m) => m.running.some((r) => r.cards.includes(a!)) || m.holds.includes('cards'));
    await endsAndStops(page);
    expect((await cardIn(page, a!))?.tapped).toBe(true);
    await hook(page, 'dispatch', { type: 'tap', card: a, tapped: false });
    await until(page, (m) => m.running.length > 0 || m.holds.includes('cards'));
    await endsAndStops(page);
  });
  await test.step('a counter pops its badge', async () => {
    await hook(page, 'dispatch', { type: 'counter', card: a, kind: '+1/+1', delta: 1 });
    await until(page, (m) => running(m, 'counter').some((r) => r.cards.includes(a!)));
    await endsAndStops(page);
  });
  await test.step('to graveyard and to exile fly to the pile', async () => {
    await hook(page, 'dispatch', { type: 'move', card: b, to: 'battlefield:s0', pose: { x: 0, y: -300, rot: 0 } });
    await hook(page, 'dispatch', { type: 'move', card: c, to: 'battlefield:s0', pose: { x: 150, y: -300, rot: 0 } });
    await endsAndStops(page);
    await hook(page, 'dispatch', { type: 'move', card: b, to: 'graveyard:s0' });
    await until(page, (m) => running(m, 'toGraveyard').length > 0);
    await endsAndStops(page);
    await hook(page, 'dispatch', { type: 'move', card: c, to: 'exile:s0' });
    await until(page, (m) => running(m, 'toExile').length > 0);
    await endsAndStops(page);
  });
  const [d, e, f] = (await handIds(page)).slice(0, 3);
  await test.step('attach: a card put on another moves onto it', async () => {
    await hook(page, 'dispatch', { type: 'move', card: d, to: 'battlefield:s0', pose: { x: 150, y: -300, rot: 0 } });
    await endsAndStops(page);
    await hook(page, 'dispatch', { type: 'attach', card: d, to: a });
    await until(page, (m) => running(m, 'attach').some((r) => r.cards.includes(d!)));
    await endsAndStops(page);
    expect((await cardIn(page, d!))?.attachedTo).toBe(a);
  });
  await test.step('clip: two cards clipped together pop', async () => {
    await hook(page, 'dispatch', { type: 'move', card: e, to: 'battlefield:s0', pose: { x: 350, y: -300, rot: 0 } });
    await hook(page, 'dispatch', { type: 'move', card: f, to: 'battlefield:s0', pose: { x: 370, y: -290, rot: 0 } });
    await endsAndStops(page);
    await hook(page, 'dispatch', { type: 'clipAdd', clip: 'feel-clip', cards: [e, f], anchor: { card: f, x: -15, y: -10 } });
    await until(page, (m) => running(m, 'clip').some((r) => r.cards.includes(e!) && r.cards.includes(f!)));
    await endsAndStops(page);
  });
});

test('disposing the table mid-draw cancels every animation and releases every frame hold', async ({ page }) => {
  await page.clock.install();
  await openScene(page, { scenario: 'empty' });
  for (const id of ['d1', 'd2', 'd3']) await addCard(page, id, { x: 400, y: -300, rot: 0 }, 'library:s0');
  await settle(page);
  await pauseClock(page);
  // Three cards drawn at once (library to the viewer's hand): they fly, staggered.
  for (const id of ['d1', 'd2', 'd3']) await dispatch(page, { type: 'toZone', by: 's0', cid: `draw-${id}`, card: id, to: 'hand:s0' } as never);
  await until(page, (m) => running(m, 'draw').length > 0);
  await step(page, 32);
  const before = await hook<{ scenes: number; animations: number; holds: number }>(page, 'feel.totals');
  expect(before.scenes).toBe(1);
  expect(before.animations).toBeGreaterThan(0);
  const mounted = await hook<RenderMemory>(page, 'render.memory');
  expect(mounted.rafLoops).toBe(1);
  expect(mounted.contexts).toBe(1);
  // Keep the disposed scene's own frame counter: a frame loop or rAF that survived dispose would still draw.
  await page.evaluate(() => {
    const w = window as unknown as { __deadRender?: unknown; __spellplane: Record<string, unknown> };
    w.__deadRender = w.__spellplane.render;
  });
  const deadFrames = () => page.evaluate(() => (window as unknown as { __deadRender: { framesDrawn(): number } }).__deadRender.framesDrawn());
  await harness(page, 'dispose');
  expect(await hook(page, 'feel.totals')).toEqual({ scenes: 0, animations: 0, holds: 0 });
  // The lifecycle counters are back where they were before the mount: the harness page's only table is gone.
  const gone = await hook<RenderMemory>(page, 'render.memory');
  expect({ rafLoops: gone.rafLoops, contexts: gone.contexts, audioContexts: gone.audioContexts }).toEqual({ rafLoops: 0, contexts: 0, audioContexts: 0 });
  const framesAtDispose = await deadFrames();
  await step(page, 200);
  expect(await deadFrames(), 'frames drawn after dispose').toBe(framesAtDispose);
  expect(await hook(page, 'feel.totals')).toEqual({ scenes: 0, animations: 0, holds: 0 });
  // The scene's debug parts went with it.
  expect(await page.evaluate(() => typeof (window.__spellplane as Record<string, unknown>).motion)).toBe('undefined');
});

test('the page has one audio context, counted while the table holds it', async ({ page }, info) => {
  await openSolo(page, profileFor(info, 'feel-audio'));
  // Nothing before the first press (the browsers' autoplay rule).
  expect(await hook<number>(page, 'audio.made')).toBe(0);
  expect(await hook<number>(page, 'audio.live')).toBe(0);
  await page.mouse.click(5, 300);
  // Plain, the default look, plays sound by default: the first press makes the page's one context, counted while the
  // table holds it.
  await expect.poll(() => hook<number>(page, 'audio.made')).toBe(1);
  await expect.poll(() => hook<number>(page, 'audio.live')).toBe(1);
  // A second press makes no second context.
  await page.mouse.click(15, 300);
  await expect.poll(() => hook<number>(page, 'audio.made')).toBe(1);
  expect(await hook<number>(page, 'audio.live')).toBe(1);
  // Home disposes the table: it lets the context go, suspended, not closed, and counts none.
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => hook<number>(page, 'audio.live')).toBe(0);
  await expect.poll(() => hook<string | null>(page, 'audio.state')).toBe('suspended');
  // The table's coach marks went with it: the debug hook keeps no part of the dead table's HUD.
  await expect.poll(() => page.evaluate(() => typeof (window.__spellplane as Record<string, unknown>).coach)).toBe('undefined');
  // A second table reuses it on its first press.
  await page.evaluate(() => (location.hash = '#/solo'));
  await expect.poll(() => page.evaluate(() => typeof (window.__spellplane as Record<string, unknown>).motion)).toBe('function');
  await page.mouse.click(5, 300);
  await expect.poll(() => hook<number>(page, 'audio.live')).toBe(1);
  expect(await hook<number>(page, 'audio.made')).toBe(1);
  await expect.poll(() => hook<string | null>(page, 'audio.state')).toBe('running');
});
