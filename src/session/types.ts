/**
 * The TableSession API (PLAN M0-P7 Solo session; DESIGN "Specification: code interfaces", Reducer contract: private
 * effects run in the owner's client around the reducer; "Turn flow and confirmation", Undo). Implementer: M0-P7;
 * consumers: the HUD (M0-P4) and the debug hook. Milestone 1 plugs the sequencer and sync in behind the same API.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { CardRef, Format, InstanceId, LobbySettings, LogEntry, Pose, RngPurpose, SecretStore, SeatColourIndex, SeatId, TableState, ZoneId } from '../core/types';
import type { CardData, CardDataSource, GeneratePack, SetDataSource } from '../data/types';
import type { DraftControls } from '../draft/types';
import type { GameDefinition } from '../games/types';
import type { ChatChannel } from '../net/messages';
import type { Transport } from '../net/transport';
import type { ConnectionStatus, NetEngine, PeerInfo, Presence } from '../net/types';
import type { IdentityRecord, TableStore } from '../store/types';

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

/**
 * The table's connection as the HUD shows it (DESIGN "Multiplayer architecture", Rooms and connection, Resume: away
 * seats; "Specification: network protocol and secrecy", Liveness). Added by M1-C. Away seats are `Seat.away` in the
 * shared state; this is the local view of the peers behind them.
 */
export interface SessionNetStatus {
  mode: 'solo' | 'net';
  /** 'solo' for the solo table. */
  connection: ConnectionStatus | 'solo';
  /** Other peers (empty in solo play). */
  peers: PeerInfo[];
  /** Identity peer id of the sequencer, null in solo play or while unknown. */
  sequencer: string | null;
  /** Last seq applied in order. */
  seq: number;
}

/** Listener for the network status (DESIGN "Multiplayer architecture"). Added by M1-C. */
export type NetStatusListener = (status: SessionNetStatus) => void;

/** One player's game client (PLAN M0-P7; M1-P8 networked). */
export interface TableSession {
  /**
   * The local player's seat. In a networked session this is the chair the key pair holds: the session resolves once
   * it reclaimed its chair or took the lowest free one, and `takeSeat` may change it later (M1-C decision).
   */
  readonly seat: SeatId;
  /** The table's room id ('solo' for the solo table). Added by M1-C. */
  readonly roomId: string;
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
   * Networked (M1-P8): applied optimistically and proposed to the sequencer; `seq` is set once sequenced, and a
   * refused proposal is rolled back with a system log line. A `revealTo` of an own hidden card also sends its identity
   * to those seats on the pair channel only. Ask, hold, release and OK are plain `ask`/`respond` drafts.
   */
  dispatch(action: ActionDraft): Action;
  /**
   * Put an own hand or library card onto a battlefield or into exile face down, keeping its identity in this browser
   * (DESIGN "Table model", Face-down). No `reveal`; turning it up or moving it into a zone that shows faces reveals it.
   * Added by M1-C from SoloSession (M0-P7 proposal).
   */
  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action;
  /** Send a chat line on a tab (default 'table') as a `chat` action (DESIGN "Chat and voice", Text chat). Added by M1-C. */
  chat(text: string, channel?: ChatChannel): Action;
  /**
   * Take (or move to) a free chair with a seat colour, using the identity's nickname (DESIGN "Players, seats and
   * formats", Seats). Added by M1-C; the solo session refuses it with a warning.
   */
  takeSeat(seat: SeatId, colour: SeatColourIndex): Action;
  /**
   * A die roll or coin flip by commit-and-reveal among the connected seated players (DESIGN "Specification: network
   * protocol and secrecy", Public randomness); resolves with the 0-based outcome in [0, n). Added by M1-C;
   * implementer: M1-P8 on M1-P2's protocol.
   */
  roll(purpose: RngPurpose, n: number): Promise<number>;
  /** Own cursor, drag and typing out; other players' presence in (DESIGN "Players, seats and formats", Other players' cursors). A no-op in solo play. Added by M1-C. */
  readonly presence: Presence;
  /** The connection and the peers behind the seats. Added by M1-C. */
  netStatus(): SessionNetStatus;
  /** Called when the network status changes; returns an unsubscribe function. Added by M1-C. */
  subscribeNet(listener: NetStatusListener): () => void;
  /** Resolves once every action applied so far has been written to the local store (immediately without one). Added by M1-C from SoloSession. */
  whenSaved(): Promise<void>;
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
  /**
   * The draft and the builder for this seat (DESIGN "Pre-game: draft, sealed and deck building"). Added by M2-C;
   * present once M2-P7 wires the draft drivers into the session (absent on sessions without set data).
   */
  readonly draft?: DraftControls;
  /** The evening's stage flow (DESIGN "Specification: card data, packs and draft formats", Evening stages). Added by M2-C; implementer: M2-P7. */
  readonly evening?: EveningControls;
}

/**
 * Stage flow for the HUD (DESIGN "Specification: card data, packs and draft formats", Evening stages: the host advances
 * from lobby, draft advances automatically, build advances when all seated players are Ready, from match any player
 * proposes "next game" or "new draft" and the others confirm; PLAN M2-P7: rematch and a new draft on the same link).
 * Added by M2-C; implementer: M2-P7 (session wiring, ui/flow/*).
 */
export interface EveningControls {
  /** Host only, in the lobby: replace the lobby settings (`lobbySet`). */
  setLobby(lobby: LobbySettings): Action;
  /** Host only: leave the lobby for the draft, or straight for a match with constructed decks (core/stage.ts nextStage 'start'). */
  start(): Action;
  /**
   * From a match: ask the others to confirm the next game (or rematch: back to the builder to sideboard) or a new draft
   * (back to the lobby); resolves true once the stage changed, false when someone held or the round was replaced.
   */
  propose(event: 'nextGame' | 'newDraft'): Promise<boolean>;
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
  /** MTGJSON set data for drafts (M2-P1); without it the session offers no `draft`. Added by M2-C. */
  sets?: SetDataSource;
  /** Pack generation (M2-P1). Added by M2-C. */
  generatePack?: GeneratePack;
}

/** Create or restore the solo table (PLAN M0-P7). */
export type CreateSoloSession = (opts: SoloSessionOptions) => Promise<TableSession>;

/** The key pair and profile a networked session joins with (DESIGN "Players, seats and formats", Identity; store/types.ts IdentityRecord). Added by M1-C. */
export type SessionIdentity = Pick<IdentityRecord, 'keyPair' | 'peerId' | 'nickname' | 'seatColour'>;

/**
 * Options for a networked table (DESIGN "Multiplayer architecture"; PLAN M1-P8). Added by M1-C. The room id and key
 * come from the link `#/t/<roomId>/<roomKey>` (DESIGN "Specification: network protocol and secrecy", Room).
 */
export interface NetSessionOptions {
  game: GameDefinition;
  cardData: CardDataSource;
  roomId: string;
  roomKey: string;
  /** Creates the room's transport: Trystero in production, BroadcastTransport with `?transport=local`, a LoopbackTransport in unit tests. */
  transport: () => Transport;
  identity: SessionIdentity;
  /** Persistence (log, table record, secret store); omitted in unit tests. */
  store?: TableStore;
  /** Format of a table this browser starts (no save and no peer); default '1v1'. */
  format?: Format;
  /** Local clock in ms; default Date.now (tests use fake timers). */
  now?: () => number;
  /** MTGJSON set data for drafts (M2-P1); without it the session offers no `draft`. Added by M2-C. */
  sets?: SetDataSource;
  /** Pack generation (M2-P1). Added by M2-C. */
  generatePack?: GeneratePack;
}

/** A networked table session: TableSession over a NetEngine (PLAN M1-P8). Added by M1-C. */
export interface NetSession extends TableSession {
  /** The engine, for the debug hook's `net` part and tests. */
  readonly engine: NetEngine;
  /** Leave the room cleanly (bye) and stop; `dispose` does the same. */
  leave(): void;
}

/** Join (or start) a networked table and resolve once it holds a chair (PLAN M1-P8). Added by M1-C. */
export type CreateNetSession = (opts: NetSessionOptions) => Promise<NetSession>;
