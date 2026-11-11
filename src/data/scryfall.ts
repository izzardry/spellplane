/**
 * Scryfall API client (DESIGN "Card data and images"; "Specification: card data, packs and draft formats",
 * Scryfall access). Every API request goes through one shared limiter (2 requests/s, 30 s back-off on 429).
 * `fetch` is injectable so tests answer from tests/fixtures/scryfall/ and never touch the network.
 */
import { trimCard } from './cards';
import { scryfallLimiter, type RateLimiter } from './limiter';
import type { CardData } from './types';

export const SCRYFALL_API = 'https://api.scryfall.com';
/** `/cards/collection` accepts at most 75 identifiers per request. */
export const COLLECTION_BATCH = 75;
/** Attempts per request when Scryfall answers 429 (each preceded by the 30 s back-off). */
export const MAX_ATTEMPTS = 3;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A `/cards/collection` identifier. */
export type CardIdentifier =
  | { id: string }
  | { name: string; set?: string }
  | { set: string; collector_number: string };

export interface CollectionResult {
  /** One entry per requested identifier, in request order; null when Scryfall did not find it. */
  cards: (CardData | null)[];
  notFound: CardIdentifier[];
}

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ScryfallError';
  }
}

export interface ScryfallClientOptions {
  fetch?: FetchLike;
  limiter?: RateLimiter;
  baseUrl?: string;
}

type Json = Record<string, unknown>;

/** Lower-cased canonical key of an identifier, to match `not_found` entries to requests. */
export function identifierKey(id: CardIdentifier): string {
  if ('id' in id) return `id:${id.id.toLowerCase()}`;
  if ('name' in id) return `name:${id.name.trim().toLowerCase()}${id.set ? `:${id.set.toLowerCase()}` : ''}`;
  return `set:${id.set.toLowerCase()}:${id.collector_number.toLowerCase()}`;
}

function asIdentifier(v: unknown): CardIdentifier | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Json;
  if (typeof o.id === 'string') return { id: o.id };
  if (typeof o.set === 'string' && typeof o.collector_number === 'string') return { set: o.set, collector_number: o.collector_number };
  if (typeof o.name === 'string') return typeof o.set === 'string' ? { name: o.name, set: o.set } : { name: o.name };
  return null;
}

/** Same-origin URL check: `next_page` must stay on the API host. */
function sameHost(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export class ScryfallClient {
  private readonly fetchFn: FetchLike;
  readonly limiter: RateLimiter;
  readonly baseUrl: string;

  constructor(opts: ScryfallClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.limiter = opts.limiter ?? scryfallLimiter;
    this.baseUrl = opts.baseUrl ?? SCRYFALL_API;
  }

  /**
   * One API request through the shared limiter. A 429 pauses the limiter for 30 s and retries (up to MAX_ATTEMPTS);
   * 404 resolves to null (Scryfall's "no results"); any other error status throws a ScryfallError.
   */
  async request(url: string, init?: RequestInit): Promise<Json | null> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.limiter.schedule(() => this.fetchFn(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } }));
      if (res.status === 429) {
        this.limiter.backOff();
        if (attempt >= MAX_ATTEMPTS) throw new ScryfallError('Scryfall rate limit (429)', 429, url);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new ScryfallError(`Scryfall ${res.status}`, res.status, url);
      const body: unknown = await res.json();
      if (typeof body !== 'object' || body === null) throw new ScryfallError('Scryfall: unexpected response', res.status, url);
      return body as Json;
    }
  }

  /** `GET /cards/search`, following `next_page` until the last page. No results gives []. */
  async search(q: string, params: Record<string, string> = {}): Promise<CardData[]> {
    const sp = new URLSearchParams({ q, ...params });
    let url: string | null = `${this.baseUrl}/cards/search?${sp.toString()}`;
    const out: CardData[] = [];
    const seen = new Set<string>();
    while (url) {
      if (seen.has(url)) break;
      seen.add(url);
      const page = await this.request(url);
      if (!page) break;
      for (const raw of Array.isArray(page.data) ? page.data : []) {
        const card = trimCard(raw);
        if (card) out.push(card);
      }
      const next = page.has_more === true && typeof page.next_page === 'string' ? page.next_page : null;
      url = next && sameHost(next, this.baseUrl) ? next : null;
    }
    return out;
  }

  /** Every paper printing of a set, in set order (DESIGN: `e:<code>+game:paper&unique=prints&order=set`). */
  loadSet(code: string): Promise<CardData[]> {
    return this.search(`e:${code.toLowerCase()} game:paper`, { unique: 'prints', order: 'set' });
  }

  /** Token search (DESIGN "Card data and images", Tokens): tokens whose name, type or text match `query`. */
  searchTokens(query: string): Promise<CardData[]> {
    const q = query.trim();
    return this.search(q ? `t:token ${q}` : 't:token', { unique: 'cards', order: 'name' });
  }

  /**
   * `POST /cards/collection` in batches of 75 identifiers. Results come back in request order with null for
   * identifiers Scryfall did not find.
   */
  async collection(ids: CardIdentifier[]): Promise<CollectionResult> {
    const cards: (CardData | null)[] = [];
    const notFound: CardIdentifier[] = [];
    for (let i = 0; i < ids.length; i += COLLECTION_BATCH) {
      const batch = ids.slice(i, i + COLLECTION_BATCH);
      const body = await this.request(`${this.baseUrl}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch }),
      });
      const missing = new Set<string>();
      for (const nf of Array.isArray(body?.not_found) ? body.not_found : []) {
        const id = asIdentifier(nf);
        if (id) missing.add(identifierKey(id));
      }
      const data = (Array.isArray(body?.data) ? body.data : []).map(trimCard);
      // Scryfall returns found cards in request order, skipping the not_found identifiers.
      let j = 0;
      for (const id of batch) {
        if (missing.has(identifierKey(id)) || j >= data.length) {
          cards.push(null);
          notFound.push(id);
        } else {
          cards.push(data[j++] ?? null);
        }
      }
    }
    return { cards, notFound };
  }

  /** `GET /cards/named?fuzzy=` — Scryfall's best guess for a misspelt name, or null. */
  async fuzzyName(name: string): Promise<string | null> {
    const body = await this.request(`${this.baseUrl}/cards/named?${new URLSearchParams({ fuzzy: name }).toString()}`);
    return body && typeof body.name === 'string' ? body.name : null;
  }
}
