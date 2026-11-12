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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../src/core/commit';
import type { LobbySettings, SecretStore } from '../../../src/core/types';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { packLeakScan } from '../../leak/draft';
import { closeAll, FAKE_TIMERS, net, observedBy, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { both, deckOfFirst, reload, seatedPair, stageIs, startDraft, type Evening } from './evening';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 300 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };
const SEALED: LobbySettings = { draft: { format: 'sealed', packs: 3 }, sets: ['M19'], pickTimer: false };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
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
