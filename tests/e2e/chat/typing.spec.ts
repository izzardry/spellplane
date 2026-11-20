/**
 * GAPS 22 (M6-P2) in the browser: the "who is typing" indicator and the spectator chat tab. DESIGN "Multiplayer
 * architecture", Shared state: who is typing travels on presence; "Chat and voice", Text chat: "A collapsible panel with
 * table, team and spectator tabs"; "Players, seats and formats", Spectators: a spectator "can chat". Two players and a
 * spectator on `?transport=local` in one browser context; the spectator joins by the table's watch link. Engine
 * behaviour is read from the debug hook and the DOM's test ids, never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { LogEntry } from '../../../src/core/types';
import { hook, openLog } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, open, openTable, setNickname, startPageLoaded } from '../lobby/helpers';

async function watchFromStart(page: Page, profile: string, nickname: string, watchLink: string): Promise<void> {
  await open(page, '/lobby', { profile, transport: 'local' });
  await startPageLoaded(page);
  await page.getByTestId('nickname').fill(nickname);
  await page.getByTestId('join-link').fill(watchLink);
  await page.getByTestId('join-table').click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByTestId('spectator-view')).toBeVisible({ timeout: 15_000 });
}

const typing = (page: Page) => page.getByTestId('chat-typing');
const avatar = (page: Page, seat: string) => page.locator(`[data-testid="avatar"][data-seat="${seat}"]`);
const chats = async (page: Page) =>
  (await hook<LogEntry[]>(page, 'session.log')).flatMap((e) => (e.kind === 'action' && e.action.type === 'chat' ? [{ text: e.action.text, channel: e.action.channel, by: e.action.by }] : []));
const line = (page: Page, text: string) => page.getByTestId('log-line').filter({ hasText: text });

test('who is typing shows beside the chat field and on the avatar; players and spectators share the spectator tab', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [a, b, v] = [await context.newPage(), await context.newPage(), await context.newPage()];
  const errors: string[] = [];
  for (const p of [a, b, v]) p.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'ta'));
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'tb'));
  await setNickname(b, 'Ben');
  await expect(chair(a, 's1')).toContainText('Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  const watchLink = await a.getByTestId('watch-link').inputValue();

  // Before anyone watches, a 1v1 table has the table tab only.
  await a.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist('gw-m19-60.txt'));
  await b.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist('ur-m19-60.mtga.txt'));
  await expect(a.getByTestId('start-game')).toBeVisible();
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await openLog(a);
  await expect(a.getByTestId('chat-input')).toBeVisible();
  await expect(a.getByTestId('chat-tab-spectator')).toHaveCount(0);
  await expect(typing(a)).toHaveText('');

  // --- Who is typing, between the two players --------------------------------------------------------------------
  await openLog(a);
  const annInput = a.getByTestId('chat-input');
  await a.bringToFront();
  await annInput.click();
  await annInput.pressSequentially('good ga');
  await expect(typing(b)).toHaveText('Ann is typing…');
  await expect(avatar(b, 's0')).toHaveAttribute('data-typing', 'true');
  await expect(avatar(b, 's0').getByTestId('avatar-typing')).toBeVisible();
  // Never to the one typing.
  await expect(typing(a)).toHaveText('');
  // Emptying the field stops it; typing again brings it back; sending stops it.
  await annInput.fill('');
  await expect(typing(b)).toHaveText('');
  await expect(avatar(b, 's0')).toHaveAttribute('data-typing', 'false');
  await annInput.pressSequentially('good game');
  await expect(typing(b)).toHaveText('Ann is typing…');
  await annInput.press('Enter');
  await expect(typing(b)).toHaveText('');
  await openLog(b);
  await expect(line(b, 'good game')).toHaveCount(1);
  // Leaving the field with text in it stops it too (the text stays).
  await annInput.pressSequentially('one more');
  await expect(typing(b)).toHaveText('Ann is typing…');
  await annInput.blur();
  await expect(typing(b)).toHaveText('');
  await expect(annInput).toHaveValue('one more');
  await annInput.fill('');

  // --- A spectator joins: the spectator tab appears ---------------------------------------------------------------
  await watchFromStart(v, freshProfile(info, 'tv'), 'Viv', watchLink);
  await expect(v.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  for (const p of [a, b]) await expect(p.getByTestId('chat-tab-spectator')).toBeVisible({ timeout: 15_000 });
  // The spectator has the table and spectator tabs (no team tab).
  await expect(v.getByTestId('chat-tab-table')).toBeVisible();
  await expect(v.getByTestId('chat-tab-spectator')).toBeVisible();
  await expect(v.getByTestId('chat-tab-team')).toHaveCount(0);

  // The spectator sees the players typing.
  await a.bringToFront();
  await annInput.click();
  await annInput.pressSequentially('hello');
  await expect(typing(v)).toHaveText('Ann is typing…');
  await expect(avatar(v, 's0')).toHaveAttribute('data-typing', 'true');
  await annInput.fill('');
  await expect(typing(v)).toHaveText('');

  // Viv writes on the spectator tab: the players see her typing there, by her nickname.
  await v.bringToFront();
  await v.getByTestId('chat-tab-spectator').click();
  await openLog(v);
  const vivInput = v.getByTestId('chat-input');
  await vivInput.click();
  await vivInput.pressSequentially('nice pla');
  await expect(typing(a)).toHaveText('Viv (spectator) is typing in Spectators');
  await expect(typing(b)).toHaveText('Viv (spectator) is typing in Spectators');
  await vivInput.pressSequentially('y');
  await vivInput.press('Enter');
  await expect(typing(a)).toHaveText('');
  const vivId = await hook<string>(v, 'session.seat');
  for (const p of [a, b, v]) await expect.poll(() => chats(p)).toContainEqual({ text: 'nice play', channel: 'spectator', by: vivId });
  // On the players' table tab it is not shown; on their spectator tab it is.
  await openLog(a);
  await expect(line(a, 'nice play')).toHaveCount(0);
  await a.getByTestId('chat-tab-spectator').click();
  await openLog(a);
  await expect(line(a, 'nice play')).toHaveCount(1);
  await openLog(a);
  await expect(line(a, 'nice play')).toContainText('Viv (spectator)');
  await openLog(v);
  await expect(line(v, 'nice play')).toHaveCount(1);

  // Ann answers on the spectator tab: Viv sees her typing there and reads the line; Ben reads it on his spectator tab.
  await a.bringToFront();
  await annInput.click();
  await annInput.pressSequentially('thank');
  await expect(typing(v)).toHaveText('Ann is typing…');
  await expect(typing(b)).toHaveText('Ann is typing in Spectators');
  await annInput.pressSequentially('s');
  await annInput.press('Enter');
  for (const p of [a, b, v]) await expect.poll(() => chats(p)).toContainEqual({ text: 'thanks', channel: 'spectator', by: 's0' });
  await openLog(v);
  await expect(line(v, 'thanks')).toHaveCount(1);
  await openLog(b);
  await expect(line(b, 'thanks')).toHaveCount(0);
  await b.getByTestId('chat-tab-spectator').click();
  await openLog(b);
  await expect(line(b, 'thanks')).toHaveCount(1);
  // The table tab keeps table talk only.
  await v.getByTestId('chat-tab-table').click();
  await openLog(v);
  await expect(line(v, 'good game')).toHaveCount(1);
  await openLog(v);
  await expect(line(v, 'thanks')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('a draft on the spectator tab stays there when the last spectator leaves: Enter never sends it to the table', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [a, b, v] = [await context.newPage(), await context.newPage(), await context.newPage()];
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'da'));
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'db'));
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  const watchLink = await a.getByTestId('watch-link').inputValue();
  await a.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist('gw-m19-60.txt'));
  await b.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist('ur-m19-60.mtga.txt'));
  await expect(a.getByTestId('start-game')).toBeVisible();
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });

  // Viv watches; Ann starts a line to the spectators but has not sent it when Viv leaves.
  await watchFromStart(v, freshProfile(info, 'dv'), 'Viv', watchLink);
  await expect(v.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('chat-tab-spectator')).toBeVisible({ timeout: 15_000 });
  await a.bringToFront();
  await a.getByTestId('chat-tab-spectator').click();
  await openLog(a);
  const annInput = a.getByTestId('chat-input');
  await annInput.click();
  await annInput.pressSequentially('thanks for watching');
  await v.close();
  await expect
    .poll(async () => (await hook<{ role: string }[]>(a, 'net.peers')).filter((p) => p.role === 'spectator').length, { timeout: 30_000 })
    .toBe(0);
  // The tab the draft was written on stays, still chosen, with the draft.
  await expect(a.getByTestId('chat-tab-spectator')).toHaveAttribute('aria-selected', 'true');
  await expect(annInput).toHaveValue('thanks for watching');
  await annInput.press('Enter');
  for (const p of [a, b]) await expect.poll(() => chats(p)).toContainEqual({ text: 'thanks for watching', channel: 'spectator', by: 's0' });
  expect((await chats(a)).filter((c) => c.text === 'thanks for watching').map((c) => c.channel)).toEqual(['spectator']);
  await openLog(b);
  await expect(line(b, 'thanks for watching')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
