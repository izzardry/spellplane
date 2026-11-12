/**
 * Pass drafts and sealed pools on a simulated network (PLAN M2-P2; "Quality gates": every protocol feature gets a
 * simulated-network test with delay, drop, reordering and peer loss). Each seat is a MiniPeer (tests/leak/minitable.ts)
 * on a LoopbackNetwork with a `DraftHost` over it, as the session (M2-P7) will provide one: an optimistic view (the
 * confirmed state plus the own pending proposals), the pack-seed round (shuffleCommit with purpose 'pack' on the own
 * pack zone, the other seats' nonces from the Player client, shuffleDone), the pair channel of net/private.ts for the
 * pack hand-over, the recorded M19/M20/M21 booster data and M2-P1's real pack generator (data/packs.ts).
 */
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../../../src/core/actions';
import type { RevealedCard } from '../../../../src/core/commit';
import { nonceHash } from '../../../../src/core/commit';
import { createDraftState } from '../../../../src/core/drafting';
import { createTable, reduce } from '../../../../src/core/reducer';
import { orderHash, shufflePeerNonces, shuffleReady, shuffleSeed } from '../../../../src/core/rng';
import { emptySecretStore } from '../../../../src/core/secrets';
import type { DraftFormatSettings, Format, LobbySettings, SecretStore, SeatId, TableState } from '../../../../src/core/types';
import { generatePack } from '../../../../src/data/packs';
import type { SetData, SetDataSource } from '../../../../src/data/types';
import { DRAFT_DRIVERS } from '../../../../src/draft/index';
import { POOL_KEY } from '../../../../src/draft/secret';
import type { DraftDriver, DraftHost } from '../../../../src/draft/types';
import { mtg } from '../../../../src/games/index';
import { LoopbackNetwork, type LoopbackOptions } from '../../../../src/net/loopback';
import { privateChannelOver } from '../../../../src/net/private';
import type { SequencedAction } from '../../../../src/net/messages';
import type { PrivateChannel } from '../../../../src/net/types';
import { mulberry32 } from '../../../../src/util/prng';
import { testEntropy } from '../../../leak/fixtures';
import { MiniPeer, Player } from '../../../leak/minitable';
import { fixtureSet } from '../open/net';

function fixtureSets(): SetDataSource {
  const data = new Map<string, SetData>();
  const get = (code: string): SetData => {
    if (!data.has(code)) data.set(code, fixtureSet(code));
    return data.get(code)!;
  };
  return { listSets: async () => [], get: async (code) => get(code), peek: (code) => get(code) };
}

/** One browser in the draft. */
export interface PassSeat {
  seat: SeatId;
  peer: MiniPeer;
  player: Player;
  host: DraftHost;
  driver: DraftDriver;
  /** The pair channel of this browser (replaced by a reload). */
  channel(): PrivateChannel;
  /** The own secret store as the host keeps it. */
  secrets(): SecretStore;
  /** A reload: the driver and the pair channel are dropped and recreated over the same (persisted) secret store. */
  reload(): void;
  /** Stop the bot of this seat (it picks only when told, or the pick timer picks for it). */
  idle: boolean;
}

export interface PassNet {
  net: LoopbackNetwork;
  seats: PassSeat[];
  /** The table every seat started from (the draft stage, nothing drafted yet). */
  start: TableState;
}

const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];
const FORMATS: Record<number, Format> = { 2: '1v1', 3: 'ffa3', 4: 'ffa4' };

/** Wait until `done()` holds, re-checked after every sequenced action of `peer`. */
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

function makeHost(peer: MiniPeer, entropySeed: number, channel: () => PrivateChannel, store: { secrets: SecretStore }): DraftHost {
  const entropy = testEntropy(entropySeed);
  const pending = (): readonly Action[] => peer.host().pending?.() ?? [];
  let seeds = 0;
  const act = async (draft: ActionDraft): Promise<void> => {
    const a = peer.stamp(draft);
    const why = await peer.propose(a);
    if (why !== null) throw new Error(`${a.type} refused: ${why}`);
  };
  return {
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
    sendPack: (to, packId, cards) => channel().sendPack(to, packId, cards),
    onPack: (l) => channel().onPack(l),
    onSequenced: (l) => peer.onSequenced((a) => l(a, peer.state)),
    sets: fixtureSets(),
    generatePack,
    entropy,
  };
}

export interface PassNetOptions {
  net?: LoopbackOptions;
  sets?: string[];
  pickTimer?: boolean;
}

/** `seats` seats in the draft stage of `draft` on one LoopbackNetwork (s0 sequences), each with its format driver. */
export async function passNet(seats: number, draft: DraftFormatSettings, options: PassNetOptions = {}): Promise<PassNet> {
  const net = new LoopbackNetwork(options.net ?? {});
  const t = createTable({ game: mtg, format: FORMATS[seats]!, seats: NAMES.slice(0, seats).map((name, i) => ({ name, colour: i, peer: `p${i}` })) });
  const lobby: LobbySettings = { draft, sets: options.sets ?? ['M19'], pickTimer: options.pickTimer ?? false };
  const start: TableState = { ...t, stage: 'draft', lobby, draft: createDraftState(t, lobby, 0)! };
  const seatMap = Object.fromEntries(NAMES.slice(0, seats).map((_, i) => [`s${i}`, `p${i}`]));
  const out: PassSeat[] = [];
  for (let i = 0; i < seats; i++) {
    const peer = new MiniPeer(net, `p${i}`, `s${i}`, seatMap, 'p0', start);
    await peer.join();
    const player = new Player(peer, testEntropy(500 + i));
    const store = { secrets: emptySecretStore(peer.seatId) };
    let channel = privateChannelOver(peer.host());
    const host = makeHost(peer, 900 + i, () => channel, store);
    const seat: PassSeat = {
      seat: `s${i}`,
      peer,
      player,
      host,
      driver: DRAFT_DRIVERS[draft.format](host),
      channel: () => channel,
      secrets: () => store.secrets,
      idle: false,
      reload() {
        seat.driver.dispose();
        store.secrets = JSON.parse(JSON.stringify(store.secrets)) as SecretStore;
        channel = privateChannelOver(peer.host());
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

/** A bot that confirms the marked cards, or else random ones, about every other tick (so queues build up). */
export function randomBot(seed: number): (s: PassSeat) => void {
  const rand = mulberry32(seed);
  return (s) => {
    if (s.idle) return;
    const v = s.driver.view();
    if (v.pack === null || v.picks === 0 || rand() < 0.5) return;
    const chosen = v.marked.length === v.picks ? [...v.marked] : [];
    if (chosen.length === 0) {
      const ids = v.pack.cards.map((c) => c.id);
      while (chosen.length < v.picks) {
        const id = ids[Math.floor(rand() * ids.length)]!;
        if (!chosen.includes(id)) chosen.push(id);
      }
    }
    s.driver.mark(chosen);
    if (!s.driver.pick(chosen)) throw new Error(`${s.seat} could not pick ${chosen.join(',')}`);
  };
}

/** Advance fake timers, letting every seat drive and act through `bot`, until the draft is done everywhere and every pack is resolved. */
export async function runDraft(t: PassNet, bot: (s: PassSeat) => void, maxMs = 900_000, every?: (elapsed: number) => void | Promise<void>, step = 10): Promise<void> {
  for (let ms = 0; ms <= maxMs; ms += step) {
    for (const s of t.seats) {
      s.driver.drive();
      bot(s);
    }
    await every?.(ms);
    if (t.seats.every((s) => s.peer.state.draft?.done === true && s.peer.state.seq === t.seats[0]!.peer.state.seq && settled(s))) {
      await vi.advanceTimersByTimeAsync(500);
      for (const s of t.seats) s.driver.drive();
      return;
    }
    await vi.advanceTimersByTimeAsync(step);
  }
  throw new Error('the draft did not finish');
}

/**
 * Two seats, one pack each, two picks per pass, the pick timer on (`passNet(2, {format: 'pass', packs: 1, picks: 2},
 * {pickTimer: true})`): s0 picks only on its timer, s1 at once until it owes nothing, then s1 is away until 10 s after
 * the draft ended. 15 cards take visits of 2, 2, …, 2, 1, so the timer takes the last card of s0's pack (its eighth
 * visit, s1's) while s1 is away, and s1 asks for it once it is back. Returns whether s1 came back.
 */
export async function runAwayAtLastVisit(t: PassNet): Promise<boolean> {
  const [a, b] = t.seats as [PassSeat, PassSeat];
  a.idle = true;
  const bot = randomBot(12);
  let killedAt = -1;
  let doneAt = -1;
  let revived = false;
  await runDraft(
    t,
    (s) => {
      if (s === b && killedAt < 0) {
        const v = b.driver.view();
        if (v.pack !== null) b.driver.pick(v.pack.cards.slice(0, v.picks).map((c) => c.id));
      } else if (s !== b) bot(s);
    },
    4_000_000,
    (ms) => {
      const d = a.peer.state.draft!;
      const own = Object.values(d.packs).find((p) => p.opener === 's0');
      const theirs = Object.values(d.packs).find((p) => p.opener === 's1');
      // s1 leaves once it owes nothing: its pack's last visit is s0's, and s0's pack is at s0 for its seventh visit.
      if (killedAt < 0 && own !== undefined && theirs !== undefined && theirs.picks >= 7 && own.holder === 's0' && own.picks === 6) {
        killedAt = ms;
        b.idle = true;
        t.net.kill(b.peer.peerId);
      }
      if (killedAt >= 0 && doneAt < 0 && d.done) doneAt = ms;
      if (doneAt >= 0 && !revived && ms - doneAt > 10_000) {
        revived = true;
        t.net.revive(b.peer.peerId);
      }
    },
    100,
  );
  return revived;
}

/** Whether a seat's pool covers every card the shared state counts for it. */
function settled(s: PassSeat): boolean {
  return poolOf(s).length === (s.peer.state.draft?.pools[s.seat] ?? -1);
}

/** The own picks of a seat with ids, in pick order. */
export function poolOf(s: PassSeat): RevealedCard[] {
  return s.secrets().draft?.held[POOL_KEY] ?? [];
}

/** Every card each seat generated, by pack id. */
export function generatedPacks(t: PassNet): Map<string, { opener: SeatId; cards: RevealedCard[] }> {
  const out = new Map<string, { opener: SeatId; cards: RevealedCard[] }>();
  for (const s of t.seats) for (const g of s.secrets().draft?.generated ?? []) out.set(g.packId, { opener: s.seat, cards: g.cards });
  return out;
}

/** Leave the network. */
export function close(t: PassNet): void {
  for (const s of t.seats) {
    s.driver.dispose();
    s.peer.leave();
  }
}

/** One holder's turn at a pack, reconstructed from the public log and the owners' own records. */
export interface Visit {
  packId: string;
  holder: SeatId;
  /** Taken by the holder's `pick`, or by the sequencer's `draftTimeout`. */
  kind: 'pick' | 'timeout';
  seq: number;
  /** Picks taken from the pack before this one. */
  picks: number;
  count: number;
  /** The pack's cards as the holder held them, in pack order. */
  before: string[];
  /** The cards the holder took, in pick order. */
  taken: string[];
}

/**
 * Every visit of every pack in log order: the pack's cards at that point (its generated cards minus those taken at
 * earlier visits) and the cards the holder took (the next `count` cards of that pack in the holder's own pool). Taken
 * from the owners' side only (generated records, pools), never from what a receiver was sent.
 */
export function visits(t: PassNet): Visit[] {
  return visitsOf(t.start, t.seats[0]!.peer.log(), generatedPacks(t), new Map(t.seats.map((s) => [s.seat, poolOf(s).map((c) => c.instanceId)])));
}

/**
 * `visits` over any table: `log` is every sequenced action after `start` (a state before the draft started), `packs`
 * every seat's generated packs by pack id and `pools` every seat's picks (instance ids) in pick order.
 */
export function visitsOf(start: TableState, log: readonly SequencedAction[], packs: ReadonlyMap<string, { cards: readonly RevealedCard[] }>, pools: ReadonlyMap<SeatId, readonly string[]>): Visit[] {
  const used = new Map<string, number>();
  const gone = new Map<string, Set<string>>();
  const out: Visit[] = [];
  let state = start;
  for (const a of log) {
    const before = state;
    state = reduce(state, a);
    if (a.type !== 'pick' && a.type !== 'draftTimeout') continue;
    if (state === before) continue;
    const pack = before.draft!.packs[a.packId]!;
    const holder = pack.holder!;
    const count = pack.count - state.draft!.packs[a.packId]!.count;
    const cards = packs.get(a.packId)!.cards.map((c) => c.instanceId);
    const taken = gone.get(a.packId) ?? new Set<string>();
    const inPack = new Set(cards);
    const key = `${holder}|${a.packId}`;
    const mine = pools.get(holder)!.filter((id) => inPack.has(id));
    const k = used.get(key) ?? 0;
    const took = mine.slice(k, k + count);
    used.set(key, k + count);
    out.push({ packId: a.packId, holder, kind: a.type === 'pick' ? 'pick' : 'timeout', seq: a.seq, picks: pack.picks, count, before: cards.filter((id) => !taken.has(id)), taken: took });
    for (const id of took) taken.add(id);
    gone.set(a.packId, taken);
  }
  return out;
}

/** The `pack` pair message in a delivered or received message, or null. */
export function packMessage(msg: unknown): { packId: string; cards: RevealedCard[] } | null {
  const m = msg as { t?: unknown; packId?: unknown; cards?: unknown };
  return m.t === 'pack' && typeof m.packId === 'string' && Array.isArray(m.cards) ? { packId: m.packId, cards: m.cards as RevealedCard[] } : null;
}
