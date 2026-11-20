/**
 * What may leave the browser about a deck (decks.md section 7, "What may leave the browser"; contracts.md Part A):
 * `queueDeckInfo(record)` is a projection of `record.summary` to six facts. M8-C lands it; M8-P3 owns the file and adds
 * `queueEligibility` and `averageInfo`.
 */
import type { QueueDeckInfo } from '../../core/types';
import type { DeckRecord } from '../../store/types';

export type { QueueDeckInfo } from '../../core/types';

/** Kind, size, card count, score, band and formula version of a deck; null without a summary or a strength. Added by M8-C. */
export function queueDeckInfo(record: Pick<DeckRecord, 'kind' | 'size' | 'summary'>): QueueDeckInfo | null {
  const s = record.summary;
  if (!s || !s.strength) return null;
  return { kind: record.kind ?? 'custom', size: record.size ?? 60, cards: s.cards, strength: s.strength.score, band: s.strength.band, v: s.strength.v };
}

/** Why a deck may not enter the ranked or casual queue (decks.md section 7, D21). Added by M8-P3. */
export type QueueEligibility =
  | { ok: true; info: QueueDeckInfo }
  | { ok: false; reason: 'incomplete' | 'noStrength' | 'opening' | 'copies' };

/**
 * Whether a deck may queue, from its summary only (decks.md section 7): `opening` while its boosters are not all shown,
 * `incomplete` below its size, `copies` above four copies of a card that is not a basic land (one at size 100),
 * `noStrength` for a deck with cards but no strength (matchmaking then queues it as average, `averageInfo`). Added by M8-P3.
 */
export function queueEligibility(deck: Pick<DeckRecord, 'kind' | 'size' | 'summary' | 'seal' | 'main'>): QueueEligibility {
  if (deck.seal && deck.seal.revealed < deck.seal.sets.length) return { ok: false, reason: 'opening' };
  const size = deck.size ?? 60;
  const s = deck.summary;
  const cards = s?.cards ?? deck.main.length;
  if (cards < size) return { ok: false, reason: 'incomplete' };
  if (s && s.maxCopies > (size >= 100 ? 1 : 4)) return { ok: false, reason: 'copies' };
  const info = queueDeckInfo(deck);
  if (!info) return { ok: false, reason: 'noStrength' };
  return { ok: true, info };
}

/** A deck without strength queues as average: band solid (3), score 50 (matchmaking.md 2.7). Added by M8-P3. */
export function averageInfo(deck: Pick<DeckRecord, 'kind' | 'size' | 'summary' | 'main'>, v: number): QueueDeckInfo {
  return { kind: deck.kind ?? 'custom', size: deck.size ?? 60, cards: deck.summary?.cards ?? deck.main.length, strength: 50, band: 'solid', v };
}
