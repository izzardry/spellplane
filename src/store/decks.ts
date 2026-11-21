/**
 * Local deck library (DESIGN "Pre-game: draft, sealed and deck building", Local deck library; "Specification:
 * network protocol and secrecy", Local persistence: name, card refs, sideboard, source, timestamps).
 * Implementers: M0-P5 (the store), M2-P6 (library files, records from and to the builder's DeckBuild).
 *
 * Everything below the store is pure: no clock, randomness or DOM; callers pass `now` and id factories.
 */
import type { IDBPDatabase } from 'idb';
import { canonicalJson } from '../core/hash';
import type { CardRef, DeckBuild, DraftFormat, PoolCard, Pose } from '../core/types';
import { LIBRARY_FILE_FORMAT, LIBRARY_FILE_VERSION, type DeckRecord, type DeckSeal, type DeckSize, type DeckStore, type LibraryFile, type LibraryImport, type SpellplaneDB } from './types';

/** The DeckStore on an open database (store/types.ts DeckStore). `list()` returns the most recently updated first. */
export function createDeckStore(db: IDBPDatabase<SpellplaneDB>): DeckStore {
  return {
    async list(): Promise<DeckRecord[]> {
      const ascending = await db.getAllFromIndex('decks', 'updatedAt');
      return ascending.reverse().map(migrateDeckRecord);
    },
    async get(id: string): Promise<DeckRecord | null> {
      const d = await db.get('decks', id);
      return d ? migrateDeckRecord(d) : null;
    },
    async put(deck: DeckRecord): Promise<void> {
      if (!deck.id) throw new TypeError('deck needs an id');
      await db.put('decks', deck);
    },
    async delete(id: string): Promise<void> {
      await db.delete('decks', id);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Migration (decks.md section 7, "Migration"; M8-P3)
// ---------------------------------------------------------------------------------------------------------------------

const refKeyOf = (r: CardRef): string => (r.foil ? `${r.sid}*` : r.sid);

/** Pool cards not in `main`, in pool order (the sideboard of a sealed deck; data/deck/seal.ts poolRemaining). */
function remainingOf(pool: readonly CardRef[], main: readonly CardRef[]): CardRef[] {
  const inMain = new Map<string, number>();
  for (const r of main) inMain.set(refKeyOf(r), (inMain.get(refKeyOf(r)) ?? 0) + 1);
  const out: CardRef[] = [];
  for (const r of pool) {
    const n = inMain.get(refKeyOf(r)) ?? 0;
    if (n > 0) inMain.set(refKeyOf(r), n - 1);
    else out.push(refOf(r));
  }
  return out;
}

/**
 * An older record in M8's shape (decks.md section 7, "Migration"; contracts.md Part G "Decks"): a record with a draft
 * `origin` becomes sealed (`via: 'draft'`, the non-basic cards of its pool, every pack shown, `side` recomputed); every
 * other record becomes custom, sized 100 with a commander, 40 up to 45 main cards, else 60. A record that already has a
 * `kind` is returned as it is, so the migration is idempotent. `pool` and `origin` are kept for the M2 builder.
 */
export function migrateDeckRecord(record: DeckRecord): DeckRecord {
  if (record.kind) return record;
  if (record.origin) {
    const pool: CardRef[] = record.pool ? record.pool.cards.filter((c) => c.basic !== true).map((c) => refOf(c.ref)) : [...record.main, ...record.side].map(refOf);
    const seal: DeckSeal = { via: 'draft', sets: [...record.origin.sets], pool, draft: { format: record.origin.format }, sealedAt: record.createdAt, revealed: record.origin.sets.length };
    return { ...record, kind: 'sealed', size: 40, seal, side: remainingOf(pool, record.main) };
  }
  const size: DeckSize = (record.commander?.length ?? 0) > 0 ? 100 : record.main.length <= 45 ? 40 : 60;
  return { ...record, kind: 'custom', size };
}

/**
 * A record as an edit saves it (decks.md section 7, "The record's invariants"): a custom deck drops the M2 builder's
 * `pool` and `origin` ("removed at the first save after migration"); a sealed deck keeps them for the M2 builder only
 * while the pool still holds the same cards as its deck and sideboard, else the stale `pool` is dropped (the seal holds
 * the pool now, and the builder opens the record from its lists). A record without `kind` is returned as it is.
 */
export function settleEdited(record: DeckRecord): DeckRecord {
  if (!record.kind || (record.pool === undefined && record.origin === undefined)) return record;
  const out: DeckRecord = { ...record };
  if (out.kind === 'custom') {
    delete out.pool;
    delete out.origin;
  } else if (out.pool && !poolMatches(out.pool, out.main, out.side)) {
    delete out.pool;
  }
  return out;
}

function poolMatches(pool: DeckBuild, main: readonly CardRef[], side: readonly CardRef[]): boolean {
  const lists = buildLists(pool);
  return sameRefs(lists.main, main) && sameRefs(lists.side, side);
}

/** A new random deck id. */
export function newDeckId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------------------------------
// Records and builds (DESIGN "Pre-game", Deck building: the builder's DeckBuild; Local deck library: decks and pools)
// ---------------------------------------------------------------------------------------------------------------------

/** Limits on what a library file may hold, so a malformed or hostile file cannot fill the browser's storage. */
export const LIBRARY_LIMITS = {
  /** Records per file. */
  decks: 2000,
  /** Card refs per list (main, side, pool cards). */
  cards: 5000,
  /** Characters of a name or id. */
  name: 200,
  /** Characters of a pasted decklist kept for re-import. */
  text: 200_000,
} as const;

const DRAFT_FORMATS: readonly DraftFormat[] = ['pass', 'sealed', 'rochester', 'winston', 'grid', 'teamDraft', 'teamSealed'];
const SOURCES: readonly DeckRecord['source'][] = ['pasted', 'built', 'drafted'];

/** A deep copy of plain JSON. */
function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function refOf(ref: CardRef): CardRef {
  return ref.foil ? { sid: ref.sid, foil: true } : { sid: ref.sid };
}

/** The deck (`main`, in deck order) and the rest of the pool (`side`, in pool order) of a build, as card refs. */
export function buildLists(build: DeckBuild): { main: CardRef[]; side: CardRef[] } {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const inMain = new Set(build.main);
  const main: CardRef[] = [];
  for (const id of build.main) {
    const c = byId.get(id);
    if (c) main.push(refOf(c.ref));
  }
  const side = build.cards.filter((c) => !inMain.has(c.id)).map((c) => refOf(c.ref));
  return { main, side };
}

export interface RecordFromBuildOptions {
  id: string;
  name: string;
  now: number;
  /** When the record already exists: its creation time is kept. */
  createdAt?: number;
  /** Where a drafted or sealed pool came from (DeckRecord.origin); makes the record a 'drafted' one. */
  origin?: DeckRecord['origin'];
}

/**
 * A build in the form a library file holds it (see importLibrary): one card per id (the first wins), refs and basic
 * flags in canonical form, the deck without unknown or repeated ids, and positions only of cards in the pool, each
 * with just x, y and rot. Saving stores this form, so a saved record, its export and its import agree.
 */
export function normaliseBuild(build: DeckBuild): DeckBuild {
  const ids = new Set<string>();
  const cards: PoolCard[] = [];
  for (const c of build.cards) {
    if (ids.has(c.id)) continue;
    ids.add(c.id);
    const card: PoolCard = { id: c.id, ref: refOf(c.ref) };
    if (c.basic === true) card.basic = true;
    cards.push(card);
  }
  const inMain = new Set<string>();
  const main: string[] = [];
  for (const id of build.main) {
    if (!ids.has(id) || inMain.has(id)) continue;
    inMain.add(id);
    main.push(id);
  }
  const out: DeckBuild = { cards, main };
  if (build.poses) {
    const poses: Record<string, Pose> = {};
    for (const [id, p] of Object.entries(build.poses)) if (ids.has(id)) poses[id] = { x: p.x, y: p.y, rot: p.rot };
    out.poses = poses;
  }
  return out;
}

/**
 * A library record of the builder's state (DESIGN "Pre-game", Local deck library: "Decks and drafted pools are saved
 * in the browser"): `main` is the deck, `side` the rest of the pool, and `pool` the whole build (with the table view's
 * positions, normalised by normaliseBuild) so it opens again exactly as it was.
 */
export function deckRecordFromBuild(input: DeckBuild, opts: RecordFromBuildOptions): DeckRecord {
  const build = normaliseBuild(input);
  const { main, side } = buildLists(build);
  const record: DeckRecord = {
    id: opts.id,
    name: opts.name,
    main,
    side,
    source: opts.origin ? 'drafted' : 'built',
    createdAt: opts.createdAt ?? opts.now,
    updatedAt: opts.now,
    pool: build,
  };
  if (opts.origin) record.origin = cloneJson(opts.origin);
  return record;
}

/**
 * The builder state a library record opens as: its saved `pool` when it has one, else a pool of its deck and
 * sideboard cards (ids `d1`, `d2`, …) with the deck cards in `main`.
 */
export function buildFromDeckRecord(record: DeckRecord): DeckBuild {
  if (record.pool) return cloneJson(record.pool);
  const cards: PoolCard[] = [];
  const main: string[] = [];
  for (const ref of record.main) {
    const id = `d${cards.length + 1}`;
    cards.push({ id, ref: refOf(ref) });
    main.push(id);
  }
  for (const ref of record.side) cards.push({ id: `d${cards.length + 1}`, ref: refOf(ref) });
  return { cards, main };
}

// ---------------------------------------------------------------------------------------------------------------------
// Library files (DESIGN "Pre-game", Local deck library: "exportable and importable as files")
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Serialise library records as a LibraryFile (DESIGN "Pre-game", Local deck library: exportable as files). Plain JSON,
 * indented for people who open it; `importLibrary` reads it back to equal records.
 */
export function exportLibrary(decks: readonly DeckRecord[], now: number): string {
  const file: LibraryFile = { format: LIBRARY_FILE_FORMAT, version: LIBRARY_FILE_VERSION, exportedAt: now, decks: decks.map((d) => cloneJson(d)) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A file name for an export: the deck's name for one deck, else `spellplane-decks-<date>` (UTC date of `now`). */
export function exportFileName(decks: readonly DeckRecord[], now: number): string {
  if (decks.length === 1) {
    const slug = decks[0]!.name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return `${slug || 'deck'}.spellplane.json`;
  }
  return `spellplane-decks-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** Thrown inside the validators with the reason an entry is skipped. */
class Invalid extends Error {}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, what: string, max: number = LIBRARY_LIMITS.name): string {
  if (typeof v !== 'string' || v.length === 0) throw new Invalid(`${what} is missing`);
  if (v.length > max) throw new Invalid(`${what} is longer than ${max} characters`);
  return v;
}

function time(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Invalid(`${what} is not a time`);
  return v;
}

function cardRef(v: unknown, what: string): CardRef {
  if (!isObj(v)) throw new Invalid(`${what} is not a card`);
  const sid = str(v.sid, `${what}'s card id`, 64);
  if (v.foil !== undefined && v.foil !== true && v.foil !== false) throw new Invalid(`${what}'s foil flag is not true or false`);
  return v.foil === true ? { sid, foil: true } : { sid };
}

function refList(v: unknown, what: string): CardRef[] {
  if (!Array.isArray(v)) throw new Invalid(`${what} is not a list of cards`);
  if (v.length > LIBRARY_LIMITS.cards) throw new Invalid(`${what} has more than ${LIBRARY_LIMITS.cards} cards`);
  return v.map((r, i) => cardRef(r, `${what} card ${i + 1}`));
}

function pose(v: unknown, what: string): Pose {
  if (!isObj(v)) throw new Invalid(`${what} is not a position`);
  const n = (k: 'x' | 'y' | 'rot'): number => {
    const x = v[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Invalid(`${what} has no ${k}`);
    return x;
  };
  return { x: n('x'), y: n('y'), rot: n('rot') };
}

function deckBuild(v: unknown): DeckBuild {
  if (!isObj(v)) throw new Invalid('the pool is not a pool');
  if (!Array.isArray(v.cards)) throw new Invalid('the pool has no cards');
  if (v.cards.length > LIBRARY_LIMITS.cards) throw new Invalid(`the pool has more than ${LIBRARY_LIMITS.cards} cards`);
  const ids = new Set<string>();
  const cards: PoolCard[] = v.cards.map((c: unknown, i: number) => {
    const what = `pool card ${i + 1}`;
    if (!isObj(c)) throw new Invalid(`${what} is not a card`);
    const id = str(c.id, `${what}'s id`, 64);
    if (ids.has(id)) throw new Invalid(`the pool has two cards with id ${id}`);
    ids.add(id);
    if (c.basic !== undefined && c.basic !== true && c.basic !== false) throw new Invalid(`${what}'s basic flag is not true or false`);
    const card: PoolCard = { id, ref: cardRef(c.ref, what) };
    if (c.basic === true) card.basic = true;
    return card;
  });
  if (!Array.isArray(v.main)) throw new Invalid('the pool has no deck list');
  const main: string[] = [];
  const inMain = new Set<string>();
  for (const id of v.main) {
    if (typeof id !== 'string' || !ids.has(id)) throw new Invalid('the pool\'s deck names a card the pool does not hold');
    if (inMain.has(id)) throw new Invalid(`the pool's deck names card ${id} twice`);
    inMain.add(id);
    main.push(id);
  }
  const build: DeckBuild = { cards, main };
  if (v.poses !== undefined) {
    if (!isObj(v.poses)) throw new Invalid('the pool\'s positions are not positions');
    const poses: Record<string, Pose> = {};
    for (const [id, p] of Object.entries(v.poses)) {
      // Positions of cards that are not in the pool are dropped, not an error.
      if (ids.has(id)) poses[id] = pose(p, `the position of ${id}`);
    }
    build.poses = poses;
  }
  return build;
}

function sameRefs(a: readonly CardRef[], b: readonly CardRef[]): boolean {
  const key = (r: CardRef): string => `${r.sid}${r.foil ? '*' : ''}`;
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const r of a) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  for (const r of b) {
    const n = counts.get(key(r)) ?? 0;
    if (n === 0) return false;
    counts.set(key(r), n - 1);
  }
  return true;
}

/** One record of a library file, checked and copied field by field (unknown fields are dropped). */
function deckRecord(v: unknown): DeckRecord {
  if (!isObj(v)) throw new Invalid('not a deck');
  const id = str(v.id, 'the id');
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, LIBRARY_LIMITS.name) : 'Untitled deck';
  if (typeof v.source !== 'string' || !(SOURCES as readonly string[]).includes(v.source)) throw new Invalid('the source is not pasted, built or drafted');
  const record: DeckRecord = {
    id,
    name,
    main: refList(v.main, 'the deck'),
    side: refList(v.side, 'the sideboard'),
    source: v.source as DeckRecord['source'],
    createdAt: time(v.createdAt, 'the creation date'),
    updatedAt: time(v.updatedAt, 'the change date'),
  };
  if (v.text !== undefined) {
    if (typeof v.text !== 'string') throw new Invalid('the decklist text is not text');
    if (v.text.length > LIBRARY_LIMITS.text) throw new Invalid('the decklist text is too long');
    record.text = v.text;
  }
  if (v.pool !== undefined) {
    const pool = deckBuild(v.pool);
    // An M8 record (with `kind`) keeps the M2 pool only as a convenience for the builder: a stale one is dropped, not
    // fatal (decks.md section 7). A version 1 record still needs its pool to match, since migration reads it.
    if (poolMatches(pool, record.main, record.side)) record.pool = pool;
    else if (v.kind === undefined) throw new Invalid('the pool does not hold the same cards as the deck and sideboard');
  }
  if (v.origin !== undefined) {
    const o = v.origin;
    if (!isObj(o) || typeof o.format !== 'string' || !(DRAFT_FORMATS as readonly string[]).includes(o.format)) throw new Invalid('the draft format is unknown');
    if (!Array.isArray(o.sets) || o.sets.length > 64 || !o.sets.every((s) => typeof s === 'string' && /^[A-Za-z0-9]{1,16}$/.test(s))) throw new Invalid('the set codes are not set codes');
    record.origin = { format: o.format as DraftFormat, sets: [...(o.sets as string[])] };
  }
  m8Fields(v, record);
  return record;
}

const SET_CODE = /^[A-Za-z0-9]{1,16}$/;

function setCodes(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.length > 36 || !v.every((s) => typeof s === 'string' && SET_CODE.test(s))) throw new Invalid(`${what} are not set codes`);
  return [...(v as string[])];
}

/**
 * The fields M8 added (decks.md section 7, "Library files"): kind, size, seal, maybe, cover, notes, convertedFrom and
 * lastPlayedAt, checked with the existing limits. `summary` is derived and recomputed, so it is not read from a file.
 */
function m8Fields(v: Obj, record: DeckRecord): void {
  if (v.kind !== undefined) {
    if (v.kind !== 'custom' && v.kind !== 'sealed') throw new Invalid('the deck kind is not custom or sealed');
    record.kind = v.kind;
  }
  if (v.size !== undefined) {
    if (v.size !== 40 && v.size !== 60 && v.size !== 100) throw new Invalid('the deck size is not 40, 60 or 100');
    record.size = v.size;
  }
  if (v.maybe !== undefined) record.maybe = refList(v.maybe, 'the maybe-board');
  if (v.commander !== undefined) record.commander = refList(v.commander, 'the commander');
  if (v.companion !== undefined) record.companion = refList(v.companion, 'the companion');
  if (v.cover !== undefined) record.cover = cardRef(v.cover, 'the cover');
  if (v.notes !== undefined) {
    if (typeof v.notes !== 'string' || v.notes.length > 2000) throw new Invalid('the notes are longer than 2000 characters');
    record.notes = v.notes;
  }
  if (v.lastPlayedAt !== undefined) record.lastPlayedAt = time(v.lastPlayedAt, 'the last played date');
  if (v.seal !== undefined) {
    const s = v.seal;
    if (!isObj(s) || (s.via !== 'packs' && s.via !== 'draft')) throw new Invalid('the seal is not a seal');
    const sets = setCodes(s.sets, "the seal's sets");
    const revealed = s.revealed;
    if (typeof revealed !== 'number' || !Number.isInteger(revealed) || revealed < 0 || revealed > sets.length) throw new Invalid("the seal's opened packs are not a count");
    const seal: DeckSeal = { via: s.via, sets, pool: refList(s.pool, 'the seal\'s pool'), sealedAt: time(s.sealedAt, 'the seal date'), revealed };
    if (s.seed !== undefined) {
      if (typeof s.seed !== 'string' || !/^[0-9a-f]{1,128}$/.test(s.seed)) throw new Invalid("the seal's seed is not hex");
      seal.seed = s.seed;
    }
    if (s.generator !== undefined) {
      if (typeof s.generator !== 'number' || !Number.isInteger(s.generator) || s.generator < 1) throw new Invalid("the seal's generator is not a version");
      seal.generator = s.generator;
    }
    if (s.draft !== undefined) {
      const d = s.draft;
      if (!isObj(d) || typeof d.format !== 'string' || !(DRAFT_FORMATS as readonly string[]).includes(d.format)) throw new Invalid("the seal's draft format is unknown");
      seal.draft = { format: d.format as DraftFormat };
      if (typeof d.roomId === 'string' && d.roomId.length <= LIBRARY_LIMITS.name) seal.draft.roomId = d.roomId;
    }
    record.seal = seal;
  }
  if (v.convertedFrom !== undefined) {
    const c = v.convertedFrom;
    if (!isObj(c) || (c.via !== 'packs' && c.via !== 'draft')) throw new Invalid('the conversion note is not readable');
    record.convertedFrom = { id: str(c.id, 'the converted deck id'), name: str(c.name, 'the converted deck name'), at: time(c.at, 'the conversion date'), via: c.via, sets: setCodes(c.sets, 'the converted sets') };
  }
  if (record.kind === 'sealed' && !record.seal) throw new Invalid('the booster deck has no seal');
}

/** Note on a sealed record from a file that held cards from outside its boosters (decks.md section 7). */
export const UNSEALED_NOTE = 'This deck held cards from outside its boosters. It is a custom deck now.';

/**
 * A sealed record read from a file is checked (decks.md section 7, "The record's invariants"): its main deck without
 * free basics must come from its pool. One that fails becomes a custom deck with `convertedFrom`. Without
 * `isFreeBasic` (no card data) every main card outside the pool fails. The side is recomputed for one that passes.
 */
export function checkSealedImport(record: DeckRecord, isFreeBasic: (ref: CardRef) => boolean, now: number): { record: DeckRecord; unsealed: boolean } {
  const seal = record.seal;
  if (record.kind !== 'sealed' || !seal) return { record, unsealed: false };
  const left = new Map<string, number>();
  for (const r of seal.pool) left.set(refKeyOf(r), (left.get(refKeyOf(r)) ?? 0) + 1);
  let ok = (record.maybe?.length ?? 0) === 0 && (record.commander?.length ?? 0) === 0 && (record.companion?.length ?? 0) === 0;
  for (const r of record.main) {
    const n = left.get(refKeyOf(r)) ?? 0;
    if (n > 0) left.set(refKeyOf(r), n - 1);
    else if (!isFreeBasic(r)) ok = false;
  }
  if (ok) return { record: { ...record, side: remainingOf(seal.pool, record.main) }, unsealed: false };
  const out: DeckRecord = { ...record, kind: 'custom', convertedFrom: { id: record.id, name: record.name, at: now, via: seal.via, sets: [...seal.sets] } };
  delete out.seal;
  return { record: out, unsealed: true };
}

/**
 * The Scryfall ids of the main-deck cards of sealed records that no pool copy accounts for: the cards
 * checkSealedImport asks `isFreeBasic` about (decks.md section 7, invariant 4). A caller loads their card data first,
 * so a booster deck's free basics keep it sealed (D25). Reads what importLibrary and readBackup read (a LibraryFile, a
 * single record, or a backup's `decks`); entries that cannot be read give nothing. Each id is listed once.
 */
export function sealedOutsideSids(json: unknown): string[] {
  let entries: unknown[] = [];
  if (isObj(json) && Array.isArray(json.decks)) entries = json.decks;
  else if (isObj(json) && 'main' in json && 'id' in json) entries = [json];
  const out = new Set<string>();
  for (const entry of entries) {
    let record: DeckRecord;
    try {
      record = migrateDeckRecord(deckRecord(entry));
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      continue;
    }
    const seal = record.seal;
    if (record.kind !== 'sealed' || !seal) continue;
    const left = new Map<string, number>();
    for (const r of seal.pool) left.set(refKeyOf(r), (left.get(refKeyOf(r)) ?? 0) + 1);
    for (const r of record.main) {
      const n = left.get(refKeyOf(r)) ?? 0;
      if (n > 0) left.set(refKeyOf(r), n - 1);
      else out.add(r.sid);
    }
  }
  return [...out];
}

/** What importLibrary checks sealed records with (decks.md section 7, "The record's invariants"). */
export interface ImportOptions {
  /**
   * Whether a main-deck card outside a sealed deck's pool is one of the five basic lands (from card data the caller
   * loaded). Without it, or for a card it does not know, the card counts as foreign and the deck becomes custom: the
   * check is never skipped.
   */
  isFreeBasic?: (ref: CardRef) => boolean;
  /** The time stamped on `convertedFrom` of a deck that fails (default: the record's own change date). */
  now?: number;
}

/**
 * Read a LibraryFile (or a single exported deck record) back into records (DESIGN "Pre-game", Local deck library:
 * importable). Every record is checked; invalid ones are reported in `errors` with their 0-based index in the file and
 * never thrown on. Problems with the file as a whole (not JSON, another format, a newer version) are reported with
 * index -1 and no records. A record whose id appears earlier in the same file is skipped. Ids that already exist in
 * the library are kept for the caller to overwrite or rename (see planImport). Every sealed record is checked
 * (checkSealedImport with `opts.isFreeBasic`): one holding cards from outside its boosters is returned as a custom deck
 * and listed in `notes` with UNSEALED_NOTE.
 */
export function importLibrary(text: string, opts: ImportOptions = {}): LibraryImport {
  const fail = (message: string): LibraryImport => ({ decks: [], errors: [{ index: -1, message }] });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('The file is not a Spellplane deck file (it is not JSON).');
  }
  let entries: unknown[];
  if (isObj(data) && data.format === LIBRARY_FILE_FORMAT) {
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) return fail('The file has no valid version.');
    if (data.version > LIBRARY_FILE_VERSION) return fail(`The file was written by a newer Spellplane (version ${data.version}); update the app to read it.`);
    if (!Array.isArray(data.decks)) return fail('The file holds no deck list.');
    entries = data.decks;
  } else if (isObj(data) && 'main' in data && 'id' in data) {
    entries = [data];
  } else {
    return fail('The file is not a Spellplane deck file.');
  }
  if (entries.length > LIBRARY_LIMITS.decks) return fail(`The file holds more than ${LIBRARY_LIMITS.decks} decks.`);
  const decks: DeckRecord[] = [];
  const errors: LibraryImport['errors'] = [];
  const notes: NonNullable<LibraryImport['notes']> = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    try {
      const read = deckRecord(entry);
      // An M2 pool (kept only while it matches the lists, see deckRecord) flags the basics its builder dispensed: those
      // count as free basics here, so a drafted deck keeps its seal without card data.
      const dispensed = read.pool ? new Set(read.pool.cards.filter((c) => c.basic === true).map((c) => c.ref.sid)) : null;
      const free = (r: CardRef): boolean => (dispensed?.has(r.sid) ?? false) || (opts.isFreeBasic?.(r) ?? false);
      const migrated = migrateDeckRecord(read);
      if (seen.has(migrated.id)) throw new Invalid(`an earlier deck in the file has the same id`);
      seen.add(migrated.id);
      const checked = checkSealedImport(migrated, free, opts.now ?? migrated.updatedAt);
      if (checked.unsealed) notes.push({ index, message: `“${checked.record.name}”: ${UNSEALED_NOTE}` });
      decks.push(checked.record);
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      const name = isObj(entry) && typeof entry.name === 'string' && entry.name.trim() ? ` "${entry.name.trim().slice(0, 60)}"` : '';
      errors.push({ index, message: `Deck ${index + 1}${name} was skipped: ${e.message}.` });
    }
  });
  return notes.length > 0 ? { decks, errors, notes } : { decks, errors };
}

/** What importing records into a library does (see planImport). */
export interface ImportPlan {
  /** Records to write, in file order. */
  put: DeckRecord[];
  /** Records already in the library unchanged (nothing to write). */
  unchanged: number;
  /** Records whose id was taken by a different deck: imported as a copy with a new id. */
  copied: number;
}

/**
 * Whether a stored record and an imported one are the same deck, field for field. The stored record is first read as
 * a file would be (deckRecord), so details the importer normalises (stale positions, unknown fields) do not count; a
 * stored record that cannot be read or compared counts as different.
 */
function sameRecord(stored: DeckRecord, imported: DeckRecord): boolean {
  try {
    return canonicalJson(migrateDeckRecord(deckRecord(cloneJson(stored)))) === canonicalJson(migrateDeckRecord(imported));
  } catch {
    return false;
  }
}

/**
 * How imported records join a library: a record that is new is written as it is; one equal to the stored record of
 * its id is left alone; one whose id holds a different deck is written as a copy with a new id from `newId`, so
 * importing never overwrites a deck in the library.
 */
export function planImport(existing: readonly DeckRecord[], incoming: readonly DeckRecord[], newId: () => string): ImportPlan {
  const byId = new Map(existing.map((d) => [d.id, d] as const));
  const plan: ImportPlan = { put: [], unchanged: 0, copied: 0 };
  for (const record of incoming) {
    const stored = byId.get(record.id);
    if (!stored) {
      plan.put.push(cloneJson(record));
      byId.set(record.id, record);
    } else if (sameRecord(stored, record)) {
      plan.unchanged++;
    } else {
      let id = newId();
      while (byId.has(id)) id = newId();
      const copy = { ...cloneJson(record), id };
      plan.put.push(copy);
      byId.set(id, copy);
      plan.copied++;
    }
  }
  return plan;
}
