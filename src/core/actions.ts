/**
 * Every shared action (docs/DESIGN.md "Data model and protocol", Action families; "Specification: network protocol and secrecy").
 * Later milestones add reducer cases, not types. Actions are plain JSON (see core/types.ts).
 *
 * Conventions:
 * - Every action carries `by` (acting seat), `cid` (client-unique id for de-duplication) and, once sequenced, `seq`.
 * - Card actions name ONE card. A gesture over a selection dispatches one action per card sharing a `group` id;
 *   personal undo reverts a whole group as one step.
 * - Ids of new objects (tokens, stack items, lines, rounds) are chosen by the dispatching client, so the reducer stays deterministic.
 * - The reducer never reads secrets: hidden-to-public moves need a prior `reveal` (or a `flip` carrying `ref` and `salt`).
 */
import type {
  Anchor,
  CardInstance,
  CardRef,
  ConfirmResponse,
  InstanceId,
  Line,
  LineId,
  LineKind,
  PackId,
  PhaseId,
  PileRef,
  Pose,
  RngId,
  RngPurpose,
  RoundId,
  SeatColourIndex,
  SeatId,
  ShuffleId,
  Stage,
  StackItem,
  StackItemId,
  TableSettings,
  Team,
  TeamId,
  TurnState,
  Seat,
  Zone,
  ZoneId,
} from './types';

/** Fields every action carries (DESIGN "Data model and protocol", Action families). */
export interface ActionBase {
  /** Acting seat. */
  by: SeatId;
  /** Client-unique id for de-duplication and optimistic reconciliation. */
  cid: string;
  /** Set by the sequencer (or the solo session) once sequenced. */
  seq?: number;
  /** Shared by the actions of one gesture over a selection; undo reverts a group as one step. */
  group?: string;
  /**
   * Added by M0-P1. Only on an inverse built by `inverse()` (core/undo.ts): the exact prior public records that the
   * inverse action alone cannot bring back (a turn number, removed lines, a dropped identity, a re-laid pile).
   * The reducer applies it after the action's own effect, and only on undoable action types.
   */
  restore?: RestorePatch;
}

/**
 * Prior public records an inverse action restores (DESIGN "Turn flow and confirmation", Undo). Added by M0-P1.
 * `null` deletes a record. Built only from shared state, so it never carries a hidden identity.
 */
export interface RestorePatch {
  cards?: Record<InstanceId, CardInstance | null>;
  zones?: Record<ZoneId, Zone>;
  lines?: Record<LineId, Line | null>;
  /** The whole stack, bottom to top. */
  stack?: StackItem[];
  turn?: TurnState;
  seats?: Record<SeatId, Seat>;
  teams?: Record<TeamId, Team>;
}

type A<T extends string, P> = ActionBase & { type: T } & P;

// --- Card (DESIGN "Card manipulation", "Combat and annotation") ------------------------------------

/** Permanent move of a public card between or within public zones; `index` positions it in an ordered zone, `controller` changes territory (DESIGN "Card manipulation"). */
export type MoveAction = A<'move', { card: InstanceId; to: ZoneId; pose?: Pose; pile?: PileRef | null; index?: number; controller?: SeatId }>;
/** Temporary move: sets `home` if unset, optional tap and combat role (DESIGN "Combat and annotation", Temporary move). */
export type MoveTempAction = A<'moveTemp', { card: InstanceId; pose: Pose; combat?: 'attack' | 'block'; tap?: boolean }>;
/** Return displaced cards home and remove attack and block lines; all displaced cards when `cards` is absent (DESIGN "Combat and annotation", Settle). */
export type SettleAction = A<'settle', { cards?: InstanceId[] }>;
/** Tap or untap (DESIGN "Card manipulation"). */
export type TapAction = A<'tap', { card: InstanceId; tapped: boolean }>;
/** Turn face up or down; turning up a card whose identity is hidden carries `ref` and `salt` as a reveal (DESIGN "Card manipulation", "Table model"). */
export type FlipAction = A<'flip', { card: InstanceId; face: 'up' | 'down'; ref?: CardRef; salt?: string }>;
/** Show the other face of a double-faced card (DESIGN "Card manipulation"). */
export type TransformAction = A<'transform', { card: InstanceId; faceIndex: 0 | 1 }>;
/** Rotate by `delta` degrees, e.g. 180 for Shift+T (DESIGN "Card manipulation"). */
export type RotateAction = A<'rotate', { card: InstanceId; delta: number }>;
/** Add `delta` counters of `kind` ('+1/+1', 'loyalty', ...); a count reaching 0 removes the key (DESIGN "Card manipulation"). */
export type CounterAction = A<'counter', { card: InstanceId; kind: string; delta: number }>;
/** Set the card note; empty text clears it (DESIGN "Card manipulation"). */
export type NoteAction = A<'note', { card: InstanceId; text: string }>;
/** Attach `card` to `to` (Aura, Equipment); tucks behind the host (DESIGN "Card manipulation", "Combat and annotation"). */
export type AttachAction = A<'attach', { card: InstanceId; to: InstanceId; pose?: Pose }>;
/** Detach from the host (DESIGN "Combat and annotation"). */
export type DetachAction = A<'detach', { card: InstanceId; pose?: Pose }>;
/** Set or clear pile membership; the reducer re-numbers the pile so indices stay contiguous (DESIGN "Card manipulation"). */
export type PileAction = A<'pile', { card: InstanceId; pile: PileRef | null; pose?: Pose }>;
/** Tidy a seat's battlefield to the poses the client computed from the layout (DESIGN "Card manipulation", Tidy). */
export type TidyAction = A<'tidy', { seat: SeatId; poses: Record<InstanceId, Pose> }>;
/** Create a token (Scryfall token `ref`) or a table object without identity (`label`: counter object, sticky note) (DESIGN "Card manipulation"). */
export type CreateTokenAction = A<'createToken', { card: InstanceId; zone: ZoneId; pose: Pose; ref?: CardRef; label?: string; controller?: SeatId }>;
/** Token copy of a public card next to it (DESIGN "Card manipulation", X). */
export type CopyAction = A<'copy', { card: InstanceId; of: InstanceId; pose: Pose }>;
/** Remove a card from the game (tokens leaving the battlefield, sticky notes) (DESIGN "Data model and protocol"). */
export type RemoveAction = A<'remove', { card: InstanceId }>;

// --- Zone and secrecy (DESIGN "Table model", "Specification: network protocol and secrecy") -------

/** Move a card into a hidden zone (hand, library top or bottom); peers drop its identity (DESIGN "Table model", Hidden cards). */
export type ToZoneAction = A<'toZone', { card: InstanceId; to: ZoneId; position: 'top' | 'bottom' | 'any' }>;
/** Draw the opaque id on top of the owner's library into `to` (default: the drawer's hand) (DESIGN "Specification: network protocol and secrecy"). */
export type DrawAction = A<'draw', { instanceId: InstanceId; to?: ZoneId }>;
/** Publish a card's identity with its salt; peers verify against the commitment (DESIGN "Specification: network protocol and secrecy", Commitments). */
export type RevealAction = A<'reveal', { instanceId: InstanceId; ref: CardRef; salt: string }>;
/** Public record of a targeted reveal; the identity travels on the pair's `prv` channel only (DESIGN "Multiplayer architecture", Targeted reveal). */
export type RevealToAction = A<'revealTo', { instanceId: InstanceId; seats: SeatId[] }>;
/** Drop a public card's identity from shared state (face-down exile, morph) (DESIGN "Table model", Face-down). */
export type HideAction = A<'hide', { card: InstanceId }>;
/** Start a secret shuffle: `h = SHA-256(ownerNonce)` (DESIGN "Specification: network protocol and secrecy", Secret shuffle 1). */
export type ShuffleCommitAction = A<'shuffleCommit', { sid: ShuffleId; zone: ZoneId; h: string; purpose?: 'shuffle' | 'pack' }>;
/** A peer's nonce for a secret shuffle, in the clear (Secret shuffle 2). */
export type ShuffleNonceAction = A<'shuffleNonce', { sid: ShuffleId; nonce: string }>;
/** Finish a secret shuffle with `orderHash = SHA-256(order joined by ',' + '|' + ownerNonce)` (Secret shuffle 5). */
export type ShuffleDoneAction = A<'shuffleDone', { sid: ShuffleId; orderHash: string }>;
/** Public trace of a private reorder of the top `count` cards (DESIGN "Specification: network protocol and secrecy"). */
export type ReorderAction = A<'reorder', { zone: ZoneId; count: number; orderHash: string }>;
/** Logged private look: top `count` cards of `zone`, or one face-down `card` (peek) (DESIGN "Multiplayer architecture", Private looks). */
export type LookAtAction = A<'lookAt', { zone: ZoneId; count: number; card?: InstanceId }>;
/** London mulligan marker: the hand goes into the library; shuffle and draws follow as their own actions (DESIGN "Card manipulation"). `count` is the mulligan number. */
export type MulliganAction = A<'mulligan', { count: number }>;

// --- Stack (DESIGN "The effect stack") ---------------------------------------------------------------

/** Push an item; a spell's card moves to the 'stack' zone. Starts a confirmation round with id `round` (DESIGN "The effect stack"). */
export type StackPushAction = A<'stackPush', { item: StackItemId; kind: StackItem['kind']; card?: InstanceId; source?: InstanceId; copyOf?: StackItemId; note?: string; controller?: SeatId; round?: RoundId }>;
/** Set an item's one-line note (DESIGN "The effect stack"). */
export type StackNoteAction = A<'stackNote', { item: StackItemId; note: string }>;
/** Resolve the top item to `to` (default from the game definition); `force` records a resolve before all passed (DESIGN "The effect stack", Resolving). */
export type StackResolveAction = A<'stackResolve', { item: StackItemId; to?: ZoneId; pose?: Pose; force?: boolean }>;
/** Counter the top item: spell to its owner's graveyard, markers vanish (DESIGN "The effect stack"). */
export type StackCounterAction = A<'stackCounter', { item: StackItemId; to?: ZoneId }>;
/** Move an item to `index` (0 = bottom) (DESIGN "The effect stack"). */
export type StackReorderAction = A<'stackReorder', { item: StackItemId; index: number }>;

// --- Lines (DESIGN "Combat and annotation") ----------------------------------------------------------

/** Draw a connection line (DESIGN "Combat and annotation"). */
export type LineAddAction = A<'lineAdd', { line: LineId; kind: LineKind; from: Anchor; to: Anchor; label?: string }>;
/** Remove a line (DESIGN "Combat and annotation"). */
export type LineRemoveAction = A<'lineRemove', { line: LineId }>;
/** Flash a card, stack item or avatar for everyone; leaves no state (DESIGN "Combat and annotation", Ping). */
export type PingAction = A<'ping', { target: Anchor }>;

// --- Turn and confirm (DESIGN "Turn flow and confirmation") -------------------------------------------

/** Set the announced phase (DESIGN "Turn flow and confirmation"). */
export type PhaseSetAction = A<'phaseSet', { phase: PhaseId }>;
/** Pass the turn to `to`; clears every seat's auto-pass (DESIGN "Turn flow and confirmation"). */
export type TurnPassAction = A<'turnPass', { to: SeatId | TeamId }>;
/** Start a confirmation round manually or about a stack item (DESIGN "Turn flow and confirmation", Confirmation rounds). */
export type AskAction = A<'ask', { round: RoundId; about?: StackItemId; label?: string }>;
/** Answer a round for `seat`: ok, hold, release (of a hold), or timeout (emitted by the sequencer) (DESIGN "Specification: network protocol and secrecy", Timers). */
export type RespondAction = A<'respond', { round: RoundId; seat: SeatId; response: ConfirmResponse | 'release' }>;
/** Toggle the acting seat's "pass until end of turn" (DESIGN "Turn flow and confirmation", Auto-pass). */
export type AutoPassAction = A<'autoPass', { on: boolean }>;

// --- Players (DESIGN "Turn flow and confirmation", "Players, seats and formats") -----------------------

/** Change a seat's life by `delta` (the team's in Two-Headed Giant) (DESIGN "Turn flow and confirmation", Life). */
export type LifeAction = A<'life', { seat: SeatId; delta: number }>;
/** Change a named player counter ('poison', 'energy', 'cmd:<seatId>') (DESIGN "Turn flow and confirmation"). */
export type PlayerCounterAction = A<'playerCounter', { seat: SeatId; kind: string; delta: number }>;
/** Take a chair (DESIGN "Players, seats and formats"). */
export type SeatTakeAction = A<'seatTake', { seat: SeatId; name: string; colour: SeatColourIndex; peer?: string; team?: TeamId }>;
/** Leave a chair (DESIGN "Players, seats and formats"). */
export type SeatLeaveAction = A<'seatLeave', { seat: SeatId }>;
/** Ready with the deck commitment and the sorted public opaque ids; creates the hidden library instances (DESIGN "Specification: network protocol and secrecy", Commitments). */
export type ReadyAction = A<'ready', { commits: string[]; instanceIds: InstanceId[]; zone: ZoneId }>;

// --- Randomness (DESIGN "Specification: network protocol and secrecy", Public randomness) -------------

/** Commit to a nonce for a public random round (Public randomness 1-2). */
export type RngCommitAction = A<'rngCommit', { rid: RngId; purpose: RngPurpose; n: number; h: string }>;
/** Reveal the committed nonce (Public randomness 3). */
export type RngRevealAction = A<'rngReveal', { rid: RngId; nonce: string }>;

// --- Draft (DESIGN "Specification: network protocol and secrecy", Draft packs; M2 refines the state) -------

/** Open a pack: publishes commitments for its cards (DESIGN "Specification: network protocol and secrecy", Draft packs). */
export type PackOpenAction = A<'packOpen', { packId: PackId; commits: string[]; count: number; public?: boolean }>;
/** Pick `count` cards from a held pack; picked identities stay with the picker (Draft packs). */
export type PickAction = A<'pick', { packId: PackId; count: number; cards?: InstanceId[] }>;
/** Hand the rest of a pack to `to` (contents go on the pair's `prv` channel) (Draft packs). */
export type PackPassAction = A<'packPass', { packId: PackId; to: SeatId | TeamId; count: number }>;
/** Winston: look at pile `pile` (0..2) (DESIGN "Specification: card data, packs and draft formats"). */
export type PileLookAction = A<'pileLook', { pile: number; take: boolean }>;
/** Grid: take row or column `index` of grid `grid` (DESIGN "Specification: card data, packs and draft formats"). */
export type GridTakeAction = A<'gridTake', { grid: number; line: 'row' | 'col'; index: 0 | 1 | 2 }>;

// --- Social (DESIGN "Chat and voice") ----------------------------------------------------------------

/** A chat line on a tab (DESIGN "Chat and voice", Text chat). */
export type ChatAction = A<'chat', { text: string; channel: 'table' | 'team' | 'spectator' }>;
/** A final dictated caption anchored to a card, stack item or avatar, attached to action `about` (a cid) (DESIGN "Chat and voice", Dictation and captions). */
export type CaptionAction = A<'caption', { text: string; anchor?: Anchor; about?: string }>;

// --- Meta (DESIGN "Data model and protocol", "Turn flow and confirmation") -------------------------------

/** Personal undo: applies `inverse` and logs that action `of` (a cid) was undone (DESIGN "Turn flow and confirmation", Undo). */
export type UndoAction = A<'undo', { of: string; inverse: UndoableAction }>;
/** A peer's state hash at `upTo` (DESIGN "Data model and protocol", Consistency check). */
export type SnapshotHashAction = A<'snapshotHash', { upTo: number; h: string }>;
/** A new sequencer takes over from `fromSeq` (DESIGN "Specification: network protocol and secrecy", Liveness). */
export type SequencerClaimAction = A<'sequencerClaim', { fromSeq: number; peer: string }>;
/** Host changes table settings, e.g. the pass timer (DESIGN "Turn flow and confirmation": the host can change it mid-game). Added by M0-C. */
export type SettingsAction = A<'settings', { settings: Partial<TableSettings> }>;
/** Move the evening to another stage (DESIGN "Specification: card data, packs and draft formats", Evening stages). Added by M0-C; M2 refines. */
export type StageSetAction = A<'stageSet', { stage: Stage }>;

/** Every shared action (DESIGN "Data model and protocol"). */
export type Action =
  | MoveAction
  | MoveTempAction
  | SettleAction
  | TapAction
  | FlipAction
  | TransformAction
  | RotateAction
  | CounterAction
  | NoteAction
  | AttachAction
  | DetachAction
  | PileAction
  | TidyAction
  | CreateTokenAction
  | CopyAction
  | RemoveAction
  | ToZoneAction
  | DrawAction
  | RevealAction
  | RevealToAction
  | HideAction
  | ShuffleCommitAction
  | ShuffleNonceAction
  | ShuffleDoneAction
  | ReorderAction
  | LookAtAction
  | MulliganAction
  | StackPushAction
  | StackNoteAction
  | StackResolveAction
  | StackCounterAction
  | StackReorderAction
  | LineAddAction
  | LineRemoveAction
  | PingAction
  | PhaseSetAction
  | TurnPassAction
  | AskAction
  | RespondAction
  | AutoPassAction
  | LifeAction
  | PlayerCounterAction
  | SeatTakeAction
  | SeatLeaveAction
  | ReadyAction
  | RngCommitAction
  | RngRevealAction
  | PackOpenAction
  | PickAction
  | PackPassAction
  | PileLookAction
  | GridTakeAction
  | ChatAction
  | CaptionAction
  | UndoAction
  | SnapshotHashAction
  | SequencerClaimAction
  | SettingsAction
  | StageSetAction;

/** The `type` tag of an action (DESIGN "Data model and protocol"). */
export type ActionType = Action['type'];

/** The action with tag `T` (DESIGN "Data model and protocol"). */
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

/** Omit that distributes over a union (helper for ActionDraft). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An action before the session stamps `by`, `cid` and `seq`: what the HUD and scene dispatch (DESIGN "Specification: code interfaces"). A full Action is assignable to it. */
export type ActionDraft = DistributiveOmit<Action, 'by' | 'cid' | 'seq'>;

/** Action families of the design's table, plus 'Zone and secrecy' carrying shuffleNonce/shuffleDone/reorder from the network spec (DESIGN "Data model and protocol"). */
export type ActionFamily = 'card' | 'zone' | 'stack' | 'lines' | 'turn' | 'players' | 'randomness' | 'draft' | 'social' | 'meta';

/** Family of every action type; a Record over ActionType, so a missing type fails to compile (DESIGN "Data model and protocol"). */
export const ACTION_FAMILIES: Readonly<Record<ActionType, ActionFamily>> = {
  move: 'card',
  moveTemp: 'card',
  settle: 'card',
  tap: 'card',
  flip: 'card',
  transform: 'card',
  rotate: 'card',
  counter: 'card',
  note: 'card',
  attach: 'card',
  detach: 'card',
  pile: 'card',
  tidy: 'card',
  createToken: 'card',
  copy: 'card',
  remove: 'card',
  toZone: 'zone',
  draw: 'zone',
  reveal: 'zone',
  revealTo: 'zone',
  hide: 'zone',
  shuffleCommit: 'zone',
  shuffleNonce: 'zone',
  shuffleDone: 'zone',
  reorder: 'zone',
  lookAt: 'zone',
  mulligan: 'zone',
  stackPush: 'stack',
  stackNote: 'stack',
  stackResolve: 'stack',
  stackCounter: 'stack',
  stackReorder: 'stack',
  lineAdd: 'lines',
  lineRemove: 'lines',
  ping: 'lines',
  phaseSet: 'turn',
  turnPass: 'turn',
  ask: 'turn',
  respond: 'turn',
  autoPass: 'turn',
  life: 'players',
  playerCounter: 'players',
  seatTake: 'players',
  seatLeave: 'players',
  ready: 'players',
  rngCommit: 'randomness',
  rngReveal: 'randomness',
  packOpen: 'draft',
  pick: 'draft',
  packPass: 'draft',
  pileLook: 'draft',
  gridTake: 'draft',
  chat: 'social',
  caption: 'social',
  undo: 'meta',
  snapshotHash: 'meta',
  sequencerClaim: 'meta',
  settings: 'meta',
  stageSet: 'meta',
};

/** Every action type, in declaration order (DESIGN "Data model and protocol"). */
export const ACTION_TYPES: readonly ActionType[] = Object.keys(ACTION_FAMILIES) as ActionType[];

/**
 * Action types personal undo can revert (DESIGN "Turn flow and confirmation", Undo: shuffles, reveals, dice and coin
 * results cannot be undone; no table-wide rewind). Everything else is never undoable: secrecy and randomness steps,
 * looks, mulligans (they contain a shuffle), confirmation answers, pings, seats, draft, social and meta actions.
 */
export const UNDOABLE_TYPES = [
  'move',
  'moveTemp',
  'settle',
  'tap',
  'flip',
  'transform',
  'rotate',
  'counter',
  'note',
  'attach',
  'detach',
  'pile',
  'tidy',
  'createToken',
  'copy',
  'remove',
  'toZone',
  'draw',
  'stackPush',
  'stackNote',
  'stackResolve',
  'stackCounter',
  'stackReorder',
  'lineAdd',
  'lineRemove',
  'phaseSet',
  'turnPass',
  'life',
  'playerCounter',
] as const satisfies readonly ActionType[];

/** An action whose type can be undone (DESIGN "Turn flow and confirmation", Undo). */
export type UndoableAction = ActionOf<(typeof UNDOABLE_TYPES)[number]>;

const UNDOABLE: ReadonlySet<ActionType> = new Set<ActionType>(UNDOABLE_TYPES);

/**
 * Whether personal undo may revert this action (DESIGN "Turn flow and confirmation", Undo).
 * A flip that carries `ref`/`salt` is a reveal and is not undoable.
 */
export function isUndoable(action: Action): action is UndoableAction {
  if (!UNDOABLE.has(action.type)) return false;
  if (action.type === 'flip' && action.ref !== undefined) return false;
  return true;
}
