/**
 * PLAN M5-P1 acceptance: touch gestures pass under Playwright's iPad emulation (WebKit, touch). DESIGN "Input and
 * interaction design", Touch: tap selects; drag moves; double-tap taps the card; long-press opens a radial menu with
 * the eight most used actions (owner decisions: tap/untap, flip, inspect, +1/+1 counter, to hand, to graveyard, exile,
 * to stack); long-press then drag draws a line; two-finger gestures always drive the camera. "Camera and navigation",
 * Navigation gestures, Touch column: one-finger drag on empty table pans, two-finger pinch zooms centred between the
 * fingers, two-finger vertical drag pitches (ego), double-tap with two fingers fits, tap an avatar goes to that seat,
 * double-tap zooms to a card; nothing moves the camera while the player drags. Every touch action dispatches the same
 * actions as the keys. Asserted on state, the log and the debug hook; never on pixels or timing.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import {
  IPAD,
  card,
  cards,
  centre,
  doubleTap,
  drag,
  fingers,
  gestures,
  holdDown,
  lastActions,
  longPress,
  path,
  pose,
  radial,
  settled,
  state,
  tableWithCards,
  twoFingers,
  type Pt,
} from './helpers';

test.use(IPAD);
test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** A point of empty table: well below the own row of cards, above the hand fan. */
async function emptyTable(page: Page, ids: string[]): Promise<Pt> {
  const cs = (await cards(page)).filter((c) => ids.includes(c.id));
  const bottom = Math.max(...cs.map((c) => c.screen.y + c.screen.height));
  const left = Math.min(...cs.map((c) => c.screen.x));
  return { x: Math.round(left - 60), y: Math.round(bottom + 40) };
}
const camMoved = (a: { position: number[] }, b: { position: number[] }) => Math.hypot(...a.position.map((v, i) => v - b.position[i]!));

test('tap selects a card (the browser’s own touch), tap on empty table clears; no hover, no camera move', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const p0 = await pose(page);
  const c = centre(await card(page, bf[1]!));
  await page.touchscreen.tap(c.x, c.y);
  await expect.poll(async () => (await cards(page)).filter((x) => x.selected).map((x) => x.id)).toEqual([bf[1]]);
  expect((await gestures(page)).at(-1)).toMatchObject({ kind: 'tap' });
  // Tapping another card selects it instead.
  const c2 = centre(await card(page, bf[2]!));
  await page.touchscreen.tap(c2.x, c2.y);
  await expect.poll(async () => (await cards(page)).filter((x) => x.selected).map((x) => x.id)).toEqual([bf[2]]);
  const empty = await emptyTable(page, bf);
  await page.touchscreen.tap(empty.x, empty.y);
  await expect.poll(async () => (await cards(page)).filter((x) => x.selected).length).toBe(0);
  expect(camMoved(p0, await pose(page))).toBeLessThan(0.01);
  // A tap changes no shared state.
  expect((await state(page)).cards[bf[1]!]!.tapped).toBe(false);
});

test('drag moves a card to where the finger lifts, without moving the camera', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const p0 = await pose(page);
  const before = (await state(page)).cards[bf[0]!]!.pose;
  const from = centre(await card(page, bf[0]!));
  // Up and to the left, within the own territory (the stack lane is further up, at the table's centre).
  const to = { x: from.x - 60, y: from.y - 30 };
  await drag(page, from, to);
  await expect.poll(async () => (await state(page)).cards[bf[0]!]!.pose.x).toBeLessThan(before.x - 40);
  expect((await state(page)).cards[bf[0]!]!.pose.y).toBeGreaterThan(before.y + 20);
  await settled(page);
  expect(dist(centre(await card(page, bf[0]!)), to)).toBeLessThan(12);
  expect((await state(page)).cards[bf[0]!]!.zone).toBe('battlefield:s0');
  expect(camMoved(p0, await pose(page))).toBeLessThan(0.01);
  expect((await lastActions(page, 1))[0]).toMatchObject({ type: 'move', card: bf[0], to: 'battlefield:s0' });
  expect((await gestures(page)).filter((g) => g.kind === 'drag').map((g) => ('phase' in g ? g.phase : ''))).toContain('end');
});

test('double-tap taps the card and again untaps it: the same tap action as T', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const c = centre(await card(page, bf[0]!));
  await doubleTap(page, c);
  await expect.poll(async () => (await state(page)).cards[bf[0]!]!.tapped).toBe(true);
  expect(await lastActions(page, 1)).toEqual([{ type: 'tap', card: bf[0], tapped: true }]);
  await settled(page);
  await doubleTap(page, centre(await card(page, bf[0]!)));
  await expect.poll(async () => (await state(page)).cards[bf[0]!]!.tapped).toBe(false);
  expect(await lastActions(page, 1)).toEqual([{ type: 'tap', card: bf[0], tapped: false }]);
  // Two taps far apart are two taps (selection), not a double-tap.
  await settled(page);
  const a = centre(await card(page, bf[0]!));
  const b = centre(await card(page, bf[2]!));
  await fingers(page, [
    { type: 'down', id: 1, ...a, wait: 30 },
    { type: 'up', id: 1, ...a, wait: 40 },
    { type: 'down', id: 1, ...b, wait: 30 },
    { type: 'up', id: 1, ...b },
  ]);
  await expect.poll(async () => (await cards(page)).filter((x) => x.selected).map((x) => x.id)).toEqual([bf[2]]);
  expect((await state(page)).cards[bf[2]!]!.tapped).toBe(false);
});

test('double-tap on the library draws, as double-click does', async ({ page }, info) => {
  await tableWithCards(page, info, { battlefield: 1, hand: 0 });
  const lib = (await cards(page)).find((c) => c.zone === 'library:s0' && c.visible);
  expect(lib).toBeTruthy();
  const n = (await state(page)).zones['hand:s0']!.ids.length;
  await doubleTap(page, centre(lib!));
  await expect.poll(async () => (await state(page)).zones['hand:s0']!.ids.length).toBe(n + 1);
});

test('double-tap on empty space beside a card zooms to that card', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const c0 = await card(page, bf[2]!);
  // Just right of the rightmost card, on empty table.
  const beside = { x: Math.round(c0.screen.x + c0.screen.width + 10), y: centre(c0).y };
  expect(await hook(page, 'cards').then((cs) => (cs as { id: string; screen: DOMRect }[]).some((c) => beside.x >= c.screen.x && beside.x <= c.screen.x + c.screen.width && beside.y >= c.screen.y && beside.y <= c.screen.y + c.screen.height))).toBe(false);
  await doubleTap(page, beside);
  await settled(page);
  const c1 = await card(page, bf[2]!);
  expect(c1.screen.height).toBeGreaterThan(c0.screen.height * 2);
  const vp = page.viewportSize()!;
  expect(dist(centre(c1), { x: vp.width / 2, y: vp.height / 2 })).toBeLessThan(vp.height / 3);
  expect((await state(page)).cards[bf[2]!]!.tapped).toBe(false);
});

test('long-press opens the radial menu with the eight slots; each runs its action for the card', async ({ page }, info) => {
  const { bf, hand } = await tableWithCards(page, info, { battlefield: 3, hand: 2 });
  const [a, b, c] = bf as [string, string, string];

  // The menu shows while the finger is still down, at the long-press point, with the owner's eight slots.
  const pa = centre(await card(page, a));
  await holdDown(page, pa);
  const r = (await radial(page))!;
  expect(r.card).toBe(a);
  expect(dist(r.at, pa)).toBeLessThan(1);
  expect(r.slots.map((s) => s.id)).toEqual(['tap', 'flip', 'inspect', 'counter', 'toHand', 'toGraveyard', 'toExile', 'stack']);
  expect(r.slots.every((s) => s.enabled)).toBe(true);
  for (const s of r.slots) {
    expect(s.screen.width).toBeGreaterThanOrEqual(44);
    expect(s.screen.height).toBeGreaterThanOrEqual(44);
  }
  // Lifting the finger keeps the menu open and runs nothing.
  const seq = (await state(page)).seq;
  await fingers(page, [{ type: 'up', id: 1, ...pa }]);
  expect(await radial(page)).not.toBeNull();
  expect((await state(page)).seq).toBe(seq);

  const slot = async (id: string) => {
    const s = (await radial(page))!.slots.find((x) => x.id === id)!;
    await page.touchscreen.tap(Math.round(s.screen.x + s.screen.width / 2), Math.round(s.screen.y + s.screen.height / 2));
  };
  await slot('counter');
  await expect.poll(async () => (await state(page)).cards[a]!.counters['+1/+1']).toBe(1);
  expect(await radial(page)).toBeNull();
  expect(await lastActions(page, 1)).toEqual([{ type: 'counter', card: a, kind: '+1/+1', delta: 1 }]);

  const run = async (id: string, cardId: string) => {
    await settled(page);
    await longPress(page, centre(await card(page, cardId)));
    await slot(id);
  };
  await run('tap', a);
  await expect.poll(async () => (await state(page)).cards[a]!.tapped).toBe(true);
  await run('flip', a);
  await expect.poll(async () => (await state(page)).cards[a]!.face).toBe('down');
  await run('stack', b);
  await expect.poll(async () => (await state(page)).stack.map((i) => [i.kind, i.source])).toEqual([['ability', b]]);
  await run('inspect', b);
  await expect(page.getByTestId('inspect')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspect')).toHaveCount(0);
  await run('toGraveyard', b);
  await expect.poll(async () => (await state(page)).cards[b]!.zone).toBe('graveyard:s0');
  await run('toExile', c);
  await expect.poll(async () => (await state(page)).cards[c]!.zone).toBe('exile:s0');
  await run('toHand', a);
  await expect.poll(async () => (await state(page)).cards[a]!.zone).toBe('hand:s0');

  // A hand card: long-press in the fan; tap/untap does not apply there, the stack slot casts it.
  const h = hand[0]!;
  const fanCard = page.locator(`[data-testid="hand-card"][data-card="${h}"]`);
  const box = (await fanCard.boundingBox())!;
  await longPress(page, { x: Math.round(box.x + 20), y: Math.round(box.y + box.height / 2) });
  const rh = (await radial(page))!;
  expect(rh.card).toBe(h);
  expect(rh.slots.find((s) => s.id === 'tap')!.enabled).toBe(false);
  expect(rh.slots.find((s) => s.id === 'stack')!.enabled).toBe(true);
  // A disabled slot does nothing and leaves the menu open.
  const seq2 = (await state(page)).seq;
  await slot('tap');
  expect((await state(page)).seq).toBe(seq2);
  expect(await radial(page)).not.toBeNull();
  await slot('stack');
  await expect.poll(async () => (await state(page)).stack.some((i) => i.kind === 'spell' && i.card === h)).toBe(true);
});

test('the radial menu closes on a press elsewhere, on Esc, and its centre opens the full context menu', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const at = centre(await card(page, bf[0]!));
  await longPress(page, at);
  const r = (await radial(page))!;
  // A press on empty table well clear of the menu's ring closes it and runs nothing.
  const away = { x: Math.round(r.at.x + 260), y: Math.round(r.at.y - 120) };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, away)).toBe('CANVAS');
  const seq = (await state(page)).seq;
  await page.touchscreen.tap(away.x, away.y);
  await expect.poll(() => radial(page)).toBeNull();
  expect((await state(page)).seq).toBe(seq);

  await longPress(page, centre(await card(page, bf[0]!)));
  await page.keyboard.press('Escape');
  await expect.poll(() => radial(page)).toBeNull();

  await longPress(page, centre(await card(page, bf[0]!)));
  await page.getByTestId('radial-more').tap();
  await expect(page.getByTestId('context-menu')).toBeVisible();
  expect(await radial(page)).toBeNull();
  // Entries are thumb-sized on a touch screen; one of them runs on the card (Rotate 180° is not on the radial menu).
  const entry = page.getByTestId('context-menu').locator('[data-action="rotate180"]');
  expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await entry.tap();
  await expect.poll(async () => (await state(page)).cards[bf[0]!]!.pose.rot).toBe(180);
});

test('a long-press on empty table opens the table menu when the finger lifts; no browser context menu', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const empty = await emptyTable(page, bf);
  await holdDown(page, empty);
  // While the finger is down nothing opens yet (it may still drag a marquee).
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  // A context menu event the browser sends for the long touch is not opened as the table's context menu.
  await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true })), empty);
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await fingers(page, [{ type: 'up', id: 1, ...empty }]);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-menu').locator('[data-action="untapAll"]')).toBeVisible();
  expect(await radial(page)).toBeNull();
});

test('long-press then drag draws a line from the card to the card under the finger; the radial menu closes', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const a = centre(await card(page, bf[0]!));
  const b = centre(await card(page, bf[2]!));
  const p0 = await pose(page);
  await holdDown(page, a);
  expect(await radial(page)).not.toBeNull();
  await fingers(page, [...path(1, a, b, 10), { type: 'up', id: 1, ...b }]);
  await expect.poll(async () => Object.keys((await state(page)).lines).length).toBe(1);
  const line = Object.values((await state(page)).lines)[0]!;
  expect(line.from).toEqual({ kind: 'card', id: bf[0] });
  expect(line.to).toEqual({ kind: 'card', id: bf[2] });
  expect(await radial(page)).toBeNull();
  // The source card did not move, nor did the camera.
  expect((await lastActions(page, 1))[0]).toMatchObject({ type: 'lineAdd' });
  expect(camMoved(p0, await pose(page))).toBeLessThan(0.01);
});

test('long-press then drag on empty table selects the cards it spans (a marquee)', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const cs = (await cards(page)).filter((c) => bf.includes(c.id));
  const top = Math.min(...cs.map((c) => c.screen.y));
  const left = Math.min(...cs.map((c) => c.screen.x));
  const start = { x: Math.round(left - 30), y: Math.round(top - 30) };
  const mid = centre(cs.find((c) => c.id === bf[1])!);
  await holdDown(page, start);
  await fingers(page, [...path(1, start, mid, 8), { type: 'up', id: 1, ...mid }]);
  await expect.poll(async () => (await cards(page)).filter((c) => c.selected).map((c) => c.id).sort()).toEqual([bf[0], bf[1]].sort());
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
});

test('one-finger drag on empty table pans the table; nothing on it changes', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const seq = (await state(page)).seq;
  const before = await card(page, bf[1]!);
  const from = await emptyTable(page, bf);
  await drag(page, from, { x: from.x + 150, y: from.y - 60 }, 10);
  await settled(page);
  const after = await card(page, bf[1]!);
  // The table moved with the finger (inertia may carry it a little further).
  expect(after.screen.x - before.screen.x).toBeGreaterThan(120);
  expect(after.screen.y - before.screen.y).toBeLessThan(-40);
  expect((await state(page)).seq).toBe(seq);
});

test('two-finger pinch zooms around the point between the fingers', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const c0 = await card(page, bf[1]!);
  const m = centre(c0);
  const poseBefore = (await state(page)).cards[bf[1]!]!.pose;
  // Spread from 60 px to 300 px apart, centred on the card: it grows and stays under the fingers.
  await fingers(page, twoFingers({ x: m.x - 30, y: m.y }, { x: m.x + 30, y: m.y }, { x: m.x - 150, y: m.y }, { x: m.x + 150, y: m.y }));
  await settled(page);
  const c1 = await card(page, bf[1]!);
  expect(c1.screen.height / c0.screen.height).toBeGreaterThan(3);
  expect(dist(centre(c1), m)).toBeLessThan(6);
  // Pinching in zooms back out.
  await fingers(page, twoFingers({ x: m.x - 150, y: m.y }, { x: m.x + 150, y: m.y }, { x: m.x - 30, y: m.y }, { x: m.x + 30, y: m.y }));
  await settled(page);
  const c2 = await card(page, bf[1]!);
  expect(c2.screen.height).toBeLessThan(c1.screen.height / 3);
  // Two fingers on a card never move, select or tap it.
  expect((await state(page)).cards[bf[1]!]!.pose).toEqual(poseBefore);
  expect((await cards(page)).some((c) => c.selected)).toBe(false);
  const g = await gestures(page);
  expect(g.some((x) => x.kind === 'twoFinger' && x.mode === 'panZoom')).toBe(true);
  expect(g.some((x) => x.kind === 'drag' || x.kind === 'tap')).toBe(false);
});

test('two-finger vertical drag pitches in the ego view; in bird’s-eye it pans', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const vp = page.viewportSize()!;
  const y0 = Math.round(vp.height * 0.45);
  const x0 = Math.round(vp.width / 2);
  // Bird's-eye: the drag moves the table, the pitch stays.
  const b0 = await pose(page);
  await fingers(page, twoFingers({ x: x0 - 60, y: y0 }, { x: x0 + 60, y: y0 }, { x: x0 - 60, y: y0 - 120 }, { x: x0 + 60, y: y0 - 120 }));
  await settled(page);
  const b1 = await pose(page);
  expect(b1.pitchDeg).toBeCloseTo(b0.pitchDeg, 3);
  expect(camMoved(b0, b1)).toBeGreaterThan(1);

  await hook(page, 'rig.setRig', 'ego', { animate: false });
  await settled(page);
  const e0 = await pose(page);
  expect(e0.fovDeg).toBeGreaterThan(20);
  // Fingers up: the camera looks less steeply down (as a right-drag up does); fingers down: steeper again.
  await fingers(page, twoFingers({ x: x0 - 60, y: y0 }, { x: x0 + 60, y: y0 }, { x: x0 - 60, y: y0 - 100 }, { x: x0 + 60, y: y0 - 100 }));
  await settled(page);
  const e1 = await pose(page);
  expect(e1.pitchDeg).toBeLessThan(e0.pitchDeg - 5);
  await fingers(page, twoFingers({ x: x0 - 60, y: y0 }, { x: x0 + 60, y: y0 }, { x: x0 - 60, y: y0 + 100 }, { x: x0 + 60, y: y0 + 100 }));
  await settled(page);
  expect((await pose(page)).pitchDeg).toBeGreaterThan(e1.pitchDeg + 5);
  expect((await gestures(page)).some((g) => g.kind === 'twoFinger' && g.mode === 'pitch')).toBe(true);
  expect((await state(page)).cards[bf[0]!]!.tapped).toBe(false);
});

test('a two-finger double-tap fits the whole table', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const fitted = await pose(page);
  const m = centre(await card(page, bf[1]!));
  await fingers(page, twoFingers({ x: m.x - 30, y: m.y }, { x: m.x + 30, y: m.y }, { x: m.x - 140, y: m.y }, { x: m.x + 140, y: m.y }));
  await settled(page);
  expect(camMoved(fitted, await pose(page))).toBeGreaterThan(10);
  const at = { x: 600, y: 360 };
  const one = [
    { type: 'down' as const, id: 1, x: at.x - 40, y: at.y, wait: 0 },
    { type: 'down' as const, id: 2, x: at.x + 40, y: at.y, wait: 30 },
    { type: 'up' as const, id: 1, x: at.x - 40, y: at.y, wait: 0 },
    { type: 'up' as const, id: 2, x: at.x + 40, y: at.y, wait: 60 },
  ];
  await fingers(page, [...one, ...one]);
  await settled(page);
  expect(camMoved(fitted, await pose(page))).toBeLessThan(1);
  expect((await gestures(page)).at(-1)).toMatchObject({ kind: 'twoFingerDoubleTap' });
});

test('tapping an avatar goes to that seat: the HUD avatar and the avatar spot on the table', async ({ page }, info) => {
  await tableWithCards(page, info);
  const fitted = await pose(page);
  // The other seat's avatar spot on the table.
  const view = await hook<{ seats: { seat: string; screen: { avatar: Pt } | null }[] }>(page, 'tableView');
  const other = view.seats.find((s) => s.seat !== 's0' && s.screen)!;
  await page.touchscreen.tap(Math.round(other.screen!.avatar.x), Math.round(other.screen!.avatar.y));
  await settled(page);
  const there = await pose(page);
  expect(camMoved(fitted, there)).toBeGreaterThan(10);
  // The own avatar in the HUD brings the camera to the own side.
  await page.getByTestId('avatar-goto').first().tap();
  await settled(page);
  const home = await pose(page);
  expect(camMoved(there, home)).toBeGreaterThan(10);
  expect(home.target[1]).toBeLessThan(there.target[1]);
});

test('nothing moves the camera while a finger drags a card: a second finger is ignored until the drag ends', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const p0 = await pose(page);
  const from = centre(await card(page, bf[0]!));
  const to = { x: from.x + 60, y: from.y - 80 };
  // The second finger lands on empty table, right of the row of cards.
  const c2 = await card(page, bf[2]!);
  const f2 = { x: Math.round(c2.screen.x + c2.screen.width + 80), y: Math.round(c2.screen.y - 40) };
  const f2end = { x: f2.x + 120, y: f2.y + 60 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, f2)).toBe('CANVAS');
  await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, { x: from.x + 30, y: from.y - 40 }, 4)]);
  expect((await card(page, bf[0]!)).dragging).toBe(true);
  // A second finger lands and slides; the first goes on dragging.
  await fingers(page, [{ type: 'down', id: 2, ...f2 }, ...path(2, f2, f2end, 6), ...path(1, { x: from.x + 30, y: from.y - 40 }, to, 4)]);
  expect(camMoved(p0, await pose(page))).toBeLessThan(0.01);
  expect((await card(page, bf[0]!)).dragging).toBe(true);
  await fingers(page, [
    { type: 'up', id: 1, ...to },
    { type: 'up', id: 2, ...f2end },
  ]);
  await settled(page);
  expect(camMoved(p0, await pose(page))).toBeLessThan(0.01);
  expect(dist(centre(await card(page, bf[0]!)), to)).toBeLessThan(12);
  expect((await gestures(page)).some((g) => g.kind === 'twoFinger')).toBe(false);
});

test('a second finger before a card drag starts turns the touch into a camera gesture; the card stays', async ({ page }, info) => {
  const { bf } = await tableWithCards(page, info);
  const m = centre(await card(page, bf[1]!));
  const before = (await state(page)).cards[bf[1]!]!.pose;
  await fingers(page, twoFingers({ x: m.x, y: m.y }, { x: m.x + 80, y: m.y }, { x: m.x - 60, y: m.y }, { x: m.x + 140, y: m.y }));
  await settled(page);
  expect((await state(page)).cards[bf[1]!]!.pose).toEqual(before);
  expect((await gestures(page)).some((g) => g.kind === 'twoFinger')).toBe(true);
});
