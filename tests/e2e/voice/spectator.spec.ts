/**
 * PLAN Milestone 5, owner decisions: "Spectators listen. A spectator gets a listen-only voice session: they hear the
 * table's open voice but never talk, and team-only talk never reaches them." (M5-P7; DESIGN "Chat and voice", Live
 * voice, Team channel; "Players, seats and formats", Spectators.)
 *
 * 1. The real app on Chromium fake media: Ann and Ben at a table on `?transport=local`, Viv watching by the watch link.
 *    Viv's page shows "Listening", never asks for a microphone and sends no stream; Ann's page carries a track to Viv's
 *    connection that opens for her open talk (hold Ctrl) and closes on release. (BroadcastChannel carries no media, so
 *    the tracks are read through the debug hook's `voice.tracks()`, the real MediaStreamTrack of each connection.)
 * 2. The voice harness (`?harness=voice&watcher=1`: the real HUD and voice controller on the page's real microphone,
 *    Two-Headed Giant, Anna teamed with Ben, plus Vera watching): team talk enables Anna's real track on Ben's
 *    connection only, never on Vera's; open talk, the turn mic and the open mic reach Vera.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SentStream, VoiceHarness } from '../../../src/ui/voice/harness';
import type { VoiceTrackState } from '../../../src/voice/types';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, open, openTable, setNickname, startPageLoaded, twoPages } from '../lobby/helpers';

test.skip(({ browserName }) => browserName !== 'chromium', 'fake media is Chromium-only; WebKit would prompt for the microphone');

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
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

const tracks = (page: Page) => hook<VoiceTrackState[]>(page, 'voice.tracks');

test('a spectator listens: "Listening", no microphone, no stream; a player\'s open talk reaches its connection', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const { context, a, b } = await twoPages(browser);
  const v = await context.newPage();
  // Count microphone requests on the spectator's page.
  await v.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md?.getUserMedia?.bind(md);
    (window as unknown as { __micAsks: number }).__micAsks = 0;
    if (md && real)
      md.getUserMedia = (c?: MediaStreamConstraints) => {
        (window as unknown as { __micAsks: number }).__micAsks++;
        return real(c);
      };
  });
  const errors: string[] = [];
  for (const p of [a, b, v]) p.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'sa'));
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await openTable(b, room, freshProfile(info, 'sb'));
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  const watchLink = await a.getByTestId('watch-link').inputValue();
  await watchFromStart(v, freshProfile(info, 'sv'), 'Viv', watchLink);
  await expect(a.getByTestId('spectator-name')).toHaveText('Viv');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b, v]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });

  // The spectator's own controls: listening only, nothing to join or mute.
  const indicator = v.getByTestId('talk-indicator');
  await expect(indicator).toHaveAttribute('data-state', 'listening');
  await expect(v.getByTestId('talk-state')).toHaveText('Listening');
  await expect(v.getByTestId('voice-join')).toHaveCount(0);
  await expect(v.getByTestId('voice-mute')).toHaveCount(0);
  await v.getByTestId('voice-settings').click();
  await expect(v.getByTestId('voice-listening')).toBeVisible();
  await expect(v.getByTestId('talk-gate-ptt')).toHaveCount(0);
  await v.getByTestId('voice-settings').click();

  // Ann and Ben join voice; Ann's page carries a closed track to each connection: Ben's and Viv's.
  for (const p of [a, b]) {
    await p.bringToFront();
    await p.getByTestId('voice-join').click();
    await expect(p.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  }
  const vivPeer = await hook<string>(v, 'net.self');
  await expect.poll(async () => (await tracks(a)).map((t) => [t.peerId === vivPeer ? 'viv' : t.seat, t.enabled]).sort()).toEqual([
    ['s1', false],
    ['viv', false],
  ]);

  // Ann holds Ctrl alone: her open talk reaches Ben and Viv; released, it closes.
  await a.bringToFront();
  await a.mouse.move(700, 420);
  await a.keyboard.down('Control');
  await expect.poll(async () => (await tracks(a)).map((t) => t.enabled)).toEqual([true, true]);
  await a.keyboard.up('Control');
  await expect.poll(async () => (await tracks(a)).map((t) => t.enabled)).toEqual([false, false]);

  // Viv holds Ctrl: nothing opens, no microphone was ever asked for, no stream exists on her page.
  await v.bringToFront();
  await v.mouse.move(700, 420);
  await v.keyboard.down('Control');
  await v.waitForTimeout(500);
  expect(await hook(v, 'voice.talk')).toMatchObject({ audio: 'off', dictation: 'off' });
  await v.keyboard.up('Control');
  expect(await tracks(v)).toEqual([]);
  expect(await v.evaluate(() => (window as unknown as { __micAsks: number }).__micAsks)).toBe(0);
  await expect(indicator).toHaveAttribute('data-state', 'listening');
  expect(errors).toEqual([]);
  await context.close();
});

type Fn = keyof VoiceHarness;
const vh = <T = unknown>(page: Page, fn: Fn, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    async ([name, x]) => {
      const out = await (window.__voiceHarness as unknown as Record<string, (...y: unknown[]) => unknown>)[name as string]!(...(x as unknown[]));
      return JSON.parse(JSON.stringify(out ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;

/** Whether the live stream sent to each connection has its real track enabled. */
async function sentEnabled(page: Page): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const s of await vh<SentStream[]>(page, 'sent')) if (!s.removed) out[s.peer] = s.tracks.length === 1 && s.tracks[0]!.readyState === 'live' && s.tracks[0]!.enabled;
  return out;
}

test('secrecy: team talk never reaches a spectator\'s connection; open talk, the turn mic and the open mic do', async ({ page }) => {
  await page.goto('./?faces=placeholder&harness=voice&watcher=1');
  await expect.poll(() => page.evaluate(() => typeof window.__voiceHarness === 'object')).toBe(true);
  await page.getByTestId('voice-join').click();
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  const OFF = { 't-ben': false, 't-cara': false, 't-dan': false, 't-vera': false };
  const ALL = { 't-ben': true, 't-cara': true, 't-dan': true, 't-vera': true };
  const TEAM = { 't-ben': true, 't-cara': false, 't-dan': false, 't-vera': false };
  await expect.poll(() => sentEnabled(page)).toEqual(OFF);
  await page.mouse.move(700, 400);

  // Team talk: Shift held, then Ctrl alone.
  await page.keyboard.down('Shift');
  await page.keyboard.down('Control');
  await expect.poll(() => sentEnabled(page)).toEqual(TEAM);
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'team');
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');
  await expect.poll(() => sentEnabled(page)).toEqual(OFF);

  // Open talk reaches the spectator.
  await page.keyboard.down('Control');
  await expect.poll(() => sentEnabled(page)).toEqual(ALL);
  await page.keyboard.up('Control');
  await expect.poll(() => sentEnabled(page)).toEqual(OFF);

  // The turn mic (Anna's team's turn) and the open mic reach it too; team talk over the open mic narrows to Ben only.
  await vh(page, 'setTalk', { gate: 'turn' });
  await vh(page, 'setActive', 't0');
  await expect.poll(() => sentEnabled(page)).toEqual(ALL);
  await vh(page, 'setActive', 't1');
  await expect.poll(() => sentEnabled(page)).toEqual(OFF);
  await vh(page, 'setTalk', { gate: 'open' });
  await expect.poll(() => sentEnabled(page)).toEqual(ALL);
  await page.keyboard.down('Shift');
  await page.keyboard.down('Control');
  await expect.poll(() => sentEnabled(page)).toEqual(TEAM);
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');
  await expect.poll(() => sentEnabled(page)).toEqual(ALL);
  // Never once was Vera's track enabled while team talk was on (the debug hook agrees per connection).
  const t = await page.evaluate(() => window.__spellplane!.voice!.tracks());
  expect(t.find((x) => x.peer === 't-vera')).toMatchObject({ seat: null, enabled: true });
});
