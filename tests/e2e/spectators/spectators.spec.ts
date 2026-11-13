/**
 * M3-P5 Spectators in the browser (PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: "A spectator joins by
 * the same link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may
 * reveal their hand to a named spectator"). Two players and a spectator on `?transport=local` in one browser context;
 * the spectator joins by the table's watch link (`#/t/<room>/<key>/watch`, DECISIONS [M3-C]). Engine behaviour is read
 * from the debug hook, never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { LogEntry, SecretStore, TableState } from '../../../src/core/types';
import type { NetMessageRecord } from '../../../src/net/types';
import { hook, shot } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, open, openTable, setNickname, startPageLoaded } from '../lobby/helpers';

/** Join a table as a spectator from the start page: nickname, then the pasted watch link. */
async function watchFromStart(page: Page, profile: string, nickname: string, watchLink: string): Promise<void> {
  await open(page, '/lobby', { profile, transport: 'local' });
  await startPageLoaded(page);
  await page.getByTestId('nickname').fill(nickname);
  await page.getByTestId('join-link').fill(watchLink);
  await page.getByTestId('join-table').click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByTestId('spectator-view')).toBeVisible({ timeout: 15_000 });
}

async function ready(page: Page, file: string): Promise<void> {
  await page.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist(file));
}

const actionsBy = (log: LogEntry[], by: string) => log.flatMap((e) => (e.kind === 'action' && e.action.by === by ? [e.action] : []));

test('a spectator watches by the watch link without a chair, chats and pings, cannot move cards, and sees a hand shown to it by name', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [a, b, v] = [await context.newPage(), await context.newPage(), await context.newPage()];
  const errors: string[] = [];
  v.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  await expect(chair(a, 's1')).toContainText('Ben');

  // The lobby offers the spectator link: the table link plus /watch. Nobody watches yet.
  const watchLink = await a.getByTestId('watch-link').inputValue();
  expect(watchLink).toBe(`${await a.getByTestId('share-link').inputValue()}/watch`);
  await expect(a.getByTestId('spectator-count')).toHaveText('Nobody is watching.');

  // Viv joins by it: no chair is taken, both players see her watching.
  await watchFromStart(v, freshProfile(info, 'v'), 'Viv', watchLink);
  await expect(v.getByTestId('spectator-view')).toHaveAttribute('data-stage', 'lobby');
  await expect(v.getByTestId('spectator-players')).toContainText('Ann');
  await expect(v.getByTestId('spectator-players')).toContainText('Ben');
  await expect(a.getByTestId('spectator-name')).toHaveText('Viv');
  await shot(v, 'M3', 'spectator-lobby', info.project.name);
  await expect(a.getByTestId('spectator-name')).toHaveText('Viv');
  await expect(b.getByTestId('spectator-name')).toHaveText('Viv');
  const vivId = await hook<string>(v, 'session.seat');
  expect(vivId).toMatch(/^v:[0-9a-f]{16}$/);
  const seats = Object.values((await hook<TableState>(a, 'state')).seats);
  expect(seats).toHaveLength(2);
  expect(seats.every((s) => s.peer !== vivId.slice(2))).toBe(true);
  await expect(a.locator('[data-testid="chair"]')).toHaveCount(2);

  // The match starts; the spectator's page follows it to the table.
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('start-game')).toBeVisible();
  await a.getByTestId('start-game').click();
  await expect(v.getByTestId('spectator-view')).toHaveAttribute('data-stage', 'match');
  await expect(v.getByTestId('hud')).toBeVisible();
  await expect(v.getByTestId('spectator-badge')).toHaveText('Watching');

  // Public only: Ann's seven cards are backs to Viv, and she holds no identity.
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'createToken', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: -250, rot: 0 }, label: 'Soldier' } as never));
  await expect.poll(async () => (await hook<TableState>(v, 'state')).zones['hand:s0']?.ids.length).toBe(7);
  await expect.poll(async () => Boolean((await hook<TableState>(v, 'state')).cards['tok-1'])).toBe(true);
  const vState = await hook<TableState>(v, 'state');
  for (const id of vState.zones['hand:s0']!.ids) expect(vState.cards[id]!.identity).toBeUndefined();
  expect(await hook<SecretStore>(v, 'secrets')).toMatchObject({ identities: {}, received: {} });

  // Card actions from the spectator's page are proposed and refused by the sequencer (Ann's page): nacked, rolled
  // back, nothing changes anywhere.
  const hashOf = (p: Page): Promise<string> => p.evaluate(() => window.__spellplane!.session!.hash());
  const before = await hashOf(a);
  await v.evaluate(() => {
    const d = window.__spellplane!.dispatch!;
    d({ type: 'tap', card: 'tok-1', tapped: true } as never);
    d({ type: 'move', card: 'tok-1', to: 'battlefield:s0', pose: { x: 300, y: -300, rot: 0 } } as never);
    d({ type: 'life', seat: 's0', delta: -20 } as never);
  });
  await expect
    .poll(async () => (await hook<NetMessageRecord[]>(v, 'net.messages')).filter((r) => r.dir === 'in' && r.msg.t === 'nack' && /spectator may chat and ping only/.test((r.msg as { reason: string }).reason)).length)
    .toBe(3);
  await expect.poll(async () => (await hook<LogEntry[]>(v, 'session.log')).filter((e) => e.kind === 'system' && /refused: a spectator/.test(e.text)).length).toBe(3);
  const after = await hook<TableState>(v, 'state');
  expect(after.cards['tok-1']).toMatchObject({ tapped: false });
  expect(after.seats.s0!.life).toBe(20);
  expect(await hashOf(a)).toBe(before);
  expect(actionsBy(await hook<LogEntry[]>(a, 'session.log'), vivId)).toEqual([]);

  // Chat from the chat field, and a ping: both players log them under Viv's name.
  await v.getByTestId('chat-input').fill('gl hf');
  await v.getByTestId('chat-input').press('Enter');
  await v.evaluate(() => window.__spellplane!.dispatch!({ type: 'ping', target: { kind: 'card', id: 'tok-1' } } as never));
  for (const p of [a, b]) {
    await expect.poll(async () => actionsBy(await hook<LogEntry[]>(p, 'session.log'), vivId).map((x) => x.type)).toEqual(['chat', 'ping']);
    await expect(p.getByTestId('log-line').filter({ hasText: 'gl hf' })).toContainText('Viv (spectator)');
  }

  // Ann shows her hand to Viv by name: Viv's page lists the seven cards; Ben learns none of them.
  await expect(a.getByTestId('spectator-toggle')).toHaveText('1 watching');
  await a.getByTestId('spectator-toggle').click();
  await a.locator(`[data-testid="spectator-row"][data-spectator="${vivId}"] [data-testid="show-hand"]`).click();
  await expect(a.getByTestId('shown-count')).toHaveText('shown 7');
  await expect(v.getByTestId('spectator-shown-card')).toHaveCount(7);
  await expect(v.getByTestId('spectator-shown')).toContainText('Ann showed you');
  const annHand = (await hook<SecretStore>(a, 'secrets')).hand;
  const received = (await hook<SecretStore>(v, 'secrets')).received;
  expect(Object.keys(received).sort()).toEqual([...annHand].sort());
  const annIds = (await hook<SecretStore>(a, 'secrets')).identities;
  for (const id of annHand) expect(received[id]).toMatchObject({ card: annIds[id]!.card, from: 's0' });
  // Evidence for the M3 gate review (not a baseline): the spectator's table with the shown hand, and Ann's panel.
  await shot(v, 'M3', 'spectator-view', info.project.name);
  await shot(a, 'M3', 'spectator-panel', info.project.name);
  const benReceived = (await hook<SecretStore>(b, 'secrets')).received;
  for (const id of annHand) expect(benReceived[id]).toBeUndefined();
  expect(errors).toEqual([]);
  await context.close();
});

test('a player who finds the table full is offered to watch; watching takes no chair', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const [a, b, c] = [await context.newPage(), await context.newPage(), await context.newPage()];
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await openTable(b, room, freshProfile(info, 'b'));
  await expect(a.locator('[data-testid="chair"][data-occupied="true"]')).toHaveCount(2);

  await open(c, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, 'c'), transport: 'local' });
  await expect(c.getByTestId('room-error')).toContainText('full', { timeout: 30_000 });
  await c.getByTestId('watch-instead').click();
  await expect(c).toHaveURL(new RegExp(`#/t/${room.roomId}/${room.roomKey}/watch$`));
  await expect(c.getByTestId('spectator-view')).toBeVisible({ timeout: 15_000 });
  await expect(c.getByTestId('spectator-players').locator('li')).toHaveCount(2);
  await expect(a.getByTestId('spectator-count')).toContainText('Watching:');
  // The spectator's own refusals: no chair, no Ready.
  await expect(c.evaluate(() => window.__spellplane!.session!.draw(1))).rejects.toThrow(/Spectators watch/);
  expect(Object.values((await hook<TableState>(a, 'state')).seats)).toHaveLength(2);
  await context.close();
});
