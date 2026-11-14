/**
 * Table objects, dice and seat randomness (DESIGN "Card manipulation", Other table objects: "Dice (any size) and coin
 * flips with shared, logged results; a generic counter object for emblems, monarch, initiative or day/night; token
 * cards; text sticky notes"; "Players, seats and formats": a random seat shuffle and a public random first player;
 * "Combat and annotation": lines carry an optional short label). Contracts: M6-C. Implementer: M6-P3 (the reducer cases
 * of `rngApply` and `lineLabel`, the table-object UI). Pure: no clock, randomness or DOM.
 */
import { seatedInOrder } from './drafting';
import type { RngId, SeatId, TableState } from './types';

/** Die sizes the HUD offers (DESIGN "Card manipulation", Other table objects: "Dice (any size)"); any `n` ≥ 2 is valid in `rngCommit`. Added by M6-C. */
export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

/** The die Ctrl+I rolls until the player picks another size (DESIGN "Input and interaction design": Ctrl+I roll die). Added by M6-C. */
export const DEFAULT_DIE_SIDES = 6;

/** Longest line label in characters, as `lineAdd` already accepts (DESIGN "Combat and annotation": "an optional short label"). Added by M6-C. */
export const LINE_LABEL_MAX = 200;

/** k! for small k (seat shuffles have at most four seated players). */
function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

/**
 * The `index`-th permutation of 0..k-1 in lexicographic order (index taken modulo k!): the seat shuffle's outcome, so a
 * `seatShuffle` round over k seated players uses `n = k!` outcomes (DESIGN "Players, seats and formats", random seat
 * shuffle). Entry i is the old position (among the seated players in seat-index order) of the player who takes the i-th
 * taken chair. Added by M6-C.
 */
export function seatPermutation(index: number, k: number): number[] {
  const pool = Array.from({ length: k }, (_, i) => i);
  let rest = ((index % factorial(k)) + factorial(k)) % factorial(k);
  const out: number[] = [];
  for (let i = k; i >= 1; i--) {
    const f = factorial(i - 1);
    const pick = Math.floor(rest / f);
    rest -= pick * f;
    out.push(pool.splice(pick, 1)[0]!);
  }
  return out;
}

/**
 * The seat a finished 'firstPlayer' round picked: the `result`-th seated seat in seat-index order (core/drafting.ts `seatedInOrder`), or null while the
 * round has no result or is not a first-player round (DESIGN "Players, seats and formats": a public random first
 * player). Added by M6-C.
 */
export function firstPlayerOf(state: TableState, rid: RngId): SeatId | null {
  const r = Object.hasOwn(state.rng, rid) ? state.rng[rid] : undefined;
  if (!r || r.purpose !== 'firstPlayer' || r.result === null) return null;
  return seatedInOrder(state)[r.result] ?? null;
}
