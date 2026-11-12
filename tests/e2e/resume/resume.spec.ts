/**
 * PLAN M1-P7 acceptance in the browser (DESIGN "Multiplayer architecture", Resume and failure handling): two pages on
 * `?transport=local` (BroadcastChannel; distinct `?profile=`, so distinct key pairs and IndexedDBs) with fixture decks.
 *
 * - Reloading either page mid-game rejoins the same seat with the same hand.
 * - Closing both pages and reopening either restores the table from its own save; the later arrival reconciles to the
 *   copy with the highest sequence number.
 * - The lost-save recovery through ui/recovery: a page whose save of the table is gone re-imports its deck, proposes a
 *   hand count, the other player agrees in the confirmation prompt, and the library ends at deck size minus public
 *   cards minus the agreed hand.
 */
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { decklist, freshProfile, freshRoom, open, openTable, twoPages } from '../lobby/helpers';

type Room = { roomId: string; roomKey: string };

const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const saved = (page: Page) => page.evaluate(() => window.__spellplane!.session!.saved());

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

/** Both pages agree on the state hash. */
async function sameHash(a: Page, b: Page): Promise<string> {
  await expect
    .poll(async () => {
      const [ha, hb] = await Promise.all([hashOf(a), hashOf(b)]);
      return ha === hb ? ha : `${ha} != ${hb}`;
    }, { timeout: 20_000 })
    .toMatch(/^[A-Za-z0-9_-]{20,}$/);
  return hashOf(a);
}

interface Game {
  context: BrowserContext;
  a: Page;
  b: Page;
  room: Room;
  profiles: { a: string; b: string };
}

/** Ann and Ben at one table: Ready with fixture decks, the game started, both shuffled and drew seven. */
async function game(browser: Browser, info: TestInfo): Promise<Game> {
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  const profiles = { a: freshProfile(info, 'a'), b: freshProfile(info, 'b') };
  await openTable(a, room, profiles.a);
  await openTable(b, room, profiles.b);
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  await sameHash(a, b);
  return { context, a, b, room, profiles };
}

/** Open the table link in a new page of the context (a reopened tab) and wait for the HUD. */
async function reopen(g: Game, profile: string): Promise<Page> {
  const page = await g.context.newPage();
  await open(page, `/t/${g.room.roomId}/${g.room.roomKey}`, { profile, transport: 'local' });
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
  return page;
}

/** Ben plays one card of his hand onto the battlefield (it is turned up, verified) and returns its id. */
async function benPlaysACard(b: Page): Promise<string> {
  const card = (await secrets(b)).hand[0]!;
  await b.evaluate((id) => window.__spellplane!.dispatch!({ type: 'move', card: id, to: 'battlefield:s1', pose: { x: 0, y: 300, rot: 180 } } as never), card);
  await expect.poll(async () => (await state(b)).cards[card]?.identity?.sid ?? null, { timeout: 15_000 }).not.toBeNull();
  return card;
}

test('reloading either page mid-game rejoins the same seat with the same hand', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const g = await game(browser, info);
  for (const [page, seat] of [
    [g.a, 's0'],
    [g.b, 's1'],
  ] as const) {
    const before = await secrets(page);
    expect(before.hand).toHaveLength(7);
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => hook<string>(page, 'session.seat')).toBe(seat);
    await expect.poll(async () => (await secrets(page)).hand).toEqual(before.hand);
    expect((await secrets(page)).libraryOrder).toEqual(before.libraryOrder);
    // The hand shows as faces in the reloaded page's hand fan, in the same order.
    await expect.poll(() => page.getByTestId('hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(before.hand);
    await sameHash(g.a, g.b);
  }
  // Both play on: the reloaded sequencer still sequences.
  await g.b.evaluate(() => window.__spellplane!.session!.draw(1));
  await expect.poll(async () => (await state(g.a)).zones['hand:s1']!.ids.length).toBe(8);
  await sameHash(g.a, g.b);
  await g.context.close();
});

test('closing both pages and reopening either restores the table; the later page reconciles to the higher seq', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const g = await game(browser, info);
  const hands = { a: (await secrets(g.a)).hand, b: (await secrets(g.b)).hand };
  // Ben closes his page; Ann plays on (life 20 → 17), so her copy is ahead; then she closes hers too.
  await saved(g.b);
  await g.b.close();
  for (let i = 0; i < 3; i++) await g.a.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="life-minus"]').click();
  await expect.poll(async () => (await state(g.a)).seats.s0!.life).toBe(17);
  const high = (await state(g.a)).seq;
  await saved(g.a);
  await g.a.close();

  // Ben comes back first, alone: his own save restores the table as he left it (his chair, his hand, Ann at 20).
  const b = await reopen(g, g.profiles.b);
  await expect.poll(() => hook<string>(b, 'session.seat')).toBe('s1');
  await expect.poll(async () => (await secrets(b)).hand).toEqual(hands.b);
  const alone = await state(b);
  expect(alone.seq).toBeLessThan(high);
  expect(alone.seats.s0!.life).toBe(20);
  await expect(b.locator('[data-testid="hand-card"]')).toHaveCount(7);

  // Ann comes back: both reconcile to her copy, the one with the higher seq.
  const a = await reopen(g, g.profiles.a);
  await expect.poll(() => hook<string>(a, 'session.seat')).toBe('s0');
  await expect.poll(async () => (await state(b)).seats.s0!.life, { timeout: 20_000 }).toBe(17);
  await sameHash(a, b);
  expect((await state(b)).seq).toBeGreaterThanOrEqual(high);
  expect((await secrets(a)).hand).toEqual(hands.a);
  expect((await secrets(b)).hand).toEqual(hands.b);
  // And the table plays on.
  await a.evaluate(() => window.__spellplane!.session!.draw(1));
  await expect.poll(async () => (await state(b)).zones['hand:s0']!.ids.length).toBe(8);
  await sameHash(a, b);
  await g.context.close();
});

test('a page whose save is lost recovers through the recovery panel: library = deck − public cards − agreed hand', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const g = await game(browser, info);
  await benPlaysACard(g.b);
  await sameHash(g.a, g.b);
  const st = await state(g.a);
  const pub = Object.values(st.cards).filter((c) => c.owner === 's1' && c.isToken !== true && st.zones[c.zone]?.visibility === 'public').length;
  expect(pub).toBe(1);
  // No recovery is offered while the save is intact.
  await expect(g.b.getByTestId('recovery')).toHaveCount(0);

  // Ben's save of this table is lost (his key pair stays): his page closes, the table's records are deleted.
  await saved(g.b);
  await g.b.close();
  const wipe = await g.context.newPage();
  await open(wipe, '/', { profile: g.profiles.b });
  await wipe.evaluate(
    ({ name, roomId }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onerror = () => reject(new Error('cannot open the database'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['tables', 'secrets', 'log'], 'readwrite');
          tx.objectStore('tables').delete(roomId);
          tx.objectStore('secrets').delete(roomId);
          tx.objectStore('log').delete(IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]));
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('cannot delete the table'));
        };
      }),
    { name: `spellplane-${g.profiles.b}`, roomId: g.room.roomId },
  );
  await wipe.close();

  // Ben reopens the link: same chair (key pair), but his hand and library are unknown to this browser.
  const b = await reopen(g, g.profiles.b);
  await expect.poll(() => hook<string>(b, 'session.seat')).toBe('s1');
  const panel = b.getByTestId('recovery');
  await expect(panel).toHaveAttribute('data-phase', 'lost', { timeout: 20_000 });
  await expect(b.getByTestId('recovery-lost')).toContainText('hand (6 cards) and library (53 cards)');
  await expect(g.a.getByTestId('recovery')).toHaveCount(0);

  // He proposes a fresh hand of 7 with his re-imported deck.
  await b.getByTestId('recovery-hand').fill('7');
  await expect(b.getByTestId('recovery-sizes')).toContainText('Deck 60 − 1 on the table − 7 in hand = library 52');
  await b.getByTestId('recovery-start').click();
  const dialog = b.getByTestId('recovery-import');
  await dialog.getByTestId('deck-text').fill(decklist('ur-m19-60.mtga.txt'));
  await dialog.getByTestId('deck-check').click();
  await expect(dialog.getByTestId('deck-summary')).toContainText('60 cards in the deck');
  await dialog.getByTestId('deck-import-go').click();
  await expect(dialog).toHaveCount(0);

  // The table sees the public proposal: Ann's prompt asks "new hand of 7?"; Ben's panel shows the round waiting on Ann.
  await expect(g.a.getByTestId('confirm-prompt')).toContainText('new hand of 7?', { timeout: 15_000 });
  await expect(b.locator('[data-testid="recovery-answer"][data-seat="s0"]')).toHaveAttribute('data-state', 'waiting');
  await expect.poll(async () => (await state(g.a)).seats.s1!.recovering?.hand ?? null).toBe(7);
  await g.a.getByTestId('prompt-ok').click();

  // Committed, shuffled with Ann's nonce, seven drawn.
  await expect(b.getByTestId('recovery-done')).toContainText('a new library of 52 and a hand of 7', { timeout: 30_000 });
  for (const p of [g.a, b]) {
    await expect.poll(async () => (await state(p)).zones['library:s1']!.ids.length, { timeout: 15_000 }).toBe(60 - pub - 7);
    expect((await state(p)).zones['hand:s1']!.ids).toHaveLength(7);
    expect((await state(p)).seats.s1!.recovering).toBeUndefined();
  }
  await expect(b.locator('[data-testid="hand-card"]')).toHaveCount(7);
  const sec = await secrets(b);
  for (const id of [...sec.hand, ...sec.libraryOrder]) expect(sec.identities[id]).toBeTruthy();
  // The log says so on both pages.
  for (const p of [g.a, b]) {
    const types = (await p.evaluate(() => window.__spellplane!.session!.log())).flatMap((e) => (e.kind === 'action' ? [e.action.type] : []));
    expect(types).toContain('recover');
    expect(types).toContain('recoverCommit');
  }
  await sameHash(g.a, b);
  await g.context.close();
});
