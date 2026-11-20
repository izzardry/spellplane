/**
 * Starter decks: Sparring's deck and a newcomer's first deck (computer.md 8.1 with contracts.md Part G "Computer
 * opponent" item 4): 40 cards, 17 basic lands, creatures in mana-value slots 3 / 7 / 6 / 4 / 2 / 1 (1, 2, 3, 4, 5,
 * 6 or more), up to 2 copies of a card; vanilla (class A) and keyword-only (class B) creatures first, class C (other
 * text, without the excluded drawbacks) only to fill a slot A and B cannot fill; a slot that still cannot be filled
 * borrows from the nearest slot. Pure and seeded: the same pool, colour and seed give the same deck.
 *
 * In production the pool comes from one Scryfall search per set at runtime (`cardSourcePool`), cached for the page;
 * in tests from `src/debug/fixture-starter.ts` over `tests/fixtures/starter/starter-pool.m19.json`. Card data is
 * never bundled.
 */
import { sha256Sync } from '../core/sha256';
import type { CardRef, SetCode } from '../core/types';
import { mulberry32 } from '../util/prng';
import type { CardData, CardDataSource } from './types';

/** Where the generator takes its pool of one set from (the fixture source in tests, never fetched there). */
export interface StarterPoolSource {
  /** Every card of `set` the generator may choose from. */
  pool(set: SetCode): Promise<CardData[]>;
}

/** A generated deck (computer.md 8.1). */
export interface StarterDeck {
  name: string;
  main: CardRef[];
  colour: 'W' | 'U' | 'B' | 'R' | 'G';
  set: SetCode;
}

/** Whether this build has the starter generator. */
export const STARTER_AVAILABLE: boolean = true;

/** The default set: the latest core set of the fixtures and the default boosters (store/types.ts DEFAULT_BOOSTER_SETUP). */
export const STARTER_SET: SetCode = 'M19';

/** The 40-card recipe (computer.md 8.1). */
export const STARTER_RECIPE = { size: 40, lands: 17, curve: [3, 7, 6, 4, 2, 1] as const, maxCopies: 2 } as const;

const COLOUR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' } as const;
const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' } as const;
const KEYWORDS = ['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'vigilance', 'haste', 'lifelink', 'menace', 'flash', 'hexproof', 'ward'];
const EXCLUDED = /can't attack|can't block|enters (the battlefield )?tapped|additional cost|sacrifice|upkeep|\{X\}/i;

/** The text class of a creature (computer.md 8.1): A vanilla, B keywords only, C other text, null excluded. */
export function textClass(c: CardData): 'A' | 'B' | 'C' | null {
  const text = (c.oracle_text ?? '').replace(/\([^)]*\)/g, '').trim();
  if (text === '') return 'A';
  const clauses = text
    .split(/\n|,|;/)
    .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
    .filter((s) => s !== '');
  if (clauses.every((s) => KEYWORDS.some((k) => s === k || (k === 'ward' && /^ward(\s|—|-)/.test(s))))) return 'B';
  return EXCLUDED.test(c.oracle_text ?? '') ? null : 'C';
}

const num = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
const SAFE_COST = /^(\{(\d+|[WUBRGC])\})+$/;

/** Whether `c` may go into a starter deck of `colour` (computer.md 8.1 "Eligible creature"). */
export function eligible(c: CardData, colour: keyof typeof BASIC): boolean {
  if (c.layout !== 'normal' || !/\bCreature\b/.test(c.type_line) || /\bLand\b/.test(c.type_line)) return false;
  if (!['common', 'uncommon'].includes(c.rarity)) return false;
  const colours = c.colors ?? c.color_identity;
  if (colours.length !== 1 || colours[0] !== colour) return false;
  if (!c.mana_cost || !SAFE_COST.test(c.mana_cost)) return false;
  if (num(c.power) === null || num(c.toughness) === null) return false;
  if (/\bdefender\b/i.test((c.oracle_text ?? '').replace(/\([^)]*\)/g, ''))) return false;
  return textClass(c) !== null;
}

/** The rate a slot is filled by: (power + toughness) / max(mv, 1). */
function rate(c: CardData): number {
  return (num(c.power)! + num(c.toughness)!) / Math.max(c.cmc, 1);
}

/** The slot (0..5) of a mana value: 1 → 0 … 6 or more → 5; 0 counts as 1. */
function slotOf(mv: number): number {
  return Math.min(5, Math.max(0, Math.round(mv) - 1));
}

/** A 32-bit seed from a seed string (computer.md 8.1: mulberry32(seed ^ 0x5eed)). */
function seed32(seed: string): number {
  return (parseInt(sha256Sync(`starter|${seed}`).slice(0, 8), 16) ^ 0x5eed) >>> 0;
}

/**
 * Build a starter deck from a pool (pure; computer.md 8.1). Throws when the pool cannot fill the recipe (no basic of
 * the colour, or too few creatures even after borrowing).
 */
export function buildStarterFromPool(pool: readonly CardData[], opts: { colour: keyof typeof BASIC; seed: string; set?: SetCode; name?: string }): StarterDeck {
  const { colour } = opts;
  const rand = mulberry32(seed32(opts.seed));
  const set = (opts.set ?? STARTER_SET).toUpperCase();
  // A seeded order for tie-breaks.
  const tie = new Map<string, number>();
  const byName = new Map<string, CardData>();
  for (const c of [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!eligible(c, colour) || byName.has(c.name)) continue;
    byName.set(c.name, c);
    tie.set(c.id, rand());
  }
  const candidates = [...byName.values()];
  const order = (list: CardData[]): CardData[] => [...list].sort((a, b) => rate(b) - rate(a) || tie.get(a.id)! - tie.get(b.id)!);
  const left = new Map<string, number>(candidates.map((c) => [c.id, STARTER_RECIPE.maxCopies]));
  const main: CardRef[] = [];
  const take = (list: CardData[], n: number): number => {
    let got = 0;
    for (const c of list) {
      while (got < n && (left.get(c.id) ?? 0) > 0) {
        main.push({ sid: c.id });
        left.set(c.id, left.get(c.id)! - 1);
        got++;
      }
      if (got >= n) break;
    }
    return got;
  };
  const inSlot = (s: number, cls: ('A' | 'B' | 'C')[]): CardData[] => order(candidates.filter((c) => slotOf(c.cmc) === s && cls.includes(textClass(c)!)));
  const short: number[] = [];
  STARTER_RECIPE.curve.forEach((want, s) => {
    let got = take(inSlot(s, ['A', 'B']), want);
    got += take(inSlot(s, ['C']), want - got);
    short[s] = want - got;
  });
  // A slot that cannot be filled borrows from the nearest slot (the cheaper one first on a tie).
  for (let s = 0; s < short.length; s++) {
    for (let d = 1; short[s]! > 0 && d < 6; d++) {
      for (const n of [s - d, s + d]) {
        if (n < 0 || n > 5 || short[s]! <= 0) continue;
        const got = take(inSlot(n, ['A', 'B']), short[s]!);
        short[s]! -= got;
        short[s]! -= take(inSlot(n, ['C']), short[s]!);
      }
    }
  }
  const creatures = STARTER_RECIPE.size - STARTER_RECIPE.lands;
  if (main.length !== creatures) throw new Error(`M8-P6 starter: the ${set} pool has too few ${COLOUR_NAME[colour].toLowerCase()} creatures (${main.length} of ${creatures})`);
  const basics = pool.filter((c) => c.name === BASIC[colour] && /\bBasic\b/.test(c.type_line)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (basics.length === 0) throw new Error(`M8-P6 starter: the ${set} pool has no ${BASIC[colour]}`);
  const basic = basics[Math.floor(rand() * basics.length)]!;
  for (let i = 0; i < STARTER_RECIPE.lands; i++) main.push({ sid: basic.id });
  return { name: opts.name ?? `Starter · ${COLOUR_NAME[colour]}`, main, colour, set };
}

/** Build a starter deck of one colour from the set's pool, the same for the same seed (computer.md 8.1). */
export async function buildStarterDeck(source: StarterPoolSource, opts: { colour: 'W' | 'U' | 'B' | 'R' | 'G'; seed: string; set?: SetCode; name?: string }): Promise<StarterDeck> {
  const set = (opts.set ?? STARTER_SET).toUpperCase();
  const pool = await source.pool(set);
  return buildStarterFromPool(pool, { ...opts, set });
}

/** What the production pool query keeps of a set's cards: creatures and basic lands of rarity up to uncommon. */
export function starterPoolOf(cards: readonly CardData[], set: SetCode): CardData[] {
  const s = set.toLowerCase();
  return cards.filter((c) => c.set === s && (/\bBasic\b/.test(c.type_line) || (/\bCreature\b/.test(c.type_line) && (c.rarity === 'common' || c.rarity === 'uncommon'))));
}

/** A pool source over cards already in the page (recorded fixtures in tests): never fetched. */
export function cardsPool(cards: readonly CardData[]): StarterPoolSource {
  return { pool: (set) => Promise.resolve(starterPoolOf(cards, set)) };
}

/** Sparring's deck name for a colour (computer.md 8.1). */
export function sparringDeckName(colour: keyof typeof BASIC): string {
  return `Sparring ${COLOUR_NAME[colour]}`;
}

/**
 * The production pool: one Scryfall search per set through the card source (computer.md 8.1:
 * `e:<set> (t:creature or t:basic) r<=uncommon -is:digital`, paper only), remembered for the page. The cards join the
 * source's card cache, so the deck's cards resolve without a further request.
 */
export function cardSourcePool(source: Pick<CardDataSource, 'searchCards'>): StarterPoolSource {
  const sets = new Map<string, Promise<CardData[]>>();
  return {
    pool(set) {
      const key = set.toUpperCase();
      let p = sets.get(key);
      if (!p) {
        if (!source.searchCards) return Promise.reject(new Error('M8-P6 starter: this card source cannot search'));
        p = source.searchCards(`e:${key.toLowerCase()} (t:creature or t:basic) r<=uncommon -is:digital`);
        p.catch(() => sets.delete(key));
        sets.set(key, p);
      }
      return p;
    },
  };
}
