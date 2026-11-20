/**
 * The public lobby's shared types (matchmaking.md 2.4 and 2.13; contracts.md Part E). Contract file: additive edits
 * only. The record types that the store also needs (MatchRecord, RatingRecord, MatchPlayer, RatingKey, QueueId, Band)
 * live in core/types.ts and are re-exported here. Validators are M8-P7's (src/net/lobby/validate.ts).
 */
import type { Band, Format, MatchRecord, QueueDeckKind, QueueId, QueueMode, RatingKey, SeatId } from '../../core/types';

export type { Band, MatchPlayer, MatchRecord, QueueDeckInfo, QueueId, QueueMode, RatingKey, RatingRecord } from '../../core/types';

/** The deck kind a queue asks for: 'constructed' (custom decks) or 'limited' (booster decks) (matchmaking.md 2.4). */
export type DeckKind = QueueDeckKind;

/** What a NAT probe concluded (matchmaking.md 2.3; the probe is later). */
export type NatClass = 'open' | 'strict' | 'blocked' | 'unknown';

/** Lobby wire protocol version; part of the lobby room name (matchmaking.md 2.4). */
export const LOBBY_PROTOCOL = 1;

/** The three lobbies that never meet: the live site, the preview build and dev or test builds (contracts.md Part E). */
export type LobbyRealm = 'live' | 'preview' | 'dev';

/** This build's realm: `preview` for the preview build, else `dev` with the debug hook, else `live` (contracts.md Part E). */
export const LOBBY_REALM: LobbyRealm = __SPELLPLANE_PREVIEW__ ? 'preview' : __SPELLPLANE_DEBUG__ ? 'dev' : 'live';

/** The lobby room id of a realm and shard: `lobby-<proto>-<realm>-all-<shard>` (matchmaking.md 2.2). */
export function lobbyRoomId(realm: LobbyRealm = LOBBY_REALM, shard = 0): string {
  return `lobby-${LOBBY_PROTOCOL}-${realm}-all-${shard}`;
}

/** The queues of M8 (matchmaking.md 2.4): ranked 1v1 and casual for all four tables, each for both deck kinds; `2hg.*.ranked` reserved. */
export const QUEUES: readonly QueueId[] = [
  '1v1.constructed.ranked',
  '1v1.limited.ranked',
  '1v1.constructed.casual',
  '1v1.limited.casual',
  '2hg.constructed.casual',
  '2hg.limited.casual',
  'ffa3.constructed.casual',
  'ffa3.limited.casual',
  'ffa4.constructed.casual',
  'ffa4.limited.casual',
];

/** The rating key of a ranked queue, null for a casual one (matchmaking.md 2.4). */
export function ratingKeyOf(queue: QueueId): RatingKey | null {
  const [format, kind, mode] = queue.split('.') as [Format, DeckKind, QueueMode];
  if (mode !== 'ranked' || (format !== '1v1' && format !== '2hg')) return null;
  return `${format}.${kind}`;
}

/** A formed match's plan: the derived room and its key, seat order, format and queue (PLAN M8-C Lobby row; matchmaking.md 2.6). */
export interface MatchPlan {
  matchId: string;
  roomId: string;
  roomKey: string;
  queue: QueueId;
  format: Format;
  /** Seat order: seats[i] takes seat `s<i>`; seat 0 creates the table (contracts.md Part G "Matchmaking" item 3). */
  seats: { peerId: string; name: string; seat: SeatId; team?: 0 | 1 }[];
  /** The record written before entering the room. */
  record: MatchRecord;
}

/** The broker's state per browser (matchmaking.md 2.5). */
export type BrokerState = 'watching' | 'seeking' | 'held' | 'check' | 'moving';

/** A match as the player sees it during the ready check and the move (matchmaking.md 2.8). */
export interface MatchView {
  matchId: string;
  queue: QueueId;
  /** In seat order; `me` marks this browser. */
  players: { name: string; rating: number | null; band: Band; me: boolean; team?: 0 | 1 }[];
}

/** One seeker as this browser sees it (matchmaking.md 2.13). */
export interface SeekerView {
  tid: string;
  peerId: string;
  name: string;
  queues: QueueId[];
  rating: number | null;
  band: Band;
  waitedMs: number;
  inRange: boolean;
  avoided: boolean;
  met: { games: number; won: number } | null;
}

/** What the lobby looks like from this browser (matchmaking.md 2.13). */
export interface LobbyView {
  shard: number;
  nat: NatClass;
  /** Seekers in this shard that this browser is connected to, longest waiting first. */
  seekers: SeekerView[];
  /** Seekers per queue, for the status line. */
  byQueue: Partial<Record<QueueId, number>>;
  unreachable: number;
  otherVersion: number;
  /** True when this room is at the cap; counts are then shown with a plus. */
  full: boolean;
}
