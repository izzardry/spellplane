/**
 * PLAN Milestone 5, owner decisions, Talk key: "Ctrl, either key, instead of V. It never types into a note field.
 * Chords stay shortcuts: the mic and dictation open only after Ctrl has been held alone for about 200 ms. A key or
 * click during that time makes it a shortcut (Ctrl+Z, Ctrl+Enter, Ctrl+T, Ctrl+click), and no audio or caption is
 * sent. The talk mouse button stays … The cheat sheet, hints and labels say Ctrl." (M5-P7)
 *
 * On the voice harness (`?harness=voice`: the real HUD and the real voice controller on Chromium's fake microphone, a
 * fake transport recording the stream sent to each of Ben, Cara and Dan). A chord's second key must arrive within the
 * 200 ms, which a test cannot promise across processes on a slow machine, so chords are dispatched in one task in the
 * page (both events before any timer can run); Ctrl held alone and Ctrl pressed during a click use the real keyboard
 * and mouse. Engine facts come from the harness and the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SentStream, VoiceHarness } from '../../../src/ui/voice/harness';

test.skip(({ browserName }) => browserName !== 'chromium', 'fake media is Chromium-only; WebKit would prompt for the microphone');

type Fn = keyof VoiceHarness;
const vh = <T = unknown>(page: Page, fn: Fn, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    async ([name, x]) => {
      const out = await (window.__voiceHarness as unknown as Record<string, (...y: unknown[]) => unknown>)[name as string]!(...(x as unknown[]));
      return JSON.parse(JSON.stringify(out ?? null)) as unknown;
    },
    [fn, args] as const,
  ) as Promise<T>;

async function enabled(page: Page): Promise<boolean[]> {
  return (await vh<SentStream[]>(page, 'sent')).filter((s) => !s.removed).map((s) => s.tracks[0]?.enabled ?? false);
}
const talk = (page: Page) => page.evaluate(() => window.__spellplane!.voice!.talk());

/** Watch the talk state from inside the page: true once any audio or caption opened since the call. */
async function watchOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __opened: boolean; __watch?: number };
    w.__opened = false;
    if (w.__watch) clearInterval(w.__watch);
    const check = () => {
      const t = window.__spellplane!.voice!.talk();
      if (t.audio !== 'off' || t.dictation !== 'off') w.__opened = true;
    };
    check();
    w.__watch = window.setInterval(check, 5);
  });
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: boolean }).__opened);

async function openVoice(page: Page): Promise<void> {
  await page.goto('./?faces=placeholder&harness=voice');
  await expect.poll(() => page.evaluate(() => typeof window.__voiceHarness === 'object')).toBe(true);
  await page.getByTestId('voice-join').click();
  await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'idle');
  await expect.poll(() => enabled(page)).toEqual([false, false, false]);
  // Dictation on as well: a chord must send neither audio nor a caption.
  await vh(page, 'setTalk', { voice: true, dictation: true });
  await page.mouse.move(700, 400);
}

test('the talk key is Ctrl: labels and the cheat sheet say so', async ({ page }) => {
  await openVoice(page);
  await expect(page.getByTestId('talk-state')).toHaveText('Hold Ctrl to talk');
  await page.getByTestId('open-cheat-sheet').click();
  await expect(page.locator('[data-testid="cheat-row"][data-action="talk"] [data-testid="cheat-key"]')).toHaveText(['Ctrl']);
  await expect(page.locator('[data-testid="cheat-row"][data-action="teamTalk"] [data-testid="cheat-key"]')).toHaveText(['Shift+Ctrl']);
});

test('Ctrl held alone opens the mic and dictation; either Ctrl key; release closes', async ({ page }) => {
  await openVoice(page);
  for (const key of ['Control', 'ControlRight']) {
    await page.keyboard.down(key);
    await expect.poll(() => enabled(page)).toEqual([true, true, true]);
    expect(await talk(page)).toMatchObject({ audio: 'all', dictation: 'caption', reason: 'key' });
    await expect(page.getByTestId('talk-indicator')).toHaveAttribute('data-state', 'live');
    await page.keyboard.up(key);
    await expect.poll(() => enabled(page)).toEqual([false, false, false]);
    expect(await talk(page)).toMatchObject({ audio: 'off', dictation: 'off' });
  }
});

for (const chord of [
  { name: 'Ctrl+Z', key: 'z', code: 'KeyZ' },
  { name: 'Ctrl+Enter', key: 'Enter', code: 'Enter' },
  { name: 'Ctrl+T', key: 't', code: 'KeyT' },
]) {
  test(`${chord.name} within the hold time stays a shortcut: no audio, no caption, however long Ctrl stays down`, async ({ page }) => {
    await openVoice(page);
    await watchOpen(page);
    // Ctrl and the chord's key in one task: the second key surely comes within the 200 ms.
    await page.evaluate(({ key, code }) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, ctrlKey: true, bubbles: true }));
    }, chord);
    // Ctrl stays down well past the hold time.
    await page.waitForTimeout(600);
    expect(await opened(page)).toBe(false);
    expect(await enabled(page)).toEqual([false, false, false]);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true })));
    await page.waitForTimeout(100);
    expect(await opened(page)).toBe(false);
    // The shortcut did its own thing (Ctrl+T opens the token search, a text field): close it and leave any field.
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // The next lone hold talks again.
    await page.keyboard.down('Control');
    await expect.poll(() => enabled(page)).toEqual([true, true, true]);
    await page.keyboard.up('Control');
  });
}

test('Ctrl+click stays a shortcut: Ctrl pressed with the mouse button down, or a click during the hold time, sends nothing', async ({ page }) => {
  await openVoice(page);
  await watchOpen(page);
  // A click already held when Ctrl goes down (Ctrl+drag, Ctrl+click): real mouse and keyboard.
  await page.mouse.down();
  await page.keyboard.down('Control');
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.keyboard.up('Control');
  expect(await opened(page)).toBe(false);
  // A click right after Ctrl, in one task.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, button: 0, ctrlKey: true, bubbles: true }));
  });
  await page.waitForTimeout(600);
  expect(await opened(page)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true })));
  expect(await enabled(page)).toEqual([false, false, false]);
});

test('the talk mouse button still talks at once', async ({ page }) => {
  await openVoice(page);
  await vh(page, 'setTalk', { mouseButton: 3 });
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true })));
  await expect.poll(() => enabled(page)).toEqual([true, true, true]);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true })));
  await expect.poll(() => enabled(page)).toEqual([false, false, false]);
});
