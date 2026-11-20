/**
 * Recipes and the land suggestion (decks.md section 4, "Recipe targets", "Suggested lands", "Suggested basics"):
 * Frank Karsten's regression for 60 cards (19.59 + 1.90 × average mana value − 0.28 × cheap ramp cards), scaled to
 * the deck size. Pure. Implementer: M8-P3.
 */
import type { DeckSize } from '../../store/types';
import { COLOURS, type Colour, type DeckAnalysis } from './analyse';

export interface Recipe {
  lands: number;
  /** Non-land cards per bucket 0 … 7+. */
  targets: readonly number[];
}

export const RECIPES: Readonly<Record<DeckSize, Recipe>> = {
  40: { lands: 17, targets: [0, 3, 6, 6, 4, 3, 1, 0] },
  60: { lands: 24, targets: [0, 6, 10, 8, 6, 4, 2, 0] },
  100: { lands: 37, targets: [0, 8, 14, 14, 11, 8, 5, 3] },
};

/** The recipe of the nearest known size. */
export function recipeFor(size: number): Recipe {
  if (size <= 50) return RECIPES[40];
  if (size <= 80) return RECIPES[60];
  return RECIPES[100];
}

/** The regression for `size` cards, clamped to 30 … 46 % of the size. */
export function landFormula(a: Pick<DeckAnalysis, 'avgMv' | 'ramp' | 'cards'>, size: number): number {
  const ramp60 = a.cards > 0 ? (a.ramp * 60) / a.cards : 0;
  const raw = ((19.59 + 1.9 * a.avgMv - 0.28 * ramp60) * size) / 60;
  return Math.min(Math.round(0.46 * size), Math.max(Math.round(0.3 * size), Math.round(raw)));
}

/**
 * Suggested lands for a deck of target size `size`: with fewer than 8 non-land cards the recipe's land count, else
 * the formula.
 */
export function suggestedLands(a: DeckAnalysis, size: number): number {
  if (a.spells < 8) return recipeFor(size).lands;
  return landFormula(a, size);
}

/**
 * Basics to add (decks.md section 4, "Suggested basics"): `need = suggested − lands`, split in proportion to how far
 * each colour's sources are below its share of the coloured symbols, by largest remainder; every colour with a symbol
 * gets at least one while lands remain. Empty without coloured symbols or when nothing is needed.
 */
export function suggestedBasics(a: DeckAnalysis, size: number): Partial<Record<Colour, number>> {
  const suggested = suggestedLands(a, size);
  const need = suggested - a.lands;
  const total = COLOURS.reduce((s, c) => s + a.symbols[c], 0);
  if (need <= 0 || total === 0) return {};
  const used = COLOURS.filter((c) => a.symbols[c] > 0);
  const gap = new Map<Colour, number>(used.map((c) => [c, Math.max(0, (suggested * a.symbols[c]) / total - a.sources[c])]));
  let gapSum = [...gap.values()].reduce((s, v) => s + v, 0);
  // Every source is already where it should be: split by symbols instead.
  if (gapSum <= 0) {
    for (const c of used) gap.set(c, a.symbols[c]);
    gapSum = total;
  }
  const out: Partial<Record<Colour, number>> = {};
  // At least one per colour with a symbol while lands remain, most-needed colour first.
  let left = need;
  const byNeed = [...used].sort((x, y) => gap.get(y)! - gap.get(x)! || COLOURS.indexOf(x) - COLOURS.indexOf(y));
  for (const c of byNeed) {
    if (left === 0) break;
    out[c] = 1;
    left--;
  }
  if (left > 0) {
    const shares = used.map((c) => ({ c, exact: (left * gap.get(c)!) / gapSum }));
    let given = 0;
    for (const s of shares) {
      const n = Math.floor(s.exact);
      out[s.c] = (out[s.c] ?? 0) + n;
      given += n;
    }
    shares.sort((x, y) => y.exact - Math.floor(y.exact) - (x.exact - Math.floor(x.exact)) || COLOURS.indexOf(x.c) - COLOURS.indexOf(y.c));
    for (let i = 0; given < left; i++, given++) out[shares[i % shares.length]!.c] = (out[shares[i % shares.length]!.c] ?? 0) + 1;
  }
  return out;
}
