/**
 * Request limiter for the Scryfall API (DESIGN "Specification: card data, packs and draft formats", Scryfall access):
 * at most 2 requests per second across all calls, and a 30 s pause after a 429.
 *
 * The rate is a sliding window: a request may start only if fewer than `perWindow` requests started in the last
 * `windowMs`. Requests start in the order they were scheduled.
 */

/** Requests allowed per window (DESIGN: 2 requests/s). */
export const SCRYFALL_REQUESTS_PER_SECOND = 2;
/** Pause after a 429 (DESIGN: a 429 locks the client out for 30 s). */
export const SCRYFALL_BACKOFF_MS = 30_000;

export interface LimiterOptions {
  perWindow?: number;
  windowMs?: number;
  backoffMs?: number;
  /** Clock in ms; defaults to Date.now (faked by Vitest fake timers). */
  now?: () => number;
}

interface Pending {
  run: () => void;
}

export class RateLimiter {
  readonly perWindow: number;
  readonly windowMs: number;
  readonly backoffMs: number;
  private readonly now: () => number;
  /** Start times of the most recent requests, oldest first, at most `perWindow` entries. */
  private starts: number[] = [];
  private queue: Pending[] = [];
  private blockedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: LimiterOptions = {}) {
    this.perWindow = opts.perWindow ?? SCRYFALL_REQUESTS_PER_SECOND;
    this.windowMs = opts.windowMs ?? 1000;
    this.backoffMs = opts.backoffMs ?? SCRYFALL_BACKOFF_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Runs `task` once a slot is free; the slot is taken when the task starts. */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: () => {
          let p: Promise<T>;
          try {
            p = task();
          } catch (e) {
            p = Promise.reject(e);
          }
          p.then(resolve, reject);
        },
      });
      this.pump();
    });
  }

  /** Blocks every request (queued or new) for the back-off time from now, e.g. after a 429. */
  backOff(ms: number = this.backoffMs): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pump();
  }

  /** Requests waiting for a slot. */
  get pending(): number {
    return this.queue.length;
  }

  private earliestStart(): number {
    const windowFree = this.starts.length < this.perWindow ? 0 : this.starts[0]! + this.windowMs;
    return Math.max(windowFree, this.blockedUntil);
  }

  private pump(): void {
    if (this.timer !== null) return;
    while (this.queue.length > 0) {
      const t = this.now();
      const at = this.earliestStart();
      if (at > t) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, at - t);
        return;
      }
      this.starts.push(t);
      if (this.starts.length > this.perWindow) this.starts.shift();
      this.queue.shift()!.run();
    }
  }
}

/** The one limiter shared by every Scryfall API call in the page. */
export const scryfallLimiter = new RateLimiter();
