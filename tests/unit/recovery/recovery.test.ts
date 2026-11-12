/**
 * Lost-save recovery (PLAN M1-P7 acceptance: "the recovery flow yields a library whose size equals deck size minus
 * public cards minus the agreed hand"; DESIGN "Multiplayer architecture", Resume and failure handling) and the resume
 * choice (highest sequence number wins, the own save wins ties).
 */
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../src/core/invariants';
import { recoveryLibrarySize, recoveryRemainder } from '../../../src/core/recovery';
import { commitDeck } from '../../../src/core/secrets';
import { chooseResume } from '../../../src/net/sync';
import type { CardRef } from '../../../src/core/types';
import { deckRefs, readySecretTable, type SecretTable } from '../secrecy/helpers';

const DECK = 20;

/** Anna puts `n` cards of her library onto the battlefield, revealed, and draws `hand` more. */
function midGame(n: number, hand: number): { t: SecretTable; played: string[] } {
  const t = readySecretTable(['Anna', 'Ben'], DECK);
  const played: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = t.secrets.s0!.libraryOrder[i]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    t.apply('s0', { type: 'reveal', instanceId: id, ref: card, salt });
    t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: i * 70, y: -200, rot: 0 } });
    played.push(id);
  }
  for (let i = 0; i < hand; i++) drawTop(t);
  return { t, played };
}

/** Anna draws a card of her library (the reducer only sees an opaque id). */
function drawTop(t: SecretTable): void {
  const lib = t.state.zones['library:s0']!.ids;
  t.apply('s0', { type: 'draw', instanceId: lib[0]! });
}

/** Run the round to an agreement: Ben passes. */
function agree(t: SecretTable, round: string): void {
  t.apply('s1', { type: 'respond', round, seat: 's1', response: 'ok' });
}

describe('lost-save recovery', () => {
  it('recover discards the hidden zones, keeps the public cards and opens a round on the hand count', () => {
    const { t, played } = midGame(3, 4);
    expect(t.state.zones['hand:s0']!.ids).toHaveLength(4);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    expect(t.state.zones['hand:s0']!.ids).toEqual([]);
    expect(t.state.zones['library:s0']!.ids).toEqual([]);
    for (const id of played) expect(t.state.cards[id]!.zone).toBe('battlefield:s0');
    expect(t.state.seats.s0!.recovering).toMatchObject({ hand: 7, round: 'rec-1', deckSize: DECK });
    expect(t.state.confirm).toMatchObject({ id: 'rec-1', askedBy: 's0' });
    // Ben's cards are untouched.
    expect(t.state.zones['library:s1']!.ids).toHaveLength(DECK);
    expect(recoveryLibrarySize(t.state, 's0')).toBe(DECK - 3);
    expect(recoveryLibrarySize(t.state, 's1')).toBeNull();
    expect(checkInvariants(t.state)).toEqual([]);
  });

  it('library size after the agreed hand = deck size − public cards − agreed hand', () => {
    const { t } = midGame(3, 4);
    t.apply('s0', { type: 'recover', hand: 6, round: 'rec-1' });
    // A second proposal keeps the deck size counted before the first discard.
    t.apply('s0', { type: 'recover', hand: 5, round: 'rec-2' });
    expect(t.state.seats.s0!.recovering).toMatchObject({ hand: 5, round: 'rec-2', deckSize: DECK });
    agree(t, 'rec-2');
    const remainder = recoveryRemainder(deckRefs('s0', DECK), t.state, 's0')!;
    expect(remainder).toHaveLength(DECK - 3);
    // Public identities are subtracted from the re-import.
    const shown = new Set(Object.values(t.state.cards).flatMap((c) => (c.owner === 's0' && c.identity ? [c.identity.sid] : [])));
    expect(remainder.some((r) => shown.has(r.sid))).toBe(false);
    const fresh = commitDeck({ ...t.secrets.s0!, libraryOrder: [], hand: [], identities: {} }, remainder, t.entropy.s0!);
    const ready = fresh.action as { commits: string[]; instanceIds: string[] };
    t.apply('s0', { type: 'recoverCommit', commits: ready.commits, instanceIds: ready.instanceIds, zone: 'library:s0' });
    expect(t.state.seats.s0!.recovering).toBeUndefined();
    expect(t.state.zones['library:s0']!.ids).toHaveLength(DECK - 3);
    // The new ids join the commitment; the old ones stay listed.
    expect(t.state.commitments.s0!.instanceIds).toHaveLength(DECK + DECK - 3);
    for (let i = 0; i < 5; i++) t.apply('s0', { type: 'draw', instanceId: t.state.zones['library:s0']!.ids[0]! });
    expect(t.state.zones['library:s0']!.ids).toHaveLength(DECK - 3 - 5);
    expect(t.state.zones['hand:s0']!.ids).toHaveLength(5);
    expect(checkInvariants(t.state)).toEqual([]);
  });

  it('recoverCommit is refused before the table agreed, with the wrong count, ids used before, or by another seat', () => {
    const { t } = midGame(2, 0);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    const remainder = recoveryRemainder(deckRefs('s0', DECK), t.state, 's0')!;
    const fresh = commitDeck({ ...t.secrets.s0!, libraryOrder: [], hand: [], identities: {} }, remainder, t.entropy.s0!);
    const r = fresh.action as { commits: string[]; instanceIds: string[] };
    const commit = { type: 'recoverCommit' as const, commits: r.commits, instanceIds: r.instanceIds, zone: 'library:s0' };
    t.refuse('s0', commit, /agreed/);
    t.apply('s1', { type: 'respond', round: 'rec-1', seat: 's1', response: 'hold' });
    t.refuse('s0', commit, /agreed/);
    t.apply('s1', { type: 'respond', round: 'rec-1', seat: 's1', response: 'release' });
    t.refuse('s1', { ...commit, zone: 'library:s1' }, /not recovering/);
    t.refuse('s0', { ...commit, commits: commit.commits.slice(1), instanceIds: commit.instanceIds.slice(1) }, /commits 18 cards/);
    const old = t.state.commitments.s0!.instanceIds[0]!;
    t.refuse('s0', { ...commit, instanceIds: [old, ...commit.instanceIds.slice(1)] }, /used before/);
    t.refuse('s0', { ...commit, zone: 'hand:s0' }, /library/);
    t.apply('s0', commit);
    t.refuse('s0', commit, /not recovering/);
  });

  it('recover refuses a hand larger than what the library will hold and an empty chair', () => {
    const { t } = midGame(3, 0);
    t.refuse('s0', { type: 'recover', hand: DECK - 2, round: 'rec-1' }, /hand/);
    t.refuse('s0', { type: 'recover', hand: -1, round: 'rec-1' }, /hand/);
    t.apply('s0', { type: 'recover', hand: DECK - 3, round: 'rec-1' });
  });

  it('recover drops the seat\'s unfinished shuffles of the discarded zones', () => {
    const { t } = midGame(0, 0);
    t.apply('s0', { type: 'shuffleCommit', sid: 'sh-1', zone: 'library:s0', purpose: 'shuffle', h: 'h' });
    expect(t.state.shuffles['sh-1']).toBeDefined();
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    expect(t.state.shuffles['sh-1']).toBeUndefined();
  });

  it('the remainder is null when the re-import cannot cover the public cards; face-down public cards shorten it', () => {
    const { t, played } = midGame(2, 0);
    t.apply('s0', { type: 'recover', hand: 7, round: 'rec-1' });
    const other: CardRef[] = deckRefs('s1', DECK);
    expect(recoveryRemainder(other, t.state, 's0')).toBeNull();
    // A face-down public card (identity unknown) is still counted against the deck size.
    const st = structuredClone(t.state);
    delete st.cards[played[0]!]!.identity;
    st.cards[played[0]!]!.face = 'down';
    const rest = recoveryRemainder(deckRefs('s0', DECK), st, 's0')!;
    expect(rest).toHaveLength(DECK - 2);
    expect(recoveryRemainder(deckRefs('s0', DECK), t.state, 's1')).toBeNull();
  });
});

describe('resume choice', () => {
  it('the highest sequence number wins and the own save wins ties', () => {
    expect(chooseResume(10, [])).toEqual({ from: 'local' });
    expect(chooseResume(10, [{ peerId: 'p', lastSeq: 10 }])).toEqual({ from: 'local' });
    expect(chooseResume(10, [{ peerId: 'p', lastSeq: 9 }])).toEqual({ from: 'local' });
    expect(chooseResume(10, [{ peerId: 'p', lastSeq: 12 }, { peerId: 'q', lastSeq: 15 }, { peerId: 'r', lastSeq: 15 }])).toEqual({ from: 'peer', peerId: 'q', haveSeq: 10 });
  });
});
