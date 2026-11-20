/**
 * "Suggest a deck" (decks.md section 4, D18): 23 spells and 17 lands from a pool's best one or two colours. For each of
 * the 15 choices, candidates within the colours are taken by card quality with caps per mana value; the best choice
 * wins (ties to the earlier one in WUBRG order). Then the pool's non-basic lands that make only those colours, then
 * basics from the suggestion until the deck holds 40 cards. Deterministic for a pool. Pure. Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import { analyse, BASIC_OF_COLOUR, bucketOf, COLOURS, isFreeBasic, isLandCard, type BasicLandName, type CardLookup, type Colour } from './analyse';
import { suggestedBasics } from './lands';
import { cleanRef } from './seal';
import { cardQuality, isInteraction } from './strength';

export const AUTOBUILD_SPELLS = 23;
export const AUTOBUILD_SIZE = 40;
/** Caps per bucket: 0–1: 4, 2: 8, 3: 7, 4: 5, 5: 4, 6+: 3. */
const CAPS = [4, 4, 8, 7, 5, 4, 3, 3];

export interface Suggestion {
  main: CardRef[];
  colours: Colour[];
  spells: number;
  lands: number;
}

/** The 15 one- and two-colour choices, WUBRG order. */
function choices(): Colour[][] {
  const out: Colour[][] = COLOURS.map((c) => [c]);
  for (let i = 0; i < COLOURS.length; i++) for (let j = i + 1; j < COLOURS.length; j++) out.push([COLOURS[i]!, COLOURS[j]!]);
  return out;
}

const capBucket = (b: number): number => (b >= 6 ? 6 : b <= 1 ? 1 : b);

/**
 * The suggestion for a pool. `basics` gives the printing of each basic land to add; a colour without a printing gets
 * none (the deck is then short).
 */
export function autobuild(pool: readonly CardRef[], lookup: CardLookup, basics: Partial<Record<BasicLandName, CardRef>>): Suggestion {
  const spells = pool
    .map((ref, index) => ({ ref: cleanRef(ref), card: lookup(ref), index }))
    .filter((x): x is { ref: CardRef; card: NonNullable<ReturnType<CardLookup>>; index: number } => x.card !== null && !isLandCard(x.card));
  spells.sort(
    (a, b) =>
      cardQuality(b.card) - cardQuality(a.card) ||
      a.card.cmc - b.card.cmc ||
      (a.card.name < b.card.name ? -1 : a.card.name > b.card.name ? 1 : 0) ||
      (a.ref.sid < b.ref.sid ? -1 : a.ref.sid > b.ref.sid ? 1 : 0) ||
      a.index - b.index,
  );
  let best: { value: number; colours: Colour[]; picked: typeof spells } | null = null;
  for (const choice of choices()) {
    const within = spells.filter((s) => s.card.color_identity.every((c) => (choice as string[]).includes(c)));
    const picked: typeof spells = [];
    const used = new Map<number, number>();
    const skipped: typeof spells = [];
    for (const s of within) {
      if (picked.length >= AUTOBUILD_SPELLS) break;
      const b = capBucket(bucketOf(s.card));
      if ((used.get(b) ?? 0) >= CAPS[b]!) {
        skipped.push(s);
        continue;
      }
      used.set(b, (used.get(b) ?? 0) + 1);
      picked.push(s);
    }
    // A cap is skipped only while other candidates remain: fill from the skipped ones in order.
    for (const s of skipped) {
      if (picked.length >= AUTOBUILD_SPELLS) break;
      picked.push(s);
    }
    const value = picked.reduce((v, s) => v + cardQuality(s.card) + (isInteraction(s.card) ? 0.05 : 0), 0) - 0.5 * (AUTOBUILD_SPELLS - picked.length);
    if (best === null || value > best.value + 1e-9) best = { value, colours: choice, picked };
  }
  const chosen = best!;
  const main: CardRef[] = chosen.picked.map((s) => s.ref);
  // The pool's non-basic lands that make only the chosen colours (and make at least one).
  for (const ref of pool) {
    if (main.length >= AUTOBUILD_SIZE) break;
    const c = lookup(ref);
    if (!c || !isLandCard(c) || isFreeBasic(c)) continue;
    const id = c.color_identity;
    if (id.length > 0 && id.every((x) => (chosen.colours as string[]).includes(x))) main.push(cleanRef(ref));
  }
  // Basics from the suggestion for a 40-card deck, then fill to 40 by symbols.
  const a = analyse(main, lookup);
  const want = suggestedBasics(a, AUTOBUILD_SIZE);
  const adds: Colour[] = [];
  for (const c of chosen.colours) for (let i = 0; i < (want[c] ?? 0); i++) adds.push(c);
  const order = [...chosen.colours].sort((x, y) => a.symbols[y] - a.symbols[x] || COLOURS.indexOf(x) - COLOURS.indexOf(y));
  for (let i = 0; main.length + adds.length < AUTOBUILD_SIZE && order.length > 0; i++) adds.push(order[i % order.length]!);
  for (const c of adds) {
    if (main.length >= AUTOBUILD_SIZE) break;
    const b = basics[BASIC_OF_COLOUR[c]];
    if (b) main.push(cleanRef(b));
  }
  const lands = main.filter((r) => {
    const c = lookup(r);
    return c !== null && isLandCard(c);
  }).length;
  return { main, colours: chosen.colours, spells: chosen.picked.length, lands };
}

/** "green and white" (the toast's words). */
export function coloursInWords(colours: readonly Colour[]): string {
  const names: Record<Colour, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  return colours.map((c) => names[c]).join(' and ') || 'colourless';
}
