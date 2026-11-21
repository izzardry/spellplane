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
 *
 * Gaps that are not the scene's cost never lower the resolution for good (docs/design/m8/m7-adjustments.md, M7-P6:
 * "the adaptive policy must ignore frame gaps while the page is hidden or covered"):
 *
 * - While `document.visibilityState` is hidden the browser stops or throttles animation frames: such a frame is dropped
 *   and ends the run.
 * - A gap of THROTTLED_GAP_MS or more with a short draw is a window the browser has throttled (about one frame a
 *   second), far slower than any frame worth adapting to: dropped too.
 * - Below that, one long gap with a short draw cannot tell a covered window from a slow GPU (the draw is the CPU time
 *   of the render calls; a GPU-bound frame keeps it short however slow the GPU is). So such a run is judged by effect:
 *   it goes straight to the floor (MIN_PIXEL_RATIO; one 0.8 step is too small to show on a GPU whose gaps land on
 *   vsync multiples or that pays a share of each frame whatever the pixels), and if the next run's median gap is not
 *   clearly shorter there, fewer pixels did not help (a covered window is not paced by the scene's pixels; a slow GPU
 *   is): the scale goes back and gaps are ignored until a frame at the display rate arrives. A failed probe is
 *   remembered for PROBE_MEMORY_MS across runs, so each new drag or pan does not probe (and reallocate) again.
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
/**
 * A run whose median gap is at least COVERED_GAP_MS while its median draw took at most COVERED_DRAW_MS may be the browser
 * holding frames back (a covered window) or a slow GPU: its step down is kept only if it shortens the gaps.
 */
export const COVERED_GAP_MS = 50;
export const COVERED_DRAW_MS = 8;
/** A step down on such a run holds when the next run's median gap is at most this share of the one before. */
export const HELPED_RATIO = 0.9;
/** After a probe that did not help, suspect runs keep the scale for this long (ms), across pauses. */
export const PROBE_MEMORY_MS = UP_MAX_MS;
/** A gap this long (ms) with a short draw is a throttled window (about one frame a second), never the scene's cost. */
export const THROTTLED_GAP_MS = 1000;

/** What the scene knows about a frame besides its cost. */
export interface FrameContext {
  /** The page is hidden (document.visibilityState). */
  hidden?: boolean;
  /** The CPU time of the frame's render calls, ms. */
  drawMs?: number;
}

/** Whether a frame's gap says nothing about the scene's cost (a hidden page, or a window throttled to about 1 fps). */
export function foreignGap(costMs: number, ctx: FrameContext = {}): boolean {
  if (ctx.hidden) return true;
  return ctx.drawMs !== undefined && costMs >= THROTTLED_GAP_MS && ctx.drawMs <= COVERED_DRAW_MS;
}

/** Whether a run's gaps are long while its draws are short: a covered window or a slow GPU (judged by effect). */
export function suspectRun(medianCostMs: number, medianDrawMs: number | null): boolean {
  return medianDrawMs !== null && medianCostMs >= COVERED_GAP_MS && medianDrawMs <= COVERED_DRAW_MS;
}

/** What the frame loop knows when it decides whether a still table is drawn once more at the full ratio. */
export interface RestInput {
  /** The table changed this tick (a card moved, an animation ran, a face arrived). */
  changed: boolean;
  /** Something asked for a redraw (a resize, a camera change, a new theme). */
  dirty: boolean;
  /** An ambient frame is due (a ping fading, the pending pulse, the foil sheen). */
  ambient: boolean;
  /** The theme animates by itself (lights, particles): it never rests. */
  animated: boolean;
  /** The render scale of the last drawn frame (1: the full ratio). */
  renderScale: number;
  /** Time since the last drawn frame, ms. */
  sinceDrawMs: number;
}

/**
 * Whether this tick draws the rest frame: nothing changed, nothing is due, the last frame was drawn below the full
 * ratio, the theme does not animate by itself, and REST_AFTER_MS have passed since the last drawn frame.
 */
export function restDue(i: RestInput): boolean {
  return !i.changed && !i.dirty && !i.ambient && !i.animated && i.renderScale < 1 && i.sinceDrawMs >= REST_AFTER_MS;
}

/** What decides the render scale of a frame that is drawn. */
export interface FrameScaleInput {
  /** The frame is the rest frame (restDue). */
  rest: boolean;
  /** The tick before this one drew too: a continuous run (an animation, a drag, a pan). */
  continuous: boolean;
  /** The theme animates by itself. */
  animated: boolean;
  /** The adaptive resolution's motion scale (AdaptiveResolution.motionScale). */
  motion: number;
  /** The scale in effect. */
  current: number;
}

/**
 * The render scale for a drawn frame: the full ratio for the rest frame; the motion scale within a run of frames or
 * while the theme animates by itself; else the scale in effect (one frame after a pause, e.g. a hover, does not resize
 * the buffers).
 */
export function frameScale(i: FrameScaleInput): number {
  if (i.rest) return 1;
  if (i.continuous || i.animated) return i.motion;
  return i.current;
}

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
  /** The draw times of the run's frames, where the scene reported them (same order as `costs`). */
  private draws: (number | null)[] = [];
  /** A step down taken on a suspect run: the median gap before it and the scale to go back to if it did not help. */
  private probe: { before: number; scale: number } | null = null;
  /** A step down did not shorten the gaps: frames are not counted until one at the display rate (or a new run). */
  private stalled = false;
  /** When a probe last failed: suspect runs do not probe again until PROBE_MEMORY_MS later. */
  private probeFailedAt = -Infinity;
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
    this.draws = [];
    this.probe = null;
    this.fastSince = null;
    this.probeFailedAt = -Infinity;
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

  /** The cost (ms) of a frame of a continuous run, measured at `now`; a hidden or covered gap is ignored and ends the run. */
  observe(now: number, costMs: number, ctx?: FrameContext): void {
    if (!this.enabled || !(costMs > 0)) return;
    if (foreignGap(costMs, ctx)) {
      this.pause();
      return;
    }
    if (this.stalled) {
      if (costMs > FAST_MS) return;
      this.stalled = false;
    }
    this.costs.push(costMs);
    this.draws.push(ctx?.drawMs ?? null);
    if (this.costs.length > RUN) {
      this.costs.shift();
      this.draws.shift();
    }
    if (this.costs.length < RUN) return;
    const m = median(this.costs);
    const p = this.probe;
    if (p) {
      // The first full run after a step down on a suspect run: keep the step only if it shortened the gaps.
      this.probe = null;
      if (m > p.before * HELPED_RATIO) {
        this.motion = p.scale;
        this.costs = [];
        this.draws = [];
        this.fastSince = null;
        this.stalled = true;
        this.probeFailedAt = now;
        return;
      }
    }
    if (m > SLOW_MS) {
      this.fastSince = null;
      const drawn = this.draws.filter((d): d is number => d !== null);
      const suspect = suspectRun(m, drawn.length === this.draws.length ? median(drawn) : null);
      // A suspect run probes at the floor; after a failed probe it keeps the scale (fewer pixels did not help).
      if (suspect && now - this.probeFailedAt < PROBE_MEMORY_MS) {
        this.costs = [];
        this.draws = [];
        this.stalled = true;
        return;
      }
      const next = suspect ? this.floor() : this.quantise(this.motion * STEP);
      if (next < this.motion) {
        if (suspect) this.probe = { before: m, scale: this.motion };
        this.motion = next;
        this.costs = [];
        this.draws = [];
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
      this.draws = [];
      this.lastUp = now;
    }
  }

  /** A run of frames ended (the scene went idle): the next run starts its own count. */
  pause(): void {
    this.costs = [];
    this.draws = [];
    this.fastSince = null;
    // A step down still on probation stays so: the next run's first full count judges it.
    this.stalled = false;
  }

  /** The scale for a frame of a continuous run. */
  motionScale(): number {
    return this.enabled ? this.motion : 1;
  }
}
