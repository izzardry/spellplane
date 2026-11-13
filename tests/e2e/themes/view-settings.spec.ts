// The picker's view settings: the quality level and the two follow toggles (DESIGN "Themes and rendering", Renderer: "a
// per-theme quality setting drops shadows and post-processing first"; "Camera and navigation", Follow options: two
// personal toggles, off by default; "Local persistence": quality and follow toggles are per-browser settings).
// Behaviour is read from the debug hook's render and rig parts, never from pixels.
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { freshProfile, openSolo } from '../solo/helpers';

type Stats = { quality: string; theme: string; shadows: boolean; passes: string[] };
type Follow = { stack: boolean; activePlayer: boolean };

const choice = (page: Page) => hook<string>(page, 'render.quality');
const stats = (page: Page) => hook<Stats>(page, 'render.stats');
const follow = (page: Page) => hook<Follow>(page, 'rig.follow');

test('quality and follow toggles set in the picker reach the scene, survive a theme switch and a reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(() => choice(page)).toBe('high');
  expect(await follow(page)).toEqual({ stack: false, activePlayer: false });

  await page.getByTestId('open-theme-settings').click();
  const quality = page.getByTestId('theme-quality');
  const followStack = page.getByRole('checkbox', { name: 'Follow the stack' });
  const followActive = page.getByRole('checkbox', { name: 'Follow the active player' });
  await expect(quality).toHaveValue('high');
  await expect(page.getByRole('combobox', { name: 'Quality' })).toBeVisible();
  await expect(followStack).not.toBeChecked();
  await expect(followActive).not.toBeChecked();

  // Paper has one level: the choice is kept, the level shown stays Paper's.
  await quality.selectOption('low');
  await expect.poll(() => choice(page)).toBe('low');
  expect(await stats(page)).toMatchObject({ theme: 'paper', quality: 'high' });

  // Keyboard: Space toggles a focused checkbox.
  await followStack.focus();
  await page.keyboard.press('Space');
  await followActive.check();
  await expect.poll(() => follow(page)).toEqual({ stack: true, activePlayer: true });
  await followStack.uncheck();
  await expect.poll(() => follow(page)).toEqual({ stack: false, activePlayer: true });

  // A theme switch keeps the choice; Dusk resolves it to its own low level (no shadows, no post-processing).
  await page.locator('[data-testid="theme-option"][data-theme="dusk"]').click();
  await expect.poll(async () => (await stats(page)).theme, { timeout: 15_000 }).toBe('dusk');
  await expect.poll(() => stats(page)).toMatchObject({ theme: 'dusk', quality: 'low', shadows: false, passes: [] });
  expect(await choice(page)).toBe('low');
  await expect(quality).toHaveValue('low');

  // A reload restores the choice and the toggles from this profile's settings.
  await page.reload();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(async () => (await stats(page)).theme, { timeout: 15_000 }).toBe('dusk');
  await expect.poll(() => choice(page)).toBe('low');
  await expect.poll(() => stats(page)).toMatchObject({ quality: 'low', shadows: false, passes: [] });
  await expect.poll(() => follow(page)).toEqual({ stack: false, activePlayer: true });
  await page.getByTestId('open-theme-settings').click();
  await expect(quality).toHaveValue('low');
  await expect(followStack).not.toBeChecked();
  await expect(followActive).toBeChecked();

  // Up a level in Dusk: shadows stay off, post-processing comes back.
  await quality.selectOption('medium');
  await expect.poll(() => stats(page)).toMatchObject({ theme: 'dusk', quality: 'medium', shadows: false });
  expect((await stats(page)).passes.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
