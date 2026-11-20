/**
 * Search chips and queries (decks.md section 3, "Filter chips", "Quick chips"): chips compile to Scryfall query terms
 * and combine with the typed text. `matchesQuery` evaluates the subset of Scryfall's syntax those terms use, for the
 * pool page's local filter and the fixture card source (which stands in for Scryfall in tests). Pure. Implementer: M8-P3.
 */
import type { CardData, CardSearchOptions } from '../types';
import { normaliseName } from '../decklist';
import { COLOURS, rulesText, type ManaSymbol } from './analyse';

export const TYPE_CHIPS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'] as const;
export type TypeChip = (typeof TYPE_CHIPS)[number];

export interface ChipState {
  text?: string;
  /** W U B R G C (multi-select). */
  colours?: readonly ManaSymbol[];
  /** Mana values 0 … 7 (7 means 7 or more). */
  mv?: readonly number[];
  types?: readonly TypeChip[];
  rarity?: 'common' | 'uncommon' | 'rare' | 'mythic' | null;
  set?: string | null;
  format?: string | null;
}

const either = (terms: string[]): string => (terms.length === 1 ? terms[0]! : `(${terms.join(' or ')})`);

/** The colour term: `id<=wu`; C alone `id:c`; nothing without a colour. */
export function colourTerm(colours: readonly ManaSymbol[]): string | null {
  const coloured = COLOURS.filter((c) => colours.includes(c));
  if (coloured.length > 0) return `id<=${coloured.join('').toLowerCase()}`;
  if (colours.includes('C')) return 'id:c';
  return null;
}

/** The mana value term: `mv=2`, `(mv=2 or mv=3)`, `mv>=7`. */
export function mvTerm(mv: readonly number[]): string | null {
  const vs = [...new Set(mv)].filter((v) => Number.isInteger(v) && v >= 0 && v <= 7).sort((a, b) => a - b);
  if (vs.length === 0) return null;
  return either(vs.map((v) => (v === 7 ? 'mv>=7' : `mv=${v}`)));
}

/** The query of a chip state: the text first, then colour, mana value, type, rarity, set and format terms. */
export function compileQuery(s: ChipState): string {
  const terms: string[] = [];
  const text = (s.text ?? '').trim();
  if (text) terms.push(text);
  const c = colourTerm(s.colours ?? []);
  if (c) terms.push(c);
  const m = mvTerm(s.mv ?? []);
  if (m) terms.push(m);
  const types = (s.types ?? []).filter((t) => (TYPE_CHIPS as readonly string[]).includes(t));
  if (types.length) terms.push(either(types.map((t) => `t:${t}`)));
  if (s.rarity) terms.push(`r:${s.rarity}`);
  if (s.set) terms.push(`e:${s.set.toLowerCase()}`);
  if (s.format) terms.push(`f:${s.format.toLowerCase()}`);
  return terms.join(' ');
}

export const QUICK_CHIPS = {
  cheapCreatures: { label: 'Cheap creatures', query: 't:creature mv<=3' },
  removal: { label: 'Removal', query: '(o:"destroy target" or o:"exile target" or o:"damage to any target" or o:"damage to target creature")' },
  cardDraw: { label: 'Card draw', query: '(o:"draw two cards" or o:"draw three cards" or o:"draw a card") (t:instant or t:sorcery or t:enchantment)' },
  finishers: { label: 'Finishers', query: 't:creature mv>=5 r>=rare' },
  lands: { label: 'Lands', query: 't:land -t:basic' },
} as const;
export type QuickChip = keyof typeof QUICK_CHIPS;

/** A quick chip's query within the deck's colours (`id<=` them), or without a colour term when it has none. */
export function quickQuery(chip: QuickChip, deckColours: readonly ManaSymbol[]): string {
  const c = colourTerm(deckColours.filter((x) => x !== 'C'));
  return c ? `${QUICK_CHIPS[chip].query} ${c}` : QUICK_CHIPS[chip].query;
}

export const SORTS = [
  { value: 'edhrec', label: 'Popular' },
  { value: 'cmc', label: 'Mana value' },
  { value: 'name', label: 'Name' },
] as const satisfies readonly { value: NonNullable<CardSearchOptions['order']>; label: string }[];

// ---------------------------------------------------------------------------------------------------------------------
// A small evaluator of the terms above
// ---------------------------------------------------------------------------------------------------------------------

type Node = { kind: 'and' | 'or'; items: Node[] } | { kind: 'not'; item: Node } | { kind: 'term'; key: string; op: string; value: string } | { kind: 'word'; value: string };

function tokenise(q: string): string[] {
  const out: string[] = [];
  const re = /\s*(\(|\)|-?[a-zA-Z]+(?:<=|>=|!=|:|=|<|>)(?:"[^"]*"|[^\s()]+)|-|"[^"]*"|[^\s()]+)/y;
  re.lastIndex = 0;
  while (re.lastIndex < q.length) {
    const m = re.exec(q);
    if (!m) break;
    out.push(m[1]!);
  }
  return out;
}

function parse(tokens: string[]): Node {
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const orExpr = (): Node => {
    const items = [andExpr()];
    while (peek()?.toLowerCase() === 'or') {
      i++;
      items.push(andExpr());
    }
    return items.length === 1 ? items[0]! : { kind: 'or', items };
  };
  const andExpr = (): Node => {
    const items: Node[] = [];
    while (i < tokens.length && peek() !== ')' && peek()?.toLowerCase() !== 'or') {
      const u = unary();
      if (u) items.push(u);
    }
    return items.length === 1 ? items[0]! : { kind: 'and', items };
  };
  const unary = (): Node | null => {
    const t = tokens[i++]!;
    if (t === '(') {
      const e = orExpr();
      if (peek() === ')') i++;
      return e;
    }
    if (t === '-') {
      const u = unary();
      return u ? { kind: 'not', item: u } : null;
    }
    const m = /^(-?)([a-zA-Z]+)(<=|>=|!=|:|=|<|>)(.*)$/.exec(t);
    if (m) {
      const term: Node = { kind: 'term', key: m[2]!.toLowerCase(), op: m[3]!, value: m[4]!.replace(/^"|"$/g, '') };
      return m[1] ? { kind: 'not', item: term } : term;
    }
    return { kind: 'word', value: t.replace(/^"|"$/g, '') };
  };
  return orExpr();
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];
const RARITY_SHORT: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic' };

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '!=':
      return a !== b;
    default:
      return a === b;
  }
}

function colourSet(v: string): Set<string> | null {
  const s = v.toLowerCase();
  const named: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', colorless: 'c', colourless: 'c' };
  const letters = named[s] ?? s;
  if (!/^[wubrgc]+$/.test(letters)) return null;
  return new Set(letters.toUpperCase().split('').filter((x) => x !== 'C'));
}

function term(card: CardData, key: string, op: string, value: string): boolean {
  const v = value.toLowerCase();
  switch (key) {
    case 't':
    case 'type': {
      const line = [card.type_line, ...(card.card_faces ?? []).map((f) => f.type_line ?? '')].join(' ').toLowerCase();
      return line.includes(v);
    }
    case 'o':
    case 'oracle':
      return rulesText(card).toLowerCase().includes(v);
    case 'name':
      return normaliseName(card.name).includes(normaliseName(value));
    case 'mv':
    case 'cmc': {
      const n = Number(v);
      return Number.isFinite(n) && compare(card.cmc, op === ':' ? '=' : op, n);
    }
    case 'e':
    case 's':
    case 'set':
      return card.set.toLowerCase() === v;
    case 'r':
    case 'rarity': {
      const want = RARITY_ORDER.indexOf(RARITY_SHORT[v] ?? v);
      const have = RARITY_ORDER.indexOf(card.rarity);
      if (want < 0 || have < 0) return false;
      return compare(have, op === ':' ? '=' : op, want);
    }
    case 'id':
    case 'identity':
    case 'ci':
    case 'c':
    case 'color':
    case 'colour': {
      const want = colourSet(v);
      if (!want) return false;
      const isId = key === 'id' || key === 'identity' || key === 'ci';
      const have = new Set(isId ? card.color_identity : (card.colors ?? card.card_faces?.[0]?.colors ?? []));
      const sub = [...have].every((c) => want.has(c));
      const sup = [...want].every((c) => have.has(c));
      // `id:` means "fits within"; `c:` means "has at least"; `id:c` / `c:c` is colourless.
      if (want.size === 0) return have.size === 0;
      if (op === '<=' || (op === ':' && isId)) return sub;
      if (op === '>=' || op === ':') return sup;
      if (op === '=') return sub && sup;
      if (op === '<') return sub && !sup;
      if (op === '>') return sup && !sub;
      return !(sub && sup);
    }
    // Formats, games and orders are not in the fixture data: they never narrow a local search.
    case 'f':
    case 'format':
    case 'legal':
    case 'game':
    case 'order':
    case 'unique':
      return true;
    default:
      return false;
  }
}

function evaluate(card: CardData, n: Node): boolean {
  switch (n.kind) {
    case 'and':
      return n.items.every((x) => evaluate(card, x));
    case 'or':
      return n.items.some((x) => evaluate(card, x));
    case 'not':
      return !evaluate(card, n.item);
    case 'term':
      return term(card, n.key, n.op, n.value);
    case 'word': {
      const w = normaliseName(n.value);
      if (!w) return true;
      const text = normaliseName([card.name, ...(card.card_faces ?? []).map((f) => f.name), card.type_line].join(' '));
      return text.includes(w);
    }
  }
}

/** A compiled matcher for a query (empty matches every card). */
export function queryMatcher(query: string): (card: CardData) => boolean {
  const tokens = tokenise(query.trim());
  if (tokens.length === 0) return () => true;
  const tree = parse(tokens);
  return (card) => evaluate(card, tree);
}

/** Whether a card matches a query in the subset of Scryfall's syntax above. */
export function matchesQuery(card: CardData, query: string): boolean {
  return queryMatcher(query)(card);
}

/** Sort cards as a search would: by popularity (rank, then rarity), mana value or name; ties by name, then id. */
export function sortCards(cards: CardData[], order: CardSearchOptions['order'] = 'name'): CardData[] {
  const byName = (a: CardData, b: CardData): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rank = (c: CardData): number => c.edhrec_rank ?? Number.MAX_SAFE_INTEGER;
  const rar = (c: CardData): number => -RARITY_ORDER.indexOf(c.rarity);
  if (order === 'cmc') return cards.sort((a, b) => a.cmc - b.cmc || byName(a, b));
  if (order === 'edhrec') return cards.sort((a, b) => rank(a) - rank(b) || rar(a) - rar(b) || byName(a, b));
  return cards.sort(byName);
}
