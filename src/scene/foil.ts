/**
 * Foil sheen and badge (DESIGN "Pre-game", Pack generation: "Foils are marked with a subtle sheen and a badge"; "Card
 * faces are never recoloured"). Shared by the draft, the builder and the play table.
 *
 * The sheen is a thin rim outside the face whose light hue drifts slowly, each card a little out of phase; with reduced
 * motion the rim holds still.
 */
export const FOIL_SHEEN = { widthMm: 0.9, periodMs: 6000, saturation: 55, lightness: 72, frameMs: 50 } as const;

/** The sheen's hue at `phase` (0..1 of the period) for the card at `cardIndex`, 0..1. */
export function foilHue(phase: number, cardIndex: number): number {
  return ((((phase + cardIndex * 0.13) % 1) + 1) % 1);
}

export function foilSheenColour(phase: number, cardIndex: number): string {
  const hue = Math.round(foilHue(phase, cardIndex) * 360);
  return `hsl(${hue}, ${FOIL_SHEEN.saturation}%, ${FOIL_SHEEN.lightness}%)`;
}

/**
 * The play table's foil marker (DECISIONS M4-G): the cards of a battlefield lie close together, so there is no gutter for
 * the draft's badge beside the card. The rim is a little wider than the draft's (it must read at play zoom), and the
 * badge is a small diamond over the card's bottom-left corner, on the collector line, clear of the name, mana cost,
 * type line, rules text and power/toughness. The face itself is never tinted.
 */
export const TABLE_FOIL = {
  rimMm: 1.2,
  /** Badge centre in card-local mm from the card's bottom-left corner, and its half-diagonal. */
  badge: { inset: 5.2, radius: 3.2, outline: 0.55 },
} as const;
