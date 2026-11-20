/**
 * PLAN Milestone 8, M7-P5 "Feel" meets the hand fan (found when M7-P5 was integrated into m8: tests/e2e/voice/hold.spec.ts
 * played a card it had just drawn): a card drawn from the library flies into the hand fan, and a player who grabs it from
 * the fan while that flight is still under way plays it onto the table like any other hand card. Before the fix the
 * frame that ended the flight dropped the card being dragged, and the release put nothing on the table.
 *
 * The solo table with Playwright's clock paused, so the grab is certainly made mid-flight and the flight's end certainly
 * comes during the drag; read through the debug hook, never from pixels.
 */
import { expect, test } from '@playwright/test';
import type { CardAnimationKind, MotionDebugState } from '../../../src/scene/types';
import { call, decklist, openSolo } from '../solo/helpers';
import { cardIn, fanCard, handIds, handPoint, profileFor, state, tableToScreen } from '../nokeys/helpers';
import { motion, pauseClock, step } from './helpers';

const running = (m: MotionDebugState, kind: CardAnimationKind) => m.running.filter((r) => r.kind === kind);

test('a card grabbed from the hand fan while its draw flight is still under way is played onto the table', async ({ page }, info) => {
  await page.clock.install();
  await openSolo(page, profileFor(info, 'grab-in-flight'));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await expect.poll(async () => (await state(page)).zones['library:s0']?.ids.length ?? 0).toBe(60);
  await pauseClock(page);
  await step(page, 1500);

  await test.step('draw one card and catch its flight under way', async () => {
    await call(page, 'draw', 1);
    for (let t = 0; t <= 1500 && running(await motion(page), 'draw').length === 0; t += 16) await page.clock.runFor(16);
    expect(running(await motion(page), 'draw').length).toBeGreaterThan(0);
  });
  const [card] = await handIds(page);
  expect(card).toBeTruthy();
  await expect(fanCard(page, card!)).toBeVisible();

  await test.step('grab it from the fan mid-flight, hold it over the table past the flight, release', async () => {
    const from = await handPoint(page, card!);
    const to = await tableToScreen(page, { x: 0, y: -300 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 12, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    // The flight would have ended long before now; the scene keeps drawing frames meanwhile.
    await step(page, 1200);
    expect(running(await motion(page), 'draw')).toEqual([]);
    expect((await motion(page)).held?.card).toBe(card);
    await page.mouse.up();
    await step(page, 64);
  });
  await expect.poll(async () => (await cardIn(page, card!))?.zone).toBe('battlefield:s0');
});
