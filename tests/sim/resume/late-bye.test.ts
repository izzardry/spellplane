/**
 * M8-P5 (persistence.md section 5, leaving on the wire): a reloaded page replaces its old connection; a `bye {leave}`
 * that the old page sends afterwards over the replaced connection is not a player leaving (no `onLeave`, so no
 * `Ben left …` notice), since the player is connected again. Engines on the simulated network under fake timers.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agreed, makeSim, until, type SimPeer } from '../net/sim';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('the late bye of a replaced connection does not report the reconnected player as gone', async () => {
  const sim = makeSim({ engines: 3, seed: 31, delay: { min: 5, max: 40 } });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const [a, b] = sim.peers as [SimPeer, SimPeer];
  const left: string[] = [];
  a.engine.onLeave((peerId) => left.push(peerId));
  const save = { seq: b.engine.seq(), state: b.engine.confirmedState() };
  // The old page hangs (its transport says nothing) while the reloaded page connects with the same identity.
  b.transport.silent = true;
  const reloaded = sim.add(1, save);
  await until(
    () => a.engine.peers().filter((p) => p.peerId === b.peerId && p.status === 'connected').some((p) => p.transportId === reloaded.transport.selfId),
    20_000,
    'the reloaded page',
  );
  // The old page wakes up only to close: its bye goes out over the replaced connection.
  b.transport.silent = false;
  b.engine.leave();
  await vi.advanceTimersByTimeAsync(2000);
  expect(left).toEqual([]);
  expect(a.engine.peers().some((p) => p.peerId === b.peerId && p.status === 'connected')).toBe(true);
});
