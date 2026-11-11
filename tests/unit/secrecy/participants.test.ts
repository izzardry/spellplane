/**
 * Review round 4 of M1-P2, kept as regression tests. A round's own owner (shuffle) or initiator (rng) cannot reduce
 * the round to its own nonce, so it cannot pick the order or the die result (DESIGN "Multiplayer architecture", Hidden
 * information 3: "The owner cannot choose the order"; "Dice and coin flips use the same commit-then-reveal exchange,
 * so no single browser picks the result"; "Secret shuffle" 3: "the owner could not choose it, having committed
 * first"). In 1v1 the owner is the sequencer, which alone sends `away`; marking the peer away, before or after the
 * commit, therefore must not stop the round waiting for it, and the owner cannot make the peer's chair empty either.
 *
 * Also: an undo cannot carry an inverse in another seat's name (DESIGN "Specification: network protocol and secrecy",
 * Handshake: the sequencer rejects any propose whose `by` is not the sender's seat).
 */
import { describe, expect, it } from 'vitest';
import type { ActionDraft } from '../../../src/core/actions';
import { nonceHash } from '../../../src/core/commit';
import { expectedParticipants, rngOutcome, rngSeed, shuffleOutcome, shuffleSeed } from '../../../src/core/rng';
import { beginShuffle, finishShuffle } from '../../../src/core/secrets';
import type { InstanceId } from '../../../src/core/types';
import { readySecretTable, type SecretTable } from './helpers';

const LIB0 = 'library:s0';

/** s0 commits a shuffle of its library with `ownerNonce` (through the owner's own secret store). */
function begin(t: SecretTable, ownerNonce: string, sid = 'sh1'): void {
  const b = beginShuffle(t.secrets.s0!, LIB0, sid, ownerNonce);
  t.secrets.s0 = b.secrets;
  t.apply('s0', b.action);
}

/** An owner nonce, ground offline, whose shuffle without peer nonces puts `wanted` on top. */
function grindShuffle(ids: readonly InstanceId[], wanted: InstanceId): string {
  for (let i = 0; ; i++) if (shuffleOutcome(shuffleSeed(`g${i}`, []), ids).before[0] === wanted) return `g${i}`;
}

/** A nonce, ground offline, whose die roll alone is a natural 20 (outcome 19 of 20). */
function grindD20(): string {
  for (let i = 0; ; i++) if (rngOutcome(rngSeed({ s0: `d${i}` }, ['s0']), 20) === 19) return `d${i}`;
}

describe('the 1v1 sequencer owner cannot shut the peer out with away', () => {
  it('marking the peer away after seeing its nonce proposal leaves one outcome, the one with the peer nonce', () => {
    const peerNonce = 'peerN';
    const outcomes = new Set<string>();
    for (const path of ['honest', 'away'] as const) {
      const t = readySecretTable(['Anna', 'Ben'], 20);
      begin(t, 'owner-nonce-1');
      const lib = [...t.state.zones[LIB0]!.ids];
      // The two orders s0 could compute once it holds s1's proposal differ, so a choice would matter.
      expect(shuffleOutcome(shuffleSeed('owner-nonce-1', [peerNonce]), lib).before[0]).not.toBe(shuffleOutcome(shuffleSeed('owner-nonce-1', []), lib).before[0]);
      if (path === 'away') {
        t.apply('s0', { type: 'away', seat: 's1', away: true });
        // Still waited for: no seal, no finish, no close by the owner.
        expect(t.state.shuffles.sh1!.closedSeq).toBeUndefined();
        expect(expectedParticipants(t.state, 'sh1', 'shuffle')).toEqual(['s1']);
        t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' }, /waits for peer nonces/);
        expect(() => finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!)).toThrow(/not ready/);
        t.refuse('s0', { type: 'commitClose', kind: 'shuffle', id: 'sh1' }, /cannot close/);
      }
      t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: peerNonce });
      if (path === 'away') t.apply('s0', { type: 'away', seat: 's1', away: false });
      const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
      t.apply('s0', f.action);
      expect(f.secrets.libraryOrder).toEqual(shuffleOutcome(shuffleSeed('owner-nonce-1', [peerNonce]), lib).before);
      outcomes.add(f.secrets.libraryOrder[0]!);
    }
    expect(outcomes.size).toBe(1);
  });

  it('a nonce ground offline does not decide the order: the round still waits for the away peer', () => {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    const ids = [...t.state.zones[LIB0]!.ids];
    const ownerNonce = grindShuffle(ids, [...ids].sort().at(-1)!);
    begin(t, ownerNonce);
    t.apply('s0', { type: 'away', seat: 's1', away: true });
    expect(t.state.shuffles.sh1!.closedSeq).toBeUndefined();
    expect(() => finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!)).toThrow(/not ready/);
    // The peer's nonce is taken (it is connected after all), so the order is the joint one.
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'peer' });
    expect(t.state.shuffles.sh1!.closedSeq).toBe(t.state.seq);
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    expect(f.secrets.libraryOrder).toEqual(shuffleOutcome(shuffleSeed(ownerNonce, ['peer']), ids).before);
  });

  it('marking the peer away before the commit does not help either', () => {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    const ids = [...t.state.zones[LIB0]!.ids];
    const ownerNonce = grindShuffle(ids, [...ids].sort()[0]!);
    t.apply('s0', { type: 'away', seat: 's1', away: true });
    begin(t, ownerNonce);
    expect(expectedParticipants(t.state, 'sh1', 'shuffle')).toEqual(['s1']);
    expect(t.state.shuffles.sh1!.closedSeq).toBeUndefined();
    t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' }, /waits for peer nonces/);
    // The peer returns and contributes; only then can the owner finish.
    t.apply('s0', { type: 'away', seat: 's1', away: false });
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'late' });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    expect(f.secrets.libraryOrder).toEqual(shuffleOutcome(shuffleSeed(ownerNonce, ['late']), ids).before);
  });

  it('dice: a d20 nonce ground offline does not roll a natural 20 alone', () => {
    const t = readySecretTable(['Anna', 'Ben'], 4);
    const n = grindD20();
    t.apply('s0', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 20, h: nonceHash(n) });
    t.apply('s0', { type: 'away', seat: 's1', away: true });
    expect(t.state.rng.r1!.closedSeq).toBeUndefined();
    t.refuse('s0', { type: 'rngReveal', rid: 'r1', nonce: n }, /still waits for commits/);
    t.refuse('s0', { type: 'commitClose', kind: 'rng', id: 'r1' }, /cannot close/);
    t.apply('s1', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 20, h: nonceHash('m') });
    t.apply('s0', { type: 'rngReveal', rid: 'r1', nonce: n });
    expect(t.state.rng.r1!.result).toBeNull();
    t.apply('s1', { type: 'rngReveal', rid: 'r1', nonce: 'm' });
    expect(t.state.rng.r1!.result).toBe(rngOutcome(rngSeed({ s0: n, s1: 'm' }, ['s0', 's1']), 20));
  });

  it('dice: marking the peer away before the opening commit does not help either', () => {
    const t = readySecretTable(['Anna', 'Ben'], 4);
    const n = grindD20();
    t.apply('s0', { type: 'away', seat: 's1', away: true });
    t.apply('s0', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 20, h: nonceHash(n) });
    expect(t.state.rng.r1!.closedSeq).toBeUndefined();
    t.refuse('s0', { type: 'rngReveal', rid: 'r1', nonce: n }, /still waits for commits/);
    expect(t.state.rng.r1!.result).toBeNull();
  });

  it('the owner cannot empty the peer’s chair while its round waits for it; the peer itself can leave', () => {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    begin(t, 'o');
    t.refuse('s0', { type: 'seatLeave', seat: 's1' }, /cannot stop its shuffle sh1 waiting for s1/);
    t.apply('s0', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 20, h: nonceHash('x') });
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'p' });
    t.refuse('s0', { type: 'seatLeave', seat: 's1' }, /cannot stop its round r1 waiting for s1/);
    // An initiator whose round no longer waits for the seat is not stopped by this check.
    t.apply('s1', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 20, h: nonceHash('y') });
    expect(t.why('s0', { type: 'seatLeave', seat: 's1' })).toBeNull();
    // Another seat's round: s1's own shuffle waits for s0, and s1 may leave its own chair.
    const t2 = readySecretTable(['Anna', 'Ben'], 20);
    begin(t2, 'o');
    t2.apply('s1', { type: 'seatLeave', seat: 's1' });
    expect(t2.state.shuffles.sh1!.closedSeq).toBe(t2.state.seq);
  });
});

describe('liveness where the owner does not sequence', () => {
  it('a third seat’s commitClose still excludes an away seat', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo'], 20);
    begin(t, 'o');
    t.apply('s1', { type: 'away', seat: 's2', away: true });
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1' });
    expect(t.state.shuffles.sh1!.closedSeq).toBeUndefined();
    t.apply('s1', { type: 'commitClose', kind: 'shuffle', id: 'sh1' });
    t.refuse('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n2' }, /closed/);
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    expect(t.state.shuffles.sh1!.orderHash).not.toBeNull();
  });
});

describe('an undo carries an inverse in its sender’s name only', () => {
  it('s1 cannot reveal s0’s face-down card through a forged flip inverse in s0’s name', () => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    const inverse = { type: 'flip', by: 's0', cid: 'inv', card: id, face: 'up', ref: { sid: 'black-lotus' }, salt: 'xx' };
    t.refuse('s1', { type: 'undo', of: 'zzz', inverse } as unknown as ActionDraft, /not undoable/);
    t.refuse('s1', { type: 'undo', of: 'zzz', inverse: { ...inverse, ref: undefined, salt: undefined } } as unknown as ActionDraft, /own sender/);
    // Not even the owner reveals through an undo: a flip with an identity is not an inverse.
    t.refuse('s0', { type: 'undo', of: 'zzz', inverse } as unknown as ActionDraft, /not undoable/);
    expect(t.state.cards[id]!.identity).toBeUndefined();
    expect(t.state.cards[id]!.suspect).toBeUndefined();
    expect(JSON.stringify(t.state)).not.toContain('black-lotus');
  });

  it('s1 cannot draw a card of s0’s library in s0’s name', () => {
    const t = readySecretTable();
    const notTop = t.secrets.s0!.libraryOrder[5]!;
    t.refuse('s1', { type: 'undo', of: 'zzz', inverse: { type: 'draw', by: 's0', cid: 'inv', instanceId: notTop } } as unknown as ActionDraft, /own sender/);
    expect(t.state.zones['hand:s0']!.ids).toEqual([]);
  });
});
