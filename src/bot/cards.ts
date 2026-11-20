/**
 * Reading a card (computer.md 5.4): kind, mana cost, land colours, keywords, power and toughness from CardData, plus
 * counters and notes on the table. Pure.
 */
import type { CardData } from '../data/types';
import type { BotCard, Colour, Keyword, ManaCost } from './types';
import { COLOURS, KEYWORDS } from './types';

/** The face the table shows (faceIndex) or the card itself. */
function face(c: CardData, faceIndex: 0 | 1): { name: string; type_line: string; mana_cost?: string; oracle_text?: string; power?: string; toughness?: string } {
  const f = c.card_faces?.[faceIndex];
  if (f && c.layout !== 'normal') return { name: f.name, type_line: f.type_line ?? c.type_line, mana_cost: f.mana_cost, oracle_text: f.oracle_text, power: f.power, toughness: f.toughness };
  return c;
}

/** Kind from the type line (computer.md 5.4). */
export function kindOf(typeLine: string): BotCard['kind'] {
  if (/\bLand\b/.test(typeLine)) return 'land';
  if (/\bCreature\b/.test(typeLine)) return 'creature';
  return 'other';
}

/** Parse `{2}{G}{G}`; null for any symbol Sparring cannot pay (X, hybrid, Phyrexian, snow, …). An empty cost is 0. */
export function parseCost(text: string | undefined): ManaCost | null {
  if (text === undefined) return null;
  const cost: ManaCost = { generic: 0, colours: {} };
  const symbols = text.match(/\{[^}]*\}/g) ?? [];
  if (symbols.join('') !== text.replace(/\s+/g, '')) return null;
  for (const s of symbols) {
    const sym = s.slice(1, -1);
    if (/^\d+$/.test(sym)) cost.generic += Number(sym);
    else if (sym === 'C') cost.generic += 1;
    else if ((COLOURS as readonly string[]).includes(sym)) cost.colours[sym as Colour] = (cost.colours[sym as Colour] ?? 0) + 1;
    else return null;
  }
  return cost;
}

/** Mana value of a parsed cost. */
export function manaValue(cost: ManaCost): number {
  return cost.generic + COLOURS.reduce((n, c) => n + (cost.colours[c] ?? 0), 0);
}

const BASIC: Record<string, Colour> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** Colours a land produces (computer.md 5.4): basic land types, else the symbols after "Add", "any color" is all five. */
export function landColours(typeLine: string, oracle: string | undefined): Colour[] {
  const out = new Set<Colour>();
  for (const [t, c] of Object.entries(BASIC)) if (new RegExp(`\\b${t}\\b`).test(typeLine)) out.add(c);
  if (out.size === 0 && oracle) {
    if (/any colou?r/i.test(oracle)) return [...COLOURS];
    for (const m of oracle.matchAll(/Add ([^.]*)/g)) for (const s of m[1]!.matchAll(/\{([WUBRG])\}/g)) out.add(s[1] as Colour);
  }
  return COLOURS.filter((c) => out.has(c));
}

/** Keywords in the rules text outside parentheses, as whole words (computer.md 5.4). */
export function keywordsOf(oracle: string | undefined): Keyword[] {
  if (!oracle) return [];
  const text = oracle.replace(/\([^)]*\)/g, ' ').toLowerCase();
  // Only keyword lines count: a line made of keywords separated by commas (so "creatures with flying" is not flying).
  const found = new Set<Keyword>();
  for (const line of text.split('\n')) {
    const parts = line.split(/,|;/).map((p) => p.trim()).filter((p) => p !== '');
    if (parts.length === 0) continue;
    const kws = parts.map((p) => KEYWORDS.find((k) => p === k) ?? null);
    if (kws.every((k) => k !== null)) for (const k of kws) found.add(k!);
  }
  return KEYWORDS.filter((k) => found.has(k));
}

/** An integer from a power or toughness string; `*` and other non-numbers are 0. */
export function stat(v: string | undefined): number {
  return v !== undefined && /^-?\d+$/.test(v) ? Number(v) : 0;
}

/**
 * Power and toughness with the table's changes (computer.md 5.4): +1/+1 and -1/-1 counters; a note `N/M` replaces the
 * result, a note `+N/+M` or `-N/-M` is added.
 */
export function adjustedStats(base: { power: number; toughness: number }, counters: Readonly<Record<string, number>>, note: string | undefined): { power: number; toughness: number } {
  const plus = counters['+1/+1'] ?? 0;
  const minus = counters['-1/-1'] ?? 0;
  let p = base.power + plus - minus;
  let t = base.toughness + plus - minus;
  const n = note?.trim() ?? '';
  const abs = /^(\d+)\s*\/\s*(\d+)$/.exec(n);
  const rel = /^([+-]\d+)\s*\/\s*([+-]\d+)$/.exec(n);
  if (abs) {
    p = Number(abs[1]);
    t = Number(abs[2]);
  } else if (rel) {
    p += Number(rel[1]);
    t += Number(rel[2]);
  }
  return { power: p, toughness: t };
}

/** A card read from its data (computer.md 5.4); without data (a token) a 1/1 'other' creature-less card. */
export function readCard(id: string, data: CardData | null, faceIndex: 0 | 1 = 0): BotCard {
  if (!data) return { id, name: 'Token', kind: 'creature', cost: null, mv: 0, colours: [], produces: [], power: 1, toughness: 1, keywords: [] };
  const f = face(data, faceIndex);
  const kind = kindOf(f.type_line);
  const cost = kind === 'land' ? { generic: 0, colours: {} } : parseCost(f.mana_cost);
  const colours = COLOURS.filter((c) => (data.colors ?? data.color_identity).includes(c));
  return {
    id,
    name: f.name,
    kind,
    cost,
    mv: cost ? manaValue(cost) : data.cmc,
    colours,
    produces: kind === 'land' ? landColours(f.type_line, f.oracle_text) : [],
    power: kind === 'creature' ? stat(f.power) : 0,
    toughness: kind === 'creature' ? stat(f.toughness) : 0,
    keywords: kind === 'creature' ? keywordsOf(f.oracle_text) : [],
  };
}

/** A face-down card of the opponent: a 2/2 with nothing known (computer.md 5.4). */
export function unknownCard(id: string): BotCard {
  return { id, name: 'a face-down card', kind: 'creature', cost: null, mv: 0, colours: [], produces: [], power: 2, toughness: 2, keywords: [] };
}

export function has(c: Pick<BotCard, 'keywords'>, k: Keyword): boolean {
  return c.keywords.includes(k);
}
