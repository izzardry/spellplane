/**
 * Reloads and a sequencer page that closes and reopens, with the pass timer running (M4 gate finding: Ann's log
 * showed "history diverged at seq N" after an ordinary reload and after the sequencer's page closed and reopened).
 *
 * A page that unloads is modelled as the browser does it: its transport goes (the others see it leave) and the page
 * comes back as a new engine with the same identity, started from what it had saved — the snapshot it began with plus
 * every action its engine reported sequenced (session/net.ts persists each one; `loadSaved` hands them back).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { deadlines } from '../../../src/core/deadlines';
import type { SequencedAction } from '../../../src/net/messages';
import { AWAY_AFTER_MS } from '../../../src/net/types';
import { agreed, baseTable, expectConverged, makeSim, until, type Sim, type SimPeer } from './sim';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const DELAY = { delay: { min: 5, max: 40 } };
const tid = (p: SimPeer): string => p.transport.selfId;
const life = (p: SimPeer, cid: string, delta = -1): Action => ({ type: 'life', by: p.seat, cid, seat: p.seat, delta });

/** What `p` saved: every action its engine reported sequenced after `startSeq`, up to its head, gap-free. */
function saved(p: SimPeer, startSeq: number): SequencedAction[] {
  const tail: SequencedAction[] = [];
  for (let q = startSeq + 1; q <= p.engine.seq(); q++) {
    const a = p.log.get(q);
    if (!a) break;
    tail.push(a);
  }
  return tail;
}

/**
 * `p`'s page unloads: the others see its transport leave, and its save is what its engine reported until then.
 * `reportsPeersGone`: its transport also reports every peer gone to its own, still running engine as it leaves (what
 * net/broadcast.ts did on `pagehide`, and Trystero's leave on `beforeunload` does ~100 ms later, before the fix).
 * `alone`: an action the page's player makes after that, sequenced alone.
 */
function unload(sim: Sim, p: SimPeer, startSeq: number, reportsPeersGone: boolean, alone: Action | null): SequencedAction[] {
  sim.net.kill(tid(p));
  if (reportsPeersGone) for (const other of sim.peers) if (other !== p) p.transport.inner.emitPeer('leave', tid(other));
  if (alone) p.engine.propose(alone);
  return saved(p, startSeq);
}

type Who = 'sequencer' | 'follower';

interface Outcome {
  sim: Sim;
  /** The reopened page and the page that stayed. */
  back: SimPeer;
  room: SimPeer;
  save: SequencedAction[];
  /** Seqs whose action some live page replaced after applying it, or where the save differs from the room's history. */
  forks: number[];
}

async function reloadScenario(who: Who, awayMs: number, reportsPeersGone: boolean, seed: number, actAlone = false): Promise<Outcome> {
  const start = baseTable(2);
  const sim = makeSim({ engines: 2, seats: 2, start, seed, deadlines, ...DELAY });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const [a, b] = sim.peers as [SimPeer, SimPeer];
  expect(a.engine.isSequencing()).toBe(true);
  for (let i = 0; i < 4; i++) {
    a.engine.propose(life(a, `a-${i}`));
    b.engine.propose(life(b, `b-${i}`));
    await vi.advanceTimersByTimeAsync(80);
  }
  // Ben asks a round with the table's pass timer (5 s): Ann's seat is silent, so the sequencer's clock times it out.
  b.engine.propose({ type: 'ask', by: 's1', cid: 'ask-1', round: 'r1', label: 'ok?' } as Action);
  await expectConverged(sim.peers);
  await vi.advanceTimersByTimeAsync(3000);
  const leaving = who === 'sequencer' ? a : b;
  const save = unload(sim, leaving, start.seq, reportsPeersGone, actAlone ? life(leaving, 'alone') : null);
  await vi.advanceTimersByTimeAsync(awayMs);
  const back = sim.add(leaving.index, start, 'player', save);
  const room = who === 'sequencer' ? b : a;
  await until(() => agreed([back, room]), 30_000, 'back at the table');
  // Past the round's pass timer, wherever it ran out.
  await vi.advanceTimersByTimeAsync(6000);
  await expectConverged([back, room]);
  const forks = new Set<number>();
  for (const x of save) if (room.log.get(x.seq)?.cid !== x.cid) forks.add(x.seq);
  for (const p of [back, room]) {
    const first = new Map<number, string>();
    for (const x of p.trace) {
      if (first.has(x.seq) && first.get(x.seq) !== x.cid) forks.add(x.seq);
      if (!first.has(x.seq)) first.set(x.seq, x.cid);
    }
    // The reopened page's loaded save counts as applied.
    if (p === back) for (const x of save) if (p.log.has(x.seq) && p.log.get(x.seq)!.cid !== x.cid) forks.add(x.seq);
  }
  return { sim, back, room, save, forks: [...forks].sort((x, y) => x - y) };
}

const CASES: { who: Who; awayMs: number; what: string }[] = [
  { who: 'sequencer', awayMs: 1500, what: 'the sequencer reloads' },
  { who: 'sequencer', awayMs: AWAY_AFTER_MS + 4000, what: 'the sequencer page closes and reopens (its seat is marked away, the pass timer runs out)' },
  { who: 'follower', awayMs: 1500, what: 'the other page reloads' },
];

const diverged = (p: SimPeer): string[] => p.system.filter((t) => /diverged|mismatch/.test(t));

describe('reloads and a sequencer page that closes and reopens (M4 gate finding)', () => {
  it.each(CASES)('$what: nothing diverges, the save is a prefix of the room’s history, the timer runs out once', async ({ who, awayMs }) => {
    for (const seed of [1, 2, 3, 4]) {
      const { back, room, save, forks } = await reloadScenario(who, awayMs, false, seed);
      expect(forks, `seed ${seed}`).toEqual([]);
      for (const p of [back, room]) expect(diverged(p), `${p.peerId} seed ${seed}`).toEqual([]);
      for (const x of save) expect(room.log.get(x.seq)?.cid, `seed ${seed}: saved seq ${x.seq}`).toBe(x.cid);
      const timeouts = [...room.log.values()].filter((x) => x.type === 'respond' && x.response === 'timeout');
      expect(timeouts.length, `seed ${seed}`).toBe(1);
      for (const p of [back, room]) expect(p.engine.confirmedState().seats.s0!.away, `${p.peerId} seed ${seed}`).toBeUndefined();
    }
  });

  it.each(CASES)('reproduction: $what, with a transport that reports its peers gone to the unloading page: its save diverges', async ({ who, awayMs }) => {
    // The unloading page's engine believes the room is gone: as sequencer it marks the other seat away, as follower it
    // takes over and records its claim and the sequencer's seat away. Those records are saved and exist nowhere else.
    const { save, room, forks } = await reloadScenario(who, awayMs, true, 1);
    expect(forks.length).toBeGreaterThan(0);
    const ghost = save.filter((x) => room.log.get(x.seq)?.cid !== x.cid || forks.includes(x.seq));
    expect(ghost.length).toBeGreaterThan(0);
    for (const x of ghost) expect(['away', 'sequencerClaim', 'respond']).toContain(x.type);
  });

  it('a fork that abandons only a sequencer’s own records (away, sequencerClaim) is repaired without a warning; one that abandons a player’s action warns', async () => {
    const quiet = await reloadScenario('sequencer', AWAY_AFTER_MS + 4000, true, 1);
    expect(quiet.forks.length).toBeGreaterThan(0);
    expect(quiet.save.filter((x) => quiet.forks.includes(x.seq)).map((x) => x.type)).toEqual(['away']);
    expect(diverged(quiet.back)).toEqual([]);
    const loud = await reloadScenario('sequencer', AWAY_AFTER_MS + 4000, true, 1, true);
    expect(loud.save.filter((x) => loud.forks.includes(x.seq)).map((x) => x.cid)).toContain('alone');
    expect(diverged(loud.back)).toEqual([expect.stringMatching(/^history diverged at seq \d+: taking over the sequencer's history from there\.$/)]);
  });
});
