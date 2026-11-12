/**
 * Roles on the wire: players and spectators (DESIGN "Players, seats and formats", Spectators: "A spectator joins by the
 * same link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may
 * reveal their hand to a named spectator"; "Specification: network protocol and secrecy", Sequencing 1 and 3: spectators
 * are never sequencer, and the sequencer checks that "the actor's role allows the action family").
 * Contracts: M3-C; implementer: M3-P5 (wires `roleProblem` into the sequencer's check in net/sequencer.ts and
 * `sendPrivate` to a spectator id into net/engine.ts).
 */
import type { Action, ActionType } from '../core/actions';
import type { SeatId, TableState } from '../core/types';
import type { SpectatorId } from '../core/teams';
import type { PeerRole } from './messages';
import type { PeerInfo } from './types';

export type { PeerRole };

/**
 * The action types a spectator may propose (DESIGN "Players, seats and formats", Spectators: "can chat and ping, and
 * cannot move cards"). A spectator's actions carry `by` = its spectator id (core/teams.ts `spectatorIdOf`); a `chat`
 * goes on the 'spectator' or 'table' tab and carries the spectator's nickname in `name` (DECISIONS [M3-C]).
 */
export const SPECTATOR_ACTIONS: readonly ActionType[] = ['chat', 'ping'];

/** A spectator as a player's browser knows it from the handshake (DESIGN "Players, seats and formats", Spectators: reveal to a named spectator). */
export interface SpectatorInfo {
  id: SpectatorId;
  /** Identity peer id (first 16 hex of SHA-256 of the public key). */
  peerId: string;
  nickname: string;
  /** Connected now (a spectator that left keeps no state). */
  connected: boolean;
}

/**
 * Why `sender` may not propose `action` because of its role, or null when the role allows it (DESIGN "Specification:
 * network protocol and secrecy", Sequencing 3: "the actor's role allows the action family"). For a spectator: only
 * SPECTATOR_ACTIONS, and `by` must be the sender's own spectator id. For a player: null (the seat checks stay in the
 * sequencer). Implementer: M3-P5.
 */
export function roleProblem(_state: TableState, _action: Action, _sender: { role: PeerRole; peerId: string; seat: SeatId | null }): string | null {
  throw new Error('not implemented: M3-P5');
}

/** The spectators among the engine's peers, nickname order (DESIGN "Players, seats and formats", Spectators). Implementer: M3-P5. */
export function spectatorsOf(_peers: readonly PeerInfo[]): SpectatorInfo[] {
  throw new Error('not implemented: M3-P5');
}
