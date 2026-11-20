/**
 * Leaving a table (contracts.md Part C "Leave"; journey.md 4.10 "Leaving", J17; contracts.md Part G "History and
 * saving" item 2): checkpoint, `session.leave()`, dispose, go Home, one toast. No confirmation. A solo game with fewer
 * than 10 own actions is purged instead and shows no toast. M8-P2.
 */
import { countOwnActions } from '../../session/summary';
import type { TableSession } from '../../session/types';
import type { GameStore } from '../../store/types';
import { toasts } from '../design/toasts';
import type { TableKind } from '../table/types';
import { computerHash, practiceHash, roomHash, type ToastAction } from './launch';

export type { TableKind };

/** The toast after leaving a networked table (journey.md 4.10). */
export const LEFT_NETWORKED = 'You left the table. The game goes on; your seat is kept.';
/** The toast after leaving a computer or practice table (contracts.md Part G "Journey and Home" item 2). */
export const LEFT_SOLO = 'Game saved. Continue any time.';
/** A solo game left after fewer own actions is not kept (contracts.md Part G "History and saving" item 2). */
export const SOLO_KEEP_MIN_ACTIONS = 10;

export interface LeaveOptions {
  session: TableSession;
  kind: TableKind;
  /** The game code (room id); null in the sandbox. */
  code: string | null;
  games: GameStore | null;
  /** Navigate to a hash. */
  go(hash: string): void;
  /** The frame's checkpointer (its `now('leave')` runs first). */
  checkpointer?: { now(reason: 'leave'): Promise<void>; stop?(): void; settled?(): Promise<void> } | null;
  /** Show the one toast (default: the page's toast store). */
  toast?(text: string, action?: ToastAction): void;
  /** The room key of a networked table (else read from the game's summary). */
  key?: string;
  /** Upper bound on the leave checkpoint, ms (persistence.md section 2: at most 1.5 s). */
  checkpointMs?: number;
}

/** What leaving did, for tests and the frame. */
export type LeaveOutcome = 'left' | 'purged' | 'sandbox';

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

/** Leave the table: save, leave, dispose, Home, one toast (contracts.md Part C). */
export async function leaveTable(o: LeaveOptions): Promise<LeaveOutcome> {
  // The sandbox lives for the page (decision M8-C): leaving it only goes Home.
  if (o.kind === 'sandbox' || o.code === null) {
    o.go('#/');
    return 'sandbox';
  }
  const toast = o.toast ?? ((text: string, action?: ToastAction): void => void toasts.info(text, action));
  const solo = o.kind === 'computer' || o.kind === 'practice';
  const ms = o.checkpointMs ?? 1500;
  let purge = false;
  if (solo) {
    // Counted over the whole game, never from a log tail alone: a reopened solo session holds only the log after its
    // stored snapshot, so the stored summary's count is the floor and an unknown count keeps the game.
    try {
      const prior = (await o.games?.get(o.code).catch(() => null)) ?? null;
      const count = countOwnActions(o.session.log(), o.session.seat, o.session.getState().seq, prior);
      purge = count.exact && count.n < SOLO_KEEP_MIN_ACTIONS;
    } catch {
      purge = false;
    }
  }
  if (!purge && o.checkpointer) await within(o.checkpointer.now('leave'), ms);
  o.checkpointer?.stop?.();
  // Before a purge, let every write already queued land first, or it would bring a row back after the purge.
  if (purge) {
    if (o.checkpointer?.settled) await within(o.checkpointer.settled(), ms);
    await within(o.session.whenSaved(), ms);
  }
  await within(o.session.leave(), ms);
  try {
    o.session.dispose();
  } catch {
    /* already disposed by leave */
  }
  if (purge) await o.games?.purge(o.code).catch(() => undefined);
  o.go('#/');
  if (purge) return 'purged';
  const code = o.code;
  if (solo) {
    const hash = o.kind === 'computer' ? computerHash(code) : practiceHash(code);
    toast(LEFT_SOLO, { label: 'Continue', run: () => o.go(hash) });
  } else {
    const key = o.key ?? (await o.games?.get(code).catch(() => null))?.key ?? '';
    toast(LEFT_NETWORKED, { label: 'Rejoin', run: () => o.go(roomHash(code, key)) });
  }
  return 'left';
}
