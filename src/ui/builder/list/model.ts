/**
 * The list view's model (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "a compact two-column list
 * (pool and deck) with filters and counts"). Pure functions over the shared DeckBuild (M2-C): the builder table and the
 * list view are two views of the same build, so every edit here returns a new DeckBuild that keeps everything the list
 * does not change (card order, ids, the table view's positions). Implementer: M2-P6.
 */
import type { CardRef, DeckBuild, PoolCard } from '../../../core/types';
import type { CardData } from '../../../data/types';
import type { BuilderSort } from '../../../scene/types';

/** Colour filter buttons: the five colours, multicoloured and colourless. */
export type ColourFilter = 'W' | 'U' | 'B' | 'R' | 'G' | 'M' | 'C';
export const COLOUR_FILTERS: readonly ColourFilter[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
export const COLOUR_LABELS: Readonly<Record<ColourFilter, string>> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicoloured', C: 'Colourless' };

/** Card types the type filter and the type sort know, in display order. */
export type CardKind = 'creature' | 'planeswalker' | 'battle' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'other';
export const CARD_KINDS: readonly CardKind[] = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other'];
export const KIND_LABELS: Readonly<Record<CardKind, string>> = {
  creature: 'Creatures',
  planeswalker: 'Planeswalkers',
  battle: 'Battles',
  instant: 'Instants',
  sorcery: 'Sorceries',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  land: 'Lands',
  other: 'Other',
};

/** The list view's filters; empty filters show everything. */
export interface ListFilters {
  /** Matched case-insensitively against name, type line and rules text; every word must match. */
  text: string;
  /** A card matches when one of its colours (or M for multicoloured, C for colourless) is selected. */
  colours: ColourFilter[];
  kind: CardKind | 'all';
}

export const NO_FILTERS: ListFilters = { text: '', colours: [], kind: 'all' };

/** Identical cards (same printing and finish) of one column, shown as one row with a count. */
export interface ListRow {
  key: string;
  ref: CardRef;
  /** Pool card ids in this row: deck order in the deck column, pool order in the pool column. */
  ids: string[];
  count: number;
  /** How many of the ids are dispensed basics. */
  basics: number;
  name: string;
  manaCost: string;
  typeLine: string;
  /** Card data was found (false while it loads). */
  known: boolean;
  /** A basic land: the row offers the dispenser's "one more". */
  basicLand: boolean;
}

/** A section of a column under the current sort (a colour, a mana value or a type). */
export interface ListGroup {
  key: string;
  label: string;
  rows: ListRow[];
  /** Cards (not rows) in the group. */
  count: number;
}

export interface ListColumn {
  groups: ListGroup[];
  /** Cards in the column before filtering. */
  total: number;
  /** Cards shown after filtering. */
  shown: number;
}

export interface ListModel {
  pool: ListColumn;
  deck: ListColumn;
  /** Lands in the deck (unfiltered), for the counts line. */
  deckLands: number;
}

export type CardLookup = (ref: CardRef) => CardData | null;

// ---------------------------------------------------------------------------------------------------------------------
// Card facts
// ---------------------------------------------------------------------------------------------------------------------

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** The card's colours: its own, else those of its faces (double-faced cards carry colours per face). */
export function cardColours(card: CardData): string[] {
  const raw = card.colors ?? (card.card_faces ?? []).flatMap((f) => f.colors ?? []);
  return WUBRG.filter((c) => raw.includes(c));
}

/** The front face's type line. */
export function frontType(card: CardData): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line).split(' // ')[0]!;
}

export function isLand(card: CardData): boolean {
  return /\bLand\b/.test(frontType(card));
}

export function isBasicLand(card: CardData): boolean {
  return /\bBasic\b/.test(frontType(card)) && isLand(card);
}

/** The card's kind for the type filter and the type sort; a card of several types counts as the first that applies. */
export function cardKind(card: CardData): CardKind {
  const t = frontType(card);
  const order: [CardKind, RegExp][] = [
    ['creature', /\bCreature\b/],
    ['land', /\bLand\b/],
    ['planeswalker', /\bPlaneswalker\b/],
    ['battle', /\bBattle\b/],
    ['instant', /\bInstant\b/],
    ['sorcery', /\bSorcery\b/],
    ['artifact', /\bArtifact\b/],
    ['enchantment', /\bEnchantment\b/],
  ];
  return order.find(([, re]) => re.test(t))?.[0] ?? 'other';
}

function manaCost(card: CardData): string {
  return card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
}

function rulesText(card: CardData): string {
  return [card.oracle_text ?? '', ...(card.card_faces ?? []).map((f) => `${f.name} ${f.type_line ?? ''} ${f.oracle_text ?? ''}`)].join(' ');
}

/** Whether a card passes the filters. Cards whose data is still loading pass only when no filter is set. */
export function matches(card: CardData | null, filters: ListFilters): boolean {
  const words = filters.text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!card) return words.length === 0 && filters.colours.length === 0 && filters.kind === 'all';
  if (filters.kind !== 'all' && cardKind(card) !== filters.kind) return false;
  if (filters.colours.length > 0) {
    const cs = cardColours(card);
    const ok = filters.colours.some((f) => (f === 'M' ? cs.length > 1 : f === 'C' ? cs.length === 0 : cs.includes(f)));
    if (!ok) return false;
  }
  if (words.length > 0) {
    const hay = `${card.name} ${card.type_line} ${rulesText(card)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sorting into groups (DESIGN "Pre-game", Deck building: "by colour, mana value or type")
// ---------------------------------------------------------------------------------------------------------------------

interface GroupKey {
  key: string;
  label: string;
  order: number;
}

const UNKNOWN: GroupKey = { key: 'loading', label: 'Loading', order: 99 };
const COLOUR_GROUPS: Readonly<Record<string, GroupKey>> = {
  W: { key: 'W', label: 'White', order: 0 },
  U: { key: 'U', label: 'Blue', order: 1 },
  B: { key: 'B', label: 'Black', order: 2 },
  R: { key: 'R', label: 'Red', order: 3 },
  G: { key: 'G', label: 'Green', order: 4 },
  M: { key: 'M', label: 'Multicoloured', order: 5 },
  C: { key: 'C', label: 'Colourless', order: 6 },
  L: { key: 'L', label: 'Lands', order: 7 },
};
/** Highest mana value with its own group; the last group holds this and above. */
export const MV_GROUP_MAX = 7;

/** The group a card sorts into: lands form their own group under colour and mana value. */
export function groupOf(card: CardData | null, sort: BuilderSort): GroupKey {
  if (!card) return UNKNOWN;
  if (sort === 'type') {
    const kind = cardKind(card);
    return { key: kind, label: KIND_LABELS[kind], order: CARD_KINDS.indexOf(kind) };
  }
  if (isLand(card)) return sort === 'colour' ? COLOUR_GROUPS.L! : { key: 'land', label: 'Lands', order: MV_GROUP_MAX + 1 };
  if (sort === 'colour') {
    const cs = cardColours(card);
    return COLOUR_GROUPS[cs.length > 1 ? 'M' : cs.length === 0 ? 'C' : cs[0]!]!;
  }
  const mv = Math.max(0, Math.min(MV_GROUP_MAX, Math.floor(card.cmc)));
  return { key: `mv${mv}`, label: mv === MV_GROUP_MAX ? `${MV_GROUP_MAX}+` : `${mv}`, order: mv };
}

function refKey(ref: CardRef): string {
  return `${ref.sid}${ref.foil ? '|foil' : ''}`;
}

/** Row order inside a group: mana value, then name, then printing, non-foil first. Stable for equal cards. */
function compareRows(a: ListRow & { mv: number }, b: ListRow & { mv: number }): number {
  return a.mv - b.mv || a.name.localeCompare(b.name, 'en') || a.ref.sid.localeCompare(b.ref.sid) || Number(!!a.ref.foil) - Number(!!b.ref.foil);
}

function column(cards: readonly PoolCard[], card: CardLookup, sort: BuilderSort, filters: ListFilters): ListColumn {
  const rows = new Map<string, ListRow & { mv: number; group: GroupKey }>();
  let shown = 0;
  for (const pc of cards) {
    const data = card(pc.ref);
    if (!matches(data, filters)) continue;
    shown++;
    const key = refKey(pc.ref);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        ref: pc.ref.foil ? { sid: pc.ref.sid, foil: true } : { sid: pc.ref.sid },
        ids: [],
        count: 0,
        basics: 0,
        name: data?.name ?? 'Loading card…',
        manaCost: data ? manaCost(data) : '',
        typeLine: data?.type_line ?? '',
        known: !!data,
        basicLand: !!data && isBasicLand(data),
        mv: data && !isLand(data) ? data.cmc : -1,
        group: groupOf(data, sort),
      };
      rows.set(key, row);
    }
    row.ids.push(pc.id);
    row.count++;
    if (pc.basic) row.basics++;
  }
  const groups = new Map<string, ListGroup & { order: number }>();
  for (const row of [...rows.values()].sort((a, b) => a.group.order - b.group.order || compareRows(a, b))) {
    let g = groups.get(row.group.key);
    if (!g) {
      g = { key: row.group.key, label: row.group.label, rows: [], count: 0, order: row.group.order };
      groups.set(row.group.key, g);
    }
    const { mv: _mv, group: _group, ...plain } = row;
    g.rows.push(plain);
    g.count += row.count;
  }
  return { groups: [...groups.values()].map(({ order: _order, ...g }) => g), total: cards.length, shown };
}

/**
 * Both columns of the list view: the deck (`build.main`, in deck order) and the pool (every other card, in pool
 * order), each grouped by `sort` and filtered by `filters`.
 */
export function listModel(build: DeckBuild, card: CardLookup, sort: BuilderSort, filters: ListFilters = NO_FILTERS): ListModel {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const inMain = new Set(build.main);
  const deckCards = build.main.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const poolCards = build.cards.filter((c) => !inMain.has(c.id));
  let deckLands = 0;
  for (const c of deckCards) {
    const d = card(c.ref);
    if (d && isLand(d)) deckLands++;
  }
  return { deck: column(deckCards, card, sort, filters), pool: column(poolCards, card, sort, filters), deckLands };
}

// ---------------------------------------------------------------------------------------------------------------------
// Edits: each returns a new DeckBuild and leaves the input untouched
// ---------------------------------------------------------------------------------------------------------------------

function copy(build: DeckBuild): DeckBuild {
  const out: DeckBuild = { cards: build.cards.map((c) => ({ ...c, ref: { ...c.ref } })), main: [...build.main] };
  if (build.poses) out.poses = Object.fromEntries(Object.entries(build.poses).map(([k, p]) => [k, { ...p }]));
  return out;
}

/** Move pool cards into the deck, appended in the given order (cards already in the deck or unknown ids are ignored). */
export function moveToDeck(build: DeckBuild, ids: readonly string[]): DeckBuild {
  const known = new Set(build.cards.map((c) => c.id));
  const out = copy(build);
  const inMain = new Set(out.main);
  for (const id of ids) {
    if (!known.has(id) || inMain.has(id)) continue;
    out.main.push(id);
    inMain.add(id);
  }
  return out;
}

/**
 * Move deck cards back to the pool. A dispensed basic (`basic: true`) goes back to the dispenser, which is unlimited:
 * it leaves the build (and its table position with it) instead of joining the pool.
 */
export function moveToPool(build: DeckBuild, ids: readonly string[]): DeckBuild {
  const out = copy(build);
  const leaving = new Set(ids.filter((id) => out.main.includes(id)));
  out.main = out.main.filter((id) => !leaving.has(id));
  const dispensed = new Set(out.cards.filter((c) => c.basic && leaving.has(c.id)).map((c) => c.id));
  if (dispensed.size > 0) {
    out.cards = out.cards.filter((c) => !dispensed.has(c.id));
    if (out.poses) for (const id of dispensed) delete out.poses[id];
  }
  return out;
}

/** The ids to move for one click on a row: one card, preferring dispensed basics when leaving the deck. */
export function oneOf(row: ListRow, build: DeckBuild, fromDeck: boolean): string[] {
  if (!fromDeck) return row.ids.slice(0, 1);
  const basic = new Set(build.cards.filter((c) => c.basic).map((c) => c.id));
  // The last copy added leaves first, dispensed basics before drafted ones.
  const reversed = [...row.ids].reverse();
  return [reversed.find((id) => basic.has(id)) ?? reversed[0]!].filter(Boolean);
}

/** A pool card id not used in `build`: `<prefix><n>` with the smallest n from 1. */
export function freshId(build: DeckBuild, prefix: string): string {
  const used = new Set(build.cards.map((c) => c.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Add a card from outside the pool (Scryfall search-and-add, DESIGN "Pre-game", Constructed decks: "Search and build";
 * or the dispenser's "one more" on a basic land row). Basic lands come from the dispenser (`basic: true`).
 */
export function addCard(build: DeckBuild, ref: CardRef, opts: { toDeck: boolean; basic: boolean }): DeckBuild {
  const out = copy(build);
  const id = freshId(out, opts.basic ? 'list-basic-' : 'list-add-');
  const pc: PoolCard = { id, ref: ref.foil ? { sid: ref.sid, foil: true } : { sid: ref.sid } };
  if (opts.basic) pc.basic = true;
  out.cards.push(pc);
  if (opts.toDeck) out.main.push(id);
  return out;
}
