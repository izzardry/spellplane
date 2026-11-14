/**
 * PLAN M5-P5 acceptance: the card-back setting, with backs.scryfall.io stubbed (tests never use the network). DESIGN
 * "Card data and images", Card back: Spellplane's own neutral back by default; the official back "is an opt-in setting
 * loaded from backs.scryfall.io" and never bundled; card images are drawn whole, never tinted.
 */
import { expect, test, type Page } from '@playwright/test';
import { officialCardBackUrl } from '../../../src/data/back';
import { openApp } from '../helpers/app';
import { openHud, ui } from '../ui/harness';
import { BACK_RGB, openHudSettings, openSettingsHarness, stubBacks } from './helpers';

/** The preview canvas's centre pixel (the back as the HUD draws it). */
async function previewPixel(page: Page): Promise<number[]> {
  return page.getByTestId('back-preview').locator('canvas').evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const d = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  });
}

test.describe('card back setting (settings harness)', () => {
  test('the neutral back is the default and nothing is requested from backs.scryfall.io', async ({ page }) => {
    const urls = await stubBacks(page);
    await openSettingsHarness(page, { section: 'cardBack' });
    const box = page.getByTestId('card-back-settings');
    await expect(box).toHaveAttribute('data-choice', 'spellplane');
    await expect(page.getByTestId('card-back-spellplane')).toBeChecked();
    await expect(page.getByTestId('back-preview')).toHaveAttribute('data-back', 'mtg-back');
    // Give a stray request time to show up.
    await page.waitForTimeout(300);
    expect(urls).toEqual([]);
  });

  test('opting in loads the official back from backs.scryfall.io, draws it untinted, and keeps the choice', async ({ page }) => {
    const urls = await stubBacks(page);
    await openSettingsHarness(page, { section: 'cardBack' });
    await page.getByTestId('card-back-official').check();
    await expect(page.getByTestId('card-back-settings')).toHaveAttribute('data-status', 'official');
    await expect(page.getByTestId('card-back-loaded')).toBeVisible();
    expect(urls).toEqual([officialCardBackUrl('normal')]);
    await expect(page.getByTestId('back-preview')).toHaveAttribute('data-back', 'official-back');
    await expect.poll(() => previewPixel(page)).toEqual(BACK_RGB);
    expect(await page.evaluate(() => window.__settingsHarness!.settings().then((s) => s.cardBack))).toBe('official');

    // The next page loads it again from the stored choice.
    await openSettingsHarness(page, { section: 'cardBack' }, true);
    await expect(page.getByTestId('card-back-settings')).toHaveAttribute('data-status', 'official');
    await expect(page.getByTestId('card-back-official')).toBeChecked();

    // And back to the neutral back.
    await page.getByTestId('card-back-spellplane').check();
    await expect(page.getByTestId('card-back-settings')).toHaveAttribute('data-status', 'neutral');
    await expect(page.getByTestId('back-preview')).toHaveAttribute('data-back', 'mtg-back');
  });

  test('when the image cannot be loaded the neutral back stays, the failure is shown, and Try again loads it', async ({ page }) => {
    const mode = { fail: true };
    const urls = await stubBacks(page, mode);
    await openSettingsHarness(page, { section: 'cardBack' });
    await page.getByTestId('card-back-official').check();
    await expect(page.getByTestId('card-back-settings')).toHaveAttribute('data-status', 'failed');
    const failure = page.getByTestId('card-back-settings').locator('[data-testid="empty-state"][data-state="failedImage"]');
    await expect(failure).toContainText('backs.scryfall.io');
    await expect(page.getByTestId('back-preview')).toHaveAttribute('data-back', 'mtg-back');
    mode.fail = false;
    await page.getByTestId('card-back-retry').click();
    await expect(page.getByTestId('card-back-settings')).toHaveAttribute('data-status', 'official');
    expect(urls.length).toBe(2);
  });
});

test.describe('card back on the table', () => {
  test('the HUD hands the chosen back to the scene, and the neutral back again when switched off', async ({ page }) => {
    await stubBacks(page);
    await openHud(page);
    await expect(page.getByTestId('hud')).toHaveAttribute('data-card-back', 'neutral');
    await openHudSettings(page, 'cardBack');
    await page.getByTestId('card-back-official').check();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-card-back', 'official');
    await expect.poll(async () => (await ui<{ method: string; args: unknown[] }[]>(page, 'scene')).filter((c) => c.method === 'setCardBack')).toEqual([{ method: 'setCardBack', args: [{ id: 'official-back', width: 488, height: 680 }] }]);
    await page.getByTestId('card-back-spellplane').check();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-card-back', 'neutral');
    await expect.poll(async () => (await ui<{ method: string; args: unknown[] }[]>(page, 'scene')).filter((c) => c.method === 'setCardBack').at(-1)).toEqual({ method: 'setCardBack', args: [null] });
  });

  test('in the app, the 3D table takes the official back from the settings panel', async ({ page }) => {
    const urls = await stubBacks(page);
    await openApp(page, { profile: `back${Date.now() % 100000}` });
    await expect(page.getByTestId('hud')).toHaveAttribute('data-card-back', 'neutral');
    expect(urls).toEqual([]);
    await openHudSettings(page, 'cardBack');
    await page.getByTestId('card-back-official').check();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-card-back', 'official');
    expect(urls).toEqual([officialCardBackUrl('normal')]);
    // The table keeps drawing (the scene took the back without an error).
    await expect(page.getByTestId('scene-host').locator('canvas').first()).toBeVisible();
    await expect(page.locator('.scene-error')).toHaveCount(0);
  });
});
