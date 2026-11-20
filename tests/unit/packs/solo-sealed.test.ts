/** Boosters opened alone (decks.md D11, section 6; PLAN M8-P3 unit acceptance). */
import { describe, expect, it } from 'vitest';
import { BoosterError, openBoosters, seedHex, setsForPacks, validatePack } from '../../../src/draft/solo-sealed';
import { setData } from '../decks/fixture-decks';

const DATA = { M19: setData('M19'), M20: setData('M20') };
const SIX = ['M19', 'M19', 'M19', 'M19', 'M19', 'M19'];

describe('openBoosters', () => {
  it('the same seed and sets give the same pool; another seed gives another', () => {
    const a = openBoosters(SIX, DATA, 'a'.repeat(64));
    expect(openBoosters(SIX, DATA, 'a'.repeat(64)).pool).toEqual(a.pool);
    expect(openBoosters(SIX, DATA, 'b'.repeat(64)).pool).not.toEqual(a.pool);
  });

  it('6 M19 packs give 90 refs, each pack with exactly one rare or mythic', () => {
    const { packs, pool } = openBoosters(SIX, DATA, '0123'.repeat(16));
    expect(pool).toHaveLength(90);
    expect(packs).toHaveLength(6);
    for (const p of packs) expect(p.cards.filter((c) => c.rarity === 'rare' || c.rarity === 'mythic')).toHaveLength(1);
  });

  it('mixed sets keep the pack order', () => {
    const { packs } = openBoosters(['M19', 'M19', 'M20'], DATA, 'c'.repeat(64));
    expect(packs.map((p) => p.set)).toEqual(['M19', 'M19', 'M20']);
  });

  it('pack i draws from <seed>:<i> alone', () => {
    const three = openBoosters(['M19', 'M19', 'M19'], DATA, 'd'.repeat(64)).packs;
    const two = openBoosters(['M19', 'M19'], DATA, 'd'.repeat(64)).packs;
    expect(two).toEqual(three.slice(0, 2));
  });

  it('a pack with a card lacking a Scryfall id fails validation; a missing set throws', () => {
    const { packs } = openBoosters(['M19'], DATA, 'e'.repeat(64));
    const bad = { ...packs[0]!, cards: packs[0]!.cards.map((c, i) => (i === 0 ? { ...c, ref: { sid: '' } } : c)) };
    expect(validatePack(packs[0]!)).toBe(true);
    expect(validatePack(bad)).toBe(false);
    expect(() => openBoosters(['XYZ'], DATA, 'e'.repeat(64))).toThrow(BoosterError);
  });

  it('a shorter set list repeats its last entry; seeds are 64 hex characters', () => {
    expect(setsForPacks(['M19', 'M20'], 4)).toEqual(['M19', 'M20', 'M20', 'M20']);
    expect(seedHex(new Uint8Array(32).fill(255))).toBe('f'.repeat(64));
  });
});
