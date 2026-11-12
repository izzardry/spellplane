/**
 * Scryfall search-and-add (DESIGN "Pre-game", Constructed decks: "Search and build from all cards with a
 * Scryfall-backed search box"; "Specification: card data, packs and draft formats", Scryfall access: one shared
 * limiter). Answered from tests/fixtures/scryfall/m19.json by a stub fetch; nothing touches the network.
 */
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/data/limiter';
import { ScryfallClient } from '../../../src/data/scryfall';
import { ScryfallCardDataSource } from '../../../src/data/source';
import { M19 } from './helpers';

interface Call {
  url: URL;
}

/** A /cards/search stub over the M19 fixtures: name substring match, `pageSize` per page with next_page, 404 when empty. */
function stub(pageSize = 175): { calls: Call[]; fetch: (input: string) => Promise<Response> } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (input: string) => {
      const url = new URL(input);
      calls.push({ url });
      if (url.hostname !== 'api.scryfall.com' || url.pathname !== '/cards/search') return Promise.resolve(new Response('{}', { status: 400 }));
      const q = (url.searchParams.get('q') ?? '').replace(/^\((.*)\) game:paper$/, '$1').trim().toLowerCase();
      const hits = M19.filter((c) => !/Token/.test(c.type_line) && c.name.toLowerCase().includes(q));
      if (hits.length === 0) return Promise.resolve(new Response(JSON.stringify({ object: 'error', code: 'not_found' }), { status: 404 }));
      const page = hits.slice(0, pageSize).map((c) => ({ object: 'card', ...c, prices: { usd: '1.00' } }));
      return Promise.resolve(
        new Response(JSON.stringify({ object: 'list', has_more: hits.length > pageSize, next_page: `${url.origin}${url.pathname}?page=2`, data: page }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
}

function source(s: ReturnType<typeof stub>): ScryfallCardDataSource {
  return new ScryfallCardDataSource({ client: new ScryfallClient({ fetch: s.fetch, limiter: new RateLimiter({ perWindow: 1000 }) }), cache: null });
}

describe('searchCards', () => {
  it('asks Scryfall for paper cards, one printing each, by name, and returns trimmed cards', async () => {
    const s = stub();
    const found = await source(s).searchCards('  Llanowar ');
    expect(found.map((c) => c.name)).toEqual(['Llanowar Elves']);
    expect(found[0]).not.toHaveProperty('prices');
    expect(s.calls).toHaveLength(1);
    const p = s.calls[0]!.url.searchParams;
    expect(p.get('q')).toBe('(Llanowar) game:paper');
    expect(p.get('unique')).toBe('cards');
    expect(p.get('order')).toBe('name');
  });

  it('the paper filter covers every clause of an OR query (AND binds tighter than OR in Scryfall syntax)', async () => {
    const s = stub();
    await source(s).searchCards('t:goblin or t:elf');
    expect(s.calls[0]!.url.searchParams.get('q')).toBe('(t:goblin or t:elf) game:paper');
  });

  it('found cards join the card data, so the list view can show what was added at once', async () => {
    const src = source(stub());
    const [elves] = await src.searchCards('llanowar');
    expect(src.peek(elves!.id)).toEqual(elves);
  });

  it('a broad query costs one request: only the first page is read', async () => {
    const s = stub(5);
    const found = await source(s).searchCards('a');
    expect(found).toHaveLength(5);
    expect(s.calls).toHaveLength(1);
  });

  it('no match is an empty list, and an empty query asks nothing', async () => {
    const s = stub();
    const src = source(s);
    expect(await src.searchCards('zzzz no such card')).toEqual([]);
    expect(await src.searchCards('   ')).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });

  it('a Scryfall error reaches the caller (the list view shows it)', async () => {
    const src = new ScryfallCardDataSource({
      client: new ScryfallClient({ fetch: () => Promise.resolve(new Response('oops', { status: 500 })), limiter: new RateLimiter({ perWindow: 1000 }) }),
      cache: null,
    });
    await expect(src.searchCards('elves')).rejects.toThrow(/Scryfall 500/);
  });
});
