/**
 * Draft contracts (DESIGN "Pre-game: draft, sealed and deck building"; "Specification: card data, packs and draft
 * formats", Draft formats and pick timer; "Specification: network protocol and secrecy", Draft packs). Contracts: M2-C.
 *
 * The shared shapes (DraftState, packs, lobby and per-format settings, the private DraftSecrets and DeckBuild) live in
 * core/types.ts, because TableState and SecretStore hold them and core imports nothing else; they are re-exported here.
 * This file adds the client side: presets, the private view, and the seams between the session (which owns the
 * network, the secret store and persistence) and the format drivers in draft/* (M2-P2 pass and sealed, M2-P3
 * Rochester, Winston, Grid; M3-P2 the Two-Headed Giant variants).
 */
import type { Action, ActionDraft } from '../core/actions';
import type { RevealedCard } from '../core/commit';
import type { Entropy } from '../core/secrets';
import type {
  CardRef,
  DeckBuild,
  DraftCard,
  DraftFormat,
  DraftFormatSettings,
  InstanceId,
  PackId,
  SecretStore,
  SeatId,
  ShuffleId,
  TableState,
} from '../core/types';
import type { GeneratePack, SetDataSource } from '../data/types';

export type {
  DeckBuild,
  DraftCard,
  DrafterId,
  DraftFormat,
  DraftFormatSettings,
  DraftPack,
  DraftSecrets,
  DraftState,
  GridSettings,
  GridState,
  LobbySettings,
  PackRecord,
  PassDraftSettings,
  PoolCard,
  RochesterSettings,
  RochesterState,
  SealedSettings,
  SetCode,
  TeamDraftSettings,
  TeamSealedSettings,
  WinstonSettings,
  WinstonState,
} from '../core/types';
export { DEFAULT_LOBBY_SETTINGS } from '../core/types';

/** The lobby's acquisition-mode choices (DESIGN "Pre-game", mode table; Pick-Two is a pass-draft preset). */
export type DraftPresetId = 'booster' | 'pickTwo' | 'sealed' | 'rochester' | 'winston' | 'grid' | 'teamDraft' | 'teamSealed';

/** One acquisition mode as the lobby offers it (DESIGN "Pre-game", mode table: players and defaults). */
export interface DraftPreset {
  id: DraftPresetId;
  label: string;
  /** Seat counts the mode is made for (DESIGN "Pre-game", Players column). */
  seats: { min: number; max: number };
  /** Default settings (DESIGN "Specification: card data, packs and draft formats", Setup column). */
  settings: DraftFormatSettings;
}

/**
 * The modes and their defaults (DESIGN "Pre-game", mode table; "Specification: card data, packs and draft formats",
 * Draft formats). Booster draft "3–4 (works with 2)"; Pick-Two "preset for four players"; the Two-Headed Giant modes
 * are M3-P2's.
 */
export const DRAFT_PRESETS: Readonly<Record<DraftPresetId, DraftPreset>> = {
  booster: { id: 'booster', label: 'Booster draft', seats: { min: 2, max: 4 }, settings: { format: 'pass', packs: 3, picks: 1 } },
  pickTwo: { id: 'pickTwo', label: 'Pick-Two draft', seats: { min: 4, max: 4 }, settings: { format: 'pass', packs: 3, picks: 2 } },
  sealed: { id: 'sealed', label: 'Sealed', seats: { min: 2, max: 4 }, settings: { format: 'sealed', packs: 6 } },
  rochester: { id: 'rochester', label: 'Rochester draft', seats: { min: 2, max: 4 }, settings: { format: 'rochester', packs: 3, burn: 0 } },
  winston: { id: 'winston', label: 'Winston draft', seats: { min: 2, max: 2 }, settings: { format: 'winston', packs: 6 } },
  grid: { id: 'grid', label: 'Grid draft', seats: { min: 2, max: 2 }, settings: { format: 'grid', grids: 18 } },
  teamDraft: { id: 'teamDraft', label: 'Two-Headed Giant draft', seats: { min: 4, max: 4 }, settings: { format: 'teamDraft', packs: 6, picks: 2 } },
  teamSealed: { id: 'teamSealed', label: 'Two-Headed Giant sealed', seats: { min: 4, max: 4 }, settings: { format: 'teamSealed', packs: 8 } },
};

/** Cards in one grid (DESIGN "Specification: card data, packs and draft formats", Grid: nine face-up cards). */
export const GRID_CELLS = 9;

/** Winston piles (DESIGN "Specification: card data, packs and draft formats", Winston: three piles of one card). */
export const WINSTON_PILES = 3;

/** The pack in front of this browser's drafter (DESIGN "Pre-game", Drafting interaction: the current pack is a fan or grid). */
export interface FrontPack {
  packId: PackId;
  /** Its cards in pack order: own identities for a held pack, the public ones for a Rochester pack. */
  cards: DraftCard[];
  /** Face up on the shared table (Rochester) rather than in this player's hands. */
  public: boolean;
}

/**
 * What this browser shows of the draft (DESIGN "Pre-game", Drafting interaction: the pack, marked card, pool sorted by
 * colour, waiting packs; pick timer). Built by the driver from shared state plus the own SecretStore; never sent.
 */
export interface DraftPrivateView {
  format: DraftFormat | null;
  /** The pack to pick from now, null while waiting (or for Winston and Grid, whose surfaces read `pile` and the shared grid). */
  pack: FrontPack | null;
  /** Cards one confirm takes (picks per pass, or the rest of a short pack; 1 in Rochester). */
  picks: number;
  /** Marked, not yet confirmed (DraftSecrets.marked). */
  marked: InstanceId[];
  /** Packs waiting behind the front pack at this drafter. */
  queued: number;
  /** Own pool so far in pick order (SecretStore.pool). */
  pool: CardRef[];
  /** Winston: the cards of the pile this player is looking at, when it is their turn. */
  pile?: DraftCard[];
  /** The pick timer of the front pack: it runs `ms` from the moment this browser applied seq `fromSeq`; null when off. */
  timer: { fromSeq: number; ms: number } | null;
  /** Whose pick the table is waiting for (seats holding a non-empty queue, or the Rochester/Winston/Grid turn). */
  waitingOn: SeatId[];
}

/** Owner nonce, peer nonces and the seed of a pack-generation round (DESIGN "Specification: network protocol and secrecy", Secret shuffle 1-3, purpose 'pack'). */
export interface PackSeed {
  sid: ShuffleId;
  seed: string;
  ownerNonce: string;
  peerNonces: string[];
}

/**
 * What the session gives a draft driver (DESIGN "Specification: code interfaces", Reducer contract: private effects run
 * in the owner's client around the reducer). The session owns the network, the secret store and persistence; the
 * driver never touches them directly. Provided by M2-P7's session wiring; tests drive it with a fake.
 */
export interface DraftHost {
  readonly seat: SeatId;
  /** The table as this browser sees it (optimistic view). */
  state(): TableState;
  /**
   * Added by M2-P3 (optional; the session wires it to NetEngine `confirmedState`). The confirmed table: sequenced
   * actions only, without this browser's pending ones. A driver created after a reload starts from it, so it never
   * discloses a card from a state whose own actions may still be refused.
   */
  confirmedState?(): TableState;
  /** The own secret store. */
  secrets(): SecretStore;
  /** Replace the own secret store; persisted with the next save, in step with the log (DESIGN "Local persistence"). */
  setSecrets(next: SecretStore): void;
  /** Stamp and apply (optimistically, then propose) a public action. */
  dispatch(action: ActionDraft): Action;
  /**
   * Run the secret-shuffle seed protocol with purpose 'pack' (shuffleCommit, peer nonces, commit window) on the own
   * pack zone and resolve with the seed once the round is sealed (DESIGN "Specification: network protocol and secrecy",
   * Draft packs: "Pack contents are generated with the secret-shuffle seed protocol").
   */
  packSeed(): Promise<PackSeed>;
  /** Send a pack's remaining cards to `to` on the pair channel only, with its public `packPass` (net/types.ts PrivateChannel.sendPack). */
  sendPack(to: SeatId, packId: PackId, cards: readonly RevealedCard[]): void;
  /** Packs handed to this browser, already verified against the pack's commitment in shared state. */
  onPack(listener: (packId: PackId, cards: RevealedCard[], from: SeatId) => void): () => void;
  /**
   * Added by M2-P3 (optional; the session wires it to net/draftcards.ts `send`). Send draft card identities to `to`
   * only, as the pair message `draftCards {about, cards}` (DESIGN "Pre-game", Hidden information column: Winston "pile
   * contents visible to whoever looks"). `about` is the cid of the sequenced action the cards belong to, or a request
   * tag with no cards (draft/winston.ts `WINSTON_NEED`). Returns false when `to` has no connected peer (nothing sent).
   */
  sendCards?(to: SeatId, about: string, cards: readonly RevealedCard[]): boolean;
  /** Added by M2-P3 (optional). `draftCards` received from `from`, shape-checked only: the driver verifies them against the pack commitments. */
  onCards?(listener: (about: string, cards: RevealedCard[], from: SeatId) => void): () => void;
  /** Every action applied in order to the confirmed state, with that state. */
  onSequenced(listener: (action: Action, state: TableState) => void): () => void;
  /** MTGJSON set data (M2-P1). */
  readonly sets: SetDataSource;
  /** Pack generation (M2-P1). */
  readonly generatePack: GeneratePack;
  readonly entropy: Entropy;
}

/**
 * One draft format's client side (DESIGN "Specification: card data, packs and draft formats", Turn procedure column).
 * Implementers: draft/pass.ts and draft/sealed.ts (M2-P2), draft/rochester.ts, draft/winston.ts, draft/grid.ts (M2-P3).
 */
export interface DraftDriver {
  readonly format: DraftFormat;
  /**
   * Propose whatever this browser owes the table now: open own packs when a round starts, pass a pack after a pick,
   * answer a `draftTimeout` with the marked or first card, lay the next grid. Idempotent; the session calls it after
   * every applied action and after a reload.
   */
  drive(): void;
  view(): DraftPrivateView;
  /** Mark cards of the front pack (a second click or Enter confirms with `pick`). */
  mark(cards: readonly InstanceId[]): void;
  /** Confirm a pick from the front pack (pass, sealed has none, Rochester). Refused (false) when it is not this drafter's pick. */
  pick(cards: readonly InstanceId[]): boolean;
  /** Winston: take the pile looked at, or decline it. */
  pileLook?(take: boolean): boolean;
  /** Grid: take a row or column of the current grid. */
  gridTake?(line: 'row' | 'col', index: 0 | 1 | 2): boolean;
  dispose(): void;
}

/** Create the driver for the current draft's format (DESIGN "Specification: card data, packs and draft formats", Draft formats; draft/index.ts DRAFT_DRIVERS). */
export type CreateDraftDriver = (host: DraftHost) => DraftDriver;

/**
 * The draft and builder as the HUD uses them (DESIGN "Pre-game", Drafting interaction, Deck building). Offered by the
 * session as `TableSession.draft` (session/types.ts); assembled by M2-P7 from the driver and the SecretStore.
 */
export interface DraftControls {
  view(): DraftPrivateView;
  /** Called when the view changes; returns an unsubscribe function. */
  subscribe(listener: (view: DraftPrivateView) => void): () => void;
  mark(cards: readonly InstanceId[]): void;
  pick(cards: readonly InstanceId[]): boolean;
  pileLook(take: boolean): boolean;
  gridTake(line: 'row' | 'col', index: 0 | 1 | 2): boolean;
  /** The deck being built from the own pool (SecretStore.build), created from the pool on first use; null before any pool exists. */
  build(): DeckBuild | null;
  /** Replace the deck being built (builder table and list view write through here, so both stay in step). */
  setBuild(build: DeckBuild): void;
  /**
   * Ready in the builder (DESIGN "Pre-game", Deck building: Ready locks the deck and publishes its commitment): commit
   * the main deck as the library and the rest of the pool as sideboard, through the M1 `ready` path.
   */
  ready(): Promise<void>;
}
