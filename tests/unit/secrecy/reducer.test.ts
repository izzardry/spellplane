/**
 * Secrecy in the reducer (PLAN M1-P2; DESIGN "Specification: network protocol and secrecy": Commitments, Public
 * randomness, Secret shuffle; "Table model", Hidden cards). Every rule is asserted on shared state, which all peers
 * compute alike.
 */
import { describe, expect, it } from 'vitest';
import type { ActionDraft } from '../../../src/core/actions';
import { commitFor, nonceHash } from '../../../src/core/commit';
import { deadlines } from '../../../src/core/deadlines';
import { checkInvariants } from '../../../src/core/invariants';
import { COMMIT_WINDOW_MS, commitWindowDeadlines, expectedParticipants, rngOutcome, rngSeed } from '../../../src/core/rng';
import { beginShuffle, finishShuffle, reissueZone } from '../../../src/core/secrets';
import type { TableState } from '../../../src/core/types';
import { SecretTable, deckRefs, readySecretTable } from './helpers';

const LIB0 = 'library:s0';

/** A copy of the table's state with `seat` away (the `away` action belongs to M1-P7). */
function withAway(state: TableState, seat: string): TableState {
  return { ...state, seats: { ...state.seats, [seat]: { ...state.seats[seat]!, away: true } } };
}

describe('reveal against the deck commitment', () => {
  it('a genuine reveal makes the identity public and leaves the card unflagged', () => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    t.apply('s0', { type: 'reveal', instanceId: id, ref: card, salt });
    expect(t.state.cards[id]!.identity).toEqual(card);
    expect(t.state.cards[id]!.suspect).toBeUndefined();
  });

  it.each([
    ['another card', (c: { sid: string }, s: string) => ({ ref: { sid: `${c.sid}-forged` }, salt: s })],
    ['another salt', (c: { sid: string }, s: string) => ({ ref: c, salt: `${s}x` })],
    ['a foil flag it was not committed with', (c: { sid: string }, s: string) => ({ ref: { ...c, foil: true as const }, salt: s })],
  ])('a reveal naming %s is applied but flagged suspect in shared state, not refused', (_what, forge) => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    const forged = forge(card, salt);
    t.apply('s0', { type: 'reveal', instanceId: id, ...forged });
    expect(t.state.cards[id]).toMatchObject({ identity: forged.ref, suspect: true });
  });

  it('a commit made for another instance id does not vouch for this one', () => {
    const t = readySecretTable();
    const [a, b] = t.secrets.s0!.libraryOrder;
    const other = t.secrets.s0!.identities[b!]!;
    t.apply('s0', { type: 'reveal', instanceId: a!, ref: other.card, salt: other.salt });
    expect(t.state.cards[a!]!.suspect).toBe(true);
  });

  it('a seat without a commitment cannot reveal a verified card', () => {
    const t = new SecretTable(['Anna', 'Ben']);
    t.apply('s0', { type: 'createToken', card: 'tok', zone: 'battlefield:s0', pose: { x: 0, y: 0, rot: 0 }, ref: { sid: 'cat' } });
    t.refuse('s0', { type: 'reveal', instanceId: 'tok', ref: { sid: 'cat' }, salt: 'x' }, /token/);
  });

  it('only the owner reveals its card', () => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    t.refuse('s1', { type: 'reveal', instanceId: id, ref: card, salt }, /only s0/);
  });

  it('a suspect card stays suspect after a later genuine reveal and when it goes back into a hidden zone', () => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    const { card, salt } = t.secrets.s0!.identities[id]!;
    t.apply('s0', { type: 'reveal', instanceId: id, ref: { sid: 'forged' }, salt });
    t.apply('s0', { type: 'reveal', instanceId: id, ref: card, salt });
    expect(t.state.cards[id]).toMatchObject({ identity: card, suspect: true });
    t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    t.apply('s0', { type: 'toZone', card: id, to: 'hand:s0', position: 'any' });
    expect(t.state.cards[id]!.suspect).toBe(true);
    expect(checkInvariants(t.state)).toEqual([]);
  });

  it('turning a face-down card up with its identity is verified the same way', () => {
    const t = readySecretTable();
    const [good, bad] = t.secrets.s0!.libraryOrder;
    for (const id of [good!, bad!]) t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    expect(t.state.cards[good!]!.face).toBe('down');
    const g = t.secrets.s0!.identities[good!]!;
    t.apply('s0', { type: 'flip', card: good!, face: 'up', ref: g.card, salt: g.salt });
    t.apply('s0', { type: 'flip', card: bad!, face: 'up', ref: g.card, salt: g.salt });
    expect(t.state.cards[good!]).toMatchObject({ face: 'up', identity: g.card });
    expect(t.state.cards[good!]!.suspect).toBeUndefined();
    expect(t.state.cards[bad!]).toMatchObject({ face: 'up', identity: g.card, suspect: true });
    t.refuse('s1', { type: 'flip', card: good!, face: 'up', ref: g.card, salt: g.salt }, /only s0/);
  });
});

describe('secret shuffle rounds', () => {
  const commit = (sid = 'sh1', h = nonceHash('owner-nonce')): ActionDraft => ({ type: 'shuffleCommit', sid, zone: LIB0, h });

  it('the owner opens a round on its own hidden zone; nobody else can', () => {
    const t = readySecretTable();
    t.refuse('s1', commit(), /belongs to s0/);
    t.refuse('s0', { type: 'shuffleCommit', sid: 'x', zone: 'battlefield:s0', h: 'h' }, /public/);
    t.refuse('s0', { type: 'shuffleCommit', sid: 'x', zone: LIB0, h: '' }, /hash/);
    t.apply('s0', commit());
    expect(t.state.shuffles.sh1).toEqual({ id: 'sh1', zone: LIB0, owner: 's0', purpose: 'shuffle', h: nonceHash('owner-nonce'), startSeq: t.state.seq, nonces: {}, orderHash: null });
  });

  it('every other seated seat sends one nonce in the clear; the owner sends none', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    t.apply('s0', commit());
    t.refuse('s0', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n0' }, /owner/);
    t.apply('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n2' });
    t.refuse('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n2b' }, /already/);
    t.refuse('s1', { type: 'shuffleNonce', sid: 'nope', nonce: 'n1' }, /unknown shuffle/);
    t.refuse('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: '' }, /empty/);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1' });
    expect(t.state.shuffles.sh1!.nonces).toEqual({ s1: 'n1', s2: 'n2' });
  });

  it('an away or unseated seat is neither waited for nor accepted', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    t.apply('s0', commit());
    t.state = withAway(t.state, 's2');
    t.refuse('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n2' }, /not a connected seated player/);
    expect(expectedParticipants(t.state, 'sh1')).toEqual(['s1']);
    t.apply('s1', { type: 'seatLeave', seat: 's1' });
    expect(expectedParticipants(t.state, 'sh1')).toEqual([]);
    t.refuse('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1' }, /not a connected seated player/);
  });

  it('the owner finishes only when every expected nonce is in, or the window closed', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    t.apply('s0', commit());
    t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' }, /waits for peer nonces/);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1' });
    t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' }, /waits for peer nonces/);
    t.apply('s1', { type: 'commitClose', kind: 'shuffle', id: 'sh1' });
    expect(t.state.shuffles.sh1!.closedSeq).toBe(t.state.seq);
    t.refuse('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'late' }, /closed/);
    t.refuse('s1', { type: 'commitClose', kind: 'shuffle', id: 'sh1' }, /closed/);
    t.refuse('s1', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' }, /only s0/);
    t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: '' }, /order hash/);
    t.apply('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' });
    expect(t.state.shuffles.sh1!.orderHash).toBe('o');
    t.refuse('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o2' }, /finished/);
    t.refuse('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1b' }, /finished/);
    t.refuse('s1', { type: 'commitClose', kind: 'shuffle', id: 'sh1' }, /finished/);
  });

  it('with no other seated player the shuffle is ready at once (solo)', () => {
    const t = new SecretTable(['Anna', '']);
    t.ready('s0');
    t.apply('s0', commit());
    t.apply('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' });
  });

  it('the owner cannot change its nonce after the peers sent theirs: no second commit for the round, no new round on the zone', () => {
    const t = readySecretTable();
    t.apply('s0', commit('sh1', nonceHash('first')));
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n1' });
    const before = t.state;
    t.refuse('s0', commit('sh1', nonceHash('second')), /already exists/);
    t.refuse('s0', commit('sh2', nonceHash('second')), /already has peer nonces/);
    expect(t.state).toBe(before);
    // Once finished, a new round on the zone is fine; the finished sid is never reused.
    t.apply('s0', { type: 'shuffleDone', sid: 'sh1', orderHash: 'o' });
    t.refuse('s0', commit('sh1', nonceHash('third')), /already exists/);
    t.apply('s0', commit('sh2', nonceHash('third')));
  });

  it('a round abandoned before any peer nonce is replaced by a new one', () => {
    const t = readySecretTable();
    t.apply('s0', commit('sh1'));
    t.apply('s0', commit('sh2', nonceHash('other')));
    expect(Object.keys(t.state.shuffles)).toEqual(['sh2']);
  });
});

describe('re-issued opaque ids', () => {
  function shuffled(names = ['Anna', 'Ben']): SecretTable {
    const t = readySecretTable(names, 12);
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'owner-nonce');
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    for (let i = 1; i < names.length; i++) t.apply(`s${i}`, { type: 'shuffleNonce', sid: 'sh1', nonce: `n${i}` });
    return t;
  }

  it('shuffleDone replaces every id of the zone and adds the new commits; old ids are gone', () => {
    const t = shuffled();
    const oldIds = [...t.state.zones[LIB0]!.ids];
    const oldCommits = [...t.state.commitments.s0!.commits];
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    t.secrets.s0 = f.secrets;
    const ids = t.state.zones[LIB0]!.ids;
    expect(ids).toEqual(f.action.reissue!.ids);
    expect(ids.some((id) => oldIds.includes(id))).toBe(false);
    for (const id of oldIds) expect(t.state.cards[id]).toBeUndefined();
    const c = t.state.commitments.s0!;
    expect(c.commits).toEqual([...oldCommits, ...f.action.reissue!.commits].sort());
    for (const id of ids) expect(c.instanceIds).toContain(id);
    expect(checkInvariants(t.state)).toEqual([]);
    // A re-issued card reveals cleanly; a retired id is unknown.
    const top = t.secrets.s0!.libraryOrder[0]!;
    const s = t.secrets.s0!.identities[top]!;
    t.apply('s0', { type: 'reveal', instanceId: top, ref: s.card, salt: s.salt });
    expect(t.state.cards[top]!.suspect).toBeUndefined();
    t.refuse('s0', { type: 'reveal', instanceId: oldIds[0]!, ref: s.card, salt: s.salt }, /unknown card/);
  });

  it('refuses a malformed re-issue', () => {
    const t = shuffled();
    const ids = t.state.zones[LIB0]!.ids;
    const fresh = ids.map((_, i) => `n${String(i).padStart(2, '0')}`);
    const commits = fresh.map((id) => commitFor(id, { sid: 'x' }, 's')).sort();
    const done = (reissue: unknown): ActionDraft => ({ type: 'shuffleDone', sid: 'sh1', orderHash: 'o', reissue } as ActionDraft);
    t.refuse('s0', done({ ids: fresh.slice(1), commits: commits.slice(1) }), /ids for the 12 cards/);
    t.refuse('s0', done({ ids: [...fresh].reverse(), commits }), /sorted/);
    t.refuse('s0', done({ ids: [fresh[0], ...fresh.slice(0, -1)], commits }), /sorted and unique/);
    t.refuse('s0', done({ ids: fresh, commits: commits.slice(1) }), /one commit per id/);
    t.refuse('s0', done({ ids: fresh, commits: [...commits].reverse() }), /commits must be sorted/);
    const taken = [...fresh.slice(0, -1), t.state.zones['library:s1']!.ids[0]!].sort();
    t.refuse('s0', done({ ids: taken, commits }), /already exists/);
    t.refuse('s0', done({ ids: 'nope' }), /ids and commits/);
    t.apply('s0', done({ ids: fresh, commits }));
  });

  it('an id the seat ever committed to is never issued again, so an old commit cannot vouch for a second card', () => {
    const t = readySecretTable(['Anna', 'Ben'], 3);
    const retired = [...t.state.zones[LIB0]!.ids];
    const r = reissueZone(t.secrets.s0!, t.state, LIB0, t.entropy.s0!);
    t.apply('s0', r.action);
    t.secrets.s0 = r.secrets;
    for (const id of retired) expect(t.state.cards[id]).toBeUndefined();
    const reused = [retired[0]!, 'zz1', 'zz2'].sort();
    t.refuse('s0', { type: 'reorder', zone: LIB0, count: 3, orderHash: 'o', reissue: { ids: reused, commits: ['c1', 'c2', 'c3'] } }, /used before/);
  });

  it('a reorder that re-issues covers the whole own zone', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const top = t.secrets.s0!.libraryOrder[0]!;
    t.apply('s0', { type: 'draw', instanceId: top });
    t.secrets.s0 = { ...t.secrets.s0!, libraryOrder: t.secrets.s0!.libraryOrder.slice(1), hand: [top] };
    const r = reissueZone(t.secrets.s0!, t.state, 'hand:s0', t.entropy.s0!);
    t.refuse('s1', r.action, /only s0/);
    t.refuse('s1', { type: 'reorder', zone: LIB0, count: 1, orderHash: 'o' }, /only s0/);
    t.refuse('s0', { ...r.action, count: 0 }, /whole zone/);
    t.apply('s0', r.action);
    expect(t.state.zones['hand:s0']!.ids).toEqual(r.action.reissue!.ids);
    expect(t.state.cards[top]).toBeUndefined();
  });
});

describe('public randomness rounds', () => {
  const h = (n: string): string => nonceHash(n);

  it('every seated seat commits, then reveals; the result follows from the nonces in seat order', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    t.apply('s1', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 20, h: h('b') });
    expect(t.state.rng.d1).toMatchObject({ by: 's1', purpose: 'die', n: 20, startSeq: t.state.seq, result: null });
    t.refuse('s1', { type: 'rngReveal', rid: 'd1', nonce: 'b' }, /waits for commits/);
    t.apply('s2', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 20, h: h('c') });
    t.refuse('s0', { type: 'rngCommit', rid: 'd1', purpose: 'coin', n: 2, h: h('a') }, /die with 20/);
    t.refuse('s2', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 20, h: h('c2') }, /already committed/);
    t.apply('s0', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 20, h: h('a') });
    t.refuse('s0', { type: 'rngReveal', rid: 'd1', nonce: 'not-a' }, /does not match/);
    t.apply('s2', { type: 'rngReveal', rid: 'd1', nonce: 'c' });
    t.refuse('s2', { type: 'rngReveal', rid: 'd1', nonce: 'c' }, /already revealed/);
    t.apply('s0', { type: 'rngReveal', rid: 'd1', nonce: 'a' });
    expect(t.state.rng.d1!.result).toBeNull();
    t.apply('s1', { type: 'rngReveal', rid: 'd1', nonce: 'b' });
    expect(t.state.rng.d1!.result).toBe(rngOutcome(rngSeed({ s0: 'a', s1: 'b', s2: 'c' }, ['s0', 's1', 's2']), 20));
    t.refuse('s0', { type: 'rngReveal', rid: 'd1', nonce: 'a' }, /decided/);
    t.refuse('s0', { type: 'commitClose', kind: 'rng', id: 'd1' }, /decided/);
  });

  it('no commit is taken once a nonce is revealed, so nobody commits after seeing another nonce', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    t.apply('s0', { type: 'rngCommit', rid: 'c1', purpose: 'coin', n: 2, h: h('a') });
    t.apply('s1', { type: 'rngCommit', rid: 'c1', purpose: 'coin', n: 2, h: h('b') });
    t.apply('s0', { type: 'commitClose', kind: 'rng', id: 'c1' });
    t.refuse('s2', { type: 'rngCommit', rid: 'c1', purpose: 'coin', n: 2, h: h('c') }, /closed/);
    t.apply('s0', { type: 'rngReveal', rid: 'c1', nonce: 'a' });
    t.refuse('s2', { type: 'rngReveal', rid: 'c1', nonce: 'c' }, /did not commit/);
    t.apply('s1', { type: 'rngReveal', rid: 'c1', nonce: 'b' });
    expect(t.state.rng.c1!.result).toBe(rngOutcome(rngSeed({ s0: 'a', s1: 'b' }, ['s0', 's1']), 2));
  });

  it('refuses a commit from an unseated seat and odd outcome counts; a lone seated player decides alone', () => {
    const t = new SecretTable(['Anna', '']);
    t.refuse('s1', { type: 'rngCommit', rid: 'x', purpose: 'die', n: 6, h: h('b') }, /not a connected seated player/);
    t.refuse('s0', { type: 'rngCommit', rid: 'x', purpose: 'die', n: 0, h: h('a') }, /n must be/);
    t.refuse('s0', { type: 'rngCommit', rid: 'x', purpose: 'dice' as 'die', n: 6, h: h('a') }, /purpose/);
    t.apply('s0', { type: 'rngCommit', rid: 'x', purpose: 'die', n: 6, h: h('a') });
    t.apply('s0', { type: 'rngReveal', rid: 'x', nonce: 'a' });
    expect(t.state.rng.x!.result).toBe(rngOutcome(rngSeed({ s0: 'a' }, ['s0']), 6));
  });
});

describe('commit windows the sequencer closes', () => {
  it('lists a deadline per round still waiting, and none once everything is in', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo']);
    expect(commitWindowDeadlines(t.state)).toEqual([]);
    t.apply('s0', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 6, h: nonceHash('a') });
    const rngStart = t.state.seq;
    t.apply('s1', { type: 'shuffleCommit', sid: 'sh1', zone: 'library:s1', h: nonceHash('o') });
    const shStart = t.state.seq;
    expect(deadlines(t.state)).toEqual([
      { key: 'rng:d1', fromSeq: rngStart, afterMs: COMMIT_WINDOW_MS, emit: [{ type: 'commitClose', kind: 'rng', id: 'd1' }] },
      { key: 'shuffle:sh1', fromSeq: shStart, afterMs: COMMIT_WINDOW_MS, emit: [{ type: 'commitClose', kind: 'shuffle', id: 'sh1' }] },
    ]);
    t.apply('s1', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 6, h: nonceHash('b') });
    t.apply('s2', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 6, h: nonceHash('c') });
    t.apply('s0', { type: 'shuffleNonce', sid: 'sh1', nonce: 'n0' });
    expect(commitWindowDeadlines(t.state).map((d) => d.key)).toEqual(['shuffle:sh1']);
    t.apply('s2', { type: 'commitClose', kind: 'shuffle', id: 'sh1' });
    expect(commitWindowDeadlines(t.state)).toEqual([]);
  });

  it('a seat going away stops being waited for', () => {
    const t = readySecretTable(['Anna', 'Ben']);
    t.apply('s0', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 6, h: nonceHash('a') });
    expect(commitWindowDeadlines(t.state)).toHaveLength(1);
    expect(commitWindowDeadlines(withAway(t.state, 's1'))).toEqual([]);
  });

  it('expected participants are the other seated seats in seat order', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo', 'Dan']);
    t.apply('s2', { type: 'rngCommit', rid: 'd1', purpose: 'die', n: 6, h: nonceHash('a') });
    expect(expectedParticipants(t.state, 'd1')).toEqual(['s0', 's1', 's3']);
    expect(expectedParticipants(t.state, 'nope')).toEqual([]);
  });
});

describe('determinism', () => {
  it('replaying the same secrecy actions yields the same state hash', async () => {
    const { stateHash } = await import('../../../src/core/hash');
    const { reduce } = await import('../../../src/core/reducer');
    const t = readySecretTable(['Anna', 'Ben'], 8);
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'nonce-a');
    t.apply('s0', b.action);
    t.secrets.s0 = b.secrets;
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'nonce-b' });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    t.apply('s0', { type: 'rngCommit', rid: 'r', purpose: 'coin', n: 2, h: nonceHash('x') });
    t.apply('s1', { type: 'rngCommit', rid: 'r', purpose: 'coin', n: 2, h: nonceHash('y') });
    t.apply('s1', { type: 'rngReveal', rid: 'r', nonce: 'y' });
    t.apply('s0', { type: 'rngReveal', rid: 'r', nonce: 'x' });
    const replayed = t.log.reduce(reduce, t.start);
    expect(await stateHash(replayed)).toBe(await stateHash(t.state));
    expect(checkInvariants(replayed)).toEqual([]);
    expect(deckRefs('s0', 1)).toHaveLength(1);
  });
});
