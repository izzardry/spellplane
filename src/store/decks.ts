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
import { LIBRARY_FILE_FORMAT, LIBRARY_FILE_VERSION, type DeckRecord, type DeckStore, type LibraryFile, type LibraryImport, type SpellplaneDB } from './types';

/** The DeckStore on an open database (store/types.ts DeckStore). `list()` returns the most recently updated first. */
export function createDeckStore(db: IDBPDatabase<SpellplaneDB>): DeckStore {
  return {
    async list(): Promise<DeckRecord[]> {
      const ascending = await db.getAllFromIndex('decks', 'updatedAt');
      return ascending.reverse();
    },
    async get(id: string): Promise<DeckRecord | null> {
      return (await db.get('decks', id)) ?? null;
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
 * A library record of the builder's state (DESIGN "Pre-game", Local deck library: "Decks and drafted pools are saved
 * in the browser"): `main` is the deck, `side` the rest of the pool, and `pool` the whole build (with the table view's
 * positions) so it opens again exactly as it was.
 */
export function deckRecordFromBuild(build: DeckBuild, opts: RecordFromBuildOptions): DeckRecord {
  const { main, side } = buildLists(build);
  const record: DeckRecord = {
    id: opts.id,
    name: opts.name,
    main,
    side,
    source: opts.origin ? 'drafted' : 'built',
    createdAt: opts.createdAt ?? opts.now,
    updatedAt: opts.now,
    pool: cloneJson(build),
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
    const lists = buildLists(pool);
    if (!sameRefs(lists.main, record.main) || !sameRefs(lists.side, record.side)) throw new Invalid('the pool does not hold the same cards as the deck and sideboard');
    record.pool = pool;
  }
  if (v.origin !== undefined) {
    const o = v.origin;
    if (!isObj(o) || typeof o.format !== 'string' || !(DRAFT_FORMATS as readonly string[]).includes(o.format)) throw new Invalid('the draft format is unknown');
    if (!Array.isArray(o.sets) || o.sets.length > 64 || !o.sets.every((s) => typeof s === 'string' && /^[A-Za-z0-9]{1,16}$/.test(s))) throw new Invalid('the set codes are not set codes');
    record.origin = { format: o.format as DraftFormat, sets: [...(o.sets as string[])] };
  }
  return record;
}

/**
 * Read a LibraryFile (or a single exported deck record) back into records (DESIGN "Pre-game", Local deck library:
 * importable). Every record is checked; invalid ones are reported in `errors` with their 0-based index in the file and
 * never thrown on. Problems with the file as a whole (not JSON, another format, a newer version) are reported with
 * index -1 and no records. A record whose id appears earlier in the same file is skipped. Ids that already exist in
 * the library are kept for the caller to overwrite or rename (see planImport).
 */
export function importLibrary(text: string): LibraryImport {
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
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    try {
      const record = deckRecord(entry);
      if (seen.has(record.id)) throw new Invalid(`an earlier deck in the file has the same id`);
      seen.add(record.id);
      decks.push(record);
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      const name = isObj(entry) && typeof entry.name === 'string' && entry.name.trim() ? ` "${entry.name.trim().slice(0, 60)}"` : '';
      errors.push({ index, message: `Deck ${index + 1}${name} was skipped: ${e.message}.` });
    }
  });
  return { decks, errors };
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
    } else if (canonicalJson(stored) === canonicalJson(record)) {
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
