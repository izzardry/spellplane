/**
 * M2-P1 acceptance (PLAN "Acceptance tests", M2-P1): for each of the ten target sets, 10,000 generated packs from
 * fixtures match the sheet model: pack size, slot counts, mythic rate within ±0.5 percentage points of the sheet
 * weights (about 1 in 8 for M10–M15, M20, M21), foil rate within ±1 point, no duplicate non-foil card in a pack, every
 * colour present among commons when the sheet has colour balancing. Generation is deterministic for a given seed.
 *
 * The expected numbers come from the raw MTGJSON fixture (tests/unit/packs/model.ts), not from data/mtgjson.ts.
 *
 * Sample size: every per-pack property is checked on each of 50,000 packs per set (a superset of the plan's 10,000).
 * The rates use the plan's tolerances on those 50,000: at 10,000 packs ±0.5 points is only 1.5 standard errors of a
 * 1-in-8 rate, so a correct generator would miss it for about one seed in eight per set and the test would pass or
 * fail by the choice of seed; at 50,000 the same tolerance is 3.4 standard errors (DECISIONS [M2-P1]).
 */
import { describe, expect, it } from 'vitest';
import { ByteStream } from '../../../src/core/rng';
import { canonicalJson } from '../../../src/core/hash';
import { trimSetFile } from '../../../src/data/mtgjson';
import { generatePack } from '../../../src/data/packs';
import type { GeneratedPack, SetData } from '../../../src/data/types';
import {
  TARGET_SETS,
  expectedFoilRate,
  expectedMythicRate,
  preferredConfig,
  rareSlotSheet,
  rarityShare,
  rawFixture,
  type RawConfig,
  type RawSetFile,
} from '../../unit/packs/model';

const PACKS = 50_000;
const COLOURS = ['W', 'U', 'B', 'R', 'G'];
const ONE_IN_EIGHT_SETS = new Set(['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M20', 'M21']);

function sameContents(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** Pack-order class from the raw card (DESIGN "Pack generation" 4): rare/mythic 0, uncommon 1, common 2, land 3. */
function orderClass(raw: RawSetFile, uuid: string): number {
  const c = raw.data.cards[uuid]!;
  if (c.rarity === 'uncommon') return 1;
  if (c.rarity === 'common') return c.types?.includes('Land') ? 3 : 2;
  return 0;
}

interface Tally {
  foilPacks: number;
  mythics: number;
  rareSlotMythics: number;
  layouts: number[];
}

/** Checks every per-pack property of the sheet model, reporting failures to `fail`, and tallies the rates. */
function checkPack(raw: RawSetFile, cfg: RawConfig, pack: GeneratedPack, tally: Tally, rareSlot: string, fail: (msg: string) => void): void {
  const check = (ok: boolean, msg: () => string): void => {
    if (!ok) fail(msg());
  };
  check(pack.set === raw.data.code, () => `set ${pack.set}`);
  // Slot counts and pack size: the per-sheet counts equal one layout's contents.
  const counts: Record<string, number> = {};
  for (const c of pack.cards) counts[c.sheet] = (counts[c.sheet] ?? 0) + 1;
  const layout = cfg.boosters.findIndex((b) => sameContents(b.contents, counts));
  if (layout < 0) return fail(`slot counts ${JSON.stringify(counts)} match no layout`);
  tally.layouts[layout]! += 1;
  const size = Object.values(cfg.boosters[layout]!.contents).reduce((a, b) => a + b, 0);
  check(pack.cards.length === size, () => `pack size ${pack.cards.length}, layout says ${size}`);

  const nonFoil = new Set<string>();
  let hasFoil = false;
  for (const c of pack.cards) {
    const sheet = cfg.sheets[c.sheet]!;
    // Every card comes from its sheet, maps to the fixture's Scryfall id and is foil exactly when the sheet is.
    if (!((sheet.cards[c.uuid] ?? 0) > 0)) {
      fail(`${c.uuid} is not on sheet ${c.sheet}`);
      continue;
    }
    const card = raw.data.cards[c.uuid]!;
    check(c.ref.sid === card.scryfallId, () => `${c.uuid} maps to ${c.ref.sid}, fixture says ${card.scryfallId}`);
    check(c.rarity === card.rarity, () => `${card.name} rarity ${c.rarity}`);
    check((c.ref.foil === true) === sheet.foil, () => `${card.name} foil flag ${String(c.ref.foil)} on ${c.sheet}`);
    if (sheet.foil) hasFoil = true;
    else {
      // No duplicate non-foil card in a pack.
      check(!nonFoil.has(c.ref.sid), () => `duplicate non-foil ${card.name}`);
      nonFoil.add(c.ref.sid);
      if (card.rarity === 'mythic') tally.mythics += 1;
      if (c.sheet === rareSlot && card.rarity === 'mythic') tally.rareSlotMythics += 1;
    }
  }
  if (hasFoil) tally.foilPacks += 1;

  // Colour balancing: a balanced sheet drawing at least five cards shows a mono-coloured card of every colour.
  for (const [name, n] of Object.entries(counts)) {
    const sheet = cfg.sheets[name]!;
    if (!sheet.balanceColors || n < 5) continue;
    const drawn = pack.cards.filter((c) => c.sheet === name).map((c) => raw.data.cards[c.uuid]!);
    for (const colour of COLOURS) {
      const sheetHasMono = Object.keys(sheet.cards).some((u) => raw.data.cards[u]!.colors?.length === 1 && raw.data.cards[u]!.colors![0] === colour);
      if (sheetHasMono) check(drawn.some((c) => c.colors?.length === 1 && c.colors[0] === colour), () => `no mono-${colour} card among ${name}`);
    }
  }

  // Real pack order: among non-foil cards, rare or mythic first, then uncommons, commons, the land.
  const classes = pack.cards.filter((c) => c.ref.foil !== true).map((c) => orderClass(raw, c.uuid));
  check(
    classes.every((k, i) => i === 0 || k >= classes[i - 1]!),
    () => `pack order ${classes.join(',')}`,
  );
  if (classes.includes(3)) check(orderClass(raw, pack.cards[pack.cards.length - 1]!.uuid) === 3, () => 'the land is not last');
}

function packsHash(set: SetData, seed: string, n: number): string {
  const rnd = new ByteStream(seed);
  const packs: GeneratedPack[] = [];
  for (let i = 0; i < n; i++) packs.push(generatePack(set, rnd));
  return canonicalJson(packs);
}

describe('M2-P1 acceptance: 10,000 packs per target set match the sheet model', () => {
  for (const code of TARGET_SETS) {
    it(`${code}`, () => {
      const raw = rawFixture(code);
      const cfg = preferredConfig(raw);
      const set = trimSetFile(raw);
      expect(set).not.toBeNull();
      const rareSlot = rareSlotSheet(raw, cfg);
      const tally: Tally = { foilPacks: 0, mythics: 0, rareSlotMythics: 0, layouts: cfg.boosters.map(() => 0) };
      const rnd = new ByteStream(`m2-p1 acceptance ${code}`);
      const failures: string[] = [];
      const fail = (msg: string): void => {
        if (failures.length < 20) failures.push(msg);
      };
      for (let i = 0; i < PACKS; i++) checkPack(raw, cfg, generatePack(set!, rnd), tally, rareSlot, (m) => fail(`pack ${i}: ${m}`));
      expect(failures).toEqual([]);

      // Mythic rate within ±0.5 points of the sheet weights, overall and in the rare slot.
      const rareSlotShare = rarityShare(raw, cfg.sheets[rareSlot]!, 'mythic');
      expect(Math.abs(tally.rareSlotMythics / PACKS - rareSlotShare)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(tally.mythics / PACKS - expectedMythicRate(raw, cfg))).toBeLessThanOrEqual(0.005);
      if (ONE_IN_EIGHT_SETS.has(code)) expect(Math.abs(rareSlotShare - 1 / 8)).toBeLessThan(0.002);

      // Foil rate within ±1 point of the layout weights.
      expect(Math.abs(tally.foilPacks / PACKS - expectedFoilRate(cfg))).toBeLessThanOrEqual(0.01);
      // Every layout is chosen at its weight (±1 point).
      cfg.boosters.forEach((b, i) => expect(Math.abs(tally.layouts[i]! / PACKS - b.weight / cfg.boostersTotalWeight)).toBeLessThanOrEqual(0.01));
    });
  }

  it('is deterministic for a given seed and differs between seeds', () => {
    for (const code of TARGET_SETS) {
      const set = trimSetFile(rawFixture(code))!;
      const a = packsHash(set, `seed ${code}`, 50);
      expect(packsHash(set, `seed ${code}`, 50)).toBe(a);
      // A freshly trimmed copy of the set (another browser) generates the same packs.
      expect(packsHash(trimSetFile(rawFixture(code))!, `seed ${code}`, 50)).toBe(a);
      expect(packsHash(set, `other ${code}`, 50)).not.toBe(a);
    }
  });
});
