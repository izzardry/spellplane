/**
 * The M1-P1 acceptance scenarios (./scenarios.ts) under more seeds than ./acceptance.test.ts, so a fault schedule
 * the fixed seeds happen to miss still gets exercised. SWEEP=<n> runs n seeds per scenario (default 3); the
 * scenarios are deterministic per seed, so a failure here reproduces with that seed.
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { concurrentDrags, convergence, handover, handoverTime, lateJoiner, sequencerReturns } from './scenarios';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

const SEEDS = Array.from({ length: Number(process.env.SWEEP ?? 3) }, (_, i) => 5000 + i);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('M1-P1 scenarios under more seeds', () => {
  it.each(SEEDS)('3 engines converge over 2,000 random actions (seed %i)', async (seed) => {
    await convergence(3, seed);
  });
  it.each(SEEDS)('a killed sequencer is replaced without losing acknowledged actions (seed %i)', async (seed) => {
    await handover(seed, false);
  });
  it.each(SEEDS)('a silent sequencer is replaced without losing acknowledged actions (seed %i)', async (seed) => {
    await handover(seed, true);
  });
  it.each(SEEDS)('handover time after a kill and after silence (seed %i)', async (seed) => {
    await handoverTime(seed, false);
    await handoverTime(seed, true);
  });
  it.each(SEEDS)('the sequencer comes back (seed %i)', async (seed) => {
    await sequencerReturns(seed, false);
    await sequencerReturns(seed, true);
  });
  it.each(SEEDS)('late joiners reach the same hash (seed %i)', async (seed) => {
    await lateJoiner(seed, 'fresh');
    await lateJoiner(seed, 'tail');
    await lateJoiner(seed, 'far');
  });
  it.each(SEEDS)('concurrent drags resolve to the last sequenced move (seed %i)', async (seed) => {
    await concurrentDrags(seed);
  });
});
