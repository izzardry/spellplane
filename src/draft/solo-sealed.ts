/**
 * Boosters opened alone in Deck mode (decks.md D11, section 6): a pool generated from one seed with the existing pack
 * generator, pack i drawing from ByteStream(`<seed>:<i>`), validated (every pack at least 8 cards, every card a
 * Scryfall id). Pure apart from the seed the caller draws. Implementer: M8-P3.
 */
import { ByteStream } from '../core/rng';
import type { CardRef, SetCode } from '../core/types';
import { generatePack } from '../data/packs';
import type { GeneratedPack, SetData } from '../data/types';

/** Stored as `DeckSeal.generator`, so a later change to the generator does not make old seeds lie. */
export const PACK_GENERATOR_VERSION = 1;

/** Fewer cards than this in a pack: the set's booster data is not usable here. */
export const MIN_PACK_CARDS = 8;

export class BoosterError extends Error {
  constructor(
    message: string,
    readonly set: SetCode,
  ) {
    super(message);
    this.name = 'BoosterError';
  }
}

/** A pack is valid when it holds at least 8 cards and every card has a Scryfall id. */
export function validatePack(pack: GeneratedPack): boolean {
  return pack.cards.length >= MIN_PACK_CARDS && pack.cards.every((c) => typeof c.ref.sid === 'string' && c.ref.sid.length > 0);
}

export interface OpenedBoosters {
  packs: GeneratedPack[];
  /** Every card in pack order (pack 0 first; within a pack, the generator's order). */
  pool: CardRef[];
}

/**
 * Open one pack per entry of `sets` from `seed` (decks.md section 6). `data` holds the SetData of each distinct set;
 * a missing set or an invalid pack throws a BoosterError naming the set.
 */
export function openBoosters(sets: readonly SetCode[], data: ReadonlyMap<SetCode, SetData> | Record<SetCode, SetData>, seed: string): OpenedBoosters {
  const get = (code: SetCode): SetData | undefined => (data instanceof Map ? data.get(code) : (data as Record<SetCode, SetData>)[code]);
  const packs: GeneratedPack[] = [];
  sets.forEach((code, i) => {
    const set = get(code);
    if (!set) throw new BoosterError(`No booster data for ${code}`, code);
    let pack: GeneratedPack;
    try {
      pack = generatePack(set, new ByteStream(`${seed}:${i}`));
    } catch {
      throw new BoosterError(`Boosters of ${code} could not be made here`, code);
    }
    if (!validatePack(pack)) throw new BoosterError(`Boosters of ${code} could not be made here`, code);
    packs.push(pack);
  });
  const pool = packs.flatMap((p) => p.cards.map((c) => (c.ref.foil ? { sid: c.ref.sid, foil: true as const } : { sid: c.ref.sid })));
  return { packs, pool };
}

/** The packs of a seal again (the reveal draws them from the stored seed). */
export function packsOfSeal(seal: { sets: readonly SetCode[]; seed?: string }, data: ReadonlyMap<SetCode, SetData> | Record<SetCode, SetData>): GeneratedPack[] | null {
  if (!seal.seed) return null;
  try {
    return openBoosters(seal.sets, data, seal.seed).packs;
  } catch {
    return null;
  }
}

/** The set of pack i: a list shorter than the pack count repeats its last entry. */
export function setsForPacks(sets: readonly SetCode[], packs: number): SetCode[] {
  const out: SetCode[] = [];
  for (let i = 0; i < packs; i++) out.push(sets[Math.min(i, sets.length - 1)] ?? 'M21');
  return out;
}

/** 64 hex characters from 32 random bytes (the caller's `crypto.getRandomValues`). */
export function seedHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
