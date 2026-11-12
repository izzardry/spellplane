/**
 * The networked session's scenarios of the shared leak test (CLAUDE.md: any code touching hidden information adds
 * its scenario to the shared leak test; PLAN M1-P2 leak test, M1-P8 acceptance). The scripted game (script.ts) runs
 * over the real sessions on a network with the acceptance faults (delay up to 400 ms, 5 % loss, reordering), then the
 * scanner (tests/leak/leak.ts) checks everything B received, holds in state and log, keeps in its secret store and in
 * IndexedDB against A's hidden cards, and the other way round. Further scenarios: an undo that brings a card back face
 * down (the owner re-reveals it), a reload (the save holds the same secrets and nothing more), another seat's look at
 * a face-down card (answered) and at a hidden zone (refused), and a negative control that shows the scan is not vacuous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../src/core/commit';
import { createPrivateChannel } from '../../../src/net/private';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { closeAll, FAKE_TIMERS, net, observedBy, settle, until, waitConverged, type Browser } from './harness';
import { isLand, playScript } from './script';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS = { delay: { min: 0, max: 400 }, drop: 0.05 };

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

  it('another seat’s peek at an own face-down card is answered; a look at a hidden zone is refused; neither leaks the rest', async () => {
    const network = net({ seed: 5 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    // B logs a peek at A's face-down card and asks A for it on the pair channel.
    const asker = createPrivateChannel(b.engine);
    b.dispatch({ type: 'lookAt', zone: 'battlefield:s0', count: 1, card: p.faceDown });
    let peeked: RevealedCard[] | null = null;
    void asker.requestLook('s0', 'battlefield:s0', 1, p.faceDown).then((r) => (peeked = r));
    await until(() => peeked !== null, 10_000, 'the peek');
    expect(peeked).toEqual([{ instanceId: p.faceDown, ref: a.secrets().identities[p.faceDown]!.card, salt: a.secrets().identities[p.faceDown]!.salt }]);
    // B logs a look at A's top two library cards: there is no way yet for A to agree, so A refuses.
    b.dispatch({ type: 'lookAt', zone: 'library:s0', count: 2 });
    let looked: RevealedCard[] | null = null;
    void asker.requestLook('s0', 'library:s0', 2).then((r) => (looked = r));
    await until(() => looked !== null, 10_000, 'the look');
    expect(looked).toEqual([]);
    await waitConverged([a, b]);
    const disclosed = [...p.shownToB, { instanceId: p.faceDown, sid: a.secrets().identities[p.faceDown]!.card.sid, salt: a.secrets().identities[p.faceDown]!.salt }];
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed });
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

  it('negative control: an identity sent outside the reveal paths is found by the scan', async () => {
    const network = net({ seed: 4 });
    const p = await playScript(network, browsers);
    const { a } = p;
    const hidden = a.secrets().libraryOrder[3]!;
    const id = a.secrets().identities[hidden]!;
    // A buggy client puts a library card into a pair-channel message B never asked for.
    a.engine.sendPrivate('s1', { v: 1, t: 'look', lookId: 'bogus', cards: [{ instanceId: hidden, ref: id.card, salt: id.salt }] });
    await settle(new Promise((r) => setTimeout(r, 500)));
    const report = leakScan({ observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB });
    expect(report.tokens.map((h) => h.token)).toEqual(expect.arrayContaining([id.salt]));
    expect(report.pairs.some((h) => h.why === 'mapping' && h.pair[0] === hidden)).toBe(true);
    // B never takes it as genuine.
    expect(p.b.secrets().received[hidden]).toBeUndefined();
  });
});
