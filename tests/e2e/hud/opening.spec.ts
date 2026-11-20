/**
 * PLAN Milestone 8, M7-P2 acceptance (chunk P2-2; journey 4.10): KEEP and MULLIGAN over the opening hand. They show
 * with a fresh hand, MULLIGAN runs the mulligan, and KEEP or a card leaving the hand removes them.
 */
import { expect, test } from '@playwright/test';
import type { LogEntry, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { call } from '../solo/helpers';
import { soloWithDeck, state } from './helpers';

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
