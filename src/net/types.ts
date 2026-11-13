/**
 * Network engine contracts (docs/DESIGN.md "Multiplayer architecture", Shared state: a sequenced action log;
 * "Specification: network protocol and secrecy", Sequencing, Liveness, Sync, Timers). Contracts: M1-C.
 * Implementers: M1-P1 (NetEngine, Sequencer, SyncEngine, presence, identity), M1-P2 (PrivateChannel in
 * net/private.ts), M1-P7 (resume reconciliation in net/sync.ts). The session (M1-P8) glues a NetEngine to the
 * owner's secret store and the local store.
 */
import type { Action } from '../core/actions';
import type { RevealedCard } from '../core/commit';
import type { Anchor, CoreGameSpec, Deadline, InstanceId, PackId, Pose, SeatId, TableState, ZoneId } from '../core/types';
import type { ChatChannel, LookReqMessage, PeerRole, PrivateMessage, SequencedAction, WireMessage } from './messages';
import type { Channel, PeerId, Transport } from './transport';
import type { VersionMismatch } from './version';

/** Heartbeat interval on `ctl` (DESIGN "Specification: network protocol and secrecy", Liveness). */
export const HEARTBEAT_MS = 2000;
/** A peer silent this long is away (DESIGN "Specification: network protocol and secrecy", Liveness). */
export const AWAY_AFTER_MS = 6000;
/** Peers exchange a state hash every this many actions (DESIGN "Specification: network protocol and secrecy", Sync). */
export const HASH_EVERY = 50;
/** Snapshots are taken every this many actions (DESIGN "Specification: network protocol and secrecy", Sync). */
export const NET_SNAPSHOT_EVERY = 200;
/** A sync gap larger than this is answered with a snapshot plus tail (DESIGN "Specification: network protocol and secrecy", Sync). */
export const SYNC_TAIL_LIMIT = 500;
/** Presence (cursor, drag) is sent at most this often per sender; the last value always goes out (DESIGN "Multiplayer architecture": presence on the unreliable channel). Decision M1-C. */
export const PRESENCE_INTERVAL_MS = 50;

/** Removes a listener (DESIGN "Specification: code interfaces"). */
export type Unsubscribe = () => void;

/**
 * This browser's identity on the wire (DESIGN "Players, seats and formats", Identity; "Specification: network
 * protocol and secrecy": ECDSA P-256 key pair, peer id = first 16 hex of SHA-256 of the public key).
 */
export interface NetIdentity {
  readonly peerId: string;
  /** base64url SPKI of the public key (as store/identity.ts exports it). */
  readonly pubKey: string;
  readonly nickname: string;
  /** base64url ECDSA P-256/SHA-256 signature (IEEE P1363) of the UTF-8 text. */
  sign(text: string): Promise<string>;
}

/** Where this browser stands in the room (DESIGN "Multiplayer architecture", Rooms and connection; "Specification: network protocol and secrecy", version mismatch). */
export type ConnectionStatus =
  /** Not joined yet. */
  | 'idle'
  /** Joining the room / signalling. */
  | 'joining'
  /** In the room, no other peer connected; the table runs on this browser alone. */
  | 'alone'
  /** Catching up from a peer (syncReq outstanding). */
  | 'syncing'
  /** In step with at least one peer. */
  | 'connected'
  /** A peer runs another protocol version; the notice names it. */
  | 'versionMismatch'
  /** Left the room or disposed. */
  | 'closed';

/** One remote peer as the engine knows it (DESIGN "Specification: network protocol and secrecy", Handshake, Liveness). */
export interface PeerInfo {
  /** The transport's id for the connection (Transport.peers()). */
  transportId: PeerId;
  /** Identity peer id from `hello`; '' until the hello arrived. */
  peerId: string;
  nickname: string;
  seat: SeatId | null;
  role: PeerRole;
  /** 'handshake' until the welcome signature verified; 'away' after AWAY_AFTER_MS of silence. */
  status: 'handshake' | 'connected' | 'away';
  /** Last seq the peer reported (hello, hb, claimAck). */
  lastSeq: number;
}

/** A wire message as the engine saw it, for the debug hook and the leak test (DESIGN "Specification: code interfaces", SpellplaneDebug.net.messages). */
export interface NetMessageRecord {
  dir: 'in' | 'out';
  channel: Channel;
  msg: WireMessage;
  /** The other side's transport id; '*' for a broadcast. */
  peer: PeerId;
  /** Local clock (ms), display only. */
  at: number;
}

/** Outcome of sequencing one proposal (DESIGN "Specification: network protocol and secrecy", Sequencing 3). */
export type SequenceResult = { ok: true; action: SequencedAction } | { ok: false; reason: string };

/**
 * The sequencer role (DESIGN "Specification: network protocol and secrecy", Sequencing 1-3): the connected seated
 * peer with the lowest seat index checks proposals structurally and stamps `seq = last + 1`. It holds no secrets
 * and has no special view. Implementer: M1-P1.
 */
export interface Sequencer {
  /** The last seq assigned (or adopted on handover). */
  readonly lastSeq: number;
  /**
   * Check structure only (referenced ids exist, `by` is the sender's seat, the sender's role allows the action family,
   * hidden-zone actions come from the zone's owner; only the sequencer itself may send `away`, `commitClose` and
   * `respond … timeout`) against the confirmed state, then stamp the next seq. A refusal becomes a `nack`.
   */
  sequence(state: TableState, action: Action, sender: { seat: SeatId | null; role: PeerRole; self: boolean }): SequenceResult;
}

/** What a sequenced action did to the replica (DESIGN "Specification: network protocol and secrecy", Sequencing 4). */
export type ReceiveResult = 'applied' | 'duplicate' | 'buffered';

/**
 * One browser's replica of the shared log (DESIGN "Specification: network protocol and secrecy", Sequencing 4-5,
 * Sync): the confirmed state (sequenced actions applied in order), the optimistic queue of own pending actions on
 * top of it, the buffer of out-of-order arrivals, and the retained tail for catch-up. Pure apart from its own fields;
 * no transport. Implementer: M1-P1.
 */
export interface SyncEngine {
  /** State after every sequenced action applied in order. */
  confirmed(): TableState;
  /** `confirmed()` with the pending own actions re-applied on top; what the table shows. */
  view(): TableState;
  /** Last seq applied in order. */
  seq(): number;
  /** Own actions applied optimistically and not yet sequenced, oldest first. */
  pending(): readonly Action[];
  /** Apply an own action optimistically; false (and nothing queued) when the reducer refuses it on the view. */
  applyOwn(action: Action): boolean;
  /** Take a sequenced action: apply it (and any buffered successors) if it is next, drop the matching pending copy. */
  receive(action: SequencedAction): ReceiveResult;
  /** Drop the pending action `cid` after a nack; returns it, or null if unknown. */
  reject(cid: string): Action | null;
  /** The `haveSeq` to request when a later seq is buffered (a gap), else null. */
  gap(): number | null;
  /** Retained sequenced actions after `afterSeq`, or null when they are no longer held (answer with a snapshot). */
  tail(afterSeq: number): SequencedAction[] | null;
  /** The confirmed state as a snapshot. */
  snapshot(): { seq: number; state: TableState };
  /** Replace the confirmed state with a snapshot plus tail (catch-up, resync after a hash mismatch); pending actions are re-applied. */
  load(snapshot: { seq: number; state: TableState }, tail: readonly SequencedAction[]): void;
}

/**
 * Where a table starts on this browser (DESIGN "Multiplayer architecture", Resume): a restored save, or the
 * deterministic seq-0 table when nothing is saved. Built by the session from TableStore (M1-P7).
 */
export interface ResumePoint {
  snapshot: { seq: number; state: TableState };
  /** Sequenced actions after the snapshot, ascending. */
  tail: SequencedAction[];
}

/** Another peer's presence (DESIGN "Players, seats and formats", Other players' cursors; "Multiplayer architecture": presence is never logged). */
export interface PeerPresence {
  peerId: string;
  seat: SeatId | null;
  /** Pointer in table millimetres, null when off the table or unknown. */
  cursor: { x: number; y: number } | null;
  /** Hovered card. */
  over: InstanceId | null;
  /** Cards being dragged with their current poses; empty when not dragging. */
  drag: { id: InstanceId; pose: Pose }[];
  speaking: boolean;
  typing: ChatChannel | null;
  /** Interim caption (M3-P4). */
  caption: { text: string; anchor: Anchor | null } | null;
  /** Local clock (ms) of the last presence message from this peer. */
  at: number;
}

/**
 * Publishing and reading presence on the `pres` channel (DESIGN "Multiplayer architecture": pointer position, the
 * card being dragged, who is typing or speaking travel on the unreliable channel and are never logged).
 * Publishing is throttled to PRESENCE_INTERVAL_MS. Implementer: M1-P1 (engine), M1-P5 (scene/presence.ts draws it).
 */
export interface Presence {
  /** Own pointer in table millimetres and the hovered card; null when the pointer left the table. */
  cursor(at: { x: number; y: number } | null, over?: InstanceId | null): void;
  /** Own drag in progress; an empty list ends it. */
  drag(cards: readonly { id: InstanceId; pose: Pose }[]): void;
  speaking(on: boolean): void;
  typing(channel: ChatChannel | null): void;
  captionInterim(text: string | null, anchor?: Anchor | null): void;
  /** Every other peer's latest presence. */
  peers(): PeerPresence[];
  subscribe(listener: (peers: PeerPresence[]) => void): Unsubscribe;
}

/** Options of a NetEngine (DESIGN "Multiplayer architecture"; "Specification: network protocol and secrecy"). */
export interface NetEngineOptions {
  transport: Transport;
  roomId: string;
  roomKey: string;
  identity: NetIdentity;
  game: CoreGameSpec;
  /** Starting point: the restored save or the seq-0 table (net/sync.ts decides which copy wins once peers answer). */
  start: ResumePoint;
  role?: PeerRole;
  /** Deadlines the sequencer's clock enforces (core/deadlines.ts `deadlines`); default none. */
  deadlines?: (state: TableState) => Deadline[];
  /** Local clock in ms; default Date.now (tests use fake timers). */
  now?: () => number;
}

/**
 * One browser's connection to a table (DESIGN "Multiplayer architecture"; "Specification: network protocol and
 * secrecy"): handshake, sequencing (as proposer, and as sequencer when elected), catch-up, heartbeat, handover,
 * hash exchange and presence over one Transport. Owns a SyncEngine; the own seat is the seat whose `peer` is this
 * identity. Implementer: M1-P1.
 */
export interface NetEngine {
  readonly selfId: PeerId;
  readonly identity: NetIdentity;
  /** Join the room and start the handshake; resolves when joined (not when a peer connected). */
  join(): Promise<void>;
  /** Send `bye`, leave the room and stop timers. */
  leave(): void;
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe;

  /** The view: confirmed state plus own pending actions. */
  state(): TableState;
  confirmedState(): TableState;
  /** Last seq applied in order. */
  seq(): number;
  /** The seat this identity holds in the view, or null. */
  seat(): SeatId | null;
  /**
   * Own actions applied optimistically and not yet sequenced, oldest first (SyncEngine.pending; DESIGN "Specification:
   * network protocol and secrecy", Sequencing 4). Added by M1-C (amendment): the pair channel (M1-P2) refuses a look
   * at a zone a pending own action may change.
   */
  pending(): readonly Action[];
  /**
   * Apply a stamped own action (`by`, `cid`, no `seq`) optimistically and send `propose` to the sequencer (or
   * sequence it directly when this browser is the sequencer, or when alone). False when the reducer refuses it
   * locally; nothing is sent then.
   */
  propose(action: Action): boolean;
  /** Called after every change of the view (sequenced action, optimistic apply, rollback, catch-up). */
  onState(listener: (state: TableState) => void): Unsubscribe;
  /** Called for every action applied in order to the confirmed state; `own` when its cid was proposed here. */
  onSequenced(listener: (action: SequencedAction, own: boolean) => void): Unsubscribe;
  /** Called when an own pending action was refused (`nack`) and rolled back. */
  onRollback(listener: (action: Action, reason: string) => void): Unsubscribe;
  /** A system log line: hash mismatch and resync, version mismatch, handover (DESIGN "Data model and protocol", Consistency check). */
  onSystem(listener: (level: 'info' | 'warn', text: string) => void): Unsubscribe;

  /** Identity peer id of the current sequencer, or null while none is known. */
  sequencerId(): string | null;
  isSequencer(): boolean;
  /** Handover hook: the sequencer changed; `fromSeq` is the seq the new one continues from (DESIGN "Specification: network protocol and secrecy", Liveness). */
  onSequencerChange(listener: (sequencer: string | null, fromSeq: number) => void): Unsubscribe;

  peers(): PeerInfo[];
  onPeers(listener: (peers: PeerInfo[]) => void): Unsubscribe;
  presence: Presence;

  /**
   * Send a pair-channel message to the peer holding `seat` only; false when that seat has no connected peer (DESIGN
   * "Specification: network protocol and secrecy", prv). From M3 (M3-C) `seat` may also be a spectator id
   * (core/teams.ts `spectatorIdOf`): the message goes to that connected spectator only (DESIGN "Players, seats and
   * formats": reveal to a named spectator). Spectator routing: M3-P5.
   */
  sendPrivate(seat: SeatId, msg: PrivateMessage): boolean;
  /** Pair-channel messages from verified peers, with the sender's seat (null for an unseated peer). */
  onPrivate(listener: (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void): Unsubscribe;

  /** Every message sent and received since join (debug hook and leak test). */
  messages(): NetMessageRecord[];
  /**
   * The latest protocol-version mismatch with a peer, or null (PLAN Milestone 5, owner decisions, Version mismatch:
   * "a clear message naming both versions and what to do"). Added by M5-C; implementer: M5-P6 (net/version.ts).
   * Optional until M5-P6 lands.
   */
  versionMismatch?(): VersionMismatch | null;
}

/** Create a network engine (DESIGN "Multiplayer architecture"). Implementer: M1-P1 (net/engine.ts). */
export type CreateNetEngine = (opts: NetEngineOptions) => NetEngine;

/**
 * Hidden-information exchange on the pair channel (DESIGN "Multiplayer architecture", Hidden information 4-5;
 * "Specification: network protocol and secrecy", prv). Every received identity is checked against its owner's
 * commitment (core/commit.ts verifyReveal). Implementer: M1-P2 (net/private.ts); M2-P2 adds packs, M3-P2 teammate hands.
 */
export interface PrivateChannel {
  /** Send identities to the given seats only (targeted reveal with the public `revealTo` action `about`, or a look answer); from M3 also to spectator ids (M3-P5). */
  reveal(to: readonly SeatId[], cards: readonly RevealedCard[], purpose: 'revealTo' | 'look', about: string): void;
  /** Ask `owner` to show cards of its hidden zone to this browser only; resolves with the verified cards, or [] when refused or the owner is away. */
  requestLook(owner: SeatId, zone: ZoneId, count: number, card?: InstanceId): Promise<RevealedCard[]>;
  /** Answer look requests: return the cards to show (top first) or null to refuse. One answerer at a time. */
  answerLooks(answer: (req: LookReqMessage, from: SeatId) => RevealedCard[] | null): Unsubscribe;
  /** Hand a draft pack's remaining cards to `to` (M2-P2). */
  sendPack(to: SeatId, packId: PackId, cards: readonly RevealedCard[]): void;
  /** A received identity with the verdict of the commitment check; an unverified one is flagged, never shown as genuine. */
  onIdentity(listener: (card: RevealedCard, from: SeatId, verified: boolean) => void): Unsubscribe;
  onPack(listener: (packId: PackId, cards: RevealedCard[], from: SeatId) => void): Unsubscribe;
}

/** Create the pair-channel layer over an engine (DESIGN "Multiplayer architecture", Targeted reveal). Implementer: M1-P2. */
export type CreatePrivateChannel = (engine: NetEngine) => PrivateChannel;

/**
 * The Two-Headed Giant team pair channel (DESIGN "Players, seats and formats", Two-Headed Giant: "Each teammate's hand
 * is visible live to the other", "A team channel carries voice and text only between teammates"; "Specification:
 * network protocol and secrecy", prv `teamHand`). Every received hand card is checked against its owner's commitment
 * (core/commit.ts verifyReveal) like a targeted reveal. Added by M3-C; implementer: M3-P2 (net/team.ts).
 */
export interface TeamChannel {
  /** Send this browser's whole hand in order to the teammate `to` (after every change of the hand). */
  sendHand(to: SeatId, cards: readonly RevealedCard[], order: readonly InstanceId[]): void;
  /** A teammate's hand with the commitment verdict per card; an unverified card is flagged, never shown as genuine. */
  onHand(listener: (from: SeatId, cards: RevealedCard[], order: InstanceId[], verified: boolean[]) => void): Unsubscribe;
  /** Send a team chat line to the teammate `to` (net/messages.ts TeamChatMessage). */
  sendChat(to: SeatId, cid: string, text: string, atSeq: number): void;
  onChat(listener: (from: SeatId, cid: string, text: string, atSeq: number) => void): Unsubscribe;
}

/** Create the team channel over an engine (DESIGN "Players, seats and formats", Two-Headed Giant). Added by M3-C; implementer: M3-P2. */
export type CreateTeamChannel = (engine: NetEngine) => TeamChannel;
