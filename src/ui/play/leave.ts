/**
 * Leaving a table (docs/design/m8/contracts.md Part C "Leave"; journey.md 4.10 "Leaving"): checkpoint, `session.leave()`,
 * go Home, one toast. No confirmation. A basic version by M8-C (the purge of a short solo game is M8-P2's); M8-P2 owns
 * the file.
 */
import type { GameStore } from '../../store/types';
import type { TableSession } from '../../session/types';
import { toasts } from '../design/toasts';
import type { TableKind } from '../table/types';

export type { TableKind };

/** The toast after leaving a networked table (journey.md 4.10). */
export const LEFT_NETWORKED = 'You left the table. The game goes on; your seat is kept.';
/** The toast after leaving a computer or practice table (contracts.md Part G "Journey and Home" item 2). */
export const LEFT_SOLO = 'Game saved. Continue any time.';

/** What leaving needs (contracts.md Part C: `leaveTable({ session, kind, code, games, go })`). */
export interface LeaveOptions {
  session: TableSession;
  kind: TableKind;
  /** The game code (room id); null in the sandbox. */
  code: string | null;
  games: GameStore | null;
  /** Navigate to a hash. */
  go(hash: string): void;
  /** The frame's checkpointer (its `now('leave')` runs first). */
  checkpointer?: { now(reason: 'leave'): Promise<void> } | null;
  /** The room key of a networked table, for the REJOIN action. */
  key?: string;
}

/** What leaving did. */
export type LeaveOutcome = 'left' | 'purged' | 'sandbox';

/** The hash that reopens a left table. */
function reopenHash(o: LeaveOptions): string | null {
  if (!o.code) return null;
  if (o.kind === 'computer') return `#/c/${encodeURIComponent(o.code)}`;
  if (o.kind === 'practice') return `#/p/${encodeURIComponent(o.code)}`;
  return o.key ? `#/t/${encodeURIComponent(o.code)}/${encodeURIComponent(o.key)}` : null;
}

/** Leave the table: save, leave, Home, one toast (contracts.md Part C). The sandbox only goes Home. */
export async function leaveTable(o: LeaveOptions): Promise<LeaveOutcome> {
  if (o.kind === 'sandbox') {
    o.go('#/');
    return 'sandbox';
  }
  await o.checkpointer?.now('leave').catch(() => undefined);
  await o.session.leave().catch(() => undefined);
  o.go('#/');
  const again = reopenHash(o);
  const solo = o.kind === 'computer' || o.kind === 'practice';
  toasts.info(solo ? LEFT_SOLO : LEFT_NETWORKED, again ? { label: solo ? 'Continue' : 'Rejoin', run: () => o.go(again) } : undefined);
  return 'left';
}
