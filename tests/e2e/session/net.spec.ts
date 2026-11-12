/**
 * The networked session in the browser (PLAN M1-P8): two pages on `?transport=local` (BroadcastChannel, distinct
 * `?profile=`, so distinct key pairs and IndexedDBs) join one room through the table route, both press Ready with a
 * fixture deck, the host starts; each sees the other's hand as card backs and both agree on the state hash. A die roll
 * from the HUD key runs the commit-and-reveal exchange through both browsers, a reload rejoins the same chair with the
 * same hand, and nothing a page received carries the other's hidden cards (DESIGN "Multiplayer architecture").
 */
import { expect, test, type Page } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import type { NetMessageRecord } from '../../../src/net/types';
import { scan } from '../../leak/scan';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname, twoPages } from '../lobby/helpers';

type Shown = { id: string; visible: boolean; shows: 'face' | 'back' };

const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

/** Both pages agree on seq and hash, with nothing of their own pending. */
async function sameHash(a: Page, b: Page): Promise<string> {
  await expect
    .poll(async () => {
      const [ha, hb] = await Promise.all([hashOf(a), hashOf(b)]);
      return ha === hb ? ha : `${ha} != ${hb}`;
    }, { timeout: 15_000 })
    .toMatch(/^[A-Za-z0-9_-]{20,}$/);
  return hashOf(a);
}

/** Scryfall ids and salts of `owner`'s cards that are hidden from everyone else. */
function hiddenTokens(owner: SecretStore, st: TableState): string[] {
  const out: string[] = [];
  const shownSids = new Set(Object.values(st.cards).flatMap((c) => (c.identity ? [c.identity.sid] : [])));
  for (const [id, s] of Object.entries(owner.identities)) {
    const c = st.cards[id];
    if (c?.identity) continue;
    out.push(s.salt);
    if (!shownSids.has(s.card.sid)) out.push(s.card.sid);
  }
  return out;
}

test('two pages join one room, Ready with fixture decks, see each other’s hand as backs and agree on the state hash', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  const profileB = freshProfile(info, 'b');
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await openTable(b, room, profileB);
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  await expect(chair(a, 's1')).toContainText('Ben');
  await expect(chair(b, 's0')).toContainText('Ann');

  // Both run the networked session: one sequencer, both connected.
  for (const p of [a, b]) {
    await expect.poll(() => hook<string>(p, 'net.status')).toBe('connected');
    expect(await hook<string>(p, 'session.roomId')).toBe(room.roomId);
  }
  const annPeer = await hook<string>(a, 'net.self');
  await expect.poll(() => hook<string>(b, 'net.sequencer')).toBe(annPeer);
  expect(await hook<string>(a, 'net.sequencer')).toBe(annPeer);

  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  await expect(a.getByTestId('hud')).toBeVisible();
  await expect(b.getByTestId('hud')).toBeVisible();

  // Both shuffle (each waits for the other's nonce) and draw seven.
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  const shuffles = Object.values((await state(a)).shuffles);
  expect(shuffles).toHaveLength(2);
  for (const r of shuffles) expect(Object.keys(r.nonces)).toEqual([r.owner === 's0' ? 's1' : 's0']);

  // Each sees the other's hand as backs, without identities; its own hand as faces.
  const annHand = (await secrets(a)).hand;
  const benHand = (await secrets(b)).hand;
  expect(annHand).toHaveLength(7);
  expect(benHand).toHaveLength(7);
  for (const [viewer, theirs] of [
    [b, annHand],
    [a, benHand],
  ] as const) {
    await expect.poll(async () => (await hook<Shown[]>(viewer, 'cards')).filter((c) => theirs.includes(c.id) && c.visible && c.shows === 'back').length, { timeout: 15_000 }).toBe(7);
    const st = await state(viewer);
    for (const id of theirs) expect(st.cards[id]?.identity).toBeUndefined();
  }
  await expect(a.locator('[data-testid="hand-card"]')).toHaveCount(7);

  // One state hash on both pages.
  await sameHash(a, b);

  // A die roll from the HUD key (Ctrl+I): commit by Ann, commit by Ben's browser, both reveals, one result.
  await a.getByTestId('scene-host').hover();
  await a.keyboard.press('Control+i');
  await expect.poll(async () => Object.values((await state(b)).rng).filter((r) => r.result !== null).length, { timeout: 15_000 }).toBe(1);
  const round = Object.values((await state(b)).rng)[0]!;
  expect(Object.keys(round.commits).sort()).toEqual(['s0', 's1']);
  expect(Object.keys(round.reveals).sort()).toEqual(['s0', 's1']);
  expect(round.result).toBeGreaterThanOrEqual(0);
  await sameHash(a, b);

  // Nothing Ben's page received, holds in state or keeps in its secret store names Ann's hidden cards, and the other way round.
  const recvB = (await hook<NetMessageRecord[]>(b, 'net.messages')).filter((r) => r.dir === 'in');
  const recvA = (await hook<NetMessageRecord[]>(a, 'net.messages')).filter((r) => r.dir === 'in');
  expect(recvB.length).toBeGreaterThan(20);
  const annTokens = hiddenTokens(await secrets(a), await state(a));
  const benTokens = hiddenTokens(await secrets(b), await state(b));
  expect(annTokens.length).toBeGreaterThan(50);
  expect(scan([recvB, await state(b), await secrets(b)], annTokens)).toEqual([]);
  expect(scan([recvA, await state(a), await secrets(a)], benTokens)).toEqual([]);

  // Ben reloads: the same chair and the same hand come back from his save, and the pages agree again.
  await b.evaluate(() => window.__spellplane!.session!.saved());
  await b.reload();
  await expect(b.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => hook<string>(b, 'session.seat')).toBe('s1');
  await expect.poll(async () => (await secrets(b)).hand).toEqual(benHand);
  await sameHash(a, b);
  await context.close();
});

test('a network where nobody else connects still seats the player alone, as its own sequencer', async ({ browser }, info) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__spellplaneTransport = 'silent';
  });
  const room = freshRoom();
  await openTable(page, room, freshProfile(info, 'alone'));
  await expect(chair(page, 's0')).toHaveAttribute('data-mine', 'true');
  expect(await hook<string>(page, 'net.status')).toBe('alone');
  // Alone at the table this browser sequences its own actions.
  expect(await hook<string>(page, 'net.sequencer')).toBe(await hook<string>(page, 'net.self'));
  // Back at the solo table, the debug hook has the solo session again and no network part of the room it left.
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => page.evaluate(() => window.__spellplane?.net === undefined)).toBe(true);
  expect(await hook<string>(page, 'session.roomId')).not.toBe(room.roomId);
  await context.close();
});
