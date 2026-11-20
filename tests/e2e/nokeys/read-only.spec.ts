/**
 * PLAN Milestone 8, M7-P5 "Read-only" (m7-adjustments.md D14: "look, do not touch"): after `setReadOnly(true)` a drag,
 * a double-click, a pile press and a right-drag from a card change neither the state hash nor the count of proposed
 * actions; the wheel zooms; inspect opens; no coach mark shows. And when it is switched off again, play works as before.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { call } from '../solo/helpers';
import { cardIn, centreOf, goldfish, handIds, handPoint, keydowns, log, mouseDrag, pileCentre, settledTable, shownCard, tableToScreen } from './helpers';

const hash = (page: Page) => call<string>(page, 'hash');
const proposed = (page: Page) => hook<number>(page, 'readOnly.proposed');
const setReadOnly = (page: Page, on: boolean) => page.evaluate((v) => window.__spellplane!.readOnly!.set(v), on);
const camPos = (page: Page) => hook<{ position: number[] }>(page, 'camera').then((c) => c.position);

test('a read-only table takes no action from the mouse, while the wheel, hover and inspect still work', async ({ page }, info) => {
  const { land, creature } = await goldfish(page, info);

  await test.step('setup by mouse: a land on the table, the first coach mark showing', async () => {
    await settledTable(page);
    await mouseDrag(page, await handPoint(page, land), await tableToScreen(page, { x: -400, y: -380 }));
    await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('battlefield:s0');
    await settledTable(page);
    await expect(page.getByTestId('coach-mark')).toHaveCount(1);
  });

  const before = { hash: await hash(page), proposed: await proposed(page), log: (await log(page)).length, hand: (await handIds(page)).length };

  await test.step('switched on: the coach mark goes', async () => {
    await setReadOnly(page, true);
    expect(await hook<boolean>(page, 'readOnly.on')).toBe(true);
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
  });

  await test.step('a drag of a card on the table moves no card', async () => {
    const c = centreOf((await shownCard(page, land)).screen);
    const to = await tableToScreen(page, { x: 200, y: -380 });
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    expect((await hook<{ held: unknown }>(page, 'motion')).held).toBeNull();
    await page.mouse.up();
    await settledTable(page);
    expect((await cardIn(page, land))?.pose).toEqual((await cardIn(page, land))?.pose);
  });

  await test.step('a drag from the hand onto the table plays nothing', async () => {
    await mouseDrag(page, await handPoint(page, creature), await tableToScreen(page, { x: 0, y: -380 }));
    await settledTable(page);
    expect((await cardIn(page, creature))?.zone).toBe('hand:s0');
  });

  await test.step('a double-click taps nothing; a double-click on the library draws nothing', async () => {
    const c = centreOf((await shownCard(page, land)).screen);
    await page.mouse.dblclick(c.x, c.y);
    const lib = await pileCentre(page, 'library');
    await page.mouse.dblclick(lib.x, lib.y);
    await page.waitForTimeout(300);
    expect((await cardIn(page, land))?.tapped).toBe(false);
    expect((await handIds(page)).length).toBe(before.hand);
  });

  await test.step('a pile press or hover offers no pile action; a selected card shows no strip', async () => {
    const lib = await pileCentre(page, 'library');
    await page.mouse.click(lib.x, lib.y);
    await page.mouse.move(lib.x + 2, lib.y + 2);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('pile-actions')).toHaveCount(0);
    expect((await hook<{ pile: unknown }>(page, 'affordances')).pile).toBeNull();
    const c = centreOf((await shownCard(page, land)).screen);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('selection-strip')).toHaveCount(0);
    expect((await hook<{ selection: unknown }>(page, 'affordances')).selection).toBeNull();
  });

  await test.step('a right-drag from a card draws no line', async () => {
    const c = centreOf((await shownCard(page, land)).screen);
    const to = await tableToScreen(page, { x: 0, y: 380 });
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('Escape').catch(() => undefined);
    expect((await hook<unknown[]>(page, 'lines')).length).toBe(0);
  });

  await test.step('nothing was proposed and the table is unchanged', async () => {
    expect(await hash(page)).toBe(before.hash);
    expect(await proposed(page)).toBe(before.proposed);
    expect((await log(page)).length).toBe(before.log);
  });

  await test.step('the wheel still zooms', async () => {
    await settledTable(page);
    const p0 = await camPos(page);
    const at = await tableToScreen(page, { x: 0, y: -200 });
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => Math.hypot(...(await camPos(page)).map((v, i) => v - p0[i]!))).toBeGreaterThan(1);
    expect(await hash(page)).toBe(before.hash);
  });

  await test.step('inspect opens (a right-click or middle-click on a card) and closes', async () => {
    await settledTable(page);
    const c = centreOf((await shownCard(page, land)).screen);
    await page.mouse.click(c.x, c.y, { button: 'middle' });
    await expect(page.getByTestId('inspect')).toBeVisible();
    await page.getByTestId('inspect').click();
    await expect(page.getByTestId('inspect')).toHaveCount(0);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await expect(page.getByTestId('inspect')).toBeVisible();
    await page.getByTestId('inspect').click();
    expect(await hash(page)).toBe(before.hash);
  });

  await test.step('switched off: a double-click taps again', async () => {
    await setReadOnly(page, false);
    await settledTable(page);
    const c = centreOf((await shownCard(page, land)).screen);
    await page.mouse.dblclick(c.x, c.y);
    await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(true);
  });
  // Escape above is the only key, pressed to be sure no menu stayed open; nothing else was typed.
  expect(await keydowns(page)).toBeLessThanOrEqual(1);
});
