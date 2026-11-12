/**
 * The presence channel (DESIGN "Multiplayer architecture": pointer position, the card being dragged, who is typing or
 * speaking travel on the unreliable channel and are never logged; "Specification: network protocol and secrecy",
 * `pres`). Cursor and drag updates are throttled to PRESENCE_INTERVAL_MS per sender and the last value always goes
 * out; every message carries a per-sender counter `n` so a receiver drops one older than the last it applied.
 * Implementer: M1-P1.
 */
import type { Anchor, InstanceId, Pose, SeatId } from '../core/types';
import type { ChatChannel, PresenceMessage } from './messages';
import type { PeerId } from './transport';
import { PRESENCE_INTERVAL_MS, type PeerPresence, type Presence, type Unsubscribe } from './types';

/** What the presence layer needs from its engine. */
export interface PresenceHost {
  /** Send to every verified peer on `pres`. */
  send(msg: PresenceMessage): void;
  now(): number;
}

type Throttled = 'cursor' | 'drag';

/** The engine-side presence: Presence plus the receiving half. */
export class PresenceChannel implements Presence {
  private n = 0;
  private readonly lastSent = new Map<Throttled, number>();
  private readonly queued = new Map<Throttled, PresenceMessage>();
  private readonly timers = new Map<Throttled, ReturnType<typeof setTimeout>>();
  /** Each peer's presence and, per message type, the counter of the last message applied. */
  private readonly remote = new Map<PeerId, { n: Partial<Record<PresenceMessage['t'], number>>; p: PeerPresence }>();
  private readonly listeners = new Set<(peers: PeerPresence[]) => void>();

  constructor(private readonly host: PresenceHost) {}

  cursor(at: { x: number; y: number } | null, over: InstanceId | null = null): void {
    this.throttled('cursor', { v: 1, t: 'cursor', n: 0, at: at ? { x: at.x, y: at.y } : null, over });
  }

  drag(cards: readonly { id: InstanceId; pose: Pose }[]): void {
    const msg: PresenceMessage = { v: 1, t: 'drag', n: 0, cards: cards.map((c) => ({ id: c.id, pose: { x: c.pose.x, y: c.pose.y, rot: c.pose.rot } })) };
    // The end of a drag is never held back, so no peer keeps drawing a ghost drag.
    if (cards.length === 0) this.flushNow('drag', msg);
    else this.throttled('drag', msg);
  }

  speaking(on: boolean): void {
    this.emit({ v: 1, t: 'speaking', n: 0, on });
  }

  typing(channel: ChatChannel | null): void {
    this.emit({ v: 1, t: 'typing', n: 0, channel });
  }

  captionInterim(text: string | null, anchor: Anchor | null = null): void {
    this.emit({ v: 1, t: 'captionInterim', n: 0, text, anchor });
  }

  peers(): PeerPresence[] {
    return [...this.remote.values()].map((r) => r.p);
  }

  subscribe(listener: (peers: PeerPresence[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A presence message from a verified peer. One counter numbers all of a sender's messages; a message is stale
   * when a later one of the same type was applied (the channel is unordered, and a cursor must not be dropped
   * because a typing indicator overtook it).
   */
  receive(from: PeerId, who: { peerId: string; seat: SeatId | null }, msg: PresenceMessage): void {
    const prior = this.remote.get(from);
    const last = prior?.n[msg.t];
    if (last !== undefined && msg.n <= last) return;
    const base: PeerPresence = prior?.p ?? { peerId: who.peerId, seat: who.seat, cursor: null, over: null, drag: [], speaking: false, typing: null, caption: null, at: 0 };
    const p: PeerPresence = { ...base, peerId: who.peerId, seat: who.seat, at: this.host.now() };
    switch (msg.t) {
      case 'cursor':
        p.cursor = msg.at;
        p.over = msg.over;
        break;
      case 'drag':
        p.drag = msg.cards;
        break;
      case 'speaking':
        p.speaking = msg.on;
        break;
      case 'typing':
        p.typing = msg.channel;
        break;
      case 'captionInterim':
        p.caption = msg.text === null ? null : { text: msg.text, anchor: msg.anchor };
        break;
    }
    this.remote.set(from, { n: { ...prior?.n, [msg.t]: msg.n }, p });
    this.notify();
  }

  /** Update the seat of a peer (it took or left a chair). */
  relabel(from: PeerId, peerId: string, seat: SeatId | null): void {
    const r = this.remote.get(from);
    if (!r || (r.p.peerId === peerId && r.p.seat === seat)) return;
    r.p = { ...r.p, peerId, seat };
    this.notify();
  }

  /** A peer left or went away: forget its presence. */
  forget(from: PeerId): void {
    if (this.remote.delete(from)) this.notify();
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queued.clear();
    this.listeners.clear();
  }

  private throttled(kind: Throttled, msg: PresenceMessage): void {
    const now = this.host.now();
    const last = this.lastSent.get(kind);
    if (last === undefined || now - last >= PRESENCE_INTERVAL_MS) {
      this.flushNow(kind, msg);
      return;
    }
    this.queued.set(kind, msg);
    if (!this.timers.has(kind)) {
      this.timers.set(
        kind,
        setTimeout(() => {
          this.timers.delete(kind);
          const q = this.queued.get(kind);
          if (q) this.flushNow(kind, q);
        }, PRESENCE_INTERVAL_MS - (now - last)),
      );
    }
  }

  private flushNow(kind: Throttled, msg: PresenceMessage): void {
    this.queued.delete(kind);
    const t = this.timers.get(kind);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(kind);
    }
    this.lastSent.set(kind, this.host.now());
    this.emit(msg);
  }

  private emit(msg: PresenceMessage): void {
    this.host.send({ ...msg, n: ++this.n });
  }

  private notify(): void {
    const peers = this.peers();
    for (const l of [...this.listeners]) l(peers);
  }
}
