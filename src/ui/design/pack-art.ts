/**
 * The drawn booster pack's sigil (docs/design/m8/contracts.md Part B "BoosterFan"; visual.md 2.8 "Booster pack"): pure
 * and seeded by an FNV-1a hash of `"<code>:<index>"`. No set's real art or logo is used. Added by M8-C; M8-P1 owns it.
 */

/** The sigil of one pack: a star with `points` points, turned `turnDeg`, inside `rings` circles. */
export interface PackArt {
  points: number;
  turnDeg: number;
  rings: number;
}

/** FNV-1a, 32 bit. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The pack art of the `index`th pack of set `setCode` (visual.md 2.8: points 5–8, turn 0–359, rings 2–3). */
export function packArt(setCode: string, index: number): PackArt {
  const h = fnv1a(`${setCode.toUpperCase()}:${index}`);
  return { points: 5 + (h % 4), turnDeg: (h >>> 8) % 360, rings: 2 + ((h >>> 20) % 2) };
}
