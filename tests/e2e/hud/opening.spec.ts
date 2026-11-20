/**
 * PLAN Milestone 8, M7-P2 acceptance (chunk P2-2; journey 4.10): KEEP and MULLIGAN over the opening hand. They show
 * with a fresh hand, MULLIGAN runs the mulligan, and KEEP or a card leaving the hand removes them.
 */
import { expect, test } from '@playwright/test';
import type { LogEntry, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { call } from '../solo/helpers';
import { settled } from '../helpers/hud';
import { IPAD_LANDSCAPE, IPAD_PORTRAIT, soloWithDeck, state } from './helpers';

test('no chips before a hand is drawn; both show with a fresh hand and neither is filled', async ({ page }, info) => {
  await soloWithDeck(page, info);
  await expect(page.getByTestId('opening-hand')).toHaveCount(0);
  await call(page, 'draw', 7);
  await expect(page.getByTestId('opening-keep')).toBeVisible();
  await expect(page.getByTestId('opening-mulligan')).toBeVisible();
  await expect(page.getByTestId('opening-keep')).not.toHaveClass(/ds-btn--primary/);
  await expect(page.getByTestId('opening-mulligan')).not.toHaveClass(/ds-btn--primary/);
});

test('MULLIGAN runs the mulligan and the chips stay for the new hand; KEEP removes them', async ({ page }, info) => {
  await soloWithDeck(page, info, { hand: 7 });
  await test.step('mulligan', async () => {
    await page.getByTestId('opening-mulligan').click();
    await expect
      .poll(async () => (await call<LogEntry[]>(page, 'log')).some((e) => e.kind === 'action' && e.action.type === 'mulligan'))
      .toBe(true);
    await expect(page.getByTestId('opening-keep')).toBeVisible();
  });
  await test.step('keep', async () => {
    await page.getByTestId('opening-keep').click();
    await expect(page.getByTestId('opening-hand')).toHaveCount(0);
  });
});

test('playing a card out of the hand removes the chips', async ({ page }, info) => {
  await soloWithDeck(page, info, { hand: 7 });
  await expect(page.getByTestId('opening-hand')).toBeVisible();
  const st: TableState = await state(page);
  const card = st.zones['hand:s0']!.ids[0]!;
  await hook(page, 'dispatch', { type: 'move', card, to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
  await expect(page.getByTestId('opening-hand')).toHaveCount(0);
});

/** Whether two boxes overlap (by more than half a pixel). */
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width && a.y + 0.5 < b.y + b.height && b.y + 0.5 < a.y + a.height;

for (const [name, device] of [
  ['desktop', null],
  ['1024 x 768', { viewport: { width: 1024, height: 768 } }],
  ['iPad portrait', IPAD_PORTRAIT],
  ['iPad landscape', IPAD_LANDSCAPE],
] as const) {
  test.describe(name, () => {
    if (device) test.use({ ...device });
    test('the chips sit clear of the own plate and the primary button', async ({ page }, info) => {
      await soloWithDeck(page, info, { hand: 7 });
      await settled(page);
      const chips = [await page.getByTestId('opening-keep').boundingBox(), await page.getByTestId('opening-mulligan').boundingBox()];
      const plate = await page.locator('[data-testid="avatar"][data-seat="s0"]').boundingBox();
      const primary = await page.getByTestId('primary-action').boundingBox();
      for (const chip of chips) {
        expect(chip).not.toBeNull();
        expect(overlap(chip!, plate!), 'chip over the plate').toBe(false);
        expect(overlap(chip!, primary!), 'chip over the primary button').toBe(false);
      }
    });
  });
}
