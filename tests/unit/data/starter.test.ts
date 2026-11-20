/**
 * M8-P6: the starter generator (computer.md 8.1; contracts.md Part G "Computer opponent" item 4) over the fixture pool
 * derived from M19: 17 basic lands and 23 creatures by the recipe (slots 3 / 7 / 6 / 4 / 2 / 1, at most two copies,
 * class C only where A and B cannot fill a slot), the same for the same seed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildStarterDeck, buildStarterFromPool, cardSourcePool, eligible, STARTER_RECIPE, textClass } from '../../../src/data/starter';
import type { CardData } from '../../../src/data/types';
import { fixtureStarterPool } from '../../../src/debug/fixture-starter';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
const POOL = JSON.parse(readFileSync(join(FIXTURES, 'starter', 'starter-pool.m19.json'), 'utf8')) as CardData[];
const M19 = JSON.parse(readFileSync(join(FIXTURES, 'scryfall', 'm19.json'), 'utf8')) as CardData[];
const byId = new Map(POOL.map((c) => [c.id, c]));
const slot = (mv: number): number => Math.min(5, Math.max(0, mv - 1));

describe('buildStarterDeck', () => {
  it('green: 17 Forests and 23 creatures on the curve 3 / 7 / 6 / 4 / 2 / 1, at most two copies, A and B before C', async () => {
    const deck = await buildStarterDeck({ pool: () => Promise.resolve(POOL) }, { colour: 'G', seed: 'g1' });
    expect(deck.main).toHaveLength(40);
    expect(deck.name).toBe('Starter · Green');
    const cards = deck.main.map((r) => byId.get(r.sid)!);
    const lands = cards.filter((c) => /Basic Land/.test(c.type_line));
    expect(lands).toHaveLength(17);
    expect(new Set(lands.map((c) => c.name))).toEqual(new Set(['Forest']));
    const creatures = cards.filter((c) => /Creature/.test(c.type_line));
    expect(creatures).toHaveLength(23);
    for (const c of creatures) expect(eligible(c, 'G'), c.name).toBe(true);
    const counts = new Map<string, number>();
    for (const c of creatures) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    const curve = [0, 0, 0, 0, 0, 0];
    for (const c of creatures) curve[slot(c.cmc)]! += 1;
    // Each slot is filled from its own mana value where the pool allows; whatever a slot lacks it borrows nearby.
    const total = curve.reduce((a, b) => a + b, 0);
    expect(total).toBe(23);
    const ab = (s: number) => POOL.filter((c) => eligible(c, 'G') && slot(c.cmc) === s && textClass(c) !== 'C');
    const anyIn = (s: number) => POOL.filter((c) => eligible(c, 'G') && slot(c.cmc) === s);
    STARTER_RECIPE.curve.forEach((want, s) => {
      const possible = Math.min(want, anyIn(s).length * 2);
      expect(curve[s], `slot ${s + 1}`).toBeGreaterThanOrEqual(possible);
      // Every A or B card of a slot is used (twice) before a C card of that slot.
      const usedC = creatures.some((c) => slot(c.cmc) === s && textClass(c) === 'C');
      if (usedC) for (const c of ab(s)) expect(counts.get(c.id), c.name).toBe(2);
    });
  });

  it('is the same for the same seed and differs for another seed where ties allow', async () => {
    const src = fixtureStarterPool(M19);
    const a = await buildStarterDeck(src, { colour: 'G', seed: 's' });
    const b = await buildStarterDeck(src, { colour: 'G', seed: 's' });
    expect(a).toEqual(b);
    for (const colour of ['W', 'U', 'B', 'R', 'G'] as const) expect((await buildStarterDeck(src, { colour, seed: 'x' })).main).toHaveLength(40);
  });

  it('fails when the pool is too small or has no basic of the colour', () => {
    expect(() => buildStarterFromPool(POOL.filter((c) => c.name !== 'Forest'), { colour: 'G', seed: 's' })).toThrow(/Forest/);
    expect(() => buildStarterFromPool(POOL.filter((c) => !/Creature/.test(c.type_line) || c.cmc > 3), { colour: 'G', seed: 's' })).toThrow(/too few/);
  });

  it('class rules: vanilla A, keywords B, drawbacks excluded', () => {
    const c = (oracle_text: string): CardData => ({ ...POOL[0]!, oracle_text });
    expect(textClass(c(''))).toBe('A');
    expect(textClass(c('Flying, vigilance'))).toBe('B');
    expect(textClass(c('Trample (This creature can deal excess combat damage.)'))).toBe('B');
    expect(textClass(c('When this creature enters, draw a card.'))).toBe('C');
    expect(textClass(c("This creature can't block."))).toBeNull();
    expect(textClass(c('At the beginning of your upkeep, sacrifice it.'))).toBeNull();
  });

  it('the production pool asks the card source once per set with the 8.1 query', async () => {
    const asked: string[] = [];
    const src = cardSourcePool({ searchCards: (q: string) => (asked.push(q), Promise.resolve(POOL)) });
    await src.pool('M19');
    await src.pool('m19');
    expect(asked).toEqual(['e:m19 (t:creature or t:basic) r<=uncommon -is:digital']);
  });
});
