/**
 * PLAN M7-P5: "a selected card shows a compact action strip next to it (Tap, Flip, Counter +/−, To graveyard, More…)";
 * scene/types.ts SceneEvents.selectionAnchor: "reported when the selection changes and when the camera or a drag
 * settles; null while … the camera or the selected cards move (the strip hides, then returns)";
 * docs/design/m7-hud-proposal.md, Card action strip: "in Combat, Attack · Tap · ⋯"; "⋯ opens the full context menu".
 * Keys stay accelerators: no strip control shows a key.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { affordances, cardIn, centreOf, goldfish, keydowns, log, settledTable, shownCard, state, tableToScreen } from './helpers';

async function onTable(page: Page, ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) await hook(page, 'dispatch', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: -300 + i * 160, y: -300, rot: 0 } });
  await expect.poll(async () => (await state(page)).zones['battlefield:s0']!.ids.length).toBe(ids.length);
  await settledTable(page);
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('a click selects a card and its strip stands above it, off the card, with no key on any control', async ({ page }, info) => {
  const { creature } = await goldfish(page, info);
  await onTable(page, [creature]);
  const card = (await shownCard(page, creature)).screen;
  await page.mouse.click(centreOf(card).x, centreOf(card).y);
  const strip = page.getByTestId('selection-strip');
  await expect(strip).toHaveAttribute('data-cards', creature);
  await expect(strip).toHaveAttribute('data-zone', 'battlefield:s0');
  await expect(strip.getByRole('button')).toHaveText(['Tap', 'Flip', '−', '+', 'To graveyard', 'More…']);
  await expect(strip.locator('kbd')).toHaveCount(0);
  const a = (await affordances(page)).selection!;
  expect(a.cards).toEqual([creature]);
  expect(Math.abs(a.rect.x - card.x)).toBeLessThan(2);
  const b = (await strip.boundingBox())!;
  expect(overlap(b, card)).toBe(false);
  expect(b.y + b.height).toBeLessThanOrEqual(card.y + 1);
  // A click on empty table clears the selection and the strip.
  const empty = await tableToScreen(page, { x: 300, y: -250 });
  await page.mouse.click(empty.x, empty.y);
  await expect(strip).toHaveCount(0);
  expect((await affordances(page)).selection).toBeNull();
  expect(await keydowns(page)).toBe(0);
});

test('the strip hides while the camera moves and comes back beside the card when it rests', async ({ page }, info) => {
  const { creature } = await goldfish(page, info);
  await onTable(page, [creature]);
  const c = centreOf((await shownCard(page, creature)).screen);
  await page.mouse.click(c.x, c.y);
  const strip = page.getByTestId('selection-strip');
  await expect(strip).toBeVisible();
  const before = (await affordances(page)).selection!.rect;
  // Pan the table by dragging empty table.
  const from = await tableToScreen(page, { x: 400, y: -200 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 120, from.y - 60, { steps: 8 });
  await expect.poll(async () => (await affordances(page)).selection).toBeNull();
  await expect(strip).toHaveCount(0);
  await page.mouse.up();
  await settledTable(page);
  await expect(strip).toBeVisible();
  const after = (await affordances(page)).selection!.rect;
  const now = (await shownCard(page, creature)).screen;
  expect(Math.abs(after.x - now.x)).toBeLessThan(2);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(30);
});

test('a selection of two: Tap taps both as one step; More… opens the card\'s full menu', async ({ page }, info) => {
  const { creature, land } = await goldfish(page, info);
  await onTable(page, [creature, land]);
  const a = centreOf((await shownCard(page, creature)).screen);
  const b = centreOf((await shownCard(page, land)).screen);
  await page.mouse.click(a.x, a.y);
  const strip = page.getByTestId('selection-strip');
  await expect(strip).toHaveAttribute('data-cards', creature);
  // Shift+click adds to the selection (DESIGN "Card manipulation", Multi-select).
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await strip.getAttribute('data-cards'))?.split(' ').sort()).toEqual([creature, land].sort());
  await strip.getByTestId('strip-tap').click();
  await expect.poll(async () => [(await cardIn(page, creature))?.tapped, (await cardIn(page, land))?.tapped]).toEqual([true, true]);
  const taps = (await log(page)).filter((e) => e.kind === 'action' && e.action.type === 'tap').slice(-2);
  const groups = taps.map((e) => (e.kind === 'action' ? e.action.group : undefined));
  expect(groups[0]).toBeTruthy();
  expect(groups[1]).toBe(groups[0]);
  await strip.getByTestId('strip-more').click();
  await expect(page.getByTestId('context-menu')).toBeVisible();
});

test('in the own combat step the strip leads with Attack, which attacks as the Attack shortcut does', async ({ page }, info) => {
  const { creature } = await goldfish(page, info);
  await onTable(page, [creature]);
  // The combat step, from the turn strip by a click.
  await page.locator('[data-testid="turn-strip"] [data-phase="combat"]').click();
  await expect.poll(async () => (await state(page)).turn.phase).toBe('combat');
  await settledTable(page);
  const c = centreOf((await shownCard(page, creature)).screen);
  await page.mouse.click(c.x, c.y);
  const strip = page.getByTestId('selection-strip');
  await expect(strip.getByRole('button').first()).toHaveText('Attack');
  const before = (await cardIn(page, creature))!.pose;
  await strip.getByTestId('strip-attack').click();
  await expect.poll(async () => (await cardIn(page, creature))?.combat).toBe('attack');
  expect((await cardIn(page, creature))!.tapped).toBe(true);
  expect((await cardIn(page, creature))!.pose.y).toBeCloseTo(before.y + 110, 3);
  // An attacker offers no second Attack.
  await settledTable(page);
  await expect(strip.getByTestId('strip-attack')).toHaveCount(0);
  expect(await keydowns(page)).toBe(0);
});
