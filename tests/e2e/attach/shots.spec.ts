/**
 * Screenshots of attach, carry and clips for the owner (M6.1; evidence, not baselines): the tuck preview mid-drag with
 * its ghost and attach glyph, a host with two tucked attachments, a clip on two overlapping cards in each of the four
 * themes, the hold ring mid-fill, the clip tray in the toolbar, the hover outline of a clipped group, and a clip on the
 * iPad (touch, WebKit). Written to artifacts/shots/M6.1/. Each shot is taken after the state it shows is asserted
 * through the debug hook; the hold ring is caught with Playwright's fake clock, so nothing depends on render speed.
 */
import { expect, test, type Page } from '@playwright/test';
import { THEME_IDS, THEME_LISTED, type ThemeId } from '../../../src/themes/index';
import { hook, shot } from '../helpers/app';
import { freshProfile, openSolo } from '../solo/helpers';
import { IPAD } from '../touch/helpers';
import { SIDS, centre, clipCentre, clips, creature, dispatch, hover, idle, mouseDrag, pxPerMm, shown, state } from './helpers';

const M = 'M6.1';

/** a at (0, -200) and b at (30, -180) overlap; c at (250, -200) stands apart. */
async function table(page: Page): Promise<void> {
  await creature(page, 'a', { x: 0, y: -200, rot: 0 }, SIDS[0]);
  await creature(page, 'b', { x: 30, y: -180, rot: 0 }, SIDS[1]);
  await creature(page, 'c', { x: 250, y: -200, rot: 0 }, SIDS[2]);
  await idle(page);
}

/** Clip a and b over their overlap (anchored on b, 15 mm left of and 10 mm below its centre). */
async function clipAB(page: Page): Promise<void> {
  await dispatch(page, { type: 'clipAdd', clip: 'k1', cards: ['a', 'b'], anchor: { card: 'b', x: -15, y: -10 } });
  await expect.poll(async () => (await clips(page)).clips.map((c) => c.cards)).toEqual([['a', 'b']]);
  await idle(page);
}

/** Close the first-run hints (one may follow another), so they do not cover the table in the shots. */
async function closeHints(page: Page): Promise<void> {
  const hint = page.getByTestId('hint-dismiss');
  for (let i = 0; i < 4 && (await hint.isVisible()); i++) {
    await hint.click();
    await frames(page);
  }
}

/**
 * Close the welcome hint and zoom the camera in over table point (x, y) mm of seat 0's battlefield (around `id`), so the
 * shots show the cards up close; resolves once the card's drawn size stops changing between reads of the debug hook.
 */
async function closeUp(page: Page, id: string, dx = 0, dy = 0): Promise<void> {
  await closeHints(page);
  const k = await pxPerMm(page, id);
  const c = await centre(page, id);
  await page.mouse.move(c.x + dx * k, c.y - dy * k);
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -300);
  let last = -1;
  await expect
    .poll(async () => {
      const h = (await shown(page)).find((x) => x.id === id)?.screen.height ?? 0;
      const same = h > 0 && Math.abs(h - last) < 0.01;
      last = h;
      return same;
    }, { timeout: 15_000 })
    .toBe(true);
  await idle(page);
}

/** Two animation frames, so the overlay and the canvas show the latest state. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));

/** Pick a theme in the HUD's picker; resolves once the scene drew in it (as tests/e2e/m4.gate.spec.ts does). */
async function pickHudTheme(page: Page, theme: ThemeId): Promise<void> {
  const picker = page.getByTestId('theme-settings');
  if (!(await picker.isVisible())) await page.getByTestId('open-theme-settings').click();
  await expect(picker).toBeVisible();
  // The M4 themes left the picker (PLAN Milestone 7, Owner decisions) but stay loadable: those go through the debug
  // hook, which stores the choice as the picker does.
  if (THEME_LISTED[theme]) await picker.locator(`[data-testid="theme-option"][data-theme="${theme}"] input`).check();
  else await page.evaluate((t) => window.__spellplane!.theme!.set(t), theme);
  await expect.poll(() => hook<ThemeId>(page, 'theme.current'), { timeout: 20_000 }).toBe(theme);
  await expect.poll(() => hook<{ theme: string }>(page, 'render.stats').then((r) => r.theme), { timeout: 20_000 }).toBe(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByTestId('theme-close').click();
  await expect(picker).toHaveCount(0);
  await frames(page);
}

test.describe('mouse', () => {
  test.beforeEach(async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
  });

  test('tuck preview mid-drag, and a host with two tucked attachments', async ({ page }, info) => {
    await creature(page, 'host', { x: 0, y: -220, rot: 0 }, SIDS[0]);
    await creature(page, 'aura', { x: 110, y: -230, rot: 0 }, SIDS[1]);
    await creature(page, 'gear', { x: -110, y: -230, rot: 0 }, SIDS[2]);
    await closeUp(page, 'host', 0, 40);
    const k = await pxPerMm(page, 'host');
    const h = await centre(page, 'host');
    const a = await centre(page, 'aura');
    await mouseDrag(page, a, { x: h.x + 4 * k, y: h.y - 76 * k }, { hold: true });
    await expect.poll(async () => (await clips(page)).preview).toMatchObject({ kind: 'tuck', target: 'host' });
    await expect(page.locator('[data-scene="attach-glyph"]')).toBeVisible();
    await frames(page);
    await shot(page, M, 'tuck-preview', info.project.name);
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).cards.aura?.attachedTo).toBe('host');
    await dispatch(page, { type: 'attach', card: 'gear', to: 'host' });
    await expect.poll(async () => (await state(page)).cards.gear?.attachedTo).toBe('host');
    const st = await state(page);
    expect(st.cards.aura!.pose).toEqual({ x: 10, y: -210, rot: 0 });
    expect(st.cards.gear!.pose).toEqual({ x: 20, y: -200, rot: 0 });
    await idle(page);
    await page.mouse.move(5, 450);
    await frames(page);
    await closeHints(page);
    await shot(page, M, 'host-two-attachments', info.project.name);
  });

  test('a clip on two overlapping cards in each theme', async ({ page }, info) => {
    await table(page);
    await closeUp(page, 'a', 15, 10);
    await clipAB(page);
    await page.mouse.move(5, 450);
    for (const theme of THEME_IDS) {
      await pickHudTheme(page, theme);
      await idle(page);
      expect((await clips(page)).clips[0]?.screen).not.toBeNull();
      await closeHints(page);
      await shot(page, M, `clip-${theme}`, info.project.name);
    }
  });

  test('the clip tray in the toolbar, and the hover outline of a clipped group', async ({ page }, info) => {
    await table(page);
    const tray = page.getByTestId('clip-tray');
    await expect(tray).toBeVisible();
    await tray.hover();
    await frames(page);
    await closeHints(page);
    await shot(page, M, 'clip-tray', info.project.name);
    await tray.locator('xpath=..').screenshot({ path: `artifacts/shots/${M}/clip-tray-toolbar-${info.project.name}.png` });
    await closeUp(page, 'a', 15, 10);
    await clipAB(page);
    await hover(page, await clipCentre(page));
    await expect.poll(async () => (await shown(page)).filter((x) => x.hovered).map((x) => x.id).sort()).toEqual(['a', 'b']);
    await frames(page);
    await closeHints(page);
    await shot(page, M, 'clip-hover-outline', info.project.name);
  });
});

test('the hold ring mid-fill', async ({ page }, info) => {
  // Frames run only when the test advances the fake clock, so the ring is caught mid-fill on any machine.
  await page.clock.install();
  await openSolo(page, freshProfile(info));
  await table(page);
  await closeUp(page, 'a', 15, 10);
  const a = await centre(page, 'a');
  const b = await centre(page, 'b');
  const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.mouse.move(p.x, p.y);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  await page.clock.runFor(32);
  await page.mouse.down();
  await page.clock.runFor(400);
  const hold = (await clips(page)).hold;
  expect(hold?.cards.sort()).toEqual(['a', 'b']);
  expect(hold!.progress).toBeGreaterThan(1 / 3);
  expect(hold!.progress).toBeLessThan(1);
  await expect(page.locator('[data-scene="clip-ring"]')).toBeVisible();
  await shot(page, M, 'hold-ring', info.project.name);
  await page.clock.runFor(400);
  await expect.poll(async () => Object.keys((await state(page)).clips ?? {}).length).toBe(1);
  await page.mouse.up();
  await page.clock.resume();
});

test.describe('touch', () => {
  test.use(IPAD);
  test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');

  test('a clip on the iPad', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await table(page);
    await closeHints(page);
    await clipAB(page);
    expect((await clips(page)).clips[0]?.screen).not.toBeNull();
    await closeHints(page);
    await shot(page, M, 'clip-ipad', info.project.name);
  });
});
