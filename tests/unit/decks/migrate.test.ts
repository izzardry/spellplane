/**
 * Migration of older deck records and library files (decks.md D23, section 7 "Migration"; PLAN M8-P3 unit acceptance).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSealedImport, exportLibrary, importLibrary, migrateDeckRecord, UNSEALED_NOTE } from '../../../src/store/decks';
import { isFreeBasic } from '../../../src/data/deck/analyse';
import { sealIntact } from '../../../src/data/deck/seal';
import type { DeckRecord } from '../../../src/store/types';
import { customDeck, lookup, ref, times } from './fixture-decks';

const FILE = readFileSync(join(fileURLToPath(new URL('../../fixtures/decks', import.meta.url)), 'library-v1.json'), 'utf8');
const freeBasic = (r: { sid: string }): boolean => isFreeBasic(lookup(r));

describe('migrateDeckRecord', () => {
  it('a version 1 library file with a pasted deck and a drafted pool imports as one custom and one sealed deck', () => {
    const { decks, errors } = importLibrary(FILE);
    expect(errors).toEqual([]);
    expect(decks.map((d) => d.kind)).toEqual(['custom', 'sealed']);
    const [pasted, drafted] = decks as [DeckRecord, DeckRecord];
    expect(pasted.size).toBe(60);
    expect(drafted.size).toBe(40);
    expect(drafted.seal?.via).toBe('draft');
    expect(drafted.seal?.sets).toEqual(['M19', 'M19', 'M19']);
    expect(drafted.seal?.draft).toEqual({ format: 'pass' });
    // The pool is the non-basic cards of the old pool; the dispensed Island and Mountain are free basics in main.
    expect(drafted.seal?.pool).toHaveLength(18);
    expect(drafted.seal?.revealed).toBe(3);
    expect(sealIntact(drafted, freeBasic)).toBe(true);
    // pool and origin stay for the M2 builder.
    expect(drafted.pool).toBeDefined();
    expect(drafted.origin).toBeDefined();
  });

  it('is idempotent', () => {
    for (const d of (JSON.parse(FILE) as { decks: DeckRecord[] }).decks) {
      const once = migrateDeckRecord(d);
      expect(migrateDeckRecord(once)).toEqual(once);
      expect(migrateDeckRecord(once)).toBe(once);
    }
  });

  it('sizes custom decks: 100 with a commander, 40 up to 45 cards, else 60', () => {
    const bare = (main: number, extra: Partial<DeckRecord> = {}): DeckRecord => {
      const d = customDeck(times(main, ref('Shock')), extra);
      delete d.kind;
      delete d.size;
      return d;
    };
    expect(migrateDeckRecord(bare(45)).size).toBe(40);
    expect(migrateDeckRecord(bare(46)).size).toBe(60);
    expect(migrateDeckRecord(bare(10, { commander: [ref('Shock')] })).size).toBe(100);
  });

  it('exporting then importing again is stable', () => {
    const first = importLibrary(FILE).decks;
    const again = importLibrary(exportLibrary(first, 5)).decks;
    expect(again).toEqual(first);
  });

  it('a version 2 sealed deck holding a foreign card becomes custom with the note', () => {
    const [, drafted] = importLibrary(FILE).decks as [DeckRecord, DeckRecord];
    const tampered: DeckRecord = { ...drafted, main: [...drafted.main, ref('Colossal Dreadmaw')] };
    // The M2 pool would no longer match the lists: a hand-edited file drops it.
    delete tampered.pool;
    delete tampered.origin;
    const file = exportLibrary([tampered], 1);
    const read = importLibrary(file).decks[0]!;
    expect(read.kind).toBe('sealed');
    const checked = checkSealedImport(read, freeBasic, 7);
    expect(checked.unsealed).toBe(true);
    expect(checked.record.kind).toBe('custom');
    expect(checked.record.seal).toBeUndefined();
    expect(checked.record.convertedFrom?.id).toBe(drafted.id);
    expect(UNSEALED_NOTE).toMatch(/custom deck now/);
    // An intact one stays sealed.
    expect(checkSealedImport(drafted, freeBasic, 7).unsealed).toBe(false);
  });

  it('rejects a sealed deck without a seal and invalid M8 fields', () => {
    const bad = exportLibrary([{ ...customDeck([]), kind: 'sealed' }, { ...customDeck([], { id: 'x2' }), size: 50 as 40 }], 1);
    const r = importLibrary(bad);
    expect(r.decks).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
});
