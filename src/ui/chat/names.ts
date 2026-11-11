/**
 * `[[card name]]` lookups for chat previews (DESIGN "Chat and voice", Text chat: card names typed in double brackets
 * become hover previews). Names resolve through the card data source (Scryfall in production, recorded fixtures in
 * tests) the same way a decklist line does, so a front-face name, odd case or spacing finds the card. One lookup per
 * distinct name; results are cached for the page.
 */
import type { CardRef } from '../../core/types';
import type { CardData, CardDataSource, DeckList } from '../../data/types';

/** A resolved name: the card's printing and its data; or why it did not resolve. */
export type NameLookup = { status: 'found'; ref: CardRef; card: CardData } | { status: 'missing'; nearMatches: string[] };

function keyOf(name: string, set?: string): string {
  return `${name.trim().replace(/\s+/g, ' ').toLowerCase()}|${set?.toLowerCase() ?? ''}`;
}

export class CardNameResolver {
  private readonly pending = new Map<string, Promise<NameLookup>>();
  private readonly done = new Map<string, NameLookup>();

  constructor(private readonly source: CardDataSource) {}

  /** The cached result, or null while unknown. */
  peek(name: string, set?: string): NameLookup | null {
    return this.done.get(keyOf(name, set)) ?? null;
  }

  /** Resolve a name (with an optional set hint); never rejects: a failed lookup is 'missing'. */
  resolve(name: string, set?: string): Promise<NameLookup> {
    const k = keyOf(name, set);
    const hit = this.done.get(k);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(k);
    if (!p) {
      p = this.lookup(name, set).then(({ result, cache }) => {
        this.pending.delete(k);
        // A failed request is not remembered: the next hover asks again.
        if (cache) this.done.set(k, result);
        return result;
      });
      this.pending.set(k, p);
    }
    return p;
  }

  private async lookup(name: string, set?: string): Promise<{ result: NameLookup; cache: boolean }> {
    const entry = { count: 1, name: name.trim(), section: 'main' as const, line: 1, text: name, ...(set ? { set } : {}) };
    const list: DeckList = { main: [entry], side: [], commander: [], companion: [] };
    try {
      const r = await this.source.resolveDeck(list);
      const ref = r.main[0];
      const card = ref ? r.cards[ref.sid] : undefined;
      if (ref && card) return { result: { status: 'found', ref, card }, cache: true };
      // A set hint that matches nothing still finds the card by its name alone.
      if (set) return await this.lookup(name);
      return { result: { status: 'missing', nearMatches: r.errors[0]?.nearMatches ?? [] }, cache: true };
    } catch {
      return { result: { status: 'missing', nearMatches: [] }, cache: false };
    }
  }
}
