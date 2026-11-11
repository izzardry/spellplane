/**
 * Ready with a pasted list (DESIGN "Pre-game: draft, sealed and deck building", Constructed decks; "Input and
 * interaction design": nothing silent): an empty result is refused with a message, unresolved lines need a second
 * press, and a retried Ready saves the list under the same id.
 */
import { describe, expect, it } from 'vitest';
import type { CheckedDeck } from '../../../src/ui/deck';
import { pastedDeckId, readyVerdict } from '../../../src/ui/lobby/ready';

const deck = (main: number, errors: number): CheckedDeck => ({
  resolved: { main: Array.from({ length: main }, (_, i) => ({ sid: `s${i}` })), side: [], cards: {}, errors: [] },
  errors: Array.from({ length: errors }, (_, i) => ({ line: i + 1, text: 'x', kind: 'unresolved' as const, message: 'not found', nearMatches: [] })),
});

describe('readyVerdict', () => {
  it('refuses a list in which no card was found, with a message', () => {
    expect(readyVerdict(deck(0, 3), 'a', null)).toEqual({ kind: 'refuse', message: expect.stringContaining('No cards in this list were found') });
    expect(readyVerdict(null, 'a', null).kind).toBe('refuse');
  });

  it('asks for a second press when lines did not resolve, then goes for the same text only', () => {
    const v = readyVerdict(deck(58, 2), 'list', null);
    expect(v).toEqual({ kind: 'confirm', message: expect.stringContaining('2 lines were not found') });
    expect(readyVerdict(deck(58, 2), 'list', 'list')).toEqual({ kind: 'go' });
    expect(readyVerdict(deck(58, 2), 'list edited', 'list').kind).toBe('confirm');
    expect(readyVerdict(deck(59, 1), 'l', null)).toMatchObject({ message: expect.stringContaining('1 line was not found') });
  });

  it('goes at once for a fully resolved list', () => {
    expect(readyVerdict(deck(60, 0), 'list', null)).toEqual({ kind: 'go' });
  });
});

describe('pastedDeckId', () => {
  it('is stable for one text and differs for another', () => {
    expect(pastedDeckId('4 Llanowar Elves\n20 Forest')).toBe(pastedDeckId('4 Llanowar Elves\n20 Forest'));
    expect(pastedDeckId('4 Llanowar Elves\n20 Forest')).not.toBe(pastedDeckId('4 Llanowar Elves\n21 Forest'));
    expect(pastedDeckId('')).toMatch(/^pasted-[0-9a-f]{16}$/);
  });
});
