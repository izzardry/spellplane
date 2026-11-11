/**
 * The network engine (DESIGN "Multiplayer architecture"; "Specification: network protocol and secrecy": Handshake,
 * Sequencing, Liveness, Sync, Timers). Contracts: M1-C (net/types.ts NetEngine). Implementer: M1-P1.
 *
 * One engine per browser and room. It owns the replica (net/sequencer.ts Replica): own actions apply optimistically
 * and are proposed to the sequencer; sequenced actions apply strictly in order; gaps are filled by catch-up. The
 * engine survives a transport that drops, delays and reorders (the simulated network of tests/sim): handshakes,
 * proposals, claims and catch-up requests are resent until answered. Pending proposals are sent and resent in the
 * order they were applied; on the design's reliable ordered `act` channel they reach the sequencer in that order.
 *
 * Timers use the global setTimeout/setInterval and the injected clock, so Vitest fake timers drive the engine.
 */
import type { Action, ActionDraft } from '../core/actions';
import { canonicalJson } from '../core/hash';
import { sha256Sync } from '../core/sha256';
import type { SeatId, TableState } from '../core/types';
import { foreignVersion, helloMatchesKey, makeBye, makeHello, makeWelcome, newNonce, welcomeIsValid } from './hello';
import {
  asWireMessage,
  PROTOCOL_VERSION,
  toMessage,
  type HelloMessage,
  type PresenceMessage,
  type PrivateMessage,
  type ProposeMessage,
  type SeqMessage,
  type SequencedAction,
  type SyncResMessage,
  type WelcomeMessage,
  type WireMessage,
  type WireOf,
} from './messages';
import { PresenceChannel } from './presence';
import { createSequencer, electSequencer, Replica, RETAIN_ACTIONS, seatOfPeer } from './sequencer';
import { CHANNELS, type Channel, type PeerId } from './transport';
import {
  AWAY_AFTER_MS,
  HASH_EVERY,
  HEARTBEAT_MS,
  SYNC_TAIL_LIMIT,
  type ConnectionStatus,
  type CreateNetEngine,
  type NetEngine,
  type NetEngineOptions,
  type NetIdentity,
  type NetMessageRecord,
  type PeerInfo,
  type Sequencer,
  type Unsubscribe,
} from './types';
import { validPayload } from './validate';

/** How often the engine checks liveness and resends what is unanswered. */
export const TICK_MS = 250;
/** An unanswered hello is resent after this long. */
export const HELLO_RETRY_MS = 1000;
/** Pending proposals are resent when the oldest has been unanswered this long. */
export const PROPOSE_RETRY_MS = 1000;
/** A claim is resent to peers that have not acknowledged it after this long. */
export const CLAIM_RETRY_MS = 1000;
/** An unanswered catch-up request is resent after this long. */
export const SYNC_RETRY_MS = 1000;
/** A gap in the sequenced stream is filled by catch-up once it has lasted this long (reordering heals most gaps). */
export const GAP_WAIT_MS = 500;
/** Sequenced actions before this replica's head that a fork check re-reads from the other copy. */
export const OVERLAP = 64;
/**
 * A catch-up request: `tail` asks for what follows this replica's head, `overlap` also re-reads the last OVERLAP
 * actions to detect a fork, `snapshot` asks for the other copy's snapshot.
 */
type SyncKind = 'tail' | 'overlap' | 'snapshot';
/** Reason of a `nack` for a proposal that was already sequenced (the proposer drops it silently). */
export const NACK_DUPLICATE = 'duplicate';

/** Wire messages the debug log keeps (a ring: the oldest are overwritten). */
const MESSAGE_LOG_LIMIT = 200_000;
/** The wire-message log feeds the debug hook and the leak tests: dev and test builds only, nothing in production. */
const RECORD_MESSAGES = __SPELLPLANE_DEBUG__;
const KEEP_HASHES = 64;
const KEEP_NACKS = 5_000;
const QUEUE_LIMIT = 2_000;
const KEEP_APPLY_TIMES = 1_000;
/** Reported seqs remembered against re-reporting after a reload (more than a reload replays: the retained tail). */
const KEEP_EMITTED = 2 * RETAIN_ACTIONS;

interface PeerEntry {
  info: PeerInfo;
  /** Our connection nonce for this peer; its welcome must sign it. */
  nonce: string;
  /** Its hello; replaced when another identity speaks on this connection. */
  hello: HelloMessage | null;
  /** Bumped whenever `hello` names a new identity, so stale async checks are ignored. */
  gen: number;
  /** The hello's peer id is the hash of its key. */
  keyOk: boolean;
  /** A welcome that arrived before the hello it answers could be checked. */
  early: WelcomeMessage | null;
  verifying: boolean;
  lastHeard: number;
  helloAt: number;
  /** Last seq this peer acknowledged for our current claim, or null. */
  claimAck: number | null;
  /** The sequencer this peer last named (its welcome, heartbeat, or itself when it claims); undefined until heard. */
  named: string | null | undefined;
  /** When we last answered this peer's claim with a counter-claim (at most one per CLAIM_RETRY_MS). */
  counterAt: number;
}

type Listener<A extends unknown[]> = (...args: A) => void;

class Emitter<A extends unknown[]> {
  private readonly set = new Set<Listener<A>>();
  add(l: Listener<A>): Unsubscribe {
    this.set.add(l);
    return () => this.set.delete(l);
  }
  emit(...args: A): void {
    for (const l of [...this.set]) l(...args);
  }
  clear(): void {
    this.set.clear();
  }
}

function trimMap<K, V>(m: Map<K, V>, limit: number): void {
  while (m.size > limit) {
    const k = m.keys().next();
    if (k.done) break;
    m.delete(k.value);
  }
}

class Engine implements NetEngine {
  readonly identity: NetIdentity;
  readonly presence: PresenceChannel;

  private readonly opts: NetEngineOptions;
  private readonly role: 'player' | 'spectator';
  private readonly now: () => number;
  private readonly replica: Replica;
  private readonly peerMap = new Map<PeerId, PeerEntry>();
  private readonly seen = new Set<string>();

  private statusValue: ConnectionStatus = 'idle';
  private joined = false;
  private closed = false;
  private versionNotice: number | null = null;
  private readonly warnedVersion = new Set<PeerId>();

  private sequencer: string | null = null;
  private mode: 'idle' | 'claiming' | 'active' = 'idle';
  /** A `seq` from the current (remote) sequencer was applied since it became the sequencer. */
  private heardSequencer = false;
  private seqr: Sequencer | null = null;
  private handoverFrom: string | null = null;
  private lastClaimAt = 0;
  private queued: { from: PeerId; msg: ProposeMessage }[] = [];
  private readonly nacked = new Map<string, string>();

  private readonly ownCids = new Set<string>();
  private readonly sentAt = new Map<string, number>();
  private cidCounter = 0;
  private readonly cidPrefix: string;

  private sync: { to: PeerId; at: number; kind: SyncKind } | null = null;
  private gapSince: number | null = null;
  /** The peer whose snapshot replaces this replica's state (a hash mismatch, or a fork too old to rewind). */
  private forced: PeerId | null = null;
  /** The peer whose history replaces this replica's after a fork; own actions of the abandoned part wait in lostOwn. */
  private adoptFrom: PeerId | null = null;
  private lostOwn: { action: Action; oldSeq: number }[] = [];
  private initialSynced = false;
  /** Compare the overlap with the sequencer's history once it sends again (after a change of sequencer). */
  private verifyNext = false;
  /** While claiming: the peer furthest ahead whose history this replica checked for a fork. */
  private claimChecked: PeerId | null = null;
  /**
   * This replica's history has been reconciled with the room: it caught up from its sequencer, completed a claim
   * that connected peers acknowledged, or verified peers name it as their sequencer. Until then its own state may
   * be a fresh seq-0 table or a stale save, so it does not elect itself against the room (see `recompute`).
   */
  private reconciled = false;
  /** An unreconciled replica yielded the role to this claimant (ahead of it, or ranking first at the same seq). */
  private yieldTo: string | null = null;

  private readonly myHashes = new Map<number, string>();
  private readonly seqrHashes = new Map<number, string>();

  private readonly applyAt = new Map<number, number>();
  private readonly deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly firedDeadlines = new Set<string>();

  private applied: { action: SequencedAction; own: boolean }[] = [];
  /** The cid reported to onSequenced at each recent seq: a snapshot reload replays actions already reported. */
  private readonly emitted = new Map<number, string>();
  private flushing = false;
  private lastView: TableState | null = null;
  private lastSeats: TableState['seats'] | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  /** The message log, a ring of MESSAGE_LOG_LIMIT records whose oldest is at `logStart`. */
  private readonly log: NetMessageRecord[] = [];
  private logStart = 0;

  private readonly stateEv = new Emitter<[TableState]>();
  private readonly sequencedEv = new Emitter<[SequencedAction, boolean]>();
  private readonly rollbackEv = new Emitter<[Action, string]>();
  private readonly systemEv = new Emitter<['info' | 'warn', string]>();
  private readonly statusEv = new Emitter<[ConnectionStatus]>();
  private readonly sequencerEv = new Emitter<[string | null, number]>();
  private readonly peersEv = new Emitter<[PeerInfo[]]>();
  private readonly privateEv = new Emitter<[PrivateMessage, { seat: SeatId | null; peerId: string }]>();

  constructor(opts: NetEngineOptions) {
    this.opts = opts;
    this.identity = opts.identity;
    this.role = opts.role ?? 'player';
    this.now = opts.now ?? (() => Date.now());
    const rnd = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    this.cidPrefix = `${opts.identity.peerId}.${rnd.toString(36)}.`;
    this.replica = new Replica(opts.game, opts.start.snapshot);
    this.replica.onApply = (a) => this.onApplied(a);
    if (opts.start.tail.length) this.replica.load(opts.start.snapshot, opts.start.tail);
    this.applied = [];
    this.lastView = this.replica.view();
    this.lastSeats = this.replica.confirmed().seats;
    this.presence = new PresenceChannel({ send: (m) => this.send('pres', m), now: this.now });
    for (const ch of CHANNELS) opts.transport.on(ch, (raw, from) => this.onRaw(ch, raw, from));
    opts.transport.onPeer((ev, peer) => {
      if (this.closed || !this.joined) return;
      if (ev === 'join') this.onTransportJoin(peer);
      else this.removePeer(peer);
    });
  }

  get selfId(): PeerId {
    return this.opts.transport.selfId;
  }

  // --- lifecycle ------------------------------------------------------------------------------------------

  async join(): Promise<void> {
    if (this.joined || this.closed) return;
    this.setStatus('joining');
    await this.opts.transport.join(this.opts.roomId, this.opts.roomKey);
    if (this.closed) {
      // leave() ran while the transport was joining; its leave may have come before the room existed.
      this.opts.transport.leave();
      return;
    }
    this.joined = true;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.hbTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    for (const p of this.opts.transport.peers()) this.onTransportJoin(p);
    this.recompute();
    this.updateStatus();
  }

  leave(): void {
    if (this.closed) return;
    if (this.joined) this.send('ctl', makeBye('leave'));
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.clearDeadlines();
    this.presence.dispose();
    this.opts.transport.leave();
    this.setStatus('closed');
  }

  status(): ConnectionStatus {
    return this.statusValue;
  }

  onStatus(l: (s: ConnectionStatus) => void): Unsubscribe {
    return this.statusEv.add(l);
  }

  // --- state ------------------------------------------------------------------------------------------------

  state(): TableState {
    return this.replica.view();
  }

  confirmedState(): TableState {
    return this.replica.confirmed();
  }

  seq(): number {
    return this.replica.seq();
  }

  seat(): SeatId | null {
    return seatOfPeer(this.replica.view(), this.identity.peerId);
  }

  /** Own actions applied optimistically and not yet sequenced (beyond the contract; tests and the debug hook). */
  pendingActions(): readonly Action[] {
    return this.replica.pending();
  }

  /** Whether this browser is the sequencer and has finished taking over (beyond the contract). */
  isSequencing(): boolean {
    return this.mode === 'active';
  }

  propose(action: Action): boolean {
    if (this.closed) return false;
    if (!this.replica.applyOwn(action)) return false;
    this.ownCids.add(action.cid);
    if (this.mode === 'active') this.sequenceOwn(action);
    else this.sendProposal(action);
    this.afterChange();
    return true;
  }

  onState(l: (s: TableState) => void): Unsubscribe {
    return this.stateEv.add(l);
  }

  onSequenced(l: (a: SequencedAction, own: boolean) => void): Unsubscribe {
    return this.sequencedEv.add(l);
  }

  onRollback(l: (a: Action, reason: string) => void): Unsubscribe {
    return this.rollbackEv.add(l);
  }

  onSystem(l: (level: 'info' | 'warn', text: string) => void): Unsubscribe {
    return this.systemEv.add(l);
  }

  sequencerId(): string | null {
    return this.sequencer;
  }

  isSequencer(): boolean {
    return this.sequencer !== null && this.sequencer === this.identity.peerId;
  }

  onSequencerChange(l: (s: string | null, fromSeq: number) => void): Unsubscribe {
    return this.sequencerEv.add(l);
  }

  peers(): PeerInfo[] {
    return [...this.peerMap.values()].map((e) => ({ ...e.info }));
  }

  onPeers(l: (p: PeerInfo[]) => void): Unsubscribe {
    return this.peersEv.add(l);
  }

  sendPrivate(seat: SeatId, msg: PrivateMessage): boolean {
    if (this.closed) return false;
    const state = this.replica.confirmed();
    for (const [t, e] of this.peerMap) {
      if (!this.verified(e)) continue;
      if (seatOfPeer(state, e.info.peerId) === seat) {
        this.send('prv', msg, t);
        return true;
      }
    }
    return false;
  }

  onPrivate(l: (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void): Unsubscribe {
    return this.privateEv.add(l);
  }

  /** Every message sent and received since join, oldest first (the latest MESSAGE_LOG_LIMIT; empty in production builds). */
  messages(): NetMessageRecord[] {
    return this.logStart === 0 ? [...this.log] : [...this.log.slice(this.logStart), ...this.log.slice(0, this.logStart)];
  }

  // --- sending ----------------------------------------------------------------------------------------------

  private send(channel: Channel, msg: WireMessage, to?: PeerId): void {
    if (this.closed && msg.t !== 'bye') return;
    this.record('out', channel, msg, to ?? '*');
    this.opts.transport.send(channel, toMessage(msg), to);
  }

  private record(dir: 'in' | 'out', channel: Channel, msg: WireMessage, peer: PeerId): void {
    if (!RECORD_MESSAGES) return;
    const rec: NetMessageRecord = { dir, channel, msg, peer, at: this.now() };
    if (this.log.length < MESSAGE_LOG_LIMIT) {
      this.log.push(rec);
      return;
    }
    this.log[this.logStart] = rec;
    this.logStart = (this.logStart + 1) % MESSAGE_LOG_LIMIT;
  }

  private system(level: 'info' | 'warn', text: string): void {
    this.systemEv.emit(level, text);
  }

  private newCid(): string {
    return `${this.cidPrefix}${++this.cidCounter}`;
  }

  // --- peers and handshake ----------------------------------------------------------------------------------

  private verified(e: PeerEntry): boolean {
    return e.info.status === 'connected' || e.info.status === 'away';
  }

  private entryOf(peerId: string | null): [PeerId, PeerEntry] | null {
    if (!peerId) return null;
    for (const pair of this.peerMap) if (pair[1].info.peerId === peerId && this.verified(pair[1])) return pair;
    return null;
  }

  private onTransportJoin(peer: PeerId): void {
    if (this.peerMap.has(peer)) return;
    const e = this.addPeer(peer);
    this.sendHello(peer, e);
  }

  private addPeer(peer: PeerId): PeerEntry {
    const e: PeerEntry = {
      info: { transportId: peer, peerId: '', nickname: '', seat: null, role: 'player', status: 'handshake', lastSeq: 0 },
      nonce: newNonce(),
      hello: null,
      gen: 0,
      keyOk: false,
      early: null,
      verifying: false,
      lastHeard: this.now(),
      helloAt: 0,
      claimAck: null,
      named: undefined,
      counterAt: -Infinity,
    };
    this.peerMap.set(peer, e);
    this.peersChanged();
    return e;
  }

  private sendHello(peer: PeerId, e: PeerEntry): void {
    e.helloAt = this.now();
    this.send('ctl', makeHello(this.identity, this.seat(), this.role, this.replica.seq(), e.nonce), peer);
  }

  private removePeer(peer: PeerId): void {
    const e = this.peerMap.get(peer);
    if (!e) return;
    this.peerMap.delete(peer);
    this.presence.forget(peer);
    if (this.sync?.to === peer) this.sync = null;
    if (this.forced === peer || this.adoptFrom === peer) {
      this.forced = null;
      this.adoptFrom = null;
      this.lostOwn = [];
    }
    if (this.claimChecked === peer) this.claimChecked = null;
    if (e.info.peerId && this.yieldTo === e.info.peerId) this.yieldTo = null;
    this.queued = this.queued.filter((q) => q.from !== peer);
    this.peersChanged();
    if (this.verified(e)) this.livenessChanged();
    this.updateStatus();
  }

  private onHello(from: PeerId, e: PeerEntry, hello: HelloMessage): void {
    // A hello means the other side is (re)doing its handshake, which needs our hello too; ours may have been lost,
    // so it goes out again, at most once per HELLO_RETRY_MS (both sides stop once verified).
    if (e.helloAt === 0 || this.now() - e.helloAt >= HELLO_RETRY_MS) this.sendHello(from, e);
    if (hello.peerId === this.identity.peerId) {
      this.send('ctl', makeBye('seatTaken', 'this identity is already at the table in another page'), from);
      this.system('warn', 'This browser identity is already at the table in another page.');
      return;
    }
    e.info.nickname = hello.nickname;
    e.info.role = hello.role;
    e.info.lastSeq = hello.lastSeq;
    if (e.hello && e.hello.peerId === hello.peerId && e.hello.pubKey === hello.pubKey) {
      e.hello = hello;
      if (e.keyOk) void this.answerHello(from, e, hello);
      if (this.verified(e)) {
        this.aheadCheck(e);
        this.maybeCatchUp();
      }
      return;
    }
    // A new identity on this connection: start over.
    const wasVerified = this.verified(e);
    e.hello = hello;
    e.gen++;
    e.keyOk = false;
    e.info.peerId = '';
    e.info.status = 'handshake';
    e.info.seat = hello.seat;
    if (wasVerified) {
      this.peersChanged();
      this.livenessChanged();
    }
    const gen = e.gen;
    void helloMatchesKey(hello).then((ok) => {
      if (this.closed || this.peerMap.get(from) !== e || e.gen !== gen) return;
      if (!ok) {
        this.send('ctl', makeBye('badSignature', 'peer id does not match the public key'), from);
        this.system('warn', `A peer (${hello.nickname || hello.peerId}) sent a hello whose id does not match its key; ignored.`);
        return;
      }
      e.keyOk = true;
      void this.answerHello(from, e, hello);
      const early = e.early;
      e.early = null;
      if (early) this.onWelcome(from, e, early);
    });
  }

  private async answerHello(from: PeerId, e: PeerEntry, hello: HelloMessage): Promise<void> {
    const welcome = await makeWelcome(this.identity, this.opts.roomId, hello, this.sequencer, this.replica.seq(), { self: this.selfId, peer: from });
    if (this.closed || this.peerMap.get(from) !== e) return;
    this.send('ctl', welcome, from);
  }

  private onWelcome(from: PeerId, e: PeerEntry, w: WelcomeMessage): void {
    if (!e.hello || !e.keyOk) {
      e.early = w;
      return;
    }
    if (this.verified(e)) {
      e.info.lastSeq = Math.max(e.info.lastSeq, w.seq);
      this.noteNamed(e, w.sequencer);
      this.recompute();
      this.maybeCatchUp();
      return;
    }
    if (e.verifying) return;
    e.verifying = true;
    const gen = e.gen;
    const hello = e.hello;
    void welcomeIsValid(this.opts.roomId, hello, e.nonce, w, { self: this.selfId, peer: from }).then((ok) => {
      e.verifying = false;
      if (this.closed || this.peerMap.get(from) !== e || e.gen !== gen || this.verified(e)) return;
      if (!ok) {
        this.send('ctl', makeBye('badSignature', 'welcome signature does not verify'), from);
        this.system('warn', `A peer (${hello.nickname || hello.peerId}) failed the handshake signature check; ignored.`);
        return;
      }
      // The same identity is still live on another connection: keep that one. This connection stays in the handshake
      // and is checked again with its next welcome (our hellos are resent every HELLO_RETRY_MS), so a reload whose old
      // connection was not reported gone verifies once that one is away.
      if (this.liveTwin(from, hello.peerId)) return;
      this.onVerified(from, e, hello, w);
    });
  }

  /** Another connection verified as `peerId` that the transport still lists and that was heard within AWAY_AFTER_MS. */
  private liveTwin(from: PeerId, peerId: string): boolean {
    const now = this.now();
    const listed = this.opts.transport.peers();
    for (const [t, other] of this.peerMap) {
      if (t === from || other.info.peerId !== peerId || other.info.status !== 'connected') continue;
      if (listed.includes(t) && now - other.lastHeard <= AWAY_AFTER_MS) return true;
    }
    return false;
  }

  private onVerified(from: PeerId, e: PeerEntry, hello: HelloMessage, w: WelcomeMessage): void {
    // The same identity on another connection that is gone or away (liveTwin) is a reload or reconnect: the newer
    // connection replaces it.
    for (const [t, other] of [...this.peerMap]) if (t !== from && other.info.peerId === hello.peerId) this.removePeer(t);
    e.info.peerId = hello.peerId;
    e.info.status = 'connected';
    e.info.lastSeq = Math.max(hello.lastSeq, w.seq);
    e.info.seat = seatOfPeer(this.replica.confirmed(), hello.peerId) ?? hello.seat;
    e.lastHeard = this.now();
    this.noteNamed(e, w.sequencer);
    this.seen.add(hello.peerId);
    this.peersChanged();
    this.livenessChanged();
    this.aheadCheck(e);
    if (this.sequencer === hello.peerId) this.resendPending();
    if (this.mode === 'claiming') {
      e.claimAck = null;
      this.send('ctl', { v: PROTOCOL_VERSION, t: 'claim', fromSeq: this.replica.seq(), seat: this.seat() ?? '' }, from);
    }
    this.maybeCatchUp();
    this.updateStatus();
  }

  private onBye(from: PeerId, e: PeerEntry, m: WireOf<'bye'>): void {
    if (m.reason === 'version') {
      this.onForeignVersion(from, m.version, false);
      return;
    }
    if (m.reason === 'seatTaken') this.system('warn', 'This browser identity is already at the table in another page.');
    if (m.reason === 'badSignature' && this.verified(e)) return;
    this.removePeer(from);
  }

  private onForeignVersion(from: PeerId, version: number, answer: boolean): void {
    if (answer) this.send('ctl', makeBye('version'), from);
    this.versionNotice = version;
    if (!this.warnedVersion.has(from)) {
      this.warnedVersion.add(from);
      this.system('warn', `A peer runs Spellplane protocol version ${version}; this page runs version ${PROTOCOL_VERSION}. Both need the same version: reload the page.`);
    }
    this.updateStatus();
  }

  private peerInfos(): PeerInfo[] {
    return [...this.peerMap.values()].map((e) => e.info);
  }

  private peersChanged(): void {
    const state = this.replica.confirmed();
    for (const [t, e] of this.peerMap) {
      if (!e.info.peerId) continue;
      const seat = seatOfPeer(state, e.info.peerId);
      if (seat !== null) e.info.seat = seat;
      this.presence.relabel(t, e.info.peerId, e.info.seat);
    }
    this.peersEv.emit(this.peers());
  }

  /** Connectivity changed: re-elect, finish a claim, mark seats away or back. */
  private livenessChanged(): void {
    this.recompute();
    if (this.mode === 'claiming') this.checkClaim();
    this.syncAwaySeats();
  }

  // --- receiving --------------------------------------------------------------------------------------------

  private onRaw(channel: Channel, raw: unknown, from: PeerId): void {
    if (this.closed || !this.joined) return;
    const foreign = foreignVersion(raw);
    if (foreign !== null) {
      const isHello = typeof raw === 'object' && raw !== null && (raw as { t?: unknown }).t === 'hello';
      this.onForeignVersion(from, foreign, isHello);
      return;
    }
    const msg = asWireMessage(channel, raw);
    if (!msg || !validPayload(msg)) return;
    this.record('in', channel, msg, from);
    let e = this.peerMap.get(from);
    if (!e) {
      // A peer we do not know (yet, or any more) speaks to us: start the handshake. Our hello makes it answer, so
      // a peer that still counts us as verified after we dropped it is not ignored for ever. A late message from a
      // connection the transport already reported gone is ignored.
      if (msg.t !== 'hello' && !this.opts.transport.peers().includes(from)) return;
      e = this.addPeer(from);
      this.sendHello(from, e);
      if (msg.t !== 'hello') return;
    }
    e.lastHeard = this.now();
    if (e.info.status === 'away') {
      e.info.status = 'connected';
      this.peersChanged();
      this.livenessChanged();
      // The peer may have gone on without us (we were the one cut off): learn every head before sequencing more.
      if (this.mode === 'active') this.startClaim(null);
      this.updateStatus();
    }
    switch (msg.t) {
      case 'hello':
        return this.onHello(from, e, msg);
      case 'welcome':
        return this.onWelcome(from, e, msg);
      case 'bye':
        return this.onBye(from, e, msg);
    }
    if (!this.verified(e)) return;
    switch (msg.t) {
      case 'syncReq':
        return this.onSyncReq(from, msg.haveSeq);
      case 'syncRes':
        return this.onSyncRes(from, e, msg);
      case 'hb':
        e.info.lastSeq = msg.seq;
        this.noteNamed(e, msg.sequencer);
        if (!this.reconciled) this.recompute();
        this.aheadCheck(e);
        this.maybeCatchUp();
        return;
      case 'claim':
        return this.onClaim(from, e, msg);
      case 'claimAck':
        e.info.lastSeq = msg.lastSeq;
        if (this.mode === 'claiming') {
          e.claimAck = msg.lastSeq;
          this.checkClaim();
        } else {
          this.aheadCheck(e);
          this.maybeCatchUp();
        }
        return;
      case 'hash':
        return this.onHash(e, msg.seq, msg.h);
      case 'propose':
        return this.onPropose(from, msg);
      case 'seq':
        return this.onSeq(from, e, msg);
      case 'nack':
        return this.onNack(e, msg.cid, msg.reason);
      case 'reveal':
      case 'pack':
      case 'teamHand':
      case 'nonce':
      case 'lookReq':
      case 'look':
        this.privateEv.emit(msg, { seat: seatOfPeer(this.replica.confirmed(), e.info.peerId), peerId: e.info.peerId });
        return;
      case 'cursor':
      case 'drag':
      case 'speaking':
      case 'typing':
      case 'captionInterim':
        this.presence.receive(from, { peerId: e.info.peerId, seat: seatOfPeer(this.replica.confirmed(), e.info.peerId) }, msg as PresenceMessage);
        return;
    }
  }

  // --- election and handover --------------------------------------------------------------------------------

  private recompute(): void {
    if (this.closed) return;
    const me = this.identity.peerId;
    const state = this.replica.confirmed();
    let next = electSequencer(state, { peerId: me, seat: seatOfPeer(state, me), role: this.role }, this.peerInfos());
    if (next === me && !this.reconciled) next = this.deferTo() ?? me;
    if (next === this.sequencer) {
      if (next === me && this.mode === 'idle') this.startClaim(null);
      return;
    }
    const prev = this.sequencer;
    this.sequencer = next;
    // Out-of-order arrivals from the former sequencer were applied by nobody who acknowledged the new one; the new
    // sequencer may give those seqs to other actions, so they are dropped and fetched again in order.
    this.replica.clearBuffer();
    this.gapSince = null;
    this.verifyNext = next !== null && next !== me;
    // Hashes the former sequencer sent may describe a history the new one does not continue.
    this.seqrHashes.clear();
    if (next === me) {
      this.startClaim(prev);
    } else {
      this.stepDown();
      if (next !== null) this.resendPending();
    }
    // This browser announces itself once it has taken over (activate), with the seq it continues from.
    if (next !== me) this.announce(next);
    // A handover from a remote sequencer is logged; settling on a sequencer when peers first meet is not. It was a
    // handover when the former one really sequenced for this browser (a `seq` came from it) or is gone (away, left):
    // a joiner that verified a higher seat before the lowest one merely settles.
    const former = prev !== null && prev !== me ? this.entryOf(prev) : null;
    const handedOver = prev !== null && prev !== me && (this.heardSequencer || !former || former[1].info.status !== 'connected');
    this.heardSequencer = false;
    if (handedOver && next !== null) this.system('info', next === me ? 'This browser now sequences the table.' : 'Another browser now sequences the table.');
    this.updateStatus();
  }

  /**
   * Whom an unreconciled replica follows instead of electing itself (DESIGN "Multiplayer architecture", Resume: later
   * arrivals reconcile to the copy with the highest sequence number; decision M1-C: a fresh joiner's seq-0 table may
   * differ from the room's). Its own state may seat nobody or another chair holder, so its rule 1 is not the room's:
   * it follows a claimant it yielded to, else the sequencer that the verified peer furthest ahead of it names (or that
   * peer itself when it names nobody it can reach), and catches up from there before it elects. Null: elect freely.
   */
  private deferTo(): string | null {
    const me = this.identity.peerId;
    const usable = (peerId: string | null | undefined): boolean => {
      const pair = peerId ? this.entryOf(peerId) : null;
      return !!pair && pair[1].info.status === 'connected';
    };
    if (this.yieldTo !== null && usable(this.yieldTo)) return this.yieldTo;
    const seq = this.replica.seq();
    let lead: PeerEntry | null = null;
    for (const [, e] of this.connectedPeers()) {
      if (e.info.lastSeq <= seq) continue;
      if (!lead || e.info.lastSeq > lead.info.lastSeq || (e.info.lastSeq === lead.info.lastSeq && e.info.peerId < lead.info.peerId)) lead = e;
    }
    if (!lead || lead.named === me) return null;
    return usable(lead.named) ? lead.named! : lead.info.peerId;
  }

  /** Record the sequencer a verified peer names; a peer that names this browser while it sequences reconciles it. */
  private noteNamed(e: PeerEntry, named: string | null): void {
    e.named = named;
    if (named === this.identity.peerId && this.mode === 'active') this.markReconciled();
  }

  private markReconciled(): void {
    if (this.reconciled) return;
    this.reconciled = true;
    this.yieldTo = null;
    // Elect again from the reconciled state (deferred: this can run inside the replica's apply loop or a claim).
    queueMicrotask(() => {
      if (this.closed) return;
      this.recompute();
      this.maybeCatchUp();
      this.updateStatus();
    });
  }

  /**
   * Whether a claim (`fromSeq`, `seat`) from `claimant` outranks this browser's own claim, for an unreconciled replica:
   * the one further ahead wins; at the same seq, the lowest seat index (DESIGN Liveness: two claimants resolve by
   * lowest seat index), a seated claimant before an unseated one, then the lower peer id.
   */
  private outranks(claimant: string, fromSeq: number, seat: SeatId | ''): boolean {
    const seq = this.replica.seq();
    if (fromSeq !== seq) return fromSeq > seq;
    const state = this.replica.confirmed();
    const index = (s: SeatId | '' | null): number => (s ? (state.seats[s]?.index ?? Number(/^s(\d+)$/.exec(s)?.[1] ?? Infinity)) : Infinity);
    const theirs = index(seat);
    const mine = index(seatOfPeer(state, this.identity.peerId));
    if (theirs !== mine) return theirs < mine;
    return claimant < this.identity.peerId;
  }

  private stepDown(): void {
    this.mode = 'idle';
    this.seqr = null;
    this.queued = [];
    this.clearDeadlines();
  }

  /**
   * An active sequencer that meets a peer further ahead (it came back to a table that went on without it) stops
   * sequencing and claims again, so it continues from the history the others acknowledged.
   */
  private aheadCheck(e: PeerEntry): void {
    if (this.mode === 'active' && e.info.status === 'connected' && e.info.lastSeq > this.replica.seq()) this.startClaim(null);
  }

  private connectedPeers(): [PeerId, PeerEntry][] {
    return [...this.peerMap].filter(([, e]) => e.info.status === 'connected');
  }

  private startClaim(prev: string | null): void {
    this.mode = 'claiming';
    this.seqr = null;
    this.clearDeadlines();
    if (prev !== null && prev !== this.identity.peerId) this.handoverFrom = prev;
    for (const [, e] of this.peerMap) e.claimAck = null;
    this.claimChecked = null;
    this.lastClaimAt = this.now();
    if (this.connectedPeers().length) this.send('ctl', { v: PROTOCOL_VERSION, t: 'claim', fromSeq: this.replica.seq(), seat: this.seat() ?? '' });
    this.checkClaim();
  }

  /**
   * The claim completes once every connected peer reported its last seq (claimAck) and this replica took over the
   * history of the one furthest ahead: it re-reads that peer's last actions to detect a fork (a former sequencer's
   * actions nobody else received are not acknowledged and give way), then catches up to its head.
   */
  private checkClaim(): void {
    if (this.mode !== 'claiming') return;
    let best: [PeerId, PeerEntry] | null = null;
    for (const pair of this.connectedPeers()) {
      const ack = pair[1].claimAck;
      if (ack === null) return this.updateStatus();
      const b = best?.[1];
      if (!b || ack > (b.claimAck ?? 0) || (ack === b.claimAck && pair[1].info.peerId < b.info.peerId)) best = pair;
    }
    if (!best) return this.activate();
    const [to, e] = best;
    if (this.claimChecked !== to) {
      if (!this.sync) this.requestSync(to, 'overlap');
      return this.updateStatus();
    }
    if ((e.claimAck ?? 0) > this.replica.seq()) {
      if (!this.sync) this.requestSync(to, 'tail');
      return this.updateStatus();
    }
    this.activate();
  }

  private activate(): void {
    this.mode = 'active';
    // Connected peers acknowledged the claim and this replica took over the history of the one furthest ahead.
    if (this.connectedPeers().length > 0) this.markReconciled();
    this.seqr = createSequencer(this.replica.seq());
    const prev = this.handoverFrom;
    this.handoverFrom = null;
    const seat = seatOfPeer(this.replica.confirmed(), this.identity.peerId);
    if (prev !== null && seat !== null) {
      // A logged handover record (DESIGN "Data model and protocol", Meta: sequencerClaim).
      const claim: Action = { type: 'sequencerClaim', fromSeq: this.replica.seq(), peer: this.identity.peerId, by: seat, cid: this.newCid() };
      this.ownCids.add(claim.cid);
      this.replica.requeue([claim]);
    }
    for (const a of [...this.replica.pending()]) if (this.mode === 'active') this.sequenceOwn(a);
    const queued = this.queued;
    this.queued = [];
    for (const q of queued) this.onPropose(q.from, q.msg);
    this.heartbeat();
    this.announce(this.identity.peerId);
    this.syncAwaySeats();
    this.afterChange();
    this.updateStatus();
  }

  private announced: string | null | undefined = undefined;

  /** onSequencerChange, once per change of sequencer. */
  private announce(sequencer: string | null): void {
    if (sequencer === this.announced) return;
    this.announced = sequencer;
    this.sequencerEv.emit(sequencer, this.replica.seq());
  }

  private onClaim(from: PeerId, e: PeerEntry, m: WireOf<'claim'>): void {
    // A claimant names itself, and holds at least the history it claims from.
    e.info.lastSeq = Math.max(e.info.lastSeq, m.fromSeq);
    e.named = e.info.peerId;
    this.recompute();
    if (this.sequencer === this.identity.peerId && !this.reconciled && this.outranks(e.info.peerId, m.fromSeq, m.seat)) {
      // Our claim rests on a state the room has not confirmed, and theirs ranks first: follow them and catch up.
      this.yieldTo = e.info.peerId;
      this.recompute();
    }
    if (this.sequencer === e.info.peerId) {
      this.send('ctl', { v: PROTOCOL_VERSION, t: 'claimAck', lastSeq: this.replica.seq() }, from);
      this.resendPending();
      if (m.fromSeq > this.replica.seq()) this.maybeCatchUp();
    } else if (this.sequencer === this.identity.peerId) {
      // Two claimants: the lower seat index wins; tell the other one, at most once per CLAIM_RETRY_MS, so two engines
      // whose states disagree cannot bounce claims back and forth.
      const now = this.now();
      if (now - e.counterAt < CLAIM_RETRY_MS) return;
      e.counterAt = now;
      this.send('ctl', { v: PROTOCOL_VERSION, t: 'claim', fromSeq: this.replica.seq(), seat: this.seat() ?? '' }, from);
    }
  }

  // --- proposing and sequencing -----------------------------------------------------------------------------

  private sendProposal(action: Action): void {
    const target = this.entryOf(this.sequencer);
    if (!target || this.sequencer === this.identity.peerId) return;
    this.sentAt.set(action.cid, this.now());
    this.send('act', { v: PROTOCOL_VERSION, t: 'propose', cid: action.cid, action }, target[0]);
  }

  private resendPending(): void {
    if (this.mode === 'active') return;
    for (const a of [...this.replica.pending()]) this.sendProposal(a);
  }

  private senderPeerCheck(action: Action, peerId: string): string | null {
    if (action.type === 'seatTake' && action.peer !== peerId) return 'a seat is taken with the taker’s own peer id';
    return null;
  }

  private sequenceOwn(action: Action): void {
    if (!this.seqr) return;
    const state = this.replica.confirmed();
    const me = this.identity.peerId;
    const bad = this.senderPeerCheck(action, me);
    const r = bad !== null ? { ok: false as const, reason: bad } : this.seqr.sequence(state, action, { seat: seatOfPeer(state, me), role: this.role, self: true });
    if (r.ok) {
      this.broadcastSeq(r.action);
      this.replica.receive(r.action);
    } else {
      const a = this.replica.reject(action.cid);
      if (a) this.rollbackEv.emit(a, r.reason);
    }
  }

  private broadcastSeq(a: SequencedAction): void {
    this.send('act', { v: PROTOCOL_VERSION, t: 'seq', seq: a.seq, cid: a.cid, action: a });
  }

  private onPropose(from: PeerId, msg: ProposeMessage): void {
    if (this.mode === 'claiming') {
      if (this.queued.length < QUEUE_LIMIT && !this.queued.some((q) => q.msg.cid === msg.cid)) this.queued.push({ from, msg });
      return;
    }
    if (this.mode !== 'active' || !this.seqr) return;
    const e = this.peerMap.get(from);
    if (!e || !this.verified(e)) return;
    const cid = msg.cid;
    const done = this.replica.seqOf(cid);
    if (done !== undefined) {
      const a = this.replica.at(done);
      if (a) this.send('act', { v: PROTOCOL_VERSION, t: 'seq', seq: a.seq, cid: a.cid, action: a }, from);
      else this.send('act', { v: PROTOCOL_VERSION, t: 'nack', cid, reason: NACK_DUPLICATE }, from);
      return;
    }
    const refused = this.nacked.get(cid);
    if (refused !== undefined) {
      this.send('act', { v: PROTOCOL_VERSION, t: 'nack', cid, reason: refused }, from);
      return;
    }
    const state = this.replica.confirmed();
    const peerId = e.info.peerId;
    const bad = this.senderPeerCheck(msg.action, peerId);
    const r = bad !== null ? { ok: false as const, reason: bad } : this.seqr.sequence(state, msg.action, { seat: seatOfPeer(state, peerId), role: e.info.role, self: false });
    if (r.ok) {
      this.broadcastSeq(r.action);
      this.replica.receive(r.action);
    } else {
      this.nacked.set(cid, r.reason);
      trimMap(this.nacked, KEEP_NACKS);
      this.send('act', { v: PROTOCOL_VERSION, t: 'nack', cid, reason: r.reason }, from);
    }
    this.afterChange();
  }

  private onSeq(from: PeerId, e: PeerEntry, m: SeqMessage): void {
    // Only the current sequencer's stamps count: a former sequencer's late messages may carry seqs the new one
    // has since given to other actions (catch-up from other peers goes through syncReq/syncRes).
    if (e.info.peerId !== this.sequencer || this.mode === 'active') return;
    const a = m.action;
    const mine = this.replica.at(a.seq);
    if (a.seq <= this.replica.seq() && mine && mine.cid !== a.cid) {
      // Another history at this seq. The sequencer's wins (DESIGN: every peer applies the sequencer's order).
      this.adopt(from, a.seq, `history diverged at seq ${a.seq}`);
      return;
    }
    this.replica.receive(a);
    this.heardSequencer = true;
    if (this.replica.gap() !== null && this.gapSince === null) this.gapSince = this.now();
    // The sequencer sends, so it has taken over: check once that this replica's recent history is its history.
    if (this.verifyNext && !this.sync) {
      this.verifyNext = false;
      this.requestSync(from, 'overlap');
    }
    this.afterChange();
  }

  private onNack(e: PeerEntry, cid: string, reason: string): void {
    if (e.info.peerId !== this.sequencer) return;
    const a = this.replica.reject(cid);
    this.sentAt.delete(cid);
    if (a && reason !== NACK_DUPLICATE) this.rollbackEv.emit(a, reason);
    this.afterChange();
  }

  // --- catch-up and consistency -----------------------------------------------------------------------------

  private requestSync(to: PeerId, kind: SyncKind): void {
    const seq = this.replica.seq();
    const theirs = this.peerMap.get(to)?.info.lastSeq ?? seq;
    const haveSeq = kind === 'snapshot' || seq === 0 ? 0 : kind === 'overlap' ? Math.max(1, Math.min(seq, theirs) - OVERLAP) : seq;
    this.sync = { to, at: this.now(), kind: haveSeq === 0 ? 'snapshot' : kind };
    this.send('ctl', { v: PROTOCOL_VERSION, t: 'syncReq', haveSeq }, to);
    this.updateStatus();
  }

  /** Ask the sequencer (or the peer furthest ahead) for what this replica lacks. */
  private maybeCatchUp(): void {
    if (this.closed) return;
    const gap = this.replica.gap() !== null;
    if (!gap) this.gapSince = null;
    else if (this.gapSince === null) this.gapSince = this.now();
    if (this.sync || this.mode === 'claiming') return;
    const seq = this.replica.seq();
    const me = this.identity.peerId;
    const seqEntry = this.sequencer !== me ? this.entryOf(this.sequencer) : null;
    if (seqEntry && !this.initialSynced) return this.requestSync(seqEntry[0], 'tail');
    // A gap may be plain reordering: give the missing seq a moment to arrive before asking.
    if (seqEntry && gap && this.now() - (this.gapSince ?? 0) >= GAP_WAIT_MS) return this.requestSync(seqEntry[0], 'tail');
    if (seqEntry && seqEntry[1].info.lastSeq > seq) return this.requestSync(seqEntry[0], 'tail');
    let best: [PeerId, PeerEntry] | null = null;
    for (const pair of this.peerMap) {
      const e = pair[1];
      if (e.info.status !== 'connected' || e.info.lastSeq <= seq) continue;
      if (!best || e.info.lastSeq > best[1].info.lastSeq) best = pair;
    }
    if (best) this.requestSync(best[0], 'tail');
  }

  private onSyncReq(from: PeerId, haveSeq: number): void {
    const seq = this.replica.seq();
    let res: SyncResMessage;
    const tail = haveSeq === 0 || seq - haveSeq > SYNC_TAIL_LIMIT ? null : this.replica.tail(haveSeq);
    if (tail !== null) {
      res = { v: PROTOCOL_VERSION, t: 'syncRes', snapshot: null, tail };
    } else {
      const s = this.replica.syncSnapshot();
      res = { v: PROTOCOL_VERSION, t: 'syncRes', snapshot: s.snapshot, tail: s.tail };
    }
    this.send('ctl', res, from);
  }

  private onSyncRes(from: PeerId, e: PeerEntry, m: SyncResMessage): void {
    const asked = this.sync?.to === from ? this.sync : null;
    if (asked) this.sync = null;
    const fromSequencer = e.info.peerId === this.sequencer && this.mode !== 'active' && this.mode !== 'claiming';
    // A claimant takes over the history of the peer it asked; a follower that of its sequencer.
    const authoritative = fromSequencer || (this.mode === 'claiming' && asked !== null);
    if (fromSequencer) {
      this.initialSynced = true;
      this.markReconciled();
    }
    const adopting = this.adoptFrom === from;
    const seq = this.replica.seq();
    if (m.snapshot) {
      const forced = this.forced === from;
      const fresh = asked?.kind === 'snapshot' && seq === 0 && authoritative;
      if (forced || fresh || m.snapshot.seq > seq) {
        this.replica.clearBuffer();
        this.replica.load(m.snapshot, m.tail);
        this.myHashes.clear();
        this.forced = null;
        // Own actions of an abandoned history after the snapshot that its tail does not hold are proposed again;
        // older ones may be inside the snapshot, where their cids cannot be told apart, so they are not.
        if (forced || adopting) this.requeueLost((x) => x.oldSeq > m.snapshot!.seq);
        if (this.mode === 'claiming' && asked) this.claimChecked = from;
        this.afterChange();
        this.checkClaim();
        this.maybeCatchUp();
        this.updateStatus();
        return;
      }
    }
    if (this.forced === from) {
      // Asked for a snapshot and got none to load; ask again.
      this.requestSync(from, 'snapshot');
      return;
    }
    for (const a of m.tail) {
      const mine = a.seq <= this.replica.seq() ? this.replica.at(a.seq) : undefined;
      if (mine && mine.cid !== a.cid) {
        if (authoritative) return this.adopt(from, a.seq, `history diverged at seq ${a.seq}`);
        // Another peer's diverging copy: none of it is taken.
        break;
      }
      this.replica.receive(a);
    }
    if (adopting) this.requeueLost(() => true);
    if (this.mode === 'claiming' && asked && (asked.kind === 'overlap' || adopting)) this.claimChecked = from;
    this.afterChange();
    this.checkClaim();
    this.maybeCatchUp();
    this.updateStatus();
  }

  /**
   * A fork: this replica's history from `forkSeq` on differs from that of `to` (the sequencer, or the peer a
   * claimant takes over from). Rewind to the fork point and fetch their history from there; if the fork is too old
   * to rewind, load their snapshot. Own actions of the abandoned part that their history lacks are proposed again
   * (DESIGN: no acknowledged action is lost; the abandoned part was acknowledged by no one else).
   */
  private adopt(to: PeerId, forkSeq: number, why: string): void {
    if (this.mode === 'active' || !this.peerMap.has(to) || this.adoptFrom === to || this.forced === to) return;
    this.system('warn', `${why}: taking over the sequencer's history from there.`);
    const abandoned = this.replica.tail(forkSeq - 1) ?? [];
    this.lostOwn = abandoned.filter((a) => this.ownCids.has(a.cid)).map(({ seq, ...rest }) => ({ action: rest as Action, oldSeq: seq }));
    this.adoptFrom = to;
    // Own hashes from the fork point on describe the abandoned history: the sequencer's hash of such a seq may arrive
    // before this replica re-applies it from the adopted history, and must not be compared with them.
    for (const seq of [...this.myHashes.keys()]) if (seq >= forkSeq) this.myHashes.delete(seq);
    if (this.replica.rewind(forkSeq - 1) !== null) {
      this.requestSync(to, 'tail');
    } else {
      this.replica.forget(forkSeq);
      this.forced = to;
      this.requestSync(to, 'snapshot');
    }
    this.afterChange();
  }

  /** After adopting another history: propose again the abandoned own actions it lacks (and `keep` allows). */
  private requeueLost(keep: (x: { action: Action; oldSeq: number }) => boolean): void {
    const lost = this.lostOwn.filter((x) => keep(x) && this.replica.seqOf(x.action.cid) === undefined).map((x) => x.action);
    this.lostOwn = [];
    this.adoptFrom = null;
    this.replica.requeue(lost);
    this.resendPending();
  }

  /** A state-hash mismatch (DESIGN "Data model and protocol", Consistency check): reload the sequencer's snapshot. */
  private resyncState(to: PeerId, why: string): void {
    if (this.mode === 'active' || !this.peerMap.has(to) || this.forced === to) return;
    this.system('warn', `${why}: resyncing from the sequencer's snapshot.`);
    this.forced = to;
    this.replica.clearBuffer();
    this.requestSync(to, 'snapshot');
  }

  private onApplied(a: SequencedAction): void {
    const now = this.now();
    this.applyAt.set(a.seq, now);
    trimMap(this.applyAt, KEEP_APPLY_TIMES);
    this.sentAt.delete(a.cid);
    this.applied.push({ action: a, own: this.ownCids.has(a.cid) });
    if (a.seq % HASH_EVERY === 0) {
      const h = sha256Sync(canonicalJson(this.replica.confirmed()));
      this.myHashes.set(a.seq, h);
      trimMap(this.myHashes, KEEP_HASHES);
      if (this.joined && !this.closed) this.send('ctl', { v: PROTOCOL_VERSION, t: 'hash', seq: a.seq, h });
      this.compareHash(a.seq);
    }
  }

  private onHash(e: PeerEntry, seq: number, h: string): void {
    if (e.info.peerId !== this.sequencer || this.mode === 'active') return;
    this.seqrHashes.set(seq, h);
    trimMap(this.seqrHashes, KEEP_HASHES);
    this.compareHash(seq);
  }

  private compareHash(seq: number): void {
    const mine = this.myHashes.get(seq);
    const theirs = this.seqrHashes.get(seq);
    if (mine === undefined || theirs === undefined || this.mode === 'active') return;
    this.seqrHashes.delete(seq);
    if (mine === theirs) return;
    // Deferred: compareHash can run inside the replica's apply loop.
    queueMicrotask(() => {
      const target = this.entryOf(this.sequencer);
      if (target) this.resyncState(target[0], `State hash mismatch at seq ${seq} (a reducer bug)`);
    });
  }

  // --- after every change -----------------------------------------------------------------------------------

  private afterChange(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.applied.length) {
        const batch = this.applied;
        this.applied = [];
        for (const { action, own } of batch) {
          if (this.emitted.get(action.seq) === action.cid) continue;
          this.emitted.delete(action.seq);
          this.emitted.set(action.seq, action.cid);
          trimMap(this.emitted, KEEP_EMITTED);
          this.sequencedEv.emit(action, own);
        }
      }
      const seats = this.replica.confirmed().seats;
      if (seats !== this.lastSeats) {
        this.lastSeats = seats;
        this.peersChanged();
        this.recompute();
        this.syncAwaySeats();
      }
      if (this.mode === 'active') this.armDeadlines();
      const view = this.replica.view();
      if (view !== this.lastView) {
        this.lastView = view;
        this.stateEv.emit(view);
      }
    } finally {
      this.flushing = false;
    }
    if (this.applied.length) this.afterChange();
    else this.updateStatus();
  }

  // --- timers -----------------------------------------------------------------------------------------------

  private heartbeat(): void {
    if (this.closed || !this.joined) return;
    this.send('ctl', { v: PROTOCOL_VERSION, t: 'hb', seq: this.replica.seq(), sequencer: this.sequencer });
  }

  private tick(): void {
    if (this.closed) return;
    const now = this.now();
    let changed = false;
    for (const [t, e] of this.peerMap) {
      if (e.info.status === 'handshake') {
        // A connection that never completes its handshake and that the transport no longer lists is dropped.
        if (now - e.lastHeard > 2 * AWAY_AFTER_MS && !this.opts.transport.peers().includes(t)) this.removePeer(t);
        else if (now - e.helloAt >= HELLO_RETRY_MS) this.sendHello(t, e);
      } else if (e.info.status === 'connected' && now - e.lastHeard > AWAY_AFTER_MS) {
        e.info.status = 'away';
        this.presence.forget(t);
        changed = true;
      }
    }
    if (changed) {
      this.peersChanged();
      this.livenessChanged();
      this.updateStatus();
    }
    if (this.mode !== 'active' && this.sequencer !== null && this.sequencer !== this.identity.peerId) {
      const pending = this.replica.pending();
      const oldest = pending.length ? Math.min(...pending.map((a) => this.sentAt.get(a.cid) ?? -Infinity)) : Infinity;
      if (now - oldest >= PROPOSE_RETRY_MS) this.resendPending();
    }
    if (this.mode === 'claiming' && now - this.lastClaimAt >= CLAIM_RETRY_MS) {
      this.lastClaimAt = now;
      for (const [t, e] of this.connectedPeers()) {
        if (e.claimAck === null) this.send('ctl', { v: PROTOCOL_VERSION, t: 'claim', fromSeq: this.replica.seq(), seat: this.seat() ?? '' }, t);
      }
      this.checkClaim();
    }
    if (this.sync && now - this.sync.at >= SYNC_RETRY_MS) {
      const again = this.sync;
      this.sync = null;
      if (this.forced !== null && this.peerMap.has(this.forced)) this.requestSync(this.forced, 'snapshot');
      else if (this.adoptFrom !== null && this.peerMap.has(this.adoptFrom)) this.requestSync(this.adoptFrom, 'tail');
      else if (again.kind !== 'tail' && this.peerMap.has(again.to)) this.requestSync(again.to, again.kind);
      if (this.mode === 'claiming') this.checkClaim();
    }
    this.maybeCatchUp();
    if (this.mode === 'active') this.syncAwaySeats();
    this.updateStatus();
  }

  // --- sequencer duties: away seats and deadlines -----------------------------------------------------------

  /** Stamp a draft as this browser's seat and propose it (sequencer duties). */
  private proposeAsSelf(draft: ActionDraft): void {
    const seat = seatOfPeer(this.replica.confirmed(), this.identity.peerId);
    if (seat === null) return;
    this.propose({ ...draft, by: seat, cid: this.newCid() } as Action);
  }

  /** The sequencer marks a seat away when its peer is gone and back when it returns (core/actions.ts AwayAction). */
  private syncAwaySeats(): void {
    if (this.mode !== 'active' || this.flushingAway) return;
    this.flushingAway = true;
    try {
      const state = this.replica.view();
      const me = this.identity.peerId;
      for (const seat of Object.values(state.seats)) {
        const peer = seat.peer;
        if (peer === undefined) continue;
        const present = peer === me || [...this.peerMap.values()].some((e) => e.info.peerId === peer && e.info.status === 'connected');
        const away = seat.away === true;
        if (!present && !away && this.seen.has(peer)) this.proposeAsSelf({ type: 'away', seat: seat.id, away: true });
        else if (present && away) this.proposeAsSelf({ type: 'away', seat: seat.id, away: false });
      }
    } finally {
      this.flushingAway = false;
    }
  }
  private flushingAway = false;

  private clearDeadlines(): void {
    for (const t of this.deadlineTimers.values()) clearTimeout(t);
    this.deadlineTimers.clear();
  }

  private armDeadlines(): void {
    const source = this.opts.deadlines;
    if (!source || this.mode !== 'active') {
      this.clearDeadlines();
      return;
    }
    const list = source(this.replica.confirmed());
    const keys = new Set(list.map((d) => d.key));
    for (const [k, t] of [...this.deadlineTimers]) {
      if (!keys.has(k)) {
        clearTimeout(t);
        this.deadlineTimers.delete(k);
      }
    }
    for (const k of [...this.firedDeadlines]) if (!keys.has(k)) this.firedDeadlines.delete(k);
    const now = this.now();
    for (const d of list) {
      if (this.deadlineTimers.has(d.key) || this.firedDeadlines.has(d.key)) continue;
      const due = (this.applyAt.get(d.fromSeq) ?? now) + d.afterMs;
      this.deadlineTimers.set(
        d.key,
        setTimeout(() => this.fireDeadline(d.key), Math.max(0, due - now)),
      );
    }
  }

  private fireDeadline(key: string): void {
    this.deadlineTimers.delete(key);
    if (this.mode !== 'active' || this.closed || !this.opts.deadlines) return;
    const d = this.opts.deadlines(this.replica.confirmed()).find((x) => x.key === key);
    if (!d) return;
    this.firedDeadlines.add(key);
    for (const draft of d.emit) this.proposeAsSelf(draft);
  }

  // --- status -----------------------------------------------------------------------------------------------

  private setStatus(s: ConnectionStatus): void {
    if (s === this.statusValue) return;
    this.statusValue = s;
    this.statusEv.emit(s);
  }

  private updateStatus(): void {
    if (this.closed) return this.setStatus('closed');
    if (!this.joined) return;
    const verified = [...this.peerMap.values()].some((e) => this.verified(e));
    if (!verified) return this.setStatus(this.versionNotice !== null ? 'versionMismatch' : 'alone');
    const me = this.identity.peerId;
    const syncing = this.sync !== null || this.replica.gap() !== null || this.mode === 'claiming' || (this.sequencer !== me && !this.initialSynced);
    this.setStatus(syncing ? 'syncing' : 'connected');
  }
}

/** Create a NetEngine over a transport (net/types.ts). */
export const createNetEngine: CreateNetEngine = (opts) => new Engine(opts);

/** The concrete engine type, for tests and the debug hook (net/types.ts NetEngine plus `pendingActions` and `isSequencing`). */
export type NetEngineImpl = NetEngine & { pendingActions(): readonly Action[]; isSequencing(): boolean };
