/**
 * M8-C: opening hands and the automatic setup (contracts.md Part D; src/session/entry.ts) over real networked sessions
 * on a LoopbackNetwork under fake timers, with two and four sessions: a deck committed at Ready is then dealt once; a
 * reload in the middle of the deal deals the rest once; a second game deals again; the first player is rolled once
 * per game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { dealOpening, firstPlayerRolled, importIfNeeded, OPENING_HAND, startAutoSetup } from '../../../src/session/entry';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { both, reload, seatedPair, stageIs } from '../flow/evening';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
const stops: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  for (const s of stops.splice(0)) s();
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const dealtCount = (s: NetTable, seat: string): number => s.log().filter((e) => e.kind === 'action' && e.action.type === 'dealt' && e.action.by === seat).length;
const firstPlayerRounds = (st: TableState): number => Object.values(st.rng).filter((r) => r.purpose === 'firstPlayer').length;

async function auto(sessions: readonly NetTable[]): Promise<void> {
  for (const s of sessions) stops.push(startAutoSetup(s));
  await until(() => sessions.every((s) => s.secrets().hand.length === OPENING_HAND && s.getState().seats[s.seat]?.dealt === (s.getState().games ?? 0)), 120_000, 'every opening hand');
  await waitConverged(sessions, 'the deal');
}

describe('opening hands (contracts.md Part D)', () => {
  it('two sessions: committed at Ready, dealt once; a reload mid-deal deals the rest once; a second game deals again', async () => {
    const network = net({ seed: 21 });
    const e = await seatedPair(network, browsers);
    const [a, b] = both(e) as [NetTable, NetTable];
    a.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    a.dispatch({ type: 'settings', settings: { autoSetup: true } });
    const deckA = await fixtureDeck('gw-m19-60.txt');
    expect(await settle(importIfNeeded(a, deckA))).toBe(true);
    expect(await settle(importIfNeeded(a, deckA))).toBe(false);
    await settle(importIfNeeded(b, await fixtureDeck('ur-m19-60.mtga.txt')));
    a.evening!.start();
    await stageIs(e, 'match');

    // Ben's page goes away after three of his seven cards.
    await settle(b.shuffle(), 60_000, 'Ben shuffles');
    await settle(b.draw(3));
    await waitConverged([a, b], 'three cards');
    const b2 = await reload(network, e.B);
    await auto([a, b2]);
    expect(dealtCount(a, 's0')).toBe(1);
    expect(dealtCount(a, 's1')).toBe(1);
    expect(b2.secrets().hand).toHaveLength(OPENING_HAND);
    expect(firstPlayerRounds(a.getState())).toBe(1);
    expect(firstPlayerRolled(a.getState())).toBe(true);
    // A second deal of the same game does nothing.
    expect(await settle(dealOpening(a))).toBe(false);

    // The next game: back to the builder, both Ready, and the deal runs again.
    expect(await settle(b2.evening!.propose('nextGame'), 30_000, 'the rematch')).toBe(true);
    await until(() => [a, b2].every((s) => s.engine.confirmedState().stage === 'build'), 60_000, 'the build stage');
    await settle(a.draft!.ready());
    await settle(b2.draft!.ready());
    await until(() => [a, b2].every((s) => s.engine.confirmedState().stage === 'match'), 60_000, 'game two');
    expect(a.engine.confirmedState().games).toBe(2);
    await auto([a, b2]);
    expect(dealtCount(a, 's0')).toBe(2);
    expect(dealtCount(a, 's1')).toBe(2);
    // The builder cleared game one's rounds (core/stage.ts clearGame): the one round now is game two's roll.
    expect(firstPlayerRounds(a.getState())).toBe(1);
  }, 300_000);

  it('four sessions: each seat is dealt once', async () => {
    const network = net({ seed: 22 });
    const names = ['ann', 'ben', 'cy', 'dee'];
    const all: NetTable[] = [];
    for (const [i, n] of names.entries()) {
      const br = await browser(n, `peer-${n}`, n, i);
      browsers.push(br);
      all.push(await open(network, br, {}, { format: 'ffa4' }));
    }
    await waitConverged(all, 'four seated');
    const [a] = all as [NetTable];
    a.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    a.dispatch({ type: 'settings', settings: { autoSetup: true } });
    for (const [i, s] of all.entries()) await settle(importIfNeeded(s, await fixtureDeck(i % 2 === 0 ? 'gw-m19-60.txt' : 'ur-m19-60.mtga.txt')), 60_000, `deck ${i}`);
    a.evening!.start();
    await until(() => all.every((s) => s.engine.confirmedState().stage === 'match'), 60_000, 'the match');
    await auto(all);
    for (const s of all) for (const seat of ['s0', 's1', 's2', 's3']) expect(dealtCount(s, seat)).toBe(1);
    expect(firstPlayerRounds(a.getState())).toBe(1);
  }, 300_000);
});
