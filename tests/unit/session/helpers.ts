/** Shared setup for the solo session tests: fixture card data, the 60-card fixture deck, sessions over fake-indexeddb. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, stateHash } from '../../../src/core/hash';
import type { TableState } from '../../../src/core/types';
import { parseDecklist } from '../../../src/data/decklist';
import type { CardData } from '../../../src/data/types';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import { mtg } from '../../../src/games/index';
import { createSoloSession, type DeckImport, type SoloSession } from '../../../src/session/index';
import { openStores, type LocalStores } from '../../../src/store/stores';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export function fixtureCards(): CardData[] {
  return ['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(readFileSync(join(FIXTURES, 'scryfall', f), 'utf8')) as CardData[]);
}

export const cardSource = new FixtureCardDataSource(fixtureCards());

/** The 60-card fixture deck A (tests/fixtures/decklists/gw-m19-60.txt), resolved against the fixtures. */
export async function deckA(): Promise<DeckImport> {
  const text = readFileSync(join(FIXTURES, 'decklists', 'gw-m19-60.txt'), 'utf8');
  const parsed = parseDecklist(text);
  const resolved = await cardSource.resolveDeck(parsed.list);
  if (parsed.errors.length || resolved.errors.length) throw new Error('fixture deck A does not resolve');
  return { main: resolved.main, side: resolved.side };
}

let dbCounter = 0;
export function uniqueDbName(label: string): string {
  dbCounter += 1;
  return `session-${label}-${dbCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

const openedStores: LocalStores[] = [];
export async function stores(name = uniqueDbName('t')): Promise<LocalStores> {
  const s = await openStores(name);
  openedStores.push(s);
  return s;
}
export function closeStores(): void {
  for (const s of openedStores.splice(0)) s.close();
}

export function session(store?: LocalStores): Promise<SoloSession> {
  return createSoloSession({ game: mtg, cardData: cardSource, ...(store ? { store: store.tables } : {}) });
}

/** A session with deck A imported. */
export async function withDeck(store?: LocalStores): Promise<SoloSession> {
  const s = await session(store);
  await s.importDeck(await deckA());
  return s;
}

/** State hash with `seq` set aside: what undo restores (core/undo.ts undoKey; the undo itself is a new sequenced action). */
export function hashNoSeq(state: TableState): Promise<string> {
  return stateHash({ ...state, seq: 0 });
}

export function json(v: unknown): string {
  return canonicalJson(v);
}
