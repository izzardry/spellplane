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
        // A near-flat look (Plain's pale desk) leaves the frame little to soften: below 0.06 levels the difference is the
        // 8-bit rounding of the browser's upscale (one level across 16 px), not detail.
        expect(r!.softDiff).toBeLessThanOrEqual(Math.max(r!.sharpDiff / 4, 0.06));
        const m = await memory(page);
        expect(m.contexts).toBe(0);
        expect({ geometries: m.geometries, textures: m.textures, programs: m.programs }).toEqual({ geometries: before.geometries, textures: before.textures, programs: before.programs });
      });
    const after = await memory(page);
    expect(after.disposals - before.disposals).toBe(LOOKS.length);
  });

  test('contains no card: a still taken beside a table full of cards equals one taken with no table mounted', async ({ page }, info) => {
    await openScene(page, { scenario: 'demo' });
    // A table with cards is mounted; the still is its own world, built without state, so the cards cannot reach it.
    const before = (await memory(page)).contexts;
    const still = (id: string) => page.evaluate(([look]) => window.__sceneHarness!.arenaStill(look!, 640), [id] as const) as Promise<ArenaStillReport | null>;
    for (const look of LOOKS)
      await test.step(look, async () => {
        const withTable = await still(look);
        expect(withTable).not.toBeNull();
        expect((await memory(page)).contexts).toBe(before);
        await page.evaluate(() => window.__sceneHarness!.dispose());
        const bare = await still(look);
        expect(bare).not.toBeNull();
        info.annotations.push({ type: look, description: `with a table: ${withTable!.bytes} B, sharp ${withTable!.sharpDiff.toFixed(4)}; none: ${bare!.bytes} B, sharp ${bare!.sharpDiff.toFixed(4)}` });
        // The same frame, measured on its unsoftened pixels and on the PNG: no card got into the one beside the table.
        expect({ w: withTable!.width, h: withTable!.height, fw: withTable!.frame.width, fh: withTable!.frame.height }).toEqual({ w: bare!.width, h: bare!.height, fw: bare!.frame.width, fh: bare!.frame.height });
        expect(Math.abs(withTable!.sharpDiff - bare!.sharpDiff)).toBeLessThanOrEqual(0.01 * Math.max(1, bare!.sharpDiff));
        expect(Math.abs(withTable!.bytes - bare!.bytes)).toBeLessThanOrEqual(0.02 * bare!.bytes);
        // Mount the table again for the next look.
        await openScene(page, { scenario: 'demo' });
      });
  });

  test('an odd window width (1366 px) still halves four times to a sixteenth, not a thirty-second', async ({ page }) => {
    await openScene(page);
    await page.evaluate(() => window.__sceneHarness!.dispose());
    for (const width of [1366, 1030, 390]) {
      const r = (await page.evaluate(([w]) => window.__sceneHarness!.arenaStill('kitchen', w!), [width] as const)) as ArenaStillReport | null;
      expect(r, `${width}`).not.toBeNull();
      expect(r!.frame.width).toBe(width);
      expect(Math.abs(r!.width - width / 16), `${width} px gives ${r!.width}`).toBeLessThanOrEqual(1);
    }
  });

  test('a return to Home does not draw the arena again: the same look and size resolve the kept still', async ({ page }) => {
    await openScene(page);
    await page.evaluate(() => window.__sceneHarness!.dispose());
    const before = await memory(page);
    const r = await page.evaluate(() => window.__sceneHarness!.arenaStillKept('plain', [640, 640, 800, 640]));
    expect(r.map((x) => x.bytes > 0)).toEqual([true, true, true, true]);
    expect(r.map((x) => x.kept)).toEqual([false, true, false, true]);
    // Two draws (640 and 800 px), each with its own context, released afterwards.
    const m = await memory(page);
    expect(m.disposals - before.disposals).toBe(2);
    expect(m.contexts).toBe(0);
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
