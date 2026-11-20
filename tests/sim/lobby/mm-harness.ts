/** Matchmakers over a loopback lobby (M8-P7 sims): real stores (fake IndexedDB), the fake identity, fake timers. */
import type { LoopbackNetwork } from '../../../src/net/loopback';
import { createMatchmaker, type MatchmakerControl } from '../../../src/session/matchmaker';
import type { MatchmakerStatus } from '../../../src/session/types';
import type { LocalStores } from '../../../src/store/stores';
import { mulberry32 } from '../../../src/util/prng';
import { fakeNetIdentity } from '../net/fake-identity';

export interface MmPage {
  mm: MatchmakerControl;
  hashes: string[];
  phases: MatchmakerStatus['phase'][];
  statuses: MatchmakerStatus[];
}

let n = 0;
export function mmPage(net: LoopbackNetwork, name: string, peerId: string, stores: LocalStores): MmPage {
  const rand = mulberry32(++n * 104729);
  const page: MmPage = { mm: null as unknown as MatchmakerControl, hashes: [], phases: [], statuses: [] };
  page.mm = createMatchmaker({
    settings: stores.settings,
    decks: stores.decks,
    ratings: stores.ratings,
    matches: stores.matches,
    games: stores.games,
    identity: () => Promise.resolve(fakeNetIdentity(peerId, name)),
    transport: () => net.create(`${name}-lobby-${++n}`),
    navigate: (h) => page.hashes.push(h),
    random: (k) => Uint8Array.from({ length: k }, () => Math.floor(rand() * 256)),
    followRoutes: false,
  });
  page.mm.subscribe((s) => {
    page.statuses.push(s);
    if (page.phases[page.phases.length - 1] !== s.phase) page.phases.push(s.phase);
  });
  return page;
}
