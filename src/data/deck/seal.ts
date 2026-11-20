/**
 * The seal of a booster deck (decks.md D3, D4, section 7 "The record's invariants"): a sealed deck's main deck holds
 * only cards of its own pool plus free basics, and its sideboard is the rest of the pool, in pool order. Converting
 * makes a custom copy and leaves the original untouched. Pure; no clock (callers pass `now`). Implementer: M8-P3.
 */
import type { CardRef } from '../../core/types';
import type { DeckRecord, DeckSeal } from '../../store/types';

export { isFreeBasic } from './analyse';

/** The multiset key of a ref. */
export function refKey(ref: CardRef): string {
  return ref.foil ? `${ref.sid}*` : ref.sid;
}

export function cleanRef(ref: CardRef): CardRef {
  return ref.foil ? { sid: ref.sid, foil: true } : { sid: ref.sid };
}

/** The number of packs of a seal. */
export function packTotal(seal: DeckSeal): number {
  return seal.sets.length;
}

/** A sealed deck whose opening has not shown every pack yet: edits answer `opening`. */
export function isOpening(deck: Pick<DeckRecord, 'seal'>): boolean {
  return !!deck.seal && deck.seal.revealed < packTotal(deck.seal);
}

export function isSealed(deck: Pick<DeckRecord, 'kind' | 'seal'>): boolean {
  return deck.kind === 'sealed' && !!deck.seal;
}

/**
 * Pool cards not in the main deck, in pool order (decks.md: `side` = pool minus main). Main cards matched against the
 * pool consume pool copies; main cards without a pool copy (dispensed basics) consume nothing.
 */
export function poolRemaining(pool: readonly CardRef[], main: readonly CardRef[]): CardRef[] {
  const inMain = new Map<string, number>();
  for (const r of main) inMain.set(refKey(r), (inMain.get(refKey(r)) ?? 0) + 1);
  const out: CardRef[] = [];
  for (const r of pool) {
    const n = inMain.get(refKey(r)) ?? 0;
    if (n > 0) inMain.set(refKey(r), n - 1);
    else out.push(cleanRef(r));
  }
  return out;
}

/** Main-deck cards that no pool copy accounts for (they must be free basics on an intact seal). */
export function outsidePool(pool: readonly CardRef[], main: readonly CardRef[]): CardRef[] {
  const left = new Map<string, number>();
  for (const r of pool) left.set(refKey(r), (left.get(refKey(r)) ?? 0) + 1);
  const out: CardRef[] = [];
  for (const r of main) {
    const n = left.get(refKey(r)) ?? 0;
    if (n > 0) left.set(refKey(r), n - 1);
    else out.push(cleanRef(r));
  }
  return out;
}

const sameList = (a: readonly CardRef[], b: readonly CardRef[]): boolean => a.length === b.length && a.every((r, i) => refKey(r) === refKey(b[i]!));

/**
 * The invariants of a sealed deck (decks.md section 7): a seal, no maybe, commander or companion; main without free
 * basics a sub-multiset of the pool; side equal to the pool minus those cards, in pool order.
 */
export function sealIntact(deck: DeckRecord, isFreeBasic: (ref: CardRef) => boolean): boolean {
  const seal = deck.seal;
  if (!seal || deck.kind !== 'sealed') return false;
  if ((deck.maybe?.length ?? 0) > 0 || (deck.commander?.length ?? 0) > 0 || (deck.companion?.length ?? 0) > 0) return false;
  if (!outsidePool(seal.pool, deck.main).every(isFreeBasic)) return false;
  return sameList(deck.side, poolRemaining(seal.pool, deck.main));
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * "Convert to custom deck" (decks.md D4): a copy named `<name> (custom)`, kind custom, with the same main deck and the
 * rest of the pool as its sideboard; the original is not touched.
 */
export function convertToCustom(deck: DeckRecord, newId: string, now: number): DeckRecord {
  const src = cloneJson(deck);
  const seal = src.seal;
  const copy: DeckRecord = {
    id: newId,
    name: `${src.name} (custom)`.slice(0, 200),
    main: src.main.map(cleanRef),
    side: seal ? poolRemaining(seal.pool, src.main) : src.side.map(cleanRef),
    source: 'built',
    createdAt: now,
    updatedAt: now,
    kind: 'custom',
    size: src.size ?? 40,
  };
  if (src.cover) copy.cover = src.cover;
  if (src.notes) copy.notes = src.notes;
  if (seal) copy.convertedFrom = { id: src.id, name: src.name, at: now, via: seal.via, sets: [...seal.sets] };
  return copy;
}

/** A copy of a deck under a new id (a sealed deck's copy is sealed too). Summary is dropped: it belongs to a time. */
export function duplicateDeck(deck: DeckRecord, newId: string, now: number, name?: string): DeckRecord {
  const copy = cloneJson(deck);
  copy.id = newId;
  copy.name = (name ?? `${deck.name} (copy)`).slice(0, 200);
  copy.createdAt = now;
  copy.updatedAt = now;
  delete copy.summary;
  delete copy.lastPlayedAt;
  return copy;
}
