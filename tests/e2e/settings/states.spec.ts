/**
 * PLAN M5-P5 acceptance: each empty and error state reachable in the harness (no deck, no cards found, no peers, relay
 * unreachable, storage full, failed image), first-run hints (short, dismissible, never blocking), and the consolidated
 * settings panel. DESIGN "Input and interaction design", Nothing modal: prompts are inline and dismissible, and the
 * table stays live under them.
 */
import { expect, test } from '@playwright/test';
import { openApp } from '../helpers/app';
import { drafts, hoverCard, openHud } from '../ui/harness';
import { openHudSettings, openSettingsHarness } from './helpers';

test.describe('empty and error states in the settings harness', () => {
  test('every state the plan names is shown with what it means', async ({ page }) => {
    await openSettingsHarness(page);
    const states = page.getByTestId('harness-states');
    for (const [id, title] of [
      ['noDeck', 'No deck yet'],
      ['noCardsFound', 'No cards found'],
      ['noPeers', 'No other players connected'],
      ['relayUnreachable', 'Relays unreachable'],
      ['storageFull', 'Storage full'],
      ['failedImage', 'Image unavailable'],
    ] as const) {
      const s = states.locator(`[data-testid="empty-state"][data-state="${id}"]`);
      await expect(s).toBeVisible();
      await expect(s.locator('strong')).toHaveText(title);
    }
    await expect(states.locator('[data-state="relayUnreachable"]')).toContainText('no relay server');
  });

  test('a card image that cannot be loaded shows the card name in its frame, never a broken image', async ({ page }) => {
    await openSettingsHarness(page);
    await expect(page.getByTestId('face-broken').getByTestId('face-failed')).toContainText('Grizzly Bears');
    await expect(page.getByTestId('face-broken').getByTestId('face-failed')).toContainText('Image unavailable');
    await expect(page.getByTestId('face-ok').getByTestId('face-failed')).toHaveCount(0);
  });

  test('storage: full, nearly full, unknown', async ({ page }) => {
    await openSettingsHarness(page);
    await expect(page.getByTestId('harness-storage-full').locator('[data-state="storageFull"]')).toBeVisible();
    await openSettingsHarness(page, { section: 'storage', storage: 'nearly' });
    const section = page.getByTestId('settings').getByTestId('storage-settings');
    await expect(section).toHaveAttribute('data-level', 'nearlyFull');
    await expect(section.getByTestId('storage-nearly-full')).toBeVisible();
    await expect(section.getByTestId('storage-summary')).toContainText('930 MB of 1 GB used');
    await openSettingsHarness(page, { section: 'storage', storage: 'full' });
    await expect(page.getByTestId('settings').locator('[data-state="storageFull"]')).toBeVisible();
    await openSettingsHarness(page, { section: 'storage', storage: 'error' });
    await expect(page.getByTestId('settings').getByTestId('storage-summary')).toContainText('does not report');
  });
});

test.describe('empty and error states on the table (HUD harness)', () => {
  test('no deck: an inline notice offers the deck import, can be dismissed, and goes once cards are there', async ({ page }) => {
    await openHud(page);
    await expect(page.locator('[data-testid="empty-state"][data-state="noDeck"]')).toHaveCount(0);
    await page.evaluate(() =>
      window.__uiHarness!.update((s, sec) => {
        sec.hand = [];
        sec.libraryOrder = [];
        sec.identities = {};
        for (const c of Object.values(s.cards)) if (c.owner === 's0') delete s.cards[c.id];
        for (const z of Object.values(s.zones)) if (z.owner === 's0') {
          z.ids = [];
          if ('count' in z) z.count = 0;
        }
      }),
    );
    const notice = page.locator('[data-testid="empty-state"][data-state="noDeck"]');
    await expect(notice).toBeVisible();
    await notice.getByTestId('empty-import-deck').click();
    await expect(page.getByTestId('deck-import')).toBeVisible();
    await expect(notice).toHaveCount(0);
    await page.getByTestId('deck-import').getByRole('button', { name: 'Close' }).click();
    await expect(notice).toBeVisible();
    await notice.getByTestId('empty-state-dismiss').click();
    await expect(notice).toHaveCount(0);
  });

  test('no cards found: a token search with no match says so', async ({ page }) => {
    await openHud(page);
    await page.keyboard.press('Control+KeyT');
    await page.getByTestId('token-query').fill('zzzzqq');
    await expect(page.getByTestId('token-search').locator('[data-state="noCardsFound"]')).toContainText('zzzzqq');
  });

  test('storage full: a refused write shows the notice, which opens the storage settings', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() => {
      void Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    });
    const notice = page.locator('[data-testid="empty-state"][data-state="storageFull"]');
    await expect(notice).toBeVisible();
    await notice.getByTestId('empty-storage-settings').click();
    await expect(page.getByTestId('settings')).toHaveAttribute('data-section', 'storage');
  });
});

test.describe('first-run hints', () => {
  test('one at a time, never blocking: keys work while a hint shows; dismissed hints stay dismissed', async ({ page }) => {
    await openHud(page);
    const hint = page.getByTestId('hint');
    await expect(hint).toHaveAttribute('data-hint', 'welcome');
    await expect(hint).toHaveCount(1);
    // The table stays live under the hint.
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
    // Only its button takes the pointer.
    const box = (await hint.boundingBox())!;
    const through = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="hint"]') === null, [box.x + 6, box.y + 6]);
    expect(through).toBe(true);
    await expect(hint).not.toBeFocused();

    await hint.getByTestId('hint-dismiss').click();
    await expect(hint).toHaveAttribute('data-hint', 'tableKeys');
    await expect(hint).toContainText('T taps it');
    await hint.getByTestId('hint-dismiss').click();
    await expect(hint).toHaveCount(0);
    await openHud(page, { keepSettings: true });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('hint')).toHaveCount(0);
  });

  test('hints name the player\'s own keys', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('hint').getByTestId('hint-dismiss').click();
    await openHudSettings(page, 'keys');
    await page.locator('[data-testid="key-row"][data-action="tap"]').getByTestId('key-change').click();
    await page.keyboard.press('KeyJ');
    await expect(page.getByTestId('hint')).toContainText('J taps it');
  });

  test('a touch screen gets the gesture hint instead of the keys; voice adds the talk key', async ({ page }) => {
    await openSettingsHarness(page, { touch: '1', voice: '1' });
    const hint = page.getByTestId('harness-hints').getByTestId('hint');
    await expect(hint).toHaveAttribute('data-hint', 'welcome');
    await hint.getByTestId('hint-dismiss').click();
    await expect(hint).toHaveAttribute('data-hint', 'touchGestures');
    await expect(hint).toContainText('long-press');
    await hint.getByTestId('hint-dismiss').click();
    await expect(hint).toHaveAttribute('data-hint', 'talkKey');
    // A touch screen has no talk key to hold: the hint names the thumb bar's Talk button (M5 gate).
    await expect(hint).toContainText('Touch and hold Talk');
    await expect(hint).not.toContainText('Ctrl');
  });

  test('the start page welcomes a new player once', async ({ page }) => {
    await openApp(page, { hash: '/lobby' });
    const hint = page.getByTestId('hint');
    // One hint at a time (M5 gate): where the browser can be asked to keep the data, that prompt comes first.
    const persist = page.getByTestId('hint-persist');
    await expect(hint.or(persist)).toBeVisible();
    if ((await persist.count()) > 0) {
      await expect(hint).toHaveCount(0);
      await persist.getByTestId('hint-persist-later').click();
    }
    await expect(hint).toHaveAttribute('data-hint', 'welcome');
    await hint.getByTestId('hint-dismiss').click();
    await expect(hint).toHaveCount(0);
    // Kept in this profile's settings (IndexedDB) before the page goes.
    const stored = () =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            const r = indexedDB.open('spellplane');
            r.onerror = () => resolve(null);
            r.onsuccess = () => {
              const db = r.result;
              const g = db.transaction('settings').objectStore('settings').get('hintsSeen');
              g.onsuccess = () => {
                resolve((g.result as { value?: unknown } | undefined)?.value ?? null);
                db.close();
              };
              g.onerror = () => resolve(null);
            };
          }),
      );
    await expect.poll(async () => ((await stored()) as string[] | null)?.includes('welcome') ?? false).toBe(true);
    await page.reload();
    await expect(page.getByTestId('route-lobby')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('hint')).toHaveCount(0);
  });
});

test.describe('one settings panel', () => {
  test('on the table: display, voice, dictation, keys, card back, storage and About; the theme popover stays a shortcut', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-settings').click();
    const panel = page.getByTestId('settings');
    await expect(panel.getByTestId('settings-tab')).toHaveText(['Display and sound', 'Voice', 'Dictation', 'Keys', 'Card back', 'Storage', 'About']);
    await expect(panel.getByTestId('theme-picker')).toBeVisible();
    await expect(panel.getByTestId('theme-quality')).toBeVisible();
    await expect(panel.getByTestId('follow-stack')).toBeVisible();
    await expect(panel.getByTestId('theme-sound')).toBeVisible();
    await panel.getByTestId('theme-quality').selectOption('low');
    await expect.poll(async () => (await page.evaluate(() => window.__uiHarness!.scene())).some((c) => c.method === 'setQuality' && c.args[0] === 'low')).toBe(true);
    await openHudSettings(page, 'voice');
    await expect(panel.getByTestId('voice-settings-offline')).toBeVisible();
    await openHudSettings(page, 'about');
    await expect(panel.getByTestId('fan-content-notice')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('in the app the theme popover stays as a shortcut beside the settings button', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('open-theme-settings').click();
    await expect(page.getByTestId('theme-settings')).toBeVisible();
    await page.getByTestId('open-settings').click();
    // The popover closed (its × is the popover's own); the panel holds the same picker.
    await expect(page.getByTestId('theme-close')).toHaveCount(0);
    await expect(page.getByTestId('settings').getByTestId('theme-picker')).toBeVisible();
  });

  test('at #/settings away from a table, a change is kept for the table', async ({ page }) => {
    await openApp(page, { hash: '/settings' });
    await page.locator('[data-testid="settings-tab"][data-section="keys"]').click();
    await page.locator('[data-testid="key-row"][data-action="tap"]').getByTestId('key-change').click();
    await page.keyboard.press('KeyJ');
    await expect(page.locator('[data-testid="key-row"][data-action="tap"]').getByTestId('key-current')).toHaveText(['J']);
    await page.goto(page.url().replace(/#.*$/, '#/'));
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.getByTestId('open-cheat-sheet').click();
    await expect(page.locator('[data-testid="cheat-row"][data-action="tap"]').getByTestId('cheat-key')).toHaveText(['J']);
  });
});
