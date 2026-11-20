/** "Suggest a deck" (decks.md section 4, D18; PLAN M8-P3 unit acceptance): 40 cards in at most two colours, deterministic. */
import { describe, expect, it } from 'vitest';
import { autobuild } from '../../../src/data/deck/autobuild';
import { analyse, isLandCard } from '../../../src/data/deck/analyse';
import { openBoosters } from '../../../src/draft/solo-sealed';
import { lookup, ref, setData } from './fixture-decks';

const BASICS = { Plains: ref('Plains'), Island: ref('Island'), Swamp: ref('Swamp'), Mountain: ref('Mountain'), Forest: ref('Forest') };

describe('autobuild', () => {
  const { pool } = openBoosters(['M19', 'M19', 'M19', 'M19', 'M19', 'M19'], { M19: setData('M19') }, 'f'.repeat(64));

  it('returns the same 40 cards in at most two colours twice', () => {
    const a = autobuild(pool, lookup, BASICS);
    const b = autobuild([...pool], lookup, BASICS);
    expect(a.main).toHaveLength(40);
    expect(b.main).toEqual(a.main);
    expect(a.colours.length).toBeGreaterThanOrEqual(1);
    expect(a.colours.length).toBeLessThanOrEqual(2);
    for (const r of a.main) {
      const c = lookup(r)!;
      expect(c.color_identity.every((x) => (a.colours as string[]).includes(x))).toBe(true);
    }
    expect(a.spells).toBe(23);
    expect(a.main.filter((r) => isLandCard(lookup(r)!)).length).toBe(17);
    expect(analyse(a.main, lookup).colours.length).toBeLessThanOrEqual(2);
  });

  it('takes spells only from the pool', () => {
    const a = autobuild(pool, lookup, BASICS);
    const left = new Map<string, number>();
    for (const r of pool) left.set(r.sid, (left.get(r.sid) ?? 0) + 1);
    for (const r of a.main) {
      if (isLandCard(lookup(r)!)) continue;
      expect(left.get(r.sid) ?? 0).toBeGreaterThan(0);
      left.set(r.sid, left.get(r.sid)! - 1);
    }
  });
});
