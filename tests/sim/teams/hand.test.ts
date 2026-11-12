/**
 * PLAN M3-P2 acceptance over four real networked sessions at a Two-Headed Giant table (DESIGN "Players, seats and
 * formats", Two-Headed Giant: "Each teammate's hand is visible live to the other", "one shared life total and one
 * shared turn and phase marker", "A team channel carries voice and text only between teammates"):
 *
 * - a teammate's page shows the partner's hand identities, live, and an opponent's page never receives them: the
 *   shared leak test (tests/leak/leak.ts) scans everything each opponent received, holds in state, log and secret
 *   store and keeps in IndexedDB for both partners' hidden cards, under delay, loss and reordering;
 * - a life change by either teammate updates one shared total on every page;
 * - team chat reaches the teammate only and never enters the shared log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSeatActive } from '../../../src/core/teams';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { leakScan } from '../../leak/leak';
import { scan } from '../../leak/scan';
import { closeAll, dump, FAKE_TIMERS, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser } from '../session/harness';
import { openingHands, ownHand, seatedTeams, shownHand } from './session';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

// Delay, loss and reordering on the public channels; the pair channel rides WebRTC's reliable channel (as in the M1-P8
// leak scenarios), so it overtakes the delayed log.
const FAULTS: LoopbackOptions = { delay: { min: 0, max: 300 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const verifiedHand = (s: Parameters<typeof ownHand>[0]) => ownHand(s).map((c) => ({ ...c, verified: true }));

describe('Two-Headed Giant: the live teammate hand', () => {
  it('a teammate’s page shows the partner’s hand identities live, and an opponent’s page never receives them', async () => {
    const network = net({ seed: 11, ...FAULTS });
    const t = await seatedTeams(network, browsers);
    const [a, b, c, d] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0], typeof t.sessions[0], typeof t.sessions[0]];
    const [, B, C, D] = t.browsers as [Browser, Browser, Browser, Browser];
    const shown = { a: { s2: trackDisclosures(a, 's2'), s3: trackDisclosures(a, 's3') }, b: { s2: trackDisclosures(b, 's2'), s3: trackDisclosures(b, 's3') } };
    await openingHands(t);

    // Each partner sees the other's seven cards, in the owner's arrangement, verified against the deck commitment.
    await until(() => JSON.stringify(shownHand(b, 's0')) === JSON.stringify(verifiedHand(a)) && JSON.stringify(shownHand(a, 's1')) === JSON.stringify(verifiedHand(b)), 20_000, 'the teammate hands');
    expect(shownHand(b, 's0')).toHaveLength(7);
    expect(shownHand(d, 's2')).toEqual(verifiedHand(c));
    expect(a.team!.teammates()).toEqual(['s1']);
    expect(c.team!.teammates()).toEqual(['s3']);
    // An opponent's team view has no hand of Anna or Ben.
    expect(c.team!.hand('s0')).toEqual([]);
    expect(d.team!.hand('s1')).toEqual([]);

    // Live: Anna plays a card and draws, Ben's view follows.
    const played = ownHand(a)[0]!.id;
    a.dispatch({ type: 'move', card: played, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    await settle(a.draw(1));
    await until(() => JSON.stringify(shownHand(b, 's0')) === JSON.stringify(verifiedHand(a)), 20_000, 'Ben to see Anna’s new hand');
    expect(shownHand(b, 's0').map((x) => x.id)).not.toContain(played);
    expect(shownHand(b, 's0')).toHaveLength(7);
    await waitConverged(t.sessions, 'the end');
    await settle(Promise.all(t.sessions.map((s) => s.whenSaved())));

    // The shared leak test: neither opponent learnt anything of Anna's or Ben's hidden cards.
    for (const [owner, seat, disclosed] of [
      [a, 's0', shown.a],
      [b, 's1', shown.b],
    ] as const) {
      for (const [obs, oppSeat] of [
        [C, 's2'],
        [D, 's3'],
      ] as const) {
        const input = { observed: await observedBy(network, obs), owner: { state: owner.engine.confirmedState(), secrets: owner.secrets() }, disclosed: disclosed[oppSeat] };
        const report = leakScan(input);
        expect(report.tokens, `${oppSeat} holds ${seat}'s hidden tokens`).toEqual([]);
        expect(report.pairs, `${oppSeat} holds ${seat}'s id-to-card pairs`).toEqual([]);
      }
    }
    // Not vacuous: the same scan of what Ben received finds Anna's hand (the team path is the only one that carries it).
    const toBen = leakScan({ observed: await observedBy(network, B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: [] });
    expect(toBen.tokens.length).toBeGreaterThan(0);
    const benReceived = network.delivered.filter((x) => x.to === B.peerId).map((x) => x.msg as { t?: string });
    expect(benReceived.some((m) => m.t === 'teamHand')).toBe(true);
    // Only teammates ever got a teamHand.
    for (const x of network.delivered) {
      if ((x.msg as { t?: string }).t !== 'teamHand') continue;
      const pair = [x.from, x.to].sort().join('|');
      expect(['peer-0|peer-1', 'peer-2|peer-3']).toContain(pair);
    }
    // Ben's browser keeps Anna's hand in memory only: nothing of it is in his IndexedDB.
    const stored = leakScan({ observed: await dump(B.stores), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: shown.a.s2 });
    expect(stored.tokens).toEqual([]);
    expect(stored.pairs).toEqual([]);
  }, 120_000);

  it('a teammate that reloads gets the partner’s hand again; with team hands hidden nothing more is sent', async () => {
    const network = net({ seed: 4 });
    const t = await seatedTeams(network, browsers);
    const [a] = t.sessions;
    const B = t.browsers[1]!;
    await openingHands(t);
    await until(() => shownHand(B.session!, 's0').length === 7, 20_000, 'Ben to see Anna’s hand');
    await settle(B.session!.whenSaved());
    B.session!.leave();
    B.session = null;
    const b = await open(network, B, {}, { format: '2hg' });
    await until(() => JSON.stringify(shownHand(b, 's0')) === JSON.stringify(verifiedHand(a!)), 30_000, 'Ben to see Anna’s hand after his reload');

    // The host hides team hands: Ben's view empties and Anna's next draw is not sent.
    a!.dispatch({ type: 'settings', settings: { teamHandsVisible: false } });
    await waitConverged([a!, b, t.sessions[2]!, t.sessions[3]!], 'the setting');
    expect(b.team!.hand('s0')).toEqual([]);
    // Whatever was on its way has landed.
    await vi.advanceTimersByTimeAsync(1000);
    const before = network.delivered.filter((x) => (x.msg as { t?: string }).t === 'teamHand').length;
    await settle(a!.draw(1));
    await waitConverged([a!, b], 'the draw');
    await vi.advanceTimersByTimeAsync(1000);
    expect(network.delivered.filter((x) => (x.msg as { t?: string }).t === 'teamHand').length).toBe(before);
  }, 120_000);
});

describe('Two-Headed Giant: shared life, turn marker and team chat', () => {
  it('a life change by either teammate updates one shared total on every page', async () => {
    const network = net({ seed: 6, delay: { min: 0, max: 200 } });
    const t = await seatedTeams(network, browsers);
    const [a, b, c] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0], typeof t.sessions[0]];
    a.dispatch({ type: 'life', seat: 's0', delta: -3 });
    b.dispatch({ type: 'life', seat: 's1', delta: -4 });
    c.dispatch({ type: 'life', seat: 's1', delta: -1 });
    await waitConverged(t.sessions, 'the life changes');
    for (const s of t.sessions) {
      const st = s.engine.confirmedState();
      expect(st.teams.t0!.life).toBe(22);
      expect(st.teams.t1!.life).toBe(30);
    }
    // One turn marker for the team: both teammates are active; the turn passes team to team.
    const st = a.engine.confirmedState();
    expect(st.turn.active).toBe('t0');
    expect(['s0', 's1', 's2', 's3'].map((s) => isSeatActive(st, s))).toEqual([true, true, false, false]);
    b.dispatch({ type: 'turnPass', to: 't1' });
    await waitConverged(t.sessions, 'the turn pass');
    expect(c.engine.confirmedState().turn.active).toBe('t1');
  }, 120_000);

  it('team chat reaches the teammate only and never enters the shared log', async () => {
    const network = net({ seed: 8 });
    const t = await seatedTeams(network, browsers);
    const [a, b, c, d] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0], typeof t.sessions[0], typeof t.sessions[0]];
    const line = a.chat('attack the left one, I hold the trick', 'team');
    expect(line).toMatchObject({ type: 'chat', channel: 'team', by: 's0' });
    await until(() => b.team!.chatLog().length === 1, 10_000, 'Ben to get the line');
    expect(b.team!.chatLog()[0]).toMatchObject({ kind: 'action', action: { type: 'chat', channel: 'team', text: 'attack the left one, I hold the trick', by: 's0' } });
    expect(a.team!.chatLog()).toHaveLength(1);
    a.chat('table line', 'table');
    await waitConverged(t.sessions, 'the table line');
    for (const s of t.sessions) expect(s.log().filter((e) => e.kind === 'action' && e.action.type === 'chat').map((e) => (e.kind === 'action' && e.action.type === 'chat' ? e.action.channel : null))).toEqual(['table']);
    for (const [obs, s] of [
      [t.browsers[2]!, c],
      [t.browsers[3]!, d],
    ] as const) {
      expect(s.team!.chatLog()).toEqual([]);
      expect(scan(await observedBy(network, obs), ['attack the left one'])).toEqual([]);
    }
  }, 120_000);
});
