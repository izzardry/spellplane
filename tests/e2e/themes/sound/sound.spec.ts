// The theme's sound set under the viewer's Settings.sound (DESIGN "Themes and rendering", What a theme package
// contains: "Sound: an optional set ..., off by default in Paper"; theme table, Dusk: "muted ambience"). The HUD root
// says what plays: data-sound 'off', 'on' (waiting for a gesture) or 'playing' (the room tone runs).
import { expect, test, type Page } from '@playwright/test';
import type { ThemeId } from '../../../../src/themes/index';
import { freshProfile, openSolo } from '../../solo/helpers';

/** Settings.sound as stored in the profile's IndexedDB (store/profile.ts dbName, store/settings.ts). */
const storedSound = (page: Page, profile: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open(name);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction('settings').objectStore('settings').get('sound');
            get.onsuccess = () => {
              resolve((get.result as { value?: unknown } | undefined)?.value ?? null);
              db.close();
            };
            get.onerror = () => resolve(null);
          } catch {
            db.close();
            resolve(null);
          }
        };
      }),
    `spellplane-${profile}`,
  );

const setTheme = (page: Page, id: ThemeId) => page.evaluate((t) => window.__spellplane!.theme!.set(t), id);

test('Paper is silent; Dusk plays its room tone after a press; Off silences it and survives a reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const profile = freshProfile(info);
  await openSolo(page, profile);
  const hud = page.getByTestId('hud');
  await expect(hud).toBeVisible();
  await expect(hud).toHaveAttribute('data-sound', 'off');
  await setTheme(page, 'dusk');
  // On by default in Dusk, but audio waits for the viewer's first gesture.
  await expect(hud).toHaveAttribute('data-sound', /^(on|playing)$/);
  await page.mouse.click(40, 450);
  await expect(hud).toHaveAttribute('data-sound', 'playing');
  // The picker's sound choice.
  await page.getByTestId('open-theme-settings').click();
  await expect(page.getByTestId('theme-sound')).toHaveValue('theme');
  await page.getByTestId('theme-sound').selectOption('off');
  await expect(hud).toHaveAttribute('data-sound', 'off');
  // The choice reached this profile's settings store before the reload (store/settings.ts, IndexedDB).
  await expect.poll(() => storedSound(page, profile)).toBe('off');
  await page.reload();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__spellplane?.theme?.current?.())).toBe('dusk');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-sound', 'off');
  await page.getByTestId('open-theme-settings').click();
  await expect(page.getByTestId('theme-sound')).toHaveValue('off');
  expect(errors).toEqual([]);
});
