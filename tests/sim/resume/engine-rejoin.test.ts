/**
 * M8-P5: engine behaviour of rejoin on the simulated network under fake timers. Leaving on the wire (persistence.md
 * section 5): a `bye {leave}` that a reloaded page's old connection sends after the reload replaced it is not a player
 * leaving (no `onLeave`, so no `Ben left …` notice). Standby (contracts.md Part G item 5): a standby sequencer's own
 * moves wait in its pending queue until it is live, in order, instead of being refused and rolled back.
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
  a.engine.onLeave!((peerId) => left.push(peerId));
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

it('a standby sequencer keeps its own moves pending until it is live, then sequences them in order (chat after them waits)', async () => {
  const sim = makeSim({ engines: 2, seed: 32, delay: { min: 5, max: 40 } });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const seqr = sim.peers.find((p) => p.engine.isSequencing())!;
  const seat = seqr.seat;
  const life0 = seqr.engine.confirmedState().seats[seat]!.life;
  seqr.engine.setHead({ live: false });
  expect(seqr.engine.propose({ type: 'life', by: seat, cid: 'held-move', seat, delta: -1 })).toBe(true);
  expect(seqr.engine.propose({ type: 'chat', by: seat, cid: 'held-chat', text: 'after the move', channel: 'table' })).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(seqr.rolledBack.size).toBe(0);
  expect(seqr.engine.pending().map((a) => a.cid)).toEqual(['held-move', 'held-chat']);
  seqr.engine.setHead({ live: true });
  await until(() => seqr.engine.pending().length === 0, 5000, 'sequenced once live');
  expect(seqr.engine.confirmedState().seats[seat]!.life).toBe(life0 - 1);
  const order = [...seqr.log.values()].filter((a) => a.cid.startsWith('held-')).map((a) => a.cid);
  expect(order).toEqual(['held-move', 'held-chat']);
});
