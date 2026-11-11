import { test, expect } from '@playwright/test';
import { hook, openApp } from './helpers/app';

test('renders one placeholder card on the table, found through the debug hook', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  const cards = await hook<{ id: string; screen: { x: number; y: number; width: number; height: number }; visible: boolean }[]>(page, 'cards');
  expect(cards).toHaveLength(1);
  const card = cards[0]!;
  expect(card.visible).toBe(true);
  // The card sits at the table centre and has the 63 x 88 aspect ratio.
  const vp = page.viewportSize()!;
  expect(Math.abs(card.screen.x + card.screen.width / 2 - vp.width / 2)).toBeLessThan(2);
  expect(Math.abs(card.screen.y + card.screen.height / 2 - vp.height / 2)).toBeLessThan(2);
  expect(card.screen.height / card.screen.width).toBeCloseTo(88 / 63, 1);
  const cam = await hook<{ rig: string; fov: number }>(page, 'camera');
  expect(cam).toMatchObject({ rig: 'birdseye', fov: 6 });
  expect(errors).toEqual([]);
});
