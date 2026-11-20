// The adaptive resolution ignores gaps that are not the scene's cost (docs/design/m8/m7-adjustments.md, M7-P6: "the
// adaptive policy must ignore frame gaps while the page is hidden or covered"; PLAN Milestone 8, M7-P1 Policy: "hidden
// or covered frame gaps do not lower the resolution and the table at rest renders at full resolution").
import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, COVERED_GAP_MS, MIN_PIXEL_RATIO, REST_AFTER_MS, RUN, SLOW_MS, THROTTLED_GAP_MS, foreignGap } from '../../../src/scene/resolution';

/** Feed `n` frames of `cost` ms each, `cost` apart, with the given context. */
function feed(r: AdaptiveResolution, start: number, n: number, cost: number, ctx?: { hidden?: boolean; drawMs?: number }): number {
  let now = start;
  for (let i = 0; i < n; i++) {
    now += cost;
    r.observe(now, cost, ctx);
  }
  return now;
}

describe('the adaptive resolution and frames it should not count', () => {
  it('a hidden page: hundreds of long gaps leave the full ratio', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, 400, 1000, { hidden: true, drawMs: 3 });
    expect(r.motionScale()).toBe(1);
  });

  it('a covered window: long gaps with short draws that fewer pixels do not shorten end at the full ratio', () => {
    for (const gap of [COVERED_GAP_MS, COVERED_GAP_MS + 30, 300, 700]) {
      const r = new AdaptiveResolution();
      r.setBase(2);
      feed(r, 0, 400, gap, { drawMs: 2 });
      expect(r.motionScale(), `${gap} ms`).toBe(1);
    }
  });

  it('a window throttled to about one frame a second never lowers it, not even for a probe', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    let now = 0;
    for (let i = 0; i < 40; i++) {
      now += THROTTLED_GAP_MS;
      r.observe(now, THROTTLED_GAP_MS, { drawMs: 1 });
      expect(r.motionScale()).toBe(1);
    }
  });

  it('a slow GPU (M7-A0 gate section 3: 61, 224 and 396 ms gaps with 1-4 ms draws) still steps down to ratio 1', () => {
    // A GPU-bound frame: the gap follows the pixel count (the scale squared); the CPU draw stays short whatever the GPU does.
    for (const full of [61, 224, 396]) {
      for (const drawMs of [1, 4]) {
        const r = new AdaptiveResolution();
        r.setBase(2);
        let now = 0;
        for (let i = 0; i < 600; i++) {
          const gap = full * r.motionScale() ** 2;
          now += gap;
          r.observe(now, gap, { drawMs });
        }
        expect(r.motionScale() * 2, `${full} ms, draw ${drawMs} ms`).toBe(MIN_PIXEL_RATIO);
      }
    }
  });

  it('a slow GPU is lowered within its first two runs, before any judgement of effect', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN, 61, { drawMs: 4 });
    expect(r.motionScale()).toBeLessThan(1);
  });

  it('a step down that did not help is undone and gaps are ignored until a frame at the display rate', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    let now = feed(r, 0, RUN, 80, { drawMs: 2 });
    expect(r.motionScale()).toBeLessThan(1);
    now = feed(r, now, RUN, 80, { drawMs: 2 });
    expect(r.motionScale()).toBe(1);
    // Stalled: more of the same does not try again.
    now = feed(r, now, RUN * 4, 80, { drawMs: 2 });
    expect(r.motionScale()).toBe(1);
    // A frame at the display rate ends the stall; a real slow run (long draws) lowers it again.
    now = feed(r, now, 1, 16, { drawMs: 2 });
    feed(r, now, RUN, 40, { drawMs: 30 });
    expect(r.motionScale()).toBeLessThan(1);
  });

  it('slow frames that are the scene’s own cost (long draws) still lower it, so the policy is not simply off', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN * 2, SLOW_MS + 15, { drawMs: SLOW_MS + 10 });
    expect(r.motionScale()).toBeLessThan(1);
    // And slow gaps without a draw time (the old callers) count as before.
    const q = new AdaptiveResolution();
    q.setBase(2);
    feed(q, 0, RUN * 2, SLOW_MS + 15);
    expect(q.motionScale()).toBeLessThan(1);
  });

  it('a hidden gap in the middle of a slow run ends the run: the count starts again', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    let now = feed(r, 0, RUN - 1, 40, { drawMs: 30 });
    now += 5000;
    r.observe(now, 5000, { hidden: true });
    feed(r, now, RUN - 1, 40, { drawMs: 30 });
    expect(r.motionScale()).toBe(1);
  });

  it('tells foreign gaps apart: hidden always; throttled only when the gap is a second long and the draw short', () => {
    expect(foreignGap(16, { hidden: true })).toBe(true);
    // A long gap with a short draw is judged by effect (see above), only a throttled window's is dropped outright.
    expect(foreignGap(COVERED_GAP_MS, { drawMs: 1 })).toBe(false);
    expect(foreignGap(THROTTLED_GAP_MS, { drawMs: 1 })).toBe(true);
    expect(foreignGap(THROTTLED_GAP_MS, { drawMs: 40 })).toBe(false);
    expect(foreignGap(200, { drawMs: 40 })).toBe(false);
    expect(foreignGap(200)).toBe(false);
  });

  it('the table at rest is drawn at the full ratio after REST_AFTER_MS, whatever the motion scale', () => {
    // scene/table-scene.ts scaleFor(rest) returns 1 for the rest frame; the policy's motion scale is only for runs.
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN * 3, 60, { drawMs: 50 });
    expect(r.motionScale()).toBeLessThan(1);
    expect(REST_AFTER_MS).toBeGreaterThan(0);
    r.pause();
    // A pause keeps the motion scale for the next run (no thrash) but never touches the rest frame's full ratio.
    expect(r.motionScale()).toBeLessThan(1);
  });
});
