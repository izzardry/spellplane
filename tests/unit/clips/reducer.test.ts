/**
 * PLAN Milestone 6, owner decisions, Paperclips (DESIGN "Card manipulation", Clip), in the engine: a clip pins two or
 * more battlefield cards (face-down included); anyone may add or remove one; a card that leaves the battlefield leaves
 * its clip and a clip under fewer than two cards vanishes; clips chain; adding and removing are undoable, and undoing a
 * move that dissolved a clip brings the clip back. Deterministic: the same actions give the same hash.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { clipGroup, clipsOf } from '../../../src/core/clips';
import { canonicalJson } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import { reduce } from '../../../src/core/reducer';
import { anchorPoint, clipPoint } from '../../../src/core/reducer/clips';
import type { TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import { P, act, card, no, ok, play, readyTable, withoutSeq } from '../core/helpers';

/** Seat 0 has a00, a01, a02 overlapping on its battlefield; seat 1 has b00 on its own. */
function table(): TableState {
  let s = readyTable(6);
  s = play(s, 'a00', P(0, -200));
  s = play(s, 'a01', P(30, -190));
  s = play(s, 'a02', P(60, -180));
  s = play(s, 'b00', P(0, 200, 180), 's1');
  return s;
}

const add = (clip: string, cards: string[], anchor = { card: cards[0]!, x: 15, y: 5 }, by = 's0') => act('clipAdd', { clip, cards, anchor }, by);

function clean(s: TableState): void {
  expect(checkInvariants(s)).toEqual([]);
}

function undo(before: TableState, after: TableState, a: Action, by = a.by): TableState {
  const inv = inverse(before, a);
  expect(inv, `inverse of ${a.type}`).not.toBeNull();
  return ok(after, act('undo', { of: a.cid, inverse: JSON.parse(JSON.stringify(inv)) }, by));
}

describe('clipAdd and clipRemove', () => {
  it('pins two or more battlefield cards, stored sorted, with the clipping seat and a quantised anchor', () => {
    const s = ok(table(), add('k1', ['a01', 'a00'], { card: 'a01', x: -14.999, y: 3.333 }));
    expect(s.clips).toEqual({ k1: { id: 'k1', cards: ['a00', 'a01'], anchor: { card: 'a01', x: -15, y: 3.33 }, by: 's0' } });
    expect(clipsOf(s, 'a00').map((c) => c.id)).toEqual(['k1']);
    clean(s);
  });

  it('lets any seat clip any battlefield card, also across battlefields, and any seat take any clip off', () => {
    let s = ok(table(), add('k1', ['a00', 'b00'], undefined, 's1'));
    expect(s.clips?.k1?.by).toBe('s1');
    s = ok(s, act('clipRemove', { clip: 'k1' }, 's0'));
    expect(s.clips).toBeUndefined();
    clean(s);
  });

  it('clips a face-down battlefield card', () => {
    let s = ok(table(), act('flip', { card: 'a01', face: 'down' }));
    s = ok(s, add('k1', ['a00', 'a01']));
    expect(s.clips?.k1?.cards).toEqual(['a00', 'a01']);
  });

  it('refuses what is not a clip: one card, a card twice, a card off the battlefield, an unknown card, a spectator', () => {
    let s = table();
    no(s, add('k1', ['a00']), /2 to/);
    no(s, add('k1', ['a00', 'a00']), /twice/);
    no(s, add('k1', ['a00', 'a05']), /not on a battlefield/);
    no(s, add('k1', ['a00', 'zz']), /unknown card/);
    s = ok(s, act('move', { card: 'a02', to: 'graveyard:s0' }));
    no(s, add('k1', ['a00', 'a02']), /not on a battlefield/);
    no(s, act('clipAdd', { clip: 'k1', cards: ['a00', 'a01'], anchor: { card: 'a00', x: 0, y: 0 } }, 'v:peer'), /unknown seat/);
  });

  it('refuses a bad anchor, a taken id and a second clip on exactly the same cards', () => {
    let s = table();
    no(s, add('k1', ['a00', 'a01'], { card: 'a02', x: 0, y: 0 }), /not one of its cards/);
    no(s, add('k1', ['a00', 'a01'], { card: 'a00', x: 500, y: 0 }), /anchor x/);
    no(s, add('k1', ['a00', 'a01'], { card: 'a00', x: Number.NaN, y: 0 }), /anchor x/);
    s = ok(s, add('k1', ['a00', 'a01']));
    no(s, add('k1', ['a01', 'a02']), /already exists/);
    no(s, add('k2', ['a01', 'a00']), /already clipped together/);
    // A different set sharing a card chains.
    s = ok(s, add('k2', ['a01', 'a02']));
    expect(clipGroup(s, 'a00')).toEqual(['a00', 'a01', 'a02']);
    no(s, act('clipRemove', { clip: 'nope' }), /unknown clip/);
  });

  it('keeps tables without clips free of the clips key after the last clip goes', () => {
    const before = table();
    let s = ok(before, add('k1', ['a00', 'a01']));
    s = ok(s, act('clipRemove', { clip: 'k1' }));
    expect('clips' in s).toBe(false);
    expect(withoutSeq(s)).toBe(withoutSeq(before));
  });

  it('is deterministic: the same actions give the same state on every peer', () => {
    const run = () => {
      let s = table();
      s = ok(s, act('rotate', { card: 'a00', delta: 33.33 }));
      s = ok(s, add('k1', ['a00', 'a01'], { card: 'a00', x: 12.34, y: -7.89 }));
      s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(100.5, -50.25, 33.33) }));
      s = ok(s, act('move', { card: 'a00', to: 'graveyard:s0' }));
      return canonicalJson(s);
    };
    expect(run()).toBe(run());
  });
});

describe('clips and cards leaving the battlefield', () => {
  it('a clipped card going to the graveyard leaves the clip; a clip left with one card disappears', () => {
    let s = ok(table(), add('k1', ['a00', 'a01', 'a02']));
    s = ok(s, act('move', { card: 'a02', to: 'graveyard:s0' }));
    expect(s.clips?.k1?.cards).toEqual(['a00', 'a01']);
    s = ok(s, act('move', { card: 'a01', to: 'exile:s0' }));
    expect(s.clips).toBeUndefined();
    clean(s);
  });

  it('a card to the hand, the library or the stack leaves its clip too, and a removed token', () => {
    let s = ok(table(), add('k1', ['a00', 'a01', 'a02']));
    s = ok(s, act('toZone', { card: 'a02', to: 'hand:s0', position: 'any' }));
    expect(s.clips?.k1?.cards).toEqual(['a00', 'a01']);
    s = ok(s, act('createToken', { card: 't1', zone: 'battlefield:s0', pose: P(10, -195), label: 'Soldier' }));
    s = ok(s, add('k2', ['a00', 't1']));
    s = ok(s, act('remove', { card: 't1' }));
    expect(s.clips?.k2).toBeUndefined();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    expect(s.clips).toBeUndefined();
    clean(s);
  });

  it('moving a clipped card to another battlefield keeps the clip (it is still on the battlefield)', () => {
    let s = ok(table(), add('k1', ['a00', 'a01']));
    s = ok(s, act('move', { card: 'a01', to: 'battlefield:s1', pose: P(0, 150, 180) }));
    expect(s.clips?.k1?.cards).toEqual(['a00', 'a01']);
  });

  it('a clip whose anchor card leaves stays at the same table point, anchored on a remaining card', () => {
    let s = ok(table(), act('rotate', { card: 'a01', delta: 30 }));
    s = ok(s, add('k1', ['a00', 'a01', 'a02'], { card: 'a00', x: 20, y: 6 }));
    const at = clipPoint(s, s.clips!.k1!)!;
    expect(at.x).toBeCloseTo(20, 6);
    expect(at.y).toBeCloseTo(-194, 6);
    s = ok(s, act('move', { card: 'a00', to: 'graveyard:s0' }));
    const k = s.clips!.k1!;
    expect(k.anchor.card).toBe('a01');
    const now = anchorPoint(s.cards.a01!.pose, k.anchor);
    expect(Math.abs(now.x - at.x)).toBeLessThan(0.02);
    expect(Math.abs(now.y - at.y)).toBeLessThan(0.02);
    clean(s);
  });

  it('the anchor follows its card as the card moves on the battlefield', () => {
    let s = ok(table(), add('k1', ['a00', 'a01'], { card: 'a00', x: 15, y: 5 }));
    s = ok(s, act('move', { card: 'a00', to: 'battlefield:s0', pose: P(100, -100) }));
    expect(clipPoint(s, s.clips!.k1!)).toEqual({ x: 115, y: -95 });
  });
});

describe('undo (adding and removing a clip are undoable)', () => {
  it('undoing a clip takes it off; undoing a removal brings it back with its creator, not the undoer', () => {
    const s0 = table();
    const a = add('k1', ['a00', 'a01']);
    const s1 = ok(s0, a);
    expect(withoutSeq(undo(s0, s1, a))).toBe(withoutSeq(s0));

    const r = act('clipRemove', { clip: 'k1' }, 's1');
    const s2 = ok(s1, r);
    const back = undo(s1, s2, r);
    expect(back.clips?.k1).toEqual({ id: 'k1', cards: ['a00', 'a01'], anchor: { card: 'a00', x: 15, y: 5 }, by: 's0' });
    expect(withoutSeq(back)).toBe(withoutSeq(s1));
  });

  it('undoing the move that took a clipped card to the graveyard restores the clip exactly', () => {
    let s0 = ok(table(), add('k1', ['a00', 'a01']));
    s0 = ok(s0, add('k2', ['a00', 'a01', 'a02'], { card: 'a02', x: -10, y: 0 }));
    const m = act('move', { card: 'a02', to: 'graveyard:s0' });
    const s1 = ok(s0, m);
    expect(s1.clips?.k2?.cards).toEqual(['a00', 'a01']);
    expect(s1.clips?.k2?.anchor.card).toBe('a00');
    expect(withoutSeq(undo(s0, s1, m))).toBe(withoutSeq(s0));
  });

  it('refuses an undo of a removal when someone clipped the same id meanwhile (compare-and-set)', () => {
    const s0 = ok(table(), add('k1', ['a00', 'a01']));
    const r = act('clipRemove', { clip: 'k1' });
    const s1 = ok(s0, r);
    const inv = inverse(s0, r)!;
    const s2 = ok(s1, add('k1', ['a01', 'a02'], undefined, 's1'));
    no(s2, act('undo', { of: r.cid, inverse: inv }), /already exists|stale/);
  });

  it('refuses a forged clip restore (cards off the battlefield, unsorted, unknown seat)', () => {
    const s0 = ok(table(), add('k1', ['a00', 'a01']));
    const r = act('clipRemove', { clip: 'k1' });
    const s1 = ok(s0, r);
    const inv = inverse(s0, r)!;
    const forge = (put: unknown) => act('undo', { of: r.cid, inverse: { ...inv, restore: { clips: { k1: { expect: { ...s0.clips!.k1!, by: 's0' }, put } } } } as never });
    const bad = [{ ...s0.clips!.k1!, cards: ['a01', 'a00'] }, { ...s0.clips!.k1!, cards: ['a00', 'a05'] }, { ...s0.clips!.k1!, by: 's9' }, { ...s0.clips!.k1!, extra: 1 }];
    for (const put of bad) expect(reduce(s1, forge(put))).toBe(s1);
    expect(card(s1, 'a00').zone).toBe('battlefield:s0');
  });
});
