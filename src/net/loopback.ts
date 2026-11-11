import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from './transport';
import { mulberry32 } from '../util/prng';

/**
 * In-memory network joining N transports in one process (test harness, docs/PLAN.md B0.5).
 * Faults are injectable: random delay, drop and (as a consequence of independent delays) reordering,
 * plus peer loss. Delivery uses setTimeout, so Vitest fake timers drive it deterministically.
 */
export interface LoopbackOptions {
  /** Seed for the fault PRNG; same seed and same sends give the same schedule. */
  seed?: number;
  /** Delivery delay in ms, uniformly drawn from [min, max]. Default 0..0 (still async). */
  delay?: { min: number; max: number };
  /** Probability in [0, 1] that a message is dropped. Default 0. */
  drop?: number;
  /** Channels the faults apply to. Default: all channels. */
  faultyChannels?: Channel[];
  /** Keep FIFO order per (sender, receiver, channel) even with random delays. Default false (reordering allowed). */
  ordered?: boolean;
}

interface Delivery {
  channel: Channel;
  msg: Message;
  from: PeerId;
  to: PeerId;
}

export class LoopbackNetwork {
  private readonly members = new Map<PeerId, LoopbackTransport>();
  private readonly dead = new Set<PeerId>();
  private readonly rand: () => number;
  private readonly lastDue = new Map<string, number>();
  /** Every message that was handed to a receiver, in delivery order (for leak tests). */
  readonly delivered: Delivery[] = [];
  options: LoopbackOptions;

  constructor(options: LoopbackOptions = {}) {
    this.options = options;
    this.rand = mulberry32(options.seed ?? 1);
  }

  /** Create a transport with the given peer id; it joins when `join()` is called. */
  create(peerId: PeerId): LoopbackTransport {
    const t = new LoopbackTransport(this, peerId);
    return t;
  }

  /** @internal */
  attach(t: LoopbackTransport): void {
    const others = [...this.members.values()].filter((m) => !this.dead.has(m.selfId));
    this.members.set(t.selfId, t);
    this.dead.delete(t.selfId);
    for (const o of others) {
      setTimeout(() => o.emitPeer('join', t.selfId), 0);
      setTimeout(() => t.emitPeer('join', o.selfId), 0);
    }
  }

  /** @internal */
  detach(t: LoopbackTransport): void {
    if (!this.members.has(t.selfId)) return;
    this.members.delete(t.selfId);
    for (const o of this.members.values()) {
      if (this.dead.has(o.selfId)) continue;
      setTimeout(() => o.emitPeer('leave', t.selfId), 0);
    }
  }

  /** Simulate peer loss: the peer stops sending and receiving, and others see it leave. */
  kill(peerId: PeerId): void {
    const t = this.members.get(peerId);
    if (!t || this.dead.has(peerId)) return;
    this.dead.add(peerId);
    for (const o of this.members.values()) {
      if (o.selfId === peerId || this.dead.has(o.selfId)) continue;
      setTimeout(() => o.emitPeer('leave', peerId), 0);
    }
  }

  /** Bring a killed peer back; everyone sees it join again. */
  revive(peerId: PeerId): void {
    const t = this.members.get(peerId);
    if (!t || !this.dead.has(peerId)) return;
    this.dead.delete(peerId);
    for (const o of this.members.values()) {
      if (o.selfId === peerId || this.dead.has(o.selfId)) continue;
      setTimeout(() => o.emitPeer('join', peerId), 0);
      setTimeout(() => t.emitPeer('join', o.selfId), 0);
    }
  }

  isAlive(peerId: PeerId): boolean {
    return this.members.has(peerId) && !this.dead.has(peerId);
  }

  livePeers(): PeerId[] {
    return [...this.members.keys()].filter((p) => !this.dead.has(p));
  }

  /** @internal */
  route(from: PeerId, channel: Channel, msg: Message, to?: PeerId): void {
    if (this.dead.has(from) || !this.members.has(from)) return;
    const targets = to ? [to] : [...this.members.keys()].filter((p) => p !== from);
    const faulty = !this.options.faultyChannels || this.options.faultyChannels.includes(channel);
    for (const target of targets) {
      if (target === from) continue;
      if (faulty && this.options.drop && this.rand() < this.options.drop) continue;
      const { min, max } = faulty && this.options.delay ? this.options.delay : { min: 0, max: 0 };
      let wait = min + Math.floor(this.rand() * (max - min + 1));
      // Structured clone mimics serialisation: receivers never share objects with senders.
      const copy = JSON.parse(JSON.stringify(msg)) as Message;
      if (this.options.ordered) {
        const key = `${from}>${target}>${channel}`;
        const now = Date.now();
        const due = now + wait;
        const last = this.lastDue.get(key) ?? 0;
        if (due < last) wait = last - now;
        this.lastDue.set(key, now + wait);
      }
      setTimeout(() => {
        if (this.dead.has(from) || this.dead.has(target)) return;
        const receiver = this.members.get(target);
        if (!receiver) return;
        this.delivered.push({ channel, msg: copy, from, to: target });
        receiver.emit(channel, copy, from);
      }, wait);
    }
  }
}

export class LoopbackTransport implements Transport {
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  private readonly peerHandlers: PeerHandler[] = [];
  private joined = false;
  private readonly known = new Set<PeerId>();

  constructor(
    private readonly net: LoopbackNetwork,
    readonly selfId: PeerId,
  ) {}

  async join(_roomId: string, _roomKey: string): Promise<void> {
    if (this.joined) return;
    this.joined = true;
    this.net.attach(this);
  }

  leave(): void {
    if (!this.joined) return;
    this.joined = false;
    this.known.clear();
    this.net.detach(this);
  }

  peers(): PeerId[] {
    return [...this.known];
  }

  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (!this.joined) return;
    this.net.route(this.selfId, channel, msg, to);
  }

  on(channel: Channel, handler: MessageHandler): void {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
  }

  onPeer(handler: PeerHandler): void {
    this.peerHandlers.push(handler);
  }

  /** @internal */
  emit(channel: Channel, msg: Message, from: PeerId): void {
    if (!this.joined) return;
    for (const h of this.handlers.get(channel) ?? []) h(msg, from);
  }

  /** @internal */
  emitPeer(event: 'join' | 'leave', peer: PeerId): void {
    if (!this.joined) return;
    if (event === 'join') {
      if (this.known.has(peer)) return;
      this.known.add(peer);
    } else {
      if (!this.known.has(peer)) return;
      this.known.delete(peer);
    }
    for (const h of this.peerHandlers) h(event, peer);
  }
}
