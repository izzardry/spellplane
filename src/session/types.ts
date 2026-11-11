/**
 * The TableSession API (PLAN M0-P7 Solo session; DESIGN "Specification: code interfaces", Reducer contract: private
 * effects run in the owner's client around the reducer; "Turn flow and confirmation", Undo). Implementer: M0-P7;
 * consumers: the HUD (M0-P4) and the debug hook. Milestone 1 plugs the sequencer and sync in behind the same API.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { CardRef, InstanceId, LogEntry, SecretStore, SeatId, TableState, ZoneId } from '../core/types';
import type { CardData, CardDataSource } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { TableStore } from '../store/types';

/** A deck to import as the seat's library (DESIGN "Pre-game", Constructed decks). */
export interface DeckImport {
  main: CardRef[];
  side: CardRef[];
}

/** A card seen in a private look (DESIGN "Multiplayer architecture", Private looks). */
export interface LookedCard {
  id: InstanceId;
  ref: CardRef;
}

/** Listener for state changes (DESIGN "Technology stack and project structure": scene and HUD are views of state). */
export type SessionListener = (state: TableState) => void;

/** One player's game client (PLAN M0-P7). */
export interface TableSession {
  /** The local player's seat. */
  readonly seat: SeatId;
  getState(): TableState;
  /** Called after every applied action (including undo); returns an unsubscribe function. */
  subscribe(listener: SessionListener): () => void;
  /** The local player's own secret store; never another seat's. */
  secrets(): SecretStore;
  /** Card data for a ref from the cache, or null while loading. */
  cardData(ref: CardRef): CardData | null;
  /**
   * Stamp (`by` = own seat, fresh `cid`, `seq`) and apply a public action; returns the stamped action.
   * Moving or flipping up a card whose identity only this browser holds first emits the matching `reveal`.
   */
  dispatch(action: ActionDraft): Action;
  /** Commit the deck (ready) and create the hidden library; identities stay in the secret store. */
  importDeck(deck: DeckImport): Promise<void>;
  /** Secret shuffle of an own hidden zone (library by default). */
  shuffle(zone?: ZoneId): Promise<void>;
  /** Draw `n` (default 1) from the top of the own library into the hand. */
  draw(n?: number): Promise<void>;
  /** London mulligan: hand into library, shuffle, draw seven. */
  mulligan(): Promise<void>;
  /** Logged private look at the top `n` cards of an own zone. */
  lookAt(zone: ZoneId, n: number): Promise<LookedCard[]>;
  /** Revert the own most recent undoable action (or group); false if nothing to undo. */
  undo(): boolean;
  canUndo(): boolean;
  log(): LogEntry[];
  /** Stop timers and listeners. */
  dispose(): void;
}

/** Options for the solo session (PLAN M0-P7). */
export interface SoloSessionOptions {
  game: GameDefinition;
  cardData: CardDataSource;
  /** Persistence; omitted in unit tests. */
  store?: TableStore;
  /** Defaults to 'solo'. */
  roomId?: string;
  playerName?: string;
}

/** Create or restore the solo table (PLAN M0-P7). */
export type CreateSoloSession = (opts: SoloSessionOptions) => Promise<TableSession>;
