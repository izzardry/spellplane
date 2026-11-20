/**
 * A CardDataSource over a fixed list of card objects: lookups answer at once and never fetch; search evaluates the
 * Scryfall terms Deck mode uses (data/deck/query.ts). The fixture source of dev and test builds (debug/fixture-cards.ts)
 * and the decks harness stand on it, so browser tests never touch the network. Implementer: M8-P3 (moved from
 * debug/fixture-cards.ts, behaviour unchanged).
 */
import type { CardRef, ScryfallId } from '../../core/types';
import { relatedTokenIds } from '../cards';
import { nearMatches, normaliseName } from '../decklist';
import { namesCard } from '../source';
import type { CardData, CardDataSource, CardSearchOptions, DeckEntry, DeckList, ParseError, ResolvedDeck } from '../types';
import { queryMatcher, sortCards } from './query';

/** Scryfall's first page holds 175 cards (decks.md section 3). */
const SEARCH_LIMIT = 175;

function isToken(c: CardData): boolean {
  return c.layout === 'token' || /\bToken\b/.test(c.type_line);
}

/** Card data from a fixed list; lookups answer immediately and never fetch. */
export class ListCardDataSource implements CardDataSource {
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
        for (let i = 0; i < e.count; i++) out.push(e.foil ? { sid: c.id, foil: true } : { sid: c.id });
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
   * The builder's search-and-add over the fixtures (M2-P7, standing in for Scryfall's /cards/search): non-token cards,
   * one per name. A query with Scryfall terms (`t:creature`, `id<=gw`, `mv>=5`, `or`, parentheses; M8-P3) is evaluated
   * by data/deck/query.ts; plain words match the name, a face name or the type line. Sorted by `options.order`
   * (popular: EDHREC rank then rarity, as a stand-in for Scryfall's popularity; mana value; name).
   */
  searchCards(query: string, options: CardSearchOptions = {}): Promise<CardData[]> {
    if (this.offline) return Promise.reject(new Error('offline'));
    const q = query.trim();
    if (q === '') return Promise.resolve([]);
    const syntax = /[:<>=()"]|(^|\s)or(\s|$)|(^|\s)-\S/i.test(q);
    const words = normaliseName(q).split(/\s+/).filter((w) => w !== '');
    const matcher = syntax ? queryMatcher(q) : null;
    const seen = new Set<string>();
    const out: CardData[] = [];
    for (const c of this.byId.values()) {
      if (isToken(c) || seen.has(c.name)) continue;
      if (matcher) {
        if (!matcher(c)) continue;
      } else {
        const text = normaliseName([c.name, ...(c.card_faces ?? []).map((f) => f.name), c.type_line].join(' '));
        if (!words.every((w) => text.includes(w))) continue;
      }
      seen.add(c.name);
      out.push(c);
    }
    return Promise.resolve(sortCards(out, options.order ?? 'name').slice(0, SEARCH_LIMIT));
  }

  /** Card search answers "offline" while set (the decks debug hook's setOffline; M8-P3). */
  offline = false;

  searchTokens(query: string): Promise<CardData[]> {
    const q = normaliseName(query);
    return Promise.resolve([...this.byId.values()].filter((c) => isToken(c) && normaliseName(c.name).includes(q)));
  }

  relatedTokens(card: CardData): Promise<CardData[]> {
    return Promise.resolve(relatedTokenIds(card).flatMap((id) => (this.byId.has(id) ? [this.byId.get(id)!] : [])));
  }
}

