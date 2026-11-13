/**
 * The keyboard on the real table (solo table of the test build, WebGL scene) and the reduced-motion audit. DESIGN
 * "Input and interaction design", Accessibility: "every card action is reachable from the keyboard by cycling focus
 * through cards in a zone"; "Reduced-motion is honoured"; ViewState.focused: "drawn with a focus ring distinct from hover
 * and selection"; "Specification: geometry, layout and motion": with reduced motion all motion cuts; "Camera and
 * navigation": camera motion cuts. PLAN M5-P4: visible focus ring on the table; every animation cuts or fades under
 * prefers-reduced-motion. Asserted through the debug hook and the DOM, never on pixels or timing.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import type { CardFocus } from '../../../src/ui/a11y/index';
import { hook } from '../helpers/app';
import { sceneReady, soloTable } from './helpers';

const focus = (page: Page) => hook<CardFocus | null>(page, 'a11y.focus');
const state = (page: Page) => hook<TableState>(page, 'state');

/** Keyboard only: focus the first hand card, cast it (C), resolve it onto the battlefield, return its id. */
async function castFirstByKeyboard(page: Page): Promise<string> {
  const first = (await hook<SecretStore>(page, 'secrets')).hand[0]!;
  await page.mouse.move(5, 450);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: first });
  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await state(page)).cards[first]?.zone).toBe('stack');
  await page.locator('[data-testid="resolve-to"] button[data-zone="battlefield:s0"]').click();
  await expect.poll(async () => (await state(page)).cards[first]?.zone).toBe('battlefield:s0');
  return first;
}

test.describe('the focus ring on the table (PLAN M5-P4)', () => {
  test('cast, resolve and tap by keyboard; the scene rings the focused card, apart from hover and selection', async ({ page }, info) => {
    await soloTable(page, info);
    await sceneReady(page);
    const id = await castFirstByKeyboard(page);
    // The battlefield is the next zone after the hand.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focus(page)).toEqual({ zone: 'battlefield:s0', card: id });
    const ring = page.getByTestId('focus-ring');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute('data-focus-card', id);
    // The ring surrounds the card's drawn rectangle (the debug hook's screen rectangle), a little outside it.
    await expect
      .poll(async () => {
        const card = (await hook<{ id: string; screen: { x: number; y: number; width: number; height: number } }[]>(page, 'cards')).find((c) => c.id === id)!.screen;
        const box = (await ring.locator('polygon').last().boundingBox())!;
        const host = (await page.getByTestId('scene-host').boundingBox())!;
        const r = { x: box.x - host.x, y: box.y - host.y, w: box.width, h: box.height };
        return r.x <= card.x && r.y <= card.y && r.x + r.w >= card.x + card.width && r.y + r.h >= card.y + card.height && r.w < card.width * 1.5;
      })
      .toBe(true);
    // The ring is drawn in the theme's focus colour, which is not the hover outline's. Paper's selection outline has the
    // same colour, so the ring is dashed (a selection outline is a solid line in the card shader) and stands off the card.
    expect(await ring.locator('polygon').last().getAttribute('stroke')).toBe('#1f6fd1');
    expect(await ring.locator('polygon').last().getAttribute('stroke-dasharray')).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?$/);
    expect(await ring.locator('polygon').first().getAttribute('stroke-dasharray')).toBeNull();

    await page.keyboard.press('KeyT');
    await expect.poll(async () => (await state(page)).cards[id]?.tapped).toBe(true);
    // The live region spoke the focus and the tap.
    await expect.poll(async () => (await hook<string[]>(page, 'a11y.announcements')).some((t) => t.includes('tapped') || t.includes(' taps '))).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => focus(page)).toBeNull();
    await expect(ring).toBeHidden();
  });
});

/** Every CSS animation and transition that starts on the page, with the durations it runs for. */
async function recordMotion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: { kind: string; what: string; ms: number; el: string }[] = [];
    (window as unknown as { __motion: typeof seen }).__motion = seen;
    const ms = (v: string) => Math.max(0, ...v.split(',').map((s) => (s.trim().endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000)));
    const label = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return el ? `${el.tagName?.toLowerCase()}${el.getAttribute?.('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.className?.toString?.() ?? '').split(' ')[0]}` : '?';
    };
    addEventListener('animationstart', (e) => seen.push({ kind: 'animation', what: e.animationName, ms: ms(getComputedStyle(e.target as Element).animationDuration), el: label(e.target) }), true);
    addEventListener('transitionrun', (e) => seen.push({ kind: 'transition', what: e.propertyName, ms: ms(getComputedStyle(e.target as Element).transitionDuration), el: label(e.target) }), true);
  });
}

/** A short session that moves things: hand hover, the log, the cheat sheet, a cast and resolve, a tap, a toast, the camera. */
async function busySession(page: Page, info: Parameters<typeof soloTable>[1]): Promise<void> {
  await soloTable(page, info);
  await sceneReady(page);
  await page.getByTestId('hand-card').nth(2).hover();
  await page.getByTestId('hand-card').nth(4).hover();
  await page.mouse.move(5, 450);
  await page.getByTestId('open-cheat-sheet').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('log').getByRole('button', { name: 'Hide' }).click();
  await page.getByTestId('log').getByRole('button', { name: 'Log' }).click();
  const id = await castFirstByKeyboard(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('KeyT');
  await expect.poll(async () => (await state(page)).cards[id]?.tapped).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

test.describe('reduced-motion audit (PLAN M5-P4)', () => {
  test('under prefers-reduced-motion every CSS animation and transition cuts (runs 1 ms at most) or only fades', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordMotion(page);
    await busySession(page, info);
    const motion = await page.evaluate(() => (window as unknown as { __motion: { kind: string; what: string; ms: number; el: string }[] }).__motion);
    const moving = motion.filter((m) => m.ms > 1 && m.what !== 'opacity');
    expect(moving).toEqual([]);
  });

  test('under prefers-reduced-motion the camera cuts between rigs instead of blending', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await soloTable(page, info);
    await sceneReady(page);
    const before = await hook<string>(page, 'rig.rig');
    await page.mouse.move(700, 300);
    await page.keyboard.press('KeyP');
    await expect.poll(() => hook<string>(page, 'rig.rig')).not.toBe(before);
    expect(await hook(page, 'rig.blend')).toBeNull();
  });

  test('the audit sees motion when the viewer has not asked for less (the recorder works)', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await recordMotion(page);
    await soloTable(page, info);
    await page.getByTestId('hand-card').nth(2).hover();
    await page.getByTestId('hand-card').nth(4).hover();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __motion: { ms: number }[] }).__motion.some((m) => m.ms > 1))).toBe(true);
  });
});
