/**
 * PLAN M7-P5 acceptance: "an e2e goldfish turn by mouse only … that asserts no keydown was sent, covering draw, play
 * land, cast, tap/untap, counters, to graveyard, shuffle, attack" (PLAN Milestone 7, Owner decisions after the first
 * design round, Play without memorising keys: "Every everyday action is reachable by direct manipulation with visible
 * affordances: drag, drop, double-click or tap, on-card and on-pile actions … Keys stay as optional accelerators").
 *
 * Each step goes through the visible affordance a newcomer would use: the pile's own buttons (a click on the library
 * offers Draw and Shuffle), dragging the library's top card into the hand, dragging a hand card onto the table (play)
 * or onto the stack (cast), the stack's Resolve button, double-click to tap, the selection strip (Tap, counters +/−, To
 * graveyard), dragging onto the graveyard pile, and pushing a creature toward the opponent (attack). Every step checks
 * the state through the debug hook, and the dispatched actions are the ones the keys dispatch.
 */
import { expect, test } from '@playwright/test';
import { hook } from '../helpers/app';
import { affordances, cardIn, centreOf, goldfish, handIds, handPoint, keydowns, log, mouseDrag, pileCentre, pointerdowns, secrets, settledTable, shownCard, shuffles, state, tableToScreen } from './helpers';

test('a goldfish turn by mouse only: draw, play a land, cast, tap and untap, counters, to graveyard, shuffle, attack', async ({ page }, info) => {
  const { land, creature, spare } = await goldfish(page, info);
  const handBefore = (await handIds(page)).length;

  await test.step('draw: a click on the library shows its actions on the pile; Draw draws', async () => {
    const lib = await pileCentre(page, 'library');
    await page.mouse.click(lib.x, lib.y);
    await expect(page.getByTestId('pile-actions')).toHaveAttribute('data-zone', 'library:s0');
    // On a slow runner the pointer's rest on the pile (hover) may show the actions before the click lands: poll until
    // the click holds them.
    await expect.poll(async () => (await affordances(page)).pile).toMatchObject({ zone: 'library:s0', via: 'tap', owner: 's0' });
    await page.getByTestId('pile-action-draw').click();
    await expect.poll(async () => (await handIds(page)).length).toBe(handBefore + 1);
  });

  await test.step('draw: the library\'s top card dragged into the hand is drawn', async () => {
    await settledTable(page);
    const lib = await pileCentre(page, 'library');
    const vp = page.viewportSize()!;
    await page.mouse.move(lib.x, lib.y);
    await page.mouse.down();
    await page.mouse.move(lib.x - 40, lib.y + 20, { steps: 4 });
    await page.mouse.move(Math.round(vp.width / 2), vp.height - 60, { steps: 12 });
    await expect(page.getByTestId('drop-hint')).toHaveAttribute('data-kind', 'draw');
    await page.mouse.up();
    await expect.poll(async () => (await handIds(page)).length).toBe(handBefore + 2);
    await expect(page.getByTestId('drop-hint')).toBeHidden();
  });

  await test.step('play a land: drag it from the hand onto the table', async () => {
    await settledTable(page);
    const to = await tableToScreen(page, { x: -400, y: -380 });
    await mouseDrag(page, await handPoint(page, land), to);
    await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('battlefield:s0');
    expect((await cardIn(page, land))!.face).toBe('up');
  });

  await test.step('cast: drag a creature onto the stack, then Resolve puts it onto the battlefield', async () => {
    await settledTable(page);
    const lane = await tableToScreen(page, { x: 0, y: 0 });
    await mouseDrag(page, await handPoint(page, creature), lane);
    await expect.poll(async () => (await state(page)).stack.map((i) => i.card)).toEqual([creature]);
    await page.getByTestId('resolve').click();
    await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('battlefield:s0');
  });

  await test.step('tap and untap: double-click the land, then the selection strip\'s Tap and Untap on the creature', async () => {
    await settledTable(page);
    const c = centreOf((await shownCard(page, land)).screen);
    await page.mouse.dblclick(c.x, c.y);
    await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(true);
    await settledTable(page);
    await page.mouse.dblclick(c.x, c.y);
    await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(false);

    await settledTable(page);
    const k = centreOf((await shownCard(page, creature)).screen);
    await page.mouse.click(k.x, k.y);
    const strip = page.getByTestId('selection-strip');
    await expect(strip).toHaveAttribute('data-cards', creature);
    await strip.getByTestId('strip-tap').click();
    await expect.poll(async () => (await cardIn(page, creature))?.tapped).toBe(true);
    await expect(strip.getByTestId('strip-tap')).toHaveText('Untap');
    await strip.getByTestId('strip-tap').click();
    await expect.poll(async () => (await cardIn(page, creature))?.tapped).toBe(false);
  });

  await test.step('counters: the strip\'s + and − change the counter chip on the selected creature', async () => {
    const strip = page.getByTestId('selection-strip');
    await strip.getByTestId('strip-counter-add').click();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(1);
    await strip.getByTestId('strip-counter-add').click();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(2);
    await expect(strip.getByTestId('strip-counter-chip')).toHaveAttribute('data-count', '2');
    await strip.getByTestId('strip-counter-remove').click();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(1);
    await expect(strip.getByTestId('strip-counter-chip')).toHaveAttribute('data-count', '1');
  });

  await test.step('shuffle: the library\'s Shuffle', async () => {
    const before = await shuffles(page);
    const order = (await secrets(page)).libraryOrder.join();
    const lib = await pileCentre(page, 'library');
    await page.mouse.click(lib.x, lib.y);
    await page.getByTestId('pile-action-shuffle').click();
    await expect.poll(() => shuffles(page)).toBe(before + 1);
    expect((await secrets(page)).libraryOrder.join()).not.toBe(order);
  });

  await test.step('attack: push the creature toward the opponent; it slides forward and taps, as the Attack shortcut does', async () => {
    // A click on empty table clears the selection (the strip goes).
    const empty = await tableToScreen(page, { x: 450, y: -250 });
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId('selection-strip')).toHaveCount(0);
    await settledTable(page);
    const before = (await cardIn(page, creature))!;
    const from = centreOf((await shownCard(page, creature)).screen);
    const to = await tableToScreen(page, { x: before.pose.x, y: 160 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await expect(page.getByTestId('drop-hint')).toHaveAttribute('data-kind', 'attack');
    await page.mouse.up();
    await expect.poll(async () => (await cardIn(page, creature))?.combat).toBe('attack');
    const after = (await cardIn(page, creature))!;
    expect(after.tapped).toBe(true);
    expect(after.home).toEqual(before.pose);
    expect(after.pose.x).toBeCloseTo(before.pose.x, 3);
    expect(after.pose.y).toBeCloseTo(before.pose.y + 110, 3);
    const last = (await log(page)).filter((e) => e.kind === 'action').at(-1)!;
    expect(last.kind === 'action' && last.action).toMatchObject({ type: 'moveTemp', card: creature, combat: 'attack', tap: true });
  });

  await test.step('to graveyard: the strip\'s To graveyard, and a hand card dragged onto the graveyard pile', async () => {
    await settledTable(page);
    const k = centreOf((await shownCard(page, creature)).screen);
    await page.mouse.click(k.x, k.y);
    await page.getByTestId('selection-strip').getByTestId('strip-toGraveyard').click();
    await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('graveyard:s0');

    await settledTable(page);
    const gy = await pileCentre(page, 'graveyard');
    await mouseDrag(page, await handPoint(page, spare), gy);
    await expect.poll(async () => (await cardIn(page, spare))?.zone).toBe('graveyard:s0');
  });

  // No key was pressed: every step above went through the mouse.
  expect(await keydowns(page)).toBe(0);
  const p = await pointerdowns(page);
  expect(p.mouse).toBeGreaterThan(10);
  expect(p.touch).toBe(0);
  expect(await hook(page, 'state')).toBeTruthy();
});
