/**
 * Gate M1-G (docs/PLAN.md, Milestone 1): two pages on the broadcast transport (`?transport=local`, distinct
 * `?profile=`) play a scripted 1v1 game with the fixture decks: both Ready with a deck, mulligans, eight turns with
 * lands, spells through the stack with targets and a counterspell (Essence Scatter), a hold in response, combat with a
 * double block, a face-down card revealed to the opponent only, a dice roll and life changes down to zero. During the
 * game each page is reloaded once and the sequencer's page is closed and reopened. Both pages end on the same state
 * hash, and the shared leak scan (tests/leak/scan.ts) finds no Scryfall id or salt of a card that stayed in the other
 * player's hand or library in anything a page received (debug hook `net.messages()`), holds in state or keeps in its
 * stores (SecretStore, IndexedDB).
 *
 * Every step uses the design's UI path (lobby controls, keys on hovered cards, drags, right-drags, the prompt, the
 * reveal menu, the avatar's life control); a face-down play from the hand is F on the hovered hand card. Engine behaviour is asserted on state hashes
 * and the debug hook, never on pixels; the screenshots (lobby, connectivity failure, opponent view, stack with three
 * items and targets, confirmation prompt, combat with blocks, away seat) are review evidence in artifacts/shots/M1/.
 *
 * The scripted game is one test whose steps are recorded: a failed step is listed and the game goes on where it can,
 * so one run shows every gap; the test fails if any step failed. BroadcastChannel joins pages of one browser
 * context only, so both players share a context and are kept apart by their profiles (namespaced IndexedDB, own key
 * pair).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretStore, TableState } from '../../src/core/types';
import type { NetMessageRecord } from '../../src/net/types';
import type { DebugStackEntry } from '../../src/scene/stack';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import { scan } from '../leak/scan';
import { hook, shot } from './helpers/app';
import { chair, decklist, freshProfile, freshRoom, open, openTable, setNickname } from './lobby/helpers';

/** sid -> name and type line from the recorded fixtures. */
const FIXTURE_CARDS = new Map<string, { name: string; type_line: string }>(
  ['m19.json', 'tm19.json'].flatMap((f) =>
    (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as { id: string; name: string; type_line: string }[]).map((c) => [c.id, { name: c.name, type_line: c.type_line }] as const),
  ),
);

type Seat = 's0' | 's1';
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

test.describe('M1 gate @gate', () => {
  // A missing element fails its step instead of waiting out the whole game.
  test.use({ actionTimeout: 10_000 });

  test('connectivity failure: a network that never connects says so plainly, with remedies', async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(() => {
      window.__spellplaneTransport = 'silent';
    });
    const room = freshRoom();
    await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, 'g-silent') });
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    await setNickname(page, 'Ann');
    await page.clock.fastForward(130_000);
    const problem = page.getByTestId('connectivity-problem');
    await expect(problem).toBeVisible();
    await expect(problem).toHaveAttribute('role', 'alert');
    await expect(problem).toContainText('another network, a phone hotspot or a VPN');
    await shot(page, 'M1', 'connectivity-failure', info.project.name);
  });

  test('two pages play a scripted 1v1 game to the same state hash, and the leak scan finds nothing', async ({ browser }, info) => {
    test.setTimeout(600_000);
    const project = info.project.name;
    const failures: string[] = [];
    /** Steps without a UI path that the gate drives through the debug hook (none since F plays a hand card face down). */
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
    const room = freshRoom();
    const A: Player = { name: 'Ann', seat: 's0', deck: 'gw-m19-60.txt', profile: freshProfile(info, 'ga'), page: await newPage('Ann'), received: [] };
    const B: Player = { name: 'Ben', seat: 's1', deck: 'ur-m19-60.mtga.txt', profile: freshProfile(info, 'gb'), page: await newPage('Ben'), received: [] };
    const other = (p: Player) => (p === A ? B : A);
    const both = [A, B];

    const hasNet = (page: Page) => page.evaluate(() => typeof (window.__spellplane as { net?: { messages?: unknown } } | undefined)?.net?.messages === 'function');
    /** Move what the page received so far into the player's record (it is lost on reload). */
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

    // ------------------------------------------------------------------------------------------------------------
    // Lobby: both open the link, choose nicknames, Ready with a fixture deck; the host starts.
    // ------------------------------------------------------------------------------------------------------------
    const lobbyOk = await step('lobby: both join, take chairs and press Ready with a fixture deck', async () => {
      await openTable(A.page, room, A.profile);
      await setNickname(A.page, A.name);
      await openTable(B.page, room, B.profile);
      await setNickname(B.page, B.name);
      await expect(chair(A.page, 's1')).toContainText(B.name);
      await expect(chair(B.page, 's0')).toContainText(A.name);
      await expect(chair(A.page, 's0')).toHaveAttribute('data-mine', 'true');
      await expect(chair(B.page, 's1')).toHaveAttribute('data-mine', 'true');
      for (const p of both) {
        await p.page.getByTestId('lobby-deck-text').fill(decklist(p.deck));
        await p.page.getByTestId('lobby-deck-check').click();
        await expect(p.page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
        await p.page.getByTestId('ready').click();
        await expect(p.page.getByTestId('ready-done')).toContainText('60 cards is committed');
      }
      await expect(A.page.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
      await expect(chair(B.page, 's0')).toHaveAttribute('data-ready', 'true');
      await expect(A.page.getByTestId('connectivity-problem')).toHaveCount(0);
      await shot(A.page, 'M1', 'lobby', project);
      // Ready published commitments only.
      const st = await state(B.page);
      expect(st.commitments.s0?.commits).toHaveLength(60);
      expect(st.commitments.s1?.commits).toHaveLength(60);
      await A.page.getByTestId('start-game').click();
      for (const p of both) await waitHud(p);
    });
    if (!lobbyOk) {
      await context.close();
      expect(failures).toEqual([]);
      return;
    }

    let sequencer: Player = A;
    await step('the networked session is wired: debug hook net part on both pages, a sequencer is elected', async () => {
      for (const p of both) expect(await hasNet(p.page), `window.__spellplane.net on ${p.name}'s page (M1-P8 networked session)`).toBe(true);
      const [seqA, seqB, selfA] = await Promise.all([hook<string>(A.page, 'net.sequencer'), hook<string>(B.page, 'net.sequencer'), hook<string>(A.page, 'net.self')]);
      expect(seqA).not.toBe('');
      expect(seqA).toBe(seqB);
      sequencer = seqA === selfA ? A : B;
    });

    // ------------------------------------------------------------------------------------------------------------
    // Opening hands: shuffle (S), draw seven (Shift+D 7 Enter); the opponent sees backs.
    // ------------------------------------------------------------------------------------------------------------
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
      const host = (await B.page.getByTestId('scene-host').boundingBox({ timeout: 5000 }))!;
      for (const c of (await shown(B.page)).filter((x) => hand.includes(x.id))) expect(c.screen.y + c.screen.height / 2).toBeLessThan(host.y + host.height / 2);
      const st = await state(B.page);
      for (const id of hand) expect(st.cards[id]?.identity).toBeUndefined();
      await sceneIdle(B.page);
      await shot(B.page, 'M1', 'opponent-view', project);
    });

    // ------------------------------------------------------------------------------------------------------------
    // Mulligans: each player Ctrl+M (shuffle the hand in, draw seven), then bottoms one card by hand (Shift+L).
    // ------------------------------------------------------------------------------------------------------------
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
        await expect.poll(async () => (await state(other(p).page)).zones[`library:${p.seat}`]?.ids.length).toBe(54);
      });
    }

    // ------------------------------------------------------------------------------------------------------------
    // Turn helpers
    // ------------------------------------------------------------------------------------------------------------

    /** Search the own library (avatar zone button, Search) for a card and put it into the hand (H); closing shuffles. */
    const tutor = async (p: Player, pred: (c: { name: string; type_line: string }) => boolean, what: string): Promise<string> => {
      const have = await handWhere(p.page, pred);
      if (have) return have;
      const page = p.page;
      await focus(p);
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

    const landsPlayed = { s0: 0, s1: 0 } as Record<Seat, number>;
    /** Drag a land from the hand fan onto the own battlefield; both pages see it face up with its identity. */
    const playLand = async (p: Player) => {
      const page = p.page;
      const land = await tutor(p, isLand, 'land');
      await focus(p);
      await hoverHand(page, land);
      const vp = page.viewportSize()!;
      const lb = (await page.locator(`[data-testid="hand-card"][data-card="${land}"]`).boundingBox({ timeout: 5000 }))!;
      const k = landsPlayed[p.seat]++;
      await page.mouse.down();
      await page.mouse.move(lb.x + lb.width / 2, vp.height * 0.72, { steps: 6 });
      await page.mouse.move(vp.width * (0.22 + 0.045 * k), vp.height * 0.66, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`battlefield:${p.seat}`);
      const ref = (await secrets(page)).identities[land]!.card;
      await soft(`${p.name}'s land is revealed to the other page as it enters the battlefield`, async () => {
        await expect.poll(async () => (await state(other(p).page)).cards[land]?.identity).toEqual(ref);
        expect((await state(other(p).page)).cards[land]?.face).toBe('up');
      });
    };

    /** The new active player takes the offered untap-and-draw (U). */
    const untapAndDraw = async (p: Player) => {
      await focus(p);
      await expect(p.page.getByTestId('untap-offer')).toBeVisible();
      const n = (await secrets(p.page)).hand.length;
      await p.page.keyboard.press('KeyU');
      await expect.poll(async () => (await secrets(p.page)).hand.length).toBe(n + 1);
      await expect(p.page.getByTestId('untap-offer')).toHaveCount(0);
    };

    /** The active player passes the turn (Ctrl+Enter); both pages agree on the new turn. */
    const passTurn = async (p: Player, number: number) => {
      await focus(p);
      await p.page.keyboard.press('Control+Enter');
      for (const q of both) await expect.poll(async () => (await state(q.page)).turn).toMatchObject({ number, active: other(p).seat });
    };

    /** Cast a hand card (C on the hovered card): it goes on top of the stack with its identity, and a round starts. */
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

    /** The other player answers the confirmation prompt with OK (Enter). */
    const ok = async (p: Player) => {
      await focus(p);
      await expect(p.page.getByTestId('confirm-prompt')).toBeVisible();
      await p.page.keyboard.press('Enter');
      await expect.poll(async () => (await state(p.page)).confirm?.responses[p.seat] ?? 'ok').toBe('ok');
    };

    /** Resolve the top item (R) from `p`'s page and wait until it left the stack on both pages. */
    const resolveTop = async (p: Player) => {
      await focus(p);
      const top = (await state(p.page)).stack.at(-1)!;
      await p.page.keyboard.press('KeyR');
      for (const q of both) await expect.poll(async () => (await state(q.page)).stack.some((i) => i.id === top.id)).toBe(false);
    };

    /** Cast a creature and resolve it to the caster's battlefield, the opponent passing with OK. */
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

    /** Reload a page mid-game: it rejoins the same seat with the same hand and catches up to the same hash. */
    const reload = async (p: Player) => {
      await step(`${p.name} reloads the page and rejoins the same seat with the same hand`, async () => {
        await collect(p);
        const before = await secrets(p.page);
        await p.page.reload();
        await waitHud(p);
        await expect.poll(async () => (await secrets(p.page)).seat).toBe(p.seat);
        await expect.poll(async () => (await secrets(p.page)).hand).toEqual(before.hand);
        expect((await secrets(p.page)).libraryOrder).toEqual(before.libraryOrder);
        await converged(A.page, B.page);
        await expect.poll(() => p.page.getByTestId('hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(before.hand);
      });
    };

    // ------------------------------------------------------------------------------------------------------------
    // Turn 1 (Ann): a land.  Turn 2 (Ben): a land.
    // ------------------------------------------------------------------------------------------------------------
    await step('turn 1 starts with Ann active', async () => {
      for (const q of both) expect((await state(q.page)).turn).toMatchObject({ number: 1, active: 's0' });
    });
    await turn(1, A, async () => undefined);
    await turn(2, B, async () => undefined);

    // Turn 3 (Ann): a creature through the stack; Ben's confirmation prompt.
    await turn(3, A, async () => {
      await step('turn 3: Ann casts a creature; Ben sees the confirmation prompt, passes with OK; Ann resolves it', async () => {
        const id = await tutor(A, (c) => isCreature(c) && !isLand(c), 'creature');
        await cast(A, id);
        await focus(B);
        const prompt = B.page.getByTestId('confirm-prompt');
        await expect(prompt).toBeVisible();
        await expect(B.page.getByTestId('confirm-ring')).toHaveAttribute('data-running', 'true');
        await sceneIdle(B.page);
        await shot(B.page, 'M1', 'confirmation-prompt', project);
        await ok(B);
        await resolveTop(A);
        await expect.poll(async () => (await state(B.page)).cards[id]?.zone).toBe('battlefield:s0');
        creatures.s0.push(id);
      });
    });

    // Turn 4 (Ben): a creature; a dice roll (Ctrl+I) with the same result on both pages.
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
        expect(ra?.purpose).toBe('die');
        // Commit-then-reveal: both seats took part (DESIGN "Multiplayer architecture": no single browser picks it).
        expect(Object.keys(rb!.commits).sort()).toEqual(['s0', 's1']);
      });
    });

    // Turn 5 (Ann): a second creature; then a third creature spell, which Ben holds against and counters with
    // Essence Scatter; Ann responds with Titanic Growth on her first creature. Three items, two target lines.
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
        await expect(A.page.locator('[data-testid="avatar"][data-seat="s1"] [data-testid="responding"]')).toBeVisible();
        await expect(A.page.getByTestId('confirm-ring')).toHaveAttribute('data-running', 'false');
      });
      await step('turn 5: Ben casts Essence Scatter and right-drags a target line to Ann\'s creature spell', async () => {
        scatter = await tutor(B, named('Essence Scatter'), 'Essence Scatter');
        await cast(B, scatter);
        await rightDrag(B.page, await stackStrip(B.page, scatter), await stackStrip(B.page, spell));
        const st = await state(A.page);
        const item = st.stack.find((i) => i.card === scatter)!;
        await expect
          .poll(async () => Object.values((await state(A.page)).lines).filter((l) => l.kind === 'target' && l.from.kind === 'stackItem' && l.from.id === item.id).length)
          .toBe(1);
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
        await shot(A.page, 'M1', 'stack-three-items', project);
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
          // Target lines live exactly as long as their item.
          expect(Object.values((await state(q.page)).lines).filter((l) => l.kind === 'target')).toEqual([]);
        }
      });
    });

    // Turn 6 (Ben): Ben attacks with the Minotaur (A); Ann blocks with both creatures (drags onto the attacker).
    await turn(6, B, async () => {
      await step('turn 6: Ben attacks (A); Ann double-blocks by dragging two creatures onto the attacker', async () => {
        const attacker = creatures.s1[0]!;
        await focus(B);
        await hoverTable(B.page, attacker);
        await B.page.keyboard.press('KeyA');
        for (const q of both) await expect.poll(async () => (await state(q.page)).cards[attacker]).toMatchObject({ combat: 'attack', tapped: true });
        await focus(A);
        const at = await centreOf(A.page, attacker);
        await dragTo(A.page, creatures.s0[0]!, at);
        await expect.poll(async () => (await state(A.page)).cards[creatures.s0[0]!]?.combat).toBe('block');
        const at2 = await centreOf(A.page, attacker);
        await dragTo(A.page, creatures.s0[1]!, { x: at2.x + 12, y: at2.y });
        for (const q of both) {
          await expect.poll(async () => (await state(q.page)).cards[creatures.s0[1]!]?.combat).toBe('block');
          await expect
            .poll(async () =>
              Object.values((await state(q.page)).lines)
                .filter((l) => l.kind === 'block' && l.to.kind === 'card' && l.to.id === attacker)
                .length,
            )
            .toBe(2);
        }
        await A.page.mouse.move(1000, 160);
        await sceneIdle(A.page);
        await shot(A.page, 'M1', 'combat-blocks', project);
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

    // Turn 7 (Ann): a card face down on the battlefield (F on a hand card), revealed to Ben only (W, Ben).
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
        // Shared state never learns it: the card stays face down without an identity on both pages.
        for (const q of both) expect((await state(q.page)).cards[hidden]).toMatchObject({ face: 'down' });
        for (const q of both) expect((await state(q.page)).cards[hidden]?.identity).toBeUndefined();
      });
    });
    await reload(B);

    // Turn 8 (Ben): Shock to Ann's face (target line to her avatar), life changes; the sequencer's page closes and
    // reopens (away seat); Ann's life goes to zero.
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
        // A plain close: Playwright's WebKit never closes a page asked to run beforeunload first.
        await sequencer.page.close();
        await expect.poll(async () => (await state(stay.page)).seats[sequencer.seat]?.away, { timeout: 15_000 }).toBe(true);
        await expect(stay.page.locator(`[data-testid="avatar"][data-seat="${sequencer.seat}"]`)).toHaveAttribute('data-away', 'true');
        await focus(stay);
        await sceneIdle(stay.page);
        await shot(stay.page, 'M1', 'away-seat', project);
      });
      await step('turn 8: the sequencer\'s page reopens and rejoins its seat with the same hand', async () => {
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

    // ------------------------------------------------------------------------------------------------------------
    // End: the same state hash, and the leak scan.
    // ------------------------------------------------------------------------------------------------------------
    await step('both pages end on the same state hash', async () => {
      const h = await converged(A.page, B.page);
      expect(h).toMatch(/^[0-9a-f]{64}$|^[A-Za-z0-9_-]{43}$/);
      expect(await state(A.page)).toEqual(await state(B.page));
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
        expect(viewer.received.length, `${viewer.name}'s captured messages`).toBeGreaterThan(0);
        const stores = await dumpStores(viewer.page, viewer.profile);
        const hits = scan([viewer.received, viewerState, viewerSecrets, stores], forbidden);
        expect(hits.slice(0, 10)).toEqual([]);
      });
    }

    await step('no page error and no request leaves the test server', async () => {
      if (errors.length || outside.length) throw new Error(`page errors: ${JSON.stringify(errors)}; outside requests: ${JSON.stringify(outside)}`);
    });

    await info.attach('gate-gaps.json', { body: JSON.stringify({ failures, gaps }, null, 2), contentType: 'application/json' });
    fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
    fs.writeFileSync(path.join('artifacts', 'gate', `M1-${project}.json`), JSON.stringify({ failures, gaps }, null, 2));
    await context.close();
    expect(failures).toEqual([]);
  });
});
