/** What the recovery panel (ui/recovery) says for each stage of the lost-save recovery (PLAN M1-P7). */
import { describe, expect, it } from 'vitest';
import { emptySecretStore } from '../../../src/core/secrets';
import { recoveryStatus } from '../../../src/session/resume';
import { committedText, headline, libraryAfter, lostText, seatAnswers } from '../../../src/ui/recovery/model';
import { readySecretTable } from '../secrecy/helpers';

describe('recovery panel text', () => {
  it('lost: the counts, the cards kept on the table, and the sizes it will end with', () => {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    for (let i = 0; i < 3; i++) t.apply('s0', { type: 'draw', instanceId: t.state.zones['library:s0']!.ids[0]! });
    const s = recoveryStatus(t.state, emptySecretStore('s0'), 's0');
    expect(headline(s, false)).toMatch(/lost your hidden cards/);
    expect(lostText(s)).toContain('hand (3 cards) and library (17 cards)');
    expect(lostText(s)).toContain('your 0 cards in play');
    expect(libraryAfter(s, 7)).toBe(13);
    expect(headline(recoveryStatus(t.state, t.secrets.s0!, 's0'), false)).toBeNull();
  });

  it('proposed, held and agreed: who answered what, by name', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo'], 20);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    const lost = emptySecretStore('s0');
    let s = recoveryStatus(t.state, lost, 's0');
    expect(headline(s, true)).toBe('Recovery: waiting for the table to agree to a new hand of 7');
    expect(seatAnswers(s, t.state.seats)).toEqual([
      { seat: 's1', name: 'Ben', state: 'waiting' },
      { seat: 's2', name: 'Cleo', state: 'waiting' },
    ]);
    t.apply('s1', { type: 'respond', round: 'rec-1', seat: 's1', response: 'ok' });
    t.apply('s2', { type: 'respond', round: 'rec-1', seat: 's2', response: 'hold' });
    s = recoveryStatus(t.state, lost, 's0');
    expect(headline(s, true)).toBe('The table holds your recovery');
    expect(seatAnswers(s, t.state.seats).map((a) => a.state)).toEqual(['ok', 'holding']);
    t.apply('s2', { type: 'respond', round: 'rec-1', seat: 's2', response: 'release' });
    s = recoveryStatus(t.state, lost, 's0');
    expect(headline(s, true)).toBe('The table agreed: committing your new library');
    expect(headline(s, false)).toBe('The table agreed to a new hand of 7: re-import your deck to finish');
    t.apply('s1', { type: 'ask', round: 'r-2' });
    s = recoveryStatus(t.state, lost, 's0');
    expect(headline(s, false)).toMatch(/interrupted by another confirmation round/);
    expect(seatAnswers(s, t.state.seats)).toEqual([]);
  });

  it('committed: the recovery owes its shuffle or draws and says how to finish', () => {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    const s = { ...recoveryStatus(t.state, t.secrets.s0!, 's0'), phase: 'committed' as const, hand: 7 };
    expect(headline(s, false)).toBe('Your recovery is not finished');
    expect(headline(s, true)).toBe('Shuffling your new library and drawing your hand');
    expect(committedText(s)).toContain('hand of 7 cards');
  });
});
