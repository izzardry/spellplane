/**
 * Foils on the draft table (DESIGN "Pre-game: draft, sealed and deck building", Pack generation: "Foils are marked with
 * a subtle sheen and a badge"; hard rule: card faces are never recoloured, cropped or distorted). The sheen is a rim
 * outside the face; the badge sits in the gutter beside the card's top strip, so it covers no card, also in the pool's
 * cascade.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { CardData } from '../../../src/data/types';
import { poolColumnOf } from '../../../src/scene/draft';
import { clickCard, dh, openDraft, settled } from './bundle';

const DATA = new Map((JSON.parse(fs.readFileSync('tests/fixtures/scryfall/m19.json', 'utf8')) as CardData[]).map((c) => [c.id, c]));

const packCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pack');
const poolCards = async (page: Page) => (await dh(page, 'cards')).filter((c) => c.area === 'pool');

async function badges(page: Page): Promise<{ card: string; rect: { x: number; y: number; right: number; bottom: number } }[]> {
  return page.getByTestId('draft-foil').evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).style.display !== 'none')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { card: (e as HTMLElement).dataset.card!, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom } };
      }),
  );
}

test('foils carry a sheen and a badge; the badge covers no card in the pack or in a pool cascade', async ({ page }) => {
  // Every card foil; Anna takes cards of one colour column where she can, so her picks cascade in the pool.
  await openDraft(page, { format: 'pass', seats: 'Anna,Ben', packSize: 8, foil: 1 });
  await settled(page);
  const pack = await packCards(page);
  expect(pack.every((c) => c.foil && c.sheen)).toBe(true);
  expect((await badges(page)).map((b) => b.card).sort()).toEqual(pack.map((c) => c.id).sort());

  // A marked foil shows the selection outline instead of the sheen.
  await clickCard(page, pack[0]!.id);
  await expect.poll(async () => (await packCards(page)).find((c) => c.id === pack[0]!.id)?.sheen).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dh(page, 'view'))!.marked).toEqual([]);
  await settled(page);

  let want: string | null = null;
  for (let i = 0; i < 6; i++) {
    const offered = await packCards(page);
    const col = (id: string) => poolColumnOf(DATA.get(offered.find((x) => x.id === id)!.ref.sid) ?? null);
    const c = offered.find((x) => want !== null && col(x.id) === want) ?? offered[0];
    want ??= col(c!.id);
    await clickCard(page, c!.id);
    await settled(page);
    await clickCard(page, c!.id);
    await expect.poll(async () => (await dh(page, 'picks')).filter((p) => p.seat === 's0').length).toBe(i + 1);
    expect(await dh(page, 'autoPick', 's1')).toBe(true);
    await settled(page);
  }
  const pool = await poolCards(page);
  expect(pool).toHaveLength(6);
  expect(pool.every((c) => c.sheen)).toBe(true);
  const shown = await badges(page);
  const cards = [...pool, ...(await packCards(page))];
  expect(shown.map((b) => b.card).sort()).toEqual(cards.map((c) => c.id).sort());
  // The pool has a column with more than one card: the badges of its upper cards sit beside their visible strips.
  const columns = new Map<string, number>();
  for (const c of pool) columns.set(c.column!, (columns.get(c.column!) ?? 0) + 1);
  expect(Math.max(...columns.values())).toBeGreaterThan(1);
  for (const b of shown.filter((x) => x.card.startsWith('pool:'))) {
    for (const c of pool) {
      const s = c.screen;
      const hit = b.rect.x < s.right - 0.5 && s.x + 0.5 < b.rect.right && b.rect.y < s.bottom - 0.5 && s.y + 0.5 < b.rect.bottom;
      expect(hit, `badge of ${b.card} over ${c.id}`).toBe(false);
    }
  }
});
