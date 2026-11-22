import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from './transport';
import { track, untrack } from '../util/lifecycle';
import { OwnClock } from './liveness';

/**
 * Transport over BroadcastChannel (test harness, selected with ?transport=local).
 * Several pages of one browser context form a room. Presence is detected with
 * hello/here/bye frames plus a heartbeat, so a closed page is noticed within ~3 s.
 *
 * A page that goes away (`pagehide`: a reload, a close, a navigation) says `bye` so the others notice at once, but
 * does not report its peers gone to its own page: that page's engine is still running, and would act on a room it
 * believes lost (a sequencer marks every other seat away, a follower takes over as sequencer) and save those records
 * locally, where the reopened page finds a history nobody else has (M4 gate: "history diverged at seq N" after a
 * reload). Only an explicit `leave` (the engine leaving, which closes it first) reports them.
 */
type Frame =
  | { k: 'hello'; from: PeerId }
  | { k: 'here'; from: PeerId; to: PeerId }
  | { k: 'bye'; from: PeerId }
  | { k: 'beat'; from: PeerId }
  | { k: 'msg'; from: PeerId; to?: PeerId; channel: Channel; msg: Message };

const BEAT_MS = 1000;
/** A peer unheard for this long on this page's liveness clock (net/liveness.ts) is gone. */
const GONE_MS = 3500;
/**
 * How often the page checks its peers and steps its liveness clock. Finer than the beat, so that a late check counts
 * little (at most two checks' worth) towards a peer's silence: a page whose own main thread stalls in chunks does not
 * drop the others for its own slowness (gate M8 round 3, C1).
 */
const CHECK_MS = 250;
/**
 * A check that runs this much later than the last means this page's main thread was blocked (a theme's shaders
 * compiling on a slow machine): the other pages' beats are still queued behind it, so nobody is dropped on that check.
 */
export const STALL_MS = 2 * BEAT_MS;

/** Whether a beat at `now` after the one at `last` follows a stall of this page (no peer is dropped on it). */
export function stalledBeat(last: number | null, now: number): boolean {
  return last !== null && now - last > STALL_MS;
}

export class BroadcastTransport implements Transport {
  private bc: BroadcastChannel | null = null;
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  private readonly peerHandlers: PeerHandler[] = [];
  /** When each peer was last heard, on the liveness clock `own`. */
  private readonly lastSeen = new Map<PeerId, number>();
  /** This page's own on-time running (net/liveness.ts): a check counts at most two checks' worth while visible. */
  private readonly own = new OwnClock({ cap: 2 * CHECK_MS, hiddenCap: STALL_MS });
  private beat: ReturnType<typeof setInterval> | null = null;
  private readonly onUnload = () => this.close(false);

  constructor(readonly selfId: PeerId) {}

  async join(roomId: string, _roomKey: string): Promise<void> {
    track('transports', this);
    if (this.bc) return;
    this.bc = new BroadcastChannel(`spellplane-room-${roomId}`);
    this.bc.onmessage = (e: MessageEvent<Frame>) => this.receive(e.data);
    this.post({ k: 'hello', from: this.selfId });
    let lastCheck: number | null = null;
    let lastPost = -Infinity;
    this.beat = setInterval(() => {
      const now = Date.now();
      // Beats go out by elapsed time, not by check count (a hidden page's checks run about once a second and beat each time).
      if (now - lastPost >= BEAT_MS - CHECK_MS / 2) {
        lastPost = now;
        this.post({ k: 'beat', from: this.selfId });
      }
      const stalled = stalledBeat(lastCheck, now);
      lastCheck = now;
      this.own.step(now);
      // After a stall the peers' queued beats run next: they are dropped on a later check if they really went quiet.
      if (stalled) return;
      const heard = this.own.at(now);
      for (const [peer, seen] of this.lastSeen) if (heard - seen > GONE_MS) this.drop(peer);
    }, CHECK_MS);
    if (typeof addEventListener === 'function') addEventListener('pagehide', this.onUnload);
  }

  leave(): void {
    untrack('transports', this);
    this.close(true);
  }

  /** Say `bye` and close; `report`: tell this page's own handlers that every peer is gone (not when the page unloads). */
  private close(report: boolean): void {
    if (!this.bc) return;
    this.post({ k: 'bye', from: this.selfId });
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    this.bc.close();
    this.bc = null;
    if (report) for (const peer of [...this.lastSeen.keys()]) this.drop(peer);
    else this.lastSeen.clear();
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
    this.lastSeen.set(peer, this.own.at(Date.now()));
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
