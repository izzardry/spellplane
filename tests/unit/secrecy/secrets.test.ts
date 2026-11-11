/**
 * The owner's side of secrecy (PLAN M1-P2; DESIGN "Specification: network protocol and secrecy": Commitments,
 * Secret shuffle, private reorder; "Multiplayer architecture", Hidden information and Audit; "Table model", Hidden
 * cards): deck commitments, the shuffle derivation, re-issued ids, received identities, the leak tokens and the
 * post-game audit.
 */
import { describe, expect, it } from 'vitest';
import { commitFor, nonceHash, verifyReveal } from '../../../src/core/commit';
import { orderHash, reissueSeed, shuffleOutcome, shuffleSeed, shuffledOrder } from '../../../src/core/rng';
import {
  auditSeat,
  beginShuffle,
  commitDeck,
  disclosedBy,
  emptySecretStore,
  finishShuffle,
  lookAnswer,
  privateReorder,
  pruneReceived,
  receiveIdentity,
  receivedIdentity,
  reissueZone,
  revealedCard,
  secretTokens,
  shuffleRecord,
} from '../../../src/core/secrets';
import { reduce } from '../../../src/core/reducer';
import type { ShuffleRecord, TableState } from '../../../src/core/types';
import type { Action } from '../../../src/core/actions';
import { SecretTable, deckRefs, readySecretTable, seededEntropy } from './helpers';

const LIB0 = 'library:s0';

/** A table where s0 shuffled its library with s1's (and s2's) nonces; `reissue` marks the whole library disclosed first. */
function shuffledTable(names = ['Anna', 'Ben'], n = 12, reissue = false): { t: SecretTable; doneSeq: number } {
  const t = readySecretTable(names, n);
  const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'owner-nonce');
  t.secrets.s0 = b.secrets;
  t.apply('s0', b.action);
  for (let i = names.length - 1; i >= 1; i--) t.apply(`s${i}`, { type: 'shuffleNonce', sid: 'sh1', nonce: `peer-${i}` });
  const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!, reissue ? t.state.zones[LIB0]!.ids : []);
  t.apply('s0', f.action);
  t.secrets.s0 = f.secrets;
  return { t, doneSeq: t.state.seq };
}

describe('deck commitments', () => {
  it('commit every card under a fresh opaque id and salt; ids and commits are published sorted', () => {
    const refs = [...deckRefs('s0', 5), { sid: 'shiny', foil: true as const }];
    const { secrets, action } = commitDeck(emptySecretStore('s0'), refs, seededEntropy(7));
    expect(action.instanceIds).toEqual([...action.instanceIds].sort());
    expect(action.commits).toEqual([...action.commits].sort());
    expect(secrets.libraryOrder.map((id) => secrets.identities[id]!.card)).toEqual(refs);
    for (const id of action.instanceIds) {
      const s = secrets.identities[id]!;
      expect(id).not.toContain(s.card.sid);
      expect(action.commits).toContain(commitFor(id, s.card, s.salt));
      expect(verifyReveal({ seat: 's0', commits: action.commits, instanceIds: action.instanceIds, atSeq: 1 }, revealedCard(secrets, id)!)).toBe(true);
    }
    expect(revealedCard(secrets, 'nope')).toBeNull();
  });
});

describe('the secret shuffle', () => {
  it('keeps the ids of a zone nobody saw into, so later reveals are still checked against the Ready commitment', () => {
    const t = readySecretTable(['Anna', 'Ben', 'Cleo'], 12);
    const readyIds = [...t.state.zones[LIB0]!.ids];
    const readyCommits = [...t.state.commitments.s0!.commits];
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'owner-nonce');
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'peer-1' });
    t.apply('s2', { type: 'shuffleNonce', sid: 'sh1', nonce: 'peer-2' });
    // A disclosed id outside the zone does not force a re-issue.
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!, ['someone-elses-card']);
    expect(f.action.reissue).toBeUndefined();
    t.apply('s0', f.action);
    t.secrets.s0 = f.secrets;
    expect(t.state.zones[LIB0]!.ids).toEqual(readyIds);
    expect(t.state.commitments.s0!.commits).toEqual(readyCommits);
    // Secret shuffle 4: Fisher–Yates over the sorted ids from the seed.
    expect(f.secrets.libraryOrder).toEqual(shuffledOrder(readyIds, shuffleSeed('owner-nonce', ['peer-1', 'peer-2'])));
    expect(f.action.orderHash).toBe(orderHash(f.secrets.libraryOrder, 'owner-nonce'));
    const rec = shuffleRecord(f.secrets, 'sh1')!;
    expect(rec.reissue).toBeUndefined();
    // The owner draws and reveals with a forged identity: only the Ready commitment can vouch, so it is flagged.
    const top = f.secrets.libraryOrder[0]!;
    t.apply('s0', { type: 'draw', instanceId: top });
    t.apply('s0', { type: 'reveal', instanceId: top, ref: { sid: 'BOMB' }, salt: f.secrets.identities[top]!.salt });
    expect(t.state.cards[top]).toMatchObject({ identity: { sid: 'BOMB' }, suspect: true });
    expect(auditSeat(t.start, t.log, 's0', f.secrets.audit, f.secrets.identities)).toEqual([]);
  });

  it('re-issues only a zone holding a disclosed card, and never one holding a suspect card', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const [first, second] = t.secrets.s0!.libraryOrder;
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'owner-nonce');
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'peer-1' });
    expect(finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!, [second!]).action.reissue?.ids).toHaveLength(6);
    // A forged reveal (reveal top of library) marks `first` suspect while it stays in the library.
    t.apply('s0', { type: 'reveal', instanceId: first!, ref: { sid: 'forged' }, salt: 'x' });
    expect(t.state.cards[first!]).toMatchObject({ zone: LIB0, suspect: true });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!, [first!, second!]);
    expect(f.action.reissue).toBeUndefined();
    t.apply('s0', f.action);
    expect(reissueZone(f.secrets, t.state, LIB0, t.entropy.s0!)).toBeNull();
  });

  it('reproduces from the public round plus the owner nonce, and not from the public round alone', () => {
    const { t } = shuffledTable(['Anna', 'Ben', 'Cleo'], 12, true);
    const done = t.log.find((a) => a.type === 'shuffleDone')!;
    if (done.type !== 'shuffleDone') throw new Error('unreachable');
    const round = t.state.shuffles.sh1!;
    // Public: the old ids (sorted, in shared state before shuffleDone), the peer nonces, h, the new ids and the order hash.
    const beforeDone = t.log.slice(0, t.log.indexOf(done)).reduce(reduce, t.start);
    const oldIds = beforeDone.zones[LIB0]!.ids;
    const peers = ['peer-1', 'peer-2'];
    const withNonce = shuffleOutcome(shuffleSeed('owner-nonce', peers), oldIds, done.reissue!.ids);
    expect(orderHash(withNonce.order, 'owner-nonce')).toBe(done.orderHash);
    expect(withNonce.order).toEqual(t.secrets.s0!.libraryOrder);
    expect(nonceHash('owner-nonce')).toBe(round.h);
    // The identity at each position follows too: the card of old id before[i] sits at order[i].
    const audit = shuffleRecord(t.secrets.s0!, 'sh1')!;
    withNonce.before.forEach((old, i) => expect(t.secrets.s0!.identities[withNonce.order[i]!]!.card).toEqual(audit.reissue!.retired[old]!.card));
    // Without the owner nonce every guess from public data misses.
    const guesses = [shuffleSeed('', peers), shuffleSeed(round.h, peers), shuffleSeed(peers[0]!, peers.slice(1)), shuffleSeed('peer-2', ['peer-1'])];
    for (const seed of guesses) {
      const g = shuffleOutcome(seed, oldIds, done.reissue!.ids);
      for (const n of ['', round.h, 'peer-1']) expect(orderHash(g.order, n)).not.toBe(done.orderHash);
      expect(g.order).not.toEqual(withNonce.order);
    }
  });

  it('pairs new ids with positions by an independent permutation, so old and new ids are not linked by rank', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `o${String(i).padStart(2, '0')}`);
    const fresh = Array.from({ length: 30 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const out = shuffleOutcome('seed', ids, fresh);
    const rankPairs = out.before.filter((old, i) => ids.indexOf(old) === fresh.indexOf(out.order[i]!)).length;
    expect(rankPairs).toBeLessThan(5);
    expect(out.order).toEqual(shuffledOrder(fresh, reissueSeed('seed')));
    expect(shuffleOutcome('seed', ids)).toEqual({ before: out.before, order: out.before });
  });

  it('keeps every identity across the re-issue and commits the new ids', () => {
    const { t } = shuffledTable(['Anna', 'Ben'], 12, true);
    const s = t.secrets.s0!;
    expect(Object.keys(s.identities).sort()).toEqual(t.state.zones[LIB0]!.ids);
    expect(Object.values(s.identities).map((i) => i.card.sid).sort()).toEqual(deckRefs('s0', 12).map((r) => r.sid));
    for (const id of s.libraryOrder) expect(verifyReveal(t.state.commitments.s0!, revealedCard(s, id)!)).toBe(true);
    const rec = shuffleRecord(s, 'sh1')!;
    expect(rec).toMatchObject({ sid: 'sh1', zone: LIB0, ownerNonce: 'owner-nonce', peerNonces: ['peer-1'], order: s.libraryOrder });
  });

  it('refuses to finish a round that is not ready, not the own one, or whose stored nonce was changed', () => {
    const t = readySecretTable(['Anna', 'Ben'], 4);
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'n');
    expect(() => beginShuffle(b.secrets, LIB0, 'sh1', 'n2')).toThrow(/before/);
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    expect(() => finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!)).toThrow(/not ready/);
    expect(() => finishShuffle(t.secrets.s1!, t.state, 'sh1', t.entropy.s1!)).toThrow(/not this seat's/);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'p' });
    const tampered = { ...t.secrets.s0!, audit: t.secrets.s0!.audit.map((r) => (r.kind === 'shuffle' ? { ...r, ownerNonce: 'other' } : r)) };
    expect(() => finishShuffle(tampered, t.state, 'sh1', t.entropy.s0!)).toThrow(/does not open/);
  });
});

describe('re-issue of a hidden zone', () => {
  it('gives every hand card a fresh id and salt in the owner order, recording the old ids privately', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    for (const id of t.secrets.s0!.libraryOrder.slice(0, 3)) t.apply('s0', { type: 'draw', instanceId: id });
    const hand = t.secrets.s0!.libraryOrder.slice(0, 3);
    t.secrets.s0 = { ...t.secrets.s0!, libraryOrder: t.secrets.s0!.libraryOrder.slice(3), hand: [...hand].reverse() };
    const r = reissueZone(t.secrets.s0!, t.state, 'hand:s0', t.entropy.s0!)!;
    t.apply('s0', r.action);
    const s = r.secrets;
    expect(s.hand).toHaveLength(3);
    expect(s.hand.some((id) => hand.includes(id))).toBe(false);
    const rec = s.audit.at(-1)!;
    expect(rec.kind).toBe('reorder');
    expect(rec.reissue!.before).toEqual([...hand].reverse());
    rec.reissue!.before.forEach((old, i) => expect(s.identities[s.hand[i]!]!.card).toEqual(rec.reissue!.retired[old]!.card));
    expect(r.action.orderHash).toBe(orderHash(s.hand, rec.kind === 'reorder' ? rec.nonce : ''));
    for (const id of s.hand) expect(verifyReveal(t.state.commitments.s0!, revealedCard(s, id)!)).toBe(true);
    expect(() => reissueZone(s, t.state, 'battlefield:s0', t.entropy.s0!)).toThrow(/not a hidden zone/);
    expect(() => reissueZone(t.secrets.s1!, t.state, 'hand:s0', t.entropy.s1!)).toThrow(/not a hidden zone of s1/);
  });

  it('a private reorder records the full order and a hash over it', () => {
    const t = readySecretTable(['Anna', 'Ben'], 4);
    const order = [...t.secrets.s0!.libraryOrder.slice(1), t.secrets.s0!.libraryOrder[0]!];
    const r = privateReorder(t.secrets.s0!, t.state, LIB0, order, 1, t.entropy.s0!);
    t.apply('s0', r.action);
    expect(r.secrets.libraryOrder).toEqual(order);
    expect(r.action).toMatchObject({ type: 'reorder', zone: LIB0, count: 1 });
    expect(() => privateReorder(t.secrets.s0!, t.state, LIB0, order.slice(1), 1, t.entropy.s0!)).toThrow(/does not list/);
  });
});

describe('identities revealed to this browser only', () => {
  it('are kept while the card stays where it was shown, and forgotten when it goes into a library, is re-issued or becomes public', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const [a, b, c] = t.secrets.s0!.libraryOrder;
    for (const id of [a!, b!, c!]) t.apply('s0', { type: 'draw', instanceId: id });
    let mine = t.secrets.s1!;
    for (const id of [a!, b!, c!]) mine = receiveIdentity(mine, revealedCard(t.secrets.s0!, id)!, 's0');
    expect(receivedIdentity(mine, a!)).toMatchObject({ from: 's0', card: t.secrets.s0!.identities[a!]!.card });
    expect(receiveIdentity(mine, revealedCard(t.secrets.s0!, a!)!, 's0')).toBe(mine);
    expect(receiveIdentity(mine, revealedCard(t.secrets.s0!, a!)!, 's1')).toBe(mine);
    expect(pruneReceived(mine, t.state)).toBe(mine);
    t.apply('s0', { type: 'toZone', card: a!, to: LIB0, position: 'top' });
    const sb = t.secrets.s0!.identities[b!]!;
    t.apply('s0', { type: 'reveal', instanceId: b!, ref: sb.card, salt: sb.salt });
    t.apply('s0', { type: 'move', card: b!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    mine = pruneReceived(mine, t.state);
    expect(Object.keys(mine.received)).toEqual([c!]);
    t.secrets.s0 = { ...t.secrets.s0!, hand: [c!], libraryOrder: t.secrets.s0!.libraryOrder.filter((id) => id !== c && id !== b) };
    const r = reissueZone(t.secrets.s0!, t.state, 'hand:s0', t.entropy.s0!)!;
    t.apply('s0', r.action);
    expect(pruneReceived(mine, t.state).received).toEqual({});
  });
});

describe('leak tokens', () => {
  it('name the salt and Scryfall id of every own card that is not public, and every nonce', () => {
    const { t } = shuffledTable();
    const s = t.secrets.s0!;
    const [shown, hidden] = s.libraryOrder;
    const id = s.identities[shown!]!;
    t.apply('s0', { type: 'reveal', instanceId: shown!, ref: id.card, salt: id.salt });
    t.apply('s0', { type: 'move', card: shown!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    const tokens = secretTokens(t.state, s);
    expect(tokens).not.toContain(id.salt);
    expect(tokens).not.toContain(id.card.sid);
    expect(tokens).toContain(s.identities[hidden!]!.salt);
    expect(tokens).toContain(s.identities[hidden!]!.card.sid);
    expect(tokens).toContain('owner-nonce');
    // A face-down card on the battlefield is not public.
    t.apply('s0', { type: 'move', card: hidden!, to: 'battlefield:s0', pose: { x: 60, y: -200, rot: 0 } });
    expect(secretTokens(t.state, s)).toContain(s.identities[hidden!]!.card.sid);
  });

  it('do not name a printing a public card already shows', () => {
    const t = new SecretTable(['Anna', 'Ben']);
    t.ready('s0', [{ sid: 'forest' }, { sid: 'forest' }]);
    const [x] = t.secrets.s0!.libraryOrder;
    const id = t.secrets.s0!.identities[x!]!;
    t.apply('s0', { type: 'reveal', instanceId: x!, ref: id.card, salt: id.salt });
    t.apply('s0', { type: 'move', card: x!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    expect(secretTokens(t.state, t.secrets.s0!)).not.toContain('forest');
  });
});

describe('the post-game audit', () => {
  /** Shuffle, draw two, scry one to the bottom, put a card from the hand on top, draw it again. */
  function game(reissue = false): SecretTable {
    const { t } = shuffledTable(['Anna', 'Ben'], 10, reissue);
    const draw = (): void => {
      const top = t.secrets.s0!.libraryOrder[0]!;
      t.apply('s0', { type: 'draw', instanceId: top });
      t.secrets.s0 = { ...t.secrets.s0!, libraryOrder: t.secrets.s0!.libraryOrder.slice(1), hand: [...t.secrets.s0!.hand, top] };
    };
    draw();
    draw();
    const lib = t.secrets.s0!.libraryOrder;
    const r = privateReorder(t.secrets.s0!, t.state, LIB0, [...lib.slice(1), lib[0]!], 1, t.entropy.s0!);
    t.apply('s0', r.action);
    t.secrets.s0 = r.secrets;
    const back = t.secrets.s0!.hand[0]!;
    t.apply('s0', { type: 'toZone', card: back, to: LIB0, position: 'top' });
    t.secrets.s0 = { ...t.secrets.s0!, hand: t.secrets.s0!.hand.slice(1), libraryOrder: [back, ...t.secrets.s0!.libraryOrder] };
    draw();
    return t;
  }

  it('confirms an honest game, with or without a re-issue', () => {
    for (const reissue of [false, true]) {
      const t = game(reissue);
      expect(t.log.some((a) => a.type === 'shuffleDone' && a.reissue !== undefined)).toBe(reissue);
      expect(auditSeat(t.start, t.log, 's0', t.secrets.s0!.audit, t.secrets.s0!.identities)).toEqual([]);
    }
  });

  it('finds a reorder record by zone and order hash, so a record of a refused proposal causes no finding', () => {
    const t = game();
    const lib = t.secrets.s0!.libraryOrder;
    // A reorder the sequencer refused (never in the log) left its record in the store, before the real one.
    const stale = privateReorder(t.secrets.s0!, t.state, LIB0, [...lib].reverse(), lib.length, t.entropy.s0!);
    const real = privateReorder(t.secrets.s0!, t.state, LIB0, [...lib.slice(1), lib[0]!], 1, t.entropy.s0!);
    t.apply('s0', real.action);
    const audit = [...t.secrets.s0!.audit, stale.secrets.audit.at(-1)!, real.secrets.audit.at(-1)!];
    expect(auditSeat(t.start, t.log, 's0', audit, t.secrets.s0!.identities)).toEqual([]);
  });

  it('catches a nonce other than the committed one, other peer nonces, and a forged order', () => {
    const t = game();
    const audit = t.secrets.s0!.audit;
    const swap = (patch: Partial<ShuffleRecord>) => audit.map((r) => (r.kind === 'shuffle' ? { ...r, ...patch } : r));
    const run = (a: typeof audit) => auditSeat(t.start, t.log, 's0', a, t.secrets.s0!.identities).map((f) => f.text);
    expect(run(swap({ ownerNonce: 'chosen-later' }))).toEqual(expect.arrayContaining([expect.stringMatching(/does not open its commit/)]));
    expect(run(swap({ peerNonces: ['made-up'] }))).toEqual(expect.arrayContaining([expect.stringMatching(/other peer nonces/)]));
    const rec = audit.find((r) => r.kind === 'shuffle')!;
    expect(run(swap({ order: [...rec.order].reverse() }))).toEqual(expect.arrayContaining([expect.stringMatching(/does not follow from its seed/)]));
  });

  it('catches a draw that did not take the top card', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', 'n');
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: 'p' });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    const second = f.secrets.libraryOrder[1]!;
    t.apply('s0', { type: 'draw', instanceId: second });
    expect(auditSeat(t.start, t.log, 's0', f.secrets.audit, f.secrets.identities)).toEqual([{ seq: t.state.seq, text: `draw of ${second} was not the top card` }]);
  });

  it('catches a re-issue that swapped a card for another', () => {
    const t = game(true);
    const audit = t.secrets.s0!.audit.map((r) => {
      if (r.kind !== 'shuffle' || !r.reissue) return r;
      const [first] = r.reissue.before;
      const retired = { ...r.reissue.retired, [first!]: { ...r.reissue.retired[first!]!, card: { sid: 'something-else' } } };
      return { ...r, reissue: { ...r.reissue, retired } };
    });
    const texts = auditSeat(t.start, t.log, 's0', audit, t.secrets.s0!.identities).map((f) => f.text);
    expect(texts).toEqual(expect.arrayContaining([expect.stringMatching(/re-issue changed the identity/), expect.stringMatching(/does not match its commitment/)]));
  });

  it('catches a reorder whose record does not match its hash', () => {
    const t = game();
    const audit = t.secrets.s0!.audit.map((r) => (r.kind === 'reorder' ? { ...r, nonce: 'x' } : r));
    expect(auditSeat(t.start, t.log, 's0', audit, t.secrets.s0!.identities).map((f) => f.text)).toEqual([expect.stringMatching(/reorder of library:s0 published another order hash/)]);
  });
});

describe('disclosures that make a shuffle re-issue ids', () => {
  function step(t: SecretTable, by: string, draft: Parameters<SecretTable['apply']>[1]): { prior: TableState; a: Action } {
    const prior = t.state;
    t.apply(by, draft);
    return { prior, a: t.log.at(-1)! };
  }

  it('are public reveals, own targeted reveals and other seats\u2019 looks; the owner\u2019s own look is not one', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const s0 = t.secrets.s0!;
    const [top, second, third] = s0.libraryOrder;
    const seen = (x: { prior: TableState; a: Action }): string[] => disclosedBy(s0, x.prior, x.a, t.state);
    expect(seen(step(t, 's0', { type: 'lookAt', zone: LIB0, count: 2 }))).toEqual([]);
    expect(seen(step(t, 's1', { type: 'lookAt', zone: LIB0, count: 2 }))).toEqual([top!, second!].sort());
    expect(seen(step(t, 's0', { type: 'revealTo', instanceId: third!, seats: ['s1'] }))).toEqual([third!]);
    const id = s0.identities[top!]!;
    expect(seen(step(t, 's0', { type: 'reveal', instanceId: top!, ref: id.card, salt: id.salt }))).toEqual([top!]);
    expect(seen(step(t, 's0', { type: 'move', card: top!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } }))).toEqual([top!]);
    // Seat s1's own cards are not s0's business.
    const other = t.state.zones['library:s1']!.ids[0]!;
    expect(seen(step(t, 's1', { type: 'revealTo', instanceId: other, seats: ['s0'] }))).toEqual([]);
  });
});

describe('the owner\u2019s look answer', () => {
  it('shows the top cards of the requested own hidden zone, or exactly a peeked own face-down card; never a hand or library card for a peek', () => {
    const t = readySecretTable(['Anna', 'Ben'], 6);
    const s0 = t.secrets.s0!;
    const [a, b, c] = s0.libraryOrder;
    t.apply('s0', { type: 'draw', instanceId: a! });
    t.apply('s0', { type: 'move', card: b!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    const s = { ...s0, hand: [a!], libraryOrder: s0.libraryOrder.slice(2) };
    expect(lookAnswer(s, t.state, { zone: LIB0, count: 2 })!.map((r) => r.instanceId)).toEqual([c!, s0.libraryOrder[3]!]);
    expect(lookAnswer(s, t.state, { zone: 'battlefield:s0', count: 1, card: b! })).toEqual([revealedCard(s, b!)]);
    expect(lookAnswer(s, t.state, { zone: 'hand:s0', count: 1, card: a! })).toBeNull();
    expect(lookAnswer(s, t.state, { zone: LIB0, count: 1, card: c! })).toBeNull();
    expect(lookAnswer(s, t.state, { zone: 'battlefield:s0', count: 1 })).toBeNull();
    expect(lookAnswer(s, t.state, { zone: 'library:s1', count: 1 })).toBeNull();
  });
});
