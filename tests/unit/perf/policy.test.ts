// The adaptive resolution ignores gaps that are not the scene's cost (docs/design/m8/m7-adjustments.md, M7-P6: "the
// adaptive policy must ignore frame gaps while the page is hidden or covered"; PLAN Milestone 8, M7-P1 Policy: "hidden
// or covered frame gaps do not lower the resolution and the table at rest renders at full resolution").
import { describe, expect, it } from 'vitest';
import {
  AdaptiveResolution,
  COVERED_GAP_MS,
  MIN_PIXEL_RATIO,
  PROBE_MEMORY_MS,
  REST_AFTER_MS,
  RUN,
  SLOW_MS,
  THROTTLED_GAP_MS,
  foreignGap,
  frameScale,
  restDue,
} from '../../../src/scene/resolution';

/** A gap rounded up to a whole number of 60 Hz frames. */
const vsync = (ms: number): number => Math.ceil(ms / (1000 / 60) - 1e-9) * (1000 / 60);

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

  it('a slow GPU that pays a share of each frame whatever the pixels, with gaps on vsync multiples, stays lowered', () => {
    // The reviewer's cases: base ratio 2, draws of 2 ms, gaps rounded up to multiples of a 60 Hz frame.
    const cases: [full: number, fixed: number][] = [
      [66, 0.3],
      [61, 0.5],
      [66, 0.5],
      [55, 0.5],
      [80, 0.5],
      [100, 0.5],
    ];
    for (const [full, fixed] of cases) {
      const r = new AdaptiveResolution();
      r.setBase(2);
      let now = 0;
      let changes = 0;
      let last = r.motionScale();
      // Five runs of 40 frames, each a drag or pan ended by a pause.
      for (let run = 0; run < 5; run++) {
        for (let i = 0; i < 40; i++) {
          const gap = vsync(full * (fixed + (1 - fixed) * r.motionScale() ** 2));
          now += gap;
          r.observe(now, gap, { drawMs: 2 });
          if (r.motionScale() !== last) changes++;
          last = r.motionScale();
        }
        expect(r.motionScale() * 2, `${full} ms, ${fixed * 100} % fixed, run ${run}`).toBe(MIN_PIXEL_RATIO);
        now += 2000;
        r.pause();
      }
      // One step down to the floor, and no step-down-then-undo per run.
      expect(changes, `${full} ms, ${fixed * 100} % fixed`).toBe(1);
    }
  });

  it('a covered window probes once: a failed probe is remembered across runs', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    let now = 0;
    let changes = 0;
    let last = r.motionScale();
    for (let run = 0; run < 5; run++) {
      for (let i = 0; i < 40; i++) {
        now += 100;
        r.observe(now, 100, { drawMs: 2 });
        if (r.motionScale() !== last) changes++;
        last = r.motionScale();
      }
      expect(r.motionScale(), `run ${run}`).toBe(1);
      now += 2000;
      r.pause();
    }
    // Down for the probe and back once, in the first run only.
    expect(changes).toBe(2);
    // Long after, a suspect run may probe again.
    now += PROBE_MEMORY_MS;
    feed(r, now, RUN, 100, { drawMs: 2 });
    expect(r.motionScale()).toBeLessThan(1);
  });

  it('the table at rest is drawn at the full ratio REST_AFTER_MS after a slow run, whatever the motion scale', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN * 3, 60, { drawMs: 50 });
    const motion = r.motionScale();
    expect(motion).toBeLessThan(1);
    // The run's frames draw at the motion scale.
    const inRun = frameScale({ rest: false, continuous: true, animated: false, motion, current: 1 });
    expect(inRun).toBe(motion);
    r.pause();
    // A pause keeps the motion scale for the next run (no thrash).
    expect(r.motionScale()).toBe(motion);
    const still = { changed: false, dirty: false, ambient: false, animated: false, renderScale: inRun };
    // Not before REST_AFTER_MS: a pause between gestures does not resize the buffers.
    expect(restDue({ ...still, sinceDrawMs: 0 })).toBe(false);
    expect(restDue({ ...still, sinceDrawMs: REST_AFTER_MS - 1 })).toBe(false);
    // At REST_AFTER_MS the still table is drawn once more, at the full ratio.
    expect(restDue({ ...still, sinceDrawMs: REST_AFTER_MS })).toBe(true);
    expect(frameScale({ rest: true, continuous: false, animated: false, motion, current: inRun })).toBe(1);
    // Drawn at the full ratio, it rests: no further rest frame.
    expect(restDue({ ...still, renderScale: 1, sinceDrawMs: REST_AFTER_MS * 10 })).toBe(false);
    // A frame after a pause that is not the rest frame (a hover) keeps the scale in effect.
    expect(frameScale({ rest: false, continuous: false, animated: false, motion, current: inRun })).toBe(inRun);
    // Anything that changes or is due is drawn as itself, not as the rest frame.
    for (const k of ['changed', 'dirty', 'ambient'] as const) expect(restDue({ ...still, [k]: true, sinceDrawMs: REST_AFTER_MS }), k).toBe(false);
  });

  it('a theme that animates by itself never rests and stays at the motion scale', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN * 3, 60, { drawMs: 50 });
    const motion = r.motionScale();
    expect(restDue({ changed: false, dirty: false, ambient: false, animated: true, renderScale: motion, sinceDrawMs: REST_AFTER_MS * 100 })).toBe(false);
    expect(frameScale({ rest: false, continuous: false, animated: true, motion, current: 1 })).toBe(motion);
  });
});
