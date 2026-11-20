/**
 * PLAN M7 A0: the frame meter. `?fps` shows it, the "Show frame rate" setting shows it and survives a reload, and the
 * debug hook reports the same numbers. Frame rates themselves are never asserted (CI has no GPU); only that the meter
 * reports, stays out of the pointer's way and sits clear of the hand.
 */
import { expect, test, type Page } from '@playwright/test';
import { call, decklist, freshProfile, openSolo, waitForSession } from '../solo/helpers';
import { openHudSettings } from './helpers';

type Snapshot = { fps: number; p50: number; p95: number; max: number; idle: boolean; callbacks: number; render: { width: number; height: number; pixelRatio: number; theme: string; quality: string } | null };

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => window.__spellplane!.fps!.snapshot() as unknown as Snapshot);

test.describe('frame meter (M7-A0)', () => {
  test('?fps shows the meter with the render size, theme and quality; the hook reports the same numbers', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await expect(page.getByTestId('frame-meter')).toHaveCount(0);
    await page.goto(`./?faces=placeholder&fps&profile=${freshProfile(info)}#/solo`);
    await waitForSession(page);
    const meter = page.getByTestId('frame-meter');
    await expect(meter).toBeVisible();
    await expect(meter).toHaveCSS('pointer-events', 'none');
    const s = await snapshot(page);
    expect(s.render).not.toBeNull();
    const vp = page.viewportSize()!;
    expect(s.render!.width).toBeGreaterThan(0);
    expect(Math.abs(s.render!.width / s.render!.pixelRatio - vp.width)).toBeLessThan(2);
    // M8-C: Plain (Paper's stub until M7-P1) is the default table.
    expect(s.render!.theme).toBe('plain');
    await expect(meter).toContainText(`${s.render!.width}×${s.render!.height}`);
    await expect(meter).toContainText('plain · high');
    // Plain draws on demand: once the table settles, the meter says idle.
    await expect.poll(async () => (await snapshot(page)).idle, { timeout: 10_000 }).toBe(true);
    await expect(meter).toContainText('idle');
    // A phase measured through the hook.
    const phase = await page.evaluate(async () => {
      const fps = window.__spellplane!.fps!;
      fps.begin();
      await new Promise((r) => setTimeout(r, 300));
      return fps.end();
    });
    expect(phase.callbacks).toBeGreaterThan(0);
    // The meter sits in the lower left corner, clear of the cards in the hand.
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await call(page, 'draw', 7);
    await expect(page.getByTestId('hand-card')).toHaveCount(7);
    const box = (await meter.boundingBox())!;
    expect(box.x).toBeLessThan(40);
    expect(box.y + box.height).toBeGreaterThan(vp.height - 40);
    for (const card of await page.getByTestId('hand-card').all()) {
      const h = (await card.boundingBox())!;
      const apart = box.x + box.width <= h.x || h.x + h.width <= box.x || box.y + box.height <= h.y || h.y + h.height <= box.y;
      expect(apart, `the meter covers a hand card at ${JSON.stringify(h)}`).toBe(true);
    }
  });

  test('"Show frame rate" in Settings shows the meter and is kept for this browser', async ({ page }, info) => {
    const profile = freshProfile(info);
    await openSolo(page, profile);
    await expect(page.getByTestId('frame-meter')).toHaveCount(0);
    await openHudSettings(page, 'display');
    const toggle = page.getByTestId('show-fps');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(page.getByTestId('frame-meter')).toBeVisible();
    await page.reload();
    await waitForSession(page);
    await expect(page.getByTestId('frame-meter')).toBeVisible();
    await openHudSettings(page, 'display');
    await expect(page.getByTestId('show-fps')).toBeChecked();
    await page.getByTestId('show-fps').uncheck();
    await expect(page.getByTestId('frame-meter')).toHaveCount(0);
  });
});
