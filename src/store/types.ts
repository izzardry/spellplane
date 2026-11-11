/**
 * Local persistence contracts (DESIGN "Specification: network protocol and secrecy", Local persistence; "Card data
 * and images", Caching). Implementers: M0-P5 (schema, identity, settings, decks, solo table), M0-P2 (card cache),
 * M1-P7 (log and resume). store/ may import core and util only, so card and set payloads are `unknown` here and
 * data/ narrows them to its own types.
 */
import type { DBSchema } from 'idb';
import type { Action } from '../core/actions';
import type { CardRef, SecretStore, SeatId, Stage, TableState } from '../core/types';

/** `identity` store, key 'me' (DESIGN "Local persistence"): key pair, nickname, preferred seat colour. */
export interface IdentityRecord {
  id: 'me';
  /** ECDSA P-256; the private key is non-extractable and stored as a CryptoKey. */
  keyPair: CryptoKeyPair;
  /** First 16 hex characters of SHA-256 of the public key (DESIGN "Specification: network protocol and secrecy"). */
  peerId: string;
  nickname: string;
  seatColour: number;
}

/** A remapped key: the chord replaces the defaults of `action` in `context` (DESIGN "Input and interaction design": all keys are remappable). */
export interface KeymapOverride {
  action: string;
  context: string;
  chord: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };
}

/** Per-browser settings by name (DESIGN "Local persistence": theme, keymap, talk mode, speech engine, quality, follow toggles). */
export interface Settings {
  theme: string;
  keymap: KeymapOverride[];
  talkMode: 'ptt' | 'turn' | 'open' | 'dictation';
  speechEngine: 'webspeech' | 'local';
  speechLang: string;
  quality: 'high' | 'medium' | 'low';
  followStack: boolean;
  followActive: boolean;
}

/** Defaults for every setting (DESIGN "Decision log": Paper, push-to-talk, follow toggles off). */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'paper',
  keymap: [],
  talkMode: 'ptt',
  speechEngine: 'webspeech',
  speechLang: 'en',
  quality: 'high',
  followStack: false,
  followActive: false,
};

/** `settings` store record, keyed by name (DESIGN "Local persistence"). */
export type SettingsRecord = { [K in keyof Settings]: { name: K; value: Settings[K] } }[keyof Settings];

/** `tables` store record, keyed by roomId; the solo table uses roomId 'solo' (DESIGN "Local persistence"). */
export interface TableRecord {
  roomId: string;
  /** Empty for the solo table. */
  roomKey: string;
  lastSeq: number;
  /** Latest snapshot and the seq it was taken at; replay `log` entries after it. */
  snapshot: TableState | null;
  snapshotSeq: number;
  seat: SeatId | null;
  stage: Stage;
  updatedAt: number;
}

/** `log` store record, key [roomId, seq] (DESIGN "Local persistence"). */
export interface LogRecord {
  roomId: string;
  seq: number;
  action: Action;
  /** Local wall clock when applied (display only). */
  at: number;
}

/** `secrets` store record, keyed by roomId (DESIGN "Local persistence"): the SecretStore incl. audit records. */
export interface SecretsRecord {
  roomId: string;
  secrets: SecretStore;
}

/** `decks` store record (DESIGN "Local persistence"; "Pre-game", Local deck library). */
export interface DeckRecord {
  id: string;
  name: string;
  main: CardRef[];
  side: CardRef[];
  source: 'pasted' | 'built' | 'drafted';
  /** The pasted text, kept for re-import. */
  text?: string;
  createdAt: number;
  updatedAt: number;
}

/** `cards` store record keyed by Scryfall id; `data` is data/'s CardData (DESIGN "Local persistence"). */
export interface CardRecord {
  id: string;
  data: unknown;
  fetchedAt: number;
}

/** `sets` store record keyed by set code; `data` is the trimmed MTGJSON set (DESIGN "Local persistence"). */
export interface SetRecord {
  code: string;
  data: unknown;
  fetchedAt: number;
}

/** The IndexedDB schema v1: the eight stores of the persistence table (DESIGN "Local persistence"). */
export interface SpellplaneDB extends DBSchema {
  identity: { key: 'me'; value: IdentityRecord };
  settings: { key: keyof Settings; value: SettingsRecord };
  tables: { key: string; value: TableRecord };
  log: { key: [string, number]; value: LogRecord };
  secrets: { key: string; value: SecretsRecord };
  decks: { key: string; value: DeckRecord; indexes: { updatedAt: number } };
  cards: { key: string; value: CardRecord; indexes: { fetchedAt: number } };
  sets: { key: string; value: SetRecord };
}

/** Everything needed to restore a table (DESIGN "Multiplayer architecture", Resume). */
export interface LoadedTable {
  table: TableRecord;
  /** Log records after `table.snapshotSeq`, ascending. */
  log: LogRecord[];
  secrets: SecretStore | null;
}

/** Table persistence (DESIGN "Local persistence": log, tables and secrets for one action in one transaction). Implementer: M0-P5 (solo), M1-C (loadLog, saveSecrets), M1-P7. */
export interface TableStore {
  /** Writes the log entry, the table record and (if given) the secrets in ONE transaction. */
  saveAction(roomId: string, entry: LogRecord, table: TableRecord, secrets: SecretStore | null): Promise<void>;
  /** Writes a snapshot into the table record (and secrets) without a log entry. */
  saveSnapshot(table: TableRecord, secrets: SecretStore | null): Promise<void>;
  loadTable(roomId: string): Promise<LoadedTable | null>;
  /**
   * Stored log records of a room with `seq > afterSeq` (default: all), ascending (DESIGN "Turn flow and confirmation",
   * Action log: the log is what gets saved for resume). Added by M1-C for the full log after a reload (M0-P7 known
   * limit). Entries past the table record's `lastSeq` belong to an abandoned timeline; callers stop there.
   */
  loadLog(roomId: string, afterSeq?: number): Promise<LogRecord[]>;
  /**
   * Writes the secret store alone (DESIGN "Local persistence": `secrets` keyed by roomId). Added by M1-C for networked
   * tables, whose secret store also changes without an own logged action (an identity received on the pair channel,
   * a peer's shuffle nonce folded into the order).
   */
  saveSecrets(roomId: string, secrets: SecretStore): Promise<void>;
  listTables(): Promise<TableRecord[]>;
  deleteTable(roomId: string): Promise<void>;
}

/** Deck library (DESIGN "Pre-game", Local deck library). Implementer: M0-P5. */
export interface DeckStore {
  list(): Promise<DeckRecord[]>;
  get(id: string): Promise<DeckRecord | null>;
  put(deck: DeckRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Settings (DESIGN "Local persistence"). Implementer: M0-P5. */
export interface SettingsStore {
  get<K extends keyof Settings>(name: K): Promise<Settings[K]>;
  set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void>;
  /** Every setting, defaults filled in. */
  all(): Promise<Settings>;
}

/** The browser's identity (DESIGN "Players, seats and formats", Identity). Implementer: M0-P5. */
export interface IdentityStore {
  /** The stored identity, creating the key pair on first visit. */
  get(): Promise<IdentityRecord>;
  setNickname(nickname: string): Promise<void>;
  setSeatColour(colour: number): Promise<void>;
}

/** Card JSON cache (DESIGN "Card data and images", Caching; refreshed after 30 days). Implementer: M0-P2. */
export interface CardCache {
  get(sid: string): Promise<CardRecord | null>;
  getMany(sids: string[]): Promise<CardRecord[]>;
  put(records: CardRecord[]): Promise<void>;
  /** Ids fetched before `olderThan` (ms epoch). */
  stale(olderThan: number): Promise<string[]>;
}
