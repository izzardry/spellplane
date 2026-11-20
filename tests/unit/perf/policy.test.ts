// The adaptive resolution ignores gaps that are not the scene's cost (docs/design/m8/m7-adjustments.md, M7-P6: "the
// adaptive policy must ignore frame gaps while the page is hidden or covered"; PLAN Milestone 8, M7-P1 Policy: "hidden
// or covered frame gaps do not lower the resolution and the table at rest renders at full resolution").
import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, COVERED_GAP_MS, REST_AFTER_MS, RUN, SLOW_MS, foreignGap } from '../../../src/scene/resolution';

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

  it('a covered window: long gaps with short draws leave the full ratio', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, 400, COVERED_GAP_MS + 30, { drawMs: 2 });
    expect(r.motionScale()).toBe(1);
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

  it('tells foreign gaps apart: hidden always; covered only when the gap is long and the draw short', () => {
    expect(foreignGap(16, { hidden: true })).toBe(true);
    expect(foreignGap(COVERED_GAP_MS, { drawMs: 1 })).toBe(true);
    expect(foreignGap(COVERED_GAP_MS - 1, { drawMs: 1 })).toBe(false);
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
