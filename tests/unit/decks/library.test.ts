/**
 * M2-P6 acceptance (PLAN "M2-P5 and P6": export then import reproduces the deck) and the deck library around it
 * (DESIGN "Pre-game: draft, sealed and deck building", Local deck library: "Decks and drafted pools are saved in the
 * browser, reusable across evenings, and exportable and importable as files").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import type { DeckBuild } from '../../../src/core/types';
import { buildFromDeckRecord, buildLists, deckRecordFromBuild, exportFileName, exportLibrary, importLibrary, LIBRARY_LIMITS, planImport } from '../../../src/store/decks';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { LIBRARY_FILE_FORMAT, LIBRARY_FILE_VERSION, type DeckRecord, type LibraryFile } from '../../../src/store/types';
import { uniqueDbName } from '../store/helpers';
import { sid, tableBuild } from './helpers';

const open: LocalStores[] = [];
async function stores(): Promise<LocalStores> {
  const s = await openStores(uniqueDbName('decks'));
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

const T0 = 1_790_000_000_000;

function pasted(id: string, at = T0): DeckRecord {
  return {
    id,
    name: 'Gruul aggro',
    main: [{ sid: sid('Llanowar Elves') }, { sid: sid('Llanowar Elves') }, { sid: sid('Shock'), foil: true }],
    side: [{ sid: sid('Cancel') }],
    source: 'pasted',
    text: '2 Llanowar Elves\n1 Shock\n\nSideboard\n1 Cancel',
    createdAt: at,
    updatedAt: at,
  };
}

function drafted(id = 'pool-1'): DeckRecord {
  return deckRecordFromBuild(tableBuild(), { id, name: 'M19 draft', now: T0 + 5, createdAt: T0, origin: { format: 'pass', sets: ['M19', 'M19', 'M19'] } });
}

const file = (decks: unknown[], extra: Partial<LibraryFile> = {}): string => JSON.stringify({ format: LIBRARY_FILE_FORMAT, version: LIBRARY_FILE_VERSION, exportedAt: T0, decks, ...extra });

describe('export then import reproduces the deck (PLAN M2-P6 acceptance)', () => {
  it('a saved drafted pool comes back identical: deck, sideboard, pool, table positions, basics, foils, origin', () => {
    const build = tableBuild();
    const record = drafted();
    const text = exportLibrary([record], T0 + 10);
    const back = importLibrary(text);
    expect(back.errors).toEqual([]);
    expect(back.decks).toEqual([record]);
    expect(canonicalJson(buildFromDeckRecord(back.decks[0]!))).toBe(canonicalJson(build));
  });

  it('a pasted deck without a pool round-trips with its text, and opens with its deck and sideboard', () => {
    const record = pasted('d1');
    const back = importLibrary(exportLibrary([record], T0));
    expect(back).toEqual({ decks: [record], errors: [] });
    const build = buildFromDeckRecord(back.decks[0]!);
    expect(buildLists(build)).toEqual({ main: record.main, side: record.side });
    expect(new Set(build.cards.map((c) => c.id)).size).toBe(4);
  });

  it('through IndexedDB: export from one browser profile, import into another, the stored record is the same', async () => {
    const a = await stores();
    const b = await stores();
    const records = [drafted('x1'), pasted('x2', T0 + 1)];
    for (const r of records) await a.decks.put(r);
    const text = exportLibrary(await a.decks.list(), T0 + 20);
    const result = importLibrary(text);
    expect(result.errors).toEqual([]);
    const plan = planImport(await b.decks.list(), result.decks, () => 'never');
    expect(plan).toMatchObject({ unchanged: 0, copied: 0 });
    for (const r of plan.put) await b.decks.put(r);
    expect(await b.decks.get('x1')).toEqual(records[0]);
    expect(await b.decks.get('x2')).toEqual(records[1]);
    expect(buildFromDeckRecord((await b.decks.get('x1'))!)).toEqual(tableBuild());
  });

  it('the file is the documented plain JSON format', () => {
    const parsed = JSON.parse(exportLibrary([pasted('d1')], T0 + 7)) as LibraryFile;
    expect(parsed).toEqual({ format: 'spellplane-decks', version: 1, exportedAt: T0 + 7, decks: [pasted('d1')] });
  });

  it('a single exported record (not wrapped in a library file) imports too', () => {
    expect(importLibrary(JSON.stringify(pasted('solo')))).toEqual({ decks: [pasted('solo')], errors: [] });
  });

  it('exporting does not alias the records', () => {
    const r = drafted();
    const before = canonicalJson(r);
    const back = importLibrary(exportLibrary([r], T0)).decks[0]!;
    back.pool!.main.pop();
    back.main.pop();
    expect(canonicalJson(r)).toBe(before);
  });
});

describe('records from and to the builder (DESIGN "Pre-game", Local deck library: decks and drafted pools)', () => {
  it('a record holds the deck in deck order and the rest of the pool as sideboard, in pool order', () => {
    const r = drafted();
    const forest = { sid: tableBuild().cards[11]!.ref.sid };
    expect(r.main).toEqual([
      { sid: sid('Sarkhan, Fireblood') },
      { sid: sid('Llanowar Elves') },
      forest,
      { sid: sid('Draconic Disciple') },
      { sid: sid('Shock'), foil: true },
      { sid: sid('Llanowar Elves') },
      forest,
      forest,
    ]);
    expect(r.side).toEqual(['Divination', 'Cancel', 'Meteor Golem', 'Detection Tower', 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen', 'Shock'].map((n) => ({ sid: sid(n) })));
    expect(r).toMatchObject({ source: 'drafted', origin: { format: 'pass', sets: ['M19', 'M19', 'M19'] }, createdAt: T0, updatedAt: T0 + 5 });
  });

  it('a build without an origin is saved as a built deck; the record does not share objects with the build', () => {
    const build = tableBuild();
    const r = deckRecordFromBuild(build, { id: 'b', name: 'Built', now: T0 });
    expect(r.source).toBe('built');
    expect(r.origin).toBeUndefined();
    expect(r.createdAt).toBe(T0);
    build.main.length = 0;
    build.poses!.p1!.x = 9999;
    expect(r.pool!.main).toHaveLength(8);
    expect(r.pool!.poses!.p1!.x).toBe(-300);
  });

  it('opening a record twice gives two independent builds', () => {
    const r = drafted();
    const a = buildFromDeckRecord(r);
    a.main.pop();
    expect(buildFromDeckRecord(r).main).toHaveLength(8);
  });
});

describe('import never throws and reports what it skipped', () => {
  it.each([
    ['not JSON', 'this is { not json', /not JSON/],
    ['another JSON document', JSON.stringify({ hello: 'world' }), /not a Spellplane deck file/],
    ['a JSON array', JSON.stringify([pasted('a')]), /not a Spellplane deck file/],
    ['null', 'null', /not a Spellplane deck file/],
    ['a newer version', file([pasted('a')], { version: LIBRARY_FILE_VERSION + 1 }), /newer Spellplane/],
    ['no version', JSON.stringify({ format: LIBRARY_FILE_FORMAT, decks: [] }), /version/],
    ['no deck list', JSON.stringify({ format: LIBRARY_FILE_FORMAT, version: 1, decks: {} }), /no deck list/],
  ])('%s: one file-level error (index -1), no records', (_label, text, pattern) => {
    const r = importLibrary(text);
    expect(r.decks).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(-1);
    expect(r.errors[0]!.message).toMatch(pattern);
  });

  it('an empty library file imports nothing and reports nothing', () => {
    expect(importLibrary(file([]))).toEqual({ decks: [], errors: [] });
  });

  const good = pasted('good');
  const poolOf = (mut: (p: DeckBuild) => void): unknown => {
    const r = JSON.parse(JSON.stringify(drafted('bad'))) as DeckRecord;
    mut(r.pool!);
    return r;
  };
  it.each([
    ['not an object', 42, /not a deck/],
    ['no id', { ...good, id: '' }, /id is missing/],
    ['an unknown source', { ...good, source: 'stolen' }, /source/],
    ['a card without an id', { ...good, main: [{ foil: true }] }, /card id is missing/],
    ['a foil flag that is not a boolean', { ...good, side: [{ sid: 'x', foil: 'yes' }] }, /foil flag/],
    ['a deck that is not a list', { ...good, main: 'Llanowar Elves' }, /not a list of cards/],
    ['a time that is not a number', { ...good, updatedAt: 'yesterday' }, /not a time/],
    ['a negative time', { ...good, createdAt: -1 }, /not a time/],
    ['decklist text that is not text', { ...good, text: 7 }, /not text/],
    ['a pool deck naming a card the pool lacks', poolOf((p) => p.main.push('ghost')), /does not hold/],
    ['a pool deck naming a card twice', poolOf((p) => p.main.push(p.main[0]!)), /twice/],
    ['two pool cards with one id', poolOf((p) => (p.cards[1]!.id = p.cards[0]!.id)), /two cards with id/],
    ['a position that is not a number', poolOf((p) => (p.poses!.p1 = { x: 'left', y: 0, rot: 0 } as never)), /position/],
    ['a pool that disagrees with the deck', poolOf((p) => p.main.pop()), /same cards/],
    ['an unknown draft format', { ...drafted('o'), origin: { format: 'cube', sets: ['M19'] } }, /draft format/],
    ['set codes that are not codes', { ...drafted('o'), origin: { format: 'pass', sets: ['../../etc'] } }, /set codes/],
    ['too many cards', { ...good, main: Array.from({ length: LIBRARY_LIMITS.cards + 1 }, () => ({ sid: 'x' })) }, /more than/],
  ])('an entry with %s is skipped with its index; the valid entries still import', (_label, bad, pattern) => {
    const r = importLibrary(file([good, bad, pasted('also-good')]));
    expect(r.decks.map((d) => d.id)).toEqual(['good', 'also-good']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(1);
    expect(r.errors[0]!.message).toMatch(pattern);
    expect(r.errors[0]!.message).toMatch(/^Deck 2/);
  });

  it('a second record with the same id in one file is skipped', () => {
    const r = importLibrary(file([pasted('same'), { ...pasted('same'), name: 'Other' }]));
    expect(r.decks).toEqual([pasted('same')]);
    expect(r.errors).toEqual([{ index: 1, message: expect.stringMatching(/same id/) as unknown as string }]);
  });

  it('unknown fields are dropped, a blank name gets a default, positions of cards not in the pool are dropped', () => {
    const r = JSON.parse(JSON.stringify(drafted('d'))) as DeckRecord & { extra?: string };
    r.extra = 'x';
    r.name = '   ';
    (r.main[0] as unknown as Record<string, unknown>).price = 3;
    r.pool!.poses!.ghost = { x: 1, y: 2, rot: 0 };
    const back = importLibrary(file([r])).decks[0]!;
    expect(back).not.toHaveProperty('extra');
    expect(back.name).toBe('Untitled deck');
    expect(back.main[0]).toEqual({ sid: sid('Sarkhan, Fireblood') });
    expect(back.pool!.poses).not.toHaveProperty('ghost');
  });

  it('a foil flag of false is read as not foil', () => {
    const back = importLibrary(file([{ ...pasted('f'), side: [{ sid: 'abc', foil: false }] }])).decks[0]!;
    expect(back.side).toEqual([{ sid: 'abc' }]);
  });

  it('too many records is a file-level error', () => {
    const r = importLibrary(file(Array.from({ length: LIBRARY_LIMITS.decks + 1 }, (_, i) => pasted(`d${i}`))));
    expect(r.decks).toEqual([]);
    expect(r.errors[0]).toMatchObject({ index: -1 });
  });
});

describe('importing into a library that already has decks (planImport)', () => {
  let n = 0;
  const ids = () => `new-${++n}`;

  it('new records are written, equal ones are left alone, a different deck under a taken id is added as a copy', () => {
    const existing = [pasted('a'), drafted('b')];
    const changed = { ...drafted('b'), name: 'Renamed elsewhere', updatedAt: T0 + 99 };
    const plan = planImport(existing, [pasted('a'), changed, pasted('c')], ids);
    expect(plan.unchanged).toBe(1);
    expect(plan.copied).toBe(1);
    expect(plan.put.map((r) => r.id)).toEqual([expect.stringMatching(/^new-/), 'c']);
    expect(plan.put[0]).toEqual({ ...changed, id: plan.put[0]!.id });
  });

  it('never reuses an id that is taken, including one a copy just took', () => {
    const fixed = ['taken', 'taken', 'fresh-1', 'fresh-1', 'fresh-2'];
    const plan = planImport([pasted('taken')], [{ ...pasted('taken'), name: 'A' }, { ...pasted('taken'), name: 'B' }], () => fixed.shift()!);
    expect(plan.put.map((r) => r.id)).toEqual(['fresh-1', 'fresh-2']);
  });

  it('importing the same file twice adds nothing the second time', async () => {
    const s = await stores();
    const text = exportLibrary([drafted('p'), pasted('q')], T0);
    for (let i = 0; i < 2; i++) {
      const plan = planImport(await s.decks.list(), importLibrary(text).decks, ids);
      for (const r of plan.put) await s.decks.put(r);
    }
    expect((await s.decks.list()).map((r) => r.id).sort()).toEqual(['p', 'q']);
  });
});

describe('export file names', () => {
  it('one deck is named after the deck, several after the date', () => {
    expect(exportFileName([{ ...pasted('a'), name: 'Gruul Smash! (v2)' }], T0)).toBe('gruul-smash-v2.spellplane.json');
    expect(exportFileName([{ ...pasted('a'), name: 'Ünïcödé' }], T0)).toBe('unicode.spellplane.json');
    expect(exportFileName([{ ...pasted('a'), name: '!!!' }], T0)).toBe('deck.spellplane.json');
    expect(exportFileName([pasted('a'), pasted('b')], Date.UTC(2026, 10, 11, 23))).toBe('spellplane-decks-2026-11-11.json');
  });
});
