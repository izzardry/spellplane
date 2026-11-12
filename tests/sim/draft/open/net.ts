/**
 * Open-format drafts on a simulated network (PLAN M2-P3; "Quality gates": every protocol feature gets a
 * simulated-network test with delay, drop and reordering). Each seat is a MiniPeer (tests/leak/minitable.ts) on a
 * LoopbackNetwork with a `DraftHost` over it, as the session (M2-P7) will provide one: an optimistic view (the
 * confirmed state plus the own pending proposals), the pack-seed round (shuffleCommit with purpose 'pack' on the own
 * pack zone, the other seats' nonces, shuffleDone), the `draftCards` pair channel (net/draftcards.ts), fixture set
 * data and a fixture pack generator. The other seats' nonces come from the Player client of minitable.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../../../src/core/actions';
import { nonceHash } from '../../../../src/core/commit';
import { createDraftState } from '../../../../src/core/drafting';
import { createTable, reduce } from '../../../../src/core/reducer';
import { orderHash, shufflePeerNonces, shuffleReady, shuffleSeed } from '../../../../src/core/rng';
import { emptySecretStore } from '../../../../src/core/secrets';
import type { DraftFormatSettings, Format, LobbySettings, SecretStore, SeatId, TableState } from '../../../../src/core/types';
import type { GeneratePack, SetCardInfo, SetData, SetDataSource } from '../../../../src/data/types';
import { DRAFT_DRIVERS } from '../../../../src/draft/index';
import type { DraftDriver, DraftHost } from '../../../../src/draft/types';
import { mtg } from '../../../../src/games/index';
import { draftCardsOver } from '../../../../src/net/draftcards';
import { LoopbackNetwork, type LoopbackOptions } from '../../../../src/net/loopback';
import { testEntropy } from '../../../leak/fixtures';
import { MiniPeer, Player } from '../../../leak/minitable';

const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/** M19 from the recorded MTGJSON fixture (tests/fixtures/mtgjson/M19.json), trimmed as SetData. */
export function fixtureSet(code = 'M19'): SetData {
  const raw = JSON.parse(readFileSync(join(FIXTURES, 'mtgjson', `${code}.json`), 'utf8')) as { data: { code: string; name: string; releaseDate: string; booster: Record<string, unknown>; cards: Record<string, SetCardInfo> } };
  const d = raw.data;
  return { code: d.code, name: d.name, releaseDate: d.releaseDate, boosterType: 'draft', booster: d.booster.draft as SetData['booster'], cards: d.cards };
}

/**
 * A stand-in for M2-P1's generator (data/packs.ts): `size` distinct cards of the set drawn from the stream, rarest
 * first. Deterministic for a given stream, like the real one; the open formats only need that.
 */
export function fixtureGenerator(size = 15): GeneratePack {
  const RANK: Record<string, number> = { mythic: 0, rare: 0, uncommon: 1, common: 2 };
  return (set, random) => {
    const uuids = Object.keys(set.cards).sort();
    const chosen: string[] = [];
    while (chosen.length < Math.min(size, uuids.length)) {
      const u = uuids[random.below(uuids.length)]!;
      if (!chosen.includes(u)) chosen.push(u);
    }
    const cards = chosen.map((u) => ({ uuid: u, ref: { sid: set.cards[u]!.scryfallId }, sheet: 'fixture', rarity: set.cards[u]!.rarity }));
    cards.sort((a, b) => (RANK[a.rarity] ?? 3) - (RANK[b.rarity] ?? 3));
    return { set: set.code, cards };
  };
}

function fixtureSets(): SetDataSource {
  const data = new Map<string, SetData>();
  const get = (code: string): SetData => {
    if (!data.has(code)) data.set(code, fixtureSet(code));
    return data.get(code)!;
  };
  return { listSets: async () => [], get: async (code) => get(code), peek: (code) => get(code) };
}

/** One browser in the draft. */
export interface DraftSeat {
  seat: SeatId;
  peer: MiniPeer;
  player: Player;
  host: DraftHost;
  driver: DraftDriver;
  /** The own secret store as the host keeps it. */
  secrets(): SecretStore;
  /** A reload: the driver is disposed and recreated over the same (persisted) secret store. */
  reload(): void;
}

export interface DraftNet {
  net: LoopbackNetwork;
  seats: DraftSeat[];
  /** The table every seat started from (the draft stage, nothing drafted yet). */
  start: TableState;
}

const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];
const FORMATS: Record<number, Format> = { 2: '1v1', 3: 'ffa3', 4: 'ffa4' };

/** Wait until `done()` holds, re-checked after every sequenced action of `peer` (no timers: a driver awaits this inside a timer-advancing test loop). */
function whenSequenced(peer: MiniPeer, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) return resolve();
    const off = peer.onSequenced(() => {
      if (!done()) return;
      off();
      resolve();
    });
  });
}

function makeHost(peer: MiniPeer, entropySeed: number): { host: DraftHost; store: { secrets: SecretStore } } {
  const store = { secrets: emptySecretStore(peer.seatId) };
  const entropy = testEntropy(entropySeed);
  const cards = draftCardsOver({ seat: () => peer.seatId, sendPrivate: (s, m) => peer.sendPrivate(s, m), onPrivate: (l) => peer.onPrivate(l) });
  const pending = (): readonly Action[] => peer.host().pending?.() ?? [];
  let seeds = 0;
  const act = async (draft: ActionDraft): Promise<void> => {
    const a = peer.stamp(draft);
    const why = await peer.propose(a);
    if (why !== null) throw new Error(`${a.type} refused: ${why}`);
  };
  const host: DraftHost = {
    seat: peer.seatId,
    state: () => pending().reduce((s, a) => reduce(s, a), peer.state),
    confirmedState: () => peer.state,
    secrets: () => store.secrets,
    setSecrets: (next) => {
      store.secrets = next;
    },
    dispatch: (draft) => {
      const a = peer.stamp(draft);
      void peer.propose(a);
      return a;
    },
    packSeed: async () => {
      const sid = `${peer.seatId}-pk${++seeds}`;
      const nonce = entropy.salt();
      await act({ type: 'shuffleCommit', sid, zone: `pack:${peer.seatId}`, h: nonceHash(nonce), purpose: 'pack' });
      await whenSequenced(peer, () => shuffleReady(peer.state, sid));
      const peerNonces = shufflePeerNonces(peer.state, sid);
      await act({ type: 'shuffleDone', sid, orderHash: orderHash([], nonce) });
      return { sid, seed: shuffleSeed(nonce, peerNonces), ownerNonce: nonce, peerNonces };
    },
    sendPack: () => {
      throw new Error('open formats hand no packs on');
    },
    onPack: () => () => undefined,
    sendCards: (to, about, list) => cards.send(to, about, list),
    onCards: (l) => cards.on(l),
    onSequenced: (l) => peer.onSequenced((a) => l(a, peer.state)),
    sets: fixtureSets(),
    generatePack: fixtureGenerator(),
    entropy,
  };
  return { host, store };
}

/** `seats` seats in the draft stage of `draft` on one LoopbackNetwork (s0 sequences), each with its format driver. */
export async function draftNet(seats: number, draft: DraftFormatSettings, options: LoopbackOptions = {}, sets: string[] = ['M19']): Promise<DraftNet> {
  const net = new LoopbackNetwork(options);
  const t = createTable({ game: mtg, format: FORMATS[seats]!, seats: NAMES.slice(0, seats).map((name, i) => ({ name, colour: i, peer: `p${i}` })) });
  const lobby: LobbySettings = { draft, sets, pickTimer: false };
  const start: TableState = { ...t, stage: 'draft', lobby, draft: createDraftState(t, lobby, 0)! };
  const seatMap = Object.fromEntries(NAMES.slice(0, seats).map((_, i) => [`s${i}`, `p${i}`]));
  const out: DraftSeat[] = [];
  for (let i = 0; i < seats; i++) {
    const peer = new MiniPeer(net, `p${i}`, `s${i}`, seatMap, 'p0', start);
    await peer.join();
    const player = new Player(peer, testEntropy(500 + i));
    const { host, store } = makeHost(peer, 900 + i);
    const seat: DraftSeat = {
      seat: `s${i}`,
      peer,
      player,
      host,
      driver: DRAFT_DRIVERS[draft.format](host),
      secrets: () => store.secrets,
      reload() {
        seat.driver.dispose();
        store.secrets = JSON.parse(JSON.stringify(store.secrets)) as SecretStore;
        seat.driver = DRAFT_DRIVERS[draft.format](host);
        seat.driver.drive();
      },
    };
    // The session calls drive() after every applied action (deferred here, so it never re-enters the replica).
    peer.onSequenced(() => setTimeout(() => seat.driver.drive(), 0));
    out.push(seat);
  }
  return { net, seats: out, start };
}

/** Advance fake timers, letting every seat drive and act through `bot`, until the draft is done everywhere. */
export async function runDraft(t: DraftNet, bot: (s: DraftSeat) => void, maxMs = 600_000, every?: (elapsed: number) => void): Promise<void> {
  for (let ms = 0; ms <= maxMs; ms += 10) {
    for (const s of t.seats) {
      s.driver.drive();
      bot(s);
    }
    every?.(ms);
    if (t.seats.every((s) => s.peer.state.draft?.done === true && s.peer.state.seq === t.seats[0]!.peer.state.seq)) {
      await vi.advanceTimersByTimeAsync(500);
      return;
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error('the draft did not finish');
}

/** Leave the network. */
export function close(t: DraftNet): void {
  for (const s of t.seats) {
    s.driver.dispose();
    s.peer.leave();
  }
}
