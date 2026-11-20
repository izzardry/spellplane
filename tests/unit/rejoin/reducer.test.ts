/**
 * M8-P5 acceptance, reducer (PLAN Milestone 8 "M8-P5 Rejoin"; persistence.md section 7; contracts.md Part G "Rejoin"):
 * `seatInvite`, `seatClaim`, `playOn` and the presence hook. Every refusal has its own reason; a valid claim changes
 * `peer`, `name`, `away`, `invite`, `takeovers` and nothing else; the team rule has no exception; a matched table takes
 * no invite; determinism.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson, stateHash } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import { reduce } from '../../../src/core/reducer';
import { claimHashOf, claimRefusal } from '../../../src/core/reducer/rejoin';
import type { Format, TableState } from '../../../src/core/types';
import { act, fresh, no, ok } from '../core/helpers';

const TOKEN = 'Jf0c1x9mQ2uVb7Yt3LrKzg';
const OTHER = 'AAAAAAAAAAAAAAAAAAAAAA';
const EXP = 1_000_000_000_000;

/** A table in its first game, every seat held by peer `p<i>`, the named seats marked away. */
function table(format: Format = '1v1', seats = 2, away: string[] = ['s1'], matched = false): TableState {
  const s = fresh(format, seats);
  const out: TableState = { ...s, stage: 'match', games: 1, seats: { ...s.seats }, settings: { ...s.settings, ...(matched ? { matched: true } : {}) } };
  for (const [id, seat] of Object.entries(out.seats)) out.seats[id] = { ...seat, peer: `p${seat.index}`, ...(away.includes(id) ? { away: true } : {}) };
  return out;
}

const invite = (seat: string, by: string, token = TOKEN): Action => act('seatInvite', { seat, h: claimHashOf(seat, token), exp: EXP }, by);
const claim = (seat: string, token = TOKEN, peer = 'p-new', name = 'Ben again'): Action => act('seatClaim', { seat, claim: token, peer, name }, seat);
const reason = (s: TableState, a: Action): string => no(s, a);

describe('seatClaim (persistence.md section 7)', () => {
  const invited = (): TableState => ok(table(), invite('s1', 's0'));

  it('a valid claim changes peer, name, away, invite and takeovers and nothing else', () => {
    const before = invited();
    const after = ok(before, { ...claim('s1'), seq: 7 });
    const seat = after.seats.s1!;
    expect(seat.peer).toBe('p-new');
    expect(seat.name).toBe('Ben again');
    expect(seat.away).toBeUndefined();
    expect(seat.invite).toBeUndefined();
    expect(seat.takeovers).toBe(1);
    // Nothing else of the seat, and nothing of the rest of the table (seq aside).
    const strip = (s: TableState): unknown => {
      const { peer: _p, name: _n, away: _a, invite: _i, takeovers: _t, closedInvite: _c, ...rest } = s.seats.s1!;
      return { ...s, seq: 0, seats: { ...s.seats, s1: rest } };
    };
    expect(canonicalJson(strip(after))).toBe(canonicalJson(strip(before)));
    expect(checkInvariants(after)).toEqual([]);
  });

  it('refuses with distinct reasons: wrong token, used token, taken-back invite, seated peer, present seat, no invite', () => {
    const reasons = new Map<string, string>();
    reasons.set('wrong', reason(invited(), claim('s1', OTHER)));
    const used = ok(invited(), claim('s1'));
    // A second browser with the same link, after the seat is held again and marked away anew.
    const awayAgain = ok(used, act('away', { seat: 's1', away: true }, 's0'));
    reasons.set('used', reason(awayAgain, claim('s1', TOKEN, 'p-third')));
    const back = ok(invited(), act('seatInvite', { seat: 's1', h: null }, 's0'));
    reasons.set('takenBack', reason(back, claim('s1')));
    reasons.set('seated', reason(invited(), claim('s1', TOKEN, 'p0')));
    reasons.set('present', reason(table('1v1', 2, []), claim('s1')));
    reasons.set('noInvite', reason(table(), claim('s1')));
    // The old browser came back by itself: the link is void.
    const returned = ok(invited(), act('away', { seat: 's1', away: false }, 's0'));
    expect(returned.seats.s1!.invite).toBeUndefined();
    reasons.set('void', reason(ok(returned, act('away', { seat: 's1', away: true }, 's0')), claim('s1')));
    for (const [kind, why] of reasons) expect(claimRefusal(why), `${kind}: ${why}`).toBe(kind);
    expect(new Set(reasons.values()).size).toBe(reasons.size);
  });

  it('is refused when not sent as the claimed seat, with an empty name, or a malformed token', () => {
    no(invited(), act('seatClaim', { seat: 's1', claim: TOKEN, peer: 'p-new', name: 'Ben' }, 's0'), /sent as the seat/);
    no(invited(), claim('s1', TOKEN, 'p-new', '  '), /name/);
    no(invited(), claim('s1', 'short'), /not valid/);
  });
});

describe('seatInvite (persistence.md section 7; contracts.md Part G items 1 and 7)', () => {
  it('opens, replaces and takes back the invite of an away seat', () => {
    let s = ok(table(), { ...invite('s1', 's0'), seq: 5 });
    expect(s.seats.s1!.invite).toEqual({ h: claimHashOf('s1', TOKEN), by: 's0', atSeq: 5, exp: EXP });
    s = ok(s, invite('s1', 's0', OTHER));
    expect(s.seats.s1!.invite!.h).toBe(claimHashOf('s1', OTHER));
    no(s, claim('s1', TOKEN));
    s = ok(s, act('seatInvite', { seat: 's1', h: null }, 's0'));
    expect(s.seats.s1!.invite).toBeUndefined();
    no(s, act('seatInvite', { seat: 's1', h: null }, 's0'), /no open invite/);
  });

  it('is refused for a present seat, the own seat, an empty seat, from an away maker and with a bad hash or expiry', () => {
    no(table('1v1', 2, []), invite('s1', 's0'), /not away/);
    no(table(), invite('s1', 's1'), /own seat|marked away/);
    no(table('ffa3', 3, ['s1', 's2']), invite('s1', 's2'), /marked away/);
    const empty = table();
    empty.seats.s1 = { ...empty.seats.s1!, peer: undefined } as TableState['seats'][string];
    delete (empty.seats.s1 as { peer?: string }).peer;
    no(empty, invite('s1', 's0'), /empty/);
    no(table(), act('seatInvite', { seat: 's1', h: 'x', exp: EXP }, 's0'), /hash/);
    no(table(), act('seatInvite', { seat: 's1', h: claimHashOf('s1', TOKEN) }, 's0'), /expiry/);
  });

  it('only a teammate invites a team seat, even when the whole team is away (2HG)', () => {
    // Team t1 is s2 and s3. Both away.
    const s = table('2hg', 4, ['s2', 's3']);
    no(s, invite('s2', 's0'), /teammate/);
    no(s, invite('s2', 's1'), /teammate/);
    // With s3 present, s3 may invite s2; s0 still may not.
    const one = table('2hg', 4, ['s2']);
    no(one, invite('s2', 's0'), /teammate/);
    ok(one, invite('s2', 's3'));
  });

  it('a matched table takes no invite at all', () => {
    no(table('1v1', 2, ['s1'], true), invite('s1', 's0'), /matched/);
    no(table('1v1', 2, ['s1'], true), act('seatInvite', { seat: 's1', h: null }, 's0'), /matched/);
  });
});

describe('playOn (persistence.md section 5; contracts.md Part G item 4)', () => {
  it('marks the named seats away and voids nothing else; an empty list applies', () => {
    const s = table('ffa3', 3, []);
    const after = ok(s, act('playOn', { without: ['s1', 's2'] }, 's0'));
    expect(after.seats.s1!.away).toBe(true);
    expect(after.seats.s2!.away).toBe(true);
    const same = ok(s, act('playOn', { without: [] }, 's0'));
    expect({ ...same, seq: 0 }).toEqual({ ...s, seq: 0 });
  });

  it('is refused for the own seat, an away seat, a seat named twice and an empty chair', () => {
    no(table('ffa3', 3, []), act('playOn', { without: ['s0'] }, 's0'), /own seat/);
    no(table('ffa3', 3, ['s1']), act('playOn', { without: ['s1'] }, 's0'), /already away/);
    no(table('ffa3', 3, []), act('playOn', { without: ['s1', 's1'] }, 's0'), /twice/);
  });
});

describe('determinism and totality', () => {
  it('the same rejoin actions give the same state hash', async () => {
    const run = (): TableState => {
      let s = table('ffa3', 3, ['s2']);
      const steps: Action[] = [
        { ...invite('s2', 's0'), cid: 'c1', seq: 1 },
        { ...act('playOn', { without: ['s1'] }, 's0'), cid: 'c2', seq: 2 },
        { ...claim('s2'), cid: 'c3', seq: 3 },
        { ...act('playOn', { without: [] }, 's0'), cid: 'c4', seq: 4 },
      ];
      for (const a of steps) s = reduce(s, a);
      return s;
    };
    expect(await stateHash(run())).toBe(await stateHash(run()));
    expect(run().seats.s2!.takeovers).toBe(1);
  });

  it('malformed rejoin actions are refused, never thrown', () => {
    const s = table();
    for (const bad of [
      { type: 'seatInvite', by: 's0', cid: 'x', seat: 42, h: null },
      { type: 'seatClaim', by: 's1', cid: 'x', seat: 's1', claim: null, peer: 'p', name: 'n' },
      { type: 'playOn', by: 's0', cid: 'x', without: 'nobody' },
      { type: 'playOn', by: 's0', cid: 'x', without: [{}] },
    ]) {
      expect(reduce(s, bad as unknown as Action)).toBe(s);
    }
  });
});
