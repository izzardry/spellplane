/**
 * PLAN Milestone 7, M7-P4 Card feel, with the mouse in Chromium and WebKit (the scene harness, Paper): a picked-up card
 * lifts and leans into its motion; near a snap slot it is pulled in with the landing preview showing; released, it
 * settles exactly where the state says, and then the scene stops drawing (render on demand). Reduced motion: no sway, no
 * pull, the lift is a cut. Asserted through the debug hook (`motion()`, `cards()`, the state), never on pixels; the
 * screenshots mid-lift and mid-snap are evidence for the owner's review.
 */
import { expect, test, type Page } from '@playwright/test';
import { shot } from '../helpers/app';
import { addCard, harness, openScene, screenOf, settle, state, tableOf } from '../scene/helpers';
import { dist, idleFramesStop, motion, motionIdle, shownCard } from './helpers';

const DRAG_LIFT = 12;

/**
 * Press on a card's centre and move the mouse to the table point `to` in steps (button held). Returns the screen point
 * and the free spot of the card there: the table point under the pointer plus the grab offset (whole pixels).
 */
async function pickUpAndMove(page: Page, id: string, to: { x: number; y: number }, steps = 12): Promise<{ at: { x: number; y: number }; free: { x: number; y: number } }> {
  const c = (await shownCard(page, id))!;
  const a = await screenOf(page, c.pose.x, c.pose.y);
  const grab = (await tableOf(page, a.x, a.y))!;
  const b = await screenOf(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  const under = (await tableOf(page, b.x, b.y))!;
  return { at: b, free: { x: under.x + c.pose.x - grab.x, y: under.y + c.pose.y - grab.y } };
}

test('a picked-up card lifts and leans into its motion; released it lands where the state says and the frames stop', async ({ page }, info) => {
  await openScene(page, { scenario: 'empty' });
  await addCard(page, 'a', { x: -200, y: -250, rot: 0 });
  await settle(page);
  const start = (await shownCard(page, 'a'))!;
  expect(start.lift).toBe(0);
  const a = await screenOf(page, start.pose.x, start.pose.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Sideways moves: the card leans (sway) toward its motion, never past the feel's limit.
  let maxSway = 0;
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(a.x + i * 30, a.y);
    const m = await motion(page);
    expect(m.held?.card).toBe('a');
    maxSway = Math.max(maxSway, Math.abs(m.held!.swayDeg));
  }
  expect(maxSway).toBeGreaterThan(0.2);
  expect(maxSway).toBeLessThanOrEqual(8 + 1e-6);
  // Held still, it is fully lifted and hangs straight again.
  await expect.poll(async () => (await motion(page)).held?.liftMm).toBeCloseTo(DRAG_LIFT, 1);
  await expect.poll(async () => Math.abs((await motion(page)).held!.swayDeg)).toBeLessThan(0.05);
  expect((await shownCard(page, 'a'))!.dragging).toBe(true);
  await shot(page, 'M7', 'feel-mid-lift', info.project.name);
  await page.mouse.up();
  await settle(page);
  // Where it lands is the drop's resolution (a free spot here), and the drawn pose is the state's pose.
  const drop = (await harness(page, 'lastDrop')) as { kind: string; pose: { x: number; y: number; rot: number } };
  expect(drop.kind).toBe('free');
  const st = await state(page);
  expect(st.cards.a!.pose).toEqual(drop.pose);
  const drawn = (await shownCard(page, 'a'))!;
  expect(drawn.pose.x).toBeCloseTo(st.cards.a!.pose.x, 2);
  expect(drawn.pose.y).toBeCloseTo(st.cards.a!.pose.y, 2);
  expect(drawn.pose.rot).toBeCloseTo(st.cards.a!.pose.rot, 2);
  expect(drawn.lift).toBe(0);
  expect((await motion(page)).held).toBeNull();
  await idleFramesStop(page);
});

test('near another card the dragged card is pulled in with the landing preview; released it squares onto it', async ({ page }, info) => {
  await openScene(page, { scenario: 'empty' });
  await addCard(page, 'a', { x: 0, y: -250, rot: 0 });
  await addCard(page, 'b', { x: 250, y: -250, rot: 0 });
  await settle(page);
  // Grab b at its centre and hold it 8 mm right of a's centre: within the 12 mm squared-pile radius.
  const { free } = await pickUpAndMove(page, 'b', { x: 8, y: -250 });
  await expect.poll(async () => (await motion(page)).magnet).toMatchObject({ kind: 'squared', target: 'a' });
  const m = await motion(page);
  expect(m.magnet!.pull).toBeGreaterThan(0);
  expect(m.magnet!.pull).toBeLessThanOrEqual(1);
  // The preview ghost shows the landing spot: a's pose.
  const clips = await page.evaluate(() => window.__spellplane!.clips!());
  expect(clips.preview).toMatchObject({ kind: 'squared', target: 'a', pose: { x: 0, y: -250, rot: 0 } });
  // The drawn card is pulled toward the slot: closer to it than its free spot under the pointer.
  await expect.poll(async () => {
    const b = (await shownCard(page, 'b'))!;
    return dist(free, { x: 0, y: -250 }) - dist(b.pose, { x: 0, y: -250 });
  }).toBeGreaterThan(0.5);
  await shot(page, 'M7', 'feel-mid-snap', info.project.name);
  await page.mouse.up();
  await settle(page);
  const st = await state(page);
  expect(st.cards.b!.pose).toEqual({ x: 0, y: -250, rot: 0 });
  expect(st.cards.b!.pile?.kind).toBe('squared');
  const b = (await shownCard(page, 'b'))!;
  expect(b.pose.x).toBeCloseTo(0, 2);
  expect(b.pose.y).toBeCloseTo(-250, 2);
  expect((await motion(page)).magnet).toBeNull();
  await idleFramesStop(page);
});

test('the magnet leads to the drop: Ctrl turns snapping and the pull off, far from any card nothing pulls', async ({ page }) => {
  await openScene(page, { scenario: 'empty' });
  await addCard(page, 'a', { x: 0, y: -250, rot: 0 });
  await addCard(page, 'b', { x: 250, y: -250, rot: 0 });
  await settle(page);
  // Far from a: no slot pulls.
  await pickUpAndMove(page, 'b', { x: 300, y: -350 });
  await expect.poll(async () => (await motion(page)).held?.card).toBe('b');
  expect((await motion(page)).magnet).toBeNull();
  // Over a with Ctrl held: snapping is off, so nothing pulls and the drop is free (DESIGN Drop resolution: Ctrl skips 2 to 4).
  await page.keyboard.down('Control');
  const p = await screenOf(page, 6, -250);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await expect.poll(async () => (await motion(page)).magnet).toBeNull();
  await page.mouse.up();
  await page.keyboard.up('Control');
  await settle(page);
  const st = await state(page);
  expect(st.cards.b!.pile).toBeFalsy();
  expect(Math.abs(st.cards.b!.pose.x - 6)).toBeLessThan(2);
});

test('with reduced motion a held card never sways or is pulled, its lift is a cut, and it lands at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openScene(page, { scenario: 'empty' });
  await addCard(page, 'a', { x: 0, y: -250, rot: 0 });
  await addCard(page, 'b', { x: 250, y: -250, rot: 0 });
  await settle(page);
  const b0 = (await shownCard(page, 'b'))!;
  const s = await screenOf(page, b0.pose.x, b0.pose.y);
  const grab = (await tableOf(page, s.x, s.y))!;
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  const t = await screenOf(page, 8, -250);
  const lifts: number[] = [];
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(s.x + ((t.x - s.x) * i) / 8, s.y + ((t.y - s.y) * i) / 8);
    const m = await motion(page);
    expect(m.motion.reduced).toBe(true);
    expect(m.held!.swayDeg).toBe(0);
    lifts.push(m.held!.liftMm);
  }
  expect(lifts.every((l) => l === 0 || l === DRAG_LIFT)).toBe(true);
  expect(lifts.at(-1)).toBe(DRAG_LIFT);
  // The slot is known (the preview shows it) but nothing pulls: the drawn card is exactly under the pointer.
  await expect.poll(async () => (await motion(page)).magnet).toMatchObject({ kind: 'squared', target: 'a', pull: 0 });
  const under = (await tableOf(page, t.x, t.y))!;
  const free = { x: under.x + b0.pose.x - grab.x, y: under.y + b0.pose.y - grab.y };
  const b = (await shownCard(page, 'b'))!;
  expect(dist(b.pose, free)).toBeLessThan(0.01);
  await page.mouse.up();
  // A cut: at rest on the first look, nothing left running.
  await expect.poll(async () => (await shownCard(page, 'b'))!.lift).toBe(0);
  const st = await state(page);
  expect((await shownCard(page, 'b'))!.pose).toEqual(st.cards.b!.pose);
  await motionIdle(page);
  expect((await motion(page)).running).toEqual([]);
});
