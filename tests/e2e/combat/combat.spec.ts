/**
 * PLAN M1-P4 in the browser (DESIGN "Combat and annotation"; "Specification: geometry, layout and motion"): attack
 * moves 110 mm forward and taps; a defender drags creatures onto an attacker and they fan out in front of it with
 * block lines; right-drag draws a target line, Shift+right-drag a persistent mark; lines follow their moved endpoints
 * (the debug hook's line endpoints, not pixels); settle (B) returns every displaced card to its home pose and removes
 * attack and block lines but not the mark; a double I pings the hovered card for two seconds.
 *
 * Runs on the solo table with real input (keys, mouse drags). The far seat's creatures are put on the table and sent
 * into the attack through the debug hook, as a remote player's actions would arrive.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import type { Pose, TableState } from '../../../src/core/types';
import type { DebugPing, DrawnLine } from '../../../src/scene/lines';
import type { SceneDebugCard, SceneDebugLine } from '../../../src/scene/table-scene';
import { hook } from '../helpers/app';
import { freshProfile, openSolo } from '../solo/helpers';

const SIDS = ['226f7c45-db9f-4d48-b575-4d2f1904c963', '2f717e04-c078-4696-9ed6-e973033d7be0', 'f4bae0e4-1143-4dc4-afb1-e6b4201ff101', '62d2e929-7ae3-4560-9cfa-53b89c8a6016', 'c2f461b1-c801-4f0c-8fd7-fe68b6078ac6'];

const state = (page: Page) => hook<TableState>(page, 'state');
const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const lines = (page: Page) => hook<SceneDebugLine[]>(page, 'lines');
const drawn = (page: Page) => hook<DrawnLine[]>(page, 'drawnLines');
const pings = (page: Page) => hook<DebugPing[]>(page, 'pings');

let n = 0;
async function dispatch(page: Page, a: Record<string, unknown>, by = 's0'): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { by, cid: `e2e-${++n}`, ...a });
}

async function creature(page: Page, id: string, zone: string, pose: Pose, sid: string): Promise<void> {
  await dispatch(page, { type: 'createToken', card: id, zone, pose, ref: { sid } });
}

/** No card animates. */
async function idle(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving), { timeout: 10_000 }).toBe(true);
}

/** Screen centre of a drawn card. */
async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  await idle(page);
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

async function hover(page: Page, id: string): Promise<void> {
  const p = await centre(page, id);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect.poll(async () => (await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true)))))).toBe(true);
}

/** Drag with the left button from one card's centre to a screen point (offset from another card's centre). */
async function dragTo(page: Page, id: string, to: { x: number; y: number }, opts: { alt?: boolean } = {}): Promise<void> {
  const a = await centre(page, id);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + to.x) / 2, (a.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

/** Right-drag from one card to another (Shift held: a persistent mark). */
async function rightDrag(page: Page, from: string, to: string, shift = false): Promise<void> {
  const a = await centre(page, from);
  const b = await centre(page, to);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  if (shift) await page.keyboard.up('Shift');
}

const xy = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

/** Seat 0 has a0, a1, a2 in its front row; seat 1 has b0 and b1 in its front row. */
async function setup(page: Page): Promise<void> {
  await creature(page, 'a0', 'battlefield:s0', { x: -150, y: -200, rot: 0 }, SIDS[0]!);
  await creature(page, 'a1', 'battlefield:s0', { x: 0, y: -200, rot: 0 }, SIDS[1]!);
  await creature(page, 'a2', 'battlefield:s0', { x: 150, y: -200, rot: 0 }, SIDS[2]!);
  await creature(page, 'b0', 'battlefield:s1', { x: 0, y: 200, rot: 180 }, SIDS[3]!);
  await creature(page, 'b1', 'battlefield:s1', { x: 200, y: 200, rot: 180 }, SIDS[4]!);
  await expect.poll(async () => (await shown(page)).filter((c) => c.zone.startsWith('battlefield')).length).toBe(5);
  await idle(page);
}

test.beforeEach(async ({ page }, info) => {
  await openSolo(page, freshProfile(info));
  await setup(page);
});

test('attack (A) moves the hovered creature 110 mm forward and taps it; Shift+A does not tap', async ({ page }) => {
  await hover(page, 'a1');
  await page.keyboard.press('KeyA');
  await expect.poll(async () => (await state(page)).cards.a1?.combat).toBe('attack');
  let st = await state(page);
  expect(st.cards.a1).toMatchObject({ pose: { x: 0, y: -90, rot: 0 }, home: { x: 0, y: -200, rot: 0 }, tapped: true });
  await idle(page);
  expect((await shown(page)).find((c) => c.id === 'a1')).toMatchObject({ displaced: true, ghost: { x: 0, y: -200, rot: 0 } });

  await hover(page, 'a2');
  await page.keyboard.press('Shift+KeyA');
  await expect.poll(async () => (await state(page)).cards.a2?.combat).toBe('attack');
  st = await state(page);
  expect(st.cards.a2).toMatchObject({ pose: { x: 150, y: -90, rot: 0 }, tapped: false });
});

test('dragging creatures onto an attacker blocks it: they fan out 96 mm in front, joined by block lines that follow the cards', async ({ page }) => {
  // Seat 1 attacks with b0 (as its player's A would): 110 toward the centre, tapped.
  await dispatch(page, { type: 'moveTemp', card: 'b0', pose: { x: 0, y: 90, rot: 180 }, combat: 'attack', tap: true }, 's1');
  await expect.poll(async () => (await state(page)).cards.b0?.combat).toBe('attack');

  // a0 blocks: dropped onto the attacker.
  await dragTo(page, 'a0', await centre(page, 'b0'));
  await expect.poll(async () => (await state(page)).cards.a0?.combat).toBe('block');
  let st = await state(page);
  expect(st.cards.a0).toMatchObject({ pose: { x: 0, y: -6, rot: 0 }, home: { x: -150, y: -200, rot: 0 } });
  const block = Object.values(st.lines).filter((l) => l.kind === 'block');
  expect(block).toHaveLength(1);
  expect(block[0]).toMatchObject({ from: { kind: 'card', id: 'a0' }, to: { kind: 'card', id: 'b0' } });

  // The lone blocker lifted and put back a little off its spot stays blocking, on its spot.
  const a0 = await centre(page, 'a0');
  await dragTo(page, 'a0', { x: a0.x + 8, y: a0.y + 6 });
  await idle(page);
  st = await state(page);
  expect(st.cards.a0).toMatchObject({ pose: { x: 0, y: -6, rot: 0 }, combat: 'block' });
  expect(Object.values(st.lines).filter((l) => l.kind === 'block')).toHaveLength(1);

  // a2 joins the fan, dropped onto the attacker's right half as seat 0 sees it: from seat 1's side (the attacking
  // player orders damage) that is its left, so a2 goes first.
  const b0 = await centre(page, 'b0');
  await dragTo(page, 'a2', { x: b0.x + 12, y: b0.y });
  await expect.poll(async () => (await state(page)).cards.a2?.combat).toBe('block');
  await idle(page);
  st = await state(page);
  expect(st.cards.a2!.pose).toEqual({ x: 34.5, y: -6, rot: 0 });
  expect(st.cards.a0!.pose).toEqual({ x: -34.5, y: -6, rot: 0 });
  expect(Object.values(st.lines).filter((l) => l.kind === 'block')).toHaveLength(2);

  // Debug endpoints are the cards' centres.
  const ends = async () => (await lines(page)).filter((l) => l.kind === 'block').map((l) => [l.from.id, xy(l.ends!.from), xy(l.ends!.to)]);
  expect(await ends()).toEqual(
    expect.arrayContaining([
      ['a0', { x: -34.5, y: -6 }, { x: 0, y: 90 }],
      ['a2', { x: 34.5, y: -6 }, { x: 0, y: 90 }],
    ]),
  );

  // The attacker moves (Alt-drag: a temporary move): both block lines follow it.
  const target = await centre(page, 'b1');
  await dragTo(page, 'b0', { x: target.x, y: target.y + 120 }, { alt: true });
  await expect.poll(async () => (await state(page)).cards.b0!.pose.x).not.toBe(0);
  await idle(page);
  const moved = (await state(page)).cards.b0!.pose;
  expect(moved.y).not.toBe(90);
  expect((await state(page)).cards.b0!.home).toEqual({ x: 0, y: 200, rot: 180 });
  for (const l of (await lines(page)).filter((x) => x.kind === 'block')) expect(xy(l.ends!.to)).toEqual(xy(moved));
  for (const l of (await drawn(page)).filter((x) => x.kind === 'block')) expect(xy(l.to)).toEqual(xy(moved));
});

test('right-drag draws a target line, Shift+right-drag a mark; settle (B) brings everything home and keeps the mark', async ({ page }) => {
  await page.locator('[data-testid="context-menu"]').waitFor({ state: 'detached' }).catch(() => undefined);
  await rightDrag(page, 'a2', 'b1');
  await expect.poll(async () => Object.values((await state(page)).lines).map((l) => l.kind)).toEqual(['target']);
  await rightDrag(page, 'a1', 'b1', true);
  await expect.poll(async () => Object.values((await state(page)).lines).map((l) => l.kind).sort()).toEqual(['mark', 'target']);
  // A right-drag is not a right-click: no context menu.
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  const mark = Object.values((await state(page)).lines).find((l) => l.kind === 'mark')!;
  expect(mark).toMatchObject({ from: { kind: 'card', id: 'a1' }, to: { kind: 'card', id: 'b1' }, by: 's0' });

  // Combat: a0 and a1 attack; b0 blocks a0 (dropped by the far seat's player, through the same plan the drag uses).
  await hover(page, 'a0');
  await page.keyboard.press('KeyA');
  await hover(page, 'a1');
  await page.keyboard.press('KeyA');
  await expect.poll(async () => Object.values((await state(page)).cards).filter((c) => c.combat === 'attack').length).toBe(2);
  // An attack target drawn from an attacker is an attack line.
  await rightDrag(page, 'a1', 'b1');
  await expect.poll(async () => Object.values((await state(page)).lines).filter((l) => l.kind === 'attack').length).toBe(1);
  // From an attacker to its own side's permanent it is a target line (an ability's target); the attack line stays.
  await rightDrag(page, 'a1', 'a2');
  await expect.poll(async () => Object.values((await state(page)).lines).filter((l) => l.from.id === 'a1' && l.to.id === 'a2').map((l) => l.kind)).toEqual(['target']);
  expect(Object.values((await state(page)).lines).filter((l) => l.kind === 'attack')).toMatchObject([{ from: { id: 'a1' }, to: { id: 'b1' } }]);
  await dispatch(page, { type: 'moveTemp', card: 'b0', pose: { x: -150, y: 6, rot: 180 }, combat: 'block' }, 's1');
  await dispatch(page, { type: 'lineAdd', line: 'blk', kind: 'block', from: { kind: 'card', id: 'b0' }, to: { kind: 'card', id: 'a0' } }, 's1');
  await expect.poll(async () => Object.keys((await state(page)).lines).length).toBe(5);
  // The mark follows a1 into the attack.
  await idle(page);
  const markEnds = (await lines(page)).find((l) => l.kind === 'mark')!.ends!;
  expect(xy(markEnds.from)).toEqual({ x: 0, y: -90 });

  await page.mouse.move(8, 450);
  await page.keyboard.press('KeyB');
  await expect.poll(async () => Object.values((await state(page)).cards).filter((c) => c.home).length).toBe(0);
  const st = await state(page);
  expect(st.cards.a0).toMatchObject({ pose: { x: -150, y: -200, rot: 0 }, tapped: true });
  expect(st.cards.a1).toMatchObject({ pose: { x: 0, y: -200, rot: 0 }, tapped: true });
  expect(st.cards.b0!.pose).toEqual({ x: 0, y: 200, rot: 180 });
  expect(Object.values(st.lines).map((l) => l.kind).sort()).toEqual(['mark', 'target', 'target']);
  await idle(page);
  expect((await shown(page)).some((c) => c.displaced)).toBe(false);
  // The mark's end came home with a1.
  expect(xy((await lines(page)).find((l) => l.kind === 'mark')!.ends!.from)).toEqual({ x: 0, y: -200 });
});

test('drawing the same line again removes it; a plain right-click still opens the context menu', async ({ page }) => {
  await rightDrag(page, 'a2', 'b1');
  await expect.poll(async () => Object.keys((await state(page)).lines).length).toBe(1);
  await rightDrag(page, 'a2', 'b1');
  await expect.poll(async () => Object.keys((await state(page)).lines).length).toBe(0);
  const c = await centre(page, 'a2');
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
});

test('a double I pings the hovered card for everyone and the ping fades after two seconds', async ({ page }) => {
  await hover(page, 'b1');
  await page.keyboard.press('KeyI');
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await pings(page)).map((p) => p.target)).toEqual([{ kind: 'card', id: 'b1' }]);
  const p = (await pings(page))[0]!;
  expect(p.alpha).toBeGreaterThan(0);
  expect(xy(p.at!)).toEqual({ x: 200, y: 200 });
  // A ping leaves no state.
  expect(Object.keys((await state(page)).lines)).toEqual([]);
  await expect.poll(async () => (await pings(page)).length, { timeout: 5_000 }).toBe(0);
});
