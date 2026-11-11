/**
 * The sequencer role, the election rule and the replica (DESIGN "Specification: network protocol and secrecy",
 * Sequencing 1-5, Sync), without a network.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import type { SequencedAction } from '../../../src/net/messages';
import { applySequenced, createSequencer, createSyncEngine, electSequencer, Replica, RETAIN_ACTIONS } from '../../../src/net/sequencer';
import type { PeerInfo } from '../../../src/net/types';
import { baseTable, libraryIds } from '../../sim/net/sim';
import { TEST_GAME } from '../core/helpers';

const player = (seat: string) => ({ seat, role: 'player' as const, self: false });
const life = (by: string, cid: string, delta = -1): Action => ({ type: 'life', by, cid, seat: by, delta });
const stamp = (a: Action, seq: number): SequencedAction => ({ ...a, seq }) as SequencedAction;

describe('Sequencer.sequence', () => {
  const { state } = baseTable(4);

  it('stamps seq = last + 1 and strips a proposed seq', () => {
    const s = createSequencer(state.seq);
    const r1 = s.sequence(state, { ...life('s1', 'c1'), seq: 999 }, player('s1'));
    expect(r1).toEqual({ ok: true, action: { ...life('s1', 'c1'), seq: state.seq + 1 } });
    const next = reduce(state, (r1 as { action: SequencedAction }).action);
    const r2 = s.sequence(next, life('s2', 'c2'), player('s2'));
    expect(r2.ok && r2.action.seq).toBe(state.seq + 2);
    expect(s.lastSeq).toBe(state.seq + 2);
  });

  it('refuses an action whose `by` is not the sender’s seat', () => {
    const r = createSequencer(state.seq).sequence(state, life('s0', 'c'), player('s1'));
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/not the sender's seat/) });
  });

  it('refuses actions only the sequencer may send, unless it sends them itself', () => {
    const s = createSequencer(state.seq);
    for (const a of [
      { type: 'sequencerClaim', by: 's1', cid: 'x1', fromSeq: 3, peer: 'peer1' },
      { type: 'away', by: 's1', cid: 'x2', seat: 's2', away: true },
      { type: 'commitClose', by: 's1', cid: 'x3', kind: 'rng', id: 'r1' },
      { type: 'respond', by: 's1', cid: 'x4', round: 'r', seat: 's2', response: 'timeout' },
    ] as Action[]) {
      expect(s.sequence(state, a, player('s1')), a.type).toEqual({ ok: false, reason: expect.stringMatching(/only the sequencer/) });
    }
    expect(s.sequence(state, { type: 'sequencerClaim', by: 's0', cid: 'x5', fromSeq: 3, peer: 'peer0' } as Action, { seat: 's0', role: 'player', self: true }).ok).toBe(true);
  });

  it('refuses hidden-zone actions from anyone but the zone’s owner', () => {
    const s = createSequencer(state.seq);
    const libOf0 = libraryIds(0).filter((id) => state.cards[id]!.zone === 'library:s0');
    expect(s.sequence(state, { type: 'draw', by: 's1', cid: 'd1', instanceId: libOf0[0]!, to: 'hand:s1' }, player('s1'))).toEqual({ ok: false, reason: expect.stringMatching(/belongs to s0/) });
    expect(s.sequence(state, { type: 'reveal', by: 's1', cid: 'r1', instanceId: libOf0[0]!, ref: { sid: 'x' }, salt: 's' }, player('s1')).ok).toBe(false);
    expect(s.sequence(state, { type: 'reorder', by: 's1', cid: 'o1', zone: 'library:s0', count: 1, orderHash: 'h' }, player('s1')).ok).toBe(false);
    expect(s.sequence(state, { type: 'revealTo', by: 's1', cid: 't1', instanceId: libOf0[0]!, seats: ['s2'] }, player('s1')).ok).toBe(false);
    expect(s.sequence(state, { type: 'draw', by: 's0', cid: 'd2', instanceId: libOf0[0]! }, player('s0')).ok).toBe(true);
    // Moving someone else's public card is fine: no rules enforcement.
    const theirs = Object.values(state.cards).find((c) => c.zone === 'battlefield:s0')!;
    expect(s.sequence(state, { type: 'tap', by: 's1', cid: 'tp', card: theirs.id, tapped: true }, player('s1')).ok).toBe(true);
  });

  it('lets a spectator chat but not act for a seat', () => {
    const s = createSequencer(state.seq);
    const spectator = { seat: null, role: 'spectator' as const, self: false };
    expect(s.sequence(state, { type: 'chat', by: 'spectator-1', cid: 'ch', text: 'hi', channel: 'spectator' }, spectator).ok).toBe(true);
    expect(s.sequence(state, life('s1', 'l'), spectator).ok).toBe(false);
    expect(s.sequence(state, { type: 'chat', by: 's1', cid: 'ch2', text: 'hi', channel: 'table' }, spectator).ok).toBe(false);
  });

  it('lets an unseated player only take a chair', () => {
    const s = createSequencer(state.seq);
    const unseated = { seat: null, role: 'player' as const, self: false };
    expect(s.sequence(state, life('s1', 'l'), unseated).ok).toBe(false);
    const free = reduce(state, { type: 'seatLeave', by: 's3', cid: 'lv', seat: 's3', seq: state.seq + 1 });
    expect(s.sequence(free, { type: 'seatTake', by: 's3', cid: 'tk', seat: 's3', name: 'Eve', colour: 5, peer: 'peer9' }, unseated).ok).toBe(true);
    expect(s.sequence(free, { type: 'seatTake', by: 's2', cid: 'tk2', seat: 's3', name: 'Eve', colour: 5, peer: 'peer9' }, unseated).ok).toBe(false);
  });

  it('refuses what the reducer refuses on the confirmed state, with its reason', () => {
    const r = createSequencer(state.seq).sequence(state, { type: 'tap', by: 's1', cid: 't', card: 'ghost', tapped: true }, player('s1'));
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/ghost/) });
    expect(createSequencer(state.seq).sequence(state, { type: 'nope', by: 's1', cid: 'n' } as unknown as Action, player('s1')).ok).toBe(false);
  });
});

describe('electSequencer', () => {
  const { state } = baseTable(4);
  const peer = (peerId: string, status: PeerInfo['status'] = 'connected', role: PeerInfo['role'] = 'player'): PeerInfo => ({ transportId: `t-${peerId}`, peerId, nickname: '', seat: null, role, status, lastSeq: 0 });

  it('picks the connected seated player with the lowest seat index', () => {
    expect(electSequencer(state, { peerId: 'peer2', seat: 's2', role: 'player' }, [peer('peer1'), peer('peer3')])).toBe('peer1');
    expect(electSequencer(state, { peerId: 'peer0', seat: 's0', role: 'player' }, [peer('peer1')])).toBe('peer0');
  });

  it('skips away and handshaking peers', () => {
    expect(electSequencer(state, { peerId: 'peer2', seat: 's2', role: 'player' }, [peer('peer0', 'away'), peer('peer1', 'handshake')])).toBe('peer2');
  });

  it('never picks a spectator', () => {
    expect(electSequencer(state, { peerId: 'peer3', seat: 's3', role: 'player' }, [peer('peer0', 'connected', 'spectator')])).toBe('peer3');
    expect(electSequencer(state, { peerId: 'zz', seat: null, role: 'spectator' }, [])).toBeNull();
  });

  it('uses the seat the state gives a peer id, not the one it claims', () => {
    expect(electSequencer(state, { peerId: 'peer3', seat: 's0', role: 'player' }, [peer('peer2')])).toBe('peer2');
  });

  it('falls back to the lowest peer id while no connected player holds a seat', () => {
    expect(electSequencer(state, { peerId: 'x9', seat: null, role: 'player' }, [peer('x2'), peer('x5')])).toBe('x2');
  });
});

describe('Replica (SyncEngine)', () => {
  const start = baseTable(2);
  const a1 = life('s0', 'a1');
  const b1 = life('s1', 'b1');
  const b2 = life('s1', 'b2', -2);

  it('applies own actions optimistically and refuses what the reducer refuses', () => {
    const r = createSyncEngine(TEST_GAME, start);
    expect(r.applyOwn(a1)).toBe(true);
    expect(r.view().seats.s0!.life).toBe(19);
    expect(r.confirmed()).toBe(start.state);
    expect(r.applyOwn({ type: 'tap', by: 's0', cid: 'bad', card: 'ghost', tapped: true })).toBe(false);
    expect(r.pending().map((a) => a.cid)).toEqual(['a1']);
  });

  it('drops the optimistic copy when its own action comes back and re-applies the rest on top of earlier ones', () => {
    const r = createSyncEngine(TEST_GAME, start);
    r.applyOwn(a1);
    r.applyOwn(life('s0', 'a2'));
    expect(r.receive(stamp(b1, start.seq + 1))).toBe('applied');
    expect(r.pending().map((a) => a.cid)).toEqual(['a1', 'a2']);
    expect(r.view().seats.s0!.life).toBe(18);
    expect(r.view().seats.s1!.life).toBe(19);
    expect(r.receive(stamp(a1, start.seq + 2))).toBe('applied');
    expect(r.pending().map((a) => a.cid)).toEqual(['a2']);
    expect(r.confirmed().seq).toBe(start.seq + 2);
    expect(r.confirmed().seats.s0!.life).toBe(19);
    expect(r.view().seats.s0!.life).toBe(18);
  });

  it('applies strictly in order: buffers a later seq, reports the gap, ignores duplicates', () => {
    const r = createSyncEngine(TEST_GAME, start);
    expect(r.receive(stamp(b2, start.seq + 2))).toBe('buffered');
    expect(r.gap()).toBe(start.seq);
    expect(r.seq()).toBe(start.seq);
    expect(r.receive(stamp(b1, start.seq + 1))).toBe('applied');
    expect(r.seq()).toBe(start.seq + 2);
    expect(r.gap()).toBeNull();
    expect(r.receive(stamp(b1, start.seq + 1))).toBe('duplicate');
    expect(r.confirmed().seats.s1!.life).toBe(17);
  });

  it('rolls back a refused own action', () => {
    const r = createSyncEngine(TEST_GAME, start);
    r.applyOwn(a1);
    expect(r.reject('a1')).toEqual(a1);
    expect(r.view()).toBe(r.confirmed());
    expect(r.reject('a1')).toBeNull();
  });

  it('still advances seq for a sequenced action the reducer refuses, the same way on every peer', () => {
    const bad = stamp({ type: 'tap', by: 's0', cid: 'x', card: 'ghost', tapped: true }, start.seq + 1);
    const s = applySequenced(start.state, bad);
    expect(s.seq).toBe(start.seq + 1);
    expect({ ...s, seq: start.seq }).toEqual(start.state);
  });

  it('serves a tail of retained actions and null once they are no longer held', () => {
    const r = new Replica(TEST_GAME, start);
    for (let i = 1; i <= RETAIN_ACTIONS + 10; i++) r.receive(stamp(life('s1', `c${i}`, i % 2 ? -1 : 1), start.seq + i));
    expect(r.tail(r.seq())).toEqual([]);
    expect(r.tail(r.seq() - 3)!.map((a) => a.cid)).toEqual([`c${RETAIN_ACTIONS + 8}`, `c${RETAIN_ACTIONS + 9}`, `c${RETAIN_ACTIONS + 10}`]);
    expect(r.tail(start.seq)).toBeNull();
    expect(r.seqOf('c5')).toBe(start.seq + 5);
    // The sync snapshot is the latest periodic snapshot with the tail after it, enough to rebuild the head.
    const { snapshot, tail } = r.syncSnapshot();
    expect(snapshot.seq % 200 === 0 || snapshot.seq === start.seq).toBe(true);
    const other = new Replica(TEST_GAME, start);
    other.load(snapshot, tail);
    expect(other.confirmed()).toEqual(r.confirmed());
  });

  it('loads a snapshot plus tail, keeps pending actions on top and drops those the tail already holds', () => {
    const src = new Replica(TEST_GAME, start);
    for (let i = 1; i <= 5; i++) src.receive(stamp(life('s1', `c${i}`), start.seq + i));
    const r = new Replica(TEST_GAME, start);
    r.applyOwn(life('s0', 'mine'));
    r.applyOwn(life('s0', 'c4'));
    r.load({ seq: start.seq + 3, state: src.tail(start.seq)!.slice(0, 3).reduce<TableState>((s, a) => applySequenced(s, a), start.state) }, src.tail(start.seq + 3)!);
    expect(r.seq()).toBe(start.seq + 5);
    expect(r.confirmed()).toEqual(src.confirmed());
    expect(r.pending().map((a) => a.cid)).toEqual(['mine']);
  });

  it('forgets an abandoned history so its own actions can be proposed again', () => {
    const r = new Replica(TEST_GAME, start);
    for (let i = 1; i <= 4; i++) r.receive(stamp(life('s1', `c${i}`), start.seq + i));
    expect(r.forget(start.seq + 3).map((a) => a.cid)).toEqual(['c3', 'c4']);
    expect(r.seqOf('c3')).toBeUndefined();
    expect(r.seqOf('c2')).toBe(start.seq + 2);
    r.requeue([life('s1', 'c3'), life('s1', 'c2')]);
    expect(r.pending().map((a) => a.cid)).toEqual(['c3']);
  });
});
