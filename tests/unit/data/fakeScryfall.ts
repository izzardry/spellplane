/**
 * A fake Scryfall API answering from tests/fixtures/scryfall/ (tests never use the network).
 * It mimics the endpoints the client uses: /cards/search (paged with next_page), POST /cards/collection
 * (max 75 identifiers, results in request order, not_found echoed), /cards/named?fuzzy= and /cards/:id.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardData } from '../../../src/data/types';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export function loadFixtureSet(file: string): CardData[] {
  return JSON.parse(readFileSync(join(FIXTURES, 'scryfall', file), 'utf8')) as CardData[];
}

export function allFixtureCards(): CardData[] {
  return readdirSync(join(FIXTURES, 'scryfall'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap(loadFixtureSet);
}

export function fixtureDecklist(file: string): string {
  return readFileSync(join(FIXTURES, 'decklists', file), 'utf8');
}

export interface FakeCall {
  method: string;
  url: string;
  path: string;
  body: unknown;
  at: number;
}

export interface FakeScryfallOptions {
  pageSize?: number;
  /** Answer 429 to these 0-based call indices. */
  rateLimitCalls?: number[];
  /** Cards served; defaults to every fixture card (sets in file-name order, m19 before m20…). */
  cards?: CardData[];
}

function lev(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export class FakeScryfall {
  readonly calls: FakeCall[] = [];
  readonly cards: CardData[];
  readonly pageSize: number;
  rateLimitCalls: Set<number>;

  constructor(opts: FakeScryfallOptions = {}) {
    // Prefer the most recent core set for name lookups like Scryfall's default printing: m19 is the full set.
    this.cards = opts.cards ?? allFixtureCards().sort((a, b) => (a.set === 'm19' ? -1 : 0) - (b.set === 'm19' ? -1 : 0));
    this.pageSize = opts.pageSize ?? 175;
    this.rateLimitCalls = new Set(opts.rateLimitCalls ?? []);
  }

  byId(id: string): CardData | undefined {
    return this.cards.find((c) => c.id === id);
  }

  byName(name: string, set?: string): CardData | undefined {
    const n = name.toLowerCase();
    return this.cards.find(
      (c) => (!set || c.set === set.toLowerCase()) && (c.name.toLowerCase() === n || (c.card_faces ?? []).some((f) => f.name.toLowerCase() === n)),
    );
  }

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const index = this.calls.length;
    this.calls.push({ method, url: input, path: url.pathname, body, at: Date.now() });
    if (url.hostname !== 'api.scryfall.com') throw new Error(`fake scryfall: unexpected host ${url.hostname}`);
    if (this.rateLimitCalls.has(index)) return json(429, { object: 'error', code: 'rate_limited', status: 429 });

    if (url.pathname === '/cards/search' && method === 'GET') return this.search(url);
    if (url.pathname === '/cards/collection' && method === 'POST') return this.collection(body);
    if (url.pathname === '/cards/named') return this.named(url);
    const m = /^\/cards\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (m) {
      const c = this.byId(m[1]!);
      return c ? json(200, { object: 'card', ...c }) : json(404, { object: 'error', code: 'not_found' });
    }
    return json(404, { object: 'error', code: 'not_found' });
  };

  private search(url: URL): Response {
    const q = url.searchParams.get('q') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    let matches: CardData[];
    const set = /(?:^|\s)e:(\w+)/.exec(q);
    if (set) {
      matches = this.cards.filter((c) => c.set === set[1]);
    } else if (/(?:^|\s)t:token/.test(q)) {
      const rest = q.replace(/t:token/, '').trim().toLowerCase();
      matches = this.cards.filter(
        (c) => c.type_line.toLowerCase().includes('token') && (!rest || c.name.toLowerCase().includes(rest) || c.type_line.toLowerCase().includes(rest) || (c.oracle_text ?? '').toLowerCase().includes(rest)),
      );
    } else matches = [];
    if (matches.length === 0) return json(404, { object: 'error', code: 'not_found', details: 'Your query didn’t match any cards.' });
    const start = (page - 1) * this.pageSize;
    const data = matches.slice(start, start + this.pageSize);
    const hasMore = start + this.pageSize < matches.length;
    const next = new URL(url.toString());
    next.searchParams.set('page', String(page + 1));
    // Scryfall's real responses carry many more fields; the client must trim them.
    const fat = data.map((c) => ({ object: 'card', ...c, prices: { usd: '0.10' }, legalities: { standard: 'not_legal' }, lang: 'en' }));
    return json(200, { object: 'list', total_cards: matches.length, has_more: hasMore, ...(hasMore ? { next_page: next.toString() } : {}), data: fat });
  }

  private collection(body: unknown): Response {
    const ids = (body as { identifiers?: Record<string, string>[] } | undefined)?.identifiers;
    if (!Array.isArray(ids) || ids.length === 0) return json(400, { object: 'error', code: 'bad_request' });
    if (ids.length > 75) return json(400, { object: 'error', code: 'bad_request', details: 'Too many identifiers' });
    const data: unknown[] = [];
    const notFound: unknown[] = [];
    for (const id of ids) {
      let c: CardData | undefined;
      if (id.id) c = this.byId(id.id);
      else if (id.set && id.collector_number) c = this.cards.find((x) => x.set === id.set!.toLowerCase() && x.collector_number === id.collector_number);
      else if (id.name && id.set) c = this.byName(id.name, id.set);
      else if (id.name) c = this.byName(id.name);
      if (c) data.push({ object: 'card', ...c, prices: {} });
      else notFound.push(id);
    }
    return json(200, { object: 'list', not_found: notFound, data });
  }

  private named(url: URL): Response {
    const fuzzy = (url.searchParams.get('fuzzy') ?? '').toLowerCase();
    let best: CardData | undefined;
    let bestD = Infinity;
    for (const c of this.cards) {
      const d = lev(fuzzy, c.name.toLowerCase());
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best && bestD <= 3 ? json(200, { object: 'card', ...best }) : json(404, { object: 'error', code: 'not_found' });
  }

  callsTo(path: string): FakeCall[] {
    return this.calls.filter((c) => c.path === path);
  }
}
