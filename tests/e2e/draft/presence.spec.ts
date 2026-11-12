/**
 * Cursors on the shared draft table (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction:
 * "Rochester picks happen on the shared table with cursors and voice, since table talk is the point"; "Players, seats
 * and formats", Other players' cursors: "each player's pointer … shown live in their seat colour"). Over a Rochester
 * pack or the Grid the others' cursors are drawn and this browser's is reported; over a pack passed in private or a
 * Winston pile nothing is reported, so not even a pointer's position hints at hidden cards (CLAUDE.md: hidden
 * information never leaves its owner's browser; the shared leak scan runs over everything sent).
 */
import { expect, test, type Page } from '@playwright/test';
import { scan } from '../../leak/scan';
import { clickCard, dh, openDraft, settled } from './bundle';

const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');
const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test.describe('cursors on the draft table', () => {
  test('Rochester: the other seat’s cursor shows over the shared pack, and this seat’s cursor is reported', async ({ page }) => {
    await openDraft(page, { format: 'rochester', seats: 'Anna,Ben', packSize: 4, packs: 1 });
    await settled(page);
    expect(await dh(page, 'presenceListening')).toEqual(['s0']);
    const [a, b] = await packCards(page);

    // Ben points at card a: his cursor is drawn at that card, labelled with his name.
    await dh(page, 'presenceAs', 's1', { x: a!.pose.x, y: a!.pose.y }, a!.id);
    await expect.poll(async () => (await dh(page, 'presenceDrawn')).map((s) => [s.seat, s.label])).toEqual([['s1', 'Ben']]);
    const drawn = (await dh(page, 'presenceDrawn'))[0]!;
    const at = (await dh(page, 'toScreen', { x: a!.pose.x, y: a!.pose.y }))!;
    expect(drawn.cursor!.x).toBeCloseTo(at.x, 0);
    expect(drawn.cursor!.y).toBeCloseTo(at.y, 0);
    expect(drawn.cursor!.x).toBeGreaterThan(a!.screen.x);
    expect(drawn.cursor!.x).toBeLessThan(a!.screen.x + a!.screen.width);

    // Anna's pointer over card b is reported in table millimetres, naming the shared card under it.
    const p = centre(b!.screen);
    await page.mouse.move(p.x - 5, p.y - 5);
    await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await dh(page, 'presenceSent')).at(-1)?.over).toBe(b!.id);
    const sent = (await dh(page, 'presenceSent')).at(-1)!;
    expect(Math.abs(sent.cursor!.x - b!.pose.x)).toBeLessThan(2);
    expect(Math.abs(sent.cursor!.y - b!.pose.y)).toBeLessThan(2);

    // Ben's cursor follows him off the table.
    await dh(page, 'presenceAs', 's1', null);
    await expect.poll(async () => (await dh(page, 'presenceDrawn')).length).toBe(0);
  });

  test('Rochester: cursors stop when the shared pack is gone; the own pool is never named', async ({ page }) => {
    await openDraft(page, { format: 'rochester', seats: 'Anna,Ben', packSize: 4, packs: 1 });
    await settled(page);
    const [a] = await packCards(page);
    await clickCard(page, a!.id);
    await settled(page);
    await clickCard(page, a!.id);
    await settled(page);
    // Over the own pool card the cursor goes out, but names no card.
    const pool = (await dh(page, 'cards')).find((c) => c.area === 'pool')!;
    const p = centre(pool.screen);
    await page.mouse.move(p.x - 5, p.y - 5);
    await page.mouse.move(p.x, p.y);
    await expect.poll(async () => Math.abs(((await dh(page, 'presenceSent')).at(-1)?.cursor?.y ?? Infinity) - pool.pose.y)).toBeLessThan(2);
    expect((await dh(page, 'presenceSent')).at(-1)!.over).toBeNull();
    expect((await dh(page, 'presenceSent')).every((m) => !m.over?.startsWith('pool:'))).toBe(true);

    // The rest of the draft (Ben's pack follows Anna's): once it is done no shared pack is left and the cursor is
    // withdrawn.
    for (let i = 0; i < 20 && !(await dh(page, 'state')).draft?.done; i++) {
      const waiting = (await dh(page, 'view'))!.waitingOn;
      expect(await dh(page, 'autoPick', waiting[0]!)).toBe(true);
    }
    await expect.poll(async () => (await dh(page, 'state')).draft?.done ?? false).toBe(true);
    await expect.poll(() => dh(page, 'presenceListening')).toEqual([]);
    expect((await dh(page, 'presenceSent')).at(-1)).toMatchObject({ cursor: null, over: null });
    const count = (await dh(page, 'presenceSent')).length;
    await page.mouse.move(p.x + 20, p.y + 20);
    await page.mouse.move(p.x + 40, p.y + 40);
    expect(await dh(page, 'presenceSent')).toHaveLength(count);
  });

  test('Grid: the 3×3 lies on the shared table, so cursors are shared over it', async ({ page }) => {
    await openDraft(page, { format: 'grid', seats: 'Anna,Ben', grids: 1 });
    await settled(page);
    expect(await dh(page, 'presenceListening')).toEqual(['s0']);
    const [g] = await packCards(page);
    const p = centre(g!.screen);
    await page.mouse.move(p.x - 5, p.y - 5);
    await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await dh(page, 'presenceSent')).at(-1)?.over).toBe(g!.id);
  });

  for (const format of ['pass', 'winston'] as const) {
    test(`${format === 'pass' ? 'a booster pack' : 'a Winston pile'}: no cursor is sent and none is drawn`, async ({ page }) => {
      await openDraft(page, { format, seats: 'Anna,Ben', packSize: 6, packs: 1 });
      await settled(page);
      expect(await dh(page, 'presenceListening')).toEqual([]);
      const cards = await packCards(page);
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) {
        const p = centre(c.screen);
        await page.mouse.move(p.x - 3, p.y - 3);
        await page.mouse.move(p.x, p.y);
      }
      await clickCard(page, cards[0]!.id);
      // The other seat's pointer is not drawn either.
      await dh(page, 'presenceAs', 's1', { x: cards[0]!.pose.x, y: cards[0]!.pose.y });
      await page.waitForTimeout(100);
      expect(await dh(page, 'presenceDrawn')).toEqual([]);
      const sent = await dh(page, 'presenceSent');
      expect(sent).toEqual([]);
      // The shared leak scan over everything this seat sent: no private card id or identity.
      expect(scan(sent, cards.flatMap((c) => [c.id, c.ref.sid]))).toEqual([]);
    });
  }
});
