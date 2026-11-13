/**
 * The post-game audit (DESIGN "Multiplayer architecture", Hidden information 6: "At game end each browser can publish
 * its nonces and order history. Peers replay them and confirm that every draw came from the committed order";
 * "Specification: network protocol and secrecy", Secret shuffle: "The audit replays every record against the public log
 * and checks that each drawn id was on top"; PLAN Milestone 5, owner decisions: "Audit: automatic at game end").
 * Contracts: M5-C. Implementer: M5-P2 (this file's functions, ui/audit/*, the session's publishing at game end).
 *
 * Shape of the protocol (DECISIONS [M5-C]):
 * - When a game ends (the sequenced `stageSet` that leaves 'match' after "Next game" or "New draft", or the evening
 *   ending; M5-P2 decides how an evening end is signalled), every seated browser proposes one public action
 *   `auditPublish {bundle}` (core/actions.ts) carrying its AuditBundle for that game. It is sequenced like any action,
 *   so every peer holds the same bundles in the same log order, persists them with the log and gets them on catch-up.
 * - Every peer verifies every bundle against the public log with the pure `verifyAudit` and shows one AuditVerdict per
 *   seat in the log and in the audit panel. All peers compute the same verdicts from the same log.
 * - A seat with no bundle (left early, storage lost) is 'unverifiable' with reason 'recordsMissing', shown neutrally as
 *   "could not be checked: records missing", never as a mismatch. 'mismatch' is reserved for records that exist and
 *   disagree with the public log.
 *
 * Secrecy: a bundle carries opaque instance ids, nonces and orders only. It never carries a card identity (`CardRef`)
 * or a commitment salt: `PublishedAuditRecord` drops `ReissueRecord.retired`, and draft `PackRecord`s are not
 * published (their cards are identities). The bundle is published only after the game it covers has ended.
 */
import type { Action } from './actions';
import type { InstanceId, SecretStore, SeatId, ShuffleId, TableState, ZoneId } from './types';

/** The span of one finished game in the shared log (DESIGN "Multiplayer architecture", Audit: "at game end"). Added by M5-C. */
export interface AuditGame {
  /** `TableState.games` after the game started (1 for the first game of the evening). */
  game: number;
  /** Seq of the first action of the game (the `stageSet` into 'match'). */
  fromSeq: number;
  /** Seq of the action that ended it (the `stageSet` out of 'match'), or the last seq when the evening ended mid-match. */
  toSeq: number;
}

/** The public form of a re-issue of opaque ids (DESIGN "Table model", Hidden cards): the old id of the card now at `order[i]`, without the retired identities. Added by M5-C. */
export interface PublishedReissue {
  before: InstanceId[];
}

/** A secret shuffle's audit record as published (DESIGN "Specification: network protocol and secrecy", Secret shuffle step 5): core/types.ts ShuffleRecord without identities. Added by M5-C. */
export interface PublishedShuffle {
  kind: 'shuffle';
  sid: ShuffleId;
  zone: ZoneId;
  ownerNonce: string;
  /** Peer nonces in seat order, as the owner folded them into the seed. */
  peerNonces: string[];
  /** Resulting order, index 0 = top. */
  order: InstanceId[];
  reissue?: PublishedReissue;
}

/** A private reorder's audit record as published (DESIGN "Specification: network protocol and secrecy": "A private reorder … is recorded the same way"): core/types.ts ReorderRecord without identities. Added by M5-C. */
export interface PublishedReorder {
  kind: 'reorder';
  zone: ZoneId;
  count: number;
  /** The nonce hashed into the public `reorder.orderHash`. */
  nonce: string;
  /** Full order after the reorder, index 0 = top. */
  order: InstanceId[];
  reissue?: PublishedReissue;
}

/** One published audit record (DESIGN "Multiplayer architecture", Audit: "nonces and order history"). Added by M5-C. */
export type PublishedAuditRecord = PublishedShuffle | PublishedReorder;

/**
 * What one browser publishes at game end (DESIGN "Multiplayer architecture", Audit; PLAN M5-P2: "publish nonces and
 * order history"). Plain JSON (it travels inside the `auditPublish` action). Added by M5-C.
 */
export interface AuditBundle {
  /** The publishing seat; equals the action's `by`. */
  seat: SeatId;
  game: AuditGame;
  /** The seat's shuffle and reorder records of this game, in the order they were made. */
  records: PublishedAuditRecord[];
  /**
   * Set when this browser knows some records of the game are gone (local save lost and restored through the recovery
   * path, PLAN M5 owner decisions: "storage lost"). The records it still has are checked; the rest are unverifiable.
   */
  incomplete?: true;
}

/** Overall result for one seat (PLAN Milestone 5, owner decisions: verified, mismatch, could not be checked). Added by M5-C. */
export type AuditStatus = 'verified' | 'mismatch' | 'unverifiable';

/** What disagreed (DESIGN "Specification: network protocol and secrecy", Secret shuffle 1–5 and draws). Added by M5-C. */
export type AuditMismatchKind =
  /** SHA-256(ownerNonce) is not the `shuffleCommit.h`. */
  | 'commit'
  /** The record's peer nonces are not the sequenced `shuffleNonce`s in seat order. */
  | 'nonces'
  /** Replaying the seed over the zone's sorted ids does not give the recorded order. */
  | 'order'
  /** The recorded order and nonce do not hash to the public `shuffleDone.orderHash` or `reorder.orderHash`. */
  | 'orderHash'
  /** A `draw` named an id that was not on top of the recorded order. */
  | 'draw'
  /** A re-issue does not map the public old ids onto the new ones. */
  | 'reissue'
  /** A public shuffle or reorder of the seat has no record although the bundle claims to be complete. */
  | 'unrecorded'
  /** The bundle is not well formed or names another seat or game. */
  | 'malformed';

/** One disagreement between a seat's records and the public log (PLAN M5-P2: "show … any mismatch"). Added by M5-C. */
export interface AuditMismatch {
  kind: AuditMismatchKind;
  /** Seq of the public action it concerns, null when none. */
  seq: number | null;
  /** The shuffle id or zone it concerns, when there is one. */
  ref?: ShuffleId | ZoneId;
  /** One plain sentence for the audit panel. */
  detail: string;
}

/** Why a seat could not be checked (PLAN Milestone 5, owner decisions: "left early, storage lost"). Added by M5-C. */
export type AuditUnverifiableReason = 'recordsMissing';

/** The audit's verdict on one seat for one game (PLAN M5-P2: "a per-player verdict and any mismatch"). Added by M5-C. */
export type AuditVerdict =
  | { seat: SeatId; game: number; status: 'verified'; shuffles: number; draws: number }
  | { seat: SeatId; game: number; status: 'mismatch'; mismatches: AuditMismatch[] }
  | {
      seat: SeatId;
      game: number;
      status: 'unverifiable';
      reason: AuditUnverifiableReason;
      /** E.g. "3 of 5 shuffles checked; the rest could not be checked". */
      detail: string;
      /** Records that existed and agreed. */
      checked: number;
    };

/** The words the log and the audit panel use per status (PLAN Milestone 5, owner decisions: "could not be checked: records missing"). Added by M5-C. */
export const AUDIT_STATUS_TEXT: Readonly<Record<AuditStatus, string>> = {
  verified: 'verified',
  mismatch: 'mismatch',
  unverifiable: 'could not be checked: records missing',
};

/**
 * Everything `verifyAudit` needs (DESIGN "Specification: network protocol and secrecy": "The audit replays every
 * record against the public log"). Added by M5-C.
 */
export interface AuditInput {
  /** The seat under audit. */
  seat: SeatId;
  game: AuditGame;
  /** The seat's sequenced `auditPublish` bundle for this game, or null when none arrived. */
  bundle: AuditBundle | null;
  /** The shared state just before `game.fromSeq` (the replay starts there). */
  start: TableState;
  /** The sequenced public actions `game.fromSeq` … `game.toSeq`, ascending, no gaps. */
  log: readonly Action[];
}

/** The finished games in a sequenced log (stage 'match' spans), oldest first. Implementer: M5-P2. Added by M5-C. */
export function auditGames(_log: readonly Action[]): AuditGame[] {
  throw new Error('not implemented: M5-P2');
}

/**
 * The bundle this browser publishes for `game`: its own audit records of that game's shuffles and reorders (matched by
 * the public `shuffleCommit` sids and `reorder` actions in `log`), stripped to their public form. Pure. Implementer:
 * M5-P2. Added by M5-C.
 */
export function buildAuditBundle(_secrets: SecretStore, _game: AuditGame, _log: readonly Action[]): AuditBundle {
  throw new Error('not implemented: M5-P2');
}

/** Verify one seat's bundle against the public log (pure, deterministic, total). Implementer: M5-P2. Added by M5-C. */
export function verifyAudit(_input: AuditInput): AuditVerdict {
  throw new Error('not implemented: M5-P2');
}
