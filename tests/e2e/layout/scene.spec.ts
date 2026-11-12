/**
 * PLAN M3-P1 in the browser, on the real table scene (`?harness=scene&format=…&viewer=…`; DESIGN "Players, seats and
 * formats"; "Camera and navigation"; "Combat and annotation"): for every format and every viewer the own seat is at the
 * bottom of the screen; an attack line is drawn by right-drag to each opponent's avatar spot and to an opponent's
 * permanent, and the lines keep their ends through camera moves (seat keys, pan, zoom); a tap on an avatar spot goes
 * to that seat; an attacker with no target shows a dashed stub when there are several opponents.
 *
 * Engine facts come from the debug hook (`tableView`, `lines`, `drawnLines`), never from pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import type { Format, TableState } from '../../../src/core/types';
import type { DebugTableView, DrawnLine } from '../../../src/scene/lines';
import type { SceneDebugCard, SceneDebugLine } from '../../../src/scene/table-scene';

const FORMATS: { format: Exclude<Format, '1v1'>; seats: number }[] = [
  { format: 'ffa3', seats: 3 },
  { format: 'ffa4', seats: 4 },
  { format: '2hg', seats: 4 },
];

async function openFormat(page: Page, format: string, viewer: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format, viewer }).toString()}`);
  await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
  await idle(page);
  expect(errors).toEqual([]);
}

const tableView = (page: Page) => page.evaluate(() => window.__spellplane!.tableView!()) as Promise<DebugTableView>;
const state = (page: Page) => page.evaluate(() => window.__spellplane!.state!()) as Promise<TableState>;
const lines = (page: Page) => page.evaluate(() => window.__spellplane!.lines!()) as Promise<SceneDebugLine[]>;
const drawn = (page: Page) => page.evaluate(() => window.__spellplane!.drawnLines!()) as Promise<DrawnLine[]>;
const cards = (page: Page) => page.evaluate(() => window.__spellplane!.cards!()) as Promise<SceneDebugCard[]>;

async function idle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.idle()), { timeout: 10_000 }).toBe(true);
}

async function dispatch(page: Page, a: Record<string, unknown>): Promise<void> {
  await page.evaluate((x) => window.__spellplane!.dispatch!(x as unknown as Action), { cid: `e2e-${Math.random().toString(36).slice(2)}`, ...a });
}

/** Screen centre of a drawn card. */
async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  await idle(page);
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

/** The screen point of a seat's avatar spot now. */
async function avatarOnScreen(page: Page, seat: string): Promise<{ x: number; y: number }> {
  await idle(page);
  const v = await tableView(page);
  const s = v.seats.find((x) => x.seat === seat)!;
  return s.screen!.avatar;
}

/** Right-drag (a line) from a card's centre to a screen point. */
async function rightDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up({ button: 'right' });
}

/** Attack with a creature as the A key would: 110 mm toward the table centre, tapped (scene/combat). */
async function attack(page: Page, card: string): Promise<void> {
  const st = await state(page);
  const c = st.cards[card]!;
  const angle = (await tableView(page)).seats.find((s) => s.seat === c.controller)!.angle;
  const t = (angle * Math.PI) / 180;
  const f = { x: Math.round(Math.sin(t) * 1e9) / 1e9, y: Math.round(Math.cos(t) * 1e9) / 1e9 };
  await dispatch(page, { type: 'moveTemp', by: c.controller, card, pose: { x: c.pose.x + f.x * 110, y: c.pose.y + f.y * 110, rot: c.pose.rot }, combat: 'attack', tap: true });
  await expect.poll(async () => (await state(page)).cards[card]?.combat).toBe('attack');
}

/** Every seat's territory centre on screen; the own one is the lowest (largest y) and in the lower half. */
async function expectOwnSeatAtBottom(page: Page, viewer: string): Promise<void> {
  await idle(page);
  const v = await tableView(page);
  const own = v.seats.find((s) => s.seat === viewer)!;
  expect(own.screen).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(own.screen!.territory.y).toBeGreaterThan(vp.height / 2);
  // The own avatar spot sits under the own territory.
  expect(own.screen!.avatar.y).toBeGreaterThan(own.screen!.territory.y);
  for (const o of v.seats) {
    if (o.seat === viewer) continue;
    expect(o.screen!.territory.y, `seat ${o.seat} as ${viewer} sees it`).toBeLessThanOrEqual(own.screen!.territory.y + 0.5);
  }
}

for (const { format, seats } of FORMATS) {
  for (let i = 0; i < seats; i++) {
    const viewer = `s${i}`;
    test(`${format}, viewer ${viewer}: the own seat is at the bottom, upright`, async ({ page }) => {
      await openFormat(page, format, viewer);
      const v = await tableView(page);
      expect(v.format).toBe(format);
      expect(v.seats).toHaveLength(seats);
      expect(v.viewerAngle).toBe(v.seats[i]!.angle);
      await expectOwnSeatAtBottom(page, viewer);
      // The viewer's own creatures are drawn upright for them: their screen rectangle is taller than wide.
      const own = (await cards(page)).find((c) => c.id === `${viewer}-c0`)!;
      expect(own.screen.height).toBeGreaterThan(own.screen.width);
    });
  }

  test(`${format}: an attack line to each opponent is drawn by right-drag and keeps its ends through camera moves`, async ({ page }) => {
    await openFormat(page, format, 's0');
    const st = await state(page);
    const opponents = Object.values(st.seats)
      .filter((s) => s.id !== 's0' && (s.team === undefined || s.team !== st.seats.s0!.team))
      .map((s) => s.id);
    expect(opponents.length).toBe(format === 'ffa3' ? 2 : 2 + (format === 'ffa4' ? 1 : 0));

    // A stub on an attacker with no target only where the target is not implicit (several opposing sides).
    await attack(page, 's0-c0');
    await expect.poll(async () => (await drawn(page)).filter((l) => l.source === 'stub').map((l) => l.id)).toEqual(format === '2hg' ? [] : ['stub:s0-c0']);

    // One attack line per opponent: an attacker has one target, so further opponents get further attackers (a token
    // made for each, as Ctrl+T would).
    const attackers = ['s0-c0', 's0-c1'];
    for (let k = 2; k < opponents.length; k++) {
      const c = st.cards['s0-c1']!;
      await dispatch(page, { type: 'createToken', by: 's0', card: `s0-t${k}`, zone: 'battlefield:s0', pose: { x: c.pose.x + 100 * (k - 1), y: c.pose.y, rot: c.pose.rot }, ref: { sid: 'fx-7' } });
      attackers.push(`s0-t${k}`);
    }
    for (const a of attackers.slice(1, opponents.length)) await attack(page, a);
    for (let k = 0; k < opponents.length; k++) {
      const from = await centre(page, attackers[k]!);
      await rightDrag(page, from, await avatarOnScreen(page, opponents[k]!));
      await expect.poll(async () => (await lines(page)).filter((l) => l.kind === 'attack').length, { timeout: 10_000 }).toBe(k + 1);
    }
    const attacks = (await lines(page)).filter((l) => l.kind === 'attack');
    expect(attacks.map((l) => [l.from, l.to])).toEqual(expect.arrayContaining(opponents.map((o, k) => [{ kind: 'card', id: attackers[k] }, { kind: 'seat', id: o }])));
    // No stub once every attacker has its target.
    expect((await drawn(page)).filter((l) => l.source === 'stub')).toEqual([]);

    // Where each line is drawn (table mm), before any camera move.
    const before = await lines(page);
    const expectEnds = async () => {
      const v = await tableView(page);
      for (const l of await lines(page)) {
        const b = before.find((x) => x.id === l.id)!;
        expect(l.ends, l.id).not.toBeNull();
        expect(l.ends).toEqual(b.ends);
        if (l.to.kind === 'seat') {
          const seat = v.seats.find((s) => s.seat === l.to.id)!;
          expect(l.ends!.to).toEqual(seat.avatar);
        }
      }
      // Every state line is drawn this frame.
      const ids = (await drawn(page)).filter((d) => d.source === 'state').map((d) => d.id);
      expect(ids.sort()).toEqual(before.map((l) => l.id).sort());
    };

    // Camera moves: the seat keys (2, 3, 4 clockwise, 1 home), a pan and a zoom, then fit (0).
    const camera = async () => (await tableView(page)).camera;
    for (const key of ['2', '3', '4'].slice(0, seats - 1)) {
      const was = await camera();
      await page.keyboard.press(key);
      await idle(page);
      expect(await camera()).not.toEqual(was);
      await expectEnds();
    }
    await page.keyboard.press('1');
    await idle(page);
    await expectEnds();
    await page.evaluate(() => window.__sceneHarness!.camera.panBy(180, -120));
    await page.evaluate(() => window.__sceneHarness!.camera.zoomAt(700, 450, 1.6));
    await idle(page);
    await expectEnds();
    await page.keyboard.press('0');
    await idle(page);
    await expectEnds();

    // A line to an opponent's permanent (a planeswalker, say) is an attack line too.
    const target = `${opponents[0]}-c1`;
    await rightDrag(page, await centre(page, 's0-c0'), await centre(page, target));
    await expect.poll(async () => (await lines(page)).some((l) => l.kind === 'attack' && l.to.kind === 'card' && l.to.id === target)).toBe(true);
    // It replaced s0-c0's line to the player (one target per attacker).
    expect((await lines(page)).filter((l) => l.kind === 'attack' && l.from.kind === 'card' && l.from.id === 's0-c0')).toHaveLength(1);
  });

  test(`${format}: seat keys go clockwise from the viewer and a tap on an avatar spot goes to that seat`, async ({ page }) => {
    const viewer = 's1';
    await openFormat(page, format, viewer);
    const v = await tableView(page);
    const terr = (seat: string) => v.seats.find((s) => s.seat === seat)!.territory;
    const near = async (seat: string) => {
      const c = (await tableView(page)).camera;
      // The camera centres the seat's territory (it is the closest territory centre to the view centre).
      const d = (s: string) => Math.hypot(c.x - terr(s).x, c.y - terr(s).y);
      return v.seats.every((s) => s.seat === seat || d(seat) < d(s.seat));
    };
    for (let k = 1; k < seats; k++) {
      await page.keyboard.press(String(k + 1));
      await idle(page);
      const target = `s${(1 + k) % seats}`;
      await expect.poll(() => near(target), { message: `key ${k + 1} goes to ${target}` }).toBe(true);
    }
    await page.keyboard.press('1');
    await idle(page);
    expect(await near(viewer)).toBe(true);
    await page.keyboard.press('0');
    await idle(page);

    // A tap (press and release without moving) on another seat's avatar spot goes there.
    const other = `s${(1 + 2) % seats}`;
    const a = await avatarOnScreen(page, other);
    await page.mouse.click(a.x, a.y);
    await idle(page);
    await expect.poll(() => near(other)).toBe(true);
    // The own seat is still at the bottom of the screen: going to a seat never turns the view.
    expect((await tableView(page)).viewerAngle).toBe(v.viewerAngle);
  });
}
