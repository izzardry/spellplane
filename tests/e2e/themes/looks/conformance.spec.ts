/**
 * Conformance and budget of the three M7 looks (PLAN M7-P1 acceptance: "conformance and budget specs per look"; "Card
 * faces never tinted or cropped (keep the M4 conformance tests green, extended to the new looks)"; "Performance: cheap
 * in Safari"). The M4 specs these extend: tests/e2e/render/face-colour.spec.ts (PLAN M4-P2: "The average colour of a
 * rendered card face differs from the source texture by less than 3% in every lit theme") and
 * tests/e2e/render/performance.spec.ts (PLAN M4: 300 cards, draw calls, texture memory under 400 MB). The functional
 * signal checks run over every registered theme in tests/e2e/signals.spec.ts, the looks included.
 *
 * The face is measured in the middle of the screen and pushed into a corner, where the lamp's pool is weakest: a face
 * never takes the table's light. Nothing here asserts on time (CI renders WebGL in software); frame work is reported as
 * an annotation.
 */
import { expect, test, type Page } from '@playwright/test';
import { colourDelta, openRender, rh, screenAverage, settle } from '../../render/helpers';
import { LOOKS, setTilt } from './helpers';

type Rect = { x: number; y: number; width: number; height: number };
type Card = { id: string; screen: Rect; tier: string | null; visible: boolean };
type Stats = { drawCalls: number; textureBytes: number; frameMs: number; textures: number; passes: string[] };

const SID = 'fx-7';
const INSET = 0.12;
/** Draw calls with 300 cards on the table: Paper's 20 plus the world (slabs, skirt, marks), well under the lit M4 themes' 60. */
const DRAW_CALL_BUDGET = 36;

const probe = async (page: Page): Promise<Card> => (await rh<Card[]>(page, 'cards')).find((c) => c.id === 'probe')!;

for (const look of LOOKS) {
  test.describe(`${look}: conformance`, () => {
    test.describe.configure({ timeout: 120_000 });

    test(`card face keeps its printed colours within 3% (centre and corner)`, async ({ page }, info) => {
      const errors = await openRender(page, { theme: look, scenario: 'empty' });
      await page.evaluate((sid) => window.__renderHarness!.addCard('probe', sid, { x: 0, y: -260, rot: 0 }), SID);
      await page.evaluate(() => window.__renderHarness!.camera.zoomTo('probe'));
      await settle(page);
      await expect.poll(async () => (await probe(page)).tier).toBe('large');
      await settle(page);
      const source = await rh<[number, number, number]>(page, 'sourceAverage', SID, INSET);
      const vp = page.viewportSize()!;
      const centre = await probe(page);
      expect(centre.screen.height).toBeGreaterThan(vp.height * 0.6);
      const atCentre = await screenAverage(page, centre.screen, INSET);
      expect(colourDelta(atCentre, source), `centre ${atCentre.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);

      await page.evaluate(([w, h]) => window.__renderHarness!.camera.zoomAt(w! / 2, h! / 2, 0.5), [vp.width, vp.height] as const);
      await settle(page);
      const half = await probe(page);
      await page.evaluate(([dx, dy]) => window.__renderHarness!.camera.panBy(dx!, dy!), [6 - half.screen.x, 6 - half.screen.y] as const);
      await settle(page);
      const corner = await probe(page);
      expect(corner.screen.x).toBeLessThan(20);
      expect(corner.screen.y).toBeLessThan(20);
      const atCorner = await screenAverage(page, corner.screen, INSET);
      expect(colourDelta(atCorner, source), `corner ${atCorner.map(Math.round)} vs source ${source.map(Math.round)}`).toBeLessThan(0.03);

      info.annotations.push({ type: 'face', description: `centre ${atCentre.map(Math.round)} corner ${atCorner.map(Math.round)} source ${source.map(Math.round)}` });
      expect(errors).toEqual([]);
    });

    test(`300 cards: at most ${DRAW_CALL_BUDGET} draw calls, texture memory under 400 MB, no post passes; frame work reported`, async ({ page }, info) => {
      test.slow(!!process.env.CI, 'software GL on CI');
      await openRender(page, { theme: look, scenario: 'bench' });
      await settle(page);
      expect((await rh<unknown[]>(page, 'cards')).length).toBeGreaterThanOrEqual(300);
      const samples: Stats[] = [];
      const vp = page.viewportSize()!;
      for (const t of [1, 0.5, 0]) {
        await setTilt(page, t);
        for (const factor of [1, 2.5]) {
          if (factor !== 1) await page.evaluate(([x, y, f]) => window.__renderHarness!.camera.zoomAt(x!, y!, f!), [vp.width / 2, vp.height * 0.6, factor] as const);
          await settle(page);
          for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.__renderHarness!.camera.panBy(1, 0));
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            samples.push((await page.evaluate(() => window.__spellplane!.render!.stats())) as Stats);
          }
        }
      }
      const maxCalls = Math.max(...samples.map((s) => s.drawCalls));
      const maxBytes = Math.max(...samples.map((s) => s.textureBytes));
      expect(maxCalls).toBeGreaterThan(0);
      expect(maxCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
      expect(maxBytes).toBeGreaterThan(0);
      expect(maxBytes).toBeLessThan(400 * 1024 * 1024);
      for (const s of samples) expect(s.passes).toEqual([]);
      const ms = samples.map((s) => s.frameMs).sort((a, b) => a - b);
      const report = `${look}/${info.project.name}: frame CPU median ${ms[Math.floor(ms.length / 2)]!.toFixed(2)} ms, max ${ms.at(-1)!.toFixed(2)} ms over ${ms.length} frames; draw calls ≤ ${maxCalls}; texture memory ${(maxBytes / 2 ** 20).toFixed(1)} MB`;
      info.annotations.push({ type: 'frame-cpu-ms', description: report });
      console.log(`[perf] ${report}`);
    });
  });
}
