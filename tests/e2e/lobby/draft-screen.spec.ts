/**
 * The draft screens after the M8-P4 sweep (PLAN Milestone 8, "M8-P4" acceptance: designAudit and axe on the draft
 * screen; contracts.md Part G "Visual" item 4: kit classes and heights only, no restructuring): the draft HUD's
 * line of buttons and the lobby's draft settings panel, on the draft module's own harness page (tests/e2e/draft).
 */
import { expect, test } from '@playwright/test';
import { seriousViolations } from '../a11y/helpers';
import { openDraft, settled } from '../draft/bundle';
import { designAudit } from '../helpers/design-audit';

test.describe('draft screens on the kit (M8-P4 sweep)', () => {
  test('the draft HUD: kit buttons at the kit heights, one primary, no blur; axe passes', async ({ page }) => {
    await openDraft(page, { format: 'pass', seats: 'Anna,Ben', packSize: 6 });
    await settled(page);
    await expect(page.getByTestId('draft-confirm')).toHaveClass(/ds-btn--primary/);
    await designAudit(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the draft settings panel: kit wells at the kit heights; axe passes', async ({ page }) => {
    await openDraft(page, { view: 'lobby', seats: 'Anna,Ben,Cleo' });
    await expect(page.getByTestId('panel-s0').getByTestId('lobby-settings')).toBeVisible();
    await designAudit(page);
    expect(await seriousViolations(page)).toEqual([]);
  });
});
