// The HUD's table tools stay reachable (DESIGN "Camera and navigation", Screen-anchored layer): every toolbar button is
// the topmost element at its centre, never under the turn strip centred above the table (the View button of M4-P1
// made the row long enough to slide the theme button under the strip at 1440 px).
import { expect, test } from '@playwright/test';
import { freshProfile, openSolo } from '../solo/helpers';

for (const width of [1440, 1280, 1920]) {
  test(`every table tool is clickable at ${width} px: none lies under the turn strip`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await openSolo(page, freshProfile(info));
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('open-theme-settings')).toBeVisible();
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('nav.toolbar button')]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !(top && (top === b || b.contains(top)));
        })
        .map((b) => b.textContent?.trim() || b.getAttribute('aria-label') || '?'),
    );
    expect(covered).toEqual([]);
    await page.getByTestId('open-theme-settings').click();
    await expect(page.getByTestId('theme-settings')).toBeVisible();
  });
}
