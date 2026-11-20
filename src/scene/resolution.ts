/**
 * Adaptive render resolution (PLAN M7 A0: "adaptive resolution"; DECISIONS M7-A0). A Retina display at full pixel ratio
 * gives the GPU four times the pixels of the same window at one device pixel per CSS pixel, and a lit theme runs its
 * post-processing chain over all of them; on a large display (a 27-inch 5K screen: 14 million pixels) that is more than
 * a frame's budget in Safari. So while frames are slow the scene draws at a lower pixel ratio, and it draws the picture
 * at rest at the full ratio again:
 *
 * - The motion scale (a factor on the quality level's pixel ratio) goes down a step while the median of a run of frame
 *   costs is over SLOW_MS, never below MIN_PIXEL_RATIO device pixels per CSS pixel (text and card faces stay as sharp
 *   as on a standard display), and back up a step after a long run of frames at the display rate; a step up that is
 *   undone soon after doubles the wait before the next try.
 * - Frames in a continuous run (an animation, a drag, a pan) draw at the motion scale; a scene at rest draws once more
 *   at the full ratio REST_AFTER_MS after its last change, so a still table is always crisp. A theme that animates by
 *   itself never rests and stays at the motion scale.
 *
 * Pure: the scene passes the clock and the frame costs. A frame's cost is the time from the callback that drew it to the
 * next animation-frame callback (scene/pacing.ts); a frame drawn at a new scale also pays for the new buffers and is
 * not counted.
 */

/** Median frame cost (ms) of a run above which the motion scale goes down (under 48 fps). */
export const SLOW_MS = 21;
/** Median frame cost (ms) at or under which frames keep up with a 60 Hz display. */
export const FAST_MS = 17.5;
/** Frame costs per decision. */
export const RUN = 8;
/** A step down multiplies the pixel ratio by this; a step up divides by it. */
export const STEP = 0.8;
/** Frames at the display rate for this long before a step up; doubled after each step down, up to UP_MAX_MS. */
export const UP_AFTER_MS = 4000;
export const UP_MAX_MS = 60_000;
/** No change for this long: the scene draws at the full ratio (ms). */
export const REST_AFTER_MS = 1000;
/** The lowest pixel ratio the motion scale goes to. */
export const MIN_PIXEL_RATIO = 1;
/** Pixel ratios are multiples of this, so the buffers take only a few sizes. */
export const RATIO_QUANTUM = 0.125;

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

export class AdaptiveResolution {
  private base = 1;
  /** The motion pixel ratio as a factor on `base`. */
  private motion = 1;
  private costs: number[] = [];
  private fastSince: number | null = null;
  private upAfter = UP_AFTER_MS;
  private lastUp = -Infinity;

  constructor(private readonly enabled = true) {}

  /** The quality level's pixel ratio (the full ratio); a lowered motion scale keeps its pixel ratio where it can. */
  setBase(pixelRatio: number): void {
    const ratio = this.base * this.motion;
    const full = this.motion >= 1;
    this.base = pixelRatio > 0 ? pixelRatio : 1;
    this.motion = full ? 1 : this.quantise(Math.min(1, ratio / this.base));
    this.costs = [];
    this.fastSince = null;
  }

  /** The lowest scale: MIN_PIXEL_RATIO, or the full ratio if that is lower. */
  private floor(): number {
    return this.base > MIN_PIXEL_RATIO ? MIN_PIXEL_RATIO / this.base : 1;
  }

  /** A scale whose pixel ratio is a multiple of RATIO_QUANTUM, within [floor, 1]. */
  private quantise(scale: number): number {
    const ratio = Math.round((this.base * scale) / RATIO_QUANTUM) * RATIO_QUANTUM;
    return Math.min(1, Math.max(this.floor(), ratio / this.base));
  }

  /** The cost (ms) of a frame of a continuous run, measured at `now`. */
  observe(now: number, costMs: number): void {
    if (!this.enabled || !(costMs > 0)) return;
    this.costs.push(costMs);
    if (this.costs.length > RUN) this.costs.shift();
    if (this.costs.length < RUN) return;
    const m = median(this.costs);
    if (m > SLOW_MS) {
      this.fastSince = null;
      const next = this.quantise(this.motion * STEP);
      if (next < this.motion) {
        this.motion = next;
        this.costs = [];
        // A step up that did not hold: wait longer before the next try.
        if (now - this.lastUp < 2 * UP_AFTER_MS) this.upAfter = Math.min(UP_MAX_MS, this.upAfter * 2);
      }
      return;
    }
    if (m > FAST_MS || this.motion >= 1) {
      this.fastSince = null;
      return;
    }
    this.fastSince ??= now;
    if (now - this.fastSince >= this.upAfter) {
      this.motion = this.quantise(this.motion / STEP);
      this.fastSince = null;
      this.costs = [];
      this.lastUp = now;
    }
  }

  /** A run of frames ended (the scene went idle): the next run starts its own count. */
  pause(): void {
    this.costs = [];
    this.fastSince = null;
  }

  /** The scale for a frame of a continuous run. */
  motionScale(): number {
    return this.enabled ? this.motion : 1;
  }
}
