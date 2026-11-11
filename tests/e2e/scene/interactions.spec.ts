// Scene interactions beyond the acceptance list (DESIGN "Card manipulation", "Camera and navigation",
// "Specification: geometry, layout and motion"): Ctrl, clamping, zone drops, piles moving as one, selection,
// pan with inertia, reduced motion, remote animation, flip, faces per viewer.
import { expect, test } from '@playwright/test';
import { actions, addCard, card, cards, dispatch, dist, drag, harness, openScene, screenOf, settle, state, tableOf, zoomTo } from './helpers';

test('Ctrl skips snapping: the card lands exactly where it was released', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
  await addCard(page, 'b', { x: -250, y: -300, rot: 0 });
  await zoomTo(page, -100, -300, 2.5);
  const { a, b } = await drag(page, { x: -250, y: -300 }, { x: 5, y: -296 }, { ctrl: true });
  await settle(page);
  // Expected: release point plus the grab offset, both from the rounded pointer positions.
  const pa = await tableOf(page, a.x, a.y);
  const pb = await tableOf(page, b.x, b.y);
  const expected = { x: pb.x + (-250 - pa.x), y: pb.y + (-300 - pa.y) };
  expect(dist((await state(page)).cards.b!.pose, expected)).toBeLessThan(0.5);
  expect((await state(page)).cards.b!.pile).toBeUndefined();
  expect(await harness(page, 'lastDrop')).toMatchObject({ rule: 5, kind: 'free' });
});

test('a free drop beyond the table edge is clamped to the table', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: 500, y: -300, rot: 0 });
  // Release the card's centre past the right edge (table is 1400 wide).
  await drag(page, { x: 500, y: -300 }, { x: 760, y: -300 });
  await settle(page);
  const pose = (await state(page)).cards.a!.pose;
  expect(pose.x).toBeCloseTo(700 - 31.5, 3);
});

test('dropping on the graveyard moves the card there; the library takes it face down on top', async ({ page }) => {
  await openScene(page);
  const layout = (await harness(page, 'layout')) as { seats: { zones: { graveyard: { x: number; y: number }; library: { x: number; y: number } } }[] };
  const gy = layout.seats[0]!.zones.graveyard;
  const lib = layout.seats[0]!.zones.library;
  await addCard(page, 'a', { x: 200, y: -300, rot: 0 });
  await addCard(page, 'b', { x: 300, y: -300, rot: 0 });
  await drag(page, { x: 200, y: -300 }, gy);
  await settle(page);
  expect((await actions(page)).at(-1)).toEqual({ type: 'move', card: 'a', to: 'graveyard:s0', pile: null });
  expect((await state(page)).cards.a!.zone).toBe('graveyard:s0');
  expect(dist((await card(page, 'a'))!.pose, gy)).toBeLessThan(0.5);
  await drag(page, { x: 300, y: -300 }, lib);
  await settle(page);
  expect((await actions(page)).at(-1)).toEqual({ type: 'toZone', card: 'b', to: 'library:s0', position: 'top' });
  expect((await card(page, 'b'))!.shows).toBe('back');
});

test('a pile moves as one when dragged by its bottom card; any other card pulls out singly', async ({ page }) => {
  await openScene(page);
  const pile = (i: number) => ({ id: 'P', index: i, kind: 'cascade' as const });
  await addCard(page, 'a', { x: 0, y: -250, rot: 0 });
  await addCard(page, 'b', { x: 0, y: -264, rot: 0 });
  await addCard(page, 'c', { x: 0, y: -278, rot: 0 });
  for (const [id, i] of [['a', 0], ['b', 1], ['c', 2]] as const) await dispatch(page, { type: 'pile', by: 's0', cid: `p${id}`, card: id, pile: pile(i) });
  await zoomTo(page, 100, -280, 2);
  // Grab the bottom card by its title bar (the only part not covered).
  await drag(page, { x: 0, y: -250 + 38 }, { x: 200, y: -250 + 38 });
  await settle(page);
  let s = await state(page);
  expect(dist(s.cards.a!.pose, { x: 200, y: -250 })).toBeLessThan(0.5);
  expect(dist(s.cards.b!.pose, { x: 200, y: -264 })).toBeLessThan(0.5);
  expect(dist(s.cards.c!.pose, { x: 200, y: -278 })).toBeLessThan(0.5);
  expect(s.cards.c!.pile).toMatchObject({ id: 'P', index: 2 });
  // The top card pulls out alone and leaves the pile.
  await drag(page, { x: 200, y: -278 }, { x: 0, y: -420 });
  await settle(page);
  s = await state(page);
  expect(s.cards.c!.pile).toBeUndefined();
  expect(dist(s.cards.a!.pose, { x: 200, y: -250 })).toBeLessThan(0.5);
});

test('double-click opens a pile in place; Shift+click and Shift+marquee select', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: -100, y: -300, rot: 0 });
  await addCard(page, 'b', { x: 0, y: -300, rot: 0 });
  await addCard(page, 'c', { x: 100, y: -300, rot: 0 });
  await addCard(page, 'd', { x: 300, y: -400, rot: 0 });
  const pa = await screenOf(page, -100, -300);
  const pc = await screenOf(page, 100, -300);
  await page.mouse.click(pa.x, pa.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pc.x, pc.y);
  await page.keyboard.up('Shift');
  expect((await harness(page, 'view')) as { selection: string[] }).toMatchObject({ selection: ['a', 'c'] });
  // Shift+drag on empty table draws a marquee that adds the cards it touches.
  const m0 = await screenOf(page, 250, -330);
  const m1 = await screenOf(page, 380, -470);
  await page.keyboard.down('Shift');
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m1.x, m1.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(((await harness(page, 'view')) as { selection: string[] }).selection).toEqual(['a', 'c', 'd']);
  // A click on empty table clears it.
  const e = await screenOf(page, -500, -150);
  await page.mouse.click(e.x, e.y);
  expect(((await harness(page, 'view')) as { selection: string[] }).selection).toEqual([]);
  // Squared pile: double-click fans it open in place.
  for (const [id, i] of [['a', 0], ['b', 1]] as const) await dispatch(page, { type: 'pile', by: 's0', cid: `q${id}`, card: id, pile: { id: 'Q', index: i, kind: 'squared' }, pose: { x: -100, y: -300, rot: 0 } });
  await settle(page);
  await page.mouse.dblclick(pa.x, pa.y);
  await settle(page);
  expect((await harness(page, 'events')) as { type: string; args: unknown[] }[]).toContainEqual({ type: 'pileOpen', args: ['Q'] });
  expect(dist((await card(page, 'b'))!.pose, { x: -100 + 69, y: -300 })).toBeLessThan(0.5);
  // The state is unchanged: opening is a view, not an action.
  expect((await state(page)).cards.b!.pose).toEqual({ x: -100, y: -300, rot: 0 });
});

test('dragging empty table pans and keeps gliding (inertia); 0 fits the table again', async ({ page }) => {
  await openScene(page);
  await page.evaluate(() => window.__sceneHarness!.camera.zoomAt(720, 450, 3));
  await settle(page);
  const cam0 = (await page.evaluate(() => window.__spellplane!.camera!())).position;
  const k = 900 / 2 / (cam0[2] * Math.tan((3 * Math.PI) / 180)); // px per mm
  // The fling needs the release within 80 ms of the last move. Driving the drag from inside the page keeps
  // that timing independent of the test runner's round trips (on a loaded CI machine page.mouse.up arrived late).
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!;
    const fire = (type: string, x: number, target: EventTarget) =>
      target.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: 450, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }),
      );
    fire('pointerdown', 900, canvas);
    for (let i = 1; i <= 8; i++) {
      await new Promise((r) => setTimeout(r, 16));
      fire('pointermove', 900 - i * 25, canvas);
    }
    fire('pointerup', 700, canvas);
  });
  await settle(page);
  const cam1 = (await page.evaluate(() => window.__spellplane!.camera!())).position;
  const movedPx = (cam1[0] - cam0[0]) * k;
  // Dragging the table left moves the view right: by the 200 px dragged, plus the glide.
  expect(movedPx).toBeGreaterThan(205);
  await page.keyboard.press('0');
  await settle(page);
  const fit = (await page.evaluate(() => window.__spellplane!.camera!())).position;
  expect(fit[0]).toBeCloseTo(0, 6);
  expect(fit[1]).toBeCloseTo(0, 6);
});

test('trackpad scroll pans without zooming; the zoom is clamped at both ends', async ({ page }) => {
  await openScene(page);
  await page.evaluate(() => window.__sceneHarness!.camera.zoomAt(720, 450, 3));
  const before = (await page.evaluate(() => window.__spellplane!.camera!())).position;
  await page.mouse.move(720, 450);
  await page.mouse.wheel(37.5, 12.5);
  const after = (await page.evaluate(() => window.__spellplane!.camera!())).position;
  expect(after[2]).toBe(before[2]);
  expect(after[0]).toBeGreaterThan(before[0]);
  await addCard(page, 'a', await tableOf(page, 720, 450).then((p) => ({ ...p, rot: 0 })));
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200);
  // Closest zoom: one card is 80% of the viewport height.
  expect((await card(page, 'a'))!.screen.height).toBeCloseTo(0.8 * 900, 0);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 200);
  // Farthest: the table plus 5% fits (the 1100 deep table is the tight axis at 1440 x 900).
  const tl = (await harness(page, 'toScreen', -700, 550)) as { x: number; y: number };
  const br = (await harness(page, 'toScreen', 700, -550)) as { x: number; y: number };
  expect((br.y - tl.y) / 900).toBeCloseTo(1 / 1.05, 3);
});

test('with reduced motion a drop is a cut, not an animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openScene(page);
  await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
  await addCard(page, 'b', { x: -250, y: -300, rot: 0 });
  await zoomTo(page, -100, -300, 2);
  await drag(page, { x: -250, y: -300 }, { x: 4, y: -297 });
  const b = (await card(page, 'b'))!;
  expect(b.moving).toBe(false);
  expect(dist(b.pose, { x: 0, y: -300 })).toBeLessThan(0.5);
  // A remote change also cuts.
  const moving = await page.evaluate(() => {
    window.__spellplane!.dispatch!({ type: 'move', by: 's1', cid: 'r1', card: 'a', to: 'battlefield:s0', pose: { x: 300, y: -200, rot: 0 } });
    return window.__sceneHarness!.cards().find((c) => c.id === 'a')!;
  });
  expect(moving.moving).toBe(false);
  expect(moving.pose).toEqual({ x: 300, y: -200, rot: 0 });
});

test('remote changes animate; a flip swaps the face half-way', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
  await settle(page);
  const first = await page.evaluate(() => {
    window.__spellplane!.dispatch!({ type: 'move', by: 's1', cid: 'r1', card: 'a', to: 'battlefield:s0', pose: { x: 300, y: -200, rot: 0 } });
    return window.__sceneHarness!.cards().find((c) => c.id === 'a')!;
  });
  expect(first.moving).toBe(true);
  expect(first.pose).toMatchObject({ x: 0, y: -300 });
  await settle(page);
  expect((await card(page, 'a'))!.pose).toEqual({ x: 300, y: -200, rot: 0 });
  const flipping = await page.evaluate(() => {
    window.__spellplane!.dispatch!({ type: 'flip', by: 's0', cid: 'f1', card: 'a', face: 'down' });
    return window.__sceneHarness!.cards().find((c) => c.id === 'a')!;
  });
  expect(flipping).toMatchObject({ moving: true, shows: 'face' });
  await settle(page);
  expect((await card(page, 'a'))!.shows).toBe('back');
});

test('the owner sees their own face-down card dimmed; the opponent sees the back', async ({ page }) => {
  await openScene(page, { scenario: 'demo' });
  const all = await cards(page);
  expect(all.find((c) => c.id === 's0-d0')).toMatchObject({ shows: 'face', dimmed: true });
  expect(all.find((c) => c.id === 's1-d0')).toMatchObject({ shows: 'back', dimmed: false });
  // The viewer's own hand is the HUD's fan, not drawn on the table; the opponent's hand is a row of backs.
  expect(all.some((c) => c.zone === 'hand:s0')).toBe(false);
  expect(all.filter((c) => c.zone === 'hand:s1').every((c) => c.shows === 'back')).toBe(true);
  // From seat 1 the table turns around: seat 1's territory is at the bottom of the screen.
  await openScene(page, { scenario: 'demo', viewer: 's1' });
  const near = (await harness(page, 'toScreen', 0, 330)) as { y: number };
  expect(near.y).toBeGreaterThan(450);
});

test('each texture tier asks the face source for its own image (thumbnail at overview, large up close)', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: 0, y: -300, rot: 0 }, 'battlefield:s0', 'fx-777');
  const tiers = async () => ((await harness(page, 'faceRequests')) as { key: string; tier: string }[]).filter((r) => r.key === 'fx-777#0').map((r) => r.tier);
  // The card's thumbnail is requested on the next frame and drawn once uploaded.
  await expect.poll(async () => (await card(page, 'a'))?.tier ?? null).toBe('small');
  await expect.poll(() => page.evaluate(() => window.__sceneHarness!.ready())).toBe(true);
  expect(await tiers()).toEqual(['small']);
  await page.evaluate(() => window.__sceneHarness!.camera.zoomTo('a'));
  await settle(page);
  await expect.poll(async () => (await card(page, 'a'))!.tier, { timeout: 20_000 }).toBe('large');
  expect(await tiers()).toContain('large');
});

test('a dropped card awaiting confirmation does not bounce back on an unrelated update', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: -250, y: -300, rot: 0 });
  // Reduced motion: every retarget is a cut, so a bounce would show at once (no timing involved).
  await page.evaluate(() => window.__sceneHarness!.setView({ reducedMotion: true }));
  await page.evaluate(() => window.__sceneHarness!.hold(true));
  await drag(page, { x: -250, y: -300 }, { x: 200, y: -280 });
  expect(dist((await card(page, 'a'))!.pose, { x: 200, y: -280 })).toBeLessThan(1);
  // Before the move is confirmed, another update arrives (a card created elsewhere).
  await addCard(page, 'z', { x: 500, y: 300, rot: 180 }, 'battlefield:s1');
  const shown = (await card(page, 'a'))!;
  expect(dist(shown.pose, { x: 200, y: -280 })).toBeLessThan(1);
  expect((await state(page)).cards.a!.pose).toEqual({ x: -250, y: -300, rot: 0 });
  await page.evaluate(() => window.__sceneHarness!.hold(false));
  await settle(page);
  expect(dist((await state(page)).cards.a!.pose, { x: 200, y: -280 })).toBeLessThan(1);
  expect(dist((await card(page, 'a'))!.pose, { x: 200, y: -280 })).toBeLessThan(1);
});

test('double-click taps a member of a cascade; its bottom card opens the pile', async ({ page }) => {
  await openScene(page);
  await addCard(page, 'a', { x: -100, y: -300, rot: 0 });
  await addCard(page, 'b', { x: -100, y: -314, rot: 0 });
  for (const [id, i, y] of [['a', 0, -300], ['b', 1, -314]] as const) await dispatch(page, { type: 'pile', by: 's0', cid: `c${id}`, card: id, pile: { id: 'L', index: i, kind: 'cascade' }, pose: { x: -100, y, rot: 0 } });
  await zoomTo(page, -100, -300, 2);
  const pb = await screenOf(page, -100, -330);
  await page.mouse.dblclick(pb.x, pb.y);
  await settle(page);
  expect((await state(page)).cards.b!.tapped).toBe(true);
  expect(await actions(page)).toContainEqual({ type: 'tap', card: 'b', tapped: true });
  // The bottom card's exposed strip (above b's top edge).
  const pa = await screenOf(page, -100, -262);
  expect(await harness(page, 'cardAt', pa.x, pa.y)).toBe('a');
  await page.mouse.dblclick(pa.x, pa.y);
  await settle(page);
  expect((await harness(page, 'events')) as { type: string; args: unknown[] }[]).toContainEqual({ type: 'pileOpen', args: ['L'] });
  expect((await state(page)).cards.a!.tapped).toBe(false);
});

test('dispose releases the WebGL context and the scene\'s debug parts', async ({ page }) => {
  await openScene(page);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-scene="table"]') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    window.__sceneHarness!.dispose();
    const hook = window.__spellplane as Record<string, unknown>;
    return { lost: gl.isContextLost(), attached: canvas.isConnected, cards: 'cards' in hook, camera: 'camera' in hook, state: 'state' in hook };
  });
  expect(result).toEqual({ lost: true, attached: false, cards: false, camera: false, state: true });
});
