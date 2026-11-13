/**
 * Local persistence contracts (DESIGN "Specification: network protocol and secrecy", Local persistence; "Card data
 * and images", Caching). Implementers: M0-P5 (schema, identity, settings, decks, solo table), M0-P2 (card cache),
 * M1-P7 (log and resume). store/ may import core and util only, so card and set payloads are `unknown` here and
 * data/ narrows them to its own types.
 */
import type { DBSchema } from 'idb';
import type { Action } from '../core/actions';
import type { CardRef, DeckBuild, DraftFormat, SecretStore, SeatId, SetCode, Stage, TableState } from '../core/types';

/** `identity` store, key 'me' (DESIGN "Local persistence"): key pair, nickname, preferred seat colour. */
export interface IdentityRecord {
  id: 'me';
  /** ECDSA P-256; in memory the private key is non-extractable (stored as JWK, see StoredIdentity). */
  keyPair: CryptoKeyPair;
  /** First 16 hex characters of SHA-256 of the public key (DESIGN "Specification: network protocol and secrecy"). */
  peerId: string;
  nickname: string;
  seatColour: number;
}

/**
 * How the identity is kept in the `identity` store (DESIGN "Local persistence"). The key pair is stored as JWK data,
 * not as CryptoKey objects: WebKit wraps stored CryptoKeys with a master key from the macOS keychain, which made
 * Playwright's WebKit raise keychain dialogs. `get()` imports the private key as non-extractable. Records written by
 * earlier builds hold `keyPair` CryptoKeys instead and are still read.
 */
export interface StoredIdentity {
  id: 'me';
  privateJwk?: JsonWebKey;
  publicJwk?: JsonWebKey;
  /** Earlier builds (before 11 Nov 2026) only. */
  keyPair?: CryptoKeyPair;
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

/**
 * How a player talks (DESIGN "Chat and voice", Talk modes: push-to-talk, turn mic, open mic, dictation; "Voice and
 * dictation can run together"). `gate` says when the mic opens: 'ptt' while the talk key is held, 'turn' for the whole
 * own turn (push-to-talk outside it), 'open' always. `voice` sends live audio, `dictation` sends captions; at least one
 * is on. `muted` is the open-mic mute toggle (M) and closes every gate. `mouseButton` is an extra talk button
 * (MouseEvent.button), null for none; the talk key itself is the keymap's 'talk' binding. Added by M3-C; voice/types.ts
 * builds on it (M3-P3, M3-P4).
 */
export interface TalkSettings {
  gate: 'ptt' | 'turn' | 'open';
  voice: boolean;
  dictation: boolean;
  muted: boolean;
  mouseButton: number | null;
}

/** A player's own volume and mute for one other player's voice (DESIGN "Chat and voice", Live voice: "a personal volume and mute control per other player"). Added by M3-C. */
export interface PeerAudioSetting {
  /** 0..1. */
  volume: number;
  muted: boolean;
}

/** Per-browser settings by name (DESIGN "Local persistence": theme, keymap, talk mode, speech engine, quality, follow toggles). */
export interface Settings {
  theme: string;
  keymap: KeymapOverride[];
  /** Superseded by `talk` (M3-C); kept so older saves load. M3-P3 maps a stored value onto `talk` once ('dictation' → ptt gate, dictation only). */
  talkMode: 'ptt' | 'turn' | 'open' | 'dictation';
  /** 'local' is the in-browser Whisper-class model loaded on demand (DESIGN "Chat and voice", Dictation and captions: Engine). */
  speechEngine: 'webspeech' | 'local';
  /** BCP 47 tag; DESIGN says the default follows the browser locale, English for the run (DESIGN "Chat and voice": Language). */
  speechLang: string;
  quality: 'high' | 'medium' | 'low';
  followStack: boolean;
  followActive: boolean;
  /** Added by M3-C. The talk mode (DESIGN "Chat and voice", Talk modes). */
  talk: TalkSettings;
  /** Added by M3-C. The chosen microphone (MediaDeviceInfo.deviceId), null for the default (PLAN M3-P3 device picker). */
  micDevice: string | null;
  /** Added by M3-C. Per-player volume and mute by identity peer id (DESIGN "Chat and voice", Live voice). */
  peerAudio: Record<string, PeerAudioSetting>;
  /**
   * Added by M4-C. The theme's sound set (DESIGN "Themes and rendering", Sound: optional, off by default in Paper):
   * 'theme' follows the theme's SoundSet.onByDefault, 'on' and 'off' override it for every theme.
   */
  sound: 'theme' | 'on' | 'off';
}

/** Talk defaults (DESIGN "Decision log": push-to-talk; hold V). Added by M3-C. */
export const DEFAULT_TALK: TalkSettings = { gate: 'ptt', voice: true, dictation: false, muted: false, mouseButton: null };

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
  talk: DEFAULT_TALK,
  micDevice: null,
  peerAudio: {},
  sound: 'theme',
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
  /**
   * Added by M2-C. For a drafted or sealed pool (DESIGN "Pre-game", Local deck library: "Decks and drafted pools are
   * saved"): the whole pool as the builder held it, so it can be rebuilt on another evening; `main` and `side` are
   * then the deck and the rest of the pool.
   */
  pool?: DeckBuild;
  /** Added by M2-C. Where a drafted pool came from: the format and the set per pack. */
  origin?: { format: DraftFormat; sets: SetCode[] };
}

/** Format tag of an exported deck library file (DESIGN "Pre-game", Local deck library: exportable and importable as files). Added by M2-C. */
export const LIBRARY_FILE_FORMAT = 'spellplane-decks';

/** Current version of the library file (M2-P6 bumps it with a migration). Added by M2-C. */
export const LIBRARY_FILE_VERSION = 1;

/** An exported deck library file, plain JSON (DESIGN "Pre-game", Local deck library). Added by M2-C; implementer: M2-P6. */
export interface LibraryFile {
  format: typeof LIBRARY_FILE_FORMAT;
  version: number;
  /** ms epoch of the export. */
  exportedAt: number;
  decks: DeckRecord[];
}

/** Result of reading a library file: the records to save and one message per entry that was skipped (M2-P6). Added by M2-C. */
export interface LibraryImport {
  decks: DeckRecord[];
  errors: { index: number; message: string }[];
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
  identity: { key: 'me'; value: StoredIdentity };
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

/** Trimmed MTGJSON set cache, the `sets` store (DESIGN "Local persistence"; "Card data and images", Caching). Added by M2-C; implementer: M2-P1 (store/sets.ts). */
export interface SetCache {
  get(code: string): Promise<SetRecord | null>;
  put(record: SetRecord): Promise<void>;
  /** Every cached set code. */
  codes(): Promise<string[]>;
}

/** Card JSON cache (DESIGN "Card data and images", Caching; refreshed after 30 days). Implementer: M0-P2. */
export interface CardCache {
  get(sid: string): Promise<CardRecord | null>;
  getMany(sids: string[]): Promise<CardRecord[]>;
  put(records: CardRecord[]): Promise<void>;
  /** Ids fetched before `olderThan` (ms epoch). */
  stale(olderThan: number): Promise<string[]>;
}
