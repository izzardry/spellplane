/**
 * Export and import of decks and saved tables (PLAN Milestone 5, owner decisions, Installable on iPad: "lets decks and
 * saved tables be exported to a file and imported again"; DESIGN "Pre-game", Local deck library: exportable and
 * importable as files). File shape: store/types.ts BackupFile. Contracts: M5-C. Implementer: M5-P3.
 *
 * The file is the player's own copy of their own data, so it may hold their secret stores and key pair (as JWK); it is
 * never sent anywhere by the app (CLAUDE.md: hidden information never leaves its owner's browser except through the
 * design's reveal paths — saving a file the owner keeps is not a send). What it holds of a table is exactly what this
 * browser's IndexedDB holds (record, log, own secret store), never more.
 *
 * Reading checks every entry and reports the ones it skips; it never throws on a bad file. Restoring never overwrites
 * a deck or table that already exists unless asked, and never seats a restored networked table under another
 * identity than the one it was played with.
 */
import { canonicalJson } from '../core/hash';
import type { SecretStore, Stage } from '../core/types';
import { importLibrary, LIBRARY_LIMITS } from './decks';
import { MAX_NICKNAME_LENGTH, peerIdOf, SEAT_COLOUR_COUNT } from './identity';
import type { LocalStores } from './stores';
import { atomicWrite } from './tx';
import {
  BACKUP_FILE_FORMAT,
  BACKUP_FILE_VERSION,
  DEFAULT_SETTINGS,
  LIBRARY_FILE_FORMAT,
  type BackupFile,
  type BackupImport,
  type DeckRecord,
  type ExportedIdentity,
  type HintId,
  type LoadedTable,
  type LogRecord,
  type SavedTableExport,
  type Settings,
  type StoredIdentity,
  type TableRecord,
} from './types';

/** What to put in a backup file (M5-P3). Added by M5-C. */
export interface BackupOptions {
  decks: boolean;
  /** Room ids of the saved tables to include, or 'all'. Tables imply the identity. */
  tables: string[] | 'all';
  settings: boolean;
}

/** How to restore (M5-P3). Added by M5-C. */
export interface RestoreOptions {
  /** Replace this browser's identity with the file's (needed to reclaim the file's seats). */
  replaceIdentity: boolean;
  /** Overwrite decks and tables that already exist here (otherwise they are skipped with a message). */
  overwrite: boolean;
}

/** Limits on a backup file, so a malformed or hostile file cannot fill the browser's storage (M5-P3). */
export const BACKUP_LIMITS = {
  /** Saved tables per file. */
  tables: 500,
  /** Log records per table. */
  log: 200_000,
} as const;

const STAGES: readonly Stage[] = ['lobby', 'draft', 'build', 'match'];
const HINT_IDS: readonly HintId[] = ['welcome', 'tableKeys', 'touchGestures', 'talkKey', 'installHomeScreen', 'persistStorage'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Thrown inside the validators with the reason an entry is skipped. */
class Invalid extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------------------------------

/** The stored identity as JWK, or null when this browser has none (or only an old non-extractable key pair). */
async function exportedIdentity(stores: LocalStores): Promise<ExportedIdentity | null> {
  const stored = await stores.db.get('identity', 'me');
  if (!stored) return null;
  let privateJwk = stored.privateJwk;
  let publicJwk = stored.publicJwk;
  if ((!privateJwk || !publicJwk) && stored.keyPair) {
    // Records of builds before 11 Nov 2026 hold CryptoKeys; they were generated extractable.
    try {
      [privateJwk, publicJwk] = await Promise.all([crypto.subtle.exportKey('jwk', stored.keyPair.privateKey), crypto.subtle.exportKey('jwk', stored.keyPair.publicKey)]);
    } catch {
      return null;
    }
  }
  if (!privateJwk || !publicJwk) return null;
  return { privateJwk, publicJwk, peerId: stored.peerId, nickname: stored.nickname, seatColour: stored.seatColour };
}

/** Build a backup file from the stores (no I/O beyond IndexedDB). Implementer: M5-P3. Added by M5-C. */
export async function exportBackup(stores: LocalStores, opts: BackupOptions, now: number): Promise<BackupFile> {
  const decks = opts.decks ? await stores.decks.list() : [];
  const records = await stores.tables.listTables();
  const wanted = opts.tables === 'all' ? records : records.filter((t) => (opts.tables as string[]).includes(t.roomId));
  const tables: SavedTableExport[] = [];
  for (const table of wanted) {
    const [log, loaded] = await Promise.all([stores.tables.loadLog(table.roomId), stores.tables.loadTable(table.roomId)]);
    tables.push({ table, log, secrets: loaded?.secrets ?? null });
  }
  const file: BackupFile = { format: BACKUP_FILE_FORMAT, version: BACKUP_FILE_VERSION, exportedAt: now, decks: cloneJson(decks), tables: cloneJson(tables) };
  if (tables.length > 0) {
    const identity = await exportedIdentity(stores);
    if (identity) file.identity = cloneJson(identity);
  }
  if (opts.settings) file.settings = cloneJson(await stores.settings.all());
  return file;
}

/** The file's text: plain JSON, indented for people who open it. */
export function backupText(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A file name for a backup: `spellplane-backup-<date>.json` (UTC date of `now`). */
export function backupFileName(now: number): string {
  return `spellplane-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

function int(v: unknown, what: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new Invalid(`${what} is not a whole number`);
  return v;
}

function text(v: unknown, what: string, max: number = LIBRARY_LIMITS.name, allowEmpty = false): string {
  if (typeof v !== 'string' || (!allowEmpty && v.length === 0)) throw new Invalid(`${what} is missing`);
  if (v.length > max) throw new Invalid(`${what} is longer than ${max} characters`);
  return v;
}

function tableRecord(v: unknown): TableRecord {
  if (!isObj(v)) throw new Invalid('the table record is missing');
  const roomId = text(v.roomId, 'the room id');
  const roomKey = text(v.roomKey, 'the room key', LIBRARY_LIMITS.name, true);
  const lastSeq = int(v.lastSeq, 'the last action number');
  const snapshotSeq = int(v.snapshotSeq, 'the snapshot number');
  if (snapshotSeq > lastSeq) throw new Invalid('the snapshot is newer than the last action');
  if (v.snapshot !== null && !(isObj(v.snapshot) && isObj(v.snapshot.cards) && isObj(v.snapshot.zones) && typeof v.snapshot.seq === 'number')) throw new Invalid('the snapshot is not a table');
  if (v.seat !== null && typeof v.seat !== 'string') throw new Invalid('the seat is not a seat');
  if (typeof v.stage !== 'string' || !(STAGES as readonly string[]).includes(v.stage)) throw new Invalid('the stage is unknown');
  if (typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt)) throw new Invalid('the change date is not a time');
  const record: TableRecord = {
    roomId,
    roomKey,
    lastSeq,
    snapshot: v.snapshot === null ? null : (cloneJson(v.snapshot) as unknown as TableRecord['snapshot']),
    snapshotSeq,
    seat: v.seat,
    stage: v.stage as Stage,
    updatedAt: v.updatedAt,
  };
  if (v.protocol !== undefined) record.protocol = int(v.protocol, 'the protocol version', 1);
  return record;
}

function logRecords(v: unknown, roomId: string): LogRecord[] {
  if (!Array.isArray(v)) throw new Invalid('the log is not a list');
  if (v.length > BACKUP_LIMITS.log) throw new Invalid(`the log has more than ${BACKUP_LIMITS.log} entries`);
  let last = -Infinity;
  return v.map((e: unknown, i) => {
    const what = `log entry ${i + 1}`;
    if (!isObj(e)) throw new Invalid(`${what} is not an entry`);
    if (e.roomId !== roomId) throw new Invalid(`${what} belongs to another room`);
    const seq = int(e.seq, `${what}'s number`);
    if (seq <= last) throw new Invalid('the log is not in ascending order');
    last = seq;
    if (!isObj(e.action) || typeof e.action.type !== 'string') throw new Invalid(`${what} holds no action`);
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) throw new Invalid(`${what}'s time is not a time`);
    return { roomId, seq, action: cloneJson(e.action) as unknown as LogRecord['action'], at: e.at };
  });
}

function secretStore(v: unknown, seat: string | null): SecretStore | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new Invalid('the hidden cards are not a secret store');
  if (typeof v.seat !== 'string') throw new Invalid('the hidden cards name no seat');
  if (seat !== null && v.seat !== seat) throw new Invalid('the hidden cards belong to another seat');
  if (!isObj(v.identities) || !Array.isArray(v.libraryOrder) || !Array.isArray(v.hand) || !Array.isArray(v.audit) || !isObj(v.received)) throw new Invalid('the hidden cards are incomplete');
  if (![...v.libraryOrder, ...v.hand].every((id) => typeof id === 'string')) throw new Invalid('the hidden cards hold an invalid id');
  return cloneJson(v) as unknown as SecretStore;
}

function savedTable(v: unknown): SavedTableExport {
  if (!isObj(v)) throw new Invalid('not a saved table');
  const table = tableRecord(v.table);
  return { table, log: logRecords(v.log, table.roomId), secrets: secretStore(v.secrets, table.seat) };
}

function jwk(v: unknown, what: string, priv: boolean): JsonWebKey {
  if (!isObj(v) || v.kty !== 'EC' || v.crv !== 'P-256' || typeof v.x !== 'string' || typeof v.y !== 'string') throw new Invalid(`${what} is not a P-256 key`);
  if (priv && typeof v.d !== 'string') throw new Invalid(`${what} has no private part`);
  const out: JsonWebKey = { kty: 'EC', crv: 'P-256', x: v.x, y: v.y };
  if (priv) out.d = v.d as string;
  // The fields Web Crypto wrote on export are kept, so a restored identity is the stored one, field for field.
  if (typeof v.ext === 'boolean') out.ext = v.ext;
  if (Array.isArray(v.key_ops) && v.key_ops.every((o) => typeof o === 'string')) out.key_ops = [...(v.key_ops as string[])];
  return out;
}

function identityOf(v: unknown): ExportedIdentity {
  if (!isObj(v)) throw new Invalid('not an identity');
  const peerId = text(v.peerId, 'the peer id', 16);
  if (!/^[0-9a-f]{16}$/.test(peerId)) throw new Invalid('the peer id is not 16 hex characters');
  const nickname = text(v.nickname, 'the nickname', MAX_NICKNAME_LENGTH, true);
  const seatColour = int(v.seatColour, 'the seat colour');
  if (seatColour >= SEAT_COLOUR_COUNT) throw new Invalid('the seat colour is out of range');
  return { privateJwk: jwk(v.privateJwk, 'the private key', true), publicJwk: jwk(v.publicJwk, 'the public key', false), peerId, nickname, seatColour };
}

/** Allowed values of the settings that are one of a few words. */
const SETTING_CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  talkMode: ['ptt', 'turn', 'open', 'dictation'],
  speechEngine: ['webspeech', 'local'],
  quality: ['high', 'medium', 'low'],
  sound: ['theme', 'on', 'off'],
  cardBack: ['spellplane', 'official'],
};

/** One setting checked against the shape of its default; unknown hint ids are dropped as the store would ignore them. */
function settingValue(name: keyof Settings, v: unknown): unknown {
  const def: unknown = DEFAULT_SETTINGS[name];
  const choices = SETTING_CHOICES[name];
  if (choices) {
    if (typeof v !== 'string' || !choices.includes(v)) throw new Invalid(`is not one of ${choices.join(', ')}`);
    return v;
  }
  if (name === 'hintsSeen') {
    if (!Array.isArray(v)) throw new Invalid('is not a list');
    return [...new Set(v.filter((h): h is HintId => typeof h === 'string' && (HINT_IDS as readonly string[]).includes(h)))];
  }
  if (name === 'keymap') {
    if (!Array.isArray(v) || !v.every((o) => isObj(o) && typeof o.action === 'string' && typeof o.context === 'string' && isObj(o.chord) && typeof o.chord.key === 'string')) throw new Invalid('is not a list of key bindings');
    return cloneJson(v);
  }
  if (def === null) {
    if (v !== null && typeof v !== 'string') throw new Invalid('is not text');
    return v;
  }
  if (isObj(def)) {
    if (!isObj(v)) throw new Invalid('is not a group of settings');
    return cloneJson(v);
  }
  if (typeof v !== typeof def) throw new Invalid(`is not a ${typeof def}`);
  return v;
}

function settingsOf(v: unknown, errors: BackupImport['errors']): Partial<Settings> {
  if (v === undefined) return {};
  if (!isObj(v)) {
    errors.push({ where: 'settings', message: 'The settings were skipped: they are not a group of settings.' });
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(v)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) {
      errors.push({ where: `setting ${name}`, message: `The setting "${name}" was skipped: this version of Spellplane does not know it.` });
      continue;
    }
    try {
      out[name] = settingValue(name as keyof Settings, value);
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      errors.push({ where: `setting ${name}`, message: `The setting "${name}" was skipped: it ${e.message}.` });
    }
  }
  return out as Partial<Settings>;
}

/** Read a parsed file (a BackupFile, or a deck-only LibraryFile) without writing anything. Implementer: M5-P3. Added by M5-C. */
export function readBackup(json: unknown): BackupImport {
  const result: BackupImport = { decks: [], tables: [], identity: null, settings: {}, errors: [] };
  const fail = (message: string): BackupImport => ({ ...result, errors: [{ where: 'file', message }] });

  // A deck library file (or a single exported deck) from the builder's library reads as a backup of decks only.
  if (isObj(json) && (json.format === LIBRARY_FILE_FORMAT || (json.format === undefined && 'main' in json && 'id' in json))) {
    const lib = importLibrary(JSON.stringify(json));
    return { ...result, decks: lib.decks, errors: lib.errors.map((e) => ({ where: e.index < 0 ? 'file' : `deck ${e.index + 1}`, message: e.message })) };
  }
  if (!isObj(json) || json.format !== BACKUP_FILE_FORMAT) return fail('The file is not a Spellplane backup.');
  if (typeof json.version !== 'number' || !Number.isInteger(json.version) || json.version < 1) return fail('The backup has no valid version.');
  if (json.version > BACKUP_FILE_VERSION) return fail(`The backup was written by a newer Spellplane (version ${json.version}); update the app to read it.`);

  if (json.decks !== undefined) {
    if (!Array.isArray(json.decks)) result.errors.push({ where: 'decks', message: 'The decks were skipped: they are not a list.' });
    else {
      const lib = importLibrary(JSON.stringify({ format: LIBRARY_FILE_FORMAT, version: 1, exportedAt: 0, decks: json.decks }));
      result.decks = lib.decks;
      for (const e of lib.errors) result.errors.push({ where: e.index < 0 ? 'decks' : `deck ${e.index + 1}`, message: e.message });
    }
  }

  if (json.tables !== undefined) {
    if (!Array.isArray(json.tables)) result.errors.push({ where: 'tables', message: 'The saved tables were skipped: they are not a list.' });
    else if (json.tables.length > BACKUP_LIMITS.tables) result.errors.push({ where: 'tables', message: `The saved tables were skipped: the file holds more than ${BACKUP_LIMITS.tables}.` });
    else {
      const seen = new Set<string>();
      json.tables.forEach((entry: unknown, i: number) => {
        try {
          const t = savedTable(entry);
          if (seen.has(t.table.roomId)) throw new Invalid('an earlier table in the file has the same room');
          seen.add(t.table.roomId);
          result.tables.push(t);
        } catch (e) {
          if (!(e instanceof Invalid)) throw e;
          const room = isObj(entry) && isObj(entry.table) && typeof entry.table.roomId === 'string' ? ` (${entry.table.roomId.slice(0, 40)})` : '';
          result.errors.push({ where: `table ${i + 1}`, message: `Saved table ${i + 1}${room} was skipped: ${e.message}.` });
        }
      });
    }
  }

  if (json.identity !== undefined) {
    try {
      result.identity = identityOf(json.identity);
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      result.errors.push({ where: 'identity', message: `The identity was skipped: ${e.message}.` });
    }
  }

  result.settings = settingsOf(json.settings, result.errors);
  return result;
}

/** Parse a file's text and read it (readBackup); text that is not JSON is reported, never thrown. */
export function readBackupText(text: string): BackupImport {
  try {
    return readBackup(JSON.parse(text) as unknown);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return { decks: [], tables: [], identity: null, settings: {}, errors: [{ where: 'file', message: 'The file is not a Spellplane backup (it is not JSON).' }] };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------------------------------------------------

const KEY_ALGORITHM: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };

/** Whether the key pair is one pair and the peer id is its public key's (DESIGN "Specification: network protocol and secrecy"). */
async function identityHolds(id: ExportedIdentity): Promise<boolean> {
  try {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey('jwk', id.privateJwk, KEY_ALGORITHM, false, ['sign']),
      crypto.subtle.importKey('jwk', id.publicJwk, KEY_ALGORITHM, true, ['verify']),
    ]);
    if ((await peerIdOf(publicKey)) !== id.peerId) return false;
    const probe = new TextEncoder().encode(`spellplane-backup ${id.peerId}`);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, probe);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, probe);
  } catch {
    return false;
  }
}

/**
 * A table this browser set up but never played: the solo table every visit creates (store/tables.ts SOLO_ROOM_ID;
 * session/solo.ts saves an empty table and its `stageSet`). Restoring over it loses nothing, so it is no conflict.
 */
function untouched(t: LoadedTable): boolean {
  const empty = t.table.snapshot === null || Object.keys(t.table.snapshot.cards).length === 0;
  return empty && t.table.lastSeq <= 1 && t.log.every((e) => e.action.type === 'stageSet');
}

function sameDeck(a: DeckRecord, b: DeckRecord): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

/** Write what `readBackup` returned into the stores. Implementer: M5-P3. Added by M5-C. */
export async function restoreBackup(stores: LocalStores, data: BackupImport, opts: RestoreOptions): Promise<{ errors: BackupImport['errors'] }> {
  const errors: BackupImport['errors'] = [];

  // The identity first: whether networked tables may be restored depends on it.
  let peerId = (await stores.db.get('identity', 'me'))?.peerId ?? null;
  if (data.identity && opts.replaceIdentity && data.identity.peerId !== peerId) {
    if (await identityHolds(data.identity)) {
      const record: StoredIdentity = { id: 'me', ...cloneJson(data.identity) };
      await stores.db.put('identity', record);
      peerId = record.peerId;
    } else {
      errors.push({ where: 'identity', message: 'The identity was not taken over: its key pair does not match its peer id.' });
    }
  }

  for (const deck of data.decks) {
    const existing = await stores.decks.get(deck.id);
    if (existing && sameDeck(existing, deck)) continue;
    if (existing && !opts.overwrite) {
      errors.push({ where: `deck ${deck.id}`, message: `Deck "${deck.name}" was skipped: a different deck with the same id is already here (choose to overwrite to replace it).` });
      continue;
    }
    await stores.decks.put(cloneJson(deck));
  }

  for (const saved of data.tables) {
    const { table } = saved;
    const where = `table ${table.roomId}`;
    // A networked table's seat belongs to the key pair it was played with; under another identity it would claim a
    // chair this browser cannot prove. The solo table has no other players.
    if (table.roomKey !== '' && (!data.identity || data.identity.peerId !== peerId)) {
      errors.push({
        where,
        message: data.identity
          ? `Saved table ${table.roomId} was skipped: it was played as ${data.identity.nickname || 'another player'}, and this browser keeps its own identity (choose to take over the file's identity to restore it).`
          : `Saved table ${table.roomId} was skipped: the file holds no identity to reclaim its seat with.`,
      });
      continue;
    }
    const existing = await stores.tables.loadTable(table.roomId);
    if (!opts.overwrite && existing && !untouched(existing)) {
      errors.push({ where, message: `Saved table ${table.roomId === 'solo' ? '(the solo table)' : table.roomId} was skipped: this browser already has it (choose to overwrite to replace it).` });
      continue;
    }
    const tx = stores.db.transaction(['tables', 'log', 'secrets'], 'readwrite');
    await atomicWrite(tx, (t, track) => {
      track(t.objectStore('log').delete(IDBKeyRange.bound([table.roomId, -Infinity], [table.roomId, Infinity])));
      track(t.objectStore('secrets').delete(table.roomId));
      track(t.objectStore('tables').put(cloneJson(table)));
      for (const entry of saved.log) track(t.objectStore('log').put(cloneJson(entry)));
      if (saved.secrets) track(t.objectStore('secrets').put({ roomId: table.roomId, secrets: cloneJson(saved.secrets) }));
    });
  }

  for (const [name, value] of Object.entries(data.settings) as [keyof Settings, Settings[keyof Settings]][]) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name) || value === undefined) continue;
    await stores.settings.set(name, cloneJson(value));
  }

  return { errors };
}

/**
 * Whether restoring this file should take over its identity by default: the file has one, and this browser has no
 * saved networked table of its own that a new identity would orphan (a browser whose storage was wiped, or a new one).
 */
export async function suggestReplaceIdentity(stores: LocalStores, data: BackupImport): Promise<boolean> {
  if (!data.identity) return false;
  const current = await stores.db.get('identity', 'me');
  if (current?.peerId === data.identity.peerId) return false;
  return (await stores.tables.listTables()).every((t) => t.roomKey === '');
}
