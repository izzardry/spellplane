/** PLAN Milestone 8, M7-P2: when KEEP and MULLIGAN show (ui/hud/opening.ts). */
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { openingHandShown, ownTurnEnded, turnTakers } from '../../../src/ui/hud/opening';

function table(cards: Record<string, string>, over: Partial<TableState> = {}): TableState {
  return {
    stage: 'match',
    seats: { s0: { id: 's0', index: 0 } },
    turn: { number: 1, active: 's0', phase: 'main1' },
    cards: Object.fromEntries(Object.entries(cards).map(([id, zone]) => [id, { id, owner: 's0', zone }])),
    ...over,
  } as unknown as TableState;
}

describe('opening hand chips', () => {
  it('show with a fresh hand in the first turn', () => {
    expect(openingHandShown(table({ a: 'hand:s0', b: 'library:s0' }), 's0', 1, null)).toBe(true);
  });
  it('not without a hand, after turn one, after KEEP, or once a card left the hand', () => {
    expect(openingHandShown(table({ b: 'library:s0' }), 's0', 0, null)).toBe(false);
    expect(openingHandShown(table({ a: 'hand:s0' }, { turn: { number: 2, active: 's0', phase: 'main1' } } as Partial<TableState>), 's0', 1, null)).toBe(false);
    expect(openingHandShown(table({ a: 'hand:s0' }), 's0', 1, 0)).toBe(false);
    for (const z of ['battlefield:s0', 'graveyard:s0', 'exile:s0', 'stack']) expect(openingHandShown(table({ a: 'hand:s0', b: z }), 's0', 1, null)).toBe(false);
  });
  it('another seat playing a card does not remove mine', () => {
    const st = table({ a: 'hand:s0' });
    (st.cards as Record<string, unknown>)['o'] = { id: 'o', owner: 's1', zone: 'battlefield:s1' };
    expect(openingHandShown(st, 's0', 1, null)).toBe(true);
  });
  it('not outside a match', () => {
    expect(openingHandShown(table({ a: 'hand:s0' }, { stage: 'draft' } as Partial<TableState>), 's0', 1, null)).toBe(false);
  });
  it('a player on the draw keeps them through the opponent\'s first turn, until every seat had a turn', () => {
    const two = { seats: { s0: { id: 's0', index: 0 }, s1: { id: 's1', index: 1 } } } as unknown as Partial<TableState>;
    expect(openingHandShown(table({ a: 'hand:s0' }, { ...two, turn: { number: 2, active: 's0', phase: 'untap' } } as Partial<TableState>), 's0', 1, null)).toBe(true);
    expect(openingHandShown(table({ a: 'hand:s0' }, { ...two, turn: { number: 3, active: 's1', phase: 'untap' } } as Partial<TableState>), 's0', 1, null)).toBe(false);
  });
  it('teams take turns as one', () => {
    const st = table({}, { seats: { a: { id: 'a', team: 't1' }, b: { id: 'b', team: 't1' }, c: { id: 'c', team: 't2' }, d: { id: 'd', team: 't2' } } } as unknown as Partial<TableState>);
    expect(turnTakers(st)).toBe(2);
  });
  it('a turn ends for the seat only when it was the seat\'s own', () => {
    expect(ownTurnEnded({ number: 1, mine: true }, { number: 2 })).toBe(true);
    expect(ownTurnEnded({ number: 1, mine: false }, { number: 2 })).toBe(false);
    expect(ownTurnEnded({ number: 2, mine: true }, { number: 2 })).toBe(false);
    // A new game starts again at turn 1.
    expect(ownTurnEnded({ number: 4, mine: true }, { number: 1 })).toBe(false);
  });
});
