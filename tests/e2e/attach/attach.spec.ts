/**
 * PLAN Milestone 6 acceptance, Attach and carry, with the mouse (Chromium and WebKit): drop a card on another's upper
 * third and it tucks and attaches, with the ghost outline and attach glyph showing first; dragging the host carries it;
 * dragging it out detaches it (logged). Dragging a middle cascade card carries the cards below it. An attacking
 * creature takes its attachments, and Settle brings them back (DESIGN "Card manipulation", Attach; "Specification:
 * geometry, layout and motion", Drop resolution 3a). Asserted on state, the log and the debug hook.
 */
import { expect, test } from '@playwright/test';
import { shot } from '../helpers/app';
import { freshProfile, openSolo } from '../solo/helpers';
import { SIDS, actions, centre, clips, creature, dispatch, hover, idle, mouseDrag, pxPerMm, state } from './helpers';

test.beforeEach(async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
});

test('a card dropped on the upper third of another tucks behind it and attaches; the host carries it; dragged out alone it detaches', async ({ page }, info) => {
  await creature(page, 'host', { x: 0, y: -220, rot: 0 }, SIDS[0]);
  await creature(page, 'aura', { x: 250, y: -220, rot: 0 }, SIDS[1]);
  const k = await pxPerMm(page, 'host');
  const h = await centre(page, 'host');
  const a = await centre(page, 'aura');
  // The aura's bottom edge 12 mm under the host's top edge: its centre 88 - 12 = 76 mm above the host's.
  const to = { x: h.x + 4 * k, y: h.y - 76 * k };
  await mouseDrag(page, a, to, { hold: true });
  // Before releasing, the preview shows the landing spot with the attach glyph.
  await expect.poll(async () => (await clips(page)).preview).toMatchObject({ kind: 'tuck', target: 'host', pose: { x: 10, y: -210, rot: 0 } });
  await expect(page.locator('[data-scene="attach-glyph"]')).toBeVisible();
  expect((await clips(page)).drag).toMatchObject({ anchor: 'aura', cards: ['aura'] });
  await shot(page, 'M6', 'attach-preview', info.project.name);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).cards.aura?.attachedTo).toBe('host');
  let st = await state(page);
  expect(st.cards.aura!.pose).toEqual({ x: 10, y: -210, rot: 0 });
  // Tucked behind: drawn before the host.
  const ids = st.zones['battlefield:s0']!.ids;
  expect(ids.indexOf('aura')).toBeLessThan(ids.indexOf('host'));
  await expect(page.locator('[data-scene="attach-glyph"]')).toBeHidden();
  expect((await clips(page)).preview).toBeNull();

  // Dragging the host carries the aura.
  const h2 = await centre(page, 'host');
  await mouseDrag(page, h2, { x: h2.x - 120 * k, y: h2.y + 30 * k });
  await expect.poll(async () => (await state(page)).cards.host!.pose.x).toBeLessThan(-100);
  await idle(page);
  st = await state(page);
  expect(st.cards.aura).toMatchObject({ attachedTo: 'host' });
  expect(st.cards.aura!.pose.x - st.cards.host!.pose.x).toBeCloseTo(10, 1);
  expect(st.cards.aura!.pose.y - st.cards.host!.pose.y).toBeCloseTo(10, 1);

  // Grabbing the aura's peeking strip and dragging it away alone detaches it (and the log says so).
  const h3 = await centre(page, 'host');
  const strip = { x: h3.x + 8 * k, y: h3.y - 49 * k };
  await mouseDrag(page, strip, { x: strip.x + 200 * k, y: strip.y });
  await expect.poll(async () => (await state(page)).cards.aura?.attachedTo ?? null).toBeNull();
  expect((await actions(page)).some((x) => x.type === 'detach' && x.card === 'aura')).toBe(true);
});

test('Ctrl skips the tuck', async ({ page }) => {
  await creature(page, 'host', { x: 0, y: -220, rot: 0 }, SIDS[0]);
  await creature(page, 'aura', { x: 250, y: -220, rot: 0 }, SIDS[1]);
  const k = await pxPerMm(page, 'host');
  const h = await centre(page, 'host');
  await page.keyboard.down('Control');
  await mouseDrag(page, await centre(page, 'aura'), { x: h.x, y: h.y - 76 * k });
  await page.keyboard.up('Control');
  await expect.poll(async () => (await state(page)).cards.aura!.pose.x).toBeLessThan(100);
  expect((await state(page)).cards.aura!.attachedTo).toBeUndefined();
});

test('dragging a middle card of a cascade carries the cards below it; the bottom card carries the pile', async ({ page }) => {
  for (const [i, id] of ['c0', 'c1', 'c2', 'c3'].entries()) {
    await creature(page, id, { x: -200, y: -150 - 14 * i, rot: 0 }, SIDS[i]);
    await dispatch(page, { type: 'pile', card: id, pile: { id: 'L', index: i, kind: 'cascade' } });
  }
  await expect.poll(async () => Object.values((await state(page)).cards).filter((c) => c.pile?.id === 'L').length).toBe(4);
  await idle(page);
  const k = await pxPerMm(page, 'c0');
  // c1's visible strip: its title bar, 14 mm below c0's (cascades step toward the owner).
  const c1 = await centre(page, 'c1');
  const grab = { x: c1.x, y: c1.y - 38 * k };
  await mouseDrag(page, grab, { x: grab.x + 300 * k, y: grab.y }, { hold: true });
  await expect.poll(async () => (await clips(page)).drag?.cards).toEqual(['c1', 'c2', 'c3']);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).cards.c1!.pose.x).toBeGreaterThan(0);
  const st = await state(page);
  expect(st.cards.c0!.pile).toEqual({ id: 'L', index: 0, kind: 'cascade' });
  const np = st.cards.c1!.pile!;
  expect(np.id).not.toBe('L');
  expect(st.cards.c2!.pile).toEqual({ ...np, index: 1 });
  expect(st.cards.c3!.pile).toEqual({ ...np, index: 2 });
  expect(st.cards.c3!.pose.y).toBeCloseTo(st.cards.c1!.pose.y - 28, 1);
});

test('an attacking creature takes its attachments, and Settle brings them back', async ({ page }) => {
  await creature(page, 'bear', { x: 0, y: -220, rot: 0 }, SIDS[0]);
  await creature(page, 'aura', { x: 250, y: -220, rot: 0 }, SIDS[1]);
  await dispatch(page, { type: 'attach', card: 'aura', to: 'bear' });
  await expect.poll(async () => (await state(page)).cards.aura?.attachedTo).toBe('bear');
  await idle(page);
  const tucked = (await state(page)).cards.aura!.pose;
  await hover(page, await centre(page, 'bear'));
  await page.keyboard.press('KeyA');
  await expect.poll(async () => (await state(page)).cards.bear?.combat).toBe('attack');
  expect((await state(page)).cards.aura!.pose).toEqual({ ...tucked, y: tucked.y + 110 });
  await page.keyboard.press('KeyB');
  await expect.poll(async () => (await state(page)).cards.bear?.combat ?? null).toBeNull();
  expect((await state(page)).cards.aura!.pose).toEqual(tucked);
  expect((await state(page)).cards.aura!.attachedTo).toBe('bear');
});
