/**
 * PLAN M3-P3 in the real app on Chromium fake media: two pages on `?transport=local` (BroadcastChannel, distinct
 * profiles) join one table and start a game; each joins voice with a click. Every connection gets its own outgoing
 * track (BroadcastChannel carries no media, so the tracks are asserted through the debug hook's `voice.tracks()`, which
 * reads the real MediaStreamTrack of each connection). Push-to-talk opens it only while Ctrl is held (since M5: PLAN
 * Milestone 5, owner decisions, Talk key) and closes it on window blur; the turn mic opens it exactly for the own turn as
 * the shared turn marker moves; typing V in the chat opens nothing (DESIGN "Chat and voice", Talk modes and Live voice; "Multiplayer architecture").
 */
import { expect, test, type Page } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import type { TalkState, VoiceTrackState } from '../../../src/voice/types';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname, twoPages } from '../lobby/helpers';

test.skip(({ browserName }) => browserName !== 'chromium', 'fake media is Chromium-only; WebKit would prompt for the microphone');

const tracks = (page: Page) => hook<VoiceTrackState[]>(page, 'voice.tracks');
const talk = (page: Page) => hook<TalkState>(page, 'voice.talk');
const enabled = async (page: Page) => (await tracks(page)).map((t) => t.enabled);
const toTable = (page: Page) => page.mouse.move(700, 420);

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

test('two players join voice; push-to-talk, blur and the turn mic gate the track on the real connection', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const { context, a, b } = await twoPages(browser);
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'va'));
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await openTable(b, room, freshProfile(info, 'vb'));
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible();

  // Nothing is acquired before the click.
  for (const p of [a, b]) {
    await expect(p.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'noMic');
    expect(await tracks(p)).toEqual([]);
  }
  const benPeer = await hook<string>(b, 'net.self');
  for (const p of [a, b]) {
    await p.getByTestId('voice-join').click();
    await expect(p.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  }
  // One outgoing track per connection, to the other player, closed.
  await expect.poll(() => tracks(a)).toEqual([expect.objectContaining({ peerId: benPeer, seat: 's1', enabled: false })]);
  await expect.poll(() => enabled(b)).toEqual([false]);

  // Push-to-talk on Ann's page.
  await a.bringToFront();
  await toTable(a);
  await a.keyboard.down('Control');
  await expect.poll(() => enabled(a)).toEqual([true]);
  await expect(a.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'live');
  // Ben's page heard of it on presence: Ann's avatar shows the speaking ring there.
  await expect(b.locator('[data-testid="avatar"][data-seat="s0"]')).toHaveAttribute('data-speaking', 'true');
  await a.keyboard.up('Control');
  await expect.poll(() => enabled(a)).toEqual([false]);
  await expect(b.locator('[data-testid="avatar"][data-seat="s0"]')).toHaveAttribute('data-speaking', 'false');
  await a.keyboard.down('Control');
  await expect.poll(() => enabled(a)).toEqual([true]);
  await a.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
  await expect.poll(() => enabled(a)).toEqual([false]);
  await a.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await a.keyboard.up('Control');
  expect(await enabled(a)).toEqual([false]);

  // Turn mic on both: exactly the active player's track is open, and it follows the turn.
  for (const p of [a, b]) {
    await p.getByTestId('voice-settings').click();
    await p.getByTestId('talk-gate-turn').check();
    await expect(p.getByTestId('talk-indicator')).toHaveAttribute('data-gate', 'turn');
  }
  const active = (await hook<TableState>(a, 'state')).turn.active;
  const [mine, theirs] = active === 's0' ? [a, b] : [b, a];
  await expect.poll(() => enabled(mine)).toEqual([true]);
  await expect.poll(() => enabled(theirs)).toEqual([false]);
  expect(await talk(mine)).toMatchObject({ audio: 'all', reason: 'turn' });
  await hook(mine, 'dispatch', { type: 'turnPass', to: active === 's0' ? 's1' : 's0' });
  await expect.poll(() => enabled(theirs)).toEqual([true]);
  await expect.poll(() => enabled(mine)).toEqual([false]);

  // Typing V in the chat on the page whose turn it is not opens nothing.
  await mine.bringToFront();
  await toTable(mine);
  await mine.keyboard.press('Enter');
  await expect(mine.getByTestId('chat-input')).toBeFocused();
  await mine.keyboard.type('very vivid');
  await expect(mine.getByTestId('chat-input')).toHaveValue('very vivid');
  expect(await enabled(mine)).toEqual([false]);
  expect(await talk(mine)).toMatchObject({ audio: 'off', reason: null });
  expect(errors).toEqual([]);
  await context.close();
});
