/**
 * PLAN Milestone 6 acceptance, attach and clips by touch, under Playwright's iPad emulation (WebKit, touch): a finger
 * drag tucks a card behind another and carries a clipped group; a clip dragged out of the HUD's clip tray clips an
 * overlap; the radial menu's full menu offers "Clip here" where the long-press covers two or more cards; a double-tap
 * on a clip takes it off, a long-press on it opens its menu (owner decisions, Paperclips: Creating a clip, Touch;
 * Removing a clip). Asserted on state and the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import { IPAD, doubleTap, drag, fingers, holdDown, path } from '../touch/helpers';
import { freshProfile, openSolo } from '../solo/helpers';
import { SIDS, centre, clipCentre, clips, creature, idle, pxPerMm, state } from './helpers';

test.use(IPAD);
test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');

const clipCount = async (page: Page) => Object.keys((await state(page)).clips ?? {}).length;
const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

async function table(page: Page): Promise<void> {
  await creature(page, 'a', { x: 0, y: -200, rot: 0 }, SIDS[0]);
  await creature(page, 'b', { x: 30, y: -180, rot: 0 }, SIDS[1]);
  await creature(page, 'c', { x: 250, y: -200, rot: 0 }, SIDS[2]);
  await idle(page);
}

async function overlap(page: Page) {
  const a = await centre(page, 'a');
  const b = await centre(page, 'b');
  return round({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

test.beforeEach(async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
  await table(page);
});

test('a finger drags a clip out of the tray onto an overlap; a double-tap on the clip takes it off', async ({ page }) => {
  // M7-P2: the clip tray is an item of the Menu, dragged out of it.
  await page.getByTestId('open-menu').tap();
  const box = (await page.getByTestId('clip-tray').boundingBox())!;
  const from = round({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const to = await overlap(page);
  await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, to, 10), { type: 'up', id: 1, ...to }]);
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'b']);
  await doubleTap(page, round(await clipCentre(page)));
  await expect.poll(() => clipCount(page)).toBe(0);
});

test('the radial menu’s full menu offers Clip here on an overlap; a long-press on the clip opens its menu', async ({ page }) => {
  const p = await overlap(page);
  await holdDown(page, p);
  await fingers(page, [{ type: 'up', id: 1, ...p }]);
  await page.getByTestId('radial-more').tap();
  const entry = page.getByTestId('context-menu').locator('[data-action="clipHere"]');
  await expect(entry).toHaveText('Clip here');
  await entry.tap();
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'b']);
  // A long-press on a card where nothing overlaps offers no Clip here.
  const c = round(await centre(page, 'c'));
  await holdDown(page, c);
  await fingers(page, [{ type: 'up', id: 1, ...c }]);
  await page.getByTestId('radial-more').tap();
  await expect(page.getByTestId('context-menu').locator('[data-action="clipHere"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The clip's own menu by long-press.
  const at = round(await clipCentre(page));
  await holdDown(page, at);
  await fingers(page, [{ type: 'up', id: 1, ...at }]);
  await page.getByTestId('context-menu').locator('[data-action="removeClip"]').tap();
  await expect.poll(() => clipCount(page)).toBe(0);
});

test('a finger drag of a clipped card moves the group; a finger drag tucks a card behind another', async ({ page }) => {
  await page.evaluate(() => (window.__spellplane as unknown as { dispatch(a: unknown): void }).dispatch({ type: 'clipAdd', by: 's0', cid: 'k-touch', clip: 'k1', cards: ['a', 'b'], anchor: { card: 'b', x: -15, y: -10 } }));
  await expect.poll(() => clipCount(page)).toBe(1);
  await idle(page);
  const k = await pxPerMm(page, 'a');
  const a = await centre(page, 'a');
  const grab = round({ x: a.x - 20 * k, y: a.y });
  await drag(page, grab, round({ x: grab.x - 150 * k, y: grab.y }));
  await expect.poll(async () => (await state(page)).cards.a!.pose.x).toBeLessThan(-100);
  let st = await state(page);
  expect(st.cards.b!.pose.x - st.cards.a!.pose.x).toBeCloseTo(30, 1);
  expect(st.cards.b!.pose.y - st.cards.a!.pose.y).toBeCloseTo(20, 1);
  expect((await clips(page)).clips[0]?.cards).toEqual(['a', 'b']);

  // c tucks behind a: its bottom edge 12 mm under a's top edge.
  await idle(page);
  const host = await centre(page, 'a');
  await drag(page, round(await centre(page, 'c')), round({ x: host.x - 25 * k, y: host.y - 76 * k }), 12);
  await expect.poll(async () => (await state(page)).cards.c?.attachedTo ?? null).toBe('a');
  st = await state(page);
  // The clipped group grew a passenger: dragging b now carries a, and a carries c.
  expect(st.cards.c!.pose.x - st.cards.a!.pose.x).toBeCloseTo(10, 1);
});
