/**
 * PLAN Milestone 5 acceptance (M5-P6, long-session soak): "a 5,000-action soak on four simulated peers ends with equal
 * hashes and bounded memory". Four engines on a LoopbackNetwork with seeded delay, drop and the reordering independent
 * delays cause, plus peer loss: a peer that is not the sequencer is killed and revived again and again (PLAN "Standing
 * rules for tests": delay, drop, reordering and peer loss).
 *
 * Bounded memory is measured on what each engine retains (tests/sim/soak/harness.ts; decision M5-C), never on wall time
 * or the process heap: every structure stays under a limit that does not grow with the number of actions, and the
 * structures that are not caches are back to empty once the table is quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInvariants } from '../../src/core/invariants';
import { ENGINE_RETAIN_LIMITS, type EngineRetained } from '../../src/net/engine';
import { RETAIN_ACTIONS } from '../../src/net/sequencer';
import { runSoak, runSoakDetailed } from './soak/harness';

vi.mock('../../src/net/identity', async () => (await import('./net/fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The acceptance faults: delay up to 250 ms (hence reordering) and 3% drop on every channel. */
const FAULTS = { delay: { min: 0, max: 250 }, drop: 0.03 };

/**
 * Remembered ids whose caps (REMEMBER_CIDS, KEEP_OWN_CIDS, KEEP_NACKS) lie above what a 5,000-action soak reaches: they
 * grow with the actions up to their caps, by at most one per sequenced action.
 */
const UNDER_CAP: (keyof EngineRetained)[] = ['cids', 'ownCids', 'nacked'];

/**
 * How much a structure may hold at the end beyond what it held half-way: a peer was away at the half-way probe (one
 * more peer entry and its catch-up asks), and the hash windows (both sides' last KEEP_HASHES hashes) were still filling.
 */
const SLACK: Record<keyof EngineRetained, number> = {
  log: 0,
  buffer: 0,
  cids: 0,
  marks: 0,
  pending: 0,
  messages: 0,
  ownCids: 0,
  sentAt: 0,
  nacked: 0,
  held: 0,
  queued: 0,
  asks: 8,
  deferred: 0,
  lostOwn: 0,
  hashes: 32,
  applyAt: 0,
  emitted: 0,
  deadlines: 0,
  peers: 1,
};

/** Structures that hold nothing once every peer is back and the table is quiet (no cache, no window). */
const DRAINED: (keyof EngineRetained)[] = ['pending', 'buffer', 'sentAt', 'held', 'queued', 'deferred', 'lostOwn'];

describe('M5-P6 acceptance: long-session soak', () => {
  it('5,000 actions on four simulated peers under delay, drop, reordering and peer loss end with equal hashes and bounded memory', async () => {
    const actions = 5000;
    const run = await runSoakDetailed({ peers: 4, actions, seed: 2026, churnEvery: 600, ...FAULTS });
    const { report, engines, half, stateBytes, startSeq, sim } = run;

    // Equal hashes: every peer reached the same seq, at least the 5,000 actions past the start, and one state.
    expect(report.hashes).toHaveLength(4);
    expect(new Set(report.hashes).size).toBe(1);
    expect(report.seq).toBeGreaterThanOrEqual(startSeq + actions);
    for (const p of sim.peers) expect(p.engine.seq()).toBe(report.seq);
    expect(checkInvariants(sim.peers[0]!.engine.confirmedState())).toEqual([]);
    // Peer loss happened, over and over, and every peer is back.
    expect(run.churns).toBeGreaterThanOrEqual(5);
    for (const p of sim.peers) expect(p.engine.status()).toBe('connected');

    // Bounded memory, per peer: every structure under a limit that does not depend on the number of actions.
    for (const [i, r] of engines.entries()) {
      for (const k of Object.keys(ENGINE_RETAIN_LIMITS) as (keyof EngineRetained)[]) {
        expect(r[k], `peer${i} ${k}`).toBeLessThanOrEqual(ENGINE_RETAIN_LIMITS[k]);
      }
      // What is not a cache or a window is empty again once the table is quiet.
      for (const k of DRAINED) expect(r[k], `peer${i} ${k}`).toBe(0);
      // The catch-up window is full and no larger: older actions live only in the snapshot.
      expect(r.log, `peer${i} retained actions`).toBe(RETAIN_ACTIONS);
      expect(report.retained[i]).toEqual({ messages: r.messages, pending: 0, buffered: 0, history: RETAIN_ACTIONS });
    }
    // From half-way to the end nothing grew with the actions (twice the actions, the same retained tail, rewind states,
    // apply times and the rest), which the caps alone cannot show: a structure that grew under its cap would pass them.
    // Left out: the remembered ids whose caps lie above what this soak reaches, which grow with the actions up to their
    // caps (each sequenced action adds at most one), and the debug ring of wire messages (dev and test builds only).
    for (const [i, r] of engines.entries()) {
      const h = half[i]!;
      for (const k of Object.keys(ENGINE_RETAIN_LIMITS) as (keyof EngineRetained)[]) {
        if (UNDER_CAP.includes(k) || k === 'messages') continue;
        expect(r[k], `peer${i} ${k}: ${h[k]} half-way`).toBeLessThanOrEqual(h[k] + SLACK[k]);
      }
      for (const k of UNDER_CAP) expect(r[k] - h[k], `peer${i} ${k} added in the second half`).toBeLessThanOrEqual(report.seq - run.halfSeqs[i]!);
    }
    // The shared state keeps no history of its own: it grows with what lies on the table (random play leaves tokens
    // behind), and its size per table object stays where it was half-way.
    expect(stateBytes.end).toBeLessThan(stateBytes.half * 1.25);
  }, 600_000);

  it('the same seed gives the same history: the soak is deterministic', async () => {
    const a = await runSoak({ peers: 4, actions: 400, seed: 7, churnEvery: 150, ...FAULTS });
    vi.useRealTimers();
    vi.useFakeTimers();
    const b = await runSoak({ peers: 4, actions: 400, seed: 7, churnEvery: 150, ...FAULTS });
    expect(new Set(a.hashes).size).toBe(1);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.seq).toBe(a.seq);
  }, 300_000);

  it.each([
    { what: 'reordering only, no loss', seed: 11, delay: { min: 0, max: 400 } },
    { what: 'heavy drop', seed: 12, delay: { min: 0, max: 100 }, drop: 0.15 },
    { what: 'ordered links with churn every 100 actions', seed: 13, delay: { min: 0, max: 200 }, ordered: true, churnEvery: 100 },
  ])('a shorter soak converges under $what', async (o) => {
    const { what: _what, ...opts } = o;
    const r = await runSoak({ peers: 4, actions: 800, ...opts });
    expect(new Set(r.hashes).size).toBe(1);
    expect(r.retained.every((x) => x.pending === 0 && x.buffered === 0)).toBe(true);
  }, 300_000);
});
