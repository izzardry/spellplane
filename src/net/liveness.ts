/**
 * The page's own running time, the clock that peer liveness is judged on (gate M8 round 3, C1).
 *
 * A page judges a peer away (the engine) or gone (the BroadcastChannel transport) when it has not heard it for a while.
 * Measured on the wall clock, a page whose own main thread stalls (a theme's shaders compiling under software GL, a
 * busy machine) sees every peer fall silent: their messages wait in its queue, or the stall is the whole machine's and
 * the peers stall with it. A guard that skips judging on one tick that ran very late does not cover a stall that comes
 * in several shorter chunks (CI: a theme switch on a two-core runner claimed the sequencer and marked the other seat
 * away). So liveness runs on this clock instead: it advances with each timer run by the time since the previous run,
 * but by at most `cap` (twice the nominal interval) while the page is visible. A page's own lateness therefore never
 * counts towards a peer's silence; a peer is judged only after that much of this page's own on-time running without
 * hearing from it. A clock that jumps (a laptop waking, a wall-clock adjustment) counts at most one capped run forward
 * and nothing backward.
 *
 * A hidden page's timers are slowed by the browser on purpose (about one run a second), not stalled: there each run
 * counts up to `hiddenCap`, the stall bound, as before.
 */

/** Whether the page is hidden (its timers are throttled by the browser); false outside a browser. */
export function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export interface OwnClockOptions {
  /** The most one run counts while the page is visible (ms). */
  cap: number;
  /** The most one run counts while the page is hidden (ms). */
  hiddenCap: number;
  /** Whether the page is hidden now; default `pageHidden`. */
  hidden?: () => boolean;
}

export class OwnClock {
  private total = 0;
  private last: number | null = null;
  private readonly hidden: () => boolean;

  constructor(private readonly opts: OwnClockOptions) {
    this.hidden = opts.hidden ?? pageHidden;
  }

  /** What `elapsed` ms since the last run count for. */
  private credit(elapsed: number): number {
    return Math.min(Math.max(0, elapsed), this.hidden() ? this.opts.hiddenCap : this.opts.cap);
  }

  /**
   * A timer run at `now` (the caller's clock, ms): advances the own running time; returns the ms since the previous run (0 at
   * the first, and after the page clock went back, which counts nothing).
   */
  step(now: number): number {
    const elapsed = this.last === null ? 0 : Math.max(0, now - this.last);
    this.total += this.credit(elapsed);
    this.last = now;
    return elapsed;
  }

  /** The own running time at `now` (between runs: the last run's plus what has passed since, capped). */
  at(now: number): number {
    return this.last === null ? this.total : this.total + this.credit(now - this.last);
  }
}
