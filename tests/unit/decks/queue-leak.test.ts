/**
 * Leak test (contracts.md Part A; decks.md section 7 "What may leave the browser"): `queueDeckInfo` holds exactly six
 * facts (kind, size, cards, score, band, version) and no card id, card name, deck name or colour. Owner: M8-P3.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { queueDeckInfo } from '../../../src/data/deck/queue';
import { summarise } from '../../../src/data/deck/summary';
import { importLibrary } from '../../../src/store/decks';
import type { DeckRecord } from '../../../src/store/types';
import { customDeck, decklist, lookup } from './fixture-decks';

const LIBRARY = readFileSync(join(fileURLToPath(new URL('../../fixtures/decks', import.meta.url)), 'library-v1.json'), 'utf8');
const COLOUR_WORDS = ['white', 'blue', 'black', 'red', 'green', '"W"', '"U"', '"B"', '"R"', '"G"', '"C"'];

async function fixtureDecks(): Promise<DeckRecord[]> {
  const gw = customDeck((await decklist('gw-m19-60.txt')).main, { id: 'gw', name: 'Selesnya Elves Secret' });
  const ur = customDeck((await decklist('ur-m19-60.mtga.txt')).main, { id: 'ur', name: 'Izzet Tempo Secret' });
  return [gw, ur, ...importLibrary(LIBRARY).decks].map((d) => ({ ...d, summary: summarise(d, lookup) }));
}

describe('queue deck info leak (M8-P3)', () => {
  it('queueDeckInfo holds six facts and no card id, name or colour', async () => {
    const decks = await fixtureDecks();
    let checked = 0;
    for (const deck of decks) {
      const info = queueDeckInfo(deck);
      if (!info) continue;
      checked++;
      expect(Object.keys(info).sort()).toEqual(['band', 'cards', 'kind', 'size', 'strength', 'v']);
      const bytes = JSON.stringify(info);
      const secrets = [deck.id, deck.name, ...[...deck.main, ...deck.side, ...(deck.seal?.pool ?? [])].flatMap((r) => [r.sid, lookup(r)?.name ?? '', lookup(r)?.oracle_id ?? ''])].filter((s) => s.length > 0);
      for (const s of secrets) expect(bytes.includes(s), `${s} leaked`).toBe(false);
      for (const w of COLOUR_WORDS) expect(bytes.toLowerCase().includes(w.toLowerCase()), `colour ${w} leaked`).toBe(false);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('fails when a leak is injected (the scan sees a name)', async () => {
    const [deck] = await fixtureDecks();
    const leaky = JSON.stringify({ ...queueDeckInfo(deck!), cover: deck!.summary!.cover });
    expect(leaky.includes(deck!.summary!.cover!.sid)).toBe(true);
  });
});
