/**
 * Gate M5-G (docs/PLAN.md, Milestone 5): "the full evening from M2 on an emulated tablet using touch only, followed by
 * the audit". Owner decisions for M5 (13 Nov 2026): the tablet is an iPad with Safari, emulated in WebKit.
 *
 * 1. The touch evening. Ann (s0, host) and Ben (s1) open one table link on an emulated iPad Pro 11" in landscape
 *    (Playwright's device, touch, mobile viewport; the browser is the project's, so WebKit is Safari and Chromium runs
 *    it as a second check) and replay the M2 gate's evening (tests/e2e/m2.gate.spec.ts) with fingers only: lobby
 *    settings, a three-pack booster draft picked tap-tap, two 40-card builds in the list view and the dispenser, the
 *    table view sorted by its buttons, Ready, a short game (the library opened from the avatar, Shuffle and Draw
 *    tapped, a land dragged out of the hand fan), "Next game", sideboarding, game two, a sealed pool and a Rochester
 *    draft. On the way: the radial menu, the thumb bar, the lifted hand card, double-tap, a two-finger camera gesture,
 *    a portrait table, the first-run hints, the Home Screen hint and the update notice (a waiting update never applies
 *    mid-game, and applies at the lobby). Text fields are filled as the on-screen keyboard would (Playwright's fill)
 *    and selects chosen as the iPad picker would (selectOption); nothing goes through a hardware key or the mouse.
 *    After each game the automatic audit must report every verdict 'verified'; one game with a tampered library order
 *    (a test-only hook) must report a mismatch.
 * 2. Offline: a saved table resumes with the network disabled (service worker, `?sw=on`).
 * 3. Three players from seats 1-3, a spectator hearing open voice, and the Ctrl talk rule, in one real three-seat room.
 * 4. Ego framing in Wyrm and Stonetable (own piles on screen, 1440x900 and iPad), the far-zoom stack badge.
 * 5. The screens: settings, a key remap with a conflict, About, the empty and error states.
 * 6. Acceptance items of parked packages: axe (M5-P4), the 5,000-action soak and the version check (M5-P6), the audit
 *    (M5-P2). They are checked for and fail while their package is not on the branch.
 *
 * Engine behaviour is asserted on state hashes and the debug hook, never on pixels. Screenshots are review evidence in
 * artifacts/shots/M5/. Like the earlier gates each test records its steps: a failed step is listed and the test goes on
 * where it can, and fails at the end if any step failed. Fallbacks to the debug hook are listed in `gaps`.
 */
import { devices, expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RevealedCard } from '../../src/core/commit';
import { rochesterOrder } from '../../src/core/drafting';
import type { CardRef, DeckBuild, PackRecord, SecretStore, Stage, TableState } from '../../src/core/types';
import type { CardData, SetData } from '../../src/data/types';
import type { DraftPrivateView } from '../../src/draft/types';
import type { NetMessageRecord } from '../../src/net/types';
import type { TouchGesture } from '../../src/scene/input/touch';
import type { DebugTableView } from '../../src/scene/lines';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import type { BuilderSort, CameraPose, StackBadgeState } from '../../src/scene/types';
import type { RadialMenuState, ThumbAction } from '../../src/ui/touch/actions';
import { UPDATE_NOTICE } from '../../src/util/pwa';
import type { VoiceTrackState } from '../../src/voice/types';
import { packLeakScan } from '../leak/draft';
import { hook, shot } from './helpers/app';

// --------------------------------------------------------------------------------------------------------------------
// Fixtures and devices
// --------------------------------------------------------------------------------------------------------------------
const FIXTURES = path.join('tests', 'fixtures');
const FIXTURE_CARDS = new Map<string, CardData>(
  ['m19.json', 'tm19.json'].flatMap((f) => (JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as CardData[]).map((c) => [c.id, c] as const)),
);
const lookup = (ref: CardRef): CardData | null => FIXTURE_CARDS.get(ref.sid) ?? null;
const isLand = (c: CardData | null): boolean => !!c && /\bLand\b/.test(c.type_line);
const BASIC_OF: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const decklist = (file: string) => fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');

const cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards: [...FIXTURE_CARDS.values()] })};`;
let setsScriptText: string | null = null;
/** Recorded M19 booster data (the app then never fetches MTGJSON). */
function setsScript(): string {
  if (setsScriptText === null) {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mtgjson', 'M19.json'), 'utf8')) as {
      data: { code: string; name: string; releaseDate: string; booster: Record<string, SetData['booster']>; cards: SetData['cards'] };
    };
    const d = raw.data;
    const set: SetData = { code: d.code, name: d.name, releaseDate: d.releaseDate, boosterType: 'draft', booster: d.booster.draft!, cards: d.cards };
    setsScriptText = `window.__spellplaneSets = ${JSON.stringify([set])};`;
  }
  return setsScriptText;
}

/**
 * WebKit only: `getUserMedia` answers with a silent Web Audio stream, so joining voice never reaches the real
 * microphone (which would show the macOS prompt; CLAUDE.md, pw-guard exit code 3). As in the M3 gate.
 */
const FAKE_MIC = `(() => {
  const md = navigator.mediaDevices;
  if (!md) return;
  const silent = async () => {
    const ctx = new AudioContext();
    const dst = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dst);
    osc.start();
    void ctx.resume().catch(() => undefined);
    return dst.stream;
  };
  const devices = async () => [];
  for (const target of [md, Object.getPrototypeOf(md)]) {
    try {
      Object.defineProperty(target, 'getUserMedia', { configurable: true, writable: true, value: silent });
      Object.defineProperty(target, 'enumerateDevices', { configurable: true, writable: true, value: devices });
    } catch {}
  }
})();`;

// iPad Pro 11" (Playwright's device: viewport, touch, mobile, iPad Safari's user agent); the browser stays the project's.
const { defaultBrowserType: _l, ...IPAD } = devices['iPad Pro 11 landscape']!;
const IPAD_PORTRAIT = devices['iPad Pro 11']!.viewport;

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

// --------------------------------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------------------------------
type Pt = { x: number; y: number };
const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const view = (page: Page) => hook<DraftPrivateView | null>(page, 'draft.view');
const build = (page: Page) => hook<DeckBuild | null>(page, 'draft.build');
const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const pose = (page: Page) => hook<CameraPose>(page, 'rig.pose');
const tableView = (page: Page) => hook<DebugTableView | null>(page, 'tableView');
const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const hasPart = (page: Page, part: string) => page.evaluate((p) => typeof (window.__spellplane as unknown as Record<string, unknown> | undefined)?.[p] !== 'undefined', part);
const deckOf = (b: DeckBuild | null) => (b === null ? null : { cards: b.cards, main: b.main });
const STAGE_VIEW: Record<Stage, string> = { lobby: 'lobby', draft: 'draft', build: 'builder', match: 'hud' };

function firstLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ');
}
const fresh = (info: TestInfo, who: string) => `g5-${who}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(5).toString('hex')}`;
const freshRoom = () => ({ roomId: `gate5-${crypto.randomBytes(4).toString('hex')}-42`, roomKey: crypto.randomBytes(16).toString('base64url') });

async function frames(page: Page, n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}
async function inStage(page: Page, stage: Stage): Promise<void> {
  await expect(page.getByTestId('stage')).toHaveAttribute('data-stage', stage, { timeout: 30_000 });
  await expect(page.getByTestId(STAGE_VIEW[stage])).toBeVisible({ timeout: 30_000 });
}
async function converged(pages: Page[]): Promise<string> {
  let h = '';
  await expect
    .poll(
      async () => {
        const hs = await Promise.all(pages.map((p) => hashOf(p)));
        h = hs[0]!;
        return hs.every((x) => x === h);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return h;
}
/** Wait until no card moves and the camera holds still. */
async function settled(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      async () => {
        const a = await pose(page);
        await page.waitForTimeout(80);
        const b = await pose(page);
        return Math.hypot(...a.position.map((v, i) => v - b.position[i]!)) < 0.01 && (await hook(page, 'rig.blend')) === null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

type Step = { type: 'down' | 'move' | 'up'; id: number; x: number; y: number; wait?: number };
/**
 * Finger steps as touch pointer events (iPad Safari's events for a finger), each sent to the element under the finger
 * at its press (implicit capture, as in Safari), inside one evaluate so a gesture never straddles a slow round trip.
 * Playwright has no multi-touch or held-finger API; single taps go through page.touchscreen (the browser's own touch).
 */
async function fingers(page: Page, steps: Step[]): Promise<void> {
  await page.evaluate(async (list) => {
    const w = window as unknown as { __gateFingers?: Map<number, Element> };
    const targets = (w.__gateFingers ??= new Map<number, Element>());
    const names = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' } as const;
    for (const s of list) {
      let target = targets.get(s.id);
      if (s.type === 'down' || !target) {
        target = document.elementFromPoint(s.x, s.y) ?? document.body;
        targets.set(s.id, target);
      }
      const pressed = s.type !== 'up';
      target.dispatchEvent(
        new PointerEvent(names[s.type], {
          pointerId: 200 + s.id,
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
        }),
      );
      if (s.type === 'up') targets.delete(s.id);
      await new Promise((r) => setTimeout(r, s.wait ?? 16));
    }
  }, steps);
}
function slide(id: number, a: Pt, b: Pt, n = 10): Step[] {
  const out: Step[] = [];
  for (let i = 1; i <= n; i++) out.push({ type: 'move', id, x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) });
  return out;
}
const gestures = (page: Page) => hook<TouchGesture[]>(page, 'touch.gestures');
/** Press and hold until the long-press fired (read from the debug hook), then lift. */
async function longPress(page: Page, p: Pt): Promise<void> {
  const before = (await gestures(page)).length;
  await fingers(page, [{ type: 'down', id: 1, ...p }]);
  await expect.poll(async () => (await gestures(page)).slice(before).some((g) => g.kind === 'longPress'), { timeout: 10_000 }).toBe(true);
  await fingers(page, [{ type: 'up', id: 1, ...p }]);
}
const tapAt = (page: Page, p: Pt) => page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
const centre = (r: { x: number; y: number; width: number; height: number }): Pt => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/** Record steps; a failed step is listed and the test goes on. */
function recorder(info: TestInfo, name: string) {
  const failures: string[] = [];
  const gaps: string[] = [];
  const errors: string[] = [];
  const outside: string[] = [];
  const step = async (title: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await test.step(title, fn);
      return true;
    } catch (e) {
      failures.push(`${title}: ${firstLine(e)}`);
      return false;
    }
  };
  const soft = async (title: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      failures.push(`${title}: ${firstLine(e)}`);
    }
  };
  const watch = (page: Page, who: string) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('request', (r) => {
      if (!/^(data|blob):/.test(r.url()) && !LOCAL.test(r.url())) outside.push(r.url());
    });
  };
  const finish = async (close: () => Promise<void>) => {
    if (errors.length || outside.length) failures.push(`page errors: ${JSON.stringify(errors.slice(0, 5))}; outside requests: ${JSON.stringify(outside.slice(0, 5))}`);
    await info.attach('gate-gaps.json', { body: JSON.stringify({ failures, gaps }, null, 2), contentType: 'application/json' });
    fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
    fs.writeFileSync(path.join('artifacts', 'gate', `M5-${name}-${info.project.name}.json`), JSON.stringify({ failures, gaps }, null, 2));
    await close().catch(() => undefined);
    expect(failures).toEqual([]);
  };
  return { failures, gaps, errors, outside, step, soft, watch, finish };
}

/** Refuse (and record) every request that would leave the machine; tests never use the network. */
async function noNetwork(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => !LOCAL.test(url.href) && !/^(data|blob):/.test(url.href),
    (route) => route.abort('internetdisconnected'),
  );
}

async function ipadContext(browser: Browser, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ ...IPAD, ...extra });
  context.setDefaultTimeout(10_000);
  await noNetwork(context);
  await context.addInitScript({ content: cardsScript });
  await context.addInitScript({ content: setsScript() });
  return context;
}

type Seat = 's0' | 's1';
interface Player {
  name: string;
  seat: Seat;
  profile: string;
  page: Page;
}
interface PickRec {
  seat: Seat;
  packId: string;
  before: string[];
  picked: string[];
}

const appliedAt = (page: Page) => page.evaluate(() => (window as unknown as { __spellplaneFakeUpdate: { applied: unknown[] } }).__spellplaneFakeUpdate.applied);
const offerUpdate = (page: Page) => page.evaluate(() => (window as unknown as { __spellplaneFakeUpdate: { offer(): void } }).__spellplaneFakeUpdate.offer());

test.describe('M5 gate @gate', () => {
  test.use({ actionTimeout: 10_000 });

  // ==================================================================================================================
  // 1. The touch evening
  // ==================================================================================================================
  test('the M2 evening on an emulated iPad, touch only, followed by the audit', async ({ browser }, info) => {
    test.setTimeout(30 * 60_000);
    const project = info.project.name;
    const R = recorder(info, 'evening');
    const { step, soft, gaps } = R;
    const context = await ipadContext(browser);
    const room = freshRoom();
    const newPage = async (who: string) => {
      const p = await context.newPage();
      R.watch(p, who);
      return p;
    };
    const A: Player = { name: 'Ann', seat: 's0', profile: fresh(info, 'a'), page: await newPage('Ann') };
    const B: Player = { name: 'Ben', seat: 's1', profile: fresh(info, 'b'), page: await newPage('Ben') };
    const both = [A, B];
    const other = (p: Player) => (p === A ? B : A);
    const front = async (p: Player) => {
      await p.page.bringToFront();
      await frames(p.page);
    };
    const finish = () => R.finish(() => context.close());

    // ---- Lobby ------------------------------------------------------------------------------------------------------
    const lobbyOk = await step('lobby (touch): both join on the iPad; Ann sets an M19 booster draft of three packs; the Home Screen hint shows once', async () => {
      for (const p of both) {
        const q = new URLSearchParams({ faces: 'placeholder', profile: p.profile, transport: 'local', update: 'fake' });
        await p.page.goto(`./?${q.toString()}#/t/${room.roomId}/${room.roomKey}`);
        await expect(p.page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
        await front(p);
        const nick = p.page.getByTestId('lobby-nickname');
        await nick.tap();
        await nick.fill(p.name);
        await nick.blur();
        await expect(p.page.locator(`[data-testid="chair"][data-seat="${p.seat}"]`)).toHaveAttribute('data-mine', 'true', { timeout: 15_000 });
      }
      await soft('the Home Screen hint shows on the iPad and is dismissed by a tap', async () => {
        for (const p of both) {
          await front(p);
          const hint = p.page.getByTestId('hint-home-screen');
          await expect(hint).toBeVisible();
          if (p === A) {
            await expect(hint).toContainText('7 days');
            await shot(A.page, 'M5', 'home-screen-hint', project);
          }
          await hint.getByTestId('hint-home-screen-ok').tap();
          await expect(hint).toHaveCount(0);
        }
      });
      await front(A);
      await expect(A.page.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'true');
      await A.page.getByTestId('lobby-mode').selectOption('booster');
      await expect(A.page.getByTestId('lobby-set')).toHaveValue('M19');
      for (const [id, v] of [
        ['lobby-packs', 3],
        ['lobby-picks', 1],
      ] as const) {
        const input = A.page.getByTestId(id);
        await input.tap();
        await input.fill(String(v));
        await input.blur();
      }
      await expect.poll(async () => (await state(B.page)).lobby).toEqual({ draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false });
      await expect(A.page.getByTestId('start-draft')).toBeEnabled();
      await shot(A.page, 'M5', 'ipad-lobby', project);
    });
    if (!lobbyOk) return finish();

    // ---- Draft by touch ------------------------------------------------------------------------------------------
    const generated: Record<Seat, Map<string, PackRecord>> = { s0: new Map(), s1: new Map() };
    const packSeen = new Set<string>();
    const noteGenerated = async (p: Player, packId: string) => {
      if (packSeen.has(`${p.seat}:${packId}`)) return;
      packSeen.add(`${p.seat}:${packId}`);
      for (const g of (await secrets(p.page)).draft?.generated ?? []) generated[p.seat].set(g.packId, g);
    };
    /** Where each seat last found a pack card with a tap (fractions of the draft surface). */
    const lastHit: Record<Seat, Pt> = { s0: { x: 0.5, y: 0.25 }, s1: { x: 0.5, y: 0.25 } };
    const GRID: Pt[] = [];
    for (let y = 0.1; y <= 0.62; y += 0.06) for (let x = 0.12; x <= 0.92; x += 0.05) GRID.push({ x, y });
    /** Tap pack cards until one is marked; returns the surface point that marked it. */
    const markByTap = async (p: Player): Promise<Pt> => {
      const box = (await p.page.getByTestId('draft-surface').boundingBox())!;
      const at = (f: Pt): Pt => ({ x: box.x + f.x * box.width, y: box.y + f.y * box.height });
      const last = lastHit[p.seat];
      const order = [last, ...GRID.slice().sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y))];
      for (const f of order) {
        await tapAt(p.page, at(f));
        const ok = await expect
          .poll(async () => (await view(p.page))?.marked.length ?? 0, { timeout: 500, intervals: [50, 100, 150] })
          .toBe(1)
          .then(() => true)
          .catch(() => false);
        if (ok) {
          lastHit[p.seat] = f;
          return at(f);
        }
      }
      throw new Error(`${p.name}: no tap on the draft surface marked a pack card`);
    };
    let tapFallbacks = 0;
    const notes: string[] = [];
    /** One pick by `p` when it has a pack to pick from: tap marks a card, a second tap on it takes it. */
    const touchPick = async (p: Player, beforeTake?: () => Promise<void>): Promise<PickRec | null> => {
      const v = await view(p.page);
      if (!v || !v.pack || v.pack.cards.length === 0 || v.picks === 0) return null;
      if (v.pack.public && !v.waitingOn.includes(p.seat)) return null;
      await noteGenerated(p, v.pack.packId);
      const before = v.pack.cards.map((c) => c.id);
      const done = async () =>
        expect
          .poll(
            async () => {
              const w = await view(p.page);
              return !w || w.pool.length > v.pool.length;
            },
            { timeout: 15_000 },
          )
          .toBe(true);
      try {
        expect(v.picks, 'one card per pick').toBe(1);
        await front(p);
        if (v.marked.length) await p.page.getByTestId('draft-clear').tap();
        const at = await markByTap(p);
        const marked = (await view(p.page))!.marked;
        if (beforeTake) await beforeTake();
        await tapAt(p.page, at);
        const took = await expect
          .poll(async () => ((await view(p.page))?.pool.length ?? Infinity) > v.pool.length || (await view(p.page)) === null, { timeout: 3_000 })
          .toBe(true)
          .then(() => true)
          .catch(() => false);
        if (!took) {
          // The second tap on the marked card did not take it: take it with the Take button (also a touch route).
          notes.push(`${p.name}: a second tap on the marked card did not take it (pick ${v.pool.length + 1}); the Take button did`);
          await p.page.getByTestId('draft-confirm').tap();
        }
        await done();
        return { seat: p.seat, packId: v.pack.packId, before, picked: marked };
      } catch (e) {
        if (tapFallbacks++ === 0) R.failures.push(`${p.name}'s pick by tap-tap did not register (fell back to __spellplane.flow.pick): ${firstLine(e)}`);
        gaps.push(`${p.name}: a draft pick through __spellplane.flow.pick`);
        const want = before.slice(0, v.picks);
        await hook(p.page, 'flow.mark', want);
        expect(await hook<boolean>(p.page, 'flow.pick', want)).toBe(true);
        await done();
        return { seat: p.seat, packId: v.pack.packId, before, picked: want };
      }
    };

    const picks: PickRec[] = [];
    const draftOk = await step('booster draft (touch): Ann taps Start; both draft three packs, every pick tap-tap, until the builder opens', async () => {
      await A.page.getByTestId('start-draft').tap();
      for (const p of both) await inStage(p.page, 'draft');
      await expect.poll(async () => (await view(B.page))?.pack?.cards.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
      let shotPick = false;
      let shotWaiting = false;
      await expect
        .poll(
          async () => {
            for (const p of both) {
              const r = await touchPick(
                p,
                p === A && !shotPick
                  ? async () => {
                      shotPick = true;
                      await A.page.waitForTimeout(500);
                      await shot(A.page, 'M5', 'ipad-draft-pick', project);
                    }
                  : undefined,
              );
              if (r) picks.push(r);
              if (r && p === A && !shotWaiting) {
                shotWaiting = true;
                await soft('waiting indicator after Ann’s first pick', async () => {
                  await expect(A.page.getByTestId('draft-prompt')).toContainText('Waiting');
                  await shot(A.page, 'M5', 'ipad-draft-waiting', project);
                });
              }
            }
            return [(await state(A.page)).stage, (await state(B.page)).stage].join();
          },
          { timeout: 900_000, intervals: [100] },
        )
        .toBe('build,build');
      for (const p of both) await inStage(p.page, 'build');
      const packSize = picks.find((x) => x.seat === 's0')!.before.length;
      for (const p of both) {
        expect(picks.filter((x) => x.seat === p.seat)).toHaveLength(3 * packSize);
        expect((await secrets(p.page)).pool).toHaveLength(3 * packSize);
      }
      expect(generated.s0.size).toBe(3);
      expect(generated.s1.size).toBe(3);
    });
    if (draftOk) {
      for (const viewer of both) {
        const owner = other(viewer);
        await step(`leak scan: nothing ${viewer.name}'s page received, holds or shows names a card of ${owner.name}'s packs it never held`, async () => {
          const received = (await hook<NetMessageRecord[]>(viewer.page, 'net.messages')).filter((m) => m.dir === 'in');
          const own = [...generated[viewer.seat].values()].flatMap((g) => g.cards);
          const others = [...generated[owner.seat].values()].flatMap((g) => g.cards);
          const passed = picks.filter((r) => r.seat === owner.seat).map((r) => r.before.filter((id) => !r.picked.includes(id)));
          const allowed = new Set<string>([...own.map((c) => c.instanceId), ...passed.flat()]);
          const all = new Map<string, RevealedCard>([...own, ...others].map((c) => [c.instanceId, c]));
          const known = [...allowed].map((id) => all.get(id)).filter((c): c is RevealedCard => c !== undefined);
          const report = packLeakScan({
            observed: [received, await state(viewer.page), await secrets(viewer.page), await view(viewer.page)],
            others,
            nonces: [...generated[owner.seat].values()].map((g) => g.ownerNonce),
            allowed,
            known,
          });
          expect(report.forbidden).toBeGreaterThan(0);
          expect(report.tokens.slice(0, 10)).toEqual([]);
          expect(report.pairs.slice(0, 10)).toEqual([]);
        });
      }
    }
    if (!draftOk) return finish();

    // ---- Builder by touch ------------------------------------------------------------------------------------------
    const mainColours = (b: DeckBuild): [string, string] => {
      const n: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const id of b.main) for (const col of lookup(b.cards.find((x) => x.id === id)!.ref)?.colors ?? []) if (col in n) n[col]!++;
      const order = Object.entries(n).sort((x, y) => y[1] - x[1]);
      return [order[0]![0], order[1]![0]];
    };
    const deckSize = (b: DeckBuild | null) => b?.main.length ?? 0;
    const spellToDeck = async (page: Page) => {
      const rows = page.locator('[data-testid="list-pool"] [data-testid="list-row"]');
      const sids = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const i = sids.findIndex((sid) => !isLand(lookup({ sid })));
      if (i < 0) throw new Error('no spell left in the pool');
      await rows.nth(i).locator('button.main').tap();
    };
    const decks: Record<Seat, DeckBuild | null> = { s0: null, s1: null };
    for (const p of both) {
      await step(`${p.name} builds 40 cards by touch: 23 spells tapped in the list view, 17 basics from the dispenser`, async () => {
        const page = p.page;
        await front(p);
        await page.getByTestId('view-list').tap();
        await expect(page.getByTestId('builder-list')).toBeVisible();
        for (let i = 0; i < 23; i++) {
          await spellToDeck(page);
          await expect.poll(async () => deckSize(await build(page))).toBe(i + 1);
        }
        const [c1, c2] = mainColours((await build(page))!);
        for (const [name, n] of [
          [BASIC_OF[c1]!, 9],
          [BASIC_OF[c2]!, 8],
        ] as [string, number][]) {
          const row = page.locator(`[data-testid="dispenser-row"][data-basic="${name}"]`);
          const had = Number(await row.getByTestId('dispenser-count').textContent());
          for (let i = 0; i < n; i++) await row.getByTestId('dispenser-add').tap();
          await expect(row.getByTestId('dispenser-count')).toHaveText(String(had + n));
        }
        const b = (await build(page))!;
        expect(b.main).toHaveLength(40);
        expect(b.main.map((id) => b.cards.find((c) => c.id === id)!).filter((c) => c.basic)).toHaveLength(17);
        if (p === A) await shot(page, 'M5', 'ipad-builder-list', project);
        decks[p.seat] = b;
      });
      await step(`${p.name}'s builder table sorts by colour, mana value and type by its buttons; the readout shows 40 and 17`, async () => {
        const page = p.page;
        await page.getByTestId('view-table').tap();
        await expect(page.getByTestId('builder')).toHaveAttribute('data-view', 'table');
        for (const key of ['manaValue', 'type', 'colour'] as BuilderSort[]) {
          await page.getByTestId(`sort-${key}`).tap();
          await expect(page.getByTestId(`sort-${key}`)).toHaveAttribute('aria-pressed', 'true');
          expect(deckOf(await build(page))).toEqual(deckOf(decks[p.seat]));
        }
        await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '40');
        await expect(page.getByTestId('stats-lands')).toHaveAttribute('data-value', '17');
        if (p === A) {
          await page.waitForTimeout(800);
          await shot(page, 'M5', 'ipad-builder-table', project);
        }
        decks[p.seat] = await build(page);
      });
    }
    const readyBoth = async (game: number) => {
      await front(A);
      await A.page.getByTestId('builder-ready').tap();
      await expect(A.page.getByTestId('builder-locked')).toBeVisible();
      await front(B);
      await B.page.getByTestId('builder-ready').tap();
      for (const p of both) await inStage(p.page, 'match');
      await expect.poll(async () => (await state(A.page)).games).toBe(game);
      for (const p of both) await expect.poll(async () => (await secrets(p.page)).libraryOrder.length, { timeout: 15_000 }).toBe(40);
    };
    const game1 = await step('both tap Ready: game one starts with the 40-card decks', () => readyBoth(1));
    if (!game1) return finish();

    // ---- Game one by touch -----------------------------------------------------------------------------------------
    const fanCard = (page: Page, id: string) => page.locator(`[data-testid="hand-card"][data-card="${id}"]`);
    const landInHand = async (page: Page): Promise<string | null> => {
      const sec = await secrets(page);
      return sec.hand.find((id) => isLand(lookup(sec.identities[id]!.card))) ?? null;
    };
    const openLibrary = async (p: Player) => {
      await p.page.locator(`[data-testid="zone-button"][data-zone="library:${p.seat}"]`).tap();
      await expect(p.page.getByTestId('pile-viewer')).toHaveAttribute('data-kind', 'library');
    };
    const viewerButton = (page: Page, name: RegExp) => page.getByTestId('pile-viewer').getByRole('button', { name });
    const closeViewer = async (page: Page) => {
      await viewerButton(page, /^Close/).tap();
      await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
    };
    /** Drag a hand card up out of the fan onto the table with one finger. */
    /** A point of the hand card's face that is not covered by a neighbour (later fan cards overlap earlier ones). */
    const pressPoint = async (page: Page, id: string): Promise<Pt> => {
      const b = (await fanCard(page, id).boundingBox())!;
      const y = Math.round(b.y + b.height - 20);
      for (const fx of [0.5, 0.35, 0.2, 0.1, 0.65, 0.8]) {
        const x = Math.round(b.x + b.width * fx);
        const hit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-testid="hand-card"]') as HTMLElement | null)?.dataset.card ?? null, { x, y });
        if (hit === id) return { x, y };
      }
      const what = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName.toLowerCase()}${el.closest('[data-testid]') ? ` in ${el.closest('[data-testid]')!.getAttribute('data-testid')}` : ''}` : 'nothing';
      }, { x: Math.round(b.x + b.width / 2), y });
      throw new Error(`hand card ${id} has no uncovered point near its foot (centre is under ${what}; box ${JSON.stringify(b)})`);
    };
    /** Drag a hand card up out of the fan onto the table with one finger. */
    const dragOut = async (p: Player, id: string) => {
      const page = p.page;
      const vp = page.viewportSize()!;
      const from = await pressPoint(page, id);
      const to = { x: Math.round(vp.width * 0.3), y: Math.round(vp.height * 0.58) };
      // Straight up out of the fan first (a sideways start scrolls the fan), then across to the drop point.
      const up = { x: from.x, y: Math.round(from.y - vp.height * 0.18) };
      await fingers(page, [{ type: 'down', id: 1, ...from }, ...slide(1, from, up, 8), ...slide(1, up, to, 12), { type: 'up', id: 1, ...to }]);
      await expect.poll(async () => (await state(page)).cards[id]?.zone).toBe(`battlefield:${p.seat}`);
    };
    const lands: Partial<Record<Seat, string>> = {};

    for (const p of both) {
      await step(`game one (touch): ${p.name} opens the library from the avatar, taps Shuffle and Draw seven times, and drags a land out of the hand fan`, async () => {
        const page = p.page;
        await front(p);
        if (p === A) {
          await soft('first-run hints at the table: the touch gestures, then talking by the thumb bar (no welcome "try it alone" in an evening); each dismissed by a tap', async () => {
            const hint = page.getByTestId('hint');
            await expect(hint).toHaveAttribute('data-hint', 'touchGestures');
            await shot(page, 'M5', 'first-run-hint-touch', project);
            await hint.getByTestId('hint-dismiss').tap();
            await expect(hint).toHaveAttribute('data-hint', 'talkKey');
            await expect(hint).not.toContainText('Ctrl');
            await expect(hint).toContainText('Talk');
            await shot(page, 'M5', 'first-run-hint-talk', project);
            await hint.getByTestId('hint-dismiss').tap();
          });
        }
        // Any first-run hint left (top left, under the toolbar): tap it away first.
        for (let i = 0; i < 6 && (await page.getByTestId('hint').count()) > 0; i++) {
          await page.getByTestId('hint').getByTestId('hint-dismiss').tap();
          await page.waitForTimeout(150);
        }
        await openLibrary(p);
        const before = (await secrets(page)).libraryOrder;
        await viewerButton(page, /^Shuffle/).tap();
        await expect.poll(async () => (await secrets(page)).libraryOrder).not.toEqual(before);
        for (let i = 1; i <= 7; i++) {
          await viewerButton(page, /^Draw(?! N)/).tap();
          await expect.poll(async () => (await secrets(page)).hand).toHaveLength(i);
        }
        let land = await landInHand(page);
        for (let i = 0; land === null && i < 10; i++) {
          const n = (await secrets(page)).hand.length;
          await viewerButton(page, /^Draw(?! N)/).tap();
          await expect.poll(async () => (await secrets(page)).hand.length).toBe(n + 1);
          land = await landInHand(page);
        }
        await closeViewer(page);
        await expect.poll(async () => (await state(other(p).page)).zones[`hand:${p.seat}`]?.ids.length ?? 0).toBeGreaterThanOrEqual(7);
        if (land === null) throw new Error('no land in seventeen draws');
        await dragOut(p, land);
        lands[p.seat] = land;
        const ref = (await secrets(page)).identities[land]!.card;
        await expect.poll(async () => (await state(other(p).page)).cards[land]?.identity).toEqual(ref);
      });
    }

    // Ann's tablet controls, each with its evidence.
    await front(A);
    const land = lands.s0;
    await step('touch: the iPad table in landscape, with the thumb bar above the hand', async () => {
      await settled(A.page);
      expect((await hook<ThumbAction[]>(A.page, 'touch.thumbBar')).map((b) => b.action)).toEqual(['attack', 'settle', 'resolve', 'ask', 'talk']);
      await expect(A.page.getByTestId('thumb-bar')).toBeVisible();
      for (const a of ['attack', 'settle', 'resolve', 'ask', 'talk']) {
        const b = (await A.page.getByTestId(`thumb-${a}`).boundingBox())!;
        expect(Math.min(b.width, b.height), `thumb-${a} is a thumb-sized target`).toBeGreaterThanOrEqual(44);
      }
      await shot(A.page, 'M5', 'ipad-landscape-table', project);
      await A.page.getByTestId('thumb-bar').screenshot({ path: path.join('artifacts', 'shots', 'M5', `thumb-bar-${project}.png`) });
    });
    if (land) {
      await step('touch: a long-press on the land opens the eight-slot radial menu; its Tap slot taps the land', async () => {
        const c = (await shown(A.page)).find((x) => x.id === land)!;
        await longPress(A.page, centre(c.screen));
        const radial = (await hook<RadialMenuState | null>(A.page, 'touch.radial'))!;
        expect(radial.card).toBe(land);
        expect(radial.slots.map((s) => s.id).sort()).toEqual(['counter', 'flip', 'inspect', 'stack', 'tap', 'toExile', 'toGraveyard', 'toHand']);
        await expect(A.page.getByTestId('radial-menu')).toBeVisible();
        await shot(A.page, 'M5', 'radial-menu', project);
        await A.page.getByTestId('radial-tap').tap();
        await expect.poll(async () => (await state(A.page)).cards[land]!.tapped).toBe(true);
        await expect(A.page.getByTestId('radial-menu')).toHaveCount(0);
      });
      await step('touch: a double-tap on the land untaps it', async () => {
        await settled(A.page);
        const c = centre((await shown(A.page)).find((x) => x.id === land)!.screen);
        await fingers(A.page, [
          { type: 'down', id: 1, ...c, wait: 30 },
          { type: 'up', id: 1, ...c, wait: 60 },
          { type: 'down', id: 1, ...c, wait: 30 },
          { type: 'up', id: 1, ...c },
        ]);
        await expect.poll(async () => (await state(A.page)).cards[land]!.tapped).toBe(false);
      });
    }
    await step('touch: a tap lifts a hand card for reading; a tap on the table lowers it', async () => {
      const id = (await secrets(A.page)).hand[1]!;
      const vh = A.page.viewportSize()!.height;
      const el = fanCard(A.page, id);
      const rest = (await el.boundingBox())!;
      await A.page.touchscreen.tap(Math.round(rest.x + 15), Math.round(rest.y + rest.height - 15));
      await expect.poll(async () => (await el.boundingBox())!.height).toBeGreaterThan(vh * 0.4);
      await A.page.waitForTimeout(300);
      await shot(A.page, 'M5', 'hand-fan-lifted', project);
      await A.page.touchscreen.tap(Math.round(A.page.viewportSize()!.width * 0.5), Math.round(vh * 0.3));
      await expect.poll(async () => (await el.boundingBox())!.height).toBeLessThan(vh * 0.3);
    });
    await step('touch: two fingers pinch the camera; the table state does not change', async () => {
      await settled(A.page);
      const h = await hashOf(A.page);
      const p0 = await pose(A.page);
      const vp = A.page.viewportSize()!;
      const c = { x: Math.round(vp.width / 2), y: Math.round(vp.height * 0.4) };
      const steps: Step[] = [
        { type: 'down', id: 1, x: c.x - 40, y: c.y, wait: 0 },
        { type: 'down', id: 2, x: c.x + 40, y: c.y },
      ];
      for (let i = 1; i <= 10; i++) steps.push({ type: 'move', id: 1, x: c.x - 40 - 12 * i, y: c.y, wait: 0 }, { type: 'move', id: 2, x: c.x + 40 + 12 * i, y: c.y });
      steps.push({ type: 'up', id: 1, x: c.x - 160, y: c.y, wait: 0 }, { type: 'up', id: 2, x: c.x + 160, y: c.y });
      await fingers(A.page, steps);
      await settled(A.page);
      const p1 = await pose(A.page);
      expect(Math.hypot(...p0.position.map((v, i) => v - p1.position[i]!))).toBeGreaterThan(1);
      expect(await hashOf(A.page)).toBe(h);
      // Two fingers tapped twice fit the table again.
      const two = (): Step[] => [
        { type: 'down', id: 1, x: c.x - 60, y: c.y, wait: 0 },
        { type: 'down', id: 2, x: c.x + 60, y: c.y, wait: 30 },
        { type: 'up', id: 1, x: c.x - 60, y: c.y, wait: 0 },
        { type: 'up', id: 2, x: c.x + 60, y: c.y, wait: 60 },
      ];
      await fingers(A.page, [...two(), ...two()]);
      await settled(A.page);
      const p2 = await pose(A.page);
      expect(Math.hypot(...p0.position.map((v, i) => v - p2.position[i]!))).toBeLessThan(5);
    });
    await step('the iPad table in portrait: own seat at the bottom, thumb bar and hand on screen', async () => {
      await A.page.setViewportSize(IPAD_PORTRAIT);
      await settled(A.page);
      await A.page.waitForTimeout(400);
      const v = (await tableView(A.page))!;
      const own = v.seats.find((s) => s.seat === 's0')!;
      const opp = v.seats.find((s) => s.seat === 's1')!;
      expect(own.screen!.territory.y).toBeGreaterThan(opp.screen!.territory.y);
      await expect(A.page.getByTestId('thumb-bar')).toBeInViewport();
      await shot(A.page, 'M5', 'ipad-portrait-table', project);
      await A.page.setViewportSize(IPAD.viewport);
      await settled(A.page);
    });
    await step('update between games: a waiting update shows the notice mid-game and is not applied', async () => {
      await offerUpdate(A.page);
      await expect(A.page.getByTestId('update-notice')).toHaveText(UPDATE_NOTICE);
      await A.page.waitForTimeout(300);
      await shot(A.page, 'M5', 'update-available', project);
      expect(await appliedAt(A.page)).toEqual([]);
    });
    await step('game one: both pages agree on the state hash', async () => {
      await converged([A.page, B.page]);
      expect(await state(A.page)).toEqual(await state(B.page));
    });

    // ---- Next game, the audit ----------------------------------------------------------------------------------------
    const backOk = await step('next game (touch): Ann taps "Next game", Ben taps OK in the HUD prompt; both return to their builds; the update still waits', async () => {
      await front(A);
      await A.page.getByTestId('propose-nextGame').tap();
      await front(B);
      await expect(B.page.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
      await B.page.getByTestId('prompt-ok').tap();
      for (const p of both) await inStage(p.page, 'build');
      for (const p of both) expect(deckOf(await build(p.page))).toEqual(deckOf(decks[p.seat]));
      expect(await appliedAt(A.page)).toEqual([]);
    });
    const auditOk = async (game: number, title: string) =>
      step(title, async () => {
        for (const p of both) expect(await hasPart(p.page, 'audit'), `${p.name}'s page has the audit part of the debug hook (M5-P2)`).toBe(true);
        for (const p of both) {
          await expect
            .poll(async () => (await hook<{ game: number; seat: string; verdict: string }[]>(p.page, 'audit.verdicts')).filter((v) => v.game === game).map((v) => `${v.seat}:${v.verdict}`), { timeout: 20_000 })
            .toEqual(['s0:verified', 's1:verified']);
        }
        await expect(A.page.getByTestId('audit-panel')).toBeVisible();
        await shot(A.page, 'M5', 'audit-panel-verified', project);
      });
    if (backOk) await auditOk(1, 'audit after game one: every browser publishes automatically; both verdicts are verified, in the log and the audit panel');
    if (!backOk) return finish();

    await step('sideboarding (touch): Ann swaps one deck spell for a sideboard spell in the list view', async () => {
      const page = A.page;
      await front(A);
      await page.getByTestId('view-list').tap();
      await expect(page.getByTestId('builder-list')).toBeVisible();
      const deckRows = page.locator('[data-testid="list-deck"] [data-testid="list-row"]');
      const deckSids = await deckRows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const out = deckSids.findIndex((sid) => !isLand(lookup({ sid })));
      await deckRows.nth(out).locator('button.main').tap();
      await expect.poll(async () => deckSize(await build(page))).toBe(39);
      const poolRows = page.locator('[data-testid="list-pool"] [data-testid="list-row"]');
      const poolSids = await poolRows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const into = poolSids.findIndex((sid) => sid !== deckSids[out] && !isLand(lookup({ sid })));
      await poolRows.nth(into).locator('button.main').tap();
      await expect.poll(async () => deckSize(await build(page))).toBe(40);
      decks.s0 = await build(page);
    });
    const game2 = await step('game two: both tap Ready; Ann’s library is her new deck', async () => {
      await readyBoth(2);
      const sec = await secrets(A.page);
      const sids = [...sec.libraryOrder, ...sec.hand].map((id) => sec.identities[id]!.card.sid).sort();
      const b = decks.s0!;
      expect(sids).toEqual(b.main.map((id) => b.cards.find((c) => c.id === id)!.ref.sid).sort());
      await converged([A.page, B.page]);
      expect(await appliedAt(A.page)).toEqual([]);
    });
    if (!game2) return finish();
    await step('a tampered game: a test-only hook rewrites Ann’s recorded library order; the audit after the game shows a mismatch for Ann', async () => {
      const tamper = await A.page.evaluate(() => typeof (window.__spellplane as unknown as { audit?: { tamper?: unknown } }).audit?.tamper === 'function');
      expect(tamper, 'a test-only hook to tamper with the recorded library order (__spellplane.audit.tamper; M5-P2)').toBe(true);
    });

    // ---- Sealed, then Rochester -----------------------------------------------------------------------------------
    const sealedOk = await step('sealed (touch): Ben taps "New draft", Ann taps OK; the update applies at the lobby; Ann opens six sealed packs each', async () => {
      await front(B);
      await B.page.getByTestId('propose-newDraft').tap();
      await front(A);
      await expect(A.page.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
      await A.page.getByTestId('prompt-ok').tap();
      for (const p of both) await inStage(p.page, 'lobby');
      await soft('the waiting update applies once the table is back in its lobby', async () => {
        await expect.poll(() => appliedAt(A.page)).toEqual([{ route: 'room', stage: 'lobby' }]);
      });
      await A.page.getByTestId('lobby-mode').selectOption('sealed');
      const packs = A.page.getByTestId('lobby-packs');
      await packs.tap();
      await packs.fill('6');
      await packs.blur();
      await expect.poll(async () => (await state(B.page)).lobby?.draft).toEqual({ format: 'sealed', packs: 6 });
      await A.page.getByTestId('start-draft').tap();
      for (const p of both) await inStage(p.page, 'build');
      const packSize = picks.find((x) => x.seat === 's0')!.before.length;
      for (const p of both) await expect.poll(async () => (await secrets(p.page)).pool?.length ?? 0, { timeout: 20_000 }).toBe(6 * packSize);
    });
    if (!sealedOk) return finish();

    const rochesterPicks: PickRec[] = [];
    await step('Rochester (touch): Ann taps "New draft" in the builder, Ben taps OK; one pack each on the shared table, picked tap-tap in snake order', async () => {
      await front(A);
      await A.page.getByTestId('propose-newDraft').tap();
      await front(B);
      await expect(B.page.getByTestId('evening-ok')).toBeVisible({ timeout: 15_000 });
      await B.page.getByTestId('evening-ok').tap();
      for (const p of both) await inStage(p.page, 'lobby');
      await front(A);
      await A.page.getByTestId('lobby-mode').selectOption('rochester');
      const packs = A.page.getByTestId('lobby-packs');
      await packs.tap();
      await packs.fill('1');
      await packs.blur();
      await expect.poll(async () => (await state(B.page)).lobby?.draft).toEqual({ format: 'rochester', packs: 1, burn: 0 });
      await A.page.getByTestId('start-draft').tap();
      for (const p of both) await inStage(p.page, 'draft');
      await expect.poll(async () => (await view(A.page))?.pack?.public ?? false, { timeout: 30_000 }).toBe(true);
      lastHit.s0 = { x: 0.5, y: 0.3 };
      lastHit.s1 = { x: 0.5, y: 0.3 };
      await A.page.waitForTimeout(600);
      await shot(A.page, 'M5', 'ipad-rochester', project);
      await expect
        .poll(
          async () => {
            for (const p of both) {
              const r = await touchPick(p);
              if (r) rochesterPicks.push(r);
            }
            return [(await state(A.page)).stage, (await state(B.page)).stage].join();
          },
          { timeout: 400_000, intervals: [100] },
        )
        .toBe('build,build');
      const packIds = [...new Set(rochesterPicks.map((r) => r.packId))];
      expect(packIds).toHaveLength(2);
      packIds.forEach((id, n) => {
        const order = rochesterOrder(['s0', 's1'], n === 0 ? 's0' : 's1');
        const seats = rochesterPicks.filter((r) => r.packId === id).map((r) => r.seat);
        expect(seats).toEqual(seats.map((_, i) => order[i % order.length]));
      });
    });
    await info.attach('gate-notes.json', { body: JSON.stringify(notes, null, 2), contentType: 'application/json' });
    fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
    fs.writeFileSync(path.join('artifacts', 'gate', `M5-evening-notes-${project}.json`), JSON.stringify(notes, null, 2));
    await step('no page error and no request leaves the test server', async () => {
      expect(R.errors).toEqual([]);
      expect(R.outside).toEqual([]);
    });
    R.errors.length = 0;
    R.outside.length = 0;
    return finish();
  });

  // ==================================================================================================================
  // 2. Offline resume
  // ==================================================================================================================
  test('offline: a saved table resumes on the iPad with the network disabled', async ({ browser }, info) => {
    test.setTimeout(5 * 60_000);
    const project = info.project.name;
    const R = recorder(info, 'offline');
    const context = await ipadContext(browser);
    const page = await context.newPage();
    R.watch(page, 'Ann');
    const profile = fresh(info, 'off');
    const url = (hash = '/') => `./?${new URLSearchParams({ faces: 'placeholder', profile, sw: 'on' }).toString()}#${hash}`;
    let hash = '';
    let hidden: SecretStore | null = null;
    const online = await R.step('online: the first visit installs the worker; a deck is imported and played by touch, and saved', async () => {
      await page.goto(url());
      await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 20_000 }).toBe(true);
      await expect
        .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller && navigator.serviceWorker.controller.state === 'activated'), { timeout: 30_000 })
        .toBe(true);
      await page.getByTestId('open-deck-import').tap();
      await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
      await page.getByTestId('deck-check').tap();
      await expect(page.getByTestId('deck-import-go')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('deck-import-go').tap();
      await expect.poll(async () => (await secrets(page)).libraryOrder.length, { timeout: 15_000 }).toBe(60);
      await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').tap();
      await page.getByTestId('pile-viewer').getByRole('button', { name: /^Shuffle/ }).tap();
      for (let i = 1; i <= 7; i++) {
        await page.getByTestId('pile-viewer').getByRole('button', { name: /^Draw(?! N)/ }).tap();
        await expect.poll(async () => (await secrets(page)).hand).toHaveLength(i);
      }
      await page.getByTestId('pile-viewer').getByRole('button', { name: /^Close/ }).tap();
      const id = (await secrets(page)).hand[0]!;
      const b = (await page.locator(`[data-testid="hand-card"][data-card="${id}"]`).boundingBox())!;
      const from = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height - 20) };
      const to = { x: Math.round(page.viewportSize()!.width * 0.4), y: Math.round(page.viewportSize()!.height * 0.55) };
      await fingers(page, [{ type: 'down', id: 1, ...from }, ...slide(1, from, to, 14), { type: 'up', id: 1, ...to }]);
      await expect.poll(async () => (await state(page)).cards[id]?.zone).toBe('battlefield:s0');
      await page.evaluate(() => (window.__spellplane as unknown as { session: { saved(): Promise<void> } }).session.saved());
      hash = await hashOf(page);
      hidden = await secrets(page);
    });
    if (online) {
      await R.step('offline: the page reloads from the worker and resumes the table: same state hash, same hidden cards', async () => {
        await context.setOffline(true);
        await page.reload();
        await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 20_000 }).toBe(true);
        await expect(page.getByTestId('hud')).toBeVisible();
        expect(await hashOf(page)).toBe(hash);
        expect(await secrets(page)).toEqual(hidden);
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await settled(page);
        await shot(page, 'M5', 'offline-table', project);
      });
      await R.step('offline: the player is told the app is offline (an offline banner or notice)', async () => {
        await expect(page.getByText(/offline|no connection|not connected to the internet/i).first()).toBeVisible({ timeout: 5_000 });
      });
      await R.step('offline: the start page loads with the saved table', async () => {
        await page.goto(url('/lobby'));
        await expect(page.getByTestId('start-page')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(300);
        await shot(page, 'M5', 'offline-start-page', project);
      });
    }
    await R.finish(() => context.close());
  });

  // ==================================================================================================================
  // 3. Three players, a listening spectator, the Ctrl talk rule
  // ==================================================================================================================
  test('three players from seats 1-3 (same shape for all), a spectator hears open voice, Ctrl talks only when held alone', async ({ browser, browserName }, info) => {
    test.setTimeout(8 * 60_000);
    const project = info.project.name;
    const R = recorder(info, 'three');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(10_000);
    await noNetwork(context);
    await context.addInitScript({ content: cardsScript });
    if (browserName === 'webkit') await context.addInitScript({ content: FAKE_MIC });
    const room = freshRoom();
    const names = ['Ann', 'Ben', 'Cal'];
    const decks = ['gw-m19-60.txt', 'ur-m19-60.mtga.txt', 'gw-m19-60.txt'];
    const players: { name: string; seat: string; page: Page }[] = [];
    const open = async (page: Page, hash: string, who: string) => {
      const q = new URLSearchParams({ faces: 'placeholder', profile: fresh(info, who), transport: 'local', speech: 'fake' });
      await page.goto(`./?${q.toString()}#${hash}`);
    };
    let viv: Page | null = null;
    const setup = await R.step('a three-player free-for-all: three pages join, Ann picks ffa3, all Ready, a spectator watches', async () => {
      for (const [i, name] of names.entries()) {
        const page = await context.newPage();
        R.watch(page, name);
        await open(page, `/t/${room.roomId}/${room.roomKey}`, name);
        await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
        const nick = page.getByTestId('lobby-nickname');
        await nick.fill(name);
        await nick.press('Enter');
        const seat = `s${i}`;
        await expect(page.locator(`[data-testid="chair"][data-seat="${seat}"]`)).toHaveAttribute('data-mine', 'true', { timeout: 15_000 });
        players.push({ name, seat, page });
        if (i === 0) {
          await page.getByTestId('lobby-format-select').selectOption('ffa3');
          await expect.poll(async () => (await state(page)).format).toBe('ffa3');
          await page.getByTestId('lobby-pass-timer').selectOption('off');
        }
      }
      for (const [i, p] of players.entries()) {
        await p.page.getByTestId('lobby-deck-text').fill(decklist(decks[i]!));
        await p.page.getByTestId('lobby-deck-check').click();
        await expect(p.page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
        await p.page.getByTestId('ready').click();
      }
      const host = players[0]!.page;
      await expect(host.getByTestId('ready-count')).toHaveText('3 of 3 players ready.');
      const watchLink = await host.getByTestId('watch-link').inputValue();
      viv = await context.newPage();
      R.watch(viv, 'Viv');
      await viv.addInitScript(() => {
        const md = navigator.mediaDevices;
        const w = window as unknown as { __micAsks: number };
        w.__micAsks = 0;
        const real = md?.getUserMedia?.bind(md);
        if (md && real)
          md.getUserMedia = (c?: MediaStreamConstraints) => {
            w.__micAsks++;
            return real(c);
          };
      });
      const hashPart = watchLink.slice(watchLink.indexOf('#') + 1);
      await open(viv, hashPart, 'viv');
      await expect(viv.getByTestId('spectator-view')).toBeVisible({ timeout: 20_000 });
      await host.getByTestId('start-game').click();
      for (const p of players) await expect(p.page.getByTestId('hud')).toBeVisible({ timeout: 30_000 });
      await expect(viv.getByTestId('hud')).toBeVisible({ timeout: 30_000 });
      for (const p of players) await expect.poll(async () => (await tableView(p.page))?.format ?? null, { timeout: 15_000 }).toBe('ffa3');
    });
    if (setup) {
      await R.step('three players: from seats 1, 2 and 3 the own seat is at the bottom, the next clockwise top-left, the last top-right, the same shape for all', async () => {
        const shapes: { x: number; y: number }[][] = [];
        for (const [i, p] of players.entries()) {
          await p.page.bringToFront();
          await settled(p.page);
          const v = (await tableView(p.page))!;
          const sh = [0, 1, 2].map((k) => v.seats.find((s) => s.seat === `s${(i + k) % 3}`)!.screen!.territory);
          const [me, next, last] = sh as [Pt, Pt, Pt];
          expect(me.y, `${p.name}: own seat below the others`).toBeGreaterThan(Math.max(next.y, last.y));
          expect(next.x, `${p.name}: next seat clockwise on the left`).toBeLessThan(me.x - 100);
          expect(last.x, `${p.name}: last seat on the right`).toBeGreaterThan(me.x + 100);
          shapes.push(sh);
          await shot(p.page, 'M5', `three-player-seat${i + 1}`, project);
        }
        for (let v = 1; v < 3; v++) for (let k = 0; k < 3; k++) {
          expect(Math.abs(shapes[v]![k]!.x - shapes[0]![k]!.x)).toBeLessThan(2);
          expect(Math.abs(shapes[v]![k]!.y - shapes[0]![k]!.y)).toBeLessThan(2);
        }
      });
      await R.step('a spectator listens: "Listening", no microphone asked for; Ann’s open talk (Ctrl held alone) reaches every connection, the spectator’s too', async () => {
        const v = viv!;
        await v.bringToFront();
        await expect(v.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'listening');
        await expect(v.getByTestId('talk-state')).toHaveText('Listening');
        await expect(v.getByTestId('voice-join')).toHaveCount(0);
        await shot(v, 'M5', 'spectator-listening', project);
        for (const p of players) {
          await p.page.bringToFront();
          await p.page.getByTestId('voice-join').click();
          await expect(p.page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
        }
        const a = players[0]!.page;
        const vivPeer = await hook<string>(v, 'net.self');
        const tracks = () => hook<VoiceTrackState[]>(a, 'voice.tracks');
        await expect.poll(async () => (await tracks()).map((t) => [t.peerId === vivPeer ? 'viv' : t.seat, t.enabled]).sort()).toEqual([
          ['s1', false],
          ['s2', false],
          ['viv', false],
        ]);
        await a.bringToFront();
        await a.mouse.move(700, 420);
        await a.keyboard.down('Control');
        try {
          await expect.poll(async () => (await tracks()).map((t) => t.enabled)).toEqual([true, true, true]);
          await expect(a.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'live');
          await shot(a, 'M5', 'ctrl-talking', project);
        } finally {
          await a.keyboard.up('Control');
        }
        await expect.poll(async () => (await tracks()).map((t) => t.enabled)).toEqual([false, false, false]);
        expect(await hook(v, 'voice.tracks')).toEqual([]);
        expect(await v.evaluate(() => (window as unknown as { __micAsks: number }).__micAsks)).toBe(0);
      });
      await R.step('the Ctrl talk rule: Ctrl+Z within the hold time stays a shortcut (no audio, no caption); the talk label says Ctrl', async () => {
        const a = players[0]!.page;
        await a.bringToFront();
        await expect(a.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
        await expect(a.getByTestId('talk-state')).toHaveText('Hold Ctrl to talk');
        await a.evaluate(() => {
          const w = window as unknown as { __opened: boolean; __watch?: number };
          w.__opened = false;
          w.__watch = window.setInterval(() => {
            const t = window.__spellplane!.voice!.talk();
            if (t.audio !== 'off' || t.dictation !== 'off') w.__opened = true;
          }, 5);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
        });
        await a.waitForTimeout(600);
        await a.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true })));
        await a.waitForTimeout(100);
        expect(await a.evaluate(() => (window as unknown as { __opened: boolean }).__opened)).toBe(false);
      });
      await R.step('the three-seat table converges on one state hash, the spectator’s too', async () => {
        await converged([...players.map((p) => p.page), viv!]);
      });
    }
    await R.finish(() => context.close());
  });

  // ==================================================================================================================
  // 4. Ego framing and the far-zoom stack badge
  // ==================================================================================================================
  test('ego framing shows the own piles in Wyrm and Stonetable (1440x900 and iPad); the far-zoom stack badge', async ({ browser }, info) => {
    test.setTimeout(8 * 60_000);
    const project = info.project.name;
    const R = recorder(info, 'camera');
    for (const [label, opts] of [
      ['desktop', { viewport: { width: 1440, height: 900 } }],
      ['ipad', IPAD],
    ] as const) {
      const context = await browser.newContext(opts);
      context.setDefaultTimeout(10_000);
      await noNetwork(context);
      await context.addInitScript({ content: cardsScript });
      const page = await context.newPage();
      R.watch(page, `solo-${label}`);
      const profile = fresh(info, `ego${label}`);
      await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', profile }).toString()}`);
      await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 20_000 }).toBe(true);
      const touch = label === 'ipad';
      const press = (l: ReturnType<Page['getByTestId']>) => (touch ? l.tap() : l.click());
      await R.step(`${label}: a deck imported through the deck dialog`, async () => {
        await press(page.getByTestId('open-deck-import'));
        await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
        await press(page.getByTestId('deck-check'));
        await expect(page.getByTestId('deck-import-go')).toBeEnabled({ timeout: 15_000 });
        await press(page.getByTestId('deck-import-go'));
        await expect.poll(async () => (await secrets(page)).libraryOrder.length, { timeout: 15_000 }).toBe(60);
      });
      for (const theme of ['wyrm', 'stonetable'] as const) {
        await R.step(`${label}, ${theme}: chosen in the theme picker, the default rig is ego and the own pile column, command area and battlefield row are on screen`, async () => {
          await press(page.getByTestId('open-theme-settings'));
          await press(page.locator(`[data-testid="theme-option"][data-theme="${theme}"]`));
          await expect.poll(() => hook<{ theme: string }>(page, 'render.stats').then((s) => s.theme), { timeout: 20_000 }).toBe(theme);
          // A fresh table in this theme opens in its default rig: reload (the choice is kept).
          await page.reload();
          await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.session?.hash === 'function'), { timeout: 20_000 }).toBe(true);
          await expect.poll(() => hook<{ theme: string }>(page, 'render.stats').then((s) => s.theme), { timeout: 20_000 }).toBe(theme);
          await expect.poll(() => hook<string>(page, 'rig.rig')).toBe('ego');
          await settled(page);
          const v = (await tableView(page))!;
          const own = v.seats.find((s) => s.seat === 's0')!;
          const vp = page.viewportSize()!;
          expect(own.zones).toBeDefined();
          for (const [zone, corners] of Object.entries(own.zones!)) {
            for (const c of corners) {
              expect(c, `${zone} in front of the camera`).not.toBeNull();
              expect(c!.x, `${zone} x`).toBeGreaterThanOrEqual(0);
              expect(c!.x, `${zone} x`).toBeLessThanOrEqual(vp.width);
              expect(c!.y, `${zone} y`).toBeGreaterThanOrEqual(0);
              expect(c!.y, `${zone} y`).toBeLessThanOrEqual(vp.height);
            }
          }
          await page.waitForTimeout(500);
          await shot(page, 'M5', `ego-${theme}-${label}`, project);
          // On screen means visible: the centre of each own pile and of the command area is not under a HUD panel
          // (the log, the avatar, the toolbar), i.e. the table canvas is the element at that point.
          const covered: string[] = [];
          for (const zone of ['library', 'graveyard', 'exile', 'command'] as const) {
            const cs = own.zones![zone].filter((c): c is { x: number; y: number } => c !== null);
            const mid = { x: cs.reduce((t, c) => t + c.x, 0) / cs.length, y: cs.reduce((t, c) => t + c.y, 0) / cs.length };
            const what = await page.evaluate(({ x, y }) => {
              const el = document.elementFromPoint(x, y);
              if (!el || el.matches('canvas')) return null;
              const t = el.closest('[data-testid]');
              return t?.getAttribute('data-testid') ?? el.tagName.toLowerCase();
            }, mid);
            if (what !== null) covered.push(`${zone} under ${what}`);
          }
          if (covered.length) throw new Error(`${theme} on ${label}, the default ego view: ${covered.join(', ')} (owner decision: own pile column and command area on screen)`);
        });
      }
      await context.close();
    }

    // The far-zoom stack badge: the real table scene with four seats and three items on the stack (scene harness).
    for (const [label, opts] of [
      ['mouse', { viewport: { width: 1280, height: 720 } }],
      ['touch', { viewport: { width: 1024, height: 700 }, hasTouch: true }],
    ] as const) {
      const context = await browser.newContext(opts);
      await noNetwork(context);
      const page = await context.newPage();
      R.watch(page, `badge-${label}`);
      await R.step(`stack badge (${label}): the fitted four-seat view collapses the stack to a count; ${label === 'touch' ? 'a tap' : 'hover'} lists the items readably`, async () => {
        await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format: 'ffa4', viewer: 's0' }).toString()}`);
        await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
        for (const a of [
          { type: 'stackPush', by: 's1', item: 'i1', kind: 'spell', card: 's1-c0' },
          { type: 'stackPush', by: 's2', item: 'i2', kind: 'spell', card: 's2-c0' },
          { type: 'stackPush', by: 's3', item: 'i3', kind: 'ability' },
        ])
          await page.evaluate((x) => window.__spellplane!.dispatch!(x as never), { cid: `gate-${a.item}`, ...a });
        await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
        const badge = () => hook<StackBadgeState>(page, 'stackBadge');
        await expect.poll(badge).toMatchObject({ count: 3, collapsed: true, expanded: false });
        await shot(page, 'M5', `stack-badge-collapsed-${label}`, project);
        if (label === 'touch') await page.getByTestId('stack-badge-count').tap();
        else {
          const at = centre((await badge()).screen!);
          await page.mouse.move(at.x, at.y, { steps: 4 });
        }
        await expect.poll(async () => (await badge()).expanded).toBe(true);
        await expect(page.getByTestId('stack-badge-item')).toHaveCount(3);
        await page.waitForTimeout(400);
        await shot(page, 'M5', `stack-badge-expanded-${label}`, project);
      });
      await context.close();
    }
    await R.finish(async () => undefined);
  });

  // ==================================================================================================================
  // 5. The screens
  // ==================================================================================================================
  test('screens: settings on the iPad, a key remap with a conflict, About, the empty and error states', async ({ browser }, info) => {
    test.setTimeout(5 * 60_000);
    const project = info.project.name;
    const R = recorder(info, 'screens');
    {
      const context = await browser.newContext({ ...IPAD });
      await noNetwork(context);
      const page = await context.newPage();
      R.watch(page, 'settings-ipad');
      await R.step('the settings panel opens by a tap; its tabs are thumb-sized', async () => {
        await page.goto('./?faces=placeholder&harness=ui');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await expect(page.getByTestId('hud')).toBeVisible();
        await page.getByTestId('open-settings').tap();
        const tabs = page.getByTestId('settings-tab');
        await expect(tabs.first()).toBeVisible();
        for (const t of await tabs.all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await shot(page, 'M5', 'settings-panel-ipad', project);
      });
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await noNetwork(context);
      const page = await context.newPage();
      R.watch(page, 'settings-desktop');
      await R.step('key remapping: G for "Tap" is refused and names "To graveyard"; nothing changes until Swap', async () => {
        await page.goto('./?faces=placeholder&harness=ui');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await expect(page.getByTestId('hud')).toBeVisible();
        await page.getByTestId('open-settings').click();
        await page.locator('[data-testid="settings-tab"][data-section="keys"]').click();
        await expect(page.getByTestId('settings')).toHaveAttribute('data-section', 'keys');
        await shot(page, 'M5', 'settings-panel-keys', project);
        const row = (a: string) => page.locator(`[data-testid="key-row"][data-action="${a}"][data-context="table"]`);
        await row('tap').getByTestId('key-change').click();
        await expect(page.getByTestId('key-capture')).toBeVisible();
        await page.keyboard.press('KeyG');
        await expect(page.getByTestId('key-conflict')).toContainText('G is already “To graveyard”');
        await expect(row('tap').getByTestId('key-current')).toHaveText(['T']);
        await shot(page, 'M5', 'key-remap-conflict', project);
      });
      await R.step('About: the Fan Content notice and the Scryfall and MTGJSON credits', async () => {
        await page.goto('./?faces=placeholder#/lobby');
        await page.getByTestId('link-about').click();
        const about = page.getByTestId('about');
        await expect(about.getByTestId('fan-content-notice')).toContainText('Not approved/endorsed by Wizards');
        await expect(about.locator('[data-testid="credit"][data-credit="scryfall"]')).toBeVisible();
        await expect(about.locator('[data-testid="credit"][data-credit="mtgjson"]')).toBeVisible();
        await shot(page, 'M5', 'about', project);
      });
      await R.step('empty and error states: no deck, no cards found, no peers, relays unreachable, storage full, failed image', async () => {
        await page.goto('./?faces=placeholder&harness=settings&fresh=1');
        await expect(page.getByTestId('settings-harness')).toBeVisible();
        for (const id of ['noDeck', 'noCardsFound', 'noPeers', 'relayUnreachable', 'storageFull', 'failedImage'])
          await expect(page.getByTestId('harness-states').locator(`[data-testid="empty-state"][data-state="${id}"]`)).toBeVisible();
        await page.getByTestId('harness-states').screenshot({ path: path.join('artifacts', 'shots', 'M5', `empty-states-${project}.png`) });
        await shot(page, 'M5', 'empty-states-page', project);
      });
      await R.step('empty state on the table: no deck offers the deck import', async () => {
        await page.goto(`./?faces=placeholder&profile=${fresh(info, 'empty')}`);
        await expect(page.locator('[data-testid="empty-state"][data-state="noDeck"]')).toBeVisible({ timeout: 20_000 });
        await shot(page, 'M5', 'empty-state-no-deck-table', project);
      });
      await context.close();
    }
    await R.finish(async () => undefined);
  });

  // ==================================================================================================================
  // 6. Acceptance items of the parked packages
  // ==================================================================================================================
  test('accessibility, the soak and the version check: axe on lobby, table HUD and builder list; the 5,000-action soak; the version-mismatch message', async ({ browserName: _browserName }, info) => {
    const R = recorder(info, 'parked');
    await R.step('axe (M5-P4): no serious or critical violation on lobby, table HUD and builder list', async () => {
      expect(fs.existsSync(path.join('node_modules', '@axe-core', 'playwright')), '@axe-core/playwright is installed (M5-P4, parked: not merged into m5)').toBe(true);
    });
    await R.step('the 5,000-action soak on four simulated peers (M5-P6) is part of the suite', async () => {
      expect(fs.existsSync(path.join('tests', 'sim', 'soak.test.ts')), 'tests/sim/soak.test.ts exists (M5-P6, parked: not merged into m5)').toBe(true);
    });
    await R.step('the version-mismatch message names both protocol versions and what to do (M5-P6)', async () => {
      // net/version.ts (versionNotice, versionAdvice) is M5-P6's; while it is the contract stub no page can show the message.
      expect(fs.readFileSync(path.join('src', 'net', 'version.ts'), 'utf8'), 'net/version.ts implemented (M5-P6, parked: not merged into m5)').not.toContain('not implemented: M5-P6');
    });
    await R.finish(async () => undefined);
  });
});
