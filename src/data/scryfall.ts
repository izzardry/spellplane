/**
 * Scryfall API client (DESIGN "Card data and images"; "Specification: card data, packs and draft formats",
 * Scryfall access). Every API request goes through one shared limiter (2 requests/s, 30 s back-off on 429).
 * `fetch` is injectable so tests answer from tests/fixtures/scryfall/ and never touch the network.
 */
import { trimCard } from './cards';
import { scryfallLimiter, type RateLimiter } from './limiter';
import { guarded, REQUEST_TIMEOUT_MS, UnreachableError } from './offline';
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
  /** How long one request may take, answer included (data/offline.ts; default REQUEST_TIMEOUT_MS.Scryfall). */
  timeoutMs?: number;
  /** Whether the browser believes it is online; offline requests fail at once instead of queueing (default navigator.onLine). */
  online?: () => boolean;
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
  private readonly timeoutMs: number;
  private readonly online: () => boolean;

  constructor(opts: ScryfallClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.limiter = opts.limiter ?? scryfallLimiter;
    this.baseUrl = opts.baseUrl ?? SCRYFALL_API;
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS.Scryfall;
    this.online = opts.online ?? (() => (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine));
  }

  /**
   * One API request through the shared limiter. A 429 pauses the limiter for 30 s and retries (up to MAX_ATTEMPTS);
   * 404 resolves to null (Scryfall's "no results"); any other error status throws a ScryfallError. A request that
   * cannot reach Scryfall, or gets no complete answer within the timeout, throws an UnreachableError (data/offline.ts)
   * at once, without retrying; while the browser is offline no request is made.
   */
  async request(url: string, init?: RequestInit): Promise<Json | null> {
    for (let attempt = 1; ; attempt++) {
      if (!this.online()) throw new UnreachableError('Scryfall', 'offline', url);
      // A retry after a 429 goes to the front of the queue so it keeps its place ahead of later requests. The deadline
      // starts when the request does, not while it waits for the limiter.
      const res = await this.limiter.schedule(
        () =>
          guarded(
            'Scryfall',
            url,
            async (signal) => {
              const r = await this.fetchFn(url, { ...init, signal, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
              if (!r.ok) return { status: r.status, body: undefined as unknown, invalid: false };
              try {
                return { status: r.status, body: (await r.json()) as unknown, invalid: false };
              } catch (e) {
                // A body cut off is a network failure (TypeError); one that is not JSON is a proxy or captive-portal page.
                if (e instanceof TypeError) throw e;
                return { status: r.status, body: undefined as unknown, invalid: true };
              }
            },
            { timeoutMs: this.timeoutMs, online: this.online },
          ),
        { front: attempt > 1 },
      );
      if (res.status === 429) {
        this.limiter.backOff();
        if (attempt >= MAX_ATTEMPTS) throw new ScryfallError('Scryfall is limiting requests (429); wait half a minute and try again.', 429, url);
        continue;
      }
      if (res.status === 404) return null;
      if (res.status < 200 || res.status > 299) throw new ScryfallError(`Scryfall ${res.status}: the card service answered with an error. Cards already loaded on this device still work; try again later.`, res.status, url);
      if (res.invalid) throw new ScryfallError('Scryfall: invalid JSON', res.status, url);
      const body = res.body;
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
