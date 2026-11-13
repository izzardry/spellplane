/**
 * PLAN M3-P1 in the app (DESIGN "Players, seats and formats"; "Pre-game", Lobby settings: Format; "Camera and
 * navigation"; "Combat and annotation"): the host picks the table format in the lobby and every page gets its chairs;
 * three players on the local transport start a free-for-all; each sees their own seat at the bottom; Ann's attackers
 * draw an attack line to each opponent's avatar, every page draws them, and they keep their ends through camera moves
 * (seat keys, avatar taps); the seat keys go clockwise.
 *
 * Engine facts come from shared state and the debug hook (`tableView`, `lines`), never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import type { DebugTableView } from '../../../src/scene/lines';
import type { SceneDebugCard, SceneDebugLine } from '../../../src/scene/table-scene';
import { hook } from '../helpers/app';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname } from '../lobby/helpers';

const tableView = (page: Page) => hook<DebugTableView>(page, 'tableView');
const state = (page: Page) => hook<TableState>(page, 'state');
const lines = (page: Page) => hook<SceneDebugLine[]>(page, 'lines');
const cards = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');

async function idle(page: Page): Promise<void> {
  await expect.poll(async () => (await cards(page)).every((c) => !c.moving), { timeout: 10_000 }).toBe(true);
  // Let a camera move finish: two frames with the same camera.
  await expect
    .poll(async () => {
      const a = (await tableView(page)).camera;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
      const b = (await tableView(page)).camera;
      return a.x === b.x && a.y === b.y && a.dist === b.dist;
    }, { timeout: 10_000 })
    .toBe(true);
}

async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  await idle(page);
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

/** Right-drag from a screen point to another (a connection line). */
async function rightDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up({ button: 'right' });
}

/** The seat whose territory centre is closest to the camera centre. */
async function framed(page: Page): Promise<string> {
  await idle(page);
  const v = await tableView(page);
  const d = (s: (typeof v.seats)[number]) => Math.hypot(v.camera.x - s.territory.x, v.camera.y - s.territory.y);
  return [...v.seats].sort((a, b) => d(a) - d(b))[0]!.seat;
}

async function expectOwnSeatAtBottom(page: Page, me: string): Promise<void> {
  await idle(page);
  const v = await tableView(page);
  const own = v.seats.find((s) => s.seat === me)!;
  const host = (await page.getByTestId('scene-host').boundingBox())!;
  expect(own.screen!.territory.y).toBeGreaterThan(host.y + host.height / 2);
  for (const o of v.seats) if (o.seat !== me) expect(o.screen!.territory.y, `${o.seat} as ${me} sees it`).toBeLessThanOrEqual(own.screen!.territory.y + 0.5);
}

test('the host picks the table format in the lobby; every page gets its chairs', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  const b = await context.newPage();
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  await expect(chair(a, 's1')).toContainText('Ben');
  // Only the host edits it.
  await expect(b.getByTestId('lobby-format-select')).toHaveCount(0);
  await expect(b.getByTestId('lobby-format')).toHaveText('One versus one');

  const select = a.getByTestId('lobby-format-select');
  for (const [format, chairs, name] of [
    ['ffa4', 4, 'Free-for-all, four players'],
    ['2hg', 4, 'Two-Headed Giant'],
    ['ffa3', 3, 'Free-for-all, three players'],
  ] as const) {
    await select.selectOption(format);
    for (const p of [a, b]) {
      await expect(p.locator('[data-testid="chair"]')).toHaveCount(chairs);
      await expect.poll(async () => (await state(p)).format).toBe(format);
    }
    await expect(b.getByTestId('lobby-format')).toHaveText(name);
    // Ann and Ben keep their chairs.
    await expect(chair(b, 's0')).toContainText('Ann');
    await expect(chair(a, 's1')).toContainText('Ben');
    const st = await state(b);
    expect(Object.values(st.seats).every((s) => s.life === (format === '2hg' ? 30 : 20))).toBe(true);
    expect(Object.keys(st.teams)).toEqual(format === '2hg' ? ['t0', 't1'] : []);
  }
  await context.close();
});

test('three players: own seat at the bottom on every page, attack lines to both opponents survive camera moves, seat keys go clockwise', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pages = [await context.newPage(), await context.newPage(), await context.newPage()];
  const [a, b, c] = pages as [Page, Page, Page];
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Ann');
  await a.getByTestId('lobby-format-select').selectOption('ffa3');
  await expect(a.locator('[data-testid="chair"]')).toHaveCount(3);
  for (const [p, name, seat] of [
    [b, 'Ben', 's1'],
    [c, 'Cleo', 's2'],
  ] as const) {
    await openTable(p, room, freshProfile(info, name));
    await setNickname(p, name);
    await expect(chair(a, seat)).toContainText(name);
  }
  for (const p of pages) {
    await p.getByTestId('lobby-deck-text').fill(decklist('gw-m19-60.txt'));
    await p.getByTestId('lobby-deck-check').click();
    await expect(p.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
    await p.getByTestId('ready').click();
    await expect(p.getByTestId('ready-done')).toContainText('60 cards is committed');
  }
  await expect(a.getByTestId('ready-count')).toHaveText('3 of 3 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('hud')).toBeVisible();
  for (const p of pages) await expect.poll(async () => (await hook<DebugTableView | null>(p, 'tableView'))?.format ?? null, { timeout: 15_000 }).toBe('ffa3');

  // Each viewer sees their own seat at the bottom.
  for (const [p, me] of [
    [a, 's0'],
    [b, 's1'],
    [c, 's2'],
  ] as const) await expectOwnSeatAtBottom(p, me);

  // Ann puts two creatures in her front row and attacks with both.
  const view = await tableView(a);
  const t0 = view.seats.find((s) => s.seat === 's0')!.territory;
  for (const [id, dx] of [
    ['atk1', -160],
    ['atk2', -40],
  ] as const) {
    await a.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { type: 'createToken', by: 's0', cid: `e2e-${id}`, card: id, zone: 'battlefield:s0', pose: { x: t0.x + dx, y: t0.y + 120, rot: 0 }, ref: { sid: '226f7c45-db9f-4d48-b575-4d2f1904c963' } });
  }
  await expect.poll(async () => (await cards(a)).filter((x) => x.id.startsWith('atk')).length).toBe(2);
  for (const id of ['atk1', 'atk2']) {
    const p = await centre(a, id);
    await a.mouse.move(p.x, p.y, { steps: 3 });
    await a.keyboard.press('KeyA');
    await expect.poll(async () => (await state(a)).cards[id]?.combat).toBe('attack');
  }
  // Each draws an attack line to one opponent's avatar (the HUD avatars are line targets).
  for (const [id, seat] of [
    ['atk1', 's1'],
    ['atk2', 's2'],
  ] as const) {
    const avatar = (await a.locator(`[data-testid="avatar"][data-seat="${seat}"]`).boundingBox())!;
    await rightDrag(a, await centre(a, id), { x: avatar.x + avatar.width / 2, y: avatar.y + 12 });
    await expect.poll(async () => (await lines(a)).some((l) => l.kind === 'attack' && l.from.kind === 'card' && l.from.id === id && l.to.kind === 'seat' && l.to.id === seat), { timeout: 10_000 }).toBe(true);
  }
  // Every page has both lines, drawn at the attackers and at the opponents' avatar spots.
  const endsOn = async (p: Page) => {
    const v = await tableView(p);
    const ls = (await lines(p)).filter((l) => l.kind === 'attack');
    return ls
      .map((l) => ({ to: l.to.id, ok: l.ends !== null && l.to.kind === 'seat' && l.ends.to.x === v.seats.find((s) => s.seat === l.to.id)!.avatar.x && l.ends.to.y === v.seats.find((s) => s.seat === l.to.id)!.avatar.y, from: l.ends?.from ?? null }))
      .sort((x, y) => x.to.localeCompare(y.to));
  };
  for (const p of pages) {
    await expect.poll(async () => (await endsOn(p)).map((e) => [e.to, e.ok])).toEqual([
      ['s1', true],
      ['s2', true],
    ]);
  }
  const before = await endsOn(a);

  // Camera moves on Ann's page: seat keys (2 is Ben, 3 is Cleo: clockwise from her), an avatar tap, home and fit.
  await a.mouse.move(5, 450);
  await a.keyboard.press('2');
  await expect.poll(() => framed(a)).toBe('s1');
  expect(await endsOn(a)).toEqual(before);
  await a.keyboard.press('3');
  await expect.poll(() => framed(a)).toBe('s2');
  expect(await endsOn(a)).toEqual(before);
  await a.locator('[data-testid="avatar"][data-seat="s1"]').getByTestId('avatar-goto').click();
  await expect.poll(() => framed(a)).toBe('s1');
  expect(await endsOn(a)).toEqual(before);
  await a.keyboard.press('1');
  await expect.poll(() => framed(a)).toBe('s0');
  await a.keyboard.press('0');
  await idle(a);
  expect(await endsOn(a)).toEqual(before);
  expect((await tableView(a)).viewerAngle).toBe(0);

  // Ben's keys go clockwise from him: 2 is Cleo, 3 is Ann. His lines too stay put.
  const benBefore = await endsOn(b);
  await b.mouse.move(5, 450);
  await b.keyboard.press('2');
  await expect.poll(() => framed(b)).toBe('s2');
  await b.keyboard.press('3');
  await expect.poll(() => framed(b)).toBe('s0');
  expect(await endsOn(b)).toEqual(benBefore);
  await context.close();
});
