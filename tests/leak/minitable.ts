/**
 * A minimal networked table for the secrecy simulations and the leak test (PLAN M1-P2; "Quality gates": every
 * protocol feature gets a simulated-network test with delay, drop, reordering and peer loss). It is NOT the M1-P1
 * engine: one fixed sequencer stamps proposals in order (DESIGN "Specification: network protocol and secrecy",
 * Sequencing), resends cover dropped messages, and the sequencer's clock closes commit windows (core/deadlines.ts).
 * On top of it `Player` is an owner's client that runs the private effects with core/secrets.ts and the pair channel
 * with net/private.ts. M1-P8 runs the same leak scanner over the real NetEngine and TableSession.
 */
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../src/core/actions';
import { nonceHash, type RevealedCard } from '../../src/core/commit';
import { deadlines } from '../../src/core/deadlines';
import { explain, reduce } from '../../src/core/reducer';
import { rngCommitPhaseComplete, shuffleReady } from '../../src/core/rng';
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
  type Entropy,
} from '../../src/core/secrets';
import type { CardRef, InstanceId, Pose, SecretStore, SeatId, TableState, ZoneId } from '../../src/core/types';
import type { LoopbackNetwork, LoopbackTransport } from '../../src/net/loopback';
import type { PrivateMessage, SequencedAction, WireMessage } from '../../src/net/messages';
import { privateChannelOver, type PrivateChannelHost } from '../../src/net/private';
import type { PeerInfo, PrivateChannel, Unsubscribe } from '../../src/net/types';
import { reconcileSecrets } from '../../src/session/secrets';
import type { Disclosure } from './leak';

const RESEND_MS = 300;
const HEARTBEAT_MS = 500;

/** Advance fake timers until `done()` holds (or fail after `maxMs`). */
export async function until(done: () => boolean, maxMs = 30_000, what = 'condition'): Promise<void> {
  for (let t = 0; t <= maxMs; t += 10) {
    if (done()) return;
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** One browser's replica of the sequenced log over a LoopbackTransport. */
export class MiniPeer {
  readonly transport: LoopbackTransport;
  /** Confirmed state: sequenced actions applied in order. */
  state: TableState;
  /** Every message this peer received (its view of the wire). */
  readonly received: { channel: string; msg: unknown }[] = [];
  private readonly buffer = new Map<number, SequencedAction>();
  private readonly sequenced: SequencedAction[] = [];
  private readonly byCid = new Map<string, SequencedAction>();
  private readonly pending = new Map<string, { action: Action; resolve: (r: string | null) => void; timer: ReturnType<typeof setInterval> }>();
  private readonly seqListeners: ((a: SequencedAction) => void)[] = [];
  private readonly prvListeners: ((msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void)[] = [];
  private readonly peerListeners: ((peers: PeerInfo[]) => void)[] = [];
  private readonly armed = new Set<string>();
  private readonly connected = new Set<string>();
  private hb: ReturnType<typeof setInterval> | null = null;
  private cidCounter = 0;

  constructor(
    net: LoopbackNetwork,
    readonly peerId: string,
    readonly seatId: SeatId,
    private readonly seats: Readonly<Record<SeatId, string>>,
    private readonly sequencerId: string,
    start: TableState,
  ) {
    this.state = start;
    this.transport = net.create(peerId);
    this.transport.on('act', (m, from) => this.onAct(m as unknown as WireMessage, from));
    this.transport.on('ctl', (m, from) => this.onCtl(m as unknown as WireMessage, from));
    this.transport.on('prv', (m, from) => {
      this.received.push({ channel: 'prv', msg: m });
      const seat = this.seatOfPeer(from);
      for (const l of this.prvListeners) l(m as unknown as PrivateMessage, { seat, peerId: from });
    });
    this.transport.onPeer((event, peer) => {
      if (event === 'join') this.connected.add(peer);
      else this.connected.delete(peer);
      for (const l of this.peerListeners) l(this.peers());
    });
  }

  get isSequencer(): boolean {
    return this.peerId === this.sequencerId;
  }

  async join(): Promise<void> {
    await this.transport.join('room', 'key');
    if (this.isSequencer) this.hb = setInterval(() => this.transport.send('ctl', { v: 1, t: 'hb', seq: this.state.seq, sequencer: this.peerId }), HEARTBEAT_MS);
  }

  leave(): void {
    if (this.hb) clearInterval(this.hb);
    for (const p of this.pending.values()) clearInterval(p.timer);
    this.transport.leave();
  }

  private seatOfPeer(peer: string): SeatId | null {
    for (const [s, p] of Object.entries(this.seats)) if (p === peer) return s;
    return null;
  }

  // ---- proposing -------------------------------------------------------------------------------------------------

  /** Stamp a draft as this seat. */
  stamp(draft: ActionDraft): Action {
    return { ...draft, by: this.seatId, cid: `${this.peerId}-${++this.cidCounter}` } as Action;
  }

  /** Propose a stamped action; resolves with null once sequenced, or the refusal reason. */
  propose(action: Action): Promise<string | null> {
    return new Promise((resolve) => {
      if (this.isSequencer) return resolve(this.sequence(action, this.seatId));
      const send = (): void => this.transport.send('act', { v: 1, t: 'propose', cid: action.cid, action }, this.sequencerId);
      const timer = setInterval(send, RESEND_MS);
      this.pending.set(action.cid, { action, resolve, timer });
      send();
    });
  }

  /** Propose a draft and wait (advancing fake timers) until it is sequenced; throws on refusal. */
  async act(draft: ActionDraft): Promise<SequencedAction> {
    const a = this.stamp(draft);
    let out: string | null | undefined;
    void this.propose(a).then((r) => (out = r));
    await until(() => out !== undefined, 30_000, `${a.type} to be sequenced`);
    if (out !== null) throw new Error(`${a.type} refused: ${out}`);
    await until(() => this.byCid.has(a.cid), 30_000, `${a.type} to arrive`);
    return this.byCid.get(a.cid)!;
  }

  // ---- sequencer -------------------------------------------------------------------------------------------------

  private sequence(action: Action, senderSeat: SeatId | null): string | null {
    const dup = this.byCid.get(action.cid);
    if (dup) return null;
    if (action.by !== senderSeat) return `by ${action.by} is not the sender's seat`;
    const stamped = { ...action, seq: this.state.seq + 1 } as SequencedAction;
    const why = explain(this.state, stamped);
    if (why !== null) return why;
    this.apply(stamped);
    this.transport.send('act', { v: 1, t: 'seq', seq: stamped.seq, cid: stamped.cid, action: stamped });
    return null;
  }

  private armDeadlines(): void {
    if (!this.isSequencer) return;
    for (const d of deadlines(this.state)) {
      if (this.armed.has(d.key)) continue;
      this.armed.add(d.key);
      setTimeout(() => {
        if (!deadlines(this.state).some((x) => x.key === d.key)) return;
        for (const e of d.emit) this.sequence(this.stamp(e), this.seatId);
      }, d.afterMs);
    }
  }

  // ---- replica ---------------------------------------------------------------------------------------------------

  private apply(a: SequencedAction): void {
    this.state = reduce(this.state, a);
    this.sequenced.push(a);
    this.byCid.set(a.cid, a);
    const p = this.pending.get(a.cid);
    if (p) {
      clearInterval(p.timer);
      this.pending.delete(a.cid);
      p.resolve(null);
    }
    this.armDeadlines();
    for (const l of this.seqListeners) l(a);
  }

  private drain(): void {
    for (;;) {
      const next = this.buffer.get(this.state.seq + 1);
      if (!next) return;
      this.buffer.delete(next.seq);
      this.apply(next);
    }
  }

  private onAct(m: WireMessage, from: string): void {
    this.received.push({ channel: 'act', msg: m });
    if (m.t === 'propose' && this.isSequencer) {
      const seat = this.seatOfPeer(from);
      const dup = this.byCid.get(m.action.cid);
      if (dup) return this.transport.send('act', { v: 1, t: 'seq', seq: dup.seq, cid: dup.cid, action: dup }, from);
      const why = this.sequence(m.action, seat);
      if (why !== null) this.transport.send('act', { v: 1, t: 'nack', cid: m.cid, reason: why }, from);
    } else if (m.t === 'seq' && !this.isSequencer) {
      if (m.seq <= this.state.seq) return;
      this.buffer.set(m.seq, m.action);
      this.drain();
      if (this.buffer.size > 0) this.transport.send('ctl', { v: 1, t: 'syncReq', haveSeq: this.state.seq }, this.sequencerId);
    } else if (m.t === 'nack') {
      const p = this.pending.get(m.cid);
      if (!p) return;
      clearInterval(p.timer);
      this.pending.delete(m.cid);
      p.resolve(m.reason);
    }
  }

  private onCtl(m: WireMessage, from: string): void {
    this.received.push({ channel: 'ctl', msg: m });
    if (m.t === 'hb' && !this.isSequencer && m.seq > this.state.seq) {
      this.transport.send('ctl', { v: 1, t: 'syncReq', haveSeq: this.state.seq }, this.sequencerId);
    } else if (m.t === 'syncReq' && this.isSequencer) {
      for (const a of this.sequenced.filter((x) => x.seq > m.haveSeq)) this.transport.send('act', { v: 1, t: 'seq', seq: a.seq, cid: a.cid, action: a }, from);
    }
  }

  onState(l: (state: TableState) => void): Unsubscribe {
    return this.onSequenced(() => l(this.state));
  }

  onSequenced(l: (a: SequencedAction) => void): Unsubscribe {
    this.seqListeners.push(l);
    return () => this.seqListeners.splice(this.seqListeners.indexOf(l), 1);
  }

  log(): SequencedAction[] {
    return [...this.sequenced];
  }

  // ---- PrivateChannelHost ------------------------------------------------------------------------------------------

  /** The pair-channel host view of this peer (net/private.ts). */
  host(): PrivateChannelHost {
    return {
      state: () => this.state,
      onState: (l) => this.onState(l),
      onSequenced: (l) => this.onSequenced((a) => l(a, a.by === this.seatId)),
      seat: () => this.seat(),
      sendPrivate: (seat, msg) => this.sendPrivate(seat, msg),
      onPrivate: (l) => this.onPrivate(l),
      peers: () => this.peers(),
      onPeers: (l) => this.onPeers(l),
    };
  }

  seat(): SeatId | null {
    return this.seatId;
  }

  sendPrivate(seat: SeatId, msg: PrivateMessage): boolean {
    const to = this.seats[seat];
    if (to === undefined || !this.connected.has(to)) return false;
    this.transport.send('prv', msg, to);
    return true;
  }

  onPrivate(l: (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void): Unsubscribe {
    this.prvListeners.push(l);
    return () => undefined;
  }

  peers(): PeerInfo[] {
    return [...this.connected].map((p) => ({ transportId: p, peerId: p, nickname: p, seat: this.seatOfPeer(p), role: 'player' as const, status: 'connected' as const, lastSeq: 0 }));
  }

  onPeers(l: (peers: PeerInfo[]) => void): Unsubscribe {
    this.peerListeners.push(l);
    return () => undefined;
  }
}

/**
 * An owner's client on a MiniPeer: keeps its SecretStore in step with the sequenced log, sends its nonce for the
 * other seats' shuffles and dice, and runs its own private effects (DESIGN "Specification: network protocol and
 * secrecy"). `disclosed` records every identity it showed each other seat on purpose (for the leak scanner).
 */
export class Player {
  secrets: SecretStore;
  readonly channel: PrivateChannel;
  readonly disclosed: Record<SeatId, Disclosure[]> = {};
  private sidCounter = 0;
  private readonly rngNonces = new Map<string, string>();
  /** Re-issue the hand after a public card returned to it (DESIGN "Table model", Hidden cards). Off only for the negative control. */
  reissueOnReturn = true;
  /** Send a nonce for other seats' shuffles and dice automatically. */
  autoRespond = true;
  /** Own ids whose identity another seat saw since they were issued (core/secrets.ts disclosedBy): a shuffle of a zone holding one re-issues its ids. */
  readonly exposed = new Set<InstanceId>();

  constructor(
    readonly peer: MiniPeer,
    private readonly entropy: Entropy,
  ) {
    this.secrets = emptySecretStore(peer.seatId);
    this.channel = privateChannelOver(peer.host());
    this.channel.onIdentity((card, from, verified) => {
      if (verified) this.secrets = receiveIdentity(this.secrets, card, from);
    });
    this.channel.answerLooks((req, from) => {
      const out = lookAnswer(this.secrets, this.state, req);
      for (const c of out ?? []) this.disclose(from, c);
      return out;
    });
    this.prior = peer.state;
    peer.onSequenced((a) => this.afterSequenced(a));
  }

  get seat(): SeatId {
    return this.peer.seatId;
  }

  get state(): TableState {
    return this.peer.state;
  }

  zone(kind: string): ZoneId {
    return `${kind}:${this.seat}`;
  }

  private disclose(to: SeatId, c: RevealedCard): void {
    (this.disclosed[to] ??= []).push({ instanceId: c.instanceId, sid: c.ref.sid, salt: c.salt });
  }

  /** Public reveals are disclosed to every other seat. */
  private discloseAll(c: RevealedCard): void {
    for (const s of Object.keys(this.state.seats)) if (s !== this.seat) this.disclose(s, c);
  }

  private prior: TableState | null = null;

  private afterSequenced(a: SequencedAction): void {
    // A disclosed card that went from a public zone back into a hidden one: the disclosure lapses (leak scanner).
    const before = this.prior ?? this.state;
    this.prior = this.state;
    for (const id of disclosedBy(this.secrets, before, a, this.state)) this.exposed.add(id);
    for (const id of [...this.exposed]) if (!Object.hasOwn(this.state.cards, id)) this.exposed.delete(id);
    for (const c of Object.values(before.cards)) {
      if (c.owner !== this.seat || before.zones[c.zone]?.visibility !== 'public') continue;
      const now = this.state.cards[c.id];
      if (now && this.state.zones[now.zone]?.visibility !== 'public') for (const list of Object.values(this.disclosed)) for (const d of list) if (d.instanceId === c.id) d.lapsed = true;
    }
    // Keep the private lists in step with the zones (cards that entered the library go where the action put them).
    const placement = a.type === 'toZone' && a.position === 'bottom' ? 'bottom' : 'top';
    this.secrets = pruneReceived(reconcileSecrets(this.secrets, this.state, placement), this.state);
    if (!this.autoRespond || a.by === this.seat) return;
    if (a.type === 'shuffleCommit') {
      const sid = a.sid;
      setTimeout(() => {
        if (this.state.shuffles[sid]?.orderHash === null) void this.peer.propose(this.peer.stamp({ type: 'shuffleNonce', sid, nonce: this.entropy.salt() }));
      }, 0);
    } else if (a.type === 'rngCommit' && !this.rngNonces.has(a.rid)) {
      const rid = a.rid;
      const nonce = this.entropy.salt();
      this.rngNonces.set(rid, nonce);
      setTimeout(() => void this.peer.propose(this.peer.stamp({ type: 'rngCommit', rid, purpose: a.purpose, n: a.n, h: nonceHash(nonce) })), 0);
    }
    this.revealRngWhenDue();
  }

  private revealRngWhenDue(): void {
    for (const [rid, nonce] of this.rngNonces) {
      const r = this.state.rng[rid];
      if (!r || r.result !== null || !Object.hasOwn(r.commits, this.seat) || Object.hasOwn(r.reveals, this.seat)) continue;
      if (!rngCommitPhaseComplete(this.state, rid)) continue;
      setTimeout(() => {
        const now = this.state.rng[rid];
        if (now && !Object.hasOwn(now.reveals, this.seat)) void this.peer.propose(this.peer.stamp({ type: 'rngReveal', rid, nonce }));
      }, 0);
    }
  }

  // ---- private effects -------------------------------------------------------------------------------------------

  async importDeck(cards: readonly CardRef[]): Promise<void> {
    const r = commitDeck(this.secrets, cards, this.entropy);
    this.secrets = r.secrets;
    await this.peer.act(r.action);
  }

  /** The secret shuffle of an own hidden zone with the other seats' nonces (DESIGN "Secret shuffle"). */
  async shuffle(zone: ZoneId = this.zone('library')): Promise<string> {
    const sid = `${this.seat}-sh${++this.sidCounter}`;
    const b = beginShuffle(this.secrets, zone, sid, this.entropy.salt());
    this.secrets = b.secrets;
    await this.peer.act(b.action);
    await until(() => shuffleReady(this.state, sid), 30_000, `shuffle ${sid} to be ready`);
    const f = finishShuffle(this.secrets, this.state, sid, this.entropy, this.exposed);
    this.secrets = f.secrets;
    await this.peer.act(f.action);
    return sid;
  }

  async draw(n = 1): Promise<InstanceId[]> {
    const out: InstanceId[] = [];
    for (let i = 0; i < n; i++) {
      const top = this.secrets.libraryOrder[0]!;
      await this.peer.act({ type: 'draw', instanceId: top });
      out.push(top);
    }
    return out;
  }

  /** London mulligan: the hand goes into the library, shuffle, draw seven, then `bottom` cards to the bottom. */
  async mulligan(bottom: number): Promise<void> {
    await this.peer.act({ type: 'mulligan', count: 1 });
    await this.shuffle();
    await this.draw(7);
    for (const id of this.secrets.hand.slice(0, bottom)) await this.peer.act({ type: 'toZone', card: id, to: this.zone('library'), position: 'bottom' });
  }

  /** Scry `n`: a logged look at the top cards, then the first goes to the bottom as a private reorder. */
  async scry(n: number): Promise<InstanceId[]> {
    const seen = this.secrets.libraryOrder.slice(0, n);
    await this.peer.act({ type: 'lookAt', zone: this.zone('library'), count: n });
    const order = [...this.secrets.libraryOrder.slice(1), this.secrets.libraryOrder[0]!];
    const r = privateReorder(this.secrets, this.state, this.zone('library'), order, 1, this.entropy);
    await this.peer.act(r.action);
    this.secrets = r.secrets;
    return seen;
  }

  /** Search the library (a logged look at all of it), take one card to hand, shuffle on close. */
  async search(pick: (ids: readonly InstanceId[]) => InstanceId): Promise<InstanceId> {
    const lib = this.zone('library');
    await this.peer.act({ type: 'lookAt', zone: lib, count: this.state.zones[lib]!.ids.length });
    const id = pick(this.secrets.libraryOrder);
    await this.peer.act({ type: 'toZone', card: id, to: this.zone('hand'), position: 'any' });
    await this.shuffle();
    return id;
  }

  /** Reveal (publicly) and put a hand card onto the battlefield. */
  async play(id: InstanceId, pose: Pose): Promise<void> {
    const c = revealedCard(this.secrets, id)!;
    await this.peer.act({ type: 'reveal', ...c });
    this.discloseAll(c);
    await this.peer.act({ type: 'move', card: id, to: this.zone('battlefield'), pose });
  }

  /** Put a hand card onto the battlefield face down, identity kept here (DESIGN "Table model", Face-down). */
  async playFaceDown(id: InstanceId, pose: Pose): Promise<void> {
    await this.peer.act({ type: 'move', card: id, to: this.zone('battlefield'), pose });
  }

  /** Peek at an own face-down card: a logged look with private content. */
  async peek(id: InstanceId): Promise<CardRef> {
    await this.peer.act({ type: 'lookAt', zone: this.zone('battlefield'), count: 1, card: id });
    return this.secrets.identities[id]!.card;
  }

  /** Turn an own face-down card up, revealing it (the flip carries ref and salt). */
  async flipUp(id: InstanceId): Promise<void> {
    const c = revealedCard(this.secrets, id)!;
    await this.peer.act({ type: 'flip', card: id, face: 'up', ref: c.ref, salt: c.salt });
    this.discloseAll(c);
  }

  /** Show a hidden own card to `seats` only: public `revealTo`, identity on the pair channel (DESIGN "Targeted reveal"). */
  async revealTo(id: InstanceId, seats: SeatId[]): Promise<void> {
    const a = await this.peer.act({ type: 'revealTo', instanceId: id, seats });
    const c = revealedCard(this.secrets, id)!;
    this.channel.reveal(seats, [c], 'revealTo', a.cid);
    for (const s of seats) this.disclose(s, c);
  }

  /** Return a public own card to the hand; the hand then gets fresh opaque ids (DESIGN "Table model", Hidden cards). */
  async returnToHand(id: InstanceId): Promise<void> {
    await this.peer.act({ type: 'toZone', card: id, to: this.zone('hand'), position: 'any' });
    if (!this.reissueOnReturn) return;
    const r = reissueZone(this.secrets, this.state, this.zone('hand'), this.entropy);
    if (!r) return;
    await this.peer.act(r.action);
    this.secrets = r.secrets;
  }

  /** A die roll by commit-and-reveal with every connected seated player; resolves with the 0-based result. */
  async roll(n: number): Promise<number> {
    const rid = `${this.seat}-r${++this.sidCounter}`;
    const nonce = this.entropy.salt();
    this.rngNonces.set(rid, nonce);
    await this.peer.act({ type: 'rngCommit', rid, purpose: 'die', n, h: nonceHash(nonce) });
    await until(() => this.state.rng[rid]?.result !== null && this.state.rng[rid] !== undefined, 30_000, `roll ${rid}`);
    return this.state.rng[rid]!.result!;
  }
}
