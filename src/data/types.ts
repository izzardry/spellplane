/**
 * Card data contracts (DESIGN "Card data and images", "Specification: card data, packs and draft formats",
 * "Specification: geometry, layout and motion" texture tiers). Implementer of the sources: M0-P2.
 * CardData keeps Scryfall's snake_case field names so recorded fixtures and API responses map 1:1.
 */
import type { CardRef, ScryfallId, SetCode } from '../core/types';

export type { SetCode };

/** Scryfall image URLs per tier (DESIGN "Card data and images", Image tiers). */
export interface ImageUris {
  small: string;
  normal: string;
  large: string;
}

/** One face of a multi-faced card (DESIGN "Specification: card data, packs and draft formats": card_faces with the same fields per face). */
export interface CardFaceData {
  name: string;
  /** Per-face fields Scryfall sets only on some layouts (e.g. `reversible_card`); added by M0-P2, additive. */
  oracle_id?: string;
  layout?: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: ImageUris;
  artist?: string;
}

/** A related object from Scryfall `all_parts` (DESIGN "Card data and images", Tokens). */
export interface RelatedCard {
  id: ScryfallId;
  /** 'token', 'meld_part', 'meld_result' or 'combo_piece'. */
  component: string;
  name: string;
  type_line: string;
}

/** A trimmed Scryfall card object (DESIGN "Specification: card data, packs and draft formats", Stored fields). */
export interface CardData {
  id: ScryfallId;
  oracle_id?: string;
  name: string;
  set: string;
  collector_number: string;
  rarity: string;
  layout: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  colors?: string[];
  color_identity: string[];
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: ImageUris;
  card_faces?: CardFaceData[];
  all_parts?: RelatedCard[];
  artist?: string;
}

/** Scryfall image tier (DESIGN "Card data and images", Image tiers). */
export type ImageTier = 'small' | 'normal' | 'large';

/**
 * Pixel sizes and selection thresholds per tier (DESIGN "Specification: geometry, layout and motion", Texture tiers):
 * small below 160 px on-screen height, normal up to 560 px, large above that and in inspect.
 */
export const IMAGE_TIERS: Readonly<Record<ImageTier, { width: number; height: number; maxScreenHeightPx: number }>> = {
  small: { width: 146, height: 204, maxScreenHeightPx: 160 },
  normal: { width: 488, height: 680, maxScreenHeightPx: 560 },
  large: { width: 672, height: 936, maxScreenHeightPx: Number.POSITIVE_INFINITY },
};

/** Decoded-texture cache budget in bytes (DESIGN "Specification: geometry, layout and motion", Texture tiers). */
export const TEXTURE_CACHE_BYTES = 400 * 1024 * 1024;

/** The tier for an on-screen card height in CSS px (DESIGN "Specification: geometry, layout and motion", Texture tiers). */
export function tierForScreenHeight(px: number, inspect = false): ImageTier {
  if (inspect || px > IMAGE_TIERS.normal.maxScreenHeightPx) return 'large';
  return px < IMAGE_TIERS.small.maxScreenHeightPx ? 'small' : 'normal';
}

/** What a placeholder face is drawn from (test harness `?faces=placeholder`, PLAN B0.5; moved here from scene/placeholder.ts by M0-C). */
export interface PlaceholderFace {
  name: string;
  cost?: string;
  type?: string;
  /** Free text in the body, e.g. oracle text. */
  text?: string;
  pt?: string;
}

/** Where a card face image comes from: a Scryfall URL or a procedurally drawn placeholder (DESIGN "Card data and images"). */
export type FaceImage = { kind: 'url'; url: string } | { kind: 'placeholder'; face: PlaceholderFace };

/** Face images for the scene and HUD (DESIGN "Card data and images"; PLAN B0.5 placeholder faces). Implementer: M0-P2. */
export interface FaceSource {
  /** Resolves card data as needed (cache first), so it is async. */
  faceFor(ref: CardRef, faceIndex: 0 | 1, tier: ImageTier): Promise<FaceImage>;
}

/** Decklist section (DESIGN "Specification: card data, packs and draft formats", Decklist grammar). */
export type DeckSection = 'main' | 'side' | 'commander' | 'companion';

/** One parsed decklist line (DESIGN "Specification: card data, packs and draft formats", Decklist grammar). */
export interface DeckEntry {
  count: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  /**
   * A foil printing: the line ends in the export marker `*F*` (Moxfield, Archidekt; `*E*` etched counts as foil).
   * Added by the M4 gate fix (additive): the finish reaches `CardRef.foil` (DESIGN "Specification: card data").
   */
  foil?: true;
  section: DeckSection;
  /** 1-based source line. */
  line: number;
  /** The source line as pasted, for error reports (added by M0-P2, additive). */
  text?: string;
}

/** A parsed decklist (DESIGN "Specification: card data, packs and draft formats"). */
export interface DeckList {
  main: DeckEntry[];
  side: DeckEntry[];
  commander: DeckEntry[];
  companion: DeckEntry[];
}

/** A line that could not be parsed or resolved, with near matches for unresolved names (DESIGN "Specification: card data, packs and draft formats"). */
export interface ParseError {
  /** 1-based source line. */
  line: number;
  text: string;
  kind: 'syntax' | 'unresolved';
  message: string;
  nearMatches: string[];
}

/** Result of parsing a decklist; errors never block the rest (DESIGN "Specification: card data, packs and draft formats"). */
export interface ParseResult {
  list: DeckList;
  errors: ParseError[];
}

/** A decklist resolved to printings (DESIGN "Card data and images"; "Pre-game", Constructed decks). */
export interface ResolvedDeck {
  main: CardRef[];
  side: CardRef[];
  /** Cards from the `Commander` section, if any (added by M0-P2: the decklist grammar has this header). */
  commander?: CardRef[];
  /** Cards from the `Companion` section, if any (added by M0-P2: the decklist grammar has this header). */
  companion?: CardRef[];
  cards: Record<ScryfallId, CardData>;
  errors: ParseError[];
}

/** Card data access with the shared rate limiter and IndexedDB cache (DESIGN "Specification: card data, packs and draft formats"). Implementer: M0-P2. */
export interface CardDataSource {
  /**
   * Scryfall-backed card search for the builder's search-and-add (DESIGN "Pre-game", Constructed decks: "Search and
   * build"; PLAN M2-P6). Added by M2-C, optional so existing sources compile; implementer: M2-P6.
   */
  searchCards?(query: string): Promise<CardData[]>;
  get(sid: ScryfallId): Promise<CardData | null>;
  getMany(sids: ScryfallId[]): Promise<Record<ScryfallId, CardData>>;
  /** Synchronous cache lookup for views; null when not loaded yet. */
  peek(sid: ScryfallId): CardData | null;
  resolveDeck(list: DeckList): Promise<ResolvedDeck>;
  searchTokens(query: string): Promise<CardData[]>;
  /** Tokens linked from the card's `all_parts` (DESIGN "Card data and images", Tokens). */
  relatedTokens(card: CardData): Promise<CardData[]>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Set data and pack generation (DESIGN "Specification: card data, packs and draft formats", Booster data, Pack
// generation; "Card data and images": MTGJSON per-set file, `booster` field). Added by M2-C; implementer: M2-P1.
// Field names follow MTGJSON v5 (camelCase), so recorded fixtures (tests/fixtures/mtgjson) map 1:1.
// ---------------------------------------------------------------------------------------------------------------------

/** An MTGJSON card uuid (DESIGN "Specification: card data, packs and draft formats", Booster data: the map from MTGJSON uuid to Scryfall id). */
export type MtgjsonUuid = string;

/**
 * The ten target sets, listed first in the lobby in this order (DESIGN "Specification: card data, packs and draft
 * formats": M10, M11, M12, M13, M14, M15, Magic Origins, M19, M20, M21; PLAN Milestone 2 acceptance targets).
 */
export const FEATURED_SETS: readonly SetCode[] = ['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21'];

/** Booster types in order of preference (DESIGN "Specification: card data, packs and draft formats", Booster data: "draft, else default, else play"). */
export const BOOSTER_TYPES = ['draft', 'default', 'play'] as const;

/** A booster type Spellplane generates from (DESIGN "Specification: card data, packs and draft formats", Booster data). */
export type BoosterType = (typeof BOOSTER_TYPES)[number];

/** MTGJSON per-set URL (DESIGN "Specification: card data, packs and draft formats", Booster data). */
export const MTGJSON_SET_URL = (code: SetCode): string => `https://mtgjson.com/api/v5/${code}.json`;

/** One sheet of a booster configuration (MTGJSON `booster.<type>.sheets.<name>`; DESIGN "Pack generation" 2-3: weights, foil, colour balancing). */
export interface BoosterSheet {
  /** Card uuid → weight on the sheet. */
  cards: Record<MtgjsonUuid, number>;
  totalWeight: number;
  /** Every card drawn from this sheet is foil. */
  foil: boolean;
  /** Draw one mono-coloured card of each colour first when at least five come from this sheet (Pack generation 3). */
  balanceColors?: boolean;
  /** Duplicates allowed (otherwise draws are without replacement, Pack generation 2). */
  allowDuplicates?: boolean;
  /** MTGJSON marks some sheets fixed (always the same cards in order); M2-P1 decides how to honour it. */
  fixed?: boolean;
}

/** One weighted pack layout: how many cards come from each sheet (MTGJSON `boosters[]`; DESIGN "Pack generation" 1). */
export interface BoosterLayout {
  /** Sheet name → card count. */
  contents: Record<string, number>;
  weight: number;
}

/** A set's booster configuration of one type (MTGJSON `booster.<type>`; DESIGN "Specification: card data, packs and draft formats", Pack generation). */
export interface BoosterConfig {
  boosters: BoosterLayout[];
  boostersTotalWeight: number;
  sheets: Record<string, BoosterSheet>;
}

/** What Spellplane keeps of an MTGJSON card: its Scryfall id plus what colour balancing and pack order read (tests/fixtures/README.md shape). */
export interface SetCardInfo {
  scryfallId: ScryfallId;
  name: string;
  colors?: string[];
  /** 'common', 'uncommon', 'rare', 'mythic', 'special' or 'bonus'. */
  rarity: string;
  types?: string[];
  number: string;
  manaCost?: string;
}

/**
 * A trimmed MTGJSON set as cached in the `sets` store (DESIGN "Specification: card data, packs and draft formats",
 * Booster data: "trimmed to data.booster and a map from MTGJSON uuid to Scryfall id"; "Local persistence": `sets`).
 */
export interface SetData {
  code: SetCode;
  name: string;
  /** ISO date, e.g. '2018-07-13'. */
  releaseDate: string;
  /** The booster type chosen by preference (BOOSTER_TYPES). */
  boosterType: BoosterType;
  booster: BoosterConfig;
  /** Every card any sheet names. */
  cards: Record<MtgjsonUuid, SetCardInfo>;
}

/** A set as the lobby's set picker lists it (DESIGN "Specification: card data, packs and draft formats": featured sets first, then every other set with booster data by release date). */
export interface SetSummary {
  code: SetCode;
  name: string;
  releaseDate: string;
  /** One of FEATURED_SETS. */
  featured: boolean;
}

/** One generated pack card (DESIGN "Specification: card data, packs and draft formats", Pack generation). */
export interface PackCard {
  uuid: MtgjsonUuid;
  /** Scryfall id and foil flag: the identity committed to (core/types.ts CardRef). */
  ref: CardRef;
  /** The sheet it came from. */
  sheet: string;
  rarity: string;
}

/** A generated pack in real pack order: rare or mythic first, then uncommons, commons, land (DESIGN "Pack generation" 4). */
export interface GeneratedPack {
  set: SetCode;
  cards: PackCard[];
}

/** The random source pack generation draws from: the pack's secret-seed byte stream (core/rng.ts ByteStream satisfies it; DESIGN "Pack generation": reproducible in the audit). */
export interface PackRandom {
  /** Uniform integer in [0, n), no modulo bias. */
  below(n: number): number;
}

/** Generate one pack of `set` from `random` (DESIGN "Specification: card data, packs and draft formats", Pack generation 1-4). Deterministic for a given random stream. Implementer: M2-P1 (data/packs.ts). */
export type GeneratePack = (set: SetData, random: PackRandom) => GeneratedPack;

/** MTGJSON set data with the IndexedDB `sets` cache (DESIGN "Card data and images", Caching; "Specification: card data, packs and draft formats", Booster data). Implementer: M2-P1 (data/mtgjson.ts). */
export interface SetDataSource {
  /** Sets for the lobby's picker: FEATURED_SETS first in their order, then the rest with booster data by release date. */
  listSets(): Promise<SetSummary[]>;
  /** The trimmed set, cache first; null when the set has no usable booster data. */
  get(code: SetCode): Promise<SetData | null>;
  /** Synchronous cache lookup for views; null when not loaded yet. */
  peek(code: SetCode): SetData | null;
}
