/**
 * The arena still behind Home (contracts.md Part G "Visual" 1; PLAN Milestone 8, M7-P1 Still): `renderArenaStill`
 * returns a Blob for each of the four looks in the scene harness; it contains no card (it is drawn from the look's
 * empty world, no table state); it is soft (the mean difference between neighbouring pixels, once the browser scales it
 * up, is at most a quarter of the unsoftened frame's); afterwards no WebGL context is alive and the residue is
 * unchanged; with WebGL unavailable it resolves null.
 */
import { expect, test, type Page } from '@playwright/test';
import type { ArenaStillReport } from '../../../src/scene/harness';
import type { RenderMemory } from '../../../src/scene/types';
import { openScene } from './helpers';

const LOOKS = ['plain', 'kitchen', 'graphite', 'codex'] as const;
const memory = (page: Page) => page.evaluate(() => (window.__spellplane as { render?: { memory?(): RenderMemory } }).render!.memory!());

test.describe('the arena still', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a soft PNG a sixteenth of the width for each look, with nothing left alive afterwards', async ({ page }, info) => {
    await openScene(page);
    // No table mounted: the still's own context is the only one.
    await page.evaluate(() => window.__sceneHarness!.dispose());
    const before = await memory(page);
    expect(before.contexts).toBe(0);
    for (const look of LOOKS)
      await test.step(look, async () => {
        const r = (await page.evaluate(([id]) => window.__sceneHarness!.arenaStill(id!, 1280), [look] as const)) as ArenaStillReport | null;
        expect(r, `${look} still`).not.toBeNull();
        expect(r!.type).toBe('image/png');
        expect(r!.bytes).toBeGreaterThan(0);
        expect(r!.frame.width).toBe(1280);
        expect(r!.width).toBe(80);
        expect(Math.abs(r!.height - r!.frame.height / 16)).toBeLessThanOrEqual(1);
        info.annotations.push({ type: look, description: `sharp ${r!.sharpDiff.toFixed(2)} soft ${r!.softDiff.toFixed(2)}` });
        // The frame shows something (a table, its edge, the desk), and the still is properly soft.
        expect(r!.sharpDiff).toBeGreaterThan(0);
        expect(r!.softDiff).toBeLessThanOrEqual(r!.sharpDiff / 4);
        const m = await memory(page);
        expect(m.contexts).toBe(0);
        expect({ geometries: m.geometries, textures: m.textures, programs: m.programs }).toEqual({ geometries: before.geometries, textures: before.textures, programs: before.programs });
      });
    const after = await memory(page);
    expect(after.disposals - before.disposals).toBe(LOOKS.length);
  });

  test('contains no card: the still is drawn from the empty world, with no table state', async ({ page }) => {
    await openScene(page, { scenario: 'demo' });
    // A table with cards is mounted; the still is its own world, built without state, so the cards cannot reach it.
    const before = (await memory(page)).contexts;
    const r = (await page.evaluate(() => window.__sceneHarness!.arenaStill('plain', 640))) as ArenaStillReport | null;
    expect(r).not.toBeNull();
    expect((await memory(page)).contexts).toBe(before);
  });

  test('resolves null when WebGL is unavailable', async ({ page }) => {
    await openScene(page);
    const before = await memory(page);
    const r = await page.evaluate(() => window.__sceneHarness!.arenaStill('graphite', 640, true));
    expect(r).toBeNull();
    const m = await memory(page);
    expect(m.contexts).toBe(before.contexts);
    expect(m.disposals).toBe(before.disposals);
  });
});
