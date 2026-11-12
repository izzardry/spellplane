/**
 * The session side of the lost-save recovery (session/resume.ts; DESIGN "Multiplayer architecture", Resume and failure
 * handling): whether this browser lost its hidden cards, where an open recovery stands (what ui/recovery shows), and the
 * check of a re-imported deck before anything is proposed.
 */
import { describe, expect, it } from 'vitest';
import { emptySecretStore } from '../../../src/core/secrets';
import type { CardRef } from '../../../src/core/types';
import type { TableSession } from '../../../src/session/types';
import { canRecover, lostHiddenCards, recoveryProblem, recoveryStatus } from '../../../src/session/resume';
import { deckRefs, readySecretTable, type SecretTable } from '../secrecy/helpers';

const DECK = 20;

/** Anna plays `n` library cards face up onto the battlefield and draws `hand`. */
function midGame(n: number, hand: number): SecretTable {
  const t = readySecretTable(['Anna', 'Ben'], DECK);
  for (let i = 0; i < n; i++) {
    const id = t.secrets.s0!.libraryOrder[i]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    t.apply('s0', { type: 'reveal', instanceId: id, ref: card, salt });
    t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: i * 70, y: -200, rot: 0 } });
  }
  for (let i = 0; i < hand; i++) t.apply('s0', { type: 'draw', instanceId: t.state.zones['library:s0']!.ids[0]! });
  return t;
}

describe('lostHiddenCards', () => {
  it('names the own hand and library cards whose identities this browser does not hold', () => {
    const t = midGame(3, 4);
    expect(lostHiddenCards(t.state, t.secrets.s0!, 's0')).toEqual({ hand: [], library: [] });
    const lost = lostHiddenCards(t.state, emptySecretStore('s0'), 's0');
    expect(lost.hand).toEqual(t.state.zones['hand:s0']!.ids);
    expect(lost.library).toEqual(t.state.zones['library:s0']!.ids);
    // Another seat's hidden cards are never "lost" for this browser.
    expect(lostHiddenCards(t.state, t.secrets.s0!, 's1').hand).toEqual([]);
  });
});

describe('recoveryStatus', () => {
  it('none while the save holds every hidden card; lost with counts, deck size and the largest hand when it does not', () => {
    const t = midGame(3, 4);
    expect(recoveryStatus(t.state, t.secrets.s0!, 's0')).toMatchObject({ phase: 'none', lost: { hand: 0, library: 0 }, deckSize: DECK, publicCards: 3, maxHand: DECK - 3, hand: 4, round: null });
    expect(recoveryStatus(t.state, emptySecretStore('s0'), 's0')).toMatchObject({ phase: 'lost', lost: { hand: 4, library: DECK - 7 }, deckSize: DECK, publicCards: 3, maxHand: DECK - 3, hand: 4, librarySize: null });
  });

  it('tokens are not part of the deck', () => {
    const t = midGame(1, 0);
    t.apply('s0', { type: 'createToken', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: -100, rot: 0 }, label: 'Soldier' });
    expect(recoveryStatus(t.state, emptySecretStore('s0'), 's0')).toMatchObject({ deckSize: DECK, publicCards: 1, maxHand: DECK - 1 });
  });

  it('proposed: the round, who passed, who holds; agreed once every other seat passed', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo'], DECK);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    const lost = emptySecretStore('s0');
    expect(recoveryStatus(t.state, lost, 's0')).toMatchObject({
      phase: 'proposed',
      hand: 7,
      deckSize: DECK,
      publicCards: 0,
      librarySize: DECK,
      lost: { hand: 0, library: 0 },
      round: { id: 'rec-1', current: true, seats: ['s1', 's2'], passed: [], waiting: ['s1', 's2'], holder: null, agreed: false },
    });
    t.apply('s1', { type: 'respond', round: 'rec-1', seat: 's1', response: 'ok' });
    t.apply('s2', { type: 'respond', round: 'rec-1', seat: 's2', response: 'hold' });
    expect(recoveryStatus(t.state, lost, 's0').round).toMatchObject({ passed: ['s1'], holder: 's2', agreed: false });
    t.apply('s2', { type: 'respond', round: 'rec-1', seat: 's2', response: 'release' });
    expect(recoveryStatus(t.state, lost, 's0')).toMatchObject({ phase: 'agreed', round: { passed: ['s1', 's2'], waiting: [], agreed: true } });
  });

  it('a newer round replaces the recovery round: proposed, not current, never agreed', () => {
    const t = midGame(2, 3);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    t.apply('s1', { type: 'ask', round: 'r-2', label: 'attacks?' });
    t.apply('s0', { type: 'respond', round: 'r-2', seat: 's0', response: 'ok' });
    expect(recoveryStatus(t.state, emptySecretStore('s0'), 's0')).toMatchObject({ phase: 'proposed', round: { id: 'rec-1', current: false, agreed: false } });
  });
});

describe('recoveryProblem (checked before anything is proposed)', () => {
  it('accepts the deck that was played, with any hand count up to deck size minus public cards', () => {
    const t = midGame(3, 4);
    const deck = deckRefs('s0', DECK);
    expect(recoveryProblem(t.state, 's0', deck, 7)).toBeNull();
    expect(recoveryProblem(t.state, 's0', deck, 0)).toBeNull();
    expect(recoveryProblem(t.state, 's0', deck, DECK - 3)).toBeNull();
    // A larger re-import is fine: the extra cards are dropped.
    expect(recoveryProblem(t.state, 's0', [...deck, { sid: 'extra' }], 7)).toBeNull();
  });

  it('refuses a hand larger than deck size minus public cards, or not a whole number', () => {
    const t = midGame(3, 4);
    expect(recoveryProblem(t.state, 's0', deckRefs('s0', DECK), DECK - 2)).toMatch(/at most 17 cards/);
    expect(recoveryProblem(t.state, 's0', deckRefs('s0', DECK), 2.5)).toMatch(/whole number/);
    expect(recoveryProblem(t.state, 's0', deckRefs('s0', DECK), -1)).toMatch(/whole number/);
  });

  it('refuses a deck that lacks a card that is public on the table, a foil mismatch included', () => {
    const t = midGame(3, 4);
    expect(recoveryProblem(t.state, 's0', deckRefs('s1', DECK), 7)).toMatch(/not the deck you played/);
    const shown = Object.values(t.state.cards).find((c) => c.owner === 's0' && c.identity)!.identity!.sid;
    const foiled: CardRef[] = deckRefs('s0', DECK).map((r): CardRef => (r.sid === shown ? { sid: r.sid, foil: true } : r));
    expect(recoveryProblem(t.state, 's0', foiled, 7)).toMatch(/not the deck you played/);
  });

  it('refuses a deck too small for the library and an empty or malformed one', () => {
    const t = midGame(3, 4);
    const played = new Set(Object.values(t.state.cards).flatMap((c) => (c.owner === 's0' && c.identity ? [c.identity.sid] : [])));
    const small = deckRefs('s0', DECK).filter((r, i) => played.has(r.sid) || i < 10);
    expect(recoveryProblem(t.state, 's0', small, 7)).toMatch(/needs 17 for your library/);
    expect(recoveryProblem(t.state, 's0', [], 7)).toMatch(/no main-deck cards/);
    expect(recoveryProblem(t.state, 's0', [{ sid: '' }], 7)).toMatch(/Scryfall id/);
  });

  it('a seat that is not taken cannot recover', () => {
    const t = midGame(0, 0);
    t.apply('s1', { type: 'seatLeave', seat: 's1' });
    expect(recoveryProblem(t.state, 's1', deckRefs('s1', DECK), 7)).toMatch(/empty/);
  });
});

describe('canRecover', () => {
  it('only a session with the recovery driver', () => {
    expect(canRecover({} as TableSession)).toBe(false);
    expect(canRecover({ recover: () => Promise.resolve(), recovering: () => false } as unknown as TableSession)).toBe(true);
  });
});
