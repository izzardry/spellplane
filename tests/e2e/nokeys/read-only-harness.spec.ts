/**
 * PLAN Milestone 8, M7-P5 "Read-only", on the real table scene in the scene harness (`?harness=scene`, no HUD, no
 * session): after `setReadOnly(true)` a drag, a double-click (on a card and on the library), a pile press and a
 * right-drag from a card dispatch nothing (the harness records every draft the scene dispatches) and leave the state
 * unchanged; the wheel still zooms and a right-click still inspects. Switched off, a double-click taps again.
 * The #/solo version with the HUD, the coach mark and the strip is read-only.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { actions, addCard, card, harness, openScene, screenOf, settle, state } from '../scene/helpers';

const setReadOnly = (page: Page, on: boolean) => page.evaluate((v) => window.__spellplane!.readOnly!.set(v), on);
const proposed = (page: Page) => hook<number>(page, 'readOnly.proposed');
const snapshot = async (page: Page) => JSON.stringify(await state(page));
const camPos = (page: Page) => hook<{ position: number[] }>(page, 'camera').then((c) => c.position);
const pileShown = (page: Page) => hook<{ pile: unknown }>(page, 'affordances').then((a) => a.pile);

test('the scene harness: read-only proposes nothing from a drag, a double-click, a pile press or a right-drag; the wheel zooms and inspect works', async ({ page }) => {
  await openScene(page, { scenario: 'demo', viewer: 's0' });
  await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
  await settle(page);
  const layout = (await harness(page, 'layout')) as { seats: { zones: { library: { x: number; y: number } } }[] };
  const lib = await screenOf(page, layout.seats[0]!.zones.library.x, layout.seats[0]!.zones.library.y);
  const a = await screenOf(page, 0, -300);

  await setReadOnly(page, true);
  expect(await hook<boolean>(page, 'readOnly.on')).toBe(true);
  const before = { state: await snapshot(page), actions: (await actions(page)).length, proposed: await proposed(page) };

  const fit = async () => {
    await page.evaluate(() => window.__sceneHarness!.camera.fit(false));
    await settle(page);
  };

  await test.step('a drag of a card moves no card (it pans the view instead)', async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + 40, { steps: 12 });
    expect((await card(page, 'a'))!.dragging).toBe(false);
    await page.mouse.up();
    await settle(page);
    expect((await card(page, 'a'))!.pose).toMatchObject({ x: 0, y: -300 });
    await fit();
  });

  await test.step('a double-click on a card taps nothing; on the library it draws nothing', async () => {
    const at = await screenOf(page, 0, -300);
    await page.mouse.dblclick(at.x, at.y);
    await page.mouse.dblclick(lib.x, lib.y);
    await settle(page);
    expect((await card(page, 'a'))!.tapped).toBe(false);
  });

  await test.step('a press on the library offers no pile action', async () => {
    await page.mouse.click(lib.x, lib.y);
    await page.mouse.move(lib.x + 2, lib.y + 2);
    expect(await pileShown(page)).toBeNull();
  });

  await test.step('a right-drag from a card draws no line', async () => {
    const at = await screenOf(page, 0, -300);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(at.x + 150, at.y - 80, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await settle(page);
  });

  await test.step('nothing was dispatched or proposed, and the state is unchanged', async () => {
    expect((await actions(page)).length).toBe(before.actions);
    expect(await proposed(page)).toBe(before.proposed);
    expect(await snapshot(page)).toBe(before.state);
  });

  await test.step('a right-click on a card inspects it', async () => {
    await settle(page);
    const at = await screenOf(page, 0, -300);
    const n = ((await harness(page, 'events')) as { type: string }[]).filter((e) => e.type === 'inspect').length;
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect.poll(async () => ((await harness(page, 'events')) as { type: string; args: unknown[] }[]).filter((e) => e.type === 'inspect').slice(n).map((e) => e.args[0])).toContain('a');
    expect((await actions(page)).length).toBe(before.actions);
  });

  await test.step('the wheel still zooms', async () => {
    const p0 = await camPos(page);
    const at = await screenOf(page, 0, -300);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await camPos(page)).join()).not.toBe(p0.join());
  });

  await test.step('switched off, a double-click taps again', async () => {
    await setReadOnly(page, false);
    await fit();
    const at = await screenOf(page, 0, -300);
    await page.mouse.dblclick(at.x, at.y);
    await expect.poll(async () => (await card(page, 'a'))!.tapped).toBe(true);
    expect(await proposed(page)).toBeGreaterThan(before.proposed);
  });
});
