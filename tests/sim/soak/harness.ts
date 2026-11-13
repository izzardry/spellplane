/**
 * Long-session soak harness (PLAN M5-P6: "long-session soak test"; PLAN Milestone 5, Acceptance tests: "a 5,000-action
 * soak on four simulated peers ends with equal hashes and bounded memory"). Builds on tests/sim/net/sim.ts (loopback
 * network with seeded delay, drop and reordering; Vitest fake timers). Contracts: M5-C. Implementer: M5-P6
 * (tests/sim/soak.test.ts and this file).
 *
 * "Bounded memory" is measured on what the engines retain, not on the process heap (which Vitest and V8 make noisy):
 * the counts below must stay under limits that do not grow with the number of actions, apart from the log itself.
 */
import type { LoopbackOptions } from '../../../src/net/loopback';

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
export function runSoak(_opts: SoakOptions): Promise<SoakReport> {
  return Promise.reject(new Error('not implemented: M5-P6'));
}
