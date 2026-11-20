/**
 * Deck analysis (decks.md section 4, "Card facts", "Curve"): pure facts about a deck's main list from card data. A card
 * whose data is missing counts toward the card total only. Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import type { CardData } from '../types';

export type Colour = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaSymbol = Colour | 'C';
export const COLOURS: readonly Colour[] = ['W', 'U', 'B', 'R', 'G'];
export const MANA_SYMBOLS: readonly ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C'];
export const COLOUR_NAMES: Readonly<Record<Colour, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** Mana value buckets 0 … 7+. */
export const CURVE_BUCKETS = 8;

/** A lookup from a card ref to its data; null while unknown. */
export type CardLookup = (ref: CardRef) => CardData | null;

/** The front face's type line (a double-faced card counts as its front, as it is cast). */
export function frontType(card: CardData): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split(' // ')[0]!;
}

/** A land: the front type line contains "Land". */
export function isLandCard(card: CardData): boolean {
  return /\bLand\b/.test(frontType(card));
}

export function isCreatureCard(card: CardData): boolean {
  return /\bCreature\b/.test(frontType(card));
}

/** The five basic land names, WUBRG order. */
export const BASIC_LAND_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type BasicLandName = (typeof BASIC_LAND_NAMES)[number];
export const BASIC_OF_COLOUR: Readonly<Record<Colour, BasicLandName>> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/**
 * A free basic (decks.md section 7, invariant 4): named Plains, Island, Swamp, Mountain or Forest with a "Basic Land"
 * type line. Snow-covered basics and Wastes are not free.
 */
export function isFreeBasic(card: CardData | null): boolean {
  if (!card) return false;
  if (!(BASIC_LAND_NAMES as readonly string[]).includes(card.name)) return false;
  const t = frontType(card);
  return /\bBasic\b/.test(t) && /\bLand\b/.test(t) && !/\bSnow\b/.test(t);
}

/** Layouts whose halves are printed on one face and cast from the same card: their costs count together. */
const JOINED_LAYOUTS = new Set(['split', 'flip', 'adventure']);

/** The mana costs a card shows (its own, the joined halves of a split card, else the front face's). */
export function manaCosts(card: CardData): string {
  if (card.mana_cost) return card.mana_cost;
  const faces = card.card_faces ?? [];
  if (JOINED_LAYOUTS.has(card.layout)) return faces.map((f) => f.mana_cost ?? '').join('');
  return faces[0]?.mana_cost ?? '';
}

/** Coloured symbols in a cost; a hybrid symbol counts once for each of its colours. */
export function costSymbols(cost: string): Record<ManaSymbol, number> {
  const out: Record<ManaSymbol, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1]!.toUpperCase().split('/');
    const seen = new Set<ManaSymbol>();
    for (const p of parts) if ((MANA_SYMBOLS as readonly string[]).includes(p)) seen.add(p as ManaSymbol);
    for (const c of seen) out[c]++;
  }
  return out;
}

/** Rules text of every face, joined. */
export function rulesText(card: CardData): string {
  const faces = card.card_faces ?? [];
  return [card.oracle_text ?? '', ...faces.map((f) => f.oracle_text ?? '')].join('\n');
}

/** Mana value bucket 0..7 (7 holds 7 and above). */
export function bucketOf(card: CardData): number {
  return Math.max(0, Math.min(CURVE_BUCKETS - 1, Math.floor(card.cmc)));
}

/** A cheap ramp card (decks.md section 4, "Suggested lands"): mana value ≤ 3 with "{T}: Add" or a land search. */
export function isRamp(card: CardData): boolean {
  if (isLandCard(card) || card.cmc > 3) return false;
  const t = rulesText(card);
  return /\{T\}: Add/.test(t) || /search your library for (a|an|up to [a-z0-9]+) [^.]*\bland/i.test(t);
}

/** The key that groups copies of one card (oracle id, else name). */
export function cardKey(card: CardData): string {
  return card.oracle_id ?? card.name;
}

export interface DeckAnalysis {
  /** Main deck cards, with or without data. */
  cards: number;
  lands: number;
  /** Non-land cards with data. */
  spells: number;
  creatures: number;
  /** Non-land creatures by bucket. */
  curveCreatures: number[];
  /** Non-land non-creatures by bucket. */
  curveOthers: number[];
  /** Mean mana value of the non-land cards; 0 without any. */
  avgMv: number;
  /** Coloured symbols in the costs of every card with data. */
  symbols: Record<Colour, number>;
  /** Land sources per colour; a land of two colours counts half for each. */
  sources: Record<Colour, number>;
  /** Colours with at least 8 % of the coloured symbols, WUBRG order. */
  colours: Colour[];
  /** Cards without data. */
  unknown: number;
  /** Cheap ramp cards. */
  ramp: number;
  /** Largest number of copies of one card that is not a basic land (by name; unknown cards by id). */
  maxCopies: number;
  /** Non-land cards costing 6 or more, and 2 or less. */
  sixPlus: number;
  twoOrLess: number;
  fivePlus: number;
  /** Type breakdown of non-land cards with data. */
  types: { creature: number; instant: number; sorcery: number; artifact: number; enchantment: number; planeswalker: number; other: number };
}

/** The analysis of a list of main-deck refs. */
export function analyse(main: readonly CardRef[], lookup: CardLookup): DeckAnalysis {
  const out: DeckAnalysis = {
    cards: 0,
    lands: 0,
    spells: 0,
    creatures: 0,
    curveCreatures: Array.from({ length: CURVE_BUCKETS }, () => 0),
    curveOthers: Array.from({ length: CURVE_BUCKETS }, () => 0),
    avgMv: 0,
    symbols: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    sources: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    colours: [],
    unknown: 0,
    ramp: 0,
    maxCopies: 0,
    sixPlus: 0,
    twoOrLess: 0,
    fivePlus: 0,
    types: { creature: 0, instant: 0, sorcery: 0, artifact: 0, enchantment: 0, planeswalker: 0, other: 0 },
  };
  let mvSum = 0;
  const copies = new Map<string, number>();
  for (const ref of main) {
    out.cards++;
    const card = lookup(ref);
    if (!card) {
      // Unknown cards may be basics: they do not count toward the copy limit.
      out.unknown++;
      continue;
    }
    if (!isFreeBasic(card)) copies.set(card.name, (copies.get(card.name) ?? 0) + 1);
    const sym = costSymbols(manaCosts(card));
    for (const c of COLOURS) out.symbols[c] += sym[c];
    if (isLandCard(card)) {
      out.lands++;
      const id = card.color_identity.filter((c): c is Colour => (COLOURS as readonly string[]).includes(c));
      for (const c of id) out.sources[c] += 1 / id.length;
      continue;
    }
    out.spells++;
    mvSum += card.cmc;
    const b = bucketOf(card);
    const t = frontType(card);
    if (isCreatureCard(card)) {
      out.creatures++;
      out.curveCreatures[b]!++;
    } else out.curveOthers[b]!++;
    if (card.cmc >= 6) out.sixPlus++;
    if (card.cmc >= 5) out.fivePlus++;
    if (card.cmc <= 2) out.twoOrLess++;
    if (isRamp(card)) out.ramp++;
    if (/\bCreature\b/.test(t)) out.types.creature++;
    else if (/\bPlaneswalker\b/.test(t)) out.types.planeswalker++;
    else if (/\bInstant\b/.test(t)) out.types.instant++;
    else if (/\bSorcery\b/.test(t)) out.types.sorcery++;
    else if (/\bEnchantment\b/.test(t)) out.types.enchantment++;
    else if (/\bArtifact\b/.test(t)) out.types.artifact++;
    else out.types.other++;
  }
  out.avgMv = out.spells > 0 ? mvSum / out.spells : 0;
  const total = COLOURS.reduce((s, c) => s + out.symbols[c], 0);
  out.colours = total > 0 ? COLOURS.filter((c) => out.symbols[c] / total >= 0.08) : [];
  out.maxCopies = Math.max(0, ...copies.values());
  return out;
}

/** The whole curve (creatures plus others) per bucket. */
export function curveOf(a: DeckAnalysis): number[] {
  return a.curveCreatures.map((n, i) => n + a.curveOthers[i]!);
}

/** "Mana curve: 4 cards at 1, 10 at 2, …" (decks.md section 3, accessibility). */
export function curveText(curve: readonly number[]): string {
  const parts = curve.map((n, i) => `${n} at ${i === CURVE_BUCKETS - 1 ? '7 or more' : i}`);
  return `Mana curve: ${parts.join(', ')}.`;
}
