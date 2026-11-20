/**
 * Migration of older deck records and library files (decks.md D23, section 7 "Migration"; PLAN M8-P3 unit acceptance).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardRef } from '../../../src/core/types';
import { add } from '../../../src/data/deck/edit';
import { checkSealedImport, deckRecordFromBuild, exportLibrary, importLibrary, migrateDeckRecord, settleEdited, UNSEALED_NOTE } from '../../../src/store/decks';
import { isFreeBasic } from '../../../src/data/deck/analyse';
import { sealIntact } from '../../../src/data/deck/seal';
import type { DeckRecord } from '../../../src/store/types';
import { DeckEditor } from '../../../src/ui/decks/state/editor';
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
    const again = importLibrary(exportLibrary(first, 5), { isFreeBasic: freeBasic }).decks;
    expect(again).toEqual(first);
  });

  it('a version 2 sealed deck holding a foreign card becomes custom with the note', () => {
    const [, drafted] = importLibrary(FILE).decks as [DeckRecord, DeckRecord];
    const tampered: DeckRecord = { ...drafted, main: [...drafted.main, ref('Colossal Dreadmaw')] };
    // The M2 pool would no longer match the lists: a hand-edited file drops it.
    delete tampered.pool;
    delete tampered.origin;
    const file = exportLibrary([tampered], 1);
    const read = importLibrary(file, { isFreeBasic: freeBasic, now: 7 });
    expect(read.errors).toEqual([]);
    const deck = read.decks[0]!;
    expect(deck.kind).toBe('custom');
    expect(deck.seal).toBeUndefined();
    expect(deck.convertedFrom).toEqual({ id: drafted.id, name: drafted.name, at: 7, via: 'draft', sets: drafted.seal!.sets });
    expect(read.notes).toEqual([{ index: 0, message: `“${drafted.name}”: ${UNSEALED_NOTE}` }]);
    expect(UNSEALED_NOTE).toMatch(/custom deck now/);
    // Without card data the check is strict, never skipped.
    expect(importLibrary(file).decks[0]!.kind).toBe('custom');
    // An intact one stays sealed, with its free basics known from card data, and carries no note.
    const intact = importLibrary(exportLibrary([drafted], 1), { isFreeBasic: freeBasic });
    expect(intact.decks[0]!.kind).toBe('sealed');
    expect(intact.notes).toBeUndefined();
    expect(checkSealedImport(drafted, freeBasic, 7).unsealed).toBe(false);
  });

  it('a version 1 drafted deck keeps its seal without card data: its own pool flags the dispensed basics', () => {
    const r = importLibrary(FILE);
    expect(r.decks.map((d) => d.kind)).toEqual(['custom', 'sealed']);
    expect(r.notes).toBeUndefined();
  });

  it('rejects a sealed deck without a seal and invalid M8 fields', () => {
    const bad = exportLibrary([{ ...customDeck([]), kind: 'sealed' }, { ...customDeck([], { id: 'x2' }), size: 50 as 40 }], 1);
    const r = importLibrary(bad);
    expect(r.decks).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
});

describe('a pre-M8 record edited in Deck mode exports and imports again (decks.md section 7)', () => {
  async function editAndSave(start: DeckRecord, card: CardRef): Promise<DeckRecord> {
    const saved: DeckRecord[] = [];
    const editor = new DeckEditor(start, { store: { put: async (d) => void saved.push(JSON.parse(JSON.stringify(d)) as DeckRecord) }, lookup, now: () => 99, setTimer: () => 0, clearTimer: () => undefined });
    const r = editor.apply((d) => add(d, card, 'main', 1, lookup(card)));
    expect(r.ok).toBe(true);
    await editor.flush();
    return saved.at(-1)!;
  }

  it('a drafted record: one pool card moved to main, saved, exported and imported again', async () => {
    const drafted = importLibrary(FILE).decks.find((d) => d.kind === 'sealed')!;
    expect(drafted.pool).toBeDefined();
    const stored = await editAndSave(drafted, drafted.side[0]!);
    // The stale M2 pool is dropped at the save; the seal holds the pool now.
    expect(stored.pool).toBeUndefined();
    const back = importLibrary(exportLibrary([stored], 100), { isFreeBasic: freeBasic });
    expect(back.errors).toEqual([]);
    expect(back.decks).toHaveLength(1);
    expect(back.decks[0]!.kind).toBe('sealed');
    expect(back.decks[0]!.main).toEqual(stored.main);
  });

  it('a built record (custom after migration) loses pool and origin at its first save', async () => {
    const old = deckRecordFromBuild({ cards: [{ id: 'a', ref: ref('Shock') }, { id: 'b', ref: ref('Cancel') }], main: ['a'] }, { id: 'm2', name: 'Built in M2', now: 5 });
    const migrated = migrateDeckRecord(old);
    expect(migrated.kind).toBe('custom');
    const stored = await editAndSave(migrated, ref('Llanowar Elves'));
    expect(stored.pool).toBeUndefined();
    expect(stored.origin).toBeUndefined();
    const back = importLibrary(exportLibrary([stored], 100));
    expect(back.errors).toEqual([]);
    expect(back.decks).toHaveLength(1);
  });

  it('a version 2 record that already carries a stale pool imports with the pool dropped, not skipped', () => {
    const drafted = importLibrary(FILE).decks.find((d) => d.kind === 'sealed')!;
    const moved = add(drafted, drafted.side[0]!, 'main', 1, lookup(drafted.side[0]!));
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.deck.pool).toBeDefined();
    const back = importLibrary(exportLibrary([moved.deck], 100), { isFreeBasic: freeBasic });
    expect(back.errors).toEqual([]);
    expect(back.decks[0]!.pool).toBeUndefined();
    expect(back.decks[0]!.kind).toBe('sealed');
  });

  it('settleEdited keeps a sealed record\'s pool while it still matches', () => {
    const drafted = importLibrary(FILE).decks.find((d) => d.kind === 'sealed')!;
    const settled = settleEdited(drafted);
    expect(settled.origin).toEqual(drafted.origin);
    expect(settleEdited(customDeck([ref('Shock')]))).toEqual(customDeck([ref('Shock')]));
  });
});
