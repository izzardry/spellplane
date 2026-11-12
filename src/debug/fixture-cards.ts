/**
 * An in-memory CardDataSource over recorded card objects (dev and test builds only). Playwright injects the fixtures
 * of tests/fixtures/scryfall/ as `window.__spellplaneFixtures` before the page loads, and main.ts then uses this
 * source instead of Scryfall, so browser tests never touch the network (CLAUDE.md: tests never use the network;
 * card data comes from tests/fixtures/). Nothing here ships in production builds.
 */
import { relatedTokenIds } from '../data/cards';
import { nearMatches, normaliseName } from '../data/decklist';
import { namesCard } from '../data/source';
import type { CardData, CardDataSource, DeckEntry, DeckList, ParseError, ResolvedDeck } from '../data/types';
import type { CardRef, ScryfallId } from '../core/types';

/** What a test injects before the page loads. */
export interface InjectedFixtures {
  cards: CardData[];
}

declare global {
  interface Window {
    __spellplaneFixtures?: InjectedFixtures;
  }
}

function isToken(c: CardData): boolean {
  return c.layout === 'token' || /\bToken\b/.test(c.type_line);
}

/** Card data from a fixed list; lookups answer immediately and never fetch. */
export class FixtureCardDataSource implements CardDataSource {
  private readonly byId = new Map<ScryfallId, CardData>();
  /** First printing per normalised name (and per face name), in list order. */
  private readonly byName = new Map<string, CardData>();

  constructor(cards: readonly CardData[]) {
    for (const c of cards) {
      if (!this.byId.has(c.id)) this.byId.set(c.id, c);
      if (isToken(c)) continue;
      const names = [c.name, ...c.name.split(' // '), ...(c.card_faces ?? []).map((f) => f.name)];
      for (const n of names) {
        const k = normaliseName(n);
        if (k && !this.byName.has(k)) this.byName.set(k, c);
      }
    }
  }

  peek(sid: ScryfallId): CardData | null {
    return this.byId.get(sid) ?? null;
  }

  get(sid: ScryfallId): Promise<CardData | null> {
    return Promise.resolve(this.peek(sid));
  }

  getMany(sids: ScryfallId[]): Promise<Record<ScryfallId, CardData>> {
    const out: Record<ScryfallId, CardData> = {};
    for (const sid of sids) {
      const c = this.byId.get(sid);
      if (c) out[sid] = c;
    }
    return Promise.resolve(out);
  }

  private find(e: DeckEntry): CardData | undefined {
    if (e.set) {
      const set = e.set.toLowerCase();
      for (const c of this.byId.values()) {
        if (c.set !== set || isToken(c) || !namesCard(c, e.name)) continue;
        if (!e.collectorNumber || c.collector_number === e.collectorNumber) return c;
      }
    }
    return this.byName.get(normaliseName(e.name));
  }

  resolveDeck(list: DeckList): Promise<ResolvedDeck> {
    const cards: Record<ScryfallId, CardData> = {};
    const errors: ParseError[] = [];
    const refs = (section: DeckEntry[]): CardRef[] => {
      const out: CardRef[] = [];
      for (const e of section) {
        const c = this.find(e);
        if (!c) {
          errors.push({
            line: e.line,
            text: e.text ?? `${e.count} ${e.name}`,
            kind: 'unresolved',
            message: `Unknown card "${e.name}"`,
            nearMatches: nearMatches(e.name, [...this.byId.values()].filter((x) => !isToken(x)).map((x) => x.name)),
          });
          continue;
        }
        cards[c.id] = c;
        for (let i = 0; i < e.count; i++) out.push({ sid: c.id });
      }
      return out;
    };
    const deck: ResolvedDeck = { main: refs(list.main), side: refs(list.side), cards, errors };
    const commander = refs(list.commander);
    const companion = refs(list.companion);
    if (commander.length) deck.commander = commander;
    if (companion.length) deck.companion = companion;
    return Promise.resolve(deck);
  }

  /**
   * The builder's search-and-add over the fixtures (M2-P7, standing in for Scryfall's /cards/search): non-token cards
   * whose name, a face name or the type line contains every word of the query, one per name, sorted by name.
   */
  searchCards(query: string): Promise<CardData[]> {
    const words = normaliseName(query).split(/\s+/).filter((w) => w !== '');
    if (words.length === 0) return Promise.resolve([]);
    const seen = new Set<string>();
    const out: CardData[] = [];
    for (const c of this.byId.values()) {
      if (isToken(c) || seen.has(c.name)) continue;
      const text = normaliseName([c.name, ...(c.card_faces ?? []).map((f) => f.name), c.type_line].join(' '));
      if (!words.every((w) => text.includes(w))) continue;
      seen.add(c.name);
      out.push(c);
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return Promise.resolve(out);
  }

  searchTokens(query: string): Promise<CardData[]> {
    const q = normaliseName(query);
    return Promise.resolve([...this.byId.values()].filter((c) => isToken(c) && normaliseName(c.name).includes(q)));
  }

  relatedTokens(card: CardData): Promise<CardData[]> {
    return Promise.resolve(relatedTokenIds(card).flatMap((id) => (this.byId.has(id) ? [this.byId.get(id)!] : [])));
  }
}

/** The fixture card source when a test injected fixtures into this page, else null. */
export function injectedCardData(): CardDataSource | null {
  if (typeof window === 'undefined') return null;
  const f = window.__spellplaneFixtures;
  return f && Array.isArray(f.cards) ? new FixtureCardDataSource(f.cards) : null;
}
