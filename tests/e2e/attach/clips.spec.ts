/**
 * PLAN Milestone 6 acceptance, Clips, with the mouse and keyboard (Chromium and WebKit): clips created by hold (the
 * ring fills from 200 ms, the clip snaps on at 600 ms), by tray drag and by key; dragging any clipped card moves the
 * group; double-click and drag-off removal, the clip's menu and the Clip key on a clipped card; hovering a clip outlines
 * the clipped cards; a clipped card going to the graveyard leaves the clip; undo restores clips (DESIGN "Card
 * manipulation", Clip). Asserted on state, the log and the debug hook.
 */
import { expect, test, type Page } from '@playwright/test';
import { shot } from '../helpers/app';
import { freshProfile, openSolo } from '../solo/helpers';
import { SIDS, actions, centre, clipCentre, clips, creature, hover, idle, mouseDrag, pxPerMm, shown, state } from './helpers';

/** a at (0, -200) and b at (30, -180) overlap; c at (250, -200) stands apart. */
async function table(page: Page): Promise<void> {
  await creature(page, 'a', { x: 0, y: -200, rot: 0 }, SIDS[0]);
  await creature(page, 'b', { x: 30, y: -180, rot: 0 }, SIDS[1]);
  await creature(page, 'c', { x: 250, y: -200, rot: 0 }, SIDS[2]);
  await idle(page);
}

/** A screen point over the overlap of a and b: the middle of their centres. */
async function overlap(page: Page): Promise<{ x: number; y: number }> {
  const a = await centre(page, 'a');
  const b = await centre(page, 'b');
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const clipCount = async (page: Page) => Object.keys((await state(page)).clips ?? {}).length;

test.beforeEach(async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
  await table(page);
});

test('holding the button still on an overlap clips the cards: the ring fills from 200 ms, the clip snaps on at 600 ms', async ({ page }, info) => {
  const p = await overlap(page);
  await page.mouse.move(p.x, p.y);
  // Record in the page when the press went down, when the ring first showed and when the clip came on (lower bounds
  // only: a slow machine may draw late, never early).
  await page.evaluate(() => {
    const w = window as unknown as { __ring: { down: number; shown: number; clipped: number } };
    w.__ring = { down: 0, shown: 0, clipped: 0 };
    addEventListener('pointerdown', () => (w.__ring.down = performance.now()), { capture: true, once: true });
    const ring = document.querySelector<HTMLElement>('[data-scene="clip-ring"]')!;
    new MutationObserver(() => {
      if (ring.style.display === 'block' && !w.__ring.shown) w.__ring.shown = performance.now();
    }).observe(ring, { attributes: true });
    const loop = () => {
      if ((window.__spellplane as unknown as { clips(): { clips: unknown[] } }).clips().clips.length) w.__ring.clipped = performance.now();
      else requestAnimationFrame(loop);
    };
    loop();
  });
  await page.mouse.down();
  await expect.poll(async () => (await clips(page)).hold?.cards.sort() ?? (await clips(page)).clips[0]?.cards).toEqual(['a', 'b']);
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null, { timeout: 10_000 }).toEqual(['a', 'b']);
  const t = await page.evaluate(() => (window as unknown as { __ring: { down: number; shown: number; clipped: number } }).__ring);
  expect(t.clipped - t.down).toBeGreaterThanOrEqual(595);
  if (t.shown) {
    expect(t.shown - t.down).toBeGreaterThanOrEqual(195);
    expect(t.shown).toBeLessThanOrEqual(t.clipped);
  }
  await page.mouse.up();
  await expect(page.locator('[data-scene="clip-ring"]')).toBeHidden();
  const c = Object.values((await state(page)).clips!)[0]!;
  expect(c).toMatchObject({ cards: ['a', 'b'], by: 's0', anchor: { card: 'b' } });
  // The release after the hold neither dragged nor selected anything.
  expect((await state(page)).cards.b!.pose).toEqual({ x: 30, y: -180, rot: 0 });
  expect((await shown(page)).filter((x) => x.selected)).toEqual([]);
  // The clip lies over the overlap.
  const d = (await clips(page)).clips[0]!;
  expect(d.at.x).toBeGreaterThan(-1.5);
  expect(d.at.x).toBeLessThan(31.5);
  await shot(page, 'M6', 'clip-hold', info.project.name);
  // The log names who clipped.
  expect((await actions(page)).some((a) => a.type === 'clipAdd' && a.by === 's0')).toBe(true);
});

test('a quick click or a press that moves never clips', async ({ page }) => {
  const p = await overlap(page);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  expect(await clipCount(page)).toBe(0);
  const k = await pxPerMm(page, 'a');
  await mouseDrag(page, p, { x: p.x + 60 * k, y: p.y });
  await page.waitForTimeout(800);
  expect(await clipCount(page)).toBe(0);
});

test('dragging any clipped card moves the whole group; the clip rides along; hovering the clip outlines the group', async ({ page }) => {
  const p = await overlap(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await expect.poll(() => clipCount(page), { timeout: 10_000 }).toBe(1);
  await page.mouse.up();
  const k = await pxPerMm(page, 'a');
  for (const [id, dx] of [
    ['a', -150],
    ['b', 150],
  ] as const) {
    const before = await state(page);
    // Grab the card where it is not covered by the other one or the clip.
    const r = await centre(page, id);
    const grab = { x: r.x + (id === 'a' ? -20 : 20) * k, y: r.y };
    await mouseDrag(page, grab, { x: grab.x + dx * k, y: grab.y });
    await expect.poll(async () => (await state(page)).cards[id]!.pose.x).not.toBe(before.cards[id]!.pose.x);
    const st = await state(page);
    const ddx = st.cards.a!.pose.x - before.cards.a!.pose.x;
    expect(st.cards.b!.pose.x - before.cards.b!.pose.x).toBeCloseTo(ddx, 1);
    expect(st.cards.b!.pose.y - before.cards.b!.pose.y).toBeCloseTo(st.cards.a!.pose.y - before.cards.a!.pose.y, 1);
    expect(st.cards.c!.pose).toEqual({ x: 250, y: -200, rot: 0 });
    // One gesture: one group in the log.
    const moves = (await actions(page)).filter((a) => a.type === 'move').slice(-2);
    expect(moves.map((m) => m.group)).toEqual([moves[0]!.group, moves[0]!.group]);
  }
  // Hovering the clip outlines both cards (and not the third).
  await hover(page, await clipCentre(page));
  await expect.poll(async () => (await shown(page)).filter((x) => x.hovered).map((x) => x.id).sort()).toEqual(['a', 'b']);
});

test('double-click on the clip takes it off; undo puts it back', async ({ page }) => {
  const p = await overlap(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await expect.poll(() => clipCount(page), { timeout: 10_000 }).toBe(1);
  await page.mouse.up();
  const at = await clipCentre(page);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => clipCount(page)).toBe(0);
  // The double-click did not tap the card under the clip.
  expect((await state(page)).cards.b!.tapped).toBe(false);
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => clipCount(page)).toBe(1);
});

test('dragging the clip off onto empty table removes it; the clip tray clips an overlap; its menu removes it', async ({ page }) => {
  // From the tray onto the overlap.
  const tray = page.getByTestId('clip-tray');
  const box = (await tray.boundingBox())!;
  const p = await overlap(page);
  await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, p);
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'b']);
  // Dropped from the tray on empty table, a clip just vanishes.
  const k = await pxPerMm(page, 'a');
  await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: p.x - 200 * k, y: p.y + 150 * k });
  await page.waitForTimeout(300);
  expect(await clipCount(page)).toBe(1);
  // Drag the clip off onto empty table.
  const at = await clipCentre(page);
  await mouseDrag(page, at, { x: at.x - 250 * k, y: at.y + 150 * k });
  await expect.poll(() => clipCount(page)).toBe(0);
  // Again, then its context menu's Remove clip.
  await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, p);
  await expect.poll(() => clipCount(page)).toBe(1);
  const at2 = await clipCentre(page);
  await page.mouse.click(at2.x, at2.y, { button: 'right' });
  await page.getByTestId('context-menu').locator('[data-action="removeClip"]').click();
  await expect.poll(() => clipCount(page)).toBe(0);
});

test('the Clip key clips a card with the cards it overlaps and, on a clipped card, takes the clip off; the context menu clips a selection', async ({ page }) => {
  const k = await pxPerMm(page, 'a');
  const a = await centre(page, 'a');
  await hover(page, { x: a.x - 20 * k, y: a.y });
  await page.keyboard.press('Shift+KeyP');
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'b']);
  await page.keyboard.press('Shift+KeyP');
  await expect.poll(() => clipCount(page)).toBe(0);
  // Select a and c (apart) and clip them together from the context menu.
  await page.mouse.click(a.x - 20 * k, a.y);
  const c = await centre(page, 'c');
  await page.keyboard.down('Shift');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Shift');
  await page.mouse.click(c.x, c.y, { button: 'right' });
  const entry = page.getByTestId('context-menu').locator('[data-action="clip"]');
  await expect(entry).toHaveText(/Clip together/);
  await entry.click();
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'c']);
});

test('a clipped card going to the graveyard leaves the clip; undo restores the clip', async ({ page }) => {
  const p = await overlap(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await expect.poll(() => clipCount(page), { timeout: 10_000 }).toBe(1);
  await page.mouse.up();
  const k = await pxPerMm(page, 'a');
  const a = await centre(page, 'a');
  await hover(page, { x: a.x - 20 * k, y: a.y });
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await state(page)).cards.a!.zone).toBe('graveyard:s0');
  expect(await clipCount(page)).toBe(0);
  expect((await clips(page)).clips).toEqual([]);
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(async () => (await state(page)).cards.a!.zone).toBe('battlefield:s0');
  await expect.poll(async () => Object.values((await state(page)).clips ?? {})[0]?.cards ?? null).toEqual(['a', 'b']);
});
