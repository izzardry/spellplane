/**
 * Pick-timer deadlines (core/drafting.ts `draftDeadlines`; DESIGN "Specification: card data, packs and draft formats":
 * "Pick timer, when enabled: 45 s for the first pick of a pack, reduced by 3 s per pick to a floor of 10 s";
 * "Specification: network protocol and secrecy", Timers: only the sequencer's clock decides).
 */
import { describe, expect, it } from 'vitest';
import { deadlines } from '../../../../src/core/deadlines';
import { draftDeadlines, pickTimerMs } from '../../../../src/core/drafting';
import type { TableState } from '../../../../src/core/types';
import { act, draftOf, draftTable, ok, openPack, packCards } from '../open/helpers';

function timed(state: TableState): TableState {
  return { ...state, draft: { ...draftOf(state), pickTimer: true } };
}

function opened(seats: number, size = 15): TableState {
  let s = timed(draftTable(seats, { format: 'pass', packs: 3, picks: 1 }));
  for (const seat of draftOf(s).drafters) s = openPack(s, seat, packCards(size), 0, 'down');
  return s;
}

describe('draftDeadlines', () => {
  it('times the front pack of every queue from its sinceSeq, emitting draftTimeout for its pick number', () => {
    const s = opened(3);
    const d = draftOf(s);
    const list = draftDeadlines(s);
    expect(list).toHaveLength(3);
    for (const seat of d.drafters) {
      const pack = d.packs[d.queues[seat]![0]!]!;
      expect(list).toContainEqual({ key: `pick:${pack.id}:0`, fromSeq: pack.sinceSeq, afterMs: 45_000, emit: [{ type: 'draftTimeout', packId: pack.id, picks: 0 }] });
    }
    // The table's deadline list includes them.
    expect(deadlines(s).filter((x) => x.key.startsWith('pick:'))).toHaveLength(3);
  });

  it('shortens by 3 s per pick to a floor of 10 s, with a new key for every pick', () => {
    expect([0, 1, 2, 5, 11, 12, 13, 20].map(pickTimerMs)).toEqual([45_000, 42_000, 39_000, 30_000, 12_000, 10_000, 10_000, 10_000]);
    let s = opened(2);
    const a = draftOf(s).queues.s0![0]!;
    s = ok(s, act('pick', { packId: a, count: 1 }, 's0'));
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    const b = draftOf(s).queues.s1![0]!;
    s = ok(s, act('pick', { packId: b, count: 1 }, 's1'));
    s = ok(s, act('packPass', { packId: b, to: 's0', count: 14 }, 's1'));
    // s1's front is now s0's pack at its second pick, timed from the seq of s1's pick that brought it to the front.
    const pick1 = draftDeadlines(s).find((x) => x.key.startsWith(`pick:${a}:`))!;
    expect(pick1).toMatchObject({ key: `pick:${a}:1`, afterMs: 42_000, fromSeq: draftOf(s).packs[a]!.sinceSeq });
    expect(draftOf(s).packs[a]!.sinceSeq).toBe(s.seq - 1);
  });

  it('a pack queued behind another is not timed until it reaches the front', () => {
    let s = opened(2);
    const a = draftOf(s).queues.s0![0]!;
    s = ok(s, act('pick', { packId: a, count: 1 }, 's0'));
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    expect(draftOf(s).queues.s1).toHaveLength(2);
    expect(draftDeadlines(s).map((x) => x.key)).toEqual([`pick:${draftOf(s).queues.s1![0]!}:0`]);
  });

  it('none while the timer is off, outside the draft stage, after the end, or in another format', () => {
    const s = opened(2);
    expect(draftDeadlines({ ...s, draft: { ...draftOf(s), pickTimer: false } })).toEqual([]);
    expect(draftDeadlines({ ...s, stage: 'build' })).toEqual([]);
    expect(draftDeadlines({ ...s, draft: { ...draftOf(s), done: true } })).toEqual([]);
    const sealed = timed(draftTable(2, { format: 'sealed', packs: 6 }));
    expect(draftDeadlines(sealed)).toEqual([]);
    const rochester = timed(draftTable(2, { format: 'rochester', packs: 3, burn: 0 }));
    expect(draftDeadlines(rochester)).toEqual([]);
    expect(draftDeadlines(draftTable(2, { format: 'pass', packs: 3, picks: 1 }))).toEqual([]);
  });

  it('the emitted timeout applies at its deadline and the next pick gets the next key', () => {
    let s = opened(2);
    const first = draftDeadlines(s)[0]!;
    s = ok(s, act('draftTimeout', first.emit[0] as { packId: string; picks: number }, 's0'));
    expect(draftDeadlines(s).map((x) => x.key)).not.toContain(first.key);
  });
});
