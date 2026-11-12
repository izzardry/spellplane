/**
 * Joining a room whose state this browser has not reconciled yet (DESIGN "Specification: network protocol and
 * secrecy", Sequencing 1, Liveness, Sync; "Multiplayer architecture", Resume: later arrivals reconcile to the copy
 * with the highest sequence number; decision M1-C: a fresh joiner's seq-0 table may differ from the creator's).
 * A joiner must not elect itself, or claim, from a state that is behind the room: it follows the sequencer the room
 * names, catches up, and only then elects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { createTable, reduce } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { TEST_GAME } from '../../unit/core/helpers';
import { FAULTS } from './scenarios';
import { agreed, expectConverged, makeSim, until, type SimPeer } from './sim';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

const DELAY = { delay: { min: 5, max: 40 } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A lobby table: `n` free chairs, nobody seated, seq 0. */
function lobby(n: number, format: '1v1' | 'ffa4'): { seq: number; state: TableState } {
  const state = createTable({ game: TEST_GAME, format, seats: Array.from({ length: n }, (_, i) => ({ name: '', colour: i })) });
  return { seq: 0, state };
}

const claims = (p: SimPeer): number => p.engine.messages().filter((r) => r.dir === 'out' && r.msg.t === 'claim').length;

describe('a fresh joiner meets a seated creator', () => {
  it.each([
    ['sorts lower', 2, 5],
    ['sorts higher', 7, 5],
  ])('a joiner whose peer id %s than the creator’s follows the creator, catches up and agrees on one hash', async (_what, joinerIndex, creatorIndex) => {
    const sim = makeSim({ engines: 0, seed: 70 + joinerIndex, ...DELAY });
    // The creator's table (two chairs, 1v1); it sits down alone.
    const creator = sim.add(creatorIndex, lobby(2, '1v1'));
    await vi.advanceTimersByTimeAsync(50);
    expect(creator.engine.isSequencing()).toBe(true);
    creator.engine.propose({ type: 'seatTake', by: 's0', cid: 'sit', seat: 's0', name: 'Creator', colour: 1, peer: creator.peerId });
    expect(creator.engine.seq()).toBe(1);
    // The joiner has nothing saved: its own seq-0 table is another format with four free chairs.
    const joiner = sim.add(joinerIndex, lobby(4, 'ffa4'));
    await until(() => agreed(sim.peers), 20_000, 'the joiner connected');
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(p.engine.sequencerId()).toBe(creator.peerId);
    expect(joiner.engine.confirmedState().format).toBe('1v1');
    expect(Object.keys(joiner.engine.confirmedState().seats)).toEqual(['s0', 's1']);
    // Nobody fights over the role.
    const before = claims(creator) + claims(joiner);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(claims(creator) + claims(joiner)).toBe(before);
    expect(before).toBeLessThanOrEqual(2);
    // The joiner takes the other chair and plays.
    joiner.engine.propose({ type: 'seatTake', by: 's1', cid: 'join-sit', seat: 's1', name: 'Joiner', colour: 2, peer: joiner.peerId });
    await expectConverged(sim.peers);
    expect(joiner.engine.seat()).toBe('s1');
    joiner.engine.propose({ type: 'life', by: 's1', cid: 'join-life', seat: 's1', delta: -2 });
    const h = await expectConverged(sim.peers);
    expect(creator.engine.state().seats.s1!.life).toBe(18);
    expect(joiner.engine.sequencerId()).toBe(creator.peerId);
    expect(h).toBeTruthy();
  });

  it('a joiner whose older save seats it at the lowest chair follows the room and catches up before it elects', async () => {
    // The joiner sat at s0 once (seq 1) and left (seq 2); the creator took s0 since. The joiner's save is from seq 1.
    const free = lobby(2, '1v1');
    const sit: Action = { type: 'seatTake', by: 's0', cid: 'old-sit', seat: 's0', name: 'Old', colour: 2, peer: 'peer2', seq: 1 };
    const leave: Action = { type: 'seatLeave', by: 's0', cid: 'old-leave', seat: 's0', seq: 2 };
    const atOne = reduce(free.state, sit);
    const atTwo = reduce(atOne, leave);
    const sim = makeSim({ engines: 0, seed: 81, ...DELAY });
    const creator = sim.add(5, { seq: 2, state: atTwo });
    await vi.advanceTimersByTimeAsync(50);
    creator.engine.propose({ type: 'seatTake', by: 's0', cid: 'sit', seat: 's0', name: 'Creator', colour: 1, peer: creator.peerId });
    for (let i = 0; i < 5; i++) creator.engine.propose({ type: 'life', by: 's0', cid: `c-${i}`, seat: 's0', delta: -1 });
    expect(creator.engine.seq()).toBe(8);
    const joiner = sim.add(2, { seq: 1, state: atOne });
    expect(joiner.engine.seat()).toBe('s0');
    await until(() => agreed(sim.peers), 20_000, 'the joiner connected');
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(p.engine.sequencerId()).toBe(creator.peerId);
    expect(joiner.engine.seat()).toBeNull();
    expect(joiner.engine.state().seats.s0!.life).toBe(15);
    const before = claims(creator) + claims(joiner);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(claims(creator) + claims(joiner)).toBe(before);
  });

  it.each([91, 92, 93, 94, 95, 96])('under the acceptance faults (delay ≤400 ms, drop), a fresh joiner and a seated creator agree on one sequencer and hash (seed %i)', async (seed) => {
    const sim = makeSim({ engines: 0, seed, ...FAULTS });
    const creator = sim.add(5, lobby(2, '1v1'));
    await vi.advanceTimersByTimeAsync(50);
    creator.engine.propose({ type: 'seatTake', by: 's0', cid: 'sit', seat: 's0', name: 'Creator', colour: 1, peer: creator.peerId });
    // Both orders of peer ids, and a joiner arriving while the creator still acts.
    const joiner = sim.add(seed % 2 ? 2 : 8, lobby(4, 'ffa4'));
    for (let i = 0; i < 4; i++) {
      creator.engine.propose({ type: 'life', by: 's0', cid: `c-${i}`, seat: 's0', delta: -1 });
      await vi.advanceTimersByTimeAsync(100);
    }
    await until(() => agreed(sim.peers), 30_000, 'the joiner connected');
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(p.engine.sequencerId()).toBe(creator.peerId);
    joiner.engine.propose({ type: 'seatTake', by: 's1', cid: 'join-sit', seat: 's1', name: 'Joiner', colour: 2, peer: joiner.peerId });
    await expectConverged(sim.peers);
    expect(joiner.engine.seat()).toBe('s1');
    expect(sim.net.delivered.filter((d) => d.msg.t === 'claim').length).toBeLessThan(20);
  });
});
