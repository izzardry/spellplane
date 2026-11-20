/**
 * PLAN M7-P2 acceptance (m7-adjustments P2-4: "sandbox, choose a deck, play a turn, no key"): "e2e that a newcomer path works without keys" (PLAN
 * Milestone 7, Principles: "Obvious first use. A newcomer can start a solo game, play a land, draw, tap and attack
 * without reading anything"; Owner decisions: "Play without memorising keys … Keys stay as optional accelerators and
 * leave the primary UI"). Mouse only on desktop, touch only on an iPad; the debug hook asserts no key was pressed.
 * Typing the decklist and a count goes through `fill`, which inserts text without key events (a paste).
 */
import { expect, test, type Page } from '@playwright/test';
import type { InstanceId, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { menuItem } from '../helpers/hud';
import { decklist, openSolo } from '../solo/helpers';
import { IPAD_LANDSCAPE } from './helpers';
import { card, centre, drag, longPress } from '../touch/helpers';

const state = (page: Page) => hook<TableState>(page, 'state');
type Press = 'click' | 'tap';

async function newcomerTurn(page: Page, how: Press, profile: string): Promise<void> {
  // The sandbox table (#/solo; Home is M8-P2's): a table without a deck says so and offers "Choose a deck".
  await test.step('open the sandbox and choose a deck from the no-deck line', async () => {
    await openSolo(page, profile);
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.__spellplane!.input!.reset());
    await expect(page.getByTestId('no-deck')).toContainText('No deck on this table.');
    await page.getByTestId('empty-import-deck')[how]();
    await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
    await page.getByTestId('deck-check')[how]();
    await expect(page.getByTestId('deck-import-go')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('deck-import-go')[how]();
    await expect(page.getByTestId('deck-import')).toHaveCount(0);
    await expect.poll(async () => (await state(page)).zones['library:s0']!.ids.length).toBe(60);
    await expect(page.getByTestId('no-deck')).toHaveCount(0);
  });

  // Shuffle and draw an opening hand from the Menu.
  await menuItem(page, 'menu-shuffle', how);
  await menuItem(page, 'menu-draw-n', how);
  await page.getByTestId('draw-n-input').fill('7');
  await page.getByTestId('draw-n-go')[how]();
  await expect(page.getByTestId('hand-card')).toHaveCount(7);
  // KEEP over the opening hand.
  await page.getByTestId('opening-keep')[how]();
  await expect(page.getByTestId('opening-hand')).toHaveCount(0);

  // The turn: to main with the primary button.
  const primary = page.getByTestId('primary-action');
  await expect(page.getByTestId('whose-turn')).toHaveText('Your turn');
  if ((await state(page)).turn.phase !== 'main1') {
    await primary[how]();
    await expect.poll(async () => (await state(page)).turn.phase).toBe('main1');
  }

  // Play a card: drag it from the hand onto the table, with the mouse or a finger.
  const first = (await page.getByTestId('hand-card').first().getAttribute('data-card')) as InstanceId;
  const el = page.locator(`[data-testid="hand-card"][data-card="${first}"]`);
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  const grab = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height - 12) };
  if (how === 'click') {
    await page.mouse.move(grab.x, grab.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(grab.x, vp.height * 0.7, { steps: 6 });
    await page.mouse.move(vp.width * 0.4, vp.height * 0.6, { steps: 12 });
    await page.mouse.up();
  } else {
    await drag(page, grab, { x: Math.round(vp.width * 0.4), y: Math.round(vp.height * 0.6) }, 16);
  }
  await expect.poll(async () => (await state(page)).cards[first]?.zone).toBe('battlefield:s0');

  // Tap it without a key: its context menu (right-click) or, by touch, its radial menu (long-press).
  await expect.poll(async () => (await card(page, first)).moving).toBe(false);
  const at = centre(await card(page, first));
  if (how === 'click') {
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /^Tap/ }).first().click();
  } else {
    await longPress(page, at);
    await page.getByTestId('radial-tap').tap();
  }
  await expect.poll(async () => (await state(page)).cards[first]?.tapped).toBe(true);

  // Through the turn with the primary button, life by the plate, and the turn passes.
  await primary[how]();
  await expect.poll(async () => (await state(page)).turn.phase).toBe('combat');
  await primary[how]();
  await expect.poll(async () => (await state(page)).turn.phase).toBe('main2');
  await page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('life-minus')[how]();
  await expect.poll(async () => (await state(page)).seats['s0']!.life).toBe(19);
  const turn = (await state(page)).turn.number;
  await primary[how]();
  // The sandbox's empty chair is passed over: the next turn is the player's again, with no key and no hook.
  await expect.poll(async () => (await state(page)).turn.number).toBe(turn + 1);
  await expect.poll(async () => (await state(page)).turn.active).toBe('s0');
  // The next turn begins with untap and draw on one press.
  await expect(primary).toHaveText('Untap & draw ▸');
  const hand = (await state(page)).zones['hand:s0']!.ids.length;
  await primary[how]();
  await expect.poll(async () => (await state(page)).zones['hand:s0']!.ids.length).toBe(hand + 1);
  await expect.poll(async () => (await state(page)).cards[first]?.tapped).toBe(false);

  // Nothing needed a key.
  expect(await hook<number>(page, 'input.keydowns')).toBe(0);
}

test('a newcomer plays alone, imports a deck and plays a turn by mouse, without a key', async ({ page }, info) => {
  test.setTimeout(120_000);
  await newcomerTurn(page, 'click', `newcomer-${info.project.name.slice(0, 3)}-${info.workerIndex}-${Math.random().toString(36).slice(2, 8)}`);
});

test.describe('on an iPad', () => {
  test.use({ ...IPAD_LANDSCAPE });
  test('a newcomer plays a turn by touch, without a key', async ({ page }, info) => {
    test.setTimeout(120_000);
    await newcomerTurn(page, 'tap', `newcomer-t-${info.project.name.slice(0, 3)}-${info.workerIndex}-${Math.random().toString(36).slice(2, 8)}`);
  });
});
