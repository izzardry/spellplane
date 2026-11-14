/**
 * Long-session soak harness (PLAN M5-P6: "long-session soak test"; PLAN Milestone 5, Acceptance tests: "a 5,000-action
 * soak on four simulated peers ends with equal hashes and bounded memory"). Builds on tests/sim/net/sim.ts (loopback
 * network with seeded delay, drop and reordering; Vitest fake timers). Contracts: M5-C. Implementer: M5-P6
 * (tests/sim/soak.test.ts and this file).
 *
 * "Bounded memory" is measured on what the engines retain, not on the process heap (which Vitest and V8 make noisy):
 * the counts below must stay under limits that do not grow with the number of actions, apart from the log itself.
 */
import { vi } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import type { TableState } from '../../../src/core/types';
import type { EngineRetained, NetEngineImpl } from '../../../src/net/engine';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { mulberry32 } from '../../../src/util/prng';
import { randomAction } from '../net/random-actions';
import { agreed, baseTable, converged, hashOf, makeSim, until, type Sim, type SimPeer } from '../net/sim';

/** One soak run (PLAN Milestone 5, Acceptance tests). Added by M5-C. */
export interface SoakOptions extends LoopbackOptions {
  /** Simulated peers, one seat each (4 in the acceptance test). */
  peers: number;
  /** Sequenced actions to reach (5,000 in the acceptance test). */
  actions: number;
  /** Seed of the random action stream (tests/sim/net/random-actions.ts) and of the faults. */
  seed: number;
  /** Kill and revive a random non-sequencer peer every this many actions (0: never). */
  churnEvery?: number;
}

/** What the engines hold at the end of a run, per peer (PLAN M5-P6: bounded memory). Added by M5-C. */
export interface SoakRetained {
  /** Wire messages kept for the debug hook (NetEngine.messages). */
  messages: number;
  /** Own actions applied optimistically and not yet sequenced. */
  pending: number;
  /** Out-of-order `seq` messages buffered for a gap. */
  buffered: number;
  /** Sequenced actions kept in memory for catch-up answers (beyond the snapshot). */
  history: number;
}

/** Result of a soak run (PLAN Milestone 5, Acceptance tests). Added by M5-C. */
export interface SoakReport {
  /** Seq every live peer reached. */
  seq: number;
  /** State hash per live peer at `seq` (all equal for a pass). */
  hashes: string[];
  /** Per peer, in peer order. */
  retained: SoakRetained[];
  /** Fake-clock milliseconds the run took. */
  simulatedMs: number;
}

/** Run a soak (inside Vitest fake timers). Implementer: M5-P6. Added by M5-C. */
export async function runSoak(opts: SoakOptions): Promise<SoakReport> {
  return (await runSoakDetailed(opts)).report;
}

/** What a soak run leaves behind beyond the report, for the acceptance test's deeper checks (M5-P6). */
export interface SoakDetail {
  report: SoakReport;
  /** Every structure each engine holds (net/engine.ts Engine.retained), per peer at the end. */
  engines: EngineRetained[];
  /** Per peer, the same at the half-way probe (when the table first passed half of `actions`). */
  half: EngineRetained[];
  /** Per peer, its seq at the half-way probe. */
  halfSeqs: number[];
  /**
   * Canonical JSON length of the confirmed state per table object (card, line, stack item, seat) at the half-way probe
   * and at the end: the state grows with what is on the table (random play creates more tokens than it removes), never
   * with the number of actions.
   */
  stateBytes: { half: number; end: number };
  /** The seq the run started from (the common table's setup actions). */
  startSeq: number;
  /** The simulated peers (engines, transports and what each reported). */
  sim: Sim;
  /** How often a peer was killed and revived. */
  churns: number;
}

/** Canonical JSON bytes of `state` per object on the table. */
function bytesPerObject(state: TableState): number {
  const objects = Object.keys(state.cards).length + Object.keys(state.lines).length + state.stack.length + Object.keys(state.seats).length;
  return canonicalJson(state).length / Math.max(1, objects);
}

/** At most this many own actions in flight per live peer: players act at a human pace, not in bursts of hundreds. */
const IN_FLIGHT_PER_PEER = 3;
/** Simulated ms between two proposals, drawn uniformly from [0, GAP_MS]. */
const GAP_MS = 30;

/**
 * The soak: `peers` engines, one seat each, start from the common table (tests/sim/net/sim.ts baseTable) and play
 * random actions (tests/sim/net/random-actions.ts) from random live peers under the given faults until `actions`
 * actions are sequenced past the start; every `churnEvery` sequenced actions a random peer that is not the sequencer is
 * killed (the others see it leave) and revived `churnEvery / 2` actions later. The run ends once every peer is back and
 * all of them have converged.
 */
export async function runSoakDetailed(opts: SoakOptions): Promise<SoakDetail> {
  const { peers: n, actions, seed, churnEvery = 0, ...faults } = opts;
  const start = baseTable(n);
  const sim = makeSim({ engines: n, seats: n, start, seed, ...faults });
  const t0 = Date.now();
  await until(() => agreed(sim.peers), 60_000, 'connection');
  const rand = mulberry32(seed * 7919 + 17);
  const target = start.seq + actions;
  const engine = (p: SimPeer): NetEngineImpl => p.engine;
  const head = (): number => Math.max(...sim.live().map((p) => p.engine.seq()));
  let down: { peer: SimPeer; reviveAt: number } | null = null;
  let nextChurn = churnEvery > 0 ? start.seq + churnEvery : Infinity;
  let churns = 0;
  let half: EngineRetained[] | null = null;
  let halfBytes = 0;
  let halfSeqs: number[] = sim.peers.map(() => start.seq);
  let tries = 0;
  while (head() < target || down !== null) {
    const h = head();
    if (half === null && h >= start.seq + actions / 2) {
      half = sim.peers.map((p) => engine(p).retained());
      halfBytes = bytesPerObject(sim.peers[0]!.engine.confirmedState());
      halfSeqs = sim.peers.map((p) => p.engine.seq());
    }
    if (down !== null && h >= down.reviveAt) {
      sim.net.revive(down.peer.transport.selfId);
      down = null;
    } else if (down === null && h >= nextChurn && h < target) {
      const candidates = sim.live().filter((p) => !p.engine.isSequencing());
      const victim = candidates[Math.floor(rand() * candidates.length)];
      if (victim) {
        sim.net.kill(victim.transport.selfId);
        down = { peer: victim, reviveAt: Math.min(target, h + Math.max(1, Math.floor(churnEvery / 2))) };
        churns++;
      }
      nextChurn = h + churnEvery;
    }
    const live = sim.live();
    const inFlight = live.reduce((k, p) => k + p.engine.pending().length, 0);
    if (h + inFlight < target && inFlight < IN_FLIGHT_PER_PEER * live.length) {
      const p = live[Math.floor(rand() * live.length)];
      if (p) {
        const a = randomAction(p.engine.state(), p.seat, rand, `${p.peerId}-${tries++}`);
        if (a && p.engine.propose(a)) p.proposed.push(a.cid);
      }
    }
    await vi.advanceTimersByTimeAsync(Math.floor(rand() * GAP_MS) + 1);
  }
  await until(() => agreed(sim.peers), 120_000, 'every peer back at the table', 250);
  await until(() => converged(sim.peers), 240_000, 'convergence', 250);
  const seq = sim.peers[0]!.engine.seq();
  const report: SoakReport = {
    seq,
    hashes: sim.peers.map((p) => hashOf(p.engine.confirmedState())),
    retained: sim.peers.map((p) => {
      const r = engine(p).retained();
      return { messages: r.messages, pending: r.pending, buffered: r.buffer, history: r.log };
    }),
    simulatedMs: Date.now() - t0,
  };
  return {
    report,
    engines: sim.peers.map((p) => engine(p).retained()),
    half: half ?? sim.peers.map((p) => engine(p).retained()),
    halfSeqs,
    stateBytes: { half: halfBytes, end: bytesPerObject(sim.peers[0]!.engine.confirmedState()) },
    startSeq: start.seq,
    sim,
    churns,
  };
}
