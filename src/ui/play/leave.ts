/**
 * Leaving a table (contracts.md Part C "Leave"; journey.md 4.10 "Leaving", J17; contracts.md Part G "History and
 * saving" item 2): checkpoint, `session.leave()`, dispose, go Home, one toast. No confirmation. A solo game with fewer
 * than 10 own actions is purged instead and shows no toast. M8-P2.
 */
import { countOwnActions } from '../../session/summary';
import type { SaveState, TableSession } from '../../session/types';
import type { ComputerStore, GameStore, TableStore } from '../../store/types';
import { toasts } from '../design/toasts';
import type { TableKind } from '../table/types';
import { computerHash, practiceHash, roomHash, type ToastAction } from './launch';

export type { TableKind };

/** The toast after leaving a networked table (journey.md 4.10). */
export const LEFT_NETWORKED = 'You left the table. The game goes on; your seat is kept.';
/** The toast after leaving a computer or practice table (contracts.md Part G "Journey and Home" item 2). */
export const LEFT_SOLO = 'Game saved. Continue any time.';
/** The toast after leaving a solo table in a browser that keeps no games (storage blocked): no CONTINUE. */
export const LEFT_SOLO_UNSAVED = 'This browser does not keep games, so this one was not saved.';
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
  checkpointer?: { now(reason: 'leave'): Promise<void>; stop?(): void; settled?(): Promise<void>; saveState?(): SaveState } | null;
  /** Show the one toast (default: the page's toast store). */
  toast?(text: string, action?: ToastAction): void;
  /** The room key of a networked table (else read from the game's summary). */
  key?: string;
  /** Upper bound on the leave checkpoint, ms (persistence.md section 2: at most 1.5 s). */
  checkpointMs?: number;
  /**
   * A computer game's own purge (computer.md 2.5), run after the human's session is disposed and before Home: the route
   * disposes Sparring's handle (its last saves) and then deletes both tables and the computer record, which waits for
   * those saves, so none of them writes a row back.
   */
  purgeComputer?: () => Promise<void>;
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
  // A purged computer game also drops both tables and Sparring's record (computer.md 2.5): the route's purge disposes
  // Sparring first, so its last saves land before the delete. Home does not wait past the bound; the delete goes on.
  if (purge && o.kind === 'computer' && o.purgeComputer) await within(o.purgeComputer(), ms);
  o.go('#/');
  if (purge) return 'purged';
  const code = o.code;
  if (solo && o.games === null && o.checkpointer?.saveState?.() === 'notSaving') {
    // Nothing was saved (no games store: storage blocked, and the frame's checkpointer says so): nothing to continue.
    toast(LEFT_SOLO_UNSAVED);
  } else if (solo) {
    const hash = o.kind === 'computer' ? computerHash(code) : practiceHash(code);
    toast(LEFT_SOLO, { label: 'Continue', run: () => o.go(hash) });
  } else {
    const key = o.key ?? (await o.games?.get(code).catch(() => null))?.key ?? '';
    toast(LEFT_NETWORKED, { label: 'Rejoin', run: () => o.go(roomHash(code, key)) });
  }
  return 'left';
}

/** The stores a computer game was saved into (session/computer deleteComputerGame). */
export type ComputerStores = { tables: TableStore | null; computer: ComputerStore | null };

/**
 * The purge of a short computer game for `LeaveOptions.purgeComputer` (computer.md 2.5): dispose Sparring's handle (its
 * runner, the bot session and the record's last write), then delete both tables and the record once those saves have
 * landed. Without `stores` the delete takes the page's (session/computer provideComputerDeps). M8-P8.
 */
export function computerPurge(handle: { dispose(): void }, roomId: string, stores?: ComputerStores | null): () => Promise<void> {
  return async () => {
    handle.dispose();
    const m = await import('../../session/computer');
    await m.deleteComputerGame(roomId, stores ?? undefined);
  };
}
