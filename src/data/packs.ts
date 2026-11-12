/**
 * Pack generation from MTGJSON booster data (DESIGN "Specification: card data, packs and draft formats", Pack
 * generation 1-4: layout by weight, weighted draws without replacement per sheet, foil sheets, colour balancing, real
 * pack order). Pure and deterministic for a given random stream. Contracts: M2-C (stub); implementer: M2-P1.
 *
 * Determinism does not depend on JSON key order: layouts are taken in their listed order (an array), sheets of a
 * layout in sorted name order and the cards of a sheet in sorted uuid order. Two browsers holding the same set data
 * and the same seed therefore generate the same pack, which is what the audit replays.
 */
import type { CardRef } from '../core/types';
import type { BoosterConfig, BoosterLayout, BoosterSheet, GeneratedPack, GeneratePack, MtgjsonUuid, PackCard, PackRandom, SetCardInfo, SetData } from './types';

/** The five colours colour balancing draws one mono-coloured card of each, in WUBRG order (DESIGN "Pack generation" 3). */
export const BALANCE_COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;

/** Colour balancing applies when at least this many cards come from a balanced sheet (DESIGN "Pack generation" 3). */
export const BALANCE_MIN_DRAWS = 5;

/** The largest value `PackRandom.below` accepts (core/rng.ts ByteStream: 32-bit rejection sampling). */
const BELOW_MAX = 0x100000000;

/**
 * Uniform integer in [0, n) for any positive safe integer n. MTGJSON sheet weights exceed 2^32 (M21's foil sheet sums
 * to about 2.4e12), so a range above `below`'s limit is split into a high and a low 32-bit part with rejection of the
 * overshoot; the result stays unbiased.
 */
export function uniformBelow(random: PackRandom, n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`uniformBelow(${n})`);
  if (n <= BELOW_MAX) return random.below(n);
  const hiRange = Math.ceil(n / BELOW_MAX);
  for (;;) {
    const x = random.below(hiRange) * BELOW_MAX + random.below(BELOW_MAX);
    if (x < n) return x;
  }
}

/** A sheet prepared for drawing: uuids in sorted order with their weights and, per card, its single colour (or ''). */
interface PreparedSheet {
  uuids: MtgjsonUuid[];
  weights: number[];
  mono: string[];
}

const prepared = new WeakMap<BoosterSheet, WeakMap<SetData, PreparedSheet>>();

function prepare(set: SetData, sheet: BoosterSheet): PreparedSheet {
  let bySet = prepared.get(sheet);
  if (!bySet) {
    bySet = new WeakMap();
    prepared.set(sheet, bySet);
  }
  let p = bySet.get(set);
  if (!p) {
    const uuids = Object.keys(sheet.cards)
      .filter((u) => validWeight(sheet.cards[u]))
      .sort(compareStrings);
    p = { uuids, weights: uuids.map((u) => sheet.cards[u]!), mono: uuids.map((u) => monoColour(set.cards[u])) };
    bySet.set(set, p);
  }
  return p;
}

/** The colour of a mono-coloured card, '' for any other (colour balancing, DESIGN "Pack generation" 3). */
function monoColour(info: SetCardInfo | undefined): string {
  return info?.colors?.length === 1 ? info.colors[0]! : '';
}

function validWeight(w: number | undefined): w is number {
  return typeof w === 'number' && Number.isSafeInteger(w) && w > 0;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One index drawn with probability proportional to its weight among the indices `allowed` accepts; -1 when no allowed
 * index has weight. Drawing from the remaining cards this way is the same distribution as redrawing duplicates.
 */
export function weightedIndex(random: PackRandom, weights: readonly number[], allowed: (i: number) => boolean): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) if (allowed(i)) total += weights[i]!;
  if (total <= 0) return -1;
  let r = uniformBelow(random, total);
  for (let i = 0; i < weights.length; i++) {
    if (!allowed(i)) continue;
    const w = weights[i]!;
    if (r < w) return i;
    r -= w;
  }
  return -1;
}

/** Choose one layout with probability `weight / boostersTotalWeight` (DESIGN "Pack generation" 1). */
export function chooseLayout(config: BoosterConfig, random: PackRandom): BoosterLayout {
  const layouts = config.boosters;
  const i = weightedIndex(
    random,
    layouts.map((b) => (validWeight(b.weight) ? b.weight : 0)),
    () => true,
  );
  if (i < 0) throw new Error('booster configuration has no layout with weight');
  return layouts[i]!;
}

/**
 * Draw `count` uuids from one sheet (DESIGN "Pack generation" 2-3). Without replacement unless the sheet allows
 * duplicates; `taken` holds non-foil uuids already in the pack, which a non-foil sheet does not repeat either. A
 * fixed sheet yields its cards in sorted uuid order, each as often as its weight says.
 */
export function drawFromSheet(set: SetData, sheet: BoosterSheet, count: number, random: PackRandom, taken: ReadonlySet<MtgjsonUuid> = new Set()): MtgjsonUuid[] {
  const { uuids, weights, mono } = prepare(set, sheet);
  if (sheet.fixed) {
    const out: MtgjsonUuid[] = [];
    for (let i = 0; i < uuids.length && out.length < count; i++) for (let k = 0; k < weights[i]! && out.length < count; k++) out.push(uuids[i]!);
    return out;
  }
  // blocked[i] = 1: not drawable (already drawn from a no-duplicates sheet, or a non-foil card already in the pack).
  const blocked = new Uint8Array(uuids.length);
  let total = 0;
  for (let i = 0; i < uuids.length; i++) {
    if (!sheet.foil && taken.has(uuids[i]!)) blocked[i] = 1;
    else total += weights[i]!;
  }
  const out: MtgjsonUuid[] = [];
  const take = (i: number): void => {
    out.push(uuids[i]!);
    if (!sheet.allowDuplicates) {
      blocked[i] = 1;
      total -= weights[i]!;
    }
  };
  if (sheet.balanceColors && count >= BALANCE_MIN_DRAWS) {
    for (const colour of BALANCE_COLOURS) {
      if (out.length >= count) break;
      const i = weightedIndex(random, weights, (j) => blocked[j] === 0 && mono[j] === colour);
      if (i >= 0) take(i);
    }
  }
  // The rest from the whole sheet: one weighted pass over the drawable cards, whose weight sum is kept in `total`.
  while (out.length < count && total > 0) {
    let r = uniformBelow(random, total);
    for (let i = 0; i < uuids.length; i++) {
      if (blocked[i] === 1) continue;
      const w = weights[i]!;
      if (r < w) {
        take(i);
        break;
      }
      r -= w;
    }
  }
  return out;
}

/** Pack order rank (DESIGN "Pack generation" 4): rare or mythic first, then uncommons, commons, the foil, the land. */
export function packRank(info: SetCardInfo | undefined, foil: boolean): number {
  if (foil) return 3;
  const rarity = info?.rarity ?? 'common';
  if (rarity === 'uncommon') return 1;
  if (rarity === 'common') return info?.types?.includes('Land') ? 4 : 2;
  return 0;
}

/** Generate one pack (data/types.ts GeneratePack; DESIGN "Specification: card data, packs and draft formats", Pack generation 1-4). */
export const generatePack: GeneratePack = (set: SetData, random: PackRandom): GeneratedPack => {
  const layout = chooseLayout(set.booster, random);
  const drawn: { card: PackCard; rank: number; order: number }[] = [];
  const taken = new Set<MtgjsonUuid>();
  for (const sheetName of Object.keys(layout.contents).sort(compareStrings)) {
    const count = layout.contents[sheetName]!;
    const sheet = set.booster.sheets[sheetName];
    if (!sheet) throw new Error(`booster layout names a missing sheet: ${sheetName}`);
    for (const uuid of drawFromSheet(set, sheet, count, random, taken)) {
      const info = set.cards[uuid];
      if (!info) throw new Error(`sheet ${sheetName} names a card without data: ${uuid}`);
      if (!sheet.foil) taken.add(uuid);
      const ref: CardRef = sheet.foil ? { sid: info.scryfallId, foil: true } : { sid: info.scryfallId };
      drawn.push({ card: { uuid, ref, sheet: sheetName, rarity: info.rarity }, rank: packRank(info, sheet.foil), order: drawn.length });
    }
  }
  drawn.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { set: set.code, cards: drawn.map((d) => d.card) };
};

/** Generate `n` packs of one set from the same stream, one after another (sealed pools, simulations). */
export function generatePacks(set: SetData, random: PackRandom, n: number): GeneratedPack[] {
  const out: GeneratedPack[] = [];
  for (let i = 0; i < n; i++) out.push(generatePack(set, random));
  return out;
}
