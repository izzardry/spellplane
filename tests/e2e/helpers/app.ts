import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Open the app with harness flags. `profile` gives each page its own IndexedDB namespace. */
export async function openApp(page: Page, opts: { profile?: string; transport?: 'local'; hash?: string; faces?: 'placeholder' | null } = {}) {
  const q = new URLSearchParams();
  if (opts.faces !== null) q.set('faces', opts.faces ?? 'placeholder');
  if (opts.profile) q.set('profile', opts.profile);
  if (opts.transport) q.set('transport', opts.transport);
  await page.goto(`./?${q.toString()}${opts.hash ? `#${opts.hash}` : ''}`);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
}

/** Call a function of window.__spellplane in the page and return its JSON result. */
export async function hook<T = unknown>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, a]) => {
      const api = window.__spellplane as Record<string, unknown> | undefined;
      const parts = (name as string).split('.');
      let target: unknown = api;
      let self: unknown = api;
      for (const p of parts) {
        self = target;
        target = (target as Record<string, unknown> | undefined)?.[p];
      }
      if (typeof target !== 'function') throw new Error(`__spellplane.${name as string} is not a function`);
      return JSON.parse(JSON.stringify((target as (...x: unknown[]) => unknown).apply(self, a as unknown[]) ?? null));
    },
    [fn, args] as const,
  ) as Promise<T>;
}

/**
 * Save a screenshot as gate evidence under artifacts/shots/<milestone>/<name>-<project>.png
 * (docs/PLAN.md: screenshots are evidence for review, not pixel baselines).
 */
export async function shot(page: Page, milestone: string, name: string, project: string) {
  const dir = path.join('artifacts', 'shots', milestone);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${project}.png`) });
}

// --- M7-P2 HUD routes (docs/design/m7-hud-proposal.md): rare tools live in the Menu, piles and counters under a
// plate's "⋯", the log in a drawer behind the activity button. These helpers take the new routes the way a player does.

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
