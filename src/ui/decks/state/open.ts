/**
 * Opening boosters into a booster deck (decks.md section 3 D3 "What OPEN does"; contracts.md Part G "Decks" item 1):
 * load the set data, draw a seed, generate and validate the packs, SAVE the sealed record with the whole pool before
 * anything is shown, then (after the reveal, or at once for a quick deck) apply the suggestion so the deck is
 * "pre-made from boosters". Implementer: M8-P3.
 */
import type { CardRef, SetCode } from '../../../core/types';
import { autobuild, coloursInWords, type Suggestion } from '../../../data/deck/autobuild';
import { BASIC_LAND_NAMES, type BasicLandName } from '../../../data/deck/analyse';
import { setMain } from '../../../data/deck/edit';
import { summarise } from '../../../data/deck/summary';
import type { CardDataSource, SetData, SetDataSource } from '../../../data/types';
import { BoosterError, openBoosters, PACK_GENERATOR_VERSION, seedHex, setsForPacks } from '../../../draft/solo-sealed';
import type { DeckRecord, DeckStore } from '../../../store/types';

export interface OpenDeps {
  decks: DeckStore;
  sets: SetDataSource;
  cardData: CardDataSource;
  newId: () => string;
  now: () => number;
  /** 32 random bytes; tests and the debug hook pin it (`decks.nextSeed`). */
  seed?: () => string;
}

/** The record's name: `<SET> boosters · <day> <month>` (`MIXED` for several sets). */
export function boosterDeckName(sets: readonly SetCode[], now: number): string {
  const distinct = [...new Set(sets)];
  const d = new Date(now);
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${distinct.length === 1 ? distinct[0] : 'MIXED'} boosters · ${d.getUTCDate()} ${month}`;
}

let pinnedSeed: string | null = null;

/** Pin the next seed (debug hook `decks.nextSeed(hex)`), so a browser spec opens the same pool every time. */
export function pinNextSeed(hex: string | null): void {
  pinnedSeed = hex;
}

function drawSeed(deps: OpenDeps): string {
  if (pinnedSeed) {
    const s = pinnedSeed;
    pinnedSeed = null;
    return s;
  }
  if (deps.seed) return deps.seed();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return seedHex(bytes);
}

/**
 * Steps 1 to 4 of OPEN: the sealed record with the whole pool, an empty main deck and `revealed: 0` is written before
 * this resolves (or, with `revealed: 'all'`, every pack shown). Throws BoosterError when a set has no usable data;
 * nothing is saved then.
 */
export async function openBoosterDeck(deps: OpenDeps, packs: number, sets: readonly SetCode[], opts: { revealed?: 'none' | 'all'; name?: string } = {}): Promise<DeckRecord> {
  const perPack = setsForPacks(sets, Math.min(12, Math.max(3, packs)));
  const data = new Map<SetCode, SetData>();
  for (const code of new Set(perPack)) {
    const d = deps.sets.peek(code) ?? (await deps.sets.get(code).catch(() => null));
    if (!d) throw new BoosterError(`Could not load ${code}. Sets used before still work.`, code);
    data.set(code, d);
  }
  const seed = drawSeed(deps);
  const { pool } = openBoosters(perPack, data, seed);
  const now = deps.now();
  const record: DeckRecord = {
    id: deps.newId(),
    name: opts.name ?? boosterDeckName(perPack, now),
    main: [],
    side: pool.map((r) => ({ ...r })),
    source: 'built',
    createdAt: now,
    updatedAt: now,
    kind: 'sealed',
    size: 40,
    seal: { via: 'packs', sets: perPack, pool, seed, generator: PACK_GENERATOR_VERSION, sealedAt: now, revealed: opts.revealed === 'all' ? perPack.length : 0 },
  };
  await deps.decks.put(record);
  // Step 4: start loading the pool's card objects without waiting.
  void deps.cardData.getMany([...new Set(pool.map((r) => r.sid))]).catch(() => ({}));
  return record;
}

/** The printing of each basic for a pool (the first basic printing the card source resolves in the pool's first set). */
export async function basicRefs(cardData: CardDataSource, set: SetCode | undefined): Promise<Partial<Record<BasicLandName, CardRef>>> {
  const entries = BASIC_LAND_NAMES.map((name, i) => ({ count: 1, name, section: 'main' as const, line: i + 1, ...(set ? { set: set.toLowerCase() } : {}) }));
  const resolved = await cardData.resolveDeck({ main: entries, side: [], commander: [], companion: [] }).catch(() => null);
  const out: Partial<Record<BasicLandName, CardRef>> = {};
  for (const card of Object.values(resolved?.cards ?? {})) {
    const n = BASIC_LAND_NAMES.find((b) => b === card.name);
    if (n && !out[n]) out[n] = { sid: card.id };
  }
  return out;
}

/** The suggestion for a sealed record's pool (card data loaded first). */
export async function suggestFor(deck: DeckRecord, cardData: CardDataSource): Promise<Suggestion | null> {
  const seal = deck.seal;
  if (!seal) return null;
  const sids = [...new Set(seal.pool.map((r) => r.sid))];
  await cardData.getMany(sids).catch(() => ({}));
  const basics = await basicRefs(cardData, seal.sets[0]);
  return autobuild(seal.pool, (r) => cardData.peek(r.sid), basics);
}

/** "Suggested: green and white, 23 spells, 17 lands." */
export function suggestionText(s: Suggestion): string {
  return `Suggested: ${coloursInWords(s.colours)}, ${s.spells} spells, ${s.lands} lands.`;
}

/**
 * The end of the reveal (contracts.md Part G "Decks" item 1): every pack shown and the suggestion applied, saved with
 * a fresh summary. Returns the saved record and the suggestion.
 */
export async function finishOpening(deps: Pick<OpenDeps, 'decks' | 'cardData' | 'now'>, deck: DeckRecord): Promise<{ deck: DeckRecord; suggestion: Suggestion | null }> {
  if (!deck.seal) return { deck, suggestion: null };
  let out: DeckRecord = { ...deck, seal: { ...deck.seal, revealed: deck.seal.sets.length } };
  const suggestion = await suggestFor(out, deps.cardData);
  if (suggestion) {
    const r = setMain(out, suggestion.main, (ref) => deps.cardData.peek(ref.sid));
    if (r.ok) out = r.deck;
  }
  out = { ...out, updatedAt: deps.now() };
  out.summary = summarise(out, (r) => deps.cardData.peek(r.sid));
  await deps.decks.put(out);
  return { deck: out, suggestion };
}
