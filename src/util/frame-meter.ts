/**
 * The frame meter (PLAN M7 A0: an on-screen fps and frame-time meter, so the owner reports numbers instead of
 * impressions). The table scene calls `tick` once per animation-frame callback, saying whether that callback drew a
 * frame; the meter keeps the last few seconds and reports frames per second, frame times and the render size. The
 * overlay (ui/perf/FrameMeter.svelte) reads `snapshot()` a few times a second; scripts read the same numbers through
 * the debug hook (`__spellplane.fps`, dev and test builds) or `window.__spellplaneFps` (every build, while the meter
 * is shown), and `begin`/`end` measure one phase of a scripted scenario (scripts/perf/measure.mjs).
 *
 * What the numbers mean:
 * - A frame's time is the gap from the callback that drew it to the next callback. The browser hands out the next
 *   animation frame once the last drawn one is done, GPU work included, so this is what a drawn frame really cost
 *   the page (bounded below by the display's refresh interval).
 * - fps is drawn frames per second over the window. A scene that draws on demand draws nothing while nothing moves:
 *   the meter then says "idle" instead of a low fps.
 * - max is the longest gap between any two callbacks in the window, drawn or not: a stall from layout, a long task or
 *   a texture upload shows there even when no frame was drawn around it.
 * Gaps longer than HIDDEN_GAP_MS (a hidden tab, a debugger pause) are not frames and are left out.
 *
 * Pure apart from what the caller passes in: no clock of its own, so the statistics are unit-tested.
 */
import { registerDebug } from './debug';

/** The window the overlay reports over, ms. */
export const METER_WINDOW_MS = 2000;
/** No frame drawn for this long: the loop is idle. */
export const IDLE_AFTER_MS = 500;
/** A gap this long is a hidden tab or a pause, not a frame. */
export const HIDDEN_GAP_MS = 1000;
/** Callbacks kept (a 2 s window at 240 Hz fits). */
const CAPACITY = 1024;

/** What the renderer reports about itself. */
export interface RenderInfo {
  /** Drawing buffer size, device pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel the canvas renders at (the quality cap times the adaptive render scale). */
  pixelRatio: number;
  /** The display's own device pixel ratio. */
  devicePixelRatio: number;
  /** Adaptive render scale, 1 = the quality level's pixel ratio. */
  renderScale: number;
  theme: string;
  quality: string;
  /** Post-processing passes, [] with post off. */
  post: string[];
  shadows: boolean;
  /** Draw times include the GPU's work (`?render=sync`: the scene waits for each frame to finish; measuring only). */
  sync: boolean;
}

/** Statistics over a set of frame times. */
export interface FrameTimes {
  /** Frames drawn. */
  frames: number;
  /** Drawn frames per second. */
  fps: number;
  /** Median and 95th percentile of drawn frames' times, ms (0 with no frame). */
  p50: number;
  p95: number;
  /** Longest gap between two callbacks, drawn or not, ms. */
  max: number;
  /** Animation-frame callbacks per second (the display rate while the page keeps up). */
  callbacks: number;
  /**
   * Median and 95th percentile of the time the scene spent drawing a frame, ms: main-thread work, plus the GPU's with
   * `?render=sync`. Unlike the frame time it is not rounded up to the display's refresh interval.
   */
  drawP50: number;
  drawP95: number;
}

export interface MeterSnapshot extends FrameTimes {
  /** No frame drawn in the last IDLE_AFTER_MS. */
  idle: boolean;
  /** Window the numbers cover, ms. */
  windowMs: number;
  render: RenderInfo | null;
}

/** The value at quantile q (0..1) of ascending `sorted`, nearest rank; 0 for none. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

/**
 * Statistics of callbacks at times `t` (ascending, ms), `drew[i]` whether callback i drew, over `spanMs`. A drawn
 * callback's frame time is the gap to the next callback; the last callback's frame has no end yet and is not counted.
 * A hidden-tab gap still counts its callback (the span includes it), but not as a frame time.
 */
export function frameTimes(t: readonly number[], drew: readonly boolean[], spanMs: number, work: readonly number[] = []): FrameTimes {
  const times: number[] = [];
  const draws: number[] = [];
  let frames = 0;
  let max = 0;
  let callbacks = 0;
  // A callback counts once its frame has ended (the next callback came), so N steady callbacks over a span of N - 1
  // intervals read as the true rate.
  for (let i = 0; i + 1 < t.length; i++) {
    callbacks++;
    if (drew[i]) {
      frames++;
      if (work[i] !== undefined) draws.push(work[i]!);
    }
    const gap = t[i + 1]! - t[i]!;
    if (!(gap >= 0) || gap > HIDDEN_GAP_MS) continue;
    if (gap > max) max = gap;
    if (drew[i]) times.push(gap);
  }
  times.sort((a, b) => a - b);
  draws.sort((a, b) => a - b);
  const span = spanMs > 0 ? spanMs / 1000 : 0;
  return {
    frames,
    fps: span > 0 ? frames / span : 0,
    p50: quantile(times, 0.5),
    p95: quantile(times, 0.95),
    max,
    callbacks: span > 0 ? callbacks / span : 0,
    drawP50: quantile(draws, 0.5),
    drawP95: quantile(draws, 0.95),
  };
}

/** Records animation-frame callbacks and reports over the last METER_WINDOW_MS, or over a phase. */
export class FrameMeter {
  private readonly t = new Float64Array(CAPACITY);
  private readonly d = new Uint8Array(CAPACITY);
  private readonly w = new Float32Array(CAPACITY);
  private head = 0;
  private count = 0;
  private lastDrawn = -Infinity;
  private info: (() => RenderInfo) | null = null;
  /** A phase being measured: every callback since `begin`. */
  private phase: { t: number[]; d: boolean[]; w: number[]; from: number } | null = null;

  /** One animation-frame callback at `now` (ms), which drew a frame (taking `drawMs`) or not. */
  tick(now: number, drew: boolean, drawMs = 0): void {
    this.t[this.head] = now;
    this.d[this.head] = drew ? 1 : 0;
    this.w[this.head] = drawMs;
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
    if (drew) this.lastDrawn = now;
    if (this.phase) {
      this.phase.t.push(now);
      this.phase.d.push(drew);
      this.phase.w.push(drawMs);
    }
  }

  /** Where the render size, theme and quality come from (asked only when a snapshot is taken). */
  setRender(source: () => RenderInfo): void {
    this.info = source;
  }

  /** The scene that gave `source` is gone (a newer scene's source stays). */
  releaseRender(source: () => RenderInfo): void {
    if (this.info === source) this.info = null;
  }

  private render(): RenderInfo | null {
    return this.info ? this.info() : null;
  }

  /** The last `windowMs` before `now`. */
  snapshot(now: number, windowMs = METER_WINDOW_MS): MeterSnapshot {
    const t: number[] = [];
    const d: boolean[] = [];
    const w: number[] = [];
    for (let k = this.count; k > 0; k--) {
      const i = (this.head - k + CAPACITY) % CAPACITY;
      const at = this.t[i]!;
      if (at < now - windowMs) continue;
      t.push(at);
      d.push(this.d[i] === 1);
      w.push(this.w[i]!);
    }
    // The window starts at the first callback in it, so a page that just started is not diluted by time before it.
    const span = t.length > 0 ? Math.min(windowMs, now - t[0]!) : windowMs;
    return { ...frameTimes(t, d, span, w), idle: now - this.lastDrawn > IDLE_AFTER_MS, windowMs: span, render: this.render() };
  }

  /** Start measuring a phase at `now` (scripts). */
  begin(now: number): void {
    this.phase = { t: [], d: [], w: [], from: now };
  }

  /** End the phase at `now` and report over it. */
  end(now: number): MeterSnapshot {
    const p = this.phase ?? { t: [], d: [], w: [], from: now };
    this.phase = null;
    const drewLast = p.d.lastIndexOf(true);
    const lastDrawnAt = drewLast >= 0 ? p.t[drewLast]! : -Infinity;
    return { ...frameTimes(p.t, p.d, now - p.from, p.w), idle: now - lastDrawnAt > IDLE_AFTER_MS, windowMs: now - p.from, render: this.render() };
  }
}

/** The page's meter: the table scene feeds it. */
export const frameMeter = new FrameMeter();

/** The frame meter as scripts see it. */
export interface FrameMeterApi {
  snapshot(windowMs?: number): MeterSnapshot;
  begin(): void;
  end(): MeterSnapshot;
}

export const frameMeterApi: FrameMeterApi = {
  snapshot: (windowMs) => frameMeter.snapshot(performance.now(), windowMs),
  begin: () => frameMeter.begin(performance.now()),
  end: () => frameMeter.end(performance.now()),
};

declare module './debug' {
  interface DebugParts {
    /** The frame meter (M7-A0): fps, frame times, render size; `begin`/`end` measure a phase. */
    fps: FrameMeterApi;
  }
}

declare global {
  interface Window {
    /** The frame meter while it is shown (every build): the same as `__spellplane.fps`. */
    __spellplaneFps?: FrameMeterApi;
  }
}

registerDebug({ fps: frameMeterApi });
