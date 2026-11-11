/** M1-C: commitment checks and joint-randomness derivation (DESIGN "Specification: network protocol and secrecy": Commitments, Public randomness). */
import { describe, expect, it } from 'vitest';
import { commitFor, makeCommitments, nonceHash, verifyNonce, verifyReveal } from '../../../src/core/commit';
import { deadlines } from '../../../src/core/deadlines';
import { rngOutcome, rngSeed } from '../../../src/core/rng';
import { sha256Sync } from '../../../src/core/sha256';
import type { Commitment } from '../../../src/core/types';

describe('commitments', () => {
  const card = { instanceId: 'c1', ref: { sid: 'aaa' }, salt: 'salt1' };
  const other = { instanceId: 'c2', ref: { sid: 'bbb', foil: true as const }, salt: 'salt2' };
  const commitment: Commitment = { seat: 's0', commits: makeCommitments([card, other]), instanceIds: ['c1', 'c2'], atSeq: 1 };

  it('publishes the salted hashes sorted', () => {
    expect(commitment.commits).toEqual([commitFor('c1', { sid: 'aaa' }, 'salt1'), commitFor('c2', { sid: 'bbb', foil: true }, 'salt2')].sort());
  });

  it('verifies a matching reveal and flags any change of id, card, foil or salt', () => {
    expect(verifyReveal(commitment, card)).toBe(true);
    expect(verifyReveal(commitment, other)).toBe(true);
    expect(verifyReveal(commitment, { ...card, ref: { sid: 'bbb' } })).toBe(false);
    expect(verifyReveal(commitment, { ...other, ref: { sid: 'bbb' } })).toBe(false);
    expect(verifyReveal(commitment, { ...card, salt: 'salt2' })).toBe(false);
    expect(verifyReveal(commitment, { ...card, instanceId: 'c3' })).toBe(false);
  });

  it('opens a nonce commit only with the committed nonce', () => {
    expect(verifyNonce(nonceHash('n1'), 'n1')).toBe(true);
    expect(verifyNonce(nonceHash('n1'), 'n2')).toBe(false);
  });
});

describe('public randomness', () => {
  it('seeds from the nonces in seat order and skips seats without a reveal', () => {
    expect(rngSeed({ s1: 'B', s0: 'A' }, ['s0', 's1', 's2'])).toBe(sha256Sync('AB'));
  });

  it('draws outcomes in range, deterministically', () => {
    const seed = rngSeed({ s0: 'x' }, ['s0']);
    const r = rngOutcome(seed, 6);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(6);
    expect(rngOutcome(seed, 6)).toBe(r);
  });
});

describe('deadlines', () => {
  it('is a list the sequencer arms (stubs return none until M1-P2 and M1-P3)', async () => {
    const { createTable } = await import('../../../src/core/reducer/index');
    const { mtg } = await import('../../../src/games/index');
    expect(deadlines(createTable({ game: mtg, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] }))).toEqual([]);
  });
});
