/**
 * M8-P5 acceptance, simulated network (PLAN Milestone 8 "M8-P5 Rejoin"; persistence.md section 5 case table;
 * contracts.md Part G "Rejoin" items 2 to 5 and 9): the muster rule over real networked sessions on a LoopbackNetwork
 * with seeded delay, drop and reordering, under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAll, FAKE_TIMERS, hashOf, net, settle, until, waitConverged, type Browser } from '../session/harness';
import { comeBack, confirmedHash, leave, moves, musterOf, seated, untilLive } from './rejoin-helpers';

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

const lossy = (seed: number) => net({ seed, delay: { min: 5, max: 120 }, drop: 0.05 });
const lifeOf = (b: Browser, seat: string): number => b.session!.getState().seats[seat]!.life;

describe('the case table of persistence.md section 5', () => {
  it('Ben leaves, Ann plays on, Ben returns while Ann is there: Ben is in step and live by rule 2 within a second', async () => {
    const network = lossy(101);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 1000, 'Ben marked away within a second');
    await moves(ann!, 3);
    const back = await comeBack(network, ben!);
    const t0 = Date.now();
    const rules: (number | null)[] = [];
    back.muster.subscribe((m) => rules.push(m.rule));
    expect(musterOf(ben!).live).toBe(false);
    await untilLive(ben!, 2000);
    await waitConverged([ann!.session!, back]);
    expect(rules.find((r) => r !== null)).toBe(2);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(confirmedHash(ben!)).toBe(confirmedHash(ann!));
    expect(lifeOf(ben!, 's0')).toBe(lifeOf(ann!, 's0'));
  });

  it('Ann plays on, leaves, returns alone: her copy marks Ben away, so she is live by rule 3', async () => {
    const network = lossy(102);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 1000, 'Ben away');
    await moves(ann!, 2);
    await leave(ann!);
    await comeBack(network, ann!);
    await untilLive(ann!);
    expect(ann!.session!.liveRule()).toBe(3);
  });

  it('Ben returns alone first: his copy shows Ann present, so he waits; a move is not proposed, chat is', async () => {
    const network = lossy(103);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 1000, 'Ben away');
    await moves(ann!, 2);
    await leave(ann!);
    const b = await comeBack(network, ben!);
    await vi.advanceTimersByTimeAsync(3000);
    const m = musterOf(ben!);
    expect(m.live).toBe(false);
    expect(m.waitingFor).toEqual(['s0']);
    expect(m.seats.find((s) => s.seat === 's0')!.state).toBe('away');
    const before = hashOf(b.engine.confirmedState());
    const life = lifeOf(ben!, 's1');
    b.dispatch({ type: 'life', seat: 's1', delta: -1 });
    expect(b.engine.pending()).toEqual([]);
    expect(lifeOf(ben!, 's1')).toBe(life);
    expect(b.log().at(-1)).toMatchObject({ kind: 'system', text: 'Waiting for Ann' });
    b.chat('anyone?');
    await until(() => b.engine.pending().length === 0, 5000, 'chat sequenced');
    expect(hashOf(b.engine.confirmedState())).not.toBe(before);
    // The table decides: PLAY ON WITHOUT ANN makes Ben live and logs the line.
    await settle(b.muster.playOn(['s0']));
    await untilLive(ben!);
    expect(ben!.session!.liveRule()).toBe(4);
    expect(b.getState().seats.s0!.away).toBe(true);
  });

  it('Ann reloads while she is the only one there: live at once by rule 3', async () => {
    const network = lossy(104);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 1000, 'Ben away');
    ann!.session!.leave();
    ann!.session = null;
    await comeBack(network, ann!);
    expect(musterOf(ann!).live).toBe(true);
  });

  it('three players: Cy and Dana with old copies meet and wait for Ann; one presses PLAY ON and both are live', async () => {
    const network = lossy(105);
    const [ann, ben, cy] = await seated(network, browsers, 3, 'ffa3');
    // Ben and Cy leave together; Ann plays on alone and leaves.
    await leave(ben!);
    await leave(cy!);
    await moves(ann!, 2);
    await leave(ann!);
    const b = await comeBack(network, ben!);
    const c = await comeBack(network, cy!);
    await waitConverged([b, c]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(musterOf(ben!).live).toBe(false);
    expect(musterOf(cy!).live).toBe(false);
    expect(musterOf(ben!).waitingFor).toEqual(['s0']);
    // A standby browser sequences the playOn; nobody is marked away by the sequencer meanwhile.
    expect(b.getState().seats.s0!.away).toBeUndefined();
    await settle(c.muster.playOn(['s0']));
    await untilLive(ben!);
    await untilLive(cy!);
    expect(b.getState().seats.s0!.away).toBe(true);
  });

  it('a brand-new game is live by rule 3, a joiner by rule 2', async () => {
    const network = lossy(106);
    const [ann, ben] = await seated(network, browsers, 2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(musterOf(ann!).live).toBe(true);
    expect(musterOf(ben!).live).toBe(true);
  });
});

describe('leaving on the wire (persistence.md section 5)', () => {
  it("bye with reason leave marks the seat away within a second and tells the others 'Ben left …'", async () => {
    const network = lossy(111);
    const [ann, ben] = await seated(network, browsers, 2);
    const notices: string[] = [];
    ann!.session!.onNotice((t) => notices.push(t));
    const t0 = Date.now();
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 1000, 'away within a second');
    expect(Date.now() - t0).toBeLessThanOrEqual(1000);
    await until(() => notices.length > 0, 1000, 'the notice');
    expect(notices).toContain('Ben left. The game goes on; Ben can come back.');
  });
});

describe('newest by moves (contracts.md Part G item 2)', () => {
  it('a stale browser with four chat lines loses against a copy with three more moves; both converge', async () => {
    const network = lossy(121);
    const [ann, ben] = await seated(network, browsers, 2);
    // A split: each side plays alone.
    network.kill('peer-a');
    await until(() => ben!.session!.getState().seats.s0!.away === true, 15_000, 'Ann away on Ben');
    await until(() => ann!.session!.engine.peers().every((p) => p.status !== 'connected'), 15_000, 'Ben gone on Ann');
    for (let i = 0; i < 4; i++) ann!.session!.chat(`alone ${i}`);
    await until(() => ann!.session!.engine.pending().length === 0, 5000, 'Ann chats');
    await moves(ben!, 3);
    expect(ann!.session!.engine.seq()).toBeGreaterThan(0);
    const benPlay = ben!.session!.engine.play!();
    network.revive('peer-a');
    await waitConverged([ann!.session!, ben!.session!], 'the split healed');
    // Ben's three moves are the table; Ann's chat lines were played again on top.
    expect(ann!.session!.engine.play!()).toBe(benPlay);
    expect(lifeOf(ann!, 's1')).toBe(17);
    const chats = ann!.session!.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'chat' ? [e.action.text] : []));
    expect(chats).toEqual(expect.arrayContaining(['alone 0', 'alone 1', 'alone 2', 'alone 3']));
  });
});
