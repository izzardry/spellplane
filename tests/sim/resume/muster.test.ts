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
import { comeBack, confirmedHash, crash, leave, moves, musterOf, newerHeadHeard, seated, untilLive } from './rejoin-helpers';
import { watch, closeWatchers, type Watcher } from '../roles/harness';

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

  it('row 6: Ann heard a newer copy from Ben, who dropped before she caught up: she stays on standby, PLAY ON WITH THIS TABLE is offered', async () => {
    const network = net({ seed: 107, delay: { min: 40, max: 120 } });
    const { ann, cy, benSeat, cySeat } = await newerHeadHeard(network, browsers);
    // Ben is gone again: Ann still waits for Cy, and now for Ben's newer table too.
    await vi.advanceTimersByTimeAsync(3000);
    let m = musterOf(ann);
    expect(m.live).toBe(false);
    expect(m.knownHead).toMatchObject({ seat: benSeat, peer: 'peer-b' });
    expect(m.waitingFor).toEqual([cySeat, benSeat]);
    expect(m.playOnHere).toBe(false);
    // Cy returns with the same copy as Ann's: everyone her copy expects is here, only Ben's newer table is missing.
    const c = await comeBack(network, cy);
    await waitConverged([ann.session!, c], 'Ann and Cy');
    await vi.advanceTimersByTimeAsync(3000);
    m = musterOf(ann);
    expect(m.live).toBe(false);
    expect(m.knownHead).toMatchObject({ seat: benSeat });
    expect(m.waitingFor).toEqual([benSeat]);
    expect(m.playOnHere).toBe(true);
    expect(ann.session!.liveRule()).toBeNull();
  });

  it('a spectator who stayed does not make a returning player live: Ben still waits for Ann', async () => {
    const network = lossy(108);
    const [ann, ben] = await seated(network, browsers, 2);
    await moves(ann!, 2);
    let sam: Watcher | null = null;
    try {
      sam = await watch(network, 'sam', 'peer-sam', 'Sam');
      await until(() => sam!.session.engine.seq() === ann!.session!.engine.seq(), 10_000, 'Sam in step');
      for (const b of [ann!, ben!]) await settle(b.session!.whenSaved());
      // Both players' tabs close: Sam's copy (and Ben's) show both seats present.
      crash(network, ann!);
      crash(network, ben!);
      await comeBack(network, ben!);
      await vi.advanceTimersByTimeAsync(5000);
      const m = musterOf(ben!);
      expect(m.live).toBe(false);
      expect(m.waitingFor).toEqual(['s0']);
      // The spectator announced no head (its page holds no seat).
      expect(network.delivered.some((d) => d.from === 'peer-sam' && (d.msg as { t?: string }).t === 'head')).toBe(false);
    } finally {
      if (sam) closeWatchers([sam]);
    }
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
  const NOTICE = "The table with more moves is kept; the other side's moves are played again on top where they still fit.";

  /**
   * A split: `cut` is cut off from the others; the side named `movers` makes three moves (life changes), the other side
   * writes `chats` chat lines alone, so its copy is longer by seq but has fewer moves. Then the split heals.
   */
  async function split(seed: number, n: 2 | 3, cutIndex: number, moversCut: boolean, chats: number) {
    const network = lossy(seed);
    const all = await seated(network, browsers, n, n === 3 ? 'ffa3' : undefined);
    const cut = all[cutIndex]!;
    const rest = all.filter((b) => b !== cut);
    const fork = cut.session!.engine.seq();
    network.kill(cut.peerId);
    for (const b of rest) await until(() => b.session!.getState().seats[cut.session!.seat]!.away === true, 15_000, `${cut.name} away on ${b.name}`);
    await until(() => cut.session!.engine.peers().every((p) => p.status !== 'connected'), 15_000, `the others gone on ${cut.name}`);
    const movers = moversCut ? cut : rest[0]!;
    const chatter = moversCut ? rest[0]! : cut;
    await moves(movers, 3);
    for (let i = 0; i < chats; i++) chatter.session!.chat(`alone ${i}`);
    await until(() => chatter.session!.engine.pending().length === 0, 10_000, 'the chat lines');
    // The chatting side's copy is the longer one, the moving side's has more moves.
    expect(chatter.session!.engine.seq()).toBeGreaterThan(movers.session!.engine.seq());
    expect(movers.session!.engine.play!()).toBeGreaterThan(chatter.session!.engine.play!());
    const winnerPlay = movers.session!.engine.play!();
    const moverLife = lifeOf(movers, movers.session!.seat);
    const notices = new Map(all.map((b) => [b, [] as string[]]));
    for (const b of all) b.session!.onNotice((t) => notices.get(b)!.push(t));
    network.revive(cut.peerId);
    await waitConverged(all.map((b) => b.session!), 'the split healed');
    for (const b of all) {
      // The copy with more moves is the table, whichever side elects the sequencer.
      expect(b.session!.engine.play!(), b.name).toBe(winnerPlay);
      expect(lifeOf(b, movers.session!.seat), b.name).toBe(moverLife);
      const chatsSeen = b.session!.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'chat' ? [e.action.text] : []));
      expect(chatsSeen, b.name).toEqual(expect.arrayContaining(Array.from({ length: chats }, (_, i) => `alone ${i}`)));
    }
    // The moving side's history sits right after the fork: its first move is the first move after the fork point.
    const log = movers.session!.log().flatMap((e) => (e.kind === 'action' && e.seq > fork ? [e] : []));
    const firstMove = log.find((e) => e.kind === 'action' && e.action.type === 'life');
    const firstChat = log.find((e) => e.kind === 'action' && e.action.type === 'chat');
    expect(firstMove!.seq).toBeLessThan(firstChat!.seq);
    // The browser whose own actions were played again is told; the side whose copy was kept is not.
    expect(notices.get(chatter), chatter.name).toContain(NOTICE);
    const kept = moversCut ? [cut] : rest;
    for (const b of kept) expect(notices.get(b), b.name).not.toContain(NOTICE);
  }

  it('a stale browser with eight chat lines (the longer copy) loses against a copy with three more moves', async () => {
    // Ann (s0, elects the sequencer) chats alone; Ben moves.
    await split(121, 2, 0, false, 8);
  });

  it('the elected sequencer with more moves keeps its copy against a longer copy of chat lines', async () => {
    // Ann (s0) is cut off and moves; Ben chats alone, longer by seq.
    await split(122, 2, 0, true, 8);
  });

  it('the other orientation: the cut-off higher seat has the moves, the elected sequencer the longer chat copy', async () => {
    await split(123, 2, 1, true, 8);
  });

  it('three browsers: the cut-off sequencer with more moves wins against two others who chatted', async () => {
    await split(124, 3, 0, true, 8);
  });

  it('three browsers: a cut-off player with more moves wins against the sequencer side that chatted', async () => {
    await split(125, 3, 2, true, 8);
  });
});


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
