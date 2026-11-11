/**
 * Card model: trimming Scryfall card objects to the stored fields, face images per tier and placeholder faces
 * (DESIGN "Card data and images"; "Specification: card data, packs and draft formats", Stored fields;
 * "Specification: geometry, layout and motion", Texture tiers).
 */
import type { CardData, CardFaceData, ImageTier, ImageUris, PlaceholderFace, RelatedCard } from './types';
import { tierForScreenHeight } from './types';

/** The top-level fields kept from a Scryfall card object, in the design's order. */
export const STORED_CARD_FIELDS = [
  'id',
  'oracle_id',
  'name',
  'set',
  'collector_number',
  'rarity',
  'layout',
  'mana_cost',
  'cmc',
  'type_line',
  'colors',
  'color_identity',
  'oracle_text',
  'power',
  'toughness',
  'loyalty',
  'image_uris',
  'card_faces',
  'all_parts',
  'artist',
] as const;

/**
 * The fields kept per entry of `card_faces` ("with the same fields per face"): the stored fields Scryfall can put on a
 * face. `oracle_id`, `layout` and `cmc` appear on faces of `reversible_card` only, and are kept when present.
 */
export const STORED_FACE_FIELDS = [
  'oracle_id',
  'name',
  'layout',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'colors',
  'power',
  'toughness',
  'loyalty',
  'image_uris',
  'artist',
] as const;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v as string[])] : undefined;

function trimImageUris(v: unknown): ImageUris | undefined {
  if (!isObj(v)) return undefined;
  const small = str(v.small);
  const normal = str(v.normal);
  const large = str(v.large);
  if (small === undefined || normal === undefined || large === undefined) return undefined;
  return { small, normal, large };
}

function setIf<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function trimFace(v: unknown): CardFaceData | null {
  if (!isObj(v)) return null;
  const name = str(v.name);
  if (name === undefined) return null;
  const face: CardFaceData = { name };
  setIf(face, 'oracle_id', str(v.oracle_id));
  setIf(face, 'layout', str(v.layout));
  setIf(face, 'mana_cost', str(v.mana_cost));
  if (typeof v.cmc === 'number' && Number.isFinite(v.cmc)) face.cmc = v.cmc;
  setIf(face, 'type_line', str(v.type_line));
  setIf(face, 'oracle_text', str(v.oracle_text));
  setIf(face, 'colors', strArr(v.colors));
  setIf(face, 'power', str(v.power));
  setIf(face, 'toughness', str(v.toughness));
  setIf(face, 'loyalty', str(v.loyalty));
  setIf(face, 'image_uris', trimImageUris(v.image_uris));
  setIf(face, 'artist', str(v.artist));
  // Key order follows STORED_FACE_FIELDS so records compare and serialise stably.
  const ordered: Obj = {};
  for (const k of STORED_FACE_FIELDS) if ((face as unknown as Obj)[k] !== undefined) ordered[k] = (face as unknown as Obj)[k];
  return ordered as unknown as CardFaceData;
}

function trimPart(v: unknown): RelatedCard | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const component = str(v.component);
  const name = str(v.name);
  if (id === undefined || component === undefined || name === undefined) return null;
  return { id, component, name, type_line: str(v.type_line) ?? '' };
}

/**
 * Trims a Scryfall card object (API response or cached record) to exactly the stored fields.
 * Returns null when the required fields (id, name, set, collector number) are missing.
 */
export function trimCard(raw: unknown): CardData | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  const set = str(raw.set);
  const collector_number = str(raw.collector_number);
  if (id === undefined || name === undefined || set === undefined || collector_number === undefined) return null;
  const card: CardData = {
    id,
    name,
    set,
    collector_number,
    rarity: str(raw.rarity) ?? 'common',
    layout: str(raw.layout) ?? 'normal',
    cmc: typeof raw.cmc === 'number' && Number.isFinite(raw.cmc) ? raw.cmc : 0,
    type_line: str(raw.type_line) ?? '',
    color_identity: strArr(raw.color_identity) ?? [],
  };
  setIf(card, 'oracle_id', str(raw.oracle_id));
  setIf(card, 'mana_cost', str(raw.mana_cost));
  setIf(card, 'colors', strArr(raw.colors));
  setIf(card, 'oracle_text', str(raw.oracle_text));
  setIf(card, 'power', str(raw.power));
  setIf(card, 'toughness', str(raw.toughness));
  setIf(card, 'loyalty', str(raw.loyalty));
  setIf(card, 'image_uris', trimImageUris(raw.image_uris));
  if (Array.isArray(raw.card_faces)) {
    const faces = raw.card_faces.map(trimFace).filter((f): f is CardFaceData => f !== null);
    if (faces.length > 0) card.card_faces = faces;
  }
  if (Array.isArray(raw.all_parts)) {
    const parts = raw.all_parts.map(trimPart).filter((p): p is RelatedCard => p !== null);
    if (parts.length > 0) card.all_parts = parts;
  }
  setIf(card, 'artist', str(raw.artist));
  // Re-order keys to the design's field order so records compare and serialise stably.
  const ordered: Obj = {};
  for (const k of STORED_CARD_FIELDS) if ((card as unknown as Obj)[k] !== undefined) ordered[k] = (card as unknown as Obj)[k];
  return ordered as unknown as CardData;
}

/**
 * One image set per printed face. Cards whose faces carry their own images (transform, modal_dfc and similar)
 * have one per face; every other card (including split, adventure and flip cards) has the single top-level image.
 */
export function faceImages(card: CardData): ImageUris[] {
  const perFace = (card.card_faces ?? []).map((f) => f.image_uris);
  if (perFace.length > 1 && perFace.every((u): u is ImageUris => u !== undefined)) return perFace;
  if (card.image_uris) return [card.image_uris];
  const first = perFace.find((u): u is ImageUris => u !== undefined);
  return first ? [first] : [];
}

/** Number of distinct face images (2 for double-faced cards, else 1; 0 if Scryfall has no image). */
export function faceCount(card: CardData): number {
  return faceImages(card).length;
}

/** True when the card has two printed faces with their own images, so the flip action swaps faces. */
export function isDoubleFaced(card: CardData): boolean {
  return faceImages(card).length > 1;
}

/** Image URL of a face at a tier. A face index beyond the card's faces falls back to the front. */
export function imageUrl(card: CardData, faceIndex: number, tier: ImageTier): string | null {
  const faces = faceImages(card);
  const uris = faces[faceIndex] ?? faces[0];
  return uris ? uris[tier] : null;
}

/**
 * Image URL for a card drawn `screenHeightPx` CSS px tall (DESIGN "Texture tiers"): 146×204 under 160 px,
 * 488×680 up to 560 px, 672×936 above that and in the inspect view.
 */
export function imageUrlForHeight(card: CardData, faceIndex: number, screenHeightPx: number, inspect = false): string | null {
  return imageUrl(card, faceIndex, tierForScreenHeight(screenHeightPx, inspect));
}

function pt(power: string | undefined, toughness: string | undefined, loyalty: string | undefined): string | undefined {
  if (power !== undefined && toughness !== undefined) return `${power}/${toughness}`;
  return loyalty;
}

/**
 * What the placeholder face of `faceIndex` shows (`?faces=placeholder`): the face's own name, cost, type, text and
 * power/toughness (or loyalty) for double-faced cards, otherwise the card's.
 */
export function placeholderFace(card: CardData, faceIndex: number): PlaceholderFace {
  const faces = card.card_faces ?? [];
  const src = isDoubleFaced(card) ? (faces[faceIndex] ?? faces[0]) : undefined;
  const out: PlaceholderFace = { name: src?.name ?? card.name };
  const cost = src ? src.mana_cost : (card.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '));
  const type = src ? src.type_line : card.type_line;
  const text = src
    ? src.oracle_text
    : (card.oracle_text ?? (faces.length > 0 ? faces.map((f) => f.oracle_text ?? '').join(' // ') : undefined));
  const stats = src ? pt(src.power, src.toughness, src.loyalty) : pt(card.power, card.toughness, card.loyalty);
  if (cost) out.cost = cost;
  if (type) out.type = type;
  if (text) out.text = text;
  if (stats) out.pt = stats;
  return out;
}

/** Token ids linked from a card's `all_parts`, excluding the card itself (DESIGN "Card data and images", Tokens). */
export function relatedTokenIds(card: CardData): string[] {
  const ids: string[] = [];
  for (const p of card.all_parts ?? []) {
    if (p.component === 'token' && p.id !== card.id && !ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}
