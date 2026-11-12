/**
 * The wire protocol (docs/DESIGN.md "Specification: network protocol and secrecy"; "Multiplayer architecture"; "Data
 * model and protocol": what is and is not an action). Every message is a plain JSON object `{v: 1, t: <type>, ...}`
 * and travels on exactly one Transport channel (MESSAGE_CHANNEL). Contracts: M1-C. Implementers: M1-P1 (ctl, act,
 * pres), M1-P2 (prv, net/private.ts), M2-P2 (`pack`), M3-P2 (`teamHand`).
 *
 * Hidden information rule (CLAUDE.md): an identity (`ref`, `salt`) appears only in `prv` messages addressed to one
 * peer, and in the public `reveal` action once the card is public. `ctl`, `act` and `pres` messages never carry one.
 */
import type { Action } from '../core/actions';
import type { RevealedCard } from '../core/commit';
import type { Anchor, InstanceId, PackId, Pose, SeatId, ShuffleId, TableState, ZoneId } from '../core/types';
import type { Channel, Message } from './transport';

/** Protocol version in every envelope; peers with another `v` are refused with a visible notice (DESIGN "Specification: network protocol and secrecy"). */
export const PROTOCOL_VERSION = 1 as const;

/** Trystero app id; the room key is the password that encrypts signalling (DESIGN "Specification: network protocol and secrecy", Room). */
export const APP_ID = 'spellplane-v1';

/** The envelope of message type `T` with payload `P` (DESIGN "Specification: network protocol and secrecy"). A type alias, so it is assignable to transport's Message. */
export type Envelope<T extends string, P> = { v: typeof PROTOCOL_VERSION; t: T } & P;

/** An action stamped by the sequencer: `seq` is always set (DESIGN "Specification: network protocol and secrecy", Sequencing 3). */
export type SequencedAction = Action & { seq: number };

/** A seat's role on the wire; spectators are never sequencer (DESIGN "Specification: network protocol and secrecy", Sequencing 1; "Players, seats and formats", Spectators, M3-P5). */
export type PeerRole = 'player' | 'spectator';

/** A chat tab (DESIGN "Chat and voice", Text chat). */
export type ChatChannel = 'table' | 'team' | 'spectator';

// --- ctl: reliable, ordered -------------------------------------------------------------------------

/**
 * First message on a new connection (DESIGN "Specification: network protocol and secrecy", Handshake). `peerId` is
 * the first 16 hex characters of SHA-256 of the public key, `pubKey` the ECDSA P-256 public key as base64url SPKI,
 * `nonce` a fresh connection nonce (16 random bytes, base64url) the other side signs in its `welcome`, bound to this
 * connection (see `handshakeText`), `seat` the chair this key pair held (a returning key pair reclaims it), `lastSeq`
 * the highest seq this peer holds.
 */
export type HelloMessage = Envelope<
  'hello',
  { peerId: string; pubKey: string; nickname: string; seat: SeatId | null; role: PeerRole; lastSeq: number; nonce: string }
>;

/**
 * Answer to a `hello`, carrying the handshake signature (DESIGN "Specification: network protocol and secrecy",
 * Handshake: `sig` signs the other side's connection nonce). `sig` is the base64url ECDSA P-256/SHA-256 signature
 * (IEEE P1363, as Web Crypto produces it) of `handshakeText(roomId, <the hello's nonce, connection-bound>, <this
 * sender's peerId>)`. The connection-bound nonce is `<hello nonce>|<signer's transport id>|<recipient's transport id>`
 * (M1-P1 `boundNonce`), and the verifier checks it against the connection the welcome arrived on, so a peer cannot
 * relay another player's hello and welcome to pass as that player. Also tells the newcomer who sequences and how far
 * the log is.
 */
export type WelcomeMessage = Envelope<'welcome', { peerId: string; sig: string; sequencer: string | null; seq: number }>;

/**
 * Catch-up request after a gap or on joining (DESIGN "Specification: network protocol and secrecy", Sequencing 4,
 * Sync). `haveSeq` is the last seq applied in order.
 */
export type SyncReqMessage = Envelope<'syncReq', { haveSeq: number }>;

/**
 * Catch-up answer (DESIGN "Specification: network protocol and secrecy", Sync): the sequenced actions after
 * `haveSeq`, or, when the gap exceeds SYNC_TAIL_LIMIT or `haveSeq` is 0 (a fresh joiner, whose seq-0 state may
 * differ), a snapshot plus the tail after it. `snapshot.state.seq === snapshot.seq`.
 */
export type SyncResMessage = Envelope<'syncRes', { snapshot: { seq: number; state: TableState } | null; tail: SequencedAction[] }>;

/** Heartbeat every HEARTBEAT_MS; a peer silent for AWAY_AFTER_MS is away (DESIGN "Specification: network protocol and secrecy", Liveness). Carries the sender's last applied seq. */
export type HeartbeatMessage = Envelope<'hb', { seq: number; sequencer: string | null }>;

/** A new sequencer takes over from `fromSeq` (DESIGN "Specification: network protocol and secrecy", Liveness); two claimants resolve by lowest seat index. */
export type ClaimMessage = Envelope<'claim', { fromSeq: number; seat: SeatId }>;

/** A peer's answer to a `claim`: its last seq, so whoever is ahead resends the missing `seq` messages (DESIGN "Specification: network protocol and secrecy", Liveness). Added by M1-C. */
export type ClaimAckMessage = Envelope<'claimAck', { lastSeq: number }>;

/** State-hash exchange every HASH_EVERY actions: base64url SHA-256 of the canonical JSON of the state at `seq` (DESIGN "Specification: network protocol and secrecy", Sync). */
export type HashMessage = Envelope<'hash', { seq: number; h: string }>;

/**
 * The sender refuses or leaves the connection (DESIGN "Specification: network protocol and secrecy": version
 * mismatch notice; Handshake). Added by M1-C. Its layout is frozen across protocol versions: `version` is the
 * sender's PROTOCOL_VERSION, so an older or newer peer can still show the notice.
 */
export type ByeMessage = Envelope<'bye', { reason: 'leave' | 'version' | 'badSignature' | 'seatTaken' | 'full'; version: number; detail?: string }>;

// --- act: reliable, ordered -------------------------------------------------------------------------

/**
 * Peer to sequencer: an action already applied optimistically (DESIGN "Specification: network protocol and secrecy",
 * Sequencing 2). `cid === action.cid`. `prev` (added by M1-C, amendment) keeps one proposer's actions in order under
 * loss: the cid of the proposer's previous proposal that was still pending when this one was sent, null or absent
 * when there was none. The sequencer holds a proposal until its `prev` is sequenced or refused; the proposer resends
 * its pending proposals oldest first, and how long a held proposal waits for a `prev` that never arrives is M1-P1's.
 */
export type ProposeMessage = Envelope<'propose', { cid: string; action: Action; prev?: string | null }>;

/** Sequencer to all: the stamped action (DESIGN "Specification: network protocol and secrecy", Sequencing 3). Also used to resend missing seqs after a handover. */
export type SeqMessage = Envelope<'seq', { seq: number; cid: string; action: SequencedAction }>;

/** Sequencer to the proposer: refused, roll the optimistic copy back (DESIGN "Specification: network protocol and secrecy", Sequencing 3). */
export type NackMessage = Envelope<'nack', { cid: string; reason: string }>;

// --- prv: reliable, ordered, one pair only ------------------------------------------------------------

/**
 * A card identity for this peer only (DESIGN "Multiplayer architecture", Targeted reveal; "Specification: network
 * protocol and secrecy", prv `reveal`). `purpose` 'revealTo' accompanies the public `revealTo` action (`about` = its
 * cid); 'look' answers a `lookReq` (`about` = its lookId). The receiver verifies it against the owner's commitment.
 */
export type RevealMessage = Envelope<'reveal', RevealedCard & { purpose: 'revealTo' | 'look'; about: string }>;

/** A draft pack's remaining cards handed to the next seat, with the public `packPass` (DESIGN "Specification: network protocol and secrecy", Draft packs). Implementer: M2-P2. */
export type PackMessage = Envelope<'pack', { packId: PackId; cards: RevealedCard[] }>;

/** Two-Headed Giant: the sender's whole hand in order, sent to the teammate after every change (DESIGN "Players, seats and formats", Two-Headed Giant). Implementer: M3-P2. */
export type TeamHandMessage = Envelope<'teamHand', { cards: RevealedCard[]; order: InstanceId[] }>;

/**
 * A secret shuffle's owner nonce shared with one peer (DESIGN "Specification: network protocol and secrecy", prv
 * `nonce`): lets that peer compute the order of shuffle `sid` (a teammate's view, the audit). M1 does not send it.
 */
export type NonceMessage = Envelope<'nonce', { sid: ShuffleId; nonce: string }>;

/**
 * Ask the owner to show cards of one of its hidden zones to this peer only (DESIGN "Multiplayer architecture",
 * Private looks; e.g. look at the top cards of an opponent's library, or peek at their face-down card). The public
 * `lookAt` action records the fact and count. Added by M1-C; implementer: M1-P2.
 */
export type LookReqMessage = Envelope<'lookReq', { lookId: string; zone: ZoneId; count: number; card?: InstanceId }>;

/** The owner's answer to a `lookReq`: the cards in order (top first), or `refused` (DESIGN "Multiplayer architecture", Private looks). Added by M1-C. */
export type LookMessage = Envelope<'look', { lookId: string; cards: RevealedCard[]; refused?: true }>;

// --- pres: unreliable, never logged -----------------------------------------------------------------

/**
 * Presence messages carry `n`, a per-sender counter, so a receiver drops one older than the last it applied (the
 * channel is unordered) (DESIGN "Multiplayer architecture": presence is sent on the unreliable channel and never logged).
 */
type PresenceBase = {
  n: number;
};

/** Pointer position in table millimetres, null when it left the table; `over` is the hovered card (DESIGN "Players, seats and formats", Other players' cursors). */
export type CursorMessage = Envelope<'cursor', PresenceBase & { at: { x: number; y: number } | null; over: InstanceId | null }>;

/** Cards being dragged and their current poses; an empty list ends the drag (DESIGN "Players, seats and formats", Other players' cursors). */
export type DragMessage = Envelope<'drag', PresenceBase & { cards: { id: InstanceId; pose: Pose }[] }>;

/** Speaking indicator (DESIGN "Chat and voice", Live voice: each avatar shows a speaking ring). M3-P3 sends it. */
export type SpeakingMessage = Envelope<'speaking', PresenceBase & { on: boolean }>;

/** Typing indicator on a chat tab, null when stopped (DESIGN "Multiplayer architecture", Shared state: who is typing). */
export type TypingMessage = Envelope<'typing', PresenceBase & { channel: ChatChannel | null }>;

/** Interim caption text, null when cleared; the final caption is the `caption` action (DESIGN "Chat and voice", Dictation and captions). M3-P4 sends it. */
export type CaptionInterimMessage = Envelope<'captionInterim', PresenceBase & { text: string | null; anchor: Anchor | null }>;

// --- unions ---------------------------------------------------------------------------------------------

/** Messages on `ctl` (DESIGN "Specification: network protocol and secrecy", channel table). */
export type CtlMessage = HelloMessage | WelcomeMessage | SyncReqMessage | SyncResMessage | HeartbeatMessage | ClaimMessage | ClaimAckMessage | HashMessage | ByeMessage;
/** Messages on `act` (DESIGN "Specification: network protocol and secrecy", channel table). */
export type ActMessage = ProposeMessage | SeqMessage | NackMessage;
/** Messages on `prv`, one pair only (DESIGN "Specification: network protocol and secrecy", channel table). */
export type PrivateMessage = RevealMessage | PackMessage | TeamHandMessage | NonceMessage | LookReqMessage | LookMessage;
/** Messages on `pres` (DESIGN "Specification: network protocol and secrecy", channel table). */
export type PresenceMessage = CursorMessage | DragMessage | SpeakingMessage | TypingMessage | CaptionInterimMessage;
/** Every wire message (DESIGN "Specification: network protocol and secrecy"). */
export type WireMessage = CtlMessage | ActMessage | PrivateMessage | PresenceMessage;
/** The `t` tag of a wire message (DESIGN "Specification: network protocol and secrecy"). */
export type WireType = WireMessage['t'];
/** The wire message with tag `T` (DESIGN "Specification: network protocol and secrecy"). */
export type WireOf<T extends WireType> = Extract<WireMessage, { t: T }>;

/** The channel of every message type; a Record over WireType, so a missing type fails to compile (DESIGN "Specification: network protocol and secrecy", channel table). */
export const MESSAGE_CHANNEL: Readonly<{ [T in WireType]: Channel }> = {
  hello: 'ctl',
  welcome: 'ctl',
  syncReq: 'ctl',
  syncRes: 'ctl',
  hb: 'ctl',
  claim: 'ctl',
  claimAck: 'ctl',
  hash: 'ctl',
  bye: 'ctl',
  propose: 'act',
  seq: 'act',
  nack: 'act',
  reveal: 'prv',
  pack: 'prv',
  teamHand: 'prv',
  nonce: 'prv',
  lookReq: 'prv',
  look: 'prv',
  cursor: 'pres',
  drag: 'pres',
  speaking: 'pres',
  typing: 'pres',
  captionInterim: 'pres',
};

/**
 * The text a `welcome` signature covers (DESIGN "Specification: network protocol and secrecy", Handshake): app id,
 * room, the other side's nonce bound to the connection (`<hello nonce>|<signer's transport id>|<recipient's transport
 * id>`, M1-P1 `boundNonce`) and the signer's peer id. A signature is therefore valid only on the connection it was
 * made for.
 */
export function handshakeText(roomId: string, nonce: string, signerPeerId: string): string {
  return `${APP_ID}|${roomId}|${nonce}|${signerPeerId}`;
}

/**
 * The typed message if `raw` has a known type for `channel` and protocol version 1, else null (DESIGN "Specification:
 * network protocol and secrecy": every message is `{v: 1, t, ...}`). Checks the envelope only; M1-P1 validates the
 * payload fields before use.
 */
export function asWireMessage(channel: Channel, raw: unknown): WireMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as { v?: unknown; t?: unknown };
  if (m.v !== PROTOCOL_VERSION || typeof m.t !== 'string' || !Object.hasOwn(MESSAGE_CHANNEL, m.t)) return null;
  return MESSAGE_CHANNEL[m.t as WireType] === channel ? (raw as WireMessage) : null;
}

/** A wire message as the Transport sends it; compiles only while every message type is plain JSON with string keys (DESIGN "Specification: code interfaces", Transport). */
export function toMessage(msg: WireMessage): Message {
  return msg;
}
