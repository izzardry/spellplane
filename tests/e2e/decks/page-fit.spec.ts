/**
 * The deck page fits the window (visual.md board 3; gate M8 findings F7 and F8): at 1280 × 800 and 1440 × 900, in the
 * real app's shell, while cards are searched and added, nothing scrolls sideways (the document, the shell or any pane),
 * the document does not scroll down, so the shell's top bar and the page's top row stay on screen, and the top row is
 * one 44 px row whose strength shows once.
 */
import { expect, test, type Page } from '@playwright/test';
import { freshProfile, openSite } from '../helpers/journey';
import { settleAnimations } from '../helpers/design-audit';
import { shot } from '../helpers/app';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

/** Anything scrolled sideways or down, and every element whose box reaches past the window's right edge. */
async function overflow(page: Page): Promise<{ scrolled: string[]; wide: string[] }> {
  return page.evaluate(() => {
    const scrolled: string[] = [];
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${(el as HTMLElement).dataset?.testid ? `[${(el as HTMLElement).dataset.testid}]` : ''}.${[...el.classList].slice(0, 2).join('.')}`;
    const doc = document.scrollingElement!;
    if (doc.scrollLeft !== 0) scrolled.push(`document scrollLeft ${doc.scrollLeft}`);
    if (doc.scrollTop !== 0) scrolled.push(`document scrollTop ${doc.scrollTop}`);
    for (const el of document.querySelectorAll('*')) if (el.scrollLeft !== 0) scrolled.push(`${name(el)} scrollLeft ${el.scrollLeft}`);
    const wide: string[] = [];
    const w = window.innerWidth;
    for (const el of document.querySelectorAll('[data-testid="shell"] *')) {
      // Text for assistive tech only lives in a clipped 1 px box (its content may lay out wider, unseen).
      if (el.closest('.ds-sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 0.5 && getComputedStyle(el).position !== 'fixed') wide.push(`${name(el)} right ${Math.round(r.right)}`);
    }
    return { scrolled, wide: wide.slice(0, 12) };
  });
}

test('the deck page: no sideways or document scroll while cards are added; one header row, strength once', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize(SIZES[0]);
  await openSite(page, freshProfile(info, 'fit'), '/decks');
  await page.getByTestId('new-deck').first().click();
  await page.getByTestId('new-custom').click();
  await expect(page.getByTestId('card-search')).toBeVisible();
  for (const [query, name] of [
    ['elves', 'Llanowar Elves'],
    ['titanic', 'Titanic Growth'],
  ] as const) {
    await page.getByTestId('card-search').fill(query);
    const card = page.locator(`[data-testid="result-card"][data-name="${name}"]`);
    await expect(card).toBeVisible();
    for (let i = 0; i < 4; i++) await card.click();
  }
  const add = page.getByTestId('add-lands');
  if (await add.isVisible().catch(() => false)) await add.click();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.mouse.move(size.width / 2, size.height - 40);
    await settleAnimations(page, 2_000);
    await expect.poll(() => overflow(page), { message: `the deck page at ${size.width} × ${size.height}` }).toEqual({ scrolled: [], wide: [] });
    // The shell's top bar and the page's top row are in the window; the row is one row of the kit's height.
    for (const id of ['shell-nav', 'deck-back', 'deck-done', 'deck-name']) {
      const box = await page.getByTestId(id).first().boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${id} right`).toBeLessThanOrEqual(size.width);
    }
    const back = (await page.getByTestId('deck-back').boundingBox())!;
    const done = (await page.getByTestId('deck-done').boundingBox())!;
    expect(Math.abs(back.y + back.height / 2 - (done.y + done.height / 2)), 'back and DONE on one row').toBeLessThan(2);
    // The strength is said once: one band word in the header.
    const words = (await page.getByTestId('deck-page').locator('header').first().innerText()).match(/\b(rough|casual|solid|tuned|fierce)\b/gi) ?? [];
    expect(words.length, `band words in the header: ${words.join(', ')}`).toBeLessThanOrEqual(1);
    await shot(page, 'layout', `deck-page-${size.width}`, info.project.name);
  }
});
