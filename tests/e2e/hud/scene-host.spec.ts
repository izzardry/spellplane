/**
 * M8 integration of M7-P1: the scene host is positioned inline. The table scene and the presence layer read the host's
 * computed position when they attach and make a static host relative; in WebKit that ran before the HUD's stylesheet
 * applied, left the host relative and 0 px high, and put the harness cards under the top bar's plates.
 */
import { expect, test, type Page } from '@playwright/test';
import { openHud } from '../ui/harness';
import { soloWithDeck } from './helpers';

const host = (page: Page) =>
  page.getByTestId('scene-host').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { inline: (el as HTMLElement).style.position, computed: getComputedStyle(el).position, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
  });

test('on the HUD harness the scene host is absolute inline and fills the HUD', async ({ page }) => {
  await openHud(page);
  const h = await host(page);
  expect(h).toMatchObject({ inline: 'absolute', computed: 'absolute', width: h.vw, height: h.vh });
});

test('on the solo table the scene host stays absolute once the scene and presence attached', async ({ page }, info) => {
  await soloWithDeck(page, info);
  const h = await host(page);
  expect(h).toMatchObject({ inline: 'absolute', computed: 'absolute' });
  expect(h.height).toBeGreaterThan(h.vh / 2);
});
