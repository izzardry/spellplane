/**
 * The history row's one `sm` action (visual.md 2.8 history row, O-5; gate M8 round 3 N14): its label says what opening
 * the row does.
 */
import { describe, expect, it } from 'vitest';
import { rowAction } from '../../../src/ui/history/rows';
import type { GameSummary } from '../../../src/store/types';

function game(over: Partial<GameSummary>): GameSummary {
  return {
    code: 'amber-fox-river-93',
    key: 'k',
    kind: 'private',
    format: '1v1',
    decks: 'constructed',
    seat: 'p1',
    players: [],
    stage: 'match',
    game: 0,
    turn: 3,
    active: null,
    seq: 10,
    hash: 'h',
    knownHead: null,
    handLost: false,
    recoveries: 0,
    takeovers: 0,
    createdAt: 0,
    lastPlayedAt: 0,
    savedAt: 0,
    bytes: 0,
    actions: 4,
    ...over,
  };
}

describe('history row action', () => {
  it('rejoins a table with players, opens one not started, continues a solo game and views an ended one', () => {
    expect(rowAction(game({}))).toBe('Rejoin');
    expect(rowAction(game({ stage: 'lobby' }))).toBe('Open');
    expect(rowAction(game({ kind: 'solo', key: '' }))).toBe('Continue');
    expect(rowAction(game({ endedAt: 5, ended: 'result' }))).toBe('View');
    expect(rowAction(game({ kind: 'solo', ended: 'replaced' }))).toBe('View');
  });
});
