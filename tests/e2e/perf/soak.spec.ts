/**
 * Mount and dispose soak (contracts.md Part C "Lifecycle counters"; PLAN Milestone 8, M7-P1 Lifecycle; owner, 20 Nov
 * 2026: "make sure to not mess up the system with memory leaks"). Tables are mounted and disposed many times per page
 * load: in the scene harness the table scene is mounted and disposed 20 times; after every dispose the live counts equal
 * those before the first mount, and after 20 the renderers' residue (what `info.memory` and `info.programs` still held
 * when each was disposed) is all zeros with 20 disposals. The draft table, the builder table and the flow's stage count
 * one WebGL context while mounted and none after. Read through the debug hook only; no timing.
 */
import { expect, test, type Page } from '@playwright/test';
import type { RenderMemory } from '../../../src/scene/types';
import { openScene } from '../scene/helpers';

const memory = (page: Page) => page.evaluate(() => (window.__spellplane as { render?: { memory?(): RenderMemory } }).render!.memory!());
const ready = (page: Page) => expect.poll(() => page.evaluate(() => window.__sceneHarness!.ready()), { timeout: 30_000 }).toBe(true);
const live = (m: RenderMemory) => ({ contexts: m.contexts, sessions: m.sessions, engines: m.engines, transports: m.transports, audioContexts: m.audioContexts, workers: m.workers, rafLoops: m.rafLoops, botRunners: m.botRunners, timers: m.timers });

test.describe('lifecycle soak', () => {
  test.describe.configure({ timeout: 180_000 });

  test('20 table scenes mounted and disposed leave every count where it was and nothing in the residue', async ({ page }) => {
    test.slow(!!process.env.CI, 'software GL on CI');
    await openScene(page, { scenario: 'demo' });
    const mounted = await memory(page);
    expect(mounted.contexts).toBe(1);
    expect(mounted.rafLoops).toBe(1);
    await page.evaluate(() => window.__sceneHarness!.dispose());
    const before = await memory(page);
    // The harness page mounts a table on load, so the state "before the first mount" is the page with it disposed: the
    // Home condition, every live count 0. Asserted outright, so nothing the first mount leaves behind hides in the baseline.
    expect(live(before), 'every live count is 0 once the first table is disposed').toEqual({ contexts: 0, sessions: 0, engines: 0, transports: 0, audioContexts: 0, workers: 0, rafLoops: 0, botRunners: 0, timers: 0 });
    const start = before.disposals;
    for (let i = 1; i <= 20; i++) {
      await test.step(`cycle ${i}`, async () => {
        await page.evaluate(() => window.__sceneHarness!.remount());
        await ready(page);
        const m = await memory(page);
        expect(m.contexts, 'one WebGL context while mounted').toBe(1);
        expect(m.rafLoops, 'one frame loop while mounted').toBe(1);
        // No worker is tracked by the table scene (nothing under src/scene calls track('workers', …)): the acceptance's
        // "one worker while mounted" belongs to the surfaces that start one; here the live counts after dispose cover it.
        await page.evaluate(() => window.__sceneHarness!.dispose());
        const after = await memory(page);
        expect(live(after), `live counts after dispose ${i}`).toEqual(live(before));
      });
    }
    const end = await memory(page);
    expect(end.disposals - start).toBe(20);
    expect({ geometries: end.geometries, textures: end.textures, programs: end.programs }).toEqual({ geometries: 0, textures: 0, programs: 0 });
    // The debug hook's render part stays readable with no table mounted (Home: every count is 0).
    expect(end.contexts).toBe(0);
  });

  for (const kind of ['draft', 'builder', 'stage'] as const)
    test(`the ${kind} surface counts one WebGL context while mounted and none after`, async ({ page }) => {
      await openScene(page);
      await page.evaluate(() => window.__sceneHarness!.dispose());
      const base = (await memory(page)).contexts;
      expect(base).toBe(0);
      for (let i = 0; i < 3; i++) {
        await page.evaluate((k) => window.__sceneHarness!.mountSurface(k), kind);
        expect((await memory(page)).contexts).toBe(1);
        await page.evaluate(() => window.__sceneHarness!.disposeSurface());
        const m = await memory(page);
        expect(m.contexts).toBe(0);
        expect(m.rafLoops).toBe(0);
      }
      const m = await memory(page);
      expect({ geometries: m.geometries, textures: m.textures, programs: m.programs }).toEqual({ geometries: 0, textures: 0, programs: 0 });
    });
});
