import { test, expect } from '@playwright/test';
import type { SecretStore } from '../../src/core/types';
import { hook } from './helpers/app';
import { call, decklist, freshProfile, openSolo } from './solo/helpers';

// B0.7 smoke on the wired app (M0-P7): the solo table renders the HUD and scene, and a card put on the battlefield is
// found through the debug hook. The B0 stage showed one fixed placeholder card; the solo session starts empty.
test('renders a placeholder card on the solo table, found through the debug hook', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(await hook<unknown[]>(page, 'cards')).toEqual([]);

  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'draw');
  const [card] = (await hook<SecretStore>(page, 'secrets')).hand;
  await hook(page, 'dispatch', { type: 'move', card, to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });

  type Shown = { id: string; zone: string; screen: { width: number; height: number }; visible: boolean };
  await expect.poll(async () => (await hook<Shown[]>(page, 'cards')).filter((c) => c.zone === 'battlefield:s0').map((c) => c.id)).toEqual([card]);
  const shown = (await hook<Shown[]>(page, 'cards')).find((c) => c.id === card)!;
  expect(shown.visible).toBe(true);
  // The card keeps the 63 x 88 aspect ratio.
  expect(shown.screen.height / shown.screen.width).toBeCloseTo(88 / 63, 1);
  const cam = await hook<{ rig: string }>(page, 'camera');
  expect(cam.rig).toBe('birdseye');
  expect(errors).toEqual([]);
});
