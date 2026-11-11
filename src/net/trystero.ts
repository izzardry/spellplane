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
  /** Bumped by `leave`, so a `join` still loading Trystero does not open a room after it. */
  private generation = 0;
  private joining: Promise<void> | null = null;

  constructor(private readonly options: TrysteroOptions = {}) {}

  /** Trystero's id for this page; '' until `join` loaded Trystero. */
  get selfId(): PeerId {
    return this.self;
  }

  join(roomId: string, roomKey: string): Promise<void> {
    if (this.room) return Promise.resolve();
    this.joining ??= this.open(roomId, roomKey).finally(() => {
      this.joining = null;
    });
    return this.joining;
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
        this.see(ctx.peerId);
        for (const h of this.handlers.get(channel) ?? []) h(data as unknown as Message, ctx.peerId);
      };
    }
    room.onPeerJoin = (peer) => this.see(peer);
    room.onPeerLeave = (peer) => {
      if (!this.known.delete(peer)) return;
      for (const h of this.peerHandlers) h('leave', peer);
    };
    room.onPeerStream = (stream, peer) => {
      for (const h of this.streamHandlers) h(stream, peer);
    };
  }

  leave(): void {
    this.generation++;
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.senders.clear();
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
    this.room?.addStream(stream, to ? { target: to } : {});
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
