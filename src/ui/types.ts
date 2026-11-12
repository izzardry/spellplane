/**
 * Props of the app shell src/ui/App.svelte (PLAN M0-P4 HUD, M0-P7 wiring in main.ts; DESIGN "Technology stack and
 * project structure": Svelte draws the HUD around the imperative scene).
 */
import type { CardRef, DeckBuild, TableState } from '../core/types';
import type { CardData, CardDataSource, FaceSource, ParseResult, SetDataSource } from '../data/types';
import type { DraftControls } from '../draft/types';
import type { GameDefinition } from '../games/types';
import type { createTableScene } from '../scene/index';
import type { BuilderSort, CreateBuilderSurface, CreateDraftSurface } from '../scene/types';
import type { Theme } from '../themes/types';
import type { Transport } from '../net/transport';
import type { EveningControls, TableSession } from '../session/types';
import type { DeckRecord, DeckStore, IdentityStore, SettingsStore, TableRecord } from '../store/types';

/** What main.ts hands the app shell (PLAN M0-P4, M0-P7). */
export interface AppProps {
  session: TableSession;
  createScene: typeof createTableScene;
  faces: FaceSource;
  cardData: CardDataSource;
  game: GameDefinition;
  /** Persists keymap remapping (DESIGN "Input and interaction design": all keys remappable). Added by M0-P4; without it remaps last for the page. */
  settings?: SettingsStore;
  /** data/'s decklist parser (M0-P2) for the deck import dialog. Added by M0-P4; without it a plain "4 Name" parser is used. */
  parseDecklist?: (text: string) => ParseResult;
  /** The share link of a networked table (`#/t/<roomId>/<roomKey>`), shown by the lobby. Added by M1-C; absent for the solo table. */
  link?: RoomLink;
  /** Nickname and preferred seat colour for the lobby (DESIGN "Players, seats and formats", Identity). Added by M1-C. */
  identity?: IdentityStore;
  /** The local deck library for deck selection before Ready (DESIGN "Pre-game", Local deck library). Added by M1-C. */
  decks?: DeckStore;
  /** The start page at `#/lobby`. Added by M1-C. */
  start?: StartPageProps;
  /** The connection check at `#/diag`. Added by M1-C. */
  diag?: DiagProps;
  /** MTGJSON sets for the lobby's set picker (DESIGN "Pre-game", Lobby settings). Added by M2-C; wired by M2-P7 in main.ts. */
  sets?: SetDataSource;
}

/**
 * A table link (DESIGN "Specification: network protocol and secrecy", Room): room id of three random words and a
 * two-digit number, room key of 16 random bytes base64url, both in the URL fragment so they never reach the host.
 * Added by M1-C.
 */
export interface RoomLink {
  roomId: string;
  roomKey: string;
  /** Absolute link `<base>/#/t/<roomId>/<roomKey>`. */
  url: string;
}

/**
 * The start page at `#/lobby` (DESIGN "Multiplayer architecture", Rooms and connection: a table is a link; PLAN M1-P5
 * create table, share link, nickname). Added by M1-C; implementer: M1-P5 (ui/lobby/*), wired by M1-P8 in main.ts.
 */
export interface StartPageProps {
  identity: IdentityStore;
  /** A fresh random room (ui/lobby/room.ts newRoom). */
  newRoom(): RoomLink;
  /** A pasted table link, or null when the text is not one. */
  parseLink(text: string): RoomLink | null;
  /** Saved networked tables, most recently updated first, to resume (DESIGN "Multiplayer architecture", Resume). */
  savedTables(): Promise<TableRecord[]>;
  /** Go to a table (sets `location.hash`). */
  open(link: RoomLink): void;
}

/**
 * The in-table lobby panel shown while the stage is 'lobby' (DESIGN "Players, seats and formats", Seats: the table from
 * above with empty chairs, seat colour; PLAN M1-P5 chair selection, deck selection and Ready with commitment, pairwise
 * connectivity check). Added by M1-C; implementer: M1-P5. Connectivity comes from `session.netStatus()`.
 */
export interface LobbyProps {
  session: TableSession;
  game: GameDefinition;
  link: RoomLink;
  identity: IdentityStore;
  decks: DeckStore;
  cardData: CardDataSource;
  parseDecklist?: (text: string) => ParseResult;
}

/**
 * The connection check at `#/diag` (PLAN M1 Connectivity check: joins a room and reports time to connect). Added by
 * M1-C; implementer: M1-P5.
 */
export interface DiagProps {
  /** A transport for the diagnostics room: Trystero in production, BroadcastTransport with `?transport=local`. */
  createTransport(): Transport;
  /** The room to join; null starts a fresh one whose link the page shows, so a second machine can join it. */
  room: { roomId: string; roomKey: string } | null;
  /** Local clock in ms. */
  now(): number;
}

/** What `#/diag` reports (PLAN M1 Connectivity check; DESIGN "Multiplayer architecture": the lobby says plainly when a pair cannot connect). Added by M1-C. */
export interface DiagReport {
  roomId: string;
  /** ms from start until the room was joined, null while joining. */
  joinedAfterMs: number | null;
  /** Each peer seen, with ms from start until its connection opened and a round-trip time over `ctl`. */
  peers: { peer: string; connectedAfterMs: number; rttMs: number | null }[];
  /** A plain failure message (no peer after the timeout, signalling unreachable), else null. */
  error: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Draft, builder and evening flow (DESIGN "Pre-game: draft, sealed and deck building"; "Specification: card data, packs
// and draft formats", Evening stages). Added by M2-C. Owners: M2-P4 (ui/draft/*: lobby settings panel, draft HUD),
// M2-P5 (ui/builder/stats.svelte), M2-P6 (ui/builder/list/*), M2-P7 (ui/flow/*: the stage switch and next-game prompts).
// ---------------------------------------------------------------------------------------------------------------------

/** Mana colours plus colourless, as the builder counts them (DESIGN "Pre-game", Deck building: colour split). */
export type ManaColour = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

/** The limited minimum, shown as a hint and never enforced (DESIGN "Pre-game", Deck building). */
export const LIMITED_MINIMUM = 40;

/** Highest mana value with its own curve bucket; the last bucket counts this and above (DESIGN "Pre-game", Deck building: mana curve). */
export const CURVE_MAX = 7;

/**
 * The builder's live readout (DESIGN "Pre-game", Deck building: "card count, mana curve, colour split and land count";
 * PLAN M2-P5: matches a hand-computed fixture pool). Computed from the main deck only. Implementer: M2-P5.
 */
export interface BuilderStats {
  /** Cards in the main deck. */
  cards: number;
  /** Lands among them (type line contains "Land"). */
  lands: number;
  /** Non-land cards by mana value: index 0..CURVE_MAX, the last bucket holding CURVE_MAX and above. */
  curve: number[];
  /** Coloured mana symbols in the main deck's costs by colour; 'C' counts generic-free colourless symbols ({C}). */
  colours: Record<ManaColour, number>;
  /** Below LIMITED_MINIMUM (the hint shows). */
  belowMinimum: boolean;
}

/** Props of the lobby settings panel (DESIGN "Pre-game", Lobby settings). Implementer: M2-P4 (ui/draft/*). */
export interface LobbySettingsProps {
  session: TableSession;
  evening: EveningControls;
  sets: SetDataSource;
}

/** Props of the draft HUD around the draft surface (DESIGN "Pre-game", Drafting interaction). Implementer: M2-P4 (ui/draft/*). */
export interface DraftProps {
  session: TableSession;
  draft: DraftControls;
  createSurface: CreateDraftSurface;
  faces: FaceSource;
  cardData: CardDataSource;
  theme: Theme;
}

/** Which builder view is showing (DESIGN "Pre-game", Deck building: two views of the same pool, switchable at any time). */
export type BuilderViewKind = 'table' | 'list';

/** Props of the builder, both views (DESIGN "Pre-game", Deck building). Implementers: M2-P5 (table view, stats), M2-P6 (list view, library). */
export interface BuilderProps {
  session: TableSession;
  draft: DraftControls;
  createSurface: CreateBuilderSurface;
  faces: FaceSource;
  cardData: CardDataSource;
  theme: Theme;
  decks?: DeckStore;
}

/** Props of the list view (DESIGN "Pre-game", Deck building: "a compact two-column list (pool and deck) with filters and counts"). Implementer: M2-P6. */
export interface ListViewProps {
  build: DeckBuild;
  /** Write the changed build back (DraftControls.setBuild), so the table view shows the same deck. */
  onChange(build: DeckBuild): void;
  card(ref: CardRef): CardData | null;
  sort: BuilderSort;
  /** Scryfall search-and-add (CardDataSource.searchCards), absent when unavailable. */
  search?(query: string): Promise<CardData[]>;
  /** The local deck library (DESIGN "Pre-game", Local deck library: decks and drafted pools), absent when the browser blocks storage. Added by M2-P6. */
  decks?: DeckStore;
  /** Where a drafted or sealed pool came from: a saved pool is then a 'drafted' record with this origin (store/types.ts DeckRecord). Added by M2-P6. */
  origin?: DeckRecord['origin'];
}

/** Props of the stage flow (DESIGN "Specification: card data, packs and draft formats", Evening stages). Implementer: M2-P7 (ui/flow/*). */
export interface FlowProps {
  session: TableSession;
  evening: EveningControls;
  state: TableState;
}
