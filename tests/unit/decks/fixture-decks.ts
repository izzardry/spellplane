/**
 * Fixture decks for the M8 deck model tests (M8-P3): the two M19 decklists resolved against the M19 fixture cards, a
 * lookup, and a pool opened from the recorded M19 booster data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardRef } from '../../../src/core/types';
import { parseDecklist } from '../../../src/data/decklist';
import type { CardData, SetData } from '../../../src/data/types';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import type { DeckRecord } from '../../../src/store/types';
import { fixtureDecklist, loadFixtureSet } from '../data/fakeScryfall';

export const CARDS: CardData[] = [...loadFixtureSet('m19.json'), ...loadFixtureSet('m20.json'), ...loadFixtureSet('m21.json')];
const byId = new Map(CARDS.map((c) => [c.id, c] as const));
export const source = new FixtureCardDataSource(CARDS);

export const lookup = (ref: CardRef): CardData | null => byId.get(ref.sid) ?? null;

export function named(name: string, set = 'm19'): CardData {
  const c = CARDS.find((x) => x.name === name && x.set === set);
  if (!c) throw new Error(`no fixture card ${name} in ${set}`);
  return c;
}

export const ref = (name: string, set = 'm19'): CardRef => ({ sid: named(name, set).id });

export async function decklist(file: string): Promise<{ main: CardRef[]; side: CardRef[] }> {
  const parsed = parseDecklist(fixtureDecklist(file));
  const r = await source.resolveDeck(parsed.list);
  return { main: r.main, side: r.side };
}

export function times(n: number, r: CardRef): CardRef[] {
  return Array.from({ length: n }, () => ({ ...r }));
}

export function customDeck(main: CardRef[], extra: Partial<DeckRecord> = {}): DeckRecord {
  return { id: 'c1', name: 'Custom', main, side: [], source: 'built', createdAt: 1, updatedAt: 2, kind: 'custom', size: 60, ...extra };
}

const MTGJSON = fileURLToPath(new URL('../../fixtures/mtgjson', import.meta.url));

/** Recorded MTGJSON booster data of a set as data/types.ts SetData (draft boosters). */
export function setData(code: string): SetData {
  const raw = JSON.parse(readFileSync(join(MTGJSON, `${code}.json`), 'utf8')) as { data: { code: string; name: string; releaseDate: string; booster: Record<string, SetData['booster']>; cards: SetData['cards'] } };
  const d = raw.data;
  return { code: d.code, name: d.name, releaseDate: d.releaseDate, boosterType: 'draft', booster: d.booster.draft!, cards: d.cards };
}
