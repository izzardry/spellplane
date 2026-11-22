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
 * Propose "Next game" or "New draft": from the evening bar where it shows, else (a match whose HUD has `evening`) from
 * the HUD's Menu, confirmed in its dialog.
 */
export async function propose(page: Page, event: 'nextGame' | 'newDraft', how: Press = 'click'): Promise<void> {
  // The evening bar when the stage shows it (between games, and in a match while the shell does not pass `evening` to
  // the HUD: m8's ui/flow/Stage.svelte), else the HUD's Menu.
  const bar = page.locator(`[data-testid="evening-bar"] [data-testid="propose-${event}"]`);
  if ((await page.locator('[data-testid="stage"][data-stage="match"]').count()) === 0 || (await bar.isVisible())) {
    await bar[how]();
    return;
  }
  await menuItem(page, `propose-${event}`, how);
  await page.getByTestId('leave-ok')[how]();
}

/** Buttons that belong to other packages' components mounted inside the HUD (talk, thumb bar, hints, empty states, hand). */
const FOREIGN = '.talk-cluster, .thumbs, [data-testid="hand"], [data-testid="hint"], .state, .theme-pop, .voice-pop, [data-testid="team-hands"], [data-testid="focus-mirror"]';

/**
 * Buttons and menu items under the HUD root whose height is none of the kit's four (--ds-control-xs … lg, ±0.5 px),
 * skipping other packages' components mounted inside the HUD.
 */
export async function offSizes(page: Page): Promise<string[]> {
  await settled(page);
  return page.getByTestId('hud').evaluate((root, foreign) => {
    const css = getComputedStyle(root);
    const heights = ['xs', 'sm', 'md', 'lg'].map((k) => parseFloat(css.getPropertyValue(`--ds-control-${k}`)));
    if (heights.some((h) => !Number.isFinite(h))) return ['--ds-control-* variables missing'];
    const bad: string[] = [];
    for (const b of root.querySelectorAll<HTMLElement>('button, [role="menuitem"]')) {
      if (b.closest(foreign)) continue;
      const r = b.getBoundingClientRect();
      const st = getComputedStyle(b);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      // The layout height, as the shared designAudit measures it: a pressed button's scale(0.98) is not its size.
      const h = b.offsetHeight || r.height;
      if (!heights.some((x) => Math.abs(x - h) <= 0.5)) bad.push(`${b.dataset.testid ?? b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 30)}: ${h}`);
    }
    return bad;
  }, FOREIGN);
}


/**
 * Wait until no finite animation or transition runs (a popover's entering scale, a button's eased colour). A running
 * countdown (`role="timer"`, the confirm prompt's ring) restarts its short transition on every tick, so it never
 * settles before the countdown ends: its animations are left out.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().filter((a) => {
      if (a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity) return false;
      const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
      return !(target instanceof Element && target.closest('[role="timer"]'));
    }).length === 0,
  );
}
