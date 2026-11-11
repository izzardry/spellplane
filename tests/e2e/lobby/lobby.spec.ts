/**
 * M1-P5 Lobby and seats in the browser (PLAN M1-P5): the start page creates a table link; two pages on
 * `?transport=local` see each other in the lobby, pick chairs and seat colours, press Ready with a deck (commitment
 * only) and start; the opponent's hand shows as card backs and live cursors and drags cross over; a transport that
 * never connects shows the plain connectivity failure (DESIGN "Players, seats and formats"; "Multiplayer architecture").
 * Until M1-P8 the room runs on the stand-in session (ui/lobby/local-session.ts); the tests use only the UI and the
 * debug hook, so they hold for the real session too.
 */
import { expect, test } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, identityUnavailable, open, openTable, setNickname, twoPages, WEBKIT_KEYCHAIN_SKIP } from './helpers';

const KEY_RE = /^[A-Za-z0-9_-]{22}$/;

// Every test here reads the key-pair identity (see helpers.ts).
test.beforeEach(({ browserName }) => {
  test.skip(identityUnavailable(browserName), WEBKIT_KEYCHAIN_SKIP);
});

test('the start page renders and creates a table link with the room id and key in the fragment', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '/lobby', { profile: freshProfile(info, 'start'), transport: 'local' });
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Play with friends' })).toBeVisible();
  // A nickname is required before creating.
  await expect(page.getByTestId('create-table')).toBeDisabled();
  await page.getByTestId('nickname').fill('  Ann   Lee ');
  await page.getByTestId('create-table').click();

  await expect(page).toHaveURL(/#\/t\/[a-z]+-[a-z]+-[a-z]+-\d\d\/[A-Za-z0-9_-]{22}$/);
  const [, roomId, roomKey] = /#\/t\/([^/]+)\/([^/]+)$/.exec(page.url())!;
  expect(roomKey).toMatch(KEY_RE);
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  const share = await page.getByTestId('share-link').inputValue();
  // The share link carries no test flags of this page (profile, transport), only the fragment.
  expect(share).toMatch(new RegExp(`^http://[^?#]+/spellplane/#/t/${roomId}/${roomKey}$`));
  await expect(chair(page, 's0')).toHaveAttribute('data-mine', 'true');
  await expect(chair(page, 's0')).toContainText('Ann Lee');
  await expect(page.getByTestId('lobby-nickname')).toHaveValue('Ann Lee');
  expect(errors).toEqual([]);
});

test('the start page refuses a pasted text that is not a table link and joins one that is', async ({ page }, info) => {
  await open(page, '/lobby', { profile: freshProfile(info, 'join'), transport: 'local' });
  await page.getByTestId('nickname').fill('Ben');
  await page.getByTestId('join-link').fill('https://example.test/spellplane/#/t/room-only');
  await page.getByTestId('join-table').click();
  await expect(page.getByTestId('link-problem')).toContainText('not a table link');
  const room = freshRoom();
  await page.getByTestId('join-link').fill(`Come play: https://example.test/spellplane/#/t/${room.roomId}/${room.roomKey}.`);
  await page.getByTestId('join-table').click();
  await expect(page).toHaveURL(new RegExp(`#/t/${room.roomId}/${room.roomKey}$`));
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
});

test('two pages on the local transport see each other in the lobby, choose chairs and colours', async ({ browser }, info) => {
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toContainText('Ann');
  // Ann moves to the far chair before anyone else arrives.
  await chair(a, 's1').click();
  await expect(chair(a, 's1')).toHaveAttribute('data-mine', 'true');
  await expect(chair(a, 's0')).toHaveAttribute('data-occupied', 'false');

  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  // Ben sits in the free chair; each page sees the other's nickname.
  await expect(chair(b, 's0')).toHaveAttribute('data-mine', 'true');
  await expect(chair(b, 's1')).toContainText('Ann');
  await expect(chair(a, 's0')).toContainText('Ben');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'false');
  // A taken chair cannot be taken.
  await expect(chair(b, 's1')).toBeEnabled();
  await chair(b, 's1').click();
  await expect(b.getByTestId('lobby-failure')).toContainText('Ann sits here');

  // Seat colours are unique: Ben's colour (from his key pair) is disabled for Ann; Ann picks another one, Ben sees it
  // and cannot pick it; then Ben takes a third.
  const benColour = Number(await chair(a, 's0').getAttribute('data-colour'));
  await expect(a.locator(`[data-testid="colour"][data-colour="${benColour}"]`)).toBeDisabled();
  const annPick = (benColour + 3) % 8;
  await a.locator(`[data-testid="colour"][data-colour="${annPick}"]`).check({ force: true });
  await expect(chair(b, 's1')).toHaveAttribute('data-colour', String(annPick));
  await expect(b.locator(`[data-testid="colour"][data-colour="${annPick}"]`)).toBeDisabled();
  const benPick = (benColour + 5) % 8;
  await b.locator(`[data-testid="colour"][data-colour="${benPick}"]`).check({ force: true });
  await expect(chair(a, 's0')).toHaveAttribute('data-colour', String(benPick));
  await expect(a.locator(`[data-testid="colour"][data-colour="${benPick}"]`)).toBeDisabled();
  await expect(a.locator(`[data-testid="colour"][data-colour="${benColour}"]`)).toBeEnabled();

  // The own chair is drawn at the bottom of the table view on both pages.
  const aBox = await chair(a, 's1').boundingBox();
  const aOther = await chair(a, 's0').boundingBox();
  const bBox = await chair(b, 's0').boundingBox();
  const bOther = await chair(b, 's1').boundingBox();
  expect(aBox!.y).toBeGreaterThan(aOther!.y);
  expect(bBox!.y).toBeGreaterThan(bOther!.y);

  // Shared state agrees.
  const sa = await hook<TableState>(a, 'state');
  const sb = await hook<TableState>(b, 'state');
  expect(sa.seats).toEqual(sb.seats);
  await expect(a.getByTestId('connectivity-problem')).toHaveCount(0);
  await context.close();
});

test('Ready commits the deck, the host starts, the opponent hand shows as backs and cursors and drags cross over', async ({ browser }, info) => {
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  await expect(chair(a, 's1')).toContainText('Ben');

  // Only the host (lowest chair) may start, and only when everyone is ready.
  await expect(a.getByTestId('start-blocked')).toContainText('Waiting for everyone to press Ready');
  // Ready never fails silently: a list without a single known card is refused, and a list with unknown lines needs a
  // second press.
  await a.getByTestId('lobby-deck-text').fill('4 Nonexistent Card Name\n2 Another Missing Card');
  await a.getByTestId('ready').click();
  await expect(a.getByTestId('lobby-failure')).toContainText('No cards in this list were found');
  await a.getByTestId('lobby-deck-text').fill(`${decklist('gw-m19-60.txt')}\n1 Nonexistent Card Name`);
  await a.getByTestId('ready').click();
  await expect(a.getByTestId('lobby-failure')).toContainText('1 line was not found and will be left out');
  await expect(chair(a, 's0')).toHaveAttribute('data-ready', 'false');
  for (const [page, file] of [
    [a, 'gw-m19-60.txt'],
    [b, 'ur-m19-60.mtga.txt'],
  ] as const) {
    await page.getByTestId('lobby-deck-text').fill(decklist(file));
    await page.getByTestId('lobby-deck-check').click();
    await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
    await page.getByTestId('ready').click();
    await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
  }
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await expect(chair(b, 's0')).toHaveAttribute('data-ready', 'true');
  await expect(b.getByTestId('start-blocked')).toContainText('Waiting for Ann to start the game');

  // Ready published commitments only: no Scryfall id or salt of Ann's deck in Ben's state.
  const annSecrets = await hook<SecretStore>(a, 'secrets');
  const benState = JSON.stringify(await hook<TableState>(b, 'state'));
  expect(Object.keys(annSecrets.identities)).toHaveLength(60);
  for (const { card, salt } of Object.values(annSecrets.identities)) {
    expect(benState).not.toContain(card.sid);
    expect(benState).not.toContain(salt);
  }

  // Ann's seat colour as the lobby draws it (the theme's seat colour token), for her cursor below.
  const annColour = Number(await chair(b, 's0').getAttribute('data-colour'));
  const annCss = await b
    .locator(`[data-testid="colour"][data-colour="${annColour}"]`)
    .locator('xpath=..')
    .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--seat').trim());
  expect(annCss).toMatch(/^#|^rgb|^hsl/);

  await a.getByTestId('start-game').click();
  await expect(a.getByTestId('hud')).toBeVisible();
  await expect(b.getByTestId('hud')).toBeVisible();

  // Ann draws seven; Ben's table shows them as backs at Ann's hand row.
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await expect.poll(async () => (await hook<TableState>(b, 'state')).zones['hand:s0']?.ids.length).toBe(7);
  const hand = (await hook<SecretStore>(a, 'secrets')).hand;
  await expect
    .poll(async () => {
      const cards = await hook<{ id: string; visible: boolean }[]>(b, 'cards');
      return hand.filter((id) => cards.some((c) => c.id === id && c.visible)).length;
    })
    .toBe(7);
  const benStateAfter = await hook<TableState>(b, 'state');
  for (const id of hand) expect(benStateAfter.cards[id]?.identity).toBeUndefined();
  // Drawn as backs, at the far (opponent's) hand row: Ben's own seat is at the bottom of his view.
  type Shown = { id: string; visible: boolean; shows: 'face' | 'back'; screen: { x: number; y: number; width: number; height: number } };
  await expect.poll(async () => (await hook<Shown[]>(b, 'cards')).filter((c) => hand.includes(c.id) && c.shows === 'back').length).toBe(7);
  const benHost = (await b.getByTestId('scene-host').boundingBox())!;
  const midY = benHost.y + benHost.height / 2;
  for (const c of (await hook<Shown[]>(b, 'cards')).filter((x) => hand.includes(x.id))) expect(c.screen.y + c.screen.height / 2).toBeLessThan(midY);

  // Live cursor: Ann moves over the table; Ben sees her pointer in her seat colour.
  const host = a.getByTestId('scene-host');
  const box = (await host.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  type Drawn = { peer: string; seat: string | null; colour: string; label: string; cursor: { x: number; y: number } | null; ghosts: { id: string }[] }[];
  await expect.poll(async () => (await hook<Drawn>(b, 'presence.drawn')).filter((s) => s.seat === 's0' && s.cursor).length).toBe(1);
  const annCursor = (await hook<Drawn>(b, 'presence.drawn')).find((s) => s.seat === 's0')!;
  expect(annCursor.colour).toBe(annCss);
  expect(annCursor.label).toBe('Ann');

  // Live drag: Ann drags a token on her battlefield; Ben sees its outline while it moves, and it ends on release.
  await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'createToken', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: -250, rot: 0 }, label: 'Soldier' } as never));
  await expect.poll(async () => (await hook<{ id: string; visible: boolean }[]>(a, 'cards')).some((c) => c.id === 'tok-1' && c.visible)).toBe(true);
  const tok = (await hook<{ id: string; screen: { x: number; y: number; width: number; height: number } }[]>(a, 'cards')).find((c) => c.id === 'tok-1')!;
  const cx = tok.screen.x + tok.screen.width / 2;
  const cy = tok.screen.y + tok.screen.height / 2;
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx + 30, cy - 10, { steps: 4 });
  await a.mouse.move(cx + 60, cy - 20, { steps: 4 });
  await expect.poll(async () => (await hook<Drawn>(b, 'presence.drawn')).flatMap((s) => s.ghosts.map((g) => g.id))).toEqual(['tok-1']);
  await a.mouse.up();
  await expect.poll(async () => (await hook<Drawn>(b, 'presence.drawn')).flatMap((s) => s.ghosts)).toEqual([]);

  // Live drag out of the hand: Ann pulls a card up out of her fan; Ben sees its outline (by its opaque id, no
  // identity) until she lets go.
  const handCard = a.locator(`[data-testid="hand-card"][data-card="${hand[0]}"]`);
  const hb = (await handCard.boundingBox())!;
  await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height - 20);
  await a.mouse.down();
  await a.mouse.move(hb.x + hb.width / 2, hb.y - 120, { steps: 6 });
  await a.mouse.move(hb.x + hb.width / 2 + 40, hb.y - 200, { steps: 6 });
  await expect.poll(async () => (await hook<Drawn>(b, 'presence.drawn')).flatMap((s) => s.ghosts.map((g) => g.id))).toEqual([hand[0]]);
  expect((await hook<TableState>(b, 'state')).cards[hand[0]!]?.identity).toBeUndefined();
  await a.mouse.up();
  await expect.poll(async () => (await hook<Drawn>(b, 'presence.drawn')).flatMap((s) => s.ghosts)).toEqual([]);
  await context.close();
});

test.describe('connectivity failure (DESIGN "Multiplayer architecture": no relay fallback, said plainly)', () => {
  test('a network that never connects: a neutral hint while nobody else could have joined, then the plain message with remedies', async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(() => {
      window.__spellplaneTransport = 'silent';
    });
    const room = freshRoom();
    await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, 'silent') });
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('connectivity-problem')).toHaveCount(0);
    await page.clock.fastForward(16_000);
    // Nobody else is in the seats: the friend may not have opened the link yet, so this is not a failure yet.
    const waiting = page.getByTestId('connectivity-waiting');
    await expect(waiting).toContainText('Waiting for another player to open the link');
    await expect(waiting).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('connectivity-problem')).toHaveCount(0);
    await page.clock.fastForward(110_000);
    const problem = page.getByTestId('connectivity-problem');
    await expect(problem).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await expect(problem).toContainText('No other player has connected yet');
    await expect(problem).toContainText('another network, a phone hotspot or a VPN');
    await expect(problem).toHaveAttribute('role', 'alert');
  });

  test('signalling relays out of reach: joining shows the plain message instead of waiting forever', async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(() => {
      window.__spellplaneTransport = 'unreachable';
    });
    const room = freshRoom();
    await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, 'unreach') });
    await expect(page.getByTestId('room-joining')).toBeVisible();
    await page.clock.fastForward(16_000);
    await expect(page.getByTestId('connectivity-problem')).toContainText('cannot reach the public signalling relays');
  });

  test('a link with a malformed key is refused plainly', async ({ page }, info) => {
    await open(page, '/t/amber-fox-river-42/short', { profile: freshProfile(info, 'bad'), transport: 'local' });
    await expect(page.getByTestId('route-room')).toContainText('not a valid table link');
  });
});

test('a page that closes leaves its seat marked away on the other page; reopening takes the chair back (DESIGN "Multiplayer architecture", Resume)', async ({ browser }, info) => {
  test.setTimeout(60_000);
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  const profileA = freshProfile(info, 'a');
  await openTable(a, room, profileA);
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  await expect(chair(b, 's0')).toContainText('Ann');
  // A plain close: Playwright's WebKit never closes a page asked to run beforeunload first.
  await a.close();
  await expect.poll(async () => (await hook<TableState>(b, 'state')).seats.s0?.away, { timeout: 15_000 }).toBe(true);
  const again = await context.newPage();
  await openTable(again, room, profileA);
  await expect(chair(again, 's0')).toHaveAttribute('data-mine', 'true');
  await expect.poll(async () => (await hook<TableState>(b, 'state')).seats.s0?.away ?? false, { timeout: 15_000 }).toBe(false);
  await context.close();
});
