/**
 * M8-C: the play count (contracts.md Part D "The play count"; Part G "Rejoin" item 2). `isPlayAction` over every action
 * type; the replica counts moves beside seq (also after a rewind and in snapshots); `newerHead` decides by (play, seq,
 * peerId), so a copy with more moves wins over a longer copy of chat; the count changes no hash.
 */
import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, type Action, type ActionType } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { isPlayAction } from '../../../src/core/log';
import { newerHead } from '../../../src/net/engine';
import { Replica } from '../../../src/net/sequencer';
import type { SequencedAction } from '../../../src/net/messages';
import { act, fresh } from '../core/helpers';

const NOT_MOVES: readonly ActionType[] = ['chat', 'caption', 'seatTake', 'seatLeave', 'away', 'seatInvite', 'seatClaim', 'playOn', 'sequencerClaim', 'snapshotHash'];

describe('isPlayAction (contracts.md Part D)', () => {
  it('is false for chat, presence and seat records and the sequencer records, true for every other action type', () => {
    for (const type of ACTION_TYPES) {
      const a = { type, by: 's0', cid: 'x' } as unknown as Action;
      expect(isPlayAction(a), type).toBe(!NOT_MOVES.includes(type));
    }
  });
});

const seq = (a: Action, n: number): SequencedAction => ({ ...a, seq: n }) as SequencedAction;

describe('the replica counts moves beside seq', () => {
  it('counts sequenced moves, not chat; snapshots carry the count; a rewind recounts', () => {
    const r = new Replica(null, { seq: 0, state: fresh() });
    r.receive(seq(act('life', { seat: 's0', delta: -1 }), 1));
    r.receive(seq(act('chat', { text: 'hi', channel: 'table' }), 2));
    r.receive(seq(act('life', { seat: 's1', delta: -2 }, 's1'), 3));
    expect(r.seq()).toBe(3);
    expect(r.play()).toBe(2);
    expect(r.snapshot().play).toBe(2);
    const copy = new Replica(null, r.snapshot());
    expect(copy.play()).toBe(2);
    r.rewind(1);
    expect(r.seq()).toBe(1);
    expect(r.play()).toBe(1);
  });

  it('the count is not part of the state', () => {
    const r = new Replica(null, { seq: 0, state: fresh() });
    r.receive(seq(act('life', { seat: 's0', delta: -1 }), 1));
    expect(canonicalJson(r.confirmed())).not.toContain('play');
  });
});

describe('newest is decided by (play, seq, peerId) (contracts.md Part G "Rejoin" item 2)', () => {
  it('a copy with more moves wins over a longer copy of chat', () => {
    const moves = { play: 9, seq: 12, peerId: 'bbbb' };
    const chatty = { play: 6, seq: 16, peerId: 'aaaa' };
    expect(newerHead(moves, chatty)).toBeGreaterThan(0);
    expect(newerHead(chatty, moves)).toBeLessThan(0);
  });
  it('then the higher seq, then the smaller peer id', () => {
    expect(newerHead({ play: 3, seq: 8, peerId: 'b' }, { play: 3, seq: 7, peerId: 'a' })).toBeGreaterThan(0);
    expect(newerHead({ play: 3, seq: 7, peerId: 'a' }, { play: 3, seq: 7, peerId: 'b' })).toBeGreaterThan(0);
    expect(newerHead({ play: 3, seq: 7, peerId: 'a' }, { play: 3, seq: 7, peerId: 'a' })).toBe(0);
  });
  it('a peer without a play count compares by seq as before', () => {
    expect(newerHead({ seq: 16, peerId: 'a' }, { play: 9, seq: 12, peerId: 'b' })).toBeGreaterThan(0);
  });
});
