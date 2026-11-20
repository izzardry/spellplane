/** M8-P7: Elo per rating key (matchmaking.md 2.7, MM-10, MM-12; contracts.md Part G "Matchmaking" item 4). */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { adjusted, applyRating, expected, freshRating, kFactor, ratingChanges, RATING_FLOOR, tierOf, type RatedPlayer } from '../../../../src/net/lobby/rating';
import type { Band } from '../../../../src/core/types';

const p = (rating: number, games: number, band: Band, side: 0 | 1, extra: Partial<RatedPlayer> = {}): RatedPlayer => ({ rating, games, band, side, ...extra });

describe('rating (matchmaking.md 2.7)', () => {
  it('the worked example: A (1500, band 3) against B (1500, band 5), both past placement', () => {
    const a = p(1500, 30, 3, 0);
    const b = p(1500, 30, 5, 1);
    expect(adjusted(1500, 5)).toBe(1600);
    expect(expected(1500, 1600)).toBeCloseTo(0.36, 2);
    expect(ratingChanges([a, b], 0)!.map((c) => c.delta)).toEqual([15, -15]);
    expect(ratingChanges([a, b], 1)!.map((c) => c.delta)).toEqual([-9, 9]);
    expect(ratingChanges([a, b], 0)!.map((c) => c.after)).toEqual([1515, 1485]);
  });

  it('K is 40 for the first ten games, then 24', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(9)).toBe(40);
    expect(kFactor(10)).toBe(24);
    // Two new players of equal rating and band: ±20.
    expect(ratingChanges([p(1500, 0, 3, 0), p(1500, 0, 3, 1)], 1)!.map((c) => c.delta)).toEqual([-20, 20]);
  });

  it('changes sum to zero when both K are equal (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 3000 }), fc.integer({ min: 400, max: 3000 }), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), fc.boolean(), fc.boolean(), (ra, rb, ba, bb, settled, aWins) => {
        const g = settled ? 20 : 3;
        const ch = ratingChanges([p(ra, g, ba as Band, 0), p(rb, g, bb as Band, 1)], aWins ? 0 : 1)!;
        expect(ch[0]!.delta + ch[1]!.delta).toBe(0);
        expect(Math.sign(ch[0]!.delta)).not.toBe(aWins ? -1 : 1);
      }),
    );
  });

  it('a rating never drops below the floor of 100', () => {
    const ch = ratingChanges([p(110, 3, 3, 0), p(110, 3, 3, 1)], 1)!;
    expect(ch[0]!.after).toBe(RATING_FLOOR);
    expect(ch[0]!.delta).toBe(RATING_FLOOR - 110);
    expect(ratingChanges([p(100, 3, 3, 0), p(900, 3, 3, 1)], 1)![0]!.after).toBe(100);
  });

  it('no change at all with a take-over or a recovery on either seat', () => {
    expect(ratingChanges([p(1500, 3, 3, 0, { takeovers: 1 }), p(1500, 3, 3, 1)], 0)).toBeNull();
    expect(ratingChanges([p(1500, 3, 3, 0), p(1500, 3, 3, 1, { takeovers: 2 })], 0)).toBeNull();
    expect(ratingChanges([p(1500, 3, 3, 0), p(1500, 3, 3, 1, { recovered: true })], 1)).toBeNull();
    expect(ratingChanges([p(1500, 3, 3, 0, { takeovers: 0 }), p(1500, 3, 3, 1)], 0)).not.toBeNull();
  });

  it('2v2 uses team means and each member its own K', () => {
    const ch = ratingChanges([p(1600, 30, 3, 0), p(1400, 3, 3, 0), p(1500, 30, 3, 1), p(1500, 30, 3, 1)], 0)!;
    // Equal team means: E = 0.5; settled +12, new +20, losers −12.
    expect(ch.map((c) => c.delta)).toEqual([12, 20, -12, -12]);
  });

  it('records count games, wins and the peak; tiers', () => {
    const r = applyRating(freshRating('1v1.constructed', 5), { before: 1500, after: 1520, delta: 20 }, true, 9);
    expect(r).toMatchObject({ rating: 1520, games: 1, wins: 1, losses: 0, peak: 1520, updatedAt: 9 });
    expect([1349, 1350, 1549, 1550, 1749, 1750, 1949, 1950].map(tierOf)).toEqual(['Novice', 'Adept', 'Adept', 'Expert', 'Expert', 'Master', 'Master', 'Archmage']);
  });
});
