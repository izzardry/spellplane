/**
 * What the pipeline hands a theme (themes/types.ts SceneContext v2: post, materials, viewerAngle; ThemeInstance
 * setStackFocus) and that every build is matched by a dispose (DESIGN "Themes and rendering": themes switch mid-game
 * without reloading). Read through the lit test theme's probe.
 */
import { expect, test } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import { openRender, rh, setTheme, settle } from './helpers';

type Probe = {
  builds: number;
  disposes: number;
  last: { viewerAngle: number; quality: string; reducedMotion: boolean; post: boolean; materials: boolean; table: { w: number; d: number } };
  stackFocus: { x: number; y: number } | null;
  stackFocusCalls: number;
};

for (const [viewer, angle] of [['s0', 0], ['s1', 180]] as const) {
  test(`a lit theme is built with the post pipeline, the material library and the viewer's seat angle (${viewer})`, async ({ page }) => {
    await openRender(page, { theme: 'lit', scenario: 'demo', viewer });
    const p = await rh<Probe>(page, 'litProbe');
    expect(p.last).toMatchObject({ viewerAngle: angle, quality: 'high', reducedMotion: false, post: true, materials: true, table: { w: 1400, d: 1100 } });
    expect(p.builds - p.disposes).toBe(1);
  });
}

test('every build is disposed on a switch, a quality change rebuilds it, and the stack focus follows the lane', async ({ page }) => {
  await openRender(page, { theme: 'lit', scenario: 'demo' });
  await settle(page);
  let p = await rh<Probe>(page, 'litProbe');
  expect(p.stackFocus).toBeNull();
  const push: Action = { type: 'stackPush', by: 's0', cid: 'sp1', item: 'i1', kind: 'spell', card: 's0-b05' };
  await page.evaluate((a) => window.__spellplane!.dispatch!(a), push);
  await settle(page);
  p = await rh<Probe>(page, 'litProbe');
  // The harness table's stack lane is at the table centre.
  expect(p.stackFocus).toEqual({ x: 0, y: 0 });

  await rh(page, 'setQuality', 'low');
  p = await rh<Probe>(page, 'litProbe');
  expect(p.last.quality).toBe('low');
  expect(p.builds - p.disposes).toBe(1);
  // A rebuilt theme hears where the stack is again.
  expect(p.stackFocus).toEqual({ x: 0, y: 0 });

  await setTheme(page, 'paper');
  p = await rh<Probe>(page, 'litProbe');
  expect(p.builds - p.disposes).toBe(0);
  await setTheme(page, 'lit');
  p = await rh<Probe>(page, 'litProbe');
  expect(p.builds - p.disposes).toBe(1);
  expect(p.last.quality).toBe('low');
  expect(p.stackFocus).toEqual({ x: 0, y: 0 });
});

test('reduced motion is handed to the theme, and a change of it rebuilds the theme', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRender(page, { theme: 'lit', scenario: 'empty' });
  let p = await rh<Probe>(page, 'litProbe');
  expect(p.last.reducedMotion).toBe(true);
  const builds = p.builds;
  await page.evaluate(() => window.__renderHarness!.setView({ reducedMotion: false }));
  await settle(page);
  p = await rh<Probe>(page, 'litProbe');
  expect(p.builds).toBe(builds + 1);
  expect(p.last.reducedMotion).toBe(false);
  expect(p.builds - p.disposes).toBe(1);
});
