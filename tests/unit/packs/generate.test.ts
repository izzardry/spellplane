/**
 * M2-P1 pack generation edge cases (DESIGN "Specification: card data, packs and draft formats", Pack generation 1-4):
 * layout choice by weight, weighted draws without replacement per sheet, foil sheets, colour balancing only from five
 * draws, duplicates only where the sheet allows them, real pack order, weights beyond 32 bits, determinism.
 */
import { describe, expect, it } from 'vitest';
import { ByteStream } from '../../../src/core/rng';
import { canonicalJson } from '../../../src/core/hash';
import { chooseLayout, drawFromSheet, generatePack, uniformBelow } from '../../../src/data/packs';
import type { BoosterLayout, BoosterSheet, PackRandom, SetCardInfo, SetData } from '../../../src/data/types';

function card(uuid: string, rarity: string, colors: string[] = [], types: string[] = ['Creature']): [string, SetCardInfo] {
  return [uuid, { scryfallId: `sid-${uuid}`, name: `Card ${uuid}`, rarity, colors, types, number: uuid }];
}

function sheet(cards: Record<string, number>, extra: Partial<BoosterSheet> = {}): BoosterSheet {
  return { cards, totalWeight: Object.values(cards).reduce((a, b) => a + b, 0), foil: false, ...extra };
}

function setOf(cards: [string, SetCardInfo][], sheets: Record<string, BoosterSheet>, boosters: BoosterLayout[]): SetData {
  return {
    code: 'TST',
    name: 'Test Set',
    releaseDate: '2020-01-01',
    boosterType: 'draft',
    booster: { boosters, boostersTotalWeight: boosters.reduce((a, b) => a + b.weight, 0), sheets },
    cards: Object.fromEntries(cards),
  };
}

/** A random source that records every range asked for. */
function recording(seed: string): PackRandom & { ranges: number[] } {
  const s = new ByteStream(seed);
  const ranges: number[] = [];
  return {
    ranges,
    below(n: number): number {
      ranges.push(n);
      return s.below(n);
    },
  };
}

describe('uniformBelow', () => {
  it('handles ranges above 2^32 without asking the stream for more than 2^32', () => {
    const r = recording('big');
    const n = 2_363_014_680_000; // M21's foil sheet total weight
    for (let i = 0; i < 2000; i++) {
      const x = uniformBelow(r, n);
      expect(Number.isSafeInteger(x) && x >= 0 && x < n).toBe(true);
    }
    expect(Math.max(...r.ranges)).toBeLessThanOrEqual(0x100000000);
  });

  it('is unbiased across the high part of a range above 2^32', () => {
    const r = new ByteStream('bias');
    const n = 3 * 0x100000000 - 7; // high part 0..2, the top block shortened
    const buckets = [0, 0, 0];
    const N = 30_000;
    for (let i = 0; i < N; i++) buckets[Math.floor(uniformBelow(r, n) / 0x100000000)]! += 1;
    for (const b of buckets) expect(Math.abs(b / N - 1 / 3)).toBeLessThan(0.015);
  });

  it('rejects ranges that are not positive safe integers', () => {
    const r = new ByteStream('x');
    expect(() => uniformBelow(r, 0)).toThrow(RangeError);
    expect(() => uniformBelow(r, 1.5)).toThrow(RangeError);
    expect(() => uniformBelow(r, 2 ** 60)).toThrow(RangeError);
  });
});

describe('layout choice by weight (Pack generation 1)', () => {
  it('chooses each layout with probability weight / total', () => {
    const cards = [card('a', 'common'), card('b', 'common')];
    const set = setOf(cards, { s: sheet({ a: 1, b: 1 }) }, [
      { contents: { s: 1 }, weight: 1 },
      { contents: { s: 2 }, weight: 3 },
    ]);
    const r = new ByteStream('layouts');
    let second = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) if (chooseLayout(set.booster, r) === set.booster.boosters[1]) second += 1;
    expect(Math.abs(second / N - 0.75)).toBeLessThan(0.015);
  });

  it('never chooses a layout of weight zero', () => {
    const set = setOf([card('a', 'common')], { s: sheet({ a: 1 }) }, [
      { contents: { s: 1 }, weight: 0 },
      { contents: { s: 1 }, weight: 5 },
    ]);
    const r = new ByteStream('zero');
    for (let i = 0; i < 500; i++) expect(chooseLayout(set.booster, r)).toBe(set.booster.boosters[1]);
  });
});

describe('weighted draws without replacement (Pack generation 2)', () => {
  it('never repeats a card on a sheet, even when one card carries almost all the weight', () => {
    const cards = [card('a', 'common'), card('b', 'common'), card('c', 'common')];
    const set = setOf(cards, { s: sheet({ a: 1, b: 1, c: 1000 }) }, [{ contents: { s: 3 }, weight: 1 }]);
    const r = new ByteStream('heavy');
    for (let i = 0; i < 300; i++) {
      const uuids = generatePack(set, r).cards.map((c) => c.uuid);
      expect(new Set(uuids).size).toBe(3);
    }
  });

  it('draws the first card proportional to weight and the second from the remaining weight', () => {
    // Weights 6:3:1. P(first = a) = 0.6; P(second = a | first = b) = 6/7.
    const cards = [card('a', 'common'), card('b', 'common'), card('c', 'common')];
    const set = setOf(cards, { s: sheet({ a: 6, b: 3, c: 1 }) }, [{ contents: { s: 2 }, weight: 1 }]);
    const r = new ByteStream('cond');
    let firstA = 0;
    let firstB = 0;
    let aAfterB = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const [x, y] = drawFromSheet(set, set.booster.sheets.s!, 2, r);
      if (x === 'a') firstA += 1;
      if (x === 'b') {
        firstB += 1;
        if (y === 'a') aAfterB += 1;
      }
    }
    expect(Math.abs(firstA / N - 0.6)).toBeLessThan(0.01);
    expect(Math.abs(aAfterB / firstB - 6 / 7)).toBeLessThan(0.015);
  });

  it('repeats cards on a sheet that allows duplicates', () => {
    const set = setOf([card('a', 'common')], { s: sheet({ a: 1 }, { allowDuplicates: true }) }, [{ contents: { s: 3 }, weight: 1 }]);
    const pack = generatePack(set, new ByteStream('dup'));
    expect(pack.cards.map((c) => c.uuid)).toEqual(['a', 'a', 'a']);
  });

  it('does not repeat a non-foil card drawn from another sheet of the same pack', () => {
    const cards = [card('a', 'common'), card('b', 'common')];
    const set = setOf(cards, { one: sheet({ a: 1 }), two: sheet({ a: 1000, b: 1 }) }, [{ contents: { one: 1, two: 1 }, weight: 1 }]);
    const r = new ByteStream('cross');
    for (let i = 0; i < 100; i++) expect(generatePack(set, r).cards.map((c) => c.uuid).sort()).toEqual(['a', 'b']);
  });

  it('yields a fixed sheet as listed, the same in every pack', () => {
    const cards = [card('a', 'common'), card('b', 'common'), card('c', 'common')];
    const set = setOf(cards, { s: sheet({ c: 1, a: 2 }, { fixed: true }) }, [{ contents: { s: 3 }, weight: 1 }]);
    const r = new ByteStream('fixed');
    const first = generatePack(set, r).cards.map((c) => c.uuid);
    expect(first.sort()).toEqual(['a', 'a', 'c']);
    for (let i = 0; i < 20; i++) expect(generatePack(set, r).cards.map((c) => c.uuid).sort()).toEqual(first);
  });

  it('uses the injected random source only, so a given stream reproduces the pack', () => {
    const cards = Array.from({ length: 40 }, (_, i) => card(`c${String(i).padStart(2, '0')}`, 'common', [['W', 'U', 'B', 'R', 'G'][i % 5]!]));
    const weights = Object.fromEntries(cards.map(([u], i) => [u, 1 + (i % 3)]));
    const set = setOf(cards, { s: sheet(weights, { balanceColors: true }) }, [{ contents: { s: 10 }, weight: 1 }]);
    const a = Array.from({ length: 30 }, (() => {
      const r = new ByteStream('same');
      return () => generatePack(set, r);
    })());
    const b = Array.from({ length: 30 }, (() => {
      const r = new ByteStream('same');
      return () => generatePack(set, r);
    })());
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('does not depend on the key order of the set data', () => {
    const cards = Array.from({ length: 20 }, (_, i) => card(`u${i}`, i < 2 ? 'rare' : 'common', [['W', 'U', 'B', 'R', 'G'][i % 5]!]));
    const w = Object.fromEntries(cards.map(([u], i) => [u, 1 + (i % 4)]));
    const reversed = Object.fromEntries(Object.entries(w).reverse());
    const a = setOf(cards, { c: sheet(w, { balanceColors: true }), r: sheet({ u0: 1, u1: 2 }) }, [{ contents: { c: 6, r: 1 }, weight: 1 }]);
    const b = setOf([...cards].reverse(), { r: sheet({ u1: 2, u0: 1 }), c: sheet(reversed, { balanceColors: true }) }, [{ contents: { r: 1, c: 6 }, weight: 1 }]);
    const ra = new ByteStream('order');
    const rb = new ByteStream('order');
    for (let i = 0; i < 50; i++) expect(canonicalJson(generatePack(b, rb))).toBe(canonicalJson(generatePack(a, ra)));
  });
});

describe('foil sheets', () => {
  it('marks every card of a foil sheet foil and only those', () => {
    const cards = [card('a', 'common'), card('b', 'rare')];
    const set = setOf(cards, { c: sheet({ a: 1 }), f: sheet({ a: 1, b: 1 }, { foil: true }) }, [{ contents: { c: 1, f: 1 }, weight: 1 }]);
    const r = new ByteStream('foil');
    for (let i = 0; i < 50; i++) {
      const pack = generatePack(set, r);
      for (const c of pack.cards) expect(c.ref.foil === true).toBe(c.sheet === 'f');
      expect(pack.cards.find((c) => c.sheet === 'c')!.ref).toEqual({ sid: 'sid-a' });
    }
  });

  it('lets a foil repeat a non-foil card of the same pack, as real packs do', () => {
    const set = setOf([card('a', 'common')], { c: sheet({ a: 1 }), f: sheet({ a: 1 }, { foil: true }) }, [{ contents: { c: 1, f: 1 }, weight: 1 }]);
    const pack = generatePack(set, new ByteStream('foil-dup'));
    expect(pack.cards.map((c) => c.ref)).toEqual([{ sid: 'sid-a' }, { sid: 'sid-a', foil: true }]);
  });
});

describe('colour balancing (Pack generation 3)', () => {
  // Five mono-coloured cards of tiny weight among heavy colourless and multicoloured ones.
  const colours = ['W', 'U', 'B', 'R', 'G'];
  const cards = [
    ...colours.map((c) => card(`m${c}`, 'common', [c])),
    ...Array.from({ length: 30 }, (_, i) => card(`x${i}`, 'common', i % 2 ? [] : ['W', 'U'])),
  ];
  const weights = Object.fromEntries(cards.map(([u]) => [u, u.startsWith('m') ? 1 : 1000]));

  it('draws one mono-coloured card of each colour first when five or more come from a balanced sheet', () => {
    const set = setOf(cards, { s: sheet(weights, { balanceColors: true }) }, [{ contents: { s: 5 }, weight: 1 }]);
    const r = new ByteStream('balance');
    for (let i = 0; i < 100; i++) expect(generatePack(set, r).cards.map((c) => c.uuid).sort()).toEqual(['mB', 'mG', 'mR', 'mU', 'mW']);
  });

  it('fills the rest of a balanced draw from the whole sheet without repeats', () => {
    const set = setOf(cards, { s: sheet(weights, { balanceColors: true }) }, [{ contents: { s: 10 }, weight: 1 }]);
    const r = new ByteStream('fill');
    for (let i = 0; i < 100; i++) {
      const uuids = generatePack(set, r).cards.map((c) => c.uuid);
      expect(uuids).toHaveLength(10);
      expect(new Set(uuids).size).toBe(10);
      for (const c of colours) expect(uuids).toContain(`m${c}`);
    }
  });

  it('does not balance fewer than five draws', () => {
    const set = setOf(cards, { s: sheet(weights, { balanceColors: true }) }, [{ contents: { s: 4 }, weight: 1 }]);
    const r = new ByteStream('four');
    let mono = 0;
    for (let i = 0; i < 200; i++) mono += generatePack(set, r).cards.filter((c) => c.uuid.startsWith('m')).length;
    expect(mono).toBeLessThan(5);
  });

  it('does not balance a sheet without the flag', () => {
    const set = setOf(cards, { s: sheet(weights) }, [{ contents: { s: 5 }, weight: 1 }]);
    const r = new ByteStream('flagless');
    let mono = 0;
    for (let i = 0; i < 200; i++) mono += generatePack(set, r).cards.filter((c) => c.uuid.startsWith('m')).length;
    expect(mono).toBeLessThan(5);
  });

  it('skips a colour the sheet has no mono-coloured card of and still fills the count', () => {
    const noGreen = cards.filter(([u]) => u !== 'mG');
    const w = Object.fromEntries(noGreen.map(([u]) => [u, u.startsWith('m') ? 1 : 1000]));
    const set = setOf(noGreen, { s: sheet(w, { balanceColors: true }) }, [{ contents: { s: 6 }, weight: 1 }]);
    const uuids = generatePack(set, new ByteStream('green')).cards.map((c) => c.uuid);
    expect(uuids).toHaveLength(6);
    for (const c of ['W', 'U', 'B', 'R']) expect(uuids).toContain(`m${c}`);
  });
});

describe('pack order (Pack generation 4)', () => {
  it('puts rare or mythic first, then uncommons, commons, the foil, the land', () => {
    const cards = [
      card('land', 'common', [], ['Land']),
      card('c1', 'common', ['W']),
      card('c2', 'common', ['U']),
      card('u1', 'uncommon', ['B']),
      card('r1', 'mythic', ['R']),
      card('f1', 'rare', ['G']),
    ];
    const set = setOf(
      cards,
      {
        // Sheet names sort so the draw order is the reverse of the pack order.
        a_land: sheet({ land: 1 }),
        b_common: sheet({ c1: 1, c2: 1 }),
        c_foil: sheet({ f1: 1 }, { foil: true }),
        d_unc: sheet({ u1: 1 }),
        e_rare: sheet({ r1: 1 }),
      },
      [{ contents: { a_land: 1, b_common: 2, c_foil: 1, d_unc: 1, e_rare: 1 }, weight: 1 }],
    );
    const pack = generatePack(set, new ByteStream('order'));
    expect(pack.cards.map((c) => c.uuid.replace(/\d$/, ''))).toEqual(['r', 'u', 'c', 'c', 'f', 'land']);
    expect(pack.set).toBe('TST');
    expect(pack.cards[0]!.rarity).toBe('mythic');
  });

  it('keeps a rare land with the rares, not in the land slot', () => {
    const cards = [card('dual', 'rare', [], ['Land']), card('c', 'common', ['W']), card('basic', 'common', [], ['Land'])];
    const set = setOf(cards, { r: sheet({ dual: 1 }), c: sheet({ c: 1 }), l: sheet({ basic: 1 }) }, [{ contents: { r: 1, c: 1, l: 1 }, weight: 1 }]);
    expect(generatePack(set, new ByteStream('dual')).cards.map((c) => c.uuid)).toEqual(['dual', 'c', 'basic']);
  });
});

describe('malformed set data', () => {
  it('reports a layout naming a missing sheet', () => {
    const set = setOf([card('a', 'common')], { s: sheet({ a: 1 }) }, [{ contents: { nope: 1 }, weight: 1 }]);
    expect(() => generatePack(set, new ByteStream('x'))).toThrow(/missing sheet/);
  });

  it('reports a configuration without any weighted layout', () => {
    const set = setOf([card('a', 'common')], { s: sheet({ a: 1 }) }, []);
    expect(() => generatePack(set, new ByteStream('x'))).toThrow(/no layout/);
  });
});
