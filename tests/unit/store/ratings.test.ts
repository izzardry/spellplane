/**
 * M8-P7: the `ratings` and `matches` stores (matchmaking.md 2.10) and the once-only rating application of a ranked 1v1
 * matched game from its sequenced result (matchmaking.md 2.7, 2.9; contracts.md Part E, Part G "Matchmaking" item 4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchRecord, TableState } from '../../../src/core/types';
import { ratingChanges } from '../../../src/net/lobby/rating';
import { applyRatedResult } from '../../../src/session/match-room';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { uniqueDbName } from './helpers';

const open: LocalStores[] = [];
async function stores(name = uniqueDbName('ratings')): Promise<LocalStores> {
  const s = await openStores(name);
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

function record(queue: MatchRecord['queue'], o: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: '0123456789abcdef',
    roomId: 'amber-fox-93',
    roomKey: 'AAAAAAAAAAAAAAAAAAAAAA',
    queue,
    players: [
      { peerId: 'peer-a', pubKey: 'pk-a', name: 'Ann', rating: 1500, games: 12, band: 3, score: 50 },
      { peerId: 'peer-b', pubKey: 'pk-b', name: 'Ben', rating: 1500, games: 12, band: 5, score: 90 },
    ],
    formedAt: 1,
    state: 'playing',
    deckId: 'deck-a',
    ...o,
  };
}

function ended(winner: 's0' | 's1', seats: { takeovers?: [number, number] } = {}): TableState {
  const t = seats.takeovers ?? [0, 0];
  return {
    seats: {
      s0: { id: 's0', index: 0, peer: 'peer-a', takeovers: t[0] },
      s1: { id: 's1', index: 1, peer: 'peer-b', takeovers: t[1] },
    },
    result: { winners: [winner], reason: 'concede', atSeq: 40 },
  } as unknown as TableState;
}

describe('ratings and matches stores', () => {
  it('a rating key has no record before its first ranked game; records and matches survive a reload', async () => {
    const s = await stores();
    expect(await s.ratings.get('1v1.constructed')).toBeNull();
    await s.ratings.put({ key: '1v1.constructed', rating: 1527, games: 11, wins: 6, losses: 5, draws: 0, peak: 1540, updatedAt: 9 });
    await s.matches.put(record('1v1.constructed.ranked'));
    s.close();
    const again = await stores(s.db.name);
    expect(await again.ratings.get('1v1.constructed')).toMatchObject({ rating: 1527, games: 11 });
    expect(await again.ratings.get('1v1.limited')).toBeNull();
    expect(await again.matches.get('amber-fox-93')).toMatchObject({ deckId: 'deck-a', queue: '1v1.constructed.ranked' });
    expect((await again.matches.list()).map((m) => m.roomId)).toEqual(['amber-fox-93']);
    await again.matches.delete('amber-fox-93');
    expect(await again.matches.get('amber-fox-93')).toBeNull();
  });
});

describe('applyRatedResult', () => {
  it('the worked example from the winner and the loser: opposite amounts equal to ratingChanges, once', async () => {
    const a = await stores();
    const b = await stores();
    await a.matches.put(record('1v1.constructed.ranked'));
    await b.matches.put(record('1v1.constructed.ranked'));
    const st = ended('s0');
    const expected = ratingChanges(record('1v1.constructed.ranked').players.map((p, i) => ({ rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1 })), 0)!;
    const ra = await applyRatedResult({ state: st, roomId: 'amber-fox-93', me: 'peer-a', ratings: a.ratings, matches: a.matches, now: 5 });
    const rb = await applyRatedResult({ state: st, roomId: 'amber-fox-93', me: 'peer-b', ratings: b.ratings, matches: b.matches, now: 5 });
    // matchmaking.md 2.7: A (1500, band 3) beats B (1500, band 5): A +15, B −15.
    expect(ra?.rated).toEqual({ key: '1v1.constructed', before: 1500, after: 1515 });
    expect(rb?.rated).toEqual({ key: '1v1.constructed', before: 1500, after: 1485 });
    expect(expected.map((c) => c.after)).toEqual([1515, 1485]);
    expect(await a.ratings.get('1v1.constructed')).toMatchObject({ rating: 1515, games: 1, wins: 1, losses: 0 });
    expect(await b.ratings.get('1v1.constructed')).toMatchObject({ rating: 1485, games: 1, wins: 0, losses: 1 });
    // Once: a second application (a reload, a second subscriber) changes nothing.
    expect(await applyRatedResult({ state: st, roomId: 'amber-fox-93', me: 'peer-a', ratings: a.ratings, matches: a.matches })).toBeNull();
    expect(await a.ratings.get('1v1.constructed')).toMatchObject({ rating: 1515, games: 1 });
  });

  it('no change for a casual game, a take-over on either seat or a recovery; the match is still marked finished', async () => {
    const s = await stores();
    await s.matches.put(record('1v1.constructed.casual'));
    expect(await applyRatedResult({ state: ended('s0'), roomId: 'amber-fox-93', me: 'peer-a', ratings: s.ratings, matches: s.matches })).toBeNull();
    expect((await s.matches.get('amber-fox-93'))?.state).toBe('finished');

    for (const [label, state, recovered] of [
      ['take-over', ended('s1', { takeovers: [0, 1] }), []],
      ['recovery', ended('s1'), ['s0']],
    ] as const) {
      const t = await stores();
      await t.matches.put(record('1v1.constructed.ranked'));
      expect(await applyRatedResult({ state, roomId: 'amber-fox-93', me: 'peer-a', ratings: t.ratings, matches: t.matches, recovered: [...recovered] }), label).toBeNull();
      expect(await t.ratings.get('1v1.constructed'), label).toBeNull();
      expect((await t.matches.get('amber-fox-93'))?.rated, label).toBeUndefined();
    }
  });

  it('a record player whose peer holds no seat any more is not counted (never read as no take-over)', async () => {
    const s = await stores();
    await s.matches.put(record('1v1.constructed.ranked'));
    const st = ended('s0');
    const gone = { ...st, seats: { ...st.seats, s1: { ...st.seats.s1!, peer: 'peer-invitee' } } } as TableState;
    expect(await applyRatedResult({ state: gone, roomId: 'amber-fox-93', me: 'peer-a', ratings: s.ratings, matches: s.matches })).toBeNull();
    expect(await s.ratings.get('1v1.constructed')).toBeNull();
    expect((await s.matches.get('amber-fox-93'))?.state).toBe('finished');
  });

  it('the match record is marked rated before the rating is stored: a failed rating write never applies twice', async () => {
    const s = await stores();
    await s.matches.put(record('1v1.constructed.ranked'));
    const failing = { ...s.ratings, get: s.ratings.get.bind(s.ratings), put: () => Promise.reject(new Error('quota')) };
    await expect(applyRatedResult({ state: ended('s0'), roomId: 'amber-fox-93', me: 'peer-a', ratings: failing, matches: s.matches })).rejects.toThrow('quota');
    expect((await s.matches.get('amber-fox-93'))?.rated).toBeDefined();
    // The retry finds the record rated and changes nothing.
    expect(await applyRatedResult({ state: ended('s0'), roomId: 'amber-fox-93', me: 'peer-a', ratings: s.ratings, matches: s.matches })).toBeNull();
    expect(await s.ratings.get('1v1.constructed')).toBeNull();
  });

  it('a game without a result or without a MatchRecord is left alone', async () => {
    const s = await stores();
    expect(await applyRatedResult({ state: { ...ended('s0'), result: undefined } as TableState, roomId: 'amber-fox-93', me: 'peer-a', ratings: s.ratings, matches: s.matches })).toBeNull();
    expect(await applyRatedResult({ state: ended('s0'), roomId: 'amber-fox-93', me: 'peer-a', ratings: s.ratings, matches: s.matches })).toBeNull();
    expect(await s.ratings.get('1v1.constructed')).toBeNull();
  });
});
