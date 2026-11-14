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
 * A negative control shows the scan is not vacuous. Three fork scenarios: a player cut off who ends the game alone in a
 * history that loses; (three players) a player cut off right after agreeing to "Next game?" who plays on alone in a
 * history that wins; and a peer who sat down mid-match without a deck (no player of the game, but a chair, so a
 * sequencer of its own when cut off) who plays on alone in a history that wins. No history carries anybody's records.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditGames, buildAuditBundle, type AuditBundle } from '../../../src/core/audit';
import type { Action } from '../../../src/core/actions';
import type { SecretStore } from '../../../src/core/types';
import type { LoopbackOptions } from '../../../src/net/loopback';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { scan } from '../../leak/scan';
import { AUDIT_WAIT_MS } from '../../../src/net/audit';
import { EVENING_OPTS, stageIs } from '../flow/evening';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { endGame, isLand, playMiddle, startGame, startThree, verdictOf, verdictsIn } from './game';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

/** A transport whose link can go silent both ways without a leave event (a real WebRTC cut). */
class Cuttable implements Transport {
  cut = false;
  constructor(private readonly inner: Transport) {}
  get selfId(): PeerId {
    return this.inner.selfId;
  }
  join(roomId: string, roomKey: string): Promise<void> {
    return this.inner.join(roomId, roomKey);
  }
  leave(): void {
    this.inner.leave();
  }
  peers(): PeerId[] {
    return this.inner.peers();
  }
  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (!this.cut) this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, (msg, from) => {
      if (!this.cut) handler(msg, from);
    });
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer(handler);
  }
}

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

  it.each([3, 8])('never sends a bundle into a history in which its game is still being played: cut off, ending the game alone, the other history wins (seed %i)', async (seed) => {
    const network = net({ seed });
    const g = await startGame(network, browsers);
    const benActions = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' && e.action.by === 's1' ? [e.action] : []));

    // Ben is cut off; once Anna is silent for long enough he sequences alone and marks her away.
    network.kill(g.B.peerId);
    await until(() => g.b.engine.isSequencer() && g.b.engine.confirmedState().seats.s0!.away === true, 30_000, 'Ben sequencing alone');
    // He ends the game in his history (Anna's chair answers by the pass timer); Anna draws on in hers, which grows longer.
    const ending = g.b.evening!.propose('nextGame');
    for (let i = 0; i < 15; i++) await settle(g.a.draw(1));
    expect(await settle(ending, 60_000, 'Ben’s next game')).toBe(true);
    await until(() => g.b.engine.confirmedState().stage === 'build', 30_000, 'Ben’s history to leave the match');
    await vi.advanceTimersByTimeAsync(AUDIT_WAIT_MS + 1000);
    // Nobody else follows Ben's history past the end: he holds his bundle back, and his own row waits.
    expect(benActions(g.b).some((a) => a.type === 'auditPublish')).toBe(false);
    expect(g.b.audit!.games()[0]!.seats.find((x) => x.seat === 's1')!.verdict).toBeNull();
    expect(g.b.engine.seq()).toBeLessThan(g.a.engine.seq());
    const game = auditGames(g.b.log().flatMap((e) => (e.kind === 'action' ? [e.action] : [])))[0]!;
    const isolated = buildAuditBundle(g.b.secrets(), game, g.b.log().flatMap((e) => (e.kind === 'action' ? [e.action] : [])));
    const nonces = g.b.secrets().audit.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce));
    expect(isolated.records.length).toBeGreaterThan(0);
    expect(nonces.length).toBeGreaterThan(0);

    // Ben is back: Anna's longer history wins. His abandoned "Next game?" is asked again there; Anna holds, so the game
    // is still on in the history both now follow.
    network.revive(g.B.peerId);
    await until(() => g.a.engine.confirmedState().confirm?.label === 'Next game?', 30_000, 'Ben’s question again in Anna’s history');
    const round = g.a.engine.confirmedState().confirm!.id;
    g.a.dispatch({ type: 'respond', round, seat: 's0', response: 'hold' });
    await waitConverged([g.a, g.b], 'Anna’s history');
    await vi.advanceTimersByTimeAsync(10_000);
    await waitConverged([g.a, g.b], 'Anna’s history, held');
    for (const s of [g.a, g.b]) expect(s.engine.confirmedState().stage).toBe('match');
    // Nothing Anna received carries Ben's nonces or orders.
    expect(scan(await observedBy(network, g.A), nonces)).toEqual([]);
    // And should a proposal of that bundle still be on its way (the engine proposes an abandoned history's own actions
    // again), the transport carries no record of it: the confirmed history has not ended that game.
    const propose = { v: 1 as const, t: 'propose', cid: 'c-isolated', action: { type: 'auditPublish', by: 's1', cid: 'c-isolated', bundle: isolated } };
    const sent = g.b.auditOutgoing('act', propose);
    expect(scan([sent], nonces)).toEqual([]);
    expect(g.b.auditOutgoing('act', { v: 1, t: 'propose', cid: 'c-chat', action: { type: 'chat', by: 's1', cid: 'c-chat', text: 'hi' } })).toMatchObject({ action: { text: 'hi' } });

    // Anna lets the question pass: the game ends in the shared history, both publish, and Ben's audit (rebuilt with the
    // adopted history) passes on both browsers.
    g.a.dispatch({ type: 'respond', round, seat: 's0', response: 'release' });
    g.a.dispatch({ type: 'respond', round, seat: 's0', response: 'ok' });
    await until(() => [g.a, g.b].every((s) => s.engine.confirmedState().stage === 'build'), 30_000, 'the end of the game');
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's0')!.status).toBe('verified');
      expect(verdictOf(s, 's1')!.status).toBe('verified');
    }
    expect(g.b.audit!.published()).toHaveLength(1);
  });

  it('three players: a player cut off right after his "ok" plays on alone, his history wins, and nobody\'s records reached anyone meanwhile', async () => {
    const network = net({ seed: 3 });
    let cutB: Cuttable | null = null;
    const t = await startThree(network, browsers, { passTimerMs: null, transportB: () => (cutB = new Cuttable(network.create('peer-b'))) });
    const { a, b, c } = t;
    // Anna plays a land and takes it back: her hand gets fresh opaque ids (a reorder with a re-issue, whose published
    // form would link the land Cara saw to its new hand id).
    const landIn = (): string | undefined => a.secrets().hand.find((id) => isLand(a.secrets().identities[id]!.card.sid));
    for (let i = 0; i < 20 && landIn() === undefined; i++) await settle(a.draw(1));
    const land = landIn()!;
    a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    await waitConverged(t.all, 'the land');
    a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
    await until(() => a.engine.confirmedState().cards[land] === undefined && a.engine.pending().length === 0, 20_000, 'the hand re-issue');
    await waitConverged(t.all, 'the hand re-issue');

    // "Next game?": Ben answers ok, and his link goes silent (no leave event) the moment Anna sequences it; Cara agrees.
    a.engine.onSequenced((x: Action) => {
      if (x.type === 'respond' && x.by === 's1' && x.response === 'ok') cutB!.cut = true;
    });
    const ending = a.evening!.propose('nextGame');
    await until(() => [b, c].every((s) => s.engine.confirmedState().confirm?.label === 'Next game?'), 10_000, 'the question');
    b.dispatch({ type: 'respond', round: b.engine.confirmedState().confirm!.id, seat: 's1', response: 'ok' });
    await until(() => cutB!.cut, 10_000, 'Ben’s ok sequenced');
    c.dispatch({ type: 'respond', round: c.engine.confirmedState().confirm!.id, seat: 's2', response: 'ok' });
    expect(await settle(ending, 30_000, 'the next game')).toBe(true);
    await until(() => [a, c].every((s) => s.engine.confirmedState().stage === 'build'), 10_000, 'the end for Anna and Cara');
    await vi.advanceTimersByTimeAsync(AUDIT_WAIT_MS + 1000);
    // Ben never reported the end: Anna and Cara hold their records, and their rows say for whom.
    const published = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'auditPublish' ? [e.action] : []));
    expect(published(a)).toEqual([]);
    expect(published(c)).toEqual([]);
    expect(a.audit!.games()[0]!.seats.find((x) => x.seat === 's0')!.note).toMatch(/^Published once Ben/);
    expect(c.audit!.games()[0]!.seats.find((x) => x.seat === 's2')!.note).toMatch(/^Published once Ben/);
    expect(b.engine.confirmedState().stage).toBe('match');

    // Ben, alone, plays on in game one and replaces the round; his history grows longer.
    await until(() => b.engine.isSequencer(), 30_000, 'Ben sequencing alone');
    for (let i = 0; i < 30; i++) await settle(b.draw(1));
    b.dispatch({ type: 'ask', round: 'r-ben-attacks', label: 'Attacks?' });
    await vi.advanceTimersByTimeAsync(500);
    expect(b.engine.seq()).toBeGreaterThan(a.engine.seq());

    // The link is back: Ben's longer history wins, game one is still being played everywhere.
    network.kill('peer-b');
    cutB!.cut = false;
    await vi.advanceTimersByTimeAsync(100);
    network.revive('peer-b');
    await until(() => t.all.every((s) => s.engine.confirmedState().stage === 'match' && s.engine.seq() >= b.engine.seq()), 60_000, 'Ben’s history everywhere');
    await vi.advanceTimersByTimeAsync(10_000);
    for (const s of t.all) expect(s.engine.confirmedState().stage).toBe('match');
    // Nobody received anybody's audit records: no bundle, no nonce, no re-issue link.
    const noncesOf = (s: NetTable): string[] => s.secrets().audit.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce));
    for (const [owner, others] of [
      [a, [t.B, t.C]],
      [b, [t.A, t.C]],
      [c, [t.A, t.B]],
    ] as const) {
      const nonces = noncesOf(owner);
      expect(nonces.length).toBeGreaterThan(0);
      for (const o of others) {
        const observed = await observedBy(network, o);
        expect(scan(observed, nonces)).toEqual([]);
        expect(JSON.stringify(observed)).not.toContain('auditPublish');
      }
    }
  });
  it('a peer who sat down mid-match without a deck holds a chair: cut off, playing on alone in a history that wins, nobody published to anybody', async () => {
    const network = net({ seed: 3 });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    const C = await browser('cara', 'peer-c', 'Cara', 7);
    browsers.push(A, B, C);
    await open(network, A, {}, { ...EVENING_OPTS, format: 'ffa3' });
    await open(network, B, {}, { ...EVENING_OPTS, format: 'ffa3' });
    const [a, b] = [A.session!, B.session!];
    await waitConverged([a, b], 'two seated');
    a.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'Anna ready');
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'Ben ready');
    a.evening!.start();
    await until(() => [a, b].every((s) => s.engine.confirmedState().stage === 'match'), 60_000, 'the match');
    await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
    await settle(a.draw(7));
    await settle(b.draw(7));
    await waitConverged([a, b], 'opening hands');

    // Cara opens the link mid-match and takes the free chair; she has no deck, so she is no player of game one.
    let cutC: Cuttable | null = null;
    await open(network, C, {}, { ...EVENING_OPTS, format: 'ffa3', transport: () => (cutC = new Cuttable(network.create('peer-c'))) });
    const c = C.session!;
    await waitConverged([a, b, c], 'three seated');
    expect(c.seat).toBe('s2');
    expect(a.audit!.games()).toEqual([]);

    // Cara's link goes silent; Anna and Ben end the game ("Next game", the pass timer answers for Cara).
    cutC!.cut = true;
    await until(() => a.engine.confirmedState().seats.s2!.away === true, 30_000, 'Cara away for Anna');
    const ending = a.evening!.propose('nextGame');
    await until(() => b.engine.confirmedState().confirm?.label === 'Next game?', 10_000, 'the question');
    b.dispatch({ type: 'respond', round: b.engine.confirmedState().confirm!.id, seat: 's1', response: 'ok' });
    expect(await settle(ending, 120_000, 'the next game')).toBe(true);
    await until(() => [a, b].every((s) => s.engine.confirmedState().stage === 'build'), 60_000, 'the end for Anna and Ben');
    await vi.advanceTimersByTimeAsync(AUDIT_WAIT_MS + 1000);
    // Cara never reported the end: Anna and Ben hold their records, and their rows say for whom.
    const published = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'auditPublish' ? [e.action] : []));
    expect(published(a)).toEqual([]);
    expect(published(b)).toEqual([]);
    expect(a.audit!.games()[0]!.seats.map((x) => x.seat)).toEqual(['s0', 's1']);
    expect(a.audit!.games()[0]!.seats.find((x) => x.seat === 's0')!.note).toBe("Published once Cara (away) has the game's end");
    expect(b.audit!.games()[0]!.seats.find((x) => x.seat === 's1')!.note).toBe("Published once Cara (away) has the game's end");

    // Cara, alone, sequences and plays on in game one; her history grows longer.
    await until(() => c.engine.isSequencer(), 30_000, 'Cara sequencing alone');
    for (let i = 0; i < 80; i++) {
      c.dispatch({ type: 'chat', text: `hi ${i}`, channel: 'table' });
      await vi.advanceTimersByTimeAsync(50);
    }
    c.dispatch({ type: 'ask', round: 'r-cara-attacks', label: 'Attacks?' });
    await vi.advanceTimersByTimeAsync(500);
    expect(c.engine.seq()).toBeGreaterThan(a.engine.seq());

    // The link is back: Cara's history wins; Anna's "Next game?" is asked again there and Cara holds.
    network.kill('peer-c');
    cutC!.cut = false;
    await vi.advanceTimersByTimeAsync(100);
    network.revive('peer-c');
    await until(() => c.engine.confirmedState().confirm?.label === 'Next game?', 60_000, 'the question again in Cara’s history');
    const round = c.engine.confirmedState().confirm!.id;
    c.dispatch({ type: 'respond', round, seat: 's2', response: 'hold' });
    await vi.advanceTimersByTimeAsync(30_000);
    await waitConverged([a, b, c], 'Cara’s history');
    for (const s of [a, b, c]) expect(s.engine.confirmedState().stage).toBe('match');
    // Nobody received anybody's audit records.
    const noncesOf = (s: NetTable): string[] => s.secrets().audit.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce));
    for (const [owner, others] of [
      [a, [B, C]],
      [b, [A, C]],
    ] as const) {
      const nonces = noncesOf(owner);
      expect(nonces.length).toBeGreaterThan(0);
      for (const o of others) {
        const observed = await observedBy(network, o);
        expect(scan(observed, nonces)).toEqual([]);
        expect(JSON.stringify(observed)).not.toContain('auditPublish');
      }
    }

    // Cara lets the question pass: the game ends in the shared history, Anna and Ben publish, and all three browsers
    // verify both (Cara acknowledged the end, though she has no records of her own).
    c.dispatch({ type: 'respond', round, seat: 's2', response: 'release' });
    c.dispatch({ type: 'respond', round, seat: 's2', response: 'ok' });
    await until(() => [a, b, c].every((s) => s.engine.confirmedState().stage === 'build'), 60_000, 'the end of the game');
    await verdictsIn([a, b, c]);
    for (const s of [a, b, c]) {
      expect(verdictOf(s, 's0')!.status).toBe('verified');
      expect(verdictOf(s, 's1')!.status).toBe('verified');
    }
  });
});
