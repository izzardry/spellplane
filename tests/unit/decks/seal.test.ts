/**
 * The seal (decks.md D3, D4, section 7; PLAN M8-P3 unit acceptance): a sealed deck takes only cards of its own pool
 * and the five basic lands; convert makes a custom copy and leaves the original untouched.
 */
import { describe, expect, it } from 'vitest';
import { add, applyEdit, move, remove, setMain, setSize } from '../../../src/data/deck/edit';
import { convertToCustom, duplicateDeck, poolRemaining, sealIntact } from '../../../src/data/deck/seal';
import { isFreeBasic } from '../../../src/data/deck/analyse';
import type { CardData } from '../../../src/data/types';
import type { DeckRecord } from '../../../src/store/types';
import { customDeck, lookup, named, ref } from './fixture-decks';

const POOL = ['Shock', 'Shock', 'Divination', 'Cancel', 'Llanowar Elves', 'Forest', 'Lightning Mare'].map((n) => ref(n));

function sealedDeck(extra: Partial<DeckRecord> = {}): DeckRecord {
  return {
    id: 's1',
    name: 'M19 boosters',
    main: [],
    side: POOL.map((r) => ({ ...r })),
    source: 'built',
    createdAt: 1,
    updatedAt: 1,
    kind: 'sealed',
    size: 40,
    seal: { via: 'packs', sets: ['M19', 'M19', 'M19'], pool: POOL.map((r) => ({ ...r })), seed: 'ab', generator: 1, sealedAt: 1, revealed: 3 },
    ...extra,
  };
}

const freeBasic = (r: { sid: string }): boolean => isFreeBasic(lookup(r));

const SNOW_FOREST: CardData = { id: 'snow-forest-test', name: 'Snow-Covered Forest', set: 'khm', collector_number: '285', rarity: 'common', layout: 'normal', cmc: 0, type_line: 'Basic Snow Land — Forest', color_identity: ['G'] };

describe('sealed deck edits (decks.md D3)', () => {
  it('answers notInPool for a card outside the pool, and takes a pool card from the side', () => {
    const deck = sealedDeck();
    const outside = add(deck, ref('Colossal Dreadmaw'), 'main', 1, named('Colossal Dreadmaw'));
    expect(outside).toEqual({ ok: false, reason: 'notInPool' });
    const r = add(deck, ref('Shock'), 'main', 1, named('Shock'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.main).toEqual([ref('Shock')]);
    expect(r.deck.side.filter((x) => x.sid === ref('Shock').sid)).toHaveLength(1);
    expect(sealIntact(r.deck, freeBasic)).toBe(true);
  });

  it('adds a basic Forest freely and refuses Snow-Covered Forest', () => {
    const deck = sealedDeck();
    const forest = add(deck, ref('Forest'), 'main', 3, named('Forest'));
    expect(forest.ok).toBe(true);
    if (forest.ok) {
      expect(forest.deck.main).toHaveLength(3);
      // One Forest came from the pool, two from the dispenser; the pool's Forest left the side.
      expect(forest.deck.side.some((x) => x.sid === ref('Forest').sid)).toBe(false);
      expect(sealIntact(forest.deck, freeBasic)).toBe(true);
    }
    expect(add(deck, { sid: SNOW_FOREST.id }, 'main', 1, SNOW_FOREST)).toEqual({ ok: false, reason: 'notInPool' });
  });

  it('refuses a basic without card data, any other board, more copies than the pool holds, and edits while opening', () => {
    const deck = sealedDeck();
    expect(add(deck, { sid: 'unknown-basic' }, 'main', 1, null)).toEqual({ ok: false, reason: 'sealed' });
    expect(add(deck, ref('Shock'), 'maybe', 1, named('Shock'))).toEqual({ ok: false, reason: 'sealed' });
    expect(add(deck, ref('Shock'), 'side', 1, named('Shock'))).toEqual({ ok: false, reason: 'sealed' });
    const three = add(deck, ref('Shock'), 'main', 3, named('Shock'));
    expect(three.ok && three.deck.main.length).toBe(2);
    const again = three.ok ? add(three.deck, ref('Shock'), 'main', 1, named('Shock')) : null;
    expect(again).toEqual({ ok: false, reason: 'notInPool' });
    const opening = sealedDeck({ seal: { ...sealedDeck().seal!, revealed: 1 } });
    expect(add(opening, ref('Shock'), 'main', 1, named('Shock'))).toEqual({ ok: false, reason: 'opening' });
    expect(setSize(deck, 60)).toEqual({ ok: false, reason: 'sealed' });
  });

  it('moving a pool card to main and back leaves side equal to the pool minus main, in pool order', () => {
    let deck = sealedDeck();
    for (const n of ['Cancel', 'Shock', 'Llanowar Elves']) {
      const r = add(deck, ref(n), 'main', 1, named(n));
      if (!r.ok) throw new Error(r.reason);
      deck = r.deck;
    }
    expect(deck.side).toEqual(poolRemaining(deck.seal!.pool, deck.main));
    const back = move(deck, ref('Cancel'), 'main', 'side', 1);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.deck.side).toEqual(poolRemaining(POOL, [ref('Shock'), ref('Llanowar Elves')]));
    expect(back.deck.side.map((r) => r.sid)).toEqual(['Shock', 'Divination', 'Cancel', 'Forest', 'Lightning Mare'].map((n) => ref(n).sid));
    expect(remove(back.deck, ref('Cancel'), 'main', 1)).toEqual({ ok: false, reason: 'absent' });
  });

  it('setMain takes the pool plus basics and refuses an outside card; the debug op answers the same', () => {
    const deck = sealedDeck();
    expect(setMain(deck, [ref('Shock'), ref('Forest'), ref('Forest')], lookup).ok).toBe(true);
    expect(setMain(deck, [ref('Shock'), ref('Colossal Dreadmaw')], lookup)).toEqual({ ok: false, reason: 'notInPool' });
    expect(applyEdit(deck, { op: 'add', sid: ref('Colossal Dreadmaw').sid }, lookup)).toEqual({ ok: false, reason: 'notInPool' });
  });
});

describe('convert and duplicate (decks.md D4)', () => {
  it('convertToCustom leaves the original deep-equal and makes a custom copy with the rest of the pool as side', () => {
    const r = add(sealedDeck(), ref('Shock'), 'main', 1, named('Shock'));
    if (!r.ok) throw new Error(r.reason);
    const original = r.deck;
    const before = JSON.parse(JSON.stringify(original)) as DeckRecord;
    const copy = convertToCustom(original, 'c2', 99);
    expect(original).toEqual(before);
    expect(copy.kind).toBe('custom');
    expect(copy.seal).toBeUndefined();
    expect(copy.name).toBe('M19 boosters (custom)');
    expect(copy.main).toEqual(original.main);
    expect(copy.side).toEqual(poolRemaining(POOL, original.main));
    expect(copy.convertedFrom).toEqual({ id: 's1', name: 'M19 boosters', at: 99, via: 'packs', sets: ['M19', 'M19', 'M19'] });
    // The copy takes any card.
    expect(add(copy, ref('Colossal Dreadmaw'), 'main', 1, named('Colossal Dreadmaw')).ok).toBe(true);
  });

  it("a sealed deck's duplicate is sealed too", () => {
    const d = duplicateDeck(sealedDeck(), 'd2', 5);
    expect(d.kind).toBe('sealed');
    expect(d.seal).toEqual(sealedDeck().seal);
  });
});

describe('custom deck edits', () => {
  it('adds to any board, removes, moves and answers absent', () => {
    let deck = customDeck([]);
    const a = add(deck, ref('Shock'), 'main', 5, named('Shock'));
    if (!a.ok) throw new Error(a.reason);
    deck = a.deck;
    expect(deck.main).toHaveLength(5);
    const m = move(deck, ref('Shock'), 'main', 'side', 2);
    if (!m.ok) throw new Error(m.reason);
    expect(m.deck.main).toHaveLength(3);
    expect(m.deck.side).toHaveLength(2);
    const mb = add(m.deck, ref('Cancel'), 'maybe', 1, named('Cancel'));
    expect(mb.ok && mb.deck.maybe).toEqual([ref('Cancel')]);
    expect(remove(deck, ref('Cancel'), 'main', 1)).toEqual({ ok: false, reason: 'absent' });
  });
});
