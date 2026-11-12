/**
 * Browser entry for the Two-Headed Giant Playwright specs (tests/e2e/teams/*.spec.ts): bundled from source by
 * ./bundle.ts and served on the app's own origin. Each page opens the real networked session (session/net.ts) at a
 * Two-Headed Giant table over BroadcastChannel, with its own `?profile=` (IndexedDB and key pair, Web Crypto), the
 * recorded Core Set 2019 card data (tests/fixtures) and placeholder faces, and mounts the real table HUD
 * (ui/Hud.svelte, with the teammate's hand fan and the chat panel) over a recording scene. The table format is chosen
 * at creation, since the lobby's format choice (`formatSet`) belongs to M3-P1. window.__teamHarness drives it;
 * everything it returns is plain JSON.
 */
import { mount } from 'svelte';
import cards from '../../fixtures/scryfall/m19.json';
import type { InstanceId, SeatId } from '../../../src/core/types';
import { createFaceSource } from '../../../src/data/faces';
import type { CardData } from '../../../src/data/types';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import { mtg } from '../../../src/games/index';
import { BroadcastTransport } from '../../../src/net/broadcast';
import { liveIdentity } from '../../../src/session/live-identity';
import { openNetSession, type NetTable } from '../../../src/session/net';
import type { DeckImport } from '../../../src/session/types';
import { STORE_NAMES } from '../../../src/store/db';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { paper } from '../../../src/themes/paper/index';
import { RecordingScene } from '../../../src/ui/fakes';
import Hud from '../../../src/ui/Hud.svelte';

const all = cards as unknown as CardData[];
const cardData = new FixtureCardDataSource(all);
const faces = createFaceSource(cardData, 'placeholder');

/** Four 40-card decks of distinct printings, one per seat (no printing in two decks, so a Scryfall id is evidence). */
function deck(i: number): DeckImport {
  const ids = all
    .filter((c) => !/Token/.test(c.type_line ?? ''))
    .map((c) => c.id)
    .sort();
  return { main: ids.slice(i * 40, i * 40 + 40).map((sid) => ({ sid })), side: [] };
}

let session: NetTable | null = null;
let stores: LocalStores | null = null;
const need = (): NetTable => {
  if (!session) throw new Error('call __teamHarness.start first');
  return session;
};

const harness = {
  async start(room: string, key: string, name: string, colour: number, first: boolean): Promise<SeatId> {
    stores = await openStores();
    const live = liveIdentity(stores.identity);
    await live.store.setNickname(name);
    await live.store.setSeatColour(colour);
    const identity = await live.identity();
    session = await openNetSession(
      { game: mtg, cardData, roomId: room, roomKey: key, transport: () => new BroadcastTransport(`${identity.peerId}-${Math.random().toString(36).slice(2, 8)}`), identity, store: stores.tables, format: '2hg' },
      { createdHere: first, loneWaitMs: 0 },
    );
    const host = document.getElementById('app')!;
    // As the HUD harness (src/ui/harness.ts) mounts it.
    document.documentElement.style.cssText = 'margin:0;height:100%;overflow:hidden';
    document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#fff';
    mount(Hud, { target: host, props: { session, createScene: () => new RecordingScene(), faces, cardData, game: mtg, theme: paper } });
    return session.seat;
  },
  seat: (): SeatId => need().seat,
  async ready(i: number): Promise<void> {
    await need().importDeck(deck(i));
  },
  shuffle: (): Promise<void> => need().shuffle(),
  draw: (n: number): Promise<void> => need().draw(n),
  /** Own hand in the owner's arrangement with Scryfall ids, as the confirmed state holds it. */
  hand(): { id: InstanceId; sid: string }[] {
    const s = need();
    const zone = new Set(s.engine.confirmedState().zones[`hand:${s.seat}`]!.ids);
    const order = [...s.secrets().hand.filter((id) => zone.has(id)), ...[...zone].filter((id) => !s.secrets().hand.includes(id))];
    return order.map((id) => ({ id, sid: s.secrets().identities[id]!.card.sid }));
  },
  /** Salts and Scryfall ids of the own cards nobody else may know: every own card that is not public. */
  hidden(): string[] {
    const s = need();
    const st = s.engine.confirmedState();
    const out: string[] = [];
    for (const [id, x] of Object.entries(s.secrets().identities)) {
      const c = st.cards[id];
      if (c?.identity && st.zones[c.zone]?.visibility === 'public') continue;
      out.push(x.salt, x.card.sid);
    }
    return out;
  },
  teamHand: (seat: SeatId) => need().team?.hand(seat) ?? [],
  teammates: (): SeatId[] => need().team?.teammates() ?? [],
  play(id: InstanceId): void {
    need().dispatch({ type: 'move', card: id, to: `battlefield:${need().seat}`, pose: { x: 0, y: need().seat === 's0' || need().seat === 's1' ? -200 : 200, rot: 0 } });
  },
  life(seat: SeatId, delta: number): void {
    need().dispatch({ type: 'life', seat, delta });
  },
  teamLife: (): Record<string, number> => Object.fromEntries(Object.values(need().engine.confirmedState().teams).map((t) => [t.id, t.life])),
  sync: (): { seq: number; pending: number; peers: number } => ({ seq: need().engine.seq(), pending: need().engine.pending().length, peers: need().engine.peers().filter((p) => p.status === 'connected').length }),
  /** Everything this page holds or received: incoming messages, state, log, secret store and every IndexedDB record. */
  async observed(): Promise<unknown[]> {
    const s = need();
    const out: unknown[] = [s.engine.messages().filter((r) => r.dir === 'in'), s.getState(), s.engine.confirmedState(), s.log(), s.secrets()];
    for (const name of STORE_NAMES) out.push(...(await stores!.db.getAll(name)));
    return JSON.parse(JSON.stringify(out)) as unknown[];
  },
  /** The seats every received teamHand came from (transport ids start with the sender's identity peer id). */
  teamHandsFrom(): string[] {
    const s = need();
    const seats = Object.values(s.engine.confirmedState().seats);
    const from = s
      .engine.messages()
      .filter((r) => r.dir === 'in' && r.msg.t === 'teamHand')
      .map((r) => seats.find((x) => x.peer !== undefined && r.peer.startsWith(x.peer))?.id ?? `?${r.peer}`);
    return [...new Set(from)].sort();
  },
};

(window as unknown as { __teamHarness: typeof harness }).__teamHarness = harness;
document.body.dataset.ready = '1';
