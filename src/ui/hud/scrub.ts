/**
 * Life scrubbing on a DOM plate (docs/design/m7-hud-proposal.md, Life steppers; PLAN Milestone 7, Owner decisions:
 * "life totals you click or scrub"; scene/types.ts LIFE_SCRUB). A press that moves less than the slop and lifts within
 * the click time is a click; otherwise every `pxPerPoint` of drag up or right is one point gained, down or left one
 * point lost. Pure: the plate feeds it pointer positions and times.
 */
import { LIFE_SCRUB } from '../../scene/types';

export interface ScrubOptions {
  pxPerPoint: number;
  slopPx: number;
  clickMs: number;
}

/** Whole points for a drag of (dx, dy) screen px: up (negative dy) and right are positive; truncated toward zero. */
export function scrubSteps(dx: number, dy: number, pxPerPoint: number = LIFE_SCRUB.pxPerPoint): number {
  const along = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
  const steps = Math.trunc(along / pxPerPoint);
  return steps === 0 ? 0 : steps;
}

/** What a press on a plate turned out to be. */
export type ScrubResult = { kind: 'click' } | { kind: 'scrub'; steps: number } | { kind: 'none' };

/** One press on a life plate, from pointerdown to pointerup. */
export class LifeScrub {
  private start: { x: number; y: number; t: number } | null = null;
  private moved = false;

  constructor(private readonly opts: ScrubOptions = LIFE_SCRUB) {}

  get active(): boolean {
    return this.start !== null;
  }

  /** Whether the press left the slop: it scrubs now and is no longer a click. */
  get scrubbing(): boolean {
    return this.moved;
  }

  down(x: number, y: number, t: number): void {
    this.start = { x, y, t };
    this.moved = false;
  }

  /** The whole points scrubbed so far (0 within the slop). */
  move(x: number, y: number): number {
    const s = this.start;
    if (!s) return 0;
    return this.track(x, y, s);
  }

  up(x: number, y: number, t: number): ScrubResult {
    const s = this.start;
    this.start = null;
    if (!s) return { kind: 'none' };
    const steps = this.track(x, y, s);
    if (!this.moved && t - s.t <= this.opts.clickMs) return { kind: 'click' };
    if (!this.moved) return { kind: 'none' };
    return steps === 0 ? { kind: 'none' } : { kind: 'scrub', steps };
  }

  cancel(): void {
    this.start = null;
    this.moved = false;
  }

  private track(x: number, y: number, s: { x: number; y: number }): number {
    if (!this.moved && Math.hypot(x - s.x, y - s.y) > this.opts.slopPx) this.moved = true;
    return this.moved ? scrubSteps(x - s.x, y - s.y, this.opts.pxPerPoint) : 0;
  }
}
