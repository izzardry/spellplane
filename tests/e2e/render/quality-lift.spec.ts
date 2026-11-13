/**
 * PLAN M4-P2 scope: quality levels that drop shadows and post-processing first, anisotropic filtering, card boxes with
 * thickness, lift while held, shadows. DESIGN "Themes and rendering", Renderer ("a per-theme quality setting drops
 * shadows and post-processing first"); "Specification: geometry, layout and motion" (card thickness 0.6 in themes with
 * thickness; lift while dragged 12 with a 4° tilt toward the drag direction in lit themes). Measured on the debug hook.
 */
import { expect, test } from '@playwright/test';
import { openRender, rh, settle, stableTextures } from './helpers';

type Stats = { textures: number; passes: string[]; shadows: boolean; quality: string; drawCalls: number };
type Pipeline = { boxes: boolean; contactShadows: boolean; anisotropy: number; maxAnisotropy: number; pixelRatio: number; faceLift: number };
type Card = { id: string; lift: number; tilt: number; dragging: boolean; pose: { x: number; y: number } };

/** Viewport of the drag specs (behaviour from the debug hook only). */
const DRAG_VIEWPORT = { width: 960, height: 600 };

test('lower quality levels drop shadows first, then post-processing, without a reload', async ({ page }) => {
  await openRender(page, { theme: 'lit', scenario: 'demo', quality: 'high' });
  await settle(page);
  const textures0 = await stableTextures(page);
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));
  const high = await rh<Stats>(page, 'stats');
  const highP = await rh<Pipeline>(page, 'pipeline');
  expect(high).toMatchObject({ quality: 'high', shadows: true });
  expect(high.passes).toContain('bloom');
  expect(highP.contactShadows).toBe(true);
  expect(highP.anisotropy).toBe(Math.min(8, highP.maxAnisotropy));

  await rh(page, 'setQuality', 'medium');
  await settle(page);
  const medium = await rh<Stats>(page, 'stats');
  const mediumP = await rh<Pipeline>(page, 'pipeline');
  // Shadows go first, post-processing stays.
  expect(medium).toMatchObject({ quality: 'medium', shadows: false });
  expect(medium.passes).toContain('bloom');
  expect(mediumP.contactShadows).toBe(false);
  expect(mediumP.anisotropy).toBe(Math.min(4, mediumP.maxAnisotropy));

  await rh(page, 'setQuality', 'low');
  await settle(page);
  const low = await rh<Stats>(page, 'stats');
  const lowP = await rh<Pipeline>(page, 'pipeline');
  expect(low).toMatchObject({ quality: 'low', shadows: false, passes: [] });
  expect(lowP.anisotropy).toBe(1);
  expect(lowP.pixelRatio).toBeLessThanOrEqual(1);
  // Card boxes are part of the theme, not a quality extra: they stay.
  expect(lowP.boxes).toBe(true);
  expect(low.drawCalls).toBeLessThan(high.drawCalls);

  // Back up without a reload; no textures left over from the round trip.
  await rh(page, 'setQuality', 'high');
  await settle(page);
  const again = await rh<Stats>(page, 'stats');
  expect(again).toMatchObject({ quality: 'high', shadows: true });
  expect(again.passes).toEqual(high.passes);
  expect(await stableTextures(page)).toBe(textures0);
  expect(await page.evaluate(() => (window as unknown as { marker: number }).marker)).toBe(42);
});

test('a quality setting a theme lacks falls back to its best level not better than it (Paper has one level)', async ({ page }) => {
  await openRender(page, { theme: 'paper', scenario: 'empty', quality: 'low' });
  const s = await rh<Stats>(page, 'stats');
  expect(s).toMatchObject({ quality: 'high', shadows: false, passes: [] });
  const p = await rh<Pipeline>(page, 'pipeline');
  // Paper: flat, no boxes, no contact shadows, faces on the table plane.
  expect(p).toMatchObject({ boxes: false, contactShadows: false, faceLift: 0 });
});

for (const theme of ['lit', 'paper'] as const) {
  test(`a held card lifts by the dressing's lift and tilts toward the drag only in lit themes (${theme})`, async ({ page }) => {
    // Lift and tilt are read from the debug hook, not from pixels: a smaller viewport keeps the high level's frames cheap
    // where WebGL is software-rendered (CI), and a drag draws a frame per pointer move.
    await page.setViewportSize(DRAG_VIEWPORT);
    await openRender(page, { theme, scenario: 'demo' });
    await settle(page);
    const p = await rh<Pipeline>(page, 'pipeline');
    expect(p.boxes).toBe(theme === 'lit');
    if (theme === 'lit') expect(p.faceLift).toBeCloseTo(0.62, 2);
    const card = (await rh<Card[]>(page, 'cards')).find((c) => c.id === 's0-b05')!;
    expect(card.lift).toBe(0);
    const a = (await rh<{ x: number; y: number }>(page, 'toScreen', card.pose.x, card.pose.y))!;
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // Keep moving so the card has a velocity, then sample.
    let maxTilt = 0;
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(a.x + i * 14, a.y - i * 4);
      const c = (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!;
      maxTilt = Math.max(maxTilt, c.tilt);
    }
    await expect.poll(async () => (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!.lift).toBeCloseTo(12, 1);
    if (theme === 'lit') {
      expect(maxTilt).toBeGreaterThan(0);
      expect(maxTilt).toBeLessThanOrEqual(4 + 1e-9);
    } else expect(maxTilt).toBe(0);
    // At rest under the pointer the tilt settles back to flat.
    await expect.poll(async () => (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!.tilt).toBe(0);
    await page.mouse.up();
    await expect.poll(async () => (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!.lift).toBe(0);
  });
}

test('with reduced motion the lift is a cut and a held card never tilts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRender(page, { theme: 'lit', scenario: 'demo' });
  await settle(page);
  const card = (await rh<Card[]>(page, 'cards')).find((c) => c.id === 's0-b05')!;
  const a = (await rh<{ x: number; y: number }>(page, 'toScreen', card.pose.x, card.pose.y))!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  let maxTilt = 0;
  const lifts: number[] = [];
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + i * 16, a.y);
    const c = (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!;
    maxTilt = Math.max(maxTilt, c.tilt);
    lifts.push(c.lift);
  }
  expect(maxTilt).toBe(0);
  // A cut: never anywhere between resting and lifted.
  expect(lifts.every((l) => l === 0 || l === 12)).toBe(true);
  expect(lifts.at(-1)).toBe(12);
  await page.mouse.up();
  await expect.poll(async () => (await rh<Card[]>(page, 'cards')).find((x) => x.id === 's0-b05')!.lift).toBe(0);
});
