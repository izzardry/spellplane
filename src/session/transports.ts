/**
 * The transport a page's networked table runs on (DESIGN "Multiplayer architecture", Rooms and connection; CLAUDE.md
 * test harnesses): Trystero in production, BroadcastTransport with `?transport=local`, and in dev and test builds two
 * failure stand-ins an init script can choose with `window.__spellplaneTransport`: 'silent' (signalling works, nobody
 * ever connects) and 'unreachable' (the signalling relays never answer). Also the wrapper behind the debug hook's
 * `net.kill()` / `net.revive()`.
 */
import { BroadcastTransport } from '../net/broadcast';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../net/transport';
import { TrysteroTransport } from '../net/trystero';
import { flags } from '../util/flags';
import { randomId } from './secrecy';

declare global {
  interface Window {
    /** Test override of the page transport (dev and test builds only). */
    __spellplaneTransport?: 'silent' | 'unreachable' | 'local';
  }
}

export type PageTransportKind = 'trystero' | 'local' | 'silent' | 'unreachable';

/** The transport this page uses: the test override (dev and test builds), else `?transport=local`, else Trystero. */
export function pageTransportKind(): PageTransportKind {
  const forced = __SPELLPLANE_DEBUG__ && typeof window !== 'undefined' ? window.__spellplaneTransport : undefined;
  if (forced === 'silent' || forced === 'unreachable' || forced === 'local') return forced;
  return flags().transport === 'local' ? 'local' : 'trystero';
}

/** A fresh transport of `kind` (a new transport id for the local ones). */
export function createPageTransport(kind: PageTransportKind = pageTransportKind()): Transport {
  if (kind === 'trystero') return new TrysteroTransport();
  const id: PeerId = randomId('t');
  if (kind === 'silent') return new SilentTransport(id);
  if (kind === 'unreachable') return new UnreachableTransport(id);
  return new BroadcastTransport(id);
}

/** A transport whose signalling works but which never connects to anyone (a network that blocks direct connections). */
export class SilentTransport implements Transport {
  constructor(readonly selfId: PeerId) {}
  join(): Promise<void> {
    return Promise.resolve();
  }
  leave(): void {}
  peers(): PeerId[] {
    return [];
  }
  send(): void {}
  on(): void {}
  onPeer(): void {}
}

/** A transport that never gets past the signalling relays (join never settles). */
export class UnreachableTransport extends SilentTransport {
  override join(): Promise<void> {
    return new Promise(() => undefined);
  }
}

/**
 * A transport that can drop off the network abruptly (debug hook `net.kill()`: a crash or a lost connection, no
 * `bye`): while killed nothing goes out and nothing comes in, so the other peers hear silence and mark the seat away
 * after AWAY_AFTER_MS. `revive()` lets traffic through again; the engine's resends and heartbeats pick up from there.
 */
export class KillableTransport implements Transport {
  private dead = false;
  constructor(readonly inner: Transport) {}
  get selfId(): PeerId {
    return this.inner.selfId;
  }
  get killed(): boolean {
    return this.dead;
  }
  kill(): void {
    this.dead = true;
  }
  revive(): void {
    this.dead = false;
  }
  join(roomId: string, roomKey: string): Promise<void> {
    return this.inner.join(roomId, roomKey);
  }
  leave(): void {
    this.inner.leave();
  }
  peers(): PeerId[] {
    return this.inner.peers();
  }
  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (!this.dead) this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, (m, from) => {
      if (!this.dead) handler(m, from);
    });
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer((ev, p) => {
      if (!this.dead) handler(ev, p);
    });
  }
}
