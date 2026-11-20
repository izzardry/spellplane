/**
 * The lobby room (matchmaking.md 2.2, MM-1, MM-2, MM-15): a well-known room `lobby-<proto>-<realm>-all-0` with a public
 * key on the page's own Transport (Trystero in production, BroadcastChannel with ?transport=local, LoopbackNetwork in
 * tests), only its `ctl` channel. It validates and verifies what arrives (ticket signature, ticket bound to the
 * sender's transport id, peer id derived from the key, hold signature over the fresh match id), sends a beat every
 * 4 s and drops a peer silent for 15 s, and feeds the pure broker (broker.ts). Soft cap 16: the view says `full`.
 * Shards, the NAT probe, strikes and rate limits are later.
 *
 * A ticket carries only name, peer id and public key, queues, ratings for the queued keys and the deck's band and
 * score (QueueDeckInfo); nothing else about a deck can pass the validators.
 */
import { base64url } from '../../core/hash';
import type { QueueId } from '../../core/types';
import { peerIdOfPubKey, verifySignature } from '../identity';
import type { Transport } from '../transport';
import type { NetIdentity } from '../types';
import { beatState, createBroker, step, waitedOf, type BrokerEffect, type BrokerEvent, type BrokerState } from './broker';
import { holdText, type LobbyMessage, type Ticket } from './messages';
import { compatible, ratingFor } from './pairing';
import { ticketText } from './text';
import { LOBBY_REALM, lobbyRoomId, type LobbyRealm, type LobbyView, type SeekerView } from './types';
import { validLobbyMessage } from './validate';

/** The lobby's room key: public, 22 characters; it only satisfies `Transport.join` (matchmaking.md 2.2). */
export const LOBBY_KEY = 'spellplaneLobbyPublic1';
export const BEAT_MS = 4_000;
export const PEER_TIMEOUT_MS = 15_000;
export const LOBBY_CAP = 16;
const MAX_LOG = 600;

/** One lobby message as this browser saw it (debug hook `mm.messages()`, the leak test). */
export interface LobbyMessageRecord {
  dir: 'in' | 'out';
  peer: string;
  at: number;
  msg: LobbyMessage;
}

export interface LobbyRoomOptions {
  transport: Transport;
  identity: NetIdentity;
  /** This browser's clock. */
  now: () => number;
  /** Random bytes for hold nonces. */
  random: (n: number) => Uint8Array;
  realm?: LobbyRealm;
  /** Broker effects for the matchmaker (check, formed, returned, stopped). */
  onEffect?: (e: BrokerEffect) => void;
  /** Something visible changed. */
  onChange?: () => void;
}

/** The unsigned part of a ticket the matchmaker builds. */
export type TicketDraft = Omit<Ticket, 'v' | 'tid' | 'peerId' | 'pubKey' | 'sig'>;

export class LobbyRoom {
  state: BrokerState;
  readonly log: LobbyMessageRecord[] = [];
  private readonly seen = new Map<string, number>();
  private readonly connected = new Set<string>();
  private lastBeat = -Infinity;
  private joined = false;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly o: LobbyRoomOptions) {
    this.state = createBroker({ tid: o.transport.selfId, peerId: o.identity.peerId, proto: 0 });
    o.transport.on('ctl', (msg, from) => this.receive(msg, from));
    o.transport.onPeer((ev, peer) => this.onPeer(ev, peer));
  }

  get tid(): string {
    return this.o.transport.selfId;
  }

  async join(): Promise<void> {
    if (this.joined || this.closed) return;
    this.joined = true;
    await this.o.transport.join(lobbyRoomId(this.o.realm ?? LOBBY_REALM, 0), LOBBY_KEY);
    for (const p of this.o.transport.peers()) this.onPeer('join', p);
    this.beat();
  }

  /** Leave the lobby for good (unseek first when seeking). */
  leave(): void {
    if (this.closed) return;
    if (this.state.ticket && this.state.phase !== 'moving') this.out(undefined, { v: 1, t: 'unseek' });
    this.closed = true;
    try {
      this.o.transport.leave();
    } catch {
      /* already gone */
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Sign and announce a ticket (a new search, or a changed one with a higher rev). `waitedMs` counts for a new search. */
  async seek(draft: TicketDraft, waitedMs = 0): Promise<Ticket> {
    const id = this.o.identity;
    const unsigned: Omit<Ticket, 'sig'> = { v: 1, tid: this.tid, peerId: id.peerId, pubKey: id.pubKey, ...draft };
    const sig = await id.sign(ticketText(unsigned));
    const ticket: Ticket = { ...unsigned, sig };
    if (this.closed) return ticket;
    this.state = { ...this.state, proto: ticket.proto };
    this.apply({ kind: 'seek', now: this.o.now(), ticket, waitedMs });
    this.out(undefined, { v: 1, t: 'seek', ticket, waitedMs: waitedOf(this.state, this.o.now()) });
    this.beat();
    return ticket;
  }

  cancel(): void {
    const had = this.state.ticket !== null;
    this.apply({ kind: 'cancel', now: this.o.now() });
    if (had) this.out(undefined, { v: 1, t: 'unseek' });
    this.beat();
  }

  answer(accept: boolean): void {
    this.apply({ kind: 'answer', now: this.o.now(), accept });
    if (!accept) {
      this.out(undefined, { v: 1, t: 'unseek' });
      this.beat();
    }
  }

  /**
   * The own clock jumped by `ms` (the debug hook's `mm.tick`): the others' last beats move with it, so a jump drives
   * the own timers (the ready ring, the window rows) without making every peer look silent.
   */
  skew(ms: number): void {
    for (const [peer, at] of this.seen) this.seen.set(peer, at + ms);
    this.lastBeat += ms;
  }

  /** Every 250 ms or so: beats, peer timeouts and the broker's timers. */
  tick(): void {
    if (this.closed) return;
    const now = this.o.now();
    for (const [peer, at] of this.seen) {
      if (now - at > PEER_TIMEOUT_MS) {
        this.seen.delete(peer);
        this.connected.delete(peer);
        this.apply({ kind: 'peerGone', now, tid: peer });
        this.apply({ kind: 'links', now, links: [...this.connected] });
      }
    }
    if (now - this.lastBeat >= BEAT_MS) this.beat();
    const before = this.state.ticket;
    this.apply({ kind: 'tick', now });
    if (before && !this.state.ticket) {
      // The ready check lapsed here: the search stopped.
      this.out(undefined, { v: 1, t: 'unseek' });
      this.beat();
    }
  }

  /** What the lobby looks like from here (matchmaking.md 2.13). */
  view(): LobbyView {
    const s = this.state;
    const now = this.o.now();
    const seekers: SeekerView[] = [];
    const byQueue: Partial<Record<QueueId, number>> = {};
    let otherVersion = 0;
    for (const [tid, p] of Object.entries(s.peers)) {
      if (!p.ticket || !this.connected.has(tid)) continue;
      const t = p.ticket;
      if (s.ticket && t.proto !== s.ticket.proto) otherVersion++;
      for (const q of t.queues) byQueue[q] = (byQueue[q] ?? 0) + 1;
      const wait = p.since === null ? 0 : Math.max(0, now - p.since);
      const mine = s.ticket;
      const inRange = mine !== null && t.queues.some((q) => compatible(mine, t, q, waitedOf(s, now), wait));
      seekers.push({ tid, peerId: t.peerId, name: t.name, queues: [...t.queues], rating: t.queues[0] ? ratingFor(t, t.queues[0]) : null, band: t.band, waitedMs: wait, inRange, avoided: false, met: null });
    }
    seekers.sort((a, b) => b.waitedMs - a.waitedMs);
    return { shard: 0, nat: 'unknown', seekers, byQueue, unreachable: 0, otherVersion, full: this.connected.size + 1 >= LOBBY_CAP };
  }

  /** The peers this browser is connected to in the lobby. */
  links(): string[] {
    return [...this.connected].sort();
  }

  // ---------------------------------------------------------------------------------------------------------------

  private apply(ev: BrokerEvent): void {
    const r = step(this.state, ev);
    this.state = r.state;
    for (const o of r.send) this.out(o.to, o.msg);
    for (const e of r.effects) {
      if (e.kind === 'hold') void this.hold(e.mid, e.to);
      else this.o.onEffect?.(e);
    }
    this.o.onChange?.();
  }

  private async hold(mid: string, to: string[]): Promise<void> {
    const nonce = base64url(this.o.random(16));
    const sig = await this.o.identity.sign(holdText(mid, this.tid, this.o.identity.peerId));
    if (this.closed || this.state.hold?.offer.mid !== mid) return;
    for (const t of to) this.out(t, { v: 1, t: 'hold', mid, nonce, sig });
    this.apply({ kind: 'held', now: this.o.now(), mid, nonce });
  }

  private out(to: string | undefined, msg: LobbyMessage): void {
    if (this.closed) return;
    this.record({ dir: 'out', peer: to ?? '*', at: this.o.now(), msg });
    try {
      this.o.transport.send('ctl', msg as unknown as Parameters<Transport['send']>[1], to);
    } catch {
      /* a transport that is gone */
    }
  }

  private record(r: LobbyMessageRecord): void {
    this.log.push(r);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private beat(): void {
    if (this.closed || !this.joined) return;
    this.lastBeat = this.o.now();
    this.out(undefined, { v: 1, t: 'beat', state: beatState(this.state), waitedMs: waitedOf(this.state, this.o.now()), n: this.connected.size, links: this.links().slice(0, 32) });
  }

  private onPeer(ev: 'join' | 'leave', peer: string): void {
    if (this.closed || peer === this.tid) return;
    const now = this.o.now();
    if (ev === 'join') {
      if (this.connected.has(peer)) return;
      this.connected.add(peer);
      this.seen.set(peer, now);
      this.apply({ kind: 'links', now, links: [...this.connected] });
      // Tell the newcomer who this browser is and whom it reaches; everyone else learns the new link.
      if (this.state.ticket && this.state.phase !== 'moving') this.out(peer, { v: 1, t: 'seek', ticket: this.state.ticket, waitedMs: waitedOf(this.state, now) });
      this.beat();
    } else {
      if (!this.connected.delete(peer)) return;
      this.seen.delete(peer);
      this.apply({ kind: 'peerGone', now, tid: peer });
      this.apply({ kind: 'links', now, links: [...this.connected] });
      this.beat();
    }
  }

  private receive(raw: unknown, from: string): void {
    if (this.closed) return;
    const msg = validLobbyMessage(raw);
    if (!msg) return;
    this.seen.set(from, this.o.now());
    if (!this.connected.has(from)) this.onPeer('join', from);
    this.chain = this.chain.then(() => this.handle(msg, from)).catch(() => undefined);
  }

  private async handle(msg: LobbyMessage, from: string): Promise<void> {
    if (msg.t === 'seek') {
      const t = msg.ticket;
      // A ticket is accepted only from the connection it names, for the key it carries, and never this browser's own.
      if (t.tid !== from || t.peerId === this.o.identity.peerId) return;
      if ((await peerIdOfPubKey(t.pubKey)) !== t.peerId) return;
      if (!(await verifySignature(t.pubKey, ticketText(t), t.sig))) return;
    } else if (msg.t === 'hold') {
      const t = this.state.peers[from]?.ticket;
      if (!t || !(await verifySignature(t.pubKey, holdText(msg.mid, from, t.peerId), msg.sig))) return;
    }
    if (this.closed) return;
    this.record({ dir: 'in', peer: from, at: this.o.now(), msg });
    const before = this.state.ticket;
    this.apply({ kind: 'message', now: this.o.now(), from, msg });
    if (before && !this.state.ticket) this.out(undefined, { v: 1, t: 'unseek' });
  }
}
