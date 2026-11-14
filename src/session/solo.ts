/**
 * The solo session (PLAN M0-P7): the local game client for one player at the 1v1 table, seat 0, with seat 1 empty.
 * It holds the TableState and applies every action through core's `reduce`; it owns the local SecretStore and runs
 * the private effects around the reducer (DESIGN "Specification: code interfaces", Reducer contract): deck import with
 * commitments, the secret shuffle, draws, mulligans, private looks and reorders; it keeps the personal undo stack
 * (DESIGN "Turn flow and confirmation", Undo) and persists every applied action together with the table record and the
 * secret store in one transaction (DESIGN "Specification: network protocol and secrecy", Local persistence).
 *
 * Hidden information: a library or hand card exists in shared state as an opaque id only. Its identity enters shared
 * state solely through a `reveal {instanceId, ref, salt}` that the session emits when the card becomes public (moved
 * to a public zone, cast, or turned face up), and only after a dry run showed that the action will apply.
 *
 * Milestone 1 plugs the sequencer and sync in behind the same TableSession API.
 */
import {
  createTable,
  explain,
  isUndoable,
  reduce,
  seatIdOf,
  zoneId,
  type Action,
  type ActionDraft,
  type CardRef,
  type InstanceId,
  type LogEntry,
  type Pose,
  type RngPurpose,
  type SeatColourIndex,
  type SecretIdentity,
  type SecretStore,
  type SeatId,
  type TableState,
  type UndoableAction,
  type UndoReveal,
  type ZoneId,
  undoPlan,
  undoStackFromLog,
} from '../core/index';
import type { CardData } from '../data/types';
import { SOLO_ROOM_ID } from '../store/tables';
import type { LogRecord } from '../store/types';
import { DRY_CID, faceDownAllowed, placementOf, putBack, reRevealDraft, referencedCard, revealFor, sameOrder, SESSION_ONLY, turnsUpOnMove } from './effects';
import { SNAPSHOT_EVERY, TablePersistence } from './persist';
import { commitFor, orderHash, randomId, randomSalt, shuffledOrder, shuffleSeed } from './secrecy';
import { emptySecrets, reconcileSecrets, type LibraryPlacement } from './secrets';
import type { ChatChannel } from '../net/messages';
import type { Presence } from '../net/types';
import { NULL_PRESENCE } from './presence';
import type { DeckImport, LookedCard, NetStatusListener, SessionListener, SessionNetStatus, SoloSessionOptions, TableSession } from './types';

/** Room id of the solo table: the store's own constant, re-exported so the two cannot drift apart. */
export const SOLO_ROOM = SOLO_ROOM_ID;

export { SNAPSHOT_EVERY };

/** Cards drawn by a London mulligan (DESIGN "Card manipulation", Library actions). */
export const MULLIGAN_HAND = 7;

/** The solo session: TableSession plus what tests and the debug hook need. */
export interface SoloSession extends TableSession {
  readonly roomId: string;
  /** Resolves once every action applied so far has been written to IndexedDB (immediately without a store). */
  whenSaved(): Promise<void>;
  /**
   * Put an own hand or library card onto a battlefield or into exile face down, keeping its identity in this browser
   * (DESIGN "Table model": face-down on the battlefield, face-down exile; other public zones show faces). No `reveal`
   * is emitted; turning it face up, or moving it into a zone that shows faces, reveals it.
   * On TableSession since M1-C.
   */
  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action;
}

interface UndoEntry {
  cid: string;
  group?: string;
  inverse: UndoableAction;
  /** Cards the undo brings back face down without their identity; own ones are re-revealed with the salt (M1-P2). */
  reveals: UndoReveal[];
  /** The private hand order before the action: a card the undo returns to the hand goes back to its old place in it. */
  hand: InstanceId[];
  /**
   * The private library order before the action: a card the undo returns to the library goes back to its old place
   * in it (with a private-reorder trace). Every other card keeps its current place, so later reorders survive.
   */
  library: InstanceId[];
}

interface CommitOptions {
  /** Private changes that go with the action (applied before the lists are reconciled with the new zones). */
  secrets?: (s: SecretStore) => SecretStore;
  /** Private changes applied after reconciling. */
  then?: (s: SecretStore) => SecretStore;
}

interface Init {
  state: TableState;
  secrets: SecretStore;
  entries: LogEntry[];
  snapshot: TableState;
  snapshotSeq: number;
  /** The stored record's protocol version (session/persist.ts keeps a higher one). */
  protocol?: number | undefined;
}

export { putBack };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Solo implements SoloSession {
  readonly seat: SeatId = seatIdOf(0);
  private state: TableState;
  private sec: SecretStore;
  private entries: LogEntry[];
  /** The local save (DESIGN "Local persistence"): one ordered write queue, shared with the networked session. */
  private readonly saves: TablePersistence;
  private undoStack: UndoEntry[] = [];
  private readonly listeners = new Set<SessionListener>();
  private readonly cidPrefix = randomId('');
  private cidCount = 0;
  private disposed = false;

  constructor(
    private readonly opts: SoloSessionOptions,
    readonly roomId: string,
    init: Init,
  ) {
    this.state = init.state;
    this.sec = init.secrets;
    this.entries = init.entries;
    this.saves = new TablePersistence({
      store: opts.store,
      roomId,
      roomKey: '',
      seat: () => this.seat,
      onError: (text) => this.warn(text),
      now: () => Date.now(),
      snapshot: init.snapshot,
      snapshotSeq: init.snapshotSeq,
      lastSeq: init.state.seq,
      protocol: init.protocol,
    });
    // After a reload Ctrl+Z goes on taking back the own most recent actions, from the stored snapshot on (M5-P6,
    // core/undo.ts undoStackFromLog). A draw goes back on top of the library; another card returns to the hand's end.
    const log = this.entries.flatMap((e) => (e.kind === 'action' && e.seq > init.snapshotSeq ? [{ ...e.action, seq: e.seq } as Action] : []));
    if (log.length > 0) {
      const base = init.snapshot.seq === init.snapshotSeq ? init.snapshot : { ...init.snapshot, seq: init.snapshotSeq };
      this.undoStack = undoStackFromLog(base, log, this.seat, { soloShuffles: true }).stack.map((e) => ({
        cid: e.cid,
        ...(e.group !== undefined ? { group: e.group } : {}),
        inverse: e.inverse,
        reveals: e.reveals,
        hand: [],
        library: e.drew !== undefined ? [e.drew] : [],
      }));
    }
  }

  // --- Reading -------------------------------------------------------------------------------------

  getState(): TableState {
    return this.state;
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

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  // --- Network members (TableSession, M1-C): a solo table has no peers --------------------------------

  readonly presence: Presence = NULL_PRESENCE;

  netStatus(): SessionNetStatus {
    return { mode: 'solo', connection: 'solo', peers: [], sequencer: null, seq: this.state.seq };
  }

  subscribeNet(_listener: NetStatusListener): () => void {
    return () => undefined;
  }

  chat(text: string, channel: ChatChannel = 'table'): Action {
    return this.dispatch({ type: 'chat', text, channel });
  }

  takeSeat(seat: SeatId, colour: SeatColourIndex): Action {
    const action = this.stamp({ type: 'seatTake', seat, name: this.state.seats[this.seat]?.name ?? '', colour });
    this.warn('The solo table has one chair');
    this.notify();
    return action;
  }

  roll(_purpose: RngPurpose, _n: number): Promise<number> {
    return Promise.reject(new Error('not implemented: M1-P8'));
  }

  // --- Public actions ------------------------------------------------------------------------------

  dispatch(draft: ActionDraft): Action {
    // Checked and dry-run unstamped; the cid is taken only when the action is committed or finally refused, so the
    // reveal that goes first also gets the earlier cid.
    const action = this.unstamped(draft);
    if (this.disposed) return this.stamp(action);
    if (SESSION_ONLY.has(action.type)) {
      this.warn(`${action.type} needs the session's private effects and cannot be dispatched directly`);
      return this.stamp(action);
    }
    if (action.type === 'draw' && this.state.cards[action.instanceId]?.zone === this.zone('library') && this.sec.libraryOrder[0] !== action.instanceId) {
      this.warn('A draw takes the top card of the library');
      return this.stamp(action);
    }
    if (action.type === 'toZone' && this.state.cards[action.card]?.zone === action.to) {
      // A card put on top or at the bottom of the library it is in: a private reorder (scry, surveil).
      if (action.to === this.zone('library')) return this.reorderOne(action.card, action.position === 'bottom' ? 'bottom' : 'top', action.group) ?? this.stamp(action);
      return this.stamp(action);
    }
    // A face-down card moved into a public zone that shows faces (graveyard, stack, command) is turned up there,
    // in one undo group with the move.
    const turnUp = turnsUpOnMove(this.state, this.sec, this.seat, action);
    const act = turnUp && action.group === undefined ? ({ ...action, group: randomId('g') } as Action) : action;
    const reveal = revealFor(this.state, this.sec, this.seat, act, turnUp);
    if (reveal && !this.commit(this.stamp(reveal))) return this.stamp(act);
    const stamped = this.stamp(act);
    const done = this.commit(stamped);
    if (done && turnUp) this.commit(this.stamp({ type: 'flip', card: referencedCard(act)!, face: 'up', ...(act.group !== undefined ? { group: act.group } : {}) }));
    this.notify();
    return done ?? stamped;
  }

  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
    const action = this.stamp({ type: 'move', card, to, ...(pose ? { pose } : {}) });
    if (this.disposed) return action;
    if (!faceDownAllowed(this.state, this.seat, card, to)) {
      this.warn('Only a card from your own hand or library can be put onto a battlefield or into exile face down');
      this.notify();
      return action;
    }
    // The reducer turns a card that leaves a hidden zone without a public identity face down (core relocate).
    const done = this.commit(action);
    this.notify();
    return done ?? action;
  }

  // --- Private effects ---------------------------------------------------------------------------------

  importDeck(deck: DeckImport): Promise<void> {
    return this.run(() => {
      const s = this.state;
      if (s.commitments[this.seat] || Object.values(s.cards).some((c) => c.owner === this.seat && !c.isToken)) {
        throw new Error('A deck is already on the table');
      }
      if (!Array.isArray(deck.main) || deck.main.length === 0) throw new RangeError('The deck has no main-deck cards');
      const identities: Record<InstanceId, SecretIdentity> = { ...this.sec.identities };
      const order: InstanceId[] = [];
      const commits: string[] = [];
      for (const raw of deck.main) {
        if (!raw || typeof raw.sid !== 'string' || raw.sid === '') throw new TypeError('Every card needs a Scryfall id');
        const card: CardRef = raw.foil ? { sid: raw.sid, foil: true } : { sid: raw.sid };
        let id = randomId('c');
        while (Object.hasOwn(identities, id) || Object.hasOwn(s.cards, id)) id = randomId('c');
        const salt = randomSalt();
        identities[id] = { card, salt };
        order.push(id);
        commits.push(commitFor(id, card, salt));
      }
      // Commits are published sorted: salted hashes in sorted order say nothing about the ids or the deck order.
      commits.sort();
      const ids = [...order].sort();
      const ready = this.stamp({ type: 'ready', commits, instanceIds: ids, zone: this.zone('library') });
      const pool = deck.side.map((r): CardRef => (r.foil ? { sid: r.sid, foil: true } : { sid: r.sid }));
      const ok = this.commit(ready, { secrets: (sec) => ({ ...sec, identities, libraryOrder: order, pool }) });
      if (!ok) throw new Error(`The deck could not be put on the table: ${explain(s, { ...ready, seq: s.seq + 1 }) ?? 'refused'}`);
      this.undoStack = [];
      this.prefetch([...deck.main, ...deck.side].map((r) => r.sid));
      this.notify();
    });
  }

  shuffle(zone: ZoneId = this.zone('library')): Promise<void> {
    return this.run(() => {
      this.shuffleNow(zone);
      this.notify();
    });
  }

  draw(n = 1): Promise<void> {
    return this.run(() => {
      this.drawNow(n);
      this.notify();
    });
  }

  mulligan(): Promise<void> {
    return this.run(() => {
      const count = this.entries.filter((e) => e.kind === 'action' && e.action.type === 'mulligan' && e.action.by === this.seat).length + 1;
      if (!this.commit(this.stamp({ type: 'mulligan', count }))) throw new Error('The mulligan was refused');
      this.shuffleNow(this.zone('library'));
      this.drawNow(MULLIGAN_HAND);
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
      if (!this.commit(this.stamp({ type: 'lookAt', zone, count: k }))) throw new Error('The look was refused');
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
    this.undoStack = this.undoStack.slice(0, this.undoStack.length - k);
    const group = batch.length > 1 ? randomId('g') : undefined;
    const undos = batch.map((e): ActionDraft => ({ type: 'undo', of: e.cid, inverse: e.inverse, ...(group ? { group } : {}) }));
    // Dry run first (unstamped, so a refused undo uses up no cid): a group is undone completely or not at all.
    let s = this.state;
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
    undos.forEach((u, i) => {
      const { hand, library } = batch[i]!;
      const handPrior = this.sec.hand;
      const libraryPrior = this.sec.libraryOrder;
      // Only the cards this step returns go back to their old places; the rest keep the current private order, so a
      // later scry or other private reorder is not undone with it (DESIGN "Turn flow and confirmation", Undo).
      if (!this.commit(this.stamp(u), { then: (sec) => ({ ...sec, hand: putBack(sec.hand, handPrior, hand) }) }, false)) return;
      // The public inverse puts a library card on top; when it came from deeper in the library, putting it back there
      // is a private reorder with its public trace and audit record (DESIGN "Specification: network protocol and secrecy").
      const now = this.sec.libraryOrder;
      const target = putBack(now, libraryPrior, library);
      if (!sameOrder(now, target)) this.commitReorder(target, 1, group);
      // A restore patch never puts a committed identity back: the card came back face down, and only its owner can
      // reveal it again, verified against the commitment (core/undo.ts UndoReveal).
      for (const r of batch[i]!.reveals) this.reReveal(r, group);
    });
    this.notify();
    return true;
  }

  // --- Internals ---------------------------------------------------------------------------------------

  /** Re-reveal an own card an undo brought back face down (turned up again when it was face up). */
  private reReveal(r: UndoReveal, group: string | undefined): void {
    const draft = reRevealDraft(this.state, this.sec, this.seat, r, group);
    if (draft) this.commit(this.stamp(draft), {}, false);
  }

  private zone(kind: string): ZoneId {
    return zoneId(kind, this.seat);
  }

  /** The draft as an action with `by` and a placeholder cid, for checks and dry runs before it is stamped. */
  private unstamped(draft: ActionDraft): Action {
    const { seq: _seq, ...rest } = draft as ActionDraft & { seq?: number };
    return { ...rest, by: this.seat, cid: DRY_CID } as Action;
  }

  /** Stamp `by` and a fresh client-unique `cid`; `seq` is set when the action is applied. */
  private stamp<D extends ActionDraft>(draft: D): Action {
    const { seq: _seq, ...rest } = draft as D & { seq?: number };
    return { ...rest, by: this.seat, cid: `${this.seat}.${this.cidPrefix}.${++this.cidCount}` } as Action;
  }

  /** Run a private effect synchronously; its errors reject the returned promise. */
  private run<T>(fn: () => T): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('The session is closed'));
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** The private order of an own hidden zone (library or hand), index 0 = top. */
  private privateList(zone: ZoneId): InstanceId[] {
    if (zone === this.zone('library')) return this.sec.libraryOrder;
    if (zone === this.zone('hand')) return this.sec.hand;
    throw new Error(`${zone} is not one of your hidden zones`);
  }

  /**
   * Apply a stamped action: reduce, update the secrets, record the undo entry, log, persist. Returns the sequenced
   * action, or null (with a warning in the log) when the reducer refuses it.
   */
  private commit(stamped: Action, o: CommitOptions = {}, undoable = true): Action | null {
    const before = this.state;
    const action = { ...stamped, seq: before.seq + 1 } as Action;
    const after = reduce(before, action);
    if (after === before) {
      this.warn(`${action.type} refused: ${explain(before, action) ?? 'no effect'}`);
      return null;
    }
    const inv = undoable && isUndoable(action) ? undoPlan(before, action) : null;
    const handBefore = this.sec.hand;
    const libraryBefore = this.sec.libraryOrder;
    let sec = o.secrets ? o.secrets(this.sec) : this.sec;
    sec = reconcileSecrets(sec, after, placementOf(action));
    if (o.then) sec = o.then(sec);
    this.state = after;
    this.sec = sec;
    if (inv) {
      this.undoStack.push({
        cid: action.cid,
        ...(action.group !== undefined ? { group: action.group } : {}),
        inverse: inv.inverse,
        reveals: inv.reveals,
        hand: [...handBefore],
        library: [...libraryBefore],
      });
    }
    const at = Date.now();
    this.entries.push({ kind: 'action', seq: action.seq!, at, action });
    this.persist(action);
    return action;
  }

  /** Queue the write of an applied action with the table record and the secret store (one transaction; session/persist.ts). */
  private persist(action: Action): void {
    this.saves.saveAction(action, this.state, this.sec);
  }

  /**
   * Store the current state as the table record's snapshot without a log entry: a fresh table, or a table restored
   * only up to a gap, whose stored log past the restored seq belongs to an abandoned timeline.
   */
  saveBase(): void {
    this.saves.saveBase(this.state, this.sec);
  }

  /** Secret shuffle of an own hidden zone (DESIGN "Specification: network protocol and secrecy", Secret shuffle). */
  private shuffleNow(zone: ZoneId): void {
    this.privateList(zone);
    const z = this.state.zones[zone];
    if (!z) throw new Error(`Unknown zone ${zone}`);
    const ownerNonce = randomSalt();
    const sid = randomId('sh');
    // Solo play has no peers, so there are no peer nonces (Secret shuffle 2-3).
    const peerNonces: string[] = [];
    const order = shuffledOrder(z.ids, shuffleSeed(ownerNonce, peerNonces));
    // TODO(M1-P2): publish shuffleCommit/shuffleDone once the reducer applies them; M0's reducer refuses them, so the
    // public trace of a solo shuffle is a `reorder` of the whole zone carrying the same orderHash.
    const action = this.stamp({ type: 'reorder', zone, count: order.length, orderHash: orderHash(order, ownerNonce) });
    const isLib = zone === this.zone('library');
    const ok = this.commit(action, {
      secrets: (s) => ({
        ...s,
        ...(isLib ? { libraryOrder: order } : { hand: order }),
        audit: [...s.audit, { kind: 'shuffle', sid, zone, ownerNonce, peerNonces, order }],
      }),
    });
    if (!ok) throw new Error('The shuffle was refused');
    // Shuffles cannot be undone, and nothing before a shuffle can be undone across it.
    this.undoStack = [];
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
      if (!this.commit(this.stamp({ type: 'draw', instanceId: top, ...(group ? { group } : {}) }))) return;
    }
  }

  /** Put an own library card on top or at the bottom: a private reorder with a public trace (DESIGN "Secret shuffle", private reorder). */
  private reorderOne(id: InstanceId, where: LibraryPlacement, group: string | undefined): Action | null {
    const rest = this.sec.libraryOrder.filter((x) => x !== id);
    const order = where === 'bottom' ? [...rest, id] : [id, ...rest];
    if (order.every((x, i) => x === this.sec.libraryOrder[i])) return null;
    const done = this.commitReorder(order, 1, group);
    this.notify();
    return done;
  }

  /** Commit a private reorder of the own library to `order`: public `reorder {zone, count, orderHash}` plus a ReorderRecord. */
  private commitReorder(order: InstanceId[], count: number, group: string | undefined): Action | null {
    const zone = this.zone('library');
    const nonce = randomSalt();
    const action = this.stamp({ type: 'reorder', zone, count, orderHash: orderHash(order, nonce), ...(group !== undefined ? { group } : {}) });
    return this.commit(action, { secrets: (s) => ({ ...s, libraryOrder: order, audit: [...s.audit, { kind: 'reorder', zone, count, nonce, order }] }) });
  }

  private warn(text: string): void {
    this.entries.push({ kind: 'system', seq: this.state.seq, at: Date.now(), level: 'warn', text });
  }

  notify(): void {
    if (this.disposed) return;
    for (const l of [...this.listeners]) {
      try {
        l(this.state);
      } catch (e) {
        console.error('session listener failed', e);
      }
    }
  }

  /** Load card data for these ids into the card source's memory, so `cardData()` answers synchronously. */
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

  /** Every Scryfall id this browser may show. */
  knownSids(): string[] {
    const sids = Object.values(this.sec.identities).map((i) => i.card.sid);
    for (const c of Object.values(this.state.cards)) if (c.identity) sids.push(c.identity.sid);
    return sids;
  }

  /**
   * Seq-ordered replay of the stored log on top of the stored snapshot, up to the table record's `lastSeq` (DESIGN
   * "Multiplayer architecture", Resume). Entries past `lastSeq` are left over from an abandoned timeline.
   */
  static replay(base: TableState, log: LogRecord[], lastSeq: number): { state: TableState; entries: LogEntry[]; problem: string | null } {
    let state = base;
    const entries: LogEntry[] = [];
    for (const rec of [...log].sort((a, b) => a.seq - b.seq)) {
      if (rec.seq <= state.seq) continue;
      if (rec.seq > lastSeq) break;
      if (rec.seq !== state.seq + 1) return { state, entries, problem: `the saved log has a gap after action ${state.seq}` };
      const next = reduce(state, rec.action);
      if (next === state) return { state, entries, problem: `saved action ${rec.seq} no longer applies: ${explain(state, rec.action) ?? 'refused'}` };
      state = next;
      entries.push({ kind: 'action', seq: rec.seq, at: rec.at, action: rec.action });
    }
    return { state, entries, problem: null };
  }
}

function freshTable(opts: SoloSessionOptions): TableState {
  return createTable({
    game: opts.game,
    format: '1v1',
    seats: [
      { name: opts.playerName?.trim() || 'Player', colour: 0 },
      { name: '', colour: 1 },
    ],
  });
}

/**
 * Create the solo table, or restore it from the store (PLAN M0-P7; DESIGN "Multiplayer architecture", Resume: the
 * snapshot plus the log after it, and the secret store, give back the same state hash).
 */
export async function createSoloSession(opts: SoloSessionOptions): Promise<SoloSession> {
  const roomId = opts.roomId ?? SOLO_ROOM;
  const seat = seatIdOf(0);
  const loaded = opts.store ? await opts.store.loadTable(roomId) : null;

  if (loaded) {
    const base = loaded.table.snapshot ?? freshTable(opts);
    const { state, entries, problem } = Solo.replay(base, loaded.log, loaded.table.lastSeq);
    const secrets = reconcileSecrets(loaded.secrets ?? emptySecrets(seat), state);
    const session = new Solo(opts, roomId, {
      state,
      secrets,
      entries,
      snapshot: loaded.table.snapshot ?? base,
      snapshotSeq: loaded.table.snapshot ? loaded.table.snapshotSeq : 0,
      protocol: loaded.table.protocol,
    });
    const short = problem !== null || state.seq !== loaded.table.lastSeq;
    if (problem) entries.push({ kind: 'system', seq: state.seq, at: Date.now(), level: 'warn', text: `Restored up to action ${state.seq}: ${problem}` });
    else if (short) entries.push({ kind: 'system', seq: state.seq, at: Date.now(), level: 'warn', text: `Restored up to action ${state.seq} of ${loaded.table.lastSeq}` });
    // A short restore starts a new timeline at the restored seq: store it as the base, so the stored log past it is
    // never replayed again (new writes overwrite it, and replay stops at the new lastSeq).
    if (short) session.saveBase();
    session.prefetch(session.knownSids());
    return session;
  }

  const state = freshTable(opts);
  const session = new Solo(opts, roomId, { state, secrets: emptySecrets(seat), entries: [], snapshot: state, snapshotSeq: 0 });
  session.saveBase();
  // The solo table goes straight to play (DESIGN "Specification: card data, packs and draft formats", Evening stages).
  session.dispatch({ type: 'stageSet', stage: 'match' });
  return session;
}
