// The BroadcastChannel transport drops a peer whose beats stopped, but not on a beat that ran late because this page's
// main thread was blocked: the peers' beats are still queued behind it (gate M8: a theme switch on a CI runner).
import { describe, expect, it } from 'vitest';
import { STALL_MS, stalledBeat } from '../../../src/net/broadcast';

describe('stalledBeat', () => {
  it('the first beat and beats on time are not stalls; a beat more than two beats late is', () => {
    expect(stalledBeat(null, 5000)).toBe(false);
    expect(stalledBeat(1000, 2000)).toBe(false);
    expect(stalledBeat(1000, 1000 + STALL_MS)).toBe(false);
    expect(stalledBeat(1000, 1001 + STALL_MS)).toBe(true);
  });
});
