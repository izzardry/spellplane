/**
 * Elo per rating key (matchmaking.md MM-10, MM-12, 2.7; contracts.md Part G "Matchmaking" item 4). Pure: every browser
 * computes every player's change from the same frozen inputs (the MatchRecord) and the same sequenced result.
 *
 * - start 1500, K = 40 for the first ten games of a key and 24 after, a floor of 100;
 * - each deck band step counts as 50 rating points in the expected score (R' = R + 50 × (band − 3));
 * - no change at all when either side had a seat take-over (`Seat.takeovers > 0`) or a lost-save recovery.
 */
import type { Band, RatingKey, RatingRecord } from '../../core/types';

export const START_RATING = 1500;
export const RATING_FLOOR = 100;
export const PLACEMENT_GAMES = 10;
export const BAND_POINTS = 50;
export const K_PLACEMENT = 40;
export const K_SETTLED = 24;

/** K for a player with `games` rated games of this key behind them. */
export function kFactor(games: number): number {
  return games < PLACEMENT_GAMES ? K_PLACEMENT : K_SETTLED;
}

/** The band-adjusted rating R' (MM-12). */
export function adjusted(rating: number, band: Band): number {
  return rating + BAND_POINTS * (band - 3);
}

/** Expected score of a side with adjusted rating `a` against one with `b`. */
export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Round half away from zero, so a change and its mirror are exact opposites. */
function roundSym(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** One player of a rated game, as frozen in the MatchRecord, plus what the table says about the seat. */
export interface RatedPlayer {
  rating: number;
  games: number;
  band: Band;
  /** 0 or 1 for the two sides of a 1v1 (2v2: the team). */
  side: 0 | 1;
  /** Seat take-overs (`Seat.takeovers`). */
  takeovers?: number;
  /** A lost-save recovery happened on this seat during the game. */
  recovered?: boolean;
}

/** What one player's rating does. */
export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

/**
 * Every player's change for a result in which side `winner` won (S = 1 for it, 0 for the other). Null when the game
 * may not count: a seat with a take-over or a recovery, fewer than two sides. A team's R' is the mean of its members'
 * R'; each member is updated with their own K against the other side's mean.
 */
export function ratingChanges(players: readonly RatedPlayer[], winner: 0 | 1): RatingChange[] | null {
  if (players.some((p) => (p.takeovers ?? 0) > 0 || p.recovered === true)) return null;
  const sideMean = (side: 0 | 1): number | null => {
    const members = players.filter((p) => p.side === side);
    if (members.length === 0) return null;
    return members.reduce((s, p) => s + adjusted(p.rating, p.band), 0) / members.length;
  };
  const m0 = sideMean(0);
  const m1 = sideMean(1);
  if (m0 === null || m1 === null) return null;
  return players.map((p) => {
    const own = p.side === 0 ? m0 : m1;
    const other = p.side === 0 ? m1 : m0;
    const s = p.side === winner ? 1 : 0;
    const delta = roundSym(kFactor(p.games) * (s - expected(own, other)));
    const after = Math.max(RATING_FLOOR, p.rating + delta);
    return { before: p.rating, after, delta: after - p.rating };
  });
}

/** A fresh record for a key (1500, nothing played). */
export function freshRating(key: RatingKey, now: number): RatingRecord {
  return { key, rating: START_RATING, games: 0, wins: 0, losses: 0, draws: 0, peak: START_RATING, updatedAt: now };
}

/** The record after one rated game. */
export function applyRating(record: RatingRecord, change: RatingChange, won: boolean, now: number): RatingRecord {
  return {
    ...record,
    rating: change.after,
    games: record.games + 1,
    wins: record.wins + (won ? 1 : 0),
    losses: record.losses + (won ? 0 : 1),
    peak: Math.max(record.peak, change.after),
    updatedAt: now,
  };
}

/** The tier word shown after placement (matchmaking.md 2.7, Display). */
export function tierOf(rating: number): 'Novice' | 'Adept' | 'Expert' | 'Master' | 'Archmage' {
  if (rating < 1350) return 'Novice';
  if (rating < 1550) return 'Adept';
  if (rating < 1750) return 'Expert';
  if (rating < 1950) return 'Master';
  return 'Archmage';
}
