/**
 * Shared state types (docs/DESIGN.md "Data model and protocol", "Table model", "Specification: network protocol and secrecy").
 *
 * PLAIN JSON RULE. `TableState` (and everything reachable from it, and every `Action`) is plain JSON:
 * only objects with string keys, arrays, strings, finite numbers, booleans and null. No Map, Set, Date,
 * class instances, functions, NaN or Infinity. Optional fields are OMITTED when absent; the reducer
 * deletes a key rather than assigning `undefined`. `canonicalJson` (core/hash.ts) drops `undefined`
 * properties like `JSON.stringify` does, so an accidental `undefined` can never change a state hash,
 * and it throws on anything that is not plain JSON. Single optional slots that are part of the
 * table's shape use `null` (e.g. `confirm: null`). Records keyed by id are plain objects.
 */

import type { Action } from './actions';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** A seat's id (DESIGN "Data model and protocol"). `createTable` names seats 's0'..'s3' by index. */
export type SeatId = string;
/** A Two-Headed Giant team's id (DESIGN "Players, seats and formats"), e.g. 't0'. */
export type TeamId = string;
/** A card instance's stable opaque id (DESIGN "Table model"); never derived from the card's identity. */
export type InstanceId = string;
/** A zone's id (DESIGN "Table model"): `<kind>:<seatId>` for seat zones, `<kind>` for table zones (see core/ids.ts). */
export type ZoneId = string;
/** A pile's id (DESIGN "Card manipulation": cascade and squared piles). */
export type PileId = string;
/** A stack item's id (DESIGN "The effect stack"). */
export type StackItemId = string;
/** A connection line's id (DESIGN "Combat and annotation"). */
export type LineId = string;
/** A phase id declared by the game definition (DESIGN "Turn flow and confirmation"), e.g. 'main1'. */
export type PhaseId = string;
/** A game definition id (DESIGN "Specification: code interfaces"), e.g. 'mtg'. */
export type GameDefinitionId = string;
/** A confirmation round's id (DESIGN "Turn flow and confirmation"). */
export type RoundId = string;
/** A public-randomness round id `rid` (DESIGN "Specification: network protocol and secrecy"). */
export type RngId = string;
/** A secret-shuffle id `sid` (DESIGN "Specification: network protocol and secrecy"); not a Scryfall id. */
export type ShuffleId = string;
/** A draft pack id (DESIGN "Specification: network protocol and secrecy", draft packs). */
export type PackId = string;
/** A Scryfall card id (DESIGN "Specification: card data, packs and draft formats"). */
export type ScryfallId = string;

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** A pose in the canonical table frame: millimetres from the centre, `rot` in degrees clockwise (DESIGN "Specification: geometry, layout and motion"). */
export interface Pose {
  x: number;
  y: number;
  rot: number;
}

/** A card's identity: Scryfall id plus foil flag (DESIGN "Specification: network protocol and secrecy", Commitments). */
export interface CardRef {
  sid: ScryfallId;
  foil?: true;
}

/** Table formats (DESIGN "Players, seats and formats"). */
export type Format = '1v1' | 'ffa3' | 'ffa4' | '2hg';

/** The evening's stage (DESIGN "Specification: card data, packs and draft formats", Evening stages). */
export type Stage = 'lobby' | 'draft' | 'build' | 'match';

/** Seat colour index into the theme's eight seat colours, 0..7 (DESIGN "Themes and rendering"). */
export type SeatColourIndex = number;

// ---------------------------------------------------------------------------
// Game rules the engine needs (the core subset of GameDefinition)
// ---------------------------------------------------------------------------

/** Who may see a zone's faces (DESIGN "Table model"): everyone, the owner only (hand, sideboard), or nobody (library). */
export type ZoneVisibility = 'public' | 'owner' | 'nobody';

/** How a zone is drawn (DESIGN "Table model", Presentation column). */
export type ZonePresentation = 'free' | 'squared' | 'fan' | 'cascade-lane' | 'area' | 'hidden';

/** One zone kind declared by a game definition (DESIGN "Specification: code interfaces": id, scope, visibility, ordered, presentation). */
export interface ZoneSpec {
  /** Zone kind, e.g. 'library', 'battlefield'. Zone ids are derived from it (core/ids.ts). */
  id: string;
  scope: 'seat' | 'table';
  visibility: ZoneVisibility;
  /** Whether order matters (library, graveyard, stack). Hidden zones never expose their order in shared state. */
  ordered: boolean;
  presentation: ZonePresentation;
  label: string;
}

/** One phase or step of the turn strip (DESIGN "Specification: code interfaces"). */
export interface PhaseSpec {
  id: PhaseId;
  label: string;
}

/** The part of a game definition the pure engine reads (DESIGN "Table model", Game definition). `GameDefinition` (games/types.ts) extends it. */
export interface CoreGameSpec {
  id: GameDefinitionId;
  zones: ZoneSpec[];
  phases: PhaseSpec[];
  startingLife(format: Format): number;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/** A player's chair (DESIGN "Players, seats and formats", "Turn flow and confirmation": life and player counters). */
export interface Seat {
  id: SeatId;
  /** 0..3; also the clockwise turn order and the sequencer priority. */
  index: number;
  name: string;
  colour: SeatColourIndex;
  team?: TeamId;
  /** Life total; in Two-Headed Giant the team's `life` is authoritative instead. */
  life: number;
  /** Poison and free-form named counters (energy, experience, 'cmd:<seatId>' commander damage). */
  counters: Record<string, number>;
  ready: boolean;
  /** Set while the seat's peer is disconnected (DESIGN "Multiplayer architecture", Resume). */
  away?: boolean;
  /** Personal "pass until end of turn" toggle (DESIGN "Turn flow and confirmation", Auto-pass). */
  autoPass: boolean;
  /** Peer id that holds the seat (first 16 hex of SHA-256 of the public key); absent in solo play. */
  peer?: string;
}

/** A Two-Headed Giant team with shared life (DESIGN "Players, seats and formats", Two-Headed Giant). */
export interface Team {
  id: TeamId;
  seats: SeatId[];
  life: number;
  counters: Record<string, number>;
}

/** Pile membership (DESIGN "Card manipulation", "Specification: geometry, layout and motion"). Indices are contiguous from 0 (bottom). */
export interface PileRef {
  id: PileId;
  index: number;
  kind: 'cascade' | 'squared';
}

/** A physical card in the game (DESIGN "Table model", Card instance; "Data model and protocol"). */
export interface CardInstance {
  id: InstanceId;
  owner: SeatId;
  /** The seat whose territory the card sits in. */
  controller: SeatId;
  zone: ZoneId;
  /** Present only while the card is public (DESIGN "Table model", Hidden cards). */
  identity?: CardRef;
  face: 'up' | 'down';
  faceIndex: 0 | 1;
  tapped: boolean;
  pose: Pose;
  /** Home slot while temporarily displaced (DESIGN "Combat and annotation", Temporary move). */
  home?: Pose;
  /** Combat role while displaced, for the attacking and blocking signals. */
  combat?: 'attack' | 'block';
  pile?: PileRef;
  attachedTo?: InstanceId;
  counters: Record<string, number>;
  note?: string;
  isToken?: boolean;
  /** Label of a token or table object without a Scryfall identity (generic counter object, sticky note). */
  tokenLabel?: string;
  /** Set when a reveal did not match the owner's commitment (DESIGN "Specification: network protocol and secrecy"). */
  suspect?: boolean;
}

/** A public zone: everyone sees the members in order, bottom/back first (DESIGN "Table model"). For battlefields the order is draw order. */
export interface PublicZone {
  id: ZoneId;
  kind: string;
  owner: SeatId | null;
  visibility: 'public';
  ids: InstanceId[];
}

/** A hidden zone: shared state holds only a count and the opaque ids, kept SORTED so no secret order leaks (DESIGN "Table model", Hidden cards). */
export interface HiddenZone {
  id: ZoneId;
  kind: string;
  owner: SeatId | null;
  visibility: 'owner' | 'nobody';
  /** Always equals `ids.length`; kept for readers that only need the count. */
  count: number;
  /** Lexicographically sorted opaque ids; the real order lives in the owner's SecretStore. */
  ids: InstanceId[];
}

/** A zone (DESIGN "Table model"). */
export type Zone = PublicZone | HiddenZone;

/** A spell, ability, trigger or copy on the shared stack (DESIGN "The effect stack"). */
export interface StackItem {
  id: StackItemId;
  kind: 'spell' | 'ability' | 'trigger' | 'copy';
  controller: SeatId;
  /** The spell card itself (kind 'spell'); the card sits in the table's 'stack' zone. */
  card?: InstanceId;
  /** The source permanent of an ability or trigger marker. */
  source?: InstanceId;
  /** The stack item a copy marker copies. */
  copyOf?: StackItemId;
  note?: string;
}

/** A line endpoint: a card, a stack item or a seat (player avatar) (DESIGN "Combat and annotation", Connection lines). */
export type Anchor =
  | { kind: 'card'; id: InstanceId }
  | { kind: 'stackItem'; id: StackItemId }
  | { kind: 'seat'; id: SeatId };

/** The five line kinds (DESIGN "Combat and annotation"). */
export type LineKind = 'target' | 'attack' | 'block' | 'attach' | 'mark';

/** A connection line drawn in its creator's seat colour (DESIGN "Combat and annotation"). */
export interface Line {
  id: LineId;
  kind: LineKind;
  from: Anchor;
  to: Anchor;
  by: SeatId;
  label?: string;
}

/** Turn marker (DESIGN "Turn flow and confirmation"); `active` is a team id in Two-Headed Giant. */
export interface TurnState {
  number: number;
  active: SeatId | TeamId;
  phase: PhaseId;
}

/** A seat's answer in a confirmation round (DESIGN "Turn flow and confirmation"). */
export type ConfirmResponse = 'ok' | 'hold' | 'timeout';

/**
 * A confirmation round (DESIGN "Turn flow and confirmation"; "Specification: network protocol and secrecy", Timers).
 * Stores the duration and the seq that started it instead of a wall-clock deadline: each client animates from the
 * moment it applied that action, and only the sequencer's clock emits `respond {timeout}`.
 */
export interface ConfirmRound {
  id: RoundId;
  askedBy: SeatId;
  about?: StackItemId;
  label?: string;
  durationMs: number;
  startSeq: number;
  responses: Record<SeatId, ConfirmResponse>;
  /** Seat currently holding the floor, if any. */
  holder?: SeatId;
}

/** A seat's deck commitment published on Ready (DESIGN "Specification: network protocol and secrecy", Commitments). */
export interface Commitment {
  seat: SeatId;
  /** base64url(SHA-256(instanceId|sid|f-or-n|salt)) per card, in random order. */
  commits: string[];
  /** The public list of opaque instance ids, sorted. */
  instanceIds: InstanceId[];
  /** Seq of the `ready` action that published it. */
  atSeq: number;
}

/** Purpose of a public-randomness round (DESIGN "Specification: network protocol and secrecy", Public randomness). */
export type RngPurpose = 'die' | 'coin' | 'firstPlayer' | 'seatShuffle';

/** A public-randomness round in progress or finished (DESIGN "Specification: network protocol and secrecy", Public randomness). */
export interface RngRound {
  id: RngId;
  purpose: RngPurpose;
  /** Number of outcomes (die sides; 2 for a coin). */
  n: number;
  by: SeatId;
  startSeq: number;
  /** h = SHA-256(nonce) per participating seat. */
  commits: Record<SeatId, string>;
  reveals: Record<SeatId, string>;
  /** 0-based outcome once all reveals arrived and verified; null while pending. */
  result: number | null;
}

/** A secret shuffle (or pack generation) in progress or finished (DESIGN "Specification: network protocol and secrecy", Secret shuffle). */
export interface ShuffleRound {
  id: ShuffleId;
  zone: ZoneId;
  owner: SeatId;
  purpose: 'shuffle' | 'pack';
  /** SHA-256(ownerNonce). */
  h: string;
  startSeq: number;
  /** Peer nonces in the clear, by seat. */
  nonces: Record<SeatId, string>;
  /** Set by `shuffleDone`. */
  orderHash: string | null;
}

/** Table-wide settings the host can change (DESIGN "Turn flow and confirmation", "Players, seats and formats"). */
export interface TableSettings {
  /** Pass timer in ms, 2000..30000, or null for off. Default 5000. */
  passTimerMs: number | null;
  /** Two-Headed Giant: teammates see each other's hands live. */
  teamHandsVisible: boolean;
}

/** Default table settings (DESIGN "Turn flow and confirmation": 5-second pass timer). */
export const DEFAULT_TABLE_SETTINGS: TableSettings = { passTimerMs: 5000, teamHandsVisible: true };

/** Shared state, identical in every browser (DESIGN "Data model and protocol"). Plain JSON; see the rule at the top of this file. */
export interface TableState {
  /** Last applied sequence number (0 for a fresh table). */
  seq: number;
  game: GameDefinitionId;
  format: Format;
  stage: Stage;
  seats: Record<SeatId, Seat>;
  /** Empty unless the format has teams. */
  teams: Record<TeamId, Team>;
  cards: Record<InstanceId, CardInstance>;
  zones: Record<ZoneId, Zone>;
  /** Bottom to top. */
  stack: StackItem[];
  lines: Record<LineId, Line>;
  turn: TurnState;
  confirm: ConfirmRound | null;
  commitments: Record<SeatId, Commitment>;
  rng: Record<RngId, RngRound>;
  shuffles: Record<ShuffleId, ShuffleRound>;
  settings: TableSettings;
}

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

/** A card identity with its commitment salt (DESIGN "Specification: network protocol and secrecy"). */
export interface SecretIdentity {
  card: CardRef;
  /** 16 random bytes, base64url. */
  salt: string;
}

/** Private audit record of a secret shuffle (DESIGN "Specification: network protocol and secrecy", Secret shuffle step 5). */
export interface ShuffleRecord {
  kind: 'shuffle';
  sid: ShuffleId;
  zone: ZoneId;
  ownerNonce: string;
  /** Peer nonces in seat order. */
  peerNonces: string[];
  /** Resulting order, index 0 = top. */
  order: InstanceId[];
}

/** Private audit record of a private reorder (scry to bottom, put on top) (DESIGN "Specification: network protocol and secrecy"). */
export interface ReorderRecord {
  kind: 'reorder';
  zone: ZoneId;
  count: number;
  /** Nonce hashed into the public `reorder.orderHash`. */
  nonce: string;
  /** Full order after the reorder, index 0 = top. */
  order: InstanceId[];
}

/** One private audit record (DESIGN "Multiplayer architecture", Audit). */
export type AuditRecord = ShuffleRecord | ReorderRecord;

/** An identity another seat revealed to this browser only (DESIGN "Specification: network protocol and secrecy", targeted reveal). */
export interface ReceivedIdentity extends SecretIdentity {
  from: SeatId;
}

/** Private state: only in its owner's browser, never sent (DESIGN "Data model and protocol"). Plain JSON like TableState. */
export interface SecretStore {
  seat: SeatId;
  /** Every own card's identity and salt, hidden or not. */
  identities: Record<InstanceId, SecretIdentity>;
  /** Index 0 = top of the library. */
  libraryOrder: InstanceId[];
  /** Hand order as the owner arranged it. */
  hand: InstanceId[];
  audit: AuditRecord[];
  /** Identities others revealed to this browser only (targeted reveal, teammate hand). */
  received: Record<InstanceId, ReceivedIdentity>;
  /** Draft picks and sideboard. */
  pool?: CardRef[];
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/** One sequenced action in the timeline (DESIGN "Turn flow and confirmation", Action log). `at` is the local wall clock (display only, never hashed). */
export interface ActionLogEntry {
  kind: 'action';
  seq: number;
  at: number;
  action: Action;
}

/** A local system line, e.g. a hash mismatch or an integrity warning (DESIGN "Data model and protocol", Consistency check). */
export interface SystemLogEntry {
  kind: 'system';
  /** The last applied seq when the line was written. */
  seq: number;
  at: number;
  level: 'info' | 'warn';
  text: string;
}

/** A line of the action log (DESIGN "Turn flow and confirmation", Action log). */
export type LogEntry = ActionLogEntry | SystemLogEntry;
