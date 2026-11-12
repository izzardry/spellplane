/**
 * PLAN M2-P7 acceptance, simulated network: "A reload in each stage returns to that stage with the same pool, deck and
 * table" — through a whole evening on one link (DESIGN "Pre-game: draft, sealed and deck building": "An evening moves
 * through four stages on one link: lobby, card acquisition (draft or sealed), deck building, match"; "Between games,
 * players return to the builder to sideboard"; "Specification: card data, packs and draft formats", Evening stages:
 * the host advances from lobby, the draft advances automatically, build advances when all seated players are Ready,
 * from match any player proposes "next game" or "new draft" and the others confirm).
 *
 * Real networked sessions (session/net.ts with session/draft.ts) on a LoopbackNetwork under fake timers, with the
 * recorded M19 booster data and M2-P1's real generator. A reload is the page going away with everything saved and the
 * link opened again over the same IndexedDB and local storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import type { CardRef, DeckBuild, LobbySettings, SecretStore, TableState } from '../../../src/core/types';
import { deckImportOf } from '../../../src/session/deck-build';
import { closeAll, FAKE_TIMERS, net, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { both, deckOfFirst, draftToEnd, reload, seatedPair, stageIs, startDraft, type Evening } from './evening';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const BOOSTER: LobbySettings = { draft: { format: 'pass', packs: 2, picks: 1 }, sets: ['M19'], pickTimer: false };

const sorted = (refs: readonly CardRef[]): string[] => refs.map((r) => canonicalJson(r)).sort();

/** Everything private a reload must keep: pool, draft secrets, deck being built, hand and library with identities. */
function privateOf(s: NetTable): Pick<SecretStore, 'pool' | 'draft' | 'build' | 'hand' | 'libraryOrder'> & { identities: string } {
  const sec = s.secrets();
  const ids = [...sec.hand, ...sec.libraryOrder].map((id) => [id, sec.identities[id] ?? null]);
  return { pool: sec.pool, draft: sec.draft, build: sec.build, hand: sec.hand, libraryOrder: sec.libraryOrder, identities: canonicalJson(ids) };
}

/**
 * The table as a reload must keep it: everything but the sequence number and the away marks (the sequencer marks the
 * reloading seat away and back, which are new actions).
 */
function tableOf(st: TableState): string {
  const seats = Object.fromEntries(Object.entries(st.seats).map(([id, seat]) => {
    const { away: _away, ...rest } = seat;
    return [id, rest];
  }));
  return canonicalJson({ ...st, seq: 0, seats });
}

/** Reload `who` and check it comes back to the same stage, table and private state. */
async function reloadKeeps(network: ReturnType<typeof net>, e: Evening, who: 'A' | 'B'): Promise<NetTable> {
  const b = e[who];
  await waitConverged(both(e), `the table before ${b.name}'s reload`);
  const before = { table: tableOf(b.session!.engine.confirmedState()), stage: b.session!.getState().stage, mine: privateOf(b.session!), seat: b.session!.seat };
  const s = await reload(network, b);
  await waitConverged(both(e), `the table after ${b.name}'s reload`);
  await until(() => both(e).every((x) => Object.values(x.engine.confirmedState().seats).every((seat) => seat.away !== true)), 30_000, 'nobody away');
  const hash = tableOf((await waitConverged(both(e), 'the return'), s.engine.confirmedState()));
  expect(s.seat).toBe(before.seat);
  expect(s.getState().stage).toBe(before.stage);
  expect(hash).toBe(before.table);
  expect(privateOf(s)).toEqual(before.mine);
  return s;
}

describe('M2-P7: a reload in each stage returns to that stage with the same pool, deck and table', () => {
  it('a booster-draft evening: lobby, draft, build, match, next game with a sideboard swap, new draft', async () => {
    const network = net({ seed: 11 });
    const e = await seatedPair(network, browsers);

    // Lobby: the host's settings survive a reload of either page.
    e.A.session!.evening!.setLobby(BOOSTER);
    await waitConverged(both(e), 'the lobby settings');
    await reloadKeeps(network, e, 'A');
    await reloadKeeps(network, e, 'B');
    expect(e.B.session!.getState().lobby).toEqual(BOOSTER);

    // Draft: the host starts it for everyone at once; Ben reloads with a pack in front of him and picks in his pool.
    await startDraft(e, BOOSTER);
    let reloadedInDraft = false;
    await draftToEnd(e, async () => {
      const b = e.B.session!;
      const v = b.draft!.view();
      if ((b.secrets().pool?.length ?? 0) < 3 || v.pack === null || v.pack.cards.length < 2) return false;
      const front = v.pack.cards.map((c) => c.id);
      b.draft!.mark([front[1]!]);
      const s = await reloadKeeps(network, e, 'B');
      expect(s.draft!.view().pack?.cards.map((c) => c.id)).toEqual(front);
      expect(s.draft!.view().marked).toEqual([front[1]!]);
      reloadedInDraft = true;
      return true;
    });
    expect(reloadedInDraft).toBe(true);

    // Build: the draft advanced on its own; each pool holds the 30 cards the table counts.
    await stageIs(e, 'build');
    for (const [s, seat] of [
      [e.A.session!, 's0'],
      [e.B.session!, 's1'],
    ] as const) {
      expect(s.secrets().pool).toHaveLength(30);
      expect(s.engine.confirmedState().draft!.pools[seat]).toBe(30);
    }
    const builds: Record<'A' | 'B', DeckBuild> = { A: deckOfFirst(e.A.session!.draft!.build()!, 23), B: deckOfFirst(e.B.session!.draft!.build()!, 25) };
    e.A.session!.draft!.setBuild(builds.A);
    e.B.session!.draft!.setBuild(builds.B);
    await reloadKeeps(network, e, 'A');
    expect(e.A.session!.draft!.build()).toEqual(builds.A);

    // Match: everyone Ready moves the table on; the drafted pool stays the pool.
    await settle(e.A.session!.draft!.ready(), 30_000, 'A ready');
    expect(e.A.session!.getState().stage).toBe('build');
    await settle(e.B.session!.draft!.ready(), 30_000, 'B ready');
    await stageIs(e, 'match');
    expect(e.A.session!.engine.confirmedState().games).toBe(1);
    expect(e.A.session!.secrets().pool).toHaveLength(30);
    expect(e.A.session!.engine.confirmedState().zones['library:s0']!.ids).toHaveLength(23);
    await settle(Promise.all([e.A.session!.shuffle(), e.B.session!.shuffle()]), 60_000, 'both shuffles');
    await settle(e.A.session!.draw(7));
    await settle(e.B.session!.draw(7));
    await reloadKeeps(network, e, 'B');
    expect(e.B.session!.secrets().hand).toHaveLength(7);

    // Next game: Anna proposes, Ben confirms; back in the builder with the game cleared and the decks as they were.
    const proposal = e.A.session!.evening!.propose('nextGame');
    await until(() => e.B.session!.engine.confirmedState().confirm?.label === 'Next game?', 10_000, 'the proposal');
    const round = e.B.session!.engine.confirmedState().confirm!.id;
    e.B.session!.dispatch({ type: 'respond', round, seat: 's1', response: 'ok' });
    expect(await settle(proposal, 30_000, 'the next game')).toBe(true);
    await stageIs(e, 'build');
    const cleared = e.A.session!.engine.confirmedState();
    expect(cleared.cards).toEqual({});
    expect(cleared.commitments).toEqual({});
    expect(cleared.games).toBe(1);
    expect(e.A.session!.draft!.build()).toEqual(builds.A);
    expect(e.B.session!.draft!.build()).toEqual(builds.B);
    expect(e.A.session!.secrets().hand).toEqual([]);
    await reloadKeeps(network, e, 'B');

    // Sideboarding: Anna swaps a deck card for a sideboard card, then both are Ready for game two.
    const side = builds.A.cards.find((c) => !builds.A.main.includes(c.id))!;
    const swapped: DeckBuild = { ...builds.A, main: [...builds.A.main.slice(1), side.id] };
    e.A.session!.draft!.setBuild(swapped);
    await settle(e.A.session!.draft!.ready());
    await settle(e.B.session!.draft!.ready());
    await stageIs(e, 'match');
    const g2 = e.A.session!.engine.confirmedState();
    expect(g2.games).toBe(2);
    const a = e.A.session!.secrets();
    const library = g2.zones['library:s0']!.ids.map((id) => a.identities[id]!.card);
    expect(sorted(library)).toEqual(sorted(deckImportOf(swapped).main));
    await reloadKeeps(network, e, 'A');

    // New draft on the same link: Ben proposes, Anna stays silent and the pass timer confirms for her.
    const newDraft = e.B.session!.evening!.propose('newDraft');
    expect(await settle(newDraft, 30_000, 'the new draft')).toBe(true);
    await stageIs(e, 'lobby');
    const lobby = e.A.session!.engine.confirmedState();
    expect('draft' in lobby).toBe(false);
    expect(lobby.cards).toEqual({});
    for (const s of both(e)) {
      await until(() => s.secrets().draft === undefined && s.secrets().build === undefined, 5000, 'the old draft to go');
      expect(s.secrets().pool).toBeUndefined();
    }
    await reloadKeeps(network, e, 'B');
    // And the next draft starts from nothing.
    await startDraft(e, { draft: { format: 'sealed', packs: 2 }, sets: ['M19'], pickTimer: false });
    await stageIs(e, 'build', 120_000);
    for (const s of both(e)) expect(s.secrets().pool).toHaveLength(30);
  }, 240_000);

  it('sealed: a reload while the pools are being opened finishes the same packs, and the pools stay whole', async () => {
    const network = net({ seed: 3 });
    const e = await seatedPair(network, browsers);
    await startDraft(e, { draft: { format: 'sealed', packs: 3 }, sets: ['M19', 'M20'], pickTimer: false });
    // Anna reloads as soon as she has opened one pack (the next pack seed may be half way).
    await until(() => (e.A.session!.secrets().pool?.length ?? 0) >= 15, 60_000, 'Anna’s first pack');
    await reloadKeeps(network, e, 'A');
    await stageIs(e, 'build', 120_000);
    for (const [s, seat] of [
      [e.A.session!, 's0'],
      [e.B.session!, 's1'],
    ] as const) {
      const generated = s.secrets().draft!.generated;
      expect(generated).toHaveLength(3);
      expect(sorted(s.secrets().pool!)).toEqual(sorted(generated.flatMap((g) => g.cards.map((c) => c.ref))));
      expect(s.engine.confirmedState().draft!.pools[seat]).toBe(s.secrets().pool!.length);
    }
    // Every pack seed came from a round of its own, finished, with the other seat's nonce.
    const st: TableState = e.A.session!.engine.confirmedState();
    const rounds = Object.values(st.shuffles).filter((r) => r.purpose === 'pack');
    expect(rounds).toHaveLength(6);
    for (const r of rounds) {
      expect(r.orderHash).not.toBeNull();
      expect(Object.keys(r.nonces)).toEqual([r.owner === 's0' ? 's1' : 's0']);
    }
    // A reload in the builder before any deck was made: the same pool, and the same fresh build from it.
    const fresh = e.B.session!.draft!.build()!;
    expect(fresh.main).toEqual([]);
    expect(fresh.cards.map((c) => c.ref)).toEqual(e.B.session!.secrets().pool);
    await reloadKeeps(network, e, 'B');
    expect(e.B.session!.draft!.build()).toEqual(fresh);
  }, 240_000);
});
