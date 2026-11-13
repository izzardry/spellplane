/**
 * The networked session's scenarios of the shared leak test (CLAUDE.md: any code touching hidden information adds
 * its scenario to the shared leak test; PLAN M1-P2 leak test, M1-P8 acceptance). The scripted game (script.ts) runs
 * over the real sessions on a network with the acceptance faults (delay up to 400 ms, 5 % loss, reordering), then the
 * scanner (tests/leak/leak.ts) checks everything B received, holds in state and log, keeps in its secret store and in
 * IndexedDB against A's hidden cards, and the other way round. Further scenarios: an undo that brings a card back face
 * down (the owner re-reveals it), a reload (the save holds the same secrets and nothing more), another seat's peek at
 * a face-down card its owner controls (refused) and at one it controls (answered), a look at a hidden zone (refused), a move the sequencer refuses after it passed locally (the
 * card is turned up only once the move is sequenced, so the refusal publishes nothing), another seat moving a face-down
 * card into a graveyard (the owner turns it up), a face-up play lost in a crash before it was sequenced and the same
 * card then played face down after the reload while the peers come up late (it stays face down), and a negative
 * control that shows the scan is not vacuous. M5-P6: undo after a reload, through the stack rebuilt from the saved log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../src/core/commit';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { createPrivateChannel } from '../../../src/net/private';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, lateTransport, LossyTransport, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser } from './harness';
import { isLand, playScript } from './script';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

// Delay, loss and reordering on the public channels. The pair channel (prv) has no retransmission: it rides WebRTC's
// reliable data channel, as in M1-P2's secrecy acceptance test. Undelayed, it overtakes the delayed sequenced log, so
// a targeted reveal arrives before its `revealTo` is applied.
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

describe('shared leak test: the networked session', () => {
  it.each([3, 17])('under delay, loss and reordering the script converges and leaks nothing either way (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    expect(b.engine.confirmedState().cards[p.faceDown]).toMatchObject({ face: 'down', zone: 'battlefield:s0' });
    expect(b.engine.confirmedState().cards[p.faceDown]!.identity).toBeUndefined();
    // The card A showed B was in the hand that got fresh ids when the land came back: B no longer holds it by that id.
    expect(b.secrets().received[p.shown]).toBeUndefined();

    const input = { observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB };
    expect(forbiddenFor(input).tokens.length).toBeGreaterThan(40);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    const back = leakScan({ observed: await observedBy(network, p.A), owner: { state: b.engine.confirmedState(), secrets: b.secrets() }, disclosed: [] });
    expect(back.tokens).toEqual([]);
    expect(back.pairs).toEqual([]);
  });

  it('another seat’s peek at a face-down card its owner controls is refused, as is a look at a hidden zone; nothing leaks', async () => {
    const network = net({ seed: 5 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    // B logs a peek at A's face-down card and asks A for it on the pair channel: its identity stays with its controller
    // (DESIGN "Table model", Face-down on the battlefield; "Card manipulation", Peek).
    const asker = createPrivateChannel(b.engine);
    b.dispatch({ type: 'lookAt', zone: 'battlefield:s0', count: 1, card: p.faceDown });
    let peeked: RevealedCard[] | null = null;
    void asker.requestLook('s0', 'battlefield:s0', 1, p.faceDown).then((r) => (peeked = r));
    await until(() => peeked !== null, 10_000, 'the peek');
    expect(peeked).toEqual([]);
    // B logs a look at A's top two library cards: there is no way yet for A to agree, so A refuses.
    b.dispatch({ type: 'lookAt', zone: 'library:s0', count: 2 });
    let looked: RevealedCard[] | null = null;
    void asker.requestLook('s0', 'library:s0', 2).then((r) => (looked = r));
    await until(() => looked !== null, 10_000, 'the look');
    expect(looked).toEqual([]);
    await waitConverged([a, b]);
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });

  it('undoing a public card’s move into the library brings it back face down without identity; the owner re-reveals it, verified', async () => {
    const network = net({ seed: 9 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    // A plays a land (public), then puts it on top of its library (the identity leaves shared state), then undoes that.
    const sidOf = (id: string): string => a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && !a.secrets().hand.some((id) => isLand(sidOf(id))); i++) await settle(a.draw(1));
    const card = a.secrets().hand.find((id) => isLand(sidOf(id)))!;
    a.dispatch({ type: 'move', card, to: 'battlefield:s0', pose: { x: 140, y: -200, rot: 0 } });
    await waitConverged([a, b]);
    a.dispatch({ type: 'toZone', card, to: 'library:s0', position: 'top' });
    await waitConverged([a, b]);
    expect(b.engine.confirmedState().cards[card]).toMatchObject({ zone: 'library:s0' });
    expect(b.engine.confirmedState().cards[card]!.identity).toBeUndefined();
    expect(a.secrets().libraryOrder[0]).toBe(card);
    expect(a.undo()).toBe(true);
    await waitConverged([a, b]);
    // The restore patch brings it back without identity; A's `flip` up with ref and salt shows it again, verified.
    const back = b.engine.confirmedState().cards[card]!;
    expect(back).toMatchObject({ zone: 'battlefield:s0', face: 'up', identity: a.secrets().identities[card]!.card });
    expect(back.suspect).toBeUndefined();
    const last = b.log().filter((e) => e.kind === 'action').slice(-2).map((e) => (e.kind === 'action' ? e.action.type : ''));
    expect(last).toEqual(['undo', 'flip']);
    expect(a.secrets().libraryOrder).not.toContain(card);
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });

  // M5-P6: undo after a reload rebuilds the stack from the saved log (core/undo.ts undoStackFromLog); its steps' re-reveals
  // drive the owner's verified re-reveal and its draws a private library reorder. A public card moved to the hand (its
  // hand re-issued, so its steps are dropped), a land played from the hand, a draw and the land put on top of the
  // library, then a reload and Ctrl+Z through the restored stack: the land comes back up (re-revealed), the drawn card
  // goes back on top of the library, the land goes back to the hand. Nothing but the land's identity reaches B.
  it.each([12, 33])('undo after a reload: the rebuilt stack re-reveals and reorders through the owner only (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    const sidOf = (id: string): string => a.secrets().identities[id]!.card.sid;
    const lands = (): string[] => a.secrets().hand.filter((id) => isLand(sidOf(id)));
    for (let i = 0; i < 30 && lands().length < 2; i++) await settle(a.draw(1));
    expect(lands().length).toBeGreaterThanOrEqual(2);
    // A public card moved to the hand: the hand gets fresh ids (decision M1-P2), which retires the steps naming them.
    const l2 = lands()[1]!;
    a.dispatch({ type: 'move', card: l2, to: 'battlefield:s0', pose: { x: 210, y: -200, rot: 0 } });
    await until(() => b.engine.confirmedState().cards[l2]?.identity !== undefined, 20_000, 'the second land turned up');
    a.dispatch({ type: 'toZone', card: l2, to: 'hand:s0', position: 'any' });
    await until(() => a.engine.confirmedState().cards[l2] === undefined && a.engine.pending().length === 0, 20_000, 'the re-issue of the hand');
    // A land played from the hand, a draw, and the land put on top of the library.
    const l1 = lands()[0]!;
    a.dispatch({ type: 'move', card: l1, to: 'battlefield:s0', pose: { x: 140, y: -200, rot: 0 } });
    await until(() => b.engine.confirmedState().cards[l1]?.identity !== undefined, 20_000, 'the land turned up');
    const top = a.secrets().libraryOrder[0]!;
    await settle(a.draw(1));
    a.dispatch({ type: 'toZone', card: l1, to: 'library:s0', position: 'top' });
    await waitConverged([a, b], 'before the reload');
    expect(b.engine.confirmedState().cards[l1]!.identity).toBeUndefined();

    await settle(a.whenSaved());
    a.leave();
    const a2 = await open(network, p.A, { settleMs: 200 });
    const shownAfter = trackDisclosures(a2, 's1');
    await waitConverged([a2, b], 'after the reload');
    // Ctrl+Z through the restored stack.
    expect(a2.undo()).toBe(true);
    await until(() => b.engine.confirmedState().cards[l1]?.identity !== undefined && a2.engine.pending().length === 0, 20_000, 'the land re-revealed');
    expect(b.engine.confirmedState().cards[l1]).toMatchObject({ zone: 'battlefield:s0', face: 'up', identity: a2.secrets().identities[l1]!.card });
    expect(b.engine.confirmedState().cards[l1]!.suspect).toBeUndefined();
    expect(a2.undo()).toBe(true);
    await waitConverged([a2, b], 'the draw undone');
    expect(a2.secrets().libraryOrder[0]).toBe(top);
    expect(a2.undo()).toBe(true);
    await until(() => a2.engine.pending().length === 0 && b.engine.confirmedState().cards[l1]?.zone !== 'battlefield:s0', 20_000, 'the land back in the hand');
    await waitConverged([a2, b], 'the end');
    await settle(Promise.all([a2.whenSaved(), b.whenSaved()]));

    const input = { observed: await observedBy(network, p.B), owner: { state: a2.engine.confirmedState(), secrets: a2.secrets() }, disclosed: [...p.shownToB, ...shownAfter] };
    expect(forbiddenFor(input).tokens.length).toBeGreaterThan(40);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    const back = leakScan({ observed: await observedBy(network, p.A), owner: { state: b.engine.confirmedState(), secrets: b.secrets() }, disclosed: [] });
    expect(back.tokens).toEqual([]);
    expect(back.pairs).toEqual([]);
  });

  it('a seat that controls another owner’s face-down card may peek at it; the owner answers that seat only', async () => {
    const network = net({ seed: 6 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    // A hands control of its face-down card to B (an effect that steals a morph).
    a.dispatch({ type: 'move', card: p.faceDown, to: 'battlefield:s1', controller: 's1' });
    await waitConverged([a, b]);
    expect(b.engine.confirmedState().cards[p.faceDown]).toMatchObject({ owner: 's0', controller: 's1', face: 'down', zone: 'battlefield:s1' });
    expect(b.engine.confirmedState().cards[p.faceDown]!.identity).toBeUndefined();
    const asker = createPrivateChannel(b.engine);
    b.dispatch({ type: 'lookAt', zone: 'battlefield:s1', count: 1, card: p.faceDown });
    let peeked: RevealedCard[] | null = null;
    void asker.requestLook('s0', 'battlefield:s1', 1, p.faceDown).then((r) => (peeked = r));
    await until(() => peeked !== null, 10_000, 'the peek');
    const secret = a.secrets().identities[p.faceDown]!;
    expect(peeked).toEqual([{ instanceId: p.faceDown, ref: secret.card, salt: secret.salt }]);
    await waitConverged([a, b]);
    const disclosed = [...p.shownToB, { instanceId: p.faceDown, sid: secret.card.sid, salt: secret.salt }];
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });

  it('a move the sequencer refuses publishes nothing: the owner turns a card up only after the move that makes it public is sequenced', async () => {
    const network = net({ seed: 5 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    expect(a.engine.isSequencer()).toBe(true);
    const bLand = b.engine.confirmedState().zones['battlefield:s1']!.ids[0]!;
    // B squares its land into a one-card pile p1.
    b.dispatch({ type: 'move', card: bLand, to: 'battlefield:s1', pile: { id: 'p1', index: 0, kind: 'squared' } });
    await waitConverged([a, b]);
    const x = b.secrets().hand[0]!;
    const secret = b.secrets().identities[x]!;
    // Same moment: A (the sequencer) drags pile p1 onto its own battlefield; B drops hand card x onto pile p1. B's move
    // passes on B's view and is refused by the sequencer.
    a.dispatch({ type: 'move', card: bLand, to: 'battlefield:s0', pose: { x: 0, y: -100, rot: 0 } });
    b.dispatch({ type: 'move', card: x, to: 'battlefield:s1', pile: { id: 'p1', index: 1, kind: 'squared' } });
    await waitConverged([a, b]);
    await until(() => b.engine.pending().length === 0, 5_000, 'B to settle');
    expect(b.log().some((e) => e.kind === 'system' && /move refused/.test(e.text))).toBe(true);
    // x is still in B's hand, and its identity is nowhere on A's side.
    expect(a.engine.confirmedState().cards[x]).toMatchObject({ zone: 'hand:s1' });
    expect(a.engine.confirmedState().cards[x]!.identity).toBeUndefined();
    expect(b.secrets().hand).toContain(x);
    const aboutX = a.log().flatMap((e) => (e.kind === 'action' && (('card' in e.action && e.action.card === x) || ('instanceId' in e.action && e.action.instanceId === x)) ? [e.action.type] : []));
    expect(aboutX).not.toContain('reveal');
    expect(aboutX).not.toContain('flip');
    const observed = await observedBy(network, p.A);
    expect(JSON.stringify(observed)).not.toContain(secret.salt);
    const back = leakScan({ observed, owner: { state: b.engine.confirmedState(), secrets: b.secrets() }, disclosed: [] });
    expect(back.tokens).toEqual([]);
    expect(back.pairs).toEqual([]);

    // The same move without the race: the card goes down face down and is turned up, verified, once it is sequenced.
    b.dispatch({ type: 'move', card: x, to: 'battlefield:s1', pose: { x: 70, y: 200, rot: 180 } });
    await waitConverged([a, b]);
    expect(a.engine.confirmedState().cards[x]).toMatchObject({ zone: 'battlefield:s1', face: 'up', identity: secret.card });
    expect(a.engine.confirmedState().cards[x]!.suspect).toBeUndefined();
    const steps = a.log().flatMap((e) => (e.kind === 'action' && e.action.by === 's1' && (('card' in e.action && e.action.card === x) || ('instanceId' in e.action && e.action.instanceId === x)) ? [e.action] : []));
    expect(steps.map((s) => s.type).filter((t) => t !== 'draw')).toEqual(['move', 'flip']);
    expect(steps.at(-1)).toMatchObject({ type: 'flip', face: 'up', ref: secret.card, salt: secret.salt });
  });

  it('a face-down card another seat moves into a zone that shows faces is turned up by its owner, verified', async () => {
    const network = net({ seed: 6 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    const secret = a.secrets().identities[p.faceDown]!;
    b.dispatch({ type: 'move', card: p.faceDown, to: 'graveyard:s0' });
    await waitConverged([a, b]);
    await until(() => b.engine.confirmedState().cards[p.faceDown]?.identity !== undefined && a.engine.pending().length === 0, 5_000, 'A to turn the card up');
    await waitConverged([a, b]);
    for (const s of [a, b]) expect(s.engine.confirmedState().cards[p.faceDown]).toMatchObject({ zone: 'graveyard:s0', face: 'up', identity: secret.card });
    expect(b.engine.confirmedState().cards[p.faceDown]!.suspect).toBeUndefined();
    const last = b.log().flatMap((e) => (e.kind === 'action' ? [e.action] : [])).at(-1)!;
    expect(last).toMatchObject({ type: 'flip', by: 's0', card: p.faceDown, ref: secret.card, salt: secret.salt });
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });

  // A face-up play kept as an owed turn-up in local storage, lost before it was sequenced (a crash or a reload while
  // the proposal was in flight); after the reload, the same card is played face down on purpose before the peers are
  // up (over Trystero the join resolves seconds before any WebRTC peer connects). The kept turn-up names an action
  // that was never sequenced, so it must not turn up the face-down card (DESIGN "Table model", Face-down on the
  // battlefield; "Multiplayer architecture", Hidden information 2). Delays: peers up at once, 3 s after a join that
  // resolved at once, and a join that itself takes 3 s or 50 ms.
  it.each([
    [0, false],
    [3000, false],
    [3000, true],
    [50, true],
  ] as const)('a face-up play lost before it was sequenced does not turn up the same card played face down after a reload (peers up after %i ms, join waits: %s)', async (ms, joinToo) => {
    const network = net({ seed: 61 });
    const A = await browser('anna', 'peer-a', 'Anna', 1);
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    browsers.push(A, B);
    const a = await open(network, A);
    let lost: string | null = null;
    const b = await open(network, B, {}, { transport: () => new LossyTransport(network.create('peer-b'), (x) => x.type === 'move' && x.card === lost) });
    await waitConverged([a, b]);
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await settle(b.draw(7));
    await waitConverged([a, b]);
    expect(a.engine.isSequencer()).toBe(true);
    const card = b.secrets().hand[0]!;
    const secret = b.secrets().identities[card]!;
    lost = card;
    b.dispatch({ type: 'move', card, to: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 } });
    expect(B.nonces.ids('turnUp')).toEqual([card]);
    await vi.advanceTimersByTimeAsync(300);
    b.leave();
    await settle(b.whenSaved());
    const b2 = await open(network, B, { settleMs: 200 }, { transport: lateTransport(network, 'peer-b', ms, joinToo) });
    b2.playFaceDown(card, 'battlefield:s1', { x: 160, y: 200, rot: 180 });
    expect(B.nonces.ids('turnUp')).toEqual([]);
    await until(() => b2.engine.status() === 'connected', 20_000, 'B to connect');
    await waitConverged([a, b2]);
    await vi.advanceTimersByTimeAsync(3000);
    await waitConverged([a, b2]);
    for (const s of [a, b2]) {
      expect(s.engine.confirmedState().cards[card]).toMatchObject({ zone: 'battlefield:s1', face: 'down' });
      expect(s.engine.confirmedState().cards[card]!.identity).toBeUndefined();
    }
    const aboutCard = a.log().flatMap((e) => (e.kind === 'action' && 'card' in e.action && e.action.card === card ? [e.action.type] : []));
    expect(aboutCard).not.toContain('flip');
    const observed = await observedBy(network, A);
    expect(JSON.stringify(observed)).not.toContain(secret.salt);
    const report = leakScan({ observed, owner: { state: b2.engine.confirmedState(), secrets: b2.secrets() }, disclosed: [] });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });

  it('negative control: an identity sent outside the reveal paths is found by the scan', async () => {
    const network = net({ seed: 4 });
    const p = await playScript(network, browsers);
    const { a } = p;
    const hidden = a.secrets().libraryOrder[3]!;
    const id = a.secrets().identities[hidden]!;
    // A buggy client puts a library card into a pair-channel message B never asked for.
    a.engine.sendPrivate('s1', { v: PROTOCOL_VERSION, t: 'look', lookId: 'bogus', cards: [{ instanceId: hidden, ref: id.card, salt: id.salt }] });
    await settle(new Promise((r) => setTimeout(r, 500)));
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB });
    expect(report.tokens.map((h) => h.token)).toEqual(expect.arrayContaining([id.salt]));
    expect(report.pairs.some((h) => h.why === 'mapping' && h.pair[0] === hidden)).toBe(true);
    // B never takes it as genuine.
    expect(p.b.secrets().received[hidden]).toBeUndefined();
  });
});
