/**
 * PLAN M4-P2 acceptance: "The average colour of a rendered card face differs from the source texture by less than 3%
 * in every lit theme (the Scryfall no-recolour rule)". DESIGN "Themes and rendering": card faces are never restyled;
 * lit themes render faces with a near-unlit material, the table and sleeves receive light and shadow.
 *
 * Controlled render: one known placeholder face on an empty table, zoomed so it fills most of the viewport (centre)
 * and then pushed into the top-left corner, where the vignette is darkest and the bloom of the lit table is strongest.
 * The face's average colour on screen (from a screenshot) is compared with the placeholder drawn on a 2D canvas.
 * Every theme is measured, plus the test-only lit theme that turns on every pipeline feature at its strongest.
 */
import { expect, test, type Page } from '@playwright/test';
import { ALL_THEMES, colourDelta, openRender, rh, screenAverage, settle } from './helpers';

type Rect = { x: number; y: number; width: number; height: number };
type Card = { id: string; screen: Rect; tier: string | null };

const SID = 'fx-7';
const INSET = 0.12;

async function probe(page: Page): Promise<Card> {
  const cards = await rh<Card[]>(page, 'cards');
  return cards.find((c) => c.id === 'probe')!;
}

for (const theme of ALL_THEMES) {
  test(`card face keeps its printed colours within 3% in ${theme} (centre and vignetted corner)`, async ({ page }) => {
    const errors = await openRender(page, { theme, scenario: 'empty' });
    await page.evaluate((sid) => window.__renderHarness!.addCard('probe', sid, { x: 0, y: -260, rot: 0 }), SID);
    await page.evaluate(() => window.__renderHarness!.camera.zoomTo('probe'));
    await settle(page);
    await expect.poll(async () => (await probe(page)).tier).toBe('large');
    await settle(page);

    const source = await rh<[number, number, number]>(page, 'sourceAverage', SID, INSET);
    const centre = await probe(page);
    const vp = page.viewportSize()!;
    // Most of the viewport height (DESIGN zoom range: one card at 80% of the viewport height).
    expect(centre.screen.height).toBeGreaterThan(vp.height * 0.6);
    const atCentre = await screenAverage(page, centre.screen, INSET);
    expect(colourDelta(atCentre, source), `centre ${atCentre.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);

    // Half the size, pushed into the top-left corner.
    await page.evaluate(([w, h]) => window.__renderHarness!.camera.zoomAt(w! / 2, h! / 2, 0.5), [vp.width, vp.height] as const);
    await settle(page);
    const half = await probe(page);
    await page.evaluate(([dx, dy]) => window.__renderHarness!.camera.panBy(dx!, dy!), [6 - half.screen.x, 6 - half.screen.y] as const);
    await settle(page);
    const corner = await probe(page);
    expect(corner.screen.x).toBeLessThan(20);
    expect(corner.screen.y).toBeLessThan(20);
    const atCorner = await screenAverage(page, corner.screen, INSET);
    expect(colourDelta(atCorner, source), `corner ${atCorner.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);
    expect(errors).toEqual([]);
  });
}

test('the lit test theme really runs the whole pipeline while the face is measured', async ({ page }) => {
  await openRender(page, { theme: 'lit', scenario: 'empty' });
  await page.evaluate((sid) => window.__renderHarness!.addCard('probe', sid, { x: 0, y: -260, rot: 0 }), SID);
  await settle(page);
  const stats = await rh<{ passes: string[]; shadows: boolean }>(page, 'stats');
  expect(stats.passes).toEqual(['render', 'glow', 'bloom', 'test-copy', 'vignette', 'output']);
  expect(stats.shadows).toBe(true);
  const p = await rh<{ boxes: boolean; contactShadows: boolean; faceShade: number; toneMapping: number }>(page, 'pipeline');
  expect(p.boxes).toBe(true);
  expect(p.contactShadows).toBe(true);
  // The largest shade the contract allows (themes/types.ts CARD_FACE_MAX_SHADE) and a tone mapping that would shift colours.
  expect(p.faceShade).toBe(0.03);
  expect(p.toneMapping).not.toBe(0);

  // The pipeline does change the world: the lit, tone-mapped table is not the theme's flat surface colour, and the
  // vignette darkens the table toward the corners.
  const vp = page.viewportSize()!;
  const patch = (x: number, y: number) => ({ x, y, width: 40, height: 40 });
  const mid = await screenAverage(page, patch(vp.width / 2 - 20, vp.height / 2 - 20), 0);
  const edge = await screenAverage(page, patch(vp.width * 0.27, vp.height / 2 - 20), 0);
  expect(mid.reduce((a, b) => a + b)).toBeGreaterThan(edge.reduce((a, b) => a + b));
});
