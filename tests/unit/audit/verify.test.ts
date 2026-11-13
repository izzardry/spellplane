/**
 * The audit's replay (PLAN M5-P2; DESIGN "Specification: network protocol and secrecy", Secret shuffle 1-5, private
 * reorder, draws: "The audit replays every record against the public log and checks that each drawn id was on top";
 * PLAN Milestone 5, owner decisions: a mismatch only for records that exist and disagree, "could not be checked:
 * records missing" otherwise). Pure core, no network: genuine public logs and genuine owner records (helpers.ts).
 */
import { describe, expect, it } from 'vitest';
import { auditSeats, verifyAudit, type AuditBundle, type AuditVerdict, type PublishedShuffle } from '../../../src/core/audit';
import type { Action } from '../../../src/core/actions';
import { orderHash, shuffleOutcome, shuffleSeed } from '../../../src/core/rng';
import type { ShuffleRecord } from '../../../src/core/types';
import { AuditTable } from './helpers';

const mismatchKinds = (v: AuditVerdict): string[] => (v.status === 'mismatch' ? v.mismatches.map((m) => m.kind) : []);

/** Anna and Ben both Ready, the match started, both shuffled once, seven cards each. */
function opened(): AuditTable {
  const g = new AuditTable();
  g.startMatch();
  g.shuffle('s0', 'sh-a1');
  g.shuffle('s1', 'sh-b1');
  g.draw('s0', 7);
  g.draw('s1', 7);
  return g;
}

/** A bundle with record `i` replaced. */
function withShuffle(b: AuditBundle, f: (r: PublishedShuffle) => PublishedShuffle): AuditBundle {
  return { ...b, records: b.records.map((r) => (r.kind === 'shuffle' ? f(r) : r)) };
}

describe('auditGames', () => {
  it('lists every finished match span with its number, and not the one being played', () => {
    const g = new AuditTable();
    expect(g.games()).toEqual([]);
    g.startMatch();
    const from = g.state.seq;
    g.draw('s0', 1);
    expect(g.games()).toEqual([]);
    g.endMatch();
    expect(g.games()).toEqual([{ game: 1, fromSeq: from, toSeq: g.state.seq }]);
    expect(g.state.games).toBe(1);
    // Game two: both Ready again in the builder, then match, then the evening ends in the lobby.
    g.t.ready('s0');
    g.t.ready('s1');
    g.t.apply('s0', { type: 'stageSet', stage: 'match' });
    const from2 = g.state.seq;
    g.endMatch('lobby');
    expect(g.games()).toEqual([
      { game: 1, fromSeq: from, toSeq: from + 4 },
      { game: 2, fromSeq: from2, toSeq: g.state.seq },
    ]);
    expect(g.state.games).toBe(2);
  });

  it('names the seats that held a deck', () => {
    const g = opened();
    g.endMatch();
    const game = g.games()[0]!;
    const inp = g.input('s0');
    expect(auditSeats(inp.start, inp.log)).toEqual(['s0', 's1']);
    expect(game.game).toBe(1);
  });
});

describe('verifyAudit on an honest game', () => {
  it('verifies shuffles, reorders, re-issues and every draw from a committed order', () => {
    const g = opened();
    // Anna scries her top card to the bottom, then puts the fifth card on top after a search (a reorder of one card).
    const lib = g.library('s0');
    g.reorder('s0', [...lib.slice(1), lib[0]!], 1);
    const lib2 = g.library('s0');
    g.reorder('s0', [lib2[4]!, ...lib2.slice(0, 4), ...lib2.slice(5)], 1);
    g.draw('s0', 2);
    // Anna's hand gets fresh ids; Ben's library is shuffled with fresh ids (a card of it was seen).
    g.reissueHand('s0');
    g.shuffle('s1', 'sh-b2', { disclosed: [g.library('s1')[3]!] });
    expect(g.log.at(-1)).toMatchObject({ type: 'shuffleDone', reissue: expect.anything() });
    g.draw('s1', 3);
    g.endMatch();
    const a = verifyAudit(g.input('s0'));
    const b = verifyAudit(g.input('s1'));
    expect(a).toEqual({ seat: 's0', game: 1, status: 'verified', shuffles: 1, draws: 9 });
    expect(b).toEqual({ seat: 's1', game: 1, status: 'verified', shuffles: 2, draws: 10 });
    // Deterministic, and the input is not changed.
    const inp = g.input('s1');
    const frozen = structuredClone(inp);
    expect(verifyAudit(inp)).toEqual(b);
    expect(inp).toEqual(frozen);
  });

  it('follows the library through cards the owner put on top or at the bottom and the undo of a draw', () => {
    const g = opened();
    const hand = g.t.secrets.s0!.hand;
    g.t.apply('s0', { type: 'toZone', card: hand[0]!, to: 'library:s0', position: 'top' });
    g.follow('s0', 'top');
    g.t.apply('s0', { type: 'toZone', card: hand[1]!, to: 'library:s0', position: 'bottom' });
    g.follow('s0', 'bottom');
    expect(g.library('s0')[0]).toBe(hand[0]);
    expect(g.library('s0').at(-1)).toBe(hand[1]);
    g.draw('s0', 1);
    g.t.apply('s0', { type: 'undo', of: g.log.at(-1)!.cid, inverse: { type: 'toZone', by: 's0', cid: 'inv', card: g.log.at(-1)!.type === 'draw' ? (g.log.at(-1) as Extract<Action, { type: 'draw' }>).instanceId : '', to: 'library:s0', position: 'top' } });
    g.follow('s0', 'top');
    g.draw('s0', 2);
    g.endMatch();
    expect(verifyAudit(g.input('s0'))).toEqual({ seat: 's0', game: 1, status: 'verified', shuffles: 1, draws: 10 });
  });

  it('does not check draws whose order nobody committed to (after a mulligan, before the first shuffle): no false mismatch', () => {
    const g = new AuditTable();
    g.startMatch();
    // Ben draws from the unshuffled deck order; Anna mulligans (the hand goes back unplaced) and draws again unshuffled.
    g.draw('s1', 2);
    g.shuffle('s0', 'sh-a1');
    g.draw('s0', 7);
    for (const id of [...g.t.secrets.s0!.hand]) g.t.apply('s0', { type: 'toZone', card: id, to: 'library:s0', position: 'any' });
    g.follow('s0');
    // Anna's client keeps the returned cards wherever; the table cannot know, so these draws are not checked.
    g.t.secrets.s0 = { ...g.t.secrets.s0!, libraryOrder: [...g.library('s0')].reverse() };
    g.draw('s0', 3);
    g.endMatch();
    expect(verifyAudit(g.input('s0'))).toEqual({ seat: 's0', game: 1, status: 'verified', shuffles: 1, draws: 7 });
    expect(verifyAudit(g.input('s1'))).toEqual({ seat: 's1', game: 1, status: 'verified', shuffles: 0, draws: 0 });
  });
});

describe('verifyAudit finds records that disagree', () => {
  it('a stacked shuffle: the order does not follow from the seed (one finding, at the shuffle)', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1', {
      done: (f) => {
        const rec = f.secrets.audit.at(-1) as ShuffleRecord;
        const stacked = [...rec.order].reverse();
        return { secrets: { ...f.secrets, libraryOrder: stacked, audit: [...f.secrets.audit.slice(0, -1), { ...rec, order: stacked }] }, action: { ...f.action, orderHash: orderHash(stacked, rec.ownerNonce) } };
      },
    });
    g.draw('s0', 7);
    g.endMatch();
    const v = verifyAudit(g.input('s0'));
    expect(mismatchKinds(v)).toEqual(['order']);
    const done = g.log.find((a) => a.type === 'shuffleDone')!;
    expect(v.status === 'mismatch' && v.mismatches[0]).toMatchObject({ seq: done.seq, ref: 'sh-a1' });
  });

  it('a published order hash that is not the record’s (the order shown later is not the one committed)', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1', { done: (f) => ({ ...f, action: { ...f.action, orderHash: orderHash(['x'], 'y') } }) });
    g.endMatch();
    expect(mismatchKinds(verifyAudit(g.input('s0')))).toEqual(['orderHash']);
  });

  it('a forged owner nonce, forged peer nonces, a record that lists other cards', () => {
    const g = opened();
    g.endMatch();
    const honest = g.bundle('s0');
    const rec = honest.records[0] as PublishedShuffle;
    const forged = withShuffle(honest, (r) => {
      const ownerNonce = 'forged';
      const order = shuffleOutcome(shuffleSeed(ownerNonce, r.peerNonces), r.order).order;
      return { ...r, ownerNonce, order };
    });
    // The forged order hashes differently too: the table committed to the real one.
    expect(mismatchKinds(verifyAudit(g.input('s0', forged)))).toEqual(['commit', 'orderHash']);
    const peers = withShuffle(honest, (r) => ({ ...r, peerNonces: ['someone else'] }));
    expect(mismatchKinds(verifyAudit(g.input('s0', peers)))).toEqual(['nonces']);
    const other = withShuffle(honest, (r) => ({ ...r, order: [...r.order.slice(1), 'zzz'] }));
    expect(mismatchKinds(verifyAudit(g.input('s0', other)))).toEqual(['order', 'orderHash']);
    expect(rec.order).toHaveLength(20);
  });

  it('a draw that was not on top names the draw, the drawn card and the expected top', () => {
    const g = opened();
    const [top, second] = g.library('s1');
    g.t.secrets.s1 = { ...g.t.secrets.s1!, libraryOrder: [second!, top!, ...g.library('s1').slice(2)] };
    g.draw('s1', 1);
    g.endMatch();
    const v = verifyAudit(g.input('s1'));
    expect(v.status).toBe('mismatch');
    if (v.status !== 'mismatch') return;
    expect(v.mismatches).toEqual([
      {
        kind: 'draw',
        seq: g.games()[0]!.toSeq - 3,
        ref: 'library:s1',
        detail: `The 8th draw of the game (action ${g.games()[0]!.toSeq - 3}) took ${second!.slice(0, 8)}…, which lay at position 2; the top of the committed library was ${top!.slice(0, 8)}….`,
      },
    ]);
  });

  it('a reorder whose record does not hash to the public trace, and one that moved more cards than it looked at', () => {
    const g = opened();
    const lib = g.library('s0');
    g.reorder('s0', [...lib.slice(1), lib[0]!], 1);
    g.draw('s0', 1);
    g.endMatch();
    const honest = g.bundle('s0');
    expect(verifyAudit(g.input('s0', honest)).status).toBe('verified');
    const nonce = { ...honest, records: honest.records.map((r) => (r.kind === 'reorder' ? { ...r, nonce: 'other' } : r)) };
    expect(mismatchKinds(verifyAudit(g.input('s0', nonce)))).toEqual(['orderHash']);

    const h = opened();
    const l = h.library('s0');
    // "Scry 1" that also swapped the two bottom cards.
    h.reorder('s0', [...l.slice(1, -2), l.at(-1)!, l.at(-2)!, l[0]!], 1);
    h.draw('s0', 1);
    h.endMatch();
    const v = verifyAudit(h.input('s0'));
    expect(mismatchKinds(v)).toEqual(['order']);
    expect(v.status === 'mismatch' && v.mismatches[0]!.detail).toMatch(/a reorder of 1 card moved 2 cards of the library/);
  });

  it('a re-issue whose old ids are not mapped as the seed orders them', () => {
    const g = opened();
    g.shuffle('s1', 'sh-b2', { disclosed: [g.library('s1')[0]!] });
    g.endMatch();
    const honest = g.bundle('s1');
    expect(verifyAudit(g.input('s1', honest)).status).toBe('verified');
    const swapped = withShuffle(honest, (r) => (r.reissue ? { ...r, reissue: { before: [...r.reissue.before].reverse() } } : r));
    expect(mismatchKinds(verifyAudit(g.input('s1', swapped)))).toEqual(['reissue']);
    const dropped = withShuffle(honest, (r) => {
      const { reissue: _r, ...rest } = r;
      return rest;
    });
    expect(mismatchKinds(verifyAudit(g.input('s1', dropped)))).toEqual(['reissue']);
  });
});

describe('verifyAudit with missing or malformed records', () => {
  it('a missing record is unrecorded when the bundle claims to be complete, and unchecked when it says it is incomplete', () => {
    const g = opened();
    g.shuffle('s0', 'sh-a2');
    g.draw('s0', 2);
    g.endMatch();
    const full = g.bundle('s0');
    expect(full.records).toHaveLength(2);
    const lost = { ...full, records: full.records.slice(1) };
    expect(mismatchKinds(verifyAudit(g.input('s0', lost)))).toEqual(['unrecorded']);
    // The verdict names the unrecorded shuffle by its action, and how many draws went unchecked after it.
    const firstDone = g.input('s0', lost).log.find((a) => a.type === 'shuffleDone' && a.by === 's0')!.seq!;
    expect(verifyAudit(g.input('s0', { ...lost, incomplete: true }))).toEqual({
      seat: 's0',
      game: 1,
      status: 'unverifiable',
      reason: 'recordsMissing',
      detail: `1 of 2 shuffles and reorders checked; the rest could not be checked (no record of action ${firstDone}); 2 of 9 draws checked.`,
      checked: 1,
    });
    // A disagreement among the records that do exist is still a mismatch.
    const bad = withShuffle({ ...lost, incomplete: true }, (r) => ({ ...r, ownerNonce: 'x' }));
    expect(verifyAudit(g.input('s0', bad)).status).toBe('mismatch');
  });

  it('buildAuditBundle marks a store that lost records as incomplete', () => {
    const g = opened();
    g.endMatch();
    g.t.secrets.s0 = { ...g.t.secrets.s0!, audit: [] };
    const b = g.bundle('s0');
    expect(b).toEqual({ seat: 's0', game: g.games()[0], records: [], incomplete: true });
    expect(verifyAudit(g.input('s0', b))).toMatchObject({ status: 'unverifiable', checked: 0 });
  });

  it('no bundle at all: could not be checked, never a mismatch', () => {
    const g = opened();
    g.endMatch();
    expect(verifyAudit(g.input('s1', null))).toEqual({
      seat: 's1',
      game: 1,
      status: 'unverifiable',
      reason: 'recordsMissing',
      detail: 'No audit records were published (the player left early or lost the save).',
      checked: 0,
    });
  });

  it('a bundle of another seat or game, or carrying anything beyond orders and nonces, is malformed', () => {
    const g = opened();
    g.endMatch();
    const honest = g.bundle('s0');
    const game = g.games()[0]!;
    expect(mismatchKinds(verifyAudit(g.input('s0', { ...honest, seat: 's1' })))).toEqual(['malformed']);
    expect(mismatchKinds(verifyAudit(g.input('s0', { ...honest, game: { ...game, toSeq: game.toSeq + 1 } })))).toEqual(['malformed']);
    const smuggled = { ...honest, records: [{ ...honest.records[0]!, retired: { x: { card: { sid: 'abc' }, salt: 's' } } }] } as unknown as AuditBundle;
    expect(mismatchKinds(verifyAudit(g.input('s0', smuggled)))).toEqual(['malformed']);
    for (const junk of [42, 'x', [], { seat: 's0' }, { ...honest, records: [null] }]) {
      expect(mismatchKinds(verifyAudit(g.input('s0', junk as unknown as AuditBundle)))).toEqual(['malformed']);
    }
  });
});

describe('buildAuditBundle', () => {
  it('publishes the game’s own records in log order, stripped of identities; not other games’, not refused ones', () => {
    const g = opened();
    // A record of a reorder that was never sequenced (refused) stays out.
    g.t.secrets.s0 = { ...g.t.secrets.s0!, audit: [...g.t.secrets.s0!.audit, { kind: 'reorder', zone: 'library:s0', count: 1, nonce: 'unused', order: [] }] };
    g.reissueHand('s0');
    g.endMatch();
    const b1 = g.bundle('s0');
    expect(b1.records.map((r) => r.kind)).toEqual(['shuffle', 'reorder']);
    const json = JSON.stringify(b1);
    expect(json).not.toContain('retired');
    expect(json).not.toContain('salt');
    expect(json).not.toContain('sid-s0');
    expect(b1.incomplete).toBeUndefined();
    // Game two: only its own records.
    g.t.ready('s0');
    g.t.ready('s1');
    g.t.apply('s0', { type: 'stageSet', stage: 'match' });
    g.shuffle('s0', 'sh-a9');
    g.endMatch();
    const game2 = g.games()[1]!;
    const b2 = g.bundle('s0', game2);
    expect(b2.records.map((r) => (r.kind === 'shuffle' ? r.sid : r.kind))).toEqual(['sh-a9']);
    expect(verifyAudit(g.input('s0', b2, game2))).toEqual({ seat: 's0', game: 2, status: 'verified', shuffles: 1, draws: 0 });
    // Game two's ids are new: nothing published for game one names a card of game two.
    const ids1 = new Set(b1.records.flatMap((r) => [...r.order, ...(r.reissue?.before ?? [])]));
    expect(Object.keys(g.state.cards).length).toBe(0);
    expect(g.log.filter((a) => a.type === 'ready').slice(2).flatMap((a) => (a.type === 'ready' ? a.instanceIds : [])).some((id) => ids1.has(id))).toBe(false);
  });
});
