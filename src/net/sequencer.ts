/**
 * The sequencer role and the replica (DESIGN "Specification: network protocol and secrecy", Sequencing 1-5, Sync).
 * Contracts: M1-C (net/types.ts Sequencer, SyncEngine). Implementer: M1-P1.
 *
 * Pure apart from their own fields: no transport, clock or randomness, so the simulated-network tests and the
 * engine share one implementation of ordering, de-duplication, optimistic re-application and catch-up.
 */
import { ACTION_FAMILIES, type Action, type ActionType } from '../core/actions';
import { explain, reduce } from '../core/reducer';
import type { CoreGameSpec, SeatId, TableState } from '../core/types';
import type { PeerRole, SequencedAction } from './messages';
import { roleProblem } from './roles';
import { NET_SNAPSHOT_EVERY, SYNC_TAIL_LIMIT, type PeerInfo, type ReceiveResult, type SequenceResult, type Sequencer, type SyncEngine } from './types';

/** Sequenced actions a replica retains for catch-up (twice the tail limit, so a 500-action gap is still answered with a tail). */
export const RETAIN_ACTIONS = 2 * SYNC_TAIL_LIMIT;
/** Sequenced cids a replica remembers for de-duplication of resent proposals. */
export const REMEMBER_CIDS = 20_000;
/** A replica keeps the confirmed state every this many actions, so it can rewind to a fork point. */
export const REWIND_EVERY = 50;
/** How many of those states it keeps (REWIND_EVERY * REWIND_KEEP actions back). */
export const REWIND_KEEP = 12;
/** Out-of-order arrivals a replica buffers before it relies on catch-up instead. */
export const BUFFER_LIMIT = 4 * SYNC_TAIL_LIMIT;

/**
 * Actions only the sequencer itself may send (net/types.ts Sequencer.sequence; core/actions.ts AwayAction,
 * CommitCloseAction, DraftTimeoutAction: the pick timer is the sequencer's clock, DESIGN Timers).
 */
const SEQUENCER_ONLY: ReadonlySet<ActionType> = new Set<ActionType>(['away', 'commitClose', 'sequencerClaim', 'draftTimeout']);

/** The seat whose `peer` is `peerId` in `state`, or null (DESIGN "Players, seats and formats": a returning key pair reclaims its seat). */
export function seatOfPeer(state: TableState, peerId: string): SeatId | null {
  if (!peerId) return null;
  for (const seat of Object.values(state.seats)) if (seat.peer === peerId) return seat.id;
  return null;
}

/**
 * The sender's seat for the sequencer's authority check (DESIGN "Specification: network protocol and secrecy",
 * Sequencing 3: the sequencer rejects any propose whose `by` is not the sender's seat). A peer briefly holds two
 * chairs while it moves (M1-P5 takes the new chair before leaving the old one), so the seat is the action's `by`
 * when the sender holds that chair, else the first chair it holds (or null).
 */
export function senderSeat(state: TableState, action: { by?: unknown }, peerId: string): SeatId | null {
  const by = action.by;
  if (peerId && typeof by === 'string' && Object.hasOwn(state.seats, by) && state.seats[by]!.peer === peerId) return by;
  return seatOfPeer(state, peerId);
}

function cardOwner(state: TableState, id: unknown): SeatId | null | undefined {
  if (typeof id !== 'string') return undefined;
  return state.cards[id]?.owner;
}

function zoneOwner(state: TableState, id: unknown): SeatId | null | undefined {
  if (typeof id !== 'string') return undefined;
  return state.zones[id]?.owner;
}

/**
 * The existing cards an action acts on (besides those the specific owner checks name): the card it moves, taps,
 * casts, attaches, copies or settles, and the host or source it names. A `lookAt` is left out: looking at another
 * seat's hidden cards is the asker's public record, answered by the owner on the pair channel (DESIGN "Multiplayer
 * architecture", Private looks; decision M1-C), and a `createToken` names a card that does not exist yet.
 */
function actedOnCards(a: Action): unknown[] {
  switch (a.type) {
    case 'lookAt':
    case 'createToken':
      return [];
    case 'copy':
      return [a.card, a.of];
    case 'attach':
      return [a.card, a.to];
    case 'stackPush':
      return [a.card, a.source];
    case 'settle':
      return Array.isArray(a.cards) ? a.cards : [];
    case 'tidy':
      return typeof a.poses === 'object' && a.poses !== null ? Object.keys(a.poses) : [];
    case 'draw':
    case 'reveal':
    case 'revealTo':
      return [a.instanceId];
    default: {
      const r = a as unknown as Record<string, unknown>;
      return [r.card];
    }
  }
}

/**
 * Hidden-zone actions come from the zone's owner (DESIGN "Specification: network protocol and secrecy", Sequencing 3):
 * only the owner holds the order and identities they publish. Any action on a card that lies in another seat's
 * hidden zone is refused (moving it out, casting it, attaching or copying it, re-sorting it between that seat's
 * zones), and so are the owner-only secrecy steps. Moving a public card into another seat's hidden zone (returning
 * an opponent's creature to its owner's hand) stays allowed: its identity was public. An undo is checked by the
 * inverse it applies. Null when allowed, else the reason.
 */
function hiddenOwnerCheck(state: TableState, a: Action): string | null {
  const own = (owner: SeatId | null | undefined, what: string): string | null =>
    owner === undefined || owner === null || owner === a.by ? null : `${what} belongs to ${owner}, not ${a.by}`;
  if (a.type === 'undo') {
    const inv = a.inverse as unknown;
    return typeof inv === 'object' && inv !== null && typeof (inv as { type?: unknown }).type === 'string' && Object.hasOwn(ACTION_FAMILIES, (inv as { type: string }).type)
      ? hiddenOwnerCheck(state, { ...(inv as Action), by: a.by } as Action)
      : null;
  }
  for (const id of actedOnCards(a)) {
    if (typeof id !== 'string' || !Object.hasOwn(state.cards, id)) continue;
    const zone = state.zones[state.cards[id]!.zone];
    if (zone && zone.visibility !== 'public' && zone.owner !== null && zone.owner !== a.by) {
      return `hidden-zone actions come from the zone's owner: card ${id} is in ${zone.id}, which belongs to ${zone.owner}, not ${a.by}`;
    }
  }
  switch (a.type) {
    case 'draw': {
      const c = typeof a.instanceId === 'string' ? state.cards[a.instanceId] : undefined;
      return c ? own(zoneOwner(state, c.zone), `the zone of card ${c.id}`) : null;
    }
    case 'reveal':
      return own(cardOwner(state, a.instanceId), `card ${String(a.instanceId)}`);
    case 'flip':
      return a.ref !== undefined || a.salt !== undefined ? own(cardOwner(state, a.card), `card ${String(a.card)}`) : null;
    case 'revealTo':
      return own(cardOwner(state, a.instanceId), `card ${String(a.instanceId)}`);
    case 'shuffleCommit':
    case 'reorder':
    case 'ready':
      return own(zoneOwner(state, a.zone), `zone ${String(a.zone)}`);
    case 'shuffleDone': {
      const round = typeof a.sid === 'string' ? state.shuffles[a.sid] : undefined;
      return round ? own(round.owner, `shuffle ${round.id}`) : null;
    }
    default:
      return null;
  }
}

class SequencerImpl implements Sequencer {
  constructor(public lastSeq: number) {}

  sequence(state: TableState, action: Action, sender: { seat: SeatId | null; role: PeerRole; self: boolean; peerId?: string }): SequenceResult {
    const why = this.check(state, action, sender);
    if (why !== null) return { ok: false, reason: why };
    const seq = Math.max(this.lastSeq, state.seq) + 1;
    this.lastSeq = seq;
    const { seq: _drop, ...rest } = action;
    return { ok: true, action: { ...rest, seq } as SequencedAction };
  }

  private check(state: TableState, action: Action, sender: { seat: SeatId | null; role: PeerRole; self: boolean; peerId?: string }): string | null {
    const a = action as unknown as Record<string, unknown>;
    if (typeof a !== 'object' || a === null) return 'an action must be an object';
    if (typeof a.type !== 'string' || !Object.hasOwn(ACTION_FAMILIES, a.type)) return `unknown action type ${String(a.type)}`;
    if (typeof a.by !== 'string' || typeof a.cid !== 'string' || a.cid === '') return 'an action needs by and cid';
    if (a.restore !== undefined) return 'only the inverse inside an undo carries a restore patch';
    if (sender.role === 'spectator') {
      // DESIGN "Players, seats and formats", Spectators: chat and ping only, never for a seat, as its own spectator id
      // (net/roles.ts; M3-P5). Without the sender's peer id the action is refused: its `by` cannot be checked.
      const why = roleProblem(state, action, { role: sender.role, peerId: sender.peerId ?? '', seat: sender.seat });
      if (why !== null) return why;
    } else if (sender.seat === null) {
      // An unseated player can only take a chair (DESIGN "Players, seats and formats").
      if (action.type !== 'seatTake') return `take a seat before sending ${action.type}`;
      if (action.by !== action.seat) return 'seatTake must be sent by the seat it takes';
    } else if (action.by !== sender.seat && !(action.type === 'seatTake' && action.by === action.seat)) {
      // Taking a chair is stamped as the chair taken, seated or not (M1-P5 moves chairs that way); the engine checks
      // that it is taken with the sender's own peer id, and the reducer that it is free.
      return `by ${action.by} is not the sender's seat ${sender.seat}`;
    }
    if (!sender.self && (SEQUENCER_ONLY.has(action.type) || (action.type === 'respond' && action.response === 'timeout'))) {
      return `only the sequencer sends ${action.type === 'respond' ? 'timeouts' : action.type}`;
    }
    if (action.type === 'respond' && action.response !== 'timeout' && action.seat !== action.by) return 'a seat answers only for itself';
    // A player leaves only its own chair: there is no host kick in the design (decision M1-P1). Taking a second chair
    // while seated stays allowed (with the sender's own peer id, engine.ts): moving chairs takes the new one first,
    // then leaves the old one stamped as the old one (the engine passes `by` as the sender's seat while it holds it).
    if (action.type === 'seatLeave' && action.seat !== action.by) return 'a player leaves only its own seat';
    const hidden = hiddenOwnerCheck(state, action);
    if (hidden !== null) return hidden;
    return explain(state, action);
  }
}

/** A sequencer continuing after `lastSeq` (DESIGN "Specification: network protocol and secrecy", Sequencing 3). */
export function createSequencer(lastSeq: number): Sequencer {
  return new SequencerImpl(lastSeq);
}

/**
 * Apply a sequenced action to the confirmed state. The reducer returns a refused action's state unchanged; the
 * sequence number still advances, deterministically on every peer, so `state.seq` is always the last applied seq.
 */
export function applySequenced(state: TableState, action: SequencedAction): TableState {
  const next = reduce(state, action);
  return next.seq === action.seq ? next : { ...next, seq: action.seq };
}

/** The replica (net/types.ts SyncEngine) plus what the engine needs beyond the contract: cid lookups and the log window. */
export class Replica implements SyncEngine {
  private conf: TableState;
  private viewState: TableState;
  private own: Action[] = [];
  private readonly buffer = new Map<number, SequencedAction>();
  private log: SequencedAction[] = [];
  private readonly cids = new Map<string, number>();
  private snap: { seq: number; state: TableState };
  /** Recent confirmed states (every REWIND_EVERY and every loaded snapshot), oldest first, for `rewind`. */
  private marks: { seq: number; state: TableState }[] = [];

  /** Called for every sequenced action applied in order (not for actions inside a loaded snapshot). */
  onApply: ((action: SequencedAction) => void) | null = null;

  constructor(
    readonly game: CoreGameSpec | null,
    snapshot: { seq: number; state: TableState },
  ) {
    this.conf = snapshot.state.seq === snapshot.seq ? snapshot.state : { ...snapshot.state, seq: snapshot.seq };
    this.viewState = this.conf;
    this.snap = { seq: snapshot.seq, state: this.conf };
    this.marks = [this.snap];
  }

  confirmed(): TableState {
    return this.conf;
  }

  view(): TableState {
    return this.viewState;
  }

  seq(): number {
    return this.conf.seq;
  }

  pending(): readonly Action[] {
    return this.own;
  }

  applyOwn(action: Action): boolean {
    if (explain(this.viewState, action) !== null) return false;
    this.own.push(action);
    this.viewState = reduce(this.viewState, action);
    return true;
  }

  receive(action: SequencedAction): ReceiveResult {
    const seq = action.seq;
    if (seq <= this.conf.seq) {
      // Already applied: if it is an own pending action (a resync jumped over it), it was sequenced, so drop it.
      if (this.dropPending(action.cid)) this.rebuild();
      return 'duplicate';
    }
    if (seq > this.conf.seq + 1) {
      if (!this.buffer.has(seq) && this.buffer.size < BUFFER_LIMIT) this.buffer.set(seq, action);
      return 'buffered';
    }
    this.apply(action);
    this.drain();
    this.rebuild();
    return 'applied';
  }

  reject(cid: string): Action | null {
    const i = this.own.findIndex((a) => a.cid === cid);
    if (i < 0) return null;
    const [a] = this.own.splice(i, 1);
    this.rebuild();
    return a ?? null;
  }

  gap(): number | null {
    return this.buffer.size > 0 ? this.conf.seq : null;
  }

  tail(afterSeq: number): SequencedAction[] | null {
    if (afterSeq >= this.conf.seq) return [];
    const first = this.log[0]?.seq;
    if (first === undefined || afterSeq + 1 < first) return null;
    return this.log.slice(afterSeq + 1 - first);
  }

  snapshot(): { seq: number; state: TableState } {
    return { seq: this.conf.seq, state: this.conf };
  }

  /**
   * The latest periodic snapshot (every NET_SNAPSHOT_EVERY actions) and the retained tail after it (DESIGN
   * "Specification: network protocol and secrecy", Sync: a snapshot plus tail); the current state when the tail
   * since that snapshot is no longer held.
   */
  syncSnapshot(): { snapshot: { seq: number; state: TableState }; tail: SequencedAction[] } {
    const tail = this.tail(this.snap.seq);
    return tail === null ? { snapshot: this.snapshot(), tail: [] } : { snapshot: this.snap, tail };
  }

  load(snapshot: { seq: number; state: TableState }, tail: readonly SequencedAction[]): void {
    this.conf = snapshot.state.seq === snapshot.seq ? snapshot.state : { ...snapshot.state, seq: snapshot.seq };
    this.snap = { seq: snapshot.seq, state: this.conf };
    this.marks = [this.snap];
    this.log = [];
    for (const k of [...this.buffer.keys()]) if (k <= this.conf.seq) this.buffer.delete(k);
    for (const a of tail) {
      if (a.seq <= this.conf.seq) {
        this.dropPending(a.cid);
        this.cids.set(a.cid, a.seq);
        continue;
      }
      if (a.seq !== this.conf.seq + 1) break;
      this.apply(a);
    }
    this.drain();
    this.rebuild();
  }

  /** Forget every buffered out-of-order action (a resync replaces the history they belonged to). */
  clearBuffer(): void {
    this.buffer.clear();
  }

  /** The seq at which `cid` was sequenced, if remembered. */
  seqOf(cid: string): number | undefined {
    return this.cids.get(cid);
  }

  /** The retained sequenced action at `seq`, if held. */
  at(seq: number): SequencedAction | undefined {
    const first = this.log[0]?.seq;
    if (first === undefined || seq < first) return undefined;
    return this.log[seq - first];
  }

  /**
   * Forget that the retained actions from `fromSeq` on were sequenced (their history is being replaced by another
   * peer's after a fork); returns them. The confirmed state is untouched until the replacing `load`.
   */
  forget(fromSeq: number): SequencedAction[] {
    const gone = this.log.filter((a) => a.seq >= fromSeq);
    for (const a of gone) if (this.cids.get(a.cid) === a.seq) this.cids.delete(a.cid);
    return gone;
  }

  /**
   * Go back to the confirmed state at `toSeq` (a fork point), replaying retained actions from the nearest kept
   * state; the actions after it are dropped and forgotten, and returned. Null (and nothing changed) when that state
   * can no longer be rebuilt.
   */
  rewind(toSeq: number): SequencedAction[] | null {
    if (toSeq >= this.conf.seq) return [];
    let mark: { seq: number; state: TableState } | undefined;
    for (const m of this.marks) if (m.seq <= toSeq) mark = m;
    const first = this.log[0]?.seq;
    if (!mark || (mark.seq < toSeq && (first === undefined || first > mark.seq + 1))) return null;
    let state = mark.state;
    for (const a of this.log) if (a.seq > mark.seq && a.seq <= toSeq) state = applySequenced(state, a);
    const gone = this.log.filter((a) => a.seq > toSeq);
    this.log = this.log.filter((a) => a.seq <= toSeq);
    for (const a of gone) if (this.cids.get(a.cid) === a.seq) this.cids.delete(a.cid);
    this.marks = this.marks.filter((m) => m.seq <= toSeq);
    if (this.snap.seq > toSeq) this.snap = mark;
    this.conf = state;
    this.buffer.clear();
    this.rebuild();
    return gone;
  }

  /** Put actions back at the front of the pending queue (own actions lost in an abandoned history). */
  requeue(actions: readonly Action[]): void {
    const fresh = actions.filter((a) => this.cids.get(a.cid) === undefined && !this.own.some((p) => p.cid === a.cid));
    if (fresh.length === 0) return;
    this.own = [...fresh, ...this.own];
    this.rebuild();
  }

  private apply(action: SequencedAction): void {
    this.conf = applySequenced(this.conf, action);
    this.log.push(action);
    if (this.log.length > RETAIN_ACTIONS) this.log.splice(0, this.log.length - RETAIN_ACTIONS);
    this.cids.set(action.cid, action.seq);
    if (this.cids.size > REMEMBER_CIDS) {
      const oldest = this.cids.keys().next().value;
      if (oldest !== undefined) this.cids.delete(oldest);
    }
    if (action.seq % NET_SNAPSHOT_EVERY === 0) this.snap = { seq: action.seq, state: this.conf };
    if (action.seq % REWIND_EVERY === 0) {
      this.marks.push({ seq: action.seq, state: this.conf });
      if (this.marks.length > REWIND_KEEP) this.marks.shift();
    }
    this.dropPending(action.cid);
    this.onApply?.(action);
  }

  private drain(): void {
    for (;;) {
      const next = this.buffer.get(this.conf.seq + 1);
      if (!next) break;
      this.buffer.delete(next.seq);
      this.apply(next);
    }
    for (const k of [...this.buffer.keys()]) if (k <= this.conf.seq) this.buffer.delete(k);
  }

  private dropPending(cid: string): boolean {
    const i = this.own.findIndex((a) => a.cid === cid);
    if (i < 0) return false;
    this.own.splice(i, 1);
    return true;
  }

  private rebuild(): void {
    let v = this.conf;
    for (const a of this.own) v = reduce(v, a);
    this.viewState = v;
  }
}

/** A replica starting from a snapshot (DESIGN "Specification: network protocol and secrecy", Sequencing 4). */
export function createSyncEngine(game: CoreGameSpec, snapshot: { seq: number; state: TableState }): SyncEngine {
  return new Replica(game, snapshot);
}

/**
 * Sequencer election (DESIGN "Specification: network protocol and secrecy", Sequencing 1): the identity peer id of
 * the connected (not away) seated player with the lowest seat index, counting this browser as `self`; spectators
 * never sequence. A player's seat is the seat whose `peer` is its peer id in `state`. While no connected player holds
 * a seat (a table still in its lobby), the lowest peer id among the connected players sequences, so every peer that
 * sees the same room picks the same one (decision M1-P1).
 */
export function electSequencer(state: TableState, self: { peerId: string; seat: SeatId | null; role: PeerRole }, peers: readonly PeerInfo[]): string | null {
  const players: string[] = [];
  if (self.role === 'player' && self.peerId) players.push(self.peerId);
  for (const p of peers) if (p.role === 'player' && p.status === 'connected' && p.peerId && !players.includes(p.peerId)) players.push(p.peerId);
  let best: { peerId: string; index: number } | null = null;
  for (const peerId of players) {
    const seat = seatOfPeer(state, peerId);
    const index = seat === null ? undefined : state.seats[seat]?.index;
    if (index === undefined) continue;
    if (!best || index < best.index || (index === best.index && peerId < best.peerId)) best = { peerId, index };
  }
  if (best) return best.peerId;
  return players.length ? [...players].sort()[0]! : null;
}
