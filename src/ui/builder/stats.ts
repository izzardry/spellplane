/**
 * The builder's live readout (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "A live readout shows
 * card count, mana curve, colour split and land count"; "The limited minimum of 40 cards is shown as a hint, not
 * enforced"; PLAN M2-P5: the readout matches a hand-computed fixture pool). Pure; computed from the main deck only.
 * Implementer: M2-P5.
 */
import type { CardRef, DeckBuild } from '../../core/types';
import type { CardData } from '../../data/types';
import { CURVE_MAX, LIMITED_MINIMUM, type BuilderStats, type ManaColour } from '../types';

export const MANA_COLOURS: readonly ManaColour[] = ['W', 'U', 'B', 'R', 'G', 'C'];
export const MANA_COLOUR_LABELS: Readonly<Record<ManaColour, string>> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };

/** The front face's type line (a double-faced card counts as its front, as it is cast). */
function frontType(card: CardData): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split(' // ')[0]!;
}

/** A land: the type line contains "Land" (front face). */
export function isLandCard(card: CardData): boolean {
  return /\bLand\b/.test(frontType(card));
}

/**
 * The mana costs a card shows: its own cost, else its faces' costs (a transforming card carries the cost on its front
 * face only; a split card's own cost names both halves).
 */
export function manaCosts(card: CardData): string {
  if (card.mana_cost) return card.mana_cost;
  return (card.card_faces ?? []).map((f) => f.mana_cost ?? '').join('');
}

/**
 * Coloured mana symbols in a cost, by colour: {W} counts one white symbol, a hybrid {W/U} one white and one blue, a
 * Phyrexian {W/P} and a two-brid {2/W} one white; {C} counts as colourless. Generic, {X} and {S} count nothing.
 */
export function costSymbols(cost: string): Record<ManaColour, number> {
  const out: Record<ManaColour, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1]!.toUpperCase().split('/');
    const seen = new Set<ManaColour>();
    for (const p of parts) if ((MANA_COLOURS as readonly string[]).includes(p)) seen.add(p as ManaColour);
    for (const c of seen) out[c]++;
  }
  return out;
}

export function emptyStats(): BuilderStats {
  return { cards: 0, lands: 0, curve: Array.from({ length: CURVE_MAX + 1 }, () => 0), colours: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, belowMinimum: true };
}

/**
 * The readout for a build's main deck. Deck ids the pool lacks (and repeats) do not count. Cards whose data is still
 * loading count toward the card total only: they join lands, curve and colours when their data arrives.
 */
export function builderStats(build: DeckBuild, card: (ref: CardRef) => CardData | null): BuilderStats {
  const out = emptyStats();
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const seen = new Set<string>();
  for (const id of build.main) {
    const pc = byId.get(id);
    if (!pc || seen.has(id)) continue;
    seen.add(id);
    out.cards++;
    const data = card(pc.ref);
    if (!data) continue;
    if (isLandCard(data)) out.lands++;
    else {
      const mv = Math.max(0, Math.min(CURVE_MAX, Math.floor(data.cmc)));
      out.curve[mv]!++;
    }
    const sym = costSymbols(manaCosts(data));
    for (const c of MANA_COLOURS) out.colours[c] += sym[c];
  }
  out.belowMinimum = out.cards < LIMITED_MINIMUM;
  return out;
}

/** The 40-card hint (DESIGN: shown as a hint, never enforced): how many cards are still missing, 0 at or above it. */
export function cardsToGo(stats: BuilderStats): number {
  return Math.max(0, LIMITED_MINIMUM - stats.cards);
}
