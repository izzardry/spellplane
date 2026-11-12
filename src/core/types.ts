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

import type { Action, ActionDraft } from './actions';
import type { RevealedCard } from './commit';

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
  /** Added by M1-C (amendment). Set from `recover` until `recoverCommit` (DESIGN "Multiplayer architecture", Resume: lost-save recovery). */
  recovering?: SeatRecovery;
}

/**
 * An open lost-save recovery of one seat (DESIGN "Multiplayer architecture", Resume and failure handling: "the
 * remainder is committed and shuffled as a new library with a fresh hand count agreed by the table"). Added by M1-C
 * (amendment); set and cleared by M1-P7's reducer.
 */
export interface SeatRecovery {
  /** The fresh hand count the recovering player proposed; the table agrees to it in `round`. */
  hand: number;
  /** The confirmation round that agrees on `hand`. */
  round: RoundId;
  /** The seat's non-token cards (public and hidden) counted just before the first `recover` of this recovery discarded the hidden ones: the deck size; a later proposal keeps it. */
  deckSize: number;
  /** Seq of the `recover` action that set this (the latest proposal). */
  startSeq: number;
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
  /**
   * Added by M1-C. The seq from which the current countdown runs when it is not `startSeq`: the action that released
   * the last hold (DESIGN "Turn flow and confirmation", Hold stops everyone's timers). Absent: the countdown runs
   * from `startSeq`. Every client animates from the moment it applied that action; the sequencer's clock decides.
   */
  timerSeq?: number;
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
  /** Added by M1-C. Seq of the sequencer's `commitClose`: commits after it are refused, and seats without one are excluded (Public randomness 2). */
  closedSeq?: number;
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
  /** Added by M1-C. Seq of the sequencer's `commitClose`: nonces after it are refused, so the seed uses the nonces sequenced before it (Secret shuffle 2). */
  closedSeq?: number;
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
  /**
   * Added by M2-C. The lobby settings the host chose (DESIGN "Pre-game: draft, sealed and deck building", Lobby
   * settings). Absent until the host first sets them; readers use `DEFAULT_LOBBY_SETTINGS` then.
   */
  lobby?: LobbySettings;
  /**
   * Added by M2-C. The public side of the current or last draft (DESIGN "Specification: card data, packs and draft
   * formats", Draft formats). Created when the table enters the draft stage; kept through build and match so pools stay
   * countable; removed by a new draft (core/stage.ts).
   */
  draft?: DraftState;
  /**
   * Added by M2-C. Games started this evening on this link (DESIGN "Specification: card data, packs and draft formats",
   * Evening stages: build → match → build → match …). Absent before the first game; core/stage.ts (M2-P7) counts it.
   */
  games?: number;
}

/**
 * A deadline that only the sequencer's clock enforces (DESIGN "Specification: network protocol and secrecy", Timers,
 * Public randomness 2, Secret shuffle 2). Added by M1-C. `afterMs` after the sequencer applied action `fromSeq`, it
 * stamps `emit` with its own seat and sequences it, unless the state no longer yields a deadline with this `key`.
 * Pure data derived from TableState (core/deadlines.ts), so every peer computes the same list and a new sequencer
 * after a handover restarts the same timers from its own apply times.
 */
export interface Deadline {
  /** Stable identity, e.g. 'confirm:<roundId>:<timerSeq>' or 'rng:<rid>'; a timer is re-armed only when the key changes. */
  key: string;
  fromSeq: number;
  afterMs: number;
  /** Drafts the sequencer dispatches as itself (e.g. `respond {seat, 'timeout'}` per silent seat, `commitClose`). */
  emit: ActionDraft[];
}

// ---------------------------------------------------------------------------
// Draft, lobby and deck building (shared and private shapes). Added by M2-C.
// These live in core because TableState and SecretStore hold them and core imports nothing else; draft/types.ts
// re-exports them for the draft drivers (DECISIONS [M2-C]).
// ---------------------------------------------------------------------------

/** A set code as MTGJSON and Scryfall spell it, upper case, e.g. 'M19' (DESIGN "Specification: card data, packs and draft formats", Booster data). */
export type SetCode = string;

/** Who drafts: a seat, or a team in Two-Headed Giant draft and sealed (DESIGN "Pre-game", Two-Headed Giant draft: the team picks into a shared pool). */
export type DrafterId = SeatId | TeamId;

/**
 * Draft formats (DESIGN "Specification: card data, packs and draft formats", Draft formats). Pick-Two is a pass draft
 * with 2 picks per pass (draft/types.ts DRAFT_PRESETS). 'teamDraft' and 'teamSealed' are the Two-Headed Giant variants
 * (M3-P2); M2 implements the others.
 */
export type DraftFormat = 'pass' | 'sealed' | 'rochester' | 'winston' | 'grid' | 'teamDraft' | 'teamSealed';

/** Pass draft (and the Pick-Two preset): `packs` per player, `picks` per pass (DESIGN "Specification: card data, packs and draft formats", Draft formats: defaults 3 and 1). */
export interface PassDraftSettings {
  format: 'pass';
  packs: number;
  picks: number;
}

/** Sealed: `packs` per player, no drafting (DESIGN "Specification: card data, packs and draft formats", Draft formats: default 6). */
export interface SealedSettings {
  format: 'sealed';
  packs: number;
}

/** Rochester: `packs` per player opened face up one at a time, `burn` cards left unpicked per pack (DESIGN "Specification: card data, packs and draft formats", Draft formats: defaults 3 and 0). */
export interface RochesterSettings {
  format: 'rochester';
  packs: number;
  burn: number;
}

/** Winston, two seats: `packs` in total shuffled into one face-down stack (DESIGN "Specification: card data, packs and draft formats", Draft formats: 6 packs). */
export interface WinstonSettings {
  format: 'winston';
  packs: number;
}

/** Grid, two seats: `grids` grids of nine face-up cards from shuffled packs (DESIGN "Specification: card data, packs and draft formats", Draft formats: 18 grids). */
export interface GridSettings {
  format: 'grid';
  grids: number;
}

/** Two-Headed Giant draft: `packs` per team, `picks` per pass into the team pool (DESIGN "Specification: card data, packs and draft formats", Draft formats: 6 packs, 2 picks). M3-P2. */
export interface TeamDraftSettings {
  format: 'teamDraft';
  packs: number;
  picks: number;
}

/** Two-Headed Giant sealed: `packs` per team into a shared pool (DESIGN "Specification: card data, packs and draft formats", Draft formats: 8 packs). M3-P2. */
export interface TeamSealedSettings {
  format: 'teamSealed';
  packs: number;
}

/** Per-format draft settings (DESIGN "Specification: card data, packs and draft formats", Draft formats, Setup column). */
export type DraftFormatSettings =
  | PassDraftSettings
  | SealedSettings
  | RochesterSettings
  | WinstonSettings
  | GridSettings
  | TeamDraftSettings
  | TeamSealedSettings;

/**
 * The lobby settings (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings: acquisition mode, set per
 * pack, packs per player, picks per pass, optional pick timer). The table format (1v1, free-for-all, Two-Headed Giant)
 * is `TableState.format` and the pass timer is `TableSettings.passTimerMs`; both stay where M0 put them.
 */
export interface LobbySettings {
  /** How cards are acquired; null plays constructed decks chosen in the lobby (no draft or build stage before the first game). */
  draft: DraftFormatSettings | null;
  /**
   * Set code per pack number, index 0 = the first pack (a different set per pack is allowed). A list shorter than the
   * number of packs repeats its last entry (core/drafting.ts `setForPack`); never empty.
   */
  sets: SetCode[];
  /** Pick timer: 45 s for a pack's first pick, 3 s less per pick, 10 s floor (DESIGN "Specification: card data, packs and draft formats"). Off by default. */
  pickTimer: boolean;
}

/** Lobby defaults (DESIGN "Pre-game", Lobby settings: booster draft of 3 packs, pick 1, pick timer off; M19 is the gate's set). */
export const DEFAULT_LOBBY_SETTINGS: LobbySettings = { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false };

/** A draft card whose identity is public: Rochester packs and grid cells (DESIGN "Pre-game", Hidden information column: "None: packs and picks are public"). */
export interface DraftCard {
  id: InstanceId;
  ref: CardRef;
}

/**
 * One booster in the draft (DESIGN "Specification: network protocol and secrecy", Draft packs). Its contents stay with
 * its holder; shared state knows its commitments, its size and where it is.
 */
export interface DraftPack {
  id: PackId;
  /** The seat whose browser generated it with the secret-shuffle seed (purpose 'pack') and published its commitments. */
  opener: SeatId;
  /** 0-based pack number: the round in a pass or Rochester draft, the pack's index in sealed, Winston and grid. */
  number: number;
  set: SetCode;
  /** The commitments `packOpen` published (`seat` = opener); hand-overs and reveals are verified against it (core/commit.ts verifyReveal). */
  commitment: Commitment;
  /** Cards left in it. */
  count: number;
  /** The drafter whose queue holds it; null while it lies face up on the shared table (Rochester) or once it is empty or dealt (sealed, Winston, grid). */
  holder: DrafterId | null;
  /** Picks taken from it so far (the pick timer shortens with each). */
  picks: number;
  /** Seq of the action that put it at the front of its holder's queue (the pick timer runs from there). */
  sinceSeq: number;
  /** A public pack (Rochester): its remaining cards face up, in pack order. */
  cards?: DraftCard[];
}

/** Rochester draft (DESIGN "Specification: card data, packs and draft formats", Draft formats: snake order from the opener, opener role moves left). M2-P3. */
export interface RochesterState {
  /** The pack face up on the shared table, null between packs. */
  pack: PackId | null;
  /** The seat that opens (opened) the current pack. */
  opener: SeatId;
  /** Index into the snake order of the current pack (core/drafting.ts `rochesterOrder`). */
  turn: number;
  /** Packs opened so far. */
  opened: number;
}

/** Winston draft (DESIGN "Specification: card data, packs and draft formats", Draft formats: a face-down stack and three piles). M2-P3. */
export interface WinstonState {
  /** Cards left in the face-down stack. */
  stack: number;
  /** Card count of piles 1 to 3 (index 0..2). */
  piles: number[];
  /** The seat whose turn it is. */
  active: SeatId;
  /** The pile the active player is looking at (0..2). */
  pile: number;
  /** The seat whose browser dealt the stack and answers pile looks (M2-P3 decides the dealing; DECISIONS [M2-C]). */
  dealer: SeatId;
}

/** Grid draft (DESIGN "Specification: card data, packs and draft formats", Draft formats: 3×3 face up, row or column, first player alternates). M2-P3. */
export interface GridState {
  /** 0-based number of the grid on the table. */
  index: number;
  /** Nine cells row by row (row 0 = cells 0..2); null once taken, or before the grid is laid. */
  cells: (DraftCard | null)[];
  /** The seat that takes first in this grid. */
  first: SeatId;
  /** Lines already taken in this grid, in order. */
  taken: { line: 'row' | 'col'; index: number }[];
}

/**
 * The public side of a draft (DESIGN "Specification: card data, packs and draft formats", Draft formats; "Pre-game",
 * Drafting interaction: waiting packs queue visibly behind each seat). Plain JSON, identical in every browser.
 */
export interface DraftState {
  /** The format and its settings, copied from the lobby when the draft starts. */
  settings: DraftFormatSettings;
  /** Set code per pack number (LobbySettings.sets at the start). */
  sets: SetCode[];
  pickTimer: boolean;
  /** Drafters in seat order (team ids in Two-Headed Giant). */
  drafters: DrafterId[];
  /** 0-based round (pack number) of a pass draft; direction is left in rounds 0, 2, … and right in 1, 3, … (core/drafting.ts `passDirection`). */
  round: number;
  packs: Record<PackId, DraftPack>;
  /** Packs waiting at each drafter, oldest first; the first is the one being picked from. */
  queues: Record<DrafterId, PackId[]>;
  /** Cards each drafter has taken so far (contents stay with the drafter). */
  pools: Record<DrafterId, number>;
  rochester?: RochesterState;
  winston?: WinstonState;
  grid?: GridState;
  /** Seq of the `stageSet` that started the draft. */
  startSeq: number;
  /** Set when every pick is made (or every sealed pool is open); the stage machine then advances to build. */
  done: boolean;
}

/** Own private draft record of a generated pack, for the audit (DESIGN "Specification: card data, packs and draft formats", Pack generation: reproducible in the audit). */
export interface PackRecord {
  packId: PackId;
  /** The secret-shuffle round (purpose 'pack') whose seed generated it. */
  sid: ShuffleId;
  ownerNonce: string;
  /** Peer nonces in seat order. */
  peerNonces: string[];
  set: SetCode;
  /** The generated cards in pack order. */
  cards: RevealedCard[];
}

/** The private side of a draft in its owner's browser (DESIGN "Specification: network protocol and secrecy", Draft packs). Plain JSON; persisted with the SecretStore. */
export interface DraftSecrets {
  /** Contents of every pack this browser holds or has queued, by pack id, in pack order. */
  held: Record<PackId, RevealedCard[]>;
  /** Packs this browser generated. */
  generated: PackRecord[];
  /** Own marked (not yet confirmed) cards of the front pack (DESIGN "Pre-game", Drafting interaction: click to mark, again or Enter to confirm). */
  marked: InstanceId[];
}

/** One card of a limited pool as the builder holds it (DESIGN "Pre-game", Deck building). `id` is local to the pool, never a table instance id. */
export interface PoolCard {
  id: string;
  ref: CardRef;
  /** A basic land from the dispenser (unlimited, any printing), not a drafted card. */
  basic?: true;
}

/**
 * The deck being built from a pool (DESIGN "Pre-game", Deck building: builder table and list view are two views of
 * the same pool). Cards listed in `main` are the deck, all other cards the sideboard. Plain JSON.
 */
export interface DeckBuild {
  cards: PoolCard[];
  /** Pool card ids in the deck, in deck order. */
  main: string[];
  /** Builder-table positions by pool card id (M2-P5); the list view ignores and keeps them. */
  poses?: Record<string, Pose>;
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
  /** Added by M1-P2: set when the shuffle re-issued the zone's opaque ids (`shuffleDone.reissue`). */
  reissue?: ReissueRecord;
}

/**
 * The private side of a re-issue of opaque ids (DESIGN "Table model", Hidden cards). Added by M1-P2. `before[i]` is
 * the old id of the card now at `order[i]`; `retired` keeps the old ids' identities so the post-game audit can check
 * that every card kept its identity across the re-issue.
 */
export interface ReissueRecord {
  before: InstanceId[];
  retired: Record<InstanceId, SecretIdentity>;
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
  /** Added by M1-P2: set when the reorder re-issued the zone's opaque ids (`reorder.reissue`). */
  reissue?: ReissueRecord;
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
  /** Added by M2-C. The private side of the draft: packs this browser holds or generated (DESIGN "Specification: network protocol and secrecy", Draft packs). */
  draft?: DraftSecrets;
  /** Added by M2-C. The deck being built from `pool`, so a reload in the build stage keeps it (DESIGN "Pre-game", Deck building; PLAN M2-P7). */
  build?: DeckBuild;
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
