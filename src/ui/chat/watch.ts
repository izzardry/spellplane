/**
 * What the HUD notices as the log grows (PLAN M1-P6): the attribution flash when someone touches another player's
 * card (DESIGN "Decision log", Permissions: anyone may touch any public card, with attribution; the log and the
 * seat-colour flash keep it honest), the card names this browser could see just before each action (so a line keeps
 * a name the viewer knew, e.g. the card it put from its hand on the bottom of its library after a mulligan), and own
 * chat lines sent but not sequenced yet (merged into the timeline by core/log.ts mergeTimeline).
 *
 * The HUD calls `observe` from its session subscription with the state before and after the new entries, before it
 * replaces its own state. Plain TypeScript, no Svelte, so it is unit-tested directly.
 */
import type { Action } from '../../core/actions';
import { attributions, cardsMentioned } from '../../core/log';
import type { InstanceId, LogEntry, SeatId, TableState } from '../../core/types';
import { entryKeyOf } from '../describe';

/** One attribution flash: `by` touched `card`, a card of seat `of` (core/log.ts Attribution). */
export interface Flash {
  /** Unique per page. */
  id: string;
  card: InstanceId;
  of: SeatId;
  by: SeatId;
  /** The action's seq (the log entry's). */
  seq: number;
  /** The action's cid. */
  cid: string;
  /** Local wall clock when the flash started. */
  at: number;
}

/** How many past flashes the debug hook keeps. */
export const FLASH_HISTORY = 200;

export type FlashListener = (flash: Flash) => void;

export class LogWatch {
  /** The HUD's name memo for logLines (ui/describe.ts LogContext.names); filled here before lines are described. */
  readonly names = new Map<string, string | null>();
  private seen = 0;
  private n = 0;
  private readonly history: Flash[] = [];
  private readonly listeners = new Set<FlashListener>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Entries already in the log when the HUD mounts are history: they get no flash and keep the names of the state they are described with. */
  start(log: readonly LogEntry[]): void {
    this.seen = log.length;
  }

  /**
   * Look at the entries added since the last call. `before` is the state the HUD showed until now (the state the
   * first new action applied to), `after` the new one; `knownBefore(id)` is the card's name as this browser could see
   * it in `before`, or null. Returns the flashes started.
   */
  observe(log: readonly LogEntry[], before: TableState, after: TableState, knownBefore: (id: InstanceId) => string | null): Flash[] {
    // A shorter log (a rolled-back optimistic action) restarts from its end; nothing is flashed twice.
    if (log.length < this.seen) this.seen = log.length;
    const started: Flash[] = [];
    for (let i = this.seen; i < log.length; i++) {
      const e = log[i];
      if (e?.kind !== 'action') continue;
      this.remember(e.action, before, knownBefore, entryKeyOf(e));
      for (const a of attributions(e.action, before, after)) {
        const flash: Flash = { id: `f${++this.n}`, ...a, seq: e.seq, cid: e.action.cid, at: this.now() };
        started.push(flash);
        this.history.push(flash);
      }
    }
    this.seen = log.length;
    if (this.history.length > FLASH_HISTORY) this.history.splice(0, this.history.length - FLASH_HISTORY);
    for (const f of started) for (const l of this.listeners) l(f);
    return started;
  }

  private remember(a: Action, before: TableState, knownBefore: (id: InstanceId) => string | null, key: string): void {
    for (const id of cardsMentioned(a, before)) {
      const k = `${key}|${id}`;
      if (this.names.has(k)) continue;
      const name = knownBefore(id);
      // Only a known name is kept: an unknown one is looked up in the new state when the line is first described
      // (a milled card is named by the move that made it public).
      if (name) this.names.set(k, name);
    }
  }

  /** Past flashes, oldest first (debug hook). */
  flashes(): Flash[] {
    return [...this.history];
  }

  /** Called for every flash started; returns an unsubscribe function. */
  onFlash(listener: FlashListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Own chat lines sent but not yet in the session log (DESIGN "Multiplayer architecture": the own action shows at once,
 * the sequencer numbers it later). Adds the stamped action as a pending entry unless the log already has it.
 */
export function addPending(pending: readonly LogEntry[], action: Action, log: readonly LogEntry[], at: number): LogEntry[] {
  if (log.some((e) => e.kind === 'action' && e.action.cid === action.cid)) return [...pending];
  if (pending.some((e) => e.kind === 'action' && e.action.cid === action.cid)) return [...pending];
  return [...pending, { kind: 'action', seq: action.seq ?? -1, at, action }];
}

/** Drop pending lines the session log now holds (same cid). Returns `pending` itself when nothing changed. */
export function prunePending(pending: readonly LogEntry[], log: readonly LogEntry[]): readonly LogEntry[] {
  if (pending.length === 0) return pending;
  const inLog = new Set(log.flatMap((e) => (e.kind === 'action' ? [e.action.cid] : [])));
  const left = pending.filter((e) => e.kind !== 'action' || !inLog.has(e.action.cid));
  return left.length === pending.length ? pending : left;
}
