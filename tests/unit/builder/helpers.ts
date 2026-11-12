/**
 * Shared fixtures for the builder tests: M19 card data from tests/fixtures/scryfall/m19.json (the PLAN's fixture pool)
 * and small builders of DeckBuilds.
 */
import type { CardRef, DeckBuild, PoolCard } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import { loadFixtureSet } from '../data/fakeScryfall';

export const M19: CardData[] = loadFixtureSet('m19.json');
const byId = new Map(M19.map((c) => [c.id, c] as const));

/** The first M19 card of that exact name. */
export function m19(name: string): CardData {
  const c = M19.find((x) => x.name === name);
  if (!c) throw new Error(`no M19 fixture card named ${name}`);
  return c;
}
export const sid = (name: string): string => m19(name).id;

/** Card lookup over the M19 fixtures (what CardDataSource.peek gives the builder). */
export function lookup(ref: CardRef): CardData | null {
  return byId.get(ref.sid) ?? null;
}

/** Pool cards from names: `p1`, `p2`, … in order; a trailing `*` marks a foil, a leading `+` a dispensed basic. */
export function pool(names: readonly string[]): PoolCard[] {
  return names.map((raw, i) => {
    const basic = raw.startsWith('+');
    const foil = raw.endsWith('*');
    const name = raw.replace(/^\+/, '').replace(/\*$/, '');
    const pc: PoolCard = { id: basic ? `b${i + 1}` : `p${i + 1}`, ref: foil ? { sid: sid(name), foil: true } : { sid: sid(name) } };
    if (basic) pc.basic = true;
    return pc;
  });
}

/** A build of these pool cards with the given ids in the deck and no table positions yet. */
export function buildOf(names: readonly string[], main: readonly string[] = []): DeckBuild {
  return { cards: pool(names), main: [...main] };
}

/** A deterministic shuffle (LCG), for "whatever the layout before" tests. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A 45-card drafted pool: three M19 packs' worth of cards spread over the set, with duplicates and basics. */
export function draftedPool(): DeckBuild {
  const spells = M19.filter((c) => !/\bBasic\b/.test(c.type_line) && !/Token/.test(c.type_line));
  const names: string[] = [];
  for (let i = 0; names.length < 40; i += 7) names.push(spells[i % spells.length]!.name);
  names.push('Llanowar Elves', 'Llanowar Elves', 'Forest', 'Island', 'Mountain');
  return buildOf(names);
}
