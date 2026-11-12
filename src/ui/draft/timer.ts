/**
 * The pick timer as the HUD shows it (DESIGN "Specification: card data, packs and draft formats": 45 s for the first
 * pick of a pack, 3 s less per pick, at least 10 s; "Specification: network protocol and secrecy", Timers: only the
 * sequencer's clock decides, the display is local). DraftPrivateView.timer says the timer runs `ms` from the moment
 * this browser applied seq `fromSeq`; SeqClock remembers when each seq was applied here.
 */

export class SeqClock {
  /** Seq → local time it was first seen, ascending by seq. */
  private seen: { seq: number; at: number }[] = [];

  constructor(private readonly limit = 256) {}

  /** Note that the state reached `seq` at local time `now` (the first sighting of a seq counts). */
  observe(seq: number, now: number): void {
    const last = this.seen[this.seen.length - 1];
    if (last && seq <= last.seq) return;
    this.seen.push({ seq, at: now });
    if (this.seen.length > this.limit) this.seen.splice(0, this.seen.length - this.limit);
  }

  /**
   * When seq `seq` was applied here: the first sighting of a seq at or after it. Null when this page has not seen it
   * yet; a seq older than everything seen (a reload) counts from the first sighting.
   */
  appliedAt(seq: number): number | null {
    for (const e of this.seen) if (e.seq >= seq) return e.at;
    return null;
  }
}

/** Remaining ms of a pick timer, clamped at 0; null when off or not yet started here. */
export function remainingMs(timer: { fromSeq: number; ms: number } | null, clock: SeqClock, now: number): number | null {
  if (!timer) return null;
  const at = clock.appliedAt(timer.fromSeq);
  if (at === null) return timer.ms;
  return Math.max(0, timer.ms - Math.max(0, now - at));
}

/** m:ss, rounded up so the display reaches 0:00 only when the time is up. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The last seconds are shown as urgent. */
export const URGENT_MS = 10_000;
