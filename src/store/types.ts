/**
 * Local persistence contracts (DESIGN "Specification: network protocol and secrecy", Local persistence; "Card data
 * and images", Caching). Implementers: M0-P5 (schema, identity, settings, decks, solo table), M0-P2 (card cache),
 * M1-P7 (log and resume). store/ may import core and util only, so card and set payloads are `unknown` here and
 * data/ narrows them to its own types.
 */
import type { DBSchema } from 'idb';
import type { Action } from '../core/actions';
import type { BotConfig, BotLevel, BotPace, CardRef, DeckBuild, DraftFormat, Format, MatchRecord, QueueId, RatingKey, RatingRecord, SeatColourIndex, SecretStore, SeatId, SetCode, Stage, TableState, TeamId } from '../core/types';
import { DEFAULT_DIE_SIDES } from '../core/objects';

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
  /**
   * Added by M5-C. The card back other players' hidden cards show (DESIGN "Card data and images", Card back:
   * Spellplane's own neutral back; the official back is an opt-in setting loaded from backs.scryfall.io at runtime and
   * never bundled). Implementer: M5-P5.
   */
  cardBack: CardBackChoice;
  /**
   * Added by M5-C. Hints this browser has shown and the player dismissed (PLAN M5-P5 first-run hints; M5-P3 the iPad
   * Home Screen hint and the storage-persistence prompt), so each shows once. Ids this build does not know are ignored.
   */
  hintsSeen: HintId[];
  /**
   * Added by M6-C. "Talk while I hold or drag" (Voice section, off by default; DESIGN "Chat and voice", Talk modes; PLAN
   * Milestone 6, owner decisions, Hold-to-talk): at a table with voice, a mouse-button or finger press on the table held
   * longer than HOLD_PRESS_TALK_MS (scene/types.ts) talks as push-to-talk until release. Implementer: M6-P2.
   */
  talkWhileHolding: boolean;
  /**
   * Added by M6-C. The die Ctrl+I rolls, as sides (DESIGN "Card manipulation", Other table objects: "Dice (any size)";
   * core/objects.ts DIE_SIDES offers the sizes). Implementer: M6-P3.
   */
  dieSides: number;
  /**
   * Added by M7-C. The viewer's look (themes/types.ts LookId: 'kitchen', 'graphite' or 'codex'; PLAN Milestone 7, Owner
   * decisions after the first design round: "All three looks are kept"): the HUD's design tokens (ui/design/tokens.ts)
   * and, through LOOK_THEME, the table's 3D theme. A string like `theme`, read with lookIdOf (anything unknown is the
   * default look). Choosing a look in the picker also stores its theme in `theme`; an M4 theme set by the debug hook or
   * an older save keeps `theme` and leaves the look alone. Implementer: M7-P2 (picker and HUD), M7-P1 (theme mapping).
   */
  look: string;
  /**
   * Added by M7-C. The tilt the table opens at, 0 first person to 1 bird's-eye (scene/types.ts Tilt; PLAN Milestone 7,
   * Owner decisions, One continuous tilt), or null for the look's default (Theme.camera.tilt). The last tilt the viewer
   * chose with the HUD handle or keys is stored here when it settles. Implementer: M7-P3.
   */
  tilt: number | null;
  /**
   * Added by M7-C. Motion intensity (PLAN Milestone 7, Owner decisions, Almost haptic card handling: "Reduced motion is
   * respected"; scene/types.ts resolveMotion). Implementer: M7-P4 (the scene), M7-P2 (the setting in Settings).
   */
  motion: MotionIntensity;
  /**
   * Added by M7-C. "Show frame rate" (PLAN Milestone 7, A0 steps: "An on-screen fps and frame-time meter (a URL flag and a
   * setting)"). M7-A0 keeps it in localStorage for now (DECISIONS [M7-A0]); moving it here is a follow-up of M7-A0's.
   */
  showFrameRate: boolean;
  /** Added by M8-C. What Home shows on the next visit: mode, selected deck, options per mode (journey.md section 7). Implementer: M8-P2. */
  home: HomePrefs;
  /** Added by M8-C. Card image size in the deck page's grid (decks.md section 7). Implementer: M8-P3. */
  deckCardSize: 's' | 'm' | 'l';
  /** Added by M8-C. What the Sparring selector remembers (computer.md 10.1). Implementer: M8-P6. */
  computer: ComputerPrefs;
  /** Added by M8-C. "Tell me when someone is looking" (matchmaking.md 2.10; later). */
  lobbyNotify: boolean;
  /** Added by M8-C. Also search the casual queue while ranked (matchmaking.md 2.10). */
  alsoCasual: boolean;
  /** Added by M8-C. The last queue searched (matchmaking.md 2.10). */
  lastQueue: QueueId;
  /** Added by M8-C. Players this browser avoids, at most 200, oldest dropped (matchmaking.md 2.10; later). */
  avoid: { peerId: string; name: string; at: number }[];
}

/** Home's mode (journey.md section 7). Added by M8-C. */
export type HomeMode = 'solo' | 'quick' | 'private' | 'draft';

/** Settings.home: what Home shows on the next visit (journey.md section 7). Added by M8-C. */
export interface HomePrefs {
  mode: HomeMode;
  /** The selected deck (decks.md D29); null when none. */
  deckId: string | null;
  solo: { opponent: 'sparring' | 'alone' };
  quick: { format: Format; ranked: boolean };
  private: { format: Format; decks: 'any' | 'booster' };
  draft: { format: Format; boosters: BoosterSetup };
}

/** The booster setup sheet's value; maps onto core's LobbySettings (draft, sets, pickTimer) (journey.md section 7). Added by M8-C. */
export interface BoosterSetup {
  how: 'pass' | 'sealed' | 'rochester' | 'winston' | 'grid';
  /** Per player. */
  packs: number;
  /** Per pass, draft only. */
  picks: number;
  /** Per pack; shorter lists repeat their last entry. */
  sets: SetCode[];
  pickTimer: boolean;
}

/** The default booster setup: a booster draft of 3 packs of the latest core set in the fixtures, M19 (journey.md J-C). Added by M8-C. */
export const DEFAULT_BOOSTER_SETUP: BoosterSetup = { how: 'pass', packs: 3, picks: 1, sets: ['M19'], pickTimer: true };

/** Home's defaults: solo, no deck, 1v1, unranked, any deck, booster draft of 3 packs (journey.md J-C). Added by M8-C. */
export const DEFAULT_HOME_PREFS: HomePrefs = {
  mode: 'solo',
  deckId: null,
  solo: { opponent: 'sparring' },
  quick: { format: '1v1', ranked: false },
  private: { format: '1v1', decks: 'any' },
  draft: { format: 'ffa4', boosters: DEFAULT_BOOSTER_SETUP },
};

/** The deck Sparring plays: by colour, the human's mirror, or a library deck (computer.md 10.1). Added by M8-C. */
export type OpponentDeckChoice = { kind: 'sparring'; colour: 'W' | 'U' | 'B' | 'R' | 'G'; set: SetCode } | { kind: 'mirror' } | { kind: 'deck'; deckId: string };

/** Settings.computer: what the Sparring selector remembers (computer.md 10.1). Added by M8-C. */
export interface ComputerPrefs {
  level: BotLevel;
  pace: BotPace;
  deck: 'auto' | 'W' | 'U' | 'B' | 'R' | 'G' | 'mirror' | { deckId: string };
}

/** Settings.computer's default (computer.md C0). Added by M8-C. */
export const DEFAULT_COMPUTER_PREFS: ComputerPrefs = { level: 'steady', pace: 'normal', deck: 'auto' };

/**
 * How much the table moves (Settings.motion; PLAN Milestone 7, Owner decisions, Almost haptic card handling): 'system'
 * follows the browser's prefers-reduced-motion, 'full' all of it, 'subtle' half the sway and bounce and shorter
 * animations, 'reduced' cuts instead of animating (DESIGN "Specification: geometry, layout and motion", Motion). Added by
 * M7-C.
 */
export type MotionIntensity = 'system' | 'full' | 'subtle' | 'reduced';

/** Every motion intensity, in the picker's order (Settings.motion). Added by M7-C. */
export const MOTION_INTENSITIES: readonly MotionIntensity[] = ['system', 'full', 'subtle', 'reduced'];

/** Which card back to draw (DESIGN "Card data and images", Card back). Added by M5-C. */
export type CardBackChoice = 'spellplane' | 'official';

/**
 * A one-time hint (PLAN M5-P5 first-run hints; PLAN Milestone 5, owner decisions: "a one-time hint on iPad and iPhone
 * explaining why" to add Spellplane to the Home Screen; M5-P3 storage-persistence prompt). Added by M5-C; packages may
 * add ids here through the contracts owner, and a stored id this build does not know is ignored.
 */
export type HintId = 'welcome' | 'tableKeys' | 'touchGestures' | 'talkKey' | 'installHomeScreen' | 'persistStorage' | CoachMarkId | M8HintId;

/**
 * Hints added by M8-C: the name chip and the storage toast after the first finished game (journey.md J-C), Sparring's
 * coach mark on the primary button (computer.md; contracts.md Part G "Computer opponent" item 2), the lobby privacy
 * and ranked honour notices (matchmaking.md 2.10).
 */
export type M8HintId = 'nameChip' | 'storageAfterGame' | 'coachSparring' | 'lobbyPrivacy' | 'rankedHonour';

/**
 * Gesture coach marks (PLAN M7-P5 "gesture coach marks"; docs/design/m7-hud-proposal.md, First-run hints: "One coach
 * mark at a time, anchored to the thing it explains … They disappear once you've done it"). Each is a HintId, so
 * `hintsSeen` remembers it once done or dismissed. Added by M7-C; implementer: M7-P5 (ui/hints/*).
 */
export type CoachMarkId =
  | 'coachPlayLand'
  | 'coachDraw'
  | 'coachTap'
  | 'coachSelect'
  | 'coachAttack'
  | 'coachLife'
  | 'coachNextStep'
  | 'coachTilt'
  | 'coachPileActions';

/** The coach marks in the order a newcomer meets them (docs/design/m7-hud-proposal.md, First-run hints: "Drag a land from your hand onto the table", then "Click your library to draw", then "Select a creature and press Attack"). Added by M7-C. */
export const COACH_MARK_IDS: readonly CoachMarkId[] = ['coachPlayLand', 'coachDraw', 'coachTap', 'coachSelect', 'coachAttack', 'coachLife', 'coachNextStep', 'coachTilt', 'coachPileActions'];

/** Every hint id this build knows (backup import keeps only these). Added by M7-C. */
export const HINT_IDS: readonly HintId[] = ['welcome', 'tableKeys', 'touchGestures', 'talkKey', 'installHomeScreen', 'persistStorage', ...COACH_MARK_IDS, 'nameChip', 'storageAfterGame', 'coachSparring', 'lobbyPrivacy', 'rankedHonour'];

/** Talk defaults (DESIGN "Decision log": push-to-talk; hold V). Added by M3-C. */
export const DEFAULT_TALK: TalkSettings = { gate: 'ptt', voice: true, dictation: false, muted: false, mouseButton: null };

/** Defaults for every setting (DESIGN "Decision log": Paper, push-to-talk, follow toggles off). */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'plain', // M8-C: Plain is the default look and table (PLAN Milestone 8, Decisions)
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
  cardBack: 'spellplane',
  hintsSeen: [],
  talkWhileHolding: false,
  dieSides: DEFAULT_DIE_SIDES,
  look: 'plain', // M8-C
  tilt: null,
  motion: 'system',
  showFrameRate: false,
  // Added by M8-C.
  home: DEFAULT_HOME_PREFS,
  deckCardSize: 'm',
  computer: DEFAULT_COMPUTER_PREFS,
  lobbyNotify: false,
  alsoCasual: false,
  lastQueue: '1v1.constructed.casual',
  avoid: [],
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
  /**
   * Added by M5-C. The protocol version (net/messages.ts PROTOCOL_VERSION) this browser last played the room with
   * (PLAN Milestone 5, owner decisions: "A room records its protocol version"). Absent on records written before M5:
   * read as 1. M5-P6 writes and checks it (net/version.ts).
   */
  protocol?: number;
  /** Added by M8-C. The play count at `snapshotSeq` (contracts.md Part D: moves only, never hashed); absent on saves made before M8 (read as 0). */
  snapshotPlay?: number;
  /** The newest head a verified peer ever reported for this table (persistence.md section 5; contracts.md Part G item 3); kept with the save, cleared by a claim that replaces that peer and by `playOn`. */ // [M8-P5]
  knownHead?: { play: number; seq: number; peer: string; seat: SeatId | null } | null; // [M8-P5]
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
  /**
   * Added by M6-C. The `Commander` section (DESIGN "Specification: card data, packs and draft formats", Decklist grammar;
   * GAPS 16: parsed, then dropped): kept with the deck, listed apart from `main`; at the table the commander starts in
   * the command zone. Absent on decks saved before M6 means none. Implementer: M6-P5 (keeping it), M6-P3 (the command zone).
   */
  commander?: CardRef[];
  /** Added by M6-C. The `Companion` section (as `commander`): kept with the deck, outside the game until brought in. Implementer: M6-P5. */
  companion?: CardRef[];
  /** Added by M8-C. Custom or sealed; absent on older records (decks.md section 7: migrateDeckRecord). */
  kind?: DeckKind;
  /** Added by M8-C. The deck's target size. */
  size?: DeckSize;
  /** Added by M8-C. What makes a sealed deck sealed. */
  seal?: DeckSeal;
  /** Added by M8-C. Custom decks only: the maybe-board. */
  maybe?: CardRef[];
  /** Added by M8-C. The player's chosen cover; absent means automatic. */
  cover?: CardRef;
  /** Added by M8-C. At most 2,000 characters. */
  notes?: string;
  /** Added by M8-C. Derived facts so tiles, Home and the queue need no card data. */
  summary?: DeckSummary;
  /** Added by M8-C. On a custom deck made by "Convert to custom deck". */
  convertedFrom?: { id: string; name: string; at: number; via: DeckSeal['via']; sets: SetCode[] };
  /** Added by M8-C. When the deck last went to a table. */
  lastPlayedAt?: number;
  /** Added by M8-C. Practice runs against the Dummy (computer.md section 11; later). */
  practice?: PracticeStats;
}

/** Custom or sealed (decks.md section 7). Added by M8-C. */
export type DeckKind = 'custom' | 'sealed';
/** A deck's target size (decks.md section 7). Added by M8-C. */
export type DeckSize = 40 | 60 | 100;
/** The five strength bands, in order 1 to 5 (decks.md section 5). Added by M8-C. */
export type StrengthBand = 'rough' | 'casual' | 'solid' | 'tuned' | 'fierce';

/** What makes a sealed deck sealed; never edited after `revealed` reaches the pack total (decks.md section 7). Added by M8-C. */
export interface DeckSeal {
  /** Packs opened alone in Deck mode, or a pool drafted or opened at a table. */
  via: 'packs' | 'draft';
  /** The set of each pack, in opening order. */
  sets: SetCode[];
  /** Every card the boosters gave, in pack order. Dispensed basics are not part of it. */
  pool: CardRef[];
  /** `via: 'packs'`: 64 hex characters; pack i draws from ByteStream(`${seed}:${i}`). */
  seed?: string;
  /** `via: 'packs'`: PACK_GENERATOR_VERSION when the pool was made. */
  generator?: number;
  /** `via: 'draft'`: the draft format and, when known, the room. */
  draft?: { format: DraftFormat; roomId?: string };
  /** ms epoch. */
  sealedAt: number;
  /** Packs shown by the opening animation so far; the pack total when done. */
  revealed: number;
}

/** A deck's strength, 1 to 100 in five bands (decks.md section 5). Added by M8-C. */
export interface DeckStrength {
  /** STRENGTH_VERSION. */
  v: number;
  /** 1..100. */
  score: number;
  band: StrengthBand;
  /** Each 0..1. */
  parts: { quality: number; curve: number; interaction: number; consistency: number; mana: number };
  basis: 'rank' | 'rarity' | 'mixed';
  /** The main deck has at least `size` cards. */
  complete: boolean;
}

/** Derived facts kept on the record so tiles, the landing hero and the queue need no card data (decks.md section 7; PLAN M8-C "with fan"). Added by M8-C. */
export interface DeckSummary {
  /** DECK_SUMMARY_VERSION; an older one is recomputed on sight. */
  v: number;
  /** The record's `updatedAt` it was computed for. */
  at: number;
  cards: number;
  lands: number;
  /** Colours with at least 8 % of the coloured symbols, WUBRG order; empty for colourless. */
  colours: ('W' | 'U' | 'B' | 'R' | 'G')[];
  /** Non-land cards by mana value, 8 buckets. */
  curve: number[];
  avgMv: number;
  /** Cards whose data was missing. */
  unknown: number;
  strength: DeckStrength | null;
  simple: boolean;
  /** Largest number of copies of one card that is not a basic land. */
  maxCopies: number;
  cover: CardRef | null;
  /** The cards of the hero's and the tile's fan (kit CardFan), front first, at most five; the cover first when set. */
  fan: CardRef[];
}

/** Practice runs of a deck against the Dummy (computer.md section 11). Added by M8-C. */
export interface PracticeStats {
  runs: number;
  best: number;
  /** The last 10 kill turns, newest last. */
  recent: number[];
}

/** Format tag of an exported deck library file (DESIGN "Pre-game", Local deck library: exportable and importable as files). Added by M2-C. */
export const LIBRARY_FILE_FORMAT = 'spellplane-decks';

/** Current version of the library file (M2-P6 bumps it with a migration). Added by M2-C. 2: M8 deck fields (decks.md section 7); the reader accepts 1 and 2. */
export const LIBRARY_FILE_VERSION = 2;

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

/**
 * Format tag of a backup file (PLAN Milestone 5, owner decisions, Installable on iPad: "lets decks and saved tables be
 * exported to a file and imported again", because Safari deletes a site's storage after 7 days without a visit). Added
 * by M5-C; implementer: M5-P3 (store/backup.ts).
 */
export const BACKUP_FILE_FORMAT = 'spellplane-backup';

/** Current version of the backup file (a later version bumps it with a reader for the older one). Added by M5-C. */
export const BACKUP_FILE_VERSION = 1;

/**
 * The identity in a backup file (DESIGN "Players, seats and formats", Identity: a returning key pair reclaims its
 * seat). Key pair as JWK, never CryptoKey objects (CLAUDE.md: keychain prompts in WebKit). Added by M5-C.
 */
export interface ExportedIdentity {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  peerId: string;
  nickname: string;
  seatColour: number;
}

/** One saved table in a backup file: everything `TableStore.loadTable` restores, plus the full log (DESIGN "Multiplayer architecture", Resume). Added by M5-C. */
export interface SavedTableExport {
  table: TableRecord;
  /** Every stored log record of the room, ascending. */
  log: LogRecord[];
  /** The owner's own secret store of that room (it stays with its owner: the file is the player's own copy). */
  secrets: SecretStore | null;
}

/**
 * A backup file, plain JSON (PLAN Milestone 5, owner decisions, Installable on iPad). Decks reuse `DeckRecord`; the
 * deck-only `LibraryFile` stays readable as before. Added by M5-C; implementer: M5-P3.
 */
export interface BackupFile {
  format: typeof BACKUP_FILE_FORMAT;
  version: number;
  /** ms epoch of the export. */
  exportedAt: number;
  decks: DeckRecord[];
  tables: SavedTableExport[];
  /** Present when tables are exported: without the key pair a restored table could not reclaim its seat. */
  identity?: ExportedIdentity;
  /** The settings, when the player chose to include them. */
  settings?: Partial<Settings>;
  /** Added by M8-C: History summaries of the exported games (persistence.md section 3). */
  games?: GameSummary[];
  /** Added by M8-C: ratings (matchmaking.md 2.10). */
  ratings?: RatingRecord[];
  /** Added by M8-C: formed matches (matchmaking.md 2.10). */
  matches?: MatchRecord[];
  /** Added by M8-C: computer games; they travel with their tables (computer.md C0). */
  computer?: ComputerGameRecord[];
}

/** Result of reading a backup file: what to restore and one message per entry that was skipped (M5-P3). Added by M5-C. */
export interface BackupImport {
  decks: DeckRecord[];
  tables: SavedTableExport[];
  identity: ExportedIdentity | null;
  settings: Partial<Settings>;
  /** Added by M8-C. */
  games: GameSummary[];
  /** Added by M8-C. */
  ratings: RatingRecord[];
  /** Added by M8-C. */
  matches: MatchRecord[];
  /** Added by M8-C. */
  computer: ComputerGameRecord[];
  errors: { where: string; message: string }[];
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

// ---------------------------------------------------------------------------------------------------------------
// M8 stores (added by M8-C): games (History), ratings, matches, computer.
// ---------------------------------------------------------------------------------------------------------------

/** The public battlefield as outlines for a History thumbnail: at most 80 cards `[x, y, tapped, seatIndex]` in a w × h table frame (persistence.md section 3). Added by M8-C. */
export interface GameThumb {
  w: number;
  h: number;
  cards: [number, number, 0 | 1, number][];
}

/** One game in History: what History shows and what re-entry needs, without loading the table (persistence.md section 3; PLAN M8-C Store row). Added by M8-C. */
export interface GameSummary {
  /** Game code = room id = key of tables, log and secrets. */
  code: string;
  /** Room key; '' for a solo or practice game. */
  key: string;
  kind: 'private' | 'matched' | 'solo';
  format: Format;
  decks: 'constructed' | 'draftLive' | 'draftPrebuilt';
  /** Only if the player renamed the game. */
  title?: string;
  /** Own seat. */
  seat: SeatId | null;
  /** Own deck record used at Ready, if any. */
  deck?: { id: string; name: string };
  players: { seat: SeatId; name: string; colour: SeatColourIndex; team?: TeamId; life: number; away: boolean; me: boolean }[];
  stage: Stage;
  /** TableState.games ?? 0. */
  game: number;
  /** TableState.turn.number. */
  turn: number;
  /** Whose turn. */
  active: SeatId | TeamId | null;
  /** Own head. */
  seq: number;
  /** State hash at seq. */
  hash: string;
  /** The newest head any verified peer reported (contracts.md Part G "Rejoin" item 3), with its play count. */
  knownHead: { play: number; seq: number; name: string } | null;
  /** Own hidden cards cannot be named. */
  handLost: boolean;
  recoveries: number;
  takeovers: number;
  createdAt: number;
  lastPlayedAt: number;
  savedAt: number;
  leftAt?: number;
  endedAt?: number;
  /** Soft delete while the undo toast is up. */
  deletedAt?: number;
  compactedBelow?: number;
  /** Rough size of this game's records. */
  bytes: number;
  /** Public battlefield outlines (persistence.md section 3, "GameSummary gains"). */
  thumb?: GameThumb | null;
  /** Solo games: who the opponent was. */
  opponent?: 'sparring' | 'dummy';
  /** Copied from TableState.result. */
  result?: TableState['result'];
  /** How the game ended for History: a result, or replaced by a newer solo game (contracts.md Part E). */
  ended?: 'result' | 'replaced';
  /** Own actions, for the purge rule (fewer than 10: a left solo game is purged) (contracts.md Part E). */
  actions: number;
}

/** The `games` store (persistence.md section 3; contracts.md Part E). Implementer: M8-P2 (M8-C lands the basics). Added by M8-C. */
export interface GameStore {
  create(meta: Pick<GameSummary, 'code' | 'key' | 'kind' | 'format' | 'decks'> & Partial<GameSummary>): Promise<void>;
  put(summary: GameSummary): Promise<void>;
  get(code: string): Promise<GameSummary | null>;
  /** Newest first by lastPlayedAt; without soft-deleted ones. */
  list(): Promise<GameSummary[]>;
  /** Soft delete; `purge` removes games, tables, log and secrets records in one transaction. */
  remove(code: string, at: number): Promise<void>;
  restore(code: string): Promise<void>;
  purge(code: string): Promise<void>;
  /** Mark older unfinished solo games ended ('replaced') and keep the newest `keep` resumable (contracts.md Part G "History" item 1). */
  endOlderSolo(keep: number): Promise<void>;
}

/** The `ratings` store, one record per rating key (matchmaking.md 2.10). Implementer: M8-P7. Added by M8-C. */
export interface RatingStore {
  /** The record, or null before the first ranked game of that key. */
  get(key: RatingKey): Promise<RatingRecord | null>;
  put(record: RatingRecord): Promise<void>;
  list(): Promise<RatingRecord[]>;
}

/** The `matches` store, key roomId (matchmaking.md 2.10). Implementer: M8-P7. Added by M8-C. */
export interface MatchStore {
  get(roomId: string): Promise<MatchRecord | null>;
  put(record: MatchRecord): Promise<void>;
  list(): Promise<MatchRecord[]>;
  delete(roomId: string): Promise<void>;
}

/** A game against the computer, key roomId (computer.md 10.1). Added by M8-C. */
export interface ComputerGameRecord {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  bot: {
    config: BotConfig;
    /** JWK pair, peerId, nickname 'Sparring', seatColour; never a CryptoKey. */
    identity: ExportedIdentity;
    seat: SeatId;
    deck: { name: string; choice: OpponentDeckChoice; main: CardRef[] };
  };
  human: { deckId: string | null; deckName: string };
  result?: { winner: 'human' | 'bot'; turn: number; at: number };
}

/** The `computer` store (computer.md C0). Implementer: M8-P6. Added by M8-C. */
export interface ComputerStore {
  get(roomId: string): Promise<ComputerGameRecord | null>;
  put(record: ComputerGameRecord): Promise<void>;
  delete(roomId: string): Promise<void>;
  list(): Promise<ComputerGameRecord[]>;
}

/** The IndexedDB schema (version 2 since M8: the eight stores of the persistence table plus games, ratings, matches and computer; DESIGN "Local persistence"). */
export interface SpellplaneDB extends DBSchema {
  /** Added by M8-C (DB_VERSION 2). */
  games: { key: string; value: GameSummary; indexes: { lastPlayedAt: number } };
  /** Added by M8-C (DB_VERSION 2). */
  ratings: { key: string; value: RatingRecord };
  /** Added by M8-C (DB_VERSION 2). */
  matches: { key: string; value: MatchRecord };
  /** Added by M8-C (DB_VERSION 2). */
  computer: { key: string; value: ComputerGameRecord };
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

/** The match and rating records live in core (store may not import net); re-exported here for the stores (matchmaking.md 2.13). Added by M8-C. */
export type { MatchPlayer, MatchRecord, RatingRecord, RatingKey, QueueId, Band, BotConfig, BotLevel, BotPace } from '../core/types';
