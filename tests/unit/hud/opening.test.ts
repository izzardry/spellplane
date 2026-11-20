/** PLAN Milestone 8, M7-P2: when KEEP and MULLIGAN show (ui/hud/opening.ts). */
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { openingHandShown } from '../../../src/ui/hud/opening';

function table(cards: Record<string, string>, over: Partial<TableState> = {}): TableState {
  return {
    stage: 'match',
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
});
