/**
 * PLAN M2-P4 acceptance: the waiting indicator shows queue counts (DESIGN "Pre-game: draft, sealed and deck building",
 * Drafting interaction: "Waiting packs queue visibly behind each seat so everyone sees who is holding things up";
 * "Specification: card data, packs and draft formats": packs queue at the receiver, direction left in the first round).
 * Each seat's count shows twice: in the HUD's seat strip and as a pile of backs on the draft table.
 */
import { expect, test, type Page } from '@playwright/test';
import { clickCard, dh, openDraft, settled } from './bundle';

/** Counts per seat as the seat strip, the table labels and the drawn piles show them, and as shared state holds them. */
async function shown(page: Page) {
  const strip = await page.getByTestId('draft-seat').evaluateAll((els) => Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.seat!, Number((e as HTMLElement).dataset.packs)])));
  const labels = await page.getByTestId('draft-queue').evaluateAll((els) => Object.fromEntries(els.filter((e) => (e as HTMLElement).style.display !== 'none').map((e) => [(e as HTMLElement).dataset.seat!, Number(e.querySelector('[data-testid="draft-queue-count"]')!.textContent)])));
  const piles = Object.fromEntries((await dh(page, 'queues')).map((q) => [q.seat, q.drawn]));
  const queues = (await dh(page, 'state')).draft!.queues;
  const held = Object.fromEntries(Object.entries(queues).map(([s, q]) => [s, q.length]));
  return { strip, labels, piles, held };
}

async function expectCounts(page: Page, counts: Record<string, number>) {
  await expect.poll(() => shown(page)).toEqual({ strip: counts, labels: counts, piles: counts, held: counts });
}

const picking = (page: Page) => page.getByTestId('draft-seat').evaluateAll((els) => els.filter((e) => (e as HTMLElement).dataset.picking === 'true').map((e) => (e as HTMLElement).dataset.seat));

test('the waiting indicator shows queue counts', async ({ page }) => {
  await openDraft(page, { format: 'pass', seats: 'Anna,Ben,Cleo', packSize: 5 });
  await settled(page);
  await expectCounts(page, { s0: 1, s1: 1, s2: 1 });
  expect(await picking(page)).toEqual(['s0', 's1', 's2']);

  // Anna picks: her pack passes left to Ben, who now has two waiting; Anna waits.
  const [a] = (await dh(page, 'cards')).filter((c) => c.area === 'pack');
  await clickCard(page, a!.id);
  await settled(page);
  await clickCard(page, a!.id);
  await expectCounts(page, { s0: 0, s1: 2, s2: 1 });
  expect(await picking(page)).toEqual(['s1', 's2']);
  await expect(page.getByTestId('draft-prompt')).toHaveText('Waiting for a pack: Ben and Cleo are picking.');
  await expect(page.locator('[data-testid="draft-seat"][data-seat="s1"]')).toHaveAttribute('title', 'Ben: 2 packs waiting, 0 cards drafted');

  // Ben picks one: his front pack moves on to Cleo.
  expect(await dh(page, 'autoPick', 's1')).toBe(true);
  await expectCounts(page, { s0: 0, s1: 1, s2: 2 });

  // Cleo picks twice: both go to Anna, who has packs again.
  expect(await dh(page, 'autoPick', 's2')).toBe(true);
  expect(await dh(page, 'autoPick', 's2')).toBe(true);
  await expectCounts(page, { s0: 2, s1: 1, s2: 0 });
  expect(await picking(page)).toEqual(['s0', 's1']);
  await settled(page);
  expect((await dh(page, 'cards')).filter((c) => c.area === 'pack')).toHaveLength(4);
  await expect(page.getByTestId('draft-prompt')).toHaveText('Click a card to mark it, click again or press Enter to confirm.');
  await expect(page.locator('[data-testid="draft-seat"][data-seat="s0"]')).toHaveAttribute('title', 'You: 2 packs waiting, 1 card drafted');
});
