/**
 * Gate M4-G (docs/PLAN.md, Milestone 4): "the two-player scripted game from M1 runs once per theme with a mid-game
 * theme switch and a perspective switch. Screenshot matrix: four themes × twelve states × both camera rigs, reviewed by
 * the gate verifier against the theme table in the design."
 *
 * 1. The scripted game (one test per theme). The M1 gate's game (tests/e2e/m1.gate.spec.ts: lobby, mulligans, eight
 *    turns with lands, spells through the stack with targets and a counterspell, a hold, a double block, a face-down
 *    card revealed to the opponent only, a dice roll, life to zero, a reload of each page and the sequencer's page
 *    closed and reopened), played with both players in the theme, chosen in the lobby's picker. Ann switches the
 *    perspective (P) to the ego rig before Ben's turn 4 and back after it, and switches her theme mid-game through the
 *    HUD picker (to the next theme after turn 4, back after turn 5), while Ben stays in the game's theme. Both pages
 *    end on the same state hash, a switch never changes the hash, and the shared leak scan (tests/leak/scan.ts) finds
 *    nothing.
 * 2. The screenshot matrix: two players at a networked table, set up through the UI into each of the twelve
 *    functional signals of themes/signals.ts (the "twelve gate states") plus the neutral table; at each state Ann's
 *    page is captured in each of the four themes (picked in the HUD picker) under each camera rig (P).
 * 3. Performance (PLAN M4, Performance): 300 cards in each theme in the render harness, draw calls, texture memory and
 *    the main-thread frame work through `__spellplane.render.stats()`; budgets asserted where the plan sets them, frame
 *    time reported (no timing assertions in browser specs).
 *
 * Engine behaviour is asserted on state hashes and the debug hook, never on pixels; screenshots are review evidence in
 * artifacts/shots/M4/. Steps are recorded: a failed step is listed and the run goes on where it can, so one run shows
 * every gap; a test fails if any step failed or fell back to the debug hook (`gaps`).
 */
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretStore, TableState } from '../../src/core/types';
import type { NetMessageRecord } from '../../src/net/types';
import type { DebugStackEntry } from '../../src/scene/stack';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import { THEME_IDS, THEME_LABELS, type ThemeId } from '../../src/themes/index';
import { scan } from '../leak/scan';
import { hook, shot } from './helpers/app';
import { chair, decklist, freshProfile, freshRoom, open, openTable, setNickname } from './lobby/helpers';
import { openRender, rh, settle as settleRender } from './render/helpers';

/** sid -> name and type line from the recorded fixtures. */
const FIXTURE_CARDS = new Map<string, { name: string; type_line: string }>(
  ['m19.json', 'tm19.json'].flatMap((f) =>
    (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as { id: string; name: string; type_line: string }[]).map((c) => [c.id, { name: c.name, type_line: c.type_line }] as const),
  ),
);

type Seat = 's0' | 's1';
type Rig = 'birdseye' | 'ego';
/** Each theme's default camera (DESIGN "Themes and rendering", theme table: Default camera). */
const DEFAULT_RIG: Record<ThemeId, Rig> = { paper: 'birdseye', dusk: 'birdseye', wyrm: 'ego', stonetable: 'ego' };
interface Player {
  name: string;
  seat: Seat;
  deck: string;
  profile: string;
  page: Page;
  /** Every message this player's pages received, across reloads (debug hook `net.messages()`, direction `in`). */
  received: NetMessageRecord[];
}

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const lane = (page: Page) => hook<DebugStackEntry[]>(page, 'stack');
const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const currentTheme = (page: Page) => hook<ThemeId>(page, 'theme.current');
const rigOf = (page: Page) => hook<Rig>(page, 'rig.rig');
const renderTheme = (page: Page) => hook<{ theme: string }>(page, 'render.stats').then((r) => r.theme);

function firstLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  // Strip ANSI colour codes from Playwright's assertion messages.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ');
}

/** Let the scene and the HUD process input (two animation frames). */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Wait until no card animates and every visible card has a texture. */
async function sceneIdle(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving && (!c.visible || c.tier !== null)), { timeout: 15_000 }).toBe(true);
}

async function neutral(page: Page): Promise<void> {
  await page.mouse.move(720, 330);
  await frames(page);
}

/** Point at a card drawn on the table (centre of its screen rectangle). */
async function hoverTable(page: Page, id: string): Promise<void> {
  await sceneIdle(page);
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c || !c.visible) throw new Error(`card ${id} is not drawn`);
  await page.mouse.move(c.screen.x + c.screen.width / 2, c.screen.y + c.screen.height / 2, { steps: 4 });
  await frames(page);
}

/** Point at a card in the hand fan (low on the card, where no neighbour overlaps it). */
async function hoverHand(page: Page, id: string): Promise<void> {
  const el = page.locator(`[data-testid="hand-card"][data-card="${id}"]`);
  const box = await el.boundingBox({ timeout: 5000 });
  if (!box) throw new Error(`hand card ${id} is not shown`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12, { steps: 4 });
  await expect(el).toHaveClass(/hovered/);
}

async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  await sceneIdle(page);
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c || !c.visible) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

/** A point on a stack entry's visible title strip (the cascade covers the rest of buried items). */
async function stackStrip(page: Page, card: string): Promise<{ x: number; y: number }> {
  await sceneIdle(page);
  const e = (await lane(page)).find((x) => x.face === card);
  if (!e) throw new Error(`stack entry for ${card} is not drawn`);
  // At far zoom the lane is drawn as the count badge (M5 owner decision "Far-zoom stack"): hover it, and the item's
  // title strip in the expanded list is where a line starts or ends.
  const badge = await page.evaluate(() => window.__spellplane!.stackBadge?.() ?? null);
  if (badge?.collapsed && badge.screen) {
    await page.mouse.move(badge.screen.x + badge.screen.width / 2, badge.screen.y + badge.screen.height / 2);
    await expect.poll(() => page.evaluate(() => window.__spellplane!.stackBadge?.()?.expanded ?? false)).toBe(true);
    const row = (await page.locator(`[data-testid="stack-badge-item"][data-item="${e.item}"]`).boundingBox({ timeout: 5000 }))!;
    return { x: row.x + row.width / 2 + 20, y: row.y + 12 };
  }
  const full = e.screen.height / e.scale;
  return { x: e.screen.x + e.screen.width / 2, y: e.screen.y + (full * 9) / 88 };
}

/** Right-drag (DESIGN "Combat and annotation", Connection lines) between two screen points. */
async function rightDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await frames(page);
}

/** Left-drag from a table card's centre to a screen point. */
async function dragTo(page: Page, id: string, to: { x: number; y: number }): Promise<void> {
  const a = await centreOf(page, id);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + to.x) / 2, (a.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await frames(page);
}

/** Name and type of a card as `page` knows it: public identity, own secret, or a targeted reveal it received. */
async function identify(page: Page, id: string): Promise<{ name: string; type_line: string } | null> {
  const [st, sec] = await Promise.all([state(page), secrets(page)]);
  const sid = st.cards[id]?.identity?.sid ?? sec.identities[id]?.card.sid ?? sec.received?.[id]?.card.sid;
  return (sid && FIXTURE_CARDS.get(sid)) || null;
}

async function handWhere(page: Page, pred: (c: { name: string; type_line: string }) => boolean, except: string[] = []): Promise<string | null> {
  const [sec, st] = await Promise.all([secrets(page), state(page)]);
  for (const id of sec.hand) {
    if (except.includes(id) || st.cards[id]?.zone !== `hand:${sec.seat}`) continue;
    const c = await identify(page, id);
    if (c && pred(c)) return id;
  }
  return null;
}

const isLand = (c: { type_line: string }) => c.type_line.includes('Land');
const isCreature = (c: { type_line: string }) => c.type_line.includes('Creature');
const named = (n: string) => (c: { name: string }) => c.name === n;
/** The list with one Pegasus Courser split off as a foil printing (`*F*`); the card count stays the same. */
const withFoil = (list: string): string => {
  const out = list.replace(/^4 Pegasus Courser$/m, '3 Pegasus Courser\n1 Pegasus Courser *F*');
  if (out === list) throw new Error('the matrix decklist has no "4 Pegasus Courser" line to mark foil');
  return out;
};

/** Wait until both pages report the same state hash. */
async function converged(a: Page, b: Page): Promise<string> {
  let h = '';
  await expect
    .poll(
      async () => {
        const [x, y] = await Promise.all([hashOf(a), hashOf(b)]);
        h = x;
        return x === y;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return h;
}

/** Everything a page keeps in its profile's IndexedDB, as JSON (the leak scan's "stores"). */
async function dumpStores(page: Page, profile: string): Promise<unknown> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const out: Record<string, unknown> = {};
    for (const store of Array.from(db.objectStoreNames)) {
      out[store] = await new Promise((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const keys = tx.objectStore(store).getAllKeys();
        const vals = tx.objectStore(store).getAll();
        tx.oncomplete = () => res({ keys: keys.result.map(String), values: JSON.parse(JSON.stringify(vals.result)) as unknown });
        tx.onerror = () => rej(tx.error);
      });
    }
    db.close();
    return out;
  }, `spellplane-${profile}`);
}

/** Pick a theme in the lobby's picker (DESIGN "Themes and rendering": themes are chosen per viewer). */
async function pickLobbyTheme(page: Page, theme: ThemeId): Promise<void> {
  const details = page.getByTestId('lobby-theme');
  await details.locator('summary').click();
  await details.locator(`[data-testid="theme-option"][data-theme="${theme}"] input`).check();
  await expect.poll(() => currentTheme(page), { timeout: 20_000 }).toBe(theme);
  await expect(details).toContainText(`Theme: ${THEME_LABELS[theme]}`);
  await details.locator('summary').click();
}

/** Pick a theme in the HUD's picker mid-game; resolves once the scene drew in it. */
async function pickHudTheme(page: Page, theme: ThemeId): Promise<void> {
  const picker = page.getByTestId('theme-settings');
  if (!(await picker.isVisible())) await page.getByTestId('open-theme-settings').click();
  await expect(picker).toBeVisible();
  await picker.locator(`[data-testid="theme-option"][data-theme="${theme}"] input`).check();
  await expect.poll(() => currentTheme(page), { timeout: 20_000 }).toBe(theme);
  await expect.poll(() => renderTheme(page), { timeout: 20_000 }).toBe(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByTestId('theme-close').click();
  await expect(picker).toHaveCount(0);
  await frames(page);
}

/** Switch the camera rig with the design's key (P) and wait until the debug hook reports `want`. */
async function pressPerspective(page: Page, want: Rig, at: { x: number; y: number }, timeout = 5000): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await frames(page);
  await page.keyboard.press('KeyP');
  await expect.poll(() => rigOf(page), { timeout, message: `P switches the camera to the ${want} rig (debug hook rig.rig())` }).toBe(want);
  await expect.poll(async () => (await hook<{ rig: string }>(page, 'camera')).rig, { timeout }).toBe(want);
  await expect.poll(() => hook<unknown>(page, 'rig.blend'), { timeout: 5000 }).toBeNull();
}

/**
 * WebKit only: `getUserMedia` answers with a silent Web Audio stream, so "Join voice" never reaches the real
 * microphone (which would show the macOS prompt; CLAUDE.md, pw-guard exit code 3). Same as the M3 gate.
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
    } catch (e) {}
  }
})();`;

/** Recorded steps: a failure is listed and the run goes on where it can. */
function recorder() {
  const failures: string[] = [];
  /** Steps the UI cannot reach yet, driven through the debug hook instead (each one is a gap). */
  const gaps: string[] = [];
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
  return { failures, gaps, step, soft };
}

/** Page errors, console errors and requests that leave the test server, per page. */
function watcher() {
  const errors: string[] = [];
  const outside: string[] = [];
  const watch = (page: Page, who: string) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${who} (console): ${m.text()}`);
    });
    page.on('request', (r) => {
      if (!/^(data|blob):/.test(r.url()) && !new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(r.url());
    });
  };
  return { errors, outside, watch };
}

function writeReport(info: TestInfo, name: string, body: unknown): void {
  fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
  fs.writeFileSync(path.join('artifacts', 'gate', `M4-${name}-${info.project.name}.json`), JSON.stringify(body, null, 2));
}

test.describe('M4 gate @gate', () => {
  // A missing element fails its step instead of waiting out the whole game.
  test.use({ actionTimeout: 10_000 });

  // ------------------------------------------------------------------------------------------------------------------
  // 1. The M1 scripted game, once per theme, with a perspective switch and a mid-game theme switch.
  // ------------------------------------------------------------------------------------------------------------------
  for (const [ti, theme] of THEME_IDS.entries()) {
    const next = THEME_IDS[(ti + 1) % THEME_IDS.length]!;
    test(`${THEME_LABELS[theme]}: the scripted 1v1 game with a perspective switch and a mid-game switch to ${THEME_LABELS[next]} ends on one state hash, leak scan clean`, async ({ browser }, info) => {
      test.setTimeout(900_000);
      await scriptedGame(browser, info, theme, next);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------
  // 2. The screenshot matrix.
  // ------------------------------------------------------------------------------------------------------------------
  test('screenshot matrix: four themes × twelve gate states × both camera rigs, set up through the UI', async ({ browser, browserName }, info) => {
    test.setTimeout(1_500_000);
    await matrix(browser, browserName, info);
  });

  // ------------------------------------------------------------------------------------------------------------------
  // 3. Performance with 300 cards per theme.
  // ------------------------------------------------------------------------------------------------------------------
  test('performance: 300 cards in each theme (draw calls, texture memory; main-thread frame work reported)', async ({ page }, info) => {
    test.setTimeout(300_000);
    type Stats = { drawCalls: number; textureBytes: number; frameMs: number; textures: number; passes: string[]; shadows: boolean; theme: string };
    // PLAN M4 Performance: at most 20 draw calls in Paper and 60 in Stonetable. The plan sets no number for Dusk and
    // Wyrm; they are lit themes like Stonetable, so they get its budget.
    const budget: Record<ThemeId, number> = { paper: 20, dusk: 60, wyrm: 60, stonetable: 60 };
    const report: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const theme of THEME_IDS) {
      const errors = await openRender(page, { theme, scenario: 'bench' });
      await settleRender(page);
      const drawn = (await rh<unknown[]>(page, 'cards')).length;
      // Both camera rigs: the theme's default first (bird's-eye in Paper and Dusk, ego in Wyrm and Stonetable).
      const first = await page.evaluate(() => window.__renderHarness!.camera.rig());
      for (const rig of [first, first === 'birdseye' ? 'ego' : 'birdseye'] as const) {
        if ((await page.evaluate(() => window.__renderHarness!.camera.rig())) !== rig) {
          await page.evaluate((r) => window.__renderHarness!.camera.setRig(r, { animate: false }), rig);
          await page.evaluate(() => window.__renderHarness!.camera.fit(false));
          await settleRender(page);
        }
        const samples: Stats[] = [];
        const vp = page.viewportSize()!;
        for (const factor of [1, 2.5, 6]) {
          if (factor !== 1) await page.evaluate(([x, y, f]) => window.__renderHarness!.camera.zoomAt(x!, y!, f!), [vp.width / 2, vp.height * 0.7, factor] as const);
          await settleRender(page);
          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.__renderHarness!.camera.panBy(1, 0));
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            samples.push((await page.evaluate(() => window.__spellplane!.render!.stats())) as Stats);
          }
        }
        const maxCalls = Math.max(...samples.map((s) => s.drawCalls));
        const maxBytes = Math.max(...samples.map((s) => s.textureBytes));
        const ms = samples.map((s) => s.frameMs).sort((a, b) => a - b);
        const median = ms[Math.floor(ms.length / 2)]!;
        const row = {
          cards: drawn,
          drawCallsMax: maxCalls,
          drawCallBudget: budget[theme],
          textureMB: Number((maxBytes / 2 ** 20).toFixed(1)),
          textures: Math.max(...samples.map((s) => s.textures)),
          frameCpuMedianMs: Number(median.toFixed(2)),
          frameCpuMaxMs: Number(ms.at(-1)!.toFixed(2)),
          passes: samples[0]!.passes,
          shadows: samples[0]!.shadows,
          rig,
        };
        report[`${theme}/${rig}`] = row;
        const line = `${theme}/${rig}/${info.project.name}: ${drawn} cards, draw calls ≤ ${maxCalls} (budget ${budget[theme]}), texture memory ${row.textureMB} MB, frame CPU median ${row.frameCpuMedianMs} ms (max ${row.frameCpuMaxMs} ms), passes [${row.passes.join(', ')}], shadows ${row.shadows}`;
        info.annotations.push({ type: 'perf', description: line });
        console.log(`[perf] ${line}`);
        if (samples[0]!.theme !== theme) problems.push(`${theme}: render stats name ${samples[0]!.theme}`);
        if (maxCalls > budget[theme]) problems.push(`${theme} ${rig}: ${maxCalls} draw calls > ${budget[theme]}`);
        if (maxBytes >= 400 * 2 ** 20) problems.push(`${theme} ${rig}: texture memory ${row.textureMB} MB ≥ 400 MB`);
      }
      if (drawn < 300) problems.push(`${theme}: only ${drawn} cards drawn`);
      if (errors.length) problems.push(`${theme}: page errors ${JSON.stringify(errors.slice(0, 3))}`);
    }
    writeReport(info, 'perf', report);
    expect(problems).toEqual([]);
  });
});

// ======================================================================================================================
// The scripted game (M1 gate steps, docs/PLAN.md M1-G), in one theme.
// ======================================================================================================================

async function scriptedGame(browser: Browser, info: TestInfo, theme: ThemeId, next: ThemeId): Promise<void> {
  const project = info.project.name;
  const { failures, gaps, step, soft } = recorder();
  const { errors, outside, watch } = watcher();
  const name = (s: string) => `game-${theme}-${s}`;

  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10_000);
  const newPage = async (who: string) => {
    const p = await context.newPage();
    watch(p, who);
    return p;
  };
  const room = freshRoom();
  const A: Player = { name: 'Ann', seat: 's0', deck: 'gw-m19-60.txt', profile: freshProfile(info, `a4${theme.slice(0, 3)}`), page: await newPage('Ann'), received: [] };
  const B: Player = { name: 'Ben', seat: 's1', deck: 'ur-m19-60.mtga.txt', profile: freshProfile(info, `b4${theme.slice(0, 3)}`), page: await newPage('Ben'), received: [] };
  const other = (p: Player) => (p === A ? B : A);
  const both = [A, B];
  /** The theme each player's page should show now. */
  const shows: Record<Seat, ThemeId> = { s0: theme, s1: theme };

  const hasNet = (page: Page) => page.evaluate(() => typeof (window.__spellplane as { net?: { messages?: unknown } } | undefined)?.net?.messages === 'function');
  const collect = async (p: Player) => {
    if (!(await hasNet(p.page).catch(() => false))) return;
    const msgs = await hook<NetMessageRecord[]>(p.page, 'net.messages');
    p.received.push(...msgs.filter((m) => m.dir === 'in'));
    await hook(p.page, 'net.clearMessages');
  };
  const waitHud = async (p: Player) => {
    await expect(p.page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => p.page.evaluate(() => typeof (window.__spellplane as { session?: { hash?: unknown } } | undefined)?.session?.hash === 'function'), { timeout: 15_000 }).toBe(true);
  };
  const focus = async (p: Player) => {
    await p.page.bringToFront();
    await neutral(p.page);
  };
  /** Each page shows the theme its player chose (theme debug part, scene render stats). */
  const themesHeld = async () => {
    for (const p of both) {
      await expect.poll(() => currentTheme(p.page), { timeout: 20_000 }).toBe(shows[p.seat]);
      await expect.poll(() => renderTheme(p.page), { timeout: 20_000 }).toBe(shows[p.seat]);
    }
  };

  // --------------------------------------------------------------------------------------------------------------
  // Lobby: both open the link, choose nicknames and the theme, Ready with a fixture deck; the host starts.
  // --------------------------------------------------------------------------------------------------------------
  const lobbyOk = await step(`lobby: both join, pick ${THEME_LABELS[theme]} in the lobby's theme picker, take chairs and press Ready`, async () => {
    await openTable(A.page, room, A.profile);
    await setNickname(A.page, A.name);
    await openTable(B.page, room, B.profile);
    await setNickname(B.page, B.name);
    await expect(chair(A.page, 's1')).toContainText(B.name);
    await expect(chair(B.page, 's0')).toContainText(A.name);
    for (const p of both) await pickLobbyTheme(p.page, theme);
    for (const p of both) {
      await p.page.getByTestId('lobby-deck-text').fill(decklist(p.deck));
      await p.page.getByTestId('lobby-deck-check').click();
      await expect(p.page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
      await p.page.getByTestId('ready').click();
      await expect(p.page.getByTestId('ready-done')).toContainText('60 cards is committed');
    }
    await expect(A.page.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
    await shot(A.page, 'M4', name('lobby'), project);
    await A.page.getByTestId('start-game').click();
    for (const p of both) await waitHud(p);
    await themesHeld();
  });
  if (!lobbyOk) {
    await context.close();
    expect(failures).toEqual([]);
    return;
  }

  let sequencer: Player = A;
  await step('the networked session is wired: a sequencer is elected', async () => {
    for (const p of both) expect(await hasNet(p.page)).toBe(true);
    const [seqA, seqB, selfA] = await Promise.all([hook<string>(A.page, 'net.sequencer'), hook<string>(B.page, 'net.sequencer'), hook<string>(A.page, 'net.self')]);
    expect(seqA).not.toBe('');
    expect(seqA).toBe(seqB);
    sequencer = seqA === selfA ? A : B;
  });

  for (const p of both) {
    await step(`${p.name} shuffles (S) and draws seven (Shift+D)`, async () => {
      await focus(p);
      const before = (await secrets(p.page)).libraryOrder;
      expect(before).toHaveLength(60);
      await p.page.keyboard.press('KeyS');
      await expect.poll(async () => (await secrets(p.page)).libraryOrder).not.toEqual(before);
      await p.page.keyboard.press('Shift+KeyD');
      await expect(p.page.getByTestId('draw-n-input')).toBeFocused();
      await p.page.getByTestId('draw-n-input').fill('7');
      await p.page.keyboard.press('Enter');
      await expect.poll(async () => (await secrets(p.page)).hand).toHaveLength(7);
      await expect.poll(async () => (await state(other(p).page)).zones[`hand:${p.seat}`]?.ids.length).toBe(7);
    });
  }

  await step('opponent view: Ann\'s hand shows as seven backs at the far side of Ben\'s table', async () => {
    await focus(B);
    const hand = (await secrets(A.page)).hand;
    await expect.poll(async () => (await shown(B.page)).filter((c) => hand.includes(c.id) && c.visible && c.shows === 'back').length).toBe(7);
    const st = await state(B.page);
    for (const id of hand) expect(st.cards[id]?.identity).toBeUndefined();
    await sceneIdle(B.page);
    await shot(B.page, 'M4', name('opponent-view'), project);
  });

  for (const p of both) {
    await step(`${p.name} mulligans (Ctrl+M) and bottoms one card (Shift+L)`, async () => {
      await focus(p);
      const first = (await secrets(p.page)).hand;
      await p.page.keyboard.press('Control+KeyM');
      await expect.poll(async () => (await secrets(p.page)).hand).not.toEqual(first);
      let hand = (await secrets(p.page)).hand;
      expect(hand).toHaveLength(7);
      const bottom = hand[hand.length - 1]!;
      await hoverHand(p.page, bottom);
      await p.page.keyboard.press('Shift+KeyL');
      await expect.poll(async () => (await secrets(p.page)).libraryOrder.at(-1)).toBe(bottom);
      hand = (await secrets(p.page)).hand;
      expect(hand).toHaveLength(6);
      await expect.poll(async () => (await state(other(p).page)).zones[`hand:${p.seat}`]?.ids.length).toBe(6);
    });
  }

  // Turn helpers (as in the M1 gate).
  const tutor = async (p: Player, pred: (c: { name: string; type_line: string }) => boolean, what: string): Promise<string> => {
    const have = await handWhere(p.page, pred);
    if (have) return have;
    return tutorFromLibrary(p.page, p.seat, pred, what);
  };

  const landsPlayed = { s0: 0, s1: 0 } as Record<Seat, number>;
  const playLand = async (p: Player) => {
    const page = p.page;
    const land = await tutor(p, isLand, 'land');
    await focus(p);
    const vp = page.viewportSize()!;
    const k = landsPlayed[p.seat]++;
    await dragFromHand(page, land, { x: vp.width * (0.22 + 0.045 * k), y: vp.height * 0.66 });
    await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`battlefield:${p.seat}`);
    const ref = (await secrets(page)).identities[land]!.card;
    await soft(`${p.name}'s land is revealed to the other page as it enters the battlefield`, async () => {
      await expect.poll(async () => (await state(other(p).page)).cards[land]?.identity).toEqual(ref);
    });
  };

  const untapAndDraw = async (p: Player) => {
    await focus(p);
    await expect(p.page.getByTestId('untap-offer')).toBeVisible();
    const n = (await secrets(p.page)).hand.length;
    await p.page.keyboard.press('KeyU');
    await expect.poll(async () => (await secrets(p.page)).hand.length).toBe(n + 1);
    await expect(p.page.getByTestId('untap-offer')).toHaveCount(0);
  };

  const passTurn = async (p: Player, number: number) => {
    await focus(p);
    await p.page.keyboard.press('Control+Enter');
    for (const q of both) await expect.poll(async () => (await state(q.page)).turn).toMatchObject({ number, active: other(p).seat });
  };

  const cast = async (p: Player, id: string) => {
    await focus(p);
    await hoverHand(p.page, id);
    await p.page.keyboard.press('KeyC');
    const ref = (await secrets(p.page)).identities[id]!.card;
    for (const q of both) await expect.poll(async () => (await state(q.page)).stack.at(-1)?.card).toBe(id);
    await soft(`${p.name}'s cast spell becomes public on both pages`, async () => {
      for (const q of both) await expect.poll(async () => (await state(q.page)).cards[id]?.identity).toEqual(ref);
    });
    await expect.poll(async () => (await state(p.page)).confirm?.about).toBe((await state(p.page)).stack.at(-1)!.id);
  };

  const ok = async (p: Player) => {
    await focus(p);
    await expect(p.page.getByTestId('confirm-prompt')).toBeVisible();
    await p.page.keyboard.press('Enter');
    await expect.poll(async () => (await state(p.page)).confirm?.responses[p.seat] ?? 'ok').toBe('ok');
  };

  const resolveTop = async (p: Player) => {
    await focus(p);
    const top = (await state(p.page)).stack.at(-1)!;
    await p.page.keyboard.press('KeyR');
    for (const q of both) await expect.poll(async () => (await state(q.page)).stack.some((i) => i.id === top.id)).toBe(false);
  };

  const castCreature = async (p: Player, pred: (c: { name: string; type_line: string }) => boolean, what: string): Promise<string> => {
    const id = await tutor(p, pred, what);
    await cast(p, id);
    await ok(other(p));
    await resolveTop(p);
    await expect.poll(async () => (await state(other(p).page)).cards[id]?.zone).toBe(`battlefield:${p.seat}`);
    return id;
  };

  const turn = async (n: number, p: Player, body: () => Promise<void>) => {
    await step(`turn ${n} (${p.name})`, async () => {
      if (n > 1) await untapAndDraw(p);
      await playLand(p);
    });
    await body();
    await step(`turn ${n}: both pages on the same state hash`, async () => {
      await converged(A.page, B.page);
    });
    if (n < 8) await step(`turn ${n}: ${p.name} passes the turn (Ctrl+Enter)`, () => passTurn(p, n + 1));
  };

  const creatures: Record<Seat, string[]> = { s0: [], s1: [] };

  const reload = async (p: Player) => {
    await step(`${p.name} reloads the page and rejoins the same seat with the same hand, in the theme they chose`, async () => {
      await collect(p);
      const before = await secrets(p.page);
      await p.page.reload();
      await waitHud(p);
      await expect.poll(async () => (await secrets(p.page)).seat).toBe(p.seat);
      await expect.poll(async () => (await secrets(p.page)).hand).toEqual(before.hand);
      expect((await secrets(p.page)).libraryOrder).toEqual(before.libraryOrder);
      await converged(A.page, B.page);
      await themesHeld();
    });
  };

  /** A switch of Ann's theme through the HUD picker: per viewer, the hash and Ben's page do not move. */
  const switchTheme = async (to: ThemeId, why: string) => {
    await step(`${why}: Ann switches her theme to ${THEME_LABELS[to]} in the HUD picker; the table and Ben's page stay as they are`, async () => {
      await focus(A);
      const h = await converged(A.page, B.page);
      const cardsBefore = (await shown(A.page)).filter((c) => c.visible).map((c) => c.id).sort();
      await pickHudTheme(A.page, to);
      shows.s0 = to;
      await themesHeld();
      expect(await hashOf(A.page)).toBe(h);
      expect(await hashOf(B.page)).toBe(h);
      await sceneIdle(A.page);
      expect((await shown(A.page)).filter((c) => c.visible).map((c) => c.id).sort()).toEqual(cardsBefore);
      await shot(A.page, 'M4', name(`switched-to-${to}`), project);
    });
  };

  await step('turn 1 starts with Ann active', async () => {
    for (const q of both) expect((await state(q.page)).turn).toMatchObject({ number: 1, active: 's0' });
  });
  await turn(1, A, async () => undefined);
  await turn(2, B, async () => undefined);

  await turn(3, A, async () => {
    await step('turn 3: Ann casts a creature; Ben sees the confirmation prompt, passes with OK; Ann resolves it', async () => {
      const id = await tutor(A, (c) => isCreature(c) && !isLand(c), 'creature');
      await cast(A, id);
      await focus(B);
      await expect(B.page.getByTestId('confirm-prompt')).toBeVisible();
      await sceneIdle(B.page);
      await shot(B.page, 'M4', name('confirmation-prompt'), project);
      await ok(B);
      await resolveTop(A);
      await expect.poll(async () => (await state(B.page)).cards[id]?.zone).toBe('battlefield:s0');
      creatures.s0.push(id);
    });
  });

  // Perspective switch: Ann's page opens in the theme's default rig (bird's-eye in Paper and Dusk, ego in Wyrm and
  // Stonetable; DESIGN "Themes and rendering", Default camera); she watches Ben's turn 4 from the other rig.
  const homeRig: Rig = DEFAULT_RIG[theme];
  const awayRig: Rig = homeRig === 'birdseye' ? 'ego' : 'birdseye';
  const egoOk = await step(`perspective: Ann's page opens in the ${homeRig} rig; she presses P over her creature; the camera blends to the ${awayRig} rig and the table does not change`, async () => {
    await focus(A);
    const h = await converged(A.page, B.page);
    expect(await rigOf(A.page)).toBe(homeRig);
    await pressPerspective(A.page, awayRig, await centreOf(A.page, creatures.s0[0]!));
    expect(await hashOf(A.page)).toBe(h);
    await sceneIdle(A.page);
    await shot(A.page, 'M4', name(awayRig), project);
  });

  await turn(4, B, async () => {
    await step('turn 4: Ben casts Hostile Minotaur and resolves it', async () => {
      creatures.s1.push(await castCreature(B, named('Hostile Minotaur'), 'Hostile Minotaur'));
    });
    await step('turn 4: Ben rolls a die (Ctrl+I); both pages see the same result', async () => {
      await focus(B);
      const before = Object.keys((await state(B.page)).rng);
      await B.page.keyboard.press('Control+KeyI');
      let rid = '';
      await expect
        .poll(async () => {
          const st = await state(B.page);
          rid = Object.keys(st.rng).find((k) => !before.includes(k)) ?? '';
          return rid ? st.rng[rid]!.result : null;
        })
        .not.toBeNull();
      const [ra, rb] = [(await state(A.page)).rng[rid], (await state(B.page)).rng[rid]];
      expect(ra?.result).toBe(rb?.result);
    });
    await step(`turn 4: Ann's ${awayRig} view shows Ben's creature (debug hook), still in that rig`, async () => {
      if (!egoOk) return; // already recorded by the switch step
      await focus(A);
      expect(await rigOf(A.page)).toBe(awayRig);
      await sceneIdle(A.page);
      const c = (await shown(A.page)).find((x) => x.id === creatures.s1[0]);
      expect(c?.visible).toBe(true);
      await shot(A.page, 'M4', name(`${awayRig}-opponent-creature`), project);
    });
  });

  await step(`perspective: Ann presses P again; back to the ${homeRig} rig, the table unchanged`, async () => {
    await focus(A);
    const h = await converged(A.page, B.page);
    if (egoOk) await pressPerspective(A.page, homeRig, await centreOf(A.page, creatures.s0[0]!));
    expect(await rigOf(A.page)).toBe(homeRig);
    expect(await hashOf(A.page)).toBe(h);
  });

  await switchTheme(next, 'after turn 4');

  await turn(5, A, async () => {
    await step('turn 5: Ann casts a second creature and resolves it', async () => {
      creatures.s0.push(await castCreature(A, (c) => isCreature(c) && !isLand(c), 'creature'));
    });
    let spell = '';
    let scatter = '';
    let growth = '';
    await step('turn 5: Ann casts a creature; Ben holds (H) in response', async () => {
      spell = await tutor(A, (c) => isCreature(c) && !isLand(c), 'creature');
      await cast(A, spell);
      await focus(B);
      await expect(B.page.getByTestId('confirm-prompt')).toBeVisible();
      await B.page.keyboard.press('KeyH');
      for (const q of both) await expect.poll(async () => (await state(q.page)).confirm?.holder).toBe('s1');
    });
    await step('turn 5: Ben casts Essence Scatter and right-drags a target line to Ann\'s creature spell', async () => {
      scatter = await tutor(B, named('Essence Scatter'), 'Essence Scatter');
      await cast(B, scatter);
      await rightDrag(B.page, await stackStrip(B.page, scatter), await stackStrip(B.page, spell));
      const item = (await state(A.page)).stack.find((i) => i.card === scatter)!;
      await expect.poll(async () => Object.values((await state(A.page)).lines).filter((l) => l.kind === 'target' && l.from.kind === 'stackItem' && l.from.id === item.id).length).toBe(1);
    });
    await step('turn 5: Ann holds and responds with Titanic Growth targeting her first creature: three items, two targets', async () => {
      await focus(A);
      await expect(A.page.getByTestId('confirm-prompt')).toBeVisible();
      await A.page.keyboard.press('KeyH');
      await expect.poll(async () => (await state(B.page)).confirm?.holder).toBe('s0');
      growth = await tutor(A, named('Titanic Growth'), 'Titanic Growth');
      await cast(A, growth);
      await rightDrag(A.page, await stackStrip(A.page, growth), await centreOf(A.page, creatures.s0[0]!));
      for (const q of both) {
        await expect.poll(async () => (await state(q.page)).stack.map((i) => i.card)).toEqual([spell, scatter, growth]);
        await expect.poll(async () => Object.values((await state(q.page)).lines).filter((l) => l.kind === 'target').length).toBe(2);
      }
      await focus(A);
      await A.page.mouse.move(1000, 160);
      await sceneIdle(A.page);
      await shot(A.page, 'M4', name(`stack-three-items-in-${next}`), project);
      await focus(B);
      await B.page.mouse.move(1000, 160);
      await sceneIdle(B.page);
      await shot(B.page, 'M4', name('stack-three-items'), project);
    });
    await step('turn 5: Titanic Growth and Essence Scatter resolve; the creature spell is countered (Shift+R)', async () => {
      await ok(B);
      await resolveTop(A);
      await expect.poll(async () => (await state(B.page)).cards[growth]?.zone).toBe('graveyard:s0');
      await resolveTop(B);
      await expect.poll(async () => (await state(A.page)).cards[scatter]?.zone).toBe('graveyard:s1');
      await focus(B);
      await B.page.keyboard.press('Shift+KeyR');
      for (const q of both) {
        await expect.poll(async () => (await state(q.page)).cards[spell]?.zone).toBe('graveyard:s0');
        await expect.poll(async () => (await state(q.page)).stack).toEqual([]);
        expect(Object.values((await state(q.page)).lines).filter((l) => l.kind === 'target')).toEqual([]);
      }
    });
  });

  await switchTheme(theme, 'after turn 5');

  await turn(6, B, async () => {
    await step('turn 6: Ben attacks (A); Ann double-blocks by dragging two creatures onto the attacker', async () => {
      const attacker = creatures.s1[0]!;
      await focus(B);
      await hoverTable(B.page, attacker);
      await B.page.keyboard.press('KeyA');
      for (const q of both) await expect.poll(async () => (await state(q.page)).cards[attacker]).toMatchObject({ combat: 'attack', tapped: true });
      await focus(A);
      await dragTo(A.page, creatures.s0[0]!, await centreOf(A.page, attacker));
      await expect.poll(async () => (await state(A.page)).cards[creatures.s0[0]!]?.combat).toBe('block');
      const at2 = await centreOf(A.page, attacker);
      await dragTo(A.page, creatures.s0[1]!, { x: at2.x + 12, y: at2.y });
      for (const q of both) {
        await expect.poll(async () => (await state(q.page)).cards[creatures.s0[1]!]?.combat).toBe('block');
        await expect.poll(async () => Object.values((await state(q.page)).lines).filter((l) => l.kind === 'block' && l.to.kind === 'card' && l.to.id === attacker).length).toBe(2);
      }
      await A.page.mouse.move(1000, 160);
      await sceneIdle(A.page);
      await shot(A.page, 'M4', name('combat-blocks'), project);
    });
    await step('turn 6: the Minotaur dies (G); Ann settles (B): blockers home, block lines gone', async () => {
      const attacker = creatures.s1[0]!;
      await focus(B);
      await hoverTable(B.page, attacker);
      await B.page.keyboard.press('KeyG');
      await expect.poll(async () => (await state(A.page)).cards[attacker]?.zone).toBe('graveyard:s1');
      await focus(A);
      await A.page.keyboard.press('KeyB');
      for (const q of both) {
        await expect.poll(async () => Object.values((await state(q.page)).cards).filter((c) => c.home !== undefined).length).toBe(0);
        expect(Object.values((await state(q.page)).lines).filter((l) => l.kind === 'block' || l.kind === 'attack')).toEqual([]);
      }
    });
  });
  await reload(A);

  await turn(7, A, async () => {
    let hidden = '';
    await step('turn 7: Ann puts a hand card onto the battlefield face down (F on the hovered hand card)', async () => {
      hidden = (await handWhere(A.page, (c) => !isLand(c))) ?? (await secrets(A.page)).hand[0]!;
      await focus(A);
      await hoverHand(A.page, hidden);
      await A.page.keyboard.press('KeyF');
      for (const q of both) await expect.poll(async () => (await state(q.page)).cards[hidden]).toMatchObject({ zone: 'battlefield:s0', face: 'down' });
      expect((await state(B.page)).cards[hidden]?.identity).toBeUndefined();
    });
    await step('turn 7: Ann reveals the face-down card to Ben only (W, then Ben in the menu)', async () => {
      await focus(A);
      await hoverTable(A.page, hidden);
      await A.page.keyboard.press('KeyW');
      await expect(A.page.getByTestId('reveal-to')).toBeVisible();
      await A.page.locator('[data-testid="reveal-to"] button[data-seat="s1"]').click();
      const ref = (await secrets(A.page)).identities[hidden]!.card;
      await expect.poll(async () => (await secrets(B.page)).received?.[hidden]?.card).toEqual(ref);
      for (const q of both) expect((await state(q.page)).cards[hidden]).toMatchObject({ face: 'down' });
      for (const q of both) expect((await state(q.page)).cards[hidden]?.identity).toBeUndefined();
    });
  });
  await reload(B);

  await turn(8, B, async () => {
    await step('turn 8: Ben casts Shock at Ann (right-drag to her avatar); it resolves; Ann takes 2 (− twice)', async () => {
      const shock = await tutor(B, named('Shock'), 'Shock');
      await cast(B, shock);
      const av = (await B.page.locator('[data-testid="avatar"][data-seat="s0"]').boundingBox({ timeout: 5000 }))!;
      await rightDrag(B.page, await stackStrip(B.page, shock), { x: av.x + av.width / 2, y: av.y + av.height / 2 });
      await expect.poll(async () => Object.values((await state(A.page)).lines).filter((l) => l.kind === 'target' && l.to.kind === 'seat' && l.to.id === 's0').length).toBe(1);
      await ok(A);
      await resolveTop(B);
      await focus(A);
      const minus = A.page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="life-minus"]');
      await minus.click();
      await minus.click();
      for (const q of both) await expect.poll(async () => (await state(q.page)).seats.s0?.life).toBe(18);
    });
    let closedHand: string[] | null = null;
    await step('turn 8: the sequencer\'s page closes: the other page marks its seat away', async () => {
      await collect(sequencer);
      closedHand = (await secrets(sequencer.page)).hand;
      const stay = other(sequencer);
      await sequencer.page.close();
      await expect.poll(async () => (await state(stay.page)).seats[sequencer.seat]?.away, { timeout: 15_000 }).toBe(true);
      await expect(stay.page.locator(`[data-testid="avatar"][data-seat="${sequencer.seat}"]`)).toHaveAttribute('data-away', 'true');
      await focus(stay);
      await sceneIdle(stay.page);
      await shot(stay.page, 'M4', name('away-seat'), project);
    });
    await step('turn 8: the sequencer\'s page reopens and rejoins its seat with the same hand, in its theme', async () => {
      if (!sequencer.page.isClosed()) {
        await collect(sequencer).catch(() => undefined);
        await sequencer.page.close();
      }
      sequencer.page = await newPage(`${sequencer.name} (reopened)`);
      await openTable(sequencer.page, room, sequencer.profile).catch(() => undefined);
      await waitHud(sequencer);
      await expect.poll(async () => (await secrets(sequencer.page)).seat).toBe(sequencer.seat);
      if (closedHand) await expect.poll(async () => (await secrets(sequencer.page)).hand).toEqual(closedHand);
      await expect.poll(async () => (await state(other(sequencer).page)).seats[sequencer.seat]?.away ?? false).toBe(false);
      await converged(A.page, B.page);
      await themesHeld();
    });
    await step('turn 8: Ann\'s life is set to 0 (double-click, type 0, Enter); both pages agree', async () => {
      await focus(A);
      await A.page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="life"]').dblclick();
      const input = A.page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="life-input"]');
      await input.fill('0');
      await input.press('Enter');
      for (const q of both) await expect.poll(async () => (await state(q.page)).seats.s0?.life).toBe(0);
    });
  });

  await step('both pages end on the same state hash', async () => {
    const h = await converged(A.page, B.page);
    expect(h).toMatch(/^[0-9a-f]{64}$|^[A-Za-z0-9_-]{43}$/);
    expect(await state(A.page)).toEqual(await state(B.page));
    await focus(A);
    await sceneIdle(A.page);
    await shot(A.page, 'M4', name('end'), project);
  });

  for (const viewer of both) {
    const owner = other(viewer);
    await step(`leak scan: nothing ${viewer.name}'s page received, holds or stores names a card that stayed in ${owner.name}'s hand or library`, async () => {
      await collect(viewer);
      const [ownerSecrets, ownerState, viewerState, viewerSecrets] = await Promise.all([secrets(owner.page), state(owner.page), state(viewer.page), secrets(viewer.page)]);
      const publicSids = new Set<string>();
      for (const c of Object.values(ownerState.cards)) if (c.identity) publicSids.add(c.identity.sid);
      for (const r of Object.values(viewerSecrets.received ?? {})) publicSids.add(r.card.sid);
      const hidden = [...ownerSecrets.hand, ...ownerSecrets.libraryOrder];
      expect(hidden.length).toBeGreaterThan(30);
      const forbidden: string[] = [];
      for (const id of hidden) {
        const s = ownerSecrets.identities[id]!;
        forbidden.push(s.salt);
        if (!publicSids.has(s.card.sid)) forbidden.push(s.card.sid);
      }
      expect(viewer.received.length).toBeGreaterThan(0);
      const stores = await dumpStores(viewer.page, viewer.profile);
      const hits = scan([viewer.received, viewerState, viewerSecrets, stores], forbidden);
      expect(hits.slice(0, 10)).toEqual([]);
    });
  }

  await step('no page or console error and no request leaves the test server', async () => {
    if (errors.length || outside.length) throw new Error(`errors: ${JSON.stringify(errors.slice(0, 8))}; outside requests: ${JSON.stringify(outside.slice(0, 8))}`);
  });

  await info.attach(`gate-gaps-${theme}.json`, { body: JSON.stringify({ failures, gaps }, null, 2), contentType: 'application/json' });
  writeReport(info, `game-${theme}`, { failures, gaps });
  await context.close();
  expect([...failures, ...gaps.map((g) => `gap: ${g}`)]).toEqual([]);
}

/** Search a player's library through the avatar's library button (Search) and put a matching card into the hand (H). */
async function tutorFromLibrary(
  page: Page,
  seat: string,
  pred: (c: { name: string; type_line: string }) => boolean,
  what: string,
  except: string[] = [],
  byId: (id: string) => boolean = () => true,
): Promise<string> {
  await page.bringToFront();
  await page.locator(`[data-testid="avatar"][data-seat="${seat}"] [data-testid="zone-button"][data-zone="library:${seat}"]`).click();
  await expect(page.getByTestId('pile-viewer')).toBeVisible();
  await page.getByTestId('search-library').click();
  const sec = await secrets(page);
  let id: string | undefined;
  for (const x of sec.libraryOrder) {
    if (except.includes(x) || !byId(x)) continue;
    const c = FIXTURE_CARDS.get(sec.identities[x]!.card.sid);
    if (c && pred(c)) {
      id = x;
      break;
    }
  }
  if (!id) throw new Error(`no ${what} left in the library of ${seat}`);
  const pileCard = page.locator(`[data-testid="pile-card"][data-card="${id}"]`);
  await page.mouse.move(720, 120);
  await expect(page.locator('[data-testid="pile-card"].hovered')).toHaveCount(0);
  await pileCard.hover({ position: { x: 4, y: 30 }, timeout: 5000 });
  await expect(pileCard).toHaveClass(/hovered/);
  await page.keyboard.press('KeyH');
  await expect.poll(async () => (await secrets(page)).hand).toContain(id);
  await page.getByRole('button', { name: /^Close .*Library/ }).click();
  await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
  return id;
}

/** Drag a hand card from the fan onto the table at a screen point (DESIGN: a drag crosses into the scene at the cursor). */
async function dragFromHand(page: Page, id: string, to: { x: number; y: number }): Promise<void> {
  await hoverHand(page, id);
  const vp = page.viewportSize()!;
  const lb = (await page.locator(`[data-testid="hand-card"][data-card="${id}"]`).boundingBox({ timeout: 5000 }))!;
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2, vp.height * 0.72, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await frames(page);
}

// ======================================================================================================================
// The screenshot matrix: twelve gate states (themes/signals.ts) plus the neutral table, four themes, two rigs.
// ======================================================================================================================

async function matrix(browser: Browser, browserName: string, info: TestInfo): Promise<void> {
  const project = info.project.name;
  const { failures, gaps, step } = recorder();
  const { errors, outside, watch } = watcher();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10_000);
  const room = freshRoom();
  const mk = async (who: string, seat: Seat, deck: string): Promise<Player> => {
    const page = await context.newPage();
    watch(page, who);
    if (browserName === 'webkit') await page.addInitScript({ content: FAKE_MIC });
    return { name: who, seat, deck, profile: freshProfile(info, `m4m-${who}`), page, received: [] };
  };
  const A = await mk('Ann', 's0', 'gw-m19-60.txt');
  const B = await mk('Ben', 's1', 'ur-m19-60.mtga.txt');
  const both = [A, B];
  const shotsTaken: string[] = [];
  /** Whether P reaches the ego rig at all (checked once; without it the ego column of the matrix is missing). */
  let egoWorks: boolean | null = null;

  const ok = await step('setup: two players at a networked table, pass timer off, both in the game with seven cards', async () => {
    await open(A.page, `/t/${room.roomId}/${room.roomKey}`, { profile: A.profile, transport: 'local' });
    await expect(A.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    await setNickname(A.page, A.name);
    await open(B.page, `/t/${room.roomId}/${room.roomKey}`, { profile: B.profile, transport: 'local' });
    await expect(B.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    await setNickname(B.page, B.name);
    await expect(chair(A.page, 's1')).toContainText(B.name);
    // A waiting confirmation round stays pending only while no pass timer runs (lobby setting, host only).
    await A.page.getByTestId('lobby-pass-timer').selectOption('off');
    await expect.poll(async () => (await state(B.page)).settings.passTimerMs).toBeNull();
    for (const p of both) {
      // Ann's list marks one Pegasus Courser as a foil printing (`*F*`, the export marker): the foil state of the
      // matrix comes onto the table through the UI like every other card.
      await p.page.getByTestId('lobby-deck-text').fill(p === A ? withFoil(decklist(p.deck)) : decklist(p.deck));
      await p.page.getByTestId('lobby-deck-check').click();
      await expect(p.page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
      await p.page.getByTestId('ready').click();
      await expect(p.page.getByTestId('ready-done')).toContainText('60 cards is committed');
    }
    await A.page.getByTestId('start-game').click();
    for (const p of both) await expect(p.page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
    for (const p of both) {
      await p.page.bringToFront();
      await neutral(p.page);
      const before = (await secrets(p.page)).libraryOrder;
      await p.page.keyboard.press('KeyS');
      await expect.poll(async () => (await secrets(p.page)).libraryOrder).not.toEqual(before);
      await p.page.keyboard.press('Shift+KeyD');
      await expect(p.page.getByTestId('draw-n-input')).toBeFocused();
      await p.page.getByTestId('draw-n-input').fill('7');
      await p.page.keyboard.press('Enter');
      await expect.poll(async () => (await secrets(p.page)).hand).toHaveLength(7);
    }
  });
  if (!ok) {
    await context.close();
    expect(failures).toEqual([]);
    return;
  }

  // Cards: Ann's c1 and c2, Ben's o1 (creatures) on the battlefield; the rest stays in hand.
  const ids = { c1: '', c2: '', o1: '' };
  const creature = (c: { type_line: string }) => isCreature(c) && !isLand(c);
  const vp = A.page.viewportSize()!;
  await step('setup: Ann drags two creatures from her hand onto the battlefield, Ben one', async () => {
    for (const [key, p, x] of [['c1', A, 0.42], ['c2', A, 0.54], ['o1', B, 0.48]] as const) {
      // The foil printing stays out of the neutral cards: it is the foil state's own card.
      const foils = Object.entries((await secrets(p.page)).identities).filter(([, v]) => v.card.foil === true).map(([k]) => k);
      const taken = [...Object.values(ids).filter(Boolean), ...foils];
      const id = (await handWhere(p.page, creature, taken)) ?? (await tutorFromLibrary(p.page, p.seat, creature, 'creature', taken));
      await p.page.bringToFront();
      await neutral(p.page);
      await dragFromHand(p.page, id, { x: vp.width * x, y: vp.height * 0.6 });
      await expect.poll(async () => (await state(A.page)).cards[id]?.zone).toBe(`battlefield:${p.seat}`);
      ids[key] = id;
    }
    await converged(A.page, B.page);
  });

  /** The empty table left of c1, where the pointer rests between states (bird's-eye). */
  let rest = { x: vp.width * 0.2, y: vp.height * 0.45 };
  /**
   * Where P is pressed: the centre of Ann's row, from c1's left edge to the slot right of c2 where the foil card comes.
   * The switch keeps the table point under the pointer fixed and the ego view shows Ann's cards larger than the
   * bird's-eye does, so they spread out from this point: pressed at the resting point left of c1, the row spread to
   * the right under the HUD's log panel. Switching back at the same point returns to the same bird's-eye view.
   */
  let anchor = { x: vp.width * 0.5, y: vp.height * 0.6 };
  /**
   * The ego view's own resting point (left of c1 as the ego view shows it), per theme (Dusk's tilted bird's-eye puts
   * the anchor over a slightly different table point), found at the first ego switch per bird's-eye view, c1 at home.
   */
  const egoRests = new Map<ThemeId, { x: number; y: number }>();
  let egoRest: { x: number; y: number } | null = null;
  const findRest = async () => {
    const c1 = await centreOf(A.page, ids.c1);
    const c2 = await centreOf(A.page, ids.c2);
    const w = (await shown(A.page)).find((c) => c.id === ids.c1)!.screen.width;
    rest = { x: c1.x - 2.5 * w, y: c1.y };
    anchor = { x: (c1.x - w / 2 + c2.x + 1.75 * w) / 2, y: c1.y };
    egoRests.clear();
  };
  const findEgoRest = async (): Promise<{ x: number; y: number }> => {
    const c1 = await centreOf(A.page, ids.c1);
    const w = (await shown(A.page)).find((c) => c.id === ids.c1)!.screen.width;
    // Clear of Ann's avatar panel at the left edge (190 px).
    const at = { x: Math.max(230, c1.x - 2.5 * w), y: c1.y };
    if (at.x > c1.x - w) throw new Error(`no empty table left of c1 in the ego view (c1 at ${Math.round(c1.x)}, ${Math.round(w)} px wide)`);
    return at;
  };
  /** The pointer's resting point in the rig shown. */
  const restNow = async () => ((await rigOf(A.page)) === 'ego' && egoRest ? egoRest : rest);
  await step('setup: a resting point on empty table beside Ann\'s cards', async () => {
    await A.page.bringToFront();
    await findRest();
  });

  /** Capture Ann's page in every theme and rig; `pointer` puts the pointer where the state needs it after a switch. */
  const captureAll = async (stateName: string, pointer: () => Promise<void>) => {
    await A.page.bringToFront();
    for (const theme of THEME_IDS) {
      await step(`matrix ${stateName}: ${THEME_LABELS[theme]}`, async () => {
        if ((await currentTheme(A.page)) !== theme) await pickHudTheme(A.page, theme);
        for (const rig of ['birdseye', 'ego'] as const) {
          if (rig === 'ego' && egoWorks === false) continue;
          if ((await rigOf(A.page)) !== rig) {
            try {
              await pressPerspective(A.page, rig, anchor, 4000);
              if (rig === 'ego') {
                egoWorks = true;
                egoRest = egoRests.get(theme) ?? (await findEgoRest());
                egoRests.set(theme, egoRest);
              }
            } catch (e) {
              if (rig === 'ego' && egoWorks === null) {
                egoWorks = false;
                failures.push(`matrix: P does not switch to the ego rig (scene camera setRig is a no-op without M4-P1), so the ego half of the matrix is missing: ${firstLine(e)}`);
                continue;
              }
              throw e;
            }
          }
          await pointer();
          await sceneIdle(A.page);
          await frames(A.page);
          const n = `matrix-${theme}-${rig}-${stateName}`;
          await shot(A.page, 'M4', n, project);
          shotsTaken.push(n);
        }
        // Leave each theme in the bird's-eye rig, so the next state's setup gestures work on known screen geometry.
        if ((await rigOf(A.page)) !== 'birdseye') await pressPerspective(A.page, 'birdseye', anchor, 4000);
      });
    }
    // The next state's setup starts from Paper's bird's-eye view.
    await step(`matrix ${stateName}: back to Paper`, async () => {
      if ((await currentTheme(A.page)) !== 'paper') await pickHudTheme(A.page, 'paper');
    });
  };
  const atRest = async () => {
    const at = await restNow();
    await A.page.mouse.move(at.x, at.y);
    await frames(A.page);
  };
  const ann = async () => {
    await A.page.bringToFront();
    await atRest();
  };
  const ben = async () => {
    await B.page.bringToFront();
    await neutral(B.page);
  };

  // The whole table at the fitted view, once per theme and rig: the mood of each theme.
  await captureAll('00-fit', atRest);

  // The signals are judged closer in: Ann zooms with the wheel (centred on the cursor) between her cards and Ben's,
  // until a card is about 64 px tall.
  await step('setup: Ann zooms in with the wheel between her cards and Ben\'s', async () => {
    await A.page.bringToFront();
    const [c1, o1] = [await centreOf(A.page, ids.c1), await centreOf(A.page, ids.o1)];
    // Weighted toward Ann's row, so her cards stay clear of the hand fan as the view closes in.
    const at = { x: (c1.x + o1.x) / 2 + 40, y: c1.y * 0.65 + o1.y * 0.35 };
    await A.page.mouse.move(at.x, at.y);
    const height = async () => (await shown(A.page)).find((c) => c.id === ids.c1)!.screen.height;
    for (let i = 0; i < 20 && (await height()) < 64; i++) {
      await A.page.mouse.wheel(0, -100);
      await frames(A.page);
      await sceneIdle(A.page);
    }
    expect(await height()).toBeGreaterThanOrEqual(60);
    expect(await height()).toBeLessThan(140);
    await findRest();
  });

  // 0. Neutral.
  await captureAll('00-neutral', atRest);

  // 1. Hovered: the pointer over c1 (view state).
  await captureAll('03-hovered', async () => {
    const c = await centreOf(A.page, ids.c1);
    await A.page.mouse.move(c.x, c.y, { steps: 3 });
    await frames(A.page);
  });

  // 2. Selected: click c1, pointer back to rest.
  await step('selected: Ann clicks c1', async () => {
    await ann();
    const c = await centreOf(A.page, ids.c1);
    await A.page.mouse.click(c.x, c.y);
    await atRest();
    await expect.poll(async () => (await shown(A.page)).find((x) => x.id === ids.c1)?.selected).toBe(true);
  });
  await captureAll('02-selected', atRest);
  await step('selected: a click on empty table clears the selection', async () => {
    await ann();
    await A.page.mouse.click(rest.x, rest.y);
    await expect.poll(async () => (await shown(A.page)).find((x) => x.id === ids.c1)?.selected).toBe(false);
  });

  // 3. Tapped: T on hovered c1.
  await step('tapped: Ann taps c1 (T on hover)', async () => {
    await ann();
    await hoverTable(A.page, ids.c1);
    await A.page.keyboard.press('KeyT');
    await expect.poll(async () => (await state(A.page)).cards[ids.c1]?.tapped).toBe(true);
    await atRest();
  });
  await captureAll('01-tapped', atRest);
  await step('tapped: Ann untaps c1 (T)', async () => {
    await ann();
    await hoverTable(A.page, ids.c1);
    await A.page.keyboard.press('KeyT');
    await expect.poll(async () => (await state(A.page)).cards[ids.c1]?.tapped).toBe(false);
    await atRest();
  });

  // 4. Displaced: Alt+drag c1 forward (temporary move, ghost at home).
  await step('displaced: Ann Alt-drags c1 forward (temporary move)', async () => {
    await ann();
    const c = await centreOf(A.page, ids.c1);
    const h = (await shown(A.page)).find((x) => x.id === ids.c1)!.screen.height;
    await A.page.keyboard.down('Alt');
    try {
      await dragTo(A.page, ids.c1, { x: c.x, y: c.y - 0.9 * h });
    } finally {
      await A.page.keyboard.up('Alt');
    }
    await expect.poll(async () => (await shown(A.page)).find((x) => x.id === ids.c1)?.displaced).toBe(true);
    await atRest();
  });
  await captureAll('04-displaced', atRest);
  await step('displaced: Ann settles (B); c1 goes home', async () => {
    await ann();
    await A.page.keyboard.press('KeyB');
    await expect.poll(async () => (await state(A.page)).cards[ids.c1]?.home).toBeUndefined();
  });

  // 5. Attacking: A on hovered c2.
  await step('attacking: Ann attacks with c2 (A on hover)', async () => {
    await ann();
    await hoverTable(A.page, ids.c2);
    await A.page.keyboard.press('KeyA');
    await expect.poll(async () => (await state(A.page)).cards[ids.c2]).toMatchObject({ combat: 'attack', tapped: true });
    await atRest();
  });
  await captureAll('05-attacking', atRest);
  await step('attacking: Ann settles (B) and untaps c2 (T)', async () => {
    await ann();
    await A.page.keyboard.press('KeyB');
    await expect.poll(async () => (await state(A.page)).cards[ids.c2]?.combat).toBeUndefined();
    await hoverTable(A.page, ids.c2);
    await A.page.keyboard.press('KeyT');
    await expect.poll(async () => (await state(A.page)).cards[ids.c2]?.tapped).toBe(false);
    await atRest();
  });

  // 6. Blocking: Ben attacks with o1, Ann drags c1 onto it.
  await step('blocking: Ben attacks with o1 (A); Ann drags c1 onto it (block line)', async () => {
    await ben();
    await hoverTable(B.page, ids.o1);
    await B.page.keyboard.press('KeyA');
    await expect.poll(async () => (await state(A.page)).cards[ids.o1]?.combat).toBe('attack');
    await ann();
    await dragTo(A.page, ids.c1, await centreOf(A.page, ids.o1));
    await expect.poll(async () => (await state(A.page)).cards[ids.c1]?.combat).toBe('block');
    await expect.poll(async () => Object.values((await state(A.page)).lines).filter((l) => l.kind === 'block').length).toBe(1);
    await atRest();
  });
  await captureAll('06-blocking', atRest);
  await step('blocking: both settle (B); Ben untaps o1', async () => {
    await ann();
    await A.page.keyboard.press('KeyB');
    await ben();
    await B.page.keyboard.press('KeyB');
    await hoverTable(B.page, ids.o1);
    await B.page.keyboard.press('KeyT');
    for (const p of both) await expect.poll(async () => Object.values((await state(p.page)).cards).filter((c) => c.home !== undefined || c.combat !== undefined).length).toBe(0);
    await expect.poll(async () => (await state(A.page)).cards[ids.o1]?.tapped).toBe(false);
  });

  // 7. Face-down: Ben puts a hand card onto the battlefield face down (F); Ann sees the neutral back.
  let down = '';
  await step('face-down: Ben plays a hand card face down (F on the hovered hand card)', async () => {
    await ben();
    down = (await handWhere(B.page, (c) => !isLand(c))) ?? (await secrets(B.page)).hand[0]!;
    await hoverHand(B.page, down);
    await B.page.keyboard.press('KeyF');
    await expect.poll(async () => (await state(A.page)).cards[down]).toMatchObject({ zone: 'battlefield:s1', face: 'down' });
    await expect.poll(async () => (await shown(A.page)).find((c) => c.id === down)?.shows).toBe('back');
  });
  await captureAll('07-face-down', atRest);

  // 8. Foil: Ann plays the foil printing her decklist names (`*F*`) from her hand beside c2.
  await step('foil: Ann drags the foil Pegasus Courser from her hand beside c2 (decklist *F*)', async () => {
    await ann();
    const sec = await secrets(A.page);
    const foil = (x: string) => sec.identities[x]?.card.foil === true;
    const st = await state(A.page);
    const id = sec.hand.find((x) => foil(x) && st.cards[x]?.zone === 'hand:s0') ?? (await tutorFromLibrary(A.page, 's0', () => true, 'foil printing', Object.values(ids), foil));
    await A.page.mouse.move(rest.x, rest.y);
    const c2 = await centreOf(A.page, ids.c2);
    const w = (await shown(A.page)).find((c) => c.id === ids.c2)!.screen.width;
    await dragFromHand(A.page, id, { x: c2.x + 1.25 * w, y: c2.y });
    await expect.poll(async () => (await state(A.page)).cards[id]?.zone).toBe('battlefield:s0');
    await expect.poll(async () => (await state(A.page)).cards[id]?.identity?.foil).toBe(true);
    await expect.poll(async () => (await shown(A.page)).find((c) => c.id === id)?.foil, 'the table draws the foil sheen and badge').toBe(true);
    await converged(A.page, B.page);
  });
  await captureAll('08-foil', atRest);

  // 9. Seat colours: Ann's target line c1 → o1 and Ben's o1 → c2, each in its seat's colour.
  await step('seat colours: Ann right-drags a line from c1 to o1, Ben from o1 to c2', async () => {
    await ann();
    await rightDrag(A.page, await centreOf(A.page, ids.c1), await centreOf(A.page, ids.o1));
    await ben();
    await rightDrag(B.page, await centreOf(B.page, ids.o1), await centreOf(B.page, ids.c2));
    await expect.poll(async () => Object.values((await state(A.page)).lines).filter((l) => l.kind === 'target').map((l) => l.by).sort()).toEqual(['s0', 's1']);
  });
  await captureAll('09-seat-colours', atRest);

  // 10. Pending confirmation: Ann casts a hand card; with the pass timer off the round waits on Ben.
  let spell = '';
  await step('pending confirmation: Ann casts a card (C on hover); the round waits on Ben', async () => {
    await A.page.bringToFront();
    spell = (await handWhere(A.page, (c) => !isLand(c))) ?? (await secrets(A.page)).hand[0]!;
    await hoverHand(A.page, spell);
    await A.page.keyboard.press('KeyC');
    await expect.poll(async () => (await lane(A.page)).find((e) => e.face === spell)?.pending).toBe(true);
    await atRest();
  });
  await captureAll('11-pending-confirmation', atRest);
  await step('pending confirmation: Ben passes (Enter); Ann resolves (R)', async () => {
    await ben();
    await expect(B.page.getByTestId('confirm-prompt')).toBeVisible();
    await B.page.keyboard.press('Enter');
    await ann();
    await A.page.keyboard.press('KeyR');
    await expect.poll(async () => (await state(A.page)).stack).toEqual([]);
  });

  // 11. Speaking: both join voice; Ben holds V; Ann sees Ben's avatar speaking.
  const voiceOk = await step('speaking: both join voice; Ben holds the talk key (V)', async () => {
    for (const p of both) {
      await p.page.bringToFront();
      await p.page.getByTestId('voice-join').click();
      await expect(p.page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle', { timeout: 15_000 });
    }
    await ben();
    await B.page.mouse.move(700, 420);
    await B.page.keyboard.down('Control');
    await expect(A.page.locator('[data-testid="avatar"][data-seat="s1"]')).toHaveAttribute('data-speaking', 'true', { timeout: 15_000 });
  });
  if (voiceOk) {
    await captureAll('10-speaking', atRest);
    await step('speaking: Ben releases Ctrl', async () => {
      await B.page.bringToFront();
      await B.page.keyboard.up('Control');
      await expect(A.page.locator('[data-testid="avatar"][data-seat="s1"]')).toHaveAttribute('data-speaking', 'false');
    });
  }

  // 12. Away: Ben's page closes; Ann's page marks s1 away.
  await step('away: Ben\'s page closes; Ann\'s page marks his seat away', async () => {
    await B.page.close();
    await expect.poll(async () => (await state(A.page)).seats.s1?.away, { timeout: 20_000 }).toBe(true);
    await expect(A.page.locator('[data-testid="avatar"][data-seat="s1"]')).toHaveAttribute('data-away', 'true');
  });
  await captureAll('12-away', atRest);

  await step('no page or console error and no request leaves the test server', async () => {
    if (errors.length || outside.length) throw new Error(`errors: ${JSON.stringify(errors.slice(0, 8))}; outside requests: ${JSON.stringify(outside.slice(0, 8))}`);
  });

  writeReport(info, 'matrix', { failures, gaps, shots: shotsTaken, ego: egoWorks });
  await context.close();
  expect([...failures, ...gaps.map((g) => `gap: ${g}`)]).toEqual([]);
}
