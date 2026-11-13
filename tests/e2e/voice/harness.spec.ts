/**
 * PLAN M3-P3 acceptance on Chromium fake media (`?harness=voice`: the real HUD and the real voice controller on the
 * page's real microphone, over a fake four-seat Two-Headed Giant session in which you are Anna, teamed with Ben against
 * Cara and Dan, and a fake transport that records the stream added to each connection).
 *
 * DESIGN "Chat and voice": push-to-talk opens the mic while the talk key is held (Ctrl since M5: PLAN Milestone 5, owner
 * decisions, Talk key; it opens after Ctrl was held alone for about 200 ms, so the tests poll for it); "The talk key is released on
 * window blur and ignored while a text field has focus"; the turn mic opens for the whole own turn ("In Two-Headed Giant
 * the active team's mics open"); "Shift plus the talk key sends audio only to the teammate"; a speaking ring; personal
 * volume and mute per player. "Input and interaction design": no table hotkey fires while the chat has focus. PLAN:
 * device picker.
 *
 * Only Chromium gets media (fake device and fake permission UI from playwright.config.ts); WebKit would show the macOS
 * microphone prompt, so on WebKit only the chat test runs, without joining voice.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SentStream, VoiceHarness } from '../../../src/ui/voice/harness';

type Fn = keyof VoiceHarness;
const vh = <T = unknown>(page: Page, fn: Fn, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    async ([name, a]) => {
      const out = await (window.__voiceHarness as unknown as Record<string, (...x: unknown[]) => unknown>)[name as string]!(...(a as unknown[]));
      return JSON.parse(JSON.stringify(out ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;

/** Whether the live (not removed) stream sent to each of Ben, Cara and Dan has its real track enabled. */
async function sentEnabled(page: Page): Promise<Record<string, boolean | null>> {
  const sent = await vh<SentStream[]>(page, 'sent');
  const out: Record<string, boolean | null> = { 't-ben': null, 't-cara': null, 't-dan': null };
  for (const s of sent) if (!s.removed) out[s.peer] = s.tracks.length === 1 && s.tracks[0]!.kind === 'audio' && s.tracks[0]!.readyState === 'live' && s.tracks[0]!.enabled;
  return out;
}
const ALL_OFF = { 't-ben': false, 't-cara': false, 't-dan': false };
const ALL_ON = { 't-ben': true, 't-cara': true, 't-dan': true };
const TEAM_ONLY = { 't-ben': true, 't-cara': false, 't-dan': false };

async function openVoice(page: Page): Promise<void> {
  await page.goto('./?faces=placeholder&harness=voice');
  await expect.poll(() => page.evaluate(() => typeof window.__voiceHarness === 'object')).toBe(true);
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'noMic');
}

/** Click "Join voice" (the click that acquires the microphone) and wait for every connection's track. */
async function joinVoice(page: Page): Promise<void> {
  await page.getByTestId('voice-join').click();
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('voice-join')).toHaveCount(0);
  await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
}

/** Move the pointer over the table, away from the HUD's controls. */
const toTable = (page: Page) => page.mouse.move(700, 400);
const blurWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
const focusWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));

test.describe('voice on Chromium fake media (PLAN M3-P3)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'fake media is Chromium-only; WebKit would prompt for the microphone');

  test('push-to-talk: the local track is enabled only while the key is held, and disabled on window blur', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openVoice(page);
    // Before joining no audio exists, and the key opens nothing.
    await toTable(page);
    await page.keyboard.down('Control');
    expect(await vh(page, 'sent')).toEqual([]);
    await page.keyboard.up('Control');

    await joinVoice(page);
    // The real microphone track: one live audio track per connection, each its own track.
    const sent = await vh<SentStream[]>(page, 'sent');
    expect(sent.map((s) => s.peer).sort()).toEqual(['t-ben', 't-cara', 't-dan']);

    await toTable(page);
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'live');
    await page.keyboard.up('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');

    // Held again, then the window loses focus: the key counts as released, and coming back does not reopen it.
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await blurWindow(page);
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await focusWindow(page);
    expect(await sentEnabled(page)).toEqual(ALL_OFF);
    await page.keyboard.up('Control');
    expect(await sentEnabled(page)).toEqual(ALL_OFF);
    // A fresh press works again.
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.up('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    // The debug hook reports the same per connection.
    const tracks = await page.evaluate(() => window.__spellplane!.voice!.tracks());
    expect(tracks.map((t) => [t.peer, t.enabled]).sort()).toEqual([
      ['t-ben', false],
      ['t-cara', false],
      ['t-dan', false],
    ]);
    expect(errors).toEqual([]);
  });

  test('turn mic enables the track exactly for the player’s own turn (the active team’s in Two-Headed Giant)', async ({ page }) => {
    await openVoice(page);
    await joinVoice(page);
    await vh(page, 'setActive', 't1');
    await page.getByTestId('voice-settings').click();
    await page.getByTestId('talk-gate-turn').check();
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-gate', 'turn');
    expect(await sentEnabled(page)).toEqual(ALL_OFF);

    // Anna and Ben's team's turn: Anna's mic opens to everyone, without any key.
    await vh(page, 'setActive', 't0');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'live');
    expect(await page.evaluate(() => window.__spellplane!.voice!.talk())).toMatchObject({ audio: 'all', reason: 'turn' });
    // The turn passes to the other team: closed.
    await vh(page, 'setActive', 't1');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    // Outside the own turn it is push-to-talk.
    await toTable(page);
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.up('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    // The setting persists.
    expect(await vh<{ name: string; value: { gate?: string } }[]>(page, 'settingsWrites')).toContainEqual({ name: 'talk', value: expect.objectContaining({ gate: 'turn' }) });
  });

  test('team talk (Shift, then Ctrl) enables the track only on the teammate’s connection', async ({ page }) => {
    await openVoice(page);
    await joinVoice(page);
    await toTable(page);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(TEAM_ONLY);
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'team');
    // Team talk is not announced on the broadcast speaking presence.
    expect(await vh<boolean[]>(page, 'announced')).not.toContain(true);
    // Releasing Ctrl while Shift is still down closes it.
    await page.keyboard.up('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await page.keyboard.up('Shift');

    // With the open mic, team talk narrows it to Ben while held, then opens it to the table again.
    await vh(page, 'setTalk', { gate: 'open' });
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(TEAM_ONLY);
    // Window blur releases team talk too.
    await blurWindow(page);
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.up('Control');
    await page.keyboard.up('Shift');
    // M mutes the open mic.
    await focusWindow(page);
    await page.keyboard.press('m');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'muted');
  });

  test('a talk key held when the chat takes focus is released, and typing into the chat never opens the mic', async ({ page }) => {
    await openVoice(page);
    await joinVoice(page);
    // Open the chat once (Enter) and come back to the table, so its field exists.
    await toTable(page);
    await page.keyboard.press('Enter');
    const chat = page.getByTestId('chat-input');
    await expect(chat).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chat).not.toBeFocused();
    await toTable(page);
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    // The chat takes focus while Ctrl is still held: the mic closes.
    await chat.focus();
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await page.keyboard.up('Control');
    await page.keyboard.type('vivid view');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Shift');
    await expect(chat).toHaveValue('vivid viewV');
    // Ctrl held alone in the chat opens nothing either.
    await page.keyboard.down('Control');
    await page.waitForTimeout(500);
    expect(await sentEnabled(page)).toEqual(ALL_OFF);
    await page.keyboard.up('Control');
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  });

  test('speaking rings, per-player volume and mute, and the device picker', async ({ page }) => {
    await openVoice(page);
    await joinVoice(page);
    // Cara's presence says she speaks: her avatar shows the ring.
    await vh(page, 'presenceSpeaking', 'peer-cara', true);
    await expect(page.locator('[data-testid="avatar"][data-seat="s2"]')).toHaveAttribute('data-speaking', 'true');
    await expect(page.locator('[data-testid="avatar"][data-seat="s3"]')).toHaveAttribute('data-speaking', 'false');
    await vh(page, 'presenceSpeaking', 'peer-cara', false);
    await expect(page.locator('[data-testid="avatar"][data-seat="s2"]')).toHaveAttribute('data-speaking', 'false');

    // Ben's audio arrives and plays at full volume; Anna turns him down and mutes Dan.
    await vh(page, 'remoteStream', 't-ben');
    await vh(page, 'remoteStream', 't-dan');
    await expect.poll(() => vh(page, 'played')).toEqual({ 't-ben': { volume: 1, muted: false }, 't-dan': { volume: 1, muted: false } });
    await page.getByTestId('voice-settings').click();
    const ben = page.locator('[data-testid="peer-audio"][data-peer="peer-ben"]');
    await expect(page.getByTestId('peer-audio')).toHaveCount(3);
    await ben.getByTestId('peer-volume').fill('30');
    await page.locator('[data-testid="peer-audio"][data-peer="peer-dan"]').getByTestId('peer-mute').check();
    await expect.poll(() => vh(page, 'played')).toEqual({ 't-ben': { volume: 0.3, muted: false }, 't-dan': { volume: 1, muted: true } });
    await expect
      .poll(async () => (await vh<{ name: string; value: unknown }[]>(page, 'settingsWrites')).filter((w) => w.name === 'peerAudio').at(-1)?.value)
      .toEqual({ 'peer-ben': { volume: 0.3, muted: false }, 'peer-dan': { volume: 1, muted: true } });

    // The device picker lists the fake microphones; choosing one moves every connection to it, gate state intact.
    const picker = page.getByTestId('mic-device');
    await expect.poll(() => picker.locator('option').count()).toBeGreaterThan(1);
    const id = await picker.locator('option').nth(1).getAttribute('value');
    expect(id).toBeTruthy();
    await picker.focus();
    await picker.selectOption(id!);
    await expect.poll(async () => (await vh<SentStream[]>(page, 'sent')).filter((s) => s.removed).length).toBe(3);
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    expect(await vh<{ name: string; value: unknown }[]>(page, 'settingsWrites')).toContainEqual({ name: 'micDevice', value: id });
    // The picker lets go of focus after a choice (a focused select counts as a text field): the talk key works at once.
    await expect(picker).not.toBeFocused();
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.up('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_OFF);
    await toTable(page);
    await page.keyboard.down('Control');
    await expect.poll(() => sentEnabled(page)).toEqual(ALL_ON);
    await page.keyboard.up('Control');
  });
});

test('no talk key event leaks into chat while typing, and typing never opens the talk gate (no microphone needed)', async ({ page }) => {
  await openVoice(page);
  // Dictation on (it needs no microphone): a talk key that leaked from a text field would start dictating.
  await vh(page, 'setTalk', { dictation: true });
  await toTable(page);
  await page.keyboard.down('Control');
  await expect.poll(() => page.evaluate(() => window.__spellplane!.voice!.talk().dictation)).toBe('caption');
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.__spellplane!.voice!.talk().dictation)).toBe('off');

  // In the chat: V and Shift+V type, Ctrl held alone does nothing, nothing talks.
  await page.keyboard.press('Enter');
  const chat = page.getByTestId('chat-input');
  await expect(chat).toBeFocused();
  await page.keyboard.down('v');
  await page.keyboard.up('v');
  await page.keyboard.type('oice ');
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyV');
  await page.keyboard.up('KeyV');
  await page.keyboard.up('Shift');
  await page.keyboard.down('Control');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__spellplane!.voice!.talk())).toEqual({ audio: 'off', dictation: 'off', reason: null, muted: false });
  await page.keyboard.up('Control');
  await page.keyboard.press('m');
  await expect(chat).toHaveValue('voice Vm');
  // M typed into the chat did not mute.
  expect(await page.evaluate(() => window.__spellplane!.voice!.talk().muted)).toBe(false);
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'noMic');

  // Another text field outside the HUD (a search box) is no different.
  await page.getByTestId('harness-text').click();
  await page.keyboard.down('Control');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__spellplane!.voice!.talk().dictation)).toBe('off');
  await page.keyboard.up('Control');
  await page.keyboard.type('v');
  await expect(page.getByTestId('harness-text')).toHaveValue('v');
});
