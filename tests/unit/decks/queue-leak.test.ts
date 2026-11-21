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

/** What the scan finds in what would leave the browser for `deck`: its id, name, card ids, card names, oracle ids, colour words, extra fields. */
function leaks(deck: DeckRecord, info: object): string[] {
  const found: string[] = [];
  const keys = Object.keys(info).sort();
  if (keys.join() !== 'band,cards,kind,size,strength,v') found.push(`fields ${keys.join(', ')}`);
  const bytes = JSON.stringify(info);
  const secrets = [deck.id, deck.name, ...[...deck.main, ...deck.side, ...(deck.seal?.pool ?? [])].flatMap((r) => [r.sid, lookup(r)?.name ?? '', lookup(r)?.oracle_id ?? ''])].filter((s) => s.length > 0);
  for (const s of new Set(secrets)) if (bytes.includes(s)) found.push(`${s} leaked`);
  for (const w of COLOUR_WORDS) if (bytes.toLowerCase().includes(w.toLowerCase())) found.push(`colour ${w} leaked`);
  return found;
}

describe('queue deck info leak (M8-P3)', () => {
  it('queueDeckInfo holds six facts and no card id, name or colour', async () => {
    const decks = await fixtureDecks();
    let checked = 0;
    for (const deck of decks) {
      const info = queueDeckInfo(deck);
      if (!info) continue;
      checked++;
      expect(leaks(deck, info)).toEqual([]);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('the scan reports an injected leak: the cover card, the deck name, a colour', async () => {
    const [deck] = await fixtureDecks();
    const info = queueDeckInfo(deck!)!;
    const cover = deck!.summary!.cover!;
    expect(leaks(deck!, { ...info, cover })).toEqual(expect.arrayContaining(['fields band, cards, cover, kind, size, strength, v', `${cover.sid} leaked`]));
    expect(leaks(deck!, { ...info, kind: deck!.name })).toEqual([`${deck!.name} leaked`]);
    expect(leaks(deck!, { ...info, band: 'green' })).toEqual(['colour green leaked']);
  });
});
