/**
 * The networked session (PLAN M1-P8): TableSession over a NetEngine (transport, sequencer, sync), the pair channel
 * for hidden information and the sequencer's timers, with the owner's secret store and local persistence as in the
 * solo session. Contracts: M1-C (session/types.ts NetSession). Implementer: M1-P8.
 *
 * - Public actions are stamped here (`by` = own seat, client-unique `cid`) and handed to the engine, which applies
 *   them optimistically and proposes them to the sequencer (DESIGN "Specification: network protocol and secrecy",
 *   Sequencing 2-4). A refused proposal is rolled back by the engine and logged here with its reason.
 * - Hidden information never leaves this browser except through the design's reveal paths (DESIGN "Multiplayer
 *   architecture", Hidden information): an action that makes an own card public goes alone (the reducer puts the card
 *   down face down) and, once it is sequenced, the owner turns the card up with a verified `flip {ref, salt}`, so a
 *   refused action never publishes an identity; a face-down own card in a zone that shows faces is turned up the same
 *   way, also when another seat moved it there; a targeted reveal is the public `revealTo` plus the identity on the pair channel to the named seats only, sent
 *   once the `revealTo` is sequenced; another seat's peek at an own face-down card is answered only for the seat that
 *   controls it, and looks at whole zones are refused (no consent prompt exists yet, decision M1-P8).
 * - Joining (decision M1-P8): a browser that did not create the room waits for a peer (NetSessionInternals.loneWaitMs)
 *   before it sits alone; a table started alone that meets the room's table at the same chair is given up for it
 *   (`collision`, `rejoin`).
 * - The private effects use core/secrets.ts (decision M1-P2): Ready commits the deck, the secret shuffle runs the
 *   commit/nonce/done protocol with the other seats' nonces, a public card returned to the hand re-issues the hand's
 *   opaque ids, a shuffle re-issues the zone's ids when a card in it was seen since it was issued (the `exposed` set,
 *   rebuilt from the stored log after a reload; after a catch-up from a snapshot or a rewind every own card counts as
 *   seen), and an undo re-reveals own cards it brought back face down once the undo is sequenced.
 * - The lost-save recovery (PLAN M1-P7, session/resume.ts SessionRecovery): `recover`, the table's confirmation
 *   round, `recoverCommit` of the re-imported deck minus the public cards, the secret shuffle and the agreed draws.
 * - Joint randomness (DESIGN "Public randomness", "Secret shuffle" 2): this browser contributes its nonce to every
 *   round still waiting for it (also after a reload or reconnect), keeps the nonce of an open round in local storage
 *   (session/nonces.ts) and reuses it whenever it proposes again, and reveals its rng nonce once all commits are in.
 *   An own randomness action that comes back sequenced with another payload is logged as an integrity warning.
 * - Persistence is solo.ts's path (session/persist.ts): every sequenced action with the table record and the secret
 *   store in one transaction, the secret store alone when it changes without one.
 * - Timers: the engine arms core/deadlines.ts (confirmation rounds, commit windows) on the sequencer's clock.
 */
import type { Action, ActionDraft } from '../core/actions';
import { nonceHash, type RevealedCard } from '../core/commit';
import { deadlines } from '../core/deadlines';
import { canonicalJson } from '../core/hash';
import { zoneId } from '../core/ids';
import { createTable, explain, reduce } from '../core/reducer/index';
import { roundPassed } from '../core/reducer/confirm';
import { recoveryRemainder } from '../core/recovery';
import { expectedParticipants, orderHash, rngCommitPhaseComplete, shufflePeerNonces, shuffleReady, shuffleSeed } from '../core/rng';
import {
  beginShuffle,
  commitDeck,
  disclosedBy,
  emptySecretStore,
  finishShuffle,
  lookAnswer,
  type LookRequest,
  privateReorder,
  pruneReceived,
  receiveIdentity,
  reissueZone,
  revealedCard,
  shuffleRecord,
  type Entropy,
} from '../core/secrets';
import type { CardRef, Format, InstanceId, LogEntry, PackId, Pose, RngPurpose, SeatColourIndex, SecretStore, SeatId, ShuffleId, TableState, ZoneId } from '../core/types';
import { isUndoable, type UndoableAction } from '../core/actions';
import { undoPlan, type UndoReveal } from '../core/undo';
import type { CardData } from '../data/types';
import type { PackSeed } from '../draft/types';
import { draftCardsOver } from '../net/draftcards';
import { createNetEngine, NACK_DUPLICATE } from '../net/engine';
import { createNetIdentity } from '../net/identity';
import type { ChatChannel, SequencedAction } from '../net/messages';
import { createPrivateChannel } from '../net/private';
import { spectatorRevealSender } from '../net/roles';
import { applySequenced, seatOfPeer } from '../net/sequencer';
import type { NetEngine, PrivateChannel, ResumePoint, Unsubscribe } from '../net/types';
import type { LogRecord, TableStore } from '../store/types';
import { DRY_CID, FACE_DOWN_KINDS, faceDownAllowed, placementOf, putBack, reRevealDraft, referencedCard, sameOrder, SESSION_ONLY, turnsPublic, turnsUpOnMove, withProof } from './effects';
import { localNonces, type NonceStore } from './nonces';
import { TablePersistence } from './persist';
import { randomId, randomSalt } from './secrecy';
import { identitiesFromLog, lostHiddenCards, owedOn, parseRecoveryOwed, recoveryProblem, type RecoveryOwed, type SessionRecovery } from './resume';
import { reconcileSecrets, type LibraryPlacement } from './secrets';
import { buildFromDeck, Evening, type DraftPort } from './draft';
import { TeamView } from './team';
import { MAX_TEAM_CHAT } from '../net/team';
import { formatTeamSeats, isTeamFormat, teamIdOf } from '../core/teams';
import { mountCaptions } from './captions';
import type { CaptionControls } from '../voice/types';
import type { DraftControls } from '../draft/types';
import { createSessionVoice, latestTransport } from './voice';
import { registerAuditDebug, SessionAudit } from './audit';
import type { AuditControls } from '../net/audit';
import type { VoiceControls } from '../voice/types';
import type { CreateNetSession, DeckImport, EveningControls, LookedCard, NetSession, NetSessionOptions, NetStatusListener, SessionListener, SessionNetStatus, TeamControls } from './types';

/** How long a browser without a seat listens for a table already in the room before it takes a chair (decision M1-P8). */
export const SETTLE_MS = 1500;
/**
 * How long a browser that opened a shared link over a transport whose peers may connect many seconds after joining
 * (Trystero: the WebRTC connection comes up after Nostr signalling) waits for a peer before it takes a chair at a table
 * of its own (decision M1-P8). The creator does not wait; a table started alone that meets the room's table later is
 * given up for it (`NetTable.collision`).
 */
export const LONE_WAIT_MS = 8000;
/** Taking a chair gives up after this long. */
export const SEAT_TIMEOUT_MS = 20_000;
/** A browser gives up a table it started alone for the room's table at most this many times per session. */
const MAX_REJOINS = 3;
/** The seat name when the identity has no nickname yet: the reducer refuses an empty one (decision M1-P5). */
export const DEFAULT_NICKNAME = 'Player';
/** Cards drawn by a London mulligan (DESIGN "Card manipulation", Library actions). */
export const NET_MULLIGAN_HAND = 7;
/** Attempts to take a free chair when another browser took the same one first. */
const SEAT_ATTEMPTS = 4;
/** A contribution to a randomness round that keeps being refused is given up after this many refusals. */
const ROUND_ATTEMPTS = 3;
/** The key under which an own recovery keeps what it still owes after its `recoverCommit` (session/nonces.ts 'recovery'). */
const OWED = 'owed';
/** Why nothing is taken from a recovered library yet. */
const UNSHUFFLED = 'Finish the recovery first: your new library is not shuffled yet';
/** Action types that leave a card where it lies and as it shows: a kept turn-up is still owed after them. */
const IN_PLACE: ReadonlySet<string> = new Set(['tap', 'rotate', 'counter', 'note', 'attach', 'detach']);
/** Seat colours a theme provides (DESIGN "Themes and rendering": eight seat colours). */
const SEAT_COLOURS = 8;

const SEATS_OF: Record<Format, number> = { '1v1': 2, ffa3: 3, ffa4: 4, '2hg': 4 };

/** How main.ts opened the room, and what tests may change, beyond NetSessionOptions. */
export interface NetSessionInternals {
  /**
   * This browser created the room on its start page (main.ts records it for the tab): it may take a chair alone after
   * SETTLE_MS and never gives up its table for another one it meets (decision M1-P8). Default false.
   */
  createdHere?: boolean;
  /**
   * How long a browser that did not create the room and holds no chair in its save waits for a peer before it sits
   * alone (from the join; at least SETTLE_MS). main.ts: 0 on the local transport (BroadcastChannel peers connect at
   * once), LONE_WAIT_MS otherwise. Default 0.
   */
  loneWaitMs?: number;
  /** Default SETTLE_MS. */
  settleMs?: number;
  /** Default SEAT_TIMEOUT_MS. */
  seatTimeoutMs?: number;
  /** Where open-round nonces are kept; default the page's local storage (session/nonces.ts). */
  nonces?: NonceStore;
  /** Ids and salts; default session/secrecy.ts. */
  entropy?: Entropy;
}

/** The seq-0 table of a room nobody saved (DESIGN "Players, seats and formats", Seats: every chair free). */
export function freshNetTable(game: NetSessionOptions['game'], format: Format = '1v1'): TableState {
  // Two-Headed Giant chairs belong to their team from the start (core/teams.ts TABLE_FORMAT_TEAMS; M3-P2).
  const teamOf = new Map(formatTeamSeats(format).flatMap((seats, t) => seats.map((s) => [s, teamIdOf(t)] as const)));
  return createTable({
    game,
    format,
    seats: Array.from({ length: SEATS_OF[format] }, (_, i) => {
      const team = teamOf.get(`s${i}`);
      return { name: '', colour: i as SeatColourIndex, ...(team !== undefined ? { team } : {}) };
    }),
  });
}

const DEFAULT_ENTROPY: Entropy = { id: () => randomId('c'), salt: randomSalt };

interface UndoEntry {
  cid: string;
  group?: string;
  inverse: UndoableAction;
  reveals: UndoReveal[];
  hand: InstanceId[];
  library: InstanceId[];
}

type PrivateLists = Pick<SecretStore, 'identities' | 'libraryOrder' | 'hand' | 'audit'>;

interface Waiter {
  check: () => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The refusal counter an own contribution to a randomness round counts against (see NetTable.drive). */
function roundKey(a: Action): string | null {
  if (a.type === 'shuffleNonce') return `nonce:${a.sid}`;
  if (a.type === 'shuffleDone') return `done:${a.sid}`;
  if (a.type === 'rngCommit') return `commit:${a.rid}`;
  if (a.type === 'rngReveal') return `reveal:${a.rid}`;
  return null;
}

function withoutSeq(a: Action): Omit<Action, 'seq'> {
  const { seq: _seq, ...rest } = a;
  return rest;
}

/** Own ids another seat has seen since they were issued, from a stored log (DESIGN "Table model", Hidden cards; decision M1-P8). */
export function exposedFromLog(log: readonly Action[], state: TableState, seat: SeatId): Set<InstanceId> {
  const out = new Set<InstanceId>();
  const mine = (id: InstanceId | undefined): boolean => id !== undefined && Object.hasOwn(state.cards, id) && state.cards[id]!.owner === seat;
  for (const a of log) {
    if (a.type === 'reveal' && a.by === seat && mine(a.instanceId)) out.add(a.instanceId);
    else if (a.type === 'flip' && a.by === seat && a.ref !== undefined && mine(a.card)) out.add(a.card);
    else if (a.type === 'revealTo' && a.by === seat && mine(a.instanceId)) out.add(a.instanceId);
    else if (a.type === 'lookAt' && a.by !== seat) {
      if (a.card !== undefined) {
        if (mine(a.card)) out.add(a.card);
      } else if (Object.hasOwn(state.zones, a.zone) && state.zones[a.zone]!.owner === seat) {
        // Which cards the look covered depends on the order then; every card of that zone counts (a re-issue too many is harmless).
        for (const id of state.zones[a.zone]!.ids) out.add(id);
      }
    }
  }
  for (const [id, c] of Object.entries(state.cards)) if (c.owner === seat && c.identity !== undefined) out.add(id);
  return out;
}

/**
 * The answer to another seat's look request (DESIGN "Table model", Face-down on the battlefield; "Card manipulation",
 * Peek; decision M1-P8): the identity of an own face-down card in a public zone, only for `from` when that seat
 * controls the card in the confirmed state; null (refused) for everything else, including whole hidden zones.
 */
export function peekAnswer(secrets: SecretStore, state: TableState, req: LookRequest, from: SeatId): RevealedCard[] | null {
  if (req.card === undefined) return null;
  const c = Object.hasOwn(state.cards, req.card) ? state.cards[req.card]! : null;
  if (!c || c.controller !== from || c.owner === from) return null;
  return lookAnswer(secrets, state, req, { allowZoneLook: false });
}

class NetTable implements NetSession, SessionRecovery {
  readonly roomId: string;
  /** The engine of the current join; replaced when this browser gives up a table it started alone (see `collision`). */
  private eng: NetEngine;
  private channel!: PrivateChannel;
  private readonly nonces: NonceStore;
  private readonly entropy: Entropy;
  private readonly peerId: string;
  private sec: SecretStore;
  private entries: LogEntry[];
  private saves: TablePersistence;
  /** The confirmed state as of the last sequenced action this session saw, folded action by action (saves, disclosures). */
  private fold: TableState;
  private readonly listeners = new Set<SessionListener>();
  private readonly netListeners = new Set<NetStatusListener>();
  private undoStack: UndoEntry[] = [];
  /** Own ids whose identity someone other than the owner saw since they were issued (core/secrets.ts disclosedBy). */
  private readonly exposed: Set<InstanceId>;
  /** Own randomness proposals by cid, for the integrity check when they come back sequenced. */
  private readonly sentRandomness = new Map<string, Action>();
  /** The private lists before an own action that changed them (reorder, re-issue, shuffle), restored when it is refused. */
  private readonly privateBefore = new Map<string, PrivateLists>();
  /** Own actions that make an own hidden card public, by cid: once sequenced, the card is turned up verified (`turnUpDue`). */
  private readonly turnUpAfter = new Map<string, { id: InstanceId; group?: string }>();
  /** Own cards to turn up with ref and salt, whose public-making action is sequenced (id → the action's undo group). */
  private readonly turnUpDue = new Map<InstanceId, string | undefined>();
  /** Refused verified turn-ups by card: given up after ROUND_ATTEMPTS. */
  private readonly turnUpRefusals = new Map<InstanceId, number>();
  /** Undo re-reveals waiting for their undo to be sequenced, by the undo's cid. */
  private readonly reRevealAfter = new Map<string, { reveals: UndoReveal[]; group?: string }>();
  /** Undo re-reveals whose undo is sequenced. */
  private reRevealDue: { reveal: UndoReveal; group?: string }[] = [];
  /** Targeted reveals to send on the pair channel once their public `revealTo` is sequenced. */
  private readonly revealsDue = new Map<string, { id: InstanceId; seats: SeatId[] }>();
  /** Refused own proposals by cid, with the reason (for the session's own waits). */
  private readonly refused = new Map<string, string>();
  /** A public own card came back to the hand: the hand owes a re-issue of its ids (`reissueHand`). */
  private reissueOwed = false;
  /** The cid of the own re-issue in flight. */
  private reissueCid: string | null = null;
  private reissueRefusals = 0;
  /** Refusals of contributions to one round, by round key. */
  private readonly roundRefusals = new Map<string, number>();
  private waiters: Waiter[] = [];
  private readonly cidPrefix = randomId('');
  private cidCount = 0;
  /** Nesting depth of own proposals: the view is reconciled with the action's placement after each. */
  private proposing = 0;
  private driveQueued = false;
  private netQueued = false;
  private lastSeat: SeatId;
  private disposed = false;
  /** Subscriptions to the current engine and its pair channel. */
  private readonly unsubs: Unsubscribe[] = [];
  /** Whether this browser created the room on its start page (see NetSessionInternals.createdHere). */
  private readonly createdHere: boolean;
  /** Times this browser gave up a table it started alone for the one already in the room (see `collision`). */
  private rejoins = 0;
  private rejoining = false;
  // The evening (session/draft.ts, M2-P7): its listeners survive a rejoin's new engine and pair channel.
  private readonly packListeners = new Set<(packId: PackId, cards: RevealedCard[], from: SeatId) => void>();
  private readonly cardsListeners = new Set<(about: string, cards: RevealedCard[], from: SeatId) => void>();
  private readonly sequencedListeners = new Set<(action: Action, state: TableState) => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly peerListeners = new Set<() => void>();
  /** Own pack-seed rounds run one after another. */
  private packChain: Promise<unknown> = Promise.resolve();
  private eveningImpl: Evening | null = null;
  /** Live voice (M3-P3, session/voice.ts); set by openNetSession when the options ask for it. */
  voiceImpl: VoiceControls | null = null;
  /** The Two-Headed Giant team view (M3-P2, session/team.ts). */
  private readonly teamView = new TeamView({ seat: () => this.seat, confirmedState: () => this.engine.confirmedState(), secrets: () => this.sec, now: () => this.now() });
  /** Dictation and captions (session/captions.ts, M3-P4); set once joined when the session has voice options. */
  captions?: CaptionControls;
  /** The post-game audit (M5-P2, session/audit.ts). */
  private readonly auditImpl: SessionAudit;

  constructor(
    engine: NetEngine,
    /** A new engine (with a new transport) over `start`, for a rejoin. */
    private readonly makeEngine: (start: ResumePoint) => NetEngine,
    private readonly opts: NetSessionOptions,
    private readonly internals: NetSessionInternals,
    init: { secrets: SecretStore; entries: LogEntry[]; snapshot: TableState; snapshotSeq: number; lastSeq: number },
  ) {
    this.eng = engine;
    this.roomId = opts.roomId;
    this.peerId = opts.identity.peerId;
    this.createdHere = internals.createdHere === true;
    this.nonces = internals.nonces ?? localNonces(opts.roomId, opts.identity.peerId);
    this.entropy = internals.entropy ?? DEFAULT_ENTROPY;
    this.entries = init.entries;
    this.fold = engine.confirmedState();
    this.lastSeat = engine.seat() ?? init.secrets.seat;
    this.sec = init.secrets;
    this.followView(engine.state(), 'top');
    this.exposed = exposedFromLog(
      init.entries.flatMap((e) => (e.kind === 'action' ? [e.action] : [])),
      engine.confirmedState(),
      this.sec.seat,
    );
    this.saves = this.persistence(init.snapshot, init.snapshotSeq, init.lastSeq);
    this.attach(engine);
    this.eveningImpl = new Evening(this.draftPort());
    this.auditImpl = new SessionAudit({
      seat: () => this.engine.seat(),
      secrets: () => this.sec,
      pending: () => this.engine.pending(),
      propose: (draft) => this.propose(this.stamp(draft), false),
      log: (level, text, afterSeq) => this.insertSystem(level, text, afterSeq),
      now: () => this.now(),
      changed: () => this.notify(),
    });
    this.auditImpl.rebuild(freshNetTable(opts.game, opts.format ?? '1v1'), init.entries, engine.confirmedState());
    registerAuditDebug(this.auditImpl);
  }

  /** The post-game audit (M5-P2): verdicts per game and seat, the own published bundles. */
  get audit(): AuditControls {
    return this.auditImpl;
  }

  /** The draft and the builder (M2-P7); absent without set data. */
  get draft(): DraftControls | undefined {
    return this.eveningImpl?.draft;
  }

  /** The Two-Headed Giant team view (M3-P2); absent outside a team format. */
  get team(): TeamControls | undefined {
    return isTeamFormat(this.engine.confirmedState().format) ? this.teamView : undefined;
  }

  /** The evening's stage flow (M2-P7). */
  get evening(): EveningControls | undefined {
    return this.eveningImpl?.evening;
  }

  /** Live voice and talk modes (M3-P3); absent without voice options. */
  get voice(): VoiceControls | undefined {
    return this.voiceImpl ?? undefined;
  }

  /** The own draft view for the debug hook, null outside a draft. */
  draftView(): ReturnType<Evening['view']> {
    return this.eveningImpl?.view() ?? null;
  }

  private persistence(snapshot: TableState, snapshotSeq: number, lastSeq: number, after?: Promise<void>): TablePersistence {
    return new TablePersistence({
      ...(after ? { after } : {}),
      store: this.opts.store,
      roomId: this.opts.roomId,
      roomKey: this.opts.roomKey,
      seat: () => this.engine.seat() ?? this.lastSeat,
      onError: (text) => this.system('warn', text),
      now: () => this.now(),
      snapshot,
      snapshotSeq,
      lastSeq,
    });
  }

  /** Follow `engine` and its pair channel. */
  private attach(engine: NetEngine): void {
    this.channel = createPrivateChannel(engine);
    this.unsubs.push(
      engine.onState((view) => this.onView(view)),
      engine.onSequenced((a, own) => this.onSequenced(a, own)),
      engine.onRollback((a, reason) => this.onRollback(a, reason)),
      engine.onSystem((level, text) => this.system(level, text)),
      engine.onStatus(() => {
        this.netChanged();
        // A replica now in step decides the turn-ups kept from before a reload (`keptTurnUp`).
        this.queueDrive();
      }),
      ...this.teamView.attach(engine),
      engine.onPeers(() => {
        for (const l of [...this.peerListeners]) l();
        this.teamView.sync(true);
        this.netChanged();
        // A peer that (re)connected may be the one a randomness round waits for, or this browser may owe it a nonce.
        this.queueDrive();
        if (this.collision()) queueMicrotask(() => void this.rejoin());
      }),
      engine.onSequencerChange(() => this.netChanged()),
      // A reveal to named spectators (M3-P5, net/roles.ts).
      spectatorRevealSender(engine, () => this.sec),
      this.channel.onIdentity((card, from, verified) => {
        if (!verified) {
          this.system('warn', `Integrity warning: ${from} showed this browser card ${card.instanceId}, and it does not match ${from}'s deck commitment`);
          this.notify();
          return;
        }
        this.setSecrets(receiveIdentity(this.sec, card, from));
        this.saves.saveSecrets(this.sec);
        this.notify();
      }),
      // Another seat's look, answered from the confirmed state (the pair channel itself refuses while own pending actions
      // may change that zone). A peek at an own face-down card is answered only for the seat that controls it (a card
      // whose control changed): its identity otherwise stays with its controller until it is turned up, and showing
      // it to anyone else is the owner's `revealTo` (DESIGN "Table model", Face-down on the battlefield; "Card
      // manipulation", Peek). Looks at a whole hidden zone are refused, since the owner has no way yet to agree to them
      // (core/secrets.ts lookAnswer; decisions M1-P2, M1-P8).
      this.channel.answerLooks((req, from) => peekAnswer(this.sec, this.engine.confirmedState(), req, from)),
      this.channel.onPack((packId, cards, from) => {
        for (const l of [...this.packListeners]) l(packId, cards, from);
      }),
      draftCardsOver(engine).on((about, cards, from) => {
        for (const l of [...this.cardsListeners]) l(about, cards, from);
      }),
    );
  }

  get engine(): NetEngine {
    return this.eng;
  }

  get presence(): NetEngine['presence'] {
    return this.eng.presence;
  }

  // --- Reading -----------------------------------------------------------------------------------------

  get seat(): SeatId {
    return this.engine.seat() ?? this.lastSeat;
  }

  getState(): TableState {
    return this.engine.state();
  }

  secrets(): SecretStore {
    return this.sec;
  }

  cardData(ref: CardRef): CardData | null {
    return this.opts.cardData.peek(ref.sid);
  }

  log(): LogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  whenSaved(): Promise<void> {
    return this.saves.whenSaved();
  }

  netStatus(): SessionNetStatus {
    return { mode: 'net', connection: this.engine.status(), peers: this.engine.peers(), sequencer: this.engine.sequencerId(), seq: this.engine.seq() };
  }

  subscribeNet(listener: NetStatusListener): () => void {
    this.netListeners.add(listener);
    return () => {
      this.netListeners.delete(listener);
    };
  }

  // --- Lifecycle ---------------------------------------------------------------------------------------

  leave(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eveningImpl?.dispose();
    this.auditImpl.dispose();
    this.voiceImpl?.dispose();
    this.teamView.dispose();
    this.captions?.dispose();
    for (const u of this.unsubs.splice(0)) u();
    this.engine.leave();
    for (const w of this.waiters.splice(0)) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(new Error('The session is closed'));
    }
    this.notifyNet();
    this.listeners.clear();
    this.netListeners.clear();
  }

  dispose(): void {
    this.leave();
  }

  // --- Public actions ----------------------------------------------------------------------------------

  dispatch(draft: ActionDraft): Action {
    const action = this.unstamped(draft);
    if (this.disposed) return this.stamp(action);
    if (SESSION_ONLY.has(action.type)) {
      this.warn(`${action.type} needs the session's private effects and cannot be dispatched directly`);
      return this.stamp(action);
    }
    const view = this.engine.state();
    // Nothing leaves a recovered library before it is jointly shuffled (DESIGN "Hidden information" 3): it is still in
    // the re-imported decklist's order.
    const taken = referencedCard(action);
    const leaves = action.type === 'draw' || ((action.type === 'toZone' || action.type === 'move') && action.to !== this.zone('library'));
    if (leaves && taken !== null && view.cards[taken]?.zone === this.zone('library') && this.libraryUnshuffled()) {
      this.warn(UNSHUFFLED);
      return this.stamp(action);
    }
    if (action.type === 'draw' && view.cards[action.instanceId]?.zone === this.zone('library') && this.sec.libraryOrder[0] !== action.instanceId) {
      this.warn('A draw takes the top card of the library');
      return this.stamp(action);
    }
    if (action.type === 'toZone' && view.cards[action.card]?.zone === action.to) {
      // A card put on top or at the bottom of the library it is in: a private reorder (scry, surveil).
      if (action.to === this.zone('library')) return this.reorderOne(action.card, action.position === 'bottom' ? 'bottom' : 'top', action.group) ?? this.stamp(action);
      return this.stamp(action);
    }
    if (action.type === 'rngReveal') return this.revealNonce(action);
    // A card that lies in a hidden zone has no own move of it in flight: a turn-up kept for it is stale (it is kept
    // again below when this action makes it public).
    const moved = referencedCard(action);
    if (moved !== null && view.zones[view.cards[moved]?.zone ?? '']?.visibility !== 'public') this.forgetTurnUp(moved);
    // A face-down card moved into a public zone that shows faces is turned up there, in one undo group with the move.
    const seat = this.seat;
    const turnUp = turnsUpOnMove(view, this.sec, seat, action);
    const act = withProof(view, this.sec, seat, turnUp && action.group === undefined ? ({ ...action, group: randomId('g') } as Action) : action);
    // An own card this action makes public goes down face down and is turned up, verified, once the action is
    // sequenced (Hidden information 2): its identity never goes out with, or ahead of, an action that may be refused.
    const publishes = turnsPublic(view, this.sec, seat, act, turnUp);
    const stamped = this.stamp(act);
    // Registered before proposing: the sequencer's own proposals come back sequenced inside `propose`.
    if (publishes !== null) {
      this.turnUpAfter.set(stamped.cid, { id: publishes, ...(act.group !== undefined ? { group: act.group } : {}) });
      // Kept in local storage too, so the card is still turned up after a reload before its flip is sequenced.
      this.nonces.set('turnUp', publishes, stamped.cid);
    }
    if (stamped.type === 'revealTo' && this.ownHidden(stamped.instanceId)) this.revealsDue.set(stamped.cid, { id: stamped.instanceId, seats: [...stamped.seats] });
    if (stamped.type === 'rngCommit') this.sentRandomness.set(stamped.cid, stamped);
    const done = this.propose(stamped);
    if (!done) {
      if (publishes !== null) this.nonces.delete('turnUp', publishes);
      this.turnUpAfter.delete(stamped.cid);
      this.revealsDue.delete(stamped.cid);
      this.sentRandomness.delete(stamped.cid);
    }
    // A card whose identity is already public (or a labelled table object) is turned up at once: no secret goes out.
    if (done && turnUp && publishes === null) this.propose(this.stamp({ type: 'flip', card: referencedCard(act)!, face: 'up', ...(act.group !== undefined ? { group: act.group } : {}) }));
    this.notify();
    return stamped;
  }

  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
    const action = this.stamp({ type: 'move', card, to, ...(pose ? { pose } : {}) });
    if (this.disposed) return action;
    if (!faceDownAllowed(this.engine.state(), this.seat, card, to)) {
      this.warn('Only a card from your own hand or library can be put onto a battlefield or into exile face down');
      this.notify();
      return action;
    }
    // A card played face down on purpose is never turned up by a turn-up kept from before (a face-up play of the same
    // card that was lost in a crash or reload before it was sequenced).
    this.forgetTurnUp(card);
    // No reveal: the reducer turns a card that leaves a hidden zone without a public identity face down.
    this.propose(action);
    this.notify();
    return action;
  }

  chat(text: string, channel: ChatChannel = 'table'): Action {
    if (channel === 'team') {
      // Team lines go to the teammate on the pair channel only, never into the shared log (M3-P2, session/team.ts).
      // A line longer than the channel carries is cut to it, so the own timeline shows what the teammate gets.
      const line = this.stamp({ type: 'chat', text: text.slice(0, MAX_TEAM_CHAT), channel });
      if (!this.disposed) this.teamView.say(line);
      return line;
    }
    return this.dispatch({ type: 'chat', text, channel });
  }

  /**
   * Take (or move to) a chair. The name is the identity's current nickname (main.ts hands a live identity whose
   * nickname follows the lobby's renames), or DEFAULT_NICKNAME while it has none. A move takes the new chair before it
   * leaves the old one, in one group, so this browser never stands without a chair (decision M1-P5).
   */
  takeSeat(seat: SeatId, colour: SeatColourIndex): Action {
    const current = this.engine.seat();
    const moving = current !== null && current !== seat;
    const group = moving ? randomId('g') : undefined;
    const name = this.opts.identity.nickname.trim() || DEFAULT_NICKNAME;
    const take = this.stampAs({ type: 'seatTake', seat, name, colour, peer: this.peerId, ...(group ? { group } : {}) }, seat);
    if (this.disposed) return take;
    const ok = this.propose(take);
    if (ok && moving) this.propose(this.stampAs({ type: 'seatLeave', seat: current, ...(group ? { group } : {}) }, current));
    this.notify();
    return take;
  }

  roll(purpose: RngPurpose, n: number): Promise<number> {
    return this.run(async () => {
      if (!this.engine.seat()) throw new Error('Take a chair first.');
      const rid = randomId('r');
      const nonce = randomSalt();
      this.nonces.set('rng', rid, nonce);
      const a = this.stamp({ type: 'rngCommit', rid, purpose, n, h: nonceHash(nonce) });
      this.sentRandomness.set(a.cid, a);
      if (!this.propose(a)) {
        this.nonces.delete('rng', rid);
        throw new Error(`The roll was refused: ${this.lastWarning()}`);
      }
      this.notify();
      await this.until(
        () => this.engine.confirmedState().rng[rid]?.result != null,
        () => this.refused.get(a.cid) ?? (this.gaveUp(`reveal:${rid}`) ? 'the roll could not be revealed' : null),
      );
      return this.engine.confirmedState().rng[rid]!.result!;
    });
  }

  // --- Private effects -----------------------------------------------------------------------------------

  importDeck(deck: DeckImport): Promise<void> {
    return this.run(async () => {
      const seat = this.engine.seat();
      if (!seat) throw new Error('Take a chair first.');
      const s = this.engine.state();
      if (s.commitments[seat] || Object.values(s.cards).some((c) => c.owner === seat && !c.isToken)) throw new Error('A deck is already on the table');
      if (!Array.isArray(deck.main) || deck.main.length === 0) throw new RangeError('The deck has no main-deck cards');
      for (const raw of deck.main) if (!raw || typeof raw.sid !== 'string' || raw.sid === '') throw new TypeError('Every card needs a Scryfall id');
      const before = this.sec;
      const r = commitDeck({ ...this.sec, seat }, deck.main, this.entropy);
      const pool = deck.side.map((x): CardRef => (x.foil ? { sid: x.sid, foil: true } : { sid: x.sid }));
      // A constructed deck is kept as the deck being built, so a rematch can sideboard it (M2-P7); a drafted deck's
      // build is the builder's own.
      this.setSecrets({ ...r.secrets, pool, ...(s.draft === undefined ? { build: buildFromDeck({ main: deck.main, side: deck.side }) } : {}) });
      const ready = this.stamp(r.action);
      if (!this.propose(ready)) {
        this.setSecrets(before);
        throw new Error(`The deck could not be put on the table: ${this.lastWarning()}`);
      }
      this.saves.saveSecrets(this.sec);
      this.undoStack = [];
      this.prefetch([...deck.main, ...deck.side].map((x) => x.sid));
      this.notify();
      await this.sequenced(ready.cid);
    });
  }

  shuffle(zone: ZoneId = this.zone('library')): Promise<void> {
    return this.run(() => this.shuffleNow(zone));
  }

  draw(n = 1): Promise<void> {
    return this.run(() => {
      // A recovered library is drawn from only once it is jointly shuffled (DESIGN "Hidden information" 3).
      if (this.libraryUnshuffled()) throw new Error(UNSHUFFLED);
      this.drawNow(n);
      this.notify();
    });
  }

  mulligan(): Promise<void> {
    return this.run(async () => {
      const count = this.entries.filter((e) => e.kind === 'action' && e.action.type === 'mulligan' && e.action.by === this.seat).length + 1;
      const m = this.stamp({ type: 'mulligan', count });
      if (!this.propose(m)) throw new Error(`The mulligan was refused: ${this.lastWarning()}`);
      this.notify();
      await this.shuffleNow(this.zone('library'));
      this.drawNow(NET_MULLIGAN_HAND);
      // A mulligan contains a shuffle; nothing before it, and none of its draws, can be undone.
      this.undoStack = [];
      this.notify();
    });
  }

  lookAt(zone: ZoneId, n: number): Promise<LookedCard[]> {
    return this.run(() => {
      const list = this.privateList(zone);
      if (!Number.isInteger(n) || n < 0) throw new RangeError('Look at a whole number of cards');
      const k = Math.min(n, list.length);
      if (!this.propose(this.stamp({ type: 'lookAt', zone, count: k }))) throw new Error(`The look was refused: ${this.lastWarning()}`);
      this.notify();
      return list.slice(0, k).map((id) => ({ id, ref: this.sec.identities[id]!.card }));
    });
  }

  // --- Lost-save recovery (PLAN M1-P7) --------------------------------------------------------------------

  /** `recover` and `finishRecovery` calls of this page still running. */
  private recoveryRuns = 0;
  /** Whether `drive` already started finishing an owed recovery in this page (once; the panel offers it again). */
  private recoveryResumed = false;

  recovering(): boolean {
    return this.recoveryRuns > 0;
  }

  /** The stored rest of an own recovery, whether or not its `recoverCommit` is sequenced yet. */
  private storedOwed(): RecoveryOwed | null {
    return parseRecoveryOwed(this.nonces.get('recovery', OWED));
  }

  private storeOwed(owed: RecoveryOwed | null): void {
    if (owed === null) this.nonces.delete('recovery', OWED);
    else this.nonces.set('recovery', OWED, JSON.stringify(owed));
  }

  recoveryOwed(): RecoveryOwed | null {
    const owed = this.storedOwed();
    if (!owedOn(this.engine.confirmedState(), this.sec, this.seat, owed)) return null;
    // Done once the new library is shuffled and the agreed hand was drawn after the commit (by the recovery or by hand):
    // a record that a failed finish left behind is not owed for the rest of the game.
    return this.recoveryShuffled(owed!) && this.recoveryDrawsLeft(owed!) <= 0 ? null : owed;
  }

  /** The own actions sequenced after the own `recoverCommit` that created `owed.id`, or null when the log lacks it (a catch-up from a snapshot). */
  private afterRecoverCommit(owed: RecoveryOwed): Action[] | null {
    const log = this.entries.flatMap((e) => (e.kind === 'action' ? [e.action] : []));
    const at = log.findIndex((a) => a.type === 'recoverCommit' && a.by === this.seat && a.instanceIds.includes(owed.id));
    return at < 0 ? null : log.slice(at + 1).filter((a) => a.by === this.seat);
  }

  /** Whether the own library was shuffled (a secret shuffle done) since the recovery's commit. */
  private recoveryShuffled(owed: RecoveryOwed): boolean {
    const st = this.engine.confirmedState();
    if (owed.shuffle !== null && st.shuffles[owed.shuffle]?.orderHash != null) return true;
    const after = this.afterRecoverCommit(owed) ?? [];
    const library = this.zone('library');
    const sids = new Set(after.flatMap((a) => (a.type === 'shuffleCommit' && a.zone === library ? [a.sid] : [])));
    return after.some((a) => a.type === 'shuffleDone' && sids.has(a.sid));
  }

  /**
   * How many of the agreed hand are still to be drawn: the agreed count minus the own draws sequenced after the
   * commit (so a hand played out since is not drawn again), or minus the hand now when the log lacks the commit.
   */
  private recoveryDrawsLeft(owed: RecoveryOwed): number {
    const after = this.afterRecoverCommit(owed);
    if (after === null) return owed.hand - (this.engine.confirmedState().zones[this.zone('hand')]?.ids.length ?? 0);
    return owed.hand - after.filter((a) => a.type === 'draw').length;
  }

  /** Whether an own recovery's new library is committed but not shuffled yet: nothing is drawn from it before. */
  private libraryUnshuffled(): boolean {
    const owed = this.recoveryOwed();
    return owed !== null && !this.recoveryShuffled(owed);
  }

  /**
   * The lost-save recovery (DESIGN "Multiplayer architecture", Resume and failure handling; session/resume.ts
   * SessionRecovery): propose the fresh hand count in a confirmation round, wait for the table, then commit the
   * re-imported deck minus the seat's public cards as the new library, shuffle it with the other seats' nonces and
   * draw the agreed hand. Re-running it after a reload picks up an open proposal of the same count; once the commit is
   * sequenced it finishes that recovery (`finishRecovery`, the agreed count) instead.
   */
  recover(deck: DeckImport, hand: number): Promise<void> {
    return this.recoveryRun((seat) => {
      if (!deck || !Array.isArray(deck.main) || !Array.isArray(deck.side)) throw new TypeError('A recovery needs the re-imported deck');
      const owed = this.recoveryOwed();
      return owed ? this.finishNow(seat, owed) : this.recoverNow(seat, deck, hand);
    });
  }

  finishRecovery(): Promise<void> {
    return this.recoveryRun((seat) => {
      const owed = this.recoveryOwed();
      return owed ? this.finishNow(seat, owed) : Promise.resolve();
    });
  }

  private recoveryRun(fn: (seat: SeatId) => Promise<void>): Promise<void> {
    return this.run(async () => {
      const seat = this.engine.seat();
      if (!seat) throw new Error('Take a chair first.');
      if (this.recoveryRuns > 0) throw new Error('A recovery is already running in this page');
      this.recoveryRuns++;
      this.netChanged();
      try {
        await fn(seat);
      } finally {
        this.recoveryRuns--;
        this.notify();
        this.netChanged();
      }
    });
  }

  private async recoverNow(seat: SeatId, deck: DeckImport, hand: number): Promise<void> {
    // Own public cards whose identity this browser lost but the log still names (DESIGN "Multiplayer architecture",
    // Resume): held again, a bounce of one of them later re-issues the hand as usual.
    this.adoptLoggedIdentities();
    const view = this.engine.state();
    const open = view.seats[seat]?.recovering;
    let round: string;
    if (open && open.hand === hand && view.confirm?.id === open.round) {
      // The same count is already proposed (this page reloaded mid-recovery): wait for that round.
      round = open.round;
    } else {
      const problem = recoveryProblem(view, seat, deck.main, hand);
      if (problem !== null) throw new Error(problem);
      round = randomId('rec');
      const a = this.stamp({ type: 'recover', hand, round });
      if (!this.propose(a, false)) throw new Error(`The recovery was refused: ${this.lastWarning()}`);
      // Nothing before the recovery can be undone across it (the reducer discarded the hidden zones).
      this.undoStack = [];
      this.notify();
      await this.sequenced(a.cid);
    }
    // The table agrees in the round: silence passes after the timer, a hold objects (DESIGN "Turn flow and confirmation").
    await this.until(
      () => {
        const st = this.engine.confirmedState();
        return st.seats[seat]?.recovering?.round === round && st.confirm?.id === round && roundPassed(st);
      },
      () => {
        const st = this.engine.confirmedState();
        if (st.seats[seat]?.recovering?.round !== round) return 'The recovery proposal was replaced';
        if (st.confirm?.id !== round) return 'Another confirmation round started before the table agreed to the recovery: propose it again';
        return null;
      },
    );
    const st = this.engine.confirmedState();
    const agreed = st.seats[seat]!.recovering!.hand;
    const rest = recoveryRemainder(deck.main, st, seat);
    if (rest === null) throw new Error('The re-imported deck does not cover your cards on the table');
    // Fresh ids that the table has never seen for this seat (the reducer refuses an id committed before).
    const used = new Set<string>([...Object.keys(st.cards), ...(st.commitments[seat]?.instanceIds ?? []), ...Object.keys(this.sec.identities)]);
    const entropy: Entropy = {
      id: () => {
        for (let i = 0; i < 100; i++) {
          const id = this.entropy.id();
          if (!used.has(id)) return id;
        }
        throw new Error('No fresh card id could be made for the recovered library');
      },
      salt: this.entropy.salt,
    };
    const c = commitDeck({ ...this.sec, seat, libraryOrder: [], hand: [] }, rest, entropy);
    const pool = deck.side.map((x): CardRef => (x.foil ? { sid: x.sid, foil: true } : { sid: x.sid }));
    const commit = this.stamp({ type: 'recoverCommit', commits: c.action.commits, instanceIds: c.action.instanceIds, zone: this.zone('library') });
    // What the recovery owes after its commit is kept before the commit is proposed (the sequencer's own proposal is
    // sequenced inside `propose`), so a reload at any point after it still shuffles and draws (`finishRecovery`).
    const first = c.action.instanceIds[0];
    const owed: RecoveryOwed | null = first === undefined ? null : { id: first, hand: agreed, shuffle: null };
    this.storeOwed(owed);
    if (!this.proposePrivate(commit, { ...c.secrets, pool })) {
      this.storeOwed(null);
      throw new Error(`The recovered library was refused: ${this.lastWarning()}`);
    }
    this.prefetch([...deck.main, ...deck.side].map((x) => x.sid));
    this.notify();
    await this.sequenced(commit.cid);
    // An empty library (every card of the deck is public) has nothing to shuffle and no hand to draw.
    if (owed) await this.finishNow(seat, owed);
  }

  /**
   * The steps a recovery owes after its `recoverCommit`: the secret shuffle of the new library (DESIGN "Hidden
   * information" 3: the owner cannot choose the order, so nothing is drawn before it), then draws until the hand
   * holds the agreed count. Each step is decided from the confirmed state, so it resumes after a reload.
   */
  private async finishNow(seat: SeatId, owed: RecoveryOwed): Promise<void> {
    const library = this.zone('library');
    const sid = owed.shuffle;
    const started = (id: string): boolean =>
      Object.hasOwn(this.engine.confirmedState().shuffles, id) || this.engine.pending().some((a) => a.type === 'shuffleCommit' && a.sid === id);
    if (this.recoveryShuffled(owed)) {
      // Shuffled already (before a reload, or by hand).
    } else if (sid !== null && started(sid)) {
      await this.shuffleSettled(sid, null);
    } else {
      // Not proposed yet, or lost with the page that proposed it: shuffle now.
      const next = randomId('sh');
      this.storeOwed({ ...owed, shuffle: next });
      await this.shuffleNow(library, next);
    }
    const drawing = (): boolean => this.engine.pending().some((a) => a.type === 'draw' && a.by === seat);
    // Own draws in flight are counted once they are sequenced.
    await this.until(() => !drawing(), () => null);
    for (let attempt = 0; this.recoveryDrawsLeft(owed) > 0; attempt++) {
      if (attempt >= ROUND_ATTEMPTS) throw new Error(`Only ${owed.hand - this.recoveryDrawsLeft(owed)} of the agreed ${owed.hand} cards could be drawn: finish the recovery again`);
      this.drawNow(this.recoveryDrawsLeft(owed));
      this.notify();
      await this.until(() => !drawing(), () => null);
    }
    this.storeOwed(null);
    // Nothing before the recovery, and none of its draws, can be undone (as after a mulligan).
    this.undoStack = [];
    this.notify();
  }

  /** Hold every own card whose identity this browser lacks but the sequenced log names (session/resume.ts identitiesFromLog). */
  private adoptLoggedIdentities(): void {
    const found = identitiesFromLog(
      this.entries.flatMap((e) => (e.kind === 'action' ? [e.action] : [])),
      this.engine.confirmedState(),
      this.sec.seat,
      this.sec.identities,
    );
    if (Object.keys(found).length === 0) return;
    this.setSecrets({ ...this.sec, identities: { ...this.sec.identities, ...found } });
    this.saves.saveSecrets(this.sec);
  }

  undo(): boolean {
    if (this.disposed) return false;
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top) return false;
    let k = 1;
    if (top.group !== undefined) while (k < this.undoStack.length && this.undoStack[this.undoStack.length - 1 - k]!.group === top.group) k++;
    const batch = this.undoStack.slice(this.undoStack.length - k).reverse();
    const group = batch.length > 1 ? randomId('g') : undefined;
    const undos = batch.map((e): ActionDraft => ({ type: 'undo', of: e.cid, inverse: e.inverse, ...(group ? { group } : {}) }));
    // Dry run on the view first: a group is undone completely or not at all.
    let s = this.engine.state();
    for (const u of undos) {
      const dry = { ...u, by: this.seat, cid: DRY_CID, seq: s.seq + 1 } as Action;
      const next = reduce(s, dry);
      if (next === s) {
        this.warn(`Cannot undo: ${explain(s, dry) ?? 'refused'}`);
        this.notify();
        return false;
      }
      s = next;
    }
    this.undoStack = this.undoStack.slice(0, this.undoStack.length - k);
    undos.forEach((u, i) => {
      const { hand, library, reveals } = batch[i]!;
      const handPrior = this.sec.hand;
      const libraryPrior = this.sec.libraryOrder;
      const stamped = this.stamp(u);
      // A restore patch never puts a committed identity back: the owner re-reveals, verified against the commitment,
      // once the undo is sequenced (a re-reveal sent ahead of an undo that is then refused would publish the card
      // wherever it still is).
      if (reveals.length) this.reRevealAfter.set(stamped.cid, { reveals, ...(group !== undefined ? { group } : {}) });
      if (!this.propose(stamped, false)) {
        this.reRevealAfter.delete(stamped.cid);
        return;
      }
      // Only the cards this step returns go back to their old places; the rest keep the current private order, so a
      // later scry or other private reorder is not undone with it (DESIGN "Turn flow and confirmation", Undo).
      this.setSecrets({ ...this.sec, hand: putBack(this.sec.hand, handPrior, hand) });
      const now = this.sec.libraryOrder;
      const target = putBack(now, libraryPrior, library);
      if (!sameOrder(now, target)) this.commitReorder(target, 1, group);
    });
    this.notify();
    return true;
  }

  // --- Internals: proposing ----------------------------------------------------------------------------------

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private zone(kind: string): ZoneId {
    return zoneId(kind, this.seat);
  }

  private ownHidden(id: InstanceId): boolean {
    const c = this.engine.state().cards[id];
    return !!c && c.owner === this.seat && c.identity === undefined && Object.hasOwn(this.sec.identities, id);
  }

  private unstamped(draft: ActionDraft): Action {
    const { seq: _seq, ...rest } = draft as ActionDraft & { seq?: number };
    return { ...rest, by: this.seat, cid: DRY_CID } as Action;
  }

  private stamp(draft: ActionDraft | Action): Action {
    return this.stampAs(draft, this.seat);
  }

  private stampAs(draft: ActionDraft | Action, by: SeatId): Action {
    const { seq: _seq, ...rest } = draft as ActionDraft & { seq?: number };
    return { ...rest, by, cid: `n.${this.cidPrefix}.${++this.cidCount}` } as Action;
  }

  private run<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('The session is closed'));
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Apply a stamped own action optimistically and propose it (NetEngine.propose). The private lists are reconciled
   * with the view afterwards, with the action's placement (a card put at the bottom of the library goes there).
   * Records the undo entry. False (with a warning in the log) when the reducer refuses it on the view.
   */
  private propose(action: Action, undoable = true): boolean {
    if (this.disposed) return false;
    const before = this.engine.state();
    const handBefore = this.sec.hand;
    const libraryBefore = this.sec.libraryOrder;
    const plan = undoable && isUndoable(action) ? undoPlan(before, action) : null;
    this.proposing++;
    let ok: boolean;
    try {
      ok = this.engine.propose(action);
    } finally {
      this.proposing--;
    }
    if (!ok) {
      this.warn(`${action.type} refused: ${explain(before, { ...action, seq: before.seq + 1 } as Action) ?? 'no effect'}`);
      return false;
    }
    if (plan) {
      this.undoStack.push({
        cid: action.cid,
        ...(action.group !== undefined ? { group: action.group } : {}),
        inverse: plan.inverse,
        reveals: plan.reveals,
        hand: [...handBefore],
        library: [...libraryBefore],
      });
    }
    this.followView(this.engine.state(), placementOf(action));
    return true;
  }

  /** The private hand and library follow the view; received identities this browser may no longer see are dropped. */
  private followView(view: TableState, placement: LibraryPlacement): void {
    const seat = this.engine.seat();
    if (seat !== null) {
      this.lastSeat = seat;
      // The chair changes only in the lobby, before Ready: the store follows it while it holds no cards.
      if (this.sec.seat !== seat && Object.keys(this.sec.identities).length === 0) this.sec = { ...this.sec, seat };
    }
    this.setSecrets(pruneReceived(reconcileSecrets(this.sec, view, placement), view));
  }

  private setSecrets(next: SecretStore): void {
    this.sec = next;
  }

  private onView(view: TableState): void {
    if (this.disposed) return;
    // An own proposal reconciles with its own placement right after it returns.
    if (this.proposing === 0) this.followView(view, 'top');
    this.notify();
    this.netChanged();
  }

  /** A private reorder of the own library: public `reorder {zone, count, orderHash}` plus the record (core/secrets.ts privateReorder). */
  private commitReorder(order: InstanceId[], count: number, group: string | undefined): Action | null {
    const zone = this.zone('library');
    let r: ReturnType<typeof privateReorder>;
    try {
      r = privateReorder(this.sec, this.engine.state(), zone, order, count, this.entropy);
    } catch (e) {
      this.warn(errorText(e));
      return null;
    }
    return this.proposePrivate(this.stamp({ ...r.action, ...(group !== undefined ? { group } : {}) }), r.secrets);
  }

  /** Propose an action that comes with new private lists; they are taken back when it is refused. */
  private proposePrivate(action: Action, next: SecretStore): Action | null {
    const before: PrivateLists = { identities: this.sec.identities, libraryOrder: this.sec.libraryOrder, hand: this.sec.hand, audit: this.sec.audit };
    this.setSecrets(next);
    this.privateBefore.set(action.cid, before);
    if (!this.propose(action, false)) {
      this.privateBefore.delete(action.cid);
      this.setSecrets({ ...this.sec, ...before });
      return null;
    }
    this.saves.saveSecrets(this.sec);
    return action;
  }

  private reorderOne(id: InstanceId, where: LibraryPlacement, group: string | undefined): Action | null {
    const rest = this.sec.libraryOrder.filter((x) => x !== id);
    const order = where === 'bottom' ? [...rest, id] : [id, ...rest];
    if (order.every((x, i) => x === this.sec.libraryOrder[i])) return null;
    const done = this.commitReorder(order, 1, group);
    this.notify();
    return done;
  }

  private privateList(zone: ZoneId): InstanceId[] {
    if (zone === this.zone('library')) return this.sec.libraryOrder;
    if (zone === this.zone('hand')) return this.sec.hand;
    throw new Error(`${zone} is not one of your hidden zones`);
  }

  private drawNow(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('Draw a whole number of cards');
    const group = n > 1 ? randomId('g') : undefined;
    for (let i = 0; i < n; i++) {
      const top = this.sec.libraryOrder[0];
      if (top === undefined) {
        this.warn('The library is empty');
        return;
      }
      if (!this.propose(this.stamp({ type: 'draw', instanceId: top, ...(group ? { group } : {}) }))) return;
    }
  }

  /** The secret shuffle of an own hidden zone (DESIGN "Secret shuffle" 1; `drive` finishes it once the nonces are in). */
  private async shuffleNow(zone: ZoneId, sid: ShuffleId = randomId('sh')): Promise<void> {
    this.privateList(zone);
    if (!this.engine.state().zones[zone]) throw new Error(`Unknown zone ${zone}`);
    const b = beginShuffle(this.sec, zone, sid, randomSalt());
    const a = this.stamp(b.action);
    if (!this.proposePrivate(a, b.secrets)) throw new Error(`The shuffle was refused: ${this.lastWarning()}`);
    // Shuffles cannot be undone, and nothing before a shuffle can be undone across it.
    this.undoStack = [];
    this.notify();
    await this.shuffleSettled(sid, a.cid);
  }

  /** Resolve once own shuffle `sid` is done; reject when its `shuffleCommit` (`cid`, if known) is refused or it was given up. */
  private shuffleSettled(sid: ShuffleId, cid: string | null): Promise<void> {
    return this.until(
      () => this.engine.confirmedState().shuffles[sid]?.orderHash != null,
      // Only a refusal ends the wait: an own action of a history the engine abandons is proposed again (M1-P1).
      () => (cid !== null ? this.refused.get(cid) : undefined) ?? (this.gaveUp(`done:${sid}`) ? 'the shuffle could not be finished' : null),
    );
  }

  /** An `rngReveal` the HUD sends right after its `rngCommit`: kept until every commit is in, then sent by `drive`. */
  private revealNonce(action: Action): Action {
    if (action.type !== 'rngReveal') return this.stamp(action);
    this.nonces.set('rng', action.rid, action.nonce);
    const view = this.engine.state();
    if (!Object.hasOwn(view.rng, action.rid) || !rngCommitPhaseComplete(view, action.rid)) {
      this.queueDrive();
      return this.stamp(action);
    }
    const a = this.stamp(action);
    this.sentRandomness.set(a.cid, a);
    if (!this.propose(a, false)) this.sentRandomness.delete(a.cid);
    this.notify();
    return a;
  }

  private pendingCid(cid: string): boolean {
    return this.engine.pending().some((a) => a.cid === cid);
  }

  // --- Internals: what comes back from the table ---------------------------------------------------------

  private onSequenced(action: SequencedAction, own: boolean): void {
    if (this.disposed) return;
    // The confirmed state before and after this action: folded step by step while the actions follow each other; after
    // a catch-up from a snapshot or a rewind to another history, the engine's confirmed state is the new base.
    const prior = this.fold;
    let next: TableState;
    let exact = false;
    if (action.seq === prior.seq + 1) {
      next = applySequenced(prior, action);
      exact = true;
    } else if (action.seq <= prior.seq && this.engine.confirmedState() === prior) {
      next = prior;
    } else {
      next = this.engine.confirmedState();
    }
    this.fold = next;
    if (exact) for (const id of disclosedBy(this.sec, prior, action, next)) this.exposed.add(id);
    else if (next !== prior) {
      // A catch-up from a snapshot or a rewound history skipped the actions in between, and with them any reveal, look
      // or flip of an own card: every own card counts as seen, so the next shuffle re-issues its zone (an extra
      // re-issue is harmless; a missed one would let a peer follow a card through the shuffle).
      for (const [id, c] of Object.entries(next.cards)) if (c.owner === this.sec.seat) this.exposed.add(id);
    }
    // The log: a rewound history replaces the entries from its first replaced seq on.
    const last = this.entries.findLastIndex((e) => e.kind === 'action');
    if (last >= 0 && this.entries[last]!.seq >= action.seq) this.entries = this.entries.filter((e) => e.kind !== 'action' || e.seq < action.seq);
    this.entries.push({ kind: 'action', seq: action.seq, at: this.now(), action });
    this.saves.saveAction(action, next, this.sec);
    if (own) this.ownSequenced(action);
    this.auditImpl.sequenced(action, prior, next, exact);
    // A public card of this seat back in its hand: the hand gets fresh opaque ids, so peers cannot link the card's
    // later reveal to this one (DESIGN "Table model", Hidden cards; decision M1-P2).
    const hand = zoneId('hand', this.sec.seat);
    const back = Object.entries(next.cards).some(([id, c]) => c.zone === hand && c.owner === this.sec.seat && prior.cards[id] !== undefined && prior.zones[prior.cards[id]!.zone]?.visibility === 'public');
    if (back) this.reissueOwed = true;
    for (const l of [...this.sequencedListeners]) l(action, next);
    this.queueDrive();
    this.netChanged();
  }

  private ownSequenced(action: SequencedAction): void {
    this.refused.delete(action.cid);
    if (action.cid === this.reissueCid) {
      this.reissueCid = null;
      this.reissueRefusals = 0;
    }
    this.privateBefore.delete(action.cid);
    const sent = this.sentRandomness.get(action.cid);
    if (sent) {
      this.sentRandomness.delete(action.cid);
      if (canonicalJson(withoutSeq(sent)) !== canonicalJson(withoutSeq(action))) {
        this.system('warn', `Integrity warning: your ${action.type} came back from the sequencer changed (seq ${action.seq})`);
      }
    }
    const up = this.turnUpAfter.get(action.cid);
    if (up) {
      this.turnUpAfter.delete(action.cid);
      this.turnUpDue.set(up.id, up.group);
    }
    const again = this.reRevealAfter.get(action.cid);
    if (again) {
      this.reRevealAfter.delete(action.cid);
      for (const reveal of again.reveals) this.reRevealDue.push({ reveal, ...(again.group !== undefined ? { group: again.group } : {}) });
    }
    const due = this.revealsDue.get(action.cid);
    if (due) {
      this.revealsDue.delete(action.cid);
      const card = revealedCard(this.sec, due.id);
      if (card) this.channel.reveal(due.seats, [card], 'revealTo', action.cid);
    }
  }

  /**
   * The hand's fresh ids after a public card came back to it (owed from `onSequenced`, run by `drive`). A re-issue
   * refused locally or by the sequencer (a concurrent action touched a hand id) stays owed and is tried again, up to
   * ROUND_ATTEMPTS refusals.
   */
  private reissueHand(): void {
    if (this.disposed || !this.reissueOwed || this.reissueCid !== null) return;
    if (this.reissueRefusals >= ROUND_ATTEMPTS) {
      this.reissueOwed = false;
      this.reissueRefusals = 0;
      this.warn('The hand could not get fresh ids: a card that was public may be recognised in it');
      return;
    }
    const view = this.engine.state();
    const hand = zoneId('hand', this.seat);
    // A card of the hand this browser cannot name: a public card it lost with its save comes back named by the log;
    // a hand still lost (its save is gone) cannot get fresh ids, and the lost-save recovery replaces it (M1-P7).
    if (lostHiddenCards(view, this.sec, this.seat).hand.length > 0) this.adoptLoggedIdentities();
    if (lostHiddenCards(view, this.sec, this.seat).hand.length > 0) {
      this.reissueOwed = false;
      return;
    }
    const r = reissueZone(this.sec, view, hand, this.entropy);
    if (!r) {
      this.reissueOwed = false;
      return;
    }
    const retired = view.zones[hand]?.ids ?? [];
    const a = this.stamp(r.action);
    // Set before proposing: the sequencer's own proposal comes back sequenced inside `propose`.
    this.reissueCid = a.cid;
    this.reissueOwed = false;
    if (!this.proposePrivate(a, r.secrets)) {
      this.reissueCid = null;
      this.reissueOwed = true;
      this.reissueRefusals++;
      return;
    }
    // Undo steps that name a retired id can never apply again; left on the stack they would block every later undo.
    this.undoStack = this.undoStack.filter((e) => {
      const text = canonicalJson(e.inverse);
      return !retired.some((id) => text.includes(id));
    });
    this.notify();
  }

  private onRollback(action: Action, reason: string): void {
    if (this.disposed || reason === NACK_DUPLICATE) return;
    this.refused.set(action.cid, reason);
    this.undoStack = this.undoStack.filter((e) => e.cid !== action.cid);
    const up = this.turnUpAfter.get(action.cid);
    if (up && this.nonces.get('turnUp', up.id) === action.cid) this.nonces.delete('turnUp', up.id);
    this.turnUpAfter.delete(action.cid);
    if (action.cid === this.reissueCid) {
      // A refused hand re-issue is owed again (`drive` retries it).
      this.reissueCid = null;
      this.reissueOwed = true;
      this.reissueRefusals++;
      this.queueDrive();
    }
    this.reRevealAfter.delete(action.cid);
    if (action.type === 'flip' && action.ref !== undefined) this.turnUpRefusals.set(action.card, (this.turnUpRefusals.get(action.card) ?? 0) + 1);
    this.revealsDue.delete(action.cid);
    this.sentRandomness.delete(action.cid);
    const lists = this.privateBefore.get(action.cid);
    if (lists) {
      this.privateBefore.delete(action.cid);
      this.setSecrets({ ...this.sec, ...lists });
      this.saves.saveSecrets(this.sec);
    }
    const key = roundKey(action);
    if (key !== null) this.roundRefusals.set(key, (this.roundRefusals.get(key) ?? 0) + 1);
    this.auditImpl.refused(action);
    this.warn(`${action.type} refused: ${reason}`);
    // Lost a chair to someone who sat down at the same moment: take the next free one (lobby only).
    if (action.type === 'seatTake' && !this.sitting && this.engine.seat() === null && this.engine.state().stage === 'lobby' && this.seatAttempts < SEAT_ATTEMPTS) {
      queueMicrotask(() => this.sitIfUnseated());
    }
    this.followView(this.engine.state(), 'top');
    this.notify();
  }

  // --- Joint randomness ------------------------------------------------------------------------------------

  private queueDrive(): void {
    if (this.driveQueued || this.disposed) return;
    this.driveQueued = true;
    queueMicrotask(() => {
      this.driveQueued = false;
      this.drive();
    });
  }

  /** Whether this browser stopped contributing to a round after repeated refusals. */
  private gaveUp(key: string): boolean {
    return (this.roundRefusals.get(key) ?? 0) >= ROUND_ATTEMPTS;
  }

  /** Whether an own pending action of `type` concerns round `id`. */
  private inFlight(type: string, id: string): boolean {
    return this.engine.pending().some((a) => a.type === type && ((a as { sid?: string }).sid === id || (a as { rid?: string }).rid === id));
  }

  private contribute(key: string, draft: ActionDraft): void {
    if (this.gaveUp(key)) return;
    const a = this.stamp(draft);
    if (draft.type !== 'shuffleDone') this.sentRandomness.set(a.cid, a);
    if (!this.propose(a, false)) {
      this.roundRefusals.set(key, (this.roundRefusals.get(key) ?? 0) + 1);
      this.sentRandomness.delete(a.cid);
    }
  }

  /**
   * Everything this browser owes the table's joint randomness, from the confirmed state (DESIGN "Public randomness"
   * 2-3, "Secret shuffle" 2, 5): a nonce for every other seat's open shuffle and a commit for every open rng round
   * that waits for this seat, the reveal of every committed own nonce once all commits are in, and the `shuffleDone`
   * of every own shuffle that is ready. Runs after every sequenced action and every change of peers, so a round
   * still waiting after a reload or a reconnect gets its contribution. Also settles the session's own waits.
   */
  private drive(): void {
    if (this.disposed) return;
    const st = this.engine.confirmedState();
    const me = seatOfPeer(st, this.peerId);
    if (me !== null) {
      for (const [sid, r] of Object.entries(st.shuffles)) {
        if (r.orderHash !== null) {
          this.nonces.delete('shuffle', sid);
          continue;
        }
        if (r.owner === me && r.purpose === 'pack') {
          // An own pack-seed round (M2-P7 `packSeed`): finished with its kept nonce once ready, also after a reload.
          // A round whose nonce this browser lost (cleared storage) is closed unused, so the pack zone is free again.
          const nonce = this.nonces.get('shuffle', sid) ?? randomSalt();
          if (!shuffleReady(st, sid) || this.inFlight('shuffleDone', sid) || this.gaveUp(`done:${sid}`)) continue;
          if (!this.propose(this.stamp({ type: 'shuffleDone', sid, orderHash: orderHash([], nonce) }), false)) this.roundRefusals.set(`done:${sid}`, (this.roundRefusals.get(`done:${sid}`) ?? 0) + 1);
          continue;
        }
        if (r.owner === me) {
          if (!shuffleReady(st, sid) || this.inFlight('shuffleDone', sid) || shuffleRecord(this.sec, sid) === null) continue;
          if (this.gaveUp(`done:${sid}`)) continue;
          let f: ReturnType<typeof finishShuffle>;
          try {
            f = finishShuffle(this.sec, st, sid, this.entropy, this.exposed);
          } catch (e) {
            this.warn(errorText(e));
            this.roundRefusals.set(`done:${sid}`, ROUND_ATTEMPTS);
            continue;
          }
          if (!this.proposePrivate(this.stamp(f.action), f.secrets)) this.roundRefusals.set(`done:${sid}`, (this.roundRefusals.get(`done:${sid}`) ?? 0) + 1);
          continue;
        }
        if (r.closedSeq !== undefined || Object.hasOwn(r.nonces, me) || !expectedParticipants(st, sid, 'shuffle').includes(me)) continue;
        if (this.inFlight('shuffleNonce', sid)) continue;
        let nonce = this.nonces.get('shuffle', sid);
        if (nonce === null) {
          nonce = randomSalt();
          this.nonces.set('shuffle', sid, nonce);
        }
        this.contribute(`nonce:${sid}`, { type: 'shuffleNonce', sid, nonce });
      }
      for (const [rid, r] of Object.entries(st.rng)) {
        if (r.result !== null) {
          this.nonces.delete('rng', rid);
          continue;
        }
        const committed = Object.hasOwn(r.commits, me);
        if (!committed) {
          if (r.closedSeq !== undefined || !expectedParticipants(st, rid, 'rng').includes(me) || this.inFlight('rngCommit', rid)) continue;
          let nonce = this.nonces.get('rng', rid);
          if (nonce === null) {
            nonce = randomSalt();
            this.nonces.set('rng', rid, nonce);
          }
          this.contribute(`commit:${rid}`, { type: 'rngCommit', rid, purpose: r.purpose, n: r.n, h: nonceHash(nonce) });
          continue;
        }
        if (Object.hasOwn(r.reveals, me) || !rngCommitPhaseComplete(st, rid) || this.inFlight('rngReveal', rid)) continue;
        const nonce = this.nonces.get('rng', rid);
        if (nonce === null || nonceHash(nonce) !== r.commits[me]) continue;
        this.contribute(`reveal:${rid}`, { type: 'rngReveal', rid, nonce });
      }
      this.reRevealOwed(st, me);
      this.turnUpOwed(st, me);
      this.reissueHand();
      this.resumeRecovery();
      this.auditImpl.drive();
    }
    this.settleWaiters();
  }

  /**
   * A recovery whose `recoverCommit` is sequenced but whose shuffle or draws this page never finished (it reloaded in
   * between, or a step failed): finished once per page on a replica in step with the table; the recovery panel
   * offers it again (`finishRecovery`).
   */
  private resumeRecovery(): void {
    // A record whose recovery is done (or replaced, or never sequenced) is dropped once the replica is in step.
    if (this.recoveryRuns === 0 && this.engine.status() === 'connected' && this.storedOwed() !== null && this.recoveryOwed() === null && this.engine.pending().length === 0) {
      const owed = this.storedOwed()!;
      const st = this.engine.confirmedState();
      if ((st.commitments[this.seat]?.instanceIds ?? []).includes(owed.id)) this.storeOwed(null);
    }
    if (this.recoveryResumed || this.recoveryRuns > 0 || this.engine.status() !== 'connected' || this.recoveryOwed() === null) return;
    this.recoveryResumed = true;
    this.finishRecovery().catch((e: unknown) => this.warn(`The recovery could not be finished: ${errorText(e)}`));
  }

  /** Whether own card `id` is public without an identity in the confirmed state and in the view, and this browser holds it. */
  private publicWithoutIdentity(st: TableState, view: TableState, me: SeatId, id: InstanceId): boolean {
    const c = Object.hasOwn(st.cards, id) ? st.cards[id]! : undefined;
    const v = Object.hasOwn(view.cards, id) ? view.cards[id]! : undefined;
    if (!c || !v || c.owner !== me || c.identity !== undefined || v.identity !== undefined) return false;
    return st.zones[c.zone]?.visibility === 'public' && view.zones[v.zone]?.visibility === 'public' && Object.hasOwn(this.sec.identities, id);
  }

  /** The re-reveals of the own cards a sequenced undo brought back without identity, while they are still public. */
  private reRevealOwed(st: TableState, me: SeatId): void {
    const view = this.engine.state();
    for (const { reveal, group } of this.reRevealDue.splice(0)) {
      if (!this.publicWithoutIdentity(st, view, me, reveal.card)) continue;
      const draft = reRevealDraft(view, this.sec, me, reveal, group);
      if (draft) this.propose(this.stamp(draft), false);
    }
  }

  /**
   * Turn up, verified (`flip {face: 'up', ref, salt}`), every own card that is owed its identity (DESIGN "Multiplayer
   * architecture", Hidden information 2; "Table model": only a battlefield and exile hold face-down cards): one an own
   * action made public, once that action is sequenced, and one that lies face down in a public zone that shows faces
   * (graveyard, stack, command), also when another seat moved it there. The flip needs a public card, so it fails
   * closed when the card went back into a hidden zone meanwhile.
   */
  private turnUpOwed(st: TableState, me: SeatId): void {
    const ids = new Set(this.turnUpDue.keys());
    // Cards another seat moved are judged on a replica in step with the table: right after a resume ('alone',
    // 'syncing') the confirmed state may be stale, and a card it shows face down in a graveyard may lie in a library.
    const inStep = this.engine.status() === 'connected';
    for (const [id, c] of Object.entries(st.cards)) {
      if (!inStep) break;
      const z = st.zones[c.zone];
      if (c.owner === me && c.face === 'down' && c.identity === undefined && z?.visibility === 'public' && !FACE_DOWN_KINDS.has(z.kind)) ids.add(id);
    }
    // Turn-ups kept in local storage (from before a reload), decided against the sequenced log (`keptTurnUp`).
    const waiting = new Set<InstanceId>();
    for (const id of this.nonces.ids('turnUp')) {
      const cid = this.nonces.get('turnUp', id);
      const verdict = cid === null ? 'stale' : this.keptTurnUp(id, cid);
      if (verdict === 'owed') ids.add(id);
      else if (verdict === 'stale') this.nonces.delete('turnUp', id);
      else waiting.add(id);
    }
    if (!ids.size) return;
    const view = this.engine.state();
    const pending = this.engine.pending();
    for (const id of [...ids].sort()) {
      const group = this.turnUpDue.get(id);
      if (pending.some((a) => (a.type === 'flip' && a.card === id && a.ref !== undefined) || (a.type === 'reveal' && a.instanceId === id))) continue;
      if (!this.publicWithoutIdentity(st, view, me, id) || (this.turnUpRefusals.get(id) ?? 0) >= ROUND_ATTEMPTS) {
        this.turnUpDue.delete(id);
        if (!waiting.has(id)) this.nonces.delete('turnUp', id);
        continue;
      }
      this.turnUpDue.delete(id);
      const secret = this.sec.identities[id]!;
      const flip = this.stamp({ type: 'flip', card: id, face: 'up', ref: secret.card, salt: secret.salt, ...(group !== undefined ? { group } : {}) });
      if (!this.propose(flip, false)) this.turnUpRefusals.set(id, (this.turnUpRefusals.get(id) ?? 0) + 1);
    }
  }

  /**
   * A turn-up kept in local storage for own card `id`, whose public-making action is `cid`, decided against the
   * sequenced log: 'owed' once the replica is in step with the table ('connected') and `cid` is in the log as an
   * action on `id` after which the card neither moved nor turned; 'stale' when `cid` is in the log but the card moved
   * or turned since (or the action was about another card), or when the replica is in step and `cid` is neither in the
   * log nor pending (a play lost in a crash or a reload before it was sequenced); 'wait' otherwise. A kept turn-up is
   * never honoured on a replica that only resumed ('alone', 'syncing'), so a card is never turned up on a stale
   * state, and never without the sequenced action that made it public (DESIGN "Multiplayer architecture", Hidden
   * information 2; "Table model", Face-down on the battlefield).
   */
  private keptTurnUp(id: InstanceId, cid: string): 'owed' | 'stale' | 'wait' {
    if (this.turnUpAfter.has(cid) || this.pendingCid(cid)) return 'wait';
    const at = this.entries.findLastIndex((e) => e.kind === 'action' && e.action.cid === cid);
    const inStep = this.engine.status() === 'connected';
    if (at < 0) return inStep ? 'stale' : 'wait';
    const made = this.entries[at]!;
    if (made.kind !== 'action' || referencedCard(made.action) !== id) return 'stale';
    const to = 'to' in made.action && typeof made.action.to === 'string' ? made.action.to : null;
    for (const e of this.entries.slice(at + 1)) {
      if (e.kind !== 'action' || referencedCard(e.action) !== id || IN_PLACE.has(e.action.type)) continue;
      // Moving it about within the zone it was played into keeps the turn-up owed.
      if (e.action.type === 'move' && to !== null && e.action.to === to) continue;
      return 'stale';
    }
    return inStep ? 'owed' : 'wait';
  }

  /** Drop every turn-up owed or kept for own card `id`: an own action that this browser proposes now decides its face. */
  private forgetTurnUp(id: InstanceId): void {
    this.nonces.delete('turnUp', id);
    this.turnUpDue.delete(id);
    for (const [cid, up] of this.turnUpAfter) if (up.id === id) this.turnUpAfter.delete(cid);
  }

  // --- Waiting ----------------------------------------------------------------------------------------------

  private settleWaiters(): void {
    for (const w of [...this.waiters]) {
      let done: boolean;
      try {
        done = w.check();
      } catch (e) {
        this.dropWaiter(w);
        w.reject(e instanceof Error ? e : new Error(String(e)));
        continue;
      }
      if (done) {
        this.dropWaiter(w);
        w.resolve();
      }
    }
  }

  private dropWaiter(w: Waiter): void {
    if (w.timer) clearTimeout(w.timer);
    this.waiters = this.waiters.filter((x) => x !== w);
  }

  /** Resolve once `done()` holds; reject with the reason `failed()` returns, or after `timeoutMs` (none by default). */
  until(done: () => boolean, failed: () => string | null = () => null, timeoutMs: number | null = null, what = 'the table'): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The session is closed'));
    return new Promise<void>((resolve, reject) => {
      const w: Waiter = {
        check: () => {
          if (done()) return true;
          const why = failed();
          if (why !== null) throw new Error(why);
          return false;
        },
        resolve,
        reject,
        timer: null,
      };
      if (timeoutMs !== null) w.timer = setTimeout(() => {
        this.dropWaiter(w);
        reject(new Error(`Timed out waiting for ${what}`));
      }, timeoutMs);
      this.waiters.push(w);
      this.settleWaiters();
    });
  }

  /** Resolve once own action `cid` is sequenced; reject when it is refused. */
  private sequenced(cid: string): Promise<void> {
    return this.until(
      () => !this.pendingCid(cid) && !this.refused.has(cid),
      () => {
        const why = this.refused.get(cid);
        return why === undefined ? null : `refused: ${why}`;
      },
    );
  }

  // --- Seats -------------------------------------------------------------------------------------------------

  private seatAttempts = 0;
  /** `sitDown` runs: it retries itself after a lost chair. */
  private sitting = false;

  /** Take the lowest free chair when this browser holds none (with the preferred seat colour where free). */
  sitIfUnseated(): Action | null {
    if (this.disposed || this.engine.seat() !== null) return null;
    const st = this.engine.state();
    const free = Object.values(st.seats)
      .sort((a, b) => a.index - b.index)
      .find((s) => s.peer === undefined && s.name.trim() === '');
    if (!free) return null;
    this.seatAttempts++;
    const taken = new Set(Object.values(st.seats).filter((s) => s.id !== free.id && (s.peer !== undefined || s.name.trim() !== '')).map((s) => s.colour));
    const preferred = this.opts.identity.seatColour;
    let colour = (Number.isInteger(preferred) && preferred >= 0 && preferred < SEAT_COLOURS ? preferred : free.colour) as SeatColourIndex;
    if (taken.has(colour)) for (let c = 0; c < SEAT_COLOURS; c++) if (!taken.has(c as SeatColourIndex)) {
      colour = c as SeatColourIndex;
      break;
    }
    return this.takeSeat(free.id, colour);
  }

  /** Join the room and resolve once this browser holds a chair (decision M1-P8: listen first, then sit). */
  async sitDown(settleMs: number, timeoutMs: number): Promise<void> {
    if (this.engine.seat() !== null) return;
    this.sitting = true;
    try {
      await this.sitDownNow(settleMs, timeoutMs);
    } finally {
      this.sitting = false;
    }
  }

  private async sitDownNow(settleMs: number, timeoutMs: number): Promise<void> {
    // A fresh joiner must not act before it synced (decision M1-P1): listen for a table already in the room, and if
    // a peer answered, wait until this replica is in step with it.
    await new Promise((r) => setTimeout(r, settleMs));
    if (this.disposed) throw new Error('The session is closed');
    // A browser that opened a shared link waits longer for a peer: the room's table is most likely elsewhere already,
    // and a chair taken alone would collide with its creator's (decision M1-P8). After a rejoin the room's table is
    // known to exist: wait for it as long as for a chair.
    const lone = this.rejoining ? timeoutMs : Math.max(0, (this.internals.loneWaitMs ?? 0) - settleMs);
    if (!this.createdHere && lone > 0 && !this.peerConnected()) {
      await this.until(() => this.peerConnected(), () => null, lone, 'a peer').catch(() => undefined);
      if (this.disposed) throw new Error('The session is closed');
    }
    await this.until(
      () => {
        const st = this.engine.status();
        return st !== 'syncing' && st !== 'joining' && (st === 'connected' || !this.peerConnected());
      },
      () => null,
      timeoutMs,
      'the table to sync',
    );
    const deadline = this.now() + timeoutMs;
    while (this.engine.seat() === null || seatOfPeer(this.engine.confirmedState(), this.peerId) === null) {
      if (this.disposed) throw new Error('The session is closed');
      if (this.engine.seat() === null) {
        if (this.seatAttempts >= SEAT_ATTEMPTS) throw new Error('Could not take a chair at this table.');
        const take = this.sitIfUnseated();
        if (!take) throw new Error(this.engine.state().stage === 'lobby' ? 'This table is full.' : 'The game at this table has started and every chair is taken.');
      }
      const left = deadline - this.now();
      if (left <= 0) throw new Error('Could not take a chair at this table.');
      await this.until(
        () => seatOfPeer(this.engine.confirmedState(), this.peerId) !== null || this.engine.seat() === null,
        () => null,
        left,
        'a chair',
      ).catch((e: unknown) => {
        throw new Error(`Could not take a chair at this table. (${errorText(e)})`);
      });
    }
  }

  private peerConnected(): boolean {
    return this.engine.peers().some((p) => p.status === 'connected' && p.peerId !== '' && p.peerId !== this.peerId);
  }

  /**
   * Whether this browser sits at a table it started alone and has met the room's own table (decision M1-P8): a
   * connected peer claims this browser's chair, this browser did not create the room, and its table holds nothing but
   * its own lobby actions (no other chair taken, every action its own, still in the lobby). Two such histories of the
   * same length would otherwise both keep sequencing, each with the chair (DESIGN "Multiplayer architecture", Shared
   * state: one sequencer, every browser converges).
   */
  private collision(): boolean {
    if (this.disposed || this.rejoining || this.createdHere || this.rejoins >= MAX_REJOINS) return false;
    const seat = this.engine.seat();
    if (seat === null) return false;
    if (!this.engine.peers().some((p) => p.status === 'connected' && p.peerId !== '' && p.peerId !== this.peerId && p.seat === seat)) return false;
    const st = this.engine.confirmedState();
    if (st.stage !== 'lobby') return false;
    if (Object.values(st.seats).some((s) => s.peer !== undefined && s.peer !== this.peerId)) return false;
    return this.entries.every((e) => e.kind !== 'action' || e.action.by === seat);
  }

  /**
   * Give up the table this browser started alone and join the room's (see `collision`): leave with the old engine,
   * start a new one from the seq-0 table, catch up from the peers and take a free chair. Own chat lines are said
   * again; a deck committed alone has to be readied again.
   */
  private async rejoin(): Promise<void> {
    if (!this.collision()) return;
    this.rejoining = true;
    this.rejoins++;
    const said = this.entries.flatMap((e) => (e.kind === 'action' && e.action.type === 'chat' ? [{ text: e.action.text, channel: e.action.channel }] : []));
    const readied = this.entries.some((e) => e.kind === 'action' && e.action.type === 'ready');
    for (const u of this.unsubs.splice(0)) u();
    this.eng.leave();
    for (const w of this.waiters.splice(0)) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(new Error('This browser joined the table already in the room'));
    }
    const fresh = freshNetTable(this.opts.game, this.opts.format ?? '1v1');
    this.eng = this.makeEngine({ snapshot: { seq: 0, state: fresh }, tail: [] });
    this.fold = this.eng.confirmedState();
    this.sec = emptySecretStore(this.sec.seat);
    this.entries = this.entries.filter((e) => e.kind === 'system');
    this.undoStack = [];
    this.exposed.clear();
    for (const m of [this.sentRandomness, this.privateBefore, this.turnUpAfter, this.turnUpDue, this.turnUpRefusals, this.reRevealAfter, this.revealsDue, this.refused, this.roundRefusals]) m.clear();
    this.reRevealDue = [];
    this.reissueOwed = false;
    this.reissueCid = null;
    this.reissueRefusals = 0;
    this.seatAttempts = 0;
    // The turn-ups kept for the alone table name its cards, which the room's table does not have.
    for (const id of this.nonces.ids('turnUp')) this.nonces.delete('turnUp', id);
    // The new save queue starts after the old one's last write, so a late write of the abandoned table never lands
    // over the new seq-0 record.
    this.saves = this.persistence(fresh, 0, 0, this.saves.whenSaved());
    this.auditImpl.rebuild(fresh, [], this.eng.confirmedState());
    this.attach(this.eng);
    this.system('info', `Another browser was already at this table: this browser left the table it had started alone and joins that one${readied ? ' (press Ready again)' : ''}.`);
    this.notify();
    this.netChanged();
    try {
      await this.eng.join();
      if (this.disposed) return;
      this.saveBase();
      await this.sitDown(this.internals.settleMs ?? SETTLE_MS, this.internals.seatTimeoutMs ?? SEAT_TIMEOUT_MS);
      for (const line of said) this.chat(line.text, line.channel);
    } catch (e) {
      if (!this.disposed) this.warn(`Could not join the table already in the room: ${errorText(e)}`);
    } finally {
      this.rejoining = false;
      this.notify();
      this.netChanged();
    }
  }

  // --- Log, notifications ------------------------------------------------------------------------------------

  private warn(text: string): void {
    this.system('warn', text);
  }

  private system(level: 'info' | 'warn', text: string): void {
    this.entries.push({ kind: 'system', seq: this.engine.seq(), at: this.now(), level, text });
  }

  /** A system line placed after the entry of action `afterSeq` (and the system lines already after it), else at the end (M5-P2 audit verdicts). */
  private insertSystem(level: 'info' | 'warn', text: string, afterSeq?: number): void {
    const at = afterSeq === undefined ? -1 : this.entries.findLastIndex((e) => e.kind === 'action' && e.seq === afterSeq);
    if (at < 0) return this.system(level, text);
    let i = at + 1;
    while (i < this.entries.length && this.entries[i]!.kind === 'system') i++;
    this.entries.splice(i, 0, { kind: 'system', seq: afterSeq!, at: this.now(), level, text });
  }

  private lastWarning(): string {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.kind === 'system') return e.text;
    }
    return 'refused';
  }

  private notify(): void {
    if (this.disposed) return;
    this.settleWaiters();
    this.teamView.sync();
    for (const l of [...this.changeListeners]) {
      try {
        l();
      } catch (e) {
        console.error('session listener failed', e);
      }
    }
    const state = this.engine.state();
    for (const l of [...this.listeners]) {
      try {
        l(state);
      } catch (e) {
        console.error('session listener failed', e);
      }
    }
  }

  private netChanged(): void {
    if (this.netQueued || this.disposed) return;
    this.netQueued = true;
    queueMicrotask(() => {
      this.netQueued = false;
      this.notifyNet();
    });
  }

  private notifyNet(): void {
    const s = this.netStatus();
    for (const l of [...this.netListeners]) {
      try {
        l(s);
      } catch (e) {
        console.error('net status listener failed', e);
      }
    }
    this.settleWaiters();
  }

  // --- The evening (M2-P7, session/draft.ts) ----------------------------------------------------------------

  /** What the evening and its draft driver use of this session. */
  private draftPort(): DraftPort {
    const add = <T>(set: Set<T>, l: T): (() => void) => {
      set.add(l);
      return () => {
        set.delete(l);
      };
    };
    return {
      seat: () => this.seat,
      state: () => this.engine.state(),
      confirmedState: () => this.engine.confirmedState(),
      secrets: () => this.sec,
      setSecrets: (next) => {
        if (this.disposed) return;
        this.setSecrets(next);
        this.saves.saveSecrets(this.sec);
        this.notify();
      },
      propose: (draft) => {
        const a = this.stamp(draft);
        if (this.disposed) return a;
        this.propose(a, false);
        this.notify();
        return a;
      },
      pending: () => this.engine.pending(),
      packSeed: () => this.packSeed(),
      sendPack: (to, packId, cards) => this.channel.sendPack(to, packId, cards),
      onPack: (l) => add(this.packListeners, l),
      sendCards: (to, about, cards) => draftCardsOver(this.engine).send(to, about, cards),
      onCards: (l) => add(this.cardsListeners, l),
      onSequenced: (l) => add(this.sequencedListeners, l),
      onChange: (l) => add(this.changeListeners, l),
      onPeers: (l) => add(this.peerListeners, l),
      importDeck: (deck) => this.importDeck(deck),
      warn: (text) => {
        this.warn(text);
        this.notify();
      },
      newId: (prefix) => randomId(prefix),
      sets: this.opts.sets ?? null,
      generatePack: this.opts.generatePack ?? null,
      entropy: this.entropy,
    };
  }

  /**
   * A pack seed (DESIGN "Specification: network protocol and secrecy", Draft packs: the secret-shuffle seed protocol
   * with purpose 'pack' on the own pack zone): commit to a fresh nonce (kept in local storage until the round is
   * done, so a reload finishes the same round), let the other seats add theirs, finish the round (`drive`), and resolve
   * with the seed. An own round left open by a reload is finished rather than replaced (its zone is frozen until then).
   */
  packSeed(): Promise<PackSeed> {
    const next = this.packChain.then(
      () => this.packSeedNow(),
      () => this.packSeedNow(),
    );
    this.packChain = next.catch(() => undefined);
    return next;
  }

  private async packSeedNow(): Promise<PackSeed> {
    if (this.disposed) throw new Error('The session is closed');
    const me = this.seat;
    const zone = zoneId('pack', me);
    let open = Object.values(this.engine.confirmedState().shuffles).find((r) => r.owner === me && r.zone === zone && r.orderHash === null);
    if (open !== undefined && this.nonces.get('shuffle', open.id) === null) {
      // Its nonce is lost (cleared storage): `drive` closes it unused, then a fresh round starts.
      const lost = open.id;
      this.queueDrive();
      await this.until(() => this.engine.confirmedState().shuffles[lost]?.orderHash != null, () => (this.gaveUp(`done:${lost}`) ? 'an old pack seed could not be closed' : null));
      open = undefined;
    }
    let sid: ShuffleId;
    let nonce: string;
    let cid: string | null = null;
    if (open !== undefined) {
      sid = open.id;
      nonce = this.nonces.get('shuffle', open.id)!;
    } else {
      sid = randomId('pk');
      nonce = randomSalt();
      this.nonces.set('shuffle', sid, nonce);
      const a = this.stamp({ type: 'shuffleCommit', sid, zone, h: nonceHash(nonce), purpose: 'pack' });
      if (!this.propose(a, false)) {
        this.nonces.delete('shuffle', sid);
        throw new Error(`The pack seed was refused: ${this.lastWarning()}`);
      }
      cid = a.cid;
      this.notify();
    }
    this.queueDrive();
    await this.until(
      () => this.engine.confirmedState().shuffles[sid]?.orderHash != null,
      () => {
        if (cid !== null && this.refused.has(cid)) return `the pack seed was refused: ${this.refused.get(cid)!}`;
        if (cid === null || !this.pendingCid(cid)) {
          if (!Object.hasOwn(this.engine.confirmedState().shuffles, sid)) return 'the pack seed round is gone';
        }
        return this.gaveUp(`done:${sid}`) ? 'the pack seed could not be finished' : null;
      },
    );
    const peerNonces = shufflePeerNonces(this.engine.confirmedState(), sid);
    return { sid, seed: shuffleSeed(nonce, peerNonces), ownerNonce: nonce, peerNonces };
  }

  /** Store the current confirmed state as the table record's base (a room this browser has no save of yet). */
  saveBase(): void {
    this.saves.saveBase(this.engine.confirmedState(), this.sec);
  }

  prefetch(sids: string[]): void {
    const unique = [...new Set(sids)];
    if (!unique.length) return;
    this.opts.cardData.getMany(unique).then(
      () => this.notify(),
      (e: unknown) => {
        this.warn(`Card data is unavailable: ${errorText(e)}`);
        this.notify();
      },
    );
  }

  knownSids(): string[] {
    const sids = Object.values(this.sec.identities).map((i) => i.card.sid);
    for (const c of Object.values(this.engine.state().cards)) if (c.identity) sids.push(c.identity.sid);
    for (const r of Object.values(this.sec.received)) sids.push(r.card.sid);
    return sids;
  }
}

/** The stored copy of the room, if any (DESIGN "Multiplayer architecture", Resume: the own save is the starting point). */
async function loadSaved(store: TableStore | undefined, roomId: string): Promise<{ start: ResumePoint; secrets: SecretStore | null; entries: LogEntry[]; snapshotSeq: number } | null> {
  if (!store) return null;
  const loaded = await store.loadTable(roomId);
  if (!loaded || !loaded.table.snapshot || loaded.table.roomKey === '') return null;
  const { table } = loaded;
  const snapshot = table.snapshot!;
  // The stored log after the snapshot, up to the record's lastSeq and without a gap (beyond is an abandoned timeline).
  const tail: SequencedAction[] = [];
  let seq = table.snapshotSeq;
  for (const rec of [...loaded.log].sort((a, b) => a.seq - b.seq)) {
    if (rec.seq <= seq) continue;
    if (rec.seq > table.lastSeq || rec.seq !== seq + 1) break;
    tail.push({ ...rec.action, seq: rec.seq } as SequencedAction);
    seq = rec.seq;
  }
  let log: LogRecord[];
  try {
    log = await store.loadLog(roomId);
  } catch {
    log = loaded.log;
  }
  const entries: LogEntry[] = log.filter((r) => r.seq <= seq).map((r) => ({ kind: 'action', seq: r.seq, at: r.at, action: r.action }));
  return { start: { snapshot: { seq: table.snapshotSeq, state: snapshot }, tail }, secrets: loaded.secrets, entries, snapshotSeq: table.snapshotSeq };
}

/**
 * Join (or start) the table of `opts.roomId` and resolve once this browser holds a chair (PLAN M1-P8). The starting
 * point is the own save of the room, or the deterministic seq-0 table; the engine then reconciles with the room.
 * Aborting `signal` before that leaves the room (engine and transport) and rejects.
 */
export async function openNetSession(opts: NetSessionOptions, internals: NetSessionInternals = {}, signal?: AbortSignal): Promise<NetTable> {
  // A spectator takes no chair: session/spectator.ts openSpectatorSession (M3-P5).
  if (opts.role === 'spectator') throw new Error('a spectator joins with openSpectatorSession (session/spectator.ts)');
  const saved = await loadSaved(opts.store, opts.roomId).catch(() => null);
  if (signal?.aborted) throw cancelled();
  const fresh = freshNetTable(opts.game, opts.format ?? '1v1');
  const start: ResumePoint = saved?.start ?? { snapshot: { seq: 0, state: fresh }, tail: [] };
  const identity = await createNetIdentity(opts.identity.keyPair, opts.identity.peerId, opts.identity.nickname);
  if (signal?.aborted) throw cancelled();
  const transports = latestTransport(opts.transport);
  const makeEngine = (from: ResumePoint): NetEngine =>
    createNetEngine({
      transport: transports.make(),
      roomId: opts.roomId,
      roomKey: opts.roomKey,
      identity,
      game: opts.game,
      start: from,
      deadlines,
      ...(opts.now ? { now: opts.now } : {}),
    });
  const engine = makeEngine(start);
  const seat0 = seatOfPeer(engine.confirmedState(), opts.identity.peerId) ?? 's0';
  const session = new NetTable(engine, makeEngine, opts, internals, {
    secrets: saved?.secrets ?? emptySecretStore(seat0),
    entries: saved?.entries ?? [],
    snapshot: start.snapshot.state,
    snapshotSeq: start.snapshot.seq,
    lastSeq: engine.confirmedState().seq,
  });
  if (opts.voice) {
    const port = { engine: () => session.engine, transport: transports.current, state: () => session.getState(), subscribe: session.subscribe.bind(session) };
    session.voiceImpl = createSessionVoice({ ...port, subscribeNet: (l) => session.subscribeNet(() => l()) }, opts.voice);
  }
  try {
    await abortable(engine.join(), signal);
    if (!saved) session.saveBase();
    session.prefetch(session.knownSids());
    await abortable(session.sitDown(internals.settleMs ?? SETTLE_MS, internals.seatTimeoutMs ?? SEAT_TIMEOUT_MS), signal);
    if (opts.voice) session.captions = mountCaptions(session, opts.voice, opts.now);
  } catch (e) {
    session.leave();
    throw e;
  }
  return session;
}

function cancelled(): Error {
  return new Error('Joining the table was cancelled');
}

/** `p`, or a rejection as soon as `signal` aborts (a join through relays that never answer would otherwise never end). */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Join or start the table of `opts.roomId` (PLAN M1-P8; session/types.ts CreateNetSession). */
export const createNetSession: CreateNetSession = (opts) => openNetSession(opts, { loneWaitMs: LONE_WAIT_MS });

export type { NetTable };
