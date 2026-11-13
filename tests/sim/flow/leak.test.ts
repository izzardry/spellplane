/**
 * The evening's scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario;
 * PLAN M2-P7; DESIGN "Pre-game", Hidden information: sealed "own pool only"; "Multiplayer architecture", Hidden
 * information: a deck is committed, its cards stay with their owner). A sealed evening through the networked session
 * under delay, loss and reordering: both open their pools, build decks, Ready, play the first game (shuffle, draw),
 * go back to the builder for the next game, Anna sideboards, both Ready again and draw, and each page reloads once in
 * the builder and once in the match.
 *
 * Ben must hold no trace of Anna's pool or decks: no salt of a pool card or of either deck's commitments, no Scryfall
 * id of hers that Ben's own pool does not also hold, no opaque id next to its card, no nonce of her pack seeds; in
 * every message Ben received, his state, log, secret store and IndexedDB (tests/leak/draft.ts, the hidden-pack
 * scanner). And the same the other way round.
 *
 * The draft formats with hidden packs run through the same session wiring (session/draft.ts `DraftPort` on NetTable:
 * `sendPack`/`onPack` for the pass draft's hand-overs, `sendCards`/`onCards` for Winston's private pile looks):
 * - A four-seat pass draft (DESIGN "Pre-game", Hidden information: "a pack is visible only to its current holder")
 *   under delay, loss and reordering on every channel, with one page reloaded and another one cut off for a while in
 *   mid-draft, to the builder. What each seat may know is derived from the owners' side and the public log only
 *   (tests/sim/draft/pass/net.ts `visitsOf`): its own packs, and each pack's remaining cards at each of its turns.
 * - A two-seat Winston draft (DESIGN: "pile contents visible to whoever looks"), Ben reloaded in mid-draft, to the
 *   builder. What Ben may know comes from the public log only (tests/sim/draft/open/winston-run.ts `allowedFrom`):
 *   every pile he looked at, at the moment he looked, and every card he took.
 * Each ends with a negative control: one card the observer may not know, sent to it on the pair channel by the real
 * engine, is caught by the same scan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { RevealedCard } from '../../../src/core/commit';
import { canonicalJson } from '../../../src/core/hash';
import { reduce } from '../../../src/core/reducer';
import type { LobbySettings, SecretStore, Stage, TableState } from '../../../src/core/types';
import { POOL_KEY } from '../../../src/draft/secret';
import type { LoopbackNetwork, LoopbackOptions } from '../../../src/net/loopback';
import type { SequencedAction } from '../../../src/net/messages';
import type { NetSessionOptions } from '../../../src/session/types';
import { mulberry32 } from '../../../src/util/prng';
import { packLeakScan } from '../../leak/draft';
import { allowedFrom } from '../draft/open/winston-run';
import { visitsOf } from '../draft/pass/net';
import { browser, closeAll, FAKE_TIMERS, net, observedBy, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { both, deckOfFirst, EVENING_OPTS, openFormatBot, pickWherePossible, reload, seatedPair, stageIs, startDraft, type Evening } from './evening';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 300 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };
const SEALED: LobbySettings = { draft: { format: 'sealed', packs: 3 }, sets: ['M19'], pickTimer: false };

let browsers: Browser[] = [];
/** The transport ids each browser's pages had, in order (`reloadPage` opens a new one). */
const transports = new Map<Browser, string[]>();
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  transports.clear();
  vi.useRealTimers();
});

/** Every hidden card a seat owns now (deck identities), as revealed-card records. */
function deckCards(sec: SecretStore): RevealedCard[] {
  return Object.entries(sec.identities).map(([instanceId, s]) => ({ instanceId, ref: s.card, salt: s.salt }));
}

function generated(sec: SecretStore): RevealedCard[] {
  return (sec.draft?.generated ?? []).flatMap((g) => g.cards);
}

async function readyBoth(e: Evening, decks: Map<string, RevealedCard>[]): Promise<void> {
  await settle(e.A.session!.draft!.ready(), 60_000, 'A ready');
  await settle(e.B.session!.draft!.ready(), 60_000, 'B ready');
  await stageIs(e, 'match', 60_000);
  both(e).forEach((s, i) => {
    for (const c of deckCards(s.secrets())) decks[i]!.set(c.instanceId, c);
  });
  await settle(Promise.all(both(e).map((s) => s.shuffle())), 120_000, 'both shuffles');
  for (const s of both(e)) await settle(s.draw(7), 60_000, 'the opening hand');
  await waitConverged(both(e), 'the opening hands');
}

describe('shared leak test: a sealed evening through the networked session', () => {
  it.each([4, 21])('neither seat learns the other’s pool or decks across builds, games, a rematch and reloads (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const e = await seatedPair(network, browsers);
    await startDraft(e, SEALED);
    await stageIs(e, 'build', 240_000);
    const pools = both(e).map((s) => generated(s.secrets()));
    const nonces = both(e).map((s) => (s.secrets().draft?.generated ?? []).map((g) => g.ownerNonce));
    expect(pools.map((p) => p.length)).toEqual([45, 45]);
    for (const s of both(e)) s.draft!.setBuild(deckOfFirst(s.draft!.build()!, 23));
    await reload(network, e.A);
    const decks = [new Map<string, RevealedCard>(), new Map<string, RevealedCard>()];
    await readyBoth(e, decks);
    await reload(network, e.B);
    await waitConverged(both(e), 'after the reload in the match');

    // The next game: Anna proposes, the pass timer confirms for Ben; Anna sideboards two cards.
    expect(await settle(e.A.session!.evening!.propose('nextGame'), 60_000, 'the next game')).toBe(true);
    await stageIs(e, 'build');
    const a: NetTable = e.A.session!;
    const b = a.draft!.build()!;
    const side = b.cards.filter((c) => !b.main.includes(c.id)).slice(0, 2).map((c) => c.id);
    a.draft!.setBuild({ ...b, main: [...b.main.slice(2), ...side] });
    await reload(network, e.B);
    await readyBoth(e, decks);
    await until(() => both(e).every((s) => s.engine.pending().length === 0), 30_000, 'quiet');
    await settle(Promise.all(both(e).map((s) => s.whenSaved())));

    for (const [i, who] of [
      [0, e.B],
      [1, e.A],
    ] as const) {
      const other = 1 - i;
      const report = packLeakScan({
        observed: await observedBy(network, who),
        others: [...pools[i]!, ...decks[i]!.values()],
        nonces: nonces[i]!,
        allowed: new Set(),
        known: [...pools[other]!, ...decks[other]!.values()],
      });
        expect(report.forbidden).toBeGreaterThan(90);
      expect(report.tokens).toEqual([]);
      expect(report.pairs).toEqual([]);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Hidden packs: a pass draft and a Winston draft through the session
// ---------------------------------------------------------------------------------------------------------------------

/** Every sequenced action of `s`'s log after `seq`, in order. */
function actionsAfter(s: NetTable, seq: number): SequencedAction[] {
  return s.log().flatMap((e) => (e.kind === 'action' && e.seq > seq ? [{ ...e.action, seq: e.seq }] : []));
}

/** `start` with `log` applied, checked against the session's own confirmed table (the replay is the log the scan trusts). */
function replayMatches(start: TableState, log: readonly Action[], s: NetTable): void {
  const end = log.reduce((st, a) => reduce(st, a), start);
  expect(canonicalJson(end.draft)).toBe(canonicalJson(s.engine.confirmedState().draft));
}

/** A `pack` or `draftCards` pair message (net/messages.ts). */
interface CardsMessage {
  t: string;
  packId?: string;
  about?: string;
  cards: RevealedCard[];
}

/** Every pair message of type `t` that `b` received, as the network delivered it and as its session's engine recorded it. */
function pairMessages(network: LoopbackNetwork, b: Browser, t: 'pack' | 'draftCards'): CardsMessage[] {
  const ids = transports.get(b) ?? [b.peerId];
  const all = [
    ...network.delivered.filter((d) => ids.includes(d.to) && d.channel === 'prv').map((d) => d.msg),
    ...b.session!.engine.messages().filter((r) => r.dir === 'in' && r.channel === 'prv').map((r) => r.msg),
  ] as unknown as CardsMessage[];
  return all.filter((m) => m.t === t);
}

function ownPicks(s: NetTable): string[] {
  return (s.secrets().draft?.held[POOL_KEY] ?? []).map((c) => c.instanceId);
}

const PASS: LobbySettings = { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false };
const WINSTON: LobbySettings = { draft: { format: 'winston', packs: 6 }, sets: ['M19'], pickTimer: false };
const ALL_FAULTY: LoopbackOptions = { delay: { min: 0, max: 300 }, drop: 0.05 };
const FOUR = { format: 'ffa4' as const, ...EVENING_OPTS };

describe('shared leak test: hidden packs through the networked session', () => {
  it('a four-seat pass draft shows each seat only the packs it held, at its turn, with a reload and an outage', async () => {
    const network = net({ seed: 17, ...ALL_FAULTY });
    const seated: Browser[] = [];
    for (const [i, name] of ['anna', 'ben', 'cleo', 'dan'].entries()) {
      const b = await browser(name, `peer-${name}`, name, i * 2);
      browsers.push(b);
      seated.push(b);
      await open(network, b, {}, FOUR);
    }
    const tables = (): NetTable[] => seated.map((b) => b.session!);
    await waitConverged(tables(), 'four seated');
    expect(tables().map((s) => s.seat)).toEqual(['s0', 's1', 's2', 's3']);
    const at = async (stage: Stage, maxMs = 60_000): Promise<void> => until(() => tables().every((s) => s.engine.confirmedState().stage === stage), maxMs, `the ${stage} stage`);

    const host = tables()[0]!;
    host.evening!.setLobby(PASS);
    await waitConverged(tables(), 'the lobby settings');
    const start = host.engine.confirmedState();
    host.evening!.start();
    await at('draft');

    // Cleo reloads once she has a pack in front of her; Dan is cut off for five seconds later on.
    const [, , cleo, dan] = seated as [Browser, Browser, Browser, Browser];
    let reloaded = false;
    let cutAt = -1;
    let revived = false;
    for (let ms = 0; !tables().every((s) => s.engine.confirmedState().stage !== 'draft'); ms += 20) {
      if (ms > 900_000) throw new Error('the draft did not finish');
      pickWherePossible(tables());
      if (!reloaded && ms > 2_000 && cleo.session!.draft!.view().pack !== null) {
        reloaded = true;
        await reloadPage(network, cleo, FOUR);
      }
      if (cutAt < 0 && ms > 8_000) {
        cutAt = ms;
        network.kill(dan.peerId);
      }
      if (cutAt >= 0 && !revived && ms - cutAt > 5_000) {
        revived = true;
        network.revive(dan.peerId);
      }
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(reloaded && revived).toBe(true);
    await at('build');
    const d = host.engine.confirmedState().draft!;
    for (const s of tables()) await until(() => ownPicks(s).length === d.pools[s.seat], 60_000, `${s.seat}'s pool`);
    await until(() => tables().every((s) => s.engine.pending().length === 0), 30_000, 'quiet');
    await waitConverged(tables(), 'the end of the draft');
    await settle(Promise.all(tables().map((s) => s.whenSaved())));

    const log = actionsAfter(host, start.seq);
    replayMatches(start, log, host);
    const generated = new Map(tables().map((s) => [s.seat, (s.secrets().draft?.generated ?? []).flatMap((g) => g.cards)] as const));
    const packs = new Map(tables().flatMap((s) => (s.secrets().draft?.generated ?? []).map((g) => [g.packId, g] as const)));
    expect(packs.size).toBe(12);
    const all = visitsOf(start, log, packs, new Map(tables().map((s) => [s.seat, ownPicks(s)])));
    expect(all).toHaveLength(12 * 15);
    const everything = new Map([...generated.values()].flat().map((c) => [c.instanceId, c]));

    for (const b of seated) {
      const s = b.session!;
      const others = tables().filter((x) => x.seat !== s.seat);
      const mine = all.filter((v) => v.holder === s.seat);
      const allowed = new Set([...generated.get(s.seat)!.map((c) => c.instanceId), ...mine.flatMap((v) => v.before)]);
      const report = packLeakScan({
        observed: [...(await observedAcross(network, b)), s.draftView()],
        others: others.flatMap((x) => generated.get(x.seat)!),
        nonces: others.flatMap((x) => (x.secrets().draft?.generated ?? []).map((g) => g.ownerNonce)),
        allowed,
        known: [...allowed].map((id) => everything.get(id)!),
      });
      // A seat never sees the picks taken from another seat's pack before it came round: 1 + 2 + 3 cards per round.
      expect(report.forbidden).toBe(18);
      expect(report.tokens).toEqual([]);
      expect(report.pairs).toEqual([]);
      // Every hand-over the seat received is one of its turns at that pack, exactly as the pack was then.
      const received = pairMessages(network, b, 'pack').filter((m) => m.cards.length > 0);
      expect(received.length).toBeGreaterThan(0);
      for (const m of received) {
        const ids = m.cards.map((c) => c.instanceId).sort().join();
        expect(mine.some((v) => v.packId === m.packId && [...v.before].sort().join() === ids)).toBe(true);
      }
    }

    // Negative control: one card of a pack Ben never held, sent to him on the pair channel by Anna's engine, is caught.
    const [anna, ben] = seated as [Browser, Browser];
    const seen = new Set(all.filter((v) => v.holder === 's1').flatMap((v) => v.before));
    const leaked = generated.get('s0')!.find((c) => !seen.has(c.instanceId))!;
    expect(leaked).toBeDefined();
    expect(anna.session!.engine.sendPrivate('s1', { v: PROTOCOL_VERSION, t: 'pack', packId: 'control', cards: [leaked] })).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const report = packLeakScan({ observed: await observedAcross(network, ben), others: [leaked], nonces: [], allowed: new Set(), known: [] });
    expect(report.tokens.length).toBeGreaterThan(0);
    expect(report.pairs.length).toBeGreaterThan(0);
  }, 600_000);

  it('a Winston draft shows the other player only the piles it looked at and the cards it took, with a reload', async () => {
    const network = net({ seed: 23, ...ALL_FAULTY });
    const e = await seatedPair(network, browsers);
    const host = e.A.session!;
    host.evening!.setLobby(WINSTON);
    await waitConverged(both(e), 'the lobby settings');
    const start = host.engine.confirmedState();
    host.evening!.start();
    await stageIs(e, 'draft');

    const rand = mulberry32(29);
    let reloaded = false;
    for (let ms = 0; !both(e).every((s) => s.engine.confirmedState().stage === 'build'); ms += 20) {
      if (ms > 900_000) throw new Error('the draft did not finish');
      openFormatBot(both(e), rand);
      if (!reloaded && (e.B.session!.engine.confirmedState().draft?.pools.s1 ?? 0) >= 5) {
        reloaded = true;
        await reloadPage(network, e.B, EVENING_OPTS);
      }
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(reloaded).toBe(true);
    const d = host.engine.confirmedState().draft!;
    // Ben's pool catches up with every card he took (one shown after the last look included).
    await until(() => (e.B.session!.secrets().pool?.length ?? 0) === d.pools.s1, 60_000, "Ben's pool");
    await until(() => both(e).every((s) => s.engine.pending().length === 0), 30_000, 'quiet');
    await waitConverged(both(e), 'the end of the draft');
    await settle(Promise.all(both(e).map((s) => s.whenSaved())));

    const log = actionsAfter(host, start.seq);
    replayMatches(start, log, host);
    const dealt = host.secrets().draft!.generated;
    expect(e.B.session!.secrets().draft?.generated ?? []).toEqual([]);
    const stack = dealt.flatMap((g) => g.cards);
    expect(stack).toHaveLength(6 * 15);
    const allowed = allowedFrom(start, log, 's1');
    // The scenario is meaningful: Anna looked at piles Ben never saw, and Ben saw some piles he did not take.
    expect([...allowed].filter((id) => !d.taken!.s1!.includes(id)).length).toBeGreaterThan(0);
    const report = packLeakScan({
      observed: [...(await observedAcross(network, e.B)), e.B.session!.draftView()],
      others: stack,
      nonces: dealt.map((g) => g.ownerNonce),
      allowed,
      known: stack.filter((c) => allowed.has(c.instanceId)),
    });
    expect(report.forbidden).toBeGreaterThan(10);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    // Every draftCards Ben received names cards he may know; Anna receives requests only (no cards).
    const toBen = pairMessages(network, e.B, 'draftCards');
    expect(toBen.length).toBeGreaterThan(0);
    for (const m of toBen) for (const c of m.cards) expect(allowed.has(c.instanceId)).toBe(true);
    for (const m of pairMessages(network, e.A, 'draftCards')) expect(m.cards).toEqual([]);

    // Negative control: one card Ben may not know, sent to him on the pair channel by Anna's engine, is caught.
    const leaked = stack.find((c) => !allowed.has(c.instanceId))!;
    expect(host.engine.sendPrivate('s1', { v: PROTOCOL_VERSION, t: 'draftCards', about: 'control', cards: [leaked] })).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const control = packLeakScan({ observed: await observedAcross(network, e.B), others: [leaked], nonces: [], allowed: new Set(), known: [] });
    expect(control.tokens.length).toBeGreaterThan(0);
    expect(control.pairs.length).toBeGreaterThan(0);
  }, 600_000);
});

/**
 * A reload of `b`'s page as a browser does one: everything is saved, the page is gone, and the link is opened again
 * with the same storage and identity, on a new transport (Trystero gives every page load its own id, so nothing the
 * old page was sent can reach the new one).
 */
async function reloadPage(network: LoopbackNetwork, b: Browser, opts: Partial<NetSessionOptions>): Promise<NetTable> {
  const s = b.session!;
  await settle(s.whenSaved());
  s.leave();
  b.session = null;
  const ids = transports.get(b) ?? [b.peerId];
  const id = `${b.peerId}~${ids.length}`;
  transports.set(b, [...ids, id]);
  return open(network, b, {}, { ...opts, transport: () => network.create(id) });
}

/** What browser `b` could have seen (session/harness.ts `observedBy`), over every transport its pages had. */
async function observedAcross(network: LoopbackNetwork, b: Browser): Promise<unknown[]> {
  const ids = new Set(transports.get(b) ?? [b.peerId]);
  return [...network.delivered.filter((d) => ids.has(d.to)).map((d) => d.msg), ...(await observedBy(network, b))];
}
