/**
 * The sheet model of a recorded MTGJSON fixture, read straight from the raw file (not through data/mtgjson.ts), so
 * the pack tests compare generation against MTGJSON's numbers rather than against the implementation's own trimming
 * (DESIGN "Specification: card data, packs and draft formats", Booster data and Pack generation).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TARGET_SETS = ['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21'] as const;

export interface RawCard {
  scryfallId: string;
  name: string;
  colors?: string[];
  rarity: string;
  types?: string[];
  number: string;
  manaCost?: string;
}
export interface RawSheet {
  cards: Record<string, number>;
  totalWeight: number;
  foil: boolean;
  balanceColors?: boolean;
  allowDuplicates?: boolean;
  fixed?: boolean;
}
export interface RawConfig {
  boosters: { contents: Record<string, number>; weight: number }[];
  boostersTotalWeight: number;
  sheets: Record<string, RawSheet>;
}
export interface RawSetFile {
  meta: unknown;
  data: { code: string; name: string; releaseDate: string; booster: Record<string, RawConfig>; cards: Record<string, RawCard> };
}

export function rawFixture(code: string): RawSetFile {
  const path = fileURLToPath(new URL(`../../fixtures/mtgjson/${code}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as RawSetFile;
}

/** The booster type the design prefers: draft, else default, else play (DESIGN "Booster data"). */
export function preferredConfig(raw: RawSetFile): RawConfig {
  for (const t of ['draft', 'default', 'play']) if (raw.data.booster[t]) return raw.data.booster[t];
  throw new Error(`${raw.data.code} has no draft, default or play booster`);
}

/** Probability that a pack contains a card from a foil sheet: the summed weight of layouts with a foil sheet. */
export function expectedFoilRate(cfg: RawConfig): number {
  let w = 0;
  for (const b of cfg.boosters) if (Object.keys(b.contents).some((s) => cfg.sheets[s]!.foil)) w += b.weight;
  return w / cfg.boostersTotalWeight;
}

/** Share of a sheet's weight on cards of a rarity. */
export function rarityShare(raw: RawSetFile, sheet: RawSheet, rarity: string): number {
  let w = 0;
  for (const [u, cw] of Object.entries(sheet.cards)) if (raw.data.cards[u]!.rarity === rarity) w += cw;
  return w / sheet.totalWeight;
}

/**
 * Expected number of non-foil mythics per pack from the sheet weights. Every sheet holding mythics yields one card per
 * pack in these sets, so the expectation is exact: Σ over layouts p(layout) · Σ over its non-foil sheets count · share.
 */
export function expectedMythicRate(raw: RawSetFile, cfg: RawConfig): number {
  let e = 0;
  for (const b of cfg.boosters) {
    const p = b.weight / cfg.boostersTotalWeight;
    for (const [s, n] of Object.entries(b.contents)) {
      const sheet = cfg.sheets[s]!;
      if (!sheet.foil) e += p * n * rarityShare(raw, sheet, 'mythic');
    }
  }
  return e;
}

/** The rare slot: the non-foil sheet every layout draws exactly one card from and that holds mythics. */
export function rareSlotSheet(raw: RawSetFile, cfg: RawConfig): string {
  const names = Object.keys(cfg.sheets).filter(
    (s) => !cfg.sheets[s]!.foil && rarityShare(raw, cfg.sheets[s]!, 'mythic') > 0 && cfg.boosters.every((b) => b.contents[s] === 1),
  );
  if (names.length !== 1) throw new Error(`${raw.data.code}: no unique rare slot (${names.join(', ')})`);
  return names[0]!;
}
