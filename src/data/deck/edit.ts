/**
 * The only way a deck changes (decks.md D3, section 7 "Edit functions"): every edit from search, the pool, the list,
 * paste, the suggestion and the debug hook goes through here. On a sealed deck an edit accepts only cards of the deck's
 * own pool and the five basic lands; anything else answers `notInPool` or `sealed`. No function reads the clock or
 * stamps `updatedAt`: the caller saves. Pure. Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import type { DeckRecord, DeckSize } from '../../store/types';
import type { CardData } from '../types';
import { isFreeBasic, type CardLookup } from './analyse';
import { cleanRef, isOpening, isSealed, outsidePool, poolRemaining, refKey } from './seal';

export type Board = 'main' | 'side' | 'maybe' | 'commander' | 'companion';
export const BOARDS: readonly Board[] = ['main', 'side', 'maybe', 'commander', 'companion'];

export type EditRefusal = 'sealed' | 'notInPool' | 'absent' | 'opening';
export type EditResult = { ok: true; deck: DeckRecord } | { ok: false; reason: EditRefusal };

const refuse = (reason: EditRefusal): EditResult => ({ ok: false, reason });

function copyDeck(deck: DeckRecord): DeckRecord {
  return JSON.parse(JSON.stringify(deck)) as DeckRecord;
}

function boardOf(deck: DeckRecord, board: Board): CardRef[] {
  switch (board) {
    case 'main':
      return deck.main;
    case 'side':
      return deck.side;
    default:
      return deck[board] ?? [];
  }
}

function setBoard(deck: DeckRecord, board: Board, refs: CardRef[]): void {
  if (board === 'main') deck.main = refs;
  else if (board === 'side') deck.side = refs;
  else if (refs.length > 0) deck[board] = refs;
  else delete deck[board];
}

/** Copies of `ref` in a list (foil and plain copies counted apart). */
export function countOf(list: readonly CardRef[], ref: CardRef): number {
  const k = refKey(ref);
  return list.reduce((n, r) => n + (refKey(r) === k ? 1 : 0), 0);
}

/** Copies of a card id in a list, foil or not. */
export function countSid(list: readonly CardRef[], sid: string): number {
  return list.reduce((n, r) => n + (r.sid === sid ? 1 : 0), 0);
}

/** Recompute a sealed deck's side from its pool. */
function reseal(deck: DeckRecord): DeckRecord {
  if (deck.seal) deck.side = poolRemaining(deck.seal.pool, deck.main);
  return deck;
}

/**
 * Add `count` copies of `ref` to `board`. Sealed: only to `main`, and only a pool card still in the side (moved) or a
 * free basic (needs `card`; without data the answer is `sealed`). As many copies as the pool still holds are added; none
 * at all answers `notInPool`.
 */
export function add(deck: DeckRecord, ref: CardRef, board: Board, count: number, card: CardData | null): EditResult {
  const n = Math.max(1, Math.floor(count));
  if (isSealed(deck)) {
    if (isOpening(deck)) return refuse('opening');
    if (board !== 'main') return refuse('sealed');
    const out = copyDeck(deck);
    const basic = isFreeBasic(card);
    let added = 0;
    for (let i = 0; i < n; i++) {
      const inSide = countOf(poolRemaining(out.seal!.pool, out.main), ref) > 0;
      if (!inSide && !basic) break;
      out.main.push(cleanRef(ref));
      added++;
    }
    if (added === 0) {
      const inPool = out.seal!.pool.some((r) => refKey(r) === refKey(ref));
      return refuse(!inPool && card === null ? 'sealed' : 'notInPool');
    }
    return { ok: true, deck: reseal(out) };
  }
  const out = copyDeck(deck);
  const list = [...boardOf(out, board)];
  for (let i = 0; i < n; i++) list.push(cleanRef(ref));
  setBoard(out, board, list);
  return { ok: true, deck: out };
}

/** Remove up to `count` copies of `ref` (the last ones) from `board`; none there answers `absent`. */
export function remove(deck: DeckRecord, ref: CardRef, board: Board, count: number): EditResult {
  const n = Math.max(1, Math.floor(count));
  if (isSealed(deck)) {
    if (isOpening(deck)) return refuse('opening');
    if (board !== 'main') return refuse('sealed');
  }
  const out = copyDeck(deck);
  const list = [...boardOf(out, board)];
  let removed = 0;
  // Exact printing first, then any copy of the same card.
  for (const exact of [true, false]) {
    for (let i = list.length - 1; i >= 0 && removed < n; i--) {
      if (exact ? refKey(list[i]!) === refKey(ref) : list[i]!.sid === ref.sid) {
        list.splice(i, 1);
        removed++;
      }
    }
  }
  if (removed === 0) return refuse('absent');
  setBoard(out, board, list);
  return { ok: true, deck: isSealed(out) ? reseal(out) : out };
}

/** Move up to `count` copies from one board to another. Sealed: main ↔ side only (a pool card goes back or comes in). */
export function move(deck: DeckRecord, ref: CardRef, from: Board, to: Board, count: number, card: CardData | null = null): EditResult {
  if (from === to) return refuse('absent');
  if (isSealed(deck)) {
    if (from === 'main' && to === 'side') return remove(deck, ref, 'main', count);
    if (from === 'side' && to === 'main') return add(deck, ref, 'main', count, card);
    return refuse(isOpening(deck) ? 'opening' : 'sealed');
  }
  const have = countSid(boardOf(deck, from), ref.sid);
  if (have === 0) return refuse('absent');
  const n = Math.min(have, Math.max(1, Math.floor(count)));
  const r = remove(deck, ref, from, n);
  if (!r.ok) return r;
  return add(r.deck, ref, to, n, card);
}

/**
 * Replace the main deck (the suggestion, an import into the open deck). Sealed: every card must come from the pool or
 * be a free basic, else `notInPool`.
 */
export function setMain(deck: DeckRecord, main: readonly CardRef[], lookup: CardLookup): EditResult {
  if (isSealed(deck)) {
    if (isOpening(deck)) return refuse('opening');
    if (!outsidePool(deck.seal!.pool, main).every((r) => isFreeBasic(lookup(r)))) return refuse('notInPool');
    const out = copyDeck(deck);
    out.main = main.map(cleanRef);
    return { ok: true, deck: reseal(out) };
  }
  const out = copyDeck(deck);
  out.main = main.map(cleanRef);
  return { ok: true, deck: out };
}

export function rename(deck: DeckRecord, name: string): EditResult {
  const n = name.trim().slice(0, 60);
  if (!n) return refuse('absent');
  const out = copyDeck(deck);
  out.name = n;
  return { ok: true, deck: out };
}

/** A sealed deck's size is fixed at 40. */
export function setSize(deck: DeckRecord, size: DeckSize): EditResult {
  if (isSealed(deck) && size !== 40) return refuse('sealed');
  const out = copyDeck(deck);
  out.size = size;
  return { ok: true, deck: out };
}

export function setCover(deck: DeckRecord, ref: CardRef | null): EditResult {
  const out = copyDeck(deck);
  if (ref) out.cover = cleanRef(ref);
  else delete out.cover;
  return { ok: true, deck: out };
}

export function setNotes(deck: DeckRecord, text: string): EditResult {
  const out = copyDeck(deck);
  const t = text.slice(0, 2000);
  if (t) out.notes = t;
  else delete out.notes;
  return { ok: true, deck: out };
}

/** An edit as plain JSON (the debug hook's `edit(id, op)`; the deck page's undo stack holds records, not ops). */
export type EditOp =
  | { op: 'add'; sid: string; foil?: boolean; board?: Board; count?: number }
  | { op: 'remove'; sid: string; foil?: boolean; board?: Board; count?: number }
  | { op: 'move'; sid: string; foil?: boolean; from: Board; to: Board; count?: number }
  | { op: 'setMain'; sids: string[] }
  | { op: 'rename'; name: string }
  | { op: 'setSize'; size: DeckSize }
  | { op: 'setCover'; sid: string | null };

/** Apply one EditOp through the functions above. */
export function applyEdit(deck: DeckRecord, op: EditOp, lookup: CardLookup): EditResult {
  const ref = (sid: string, foil?: boolean): CardRef => (foil ? { sid, foil: true } : { sid });
  switch (op.op) {
    case 'add': {
      const r = ref(op.sid, op.foil);
      return add(deck, r, op.board ?? 'main', op.count ?? 1, lookup(r));
    }
    case 'remove':
      return remove(deck, ref(op.sid, op.foil), op.board ?? 'main', op.count ?? 1);
    case 'move': {
      const r = ref(op.sid, op.foil);
      return move(deck, r, op.from, op.to, op.count ?? 1, lookup(r));
    }
    case 'setMain':
      return setMain(
        deck,
        op.sids.map((s) => ref(s)),
        lookup,
      );
    case 'rename':
      return rename(deck, op.name);
    case 'setSize':
      return setSize(deck, op.size);
    case 'setCover':
      return setCover(deck, op.sid ? ref(op.sid) : null);
  }
}
