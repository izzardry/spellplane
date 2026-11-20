/**
 * Deck strength band names (docs/design/m8/decks.md D19 and section 5: Rough 1–20, Casual 21–40, Solid 41–60,
 * Tuned 61–80, Fierce 81–100), numbered 1 to 5 as `StrengthPips` takes them. Added by M8-P1.
 */
export const STRENGTH_BANDS = ['Rough', 'Casual', 'Solid', 'Tuned', 'Fierce'] as const;

/** The name of band 1 to 5. */
export function bandName(band: 1 | 2 | 3 | 4 | 5): (typeof STRENGTH_BANDS)[number] {
  return STRENGTH_BANDS[band - 1]!;
}
