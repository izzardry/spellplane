/**
 * Timed checkpoints of a running game into its History summary (persistence.md section 2; contracts.md Part E). Stub
 * by M8-C: both members do nothing. M8-P2 owns the file (the 20 s timer, flushes on turn pass and hide, `notSaving`).
 */
import type { GameStore } from '../store/types';
import type { TableSession } from './types';

/** Why a checkpoint is taken (persistence.md section 2). */
export type CheckpointReason = 'timer' | 'turn' | 'hide' | 'leave' | 'result';

/** A running checkpointer (contracts.md Part E). */
export interface Checkpointer {
  stop(): void;
  now(reason: CheckpointReason): Promise<void>;
}

/** Start checkpointing `session` into `games` (contracts.md Part E). Stub: no-ops. */
export function createCheckpointer(_session: TableSession, _games: GameStore | null): Checkpointer {
  return { stop: () => undefined, now: () => Promise.resolve() };
}
