/**
 * Card data contracts (DESIGN "Card data and images", "Specification: card data, packs and draft formats",
 * "Specification: geometry, layout and motion" texture tiers). Implementer of the sources: M0-P2.
 * CardData keeps Scryfall's snake_case field names so recorded fixtures and API responses map 1:1.
 */
import type { CardRef, ScryfallId } from '../core/types';

/** Scryfall image URLs per tier (DESIGN "Card data and images", Image tiers). */
export interface ImageUris {
  small: string;
  normal: string;
  large: string;
}

/** One face of a multi-faced card (DESIGN "Specification: card data, packs and draft formats": card_faces with the same fields per face). */
export interface CardFaceData {
  name: string;
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
  section: DeckSection;
  /** 1-based source line. */
  line: number;
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
  cards: Record<ScryfallId, CardData>;
  errors: ParseError[];
}

/** Card data access with the shared rate limiter and IndexedDB cache (DESIGN "Specification: card data, packs and draft formats"). Implementer: M0-P2. */
export interface CardDataSource {
  get(sid: ScryfallId): Promise<CardData | null>;
  getMany(sids: ScryfallId[]): Promise<Record<ScryfallId, CardData>>;
  /** Synchronous cache lookup for views; null when not loaded yet. */
  peek(sid: ScryfallId): CardData | null;
  resolveDeck(list: DeckList): Promise<ResolvedDeck>;
  searchTokens(query: string): Promise<CardData[]>;
  /** Tokens linked from the card's `all_parts` (DESIGN "Card data and images", Tokens). */
  relatedTokens(card: CardData): Promise<CardData[]>;
}
