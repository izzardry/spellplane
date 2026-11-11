import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from './transport';

/**
 * Transport over BroadcastChannel (test harness, selected with ?transport=local).
 * Several pages of one browser context form a room. Presence is detected with
 * hello/here/bye frames plus a heartbeat, so a closed page is noticed within ~3 s.
 */
type Frame =
  | { k: 'hello'; from: PeerId }
  | { k: 'here'; from: PeerId; to: PeerId }
  | { k: 'bye'; from: PeerId }
  | { k: 'beat'; from: PeerId }
  | { k: 'msg'; from: PeerId; to?: PeerId; channel: Channel; msg: Message };

const BEAT_MS = 1000;
const GONE_MS = 3500;

export class BroadcastTransport implements Transport {
  private bc: BroadcastChannel | null = null;
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  private readonly peerHandlers: PeerHandler[] = [];
  private readonly lastSeen = new Map<PeerId, number>();
  private beat: ReturnType<typeof setInterval> | null = null;
  private readonly onUnload = () => this.leave();

  constructor(readonly selfId: PeerId) {}

  async join(roomId: string, _roomKey: string): Promise<void> {
    if (this.bc) return;
    this.bc = new BroadcastChannel(`spellplane-room-${roomId}`);
    this.bc.onmessage = (e: MessageEvent<Frame>) => this.receive(e.data);
    this.post({ k: 'hello', from: this.selfId });
    this.beat = setInterval(() => {
      this.post({ k: 'beat', from: this.selfId });
      const now = Date.now();
      for (const [peer, seen] of this.lastSeen) if (now - seen > GONE_MS) this.drop(peer);
    }, BEAT_MS);
    if (typeof addEventListener === 'function') addEventListener('pagehide', this.onUnload);
  }

  leave(): void {
    if (!this.bc) return;
    this.post({ k: 'bye', from: this.selfId });
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    this.bc.close();
    this.bc = null;
    for (const peer of [...this.lastSeen.keys()]) this.drop(peer);
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', this.onUnload);
  }

  peers(): PeerId[] {
    return [...this.lastSeen.keys()];
  }

  send(channel: Channel, msg: Message, to?: PeerId): void {
    // BroadcastChannel reaches every page; addressed frames are filtered by the receiver.
    // Acceptable for a same-browser test harness; the real transport sends point to point.
    this.post(to ? { k: 'msg', from: this.selfId, to, channel, msg } : { k: 'msg', from: this.selfId, channel, msg });
  }

  on(channel: Channel, handler: MessageHandler): void {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
  }

  onPeer(handler: PeerHandler): void {
    this.peerHandlers.push(handler);
  }

  private post(frame: Frame): void {
    this.bc?.postMessage(frame);
  }

  private see(peer: PeerId): void {
    const known = this.lastSeen.has(peer);
    this.lastSeen.set(peer, Date.now());
    if (!known) for (const h of this.peerHandlers) h('join', peer);
  }

  private drop(peer: PeerId): void {
    if (!this.lastSeen.delete(peer)) return;
    for (const h of this.peerHandlers) h('leave', peer);
  }

  private receive(f: Frame): void {
    if (f.from === this.selfId) return;
    switch (f.k) {
      case 'hello':
        this.see(f.from);
        this.post({ k: 'here', from: this.selfId, to: f.from });
        return;
      case 'here':
        if (f.to === this.selfId) this.see(f.from);
        return;
      case 'beat':
        this.see(f.from);
        return;
      case 'bye':
        this.drop(f.from);
        return;
      case 'msg':
        if (f.to && f.to !== this.selfId) return;
        this.see(f.from);
        for (const h of this.handlers.get(f.channel) ?? []) h(f.msg, f.from);
        return;
    }
  }
}
