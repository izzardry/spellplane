// M0-P3 acceptance tests (docs/PLAN.md, Milestone 0): through the debug hook, with real pointer input on the scene
// harness. Expected positions come from DESIGN "Specification: geometry, layout and motion" (card 63 x 88, gap 6,
// snap radius 12, cascade offset 14 toward the owner, drop resolution rules 1-5, zoom range).
import { expect, test } from '@playwright/test';
import { actions, addCard, card, cards, dist, drag, harness, openScene, screenOf, settle, state, tableOf, zoomTo } from './helpers';

test.describe('M0-P3 acceptance', () => {
  test('a drag ends at the snapped position within 0.5 mm', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
    await addCard(page, 'b', { x: -250, y: -300, rot: 0 });
    await zoomTo(page, -100, -300, 2.5);
    // Release b with its left edge 7 mm past a's right edge plus the 6 mm gap, and 4 mm high (rule 4).
    await drag(page, { x: -250, y: -300 }, { x: 76, y: -296 });
    await settle(page);
    const expected = { x: 63 + 6, y: -300 };
    expect(dist((await state(page)).cards.b!.pose, expected)).toBeLessThan(0.5);
    const shown = (await card(page, 'b'))!;
    expect(dist(shown.pose, expected)).toBeLessThan(0.5);
    expect(shown.pose.rot).toBe(0);
    expect(await harness(page, 'lastDrop')).toMatchObject({ rule: 4, kind: 'align', to: 'a' });
    expect(await actions(page)).toEqual([{ type: 'move', card: 'b', to: 'battlefield:s0', pose: expect.objectContaining({ rot: 0 }), pile: null }]);
  });

  test('dropping on a lower edge creates a cascade with 14 mm offsets', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: -250, rot: 0 });
    await addCard(page, 'b', { x: -250, y: -250, rot: 0 });
    await addCard(page, 'c', { x: 250, y: -250, rot: 0 });
    await zoomTo(page, 0, -300, 2);
    // b's top edge lands in a's lower third (a spans y -294..-206; b's top at -281), overlapping 58 mm.
    await drag(page, { x: -250, y: -250 }, { x: 5, y: -325 });
    await settle(page);
    // c's top edge in b's lower third.
    await drag(page, { x: 250, y: -250 }, { x: -4, y: -339 });
    await settle(page);
    const s = await state(page);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => s.cards[id]!);
    expect(a!.pile).toMatchObject({ kind: 'cascade', index: 0 });
    expect(b!.pile).toMatchObject({ id: a!.pile!.id, kind: 'cascade', index: 1 });
    expect(c!.pile).toMatchObject({ id: a!.pile!.id, kind: 'cascade', index: 2 });
    const shown = Object.fromEntries((await cards(page)).map((x) => [x.id, x.pose]));
    for (const [upper, lower] of [
      ['a', 'b'],
      ['b', 'c'],
    ] as const) {
      expect(Math.abs(shown[lower]!.x - shown[upper]!.x)).toBeLessThan(0.5);
      expect(Math.abs(shown[upper]!.y - shown[lower]!.y - 14)).toBeLessThan(0.5);
    }
    expect(dist(shown.c!, { x: 0, y: -278 })).toBeLessThan(0.5);
  });

  test('the far seat cascades toward its owner (+y)', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: 300, rot: 180 }, 'battlefield:s1');
    await addCard(page, 'b', { x: 250, y: 300, rot: 180 }, 'battlefield:s1');
    await zoomTo(page, 100, 330, 2);
    // From seat 1, "lower" is +y: b's lower-in-its-frame edge (its top on the canonical frame is at y - 44).
    await drag(page, { x: 250, y: 300 }, { x: -5, y: 375 });
    await settle(page);
    const s = await state(page);
    expect(s.cards.b!.pile).toMatchObject({ kind: 'cascade', index: 1 });
    expect(dist(s.cards.b!.pose, { x: 0, y: 314 })).toBeLessThan(0.5);
  });

  test('dropping squarely creates a squared pile', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
    await addCard(page, 'b', { x: -250, y: -300, rot: 0 });
    await addCard(page, 'c', { x: 250, y: -300, rot: 0 });
    await zoomTo(page, 0, -300, 2);
    await drag(page, { x: -250, y: -300 }, { x: 7, y: -295 });
    await settle(page);
    await drag(page, { x: 250, y: -300 }, { x: -4, y: -306 });
    await settle(page);
    const s = await state(page);
    const pile = s.cards.a!.pile!;
    expect(pile).toMatchObject({ kind: 'squared', index: 0 });
    expect(s.cards.b!.pile).toEqual({ id: pile.id, kind: 'squared', index: 1 });
    expect(s.cards.c!.pile).toEqual({ id: pile.id, kind: 'squared', index: 2 });
    for (const id of ['b', 'c']) {
      expect(dist(s.cards[id]!.pose, { x: 0, y: -300 })).toBeLessThan(0.5);
      expect(dist((await card(page, id))!.pose, { x: 0, y: -300 })).toBeLessThan(0.5);
    }
    // The pile's dispatched actions: the target joins first (index 0), then the dropped card; one group per gesture.
    const acts = await actions(page);
    expect(acts[0]).toMatchObject({ type: 'pile', card: 'a', pile: { index: 0, kind: 'squared' } });
    expect(acts[1]).toMatchObject({ type: 'move', card: 'b', pile: { index: 1, kind: 'squared' } });
    expect(acts[0]!.group).toBe(acts[1]!.group);
  });

  test('tap sets rotation to 90 degrees', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
    await addCard(page, 'f', { x: 0, y: 300, rot: 180 }, 'battlefield:s1');
    const p = await screenOf(page, 0, -300);
    await page.mouse.dblclick(p.x, p.y);
    await settle(page);
    // The state carries the flag (the stored pose keeps the seat rotation); the scene draws the 90° turn.
    expect((await state(page)).cards.a).toMatchObject({ tapped: true, pose: { rot: 0 } });
    expect((await card(page, 'a'))!.pose.rot).toBe(90);
    expect(await actions(page)).toContainEqual({ type: 'tap', card: 'a', tapped: true });
    // Double-click again untaps.
    await page.mouse.dblclick(p.x, p.y);
    await settle(page);
    expect((await card(page, 'a'))!.pose.rot).toBe(0);
    expect((await state(page)).cards.a!.tapped).toBe(false);
    // A card of the far seat (resting at 180) taps to 270.
    const q = await screenOf(page, 0, 300);
    await page.mouse.dblclick(q.x, q.y);
    await settle(page);
    expect((await card(page, 'f'))!.pose.rot).toBe(270);
    expect((await state(page)).cards.f).toMatchObject({ tapped: true, pose: { rot: 180 } });
  });

  test('a tapped card stays turned when dragged and its move carries the stored rotation', async ({ page }) => {
    await openScene(page);
    await addCard(page, 'a', { x: 0, y: -300, rot: 0 });
    const p = await screenOf(page, 0, -300);
    await page.mouse.dblclick(p.x, p.y);
    await settle(page);
    await drag(page, { x: 0, y: -300 }, { x: 200, y: -280 });
    await settle(page);
    const s = await state(page);
    expect(s.cards.a).toMatchObject({ tapped: true, pose: { rot: 0 } });
    expect(dist(s.cards.a!.pose, { x: 200, y: -280 })).toBeLessThan(1);
    const shown = (await card(page, 'a'))!;
    expect(shown.pose.rot).toBe(90);
    expect(dist(shown.pose, { x: 200, y: -280 })).toBeLessThan(1);
    expect((await actions(page)).at(-1)).toMatchObject({ type: 'move', card: 'a', pose: { rot: 0 } });
  });

  test('zooming keeps the world point under the cursor fixed within 1 px', async ({ page }) => {
    await openScene(page);
    const cursor = { x: 437, y: 611 };
    const p0 = await tableOf(page, cursor.x, cursor.y);
    // A card centred on that table point: its projected rectangle is an independent check of the camera.
    await addCard(page, 'probe', { x: p0.x, y: p0.y, rot: 0 });
    await page.mouse.move(cursor.x, cursor.y);
    const check = async () => {
      const s = (await harness(page, 'toScreen', p0.x, p0.y)) as { x: number; y: number };
      expect(dist(s, cursor)).toBeLessThan(1);
      const r = (await card(page, 'probe'))!.screen;
      expect(dist({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, cursor)).toBeLessThan(1);
    };
    const before = (await harness(page, 'cards')) as { screen: { height: number } }[];
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -100);
      await check();
    }
    const after = (await card(page, 'probe'))!.screen.height;
    expect(after).toBeGreaterThan(before[0]!.screen.height * 1.5);
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 100);
      await check();
    }
  });

  test('300 cards render in at most 12 draw calls', async ({ page }) => {
    await openScene(page, { scenario: 'bench' });
    const all = await cards(page);
    expect(all.length).toBeGreaterThanOrEqual(300);
    expect(all.filter((c) => c.visible).length).toBeGreaterThanOrEqual(300);
    expect(all.every((c) => c.tier !== null)).toBe(true);
    const stats = (await page.evaluate(() => window.__spellplane!.frameStats!())) as { drawCalls: number; textureBytes: number };
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.drawCalls).toBeLessThanOrEqual(12);
    expect(stats.textureBytes).toBeGreaterThan(0);
    // Still at most 12 when zoomed in, where bigger texture tiers stream in.
    const s = await screenOf(page, 0, -300);
    await page.evaluate(([x, y]) => window.__sceneHarness!.camera.zoomAt(x!, y!, 6), [s.x, s.y] as const);
    await expect.poll(async () => (await cards(page)).filter((c) => c.visible && c.tier === 'normal').length, { timeout: 20_000 }).toBeGreaterThan(0);
    const zoomed = (await page.evaluate(() => window.__spellplane!.frameStats!())) as { drawCalls: number };
    expect(zoomed.drawCalls).toBeLessThanOrEqual(12);
  });
});
