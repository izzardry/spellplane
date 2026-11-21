/**
 * M8-P4 fix: USE A STARTER DECK in the waiting room makes M8-P6's green starter over the table's card source, as a
 * custom library record (the room saves and selects it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../../src/data/types';
import { roomStarter, roomStarterPool } from '../../../src/ui/lobby/starter';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
const M19 = JSON.parse(readFileSync(join(FIXTURES, 'scryfall', 'm19.json'), 'utf8')) as CardData[];

describe('the waiting room starter deck', () => {
  it('is a 40-card green custom deck from the card source, named and dated', async () => {
    const queries: string[] = [];
    const pool = roomStarterPool({ searchCards: (q: string) => (queries.push(q), Promise.resolve(M19)) });
    const deck = await roomStarter(pool, () => 1_700_000_000_000)();
    expect(queries.length).toBe(1);
    expect(deck).toMatchObject({ id: `starter-${(1_700_000_000_000).toString(36)}`, name: 'Starter · Green', kind: 'custom', source: 'built', size: 40 });
    expect(deck.main).toHaveLength(40);
  });
  it('rejects without a card search (the room then offers PASTE A LIST)', async () => {
    await expect(roomStarter(roomStarterPool({}))()).rejects.toThrow();
  });
});
