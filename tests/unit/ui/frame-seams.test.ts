/**
 * M8-P8 seam fixes of the table frame: the game-over overlay's primary at the frame (journey.md 4.13: FIND ANOTHER
 * MATCH searches again with the same setup; a solo table's REMATCH / AGAIN opens a new game of its kind with the same
 * deck), and the ended copy of the leave toast (an ended game cannot be continued).
 */
import { describe, expect, it, vi } from 'vitest';
import type { TableState } from '../../../src/core/types';
import type { TableSession } from '../../../src/session/types';
import { blankSummary } from '../../../src/store/games';
import { DEFAULT_HOME_PREFS, type DeckRecord, type GameStore, type GameSummary } from '../../../src/store/types';
import { LEFT_ENDED, LEFT_NETWORKED, LEFT_SOLO, leaveTable } from '../../../src/ui/play/leave';
import type { LaunchDeps } from '../../../src/ui/play/launch';
import { findAgain, soloAgain, soloAgainLabel } from '../../../src/ui/table/again';
import { sampleState } from '../store/helpers';

function session(result: boolean): TableSession {
  const base = sampleState();
  const state: TableState = result ? { ...base, result: { winners: ['s0'], atSeq: base.seq, by: 'concede' } as unknown as TableState['result'] } : base;
  return {
    seat: 's0',
    roomId: 'x',
    getState: () => state,
    log: () => [],
    leave: () => Promise.resolve(),
    whenSaved: () => Promise.resolve(),
    dispose: () => undefined,
  } as unknown as TableSession;
}

function games(rows: GameSummary[] = []): GameStore {
  const map = new Map(rows.map((r) => [r.code, r]));
  return {
    get: (code: string) => Promise.resolve(map.get(code) ?? null),
    create: (m: Parameters<GameStore['create']>[0]) => {
      map.set(m.code, blankSummary(m, 0));
      return Promise.resolve();
    },
    endOlderSolo: () => Promise.resolve(),
    purge: () => Promise.resolve(),
  } as unknown as GameStore;
}

describe('FIND ANOTHER MATCH (journey.md 4.13)', () => {
  it('searches again with the finished match queue and deck', () => {
    const seek = vi.fn();
    expect(findAgain({ seek }, { queue: 'c.1v1.ranked' as never, deckId: 'deck-1' })).toBe(true);
    expect(seek).toHaveBeenCalledWith({ queues: ['c.1v1.ranked'], deckId: 'deck-1' });
  });
  it('does nothing without a record or a matchmaker', () => {
    const seek = vi.fn();
    expect(findAgain({ seek }, null)).toBe(false);
    expect(findAgain(null, { queue: 'q' as never, deckId: 'd' })).toBe(false);
    expect(seek).not.toHaveBeenCalled();
  });
});

describe('a solo table again (journey.md 4.13)', () => {
  it('REMATCH against Sparring, AGAIN alone', () => {
    expect(soloAgainLabel('computer')).toBe('REMATCH');
    expect(soloAgainLabel('practice')).toBe('AGAIN');
  });

  const deck: DeckRecord = { id: 'deck-7', name: 'Green', cards: [] } as unknown as DeckRecord;
  function deps(go: (h: string) => void, extra: Partial<LaunchDeps> = {}): LaunchDeps {
    return {
      games: games([{ ...blankSummary({ code: 'c-old', key: '', kind: 'solo', format: '1v1', decks: 'constructed', opponent: 'sparring', deck: { id: 'deck-7', name: 'Green' } }, 0) }]),
      decks: { get: (id: string) => Promise.resolve(id === 'deck-7' ? deck : null), put: () => Promise.resolve(), list: () => Promise.resolve([deck]), delete: () => Promise.resolve() },
      settings: { get: () => Promise.resolve({ ...DEFAULT_HOME_PREFS, deckId: null }), set: () => Promise.resolve() } as unknown as LaunchDeps['settings'],
      go,
      toast: () => undefined,
      now: () => 1,
      newRoom: () => ({ roomId: 'r', roomKey: 'k' }),
      openComputer: () => Promise.resolve('c-new'),
      ...extra,
    };
  }

  it('a computer game opens a new computer game with the same deck', async () => {
    const go = vi.fn();
    const openComputer = vi.fn(() => Promise.resolve('c-new'));
    expect(await soloAgain(deps(go, { openComputer }), 'computer', 'c-old')).toBe('#/c/c-new');
    expect(openComputer).toHaveBeenCalledWith({ deckId: 'deck-7' });
    expect(go).toHaveBeenLastCalledWith('#/c/c-new');
  });

  it('a practice table opens a new practice table', async () => {
    const go = vi.fn();
    const hash = await soloAgain(deps(go, { newPracticeId: () => 'p-again' }), 'practice', 'c-old');
    expect(hash).toBe('#/p/p-again');
    expect(go).toHaveBeenLastCalledWith('#/p/p-again');
  });
});

describe('leaving an ended game (journey.md 4.13)', () => {
  it('a finished networked game: the ended copy, no REJOIN', async () => {
    const toast = vi.fn();
    await leaveTable({ session: session(true), kind: 'room', code: 'amber-fox-1', key: 'K', games: games(), go: () => undefined, toast });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]).toEqual([LEFT_ENDED]);
  });
  it('a finished solo game: the ended copy, no Continue', async () => {
    const toast = vi.fn();
    const g = games([blankSummary({ code: 'p-1', key: '', kind: 'solo', format: '1v1', decks: 'constructed' }, 0)]);
    // An unknown count keeps the game (leave.ts): a stored summary without an exact count.
    await leaveTable({ session: session(true), kind: 'practice', code: 'p-1', games: g, go: () => undefined, toast });
    const texts = toast.mock.calls.map((c) => c[0]);
    expect(texts.includes(LEFT_SOLO)).toBe(false);
  });
  it('a game still going: the usual copy', async () => {
    const toast = vi.fn();
    await leaveTable({ session: session(false), kind: 'room', code: 'amber-fox-1', key: 'K', games: games(), go: () => undefined, toast });
    expect(toast.mock.calls[0]![0]).toBe(LEFT_NETWORKED);
  });
});
