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
  inverse,
  isUndoable,
  reduce,
  seatIdOf,
  zoneId,
  type Action,
  type ActionDraft,
  type CardRef,
  type InstanceId,
  type LogEntry,
  type SecretIdentity,
  type SecretStore,
  type SeatId,
  type TableState,
  type UndoableAction,
  type ZoneId,
} from '../core/index';
import type { CardData } from '../data/types';
import type { LogRecord, TableRecord } from '../store/types';
import { commitFor, orderHash, randomId, randomSalt, shuffledOrder, shuffleSeed } from './secrecy';
import { emptySecrets, reconcileSecrets, type LibraryPlacement } from './secrets';
import type { DeckImport, LookedCard, SessionListener, SoloSessionOptions, TableSession } from './types';

/** Room id of the solo table (store/tables.ts SOLO_ROOM_ID). */
export const SOLO_ROOM = 'solo';

/** A snapshot of the table goes into the table record every this many actions (DESIGN "Specification: network protocol and secrecy", Sync). */
export const SNAPSHOT_EVERY = 200;

/** Cards drawn by a London mulligan (DESIGN "Card manipulation", Library actions). */
export const MULLIGAN_HAND = 7;

/**
 * Action types that need the owner's secrets and therefore run only through the session's own methods
 * (importDeck, shuffle, mulligan, undo, a toZone within the own library), never through `dispatch`.
 */
const SESSION_ONLY: ReadonlySet<string> = new Set(['ready', 'shuffleCommit', 'shuffleNonce', 'shuffleDone', 'reorder', 'mulligan', 'undo']);

/** The solo session: TableSession plus what tests and the debug hook need. */
export interface SoloSession extends TableSession {
  readonly roomId: string;
  /** Resolves once every action applied so far has been written to IndexedDB (immediately without a store). */
  whenSaved(): Promise<void>;
}

interface UndoEntry {
  cid: string;
  group?: string;
  inverse: UndoableAction;
  /** The private hand order before the action, put back when the undo restores the same set of hand cards. */
  hand: InstanceId[];
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
}

function placementOf(a: Action): LibraryPlacement {
  if (a.type === 'toZone') return a.position === 'bottom' ? 'bottom' : 'top';
  if (a.type === 'undo') return placementOf(a.inverse);
  return 'top';
}

/** The one existing card an action is about, if any. */
function referencedCard(a: Action): InstanceId | null {
  if (a.type === 'draw' || a.type === 'reveal' || a.type === 'revealTo') return a.instanceId;
  if (a.type === 'createToken' || a.type === 'copy') return null;
  if ('card' in a && typeof a.card === 'string') return a.card;
  return null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Solo implements SoloSession {
  readonly seat: SeatId = seatIdOf(0);
  private state: TableState;
  private sec: SecretStore;
  private entries: LogEntry[];
  private snapshot: TableState;
  private snapshotSeq: number;
  private undoStack: UndoEntry[] = [];
  private readonly listeners = new Set<SessionListener>();
  private writes: Promise<void> = Promise.resolve();
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
    this.snapshot = init.snapshot;
    this.snapshotSeq = init.snapshotSeq;
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
    return this.writes;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  // --- Public actions ------------------------------------------------------------------------------

  dispatch(draft: ActionDraft): Action {
    const action = this.stamp(draft);
    if (this.disposed) return action;
    if (SESSION_ONLY.has(action.type)) {
      this.warn(`${action.type} needs the session's private effects and cannot be dispatched directly`);
      return action;
    }
    if (action.type === 'draw' && this.state.cards[action.instanceId]?.zone === this.zone('library') && this.sec.libraryOrder[0] !== action.instanceId) {
      this.warn('A draw takes the top card of the library');
      return action;
    }
    if (action.type === 'toZone' && this.state.cards[action.card]?.zone === action.to) {
      // A card put on top or at the bottom of the library it is in: a private reorder (scry, surveil).
      if (action.to === this.zone('library')) return this.reorderOne(action.card, action.position === 'bottom' ? 'bottom' : 'top', action.group) ?? action;
      return action;
    }
    const reveal = this.revealFor(action);
    if (reveal && !this.commit(reveal)) return action;
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
    const undos = batch.map((e) => this.stamp({ type: 'undo', of: e.cid, inverse: e.inverse, ...(group ? { group } : {}) }));
    // Dry run first: a group is undone completely or not at all.
    let s = this.state;
    for (const u of undos) {
      const next = reduce(s, { ...u, seq: s.seq + 1 });
      if (next === s) {
        this.warn(`Cannot undo: ${explain(s, { ...u, seq: s.seq + 1 }) ?? 'refused'}`);
        this.notify();
        return false;
      }
      s = next;
    }
    undos.forEach((u, i) => {
      const hand = batch[i]!.hand;
      this.commit(u, { then: (sec) => (sameSet(sec.hand, hand) ? { ...sec, hand: [...hand] } : sec) }, false);
    });
    this.notify();
    return true;
  }

  // --- Internals ---------------------------------------------------------------------------------------

  private zone(kind: string): ZoneId {
    return zoneId(kind, this.seat);
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
   * The reveal an action needs first: the action names an own card whose identity only this browser holds, and the
   * card ends up public (moved out of a hidden zone, cast, or turned face up). Null when the action would not apply
   * even with the reveal, so a refused action never publishes an identity.
   */
  private revealFor(action: Action): Action | null {
    const id = referencedCard(action);
    if (id === null || action.type === 'reveal' || (action.type === 'flip' && action.ref !== undefined)) return null;
    const s = this.state;
    const card = Object.hasOwn(s.cards, id) ? s.cards[id] : undefined;
    const secret = Object.hasOwn(this.sec.identities, id) ? this.sec.identities[id] : undefined;
    if (!card || !secret || card.owner !== this.seat || card.identity !== undefined) return null;
    const hidden = s.zones[card.zone]?.visibility !== 'public';
    const turnsUp = !hidden && card.face === 'down' && action.type === 'flip' && action.face === 'up';
    if (!hidden && !turnsUp) return null;
    const reveal = this.stamp({ type: 'reveal', instanceId: id, ref: secret.card, salt: secret.salt, ...(action.group !== undefined ? { group: action.group } : {}) });
    const s1 = reduce(s, { ...reveal, seq: s.seq + 1 });
    if (s1 === s) return null;
    const s2 = reduce(s1, { ...action, seq: s.seq + 2 } as Action);
    if (s2 === s1) return null;
    const after = s2.cards[id];
    if (!after || s2.zones[after.zone]?.visibility !== 'public') return null;
    return reveal;
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
    const inv = undoable && isUndoable(action) ? inverse(before, action) : null;
    const handBefore = this.sec.hand;
    let sec = o.secrets ? o.secrets(this.sec) : this.sec;
    sec = reconcileSecrets(sec, after, placementOf(action));
    if (o.then) sec = o.then(sec);
    this.state = after;
    this.sec = sec;
    if (inv) this.undoStack.push({ cid: action.cid, ...(action.group !== undefined ? { group: action.group } : {}), inverse: inv, hand: [...handBefore] });
    const at = Date.now();
    this.entries.push({ kind: 'action', seq: action.seq!, at, action });
    if (action.seq! % SNAPSHOT_EVERY === 0) {
      this.snapshot = after;
      this.snapshotSeq = action.seq!;
    }
    this.persist(action, at);
    return action;
  }

  private persist(action: Action, at: number): void {
    const store = this.opts.store;
    if (!store) return;
    const entry: LogRecord = { roomId: this.roomId, seq: action.seq!, action, at };
    const table = this.tableRecord(at);
    // State and secrets are never mutated in place, so these references stay valid until the write runs.
    const secrets = this.sec;
    this.writes = this.writes.then(() => store.saveAction(this.roomId, entry, table, secrets)).catch((e: unknown) => this.warn(`Could not save the table: ${errorText(e)}`));
  }

  tableRecord(at: number): TableRecord {
    return {
      roomId: this.roomId,
      roomKey: '',
      lastSeq: this.state.seq,
      snapshot: this.snapshot,
      snapshotSeq: this.snapshotSeq,
      seat: this.seat,
      stage: this.state.stage,
      updatedAt: at,
    };
  }

  /** Persist the current snapshot without a log entry (a fresh table). */
  saveBase(): void {
    const store = this.opts.store;
    if (!store) return;
    const table = this.tableRecord(Date.now());
    const secrets = this.sec;
    this.writes = this.writes.then(() => store.saveSnapshot(table, secrets)).catch((e: unknown) => this.warn(`Could not save the table: ${errorText(e)}`));
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
    const zone = this.zone('library');
    const rest = this.sec.libraryOrder.filter((x) => x !== id);
    const order = where === 'bottom' ? [...rest, id] : [id, ...rest];
    if (order.every((x, i) => x === this.sec.libraryOrder[i])) return null;
    const nonce = randomSalt();
    const action = this.stamp({ type: 'reorder', zone, count: 1, orderHash: orderHash(order, nonce), ...(group !== undefined ? { group } : {}) });
    const done = this.commit(action, { secrets: (s) => ({ ...s, libraryOrder: order, audit: [...s.audit, { kind: 'reorder', zone, count: 1, nonce, order }] }) });
    this.notify();
    return done;
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

  /** Seq-ordered replay of the stored log on top of the stored snapshot (DESIGN "Multiplayer architecture", Resume). */
  static replay(base: TableState, log: LogRecord[]): { state: TableState; entries: LogEntry[]; problem: string | null } {
    let state = base;
    const entries: LogEntry[] = [];
    for (const rec of log) {
      if (rec.seq <= state.seq) continue;
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
    const { state, entries, problem } = Solo.replay(base, loaded.log);
    const secrets = reconcileSecrets(loaded.secrets ?? emptySecrets(seat), state);
    const session = new Solo(opts, roomId, {
      state,
      secrets,
      entries,
      snapshot: loaded.table.snapshot ?? base,
      snapshotSeq: loaded.table.snapshot ? loaded.table.snapshotSeq : 0,
    });
    if (problem) entries.push({ kind: 'system', seq: state.seq, at: Date.now(), level: 'warn', text: `Restored up to action ${state.seq}: ${problem}` });
    else if (state.seq !== loaded.table.lastSeq) {
      entries.push({ kind: 'system', seq: state.seq, at: Date.now(), level: 'warn', text: `Restored up to action ${state.seq} of ${loaded.table.lastSeq}` });
    }
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
