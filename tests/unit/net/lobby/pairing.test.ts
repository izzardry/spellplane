/** M8-P7: the pairing window, compatibility, groups, teams and the derived room (matchmaking.md 2.5, 2.7). */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bestGroup, compatible, deriveRoom, midOf, nextBoundary, ROOM_WORDS, splitTeams, windowOf, type Candidate } from '../../../../src/net/lobby/pairing';
import { ROOM_ID_RE, ROOM_KEY_RE, ROOM_WORDS as UI_WORDS } from '../../../../src/ui/lobby/room';
import { QUEUES } from '../../../../src/net/lobby/types';
import type { Band, QueueId } from '../../../../src/core/types';

const cand = (tid: string, band: Band, r: number, queues: QueueId[] = ['1v1.constructed.ranked'], open = false): Candidate => ({
  tid,
  band,
  ratings: { '1v1.constructed': { r, g: 12 }, '2hg.constructed': { r, g: 12 } },
  open,
  queues,
  proto: 4,
});

describe('windowOf (matchmaking.md 2.7)', () => {
  it('each row boundary', () => {
    expect(windowOf(0)).toEqual({ rating: 100, band: 0 });
    expect(windowOf(9_999)).toEqual({ rating: 100, band: 0 });
    expect(windowOf(10_000)).toEqual({ rating: 200, band: 1 });
    expect(windowOf(19_999)).toEqual({ rating: 200, band: 1 });
    expect(windowOf(20_000)).toEqual({ rating: 300, band: 1 });
    expect(windowOf(39_999)).toEqual({ rating: 300, band: 1 });
    expect(windowOf(40_000)).toEqual({ rating: 400, band: 2 });
    expect(windowOf(59_999)).toEqual({ rating: 400, band: 2 });
    expect(windowOf(60_000)).toEqual({ rating: 600, band: 2 });
    expect(windowOf(89_999)).toEqual({ rating: 600, band: 2 });
    expect(windowOf(90_000)).toEqual({ rating: null, band: null });
    expect(windowOf(0, true)).toEqual({ rating: null, band: null });
    expect([0, 10_000, 15_000, 89_000, 90_000].map(nextBoundary)).toEqual([10_000, 20_000, 20_000, 90_000, null]);
  });
});

describe('compatible', () => {
  it('needs both windows: deck band first, rating second', () => {
    const a = cand('a', 3, 1500);
    expect(compatible(a, cand('b', 3, 1600), '1v1.constructed.ranked', 0, 0)).toBe(true);
    expect(compatible(a, cand('b', 3, 1601), '1v1.constructed.ranked', 0, 0)).toBe(false);
    expect(compatible(a, cand('b', 4, 1500), '1v1.constructed.ranked', 0, 0)).toBe(false);
    // My wait widens my window, but the other's window must admit me too.
    expect(compatible(a, cand('b', 4, 1500), '1v1.constructed.ranked', 10_000, 0)).toBe(false);
    expect(compatible(a, cand('b', 4, 1500), '1v1.constructed.ranked', 10_000, 10_000)).toBe(true);
    expect(compatible(a, cand('b', 5, 2900), '1v1.constructed.ranked', 90_000, 90_000)).toBe(true);
    expect(compatible(a, cand('b', 5, 2900, undefined, true), '1v1.constructed.ranked', 90_000, 0)).toBe(true);
    // Casual doubles the rating window; different queues or game protocols never meet.
    expect(compatible(cand('a', 3, 1500, ['1v1.constructed.casual']), cand('b', 3, 1700, ['1v1.constructed.casual']), '1v1.constructed.casual', 0, 0)).toBe(true);
    expect(compatible(a, cand('b', 3, 1500, ['1v1.limited.ranked']), '1v1.constructed.ranked', 0, 0)).toBe(false);
    expect(compatible(a, { ...cand('b', 3, 1500), proto: 3 }, '1v1.constructed.ranked', 0, 0)).toBe(false);
  });

  it('is symmetric (property)', () => {
    const arbC = fc.record({ band: fc.integer({ min: 1, max: 5 }), r: fc.integer({ min: 800, max: 2400 }), open: fc.boolean(), q: fc.subarray([...QUEUES], { minLength: 1, maxLength: 4 }) });
    fc.assert(
      fc.property(arbC, arbC, fc.integer({ min: 0, max: 120_000 }), fc.integer({ min: 0, max: 120_000 }), fc.constantFrom(...QUEUES), (x, y, wa, wb, q) => {
        const a = cand('a', x.band as Band, x.r, x.q, x.open);
        const b = cand('b', y.band as Band, y.r, y.q, y.open);
        expect(compatible(a, b, q, wa, wb)).toBe(compatible(b, a, q, wb, wa));
      }),
    );
  });
});

describe('bestGroup', () => {
  it('picks the cheapest partner, ties to the longest waiting', () => {
    const a = { c: cand('a', 3, 1500), waitMs: 0 };
    const others = [
      { c: cand('b', 3, 1590), waitMs: 0 },
      { c: cand('c', 3, 1520), waitMs: 0 },
      { c: cand('d', 3, 1480), waitMs: 5_000 },
    ];
    expect(bestGroup(a, others, '1v1.constructed.ranked', () => true)?.members).toEqual(['a', 'd']);
    expect(bestGroup(a, others, '1v1.constructed.ranked', (x, y) => !(x === 'a' && y === 'd') && !(x === 'd' && y === 'a'))?.members).toEqual(['a', 'c']);
    expect(bestGroup(a, others, '1v1.constructed.ranked', () => true, (m) => m.includes('d'))?.members).toEqual(['a', 'c']);
  });

  it('a four-player group for ffa4', () => {
    const q: QueueId = 'ffa4.constructed.casual';
    const a = { c: cand('a', 3, 1500, [q]), waitMs: 0 };
    const others = ['b', 'c', 'd', 'e'].map((t, i) => ({ c: cand(t, i === 3 ? 5 : 3, 1500, [q]), waitMs: 0 }));
    expect(bestGroup(a, others, q, () => true)?.members).toEqual(['a', 'b', 'c', 'd']);
    expect(bestGroup(a, others.slice(0, 2), q, () => true)).toBeNull();
  });

  it('never returns an unlinked or incompatible pair (property)', () => {
    const queues: QueueId[] = ['1v1.constructed.ranked', 'ffa3.constructed.casual', 'ffa4.constructed.casual', '2hg.constructed.casual'];
    fc.assert(
      fc.property(
        fc.array(fc.record({ band: fc.integer({ min: 1, max: 5 }), r: fc.integer({ min: 1200, max: 1800 }), w: fc.integer({ min: 0, max: 100_000 }), open: fc.boolean() }), { minLength: 2, maxLength: 9 }),
        fc.array(fc.boolean(), { minLength: 45, maxLength: 45 }),
        fc.constantFrom(...queues),
        (people, linkBits, q) => {
          const all = people.map((p, i) => ({ c: cand(`t${i}`, p.band as Band, p.r, [q], p.open), waitMs: p.w }));
          const idx = (t: string): number => Number(t.slice(1));
          const linked = (x: string, y: string): boolean => {
            const [i, j] = [idx(x), idx(y)].sort((m, n) => m - n) as [number, number];
            return linkBits[(i * 9 + j) % 45]!;
          };
          const g = bestGroup(all[0]!, all.slice(1), q, linked);
          if (!g) return;
          const byTid = new Map(all.map((x) => [x.c.tid, x]));
          for (let i = 0; i < g.members.length; i++)
            for (let j = i + 1; j < g.members.length; j++) {
              const x = byTid.get(g.members[i]!)!;
              const y = byTid.get(g.members[j]!)!;
              expect(linked(x.c.tid, y.c.tid)).toBe(true);
              expect(compatible(x.c, y.c, q, x.waitMs, y.waitMs)).toBe(true);
            }
        },
      ),
    );
  });
});

describe('splitTeams, midOf, deriveRoom', () => {
  it('2hg teams: the highest and the lowest rated together', () => {
    expect(splitTeams([{ tid: 'a', rating: 1500 }, { tid: 'b', rating: 1700 }, { tid: 'c', rating: 1300 }, { tid: 'd', rating: 1550 }])).toEqual({ b: 0, c: 0, a: 1, d: 1 });
  });

  it('a match id is 16 hex and does not depend on the member order', () => {
    const m = midOf('1v1.constructed.ranked', ['b', 'a'], 'a', 1);
    expect(m).toMatch(/^[0-9a-f]{16}$/);
    expect(midOf('1v1.constructed.ranked', ['a', 'b'], 'a', 1)).toBe(m);
    expect(midOf('1v1.constructed.ranked', ['a', 'b'], 'a', 2)).not.toBe(m);
  });

  it('the derived room is a valid room id and key, the same for any input order', () => {
    expect(ROOM_WORDS).toEqual(UI_WORDS);
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z0-9]{4,12}$/), { minLength: 2, maxLength: 4 }), fc.array(fc.stringMatching(/^[A-Za-z0-9_-]{22}$/), { minLength: 4, maxLength: 4 }), (tids, nonces) => {
        const pairs = tids.map((t, i) => [t, nonces[i]!] as const);
        const r1 = deriveRoom('0123456789abcdef', Object.fromEntries(pairs));
        const r2 = deriveRoom('0123456789abcdef', Object.fromEntries([...pairs].reverse()));
        expect(r2).toEqual(r1);
        expect(r1.roomId).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[1-9][0-9]$/);
        expect(ROOM_ID_RE.test(r1.roomId)).toBe(true);
        expect(ROOM_KEY_RE.test(r1.roomKey)).toBe(true);
        expect([...r1.order].sort()).toEqual([...tids].sort());
      }),
    );
    const a = deriveRoom('0123456789abcdef', { x: 'A'.repeat(22), y: 'B'.repeat(22) });
    const b = deriveRoom('0123456789abcdef', { x: 'A'.repeat(22), y: 'C'.repeat(22) });
    expect(b.roomKey).not.toBe(a.roomKey);
  });
});
