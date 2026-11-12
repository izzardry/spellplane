/**
 * The networked session (PLAN M1-P8): TableSession over a NetEngine (transport, sequencer, sync), the pair channel
 * for hidden information and the sequencer's timers, with the owner's secret store and local persistence as in the
 * solo session. Contracts: M1-C (session/types.ts NetSession). Implementer: M1-P8.
 *
 * - Public actions are stamped here (`by` = own seat, client-unique `cid`) and handed to the engine, which applies
 *   them optimistically and proposes them to the sequencer (DESIGN "Specification: network protocol and secrecy",
 *   Sequencing 2-4). A refused proposal is rolled back by the engine and logged here with its reason.
 * - Hidden information never leaves this browser except through the design's reveal paths (DESIGN "Multiplayer
 *   architecture", Hidden information): a `reveal {instanceId, ref, salt}` goes first when an own card becomes public;
 *   a targeted reveal is the public `revealTo` plus the identity on the pair channel to the named seats only, sent
 *   once the `revealTo` is sequenced; another seat's look is answered from the confirmed state and refused for whole
 *   zones (no consent prompt exists yet, decision M1-P8).
 * - The private effects use core/secrets.ts (decision M1-P2): Ready commits the deck, the secret shuffle runs the
 *   commit/nonce/done protocol with the other seats' nonces, a public card returned to the hand re-issues the hand's
 *   opaque ids, a shuffle re-issues the zone's ids when a card in it was seen since it was issued (the `exposed` set,
 *   rebuilt from the stored log after a reload), and an undo re-reveals own cards it brought back face down.
 * - Joint randomness (DESIGN "Public randomness", "Secret shuffle" 2): this browser contributes its nonce to every
 *   round still waiting for it (also after a reload or reconnect), keeps the nonce of an open round in local storage
 *   (session/nonces.ts) and reuses it whenever it proposes again, and reveals its rng nonce once all commits are in.
 *   An own randomness action that comes back sequenced with another payload is logged as an integrity warning.
 * - Persistence is solo.ts's path (session/persist.ts): every sequenced action with the table record and the secret
 *   store in one transaction, the secret store alone when it changes without one.
 * - Timers: the engine arms core/deadlines.ts (confirmation rounds, commit windows) on the sequencer's clock.
 */
import type { Action, ActionDraft } from '../core/actions';
import { nonceHash } from '../core/commit';
import { deadlines } from '../core/deadlines';
import { canonicalJson } from '../core/hash';
import { zoneId } from '../core/ids';
import { createTable, explain, reduce } from '../core/reducer/index';
import { expectedParticipants, rngCommitPhaseComplete, shuffleReady } from '../core/rng';
import {
  beginShuffle,
  commitDeck,
  disclosedBy,
  emptySecretStore,
  finishShuffle,
  lookAnswer,
  privateReorder,
  pruneReceived,
  receiveIdentity,
  reissueZone,
  revealedCard,
  shuffleRecord,
  type Entropy,
} from '../core/secrets';
import type { CardRef, Format, InstanceId, LogEntry, Pose, RngPurpose, SeatColourIndex, SecretStore, SeatId, TableState, ZoneId } from '../core/types';
import { isUndoable, type UndoableAction } from '../core/actions';
import { undoPlan, type UndoReveal } from '../core/undo';
import type { CardData } from '../data/types';
import { createNetEngine, NACK_DUPLICATE } from '../net/engine';
import { createNetIdentity } from '../net/identity';
import type { ChatChannel, SequencedAction } from '../net/messages';
import { createPrivateChannel } from '../net/private';
import { applySequenced, seatOfPeer } from '../net/sequencer';
import type { NetEngine, PrivateChannel, ResumePoint, Unsubscribe } from '../net/types';
import type { LogRecord, TableStore } from '../store/types';
import { DRY_CID, faceDownAllowed, placementOf, putBack, reRevealDraft, referencedCard, revealFor, sameOrder, SESSION_ONLY, turnsUpOnMove } from './effects';
import { localNonces, type NonceStore } from './nonces';
import { TablePersistence } from './persist';
import { randomId, randomSalt } from './secrecy';
import { reconcileSecrets, type LibraryPlacement } from './secrets';
import type { CreateNetSession, DeckImport, LookedCard, NetSession, NetSessionOptions, NetStatusListener, SessionListener, SessionNetStatus } from './types';

/** How long a browser without a seat listens for a table already in the room before it takes a chair (decision M1-P8). */
export const SETTLE_MS = 1500;
/** Taking a chair gives up after this long. */
export const SEAT_TIMEOUT_MS = 20_000;
/** The seat name when the identity has no nickname yet: the reducer refuses an empty one (decision M1-P5). */
export const DEFAULT_NICKNAME = 'Player';
/** Cards drawn by a London mulligan (DESIGN "Card manipulation", Library actions). */
export const NET_MULLIGAN_HAND = 7;
/** Attempts to take a free chair when another browser took the same one first. */
const SEAT_ATTEMPTS = 4;
/** A contribution to a randomness round that keeps being refused is given up after this many refusals. */
const ROUND_ATTEMPTS = 3;
/** Seat colours a theme provides (DESIGN "Themes and rendering": eight seat colours). */
const SEAT_COLOURS = 8;

const SEATS_OF: Record<Format, number> = { '1v1': 2, ffa3: 3, ffa4: 4, '2hg': 4 };

/** What tests (and only tests) may change beyond NetSessionOptions. */
export interface NetSessionInternals {
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
  return createTable({ game, format, seats: Array.from({ length: SEATS_OF[format] }, (_, i) => ({ name: '', colour: i as SeatColourIndex })) });
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

class NetTable implements NetSession {
  readonly roomId: string;
  readonly presence: NetEngine['presence'];
  private readonly channel: PrivateChannel;
  private readonly nonces: NonceStore;
  private readonly entropy: Entropy;
  private readonly peerId: string;
  private sec: SecretStore;
  private entries: LogEntry[];
  private readonly saves: TablePersistence;
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
  /** Targeted reveals to send on the pair channel once their public `revealTo` is sequenced. */
  private readonly revealsDue = new Map<string, { id: InstanceId; seats: SeatId[] }>();
  /** Refused own proposals by cid, with the reason (for the session's own waits). */
  private readonly refused = new Map<string, string>();
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
  private readonly unsubs: Unsubscribe[] = [];

  constructor(
    readonly engine: NetEngine,
    private readonly opts: NetSessionOptions,
    private readonly internals: NetSessionInternals,
    init: { secrets: SecretStore; entries: LogEntry[]; snapshot: TableState; snapshotSeq: number; lastSeq: number },
  ) {
    this.roomId = opts.roomId;
    this.peerId = opts.identity.peerId;
    this.presence = engine.presence;
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
    this.saves = new TablePersistence({
      store: opts.store,
      roomId: opts.roomId,
      roomKey: opts.roomKey,
      seat: () => this.engine.seat() ?? this.lastSeat,
      onError: (text) => this.system('warn', text),
      now: () => this.now(),
      snapshot: init.snapshot,
      snapshotSeq: init.snapshotSeq,
      lastSeq: init.lastSeq,
    });
    this.channel = createPrivateChannel(engine);
    this.unsubs.push(
      engine.onState((view) => this.onView(view)),
      engine.onSequenced((a, own) => this.onSequenced(a, own)),
      engine.onRollback((a, reason) => this.onRollback(a, reason)),
      engine.onSystem((level, text) => this.system(level, text)),
      engine.onStatus(() => this.netChanged()),
      engine.onPeers(() => {
        this.netChanged();
        // A peer that (re)connected may be the one a randomness round waits for, or this browser may owe it a nonce.
        this.queueDrive();
      }),
      engine.onSequencerChange(() => this.netChanged()),
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
      // Another seat's look: answered from the confirmed state (the pair channel itself refuses while own pending actions
      // may change that zone). Peeks at an own face-down card are answered; looks at a whole hidden zone are refused,
      // since the owner has no way yet to agree to them (core/secrets.ts lookAnswer; decision M1-P2, M1-P8).
      this.channel.answerLooks((req) => lookAnswer(this.sec, this.engine.confirmedState(), req, { allowZoneLook: false })),
    );
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
    // A face-down card moved into a public zone that shows faces is turned up there, in one undo group with the move.
    const seat = this.seat;
    const turnUp = turnsUpOnMove(view, this.sec, seat, action);
    const act = turnUp && action.group === undefined ? ({ ...action, group: randomId('g') } as Action) : action;
    const reveal = revealFor(view, this.sec, seat, act, turnUp);
    if (reveal && !this.propose(this.stamp(reveal))) return this.stamp(act);
    const stamped = this.stamp(act);
    // Registered before proposing: the sequencer's own proposals come back sequenced inside `propose`.
    if (stamped.type === 'revealTo' && this.ownHidden(stamped.instanceId)) this.revealsDue.set(stamped.cid, { id: stamped.instanceId, seats: [...stamped.seats] });
    if (stamped.type === 'rngCommit') this.sentRandomness.set(stamped.cid, stamped);
    const done = this.propose(stamped);
    if (!done) {
      this.revealsDue.delete(stamped.cid);
      this.sentRandomness.delete(stamped.cid);
    }
    if (done && turnUp) this.propose(this.stamp({ type: 'flip', card: referencedCard(act)!, face: 'up', ...(act.group !== undefined ? { group: act.group } : {}) }));
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
    // No reveal: the reducer turns a card that leaves a hidden zone without a public identity face down.
    this.propose(action);
    this.notify();
    return action;
  }

  chat(text: string, channel: ChatChannel = 'table'): Action {
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
      this.setSecrets({ ...r.secrets, pool });
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
      if (!this.propose(this.stamp(u), false)) return;
      // Only the cards this step returns go back to their old places; the rest keep the current private order, so a
      // later scry or other private reorder is not undone with it (DESIGN "Turn flow and confirmation", Undo).
      this.setSecrets({ ...this.sec, hand: putBack(this.sec.hand, handPrior, hand) });
      const now = this.sec.libraryOrder;
      const target = putBack(now, libraryPrior, library);
      if (!sameOrder(now, target)) this.commitReorder(target, 1, group);
      // A restore patch never puts a committed identity back: the owner re-reveals, verified against the commitment.
      for (const r of reveals) {
        const draft = reRevealDraft(this.engine.state(), this.sec, this.seat, r, group);
        if (draft) this.propose(this.stamp(draft), false);
      }
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
  private async shuffleNow(zone: ZoneId): Promise<void> {
    this.privateList(zone);
    if (!this.engine.state().zones[zone]) throw new Error(`Unknown zone ${zone}`);
    const sid = randomId('sh');
    const b = beginShuffle(this.sec, zone, sid, randomSalt());
    const a = this.stamp(b.action);
    if (!this.proposePrivate(a, b.secrets)) throw new Error(`The shuffle was refused: ${this.lastWarning()}`);
    // Shuffles cannot be undone, and nothing before a shuffle can be undone across it.
    this.undoStack = [];
    this.notify();
    await this.until(
      () => this.engine.confirmedState().shuffles[sid]?.orderHash != null,
      // Only a refusal ends the wait: an own action of a history the engine abandons is proposed again (M1-P1).
      () => this.refused.get(a.cid) ?? (this.gaveUp(`done:${sid}`) ? 'the shuffle could not be finished' : null),
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
    // The log: a rewound history replaces the entries from its first replaced seq on.
    const last = this.entries.findLastIndex((e) => e.kind === 'action');
    if (last >= 0 && this.entries[last]!.seq >= action.seq) this.entries = this.entries.filter((e) => e.kind !== 'action' || e.seq < action.seq);
    this.entries.push({ kind: 'action', seq: action.seq, at: this.now(), action });
    this.saves.saveAction(action, next, this.sec);
    if (own) this.ownSequenced(action);
    // A public card of this seat back in its hand: the hand gets fresh opaque ids, so peers cannot link the card's
    // later reveal to this one (DESIGN "Table model", Hidden cards; decision M1-P2).
    const hand = zoneId('hand', this.sec.seat);
    const back = Object.entries(next.cards).some(([id, c]) => c.zone === hand && c.owner === this.sec.seat && prior.cards[id] !== undefined && prior.zones[prior.cards[id]!.zone]?.visibility === 'public');
    if (back) queueMicrotask(() => this.reissueHand());
    this.queueDrive();
    this.netChanged();
  }

  private ownSequenced(action: SequencedAction): void {
    this.refused.delete(action.cid);
    this.privateBefore.delete(action.cid);
    const sent = this.sentRandomness.get(action.cid);
    if (sent) {
      this.sentRandomness.delete(action.cid);
      if (canonicalJson(withoutSeq(sent)) !== canonicalJson(withoutSeq(action))) {
        this.system('warn', `Integrity warning: your ${action.type} came back from the sequencer changed (seq ${action.seq})`);
      }
    }
    const due = this.revealsDue.get(action.cid);
    if (due) {
      this.revealsDue.delete(action.cid);
      const card = revealedCard(this.sec, due.id);
      if (card) this.channel.reveal(due.seats, [card], 'revealTo', action.cid);
    }
  }

  private reissueHand(): void {
    if (this.disposed) return;
    const view = this.engine.state();
    const r = reissueZone(this.sec, view, zoneId('hand', this.seat), this.entropy);
    if (!r) return;
    this.proposePrivate(this.stamp(r.action), r.secrets);
    this.notify();
  }

  private onRollback(action: Action, reason: string): void {
    if (this.disposed || reason === NACK_DUPLICATE) return;
    this.refused.set(action.cid, reason);
    this.undoStack = this.undoStack.filter((e) => e.cid !== action.cid);
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
    }
    this.settleWaiters();
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
    await this.until(() => this.engine.status() !== 'syncing' && this.engine.status() !== 'joining', () => null, timeoutMs, 'the table to sync');
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

  // --- Log, notifications ------------------------------------------------------------------------------------

  private warn(text: string): void {
    this.system('warn', text);
  }

  private system(level: 'info' | 'warn', text: string): void {
    this.entries.push({ kind: 'system', seq: this.engine.seq(), at: this.now(), level, text });
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
 */
export async function openNetSession(opts: NetSessionOptions, internals: NetSessionInternals = {}): Promise<NetTable> {
  const saved = await loadSaved(opts.store, opts.roomId).catch(() => null);
  const fresh = freshNetTable(opts.game, opts.format ?? '1v1');
  const start: ResumePoint = saved?.start ?? { snapshot: { seq: 0, state: fresh }, tail: [] };
  const identity = await createNetIdentity(opts.identity.keyPair, opts.identity.peerId, opts.identity.nickname);
  const engine = createNetEngine({
    transport: opts.transport(),
    roomId: opts.roomId,
    roomKey: opts.roomKey,
    identity,
    game: opts.game,
    start,
    deadlines,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const seat0 = seatOfPeer(engine.confirmedState(), opts.identity.peerId) ?? 's0';
  const session = new NetTable(engine, opts, internals, {
    secrets: saved?.secrets ?? emptySecretStore(seat0),
    entries: saved?.entries ?? [],
    snapshot: start.snapshot.state,
    snapshotSeq: start.snapshot.seq,
    lastSeq: engine.confirmedState().seq,
  });
  try {
    await engine.join();
    if (!saved) session.saveBase();
    session.prefetch(session.knownSids());
    await session.sitDown(internals.settleMs ?? SETTLE_MS, internals.seatTimeoutMs ?? SEAT_TIMEOUT_MS);
  } catch (e) {
    session.leave();
    throw e;
  }
  return session;
}

/** Join or start the table of `opts.roomId` (PLAN M1-P8; session/types.ts CreateNetSession). */
export const createNetSession: CreateNetSession = (opts) => openNetSession(opts);

export type { NetTable };
