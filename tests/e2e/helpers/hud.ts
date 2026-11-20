/** Helpers for the M7-P2 HUD routes (docs/design/m7-hud-proposal.md): rare tools live in the Menu, piles and counters under a
 * plate's "⋯", the log in a drawer behind the activity button. These helpers take the new routes the way a player does. */
import { expect, type Page } from '@playwright/test';

type Press = 'click' | 'tap';

/** Open the HUD's Menu (if it is not open) and press one of its items by data-testid. */
export async function menuItem(page: Page, testid: string, how: Press = 'click'): Promise<void> {
  const pop = page.getByTestId('menu-popover');
  if (!(await pop.isVisible())) await page.getByTestId('open-menu')[how]();
  await expect(pop).toBeVisible();
  await pop.getByTestId(testid)[how]();
}

/** Open a seat plate's details ("⋯": counters and piles), if they are not open; returns the plate. */
export async function plateDetails(page: Page, seat: string, how: Press = 'click') {
  const plate = page.locator(`[data-testid="avatar"][data-seat="${seat}"]`);
  if (!(await plate.getByTestId('plate-details').isVisible())) await plate.getByTestId('plate-more')[how]();
  await expect(plate.getByTestId('plate-details')).toBeVisible();
  return plate;
}

/** Open a pile's viewer through its owner's plate (the plate's "⋯", then the pile). */
export async function openZone(page: Page, zone: string, how: Press = 'click'): Promise<void> {
  const seat = zone.split(':')[1] ?? '';
  const plate = await plateDetails(page, seat, how);
  await plate.locator(`[data-testid="zone-button"][data-zone="${zone}"]`)[how]();
}

/** Open the log and chat drawer (the activity button) if it is closed. */
export async function openLog(page: Page, how: Press = 'click'): Promise<void> {
  const drawer = page.locator('[data-testid="log"][data-open="true"]');
  if (!(await drawer.isVisible())) await page.getByTestId('open-log')[how]();
  await expect(drawer).toBeVisible();
}

/**
 * Propose "Next game" or "New draft": in a match from the HUD's Menu, confirmed in its dialog; between games (the
 * builder) from the evening bar, as before.
 */
export async function propose(page: Page, event: 'nextGame' | 'newDraft', how: Press = 'click'): Promise<void> {
  if ((await page.locator('[data-testid="stage"][data-stage="match"]').count()) === 0) {
    await page.locator(`[data-testid="evening-bar"] [data-testid="propose-${event}"]`)[how]();
    return;
  }
  await menuItem(page, `propose-${event}`, how);
  await page.getByTestId('leave-ok')[how]();
}
