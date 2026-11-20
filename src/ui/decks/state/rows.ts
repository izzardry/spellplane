/**
 * The deck list's rows and groups (decks.md section 3 "Deck list"; visual.md 2.8 "Deck list row"): one row per card id
 * with its count, sorted by mana value then name, grouped Creatures, Spells, Other, Lands (and cards without data).
 * Pure. Implementer: M8-P3.
 */
import type { CardRef } from '../../../core/types';
import { isCreatureCard, isLandCard, type CardLookup } from '../../../data/deck/analyse';
import type { CardData } from '../../../data/types';

export interface DeckRow {
  sid: string;
  card: CardData | null;
  n: number;
  mv: number;
}

export interface DeckGroup {
  title: string;
  rows: DeckRow[];
  n: number;
}

export function rowsOf(list: readonly CardRef[], lookup: CardLookup): DeckRow[] {
  const by = new Map<string, DeckRow>();
  for (const r of list) {
    const row = by.get(r.sid);
    if (row) row.n++;
    else {
      const card = lookup(r);
      by.set(r.sid, { sid: r.sid, card, n: 1, mv: card ? Math.round(card.cmc) : 0 });
    }
  }
  return [...by.values()].sort((a, b) => a.mv - b.mv || (a.card?.name ?? a.sid).localeCompare(b.card?.name ?? b.sid));
}

export function groupsOf(list: readonly CardRef[], lookup: CardLookup): DeckGroup[] {
  const g: Record<string, DeckRow[]> = { Creatures: [], Spells: [], Other: [], Lands: [], Unknown: [] };
  for (const row of rowsOf(list, lookup)) {
    const c = row.card;
    const key = !c ? 'Unknown' : isLandCard(c) ? 'Lands' : isCreatureCard(c) ? 'Creatures' : /\b(Instant|Sorcery)\b/.test(c.type_line) ? 'Spells' : 'Other';
    g[key]!.push(row);
  }
  return Object.entries(g)
    .filter(([, rows]) => rows.length > 0)
    .map(([title, rows]) => ({ title, rows, n: rows.reduce((s, r) => s + r.n, 0) }));
}

/** The card most over the copy limit (four; one at size 100), basic lands aside, or null. */
export function overCopies(main: readonly CardRef[], lookup: CardLookup, size: number): { name: string; n: number; limit: number } | null {
  const by = new Map<string, number>();
  for (const r of main) {
    const c = lookup(r);
    if (c && isLandCard(c) && /\bBasic\b/.test(c.type_line)) continue;
    const k = c?.name ?? r.sid;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  const limit = size >= 100 ? 1 : 4;
  const over = [...by.entries()].filter(([, n]) => n > limit).sort((a, b) => b[1] - a[1])[0];
  return over ? { name: over[0], n: over[1], limit } : null;
}
