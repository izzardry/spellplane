/**
 * A stand-in networked session for dev and test builds (PLAN M1-P5: build the lobby against the M1-C contracts with
 * fakes; M1-P8 wires the real session). It implements TableSession over any Transport with the smallest protocol that
 * lets several pages share one table: the best-ranked peer (highest seq, then lowest peer id) applies proposals through
 * core's reducer and broadcasts the whole state; everyone else adopts it. Presence uses the real `pres` messages.
 *
 * It holds no secrets of other seats and sends none of its own: Ready publishes only the salted commitments and opaque
 * ids (DESIGN "Specification: network protocol and secrecy", Commitments); identities stay in this browser's secret
 * store. It is not the M1-P1 engine: no gap detection, catch-up log, heartbeat or hash exchange. Loaded lazily from
 * App.svelte only when `__SPELLPLANE_DEBUG__` is set and no networked session was handed in.
 */
import type { Action, ActionDraft } from '../../core/actions';
import { makeCommitments, type RevealedCard } from '../../core/commit';
import { createTable, explain, reduce } from '../../core/reducer/index';
import { emptySecretStore } from '../../core/secrets';
import type { CardRef, Format, InstanceId, LogEntry, Pose, RngPurpose, SeatColourIndex, SecretStore, SeatId, TableState, ZoneId } from '../../core/types';
import type { CardDataSource } from '../../data/types';
import type { GameDefinition } from '../../games/types';
import type { ChatChannel, CursorMessage, DragMessage } from '../../net/messages';
import type { Message, PeerId, Transport } from '../../net/transport';
import { PRESENCE_INTERVAL_MS, type ConnectionStatus, type PeerInfo, type PeerPresence, type Presence } from '../../net/types';
import { randomId, randomSalt, randomBytes } from '../../session/secrecy';
import type { DeckImport, LookedCard, NetStatusListener, SessionListener, SessionNetStatus, TableSession } from '../../session/types';
import { firstFreeChair, pickColour, seatOf } from './seats';

/** Wire messages of the stand-in (never seen by the real engine: they exist only between stand-in pages). */
interface LxHello extends Message {
  t: 'lxHello';
  peerId: string;
  nickname: string;
  seq: number;
}
interface LxState extends Message {
  t: 'lxState';
  peerId: string;
  state: TableState;
  action: Action | null;
}
interface LxPropose extends Message {
  t: 'lxPropose';
  action: Action;
}
interface LxNack extends Message {
  t: 'lxNack';
  cid: string;
  reason: string;
}

/** Options of the stand-in session. */
export interface LocalSessionOptions {
  game: GameDefinition;
  cardData: CardDataSource;
  roomId: string;
  roomKey: string;
  transport: Transport;
  identity: { peerId: string; nickname: string; seatColour: number };
  format?: Format;
  now?: () => number;
  /** How long to listen for a table already in the room before sitting down at a fresh one. */
  settleMs?: number;
  /** Give up taking a chair after this long. */
  seatTimeoutMs?: number;
}

/** The stand-in: a TableSession plus leave and a nickname setter for the lobby's identity changes. */
export interface LocalSession extends TableSession {
  leave(): void;
  /** The nickname used by the next `takeSeat` (the real session reads it from its identity). */
  setNickname(name: string): void;
}

function shuffleInPlace<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    let j = -1;
    const limit = 0x100000000 - (0x100000000 % (i + 1));
    while (j < 0) {
      const b = randomBytes(4);
      const v = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
      if (v < limit) j = v % (i + 1);
    }
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Join the room and resolve once this browser holds a chair (the lowest free one, or the one its key pair holds). */
export async function createLocalSession(opts: LocalSessionOptions): Promise<LocalSession> {
  const now = opts.now ?? (() => Date.now());
  const t = opts.transport;
  const self = opts.identity.peerId;
  let nickname = opts.identity.nickname;
  let state: TableState = createTable({
    game: opts.game,
    format: opts.format ?? '1v1',
    seats: Array.from({ length: opts.format === 'ffa3' ? 3 : opts.format === 'ffa4' || opts.format === '2hg' ? 4 : 2 }, (_, i) => ({ name: '', colour: i })),
  });
  let secrets: SecretStore = emptySecretStore('s0');
  let entries: LogEntry[] = [];
  let joined = false;
  let closed = false;
  let cid = 0;
  const hellos = new Map<PeerId, { peerId: string; nickname: string; seq: number }>();
  const listeners = new Set<SessionListener>();
  const netListeners = new Set<NetStatusListener>();
  const waiters: { test: () => boolean; resolve: () => void }[] = [];
  /** Own proposals not yet sequenced or refused. */
  const proposed = new Set<string>();

  const rank = (a: { peerId: string; seq: number }, b: { peerId: string; seq: number }): number => b.seq - a.seq || (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0);
  const sequencer = (): { peerId: string; transportId: PeerId | null } => {
    let best: { peerId: string; seq: number; transportId: PeerId | null } = { peerId: self, seq: state.seq, transportId: null };
    for (const [tid, h] of hellos) if (t.peers().includes(tid) && rank(h, best) < 0) best = { ...h, transportId: tid };
    return best;
  };
  const isSequencer = (): boolean => sequencer().transportId === null;

  const status = (): SessionNetStatus => {
    const peers: PeerInfo[] = t.peers().map((tid) => {
      const h = hellos.get(tid);
      return {
        transportId: tid,
        peerId: h?.peerId ?? '',
        nickname: h?.nickname ?? '',
        seat: h ? seatOf(state, h.peerId) : null,
        role: 'player',
        status: h ? 'connected' : 'handshake',
        lastSeq: h?.seq ?? 0,
      };
    });
    const connection: ConnectionStatus = closed ? 'closed' : !joined ? 'joining' : peers.some((p) => p.status === 'connected') ? 'connected' : 'alone';
    return { mode: 'net', connection, peers, sequencer: sequencer().peerId, seq: state.seq };
  };

  const notify = (): void => {
    for (const l of listeners) l(state);
    const s = status();
    for (const l of netListeners) l(s);
    for (const w of [...waiters]) {
      if (w.test()) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  };
  const until = (test: () => boolean, ms: number, what: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (test()) return resolve();
      const w = { test, resolve: () => (clearTimeout(timer), resolve()) };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(what));
      }, ms);
      waiters.push(w);
    });

  const mySeat = (): SeatId | null => seatOf(state, self);

  const adopt = (next: TableState, action: Action | null): void => {
    const before = state;
    state = next;
    if (action?.cid) proposed.delete(action.cid);
    if (action) entries = [...entries, { kind: 'action', seq: next.seq, at: now(), action }];
    else if (next.seq !== before.seq) entries = [];
    const seat = mySeat();
    if (seat && secrets.seat !== seat) secrets = { ...secrets, seat };
    notify();
    // Lost the chair to someone who sat down at the same time: take the next free one (lobby only).
    if (joined && !seat && state.stage === 'lobby' && firstFreeChair(state)) sit();
  };

  const broadcastState = (action: Action | null, to?: PeerId): void => {
    const msg: LxState = { v: 1, t: 'lxState', peerId: self, state, action };
    t.send('act', msg, to);
  };

  /** Sequence an action here (this browser is the sequencer). */
  const sequence = (action: Action): string | null => {
    const stamped = { ...action, seq: state.seq + 1 } as Action;
    const reason = explain(state, stamped);
    if (reason) return reason;
    adopt(reduce(state, stamped), stamped);
    broadcastState(stamped);
    return null;
  };

  const submit = (action: Action): void => {
    if (isSequencer()) {
      const reason = sequence(action);
      if (reason) warn(action, reason);
      return;
    }
    const seq = sequencer();
    const msg: LxPropose = { v: 1, t: 'lxPropose', action };
    proposed.add(action.cid);
    t.send('act', msg, seq.transportId ?? undefined);
  };

  const warn = (action: Action, reason: string): void => {
    proposed.delete(action.cid);
    entries = [...entries, { kind: 'system', seq: state.seq, at: now(), level: 'warn', text: `${action.type} refused: ${reason}` }];
    notify();
  };

  const stamp = (draft: ActionDraft, by: SeatId): Action => ({ ...draft, by, cid: `${self}-${++cid}` }) as Action;

  let sitting: string | null = null;
  function sit(): void {
    const free = firstFreeChair(state);
    if (!free || (sitting && proposed.has(sitting))) return;
    const action = stamp({ type: 'seatTake', seat: free, name: nickname, colour: pickColour(state, free, opts.identity.seatColour), peer: self }, free);
    sitting = action.cid;
    submit(action);
  }

  // --- Transport ---------------------------------------------------------------------------------------------
  const presencePeers = new Map<PeerId, PeerPresence & { n: number }>();
  const presenceListeners = new Set<(peers: PeerPresence[]) => void>();
  const presenceOut = (): void => {
    const list = presenceList();
    for (const l of presenceListeners) l(list);
  };
  const presenceList = (): PeerPresence[] =>
    [...presencePeers.entries()].map(([tid, p]) => {
      const h = hellos.get(tid);
      const { n: _n, ...rest } = p;
      return { ...rest, peerId: h?.peerId ?? p.peerId, seat: h ? seatOf(state, h.peerId) : null };
    });
  const presenceOf = (tid: PeerId): PeerPresence & { n: number } => {
    let p = presencePeers.get(tid);
    if (!p) {
      p = { peerId: hellos.get(tid)?.peerId ?? '', seat: null, cursor: null, over: null, drag: [], speaking: false, typing: null, caption: null, at: now(), n: -1 };
      presencePeers.set(tid, p);
    }
    return p;
  };

  const hello = (to?: PeerId): void => {
    const msg: LxHello = { v: 1, t: 'lxHello', peerId: self, nickname, seq: state.seq };
    t.send('ctl', msg, to);
  };

  t.onPeer((event, peer) => {
    if (closed) return;
    if (event === 'join') hello(peer);
    else {
      hellos.delete(peer);
      presencePeers.delete(peer);
      presenceOut();
    }
    notify();
  });
  t.on('ctl', (msg, from) => {
    if (closed || msg.t !== 'lxHello') return;
    const h = msg as LxHello;
    const known = hellos.has(from);
    hellos.set(from, { peerId: h.peerId, nickname: h.nickname, seq: h.seq });
    if (!known) hello(from);
    if (isSequencer() && state.seq > 0) broadcastState(null, from);
    notify();
  });
  t.on('act', (msg, from) => {
    if (closed) return;
    if (msg.t === 'lxState') {
      const m = msg as LxState;
      const h = hellos.get(from);
      if (h) h.seq = m.state.seq;
      else hellos.set(from, { peerId: m.peerId, nickname: '', seq: m.state.seq });
      // Adopt the state of whoever now ranks best; an equal or better own table wins otherwise.
      if (rank({ peerId: m.peerId, seq: m.state.seq }, { peerId: self, seq: state.seq }) < 0) {
        adopt(m.state, m.action);
        // Tell everyone how far this browser is, so all agree on who sequences next.
        hello();
      }
    } else if (msg.t === 'lxPropose') {
      const action = (msg as LxPropose).action;
      if (!isSequencer()) return;
      const sender = hellos.get(from);
      // Structure only, as the sequencer does: the actor must be the sender's chair, or a free chair it sits down at.
      const holds = !!sender && state.seats[action.by]?.peer === sender.peerId;
      const sitting = action.type === 'seatTake' && action.peer === sender?.peerId && action.by === action.seat;
      const reason = !holds && !sitting ? `${action.by} is not the sender's seat` : sequence(action);
      if (reason) {
        const nack: LxNack = { v: 1, t: 'lxNack', cid: action.cid, reason };
        t.send('act', nack, from);
      }
    } else if (msg.t === 'lxNack') {
      const m = msg as LxNack;
      if (proposed.delete(m.cid)) {
        entries = [...entries, { kind: 'system', seq: state.seq, at: now(), level: 'warn', text: `refused: ${m.reason}` }];
        notify();
      }
    }
  });
  t.on('pres', (msg, from) => {
    if (closed) return;
    if (msg.t !== 'cursor' && msg.t !== 'drag') return;
    const m = msg as CursorMessage | DragMessage;
    const p = presenceOf(from);
    if (typeof m.n !== 'number' || m.n <= p.n) return;
    p.n = m.n;
    p.at = now();
    if (m.t === 'cursor') {
      p.cursor = m.at;
      p.over = m.over;
    } else p.drag = m.cards;
    presenceOut();
  });

  // --- Presence out (throttled to PRESENCE_INTERVAL_MS, the last value always goes out) -------------------------
  let n = 0;
  const pending = new Map<'cursor' | 'drag', Message>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = -Infinity;
  const flush = (): void => {
    flushTimer = null;
    lastFlush = now();
    for (const m of pending.values()) t.send('pres', m);
    pending.clear();
  };
  const queue = (kind: 'cursor' | 'drag', msg: Message): void => {
    if (closed || !joined) return;
    pending.set(kind, msg);
    if (flushTimer) return;
    const wait = Math.max(0, PRESENCE_INTERVAL_MS - (now() - lastFlush));
    flushTimer = setTimeout(flush, wait);
  };
  const presence: Presence = {
    cursor(at, over = null) {
      const msg: CursorMessage = { v: 1, t: 'cursor', n: ++n, at: at ? { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } : null, over };
      queue('cursor', msg);
    },
    drag(cards) {
      const msg: DragMessage = { v: 1, t: 'drag', n: ++n, cards: cards.map((c) => ({ id: c.id, pose: { ...c.pose } })) };
      queue('drag', msg);
    },
    speaking: () => undefined,
    typing: () => undefined,
    captionInterim: () => undefined,
    peers: () => presenceList(),
    subscribe(listener) {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },
  };

  // --- Join and sit down --------------------------------------------------------------------------------------
  await t.join(opts.roomId, opts.roomKey);
  joined = true;
  hello();
  notify();
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 500));
  if (!mySeat()) {
    if (!firstFreeChair(state)) throw new Error('This table is full.');
    sit();
  }
  await until(() => mySeat() !== null, opts.seatTimeoutMs ?? 8000, 'Could not take a chair at this table.');

  const session: LocalSession = {
    get seat() {
      return mySeat() ?? secrets.seat;
    },
    roomId: opts.roomId,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    secrets: () => secrets,
    cardData: (ref: CardRef) => opts.cardData.peek(ref.sid),
    dispatch(draft: ActionDraft): Action {
      const action = stamp(draft, session.seat);
      submit(action);
      return action;
    },
    playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
      return session.dispatch({ type: 'move', card, to, ...(pose ? { pose } : {}) });
    },
    chat(text: string, channel: ChatChannel = 'table'): Action {
      return session.dispatch({ type: 'chat', text, channel });
    },
    takeSeat(seat: SeatId, colour: SeatColourIndex): Action {
      const current = mySeat();
      const moving = current !== null && current !== seat;
      const group = `g-${self}-${cid + 1}`;
      // Take the new chair first, then leave the old one, so this browser is never without a chair in between.
      const action = stamp({ type: 'seatTake', seat, name: nickname, colour, peer: self, ...(moving ? { group } : {}) }, seat);
      submit(action);
      if (moving) submit(stamp({ type: 'seatLeave', seat: current, group }, current));
      return action;
    },
    setNickname(name: string) {
      nickname = name;
    },
    roll(_purpose: RngPurpose, _n: number): Promise<number> {
      return Promise.reject(new Error('Dice need the networked session (M1-P8).'));
    },
    presence,
    netStatus: status,
    subscribeNet(listener) {
      netListeners.add(listener);
      return () => netListeners.delete(listener);
    },
    whenSaved: () => Promise.resolve(),
    async importDeck(deck: DeckImport): Promise<void> {
      const seat = mySeat();
      if (!seat) throw new Error('Take a chair first.');
      if (state.seats[seat]?.ready) throw new Error('You are already ready.');
      const cards: RevealedCard[] = deck.main.map((ref) => ({ instanceId: randomId('c'), ref, salt: randomSalt() }));
      const ids = cards.map((c) => c.instanceId);
      const order = shuffleInPlace([...ids]);
      const identities = { ...secrets.identities };
      for (const c of cards) identities[c.instanceId] = { card: c.ref, salt: c.salt };
      secrets = { ...secrets, seat, identities, libraryOrder: order, pool: [...deck.side] };
      submit(stamp({ type: 'ready', commits: makeCommitments(cards), instanceIds: [...ids].sort(), zone: `library:${seat}` }, seat));
      await until(() => !!state.seats[seat]?.ready, 8000, 'Ready was not confirmed.');
    },
    async shuffle(): Promise<void> {
      secrets = { ...secrets, libraryOrder: shuffleInPlace([...secrets.libraryOrder]) };
    },
    async draw(count = 1): Promise<void> {
      const seat = mySeat();
      if (!seat) return;
      for (let i = 0; i < count; i++) {
        const top = secrets.libraryOrder[0];
        if (!top) break;
        secrets = { ...secrets, libraryOrder: secrets.libraryOrder.slice(1), hand: [...secrets.hand, top] };
        submit(stamp({ type: 'draw', instanceId: top }, seat));
      }
      await until(() => secrets.hand.every((id) => state.cards[id]?.zone === `hand:${seat}`), 8000, 'The draw was not confirmed.');
    },
    async mulligan(): Promise<void> {
      throw new Error('Mulligans need the networked session (M1-P8).');
    },
    async lookAt(zone: ZoneId, count: number): Promise<LookedCard[]> {
      const order = zone === `library:${mySeat()}` ? secrets.libraryOrder : [];
      return order.slice(0, count).map((id) => ({ id, ref: secrets.identities[id]!.card }));
    },
    undo: () => false,
    canUndo: () => false,
    log: () => entries,
    leave() {
      if (closed) return;
      if (flushTimer) clearTimeout(flushTimer);
      closed = true;
      t.leave();
      notify();
      listeners.clear();
      netListeners.clear();
    },
    dispose() {
      session.leave();
    },
  };
  return session;
}

/** A transport whose signalling works but which never connects to anyone (a network that blocks direct connections). */
export class SilentTransport implements Transport {
  constructor(readonly selfId: PeerId) {}
  join(): Promise<void> {
    return Promise.resolve();
  }
  leave(): void {}
  peers(): PeerId[] {
    return [];
  }
  send(): void {}
  on(): void {}
  onPeer(): void {}
}

/** A transport that never gets past the signalling relays (join never settles). */
export class UnreachableTransport extends SilentTransport {
  override join(): Promise<void> {
    return new Promise(() => undefined);
  }
}
