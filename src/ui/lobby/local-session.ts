/**
 * A stand-in networked session for dev and test builds (PLAN M1-P5: build the lobby against the M1-C contracts with
 * fakes; M1-P8 wires the real session). It implements TableSession over any Transport with the smallest protocol that
 * lets several pages share one table: the best-ranked peer (highest seq, then lowest peer id) applies proposals through
 * core's reducer and broadcasts the whole state; everyone else adopts it. Presence uses the real `pres` messages.
 *
 * It holds no secrets of other seats and sends none of its own: Ready publishes only the salted commitments and opaque
 * ids (DESIGN "Specification: network protocol and secrecy", Commitments); identities stay in this browser's secret
 * store. An own card's identity leaves it only through the design's reveal paths: a `reveal` when the card becomes
 * public (moved out of a hidden zone, cast, turned up) and a targeted reveal (`revealTo`) sent to the chosen seats'
 * peers alone. The secret store follows shared state after every applied action, and with a table store the table and
 * the secret store are saved after every change, so a reload rejoins the same chair with the same hand. The sequencing
 * browser marks a seat away when its peer has been gone for AWAY_AFTER_MS and back when it returns.
 *
 * It is not the M1-P1 engine: no gap detection, catch-up log, heartbeat, hash exchange, secret shuffle protocol,
 * commit-and-reveal randomness or logged private looks. Loaded lazily from App.svelte only when
 * `__SPELLPLANE_DEBUG__` is set and no networked session was handed in.
 */
import type { Action, ActionDraft } from '../../core/actions';
import { zoneId } from '../../core/ids';
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
import { reconcileSecrets } from '../../session/secrets';
import type { TableStore } from '../../store/types';
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
/** A targeted reveal on the pair channel: sent to the chosen seat's peer only, never broadcast. */
interface LxRevealTo extends Message {
  t: 'lxRevealTo';
  from: SeatId;
  instanceId: InstanceId;
  card: CardRef;
  salt: string;
}

/** The sequencing browser marks a seat away once its peer has been gone this long (DESIGN "Specification: network protocol and secrecy", Liveness: 6 s). */
export const AWAY_AFTER_MS = 6000;

/** Cards drawn by a London mulligan (DESIGN "Card manipulation", Library actions). */
const MULLIGAN_HAND = 7;

/** Public zone kinds that may hold a face-down card (DESIGN "Table model"); other public zones show faces. */
const FACE_DOWN_KINDS: ReadonlySet<string> = new Set(['battlefield', 'exile']);

/** The one existing card an action is about, if any. */
function referencedCard(a: Action): InstanceId | null {
  if (a.type === 'draw' || a.type === 'reveal' || a.type === 'revealTo') return a.instanceId;
  if (a.type === 'createToken' || a.type === 'copy') return null;
  if ('card' in a && typeof a.card === 'string') return a.card;
  return null;
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
  /** Saves the table and the secret store after every change, and restores them on the next visit. */
  store?: TableStore;
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
  // The own save of this room (DESIGN "Multiplayer architecture", Resume: the first browser back restores from its own
  // save; later arrivals reconcile to the highest sequence number, which `rank` below does).
  const saved = opts.store ? await opts.store.loadTable(opts.roomId).catch(() => null) : null;
  if (saved?.table.snapshot) {
    state = saved.table.snapshot;
    if (saved.secrets) secrets = saved.secrets;
  }
  let writes: Promise<void> = Promise.resolve();
  let saveQueued = false;
  const save = (): void => {
    const store = opts.store;
    if (!store || saveQueued || closed) return;
    saveQueued = true;
    writes = writes.then(async () => {
      await Promise.resolve();
      saveQueued = false;
      const seat = seatOf(state, self);
      try {
        await store.saveSnapshot({ roomId: opts.roomId, roomKey: opts.roomKey, lastSeq: state.seq, snapshot: state, snapshotSeq: state.seq, seat, stage: state.stage, updatedAt: now() }, secrets);
      } catch (e) {
        console.warn('Spellplane: the table could not be saved', e);
      }
    });
  };
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
    save();
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
    // The private hand and library order follow the zones (a card drawn, searched for, returned or mulliganed).
    if (seat) secrets = reconcileSecrets(secrets, state, action?.type === 'toZone' && action.position === 'bottom' ? 'bottom' : 'top');
    notify();
    reviewAway();
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

  // --- Away seats (sequencing browser only) ------------------------------------------------------------------
  const awayTimers = new Map<SeatId, ReturnType<typeof setTimeout>>();
  const present = (peerId: string): boolean => peerId === self || [...hellos.entries()].some(([tid, h]) => h.peerId === peerId && t.peers().includes(tid));
  function reviewAway(): void {
    if (closed || !joined || !isSequencer()) return;
    const by = mySeat();
    if (!by) return;
    for (const seat of Object.values(state.seats)) {
      if (seat.peer === undefined) continue;
      const here = present(seat.peer);
      const timer = awayTimers.get(seat.id);
      if (here) {
        if (timer) clearTimeout(timer);
        awayTimers.delete(seat.id);
        if (seat.away) sequence(stamp({ type: 'away', seat: seat.id, away: false }, by));
      } else if (!seat.away && !timer) {
        awayTimers.set(
          seat.id,
          setTimeout(() => {
            awayTimers.delete(seat.id);
            const now = state.seats[seat.id];
            const me = mySeat();
            if (closed || !isSequencer() || !me || !now?.peer || now.away || present(now.peer)) return;
            sequence(stamp({ type: 'away', seat: seat.id, away: true }, me));
          }, AWAY_AFTER_MS),
        );
      }
    }
  }

  // --- Reveals (DESIGN "Multiplayer architecture", Hidden information; "Table model", Face-down) -------------------
  /** Whether `action` moves an own face-down card into a public zone that shows faces (graveyard, stack, command). */
  const turnsUpOnMove = (action: Action): boolean => {
    if (action.type !== 'move') return false;
    const card = Object.hasOwn(state.cards, action.card) ? state.cards[action.card] : undefined;
    const dest = Object.hasOwn(state.zones, action.to) ? state.zones[action.to] : undefined;
    if (!card || !dest || card.face !== 'down' || card.zone === action.to) return false;
    if (state.zones[card.zone]?.visibility !== 'public' || dest.visibility !== 'public' || FACE_DOWN_KINDS.has(dest.kind)) return false;
    return card.identity !== undefined || card.tokenLabel !== undefined || (card.owner === secrets.seat && Object.hasOwn(secrets.identities, card.id));
  };
  /**
   * The `reveal` an action needs first: it names an own card whose identity only this browser holds, and the card
   * ends up public. Null when the action would not apply even with the reveal, so a refused action publishes nothing.
   */
  const revealFor = (action: Action, turnUp: boolean): Action | null => {
    const id = referencedCard(action);
    if (id === null || action.type === 'reveal' || action.type === 'revealTo' || (action.type === 'flip' && action.ref !== undefined)) return null;
    const card = Object.hasOwn(state.cards, id) ? state.cards[id] : undefined;
    const secret = Object.hasOwn(secrets.identities, id) ? secrets.identities[id] : undefined;
    if (!card || !secret || card.owner !== action.by || card.identity !== undefined) return null;
    const hidden = state.zones[card.zone]?.visibility !== 'public';
    const turnsUp = turnUp || (!hidden && card.face === 'down' && action.type === 'flip' && action.face === 'up');
    if (!hidden && !turnsUp) return null;
    const reveal = stamp({ type: 'reveal', instanceId: id, ref: secret.card, salt: secret.salt, ...(action.group !== undefined ? { group: action.group } : {}) }, action.by);
    const s1 = reduce(state, { ...reveal, seq: state.seq + 1 } as Action);
    if (s1 === state) return null;
    const s2 = reduce(s1, { ...action, seq: state.seq + 2 } as Action);
    if (s2 === s1) return null;
    const after = s2.cards[id];
    return after && s2.zones[after.zone]?.visibility === 'public' ? reveal : null;
  };
  /** Send an own card's identity to the peers of `seats` only (targeted reveal on the pair channel). */
  const revealToSeats = (id: InstanceId, seats: readonly SeatId[]): void => {
    const secret = Object.hasOwn(secrets.identities, id) ? secrets.identities[id] : undefined;
    const from = mySeat();
    if (!secret || !from) return;
    for (const seat of seats) {
      const peer = state.seats[seat]?.peer;
      if (!peer || seat === from) continue;
      for (const [tid, h] of hellos) {
        if (h.peerId !== peer || !t.peers().includes(tid)) continue;
        const msg: LxRevealTo = { v: 1, t: 'lxRevealTo', from, instanceId: id, card: secret.card, salt: secret.salt };
        t.send('act', msg, tid);
      }
    }
  };

  let sitting: string | null = null;
  let mulligans = 0;
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
    reviewAway();
  });
  t.on('ctl', (msg, from) => {
    if (closed || msg.t !== 'lxHello') return;
    const h = msg as LxHello;
    const known = hellos.has(from);
    hellos.set(from, { peerId: h.peerId, nickname: h.nickname, seq: h.seq });
    if (!known) hello(from);
    if (isSequencer() && state.seq > 0) broadcastState(null, from);
    notify();
    reviewAway();
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
      const reason = action.type === 'away' ? 'only the sequencer marks a seat away' : !holds && !sitting ? `${action.by} is not the sender's seat` : sequence(action);
      if (reason) {
        const nack: LxNack = { v: 1, t: 'lxNack', cid: action.cid, reason };
        t.send('act', nack, from);
      }
    } else if (msg.t === 'lxRevealTo') {
      const m = msg as LxRevealTo;
      const sender = hellos.get(from);
      // Only the owner of the card's seat may tell this browser what it is.
      if (!sender || state.seats[m.from]?.peer !== sender.peerId || state.cards[m.instanceId]?.owner !== m.from) return;
      secrets = { ...secrets, received: { ...secrets.received, [m.instanceId]: { card: m.card, salt: m.salt, from: m.from } } };
      notify();
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
    // Re-insert so the burst goes out in `n` order: the receiver drops anything older than the last `n` it saw, so a
    // drag end queued before a later cursor must not be sent after it.
    pending.delete(kind);
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
      const raw = stamp(draft, session.seat);
      // A face-down card moved into a zone that shows faces is turned up there, in one undo group with the move.
      const turnUp = turnsUpOnMove(raw);
      const action = turnUp && raw.group === undefined ? ({ ...raw, group: `g-${self}-${cid}` } as Action) : raw;
      const reveal = revealFor(action, turnUp);
      if (reveal) submit(reveal);
      submit(action);
      if (turnUp) submit(stamp({ type: 'flip', card: referencedCard(action)!, face: 'up', ...(action.group !== undefined ? { group: action.group } : {}) }, action.by));
      if (action.type === 'revealTo' && state.cards[action.instanceId]?.owner === action.by) revealToSeats(action.instanceId, action.seats);
      return action;
    },
    playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
      const action = stamp({ type: 'move', card, to, ...(pose ? { pose } : {}) }, session.seat);
      const c = Object.hasOwn(state.cards, card) ? state.cards[card] : undefined;
      const dest = Object.hasOwn(state.zones, to) ? state.zones[to] : undefined;
      if (!c || c.owner !== action.by || state.zones[c.zone]?.visibility === 'public' || dest?.visibility !== 'public' || !FACE_DOWN_KINDS.has(dest.kind)) {
        warn(action, 'only a card from your own hand or library can be put onto a battlefield or into exile face down');
        return action;
      }
      // No reveal: the reducer turns a card that leaves a hidden zone without a public identity face down.
      submit(action);
      return action;
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
    whenSaved: () => writes,
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
      const seat = mySeat();
      if (!seat) throw new Error('Take a chair first.');
      const hand = zoneId('hand', seat);
      // London mulligan: the hand goes into the library, the library is shuffled, seven are drawn.
      submit(stamp({ type: 'mulligan', count: ++mulligans }, seat));
      await until(() => (state.zones[hand]?.ids.length ?? 0) === 0, 8000, 'The mulligan was not confirmed.');
      secrets = { ...secrets, libraryOrder: shuffleInPlace([...secrets.libraryOrder]) };
      notify();
      await session.draw(MULLIGAN_HAND);
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
      for (const timer of awayTimers.values()) clearTimeout(timer);
      awayTimers.clear();
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
