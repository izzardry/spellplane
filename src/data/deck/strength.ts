/**
 * Deck strength (decks.md section 5): one number from 1 to 100 in five bands, computed in the browser from the main
 * deck's card data. Quality 40 %, curve 20 %, interaction 20 %, consistency 20 %, scaled by a mana check. Pure.
 * Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import type { DeckStrength, StrengthBand } from '../../store/types';
import type { CardData } from '../types';
import { analyse, cardKey, COLOURS, isLandCard, rulesText, type CardLookup, type DeckAnalysis } from './analyse';
import { landFormula } from './lands';

export const STRENGTH_VERSION = 1;

export const BANDS: readonly StrengthBand[] = ['rough', 'casual', 'solid', 'tuned', 'fierce'];
export const BAND_LABELS: Readonly<Record<StrengthBand, string>> = { rough: 'Rough', casual: 'Casual', solid: 'Solid', tuned: 'Tuned', fierce: 'Fierce' };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The band of a score: rough 1–20, casual 21–40, solid 41–60, tuned 61–80, fierce 81–100. */
export function bandOf(score: number): StrengthBand {
  return BANDS[clamp(Math.ceil(score / 20), 1, 5) - 1]!;
}

/** The lobby's Band 1 to 5 of a strength band (matchmaking.md 2.7; decks.md section 7). */
export function bandNumber(band: StrengthBand): 1 | 2 | 3 | 4 | 5 {
  return (BANDS.indexOf(band) + 1) as 1 | 2 | 3 | 4 | 5;
}

const RARITY: Readonly<Record<string, number>> = { common: 0.35, uncommon: 0.5, rare: 0.7, mythic: 0.85 };

/** Card quality 0..1 (decks.md D20): the printing's rarity, nudged by edhrec_rank within ±0.2 and the bounds. */
export function cardQuality(card: CardData): number {
  const rarity = RARITY[card.rarity] ?? 0.6;
  const r = card.edhrec_rank;
  if (typeof r !== 'number' || !Number.isFinite(r) || r < 1) return rarity;
  const rank = clamp(1 - Math.log10(r) / 4.5, 0, 1);
  return clamp(rarity + 0.3 * (rank - 0.25), 0.15, 1);
}

const INTERACTION: readonly RegExp[] = [
  /destroy target/i,
  /exile target (?!card)/i,
  /counter target/i,
  /deals (\d+|X) damage to (any target|target creature|target planeswalker|each creature)/i,
  /target creature gets -\d+\/-\d+/i,
  /\bfights?\b/i,
  /destroy all/i,
  /exile all/i,
  /all creatures get -/i,
  /return target (creature|nonland permanent|permanent) to its owner's hand/i,
  /draws? (two|three|four|[2-9]|\d\d+|X) cards/i,
  /target (player|opponent) discards/i,
  /creature can't attack or block/i,
];

/** A card that removes, counters, draws two or more or makes a player discard (decks.md section 5, "Interaction"). */
export function isInteraction(card: CardData): boolean {
  const text = rulesText(card);
  return INTERACTION.some((re) => re.test(text));
}

/** Curve part C (decks.md section 5). */
function curvePart(a: DeckAnalysis): number {
  const avg = a.avgMv;
  let av: number;
  if (avg >= 1.6 && avg <= 3.2) av = 1;
  else if (avg > 3.2) av = clamp(1 - (avg - 3.2) / 1.8, 0, 1);
  else if (avg >= 1.0) av = 0.6 + (0.4 * (avg - 1.0)) / 0.6;
  else av = 0.6;
  const s = a.spells || 1;
  const e = Math.min(1, a.twoOrLess / s / 0.35);
  const t = 1 - clamp((a.sixPlus / s - 0.1) / 0.2, 0, 1);
  return 0.5 * av + 0.3 * e + 0.2 * t;
}

/** Mana part M (decks.md section 5). */
function manaPart(a: DeckAnalysis): number {
  const n = a.cards;
  const suggested = landFormula(a, n);
  const l = 1 - clamp((Math.abs(a.lands - suggested) - 1) / (0.12 * n), 0, 1);
  const k = a.colours.length;
  const c = k <= 2 ? 1 : k === 3 ? 0.75 : k === 4 ? 0.45 : 0.3;
  const symTotal = COLOURS.reduce((s, x) => s + a.symbols[x], 0);
  const srcTotal = COLOURS.reduce((s, x) => s + a.sources[x], 0);
  let s: number;
  if (symTotal === 0) s = 1;
  else if (srcTotal === 0) s = 0;
  else {
    const mismatch = 0.5 * COLOURS.reduce((sum, x) => sum + Math.abs(a.symbols[x] / symTotal - a.sources[x] / srcTotal), 0);
    s = 1 - clamp(mismatch / 0.4, 0, 1);
  }
  return 0.45 * l + 0.25 * c + 0.3 * s;
}

/**
 * The strength of a main deck for a target size (decks.md section 5), or null when the deck holds fewer than half its
 * size, has no non-land card, or more than 10 % of its cards have no data.
 */
export function strength(main: readonly CardRef[], lookup: CardLookup, size: number): DeckStrength | null {
  const a = analyse(main, lookup);
  if (a.cards < size / 2 || a.spells === 0 || a.unknown > 0.1 * a.cards) return null;
  const spells: CardData[] = [];
  for (const ref of main) {
    const c = lookup(ref);
    if (c && !isLandCard(c)) spells.push(c);
  }
  const quality = spells.reduce((s, c) => s + cardQuality(c), 0) / spells.length;
  const ranked = spells.filter((c) => typeof c.edhrec_rank === 'number' && c.edhrec_rank >= 1).length / spells.length;
  const basis: DeckStrength['basis'] = ranked >= 0.9 ? 'rank' : ranked <= 0.1 ? 'rarity' : 'mixed';
  const curve = curvePart(a);
  const matches = spells.filter(isInteraction).length;
  const interaction = Math.min(1, (matches * 60) / a.cards / 12);
  const distinct = new Set(spells.map(cardKey)).size;
  const consistency = size >= 100 ? 0.5 : clamp((spells.length / distinct - 1) / 2.5, 0, 1);
  const mana = manaPart(a);
  const raw = (0.4 * quality + 0.2 * curve + 0.2 * interaction + 0.2 * consistency) * (0.4 + 0.6 * mana);
  const score = clamp(Math.round(1 + (99 * (raw - 0.2)) / 0.7), 1, 100);
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    v: STRENGTH_VERSION,
    score,
    band: bandOf(score),
    parts: { quality: r3(quality), curve: r3(curve), interaction: r3(interaction), consistency: r3(consistency), mana: r3(mana) },
    basis,
    complete: a.cards >= size,
  };
}

/** The name matchmaking.md expects: the strength of a list of cards for a deck kind (custom 60, sealed 40). */
export function deckStrength(cards: readonly CardRef[], lookup: CardLookup, kind: 'custom' | 'sealed', size?: number): DeckStrength | null {
  return strength(cards, lookup, size ?? (kind === 'sealed' ? 40 : 60));
}
