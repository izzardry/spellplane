/**
 * The build stage after the sweep (contracts.md Part G "Visual" 4: "M8-P3 the build stage", kit classes and heights,
 * no restructuring; PLAN M8-P3: the design audit passes on the build stage harness). The builder's own page (M2-P5's
 * bundle) carries no app stylesheet, so the spec adds the kit's base.css and the Plain look's variables, as the app
 * does. The list rows (whole-row buttons of the M2 list view) are rows, not controls, and are left to the restyle.
 */
import { expect, test } from '@playwright/test';
import { designCssVars, lookTokens } from '../../../src/ui/design/tokens';
import { openBuilder } from '../builder/bundle';
import { deckAudit } from './audit';

for (const view of ['table', 'list'] as const) {
  test(`the build stage passes the design audit (${view} view)`, async ({ page }) => {
    await openBuilder(page, { pool: 'sealed', view });
    await page.addStyleTag({ path: 'src/ui/design/base.css' });
    await page.evaluate((vars) => {
      for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    }, designCssVars(lookTokens('plain')));
    await expect(page.getByTestId('builder-bar')).toBeVisible();
    await expect(page.getByTestId('dispenser-add').first()).toBeVisible();
    if (view === 'list') await expect(page.getByTestId('list-filter-text')).toBeVisible();
    // The swept controls are the kit's: 28 or 36 px.
    expect(await page.getByTestId('builder-ready').evaluate((b) => b.getBoundingClientRect().height)).toBe(36);
    expect(await page.getByTestId('dispenser-add').first().evaluate((b) => b.getBoundingClientRect().height)).toBe(28);
    expect(await deckAudit(page, ['[data-testid="builder-list-host"] .main'])).toEqual([]);
  });
}
