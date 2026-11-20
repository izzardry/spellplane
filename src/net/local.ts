/**
 * In-page network for members that live in the same page (computer.md section 3, `LocalNetwork`): the human's session
 * and Sparring's session talk over it. It implements the transport seam (net/transport.ts) for any number of members.
 *
 * - Every message is copied through JSON (`JSON.parse(JSON.stringify())`), so the plain-JSON rule is exercised and no
 *   receiver shares an object with its sender.
 * - Deliveries run one per task through an injectable scheduler: a `MessageChannel` in the browser (not throttled like
 *   `setTimeout` in a background tab, and it yields to rendering), `setTimeout(fn, 0)` elsewhere, so Vitest's fake
 *   timers drive it.
 * - Unlike `LoopbackNetwork` it has no fault injection and records nothing; a `tap` callback can be attached (the leak
 *   test) and sees every delivery.
 * - Joined transports are counted as `transports` in the lifecycle counters (util/lifecycle.ts) until they leave.
 */
import { track, untrack } from '../util/lifecycle';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from './transport';

/** Runs `fn` in a later task. */
export type LocalScheduler = (fn: () => void) => void;

/** One delivered message, as the tap sees it. */
export interface LocalDelivery {
  channel: Channel;
  msg: Message;
  from: PeerId;
  to: PeerId;
}

/** A scheduler with a `close()` that drops whatever is still queued. */
export interface ClosableScheduler {
  schedule: LocalScheduler;
  close(): void;
}

/** `setTimeout(fn, 0)` per task (Vitest's fake timers drive it). */
export function timeoutScheduler(): ClosableScheduler {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    schedule(fn) {
      const h = setTimeout(() => {
        pending.delete(h);
        fn();
      }, 0);
      pending.add(h);
    },
    close() {
      for (const h of pending) clearTimeout(h);
      pending.clear();
    },
  };
}

/** One task per queued function through a `MessageChannel` (the browser default). */
export function channelScheduler(): ClosableScheduler {
  const queue: (() => void)[] = [];
  let ch: MessageChannel | null = new MessageChannel();
  ch.port1.onmessage = () => {
    const fn = queue.shift();
    if (fn) fn();
  };
  return {
    schedule(fn) {
      if (!ch) return;
      queue.push(fn);
      ch.port2.postMessage(0);
    },
    close() {
      queue.length = 0;
      if (!ch) return;
      ch.port1.onmessage = null;
      ch.port1.close();
      ch.port2.close();
      ch = null;
    },
  };
}

/** The page's default: a MessageChannel in a browser page, setTimeout elsewhere (Node, Vitest). */
export function defaultScheduler(): ClosableScheduler {
  const browser = typeof window !== 'undefined' && typeof MessageChannel !== 'undefined';
  return browser ? channelScheduler() : timeoutScheduler();
}

export interface LocalNetworkOptions {
  /** Default: `defaultScheduler()`. */
  scheduler?: ClosableScheduler;
  /** Sees every delivery (the leak test). */
  tap?: (d: LocalDelivery) => void;
}

/** In-memory network of in-page members (computer.md section 3). */
export class LocalNetwork {
  private readonly members = new Map<PeerId, LocalTransport>();
  private readonly scheduler: ClosableScheduler;
  private closed = false;
  tap: ((d: LocalDelivery) => void) | null;

  constructor(opts: LocalNetworkOptions = {}) {
    this.scheduler = opts.scheduler ?? defaultScheduler();
    this.tap = opts.tap ?? null;
  }

  /** A transport with the given peer id; it joins on `join()`. */
  create(peerId: PeerId): LocalTransport {
    return new LocalTransport(this, peerId);
  }

  /** Peer ids of the joined members. */
  memberIds(): PeerId[] {
    return [...this.members.keys()];
  }

  /** Every member leaves and queued deliveries are dropped. */
  dispose(): void {
    if (this.closed) return;
    for (const m of [...this.members.values()]) m.leave();
    this.closed = true;
    this.scheduler.close();
    this.tap = null;
  }

  get disposed(): boolean {
    return this.closed;
  }

  /** @internal */
  attach(t: LocalTransport): void {
    if (this.closed) return;
    const old = this.members.get(t.selfId);
    if (old && old !== t) old.leave();
    const others = [...this.members.values()];
    this.members.set(t.selfId, t);
    for (const o of others) {
      this.scheduler.schedule(() => o.emitPeer('join', t.selfId));
      this.scheduler.schedule(() => t.emitPeer('join', o.selfId));
    }
  }

  /** @internal */
  detach(t: LocalTransport): void {
    if (this.members.get(t.selfId) !== t) return;
    this.members.delete(t.selfId);
    if (this.closed) return;
    for (const o of this.members.values()) this.scheduler.schedule(() => o.emitPeer('leave', t.selfId));
  }

  /** @internal */
  route(from: LocalTransport, channel: Channel, msg: Message, to?: PeerId): void {
    if (this.closed || this.members.get(from.selfId) !== from) return;
    const targets = to !== undefined ? [to] : [...this.members.keys()].filter((p) => p !== from.selfId);
    const text = JSON.stringify(msg);
    for (const target of targets) {
      if (target === from.selfId) continue;
      const copy = JSON.parse(text) as Message;
      this.scheduler.schedule(() => {
        const receiver = this.members.get(target);
        if (!receiver || this.members.get(from.selfId) !== from) return;
        this.tap?.({ channel, msg: copy, from: from.selfId, to: target });
        receiver.emit(channel, copy, from.selfId);
      });
    }
  }
}

/** One member's transport on a LocalNetwork. */
export class LocalTransport implements Transport {
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  private readonly peerHandlers: PeerHandler[] = [];
  private readonly known = new Set<PeerId>();
  private joined = false;

  constructor(
    private readonly net: LocalNetwork,
    readonly selfId: PeerId,
  ) {}

  join(_roomId: string, _roomKey: string): Promise<void> {
    if (!this.joined && !this.net.disposed) {
      this.joined = true;
      track('transports', this);
      this.net.attach(this);
    }
    return Promise.resolve();
  }

  leave(): void {
    if (!this.joined) return;
    this.joined = false;
    this.known.clear();
    untrack('transports', this);
    this.net.detach(this);
  }

  peers(): PeerId[] {
    return [...this.known];
  }

  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (!this.joined) return;
    this.net.route(this, channel, msg, to);
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
    for (const h of [...(this.handlers.get(channel) ?? [])]) h(msg, from);
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
    for (const h of [...this.peerHandlers]) h(event, peer);
  }
}
