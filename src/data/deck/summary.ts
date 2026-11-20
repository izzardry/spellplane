/**
 * The derived facts kept on a deck record (decks.md section 7 `DeckSummary`; PLAN M8-C "with fan"), so tiles, Home's
 * hero and the queue need no card data. Pure. Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import type { DeckRecord, DeckSize, DeckSummary } from '../../store/types';
import { analyse, curveOf, isLandCard, type CardLookup } from './analyse';
import { cleanRef } from './seal';
import { isSimpleDeck } from './simple';
import { cardQuality, strength } from './strength';

/** Bumped when the summary's meaning changes: an older one is recomputed on sight. */
export const DECK_SUMMARY_VERSION = 1;

/** The deck's target size (a sealed deck is 40; an old record without one guesses from its count). */
export function sizeOf(deck: Pick<DeckRecord, 'size' | 'kind' | 'main'>): DeckSize {
  if (deck.size) return deck.size;
  if (deck.kind === 'sealed') return 40;
  return deck.main.length <= 45 ? 40 : 60;
}

/**
 * Non-land cards of the main deck, best first (quality, then lower mana value, then name, then id), one per card id:
 * the automatic cover and the fan.
 */
export function bestCards(main: readonly CardRef[], lookup: CardLookup): CardRef[] {
  const seen = new Set<string>();
  const rows: { ref: CardRef; q: number; mv: number; name: string }[] = [];
  for (const ref of main) {
    if (seen.has(ref.sid)) continue;
    const c = lookup(ref);
    if (!c || isLandCard(c)) continue;
    seen.add(ref.sid);
    rows.push({ ref: cleanRef(ref), q: cardQuality(c), mv: c.cmc, name: c.name });
  }
  rows.sort((a, b) => b.q - a.q || a.mv - b.mv || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.ref.sid < b.ref.sid ? -1 : 1));
  return rows.map((r) => r.ref);
}

/** The summary of a deck as it is now (`at` is its `updatedAt`). */
export function summarise(deck: DeckRecord, lookup: CardLookup): DeckSummary {
  const size = sizeOf(deck);
  const a = analyse(deck.main, lookup);
  const best = bestCards(deck.main, lookup);
  const cover = deck.cover ? cleanRef(deck.cover) : (best[0] ?? (deck.main[0] ? cleanRef(deck.main[0]) : null));
  const fan = cover ? [cover, ...best.filter((r) => r.sid !== cover.sid)].slice(0, 5) : [];
  return {
    v: DECK_SUMMARY_VERSION,
    at: deck.updatedAt,
    cards: a.cards,
    lands: a.lands,
    colours: a.colours,
    curve: curveOf(a),
    avgMv: Math.round(a.avgMv * 100) / 100,
    unknown: a.unknown,
    strength: strength(deck.main, lookup, size),
    simple: isSimpleDeck(a, size),
    maxCopies: a.maxCopies,
    cover,
    fan,
  };
}

/** Whether a record's summary is missing or older than the record or this build's summary. */
export function summaryStale(deck: DeckRecord): boolean {
  return !deck.summary || deck.summary.v !== DECK_SUMMARY_VERSION || deck.summary.at !== deck.updatedAt;
}

/** "2 cards short", "3 over", or null when the deck holds its size (up to size + 2). */
export function countNote(cards: number, size: number): string | null {
  if (cards < size) return `${size - cards} card${size - cards === 1 ? '' : 's'} short`;
  if (cards > size + 2) return `${cards - size} over`;
  return null;
}
