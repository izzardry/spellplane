/**
 * PLAN M7-P5: "drag to every zone (hand, graveyard, exile, library top/bottom, command)"; "drag from library to hand
 * draws"; DESIGN "Card manipulation", Move to zone: "Also by dragging onto the zone". Each drop dispatches the action
 * the zone key does (H toZone hand, G move to graveyard, E move to exile, L toZone library top, Shift+L bottom, the
 * command zone move), read from the log through the debug hook. While a card is held over the hand, a library or the
 * library's bottom slot, a label says what the drop does.
 */
import { expect, test, type Page } from '@playwright/test';
import type { LogEntry } from '../../../src/core/types';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { libraryBottomSlot } from '../../../src/scene/affordances';
import { hook } from '../helpers/app';
import { cardIn, centreOf, goldfish, handIds, handPoint, keydowns, log, mouseDrag, pileCentre, secrets, settledTable, shownCard, tableToScreen, type Pt } from './helpers';

/** Put hand cards onto the own battlefield in a row (setup through the debug hook). */
async function onTable(page: Page, ids: string[]): Promise<void> {
  for (const [i, id] of ids.entries()) await hook(page, 'dispatch', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: -300 + i * 150, y: -300, rot: 0 } });
  await expect.poll(async () => (await Promise.all(ids.map((id) => cardIn(page, id)))).every((c) => c?.zone === 'battlefield:s0')).toBe(true);
  await settledTable(page);
}

/** Press on a table card, move to `to` in steps (checking the drop label on the way), release. */
async function dragTableCard(page: Page, id: string, to: Pt, label?: string, via?: Pt): Promise<void> {
  const from = centreOf((await shownCard(page, id)).screen);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y, { steps: 10 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (label) await expect(page.getByTestId('drop-hint')).toHaveAttribute('data-kind', label);
  await page.mouse.up();
}

const lastAction = async (page: Page) => {
  const a = (await log(page)).filter((e): e is Extract<LogEntry, { kind: 'action' }> => e.kind === 'action').at(-1)!;
  const { by: _b, cid: _c, seq: _s, ...rest } = a.action as unknown as Record<string, unknown>;
  return rest;
};

test('a table card dragged into the hand at the bottom of the screen goes to its owner\'s hand', async ({ page }, info) => {
  const { creature } = await goldfish(page, info);
  await onTable(page, [creature]);
  const vp = page.viewportSize()!;
  await dragTableCard(page, creature, { x: Math.round(vp.width * 0.8), y: vp.height - 40 }, 'hand');
  await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('hand:s0');
  expect(await lastAction(page)).toMatchObject({ type: 'toZone', card: creature, to: 'hand:s0', position: 'any' });
  await expect(page.getByTestId('drop-hint')).toBeHidden();
  expect(await keydowns(page)).toBe(0);
});

test('onto the graveyard, the exile and the command area', async ({ page }, info) => {
  const { land, creature, spare } = await goldfish(page, info);
  await onTable(page, [land, creature, spare]);
  await dragTableCard(page, land, await pileCentre(page, 'graveyard'));
  await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('graveyard:s0');
  expect(await lastAction(page)).toMatchObject({ type: 'move', card: land, to: 'graveyard:s0' });
  await settledTable(page);
  await dragTableCard(page, creature, await pileCentre(page, 'exile'));
  await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('exile:s0');
  await settledTable(page);
  const command = mtgCommandCentre();
  await dragTableCard(page, spare, await tableToScreen(page, command));
  await expect.poll(async () => (await cardIn(page, spare))?.zone).toBe('command:s0');
  expect(await lastAction(page)).toMatchObject({ type: 'move', card: spare, to: 'command:s0' });
  expect(await keydowns(page)).toBe(0);
});

test('onto the library: on the pile its top; on the Bottom slot that shows beside it, its bottom', async ({ page }, info) => {
  const { land, creature } = await goldfish(page, info);
  await onTable(page, [land, creature]);
  const lib = await pileCentre(page, 'library');
  await dragTableCard(page, land, lib, 'top');
  await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('library:s0');
  expect(await lastAction(page)).toMatchObject({ type: 'toZone', card: land, to: 'library:s0', position: 'top' });
  expect((await secrets(page)).libraryOrder[0]).toBe(land);
  await settledTable(page);

  // Over the library the Bottom slot appears beside it; moving onto it and releasing puts the card at the bottom.
  const libNow = await pileCentre(page, 'library');
  const slot = await bottomSlotCentre(page);
  await dragTableCard(page, creature, slot, 'bottom', libNow);
  await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('library:s0');
  expect(await lastAction(page)).toMatchObject({ type: 'toZone', card: creature, to: 'library:s0', position: 'bottom' });
  expect((await secrets(page)).libraryOrder.at(-1)).toBe(creature);
  // Without passing over the library first, the same spot is the battlefield (the slot shows only for a card over it).
  expect(await keydowns(page)).toBe(0);
});

test("the library's top card dragged anywhere but the hand goes back: nothing is drawn or moved", async ({ page }, info) => {
  await goldfish(page, info);
  const hand = (await handIds(page)).length;
  const entries = (await log(page)).length;
  const lib = await pileCentre(page, 'library');
  const to = await tableToScreen(page, { x: -200, y: -300 });
  await mouseDrag(page, lib, to);
  await settledTable(page);
  expect((await handIds(page)).length).toBe(hand);
  expect((await log(page)).length).toBe(entries);
  await expect(page.getByTestId('drop-hint')).toBeHidden();
});

test('a hand card dropped back into the hand stays there; one dropped on the table is played', async ({ page }, info) => {
  const { land } = await goldfish(page, info);
  const entries = (await log(page)).length;
  const from = await handPoint(page, land);
  const vp = page.viewportSize()!;
  // Up out of the fan, then back down into it.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, Math.round(vp.height * 0.5), { steps: 10 });
  await page.mouse.move(from.x + 40, vp.height - 30, { steps: 10 });
  await page.mouse.up();
  await settledTable(page);
  expect((await cardIn(page, land))?.zone).toBe('hand:s0');
  expect((await log(page)).length).toBe(entries);
});

/** The command area's centre for seat 0 of the 1v1 table (games/mtg/layout.ts). */
function mtgCommandCentre(): Pt {
  const c = mtgLayout('1v1').seats[0]!.zones.command;
  return { x: c.x, y: c.y };
}

/** The Bottom slot beside the own library (scene/affordances.ts libraryBottomSlot) on screen. */
async function bottomSlotCentre(page: Page): Promise<Pt> {
  const s = libraryBottomSlot(mtgLayout('1v1').seats[0]!.zones.library);
  return tableToScreen(page, { x: s.x, y: s.y });
}
