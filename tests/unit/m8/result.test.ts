/**
 * M8-C: the end of a game and the opening hand (contracts.md Part D; core/reducer/result.ts). `concede` in 1v1, in a
 * free-for-all and in Two-Headed Giant; `dealt` once per seat and game; `isOut` and the turn pass skipping a seat that
 * is out; totality and determinism; the result is cleared by the next game.
 */
import { describe, expect, it } from 'vitest';
import { explain, isOut, reduce } from '../../../src/core/reducer';
import { stateHash } from '../../../src/core/hash';
import { enterStage } from '../../../src/core/stage';
import type { Action } from '../../../src/core/actions';
import type { Format, TableState } from '../../../src/core/types';
import { act, fresh, no, ok } from '../core/helpers';

/** A table in its first game (stage 'match'), every seat taken. */
function playing(format: Format = '1v1', seats = 2): TableState {
  return { ...fresh(format, seats), stage: 'match', games: 1 };
}

describe('concede (contracts.md Part D)', () => {
  it('1v1: the other seat wins', () => {
    const s = ok(playing(), { ...act('concede', {}, 's1'), seq: 1 });
    expect(s.seats.s1!.conceded).toBe(true);
    expect(s.result).toEqual({ winners: ['s0'], reason: 'concede', atSeq: 1 });
    expect(isOut(s, 's1')).toBe(true);
    expect(isOut(s, 's0')).toBe(false);
  });

  it('free-for-all: the seat is out; the game ends when one seat is left', () => {
    let s = playing('ffa4', 4);
    s = ok(s, act('concede', {}, 's2'));
    expect(s.result).toBeUndefined();
    s = ok(s, act('concede', {}, 's0'));
    expect(s.result).toBeUndefined();
    s = ok(s, { ...act('concede', {}, 's3'), seq: 9 });
    expect(s.result).toEqual({ winners: ['s1'], reason: 'concede', atSeq: 9 });
  });

  it('Two-Headed Giant: a team is out when both of its seats conceded', () => {
    let s = playing('2hg', 4);
    s = ok(s, act('concede', {}, 's2'));
    expect(s.result).toBeUndefined();
    expect(isOut(s, 't1')).toBe(false);
    s = ok(s, act('concede', {}, 's3'));
    expect(isOut(s, 't1')).toBe(true);
    expect(s.result?.winners).toEqual(['s0', 's1']);
  });

  it('is refused twice, after the end, outside a game and for an empty chair', () => {
    const one = ok(playing('ffa3', 3), act('concede', {}, 's0'));
    no(one, act('concede', {}, 's0'), /already conceded/);
    const over = ok(playing(), act('concede', {}, 's0'));
    no(over, act('concede', {}, 's1'), /over/);
    no(fresh(), act('concede', {}, 's0'), /while it is played/);
  });

  it('a turn pass skips a seat that conceded', () => {
    let s = playing('ffa3', 3);
    s = ok(s, act('concede', {}, 's1'));
    s = ok(s, act('turnPass', { to: 's1' }, 's0'));
    expect(s.turn.active).toBe('s2');
  });

  it('a new game clears the result and the concessions', () => {
    let s = ok(playing(), act('concede', {}, 's1'));
    // The stage change itself (the others' confirmation round is core/stage.ts's, tested there).
    s = enterStage(s, 'build', s.seq + 1);
    expect(s.result).toBeUndefined();
    expect(s.seats.s1!.conceded).toBeUndefined();
  });

  it('a table without a result hashes as before (no new keys)', () => {
    const s = playing();
    expect(Object.keys(s)).not.toContain('result');
    expect(Object.keys(s.seats.s0!)).not.toContain('conceded');
  });
});

describe('dealt (contracts.md Part D)', () => {
  it('marks the seat dealt for the current game, once', () => {
    let s = playing();
    s = ok(s, act('dealt', { game: 1 }, 's0'));
    expect(s.seats.s0!.dealt).toBe(1);
    no(s, act('dealt', { game: 1 }, 's0'), /already been dealt/);
    no(s, act('dealt', { game: 2 }, 's1'), /plays game 1/);
    s = ok(s, act('dealt', { game: 1 }, 's1'));
    expect(s.seats.s1!.dealt).toBe(1);
  });
});

describe('the new actions are total and deterministic', () => {
  const malformed: unknown[] = [
    { type: 'concede', by: 'nobody', cid: 'x' },
    { type: 'dealt', by: 's0', cid: 'x', game: 'one' },
    { type: 'dealt', by: 's0', cid: 'x', game: -1 },
    { type: 'seatInvite', by: 's0', cid: 'x', seat: 's1', h: 3 },
    { type: 'seatClaim', by: 's1', cid: 'x' },
    { type: 'playOn', by: 's0', cid: 'x', without: 'all' },
  ];
  it('malformed actions are refused with a reason, never an internal error', () => {
    const s = playing();
    for (const a of malformed) {
      expect(reduce(s, a as Action)).toBe(s);
      const why = explain(s, a as Action);
      expect(why).not.toBeNull();
      expect(why).not.toMatch(/internal error/);
    }
  });
  it('the same actions give the same hash', async () => {
    const run = (): Promise<string> => {
      let s = playing('ffa3', 3);
      for (const a of [act('dealt', { game: 1 }, 's0'), act('concede', {}, 's1'), act('turnPass', { to: 's1' }, 's0'), act('concede', {}, 's2')]) s = reduce(s, a);
      return stateHash(s);
    };
    expect(await run()).toBe(await run());
  });
});
