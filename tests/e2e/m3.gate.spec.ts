/**
 * Gate M3-G (docs/PLAN.md, Milestone 3): four pages on the broadcast transport (`?transport=local`, distinct
 * `?profile=`, recorded Scryfall card data and MTGJSON booster data injected before load, `?faces=placeholder`,
 * `?speech=fake`) play a scripted Two-Headed Giant game; a fifth page watches it as a spectator. Then a three-player
 * free-for-all opening, and a four-player free-for-all opening for the layout screenshots.
 *
 * Two-Headed Giant (Anna s0 and Ben s1 are team t0, Cleo s2 and Dan s3 team t1; DESIGN "Players, seats and formats"):
 * 1. Lobby: Anna hosts, picks the format and turns the pass timer off in the lobby settings (so every answer is an
 *    explicit key press, never a timeout); the others join by the link and sit in the next chair (teams by chair); Viv
 *    joins from the start page by the watch link; all four Ready with a fixture deck through the lobby's deck field;
 *    Anna starts.
 * 2. Each page sees its own seat at the bottom; each teammate's page shows the partner's hand as a second fan.
 * 3. Voice: everyone clicks "Join voice"; Ben's talk-mode indicator goes through noMic, idle, live (V held), team
 *    (Shift+V held; only the teammate's connection opens), muted (M), turn mic (live for the own team's turn) and
 *    dictating.
 * 4. Turn 1 (team t0): Anna and Ben each play a land (drag from the hand) and a creature through the stack.
 *    Turn 2 (team t1): Cleo and Dan each play a land. Turn passes are Ctrl+Enter.
 * 5. Turn 3 (team t0): a three-way stack: Anna casts a creature (C), Cleo holds (H) and casts Essence Scatter at it
 *    (right-drag target line between stack items), Ben holds and casts Shock at Cleo (right-drag to her avatar).
 *    Everyone else answers OK (Enter); Shock and Essence Scatter resolve (R), the creature spell is countered (Shift+R).
 * 6. Combat: Anna and Ben attack (A) and draw attack lines to Cleo's and Dan's avatars (right-drag): attacks against
 *    both opponents. Dan reveals a hand card to the opposing team (W, then the team in the reveal menu).
 * 7. Captions: Anna dictates with the fake engine (`__spellplane.speech.say`); the caption hangs at the card she last
 *    acted on, on every page, and the final text is stored on that action in the log.
 * 8. Team life: Cleo takes the damage on the shared team total (avatar − control).
 * 9. All five pages end on the same state hash. Leak scan: nothing an opponent's page received, holds or stores names
 *    a card of the other team's hands or libraries (so no team hand reached an opponent), and the spectator's page
 *    received no hidden card at all.
 *
 * Then three new players open a three-player free-for-all (S, Shift+D, a land each) and four open a four-player one.
 *
 * Every step uses the design's UI path; engine behaviour is asserted on state hashes and the debug hook, never on pixels.
 * Screenshots (artifacts/shots/M3/) are review evidence: each layout from seat 1 and seat 3, team hands, the three-way
 * stack, the attacks, the team reveal, captions on cards, the talk-mode indicator states, the spectator's view.
 *
 * Like the M1 and M2 gates, the game is one test whose steps are recorded: a failed step is listed and the game goes on
 * where it can, so one run shows every gap; the test fails if any step failed. Failures and debug-hook fallbacks are
 * also written to artifacts/gate/M3-<project>.json.
 *
 * Chromium gets its fake microphone from playwright.config.ts. WebKit has no fake media device and would show the macOS
 * microphone prompt, so on WebKit an init script gives `navigator.mediaDevices.getUserMedia` a silent Web Audio stream
 * instead (the "Join voice" click and everything after it run unchanged).
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, SecretStore, TableState } from '../../src/core/types';
import type { NetMessageRecord } from '../../src/net/types';
import type { DebugTableView } from '../../src/scene/lines';
import type { DebugStackEntry } from '../../src/scene/stack';
import type { DebugCaption } from '../../src/scene/types';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import type { TalkIndicatorState, TalkState, VoiceTrackState } from '../../src/voice/types';
import { scan } from '../leak/scan';
import { setsScript } from './flow/helpers';
import { hook, shot } from './helpers/app';
import { chair, decklist, fixturesScript, freshRoom, setNickname, startPageLoaded } from './lobby/helpers';

/** sid -> name and type line from the recorded fixtures. */
const FIXTURE_CARDS = new Map<string, { name: string; type_line: string }>(
  ['m19.json', 'tm19.json'].flatMap((f) =>
    (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as { id: string; name: string; type_line: string }[]).map((c) => [c.id, { name: c.name, type_line: c.type_line }] as const),
  ),
);

type Seat = 's0' | 's1' | 's2' | 's3';
type Format = '2hg' | 'ffa3' | 'ffa4';
interface Player {
  name: string;
  seat: Seat;
  deck: string;
  profile: string;
  page: Page;
  /** Every message this player's page received (debug hook `net.messages()`, direction `in`). */
  received: NetMessageRecord[];
}

const GW = 'gw-m19-60.txt';
const UR = 'ur-m19-60.mtga.txt';

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const lane = (page: Page) => hook<DebugStackEntry[]>(page, 'stack');
const tableView = (page: Page) => hook<DebugTableView | null>(page, 'tableView');
const tracks = (page: Page) => hook<VoiceTrackState[]>(page, 'voice.tracks');
const talk = (page: Page) => hook<TalkState>(page, 'voice.talk');
const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const log = (page: Page) => hook<LogEntry[]>(page, 'session.log');

function firstLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  // Strip ANSI colour codes from Playwright's assertion messages.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ');
}

/** A profile no other test or earlier run uses (fresh IndexedDB, new key pair). */
function profileFor(info: TestInfo, who: string): string {
  return `g3-${who}-${info.project.name.slice(0, 3)}-${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * WebKit only: `getUserMedia` answers with a silent Web Audio stream, so "Join voice" never reaches the real
 * microphone (which would show the macOS prompt; CLAUDE.md, pw-guard exit code 3).
 */
const FAKE_MIC = `(() => {
  const log = (window.__fakeMicLog = []);
  const md = navigator.mediaDevices;
  if (!md) { log.push('no mediaDevices'); return; }
  const silent = async () => {
    log.push('getUserMedia');
    try {
      const ctx = new AudioContext();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      void ctx.resume().catch(() => undefined);
      log.push('stream ' + dst.stream.getAudioTracks().length);
      return dst.stream;
    } catch (e) {
      log.push('error ' + (e && e.name) + ' ' + (e && e.message));
      throw e;
    }
  };
  const devices = async () => [];
  for (const target of [md, Object.getPrototypeOf(md)]) {
    try {
      Object.defineProperty(target, 'getUserMedia', { configurable: true, writable: true, value: silent });
      Object.defineProperty(target, 'enumerateDevices', { configurable: true, writable: true, value: devices });
    } catch (e) {
      log.push('define ' + (e && e.message));
    }
  }
  log.push('installed ' + (navigator.mediaDevices.getUserMedia === silent));
})();`;

/** Open `hash` with fixture data, placeholder faces, the fake speech engine, a profile and the local transport. */
async function openWith(page: Page, hash: string, profile: string, browserName: string): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.addInitScript({ content: setsScript() });
  if (browserName === 'webkit') await page.addInitScript({ content: FAKE_MIC });
  const q = new URLSearchParams({ faces: 'placeholder', profile, transport: 'local', speech: 'fake' });
  await page.goto(`./?${q.toString()}#${hash}`);
}

/** Let the scene and the HUD process input (two animation frames). */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Wait until no card animates and every visible card has a texture. */
async function sceneIdle(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving && (!c.visible || c.tier !== null)), { timeout: 15_000 }).toBe(true);
}

/** Wait for a camera move to finish: two frames with the same camera. */
async function cameraIdle(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = (await tableView(page))?.camera;
        await frames(page);
        const b = (await tableView(page))?.camera;
        return !!a && !!b && a.x === b.x && a.y === b.y && a.dist === b.dist;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Park the pointer at the left edge of the viewport, off the table's cards and the HUD's controls. */
async function neutral(page: Page): Promise<void> {
  await page.mouse.move(4, 450);
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

/** Point at a card in the own hand fan (low on the card, where no neighbour overlaps it). */
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
  const full = e.screen.height / e.scale;
  return { x: e.screen.x + e.screen.width / 2, y: e.screen.y + (full * 9) / 88 };
}

/** The centre of a seat's avatar in the HUD. */
async function avatarAt(page: Page, seat: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(`[data-testid="avatar"][data-seat="${seat}"]`).boundingBox({ timeout: 5000 }))!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(12, box.height / 2) };
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

/** Name and type of a card as `page` knows it: public identity, own secret, or a targeted reveal it received. */
async function identify(page: Page, id: string): Promise<{ name: string; type_line: string } | null> {
  const [st, sec] = await Promise.all([state(page), secrets(page)]);
  const sid = st.cards[id]?.identity?.sid ?? sec.identities[id]?.card.sid ?? sec.received?.[id]?.card.sid;
  return (sid && FIXTURE_CARDS.get(sid)) || null;
}

async function handWhere(page: Page, pred: (c: { name: string; type_line: string }) => boolean): Promise<string | null> {
  const [sec, st] = await Promise.all([secrets(page), state(page)]);
  for (const id of sec.hand) {
    if (st.cards[id]?.zone !== `hand:${sec.seat}`) continue;
    const c = await identify(page, id);
    if (c && pred(c)) return id;
  }
  return null;
}

const isLand = (c: { type_line: string }) => c.type_line.includes('Land');
const isCreature = (c: { type_line: string }) => c.type_line.includes('Creature');
const named = (n: string) => (c: { name: string }) => c.name === n;

/** Wait until every page reports the same state hash; returns it. */
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

/** Everything a page keeps in its profile's IndexedDB, as JSON (the leak scan's "stores"). */
async function dumpStores(page: Page, profile: string): Promise<unknown> {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return {};
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

/** Every viewer sees their own seat at the bottom (DESIGN "Players, seats and formats"). */
async function ownSeatAtBottom(page: Page, me: string): Promise<void> {
  await cameraIdle(page);
  const v = (await tableView(page))!;
  const own = v.seats.find((s) => s.seat === me)!;
  const hostEl = page.getByTestId('scene-host');
  const host = (await hostEl.boundingBox({ timeout: 5000 }))!;
  // The middle of the area the table is fitted into: the HUD's screen layer (toolbar, hand fan, at a Two-Headed Giant
  // table the teammate's fan too) is kept clear of it (data-fit-insets "top right bottom left").
  const [top = 0, , bottom = 0] = ((await hostEl.getAttribute('data-fit-insets')) ?? '').split(/\s+/).map(Number);
  const middle = host.y + top + (host.height - top - bottom) / 2;
  expect(own.screen!.territory.y, `${me}'s own territory below the middle of the table area of its screen`).toBeGreaterThan(middle);
  for (const o of v.seats) if (o.seat !== me) expect(o.screen!.territory.y, `${o.seat} as ${me} sees it`).toBeLessThanOrEqual(own.screen!.territory.y + 0.5);
}

test.describe('M3 gate @gate', () => {
  // A missing element fails its step instead of waiting out the whole game.
  test.use({ actionTimeout: 10_000 });

  test('four pages play a scripted Two-Headed Giant game with a spectator, then free-for-all openings; the leak scan finds nothing', async ({ browser, browserName }, info) => {
    test.setTimeout(25 * 60_000);
    const project = info.project.name;
    const failures: string[] = [];
    /** Steps without a UI path that the gate drives through the debug hook instead. */
    const gaps: string[] = [];
    const errors: string[] = [];
    const outside: string[] = [];

    /** One scripted step: a failure is recorded and the game goes on where it can. */
    const step = async (title: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await test.step(title, fn);
        return true;
      } catch (e) {
        failures.push(`${title}: ${firstLine(e)}`);
        return false;
      }
    };
    /** A check whose failure is recorded without stopping the step (so the step's evidence is still taken). */
    const soft = async (title: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${title}: ${firstLine(e)}`);
      }
    };

    const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(10_000);
    const watch = (page: Page, who: string) => {
      page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      page.on('request', (r) => {
        if (!/^(data|blob):/.test(r.url()) && !new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(r.url());
      });
    };
    const newPage = async (who: string) => {
      const p = await context.newPage();
      watch(p, who);
      return p;
    };
    const hasNet = (page: Page) => page.evaluate(() => typeof (window.__spellplane as { net?: { messages?: unknown } } | undefined)?.net?.messages === 'function');
    /** Move what the page received so far into the player's record. */
    const collect = async (p: { page: Page; received: NetMessageRecord[] }) => {
      if (!(await hasNet(p.page).catch(() => false))) return;
      const msgs = await hook<NetMessageRecord[]>(p.page, 'net.messages');
      p.received.push(...msgs.filter((m) => m.dir === 'in'));
      await hook(p.page, 'net.clearMessages');
    };
    const waitHud = async (page: Page) => {
      await expect(page.getByTestId('hud')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => typeof (window.__spellplane as { session?: { hash?: unknown } } | undefined)?.session?.hash === 'function'), { timeout: 15_000 }).toBe(true);
    };
    const focus = async (page: Page) => {
      await page.bringToFront();
      await neutral(page);
    };

    /**
     * A table of `format` in a fresh room: the first player hosts and picks the format (and turns the pass timer off),
     * the others join by the link in chair order, everyone Readies with a fixture deck through the lobby's deck field,
     * and the host starts. `beforeStart` runs once all are ready (the spectator joins there).
     */
    const openTableGame = async (format: Format, players: Player[], room: { roomId: string; roomKey: string }, beforeStart?: () => Promise<void>) => {
      const [host] = players;
      for (const [i, p] of players.entries()) {
        await openWith(p.page, `/t/${room.roomId}/${room.roomKey}`, p.profile, browserName);
        await expect(p.page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
        await setNickname(p.page, p.name);
        await expect(chair(p.page, p.seat)).toHaveAttribute('data-mine', 'true');
        if (i === 0) {
          await host!.page.getByTestId('lobby-format-select').selectOption(format);
          await expect.poll(async () => (await state(host!.page)).format).toBe(format);
          await host!.page.getByTestId('lobby-pass-timer').selectOption('off');
          await expect.poll(async () => (await state(host!.page)).settings.passTimerMs).toBeNull();
        }
      }
      for (const p of players) {
        for (const q of players) await expect(chair(p.page, q.seat)).toContainText(q.name);
        await expect.poll(async () => (await state(p.page)).format).toBe(format);
      }
      for (const p of players) {
        await p.page.getByTestId('lobby-deck-text').fill(decklist(p.deck));
        await p.page.getByTestId('lobby-deck-check').click();
        await expect(p.page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
        await p.page.getByTestId('ready').click();
        await expect(p.page.getByTestId('ready-done')).toContainText('60 cards is committed');
      }
      await expect(host!.page.getByTestId('ready-count')).toHaveText(`${players.length} of ${players.length} players ready.`);
      if (beforeStart) await beforeStart();
      await host!.page.getByTestId('start-game').click();
      for (const p of players) await waitHud(p.page);
      for (const p of players) await expect.poll(async () => (await tableView(p.page))?.format ?? null, { timeout: 15_000 }).toBe(format);
    };

    /** Shuffle (S) and draw seven (Shift+D, 7, Enter). */
    const openingHand = async (p: Player, others: Page[]) => {
      await focus(p.page);
      const before = (await secrets(p.page)).libraryOrder;
      expect(before).toHaveLength(60);
      await p.page.keyboard.press('KeyS');
      await expect.poll(async () => (await secrets(p.page)).libraryOrder).not.toEqual(before);
      await p.page.keyboard.press('Shift+KeyD');
      await expect(p.page.getByTestId('draw-n-input')).toBeFocused();
      await p.page.getByTestId('draw-n-input').fill('7');
      await p.page.keyboard.press('Enter');
      await expect.poll(async () => (await secrets(p.page)).hand).toHaveLength(7);
      for (const o of others) await expect.poll(async () => (await state(o)).zones[`hand:${p.seat}`]?.ids.length).toBe(7);
    };

    /** Search the own library (avatar zone button, Search) for a card and put it into the hand (H); closing shuffles. */
    const tutor = async (p: Player, pred: (c: { name: string; type_line: string }) => boolean, what: string): Promise<string> => {
      const have = await handWhere(p.page, pred);
      if (have) return have;
      const page = p.page;
      await focus(page);
      await page.locator(`[data-testid="avatar"][data-seat="${p.seat}"] [data-testid="zone-button"][data-zone="library:${p.seat}"]`).click();
      await expect(page.getByTestId('pile-viewer')).toBeVisible();
      await page.getByTestId('search-library').click();
      const sec = await secrets(page);
      let id: string | undefined;
      for (const x of sec.libraryOrder) {
        const c = FIXTURE_CARDS.get(sec.identities[x]!.card.sid);
        if (c && pred(c)) {
          id = x;
          break;
        }
      }
      if (!id) throw new Error(`no ${what} left in ${p.name}'s library`);
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
    };

    const landsPlayed: Record<string, number> = {};
    /** Drag a land from the hand fan onto the own territory; every page sees it face up with its identity. */
    const playLand = async (p: Player, everyone: Page[]) => {
      const page = p.page;
      const land = await tutor(p, isLand, 'land');
      await focus(page);
      await cameraIdle(page);
      const own = (await tableView(page))!.seats.find((s) => s.seat === p.seat)!.screen!.territory;
      await hoverHand(page, land);
      const lb = (await page.locator(`[data-testid="hand-card"][data-card="${land}"]`).boundingBox({ timeout: 5000 }))!;
      const k = (landsPlayed[`${p.profile}`] = (landsPlayed[`${p.profile}`] ?? -1) + 1);
      await page.mouse.down();
      await page.mouse.move(lb.x + lb.width / 2, lb.y - 80, { steps: 6 });
      await page.mouse.move(own.x - 120 + 52 * k, own.y + 20, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`battlefield:${p.seat}`);
      const ref = (await secrets(page)).identities[land]!.card;
      await soft(`${p.name}'s land is revealed to every page as it enters the battlefield`, async () => {
        for (const q of everyone) await expect.poll(async () => (await state(q)).cards[land]?.identity).toEqual(ref);
      });
      return land;
    };

    // ==============================================================================================================
    // Two-Headed Giant
    // ==============================================================================================================
    const room = freshRoom();
    const A: Player = { name: 'Anna', seat: 's0', deck: GW, profile: profileFor(info, 'a'), page: await newPage('Anna'), received: [] };
    const B: Player = { name: 'Ben', seat: 's1', deck: UR, profile: profileFor(info, 'b'), page: await newPage('Ben'), received: [] };
    const C: Player = { name: 'Cleo', seat: 's2', deck: UR, profile: profileFor(info, 'c'), page: await newPage('Cleo'), received: [] };
    const D: Player = { name: 'Dan', seat: 's3', deck: GW, profile: profileFor(info, 'd'), page: await newPage('Dan'), received: [] };
    const V = { name: 'Viv', profile: profileFor(info, 'v'), page: await newPage('Viv (spectator)'), received: [] as NetMessageRecord[] };
    const players = [A, B, C, D];
    const teamOf = (p: Player) => (p === A || p === B ? 't0' : 't1');
    const mateOf = (p: Player) => ({ s0: B, s1: A, s2: D, s3: C })[p.seat];
    const pagesOf = (ps: Player[]) => ps.map((p) => p.page);
    const all = () => [...pagesOf(players), V.page];

    const lobbyOk = await step('2HG lobby: Anna hosts Two-Headed Giant with the pass timer off; three join by the link; Viv watches by the watch link; all four Ready; Anna starts', async () => {
      await openTableGame('2hg', players, room, async () => {
        // The lobby's teams: chairs 1-2 and 3-4.
        const st = await state(A.page);
        expect(st.teams.t0?.seats).toEqual(['s0', 's1']);
        expect(st.teams.t1?.seats).toEqual(['s2', 's3']);
        await expect(A.page.getByTestId('lobby-teams')).toContainText('Anna & Ben');
        await expect(A.page.getByTestId('lobby-teams')).toContainText('Cleo & Dan');
        // Viv joins from the start page with the watch link the lobby offers (DESIGN "Players, seats and formats", Spectators).
        const watchLink = await A.page.getByTestId('watch-link').inputValue();
        await openWith(V.page, '/lobby', V.profile, browserName);
        await startPageLoaded(V.page);
        await V.page.getByTestId('nickname').fill(V.name);
        await V.page.getByTestId('join-link').fill(watchLink);
        await V.page.getByTestId('join-table').click();
        await expect(V.page).toHaveURL(/\/watch$/);
        await expect(V.page.getByTestId('spectator-view')).toBeVisible({ timeout: 20_000 });
        await expect(A.page.getByTestId('spectator-name')).toHaveText(V.name);
        expect(Object.values((await state(A.page)).seats)).toHaveLength(4);
      });
      await expect(V.page.getByTestId('spectator-view')).toHaveAttribute('data-stage', 'match', { timeout: 20_000 });
      await expect(V.page.getByTestId('spectator-badge')).toHaveText('Watching');
      await converged(all());
    });
    if (!lobbyOk) {
      await context.close();
      expect(failures).toEqual([]);
      return;
    }

    await step('2HG: every page sees its own seat at the bottom; teammates side by side', async () => {
      for (const p of players) await ownSeatAtBottom(p.page, p.seat);
      const v = (await tableView(A.page))!;
      const t = (s: string) => v.seats.find((x) => x.seat === s)!;
      expect(t('s0').angle).toBe(t('s1').angle);
      expect(t('s2').angle).toBe(t('s3').angle);
      expect(Math.abs(t('s0').angle - t('s2').angle)).toBe(180);
    });

    for (const p of players) await step(`2HG: ${p.name} shuffles (S) and draws seven (Shift+D)`, () => openingHand(p, all().filter((x) => x !== p.page)));

    await step('2HG: each teammate\'s page shows the partner\'s hand as a second fan; opponents and the spectator show none', async () => {
      const fan = (page: Page, seat: string) =>
        page.locator(`[data-testid=team-hand][data-seat=${seat}] [data-testid=team-hand-card]`).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-card') ?? '', sid: e.getAttribute('data-sid') ?? '' })));
      for (const p of players) {
        const mate = mateOf(p);
        const sec = await secrets(mate.page);
        const want = sec.hand.map((id) => ({ id, sid: sec.identities[id]!.card.sid }));
        await expect.poll(() => fan(p.page, mate.seat), { timeout: 20_000 }).toEqual(want);
        for (const o of players.filter((x) => teamOf(x) !== teamOf(p))) expect(await fan(p.page, o.seat)).toEqual([]);
      }
      await expect(V.page.getByTestId('team-hand')).toHaveCount(0);
      await expect(B.page.getByTestId('team-hand-label')).toContainText('Anna');
      await focus(B.page);
      await sceneIdle(B.page);
      await shot(B.page, 'M3', 'team-hand-seat2', project);
      await focus(C.page);
      await sceneIdle(C.page);
      await shot(C.page, 'M3', 'team-hand-seat3', project);
    });

    // ------------------------------------------------------------------------------------------------------------
    // Voice: everyone joins; Ben's talk-mode indicator through its states.
    // ------------------------------------------------------------------------------------------------------------
    const indicator = (page: Page) => page.getByTestId('talk-indicator');
    const talkShot = async (shown: TalkIndicatorState | 'turn') => {
      await sceneIdle(B.page);
      await shot(B.page, 'M3', `talk-${shown}`, project);
    };
    const voiceOk = await step('voice: before joining, the indicator says the mic is off; each player joins voice with a click', async () => {
      await focus(B.page);
      await expect(indicator(B.page)).toHaveAttribute('data-state', 'noMic');
      await talkShot('noMic');
      for (const p of players) {
        await p.page.bringToFront();
        await p.page.getByTestId('voice-join').click();
        try {
          await expect(indicator(p.page)).toHaveAttribute('data-state', 'idle');
        } catch (e) {
          const fake = await p.page.evaluate(() => (window as unknown as { __fakeMicLog?: unknown }).__fakeMicLog ?? null);
          const said = await p.page.getByTestId('voice-error').textContent().catch(() => null);
          throw new Error(`${p.name} could not join voice (${said ?? 'no error shown'}; fake mic log ${JSON.stringify(fake)}): ${firstLine(e)}`, { cause: e });
        }
      }
      // One outgoing track per connection, all closed.
      for (const p of players) {
        const want = JSON.stringify(players.filter((q) => q !== p).map((q) => [q.seat, false]));
        // The spectator's connection carries a track too (seat null): spectators hear the table (DECISIONS [M3-G]).
        await expect.poll(async () => JSON.stringify((await tracks(p.page)).filter((t) => t.seat !== null).map((t) => [t.seat, t.enabled]).sort()), { message: `${p.name}'s tracks: ${JSON.stringify(await tracks(p.page))}` }).toBe(want);
        expect((await tracks(p.page)).every((t) => !t.enabled)).toBe(true);
      }
      await focus(B.page);
      await talkShot('idle');
    });
    if (voiceOk) {
      /** Seats (and 'spectator' for a spectator's connection) whose outgoing track is open. */
      const openTo = async (page: Page) => (await tracks(page)).filter((t) => t.enabled).map((t) => t.seat ?? 'spectator').sort();
      const players3 = async (page: Page) => (await openTo(page)).filter((s) => s !== 'spectator');
      await step('voice: push-to-talk (hold V) opens Ben\'s track to everyone; releasing closes it', async () => {
        await focus(B.page);
        await B.page.keyboard.down('v');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'live');
        await expect.poll(() => players3(B.page)).toEqual(['s0', 's2', 's3']);
        await expect(A.page.locator('[data-testid="avatar"][data-seat="s1"]')).toHaveAttribute('data-speaking', 'true');
        await talkShot('live');
        await B.page.keyboard.up('v');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'idle');
        await expect.poll(() => openTo(B.page)).toEqual([]);
      });
      await step('voice: team talk (Shift+V) opens Ben\'s track to Anna only', async () => {
        await focus(B.page);
        await B.page.keyboard.down('Shift');
        await B.page.keyboard.down('v');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'team');
        await expect.poll(() => openTo(B.page)).toEqual(['s0']);
        expect(await talk(B.page)).toMatchObject({ audio: 'team' });
        await talkShot('team');
        await B.page.keyboard.up('v');
        await B.page.keyboard.up('Shift');
        await expect.poll(() => openTo(B.page)).toEqual([]);
      });
      await step('voice: M mutes; the held talk key then opens nothing; M again unmutes', async () => {
        await focus(B.page);
        await B.page.keyboard.press('KeyM');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'muted');
        await B.page.keyboard.down('v');
        await frames(B.page);
        expect(await openTo(B.page)).toEqual([]);
        await talkShot('muted');
        await B.page.keyboard.up('v');
        await B.page.keyboard.press('KeyM');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'idle');
      });
      await step('voice: the turn mic opens Ben\'s track for his team\'s turn (team t0 is active)', async () => {
        await focus(B.page);
        expect((await state(B.page)).turn.active).toBe('t0');
        await B.page.getByTestId('voice-settings').click();
        await B.page.getByTestId('talk-gate-turn').check();
        await expect(indicator(B.page)).toHaveAttribute('data-gate', 'turn');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'live');
        await expect.poll(() => players3(B.page)).toEqual(['s0', 's2', 's3']);
        expect(await talk(B.page)).toMatchObject({ audio: 'all', reason: 'turn' });
        await talkShot('turn');
        await B.page.getByTestId('talk-gate-ptt').check();
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'idle');
        await expect.poll(() => openTo(B.page)).toEqual([]);
      });
      await step('voice: dictation only (voice off): the held talk key dictates and sends no audio', async () => {
        await focus(B.page);
        if (!(await B.page.getByTestId('voice-panel').isVisible())) await B.page.getByTestId('voice-settings').click();
        await B.page.getByTestId('talk-dictation').check();
        await B.page.getByTestId('talk-voice').uncheck();
        await B.page.getByTestId('voice-settings').click();
        await neutral(B.page);
        await B.page.keyboard.down('v');
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'dictating');
        expect(await openTo(B.page)).toEqual([]);
        await talkShot('dictating');
        await B.page.keyboard.up('v');
        await B.page.getByTestId('voice-settings').click();
        await B.page.getByTestId('talk-voice').check();
        await B.page.getByTestId('talk-dictation').uncheck();
        await B.page.getByTestId('voice-settings').click();
        await expect(indicator(B.page)).toHaveAttribute('data-state', 'idle');
      });
    }

    // ------------------------------------------------------------------------------------------------------------
    // Stack and turn helpers
    // ------------------------------------------------------------------------------------------------------------
    const everyone = () => all();
    /** Cast a hand card (C on the hovered card): it goes on top of the stack with its identity, and a round starts. */
    const cast = async (p: Player, id: string) => {
      await focus(p.page);
      await hoverHand(p.page, id);
      await p.page.keyboard.press('KeyC');
      const ref = (await secrets(p.page)).identities[id]!.card;
      for (const q of everyone()) await expect.poll(async () => (await state(q)).stack.at(-1)?.card).toBe(id);
      await soft(`${p.name}'s cast spell becomes public on every page`, async () => {
        for (const q of everyone()) await expect.poll(async () => (await state(q)).cards[id]?.identity).toEqual(ref);
      });
      await expect.poll(async () => (await state(p.page)).confirm?.about).toBe((await state(p.page)).stack.at(-1)!.id);
    };
    /** `p` answers the confirmation prompt with OK (Enter). */
    const ok = async (p: Player) => {
      await focus(p.page);
      await expect(p.page.getByTestId('confirm-prompt')).toBeVisible();
      await p.page.keyboard.press('Enter');
      await expect.poll(async () => (await state(p.page)).confirm?.responses[p.seat] ?? 'ok').toBe('ok');
    };
    /** `p` holds (H) in the current round. */
    const hold = async (p: Player) => {
      await focus(p.page);
      await expect(p.page.getByTestId('confirm-prompt')).toBeVisible();
      await p.page.keyboard.press('KeyH');
      for (const q of everyone()) await expect.poll(async () => (await state(q)).confirm?.holder).toBe(p.seat);
    };
    /** Everyone but the asker answers OK. */
    const allOk = async (asker: Player) => {
      for (const q of players) if (q !== asker) await ok(q);
      await expect.poll(async () => {
        const st = await state(asker.page);
        return players.filter((q) => q !== asker).every((q) => st.confirm?.responses[q.seat] === 'ok');
      }).toBe(true);
    };
    /** Resolve the top item (R) from `p`'s page and wait until it left the stack on every page. */
    const resolveTop = async (p: Player) => {
      await focus(p.page);
      const top = (await state(p.page)).stack.at(-1)!;
      await p.page.keyboard.press('KeyR');
      for (const q of everyone()) await expect.poll(async () => (await state(q)).stack.some((i) => i.id === top.id)).toBe(false);
    };
    /** Cast a creature and resolve it to the caster's battlefield, everyone else passing with OK. */
    const castCreature = async (p: Player, pred: (c: { name: string; type_line: string }) => boolean, what: string): Promise<string> => {
      const id = await tutor(p, pred, what);
      await cast(p, id);
      await allOk(p);
      await resolveTop(p);
      for (const q of everyone()) await expect.poll(async () => (await state(q)).cards[id]?.zone).toBe(`battlefield:${p.seat}`);
      return id;
    };
    /** `p` passes the turn (Ctrl+Enter); every page agrees on the new turn and the other team being active. */
    const passTurn = async (p: Player, number: number, next: string) => {
      await focus(p.page);
      await p.page.keyboard.press('Control+Enter');
      for (const q of everyone()) await expect.poll(async () => (await state(q)).turn).toMatchObject({ number, active: next });
    };

    const creature: Record<string, string> = {};

    // Turn 1 (team t0): a land and a creature each for Anna and Ben.
    await step('2HG turn 1 starts with team t0 (Anna and Ben) active, one shared turn marker', async () => {
      for (const q of everyone()) expect((await state(q)).turn).toMatchObject({ number: 1, active: 't0' });
    });
    for (const p of [A, B]) {
      await step(`2HG turn 1: ${p.name} plays a land (drag from the hand)`, async () => {
        await playLand(p, everyone());
      });
      await step(`2HG turn 1: ${p.name} casts a creature; the three others answer OK; it resolves (R)`, async () => {
        creature[p.seat] = await castCreature(p, (c) => isCreature(c) && !isLand(c), 'creature');
      });
    }
    await step('2HG turn 1: every page on the same state hash', async () => {
      await converged(everyone());
    });
    await step('2HG layout from seat 1 (Anna) and seat 3 (Cleo)', async () => {
      for (const p of [A, C]) {
        await focus(p.page);
        await p.page.keyboard.press('Digit0');
        await cameraIdle(p.page);
        await sceneIdle(p.page);
      }
      await shot(A.page, 'M3', 'layout-2hg-seat1', project);
      await shot(C.page, 'M3', 'layout-2hg-seat3', project);
    });
    await step('2HG turn 1: Anna passes the turn to team t1 (Ctrl+Enter)', () => passTurn(A, 2, 't1'));

    // Turn 2 (team t1): a land each for Cleo and Dan.
    for (const p of [C, D]) {
      await step(`2HG turn 2: ${p.name} plays a land (drag from the hand)`, async () => {
        await playLand(p, everyone());
      });
    }
    await step('2HG turn 2: Dan passes the turn to team t0 (Ctrl+Enter)', () => passTurn(D, 3, 't0'));

    // Turn 3 (team t0): the three-way stack.
    let spell = '';
    let scatter = '';
    let shock = '';
    await step('2HG turn 3: Anna casts a creature (C); a round starts for Ben, Cleo and Dan', async () => {
      spell = await tutor(A, (c) => isCreature(c) && !isLand(c), 'creature');
      await cast(A, spell);
      for (const p of [B, C, D]) await expect(p.page.getByTestId('confirm-prompt')).toBeVisible();
    });
    await step('2HG turn 3: Cleo holds (H) and casts Essence Scatter at Anna\'s spell (right-drag between stack items)', async () => {
      await hold(C);
      scatter = await tutor(C, named('Essence Scatter'), 'Essence Scatter');
      await cast(C, scatter);
      await rightDrag(C.page, await stackStrip(C.page, scatter), await stackStrip(C.page, spell));
      const item = (await state(A.page)).stack.find((i) => i.card === scatter)!;
      const target = (await state(A.page)).stack.find((i) => i.card === spell)!;
      for (const q of everyone()) {
        await expect
          .poll(async () => Object.values((await state(q)).lines).filter((l) => l.kind === 'target' && l.from.kind === 'stackItem' && l.from.id === item.id && l.to.kind === 'stackItem' && l.to.id === target.id).length)
          .toBe(1);
      }
    });
    await step('2HG turn 3: Ben holds (H) and casts Shock at Cleo (right-drag to her avatar): three items by three players', async () => {
      await hold(B);
      shock = await tutor(B, named('Shock'), 'Shock');
      await cast(B, shock);
      await rightDrag(B.page, await stackStrip(B.page, shock), await avatarAt(B.page, 's2'));
      for (const q of everyone()) {
        await expect.poll(async () => (await state(q)).stack.map((i) => [i.card, i.controller])).toEqual([
          [spell, 's0'],
          [scatter, 's2'],
          [shock, 's1'],
        ]);
        await expect.poll(async () => Object.values((await state(q)).lines).filter((l) => l.kind === 'target').length).toBe(2);
        await expect.poll(async () => Object.values((await state(q)).lines).filter((l) => l.kind === 'target' && l.to.kind === 'seat' && l.to.id === 's2').length).toBe(1);
      }
      for (const p of [A, C]) {
        await focus(p.page);
        await p.page.mouse.move(1000, 160);
        await sceneIdle(p.page);
      }
      await shot(A.page, 'M3', 'stack-three-way-seat1', project);
      await shot(C.page, 'M3', 'stack-three-way-seat3', project);
      await sceneIdle(V.page);
      await shot(V.page, 'M3', 'stack-three-way-spectator', project);
    });
    await step('2HG turn 3: Anna, Cleo and Dan answer OK; Ben resolves Shock (R); Cleo\'s team loses 2 on the shared total (− twice)', async () => {
      await allOk(B);
      await resolveTop(B);
      await focus(C.page);
      const minus = C.page.locator('[data-testid="avatar"][data-seat="s2"] [data-testid="life-minus"]');
      await minus.click();
      await minus.click();
      for (const q of everyone()) {
        await expect.poll(async () => (await state(q)).teams.t1?.life).toBe(28);
        expect((await state(q)).teams.t0?.life).toBe(30);
      }
    });
    await step('2HG turn 3: Essence Scatter resolves (R by Cleo); Anna\'s creature spell is countered (Shift+R by Cleo)', async () => {
      await resolveTop(C);
      await expect.poll(async () => (await state(A.page)).cards[scatter]?.zone).toBe('graveyard:s2');
      await focus(C.page);
      await C.page.keyboard.press('Shift+KeyR');
      for (const q of everyone()) {
        await expect.poll(async () => (await state(q)).cards[spell]?.zone).toBe('graveyard:s0');
        await expect.poll(async () => (await state(q)).stack).toEqual([]);
        expect(Object.values((await state(q)).lines).filter((l) => l.kind === 'target')).toEqual([]);
      }
    });

    // Combat: attacks against both opponents.
    await step('2HG turn 3: Anna and Ben attack (A) and draw attack lines to Cleo and Dan (right-drag to the avatars)', async () => {
      for (const [p, target] of [
        [A, 's2'],
        [B, 's3'],
      ] as const) {
        const id = creature[p.seat];
        if (!id) throw new Error(`${p.name} has no creature on the battlefield`);
        await focus(p.page);
        await hoverTable(p.page, id);
        await p.page.keyboard.press('KeyA');
        for (const q of everyone()) await expect.poll(async () => (await state(q)).cards[id]).toMatchObject({ combat: 'attack', tapped: true });
        await rightDrag(p.page, await centreOf(p.page, id), await avatarAt(p.page, target));
        for (const q of everyone()) {
          await expect
            .poll(async () => Object.values((await state(q)).lines).filter((l) => l.kind === 'attack' && l.from.kind === 'card' && l.from.id === id && l.to.kind === 'seat' && l.to.id === target).length)
            .toBe(1);
        }
      }
      for (const p of [A, C]) {
        await focus(p.page);
        await sceneIdle(p.page);
      }
      await shot(A.page, 'M3', 'attacks-both-opponents-seat1', project);
      await shot(C.page, 'M3', 'attacks-both-opponents-seat3', project);
    });

    // Team reveal: Dan shows a hand card to the opposing team.
    let revealed = '';
    await step('2HG turn 3: Dan reveals a hand card to team Anna & Ben (W on the hovered hand card, the team in the menu)', async () => {
      revealed = (await handWhere(D.page, (c) => !isLand(c))) ?? (await secrets(D.page)).hand[0]!;
      await focus(D.page);
      await hoverHand(D.page, revealed);
      await D.page.keyboard.press('KeyW');
      const menu = D.page.getByTestId('reveal-to');
      await expect(menu).toBeVisible();
      await expect(menu.locator('button[data-seat="team:t0"]')).toContainText('Anna & Ben');
      await menu.locator('button[data-seat="team:t0"]').click();
      const ref = (await secrets(D.page)).identities[revealed]!.card;
      for (const p of [A, B]) await expect.poll(async () => (await secrets(p.page)).received?.[revealed]?.card).toEqual(ref);
      // Public state never learns it, and the spectator receives nothing.
      for (const q of everyone()) expect((await state(q)).cards[revealed]?.identity).toBeUndefined();
      expect((await secrets(V.page)).received?.[revealed]).toBeUndefined();
      await focus(A.page);
      await sceneIdle(A.page);
      await shot(A.page, 'M3', 'team-reveal-seat1', project);
    });

    // Captions (fake engine): Anna dictates while holding the talk key; the caption hangs at her last-touched card.
    await step('2HG turn 3: captions: Anna dictates (fake engine); the caption is anchored to her attacker on every page and stored on that action in the log', async () => {
      const ready = await A.page.evaluate(() => typeof (window.__spellplane as { speech?: { say?: unknown } } | undefined)?.speech?.say === 'function');
      if (!ready) throw new Error('window.__spellplane.speech is not registered: dictation and captions (M3-P4) are missing from this build');
      const attacker = creature.s0!;
      await focus(A.page);
      await A.page.getByTestId('voice-settings').click();
      await A.page.getByTestId('talk-dictation').check();
      await A.page.getByTestId('voice-settings').click();
      // Touch the attacker (hover plus a ping, I) so it is the last card Anna acted on.
      await hoverTable(A.page, attacker);
      await A.page.keyboard.press('KeyI');
      await neutral(A.page);
      await A.page.keyboard.down('v');
      await expect.poll(() => hook<string | null>(A.page, 'speech.engine')).toBe('fake');
      const text = 'swinging at both of you';
      await expect.poll(() => hook<boolean>(A.page, 'speech.say', 'swinging at', false)).toBe(true);
      await hook(A.page, 'speech.say', text, true);
      await A.page.keyboard.up('v');
      // Every page at once: the final bubble fades a few seconds after the final result (scene/types.ts DebugCaption).
      await Promise.all(
        everyone().map((q) =>
          expect
            .poll(async () => (await hook<DebugCaption[]>(q, 'speech.drawn')).some((c) => c.text.includes(text) && c.anchoredTo?.kind === 'card' && c.anchoredTo.id === attacker))
            .toBe(true),
        ),
      );
      // Evidence while the bubble still shows.
      await Promise.all([A, C].map((p) => shot(p.page, 'M3', `captions-on-cards-seat${p === A ? 1 : 3}`, project)));
      for (const q of everyone()) {
        await expect
          .poll(async () => (await log(q)).some((e) => e.kind === 'action' && e.action.type === 'caption' && e.action.text.includes(text) && e.action.anchor?.kind === 'card' && e.action.anchor.id === attacker))
          .toBe(true);
      }
    });

    await step('2HG turn 3: the attack lands: Dan takes 3 more on the team total (− three times); Anna settles (B)', async () => {
      await focus(D.page);
      const minus = D.page.locator('[data-testid="avatar"][data-seat="s3"] [data-testid="life-minus"]');
      for (let i = 0; i < 3; i++) await minus.click();
      for (const q of everyone()) await expect.poll(async () => (await state(q)).teams.t1?.life).toBe(25);
      await focus(A.page);
      await A.page.keyboard.press('KeyB');
      for (const q of everyone()) {
        await expect.poll(async () => Object.values((await state(q)).cards).filter((c) => c.combat === 'attack').length).toBe(0);
        expect(Object.values((await state(q)).lines).filter((l) => l.kind === 'attack')).toEqual([]);
      }
    });

    await step('2HG: the spectator\'s view of the table (public zones only)', async () => {
      await focus(V.page);
      await sceneIdle(V.page);
      const st = await state(V.page);
      for (const p of players) for (const id of st.zones[`hand:${p.seat}`]!.ids) expect(st.cards[id]!.identity).toBeUndefined();
      expect(await secrets(V.page)).toMatchObject({ identities: {}, received: {} });
      await shot(V.page, 'M3', 'spectator-view', project);
    });

    await step('2HG: all five pages end on the same state hash', async () => {
      const h = await converged(everyone());
      expect(h).toMatch(/^[0-9a-f]{64}$|^[A-Za-z0-9_-]{43}$/);
      expect(await state(V.page)).toEqual(await state(A.page));
    });

    // ------------------------------------------------------------------------------------------------------------
    // Leak scan: no team hand (or library) reaches an opponent; the spectator receives no hidden card.
    // ------------------------------------------------------------------------------------------------------------
    for (const p of players) await collect(p).catch(() => undefined);
    await collect(V).catch(() => undefined);

    /** Salts and (unless the viewer legitimately knows that printing) Scryfall ids of `owners`' hand and library cards. */
    const forbiddenFor = async (viewer: Page, owners: Player[], extraKnown: readonly string[] = []): Promise<string[]> => {
      const [vState, vSec] = await Promise.all([state(viewer), secrets(viewer)]);
      const known = new Set<string>(extraKnown);
      for (const c of Object.values(vState.cards)) if (c.identity) known.add(c.identity.sid);
      for (const r of Object.values(vSec.received ?? {})) known.add(r.card.sid);
      for (const s of Object.values(vSec.identities ?? {})) known.add(s.card.sid);
      const out: string[] = [];
      for (const o of owners) {
        const sec = await secrets(o.page);
        for (const id of [...sec.hand, ...sec.libraryOrder]) {
          const s = sec.identities[id]!;
          // A card the owner showed this viewer (a targeted reveal) is no longer hidden from it.
          if (vSec.received?.[id]) continue;
          out.push(s.salt);
          if (!known.has(s.card.sid)) out.push(s.card.sid);
        }
      }
      return out;
    };

    /** The transport id under which `viewer`'s page knows its teammate's page (debug hook `net.peers()`). */
    const mateTransport = new Map<Player, string>();
    for (const p of players) {
      const peers = await hook<{ transportId: string; seat: string | null }[]>(p.page, 'net.peers').catch(() => []);
      mateTransport.set(p, peers.find((x) => x.seat === mateOf(p).seat)?.transportId ?? '');
    }
    const teamHands = (received: NetMessageRecord[]) => received.filter((r) => (r.msg as { t?: string }).t === 'teamHand') as (NetMessageRecord & { peer?: string; msg: { cards: { ref: { sid: string } }[] } })[];
    await step('team hands reach the teammate only: every teamHand message a page received came from its teammate; the spectator received none', async () => {
      for (const p of players) {
        expect(mateTransport.get(p), `${p.name}'s page knows its teammate's connection`).toBeTruthy();
        const got = teamHands(p.received);
        expect(got.length, `teamHand messages ${p.name} received`).toBeGreaterThan(0);
        expect([...new Set(got.map((r) => r.peer))], `senders of the teamHand messages ${p.name} received`).toEqual([mateTransport.get(p)]);
      }
      expect(teamHands(V.received)).toEqual([]);
    });
    await step('leak scan is not vacuous: each teammate received the partner\'s hand (salts) on the team channel', async () => {
      for (const p of players) {
        const mate = mateOf(p);
        const sec = await secrets(mate.page);
        const salts = sec.hand.map((id) => sec.identities[id]!.salt);
        expect(salts.length).toBeGreaterThan(0);
        expect(scan([p.received], salts).length, `${mate.name}'s hand salts in ${p.name}'s received messages`).toBeGreaterThan(0);
      }
    });
    for (const viewer of players) {
      const opponents = players.filter((o) => teamOf(o) !== teamOf(viewer));
      await step(`leak scan: nothing ${viewer.name}'s page received, holds or stores names a hidden card of ${opponents.map((o) => o.name).join(' or ')} (no team hand reached an opponent)`, async () => {
        // The teammate's hand (its team-channel messages) names printings the viewer legitimately knows; with the same
        // fixture deck on both teams the opponents hold the same printings, so those Scryfall ids are no evidence of a
        // leak. Salts stay forbidden: they are unique per card.
        const mate = mateTransport.get(viewer);
        const mateSids = teamHands(viewer.received)
          .filter((r) => r.peer === mate)
          .flatMap((r) => r.msg.cards.map((c) => c.ref.sid));
        const forbidden = await forbiddenFor(viewer.page, opponents, mateSids);
        expect(forbidden.length).toBeGreaterThan(100);
        expect(viewer.received.length, `${viewer.name}'s captured messages`).toBeGreaterThan(0);
        const stores = await dumpStores(viewer.page, viewer.profile);
        const hits = scan([viewer.received, await state(viewer.page), await secrets(viewer.page), stores], forbidden);
        if (hits.length) {
          const kinds = [...new Set(hits.map((h) => (h.index === 0 ? `msg:${(viewer.received[Number(/^\$\[(\d+)\]/.exec(h.path)?.[1] ?? -1)]?.msg as { t?: string } | undefined)?.t ?? '?'}` : `value${h.index}:${h.path.split('.').slice(0, 3).join('.')}`)))];
          fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
          fs.writeFileSync(path.join('artifacts', 'gate', `M3-leak-${viewer.name}-${project}.json`), JSON.stringify({ hits: hits.slice(0, 20), messages: [...new Set(hits.filter((h) => h.index === 0).map((h) => Number(/^\$\[(\d+)\]/.exec(h.path)?.[1] ?? -1)))].slice(0, 5).map((i) => viewer.received[i]) }, null, 2));
          throw new Error(`${hits.length} hits in ${kinds.join(', ')}, e.g. ${JSON.stringify(hits.slice(0, 2))}`);
        }
      });
    }
    await step('leak scan: nothing the spectator\'s page received, holds or stores names a hidden card of any player', async () => {
      const forbidden = await forbiddenFor(V.page, players);
      expect(forbidden.length).toBeGreaterThan(200);
      expect(V.received.length, 'the spectator\'s captured messages').toBeGreaterThan(0);
      const stores = await dumpStores(V.page, V.profile);
      const hits = scan([V.received, await state(V.page), await secrets(V.page), stores], forbidden);
      if (hits.length) throw new Error(`${hits.length} hits, e.g. ${JSON.stringify(hits.slice(0, 4))}`);
    });

    for (const p of [...players.map((x) => x.page), V.page]) await p.close().catch(() => undefined);

    // ==============================================================================================================
    // Three-player free-for-all opening
    // ==============================================================================================================
    const ffa3: Player[] = [
      { name: 'Anna', seat: 's0', deck: GW, profile: profileFor(info, 'f3a'), page: await newPage('Anna (ffa3)'), received: [] },
      { name: 'Ben', seat: 's1', deck: UR, profile: profileFor(info, 'f3b'), page: await newPage('Ben (ffa3)'), received: [] },
      { name: 'Cleo', seat: 's2', deck: GW, profile: profileFor(info, 'f3c'), page: await newPage('Cleo (ffa3)'), received: [] },
    ];
    const ffa3Ok = await step('FFA3 lobby: Anna hosts a three-player free-for-all; Ben and Cleo join; all Ready; Anna starts', async () => {
      await openTableGame('ffa3', ffa3, freshRoom());
    });
    if (ffa3Ok) {
      const pages3 = pagesOf(ffa3);
      await step('FFA3: every page sees its own seat at the bottom; opponents at top-left and top-right', async () => {
        for (const p of ffa3) await ownSeatAtBottom(p.page, p.seat);
        const v = (await tableView(ffa3[0]!.page))!;
        const s1 = v.seats.find((s) => s.seat === 's1')!.screen!.territory;
        const s2 = v.seats.find((s) => s.seat === 's2')!.screen!.territory;
        expect(Math.abs(s1.y - s2.y)).toBeLessThan(2);
        expect(s1.x).not.toBeCloseTo(s2.x, 0);
      });
      for (const p of ffa3) {
        await step(`FFA3: ${p.name} shuffles (S), draws seven (Shift+D) and plays a land`, async () => {
          await openingHand(p, pages3.filter((x) => x !== p.page));
          await playLand(p, pages3);
        });
      }
      await step('FFA3: the turn goes clockwise: Anna passes to Ben (Ctrl+Enter)', async () => {
        await focus(ffa3[0]!.page);
        await ffa3[0]!.page.keyboard.press('Control+Enter');
        for (const q of pages3) await expect.poll(async () => (await state(q)).turn).toMatchObject({ number: 2, active: 's1' });
      });
      await step('FFA3: every page on the same state hash; nothing of an opponent\'s hand or library reached a page', async () => {
        await converged(pages3);
        for (const p of ffa3) await collect(p);
        for (const viewer of ffa3) {
          const forbidden = await forbiddenFor(viewer.page, ffa3.filter((o) => o !== viewer));
          expect(scan([viewer.received, await state(viewer.page), await secrets(viewer.page)], forbidden).slice(0, 10)).toEqual([]);
        }
      });
      await step('FFA3 layout from seat 1 (Anna) and seat 3 (Cleo)', async () => {
        for (const p of [ffa3[0]!, ffa3[2]!]) {
          await focus(p.page);
          await p.page.keyboard.press('Digit0');
          await cameraIdle(p.page);
          await sceneIdle(p.page);
        }
        await shot(ffa3[0]!.page, 'M3', 'layout-ffa3-seat1', project);
        await shot(ffa3[2]!.page, 'M3', 'layout-ffa3-seat3', project);
      });
    }
    for (const p of ffa3) await p.page.close().catch(() => undefined);

    // ==============================================================================================================
    // Four-player free-for-all opening (the last layout of the screenshot set)
    // ==============================================================================================================
    const ffa4: Player[] = [
      { name: 'Anna', seat: 's0', deck: GW, profile: profileFor(info, 'f4a'), page: await newPage('Anna (ffa4)'), received: [] },
      { name: 'Ben', seat: 's1', deck: UR, profile: profileFor(info, 'f4b'), page: await newPage('Ben (ffa4)'), received: [] },
      { name: 'Cleo', seat: 's2', deck: GW, profile: profileFor(info, 'f4c'), page: await newPage('Cleo (ffa4)'), received: [] },
      { name: 'Dan', seat: 's3', deck: UR, profile: profileFor(info, 'f4d'), page: await newPage('Dan (ffa4)'), received: [] },
    ];
    const ffa4Ok = await step('FFA4 lobby: Anna hosts a four-player free-for-all; three join; all Ready; Anna starts', async () => {
      await openTableGame('ffa4', ffa4, freshRoom());
    });
    if (ffa4Ok) {
      const pages4 = pagesOf(ffa4);
      await step('FFA4: every page sees its own seat at the bottom, one player per side', async () => {
        for (const p of ffa4) await ownSeatAtBottom(p.page, p.seat);
        const v = (await tableView(ffa4[0]!.page))!;
        expect(v.seats.map((s) => s.angle).sort((x, y) => x - y)).toEqual([0, 90, 180, 270]);
      });
      for (const p of ffa4) {
        await step(`FFA4: ${p.name} shuffles (S), draws seven (Shift+D) and plays a land`, async () => {
          await openingHand(p, pages4.filter((x) => x !== p.page));
          await playLand(p, pages4);
        });
      }
      await step('FFA4: every page on the same state hash', async () => {
        await converged(pages4);
      });
      await step('FFA4 layout from seat 1 (Anna) and seat 3 (Cleo)', async () => {
        for (const p of [ffa4[0]!, ffa4[2]!]) {
          await focus(p.page);
          await p.page.keyboard.press('Digit0');
          await cameraIdle(p.page);
          await sceneIdle(p.page);
        }
        await shot(ffa4[0]!.page, 'M3', 'layout-ffa4-seat1', project);
        await shot(ffa4[2]!.page, 'M3', 'layout-ffa4-seat3', project);
      });
    }

    await step('no page error and no request leaves the test server', async () => {
      if (errors.length || outside.length) throw new Error(`page errors: ${JSON.stringify(errors.slice(0, 10))}; outside requests: ${JSON.stringify(outside.slice(0, 10))}`);
    });

    await info.attach('gate-gaps.json', { body: JSON.stringify({ failures, gaps }, null, 2), contentType: 'application/json' });
    fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
    fs.writeFileSync(path.join('artifacts', 'gate', `M3-${project}.json`), JSON.stringify({ failures, gaps }, null, 2));
    await context.close();
    expect(failures).toEqual([]);
  });
});
