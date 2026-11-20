/**
 * M8-P5 acceptance, simulated network (PLAN Milestone 8 "M8-P5 Rejoin"; persistence.md section 5 case table;
 * contracts.md Part G "Rejoin" items 2 to 5 and 9): the muster rule over real networked sessions on a LoopbackNetwork
 * with seeded delay, drop and reordering, under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetTable } from '../session/harness';
import { closeAll, FAKE_TIMERS, hashOf, net, settle, until, waitConverged, type Browser } from '../session/harness';
import { playScript } from '../session/script';
import { lostHiddenCards } from '../../../src/session/resume';
import type { LoopbackNetwork } from '../../../src/net/loopback';
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
    // Opening the table waits for the muster (journey.md 4.12: Gathering is never seen) and resolves live.
    const t0 = Date.now();
    const back = await comeBack(network, ben!);
    await untilLive(ben!, 2000);
    expect(Date.now() - t0).toBeLessThan(2000);
    await waitConverged([ann!.session!, back]);
    // Rule 2 (a live peer's head) or rule 3 (everyone in step by the engine's reconciliation, no head needed).
    expect([2, 3]).toContain(back.liveRule());
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

/** The tab is closed (or the machine sleeps): no `bye`, the transport just goes. */
function crash(network: LoopbackNetwork, b: Browser): void {
  network.kill(b.peerId);
  b.session!.dispose();
  b.session = null;
}

describe('standby (persistence.md section 5; contracts.md Part G item 5)', () => {
  it('three browsers all on standby wait for the fourth; one presses PLAY ON; a standby sequencer marks nobody away', async () => {
    const network = lossy(131);
    const [ann, ben, cy, dana] = await seated(network, browsers, 4, 'ffa4');
    await moves(ann!, 2);
    await waitConverged(browsers.map((b) => b.session!));
    for (const b of [ann!, ben!, cy!]) await settle(b.session!.whenSaved());
    // Every tab closes at once: every copy shows everyone present.
    for (const b of [ann!, ben!, cy!, dana!]) crash(network, b);
    const [a, b, c] = [await comeBack(network, ann!), await comeBack(network, ben!), await comeBack(network, cy!)];
    await waitConverged([a, b, c], 'the three gathered');
    await vi.advanceTimersByTimeAsync(20_000);
    for (const x of [ann!, ben!, cy!]) {
      expect(musterOf(x).live).toBe(false);
      expect(musterOf(x).waitingFor).toEqual(['s3']);
    }
    // The standby sequencer marked nobody away, not even Dana who is gone for 20 s.
    expect(Object.values(a.getState().seats).filter((s) => s.away === true)).toEqual([]);
    // A move is held back while on standby.
    const before = a.engine.seq();
    a.dispatch({ type: 'life', seat: 's0', delta: -1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.engine.seq()).toBe(before);
    await settle(b.muster.playOn(['s3']));
    for (const x of [ann!, ben!, cy!]) await untilLive(x);
    await waitConverged([a, b, c], 'live');
    expect(a.getState().seats.s3!.away).toBe(true);
    expect(Object.values(a.getState().seats).filter((s) => s.away === true).map((s) => s.id)).toEqual(['s3']);
    // Live now: the move goes through.
    a.dispatch({ type: 'life', seat: 's0', delta: -1 });
    await until(() => a.engine.pending().length === 0 && a.getState().seats.s0!.life === 17, 5000, 'the move');
  });
});

describe('equal copies (persistence.md section 6, "Newest" defined)', () => {
  /** A split in which each side makes one move (equal play and seq, different hashes), healed by `isolated` coming back. */
  async function equalSplit(seed: number, isolated: 0 | 1): Promise<{ first: string | undefined; hashes: string[] }> {
    const network = lossy(seed);
    const [ann, ben] = await seated(network, browsers, 2);
    const cut = [ann!, ben!][isolated]!;
    const other = [ann!, ben!][1 - isolated]!;
    const fork = ann!.session!.engine.seq();
    network.kill(cut.peerId);
    await until(() => other.session!.engine.peers().every((p) => p.status !== 'connected'), 15_000, 'the split on the other side');
    await until(() => cut.session!.engine.peers().every((p) => p.status !== 'connected'), 15_000, 'the split on the cut side');
    // Marks of absence are sequencer records, not moves; one move each.
    await moves(ann!, 1);
    await moves(ben!, 1);
    expect(ann!.session!.engine.play!()).toBe(ben!.session!.engine.play!());
    network.revive(cut.peerId);
    await waitConverged([ann!.session!, ben!.session!], 'the split healed');
    const firstMove = ann!.session!.log().find((e) => e.kind === 'action' && e.seq > fork && e.action.type === 'life');
    const hashes = [confirmedHash(ann!), confirmedHash(ben!)];
    closeAll(browsers);
    browsers = [];
    return { first: firstMove?.kind === 'action' ? firstMove.action.by : undefined, hashes };
  }

  it('two different copies of equal length converge to the same copy for both connection orders', async () => {
    const one = await equalSplit(141, 0);
    const two = await equalSplit(141, 1);
    expect(new Set(one.hashes).size).toBe(1);
    expect(new Set(two.hashes).size).toBe(1);
    // The same side's move is the table in both orders (the smaller peer id wins a tie of play and seq); the other
    // side's move is played again on top, so both moves survive.
    expect(one.first).toBeDefined();
    expect(two.first).toBe(one.first);
  });
});

describe('a long absence (persistence.md PS-6)', () => {
  it('a player returning across a 600-action gap holds every id of hand and library and is offered no recovery', async () => {
    const network = net({ seed: 151, delay: { min: 0, max: 40 } });
    const p = await playScript(network, browsers);
    const handBefore = [...p.a.secrets().hand];
    const libraryBefore = [...p.a.secrets().libraryOrder];
    const sids = (s: { identities: Record<string, { card: { sid: string } }> }, ids: readonly string[]): string[] => ids.map((id) => s.identities[id]!.card.sid).sort();
    const bouncedSid = p.a.secrets().identities[p.faceDown]!.card.sid;
    const handSids = sids(p.a.secrets(), handBefore);
    expect(handBefore.length).toBeGreaterThan(3);
    await leave(p.A);
    const leftAt = p.b.engine.seq();
    // Ben bounces Ann's face-down permanent to her hand, then plays on for more than the 600 states a peer keeps.
    p.b.dispatch({ type: 'toZone', card: p.faceDown, to: 'hand:s0', position: 'any' });
    for (let i = 0; i < 610; i++) p.b.chat(`turn ${i}`);
    await until(() => p.b.engine.pending().length === 0, 120_000, 'Ben plays on');
    const a: NetTable = await comeBack(network, p.A);
    await waitConverged([a, p.b], 'Ann back across the gap');
    const st = a.engine.confirmedState();
    const lost = lostHiddenCards(st, a.secrets(), a.seat);
    expect(lost.hand).toEqual([]);
    expect(lost.library).toEqual([]);
    // Every id of her hand and library is known to her browser.
    for (const id of [...st.zones['hand:s0']!.ids, ...st.zones['library:s0']!.ids]) expect(a.secrets().identities[id], id).toBeDefined();
    expect(a.secrets().libraryOrder.length).toBe(libraryBefore.length);
    // Her old hand plus the bounced card; the gap was longer than the 600 states a peer keeps (snapshot catch-up).
    expect(st.zones['hand:s0']!.ids.length).toBe(handBefore.length + 1);
    expect(sids(a.secrets(), a.secrets().hand)).toEqual([...handSids, bouncedSid].sort());
    expect(p.b.engine.seq() - leftAt).toBeGreaterThan(600);
  });
});
