/**
 * The sequencer role and the replica (DESIGN "Specification: network protocol and secrecy", Sequencing 1-5, Sync).
 * Contracts: M1-C (net/types.ts Sequencer, SyncEngine). Implementer: M1-P1.
 */
import type { CoreGameSpec, SeatId, TableState } from '../core/types';
import type { PeerRole } from './messages';
import type { PeerInfo, Sequencer, SyncEngine } from './types';

/** A sequencer continuing after `lastSeq` (DESIGN "Specification: network protocol and secrecy", Sequencing 3). Implementer: M1-P1 (the stub throws). */
export function createSequencer(_lastSeq: number): Sequencer {
  throw new Error('not implemented: M1-P1');
}

/** A replica starting from a snapshot (DESIGN "Specification: network protocol and secrecy", Sequencing 4). Implementer: M1-P1 (the stub throws). */
export function createSyncEngine(_game: CoreGameSpec, _snapshot: { seq: number; state: TableState }): SyncEngine {
  throw new Error('not implemented: M1-P1');
}

/**
 * Sequencer election (DESIGN "Specification: network protocol and secrecy", Sequencing 1): the identity peer id of
 * the connected (not away) seated player with the lowest seat index, counting this browser as `self`; spectators
 * never sequence. Implementer: M1-P1 (the stub returns null).
 */
export function electSequencer(_state: TableState, _self: { peerId: string; seat: SeatId | null; role: PeerRole }, _peers: readonly PeerInfo[]): string | null {
  return null;
}
