/**
 * Spectator sessions on a LoopbackNetwork next to the networked sessions of tests/sim/session/harness.ts (PLAN M3-P5).
 * Test files must `vi.mock('../../../src/net/identity', …)` themselves (vi.mock is hoisted per file).
 */
import type { LoopbackNetwork } from '../../../src/net/loopback';
import { openSpectatorSession, type SpectatorTable } from '../../../src/session/spectator';
import { mtg } from '../../../src/games/index';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { cards, dump, hashOf, KEY, ROOM, settle } from '../session/harness';

/** A spectator's browser: its own (unused) stores, to show that watching writes nothing. */
export interface Watcher {
  name: string;
  peerId: string;
  stores: LocalStores;
  session: SpectatorTable;
}

let n = 0;

/** Open a spectator's page on `network` for the harness room and wait until it joined. */
export async function watch(network: LoopbackNetwork, name: string, peerId: string, nickname = name, opts: { captions?: boolean } = {}): Promise<Watcher> {
  const stores = await openStores(`watch-${name}-${++n}-${Math.random().toString(36).slice(2, 8)}`);
  const session = await settle(
    openSpectatorSession({
      game: mtg,
      cardData: cards(),
      roomId: ROOM,
      roomKey: KEY,
      transport: () => network.create(peerId),
      identity: { keyPair: {} as CryptoKeyPair, peerId, nickname, seatColour: 0 },
      store: stores.tables,
      role: 'spectator',
      // Captions are shown only (session/captions.ts watchCaptions): no engine, no microphone.
      ...(opts.captions ? { voice: { media: {} as never, settings: stores.settings, engines: [] } } : {}),
    }),
    30_000,
    `${name} to join as a spectator`,
  );
  return { name, peerId, stores, session };
}

/** What spectator `w` could have seen: every message delivered to it or recorded in, its state, log, secrets and IndexedDB. */
export async function observedByWatcher(network: LoopbackNetwork, w: Watcher): Promise<unknown[]> {
  const s = w.session;
  const delivered = network.delivered.filter((d) => d.to === w.peerId).map((d) => d.msg);
  const received = s.engine.messages().filter((r) => r.dir === 'in');
  return [...delivered, ...received, s.getState(), s.engine.confirmedState(), s.log(), s.secrets(), ...(await dump(w.stores))];
}

/** The spectator's confirmed state matches `hash` with nothing pending. */
export function watching(w: Watcher, hash: string): boolean {
  return w.session.engine.pending().length === 0 && hashOf(w.session.engine.confirmedState()) === hash;
}

export function closeWatchers(ws: readonly Watcher[]): void {
  for (const w of ws) {
    w.session.leave();
    w.stores.close();
  }
}
