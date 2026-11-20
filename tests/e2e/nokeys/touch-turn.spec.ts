/**
 * PLAN M7-P5 acceptance: "… and one by touch only (iPad emulation) that asserts no keydown was sent, covering draw, play
 * land, cast, tap/untap, counters, to graveyard, shuffle, attack" (PLAN Milestone 7, Owner decisions: "the same model
 * for mouse and touch"; "a selected card shows a compact action strip next to it … that is also the iPad thumb bar").
 *
 * Fingers only, on an emulated iPad in WebKit: a tap on the library offers its actions, the library's top card dragged
 * into the hand draws, hand cards dragged out of the fan play and cast, double-tap taps, a tapped card's strip (thumb
 * sized) taps, untaps, counts and buries, a creature pushed forward attacks. State through the debug hook only.
 */
import { expect, test } from '@playwright/test';
import { IPAD, doubleTap, fingers, path, type Step } from '../touch/helpers';
import { affordances, cardIn, centreOf, goldfish, handIds, handPoint, keydowns, pileCentre, pointerdowns, secrets, settledTable, shownCard, shuffles, state, tableToScreen, type Pt } from './helpers';

test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');
test.use(IPAD);

/** One finger from a to b in steps, lifting there. */
const slide = (a: Pt, b: Pt, n = 10): Step[] => [{ type: 'down', id: 1, ...a }, ...path(1, a, b, n), { type: 'up', id: 1, ...b }];

/** A hand card dragged out of the fan by one finger: straight up first (a sideways start scrolls the fan), then across. */
async function fanOut(page: import('@playwright/test').Page, id: string, to: Pt): Promise<void> {
  const from = await handPoint(page, id);
  const vp = page.viewportSize()!;
  const up = { x: from.x, y: Math.round(from.y - vp.height * 0.2) };
  await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, up, 8), ...path(1, up, to, 12), { type: 'up', id: 1, ...to }]);
}

test('a goldfish turn by touch only: draw, play a land, cast, tap and untap, counters, to graveyard, shuffle, attack', async ({ page }, info) => {
  const { land, creature, spare } = await goldfish(page, info);
  const handBefore = (await handIds(page)).length;

  await test.step('draw: a tap on the library shows its actions; Draw draws', async () => {
    const lib = await pileCentre(page, 'library');
    await page.touchscreen.tap(lib.x, lib.y);
    await expect(page.getByTestId('pile-actions')).toHaveAttribute('data-zone', 'library:s0');
    expect((await affordances(page)).pile).toMatchObject({ zone: 'library:s0', via: 'tap' });
    // Thumb-sized targets.
    const b = (await page.getByTestId('pile-action-draw').boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('pile-action-draw').tap();
    await expect.poll(async () => (await handIds(page)).length).toBe(handBefore + 1);
  });

  await test.step('draw: the library\'s top card dragged into the hand by a finger', async () => {
    await settledTable(page);
    const lib = await pileCentre(page, 'library');
    const vp = page.viewportSize()!;
    await fingers(page, slide(lib, { x: Math.round(vp.width / 2), y: vp.height - 50 }, 14));
    await expect.poll(async () => (await handIds(page)).length).toBe(handBefore + 2);
  });

  await test.step('play a land: drag it out of the fan onto the table', async () => {
    await settledTable(page);
    await fanOut(page, land, await tableToScreen(page, { x: -400, y: -380 }));
    await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('battlefield:s0');
  });

  await test.step('cast: drag a creature onto the stack; Resolve puts it onto the battlefield', async () => {
    await settledTable(page);
    await fanOut(page, creature, await tableToScreen(page, { x: 0, y: 0 }));
    await expect.poll(async () => (await state(page)).stack.map((i) => i.card)).toEqual([creature]);
    await page.getByTestId('thumb-resolve').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('battlefield:s0');
  });

  await test.step('tap and untap: double-tap the land; the strip\'s Tap and Untap on the creature', async () => {
    await settledTable(page);
    const c = centreOf((await shownCard(page, land)).screen);
    await doubleTap(page, c);
    await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(true);
    await settledTable(page);
    await doubleTap(page, c);
    await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(false);

    await settledTable(page);
    const k = centreOf((await shownCard(page, creature)).screen);
    await page.touchscreen.tap(k.x, k.y);
    const strip = page.getByTestId('selection-strip');
    await expect(strip).toHaveAttribute('data-cards', creature);
    // The strip is the thumb bar for the card: every control a thumb-sized target.
    for (const t of ['strip-tap', 'strip-toGraveyard', 'strip-more', 'strip-counter-add']) {
      const b = (await strip.getByTestId(t).boundingBox())!;
      expect(Math.min(b.width, b.height), t).toBeGreaterThanOrEqual(44);
    }
    await strip.getByTestId('strip-tap').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.tapped).toBe(true);
    await expect(strip.getByTestId('strip-tap')).toHaveText('Untap');
    await strip.getByTestId('strip-tap').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.tapped).toBe(false);
  });

  await test.step('counters: + and − on the strip', async () => {
    const strip = page.getByTestId('selection-strip');
    await strip.getByTestId('strip-counter-add').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(1);
    await strip.getByTestId('strip-counter-add').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(2);
    await strip.getByTestId('strip-counter-remove').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(1);
  });

  await test.step('shuffle: a tap on the library, then Shuffle', async () => {
    const before = await shuffles(page);
    const lib = await pileCentre(page, 'library');
    await page.touchscreen.tap(lib.x, lib.y);
    await page.getByTestId('pile-action-shuffle').tap();
    await expect.poll(() => shuffles(page)).toBe(before + 1);
    expect((await secrets(page)).libraryOrder.length).toBeGreaterThan(0);
  });

  await test.step('attack: a finger pushes the creature toward the opponent; it slides forward and taps', async () => {
    await settledTable(page);
    const before = (await cardIn(page, creature))!;
    const from = centreOf((await shownCard(page, creature)).screen);
    const to = await tableToScreen(page, { x: before.pose.x, y: 160 });
    await fingers(page, slide(from, to, 14));
    await expect.poll(async () => (await cardIn(page, creature))?.combat).toBe('attack');
    const after = (await cardIn(page, creature))!;
    expect(after.tapped).toBe(true);
    expect(after.home).toEqual(before.pose);
    expect(after.pose.y).toBeCloseTo(before.pose.y + 110, 3);
  });

  await test.step('to graveyard: the strip\'s To graveyard, and a hand card dragged onto the graveyard pile', async () => {
    await settledTable(page);
    const k = centreOf((await shownCard(page, creature)).screen);
    await page.touchscreen.tap(k.x, k.y);
    await page.getByTestId('selection-strip').getByTestId('strip-toGraveyard').tap();
    await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('graveyard:s0');
    await settledTable(page);
    await fanOut(page, spare, await pileCentre(page, 'graveyard'));
    await expect.poll(async () => (await cardIn(page, spare))?.zone).toBe('graveyard:s0');
  });

  // No key was pressed, and no mouse: fingers only.
  expect(await keydowns(page)).toBe(0);
  const p = await pointerdowns(page);
  expect(p.touch).toBeGreaterThan(10);
  expect(p.mouse).toBe(0);
});
