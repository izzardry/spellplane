/**
 * A manual clock for Sparring's runner (the debug hook and e2e specs, computer.md section 12): timers run only when
 * `tick` advances past them. Its own small module, so the page's debug hook does not pull the bot into the main chunk.
 */
import type { BotClock } from './types';

/** A manual clock (the debug hook and e2e specs): timers run only when `tick` advances past them. */
export class ManualClock implements BotClock {
  private now = 0;
  private seq = 0;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.due.delete(handle as number);
  }
  /** Advance by `ms`, running every timer that falls due, in order. */
  tick(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.due) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = end;
  }
  pending(): number {
    return this.due.size;
  }
}
