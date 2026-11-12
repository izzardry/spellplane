/**
 * PLAN M2-P4 acceptance: a pick is marked then confirmed (DESIGN "Pre-game: draft, sealed and deck building", Drafting
 * interaction: "The current pack is a fan or grid on the player's private table. Click a card to mark it, click again or
 * press Enter to confirm. Picks fly to the player's pool area, which auto-sorts by colour and stays visible while
 * drafting"; Pick-Two takes two per pass; "Specification: card data, packs and draft formats", pick timer). The real
 * draft surface (scene/draft.ts) draws placeholder faces; card data comes from tests/fixtures.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { CardData } from '../../../src/data/types';
import { poolColumnOf, POOL_COLUMNS } from '../../../src/scene/draft';
import { clickCard, dh, openDraft, settled } from './bundle';

const DATA = new Map((JSON.parse(fs.readFileSync('tests/fixtures/scryfall/m19.json', 'utf8')) as CardData[]).map((c) => [c.id, c]));
const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');
const poolCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pool');
const calls = async (page: Page) => (await dh(page, 'calls')).map((c) => [c.method, ...c.args]);

test.describe('marking and confirming a pick', () => {
  test('a pick is marked then confirmed', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben,Cleo' });
    await settled(page);
    const pack = await packCards(page);
    expect(pack).toHaveLength(15);
    expect(pack.every((c) => c.visible && !c.marked)).toBe(true);
    expect(await poolCards(page)).toHaveLength(0);
    await expect(page.getByTestId('draft-pack-label')).toHaveText('Your pack · 15 cards');
    await expect(page.getByTestId('draft-confirm')).toBeDisabled();
    await expect(page.getByTestId('draft-prompt')).toHaveText('Click a card to mark it, click again or press Enter to confirm.');

    // First click marks; nothing is taken yet.
    const a = pack[3]!;
    const b = pack[9]!;
    await clickCard(page, a.id);
    expect(await calls(page)).toEqual([['mark', [a.id]]]);
    await expect.poll(async () => (await packCards(page)).find((c) => c.id === a.id)?.marked).toBe(true);
    expect((await dh(page, 'view'))!.marked).toEqual([a.id]);
    expect(await dh(page, 'picks')).toEqual([]);
    await expect(page.getByTestId('draft-confirm')).toBeEnabled();
    await expect(page.getByTestId('draft-prompt')).toHaveText('Click the marked card again or press Enter to take it.');

    // A click on another card moves the mark.
    await settled(page);
    await clickCard(page, b.id);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([b.id]);
    expect(await dh(page, 'picks')).toEqual([]);

    // A second click on the marked card confirms it: it leaves the pack and flies to the pool.
    await settled(page);
    await clickCard(page, b.id);
    expect(await calls(page)).toEqual([
      ['mark', [a.id]],
      ['mark', [b.id]],
      ['pick', [b.id]],
    ]);
    expect(await dh(page, 'picks')).toEqual([{ seat: 's0', packId: expect.any(String), cards: [b.id] }]);
    const pool = await poolCards(page);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ id: 'pool:0', ref: b.ref, column: poolColumnOf(DATA.get(b.ref.sid) ?? null) });
    await settled(page);
    const landed = (await poolCards(page))[0]!;
    // The pool lies below the pack area and stays visible.
    expect(landed.visible).toBe(true);
    expect(landed.screen.y).toBeGreaterThan(Math.max(...pack.map((c) => c.screen.bottom)));
    expect(await packCards(page)).toHaveLength(0);
    await expect(page.getByTestId('draft-pack-empty')).toHaveText('Waiting for a pack');
    await expect(page.getByTestId('draft-pool-label')).toHaveText('Pool · 1');
  });

  test('Enter confirms the marked card, Escape clears the marks, the Take button confirms too', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben', packSize: 6 });
    await settled(page);
    let pack = await packCards(page);
    const firstPick = pack[2]!.id;
    await clickCard(page, pack[0]!.id);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([pack[0]!.id]);
    // Enter with nothing marked does nothing; Escape clears.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([]);
    await page.keyboard.press('Enter');
    expect(await dh(page, 'picks')).toEqual([]);
    await clickCard(page, pack[2]!.id);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([pack[2]!.id]);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await dh(page, 'picks')).map((p) => p.cards)).toEqual([[pack[2]!.id]]);

    // Ben picks and passes his pack to Anna (two seats: left is Ben, Ben's left is Anna).
    expect(await dh(page, 'autoPick', 's1')).toBe(true);
    await settled(page);
    pack = await packCards(page);
    expect(pack).toHaveLength(5);
    await expect(page.getByTestId('draft-step')).toHaveText('Pick 2');
    await clickCard(page, pack[4]!.id);
    await expect(page.getByTestId('draft-confirm')).toBeEnabled();
    await page.getByTestId('draft-confirm').click();
    await expect.poll(async () => (await dh(page, 'picks')).filter((p) => p.seat === 's0').map((p) => p.cards)).toEqual([[firstPick], [pack[4]!.id]]);
    expect(await poolCards(page)).toHaveLength(2);
  });

  test('the keyboard alone marks and confirms: arrows move the mark, Enter takes it', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben', packSize: 5 });
    await settled(page);
    const pack = await packCards(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([pack[0]!.id]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([pack[1]!.id]);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await dh(page, 'picks')).map((p) => p.cards)).toEqual([[pack[1]!.id]]);
  });

  test('Pick-Two: two cards are marked, a third replaces the oldest, one confirm takes both', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben,Cleo,Dan', picks: 2 });
    await settled(page);
    await expect(page.getByTestId('draft-title')).toHaveText('Pick-Two draft · pack 1 of 3 · passing left');
    const [a, b, c] = await packCards(page);
    await clickCard(page, a!.id);
    await clickCard(page, b!.id);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([a!.id, b!.id]);
    await expect(page.getByTestId('draft-confirm')).toHaveText('Take 2');
    await clickCard(page, c!.id);
    await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([b!.id, c!.id]);
    await settled(page);
    await clickCard(page, c!.id);
    await expect.poll(async () => (await dh(page, 'picks')).map((p) => p.cards)).toEqual([[b!.id, c!.id]]);
    expect(await poolCards(page)).toHaveLength(2);
  });

  test('picks sort into colour columns in the pool', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben', packSize: 15 });
    await settled(page);
    // Take the first card of every pack Anna sees for six picks; Ben picks in between.
    for (let i = 0; i < 6; i++) {
      const pack = await packCards(page);
      // Spread over colours: the fixture's packs run in collector order, so take from the far end too.
      const card = i % 2 ? pack[pack.length - 1]! : pack[0]!;
      await clickCard(page, card.id);
      await settled(page);
      await clickCard(page, card.id);
      await expect.poll(async () => (await dh(page, 'picks')).filter((p) => p.seat === 's0').length).toBe(i + 1);
      expect(await dh(page, 'autoPick', 's1')).toBe(true);
      await settled(page);
    }
    const pool = await poolCards(page);
    expect(pool).toHaveLength(6);
    for (const c of pool) expect(c.column).toBe(poolColumnOf(DATA.get(c.ref.sid) ?? null));
    // Columns stand left to right in W U B R G, multicolour, colourless, land order.
    const byColumn = [...new Set(pool.map((c) => c.column!))].sort((x, y) => POOL_COLUMNS.indexOf(x) - POOL_COLUMNS.indexOf(y));
    const xs = byColumn.map((col) => pool.find((c) => c.column === col)!.screen.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(byColumn.length).toBeGreaterThan(1);
    const labels = await page.getByTestId('draft-pool-column').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.display !== 'none').map((e) => (e as HTMLElement).dataset.column));
    expect(labels.sort()).toEqual([...byColumn].sort());
  });

  test('the pick timer counts down from 45 s and the next pack starts at 42 s', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben', timer: 1, packSize: 4 });
    await settled(page);
    const timer = page.getByTestId('pick-timer');
    await expect(timer).toHaveText(/^0:4[2-5]$/);
    const first = Number(await timer.getAttribute('data-ms'));
    expect(first).toBeLessThanOrEqual(45_000);
    await expect.poll(async () => Number(await timer.getAttribute('data-ms'))).toBeLessThan(first);
    const [a] = await packCards(page);
    await clickCard(page, a!.id);
    await settled(page);
    await clickCard(page, a!.id);
    await expect(timer).toHaveCount(0);
    expect(await dh(page, 'autoPick', 's1')).toBe(true);
    await expect(timer).toHaveText(/^0:4[0-2]$/);
    expect(Number(await timer.getAttribute('data-ms'))).toBeLessThanOrEqual(42_000);
  });

  test('hold Space over a card to inspect it; release closes', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben' });
    await settled(page);
    const [a] = await packCards(page);
    await page.mouse.move(a!.screen.x + a!.screen.width / 2, a!.screen.y + a!.screen.height / 2);
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect')).toBeVisible();
    await expect(page.getByTestId('inspect-text')).toContainText(DATA.get(a!.ref.sid)!.name);
    await page.keyboard.up('Space');
    await expect(page.getByTestId('inspect')).toHaveCount(0);
    expect(await dh(page, 'picks')).toEqual([]);
  });
});
