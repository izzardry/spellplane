// PLAN M4-P1 acceptance (Camera rigs), through the debug hook on the scene harness with real pointer and key input:
// during a blend the world point under the cursor moves less than 2 px; the ego camera never passes below the table
// edge; with reduced motion the switch is a cut. Plus the design's navigation in both rigs (DESIGN "Camera and
// navigation": every gesture works the same in both; fit, pan, zoom, seat keys, avatar taps; pitch by right-drag in
// ego) and the follow toggles (follow the stack, follow the active player; never while dragging).
// Time is driven with Playwright's fake clock where a blend is sampled frame by frame, so nothing depends on how fast
// the machine renders; no assertion is on timing or pixels.
import { expect, test, type Page } from '@playwright/test';
import type { TableLayout } from '../../../src/games/types';
import type { CameraBlendState, CameraPose, DebugCamera, ScreenPoint, TablePoint } from '../../../src/scene/types';
import { hook } from '../helpers/app';
import { addCard, dispatch, dist, harness, openScene, screenOf, settle, state, tableOf } from '../scene/helpers';

const pose = (page: Page) => hook<CameraPose>(page, 'rig.pose');
const blendOf = (page: Page) => hook<CameraBlendState | null>(page, 'rig.blend');
const rigOf = (page: Page) => hook<string>(page, 'rig.rig');
const toScreen = (page: Page, p: TablePoint) => harness(page, 'toScreen', p.x, p.y) as Promise<ScreenPoint | null>;
const layoutOf = (page: Page) => harness(page, 'layout') as Promise<TableLayout>;
const MIN_HEIGHT = 120;

/** Stop the page's clock: from now on frames run only through `page.clock.runFor`. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  await page.clock.runFor(32);
}

/** Step the paused clock one frame at a time while a blend runs; the anchor's screen point and progress per frame. */
async function sampleBlend(page: Page, a: TablePoint): Promise<{ t: number | null; s: ScreenPoint | null; z: number }[]> {
  const out: { t: number | null; s: ScreenPoint | null; z: number }[] = [];
  for (let i = 0; i < 80; i++) {
    const [b, s, p] = await Promise.all([blendOf(page), toScreen(page, a), pose(page)]);
    out.push({ t: b ? b.t : null, s, z: p.position[2] });
    if (!b) break;
    await page.clock.runFor(16);
  }
  return out;
}

test.describe('M4-P1 acceptance', () => {
  test('during a blend the world point under the cursor moves less than 2 px (P, both ways)', async ({ page }) => {
    await page.clock.install();
    await openScene(page, { scenario: 'demo' });
    await settle(page);
    await pauseClock(page);
    for (const [cursor, to] of [
      [{ x: 860, y: 340 }, 'ego'],
      [{ x: 520, y: 610 }, 'birdseye'],
    ] as const) {
      await page.mouse.move(cursor.x, cursor.y);
      const a = (await tableOf(page, cursor.x, cursor.y))!;
      await page.keyboard.press('p');
      const samples = await sampleBlend(page, a);
      // The blend ran over several frames (time is ours), then ended in the other rig.
      const mid = samples.filter((x) => x.t !== null && x.t > 0 && x.t < 1);
      expect(mid.length).toBeGreaterThan(10);
      expect(samples.at(-1)!.t).toBeNull();
      for (const x of samples) expect(dist(x.s!, cursor)).toBeLessThan(2);
      // The camera stays above the table throughout.
      for (const x of samples) expect(x.z).toBeGreaterThan(MIN_HEIGHT - 1e-6);
      expect(await rigOf(page)).toBe(to);
      const cam = await hook<DebugCamera>(page, 'camera');
      expect(cam.rig).toBe(to);
      expect(cam.fov).toBe(to === 'ego' ? 45 : 6);
    }
  });

  // The multi-seat tables: the ego seat stands in front of the viewer's own territory, beside the centre line in
  // Two-Headed Giant, and the tables are wider than the 1v1 table. Cursors over the table near its side edge.
  for (const { format, viewer, fx, fy } of [
    { format: 'ffa4', viewer: 's0', fx: 0.25, fy: 0.75 },
    { format: '2hg', viewer: 's1', fx: 0.85, fy: 0.65 },
    { format: '2hg', viewer: 's0', fx: 0.1, fy: 0.6 },
  ]) {
    test(`during a blend the cursor's table point moves less than 2 px on ${format} (viewer ${viewer}, both ways)`, async ({ page }) => {
      await page.clock.install();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`./?${new URLSearchParams({ faces: 'placeholder', harness: 'scene', format, viewer }).toString()}`);
      await expect.poll(() => page.evaluate(() => window.__sceneHarness?.ready() ?? false), { timeout: 30_000 }).toBe(true);
      await settle(page);
      await pauseClock(page);
      const vp = page.viewportSize()!;
      const cursor = { x: Math.round(vp.width * fx), y: Math.round(vp.height * fy) };
      const table = (await layoutOf(page)).table;
      await page.mouse.move(cursor.x, cursor.y);
      const a = (await tableOf(page, cursor.x, cursor.y))!;
      // Over the table, not the surround.
      expect(Math.abs(a.x)).toBeLessThanOrEqual(table.w / 2);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(table.d / 2);
      for (const to of ['ego', 'birdseye'] as const) {
        await page.keyboard.press('p');
        const samples = await sampleBlend(page, a);
        expect(samples.filter((x) => x.t !== null && x.t > 0 && x.t < 1).length).toBeGreaterThan(10);
        for (const x of samples) expect(dist(x.s!, cursor)).toBeLessThan(2);
        expect(await rigOf(page)).toBe(to);
      }
      expect(errors).toEqual([]);
    });
  }

  test('the blend reports its anchor, both rigs and the 400 ms duration', async ({ page }) => {
    await page.clock.install();
    await openScene(page, { scenario: 'demo' });
    await settle(page);
    await pauseClock(page);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { anchor: { x: 700, y: 420 } }));
    const b = (await blendOf(page))!;
    expect(b).toMatchObject({ from: 'birdseye', to: 'ego', durationMs: 400, anchor: { screen: { x: 700, y: 420 } } });
    const a = (await tableOf(page, 700, 420))!;
    expect(dist(b.anchor!.table, a)).toBeLessThan(0.5);
    // Switching back mid-blend reverses from where the camera is, with no jump.
    await page.clock.runFor(160);
    const before = await pose(page);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('birdseye', { anchor: { x: 700, y: 420 } }));
    const after = await pose(page);
    expect(Math.hypot(after.position[0] - before.position[0], after.position[1] - before.position[1], after.position[2] - before.position[2])).toBeLessThan(1e-6);
    expect(await blendOf(page)).toMatchObject({ from: 'ego', to: 'birdseye' });
    for (const x of await sampleBlend(page, a)) expect(dist(x.s!, { x: 700, y: 420 })).toBeLessThan(2);
  });

  test('with reduced motion the switch is a cut', async ({ page }) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openScene(page, { scenario: 'demo' });
    await settle(page);
    await pauseClock(page);
    await page.mouse.move(800, 400);
    const a = (await tableOf(page, 800, 400))!;
    await page.keyboard.press('p');
    // No frame has run: the camera is already the ego camera, with no blend in progress.
    expect(await blendOf(page)).toBeNull();
    expect(await rigOf(page)).toBe('ego');
    const p = await pose(page);
    expect(p.fovDeg).toBe(45);
    expect(p.pitchDeg).toBeGreaterThanOrEqual(25);
    expect(p.pitchDeg).toBeLessThanOrEqual(60);
    expect(dist((await toScreen(page, a))!, { x: 800, y: 400 })).toBeLessThan(2);
    await page.keyboard.press('p');
    expect(await blendOf(page)).toBeNull();
    expect((await pose(page)).fovDeg).toBe(6);
    // The same switch without reduced motion animates (so the cut above is the reduced-motion path).
    await page.evaluate(() => window.__sceneHarness!.setView({ reducedMotion: false }));
    await page.keyboard.press('p');
    expect(await blendOf(page)).not.toBeNull();
  });

  test('the ego camera never passes below the table edge or behind the seat, whatever the input', async ({ page }) => {
    await openScene(page);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { animate: false }));
    const table = (await layoutOf(page)).table;
    const seatY = -table.d / 2 - 260;
    const check = async (what: string) => {
      await settle(page);
      const p = await pose(page);
      expect(p.position[2], what).toBeGreaterThanOrEqual(MIN_HEIGHT - 1e-6);
      expect(p.position[1], what).toBeGreaterThanOrEqual(seatY - 1e-6);
      expect(p.pitchDeg, what).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(p.pitchDeg, what).toBeLessThanOrEqual(60 + 1e-9);
      // The lean reaches the table's side edge, no further (DECISIONS [M4-P1]).
      expect(Math.abs(p.position[0]), what).toBeLessThanOrEqual(table.w / 2 + 1e-6);
      return p;
    };
    await check('at rest');
    // Wheel in as far as it goes at several cursor points.
    for (const [x, y] of [
      [720, 450],
      [200, 820],
      [1300, 120],
    ] as const) {
      await page.mouse.move(x, y);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
      await check(`wheel at ${x},${y}`);
    }
    // Pitch down to the limit with a right-drag on empty table, then wheel again.
    const empty = { x: 720, y: 200 };
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(empty.x, empty.y + 600, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    expect((await check('pitched down')).pitchDeg).toBe(60);
    await page.mouse.move(720, 450);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
    await check('pitched down and wheeled in');
    // Pull the table hard every way (pan with inertia).
    for (const [dx, dy] of [
      [600, 0],
      [-900, 0],
      [0, 700],
      [0, -900],
    ] as const) {
      const p0 = { x: 720, y: 300 };
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      await page.mouse.move(p0.x + dx, p0.y + dy, { steps: 8 });
      await page.mouse.up();
      await check(`pan ${dx},${dy}`);
    }
    // And through the camera controls directly.
    await page.evaluate(() => {
      const c = window.__sceneHarness!.camera;
      c.pitchBy(1000);
      c.zoomAt(720, 450, 1000);
      c.panBy(0, 1e6);
    });
    await check('controls at the limits');
    await page.evaluate(() => {
      const c = window.__sceneHarness!.camera;
      c.pitchBy(-1000);
      c.zoomAt(720, 450, 1e-6);
      c.panBy(-1e6, -1e6);
    });
    const p = await check('controls at the other limits');
    expect(p.pitchDeg).toBe(25);
  });
});

test.describe('navigation in the ego rig', () => {
  test('fit, seat keys, Home and avatar taps go where they go in bird\'s-eye', async ({ page }) => {
    await openScene(page);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { animate: false }));
    const layout = await layoutOf(page);
    const centre = { x: 720, y: 450 };
    // 2: the opponent's territory comes to the centre of the view.
    await page.mouse.move(5, 5);
    await page.keyboard.press('2');
    await settle(page);
    const far = layout.seats[1]!.territory;
    expect(dist((await toScreen(page, far))!, centre)).toBeLessThan(2);
    // Home: back to the own side, which shows lower on screen and nearer than the opponent's did.
    await page.keyboard.press('Home');
    await settle(page);
    const own = layout.seats[0]!.territory;
    const ownAt = (await toScreen(page, own))!;
    expect(ownAt.y).toBeGreaterThan(450 * 0.6);
    expect(ownAt.y).toBeLessThan(900);
    // An avatar tap goes to that seat (the opponent's avatar spot beyond the far edge), from a view leaning away.
    await page.keyboard.press('2');
    await settle(page);
    await page.evaluate(() => window.__sceneHarness!.camera.panBy(300, 0));
    await settle(page);
    expect(dist((await toScreen(page, far))!, centre)).toBeGreaterThan(50);
    const avatar = (await toScreen(page, layout.seats[1]!.zones.avatar))!;
    expect(avatar.y).toBeGreaterThan(0);
    await page.mouse.click(avatar.x, avatar.y);
    await settle(page);
    expect(dist((await toScreen(page, far))!, centre)).toBeLessThan(2);
    // 0: the whole table, near and far edges on screen.
    await page.keyboard.press('0');
    await settle(page);
    for (const y of [-layout.table.d / 2, layout.table.d / 2]) {
      const s = (await toScreen(page, { x: 0, y }))!;
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(900);
    }
    expect(await rigOf(page)).toBe('ego');
  });

  test('pan, wheel zoom and zoom to a card work in the ego rig; a card drag lands under the cursor', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: -150, y: -250, rot: 0 });
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { animate: false }));
    await settle(page);
    // Wheel: the camera dollies toward the cursor, which keeps its table point.
    const p1 = await pose(page);
    const at = { x: 760, y: 470 };
    await page.mouse.move(at.x, at.y);
    const t = (await tableOf(page, at.x, at.y))!;
    await page.mouse.wheel(0, -200);
    await settle(page);
    const p2 = await pose(page);
    expect(Math.hypot(t.x - p2.position[0], t.y - p2.position[1], p2.position[2])).toBeLessThan(Math.hypot(t.x - p1.position[0], t.y - p1.position[1], p1.position[2]));
    expect(dist((await toScreen(page, t))!, at)).toBeLessThan(2);
    // Pan: dragging empty table sideways leans the camera the other way.
    await page.mouse.move(900, 250);
    await page.mouse.down();
    await page.mouse.move(800, 250, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    expect((await pose(page)).position[0]).toBeGreaterThan(p2.position[0]);
    await page.keyboard.press('0');
    await settle(page);
    // A card drag: the card ends where the pointer let go, on the table under it.
    const from = (await screenOf(page, -150, -250))!;
    const to = { x: from.x + 220, y: from.y - 60 };
    const target = (await tableOf(page, to.x, to.y))!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    expect(dist((await state(page)).cards.a!.pose, target)).toBeLessThan(1.5);
    // Zoom to the card: it comes to the centre, larger.
    const before = (await harness(page, 'cards')) as { id: string; screen: { height: number } }[];
    await page.evaluate(() => window.__sceneHarness!.camera.zoomTo('a'));
    await settle(page);
    const after = (await harness(page, 'cards')) as { id: string; screen: { height: number } }[];
    expect(after.find((c) => c.id === 'a')!.screen.height).toBeGreaterThan(before.find((c) => c.id === 'a')!.screen.height);
    expect(dist((await toScreen(page, (await state(page)).cards.a!.pose))!, { x: 720, y: 450 })).toBeLessThan(2);
  });

  test('right-drag on empty table pitches in ego only; it opens no context menu', async ({ page }) => {
    await openScene(page);
    await settle(page);
    const bird = await pose(page);
    const drag = async (dy: number) => {
      await page.mouse.move(300, 300);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(300, 300 + dy, { steps: 6 });
      await page.mouse.up({ button: 'right' });
      await settle(page);
    };
    await drag(80);
    expect((await pose(page)).pitchDeg).toBe(bird.pitchDeg);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { animate: false }));
    const before = (await pose(page)).pitchDeg;
    const menus = async () => ((await harness(page, 'events')) as { type: string }[]).filter((e) => e.type === 'contextMenu').length;
    const menusBefore = await menus();
    await drag(50);
    const lower = (await pose(page)).pitchDeg;
    expect(lower).toBeGreaterThan(before);
    await drag(-100);
    expect((await pose(page)).pitchDeg).toBeLessThan(lower);
    expect(await menus()).toBe(menusBefore);
    // A plain right-click on empty table still opens the context menu in ego.
    await page.mouse.click(300, 300, { button: 'right' });
    await expect.poll(menus).toBe(menusBefore + 1);
  });
});

test.describe('follow toggles', () => {
  test('follow the stack brings a new off-screen stack item into view; off, the camera stays', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'x', { x: -550, y: -400, rot: 0 });
    await addCard(page, 'y', { x: -500, y: -400, rot: 0 });
    await settle(page);
    const stackShown = async (item: string) => {
      const e = ((await hook(page, 'stack')) as { item: string; screen: { x: number; y: number; width: number; height: number } }[]).find((s) => s.item === item)!;
      const c = { x: e.screen.x + e.screen.width / 2, y: e.screen.y + e.screen.height / 2 };
      return c.x > 0 && c.y > 0 && c.x < 1440 && c.y < 900;
    };
    await page.evaluate(() => window.__sceneHarness!.camera.zoomTo('x'));
    await settle(page);
    // Off: nothing moves.
    const p0 = await pose(page);
    await dispatch(page, { type: 'stackPush', by: 's0', cid: 'sp1', item: 'si1', kind: 'spell', card: 'x' });
    await settle(page);
    expect(await pose(page)).toEqual(p0);
    expect(await stackShown('si1')).toBe(false);
    // On: the next item comes into view, keeping the zoom.
    await page.evaluate(() => window.__spellplane!.rig!.setFollow({ stack: true }));
    expect(await hook(page, 'rig.follow')).toEqual({ stack: true, activePlayer: false });
    await dispatch(page, { type: 'stackPush', by: 's0', cid: 'sp2', item: 'si2', kind: 'spell', card: 'y' });
    await settle(page);
    expect(await stackShown('si2')).toBe(true);
    const p1 = await pose(page);
    expect(Math.abs(p1.position[2] - p0.position[2])).toBeLessThan(1e-6);
  });

  test('follow the active player eases to their territory on turn change, in both rigs, never while dragging', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'c', { x: -200, y: 100, rot: 0 });
    await settle(page);
    const layout = await layoutOf(page);
    const centreOf = async (seat: number) => dist((await toScreen(page, layout.seats[seat]!.territory))!, { x: 720, y: 450 });
    // Off by default: a turn change does not move the camera.
    const p0 = await pose(page);
    await dispatch(page, { type: 'turnPass', by: 's0', cid: 'tp1', to: 's1' });
    await settle(page);
    expect(await pose(page)).toEqual(p0);
    await page.evaluate(() => window.__spellplane!.rig!.setFollow({ activePlayer: true }));
    await dispatch(page, { type: 'turnPass', by: 's1', cid: 'tp2', to: 's0' });
    await settle(page);
    expect(await centreOf(0)).toBeLessThan(2);
    await page.evaluate(() => window.__spellplane!.rig!.setRig('ego', { animate: false }));
    await dispatch(page, { type: 'turnPass', by: 's0', cid: 'tp3', to: 's1' });
    await settle(page);
    expect(await centreOf(1)).toBeLessThan(2);
    // While a card is held, the turn change waits; the camera moves once it is dropped.
    const at = (await screenOf(page, -200, 100))!;
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 30, at.y - 10, { steps: 4 });
    const held = await pose(page);
    await dispatch(page, { type: 'turnPass', by: 's1', cid: 'tp4', to: 's0' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await pose(page)).toEqual(held);
    await page.mouse.up();
    await settle(page);
    expect(await pose(page)).not.toEqual(held);
    expect(await centreOf(0)).toBeLessThan(await centreOf(1));
    // A press not yet past the drag threshold waits as well (it may become a drag).
    await page.mouse.move(720, 450);
    await page.mouse.down();
    const pressed = await pose(page);
    await dispatch(page, { type: 'turnPass', by: 's0', cid: 'tp5', to: 's1' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await pose(page)).toEqual(pressed);
    await page.mouse.up();
    await settle(page);
    expect(await centreOf(1)).toBeLessThan(2);
    // So does a pointer pressed outside the table (a hand-fan drag still in the HUD), until it is released.
    const outside = await pose(page);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41 })));
    await dispatch(page, { type: 'turnPass', by: 's1', cid: 'tp6', to: 's0' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await pose(page)).toEqual(outside);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41 })));
    await settle(page);
    expect(await centreOf(0)).toBeLessThan(2);
  });
});
