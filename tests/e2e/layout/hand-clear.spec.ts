/**
 * Nothing of the HUD lies over a hand card (visual.md 2.9 board 7: the own plate bottom left, talk and the primary
 * bottom right, the hand fan centred between them; gate M8 finding F17). Read through the debug hook
 * (`window.__spellplane.hud.layout()`, ui/hud/debug.ts), never from pixels: every shown piece of chrome against every
 * resting hand card, at 1280 × 800 and 1440 × 900, on a computer table and on a private two-player table (the one with
 * Talk and the evening's proposals).
 */
import { expect, test, type Page } from '@playwright/test';
import type { HudLayoutDebug, HudRect } from '../../../src/ui/hud/debug';
import { shot } from '../helpers/app';
import { atTable, freshProfile, hands, openSite, pages, privateTable, readyWith, sameHash, seedDeck, soloOpponent } from '../helpers/journey';
import { settleAnimations } from '../helpers/design-audit';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const overlap = (a: HudRect, b: HudRect): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const fmt = (r: HudRect): string => `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`;

/** Every chrome rect that intersects a resting hand card, as readable lines (empty: the bottom row is clear). */
async function collisions(page: Page): Promise<{ hand: number; hits: string[] }> {
  const l = await page.evaluate(() => window.__spellplane!.hud!.layout() as unknown as HudLayoutDebug);
  const hits: string[] = [];
  for (const c of l.chrome) for (const h of l.hand) if (!h.raised && overlap(c.rect, h.rect)) hits.push(`${c.name} [${fmt(c.rect)}] over hand card ${h.card} [${fmt(h.rect)}]`);
  // The resting fan stays inside the window, too.
  for (const h of l.hand) if (!h.raised && (h.rect.left < 0 || h.rect.right > l.viewport.width + 0.5)) hits.push(`hand card ${h.card} [${fmt(h.rect)}] outside the window`);
  return { hand: l.hand.length, hits };
}

/** At each size: the pointer off the fan, the screen settled, then no collision. */
async function checkSizes(page: Page, name: string, project: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.mouse.move(size.width / 2, 120);
    await settleAnimations(page, 3_000);
    await expect.poll(async () => (await collisions(page)).hand, { message: 'seven hand cards in the fan' }).toBe(7);
    await expect.poll(async () => (await collisions(page)).hits, { message: `HUD over a hand card at ${size.width} × ${size.height}` }).toEqual([]);
    await shot(page, 'M8', `layout-${name}-${size.width}`, project);
  }
}

test('a computer table: no HUD element over a hand card at 1280 × 800 and 1440 × 900', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SIZES[0]);
  await openSite(page, freshProfile(info, 'hc'));
  await seedDeck(page, 'gw-m19-60.txt');
  await soloOpponent(page, 'SPARRING');
  await page.getByTestId('home-primary').click();
  await atTable(page, 'computer');
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
  await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
  await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.hand.length ?? -1), { timeout: 30_000 }).toBe(7);
  await expect(page.getByTestId('primary-action')).toBeVisible();
  await checkSizes(page, 'computer', info.project.name);
});

test('a private table with Talk: no HUD element over a hand card, and no evening bar in the match', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const { context, list } = await pages(browser, 2);
  const [a, b] = list as [Page, Page];
  try {
    await a.clock.install();
    await privateTable(a, b, { a: freshProfile(info, 'ha'), b: freshProfile(info, 'hb') });
    await readyWith(b, 'ur-m19-60.mtga.txt');
    await readyWith(a, 'gw-m19-60.txt');
    await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
    await a.clock.runFor(3_100);
    for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 20_000 });
    await expect.poll(() => hands(b, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
    await sameHash([a, b]);
    await expect(b.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
    // One Talk control (the round button) instead of the voice row; the evening's proposals live in the Menu.
    await expect(b.getByTestId('talk-indicator').locator('button')).toHaveCount(1);
    await expect(b.getByTestId('evening-bar')).toHaveCount(0);
    await b.getByTestId('open-menu').click();
    const thisGame = b.locator('[data-testid="menu-popover"] [data-group="top:this-game"]');
    await expect(thisGame.getByTestId('propose-nextGame')).toBeVisible();
    await b.keyboard.press('Escape');
    await checkSizes(b, 'private', info.project.name);
  } finally {
    await context.close();
  }
});
