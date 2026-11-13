/**
 * The audit's scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario to
 * the shared leak test; PLAN M5-P2: "nothing hidden is published before the game end"; DESIGN "Multiplayer
 * architecture", Hidden information 6: the nonces and order history are published at game end).
 *
 * The scripted game (game.ts) under delay, loss and reordering, then "Next game", then game two (both Ready again,
 * shuffle, draw, a land played). The scanner (tests/leak/leak.ts) checks everything Ben received, holds in state and
 * log, keeps in his secret store and in IndexedDB:
 * - before game one ends: against every secret of Anna's, her audit nonces and re-issue links included, and the other
 *   way round; no `auditPublish` was sent at all;
 * - after game two started: Anna's game-one nonces and orders are public now, and nothing else is: no identity or salt
 *   of a card that stayed hidden in either game, no nonce or re-issue link of game two. The published bundle itself holds
 *   no identity or salt, and names no card of game two.
 * A negative control shows the scan is not vacuous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditBundle } from '../../../src/core/audit';
import type { Action } from '../../../src/core/actions';
import type { SecretStore } from '../../../src/core/types';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { scan } from '../../leak/scan';
import { stageIs } from '../flow/evening';
import { closeAll, FAKE_TIMERS, net, observedBy, settle, trackDisclosures, waitConverged, type Browser, type NetTable } from '../session/harness';
import { endGame, isLand, playMiddle, startGame, verdictsIn } from './game';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 400 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const bundleOf = (s: NetTable, seat: string): AuditBundle =>
  s
    .log()
    .flatMap((e) => (e.kind === 'action' && e.action.type === 'auditPublish' && e.action.by === seat ? [(e.action as Extract<Action, { type: 'auditPublish' }>).bundle] : []))[0]!;

/** The secret store without the records `bundle` published (they are public once the game ended). */
function withoutPublished(sec: SecretStore, bundle: AuditBundle): SecretStore {
  const nonces = new Set(bundle.records.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce)));
  return { ...sec, audit: sec.audit.filter((r) => !nonces.has(r.kind === 'shuffle' ? r.ownerNonce : r.nonce)) };
}

describe('shared leak test: the post-game audit', () => {
  it.each([5, 19])('publishes nothing hidden before the game end, and afterwards only that game’s nonces and orders (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const g = await startGame(network, browsers);
    const shownToB = trackDisclosures(g.a, 's1');
    const shownToA = trackDisclosures(g.b, 's0');
    await playMiddle(g);
    await settle(Promise.all([g.a.whenSaved(), g.b.whenSaved()]));

    // Before the end: the full scan, every audit nonce of the owner included.
    const forA = { observed: await observedBy(network, g.B), owner: { state: g.a.engine.confirmedState(), secrets: g.a.secrets() }, disclosed: shownToB };
    const anna = g.a.secrets().audit.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce));
    expect(anna.length).toBeGreaterThanOrEqual(6);
    expect(forbiddenFor(forA).tokens).toEqual(expect.arrayContaining(anna));
    expect(leakScan(forA)).toEqual({ tokens: [], pairs: [] });
    expect(leakScan({ observed: await observedBy(network, g.A), owner: { state: g.b.engine.confirmedState(), secrets: g.b.secrets() }, disclosed: shownToA })).toEqual({ tokens: [], pairs: [] });
    expect(JSON.stringify(forA.observed)).not.toContain('auditPublish');

    // The game ends; both publish; game two starts with fresh decks, shuffles and a land played.
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    await settle(g.a.draft!.ready(), 30_000, 'Anna ready again');
    await settle(g.b.draft!.ready(), 30_000, 'Ben ready again');
    await stageIs(g, 'match');
    await settle(Promise.all([g.a.shuffle(), g.b.shuffle()]), 60_000, 'game two’s shuffles');
    await settle(g.a.draw(7));
    await settle(g.b.draw(7));
    const land = g.a.secrets().hand.find((id) => isLand(g.a.secrets().identities[id]!.card.sid));
    if (land) g.a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    const [seen] = await settle(g.a.lookAt('library:s0', 1));
    g.a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
    await waitConverged([g.a, g.b], 'game two');
    await settle(Promise.all([g.a.whenSaved(), g.b.whenSaved()]));

    const published = bundleOf(g.a, 's0');
    expect(published.game.game).toBe(1);
    const observed = await observedBy(network, g.B);
    // Game one's nonces are public now: they are in what Ben holds (the scan below is not vacuous for them).
    expect(scan(observed, [published.records[0]!.kind === 'shuffle' ? published.records[0]!.ownerNonce : 'x']).length).toBeGreaterThan(0);
    // Everything else Anna holds stays hers: game two's nonces and re-issue links, and every identity and salt not shown.
    const rest = { observed, owner: { state: g.a.engine.confirmedState(), secrets: withoutPublished(g.a.secrets(), published) }, disclosed: shownToB };
    expect(forbiddenFor(rest).tokens.length).toBeGreaterThan(100);
    expect(leakScan(rest)).toEqual({ tokens: [], pairs: [] });
    const ben = bundleOf(g.b, 's1');
    expect(leakScan({ observed: await observedBy(network, g.A), owner: { state: g.b.engine.confirmedState(), secrets: withoutPublished(g.b.secrets(), ben) }, disclosed: shownToA })).toEqual({
      tokens: [],
      pairs: [],
    });

    // The bundle itself: no identity, no salt, no card of game two.
    const identities = forbiddenFor({ owner: { state: g.a.engine.confirmedState(), secrets: { ...g.a.secrets(), audit: [] } }, disclosed: [] }).tokens;
    expect(identities.length).toBeGreaterThan(100);
    expect(scan([published], identities)).toEqual([]);
    const ids = new Set(published.records.flatMap((r) => [...r.order, ...(r.reissue?.before ?? [])]));
    const game2 = Object.keys(g.a.engine.confirmedState().cards);
    expect(game2.length).toBeGreaterThan(0);
    expect(game2.filter((id) => ids.has(id))).toEqual([]);

    // Negative control: a game-two nonce of Anna's in a message Ben received is caught by the same scan.
    const g2 = withoutPublished(g.a.secrets(), published).audit[0]!;
    const leaked = leakScan({ ...rest, observed: [...observed, { t: 'chat', text: g2.kind === 'shuffle' ? g2.ownerNonce : g2.nonce }] });
    expect(leaked.tokens).toHaveLength(1);
  });
});
