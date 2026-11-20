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
