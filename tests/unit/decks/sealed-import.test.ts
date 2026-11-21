/**
 * A booster deck made by FROM BOOSTERS keeps its seal through a backup and a library file (decks.md D25 and section 7:
 * a file keeps a sealed deck sealed if its cards fit its pool; free basics are allowed). The page has no card data in
 * memory, so the import loads the data of the main cards outside the pool first (freeBasicTest); a deck that really
 * holds a foreign card still becomes custom, and the backup reports it.
 */
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../../src/data/types';
import { fixtureSetSource } from '../../../src/debug/fixture-sets';
import { readBackup, readBackupText } from '../../../src/store/backup';
import { exportLibrary, importLibrary, sealedOutsideSids, UNSEALED_NOTE } from '../../../src/store/decks';
import { BACKUP_FILE_FORMAT, BACKUP_FILE_VERSION, type DeckRecord, type DeckStore } from '../../../src/store/types';
import { quickBoosterDeck } from '../../../src/ui/decks/state/quick';
import { freeBasicTest } from '../../../src/ui/decks/state/sealed-import';
import { CARDS, lookup, setData, source } from './fixture-decks';

async function boosterDeck(): Promise<DeckRecord> {
  const map = new Map<string, DeckRecord>();
  const decks: DeckStore = {
    list: () => Promise.resolve([...map.values()]),
    get: (id) => Promise.resolve(map.get(id) ?? null),
    put: (d) => (map.set(d.id, JSON.parse(JSON.stringify(d)) as DeckRecord), Promise.resolve()),
    delete: (id) => (map.delete(id), Promise.resolve()),
  };
  let n = 0;
  const id = await quickBoosterDeck({ decks, sets: fixtureSetSource([setData('M19')]), cardData: source, newId: () => `deck-${++n}`, now: () => Date.UTC(2026, 10, 20, 12), seed: () => '5eed'.repeat(16) });
  return map.get(id)!;
}

/** A page's card source with nothing in memory: peek knows no card, getMany loads them (and records what it was asked). */
function coldSource() {
  const asked: string[][] = [];
  return {
    asked,
    peek: () => null,
    load: async (sids: string[]): Promise<Record<string, CardData>> => {
      asked.push(sids);
      return Object.fromEntries(sids.map((s) => [s, lookup({ sid: s })]).filter((e): e is [string, CardData] => e[1] !== null));
    },
  };
}

const backupOf = (decks: DeckRecord[]) => ({ format: BACKUP_FILE_FORMAT, version: BACKUP_FILE_VERSION, exportedAt: 1, decks, tables: [] });

describe('a FROM BOOSTERS deck through a file (decks.md D25)', () => {
  it('holds main cards outside its pool (the suggestion basics), which sealedOutsideSids lists once each', async () => {
    const deck = await boosterDeck();
    expect(deck.kind).toBe('sealed');
    expect(deck.main).toHaveLength(40);
    const outside = sealedOutsideSids(backupOf([deck]));
    expect(outside.length).toBeGreaterThan(0);
    expect(new Set(outside).size).toBe(outside.length);
    expect(outside.every((sid) => lookup({ sid })?.type_line.includes('Basic Land'))).toBe(true);
    expect(sealedOutsideSids(JSON.parse(exportLibrary([deck], 1)))).toEqual(outside);
    expect(sealedOutsideSids(deck)).toEqual(outside);
    expect(sealedOutsideSids(null)).toEqual([]);
  });

  it('stays sealed through a backup when the card data is loaded first', async () => {
    const deck = await boosterDeck();
    const text = JSON.stringify(backupOf([deck]));
    const cold = coldSource();
    const read = readBackupText(text, { isFreeBasic: await freeBasicTest(text, cold.load, cold.peek) });
    expect(cold.asked).toEqual([sealedOutsideSids(backupOf([deck]))]);
    expect(read.errors).toEqual([]);
    expect(read.decks[0]!.kind).toBe('sealed');
    expect(read.decks[0]!.seal).toEqual(deck.seal);
    expect(read.decks[0]!.convertedFrom).toBeUndefined();
    // The deck-only library file read as a backup keeps it too.
    const lib = exportLibrary([deck], 1);
    expect(readBackupText(lib, { isFreeBasic: await freeBasicTest(lib, cold.load, cold.peek) }).decks[0]!.kind).toBe('sealed');
  });

  it('stays sealed through a library file when the card data is loaded first', async () => {
    const deck = await boosterDeck();
    const text = exportLibrary([deck], 1);
    const cold = coldSource();
    const read = importLibrary(text, { isFreeBasic: await freeBasicTest(text, cold.load, cold.peek) });
    expect(read.decks[0]!.kind).toBe('sealed');
    expect(read.notes).toBeUndefined();
  });

  it('a deck holding a foreign card still becomes custom, and the backup reports it', async () => {
    const deck = await boosterDeck();
    const foreign = CARDS.find((c) => c.set === 'm20' && !c.type_line.includes('Basic'))!;
    const tampered: DeckRecord = { ...deck, main: [...deck.main, { sid: foreign.id }] };
    const text = JSON.stringify(backupOf([tampered]));
    const cold = coldSource();
    const read = readBackup(JSON.parse(text), { isFreeBasic: await freeBasicTest(text, cold.load, cold.peek) });
    expect(read.decks[0]!.kind).toBe('custom');
    expect(read.errors).toEqual([{ where: 'deck 1', message: `“${deck.name}”: ${UNSEALED_NOTE}` }]);
  });

  it('a failed load counts the cards as foreign: the check is never skipped', async () => {
    const deck = await boosterDeck();
    const text = JSON.stringify(backupOf([deck]));
    const test = await freeBasicTest(text, () => Promise.reject(new Error('offline')), () => null);
    expect(readBackupText(text, { isFreeBasic: test }).decks[0]!.kind).toBe('custom');
  });
});
