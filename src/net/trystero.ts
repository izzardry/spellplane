/**
 * The production transport: Trystero over public Nostr relays (DESIGN "Multiplayer architecture", Rooms and
 * connection; "Specification: network protocol and secrecy", Room: `joinRoom({appId: 'spellplane-v1', password:
 * roomKey}, roomId)` with Trystero's Nostr strategy, the room key encrypting the signalling payloads). Each channel
 * is one Trystero action. Trystero is loaded on `join`, so tests and the solo table never load it.
 * Implementer: M1-P1. Tested only by the `@network` smoke test (tests/e2e/network.smoke.spec.ts), never in CI.
 */
import type { JsonValue, Room } from 'trystero';
import { APP_ID } from './messages';
import { CHANNELS, type Channel, type Message, type MessageHandler, type PeerHandler, type PeerId, type Transport } from './transport';

type Sender = (data: JsonValue, options?: { target?: string | string[] | null }) => Promise<void>;

/** Options for the Trystero transport. */
export interface TrysteroOptions {
  /** Nostr relay URLs; Trystero's defaults when omitted. */
  relayUrls?: string[];
}

/** Transport over a Trystero room (net/transport.ts). */
export class TrysteroTransport implements Transport {
  private room: Room | null = null;
  private self: PeerId = '';
  private readonly senders = new Map<Channel, Sender>();
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  private readonly peerHandlers: PeerHandler[] = [];
  private readonly streamHandlers: ((stream: MediaStream, from: PeerId) => void)[] = [];
  private readonly known = new Set<PeerId>();
  /** Peers Trystero reported gone in this room: a late message from one does not list it again (only onPeerJoin does). */
  private readonly gone = new Set<PeerId>();
  /** Bumped by `leave`, so a `join` still loading Trystero does not open a room after it. */
  private generation = 0;
  private joining: Promise<void> | null = null;
  /**
   * The page is unloading: Trystero leaves its rooms on `beforeunload` and, ~100 ms later, closes every peer
   * connection, which it reports as peers leaving. Those are not reported to this page's engine: it is still running
   * (a reload keeps the old page until the new one arrives) and would act on a room it believes lost — a sequencer
   * marks the other seats away, a follower takes over as sequencer — and save records that the reopened page then
   * finds in no one else's history (M4 gate: "history diverged at seq N" after a reload; net/broadcast.ts likewise).
   */
  private unloading = false;
  private readonly onUnload = (): void => {
    this.unloading = true;
  };

  constructor(private readonly options: TrysteroOptions = {}) {}

  /** Trystero's id for this page; '' until `join` loaded Trystero. */
  get selfId(): PeerId {
    return this.self;
  }

  join(roomId: string, roomKey: string): Promise<void> {
    if (this.room) return Promise.resolve();
    if (this.joining) return this.joining;
    // `leave` forgets a pending join, so a join after it starts afresh instead of reusing one that opens nothing.
    const pending: Promise<void> = this.open(roomId, roomKey).finally(() => {
      if (this.joining === pending) this.joining = null;
    });
    this.joining = pending;
    return pending;
  }

  private async open(roomId: string, roomKey: string): Promise<void> {
    const gen = this.generation;
    const trystero = await import('trystero/nostr');
    // `leave` ran while Trystero was loading: open nothing (no relay sockets, no peer connections).
    if (gen !== this.generation) return;
    this.self = trystero.selfId;
    const room = trystero.joinRoom(
      { appId: APP_ID, password: roomKey, ...(this.options.relayUrls ? { relayConfig: { urls: this.options.relayUrls } } : {}) },
      roomId,
    );
    this.room = room;
    for (const channel of CHANNELS) {
      const action = room.makeAction<JsonValue>(channel);
      this.senders.set(channel, action.send);
      action.onMessage = (data, ctx) => {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
        if (this.gone.has(ctx.peerId)) return;
        this.see(ctx.peerId);
        for (const h of this.handlers.get(channel) ?? []) h(data as unknown as Message, ctx.peerId);
      };
    }
    room.onPeerJoin = (peer) => {
      this.gone.delete(peer);
      this.see(peer);
    };
    room.onPeerLeave = (peer) => {
      this.gone.add(peer);
      if (!this.known.delete(peer) || this.unloading) return;
      for (const h of this.peerHandlers) h('leave', peer);
    };
    if (typeof addEventListener === 'function') addEventListener('beforeunload', this.onUnload);
    room.onPeerStream = (stream, peer) => {
      for (const h of this.streamHandlers) h(stream, peer);
    };
  }

  leave(): void {
    this.generation++;
    this.joining = null;
    const room = this.room;
    if (!room) return;
    this.room = null;
    if (typeof removeEventListener === 'function') removeEventListener('beforeunload', this.onUnload);
    this.senders.clear();
    this.gone.clear();
    for (const peer of [...this.known]) {
      this.known.delete(peer);
      for (const h of this.peerHandlers) h('leave', peer);
    }
    void room.leave();
  }

  peers(): PeerId[] {
    return [...this.known];
  }

  send(channel: Channel, msg: Message, to?: PeerId): void {
    const send = this.senders.get(channel);
    if (!send) return;
    // A rejected send means the peer left; liveness handles that, so the rejection is dropped.
    send(msg as unknown as JsonValue, { target: to ?? null }).catch(() => undefined);
  }

  on(channel: Channel, handler: MessageHandler): void {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
  }

  onPeer(handler: PeerHandler): void {
    this.peerHandlers.push(handler);
  }

  addStream(stream: MediaStream, to?: PeerId): void {
    // A rejected renegotiation means the peer left; liveness handles that.
    for (const p of this.room?.addStream(stream, to ? { target: to } : {}) ?? []) p.catch(() => undefined);
  }

  removeStream(stream: MediaStream, to?: PeerId): void {
    this.room?.removeStream(stream, to ? { target: to } : {});
  }

  onStream(handler: (stream: MediaStream, from: PeerId) => void): void {
    this.streamHandlers.push(handler);
  }

  private see(peer: PeerId): void {
    if (this.known.has(peer)) return;
    this.known.add(peer);
    for (const h of this.peerHandlers) h('join', peer);
  }
}
