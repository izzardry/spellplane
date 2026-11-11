/**
 * CardDataSource over Scryfall with an in-memory map and the IndexedDB card cache (DESIGN "Card data and images",
 * Caching; "Specification: card data, packs and draft formats"). Implementer: M0-P2.
 *
 * Lookup order: memory, then the `cards` store, then Scryfall (`/cards/collection`, batches of 75). Every fetched card
 * is written to the cache with its fetched-at time; cached entries older than 30 days are returned at once and
 * refreshed in the background. Ids asked for in the same tick share one cache read and one `/cards/collection` request;
 * ids Scryfall does not return answer null for MISSING_TTL_MS without asking again.
 */
import type { CardRef, ScryfallId } from '../core/types';
import { CARD_REFRESH_AGE_MS, createCardCache } from '../store/cards';
import type { CardCache } from '../store/types';
import { relatedTokenIds, trimCard } from './cards';
import { allEntries, nearMatches, normaliseName } from './decklist';
import { COLLECTION_BATCH, identifierKey, ScryfallClient, type CardIdentifier } from './scryfall';
import type { CardData, CardDataSource, DeckEntry, DeckList, ParseError, ResolvedDeck } from './types';

/** Unresolved names that get a Scryfall fuzzy lookup for near matches; the rest use known names only. */
export const MAX_FUZZY_LOOKUPS = 10;
/** How long an id Scryfall did not return answers null without asking again (cleared by refreshStale). */
export const MISSING_TTL_MS = 10 * 60 * 1000;

export interface CardDataSourceOptions {
  client?: ScryfallClient;
  /** null disables persistence (memory only). Defaults to the profile's IndexedDB cache. */
  cache?: CardCache | null;
  now?: () => number;
  refreshAgeMs?: number;
}

/**
 * Whether a card is the one a decklist line names: its full name, one of its faces' names or a ` // ` part, compared
 * normalised. A set and collector number from an export can point at a different card (Arena-only or promo numbers).
 */
export function namesCard(card: CardData, name: string): boolean {
  const n = normaliseName(name);
  if (!n) return false;
  const names = [card.name, ...card.name.split(' // '), ...(card.card_faces ?? []).map((f) => f.name)];
  return names.some((c) => normaliseName(c) === n);
}

function entryText(e: DeckEntry): string {
  if (e.text !== undefined) return e.text;
  const suffix = e.set ? ` (${e.set.toUpperCase()})${e.collectorNumber ? ` ${e.collectorNumber}` : ''}` : '';
  return `${e.count} ${e.name}${suffix}`;
}

function entryIdentifier(e: DeckEntry): CardIdentifier {
  if (e.set && e.collectorNumber) return { set: e.set, collector_number: e.collectorNumber };
  return e.set ? { name: e.name, set: e.set } : { name: e.name };
}

export class ScryfallCardDataSource implements CardDataSource {
  readonly client: ScryfallClient;
  private readonly cache: CardCache | null;
  private readonly now: () => number;
  private readonly refreshAgeMs: number;
  private readonly mem = new Map<ScryfallId, CardData>();
  /** Ids being looked up (cache, then Scryfall), so concurrent lookups share one request. */
  private readonly inflight = new Map<ScryfallId, Promise<CardData | null>>();
  private queued: { sid: ScryfallId; resolve: (c: CardData | null) => void; reject: (e: unknown) => void }[] = [];
  private flushScheduled = false;
  private readonly refreshing = new Set<ScryfallId>();
  /** Ids Scryfall did not return, with when (session only), so repeated lookups do not spend the rate limit. */
  private readonly missing = new Map<ScryfallId, number>();
  private readonly background = new Set<Promise<void>>();

  constructor(opts: CardDataSourceOptions = {}) {
    this.client = opts.client ?? new ScryfallClient();
    this.cache = opts.cache === undefined ? createCardCache() : opts.cache;
    this.now = opts.now ?? (() => Date.now());
    this.refreshAgeMs = opts.refreshAgeMs ?? CARD_REFRESH_AGE_MS;
  }

  peek(sid: ScryfallId): CardData | null {
    return this.mem.get(sid) ?? null;
  }

  async get(sid: ScryfallId): Promise<CardData | null> {
    return (await this.getMany([sid]))[sid] ?? null;
  }

  async getMany(sids: ScryfallId[]): Promise<Record<ScryfallId, CardData>> {
    const out: Record<ScryfallId, CardData> = {};
    const pending: { sid: ScryfallId; p: Promise<CardData | null> }[] = [];
    // Everything up to the first await runs synchronously, so lookups made in the same tick join one batch.
    for (const sid of new Set(sids)) {
      const c = this.mem.get(sid);
      if (c) out[sid] = c;
      else if (!this.isKnownMissing(sid)) pending.push({ sid, p: this.load(sid) });
    }
    if (pending.length > 0) {
      const found = await Promise.all(pending.map((q) => q.p));
      found.forEach((c, i) => {
        if (c) out[pending[i]!.sid] = c;
      });
    }
    return out;
  }

  /** Every paper printing of a set (for packs and the builder), cached like any other card. */
  async loadSet(code: string): Promise<CardData[]> {
    const cards = await this.client.loadSet(code);
    await this.remember(cards);
    return cards.map((c) => this.mem.get(c.id) ?? c);
  }

  async searchTokens(query: string): Promise<CardData[]> {
    const cards = await this.client.searchTokens(query);
    await this.remember(cards);
    return cards;
  }

  async relatedTokens(card: CardData): Promise<CardData[]> {
    const ids = relatedTokenIds(card);
    const found = await this.getMany(ids);
    return ids.map((id) => found[id]).filter((c): c is CardData => c !== undefined);
  }

  async resolveDeck(list: DeckList): Promise<ResolvedDeck> {
    const entries = allEntries(list);
    const byKey = new Map<string, CardIdentifier>();
    for (const e of entries) byKey.set(identifierKey(entryIdentifier(e)), entryIdentifier(e));
    const resolved = new Map<string, CardData>();
    await this.lookup([...byKey.values()], resolved);
    // The printing a line pins counts only if it is the card the line names.
    const pinned = (e: DeckEntry): CardData | undefined => {
      const c = resolved.get(identifierKey(entryIdentifier(e)));
      return c && namesCard(c, e.name) ? c : undefined;
    };
    // A set (and collector number) Scryfall does not know, or one that is another card, falls back to the name alone.
    const fallback = new Map<string, CardIdentifier>();
    for (const e of entries) {
      if (e.set && !pinned(e)) fallback.set(identifierKey({ name: e.name }), { name: e.name });
    }
    if (fallback.size > 0) await this.lookup([...fallback.values()], resolved);

    const cardFor = (e: DeckEntry): CardData | undefined => pinned(e) ?? resolved.get(identifierKey({ name: e.name }));
    const cards: Record<ScryfallId, CardData> = {};
    const unresolved: DeckEntry[] = [];
    const refs = (section: DeckEntry[]): CardRef[] => {
      const out: CardRef[] = [];
      for (const e of section) {
        const card = cardFor(e);
        if (!card) {
          unresolved.push(e);
          continue;
        }
        cards[card.id] = card;
        for (let i = 0; i < e.count; i++) out.push({ sid: card.id });
      }
      return out;
    };
    const deck: ResolvedDeck = { main: refs(list.main), side: refs(list.side), cards, errors: [] };
    const commander = refs(list.commander);
    const companion = refs(list.companion);
    if (commander.length > 0) deck.commander = commander;
    if (companion.length > 0) deck.companion = companion;
    deck.errors = await this.unresolvedErrors(unresolved);
    return deck;
  }

  /** Fetches cached entries older than 30 days again (call at start-up); resolves when done. */
  async refreshStale(): Promise<void> {
    if (!this.cache) return;
    this.missing.clear();
    const ids = (await this.cache.stale(this.now() - this.refreshAgeMs).catch(() => [])).filter((id) => !this.refreshing.has(id));
    if (ids.length > 0) await this.refresh(ids);
  }

  /** Resolves once every background refresh started so far has finished. */
  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.all([...this.background]);
  }

  private async lookup(ids: CardIdentifier[], into: Map<string, CardData>): Promise<void> {
    if (ids.length === 0) return;
    const res = await this.client.collection(ids);
    const found: CardData[] = [];
    res.cards.forEach((c, i) => {
      if (c) {
        into.set(identifierKey(ids[i]!), c);
        found.push(c);
      }
    });
    await this.remember(found);
  }

  private async unresolvedErrors(entries: DeckEntry[]): Promise<ParseError[]> {
    const known = new Set<string>();
    for (const c of this.mem.values()) known.add(c.name);
    const errors: ParseError[] = [];
    let fuzzy = 0;
    for (const e of entries) {
      const candidates = new Set(known);
      if (fuzzy < MAX_FUZZY_LOOKUPS) {
        fuzzy++;
        const guess = await this.client.fuzzyName(e.name).catch(() => null);
        if (guess) candidates.add(guess);
      }
      const near = nearMatches(e.name, candidates);
      errors.push({
        line: e.line,
        text: entryText(e),
        kind: 'unresolved',
        message: `No card named "${e.name}"${e.set ? ` in set ${e.set.toUpperCase()}` : ''} was found`,
        nearMatches: near,
      });
    }
    return errors.sort((a, b) => a.line - b.line);
  }

  private async remember(cards: CardData[]): Promise<void> {
    if (cards.length === 0) return;
    const at = this.now();
    for (const c of cards) this.mem.set(c.id, c);
    if (this.cache) await this.cache.put(cards.map((c) => ({ id: c.id, data: c, fetchedAt: at }))).catch(() => undefined);
  }

  private isKnownMissing(sid: ScryfallId): boolean {
    const at = this.missing.get(sid);
    if (at === undefined) return false;
    if (this.now() - at < MISSING_TTL_MS) return true;
    this.missing.delete(sid);
    return false;
  }

  /** One id through the cache and Scryfall; concurrent loads of an id share one promise, and all ids queued in a tick share one batch. */
  private load(sid: ScryfallId): Promise<CardData | null> {
    const existing = this.inflight.get(sid);
    if (existing) return existing;
    const p = new Promise<CardData | null>((resolve, reject) => {
      this.queued.push({ sid, resolve, reject });
    }).finally(() => this.inflight.delete(sid));
    this.inflight.set(sid, p);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => void this.flush());
    }
    return p;
  }

  /** Serves a tick's batch: one cache read for all of it, then `/cards/collection` (75 per request) for the rest. */
  private async flush(): Promise<void> {
    this.flushScheduled = false;
    let batch = this.queued;
    this.queued = [];
    // A card that reached memory since it was queued (a deck import, a set load) needs no lookup.
    batch = batch.filter((q) => {
      const c = this.mem.get(q.sid);
      if (c) q.resolve(c);
      return !c;
    });
    if (batch.length > 0 && this.cache) {
      const stale: ScryfallId[] = [];
      const hits = new Map<ScryfallId, CardData>();
      const records = await this.cache.getMany(batch.map((q) => q.sid)).catch(() => []);
      for (const r of records) {
        const card = trimCard(r.data);
        if (!card || card.id !== r.id) continue;
        if (!this.mem.has(card.id)) this.mem.set(card.id, card);
        hits.set(r.id, this.mem.get(card.id)!);
        if (r.fetchedAt < this.now() - this.refreshAgeMs) stale.push(r.id);
      }
      if (stale.length > 0) this.refreshInBackground(stale);
      batch = batch.filter((q) => {
        const c = hits.get(q.sid) ?? this.mem.get(q.sid);
        if (c) q.resolve(c);
        return !c;
      });
    }
    for (let i = 0; i < batch.length; i += COLLECTION_BATCH) {
      const chunk = batch.slice(i, i + COLLECTION_BATCH);
      try {
        const res = await this.client.collection(chunk.map((q) => ({ id: q.sid })));
        await this.remember(res.cards.filter((c): c is CardData => c !== null));
        const at = this.now();
        chunk.forEach((q, j) => {
          const c = res.cards[j] ?? null;
          if (!c) this.missing.set(q.sid, at);
          q.resolve(c);
        });
      } catch (e) {
        // Give up on the rest too: the limiter has just backed off or Scryfall is failing.
        for (const q of batch.slice(i)) q.reject(e);
        return;
      }
    }
  }

  private refreshInBackground(ids: ScryfallId[]): void {
    const fresh = ids.filter((id) => !this.refreshing.has(id));
    if (fresh.length === 0) return;
    const p = this.refresh(fresh).catch(() => undefined);
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  private async refresh(ids: ScryfallId[]): Promise<void> {
    for (const id of ids) this.refreshing.add(id);
    try {
      // One request per 75 ids, each remembered before the next, so a later failure keeps what was refreshed.
      for (let i = 0; i < ids.length; i += COLLECTION_BATCH) {
        const res = await this.client.collection(ids.slice(i, i + COLLECTION_BATCH).map((id) => ({ id })));
        await this.remember(res.cards.filter((c): c is CardData => c !== null));
      }
    } finally {
      for (const id of ids) this.refreshing.delete(id);
    }
  }
}

/** The app's card data source: Scryfall through the shared limiter, cached in the profile's IndexedDB. */
export function createCardDataSource(opts: CardDataSourceOptions = {}): ScryfallCardDataSource {
  return new ScryfallCardDataSource(opts);
}
