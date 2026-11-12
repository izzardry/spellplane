/**
 * Props of the app shell src/ui/App.svelte (PLAN M0-P4 HUD, M0-P7 wiring in main.ts; DESIGN "Technology stack and
 * project structure": Svelte draws the HUD around the imperative scene).
 */
import type { CardDataSource, FaceSource, ParseResult } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { createTableScene } from '../scene/index';
import type { Transport } from '../net/transport';
import type { TableSession } from '../session/types';
import type { DeckStore, IdentityStore, SettingsStore, TableRecord } from '../store/types';

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
