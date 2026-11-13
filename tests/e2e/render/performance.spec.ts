/**
 * PLAN M4 Performance acceptance: "With 300 cards: at most 20 draw calls in Paper and 60 in Stonetable, texture memory
 * under 400 MB, and main-thread frame work under 6 ms on CI hardware." Measured through the debug hook
 * (`__spellplane.render.stats()`, renderer.info). Stonetable is a stub until M4-P5, so the lit test theme (shadows,
 * boxes, contact shadows, bloom, vignette and a theme pass at once) stands in for it as well.
 *
 * The frame-work bound is CPU time on the main thread (the scene's draw: layout, instance writes, render submission);
 * CI renders in software and this run's rule forbids timing assertions in browser specs, so it is measured and reported
 * as an annotation here, and the gate reviews it (docs/DECISIONS.md M4-P2).
 */
import { expect, test } from '@playwright/test';
import { openRender, rh, settle, type HarnessThemeId } from './helpers';

type Stats = { drawCalls: number; textureBytes: number; frameMs: number; textures: number; passes: string[] };

const BUDGET: { theme: HarnessThemeId; drawCalls: number }[] = [
  { theme: 'paper', drawCalls: 20 },
  { theme: 'stonetable', drawCalls: 60 },
  { theme: 'lit', drawCalls: 60 },
];

for (const { theme, drawCalls } of BUDGET) {
  test(`300 cards in ${theme}: at most ${drawCalls} draw calls, texture memory under 400 MB; frame work reported`, async ({ page }, info) => {
    await openRender(page, { theme, scenario: 'bench' });
    await settle(page);
    const drawn = (await rh<unknown[]>(page, 'cards')).length;
    expect(drawn).toBeGreaterThanOrEqual(300);

    const samples: Stats[] = [];
    const vp = page.viewportSize()!;
    // The fitted table, a mid zoom and a close zoom (bigger texture tiers), each with a few forced redraws.
    for (const factor of [1, 2.5, 6]) {
      if (factor !== 1) await page.evaluate(([x, y, f]) => window.__renderHarness!.camera.zoomAt(x!, y!, f!), [vp.width / 2, vp.height * 0.7, factor] as const);
      await settle(page);
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.__renderHarness!.camera.panBy(1, 0));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        samples.push(await page.evaluate(() => window.__spellplane!.render!.stats()) as Stats);
      }
    }
    const maxCalls = Math.max(...samples.map((s) => s.drawCalls));
    const maxBytes = Math.max(...samples.map((s) => s.textureBytes));
    expect(maxCalls).toBeGreaterThan(0);
    expect(maxCalls).toBeLessThanOrEqual(drawCalls);
    expect(maxBytes).toBeGreaterThan(0);
    expect(maxBytes).toBeLessThan(400 * 1024 * 1024);
    const ms = samples.map((s) => s.frameMs).sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)]!;
    expect(Number.isFinite(median)).toBe(true);
    info.annotations.push({ type: 'frame-cpu-ms', description: `${theme}/${info.project.name}: median ${median.toFixed(2)} ms, max ${ms.at(-1)!.toFixed(2)} ms over ${ms.length} frames; draw calls ≤ ${maxCalls}; texture memory ${(maxBytes / 2 ** 20).toFixed(1)} MB` });
  });
}
