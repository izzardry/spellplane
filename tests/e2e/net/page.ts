/**
 * Browser entry for the net engine's Playwright specs (tests/e2e/net/*.spec.ts). It is bundled from source by
 * ./bundle.ts and served by a Playwright route on the app's own origin, so the specs exercise the real Web Crypto
 * (ECDSA P-256) handshake, the BroadcastChannel transport and the persisted identity (store/identity.ts, namespaced
 * by ?profile=) without needing the networked session (M1-P8). It registers the `net`, `state` and `dispatch` parts
 * of window.__spellplane (DESIGN "Specification: code interfaces", SpellplaneDebug) and window.__netHarness.
 */
import type { Action } from '../../../src/core/actions';
import { base64url, canonicalJson } from '../../../src/core/hash';
import { createTable } from '../../../src/core/reducer';
import { sha256Sync } from '../../../src/core/sha256';
import type { CoreGameSpec } from '../../../src/core/types';
import { BroadcastTransport } from '../../../src/net/broadcast';
import { createNetEngine, type NetEngineImpl } from '../../../src/net/engine';
import { createNetIdentity, peerIdOfPubKey } from '../../../src/net/identity';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import type { NetIdentity } from '../../../src/net/types';
import { openStores } from '../../../src/store/stores';
import { registerDebug } from '../../../src/util/debug';

const GAME: CoreGameSpec = {
  id: 'test',
  zones: [
    { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
    { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
    { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
    { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
    { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
  ],
  phases: [
    { id: 'main1', label: 'Main 1' },
    { id: 'combat', label: 'Combat' },
  ],
  startingLife: () => 20,
};

/** A transport that can drop off the network without a word (NetDebug.kill) and come back (revive). */
class Switchable implements Transport {
  silent = false;
  constructor(private readonly inner: Transport) {}
  get selfId(): PeerId {
    return this.inner.selfId;
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
    if (!this.silent) this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, (m, from) => {
      if (!this.silent) handler(m, from);
    });
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer(handler);
  }
}

let identity: NetIdentity | null = null;
let engine: NetEngineImpl | null = null;
let transport: Switchable | null = null;
const system: string[] = [];

const need = (): NetEngineImpl => {
  if (!engine) throw new Error('call __netHarness.start first');
  return engine;
};

const harness = {
  /**
   * This page's identity: with `persist`, the profile's key pair from IndexedDB (store/identity.ts, created on first
   * visit); without, a fresh non-extractable ECDSA P-256 key pair kept in memory (Playwright's WebKit hangs when a
   * CryptoKey is written to IndexedDB, so WebKit specs use this).
   */
  async identity(nickname: string, persist = true): Promise<{ peerId: string; pubKey: string }> {
    let keyPair: CryptoKeyPair;
    let peerId: string;
    if (persist) {
      const stores = await openStores();
      const rec = await stores.identity.get();
      stores.close();
      keyPair = rec.keyPair;
      peerId = rec.peerId;
    } else {
      keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      peerId = await peerIdOfPubKey(base64url(new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))));
    }
    identity = await createNetIdentity(keyPair, peerId, nickname);
    return { peerId: identity.peerId, pubKey: identity.pubKey };
  },
  /** Leave cleanly (bye), as closing the tab does. */
  close(): void {
    need().leave();
  },
  /**
   * Join room `room` with a fresh seq-0 table whose seats are held by `peers`, in order, over BroadcastChannel
   * ('local') or Trystero on public Nostr relays ('trystero': only in the @network smoke bundle, ./smoke-page.ts).
   */
  async start(room: string, peers: string[], kind: 'local' | 'trystero' = 'local'): Promise<void> {
    if (!identity) throw new Error('call __netHarness.identity first');
    const state = createTable({ game: GAME, format: '1v1', seats: peers.map((peer, i) => ({ name: `P${i}`, colour: i, peer })) });
    const trystero = (window as unknown as { __trysteroTransport?: () => Transport }).__trysteroTransport;
    if (kind === 'trystero' && !trystero) throw new Error('the Trystero transport is only in the @network smoke bundle');
    transport = new Switchable(kind === 'trystero' && trystero ? trystero() : new BroadcastTransport(`${identity.peerId}-${Math.random().toString(36).slice(2, 8)}`));
    engine = createNetEngine({ transport, roomId: room, roomKey: 'test-key', identity, game: GAME, start: { snapshot: { seq: 0, state }, tail: [] } }) as NetEngineImpl;
    engine.onSystem((_l, text) => system.push(text));
    const e = engine;
    const t = transport;
    registerDebug({
      state: () => e.state(),
      dispatch: (a: Action) => {
        e.propose(a);
      },
      net: {
        messages: () => e.messages(),
        sequencer: () => e.sequencerId() ?? '',
        self: () => e.identity.peerId,
        peers: () => e.peers(),
        status: () => e.status(),
        seq: () => e.seq(),
        clearMessages: () => undefined,
        kill: () => {
          t.silent = true;
        },
        revive: async () => {
          t.silent = false;
        },
        close: () => e.leave(),
      },
    });
    await e.join();
  },
  propose(a: Action): boolean {
    return need().propose(a);
  },
  /** The confirmed state's hash (the value peers exchange every 50 actions). */
  hash(): string {
    return sha256Sync(canonicalJson(need().confirmedState()));
  },
  info(): { status: string; seq: number; sequencer: string | null; sequencing: boolean; seat: string | null; pending: number; peers: number; system: string[] } {
    const e = need();
    return {
      status: e.status(),
      seq: e.seq(),
      sequencer: e.sequencerId(),
      sequencing: e.isSequencing(),
      seat: e.seat(),
      pending: e.pendingActions().length,
      peers: e.peers().filter((p) => p.status === 'connected').length,
      system: [...system],
    };
  },
};

(window as unknown as { __netHarness: typeof harness }).__netHarness = harness;
document.body.dataset.ready = '1';
