/**
 * Props of the table frame (docs/design/m8/contracts.md Part C "Table frame"): every table route renders
 * ui/table/TableFrame.svelte; no route builds `HudShellProps` itself. Added by M8-C; M8-P8 finishes the frame.
 */
import type { CardDataSource, FaceSource, ParseResult, SetDataSource } from '../../data/types';
import type { GameDefinition } from '../../games/types';
import type { CreateTableScene } from '../../scene/types';
import type { Matchmaker, TableSession } from '../../session/types';
import type { DeckStore, GameStore, IdentityStore, MatchStore, RatingStore, SettingsStore } from '../../store/types';
import type { HudShellProps } from '../props';
import type { RoomLink } from '../types';
import type { AppUpdate } from '../update';

/** The kinds of table a route opens (contracts.md Part C). */
export type TableKind = 'room' | 'matched' | 'computer' | 'practice' | 'sandbox';

/** What the frame hands the HUD and the stages: the page's sources and stores (main.ts AppProps). Added by M8-C. */
export interface TableDeps {
  createScene: CreateTableScene;
  faces: FaceSource;
  cardData: CardDataSource;
  game: GameDefinition;
  settings?: SettingsStore | undefined;
  parseDecklist?: ((text: string) => ParseResult) | undefined;
  sets?: SetDataSource | undefined;
  update?: AppUpdate | undefined;
  /** The waiting room's identity and deck library (networked tables). */
  identity?: IdentityStore | undefined;
  decks?: DeckStore | undefined;
  /** The matched entry's stores (matchmaking.md 2.10). */
  matches?: MatchStore | null | undefined;
  ratings?: RatingStore | null | undefined;
  /** The page's matchmaker: the match-found card and the queue bar over a computer or practice table (journey.md 4.5 "Practise while you wait"), FIND ANOTHER MATCH. */
  matchmaker?: Matchmaker | undefined; // [M8-P8]
  /** Opens a practice table (main.ts openPractice): the game-over overlay's AGAIN at a practice table. */
  openPractice?: ((roomId: string) => Promise<TableSession>) | undefined; // [M8-P8]
}

/** What the frame hands its route's `onleave` (M8-P8). */
export interface FrameLeave { // [M8-P8]
  checkpointer: { now(reason: 'leave'): Promise<void>; stop(): void; settled?(): Promise<void> };
}

/** The table frame's props (contracts.md Part C, verbatim; `deps` and `link` added by M8-C). */
export interface TableFrameProps {
  session: TableSession;
  kind: TableKind;
  /** The game code (room id); null in the sandbox. */
  code: string | null;
  /** null when storage cannot be opened. */
  games: GameStore | null;
  /** false for computer and practice tables: no Gathering, no seat presence, no invite entries. Default true for 'room' and 'matched'. */
  gather?: boolean;
  /** Extra shell members of the route (the computer game's cue button, badge and plate menu). The frame merges them over its own. */
  extraShell?: Pick<HudShellProps, 'primaryOverride' | 'plateBadge' | 'plateMenuTop' | 'menuTop'>;
  /**
   * src/ui/play/leave.ts. The frame hands its checkpointer (M8-P8, additive: the argument is optional), so leaving
   * saves first and a purge waits for the writes already queued; a returned promise settles when the leave is done.
   */
  onleave: (ctx?: FrameLeave) => void | Promise<unknown>; // [M8-P8] widened from () => void (additive: optional argument, optional promise)
  /** The game-over overlay's REMATCH of a computer game (computer.md 2.4): leaves this table for a new one; without it REMATCH proposes the next game. */ // [M8-P6]
  onrematch?: ((ctx?: FrameLeave) => void | Promise<unknown>) | undefined; // [M8-P6]
  /** Added by M8-C: the page's sources and stores; without it the frame reads the context App sets (ui/table/context.ts). */
  deps?: TableDeps | undefined;
  /** Added by M8-C: the share link of a networked table (the waiting room's invite). */
  link?: RoomLink | null | undefined;
}
