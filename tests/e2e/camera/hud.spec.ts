// The HUD's camera wiring (M4-P1, on the `?harness=ui` page with its fake scene): the stored follow toggles reach the
// scene (DESIGN "Camera and navigation", Follow options: two personal toggles, off by default; Settings.followStack,
// followActive), and the HUD button switches the rig like P (DESIGN "Camera and navigation", Switching: "One key (P)
// or a HUD button").
import { expect, test } from '@playwright/test';
import { openHud, ui } from '../ui/harness';

type Call = { method: string; args: unknown[] };

test('the stored follow toggles are handed to the scene; both off by default', async ({ page }) => {
  await openHud(page);
  await expect.poll(() => ui<Call[]>(page, 'scene')).toContainEqual({ method: 'camera.setFollow', args: [{ stack: false, activePlayer: false }] });
  await page.evaluate(() => localStorage.setItem('spellplane-ui-harness-settings', JSON.stringify({ followStack: true, followActive: true })));
  await openHud(page, { keepSettings: true });
  await expect.poll(() => ui<Call[]>(page, 'scene')).toContainEqual({ method: 'camera.setFollow', args: [{ stack: true, activePlayer: true }] });
});

test('the View button switches the camera rig, as P does', async ({ page }) => {
  await openHud(page);
  await page.getByTestId('perspective').click();
  await expect.poll(() => ui<Call[]>(page, 'scene')).toContainEqual({ method: 'camera.setRig', args: ['ego'] });
  await expect(page.getByTestId('perspective')).toContainText('P');
});
