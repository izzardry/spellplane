/**
 * Touch on the solo table under Playwright's iPad emulation (PLAN M5-P1: "touch gestures pass under Playwright's iPad
 * emulation"; owner decisions: iPad with Safari, the gate emulates an iPad in WebKit).
 *
 * Fingers are touch pointer events (pointerType 'touch'), the events iPad Safari delivers for a finger: a single tap
 * also goes through `page.touchscreen.tap` (the browser's own touch input). Playwright has no multi-touch API, so
 * several fingers and held or moving fingers are dispatched in the page, to the element under the finger at its press
 * and to that element afterwards (a touch is implicitly captured by the element it pressed, as in Safari). Steps of one
 * gesture run inside one page.evaluate, so a double-tap's two taps never straddle a slow round trip; what the table did
 * is read back through the debug hook, never from pixels or timing.
 *
 * Quick gestures (a tap, a double-tap, a two-finger double-tap) go as one burst: every event is dispatched in one task
 * and stamped with the time its finger moved (the event's `timeStamp`, which the table reads as a browser's own touch
 * events), so a slow software-rendered frame between two taps can never stretch them past the double-tap window (gate
 * M8 finding R3: CI's Linux WebKit failed a different double-tap each run).
 */
import { devices, expect, type Page, type TestInfo } from '@playwright/test';
import type { InstanceId, LogEntry, TableState } from '../../../src/core/types';
import type { CameraPose } from '../../../src/scene/types';
import type { RadialMenuState, ThumbAction } from '../../../src/ui/touch/actions';
import type { TouchGesture } from '../../../src/scene/input/touch';
import { hook } from '../helpers/app';
import { call, decklist, openSolo } from '../solo/helpers';

const { defaultBrowserType: _browser, ...ipadLandscape } = devices['iPad Pro 11 landscape']!;
/** iPad Pro 11" in landscape (1194 × 834 CSS px), touch, mobile viewport: use with `test.use(IPAD)`. */
export const IPAD = ipadLandscape;

export type Pt = { x: number; y: number };
export type Step = { type: 'down' | 'move' | 'up' | 'cancel'; id: number; x: number; y: number; wait?: number };

/**
 * Fire finger steps in order; `wait` ms after a step (default one frame). With `burst`, the steps go in one task without
 * waiting, each stamped `wait` ms after the one before and the last one now (the finger timing a browser reports for
 * touches that a busy frame held back).
 */
export async function fingers(page: Page, steps: Step[], opts: { burst?: boolean } = {}): Promise<void> {
  await page.evaluate(async ([list, burst]) => {
    const w = window as unknown as { __fingerTargets?: Map<number, Element> };
    const targets = (w.__fingerTargets ??= new Map<number, Element>());
    const names = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' } as const;
    const span = list.slice(0, -1).reduce((sum, s) => sum + (s.wait ?? 16), 0);
    let stamp = performance.now() - span;
    for (const s of list) {
      let target = targets.get(s.id);
      if (s.type === 'down' || !target) {
        target = document.elementFromPoint(s.x, s.y) ?? document.body;
        targets.set(s.id, target);
      }
      const pressed = s.type === 'down' || s.type === 'move';
      const ev = new PointerEvent(names[s.type], {
          pointerId: 100 + s.id,
          pointerType: 'touch',
          isPrimary: s.id === 1,
          clientX: s.x,
          clientY: s.y,
          button: s.type === 'move' ? -1 : 0,
          buttons: pressed ? 1 : 0,
          width: 20,
          height: 20,
          pressure: pressed ? 0.5 : 0,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
      if (burst) Object.defineProperty(ev, 'timeStamp', { value: stamp });
      target.dispatchEvent(ev);
      if (s.type === 'up' || s.type === 'cancel') targets.delete(s.id);
      if (burst) stamp += s.wait ?? 16;
      else await new Promise((r) => setTimeout(r, s.wait ?? 16));
    }
  }, [steps, !!opts.burst] as const);
}

/** Steps moving finger `id` from a to b in n moves. */
export function path(id: number, a: Pt, b: Pt, n = 8, wait = 16): Step[] {
  const out: Step[] = [];
  for (let i = 1; i <= n; i++) out.push({ type: 'move', id, x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, wait });
  return out;
}

/** One finger pressing at a, sliding to b, lifting there. */
export const drag = (page: Page, a: Pt, b: Pt, n = 8) => fingers(page, [{ type: 'down', id: 1, ...a }, ...path(1, a, b, n), { type: 'up', id: 1, ...b }]);

/** A quick tap of one finger, as one burst (30 ms between press and release). */
export const tap = (page: Page, p: Pt) => fingers(page, [{ type: 'down', id: 1, ...p, wait: 30 }, { type: 'up', id: 1, ...p }], { burst: true });

/** Two quick taps at p (a double-tap), as one burst: 30 ms down, 60 ms apart. */
export const doubleTap = (page: Page, p: Pt) =>
  fingers(
    page,
    [
      { type: 'down', id: 1, ...p, wait: 30 },
      { type: 'up', id: 1, ...p, wait: 60 },
      { type: 'down', id: 1, ...p, wait: 30 },
      { type: 'up', id: 1, ...p },
    ],
    { burst: true },
  );

/** Two fingers from a0/b0 to a1/b1, interleaved like pointer events, both lifting at the end. */
export function twoFingers(a0: Pt, b0: Pt, a1: Pt, b1: Pt, n = 10): Step[] {
  const steps: Step[] = [
    { type: 'down', id: 1, ...a0, wait: 0 },
    { type: 'down', id: 2, ...b0 },
  ];
  for (let i = 1; i <= n; i++) {
    steps.push({ type: 'move', id: 1, x: a0.x + ((a1.x - a0.x) * i) / n, y: a0.y + ((a1.y - a0.y) * i) / n, wait: 0 });
    steps.push({ type: 'move', id: 2, x: b0.x + ((b1.x - b0.x) * i) / n, y: b0.y + ((b1.y - b0.y) * i) / n });
  }
  steps.push({ type: 'up', id: 1, ...a1, wait: 0 }, { type: 'up', id: 2, ...b1 });
  return steps;
}

/** Press and hold at p until the long-press fired (polled through the debug hook), leaving the finger down. */
export async function holdDown(page: Page, p: Pt, id = 1): Promise<void> {
  const before = (await gestures(page)).length;
  await fingers(page, [{ type: 'down', id, ...p }]);
  await expect.poll(async () => (await gestures(page)).slice(before).some((g) => g.kind === 'longPress'), { timeout: 10_000 }).toBe(true);
}

/** A long-press at p: hold until it fired, then lift. */
export async function longPress(page: Page, p: Pt): Promise<void> {
  await holdDown(page, p);
  await fingers(page, [{ type: 'up', id: 1, ...p }]);
}

export const gestures = (page: Page) => hook<TouchGesture[]>(page, 'touch.gestures');
export const radial = (page: Page) => hook<RadialMenuState | null>(page, 'touch.radial');
export const thumbBar = (page: Page) => hook<ThumbAction[]>(page, 'touch.thumbBar');
export const state = (page: Page) => hook<TableState>(page, 'state');
export const pose = (page: Page) => hook<CameraPose>(page, 'rig.pose');
export const log = (page: Page) => call<LogEntry[]>(page, 'log');

export interface DebugCard {
  id: InstanceId;
  zone: string;
  screen: { x: number; y: number; width: number; height: number };
  visible: boolean;
  selected: boolean;
  tapped: boolean;
  moving: boolean;
  dragging: boolean;
}
export const cards = (page: Page) => hook<DebugCard[]>(page, 'cards');
export async function card(page: Page, id: InstanceId): Promise<DebugCard> {
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c;
}
export const centre = (c: DebugCard): Pt => ({ x: Math.round(c.screen.x + c.screen.width / 2), y: Math.round(c.screen.y + c.screen.height / 2) });

/** Resolve after `n` animation frames of the page (the table steps its camera once per frame). */
export const frames = (page: Page, n = 3) =>
  page.evaluate((count) => new Promise<void>((r) => {
    let left = count;
    const step = () => (--left <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);

/**
 * Wait until no card moves and the camera is still: two equal poses several drawn frames apart. A fixed pause alone
 * could fall inside one slow software-rendered frame and read a camera mid-flight as still (gate M8 R3).
 */
export async function settled(page: Page): Promise<void> {
  await expect.poll(async () => (await cards(page)).every((c) => !c.moving), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      async () => {
        const a = await pose(page);
        await frames(page, 3);
        await page.waitForTimeout(80);
        const b = await pose(page);
        return Math.hypot(...a.position.map((v, i) => v - b.position[i]!)) < 0.01 && (await hook(page, 'rig.blend')) === null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

interface HudLayout {
  viewport: { width: number; height: number };
  hand: { card: string; rect: { left: number; top: number; right: number; bottom: number } }[];
  chrome: { name: string; rect: { left: number; top: number; right: number; bottom: number } }[];
}

/**
 * A point of empty table near the cards `ids`: on no drawn card and no HUD chrome or hand card (the debug hook's
 * `hud.layout()`), with the table's canvas under it, and the same for each of `also` (offsets from it, for a second
 * finger). Candidates go around the cards, the first below and left of them as the specs used before. Fails naming what
 * stands at each candidate (gate M8 R3: a BUTTON stood at the one fixed point after a pinch on CI's Linux WebKit).
 */
export async function emptyTable(page: Page, ids: string[], also: Pt[] = []): Promise<Pt> {
  const all = await cards(page);
  const cs = all.filter((c) => ids.includes(c.id));
  const top = Math.min(...cs.map((c) => c.screen.y));
  const bottom = Math.max(...cs.map((c) => c.screen.y + c.screen.height));
  const left = Math.min(...cs.map((c) => c.screen.x));
  const right = Math.max(...cs.map((c) => c.screen.x + c.screen.width));
  const midY = (top + bottom) / 2;
  const candidates: Pt[] = [];
  for (const dy of [40, 70, 20, 100]) for (const dx of [-60, -120, 0, 60]) candidates.push({ x: left + dx, y: bottom + dy });
  for (const dx of [40, 80, 140]) candidates.push({ x: right + dx, y: midY }, { x: left - dx, y: midY });
  for (const dy of [30, 60]) candidates.push({ x: left - 30, y: top - dy }, { x: right + 30, y: top - dy });
  const layout = await hook<HudLayout>(page, 'hud.layout');
  const boxes = [...layout.chrome.map((c) => ({ name: c.name, ...c.rect })), ...layout.hand.map((h) => ({ name: `hand ${h.card}`, ...h.rect }))];
  const vp = layout.viewport;
  const tried: string[] = [];
  for (const c of candidates) {
    const p = { x: Math.round(c.x), y: Math.round(c.y) };
    const pts = [p, ...also.map((o) => ({ x: p.x + o.x, y: p.y + o.y }))];
    const why = await page.evaluate(
      ({ pts: list, boxes: bs, cards: cardRects, vp: v }) => {
        for (const q of list) {
          if (q.x < 24 || q.y < 24 || q.x > v.width - 24 || q.y > v.height - 24) return `off screen at ${q.x},${q.y}`;
          const card = cardRects.find((r) => q.x >= r.x - 12 && q.x <= r.x + r.width + 12 && q.y >= r.y - 12 && q.y <= r.y + r.height + 12);
          if (card) return `card ${card.id}`;
          const box = bs.find((b) => q.x >= b.left - 8 && q.x <= b.right + 8 && q.y >= b.top - 8 && q.y <= b.bottom + 8);
          if (box) return `HUD ${box.name}`;
          const el = document.elementFromPoint(q.x, q.y);
          if (el?.tagName !== 'CANVAS') return el ? `${el.tagName}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''} ${(el.textContent ?? '').trim().slice(0, 40)} in ${el.closest('[data-hud-chrome],[data-testid]')?.getAttribute('data-hud-chrome') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?'}` : 'nothing';
        }
        return null;
      },
      { pts, boxes, cards: all.filter((x) => x.visible).map((x) => ({ id: x.id, ...x.screen })), vp },
    );
    if (why === null) {
      // Name what stood at the points passed over, in the test's output (CI's log).
      if (tried.length) console.log(`[emptyTable] passed over ${tried.join('; ')}; using ${p.x},${p.y}`);
      return p;
    }
    tried.push(`${p.x},${p.y}: ${why}`);
  }
  throw new Error(`no empty table point near ${ids.join(', ')}:\n${tried.join('\n')}`);
}

/** The last action entries of the log (type and fields, without the session's stamps). */
export async function lastActions(page: Page, n: number): Promise<Record<string, unknown>[]> {
  const entries = (await log(page)).filter((e) => e.kind === 'action');
  return entries.slice(-n).map((e) => {
    const { by: _by, cid: _cid, seq: _seq, ...rest } = (e as Extract<LogEntry, { kind: 'action' }>).action as unknown as Record<string, unknown>;
    return rest;
  });
}

/**
 * The solo table on an emulated iPad with the 60-card fixture deck: `battlefield` cards drawn and put on the own
 * battlefield in a row, the rest of `hand` in hand. Returns the battlefield card ids, left to right, and the hand.
 */
export async function tableWithCards(page: Page, info: TestInfo, opts: { battlefield?: number; hand?: number } = {}): Promise<{ bf: InstanceId[]; hand: InstanceId[] }> {
  const profile = `touch-${info.workerIndex}-${Math.random().toString(36).slice(2, 10)}`;
  await openSolo(page, profile);
  // On a touch screen the first-run gesture hint (ui/hints) stands by the own hand, low on the left, and its button
  // takes the presses there (gate M8 R3: a long-press on empty table landed on GOT IT on CI's Linux WebKit, whose text
  // runs taller). The hint has its own specs (settings/touch.spec.ts); the gestures start on a table without it.
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const hint = page.getByTestId('hint');
    await expect(hint).toHaveAttribute('data-hint', 'touchGestures', { timeout: 15_000 });
    await hint.getByTestId('hint-dismiss').tap();
    await expect(hint).toHaveCount(0);
  }
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  const nb = opts.battlefield ?? 3;
  const nh = opts.hand ?? 2;
  await call(page, 'draw', nb + nh);
  const hand = (await hook<{ hand: InstanceId[] }>(page, 'secrets')).hand;
  const bf = hand.slice(0, nb);
  for (const [i, id] of bf.entries()) await hook(page, 'dispatch', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: -150 + i * 150, y: -300, rot: 0 } });
  await expect.poll(async () => (await cards(page)).filter((c) => bf.includes(c.id) && c.zone === 'battlefield:s0').length, { timeout: 15_000 }).toBe(nb);
  await settled(page);
  return { bf, hand: hand.slice(nb) };
}
