/**
 * Two-Headed Giant drafts and sealed pools on a simulated network (PLAN M3-P2; "Quality gates": every protocol feature
 * gets a simulated-network test with delay, drop, reordering and peer loss). Four MiniPeers (tests/leak/minitable.ts)
 * on a LoopbackNetwork, teams t0 = s0 + s1 and t1 = s2 + s3, each with a `DraftHost` as the session provides one (as in
 * tests/sim/draft/open/net.ts): an optimistic view, the pack-seed round with the other seats' nonces from the Player
 * client, the `draftCards` pair message (net/draftcards.ts), the recorded MTGJSON booster data and M2-P1's real pack
 * generator.
 */
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { nonceHash, type RevealedCard } from '../../../src/core/commit';
import { createDraftState } from '../../../src/core/drafting';
import { reduce } from '../../../src/core/reducer';
import { orderHash, shufflePeerNonces, shuffleReady, shuffleSeed } from '../../../src/core/rng';
import { emptySecretStore } from '../../../src/core/secrets';
import type { DraftFormatSettings, LobbySettings, SecretStore, SeatId, TableState } from '../../../src/core/types';
import { generatePack } from '../../../src/data/packs';
import type { SetData, SetDataSource } from '../../../src/data/types';
import { DRAFT_DRIVERS } from '../../../src/draft/index';
import { TEAM_POOL } from '../../../src/draft/team';
import type { DraftDriver, DraftHost } from '../../../src/draft/types';
import { draftCardsOver } from '../../../src/net/draftcards';
import { LoopbackNetwork, type LoopbackOptions } from '../../../src/net/loopback';
import { mulberry32 } from '../../../src/util/prng';
import { testEntropy } from '../../leak/fixtures';
import { MiniPeer, Player } from '../../leak/minitable';
import { fixtureSet } from '../draft/open/net';
import { teamTable } from '../../unit/teams/helpers';

function fixtureSets(): SetDataSource {
  const data = new Map<string, SetData>();
  const get = (code: string): SetData => {
    if (!data.has(code)) data.set(code, fixtureSet(code));
    return data.get(code)!;
  };
  return { listSets: async () => [], get: async (code) => get(code), peek: (code) => get(code) };
}

/** One browser of the Two-Headed Giant draft. */
export interface TeamSeat {
  seat: SeatId;
  team: string;
  peer: MiniPeer;
  player: Player;
  host: DraftHost;
  driver: DraftDriver;
  secrets(): SecretStore;
  /** A reload: the driver is disposed and recreated over the same (persisted) secret store. */
  reload(): void;
  /** The bot leaves this seat alone (its teammate picks for the team). */
  idle: boolean;
}

export interface TeamNet {
  net: LoopbackNetwork;
  seats: TeamSeat[];
  start: TableState;
}

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
      const sid = `${peer.seatId}-pk${entropySeed}-${++seeds}`;
      const nonce = entropy.salt();
      await act({ type: 'shuffleCommit', sid, zone: `pack:${peer.seatId}`, h: nonceHash(nonce), purpose: 'pack' });
      await whenSequenced(peer, () => shuffleReady(peer.state, sid));
      const peerNonces = shufflePeerNonces(peer.state, sid);
      await act({ type: 'shuffleDone', sid, orderHash: orderHash([], nonce) });
      return { sid, seed: shuffleSeed(nonce, peerNonces), ownerNonce: nonce, peerNonces };
    },
    sendPack: () => {
      throw new Error('Two-Headed Giant packs travel as draftCards');
    },
    onPack: () => () => undefined,
    sendCards: (to, about, list) => cards.send(to, about, list),
    onCards: (l) => cards.on(l),
    onSequenced: (l) => peer.onSequenced((a) => l(a, peer.state)),
    sets: fixtureSets(),
    generatePack,
    entropy,
  };
  return { host, store };
}

/** The four seats in the draft stage of `draft` on one LoopbackNetwork (s0 sequences), each with its format driver. */
export async function teamNet(draft: DraftFormatSettings, options: LoopbackOptions = {}, sets: string[] = ['M19'], pickTimer = false): Promise<TeamNet> {
  const net = new LoopbackNetwork(options);
  const t = teamTable();
  const lobby: LobbySettings = { draft, sets, pickTimer };
  const start: TableState = { ...t, stage: 'draft', lobby, draft: createDraftState(t, lobby, 0)! };
  const seatMap = { s0: 'p0', s1: 'p1', s2: 'p2', s3: 'p3' };
  const out: TeamSeat[] = [];
  for (let i = 0; i < 4; i++) {
    const peer = new MiniPeer(net, `p${i}`, `s${i}`, seatMap, 'p0', start);
    await peer.join();
    const player = new Player(peer, testEntropy(500 + i));
    const { host, store } = makeHost(peer, 900 + i);
    const seat: TeamSeat = {
      seat: `s${i}`,
      team: start.seats[`s${i}`]!.team!,
      peer,
      player,
      host,
      driver: DRAFT_DRIVERS[draft.format](host),
      secrets: () => store.secrets,
      idle: false,
      reload() {
        seat.driver.dispose();
        store.secrets = JSON.parse(JSON.stringify(store.secrets)) as SecretStore;
        seat.driver = DRAFT_DRIVERS[draft.format](host);
        seat.driver.drive();
      },
    };
    peer.onSequenced(() => setTimeout(() => seat.driver.drive(), 0));
    out.push(seat);
  }
  return { net, seats: out, start };
}

/** A bot that, about every third tick, confirms random cards of the team's front pack from either teammate (so teammates sometimes race). */
export function teamBot(seed: number): (s: TeamSeat) => void {
  const rand = mulberry32(seed);
  return (s) => {
    if (s.idle) return;
    const v = s.driver.view();
    if (v.pack === null || v.picks === 0 || rand() < 0.66) return;
    const ids = v.pack.cards.map((c) => c.id);
    const chosen: string[] = [];
    while (chosen.length < v.picks) {
      const id = ids[Math.floor(rand() * ids.length)]!;
      if (!chosen.includes(id)) chosen.push(id);
    }
    s.driver.mark(chosen);
    s.driver.pick(chosen);
  };
}

/** The team pool a seat holds, with ids, in pool order. */
export function poolOf(s: TeamSeat): RevealedCard[] {
  return s.secrets().draft?.held[TEAM_POOL] ?? [];
}

/** Whether every seat's pool covers what the table counts for its team. */
function settled(t: TeamNet): boolean {
  return t.seats.every((s) => poolOf(s).length === (s.peer.state.draft?.pools[s.team] ?? -1));
}

/** Advance fake timers, letting every seat drive and act through `bot`, until the draft is done everywhere and every pool is complete. */
export async function runTeamDraft(t: TeamNet, bot: (s: TeamSeat) => void, maxMs = 900_000, every?: (elapsed: number) => void, step = 10): Promise<void> {
  for (let ms = 0; ms <= maxMs; ms += step) {
    for (const s of t.seats) {
      s.driver.drive();
      bot(s);
    }
    every?.(ms);
    if (t.seats.every((s) => s.peer.state.draft?.done === true && s.peer.state.seq === t.seats[0]!.peer.state.seq) && settled(t)) {
      await vi.advanceTimersByTimeAsync(500);
      for (const s of t.seats) s.driver.drive();
      return;
    }
    await vi.advanceTimersByTimeAsync(step);
  }
  throw new Error(`the draft did not finish: pools ${t.seats.map((s) => `${s.seat} ${poolOf(s).length}/${s.peer.state.draft?.pools[s.team]}`).join(', ')}, done ${t.seats.map((s) => s.peer.state.draft?.done).join(',')}`);
}

/** Every card each seat generated, by seat. */
export function generatedBy(s: TeamSeat): RevealedCard[] {
  return (s.secrets().draft?.generated ?? []).flatMap((g) => g.cards);
}

/** Leave the network. */
export function close(t: TeamNet): void {
  for (const s of t.seats) {
    s.driver.dispose();
    s.peer.leave();
  }
}
