/**
 * The lobby wire protocol (matchmaking.md 2.4; contracts.md Part E). Contract file: additive edits only. Plain JSON,
 * sent on the lobby room's transport. Shape validators are M8-P7's (src/net/lobby/validate.ts). `resultSig` is later.
 */
import type { Band, QueueId, RatingKey } from '../../core/types';
import type { NatClass } from './types';

/** What a seeker announces; signed by the identity key, bound to the lobby connection by `tid` (matchmaking.md 2.4). */
export interface Ticket {
  v: 1;
  /** The sender's transport id in this lobby room. */
  tid: string;
  /** First 16 hex of SHA-256 of the public key (as hello.peerId). */
  peerId: string;
  /** base64url SPKI. */
  pubKey: string;
  /** Display name, 1..24 characters. */
  name: string;
  /** The game PROTOCOL_VERSION of this page; tickets with another value are shown but never matched. */
  proto: number;
  /** 1..4 queues this player accepts, most wanted first; all share the selected deck's kind. */
  queues: QueueId[];
  /** Rating and games played for each rating key among `queues`. Self-reported. */
  ratings: Partial<Record<RatingKey, { r: number; g: number }>>;
  /** The selected deck's band 1..5 and score (QueueDeckInfo). */
  band: Band;
  score: number;
  /** True after "Play anyone now". */
  open: boolean;
  /** 2v2 party: the teammate's tid (later). */
  mate?: string;
  nat: NatClass;
  /** Increases whenever the player changes the ticket. */
  rev: number;
  /** ECDSA P-256 over canonicalJson(ticket without sig). */
  sig: string;
}

/** Why a member does not take part in an offer (matchmaking.md 2.4). */
export type PassReason = 'busy' | 'window' | 'unreachable' | 'stale' | 'declined';

/** Every lobby message (matchmaking.md 2.4). `offer`, `hold`, `pass` and `ready` go to each member, never broadcast. */
export type LobbyMessage =
  | { v: 1; t: 'seek'; ticket: Ticket; waitedMs: number }
  | { v: 1; t: 'beat'; state: 'watching' | 'seeking' | 'held' | 'check'; waitedMs: number; n: number; links: string[] }
  | { v: 1; t: 'unseek' }
  | { v: 1; t: 'offer'; mid: string; queue: QueueId; members: { tid: string; rev: number; team?: 0 | 1 }[] }
  | { v: 1; t: 'hold'; mid: string; nonce: string; sig: string }
  | { v: 1; t: 'pass'; mid: string; reason: PassReason }
  | { v: 1; t: 'ready'; mid: string };

/** The `t` tag of a lobby message. */
export type LobbyMessageType = LobbyMessage['t'];

/** The text a hold signature covers (matchmaking.md 2.4). */
export function holdText(mid: string, tid: string, peerId: string): string {
  return `spellplane-v1|hold|${mid}|${tid}|${peerId}`;
}
