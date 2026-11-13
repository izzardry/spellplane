// The HUD's camera wiring (M4-P1, on the `?harness=ui` page with its fake scene): the stored follow toggles reach the
// scene (DESIGN "Camera and navigation", Follow options: two personal toggles, off by default; Settings.followStack,
// followActive), and the HUD button switches the rig like P (DESIGN "Camera and navigation", Switching: "One key (P)
// or a HUD button").
import { expect, test } from '@playwright/test';
import { openHud, ui } from '../ui/harness';

type Call = { method: string; args: unknown[] };

test('the stored follow toggles are handed to the scene; both are off by default', async ({ page }) => {
  await openHud(page);
  // Off by default: the scene starts with both off, so nothing is handed over.
  await expect(page.getByTestId('hud')).toBeVisible();
  expect((await ui<Call[]>(page, 'scene')).filter((c) => c.method === 'camera.setFollow')).toEqual([]);
  await page.evaluate(() => localStorage.setItem('spellplane-ui-harness-settings', JSON.stringify({ followStack: true, followActive: true })));
  await openHud(page, { keepSettings: true });
  await expect.poll(() => ui<Call[]>(page, 'scene')).toContainEqual({ method: 'camera.setFollow', args: [{ stack: true, activePlayer: true }] });
});

test('a later change of the follow toggles reaches the scene, turning one off too', async ({ page }) => {
  await openHud(page);
  const follows = async () => (await ui<Call[]>(page, 'scene')).filter((c) => c.method === 'camera.setFollow');
  // Changed elsewhere (another tab, a settings panel); the HUD picks it up when the window regains focus.
  await page.evaluate(() => window.__uiHarness!.setSetting('followStack', true));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(follows).toEqual([{ method: 'camera.setFollow', args: [{ stack: true, activePlayer: false }] }]);
  await page.evaluate(() => window.__uiHarness!.setSetting('followStack', false));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(follows).toEqual([
    { method: 'camera.setFollow', args: [{ stack: true, activePlayer: false }] },
    { method: 'camera.setFollow', args: [{ stack: false, activePlayer: false }] },
  ]);
  // Nothing changed: nothing is handed over again (the next change is the only new call; reads resolve in order).
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(() => window.__uiHarness!.setSetting('followActive', true));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(follows).toEqual([
    { method: 'camera.setFollow', args: [{ stack: true, activePlayer: false }] },
    { method: 'camera.setFollow', args: [{ stack: false, activePlayer: false }] },
    { method: 'camera.setFollow', args: [{ stack: false, activePlayer: true }] },
  ]);
});

test('the View button switches the camera rig, as P does', async ({ page }) => {
  await openHud(page);
  await page.getByTestId('perspective').click();
  await expect.poll(() => ui<Call[]>(page, 'scene')).toContainEqual({ method: 'camera.setRig', args: ['ego'] });
  await expect(page.getByTestId('perspective')).toContainText('P');
});
