/**
 * PLAN M1-P1 acceptance (simulated network, Vitest, LoopbackNetwork), on every channel random delay up to 400 ms,
 * 5% drop and the reordering that independent delays cause:
 *  1. With 2, 3 and 4 engines, 2,000 random actions converge to one state hash.
 *  2. Killing the sequencer mid-stream hands over within the timeout and loses no acknowledged action.
 *  3. A late joiner reaches the same hash.
 *  4. Two players dragging the same card resolve to the last sequenced move on all peers.
 * The scenarios live in ./scenarios.ts; ./sweep.test.ts runs them with more seeds.
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { concurrentDrags, convergence, handover, handoverTime, lateJoiner, sequencerReturns } from './scenarios';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('M1-P1 acceptance: convergence', () => {
  it.each([2, 3, 4])('%i engines under delay ≤400 ms, 5%% drop and reordering converge on one state hash over 2,000 random actions', async (n) => {
    await convergence(n, 100 + n);
  });
});

describe('M1-P1 acceptance: sequencer handover', () => {
  it('killing the sequencer mid-stream (peers see it leave) loses no acknowledged action', async () => {
    await handover(37, false);
  });

  it('a sequencer that falls silent mid-stream without leaving is replaced and no acknowledged action is lost', async () => {
    await handover(31, true);
  });

  it('after the sequencer is killed, the next action is sequenced within the away timeout', async () => {
    await handoverTime(41, false);
  });

  it('after the sequencer falls silent, the next action is sequenced within the away timeout plus the claim (5 s)', async () => {
    await handoverTime(43, true);
  });
});

describe('M1-P1: the sequencer comes back', () => {
  it('a killed sequencer that rejoins takes over again from the history the others acknowledged', async () => {
    await sequencerReturns(61, false);
  });

  it('a sequencer cut off without leaving takes over again from the history the others acknowledged', async () => {
    await sequencerReturns(62, true);
  });
});

describe('M1-P1 acceptance: late joiner', () => {
  it('a fresh browser at seq 0 whose own seq-0 table differs reaches the same hash (snapshot)', async () => {
    await lateJoiner(55, 'fresh');
  });

  it('a browser restoring a save less than 500 actions behind reaches the same hash (tail)', async () => {
    await lateJoiner(56, 'tail');
  });

  it('a browser restoring a save more than 500 actions behind reaches the same hash (snapshot plus tail)', async () => {
    await lateJoiner(57, 'far');
  });
});

describe('M1-P1 acceptance: concurrent drags', () => {
  it('two players dragging the same card resolve to the last sequenced move on all peers', async () => {
    await concurrentDrags(77);
  });
});
